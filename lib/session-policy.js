/**
 * The skip policy, as pure functions.
 *
 * Split in two stages on purpose: `earlySkipReason` decides from facts the
 * plugin already holds (no I/O at all), and `lateSkipReason` decides from facts
 * that require probing the repository. The caller only probes when the early
 * stage says "continue", so a non-git workspace, a child agent, or a disabled
 * plugin never pays for git.
 */
import { SKIPPED_SOURCES } from './constants.js'

/** Whether `value` matches any of the configured regular expressions. */
export function matchesAny(patterns, value) {
  if (!Array.isArray(patterns) || value === undefined || value === null) return false
  for (const pattern of patterns) {
    if (typeof pattern !== 'string' || pattern.length === 0) continue
    try {
      if (new RegExp(pattern).test(value)) return true
    } catch {
      /* an invalid user pattern never matches */
    }
  }
  return false
}

/**
 * Stage 1 — decisions that need no filesystem or git access.
 *
 * @param {object} input
 * @param {boolean} input.enabled plugin switch.
 * @param {string} input.source agent creation source (`startup`, `resume`, …).
 * @param {boolean} input.isRootAgent whether the agent is a top-level runtime root.
 * @param {boolean} input.skipChildAgents configured switch.
 * @param {string} input.sessionId session identity.
 * @param {string[]} input.skipSessionIdPatterns configured patterns.
 * @param {string[]} input.skipPresets configured patterns.
 * @param {string|undefined} input.preset current agent preset id, when known.
 * @param {string} input.cwd current session directory.
 * @param {string|undefined} input.headerCwd original project directory.
 * @param {object|null} input.record existing sidecar record for the session.
 * @param {boolean} input.markerPresent whether the opt-out marker exists.
 * @returns {string|null} a reason code, or null to continue.
 */
export function earlySkipReason(input) {
  if (!input.enabled) return 'disabled'
  if (SKIPPED_SOURCES.includes(input.source)) return 'source'
  if (input.skipChildAgents && !input.isRootAgent) return 'child-agent'
  if (matchesAny(input.skipSessionIdPatterns, input.sessionId)) return 'session-pattern'
  if (matchesAny(input.skipPresets, input.preset)) return 'preset'
  if (input.record !== null && input.record !== undefined) return 'recorded'
  if (input.headerCwd !== undefined && input.cwd !== input.headerCwd) return 'already-moved'
  if (input.markerPresent) return 'marker'
  return null
}

/**
 * Stage 2 — decisions that need repository facts.
 *
 * @param {object} input
 * @param {string|null} input.repoRoot resolved repository top level, null if none.
 * @param {boolean} input.hasCommit whether the repository has a commit.
 * @param {boolean} input.isLinkedWorktree whether the checkout is itself linked.
 * @param {boolean} input.cwdInsidePool whether the session directory is in the pool.
 * @param {number} input.recordCount existing records for this repository.
 * @param {number} input.maxPerRepo configured ceiling.
 * @returns {string|null} a reason code, or null to continue.
 */
export function lateSkipReason(input) {
  if (input.repoRoot === null || input.repoRoot === undefined) return 'not-git'
  if (input.cwdInsidePool) return 'pool-context'
  if (input.isLinkedWorktree) return 'linked-worktree'
  if (!input.hasCommit) return 'no-commit'
  if (input.recordCount >= input.maxPerRepo) return 'limit'
  return null
}

/** Whether a record belongs to one repository (separator-insensitive compare). */
export function recordsForRepo(records, repoRoot) {
  const clean = (value) => String(value ?? '').replace(/[\\/]+$/, '')
  return records.filter((record) => clean(record?.repoRoot) === clean(repoRoot))
}
