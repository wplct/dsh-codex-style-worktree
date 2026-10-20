/**
 * Sidecar store: `$DSH_HOME/dsh-codex-worktree/state.json`.
 *
 * The plugin owns this file alone. It never writes into a repository or into
 * DSH's own session data. Writes are atomic (tmp + rename) and serialized
 * in-process; a corrupt file is moved aside instead of being overwritten.
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { STATE_DIR, STATE_FILE, STATE_VERSION } from './constants.js'

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
  return { schemaVersion: STATE_VERSION, records: {} }
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
  return { state: { schemaVersion: STATE_VERSION, records: kept }, repaired: false }
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
  }
}
