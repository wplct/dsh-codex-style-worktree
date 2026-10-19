/**
 * Test doubles.
 *
 * The fake context provides exactly the services the plugin consumes, with a
 * real `git` behind `ctx.subprocess` so the integration tests exercise actual
 * repositories instead of a mocked command surface.
 */
import { execFileSync, spawn } from 'node:child_process'
import { mkdtemp, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** A subprocess provider shaped like `@deepseek-ai/dsh-subprocess`, backed by real processes. */
export function createSubprocess() {
  return {
    async resolveExecutable(command) {
      return command
    },
    spawn({ argv, cwd, env, signal, stdio }) {
      const child = spawn(argv[0], argv.slice(1), {
        cwd,
        env: { ...process.env, ...(env ?? {}) },
        signal,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      let stdout = ''
      let stderr = ''
      child.stdout?.on('data', (chunk) => {
        if (stdout.length < (stdio?.stdout?.maxBytes ?? 1 << 20)) stdout += chunk
      })
      child.stderr?.on('data', (chunk) => {
        if (stderr.length < (stdio?.stderr?.maxBytes ?? 1 << 19)) stderr += chunk
      })
      const done = new Promise((resolve, reject) => {
        child.on('error', reject)
        child.on('close', (exitCode, signalName) => resolve({ exitCode, signal: signalName ?? null }))
      })
      return {
        done,
        collected: {
          stdout: { readFrom: () => ({ text: stdout, lossy: false }) },
          stderr: { readFrom: () => ({ text: stderr, lossy: false }) },
        },
        terminate() {
          try {
            child.kill('SIGTERM')
          } catch {
            /* already gone */
          }
        },
        async waitForExit() {
          await done.catch(() => undefined)
        },
      }
    },
  }
}

/**
 * A context with the plugin's required services; `roots` grows as tests add agents.
 * @returns {{ctx: object, logs: string[], roots: object[]}}
 */
export function createFakeCtx(options = {}) {
  const logs = []
  const roots = []
  const ctx = {
    logger: {
      warn: (message) => logs.push(`warn: ${message}`),
      info: (message) => logs.push(`info: ${message}`),
    },
    subprocess: createSubprocess(),
    fs: {
      async resolve(path) {
        return path
      },
      processPath(path) {
        return path
      },
      async lstat(path) {
        try {
          const info = await stat(path)
          return { type: info.isFile() ? 'file' : 'directory', size: info.size }
        } catch {
          return undefined
        }
      },
    },
    agents: {
      roots: () => [...roots],
    },
    workingDirectory: {
      get: (session) => session.__cwd ?? session.header.cwd,
      async set(agent, path) {
        agent.session.__cwd = path
      },
    },
  }
  if (options.sandboxPolicy !== undefined) ctx.sandboxPolicy = options.sandboxPolicy
  return { ctx, logs, roots }
}

/** A live-agent stand-in owned by one session. */
export function createAgent(cwd, id = 'session-test-1') {
  const session = { id, header: { cwd }, append: () => undefined }
  return {
    id,
    session,
    inject: () => undefined,
    ctx: { fiber: { assertActive: () => undefined } },
  }
}

/** Absolute git helper for assertions. */
export function git(repo, args, options = {}) {
  return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', ...options }).trim()
}

/** Create a repository with one commit. */
export async function makeRepo() {
  const dir = await mkdtemp(join(tmpdir(), 'dwt-repo-'))
  git(dir, ['init', '-q', '-b', 'main'])
  git(dir, ['config', 'user.email', 'test@example.com'])
  git(dir, ['config', 'user.name', 'Test'])
  await writeFile(join(dir, 'a.txt'), 'a\n', 'utf8')
  git(dir, ['add', '.'])
  git(dir, ['commit', '-qm', 'init'])
  return dir
}

/** A temporary directory for sidecars. */
export async function makeTempDir(prefix = 'dwt-tmp-') {
  return mkdtemp(join(tmpdir(), prefix))
}
