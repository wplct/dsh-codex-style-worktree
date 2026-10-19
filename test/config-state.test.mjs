import test from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolveConfig } from '../lib/config.js'
import { coerceState, createStateStore, emptyState, resolveDshHome, statePathFor } from '../lib/state.js'

test('resolveConfig fills every documented default', () => {
  const config = resolveConfig({})
  assert.equal(config.enabled, true)
  assert.equal(config.directory, '.agents/worktrees')
  assert.equal(config.mode, 'detached')
  assert.equal(config.namePrefix, 'wt-')
  assert.equal(config.branchPrefix, 'wt/')
  assert.equal(config.baseRef, 'HEAD')
  assert.equal(config.poolGitignore, true)
  assert.equal(config.gitTimeoutMs, 20000)
  assert.equal(config.skipChildAgents, true)
  assert.deepEqual(config.skipSessionIdPatterns, ['^session-taskboard-'])
  assert.equal(config.disableMarker, '.dsh-auto-worktree-off')
  assert.equal(config.maxPerRepo, 32)
  assert.equal(config.noticeOnCreate, false)
  assert.equal(config.root, '')
  assert.equal(config.fetchBeforeCreate, false)
  assert.equal(config.autoPrune, true)
  assert.equal(config.autoPruneKeep, 15)
  assert.equal(config.pruneGraceMs, 60000)
  assert.equal(config.gitCommand, 'git')
})

test('resolveConfig rejects unusable values loudly', () => {
  assert.throws(() => resolveConfig({ directory: '/abs' }), /relative/)
  assert.throws(() => resolveConfig({ directory: 'a/../b' }), /dot segments/)
  assert.throws(() => resolveConfig({ mode: 'weird' }), /mode must be/)
  assert.throws(() => resolveConfig({ namePrefix: '-x' }), /namePrefix/)
  assert.throws(() => resolveConfig({ baseRef: '--all' }), /baseRef/)
  assert.throws(() => resolveConfig({ gitTimeoutMs: 0 }), /gitTimeoutMs/)
  assert.throws(() => resolveConfig({ maxPerRepo: -1 }), /maxPerRepo/)
  assert.throws(() => resolveConfig({ disableMarker: 'a/b' }), /disableMarker/)
  assert.equal(resolveConfig({ skipSessionIdPatterns: [] }).skipSessionIdPatterns.length, 0)
  assert.throws(() => resolveConfig({ root: 'a/../b' }), /dot segments/)
  assert.throws(() => resolveConfig({ autoPruneKeep: -1 }), /autoPruneKeep/)
  assert.throws(() => resolveConfig({ pruneGraceMs: 1.5 }), /pruneGraceMs/)
  assert.equal(resolveConfig({ root: '/abs/root' }).root, '/abs/root')
  assert.equal(resolveConfig({ root: 'shared/wt' }).root, 'shared/wt')
})

test('resolveDshHome honours DSH_HOME and falls back to ~/.dsh', () => {
  assert.equal(resolveDshHome({ DSH_HOME: '/custom/home' }, '/home/u'), '/custom/home')
  assert.equal(resolveDshHome({ DSH_HOME: '  ' }, '/home/u'), '/home/u/.dsh')
  assert.equal(resolveDshHome({}, '/home/u'), '/home/u/.dsh')
  assert.equal(statePathFor('/home/u/.dsh'), '/home/u/.dsh/dsh-auto-worktree/state.json')
})

test('coerceState drops unknown shapes and malformed records', () => {
  assert.deepEqual(coerceState(null).state, emptyState())
  assert.equal(coerceState([]).repaired, true)
  const { state } = coerceState({
    schemaVersion: 1,
    records: {
      a: { path: '/p', repoRoot: '/r' },
      b: { repoRoot: '/r' },
      c: 'nope',
    },
  })
  assert.deepEqual(Object.keys(state.records), ['a'])
})

test('state store round-trips records atomically', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dwt-state-'))
  const store = createStateStore(join(dir, 'state.json'))
  assert.deepEqual(await store.list(), [])
  const record = { sessionId: 's1', path: '/p', repoRoot: '/r', workspaceRoot: '/r', mode: 'detached', branch: null }
  await store.set(record)
  assert.deepEqual(await store.get('s1'), record)
  assert.deepEqual(await store.list(), [record])
  const raw = JSON.parse(await readFile(join(dir, 'state.json'), 'utf8'))
  assert.equal(raw.records.s1.path, '/p')
  await store.remove('s1')
  assert.equal(await store.get('s1'), null)
  await store.remove('s1')
  assert.deepEqual(await store.list(), [])
})

test('a corrupt sidecar is moved aside instead of overwritten silently', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dwt-state-'))
  const file = join(dir, 'state.json')
  await writeFile(file, '{not json', 'utf8')
  const store = createStateStore(file)
  assert.deepEqual(await store.list(), [])
  const files = await import('node:fs/promises').then((fs) => fs.readdir(dir))
  assert.ok(files.some((name) => name.startsWith('state.json.corrupt-')), `backup missing in ${files.join(',')}`)
})
