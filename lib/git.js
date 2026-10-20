/**
 * Sandboxed Git access.
 *
 * Every command runs through `ctx.subprocess` under the calling session's own
 * sandbox policy, exactly like the official worktree runtime: the plugin never
 * widens the write permission a session already has, and a denied command
 * fails the operation instead of silently escaping the sandbox.
 */
import { join } from 'node:path'
import { errorText, getService, withTimeout } from './util.js'

const STDOUT_MAX = 2 * 1024 * 1024
const STDERR_MAX = 512 * 1024
const GRACE_MS = 3000
/** Inherited repository selectors that must never steer a plugin-checkout command. */
const GIT_SELECTORS = [
  'GIT_DIR',
  'GIT_WORK_TREE',
  'GIT_COMMON_DIR',
  'GIT_INDEX_FILE',
  'GIT_OBJECT_DIRECTORY',
  'GIT_ALTERNATE_OBJECT_DIRECTORIES',
  'GIT_CONFIG',
  'GIT_CONFIG_PARAMETERS',
  'GIT_CONFIG_COUNT',
  'GIT_CEILING_DIRECTORIES',
  'GIT_PREFIX',
  'GIT_SHALLOW_FILE',
  'GIT_GRAFT_FILE',
  'GIT_REPLACE_REF_BASE',
  'GIT_ATTR_SOURCE',
]

const GIT_ENV = {
  ...Object.fromEntries(GIT_SELECTORS.map((key) => [key, undefined])),
  GIT_TERMINAL_PROMPT: '0',
  GIT_LFS_SKIP_SMUDGE: '1',
  GIT_NO_LAZY_FETCH: '1',
  GIT_OPTIONAL_LOCKS: '0',
}

/** The calling Session's policy, or the deployment default for agentless calls. */
function resolvePolicy(ctx, session, policyRoot) {
  const sandboxPolicy = getService(ctx, 'sandboxPolicy')
  if (sandboxPolicy === undefined || typeof sandboxPolicy.resolve !== 'function') return undefined
  const policy = sandboxPolicy.resolve(session === undefined ? {} : { session })
  if (policy === undefined) return undefined
  if (policyRoot !== undefined && session === undefined) return { ...policy, workspaceRoot: policyRoot }
  return policy
}

/**
 * @param {object} ctx plugin context.
 * @param {object} config resolved plugin config.
 * @returns {object} git helper API.
 */
