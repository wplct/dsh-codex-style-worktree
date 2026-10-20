/**
 * Config validation and defaults.
 *
 * Kept free of framework imports so the rules can be unit tested without a DSH
 * installation; `lib/index.js` owns the schemastery schema the loader uses and
 * `lib/settings.js` owns the form descriptor the settings page renders.
 *
 * Every user-visible field is declared `.volatile()` in `lib/index.js` (see
 * `lib/live-config.js` for why); the metadata below is the single source for
 * the settings form's controls, labels and reset defaults.
 */
import { DEFAULT_PLACEMENT, MODE_BRANCH, MODE_DETACHED, PLACEMENT_LOCAL, PLACEMENT_WORKTREE } from './constants.js'
import { isAbsolute } from 'node:path'
import { normalizePoolDirectory } from './pool.js'

/** Validate a non-negative integer option. */
function nonNegativeInteger(value, name) {
  const number = Number(value)
  if (!Number.isInteger(number) || number < 0) {
    throw new Error(`dsh-codex-worktree: ${name} must be a non-negative integer`)
  }
  return number
}

/** Validate a placement value. */
export function resolvePlacement(value, fallback = DEFAULT_PLACEMENT) {
  if (value === undefined || value === null || value === '') return fallback
  if (value === PLACEMENT_WORKTREE || value === PLACEMENT_LOCAL) return value
  throw new Error(`dsh-codex-worktree: placement must be "${PLACEMENT_WORKTREE}" or "${PLACEMENT_LOCAL}"`)
}

/**
 * Schema defaults for every user-visible field, in form order. The settings
 * page's「恢复默认」writes exactly this patch; the fields not listed here
 * (`gitCommand`, `cleanupOnDispose`) stay hidden internals.
 * @type {Array<{key: string, type: 'boolean'|'number'|'text'|'lines'|'select', options?: string[], description: string}>}
 */
export const EDITABLE_FIELDS = [
  { key: 'enabled', type: 'boolean', description: 'Create a worktree automatically for new sessions.' },
  {
    key: 'defaultPlacement',
    type: 'select',
    options: [PLACEMENT_WORKTREE, PLACEMENT_LOCAL],
    description: 'Where a new session runs when its workspace has no remembered choice.',
  },
  { key: 'directory', type: 'text', description: 'Pool directory inside the repository; relative, no dot segments.' },
  { key: 'root', type: 'text', description: 'Optional absolute (or repository-relative) checkout root; empty keeps checkouts inside the repository.' },
  { key: 'mode', type: 'select', options: [MODE_DETACHED, MODE_BRANCH], description: 'detached: no branch until commit time; branch: create a prefixed branch up front.' },
  { key: 'namePrefix', type: 'text', description: 'Prefix of the generated checkout name.' },
  { key: 'branchPrefix', type: 'text', description: 'Branch prefix used when mode is "branch".' },
  { key: 'baseRef', type: 'text', description: 'Local revision to start from; nothing is fetched.' },
  { key: 'fetchBeforeCreate', type: 'boolean', description: 'Run `git fetch --prune origin` before creating a checkout; failures only warn.' },
  { key: 'autoPrune', type: 'boolean', description: 'Delete the oldest clean checkouts beyond the keep count.' },
  { key: 'autoPruneKeep', type: 'number', description: 'How many checkouts to keep per repository when auto-prune is on.' },
  { key: 'pruneGraceMs', type: 'number', description: 'Never prune a checkout younger than this (milliseconds).' },
  { key: 'poolGitignore', type: 'boolean', description: 'Write a self-ignoring .gitignore into the pool so the main checkout stays clean.' },
  { key: 'gitTimeoutMs', type: 'number', description: 'Hard timeout for one git command (milliseconds).' },
  { key: 'skipChildAgents', type: 'boolean', description: 'Never create a worktree for subagents or child agents.' },
  { key: 'skipSessionIdPatterns', type: 'lines', description: 'Session ids to leave alone; one regular expression per line.' },
  { key: 'skipPresets', type: 'lines', description: 'Agent preset ids to leave alone; one regular expression per line.' },
  { key: 'disableMarker', type: 'text', description: 'A file with this name in the repository root disables the plugin for that repository.' },
  { key: 'maxPerRepo', type: 'number', description: 'Upper bound of live automatic worktrees per repository.' },
  { key: 'noticeOnCreate', type: 'boolean', description: 'Queue one extra user-context message describing the new checkout.' },
]

