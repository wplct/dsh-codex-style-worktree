/**
 * The codex-worktree runtime: decide, create, remember, clean, prune.
 *
 * This module is deliberately free of DSH-specific imports so the pure parts
 * stay testable; every DSH capability arrives through the `ctx` passed in.
 *
 * Creation is triggered only by `agent/created` (i.e. after the user sends the
 * first prompt), according to the work location remembered for the workspace.
 * There is no on-demand creation path and no adoption of a pre-created checkout.
 *
 * Removal is guarded and restorable: a checkout that a live session is
 * currently working in is refused (`worktree-in-use`) unless `force` is passed,
 * and detached commits not on any branch are saved as
 * `refs/dsh-codex-style-worktree/...` snapshot refs before the directory goes away.
 */
import { mkdir, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  LEGACY_DISABLE_MARKER,
  MODE_BRANCH,
  MODE_DETACHED,
  PLACEMENT_LOCAL,
  PLACEMENT_WORKTREE,
  PROJECTION_KEY,
} from './constants.js'
import { resolvePlacement } from './config.js'
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
import {
  creatingState,
  errorState,
  readyState,
  withStep,
  STEP_CHECKOUT,
  STEP_FINALIZE,
  STEP_PREPARE,
} from './projection.js'
import { cleanPath, createKeyedMutex, errorText, getService, isInsideDir, samePath, warn } from './util.js'

const NAME_ATTEMPTS = 5
/** Snapshot refs live outside `refs/heads`, so they never appear as branches. */
const SNAPSHOT_PREFIX = 'refs/dsh-codex-style-worktree/'

/**
 * Skip reasons that are genuine failures worth showing on the progress card.
 * `not-git` and the configured skips stay silent: they are expected states, not
 * errors the user should be told about on every session.
 */
const REPORTED_FAILURES = new Set(['no-commit', 'limit', 'root-outside-sandbox', 'read-only-sandbox', 'error'])

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
 * @param {object} options.config resolved live config snapshot.
 * @param {object} options.store sidecar store.
 * @param {object} options.git git helpers.
 * @param {object} options.projection projection publisher (may be inert).
 * @param {(message: string) => void} [options.log] warn sink.
 * @returns {object} runtime API used by the plugin entry, tools, commands and routes.
 */