export function createGit(ctx, config) {
  const cache = new Map()

  async function resolve(command, signal) {
    if (cache.has(command)) return cache.get(command)
    let resolved = command
    try {
      resolved = (await ctx.subprocess.resolveExecutable(command, undefined, signal)) ?? command
    } catch {
      resolved = command
    }
    cache.set(command, resolved)
    return resolved
  }

  /**
   * Run one git command in `cwd`.
   * @returns {Promise<{stdout: string, exitCode: number}>}
   */
  async function run(cwd, args, options = {}) {
    const { session, signal, allowedExitCodes = [0], timeoutMs = config.gitTimeoutMs, policyRoot } = options
    const bound = withTimeout(signal, timeoutMs)
    try {
      const executable = await resolve(config.gitCommand, bound.signal)
      let argv = [executable, ...args]
      const sandbox = getService(ctx, 'sandbox')
      if (sandbox !== undefined && typeof sandbox.confine === 'function') {
        const policy = resolvePolicy(ctx, session, policyRoot ?? cwd)
        if (policy !== undefined && policy.mode !== 'danger-full-access') {
          const confined = await sandbox.confine(argv, { ...policy, mode: policy.mode }, bound.signal)
          argv = confined.argv
        }
      }
      bound.signal.throwIfAborted()
      const child = ctx.subprocess.spawn({
        argv,
        cwd,
        env: { ...GIT_ENV },
        signal: bound.signal,
        graceMs: GRACE_MS,
        stdio: {
          stdin: 'ignore',
          stdout: { maxBytes: STDOUT_MAX },
          stderr: { maxBytes: STDERR_MAX },
        },
      })
      try {
        const outcome = await child.done
        bound.signal.throwIfAborted()
        const stdout = child.collected?.stdout?.readFrom(0)?.text ?? ''
        const stderr = child.collected?.stderr?.readFrom(0)?.text ?? ''
        const exitCode = outcome.exitCode
        if (exitCode === null || !allowedExitCodes.includes(exitCode)) {
          throw new Error(
            `git ${args.join(' ')} failed${outcome.signal ? ` (${outcome.signal})` : ` (exit ${exitCode})`}: ${
              stderr.trim() || stdout.trim() || 'no output'
            }`,
          )
        }
        return { stdout, exitCode }
      } finally {
        try {
          child.terminate()
          await child.waitForExit()
        } catch {
          /* teardown must not mask the operation result */
        }
      }
    } finally {
      bound.dispose()
    }
  }

  /** Common git flags: no repository hooks, no fsmonitor, no lazy fetches. */
  function flags(...args) {
    return ['-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', ...args]
  }

  return {
    run,
    resolve,

    /** Repository top level for `cwd`, or null when `cwd` is not in a work tree. */
    async repoRoot(cwd, session, signal) {
      try {
        const { stdout } = await run(cwd, flags('rev-parse', '--show-toplevel'), {
          session,
          signal,
          policyRoot: cwd,
          allowedExitCodes: [0, 128],
        })
        const text = stdout.replace(/\r?\n$/, '').trim()
        return text.length > 0 ? text : null
      } catch {
        return null
      }
    },

    /** Whether the repository already has at least one commit. */
    async hasCommit(repoRoot, session, signal) {
      try {
        const { exitCode } = await run(repoRoot, flags('rev-parse', '--verify', '--end-of-options', 'HEAD^{commit}'), {
          session,
          signal,
          allowedExitCodes: [0, 1, 128],
        })
        return exitCode === 0
      } catch {
        return false
      }
    },

    /** Resolve `baseRef` to a commit object name. */
    async baseCommit(repoRoot, baseRef, session, signal) {
      const { stdout } = await run(repoRoot, flags('rev-parse', '--verify', '--end-of-options', `${baseRef}^{commit}`), {
        session,
        signal,
      })
      return stdout.trim()
    },

    /** Whether this checkout is a linked worktree (`.git` is a file). */
    async isLinkedWorktree(repoRoot, signal) {
      try {
        if (ctx.fs !== undefined && typeof ctx.fs.lstat === 'function') {
          const info = await ctx.fs.lstat(join(repoRoot, '.git'), undefined, signal)
          return info !== undefined && info?.type === 'file'
        }
        const { stat } = await import('node:fs/promises')
        return (await stat(join(repoRoot, '.git'))).isFile()
      } catch {
        return false
      }
    },

    /** Validate a branch name with git itself. */
    async isRefName(name, repoRoot, session, signal) {
      try {
        const { exitCode } = await run(repoRoot, flags('check-ref-format', `refs/heads/${name}`), {
          session,
          signal,
          allowedExitCodes: [0, 1],
        })
        return exitCode === 0
      } catch {
        return false
      }
    },

    /** Fetch upstream refs when an `origin` remote exists; never fails the caller. */
    async fetchUpstream(repoRoot, session, signal) {
      const { stdout } = await run(repoRoot, flags('remote'), { session, signal, allowedExitCodes: [0, 128] })
      const remotes = stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
      if (!remotes.includes('origin')) return { fetched: false, reason: 'no-origin' }
      await run(repoRoot, flags('fetch', '--prune', '--quiet', 'origin'), { session, signal })
      return { fetched: true }
    },

    /** Commit currently checked out at `path`. */
    async headCommit(path, session, signal) {
      const { stdout } = await run(path, flags('rev-parse', 'HEAD'), { session, signal })
      return stdout.trim()
    },

    /** Point a ref at a commit, creating it when missing. */
    async updateRef(repoRoot, ref, sha, session, signal) {
      await run(repoRoot, flags('update-ref', ref, sha), { session, signal })
    },

    /** `git worktree add` in detached or new-branch mode. */
    async addWorktree({ repoRoot, path, mode, branch, baseRef, session, signal }) {
      const args =
        mode === 'branch'
          ? flags('worktree', 'add', '-b', branch, '--', path, baseRef)
          : flags('worktree', 'add', '--detach', '--', path, baseRef)
      await run(repoRoot, args, { session, signal })
    },

    /** Attach a branch to the current (detached) checkout. */
    async switchNewBranch(path, name, session, signal) {
      await run(path, flags('checkout', '-b', name), { session, signal })
    },

    /** Uncommitted change count for a checkout, or null when it cannot be read. */
    async dirtyCount(path, session, signal) {
      try {
        const { stdout } = await run(path, flags('status', '--porcelain'), {
          session,
          signal,
          allowedExitCodes: [0, 128],
        })
        return stdout.split(/\r?\n/).filter((line) => line.trim().length > 0).length
      } catch {
        return null
      }
    },

    /** Remove one worktree registration and its directory. */
    async removeWorktree({ repoRoot, path, force, session, signal }) {
      const args = force ? flags('worktree', 'remove', '--force', '--', path) : flags('worktree', 'remove', '--', path)
      await run(repoRoot, args, { session, signal })
    },

    /** Drop stale worktree registrations. */
    async prune(repoRoot, session, signal) {
      await run(repoRoot, flags('worktree', 'prune'), { session, signal, allowedExitCodes: [0, 128] })
    },

    /** Delete a local branch. */
    async deleteBranch(repoRoot, branch, force, session, signal) {
      await run(repoRoot, flags('branch', force ? '-D' : '-d', '--', branch), { session, signal })
    },

    /** `git worktree list --porcelain`, for diagnostics. */
    async worktreeList(repoRoot, session, signal) {
      try {
        const { stdout } = await run(repoRoot, flags('worktree', 'list', '--porcelain'), {
          session,
          signal,
          allowedExitCodes: [0, 128],
        })
        return stdout
      } catch (error) {
        return `error: ${errorText(error)}`
      }
    },
  }
}