/**
 * The default value of every editable field. `resolveConfig({})` is the source
 * of truth, so a changed default can never drift from the form.
 * @returns {Record<string, unknown>}
 */
export function editableDefaults() {
  const resolved = resolveConfig({})
  const defaults = {}
  for (const field of EDITABLE_FIELDS) defaults[field.key] = resolved[field.key]
  return defaults
}

/**
 * Validate and normalize the config once, at mount time. A bad value fails the
 * plugin row loudly instead of silently degrading every session.
 */
export function resolveConfig(config = {}) {
  const directory = normalizePoolDirectory(config.directory ?? '.agents/worktrees')
  if (!directory.ok) throw new Error(`dsh-codex-worktree: ${directory.reason}`)
  const rawRoot = String(config.root ?? '').trim()
  let root = ''
  if (rawRoot.length > 0 && !rawRoot.startsWith('~') && !isAbsolute(rawRoot)) {
    const relative = normalizePoolDirectory(rawRoot)
    if (!relative.ok) throw new Error(`dsh-codex-worktree: root ${relative.reason}`)
    root = relative.value
  } else if (rawRoot.includes('..')) {
    throw new Error('dsh-codex-worktree: root must not contain dot segments')
  } else {
    root = rawRoot
  }
  const mode = config.mode ?? MODE_DETACHED
  if (mode !== MODE_DETACHED && mode !== MODE_BRANCH) {
    throw new Error(`dsh-codex-worktree: mode must be "${MODE_DETACHED}" or "${MODE_BRANCH}"`)
  }
  const namePrefix = String(config.namePrefix ?? 'wt-')
  if (namePrefix.includes('/') || namePrefix.includes('\\') || namePrefix.startsWith('-')) {
    throw new Error('dsh-codex-worktree: namePrefix must be a plain name fragment')
  }
  const branchPrefix = String(config.branchPrefix ?? 'wt/')
  if (branchPrefix.startsWith('-') || branchPrefix.startsWith('/')) {
    throw new Error('dsh-codex-worktree: branchPrefix must not start with "-" or "/"')
  }
  const baseRef = String(config.baseRef ?? 'HEAD').trim()
  if (baseRef.length === 0 || baseRef.startsWith('-')) {
    throw new Error('dsh-codex-worktree: baseRef must name a local revision and must not start with "-"')
  }
  const gitTimeoutMs = Number(config.gitTimeoutMs ?? 20000)
  if (!Number.isInteger(gitTimeoutMs) || gitTimeoutMs <= 0) {
    throw new Error('dsh-codex-worktree: gitTimeoutMs must be a positive integer')
  }
  const maxPerRepo = Number(config.maxPerRepo ?? 32)
  if (!Number.isInteger(maxPerRepo) || maxPerRepo <= 0) {
    throw new Error('dsh-codex-worktree: maxPerRepo must be a positive integer')
  }
  const disableMarker = String(config.disableMarker ?? '.dsh-codex-worktree-off')
  if (disableMarker.includes('/') || disableMarker.includes('\\') || disableMarker.length === 0) {
    throw new Error('dsh-codex-worktree: disableMarker must be a plain file name')
  }
  return {
    enabled: config.enabled !== false,
    defaultPlacement: resolvePlacement(config.defaultPlacement),
    directory: directory.value,
    root,
    fetchBeforeCreate: config.fetchBeforeCreate === true,
    autoPrune: config.autoPrune !== false,
    autoPruneKeep: nonNegativeInteger(config.autoPruneKeep ?? 15, 'autoPruneKeep'),
    pruneGraceMs: nonNegativeInteger(config.pruneGraceMs ?? 60000, 'pruneGraceMs'),
    mode,
    namePrefix,
    branchPrefix,
    baseRef,
    poolGitignore: config.poolGitignore !== false,
    gitTimeoutMs,
    skipChildAgents: config.skipChildAgents !== false,
    skipSessionIdPatterns: Array.isArray(config.skipSessionIdPatterns) ? config.skipSessionIdPatterns : ['^session-taskboard-'],
    skipPresets: Array.isArray(config.skipPresets) ? config.skipPresets : [],
    disableMarker,
    maxPerRepo,
    cleanupOnDispose: config.cleanupOnDispose === true,
    noticeOnCreate: config.noticeOnCreate === true,
    gitCommand: typeof config.gitCommand === 'string' && config.gitCommand.length > 0 ? config.gitCommand : 'git',
  }
}
