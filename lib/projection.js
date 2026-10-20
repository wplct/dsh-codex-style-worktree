/**
 * The `codexWorktree` session projection.
 *
 * DSH's Session Projection registry is the native, event-driven way to keep a
 * client in sync with host-side per-session state: the host defines one unit
 * whose `apply` folds committed session events, and every client carrier reads
 * the resulting whole value from the session-list snapshot and subscribes to
 * changes. No RPC, no polling.
 *
 * This unit carries the lifecycle of the automatically created checkout:
 *
 *   null
 *   → {phase:'creating', step:'prepare'|'checkout'|'finalize', …}
 *   → {phase:'ready', path, repoRoot, …}
 *   → {phase:'error', error, …}
 *   → null  (cleanup, or the repair that sees a stale "ready")
 *
 * Each append carries the COMPLETE post-change state, as the projection
 * contract requires; `apply` never derives from a delta.
 */
import {
  PLACEMENT_WORKTREE,
  PROJECTION_EVENT,
  PROJECTION_KEY,
  PROJECTION_VERSION,
} from './constants.js'
import { getService, warn } from './util.js'

/** Lifecycle phases exposed to clients. */
export const PHASE_CREATING = 'creating'
export const PHASE_READY = 'ready'
export const PHASE_ERROR = 'error'

/** Creating steps, in the order the progress card renders them. */
export const STEP_PREPARE = 'prepare'
export const STEP_CHECKOUT = 'checkout'
export const STEP_FINALIZE = 'finalize'

const PHASES = new Set([PHASE_CREATING, PHASE_READY, PHASE_ERROR])
const STEPS = new Set([STEP_PREPARE, STEP_CHECKOUT, STEP_FINALIZE])
const PLACEMENTS = new Set([PLACEMENT_WORKTREE, 'local'])

/** Fail one value with one path-qualified message. */
function invalid(path, expected) {
  throw new TypeError(`codexWorktree projection: ${path} must be ${expected}`)
}

/**
 * Validate one complete projection value and return it unchanged.
 *
 * The projection registry only ever calls `stateSchema.parse` / `viewSchema.parse`
 * (never `toJSON` or a codec), so this plugin keeps its "no runtime dependency
 * beyond Node builtins and DSH itself" rule by validating the small fixed shape
 * here instead of importing a schema library that the copied-in install may not
 * resolve.
 * @param {unknown} value candidate value.
 * @returns {object|null} the same value.
 */
export function parseProjectionState(value) {
  if (value === null) return null
  if (typeof value !== 'object' || Array.isArray(value)) invalid('value', 'null or an object')
  const state = /** @type {Record<string, unknown>} */ (value)
  if (!PHASES.has(state.phase)) invalid('phase', '"creating", "ready" or "error"')
  if (state.step !== undefined && !STEPS.has(state.step)) invalid('step', '"prepare", "checkout" or "finalize"')
  if (state.path !== null && typeof state.path !== 'string') invalid('path', 'a string or null')
  if (typeof state.repoRoot !== 'string') invalid('repoRoot', 'a string')
  if (typeof state.workspaceRoot !== 'string') invalid('workspaceRoot', 'a string')
  if (state.placement !== undefined && !PLACEMENTS.has(state.placement)) invalid('placement', '"worktree" or "local"')
  if (typeof state.mode !== 'string') invalid('mode', 'a string')
  if (state.branch !== null && typeof state.branch !== 'string') invalid('branch', 'a string or null')
  if (state.baseCommit !== null && typeof state.baseCommit !== 'string') invalid('baseCommit', 'a string or null')
  if (state.error !== undefined && typeof state.error !== 'string') invalid('error', 'a string')
  if (typeof state.updatedAt !== 'string') invalid('updatedAt', 'a string')
  return state
}

/** Schema-shaped validator understood by the projection registry. */
const projectionStateSchema = {
  parse: parseProjectionState,
  safeParse(value) {
    try {
      return { success: true, data: parseProjectionState(value) }
    } catch (error) {
      return { success: false, error }
    }
  },
}

/** Wire value: clients receive the whole state (already JSON-shaped). */
export const projectionViewSchema = projectionStateSchema

/** Fold events into the projection. */
export function applyProjection(state, event) {
  if (event === undefined || event === null || event.type !== PROJECTION_EVENT) return state
  const data = event.data
  if (data === null || typeof data !== 'object' || !Object.hasOwn(data, 'state')) return state
  return /** @type {any} */ (data).state
}

