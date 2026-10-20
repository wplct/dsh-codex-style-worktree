#!/usr/bin/env node
/**
 * End-to-end host smoke test.
 *
 * The real plugin mounts inside the DSH app where `@deepseek-ai/*` peers exist.
 * This script recreates that situation in a temp directory — copied plugin plus
 * minimal peer stubs — then mounts the plugin against a fake DSH context and
 * drives one `agent/created` through a real repository. It catches import-path
 * mistakes, export-shape mistakes — command/route/projection/settings
 * registration mistakes and an `apply()` that throws, none of which unit tests
 * of pure modules can see.
 *
 * Usage: node scripts/smoke-host.mjs
 */
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { execFileSync, spawn } from 'node:child_process'

const here = new URL('..', import.meta.url).pathname
const workspace = await mkdtemp(join(tmpdir(), 'dsh-codex-worktree-smoke-'))
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
  for (const method of ['default', 'description', 'min', 'max', 'volatile', 'required', 'hidden']) schema[method] = () => schema
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

  const captured = {
    listeners: new Map(),
    tools: [],
    commands: [],
    routes: [],
    effects: [],
    projection: undefined,
    projectionConfigure: undefined,
    settingsConfigure: undefined,
  }
  const roots = []
  const settingsValues = {
    enabled: true,
    defaultPlacement: 'worktree',
    directory: '.agents/worktrees',
    root: '',
    mode: 'detached',
    namePrefix: 'wt-',
    branchPrefix: 'wt/',
    baseRef: 'HEAD',
    fetchBeforeCreate: false,
    autoPrune: true,
    autoPruneKeep: 15,
    pruneGraceMs: 60000,
    poolGitignore: true,
    gitTimeoutMs: 20000,
    skipChildAgents: true,
    skipSessionIdPatterns: ['^session-taskboard-'],
    skipPresets: [],
    disableMarker: '.dsh-codex-worktree-off',
    maxPerRepo: 32,
    noticeOnCreate: false,
  }
  const settingsService = {
    revision: 3,
    describe() {
      return [
        { ns: 'other-plugin', revision: 0, value: { nope: 1 } },
        { ns: 'codex-worktree', revision: settingsService.revision, value: { ...settingsValues }, writable: true },
      ]
    },
    async update(ns, patch, expectedRevision) {
      if (expectedRevision !== settingsService.revision) {
        const error = new Error('revision mismatch')
        error.code = 'SETTINGS_CONFLICT'
        error.expected = expectedRevision
        error.actual = settingsService.revision
        throw error
      }
      Object.assign(settingsValues, patch)
      settingsService.revision += 1
      return { ns, revision: settingsService.revision }
    },
    configure(presentation, owner) {
      captured.settingsConfigure = { presentation, owner }
      return () => undefined
    },
  }
  const projectionService = {
    register(definition) {
      captured.projection = definition
      return () => undefined
    },
    stateOf() {
      return null
    },
  }
  const extraServices = { settings: settingsService, sessionProjections: projectionService }
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
    agents: {
      roots: () => [...roots],
      list: () => [...roots],
      get: (id) => roots.find((agent) => agent.session?.id === id),
    },
    workingDirectory: {
      get: (session) => session.__cwd ?? session.header.cwd,
      async set(agent, path) {
        agent.session.__cwd = path
      },
    },
    get(name) {
      if (extraServices[name] !== undefined) return extraServices[name]
      try {
        return ctx[name]
      } catch {
        return undefined
      }
    },
    on(name, callback) {
      captured.listeners.set(name, callback)
      return () => undefined
    },
    inject(deps, callback) {
      const child = Object.create(ctx)
      for (const dep of deps) {
        const service = extraServices[dep] ?? ctx[dep]
        if (service === undefined) throw new Error(`fake ctx has no service ${dep}`)
        Object.defineProperty(child, dep, { value: service, configurable: true })
      }
      callback(child)
    },
    effect(fn) {
      captured.effects.push(fn())
    },
    tools: { register: (tool) => captured.tools.push(tool) },
    commands: { register: (command) => captured.commands.push(command) },
    connection: { fetch: { register: (route) => (captured.routes.push(route), () => undefined) } },
  }
  Object.defineProperty(ctx, 'fiber', { value: { uid: 'fake-fiber' }, configurable: true })

  // Cordis throws on reading a service the plugin did not inject; the optional
  // sandbox services must be read defensively, never as `ctx.sandbox` directly.
  for (const name of ['sandbox', 'sandboxPolicy']) {
    Object.defineProperty(ctx, name, {
      configurable: true,
      get() {
        throw new Error(`cannot get property "${name}" without inject`)
      },
    })
  }

  // ---- 3. Mount ----------------------------------------------------------
  // Keep the sidecar inside the sandbox: the plugin reads DSH_HOME at mount time.
  const dshHome = join(workspace, 'home')
  await mkdir(dshHome, { recursive: true })
  process.env.DSH_HOME = dshHome
  const mod = await import(pathToFileURL(join(pluginDir, 'lib', 'index.js')).href)
  check('module exports name', mod.name === 'dsh-codex-worktree', String(mod.name))
  check('module exports apply', typeof mod.apply === 'function')
  check('module exports Config', mod.Config !== undefined)
  check('module exports required injects', Array.isArray(mod.inject) && mod.inject.includes('agents'))
  mod.apply(ctx, { directory: '.agents/worktrees', pruneGraceMs: 0, autoPrune: false })
  check('agent/created listener registered', captured.listeners.has('agent/created'))
  check('volatile-update listener registered', captured.listeners.has('loader/volatile-update'))
  check('no model tool is registered', captured.tools.length === 0, String(captured.tools.length))
  check('4 slash commands registered', captured.commands.length === 4, String(captured.commands.length))
  check('codexWorktree projection registered', captured.projection?.key === 'codexWorktree', String(captured.projection?.key))
  check('projection is client-visible (wire block)', captured.projection?.wire?.viewSchema !== undefined)
  check('official auto settings form advertised', captured.settingsConfigure?.presentation?.auto === true)
  // The routes are the RPC surface of lib/constants.js. `create` and `cancel` are
  // deliberately absent: creation happens in agent/created, cancel is client-only.
  const expectedEndpoints = ['status', 'clean', 'list', 'prune', 'placement', 'settings', 'restore']
  check(
    `${expectedEndpoints.length} routes registered`,
    captured.routes.length === expectedEndpoints.length,
    String(captured.routes.length),
  )
  for (const endpoint of expectedEndpoints) {
    check(
      `${endpoint} route path registered`,
      captured.routes.some((route) => route.path === `/api/dsh-codex-worktree/${endpoint}`),
    )
  }
  check('no create route', !captured.routes.some((route) => route.path.endsWith('/create')))

  // ---- 4. Drive one agent through the real lifecycle ---------------------
  const appended = []
  const agent = {
    id: 'session-smoke',
    session: {
      id: 'session-smoke',
      header: { cwd: repo },
      append(type, data) {
        appended.push({ type, data })
      },
    },
    inject: () => undefined,
  }
  roots.push(agent)
  await captured.listeners.get('agent/created')({ agent, source: 'startup', signal: undefined })
  const cwd = ctx.workingDirectory.get(agent.session)
  const { realpath } = await import('node:fs/promises')
  const expectedPool = join(await realpath(repo), '.agents', 'worktrees')
  check('session cwd moved into a worktree', (await realpath(cwd)).startsWith(expectedPool), cwd)
  const worktrees = git(repo, ['worktree', 'list', '--porcelain'])
  check('checkout registered with git', worktrees.includes(cwd), worktrees)
  check('main checkout stays clean', git(repo, ['status', '--porcelain']) === '')

  // The projection event stream drove the inline progress card.
  const states = appended.filter((event) => event.type === 'codex-worktree/state').map((event) => event.data.state)
  const creating = states.filter((state) => state !== null && state.phase === 'creating')
  check('projection published 3 creating steps', creating.length === 3, JSON.stringify(creating.map((s) => s.step)))
  check(
    'projection steps are prepare → checkout → finalize',
    creating.map((state) => state.step).join(',') === 'prepare,checkout,finalize',
    creating.map((state) => state.step).join(','),
  )
  check('projection ends ready with the checkout path', states.at(-1)?.phase === 'ready' && states.at(-1)?.path === cwd, JSON.stringify(states.at(-1)))
  check(
    'every published state passes the registered schema',
    states.every((state) => {
      try {
        captured.projection.stateSchema.parse(state)
        return true
      } catch {
        return false
      }
    }),
  )

  // ---- 5. Drive the client routes through the envelope -------------------
  const call = async (endpoint, payload, rpcId = `rpc-${endpoint}`) => {
    const route = captured.routes.find((candidate) => candidate.path === `/api/dsh-codex-worktree/${endpoint}`)
    const response = await route.fetch({
      headers: { get: () => 'application/json', },
      json: async () => ({ rpcId, method: `dsh-codex-worktree/${endpoint}`, payload }),
    })
    return (await response.json()).result
  }

  const list = await call('list', {})
  check('list route answers the rpc envelope', list?.ok === true, JSON.stringify(list).slice(0, 300))
  check('list route reports the repository group', list?.value?.repos?.length === 1, JSON.stringify(list).slice(0, 300))
  check('list route exposes config', list?.value?.config?.autoPruneKeep === 15, JSON.stringify(list?.value?.config))

  const status = await call('status', { sessionId: 'session-smoke' })
  check('status reports the managed checkout', status?.ok === true && status.value.managed === true && status.value.path === cwd, JSON.stringify(status).slice(0, 300))

  const placementRead = await call('placement', { workspacePath: repo })
  check(
    'placement read answers worktree/isGit',
    placementRead?.ok === true && placementRead.value.mode === 'worktree' && placementRead.value.defaultMode === 'worktree' && placementRead.value.isGit === true,
    JSON.stringify(placementRead).slice(0, 300),
  )
  const placementWrite = await call('placement', { workspacePath: repo, mode: 'local' })
  check('placement write persists local', placementWrite?.ok === true && placementWrite.value.mode === 'local', JSON.stringify(placementWrite).slice(0, 300))
  const placementAgain = await call('placement', { workspacePath: repo })
  check('placement read echoes the stored value', placementAgain?.value?.mode === 'local', JSON.stringify(placementAgain).slice(0, 300))
  check(
    'placement write rejects worktree outside git',
    (await call('placement', { workspacePath: join(workspace, 'nope'), mode: 'worktree' })).error?.code === 'not-git-repository',
  )

  // A second session in a local workspace creates nothing.
  const localAgent = {
    id: 'session-local',
    session: { id: 'session-local', header: { cwd: repo }, append: () => undefined },
    inject: () => undefined,
  }
  roots.push(localAgent)
  await captured.listeners.get('agent/created')({ agent: localAgent, source: 'startup', signal: undefined })
  check('local placement leaves the session in the workspace', ctx.workingDirectory.get(localAgent.session) === repo)

  // ---- 5b. Settings bridge ------------------------------------------------
  const settingsGet = await call('settings', { action: 'get' })
  check('settings get answers this plugin namespace', settingsGet?.ok === true && settingsGet.value.ns === 'codex-worktree', JSON.stringify(settingsGet).slice(0, 300))
  check('settings get returns 21 editable fields', settingsGet?.value?.fields?.length === 21, String(settingsGet?.value?.fields?.length))
  check('settings get returns defaults', settingsGet?.value?.defaults?.defaultPlacement === 'worktree')
  check('settings get hides internal fields', !('gitCommand' in settingsGet.value.values))
  const settingsSet = await call('settings', { action: 'set', patch: { enabled: false }, revision: settingsGet.value.revision })
  check('settings set returns the new revision', settingsSet?.ok === true && settingsSet.value.revision === settingsGet.value.revision + 1, JSON.stringify(settingsSet).slice(0, 300))
  check('settings set applied the value live', settingsValues.enabled === false && settingsSet.value.values.enabled === false)
  const stale = await call('settings', { action: 'set', patch: { enabled: true }, revision: settingsGet.value.revision })
  check('stale revision maps to conflict', stale?.error?.code === 'conflict' && stale.error.details?.actual === settingsSet.value.revision, JSON.stringify(stale).slice(0, 300))
  const invalid = await call('settings', { action: 'set', patch: { mode: 'weird' }, revision: settingsSet.value.revision })
  check('invalid value maps to invalid-config', invalid?.error?.code === 'invalid-config', JSON.stringify(invalid).slice(0, 300))
  const reset = await call('settings', { action: 'reset', revision: settingsSet.value.revision })
  check('settings reset restores defaults', reset?.ok === true && reset.value.values.enabled === true, JSON.stringify(reset).slice(0, 300))

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

  // ---- 7. Removal is guarded, snapshotted and restorable -----------------
  const before = JSON.parse(await readFile(join(dshHome, 'dsh-codex-worktree', 'state.json'), 'utf8'))
  check('sidecar is schema v3', before.schemaVersion === 3, String(before.schemaVersion))
  check('sidecar keeps the session record', before.records['session-smoke']?.path === cwd)
  check('sidecar keeps the workspace placement', Object.values(before.placements)[0]?.mode === 'local', JSON.stringify(before.placements))
  check('sidecar starts without snapshots', Object.keys(before.snapshots ?? {}).length === 0, JSON.stringify(before.snapshots))

  const inUse = await call('clean', { sessionId: 'session-smoke' })
  check('clean refuses a checkout in use by a live session', inUse?.error?.code === 'worktree-in-use', JSON.stringify(inUse).slice(0, 300))
  const cleaned = await call('clean', { sessionId: 'session-smoke', force: true })
  check('forced clean removes the checkout', cleaned?.ok === true && cleaned.value.removed === true, JSON.stringify(cleaned).slice(0, 300))
  check('forced clean saved the detached commits as a snapshot', cleaned?.value?.snapshots?.length === 1, JSON.stringify(cleaned?.value?.snapshots))
  const snapshot = cleaned.value.snapshots[0]
  check('snapshot ref lives under refs/dsh-codex-worktree', String(snapshot.ref).startsWith('refs/dsh-codex-worktree/'), String(snapshot.ref))
  check('snapshot points at the detached HEAD', snapshot.commit === detachedHead, `${snapshot.commit} !== ${detachedHead}`)

  const listAfter = await call('list', {})
  check('list exposes the saved snapshot', listAfter?.value?.snapshots?.length === 1, JSON.stringify(listAfter?.value?.snapshots))
  const realRepo = await realpath(repo)
  check(
    'list keeps a snapshot-only repository visible',
    listAfter?.value?.repos?.some((group) => group.repoRoot === realRepo && group.records.length === 0),
    JSON.stringify(listAfter?.value?.repos),
  )

  const restored = await call('restore', { ref: snapshot.ref })
  check('restore recreates a checkout from the snapshot', restored?.ok === true && typeof restored.value.path === 'string', JSON.stringify(restored).slice(0, 300))
  check('restored checkout is on the saved commit', git(restored.value.path, ['rev-parse', 'HEAD']) === detachedHead)
  check('restored checkout carries the committed file', (await readFile(join(restored.value.path, 'b.txt'), 'utf8')).trim() === 'b')
  const missing = await call('restore', { ref: 'refs/dsh-codex-worktree/missing' })
  check('unknown snapshot maps to snapshot-not-found', missing?.error?.code === 'snapshot-not-found', JSON.stringify(missing).slice(0, 300))

  const after = JSON.parse(await readFile(join(dshHome, 'dsh-codex-worktree', 'state.json'), 'utf8'))
  check('sidecar records the snapshot after the clean', after.snapshots?.[snapshot.ref]?.commit === detachedHead, JSON.stringify(after.snapshots))
  check('sidecar marks the snapshot as restored', typeof after.snapshots?.[snapshot.ref]?.restoredPath === 'string', JSON.stringify(after.snapshots))
} finally {
  await rm(workspace, { recursive: true, force: true })
}

if (failures > 0) {
  console.error(`\n${failures} smoke check(s) failed`)
  process.exit(1)
}
console.log('\nsmoke: all host checks passed')
