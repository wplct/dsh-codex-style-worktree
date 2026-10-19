#!/usr/bin/env node
/**
 * End-to-end host smoke test.
 *
 * The real plugin mounts inside the DSH app where `@deepseek-ai/*` peers exist.
 * This script recreates that situation in a temp directory — copied plugin plus
 * minimal peer stubs — then mounts the plugin against a fake DSH context and
 * drives one `agent/created` through a real repository. It catches import-path
 * mistakes, export-shape mistakes, tool/command/route registration mistakes and
 * an `apply()` that throws, none of which unit tests of pure modules can see.
 *
 * Usage: node scripts/smoke-host.mjs
 */
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { execFileSync, spawn } from 'node:child_process'

const here = new URL('..', import.meta.url).pathname
const workspace = await mkdtemp(join(tmpdir(), 'dsh-auto-worktree-smoke-'))
const pluginDir = join(workspace, 'plugin')
const stubs = join(workspace, 'node_modules', '@deepseek-ai')

let failures = 0
function check(label, condition, detail = '') {
  if (condition) {
    console.log(`  ok  ${label}`)
    return
  }
  failures += 1
  console.log(`  FAIL ${label}${detail === '' ? '' : ` — ${detail}`}`)
}

try {
  // ---- 1. Stage the plugin next to peer stubs -----------------------------
  await cp(join(here, 'lib'), join(pluginDir, 'lib'), { recursive: true })
  await cp(join(here, 'package.json'), join(pluginDir, 'package.json'))

  await mkdir(join(stubs, 'schemastery'), { recursive: true })
  await writeFile(
    join(stubs, 'schemastery', 'package.json'),
    JSON.stringify({ name: '@deepseek-ai/schemastery', version: '3.18.2', type: 'module', main: 'index.js' }),
  )
  await writeFile(
    join(stubs, 'schemastery', 'index.js'),
    `const chain = () => {
  const schema = {}
  for (const method of ['default', 'description', 'min', 'max']) schema[method] = () => schema
  return schema
}
const z = {
  object: () => chain(),
  string: () => chain(),
  boolean: () => chain(),
  number: () => chain(),
  array: () => chain(),
  enum: () => chain(),
  union: () => chain(),
  const: () => chain(),
}
export default z
`,
  )
  await mkdir(join(stubs, 'dsh-tools'), { recursive: true })
  await writeFile(
    join(stubs, 'dsh-tools', 'package.json'),
    JSON.stringify({ name: '@deepseek-ai/dsh-tools', version: '0.2.1-rc.2', type: 'module', main: 'index.js' }),
  )
  await writeFile(join(stubs, 'dsh-tools', 'index.js'), `export const defineTool = (definition) => definition\n`)
  await mkdir(join(stubs, 'dsh-client-connection'), { recursive: true })
  await writeFile(
    join(stubs, 'dsh-client-connection', 'package.json'),
    JSON.stringify({ name: '@deepseek-ai/dsh-client-connection', version: '0.2.1-rc.2', type: 'module', main: 'index.js' }),
  )
  await writeFile(
    join(stubs, 'dsh-client-connection', 'index.js'),
    `export const clientRequestSchema = {
  safeParse(value) {
    if (value !== null && typeof value === 'object' && typeof value.method === 'string' && 'payload' in value) {
      return { success: true, data: value }
    }
    return { success: false }
  },
}
`,
  )

  // ---- 2. Fake DSH context ------------------------------------------------
  const git = (repo, args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).trim()
  const repo = join(workspace, 'repo')
  await mkdir(repo)
  git(repo, ['init', '-q', '-b', 'main'])
  git(repo, ['config', 'user.email', 'test@example.com'])
  git(repo, ['config', 'user.name', 'Test'])
  await writeFile(join(repo, 'a.txt'), 'a\n')
  git(repo, ['add', '.'])
  git(repo, ['commit', '-qm', 'init'])

  const subprocess = {
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
        stdout += chunk
      })
      child.stderr?.on('data', (chunk) => {
        stderr += chunk
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
            child.kill()
          } catch {
            /* gone */
          }
        },
        async waitForExit() {
          await done.catch(() => undefined)
        },
      }
    },
  }

  const captured = { listeners: new Map(), tools: [], commands: [], routes: [], effects: [] }
  const roots = []
  const ctx = {
    logger: { info: () => undefined, warn: (message) => console.log(`  [warn] ${message}`) },
    subprocess,
    fs: {
      async resolve(path) {
        return path
      },
      processPath(path) {
        return path
      },
      async lstat(path) {
        try {
          const { stat } = await import('node:fs/promises')
          const info = await stat(path)
          return { type: info.isFile() ? 'file' : 'directory', size: info.size }
        } catch {
          return undefined
        }
      },
    },
    agents: { roots: () => [...roots] },
    workingDirectory: {
      get: (session) => session.__cwd ?? session.header.cwd,
      async set(agent, path) {
        agent.session.__cwd = path
      },
    },
    on(name, callback) {
      captured.listeners.set(name, callback)
    },
    inject(_deps, callback) {
      callback(ctx)
    },
    effect(fn) {
      captured.effects.push(fn())
    },
    tools: { register: (tool) => captured.tools.push(tool) },
    commands: { register: (command) => captured.commands.push(command) },
    connection: { fetch: { register: (route) => (captured.routes.push(route), () => undefined) } },
  }

  // ---- 3. Mount ----------------------------------------------------------
  // Keep the sidecar inside the sandbox: the plugin reads DSH_HOME at mount time.
  const dshHome = join(workspace, 'home')
  await mkdir(dshHome, { recursive: true })
  process.env.DSH_HOME = dshHome
  const mod = await import(pathToFileURL(join(pluginDir, 'lib', 'index.js')).href)
  check('module exports name', mod.name === 'dsh-auto-worktree', String(mod.name))
  check('module exports apply', typeof mod.apply === 'function')
  check('module exports Config', mod.Config !== undefined)
  check('module exports required injects', Array.isArray(mod.inject) && mod.inject.includes('agents'))
  mod.apply(ctx, { directory: '.agents/worktrees', pruneGraceMs: 0, autoPrune: false })
  check('agent/created listener registered', captured.listeners.has('agent/created'))
  check('no model tool is registered', captured.tools.length === 0, String(captured.tools.length))
  check('2 slash commands registered', captured.commands.length === 2, String(captured.commands.length))
  check('4 routes registered', captured.routes.length === 4, String(captured.routes.length))
  check(
    'list route path registered',
    captured.routes.some((route) => route.path === '/api/dsh-auto-worktree/list'),
  )

  // ---- 4. Drive one agent through the real lifecycle ---------------------
  const agent = { id: 'session-smoke', session: { id: 'session-smoke', header: { cwd: repo }, append: () => undefined }, inject: () => undefined }
  roots.push(agent)
  await captured.listeners.get('agent/created')({ agent, source: 'startup', signal: undefined })
  const cwd = ctx.workingDirectory.get(agent.session)
  const { realpath } = await import('node:fs/promises')
  const expectedPool = join(await realpath(repo), '.agents', 'worktrees')
  check('session cwd moved into a worktree', (await realpath(cwd)).startsWith(expectedPool), cwd)
  check('checkout exists', execFileSync('test', ['-d', cwd]) === undefined ? true : true)
  const worktrees = git(repo, ['worktree', 'list', '--porcelain'])
  check('checkout registered with git', worktrees.includes(cwd), worktrees)
  check('main checkout stays clean', git(repo, ['status', '--porcelain']) === '')

  // ---- 5. Drive the client route through the envelope --------------------
  const listRoute = captured.routes.find((route) => route.path === '/api/dsh-auto-worktree/list')
  const response = await listRoute.fetch({
    headers: { get: () => 'application/json' },
    json: async () => ({ rpcId: 'rpc-1', method: 'dsh-auto-worktree/list', payload: {} }),
  })
  const body = await response.json()
  check('list route answers the rpc envelope', body.type === 'server-response' && body.rpcId === 'rpc-1')
  check('list route reports the repository group', body.result?.ok === true && body.result.value.repos.length === 1, JSON.stringify(body).slice(0, 300))
  check('list route exposes config', body.result?.value?.config?.autoPruneKeep === 15, JSON.stringify(body.result?.value?.config))

  // ---- 6. The checkout stays detached; Git owns branch naming ------------
  check('checkout is detached', (() => {
    try {
      git(cwd, ['symbolic-ref', '-q', 'HEAD'])
      return false
    } catch {
      return true
    }
  })())
  await writeFile(join(cwd, 'b.txt'), 'b\n')
  git(cwd, ['add', '.'])
  git(cwd, ['-c', 'user.email=test@example.com', '-c', 'user.name=Test', 'commit', '-qm', 'wip'])
  const detachedHead = git(cwd, ['rev-parse', 'HEAD'])
  check('commits land on the detached HEAD', detachedHead.length === 40, detachedHead)
  check('plugin created no branch', git(repo, ['for-each-ref', '--format=%(refname)', 'refs/heads']).split('\n').filter((line) => line.length > 0).length === 1, git(repo, ['branch']))
} finally {
  await rm(workspace, { recursive: true, force: true })
}

if (failures > 0) {
  console.error(`\n${failures} smoke check(s) failed`)
  process.exit(1)
}
console.log('\nsmoke: all host checks passed')
