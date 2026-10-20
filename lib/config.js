/**
 * Config validation and defaults.
 *
 * Kept free of framework imports so the rules can be unit tested without a DSH
 * installation; `lib/index.js` owns the schemastery schema the loader uses.
 */
import { MODE_BRANCH, MODE_DETACHED } from './constants.js'
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

