/**
 * Host routes for the client half.
 *
 * Uses Connection's authenticated `/api` carrier (`connection.fetch.register`),
 * never `connection.rpc.handle()`: in DSH 0.2 rc the custom-channel RPC path
 * reads `webServer` from a service shadow that has not injected it and can take
 * the whole host down at boot (documented by the simple-worktree-plus plugin).
 */
import { clientRequestSchema } from '@deepseek-ai/dsh-client-connection'
import { API_PREFIX, ENDPOINTS, RPC_NAMESPACE } from './constants.js'
import { errorText } from './util.js'

/** How many concurrent git status probes the list endpoint runs. */
const LIST_CONCURRENCY = 4

/** Error codes the client may branch on; anything else becomes `operation-failed`. */
const PUBLIC_ERROR_CODES = new Set([
  'bad-request',
  'worktree-dirty',
  'not-managed',
  'not-git-repository',
  'no-commit',
  'disabled',
  'root-unreachable',
  'limit-reached',
])

/** Success envelope understood by the client half. */
export const ok = (value) => ({ ok: true, value })

/** Failure envelope understood by the client half. */
export const fail = (code, message) => ({
  ok: false,
  error: { code, message, details: { issues: [] } },
})

/**
 * @param {object} ctx context that provides `connection`.
 * @param {object} runtime codex-worktree runtime.
 */
export function registerRoutes(ctx, runtime) {
  for (const endpoint of ENDPOINTS) {
    ctx.effect(
      () =>
        ctx.connection.fetch.register({
          path: `${API_PREFIX}/${endpoint}`,
          methods: ['POST'],
          requestBody: 'buffered',
          async fetch(request) {
            if (request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase() !== 'application/json') {
              return new Response('content type must be application/json', { status: 415 })
            }
            let body
            try {
              body = await request.json()
            } catch {
              return new Response('body is not JSON', { status: 400 })
            }
            const parsed = clientRequestSchema.safeParse(body)
            if (!parsed.success) return new Response('invalid client-request message', { status: 400 })
            const message = parsed.data
            if (message.method !== `${RPC_NAMESPACE}/${endpoint}`) {
              return Response.json({
                type: 'server-response',
                rpcId: message.rpcId,
                result: fail('bad-request', 'RPC method does not match endpoint.'),
              })
            }
            const result = await dispatch(runtime, endpoint, message.payload, request.signal)
            return Response.json({ type: 'server-response', rpcId: message.rpcId, result })
          },
        }),
      `dsh-codex-worktree ${endpoint} route`,
    )
  }
}

/** Public, read-only config snapshot the settings page renders. */
function publicConfig(config) {
  return {
    root: config.root,
    directory: config.directory,
    mode: config.mode,
    fetchBeforeCreate: config.fetchBeforeCreate,
    autoPrune: config.autoPrune,
    autoPruneKeep: config.autoPruneKeep,
  }
}

/** Run `task` over `items` with bounded concurrency, preserving order. */
async function mapLimit(items, limit, task) {
  const results = new Array(items.length)
  let cursor = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor
      cursor += 1
      results[index] = await task(items[index], index)
    }
  })
  await Promise.all(workers)
  return results
}

/** Group records by repository, annotated with live dirty state. */
async function groupedList(runtime, workspacePath, signal) {
  // A checkout created from the composer button is parked under a `pending-` key
  // until its Session starts; it has no conversation to show yet.
  const records = (await runtime.list(workspacePath)).filter((record) => record?.pending !== true)
  const annotated = await mapLimit(records, LIST_CONCURRENCY, async (record) => {
    let dirty = null
    try {
      dirty = await runtime.git.dirtyCount(record.path, undefined, signal)
    } catch {
      dirty = null
    }
    return { ...record, dirty }
  })
  /** @type {Map<string, object[]>} */
  const groups = new Map()
  for (const record of annotated) {
    const key = String(record.repoRoot ?? '')
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(record)
  }
  return [...groups.entries()]
    .map(([repoRoot, group]) => ({
      repoRoot,
      records: group.sort((left, right) => String(left.createdAt ?? '').localeCompare(String(right.createdAt ?? ''))),
    }))
    .sort((left, right) => left.repoRoot.localeCompare(right.repoRoot))
}

async function dispatch(runtime, endpoint, payload, signal) {
  const input = payload !== null && typeof payload === 'object' ? payload : {}
  try {
    if (endpoint === 'status') {
      const sessionId = requireSessionId(input)
      return ok(await runtime.status(sessionId))
    }
    if (endpoint === 'list') {
      const workspacePath = typeof input.workspacePath === 'string' ? input.workspacePath : undefined
      return ok({ repos: await groupedList(runtime, workspacePath, signal), config: publicConfig(runtime.config) })
    }
    if (endpoint === 'prune') {
      const repoRoot = typeof input.repoRoot === 'string' && input.repoRoot.length > 0 ? input.repoRoot : undefined
      return ok(await runtime.prune({ repoRoot, signal }))
    }
    if (endpoint === 'create') {
      const repoPath = typeof input.path === 'string' ? input.path.trim() : ''
      if (repoPath.length === 0) {
        const error = new Error('path is required')
        error.code = 'bad-request'
        throw error
      }
      return ok(await runtime.createCheckout({ repoPath, signal }))
    }
    if (endpoint === 'clean') {
      const sessionId = requireSessionId(input)
      return ok(
        await runtime.clean({
          sessionId,
          force: input.force === true,
          deleteBranch: input.deleteBranch === true,
          signal,
        }),
      )
    }
    return fail('bad-request', `unknown endpoint: ${endpoint}`)
  } catch (error) {
    const code = typeof error?.code === 'string' && PUBLIC_ERROR_CODES.has(error.code) ? error.code : 'operation-failed'
    return fail(code, errorText(error))
  }
}

function requireSessionId(input) {
  const sessionId = typeof input.sessionId === 'string' ? input.sessionId.trim() : ''
  if (sessionId.length === 0) {
    const error = new Error('sessionId is required')
    error.code = 'bad-request'
    throw error
  }
  return sessionId
}
