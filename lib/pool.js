/**
 * Pure path/name rules for the worktree pool.
 *
 * Everything here is deterministic and dependency-free so it can be unit
 * tested without a DSH context or a real repository.
 */
import { createHash } from 'node:crypto'
import { homedir } from 'node:os'
import { isAbsolute, join } from 'node:path'

/** The self-ignoring file written when this plugin creates the pool itself. */
export const POOL_GITIGNORE = '*\n'

/** Two-digit zero pad. */
const pad = (value) => String(value).padStart(2, '0')

/**
 * Validate the configured pool directory: a relative directory without dot
 * segments (mirrors the official worktree runtime's rule).
 * @param {string} value configured `directory`.
 * @returns {{ok: true, value: string} | {ok: false, reason: string}}
 */
export function normalizePoolDirectory(value) {
  const text = String(value ?? '').trim()
  if (text.length === 0) return { ok: false, reason: 'directory must not be empty' }
  if (text.startsWith('/') || /^[A-Za-z]:[\\/]/.test(text)) {
    return { ok: false, reason: 'directory must be relative to the repository root' }
  }
  const parts = text.split(/[\\/]+/).filter((part) => part.length > 0)
  if (parts.length === 0) return { ok: false, reason: 'directory must not be empty' }
  if (parts.some((part) => part === '.' || part === '..')) {
    return { ok: false, reason: 'directory must not contain dot segments' }
  }
  return { ok: true, value: parts.join('/') }
}

/**
 * Deterministic, human-readable, collision-resistant-enough name for a new
 * checkout. Seconds resolution plus retries in {@link candidateName} keeps two
 * sessions started in the same second apart.
 * @param {string} prefix configured `namePrefix`.
 * @param {Date} date creation time.
 * @returns {string} e.g. `wt-251019-190932`.
 */
export function generateName(prefix, date = new Date()) {
  const stamp = `${pad(date.getFullYear() % 100)}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(
    date.getHours(),
  )}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  return `${prefix}${stamp}`
}

/**
 * The nth candidate for a base name. Attempt 0 is the base itself.
 * @param {string} base base name.
 * @param {number} attempt zero-based attempt counter.
 * @returns {string} candidate name.
 */
export function candidateName(base, attempt) {
  if (attempt <= 0) return base
  return `${base}-${attempt + 1}`
}

/** Absolute pool path inside one repository. */
export function poolPathFor(repoRoot, directory) {
  return join(repoRoot, directory)
}

/** Absolute destination of one checkout inside the pool. */
export function destinationFor(poolPath, name) {
  return join(poolPath, name)
}

/**
 * Whether `path` lives inside `poolPath` (lexical, separator-normalized).
 * Used to refuse creating a worktree from inside an existing pool checkout.
 */
export function isInsidePool(poolPath, path) {
  const pool = poolPath.replace(/[\\/]+$/, '')
  const target = path.replace(/[\\/]+$/, '')
  return target === pool || target.startsWith(`${pool}/`) || target.startsWith(`${pool}\\`)
}

/**
 * Stable short identity for one repository, used to keep external pool roots
 * from colliding when several repositories share a directory name.
 * @param {string} repoRoot absolute repository top level.
 * @returns {string} eight hex characters.
 */
export function repoKey(repoRoot) {
  return createHash('sha1').update(String(repoRoot)).digest('hex').slice(0, 8)
}

/**
 * Resolve the configured root into an absolute pool directory.
 *
 * An empty root keeps the checkout inside the repository (the only location a
 * `workspace-write` session can write to); a configured root may be absolute,
 * `~/…`, or relative to the repository.
 *
 * @param {object} input
 * @param {string} input.root configured `root` ('' for repository-local).
 * @param {string} input.directory repository-relative pool, used when root is ''.
 * @param {string} input.repoRoot absolute repository top level.
 * @returns {string} absolute pool directory.
 */
export function resolvePoolRoot({ root, directory, repoRoot }) {
  if (root === undefined || root === null || String(root).trim().length === 0) return poolPathFor(repoRoot, directory)
  const text = String(root).trim()
  const expanded = text === '~' ? homedir() : text.startsWith('~/') ? join(homedir(), text.slice(2)) : text
  if (!isAbsolute(expanded)) return join(repoRoot, ...expanded.split(/[\\/]+/).filter((part) => part.length > 0))
  return join(expanded, `${repoRoot.split(/[\\/]/).filter(Boolean).pop() ?? 'repo'}-${repoKey(repoRoot)}`)
}