/** The unit the host registers once, at mount time. */
export const projectionDefinition = {
  key: PROJECTION_KEY,
  stateVersion: PROJECTION_VERSION,
  stateSchema: projectionStateSchema,
  init: () => null,
  apply: applyProjection,
  wire: {
    viewSchema: projectionViewSchema,
    // Identity keeps the reference stable for events that do not touch this
    // unit, which is what suppresses needless publication downstream.
    view: (state) => state,
  },
}

/**
 * Publish complete states into sessions through the projection event.
 *
 * Registration itself lives in `lib/index.js` (it is a Cordis effect on the
 * plugin fiber); this object is the runtime's write handle and stays inert when
 * the composition has no projection registry, so a headless host neither fails
 * nor pollutes the session log.
 *
 * @param {object} options
 * @param {object} options.ctx plugin context.
 * @param {(message: string) => void} [options.log] warning sink.
 */
export function createProjectionPublisher({ ctx, log }) {
  const warnWith = log ?? ((message) => warn(ctx, message))
  let registry = null

  function liveSession(sessionId) {
    try {
      const agents = getService(ctx, 'agents')
      return agents?.get?.(sessionId)?.session ?? null
    } catch {
      return null
    }
  }

  const publisher = {
    /** Whether the projection unit is registered and clients can see values. */
    get enabled() {
      return registry !== null
    },
    /** Called by the registration effect. */
    attach(nextRegistry) {
      registry = nextRegistry ?? null
    },
    /** Called by the registration effect's disposer. */
    detach() {
      registry = null
    },
    /**
     * Append one complete state for a live Session.
     * @param {object} session live session handle.
     * @param {object|null} state complete post-change projection state.
     * @returns {boolean} whether the event was appended.
     */
    publish(session, state) {
      if (registry === null) return false
      if (session === null || typeof session?.append !== 'function') return false
      try {
        session.append(PROJECTION_EVENT, { state })
        return true
      } catch (error) {
        warnWith(`could not publish worktree state: ${error instanceof Error ? error.message : String(error)}`)
        return false
      }
    },
    /**
     * Append one complete state for a Session id, when that Session is live.
     * A non-live Session cannot be appended to; its sidebar marker disappears on
     * the next creation-time repair instead (documented limitation).
     * @param {string} sessionId session identity.
     * @param {object|null} state complete post-change projection state.
     * @returns {boolean} whether the event was appended.
     */
    publishById(sessionId, state) {
      const session = liveSession(sessionId)
      if (session === null) return false
      return publisher.publish(session, state)
    },
    /** Clear one live Session's projection (cleanup/removal). */
    clear(session) {
      return publisher.publish(session, null)
    },
    /** Clear one Session id's projection when it is live. */
    clearById(sessionId) {
      return publisher.publishById(sessionId, null)
    },
    /**
     * Host-side read of the current value, used for the creation-time
     * consistency repair.
     * @param {object} session live session handle.
     * @returns {object|null|undefined} current state, null when empty, undefined when unavailable.
     */
    stateOf(session) {
      if (registry === null || session === null) return undefined
      try {
        return registry.stateOf(session, PROJECTION_KEY)
      } catch {
        return undefined
      }
    },
  }
  return publisher
}

/**
 * Build the state published at the start of the prepare step.
 * @param {{repoRoot: string, workspaceRoot: string, placement?: string, mode: string}} input
 */
export function creatingState(input) {
  return {
    phase: PHASE_CREATING,
    step: STEP_PREPARE,
    path: null,
    repoRoot: input.repoRoot,
    workspaceRoot: input.workspaceRoot,
    placement: input.placement,
    mode: input.mode,
    branch: null,
    baseCommit: null,
    updatedAt: new Date().toISOString(),
  }
}

/** Advance one creating state to the next step, keeping known facts. */
export function withStep(state, step, extra = {}) {
  return { ...state, step, ...extra, updatedAt: new Date().toISOString() }
}

/** The ready state built from a sidecar record. */
export function readyState(record) {
  return {
    phase: PHASE_READY,
    path: record.path,
    repoRoot: record.repoRoot,
    workspaceRoot: record.workspaceRoot,
    placement: record.placement ?? undefined,
    mode: record.mode,
    branch: record.branch ?? null,
    baseCommit: record.baseCommit ?? null,
    updatedAt: new Date().toISOString(),
  }
}

/** The error state; the Session stays in its original directory. */
export function errorState(input) {
  return {
    phase: PHASE_ERROR,
    step: input.step,
    path: input.path ?? null,
    repoRoot: input.repoRoot,
    workspaceRoot: input.workspaceRoot,
    placement: input.placement,
    mode: input.mode,
    branch: null,
    baseCommit: null,
    error: input.error,
    updatedAt: new Date().toISOString(),
  }
}
