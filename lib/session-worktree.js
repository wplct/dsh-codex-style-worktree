/**
 * The codex-worktree runtime: decide, create, name, clean, prune.
 *
 * This module is deliberately free of DSH-specific imports so the pure parts
 * stay testable; every DSH capability arrives through the `ctx` passed in.
 */
import { mkdir, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { MODE_BRANCH } from './constants.js'
import {
  POOL_GITIGNORE,
  candidateName,
  destinationFor,
  generateName,
  isInsidePool,
  repoKey,
  resolvePoolRoot,
} from './pool.js'
import { earlySkipReason, lateSkipReason, recordsForRepo } from './session-policy.js'
import { createKeyedMutex, errorText, isInsideDir, samePath, warn } from './util.js'

const NAME_ATTEMPTS = 5
/** Snapshot refs live outside `refs/heads`, so they never appear as branches. */
const SNAPSHOT_PREFIX = 'refs/dsh-codex-worktree/'

/** Whether a path exists (any type). */
async function exists(path) {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

/** Compact `repo-name-hash` identity used in external pool paths. */
function repoLabel(repoRoot) {
  const name = repoRoot.split(/[\\/]/).filter(Boolean).pop() ?? 'repo'
  return `${name}-${repoKey(repoRoot)}`
}

/**
 * @param {object} options
 * @param {object} options.ctx plugin context.
 * @param {object} options.config resolved config.
 * @param {object} options.store sidecar store.
 * @param {object} options.git git helpers.
 * @param {(message: string) => void} [options.log] warn sink.
 * @returns {object} runtime API used by the plugin entry, tools, commands and routes.
 */
export function createRuntime({ ctx, config, store, git, log }) {
  const attempted = new Set()
  const withRepoLock = createKeyedMutex()
  const warnWith = log ?? ((message) => warn(ctx, message))

  /** Canonical absolute path through the fs service when it is available. */
  async function canonicalize(path, session, signal) {
    try {
      if (ctx.fs !== undefined && typeof ctx.fs.resolve === 'function') {
        const resolved = await ctx.fs.resolve(path, { signal })
        if (ctx.fs.processPath !== undefined) return ctx.fs.processPath(resolved)
      }
    } catch {
      /* fall back to the lexical path */
    }
    return path
  }

  /** Create the pool directory when missing and keep it out of `git status`. */
  async function ensurePool(poolPath) {
    const existed = await exists(poolPath)
    await mkdir(poolPath, { recursive: true })
    if (existed || !config.poolGitignore) return
    try {
      await writeFile(join(poolPath, '.gitignore'), POOL_GITIGNORE, { flag: 'wx' })
    } catch {
      /* an existing or concurrently created ignore file is fine */
    }
  }

  /** Queue one optional user-context notice; never fails the caller. */
  async function notify(agent, record) {
    if (!config.noticeOnCreate) return
    try {
      const { createUserMessage } = await import('@deepseek-ai/dsh-llm')
      agent.inject(
        createUserMessage({
          content: [
            {
              type: 'text',
              text: `This session now works in an isolated Git worktree at ${JSON.stringify(record.path)} (${record.mode}${
                record.branch === null ? ', detached HEAD' : `, branch ${JSON.stringify(record.branch)}`
              }). The original checkout is ${JSON.stringify(record.workspaceRoot)}.`,
            },
          ],
          source: { kind: 'codex-worktree' },
        }),
      )
    } catch (error) {
      warnWith(`could not queue the worktree notice: ${errorText(error)}`)
    }
  }

  /**
   * Whether the configured root may be written by this session.
   * DSH's `workspace-write` boundary is the session's original `header.cwd`, so a
   * pool outside it would be read-only for every file tool. Refuse instead of
   * handing the model an unusable checkout.
   */
  function rootIsReachable(poolPath, session) {
    if (config.root === '') return { ok: true }
    const sessionRoot = session?.header?.cwd
    if (typeof sessionRoot !== 'string' || sessionRoot.length === 0) return { ok: true }
    const policy = ctx.sandboxPolicy?.resolve?.({ session })
    const mode = policy?.mode
    if (mode === 'read-only') return { ok: false, reason: 'read-only-sandbox' }
    if (mode === 'workspace-write' && !isInsideDir(sessionRoot, poolPath)) {
      return { ok: false, reason: 'root-outside-sandbox' }
    }
    return { ok: true }
  }

  /**
   * Remove the oldest clean checkouts of one repository beyond `keep`.
   * Detached commits that are not on any branch are preserved as
   * `refs/dsh-codex-worktree/...` snapshot refs before the directory goes away.
   * Checkouts with uncommitted changes are never touched.
   */
  async function pruneRepo({ repoRoot, keep, session, signal }) {
    const limit = Number.isInteger(keep) && keep >= 0 ? keep : config.autoPruneKeep
    const records = recordsForRepo(await store.list(), repoRoot).sort((left, right) =>
      String(left.createdAt ?? '').localeCompare(String(right.createdAt ?? '')),
    )
    const excess = records.slice(0, Math.max(0, records.length - limit))
    const removed = []
    const snapshots = []
    for (const record of excess) {
      const age = Date.now() - Date.parse(record.createdAt ?? '')
      if (Number.isFinite(age) && age < config.pruneGraceMs) continue
      if (!(await exists(record.path))) {
        await store.remove(record.sessionId)
        removed.push({ path: record.path, sessionId: record.sessionId, alreadyGone: true })
        continue
      }
      const dirty = await git.dirtyCount(record.path, session, signal)
      if (dirty === null || dirty > 0) continue
      if (record.mode === 'detached' && record.branch === null) {
        try {
          const head = await git.headCommit(record.path, session, signal)
          if (record.baseCommit !== head) {
            const ref = `${SNAPSHOT_PREFIX}${generateName('', new Date())}${record.sessionId.slice(-6)}`
            await git.updateRef(record.repoRoot, ref, head, session, signal)
            snapshots.push({ ref, sessionId: record.sessionId, commit: head })
          }
        } catch (error) {
          warnWith(`could not snapshot ${record.path} before pruning: ${errorText(error)}`)
          continue
        }
      }
      try {
        await git.removeWorktree({ repoRoot: record.repoRoot, path: record.path, force: false, session, signal })
        await git.prune(record.repoRoot, session, signal)
        await store.remove(record.sessionId)
        removed.push({ path: record.path, sessionId: record.sessionId })
      } catch (error) {
        warnWith(`could not prune ${record.path}: ${errorText(error)}`)
      }
    }
    return { removed, snapshots }
  }

  /** Prune every repository that has records. */
  async function pruneAll({ session, signal } = {}) {
    const records = await store.list()
    const repos = [...new Set(records.map((record) => record.repoRoot))]
    const removed = []
    const snapshots = []
    for (const repoRoot of repos) {
      const result = await pruneRepo({ repoRoot, keep: config.autoPruneKeep, session, signal })
      removed.push(...result.removed)
      snapshots.push(...result.snapshots)
    }
    return { removed, snapshots }
  }

  /** Build one checkout inside the repo's pool; caller owns the sidecar record. */
  async function provision({ repoRoot, workspaceRoot, session, signal, agent }) {
    const poolPath = resolvePoolRoot({ root: config.root, directory: config.directory, repoRoot })
    return withRepoLock(`repo:${repoRoot}`, async () => {
      const baseName = generateName(config.namePrefix)
      let destination = null
      for (let attempt = 0; attempt < NAME_ATTEMPTS; attempt += 1) {
        const candidate = destinationFor(poolPath, candidateName(baseName, attempt))
        if (!(await exists(candidate))) {
          destination = candidate
          break
        }
      }
      if (destination === null) {
        const error = new Error('could not find a free checkout directory name')
        error.code = 'name-collision'
        throw error
      }

      await ensurePool(poolPath)
      const baseCommit = await git.baseCommit(repoRoot, config.baseRef, session, signal)
      const branch = config.mode === MODE_BRANCH ? `${config.branchPrefix}${baseName}` : null
      await git.addWorktree({
        repoRoot,
        path: destination,
        mode: config.mode,
        branch,
        baseRef: config.baseRef,
        session,
        signal,
      })
      const canonical = await canonicalize(destination, session, signal)
      if (agent !== undefined) await ctx.workingDirectory.set(agent, canonical, signal)
      return {
        sessionId: null,
        repoRoot,
        workspaceRoot,
        path: canonical,
        poolRoot: poolPath,
        repoLabel: repoLabel(repoRoot),
        mode: config.mode,
        branch,
        baseCommit,
        source: null,
        createdAt: new Date().toISOString(),
      }
    })
  }

  /**
   * Rebind a checkout created ahead of its session (the composer's "new
   * worktree" button) to the session that finally starts inside it. The row is
   * re-keyed so the header chip, `/wt-clean` and the settings page all find it.
   */
  async function adoptPending(sessionId, cwd, signal) {
    if (typeof cwd !== 'string' || cwd.length === 0) return null
    const records = await store.list()
    const match = records.find((record) => record?.pending === true && typeof record.path === 'string' && samePath(record.path, cwd))
    if (match === undefined) return null
    await store.remove(match.sessionId)
    const adopted = { ...match, sessionId, pending: false }
    await store.set(adopted)
    return adopted
  }

  /** Run auto-prune in the background, after the session already started. */
  function schedulePrune(repoRoot) {
    if (!config.autoPrune) return
    const timer = setTimeout(() => {
      void withRepoLock(`repo:${repoRoot}`, () =>
        pruneRepo({ repoRoot, keep: config.autoPruneKeep }).catch((error) =>
          warnWith(`background prune failed: ${errorText(error)}`),
        ),
      ).catch(() => undefined)
    }, 50)
    timer.unref?.()
  }

  return {
    config,
    store,
    git,

    /**
     * Create and enter a worktree for one freshly created agent.
     * Never throws: a failure leaves the session in its original directory.
     * @param {object} payload `agent/created` payload: `{agent, source, signal}`.
     * @returns {Promise<{created: boolean, reason?: string, record?: object}>}
     */
    async ensureForAgent({ agent, source, signal }) {
      const session = agent?.session
      const sessionId = session?.id
      if (typeof sessionId !== 'string' || sessionId.length === 0) return { created: false, reason: 'no-session' }
      if (attempted.has(sessionId)) return { created: false, reason: 'attempted' }
      attempted.add(sessionId)
      try {
        const cwd = ctx.workingDirectory.get(session)
        const headerCwd = session.header?.cwd
        const adopted = await adoptPending(sessionId, cwd, signal)
        if (adopted !== null) return { created: false, reason: 'adopted', record: adopted }
        const record = await store.get(sessionId)
        const markerPresent = headerCwd !== undefined && (await exists(join(cwd, config.disableMarker)))

        const early = earlySkipReason({
          enabled: config.enabled,
          source,
          isRootAgent: isRootAgent(ctx, agent),
          skipChildAgents: config.skipChildAgents,
          sessionId,
          skipSessionIdPatterns: config.skipSessionIdPatterns,
          skipPresets: config.skipPresets,
          preset: presetOf(session),
          cwd,
          headerCwd,
          record,
          markerPresent,
        })
        if (early !== null) return { created: false, reason: early }

        const repoRoot = await git.repoRoot(cwd, session, signal)
        if (repoRoot === null) return { created: false, reason: 'not-git' }

        const poolPath = resolvePoolRoot({ root: config.root, directory: config.directory, repoRoot })
        const markerAtRepo = await exists(join(repoRoot, config.disableMarker))
        if (markerAtRepo) return { created: false, reason: 'marker' }

        const reachable = rootIsReachable(poolPath, session)
        if (!reachable.ok) {
          warnWith(`configured root ${JSON.stringify(config.root)} is not writable by this session (${reachable.reason})`)
          return { created: false, reason: reachable.reason }
        }

        const [hasCommit, isLinked, records] = await Promise.all([
          git.hasCommit(repoRoot, session, signal),
          git.isLinkedWorktree(repoRoot, signal),
          store.list(),
        ])

        const late = lateSkipReason({
          repoRoot,
          hasCommit,
          isLinkedWorktree: isLinked,
          cwdInsidePool: isInsidePool(poolPath, cwd),
          recordCount: recordsForRepo(records, repoRoot).length,
          maxPerRepo: config.maxPerRepo,
        })
        if (late !== null) return { created: false, reason: late }

        if (config.fetchBeforeCreate) {
          try {
            const fetched = await git.fetchUpstream(repoRoot, session, signal)
            if (!fetched.fetched) warnWith(`skipped upstream fetch: ${fetched.reason}`)
          } catch (error) {
            warnWith(`upstream fetch failed, continuing with local refs: ${errorText(error)}`)
          }
        }

        const baseRecord = await provision({ repoRoot, workspaceRoot: cwd, session, signal, agent })
        const created = { ...baseRecord, sessionId, source: source ?? null }
        await store.set(created)
        await notify(agent, created)
        schedulePrune(repoRoot)
        return { created: true, record: created }
      } catch (error) {
        warnWith(`automatic worktree for session ${sessionId} failed: ${errorText(error)}`)
        return { created: false, reason: 'error', error: errorText(error) }
      }
    },

    /**
     * Create a checkout on demand, before its session exists (the composer's
     * "new worktree" button). The record is parked with a `pending-` key and is
     * re-keyed by {@link ensureForAgent} as soon as an agent starts inside it.
     * @param {{repoPath: string, signal?: AbortSignal}} input
     */
    async createCheckout({ repoPath, signal } = {}) {
      const cwd = typeof repoPath === 'string' ? repoPath.trim() : ''
      if (cwd.length === 0) {
        const error = new Error('path is required')
        error.code = 'bad-request'
        throw error
      }
      if (!config.enabled) {
        const error = new Error('the plugin is disabled')
        error.code = 'disabled'
        throw error
      }
      const repoRoot = await git.repoRoot(cwd, undefined, signal)
      if (repoRoot === null) {
        const error = new Error(`${cwd} is not inside a Git repository`)
        error.code = 'not-git-repository'
        throw error
      }
      if (await exists(join(repoRoot, config.disableMarker))) {
        const error = new Error(`worktree creation is disabled in ${repoRoot}`)
        error.code = 'disabled'
        throw error
      }
      if (!(await git.hasCommit(repoRoot, undefined, signal))) {
        const error = new Error(`${repoRoot} has no commits yet`)
        error.code = 'no-commit'
        throw error
      }
      const poolPath = resolvePoolRoot({ root: config.root, directory: config.directory, repoRoot })
      const reachable = rootIsReachable(poolPath, undefined)
      if (!reachable.ok) {
        const error = new Error(`configured root ${JSON.stringify(config.root)} is not writable (${reachable.reason})`)
        error.code = 'root-unreachable'
        throw error
      }
      const records = await store.list()
      if (recordsForRepo(records, repoRoot).length >= config.maxPerRepo) {
        const error = new Error(`this repository already has ${config.maxPerRepo} worktrees`)
        error.code = 'limit-reached'
        throw error
      }
      if (config.fetchBeforeCreate) {
        try {
          const fetched = await git.fetchUpstream(repoRoot, undefined, signal)
          if (!fetched.fetched) warnWith(`skipped upstream fetch: ${fetched.reason}`)
        } catch (error) {
          warnWith(`upstream fetch failed, continuing with local refs: ${errorText(error)}`)
        }
      }
      const baseRecord = await provision({ repoRoot, workspaceRoot: cwd, signal })
      const record = {
        ...baseRecord,
        sessionId: `pending-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        pending: true,
      }
      await store.set(record)
      schedulePrune(repoRoot)
      return record
    },

    /** Existing record for one session, if any. */
    async recordFor(sessionId) {
      return store.get(sessionId)
    },

    /**
     * Describe what this plugin did for a session, including live git state.
     * @param {string} sessionId session identity.
     * @param {object} [session] live session for sandbox-scoped git, when available.
     */
    async status(sessionId, session) {
      const record = await store.get(sessionId)
      if (record === null) return { managed: false }
      const dirty = await git.dirtyCount(record.path, session, undefined)
      return { managed: true, ...record, dirty }
    },

    /**
     * Remove one managed worktree; refuses a dirty checkout unless `force`.
     * @param {object} input `{sessionId, force, deleteBranch, session, signal}`.
     */
    async clean({ sessionId, force = false, deleteBranch = false, session, signal }) {
      const record = await store.get(sessionId)
      if (record === null) throw new Error('this session has no automatic worktree')
      if (!(await exists(record.path))) {
        await git.prune(record.repoRoot, session, signal)
        await store.remove(sessionId)
        return { removed: true, path: record.path, alreadyGone: true }
      }
      const dirty = await git.dirtyCount(record.path, session, signal)
      if ((dirty ?? 0) > 0 && !force) {
        const error = new Error(`worktree has ${dirty} uncommitted change(s); pass --force to remove it anyway`)
        error.code = 'worktree-dirty'
        throw error
      }
      await git.removeWorktree({ repoRoot: record.repoRoot, path: record.path, force, session, signal })
      await git.prune(record.repoRoot, session, signal)
      if (deleteBranch && record.branch !== null) {
        await git.deleteBranch(record.repoRoot, record.branch, force, session, signal)
      }
      await store.remove(sessionId)
      return { removed: true, path: record.path, branchDeleted: deleteBranch && record.branch !== null }
    },

    /** All records, optionally narrowed to one workspace path. */
    async list(workspacePath) {
      const records = await store.list()
      if (typeof workspacePath !== 'string' || workspacePath.length === 0) return records
      const clean = workspacePath.replace(/[\\/]+$/, '')
      return records.filter((record) => String(record.workspaceRoot ?? '').replace(/[\\/]+$/, '') === clean)
    },

    /** Manual prune of one repository (or all of them). */
    async prune({ repoRoot, session, signal } = {}) {
      if (typeof repoRoot === 'string' && repoRoot.length > 0) {
        return pruneRepo({ repoRoot, keep: config.autoPruneKeep, session, signal })
      }
      return pruneAll({ session, signal })
    },

    /** Test-only hook: forget which sessions were already attempted. */
    resetAttempts() {
      attempted.clear()
    },
  }
}

/** Whether the agent is a top-level runtime root (not a child/subagent). */
function isRootAgent(ctx, agent) {
  try {
    if (typeof ctx.agents?.roots === 'function') return ctx.agents.roots().includes(agent)
  } catch {
    /* fall through to the permissive answer */
  }
  return true
}

/** Best-effort agent preset id for the skip list. */
function presetOf(session) {
  try {
    return session?.header?.preset ?? session?.header?.agentPreset ?? undefined
  } catch {
    return undefined
  }
}