export function createRuntime({ ctx, config, store, git, projection, log }) {
  const attempted = new Set()
  const withRepoLock = createKeyedMutex()
  const warnWith = log ?? ((message) => warn(ctx, message))
  const publish = projection ?? {
    publish() {
      return false
    },
    publishById() {
      return false
    },
    clear() {
      return false
    },
    clearById() {
      return false
    },
    stateOf() {
      return undefined
    },
  }

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

  /** Current working directory of one live session, when DSH can report it. */
  function workingDirectoryOf(session) {
    if (session === undefined || session === null) return undefined
    try {
      const value = ctx.workingDirectory?.get(session)
      return typeof value === 'string' && value.length > 0 ? value : undefined
    } catch {
      return undefined
    }
  }

  /**
   * Session ids whose live working directory sits inside `path` (or equals it).
   * @param {string} path checkout path.
   * @param {{ignore?: Set<string>}} [options] ids to leave out (archived sessions
   *   are inactive by definition, so they hold no checkout).
   */
  function sessionsUsing(path, { ignore } = {}) {
    const using = new Set()
    const registry = getService(ctx, 'agents')
    let agents = []
    try {
      agents = registry !== undefined && typeof registry.list === 'function' ? registry.list() : []
    } catch {
      agents = []
    }
    for (const agent of agents) {
      const session = agent?.session
      const cwd = workingDirectoryOf(session)
      if (cwd === undefined) continue
      const id = typeof session?.id === 'string' ? session.id : '<unknown>'
      if (ignore !== undefined && ignore.has(id)) continue
      if (samePath(cwd, path) || isInsideDir(path, cwd)) using.add(id)
    }
    return using
  }

  /**
   * Refuse to remove a checkout that an active session is currently working in.
   * Codex does the same ("switch to another checkout before deleting this
   * one"); `force` is the explicit override.
   * @param {object} record sidecar record.
   * @param {object} [options] `{force, session}`.
   */
  function assertNotInUse(record, { force = false, session } = {}) {
    if (force) return
    const using = sessionsUsing(record.path)
    // The calling session may remove its own checkout: `clean` switches its
    // working directory back to the workspace root instead of refusing.
    if (typeof session?.id === 'string') using.delete(session.id)
    if (using.size === 0) return
    const error = new Error(
      `worktree ${record.path} is the working directory of ${using.size} active session(s); switch to another directory or pass --force`,
    )
    error.code = 'worktree-in-use'
    error.details = { path: record.path, sessionIds: [...using] }
    throw error
  }

  /** The live agent owning one session id, when it is still registered. */
  function agentForSession(sessionId) {
    if (typeof sessionId !== 'string' || sessionId.length === 0) return undefined
    const registry = getService(ctx, 'agents')
    try {
      const agents = registry !== undefined && typeof registry.list === 'function' ? registry.list() : []
      return agents.find((agent) => agent?.session?.id === sessionId)
    } catch {
      return undefined
    }
  }

  /**
   * Move a live session out of a checkout that is about to disappear, so its
   * file tools keep working; a Session keeps its workspace, not its checkout.
   */
  async function detachFrom(path, { record, session, signal } = {}) {
    const own = workingDirectoryOf(session)
    if (own === undefined || !(samePath(own, path) || isInsideDir(path, own))) return false
    const target = typeof record.workspaceRoot === 'string' && record.workspaceRoot.length > 0 ? record.workspaceRoot : undefined
    if (target === undefined || !(await exists(target))) return false
    const agent = agentForSession(session?.id)
    if (agent === undefined) return false
    try {
      await ctx.workingDirectory.set(agent, target, signal)
      return true
    } catch (error) {
      warnWith(`could not move session ${session?.id ?? '?'} back to ${target}: ${errorText(error)}`)
      return false
    }
  }

  /**
   * Save a snapshot ref for a detached checkout whose HEAD moved past its base
   * commit, so those commits survive the directory being removed.
   * @param {object} record sidecar record.
   * @param {object} [options] `{session, signal}`.
   * @returns {{snapshot: object|null, needed: boolean, failed?: boolean}} outcome.
   */
  async function snapshotBeforeRemove(record, { session, signal } = {}) {
    if (record.mode === MODE_BRANCH || record.branch !== null) return { snapshot: null, needed: false }
    if (!(await exists(record.path))) return { snapshot: null, needed: false }
    try {
      const head = await git.headCommit(record.path, session, signal)
      if (head === record.baseCommit) return { snapshot: null, needed: false }
      const ref = `${SNAPSHOT_PREFIX}${generateName('', new Date())}${record.sessionId.slice(-6)}`
      await git.updateRef(record.repoRoot, ref, head, session, signal)
      const snapshot = {
        ref,
        repoRoot: record.repoRoot,
        commit: head,
        sessionId: record.sessionId,
        createdAt: new Date().toISOString(),
      }
      await store.setSnapshot(snapshot)
      return { snapshot, needed: true }
    } catch (error) {
      warnWith(`could not snapshot ${record.path} before removal: ${errorText(error)}`)
      return { snapshot: null, needed: true, failed: true }
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
   * Resolve the calling policy without tripping Cordis' injected-service guard.
   * Both `sandbox` and `sandboxPolicy` are optional services; a context that did
   * not declare them throws on property access instead of returning undefined.
   */
  function sandboxPolicyFor(session) {
    const service = getService(ctx, 'sandboxPolicy')
    if (service === undefined || typeof service.resolve !== 'function') return undefined
    try {
      return service.resolve(session === undefined ? {} : { session })
    } catch {
      return undefined
    }
  }

  /**
   * Whether this checkout may be written by the caller.
   * DSH's `workspace-write` boundary is the session's original `header.cwd`, so a
   * pool outside it would be read-only for every file tool. Refuse instead of
   * handing the model an unusable checkout.
   */
  function rootIsReachable(poolPath, session) {
    const policy = sandboxPolicyFor(session)
    if (policy?.mode === 'read-only') return { ok: false, reason: 'read-only-sandbox' }
    const sessionRoot = session?.header?.cwd
    if (policy?.mode === 'workspace-write' && typeof sessionRoot === 'string' && sessionRoot.length > 0) {
      if (!isInsideDir(sessionRoot, poolPath)) return { ok: false, reason: 'root-outside-sandbox' }
    }
    return { ok: true }
  }

  /**
   * Remove the oldest clean checkouts of one repository beyond `keep`.
   * Detached commits that are not on any branch are preserved as
   * `refs/dsh-codex-style-worktree/...` snapshot refs before the directory goes away.
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
        publish.clearById(record.sessionId)
        removed.push({ path: record.path, sessionId: record.sessionId, alreadyGone: true })
        continue
      }
      const dirty = await git.dirtyCount(record.path, session, signal)
      if (dirty === null || dirty > 0) continue
      const snapshotResult = await snapshotBeforeRemove(record, { session, signal })
      if (snapshotResult.failed === true) continue
      if (snapshotResult.snapshot !== null) snapshots.push(snapshotResult.snapshot)
      try {
        await git.removeWorktree({ repoRoot: record.repoRoot, path: record.path, force: false, session, signal })
        await git.prune(record.repoRoot, session, signal)
        await store.remove(record.sessionId)
        publish.clearById(record.sessionId)
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

  /**
   * Remove checkouts whose sessions were archived, when `cleanupOnArchive` is
   * on. Only clean, unused checkouts are removed. Called from natural trigger
   * points (new Session, list, prune, archive-with-stop); never from a timer,
   * so a profile that stays idle keeps its files.
   * @param {object} [options] `{signal}`.
   */
  async function sweepArchived({ signal } = {}) {
    if (config.cleanupOnArchive !== true) return { removed: [] }
    const registry = getService(ctx, 'workspaceRegistry')
    let archived = []
    try {
      const ids = registry?.archivedSessionIds
      if (Array.isArray(ids)) archived = ids
    } catch {
      return { removed: [] }
    }
    if (archived.length === 0) return { removed: [] }
    const records = await store.list()
    const removed = []
    for (const record of records) {
      if (!archived.includes(record.sessionId)) continue
      try {
        if (!(await exists(record.path))) {
          await git.prune(record.repoRoot, undefined, signal)
          await store.remove(record.sessionId)
          publish.clearById(record.sessionId)
          removed.push({ path: record.path, sessionId: record.sessionId, alreadyGone: true })
          continue
        }
        if (sessionsUsing(record.path, { ignore: new Set(archived) }).size > 0) continue
        const dirty = await git.dirtyCount(record.path, undefined, signal)
        if (dirty === null || dirty > 0) continue
        const snapshotResult = await snapshotBeforeRemove(record, { signal })
        if (snapshotResult.failed === true) continue
        await git.removeWorktree({ repoRoot: record.repoRoot, path: record.path, force: false, signal })
        await git.prune(record.repoRoot, undefined, signal)
        await store.remove(record.sessionId)
        publish.clearById(record.sessionId)
        removed.push({
          path: record.path,
          sessionId: record.sessionId,
          snapshotRef: snapshotResult.snapshot?.ref ?? null,
        })
      } catch (error) {
        warnWith(`could not clean archived worktree ${record.path}: ${errorText(error)}`)
      }
    }
    return { removed }
  }

  /**
   * Build one checkout inside the repo's pool; the caller owns the sidecar record.
   * Reports each creating step so the client's inline progress card can follow.
   */
  async function provision({ repoRoot, workspaceRoot, session, signal, agent, placement, onStep }) {
    const poolPath = resolvePoolRoot({ root: config.root, directory: config.directory, repoRoot })
    return withRepoLock(`repo:${repoRoot}`, async () => {
      onStep?.(STEP_PREPARE)
      await ensurePool(poolPath)
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
      const baseCommit = await git.baseCommit(repoRoot, config.baseRef, session, signal)
      const branch = config.mode === MODE_BRANCH ? `${config.branchPrefix}${baseName}` : null
      onStep?.(STEP_CHECKOUT, { path: destination, baseCommit })
      await git.addWorktree({
        repoRoot,
        path: destination,
        mode: config.mode,
        branch,
        baseRef: config.baseRef,
        session,
        signal,
      })
      onStep?.(STEP_FINALIZE, { path: destination, baseCommit })
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
        placement,
      }
    })
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

  /**
   * Read one workspace's remembered work location, defaulting when unset and
   * reporting whether the directory is a Git repository at all.
   * @param {string} workspacePath canonical workspace directory.
   * @param {AbortSignal} [signal]
   */
  async function placementFor(workspacePath, signal) {
    const key = cleanPath(await canonicalize(String(workspacePath ?? ''), undefined, signal))
    if (key.length === 0) {
      const error = new Error('workspacePath is required')
      error.code = 'bad-request'
      throw error
    }
    const stored = await store.getPlacement(key)
    const repoRoot = await git.repoRoot(key, undefined, signal)
    return {
      workspacePath: key,
      mode: stored?.mode ?? config.defaultPlacement,
      defaultMode: config.defaultPlacement,
      isGit: repoRoot !== null,
    }
  }

  /**
   * Remember one workspace's work location.
   * @param {string} workspacePath canonical workspace directory.
   * @param {string} mode `worktree` or `local`.
   * @param {AbortSignal} [signal]
   */
  async function setPlacementFor(workspacePath, mode, signal) {
    const key = cleanPath(await canonicalize(String(workspacePath ?? ''), undefined, signal))
    if (key.length === 0) {
      const error = new Error('workspacePath is required')
      error.code = 'bad-request'
      throw error
    }
    const placement = resolvePlacement(mode)
    const repoRoot = await git.repoRoot(key, undefined, signal)
    if (placement === PLACEMENT_WORKTREE && repoRoot === null) {
      const error = new Error(`${key} is not inside a Git repository`)
      error.code = 'not-git-repository'
      throw error
    }
    await store.setPlacement(key, placement)
    return { workspacePath: key, mode: placement, defaultMode: config.defaultPlacement, isGit: repoRoot !== null }
  }

  return {
    config,
    store,
    git,
    projection: publish,

    placementFor,
    setPlacementFor,

    /**
     * Create and enter a worktree for one freshly created agent, when the
     * workspace's remembered placement says so. Never throws: a failure leaves
     * the session in its original directory and is published as an error state.
     * @param {object} payload `agent/created` payload: `{agent, source, signal}`.
     * @returns {Promise<{created: boolean, reason?: string, record?: object}>}
     */
    async ensureForAgent({ agent, source, signal }) {
      const session = agent?.session
      const sessionId = session?.id
      if (typeof sessionId !== 'string' || sessionId.length === 0) return { created: false, reason: 'no-session' }
      if (attempted.has(sessionId)) return { created: false, reason: 'attempted' }
      attempted.add(sessionId)
      const cwd = ctx.workingDirectory.get(session)
      const workspaceRoot = typeof session.header?.cwd === 'string' && session.header.cwd.length > 0 ? session.header.cwd : cwd
      const placement = (await store.getPlacement(cleanPath(workspaceRoot)))?.mode ?? config.defaultPlacement
      const context = {
        repoRoot: '',
        workspaceRoot,
        placement,
        mode: config.mode,
        step: STEP_PREPARE,
        path: null,
      }
      const fail = (reason, message) => {
        if (context.repoRoot !== '' && REPORTED_FAILURES.has(reason)) {
          publish.publish(
            session,
            errorState({
              step: context.step,
              path: context.path,
              repoRoot: context.repoRoot,
              workspaceRoot: context.workspaceRoot,
              placement: context.placement,
              mode: context.mode,
              error: message ?? reason,
            }),
          )
        }
        return { created: false, reason }
      }
      try {
        const record = await store.get(sessionId)
        const markerPresent =
          typeof cwd === 'string' &&
          cwd.length > 0 &&
          ((await exists(join(cwd, config.disableMarker))) || (await exists(join(cwd, LEGACY_DISABLE_MARKER))))

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
          headerCwd: session.header?.cwd,
          record,
          markerPresent,
        })
        if (early !== null) return { created: false, reason: early }

        // Creation-time consistency repair: a projection that still says
        // "ready" for a checkout that is gone (sidecar wiped, directory
        // deleted) must not keep a stale sidebar marker alive.
        const projected = publish.stateOf(session)
        if (projected?.phase === 'ready' && record === null && typeof projected.path === 'string') {
          if (!(await exists(projected.path))) publish.clear(session)
        }

        if (placement === PLACEMENT_LOCAL) return { created: false, reason: 'local-placement' }

        const repoRoot = await git.repoRoot(cwd, session, signal)
        context.repoRoot = repoRoot ?? ''
        if (repoRoot === null) return { created: false, reason: 'not-git' }

        const markerAtRepo =
          (await exists(join(repoRoot, config.disableMarker))) || (await exists(join(repoRoot, LEGACY_DISABLE_MARKER)))
        if (markerAtRepo) return { created: false, reason: 'marker' }

        const poolPath = resolvePoolRoot({ root: config.root, directory: config.directory, repoRoot })
        const reachable = rootIsReachable(poolPath, session)
        if (!reachable.ok) {
          warnWith(`configured root ${JSON.stringify(config.root)} is not writable by this session (${reachable.reason})`)
          return fail(reachable.reason, reachable.reason)
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
        if (late !== null) return fail(late, late)

        if (config.fetchBeforeCreate) {
          try {
            const fetched = await git.fetchUpstream(repoRoot, session, signal)
            if (!fetched.fetched) warnWith(`skipped upstream fetch: ${fetched.reason}`)
          } catch (error) {
            warnWith(`upstream fetch failed, continuing with local refs: ${errorText(error)}`)
          }
        }

        const baseRecord = await provision({
          repoRoot,
          workspaceRoot,
          session,
          signal,
          agent,
          placement,
          onStep(step, extra = {}) {
            context.step = step
            context.path = extra.path ?? context.path
            const current =
              step === STEP_PREPARE
                ? creatingState({ repoRoot, workspaceRoot, placement, mode: config.mode })
                : withStep(creatingState({ repoRoot, workspaceRoot, placement, mode: config.mode }), step, {
                    path: extra.path ?? null,
                    baseCommit: extra.baseCommit ?? null,
                  })
            publish.publish(session, current)
          },
        })
        const created = { ...baseRecord, sessionId, source: source ?? null }
        await store.set(created)
        publish.publish(session, readyState(created))
        await notify(agent, created)
        schedulePrune(repoRoot)
        void sweepArchived({}).catch(() => undefined)
        return { created: true, record: created }
      } catch (error) {
        warnWith(`automatic worktree for session ${sessionId} failed: ${errorText(error)}`)
        return fail('error', errorText(error))
      }
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
     * Clears the session projection so the sidebar marker disappears at once.
     * @param {object} input `{sessionId, force, deleteBranch, session, signal}`.
     */
    async clean({ sessionId, force = false, deleteBranch = false, session, signal }) {
      const record = await store.get(sessionId)
      if (record === null) throw new Error('this session has no automatic worktree')
      assertNotInUse(record, { force, session })
      const snapshots = []
      if (!(await exists(record.path))) {
        const moved = await detachFrom(record.path, { record, session, signal })
        await git.prune(record.repoRoot, session, signal)
        await store.remove(sessionId)
        if (session === undefined) publish.clearById(sessionId)
        else publish.clear(session)
        return {
          removed: true,
          path: record.path,
          alreadyGone: true,
          snapshots,
          ...(moved ? { movedTo: record.workspaceRoot } : {}),
        }
      }
      const detached = await detachFrom(record.path, { record, session, signal })
      const dirty = await git.dirtyCount(record.path, session, signal)
      if ((dirty ?? 0) > 0 && !force) {
        const error = new Error(`worktree has ${dirty} uncommitted change(s); pass --force to remove it anyway`)
        error.code = 'worktree-dirty'
        throw error
      }
      // Explicit user action: a snapshot failure warns but never blocks the clean.
      const snapshotResult = await snapshotBeforeRemove(record, { session, signal })
      if (snapshotResult.snapshot !== null) snapshots.push(snapshotResult.snapshot)
      await git.removeWorktree({ repoRoot: record.repoRoot, path: record.path, force, session, signal })
      await git.prune(record.repoRoot, session, signal)
      if (deleteBranch && record.branch !== null) {
        await git.deleteBranch(record.repoRoot, record.branch, force, session, signal)
      }
      await store.remove(sessionId)
      if (session === undefined) publish.clearById(sessionId)
      else publish.clear(session)
      return {
        removed: true,
        path: record.path,
        branchDeleted: deleteBranch && record.branch !== null,
        snapshots,
        ...(detached ? { movedTo: record.workspaceRoot } : {}),
      }
    },

    /** All records, optionally narrowed to one workspace path. */
    async list(workspacePath) {
      await sweepArchived({})
      const records = await store.list()
      if (typeof workspacePath !== 'string' || workspacePath.length === 0) return records
      const clean = workspacePath.replace(/[\\/]+$/, '')
      return records.filter((record) => String(record.workspaceRoot ?? '').replace(/[\\/]+$/, '') === clean)
    },

    /** Manual prune of one repository (or all of them). */
    async prune({ repoRoot, session, signal } = {}) {
      await sweepArchived({ signal })
      if (typeof repoRoot === 'string' && repoRoot.length > 0) {
        return pruneRepo({ repoRoot, keep: config.autoPruneKeep, session, signal })
      }
      return pruneAll({ session, signal })
    },

    /** Saved snapshot refs, newest first; optionally one repository. */
    async snapshotList({ repoRoot } = {}) {
      return store.snapshots(repoRoot)
    },

    /**
     * Recreate a detached checkout from one saved snapshot ref. The new checkout
     * is not bound to a Session: the caller decides where to continue.
     * @param {object} input `{ref, session, signal}`.
     */
    async restoreSnapshot({ ref, session, signal } = {}) {
      const wanted = typeof ref === 'string' ? ref.trim() : ''
      if (wanted.length === 0) {
        const error = new Error('ref is required')
        error.code = 'bad-request'
        throw error
      }
      const snapshot = await store.getSnapshot(wanted)
      if (snapshot === null) {
        const error = new Error(`no saved snapshot for ${wanted}`)
        error.code = 'snapshot-not-found'
        throw error
      }
      const repoRoot = snapshot.repoRoot
      const poolPath = resolvePoolRoot({ root: config.root, directory: config.directory, repoRoot })
      return withRepoLock(`repo:${repoRoot}`, async () => {
        await ensurePool(poolPath)
        const baseName = generateName(`${config.namePrefix}restored-`)
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
        await git.addWorktree({
          repoRoot,
          path: destination,
          mode: MODE_DETACHED,
          branch: null,
          baseRef: snapshot.commit,
          session,
          signal,
        })
        const canonical = await canonicalize(destination, session, signal)
        await store.markSnapshotRestored(snapshot.ref, canonical)
        return { ref: snapshot.ref, path: canonical, commit: snapshot.commit, repoRoot }
      })
    },

    sweepArchived,

    /** Current remembered placement for a session's workspace (diagnostics/tests). */
    async placementOfSession(session) {
      const workspaceRoot = session?.header?.cwd
      if (typeof workspaceRoot !== 'string') return null
      return store.getPlacement(cleanPath(workspaceRoot))
    },

    /** Projection key this runtime publishes into. */
    projectionKey: PROJECTION_KEY,

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

// Re-exported for the router/commands that resolve a placement without the runtime.
export { PLACEMENT_LOCAL, PLACEMENT_WORKTREE }
