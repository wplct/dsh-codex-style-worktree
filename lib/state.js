/**
 * Sidecar store: `$DSH_HOME/dsh-codex-worktree/state.json`.
 *
 * The plugin owns this file alone. It never writes into a repository or into
 * DSH's own session data. Writes are atomic (tmp + rename) and serialized
 * in-process; a corrupt file is moved aside instead of being overwritten.
 *
 * Schema v2 adds `placements` (one remembered work location per canonical
 * workspace path); schema v3 adds `snapshots` (refs saved before a checkout is
 * removed, restorable into a fresh checkout). Older documents are migrated in
 * memory and rewritten on the next write; nothing is lost.
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { PLACEMENT_LOCAL, PLACEMENT_WORKTREE, PLACEMENT_TTL_MS, STATE_DIR, STATE_FILE, STATE_VERSION } from './constants.js'

/** Resolve the DSH home directory the same way the rest of the ecosystem does. */
export function resolveDshHome(env = process.env, home = homedir()) {
  const configured = typeof env?.DSH_HOME === 'string' && env.DSH_HOME.trim().length > 0 ? env.DSH_HOME.trim() : undefined
  return configured ?? join(home, '.dsh')
}

/** Absolute path of the sidecar file for a DSH home. */
export function statePathFor(dshHome) {
  return join(dshHome, STATE_DIR, STATE_FILE)
}

/** An empty, well-formed state document. */
export function emptyState() {
  return { schemaVersion: STATE_VERSION, records: {}, placements: {}, snapshots: {} }
}

/** Normalize a placement path key (drop trailing separators except the root). */
export function placementKey(workspacePath) {
  const text = String(workspacePath ?? '')
  return text.length > 1 ? text.replace(/[\\/]+$/, '') : text
}

/** Whether a candidate is a usable placement row. */
function isPlacement(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    (value.mode === PLACEMENT_WORKTREE || value.mode === PLACEMENT_LOCAL)
  )
}

/**
 * Coerce arbitrary parsed JSON into a usable state document. Unknown shapes are
 * dropped rather than trusted; a malformed record never blocks the next session.
 * @param {unknown} value parsed JSON.
 * @returns {{state: object, repaired: boolean}}
 */
export function coerceState(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return { state: emptyState(), repaired: true }
  const records = /** @type {Record<string, unknown>} */ (value).records
  if (records === null || typeof records !== 'object' || Array.isArray(records)) {
    return { state: emptyState(), repaired: true }
  }
  const kept = {}
  for (const [sessionId, record] of Object.entries(records)) {
    if (record === null || typeof record !== 'object' || Array.isArray(record)) continue
    if (typeof /** @type {any} */ (record).path !== 'string') continue
    kept[sessionId] = record
  }
  // v1 has no placements; an unknown/absent map migrates to an empty one.
  const rawPlacements = /** @type {Record<string, unknown>} */ (value).placements
  const placements = {}
  if (rawPlacements !== null && typeof rawPlacements === 'object' && !Array.isArray(rawPlacements)) {
    for (const [path, row] of Object.entries(rawPlacements)) {
      if (!isPlacement(row)) continue
      const key = placementKey(path)
      if (key.length === 0) continue
      placements[key] = {
        mode: /** @type {any} */ (row).mode,
        updatedAt: typeof /** @type {any} */ (row).updatedAt === 'string' ? /** @type {any} */ (row).updatedAt : new Date(0).toISOString(),
      }
    }
  }
  // v1/v2 have no snapshots; an unknown/absent map migrates to an empty one.
  const rawSnapshots = /** @type {Record<string, unknown>} */ (value).snapshots
  const snapshots = {}
  if (rawSnapshots !== null && typeof rawSnapshots === 'object' && !Array.isArray(rawSnapshots)) {
    for (const [ref, row] of Object.entries(rawSnapshots)) {
      if (!isSnapshot(ref, row)) continue
      const source = /** @type {Record<string, unknown>} */ (row)
      snapshots[ref] = {
        ref,
        repoRoot: source.repoRoot,
        commit: source.commit,
        sessionId: typeof source.sessionId === 'string' ? source.sessionId : null,
        createdAt: typeof source.createdAt === 'string' ? source.createdAt : new Date(0).toISOString(),
        ...(typeof source.restoredAt === 'string' ? { restoredAt: source.restoredAt } : {}),
        ...(typeof source.restoredPath === 'string' ? { restoredPath: source.restoredPath } : {}),
      }
    }
  }
  return { state: { schemaVersion: STATE_VERSION, records: kept, placements, snapshots }, repaired: false }
}

/** Whether a candidate is a usable snapshot row keyed by its ref. */
function isSnapshot(ref, value) {
  if (typeof ref !== 'string' || ref.length === 0) return false
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const row = /** @type {Record<string, unknown>} */ (value)
  return typeof row.repoRoot === 'string' && row.repoRoot.length > 0 && typeof row.commit === 'string' && row.commit.length > 0
}

/** Drop placement rows that have not been written for longer than the TTL. */
function prunePlacements(placements, now = Date.now()) {
  const result = {}
  for (const [path, row] of Object.entries(placements)) {
    const updated = Date.parse(row.updatedAt)
    if (Number.isFinite(updated) && now - updated > PLACEMENT_TTL_MS) continue
    result[path] = row
  }
  return result
}

/**
 * Create the store bound to one sidecar file.
 * @param {string} file absolute path of `state.json`.
 * @returns {object} store API.
 */
export function createStateStore(file, options = {}) {
  const onError = typeof options.onError === 'function' ? options.onError : () => undefined
  let chain = Promise.resolve()
  let cached = null

  async function load() {
    if (cached !== null) return cached
    let text
    try {
      text = await readFile(file, 'utf8')
    } catch {
      cached = emptyState()
      return cached
    }
    let parsed
    try {
      parsed = JSON.parse(text)
    } catch {
      // Keep the unreadable file for the user instead of overwriting it.
      await rename(file, `${file}.corrupt-${Date.now()}`).catch(() => undefined)
      cached = emptyState()
      return cached
    }
    const { state, repaired } = coerceState(parsed)
    if (repaired) await rename(file, `${file}.corrupt-${Date.now()}`).catch(() => undefined)
    cached = state
    return cached
  }

  async function persist(state) {
    try {
      await mkdir(dirname(file), { recursive: true })
      const tmp = `${file}.tmp-${process.pid}-${Date.now()}`
      await writeFile(tmp, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
      await rename(tmp, file)
    } catch (error) {
      // A read-only or full home must not break the worktree itself: keep the
      // in-memory record and let the owner decide how loudly to report this.
      onError(error)
    }
  }

  /** Serialize a read-modify-write cycle; the callback may return a replacement state. */
  function update(mutator) {
    const run = async () => {
      const state = await load()
      const next = (await mutator(state)) ?? state
      cached = next
      await persist(next)
      return next
    }
    const result = chain.then(run, run)
    chain = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }

  return {
    file,
    async read() {
      return load()
    },
    async get(sessionId) {
      return (await load()).records[sessionId] ?? null
    },
    async list() {
      return Object.values((await load()).records)
    },
    async set(record) {
      await update((state) => ({ ...state, records: { ...state.records, [record.sessionId]: record } }))
      return record
    },
    async remove(sessionId) {
      let removed = null
      await update((state) => {
        removed = state.records[sessionId] ?? null
        if (removed === null) return state
        const records = { ...state.records }
        delete records[sessionId]
        return { ...state, records }
      })
      return removed
    },
    /** Remembered work location for one canonical workspace path, or null. */
    async getPlacement(workspacePath) {
      const key = placementKey(workspacePath)
      if (key.length === 0) return null
      const state = await load()
      const row = state.placements[key]
      if (!isPlacement(row)) return null
      return { workspacePath: key, mode: row.mode, updatedAt: row.updatedAt }
    },
    /** Store one workspace's remembered work location. */
    async setPlacement(workspacePath, mode) {
      const key = placementKey(workspacePath)
      if (key.length === 0) throw new Error('dsh-codex-worktree: workspacePath is required')
      if (mode !== PLACEMENT_WORKTREE && mode !== PLACEMENT_LOCAL) {
        throw new Error(`dsh-codex-worktree: placement must be "${PLACEMENT_WORKTREE}" or "${PLACEMENT_LOCAL}"`)
      }
      const row = { mode, updatedAt: new Date().toISOString() }
      await update((state) => ({
        ...state,
        placements: prunePlacements({ ...state.placements, [key]: row }),
      }))
      return { workspacePath: key, mode, updatedAt: row.updatedAt }
    },
    /** Every saved snapshot ref, newest first; optionally narrowed to one repository. */
    async snapshots(repoRoot) {
      const state = await load()
      const rows = Object.values(state.snapshots)
      const kept =
        typeof repoRoot === 'string' && repoRoot.length > 0
          ? rows.filter((row) => placementKey(row.repoRoot) === placementKey(repoRoot))
          : rows
      return kept.sort((left, right) => String(right.createdAt ?? '').localeCompare(String(left.createdAt ?? '')))
    },
    /** One saved snapshot row by ref, or null. */
    async getSnapshot(ref) {
      const state = await load()
      return state.snapshots[ref] ?? null
    },
    /** Remember one saved snapshot ref (idempotent per ref). */
    async setSnapshot(snapshot) {
      await update((state) => ({ ...state, snapshots: { ...state.snapshots, [snapshot.ref]: snapshot } }))
      return snapshot
    },
    /** Mark one snapshot ref as restored into a fresh checkout. */
    async markSnapshotRestored(ref, path) {
      let updated = null
      await update((state) => {
        const row = state.snapshots[ref]
        if (row === undefined) return state
        updated = { ...row, restoredAt: new Date().toISOString(), restoredPath: path }
        return { ...state, snapshots: { ...state.snapshots, [ref]: updated } }
      })
      return updated
    },
    /** Every remembered placement, oldest dropped. */
    async placements() {
      const state = await load()
      return Object.entries(prunePlacements(state.placements)).map(([workspacePath, row]) => ({
        workspacePath,
        mode: row.mode,
        updatedAt: row.updatedAt,
      }))
    },
  }
}
