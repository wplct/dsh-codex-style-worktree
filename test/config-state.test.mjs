import test from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { EDITABLE_FIELDS, editableDefaults, resolveConfig, resolvePlacement } from '../lib/config.js'
import { PLACEMENT_TTL_MS } from '../lib/constants.js'
import { coerceState, createStateStore, emptyState, placementKey, resolveDshHome, statePathFor } from '../lib/state.js'

test('resolveConfig fills every documented default', () => {
  const config = resolveConfig({})
  assert.equal(config.enabled, true)
  assert.equal(config.defaultPlacement, 'worktree')
  assert.equal(config.directory, '.agents/worktrees')
  assert.equal(config.mode, 'detached')
  assert.equal(config.namePrefix, 'wt-')
  assert.equal(config.branchPrefix, 'wt/')
  assert.equal(config.baseRef, 'HEAD')
  assert.equal(config.poolGitignore, true)
  assert.equal(config.gitTimeoutMs, 20000)
  assert.equal(config.skipChildAgents, true)
  assert.deepEqual(config.skipSessionIdPatterns, ['^session-taskboard-'])
  assert.equal(config.disableMarker, '.dsh-codex-worktree-off')
  assert.equal(config.maxPerRepo, 32)
  assert.equal(config.noticeOnCreate, false)
  assert.equal(config.root, '')
  assert.equal(config.fetchBeforeCreate, false)
  assert.equal(config.autoPrune, true)
  assert.equal(config.autoPruneKeep, 15)
  assert.equal(config.pruneGraceMs, 60000)
  assert.equal(config.gitCommand, 'git')
})

test('resolvePlacement accepts only the two documented values', () => {
  assert.equal(resolvePlacement(undefined), 'worktree')
  assert.equal(resolvePlacement(''), 'worktree')
  assert.equal(resolvePlacement('local'), 'local')
  assert.equal(resolvePlacement('worktree'), 'worktree')
  assert.throws(() => resolvePlacement('server'), /placement must be/)
})

test('editable metadata and defaults agree with resolveConfig', () => {
  const defaults = editableDefaults()
  assert.equal(EDITABLE_FIELDS.length, 21)
  assert.deepEqual(
    EDITABLE_FIELDS.map((field) => field.key),
    [
      'enabled',
      'defaultPlacement',
      'directory',
      'root',
      'mode',
      'namePrefix',
      'branchPrefix',
      'baseRef',
      'fetchBeforeCreate',
      'autoPrune',
      'autoPruneKeep',
      'pruneGraceMs',
      'cleanupOnArchive',
      'poolGitignore',
      'gitTimeoutMs',
      'skipChildAgents',
      'skipSessionIdPatterns',
      'skipPresets',
      'disableMarker',
      'maxPerRepo',
      'noticeOnCreate',
    ],
  )
  const config = resolveConfig({})
  for (const field of EDITABLE_FIELDS) {
    assert.deepEqual(defaults[field.key], config[field.key], field.key)
    assert.ok(['boolean', 'number', 'text', 'lines', 'select'].includes(field.type), field.key)
    assert.equal(typeof field.description, 'string')
  }
  // Internal fields never appear in the form.
  assert.equal(Object.hasOwn(defaults, 'gitCommand'), false)
  assert.equal(Object.hasOwn(defaults, 'cleanupOnDispose'), false)
  assert.deepEqual(editableDefaults(), editableDefaults())
})

test('resolveConfig rejects unusable values loudly', () => {
  assert.throws(() => resolveConfig({ defaultPlacement: 'server' }), /placement must be/)
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
  assert.equal(statePathFor('/home/u/.dsh'), '/home/u/.dsh/dsh-codex-worktree/state.json')
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
  assert.deepEqual(state.placements, {})
  assert.deepEqual(state.snapshots, {})
  assert.equal(state.schemaVersion, 3)
})

test('coerceState migrates a v1 document and validates placement rows', () => {
  const { state } = coerceState({
    schemaVersion: 1,
    records: { a: { path: '/p', repoRoot: '/r' } },
    placements: {
      '/repo': { mode: 'local', updatedAt: '2026-01-01T00:00:00.000Z' },
      '/bad': { mode: 'server' },
      '': { mode: 'worktree' },
    },
  })
  assert.equal(state.schemaVersion, 3)
  assert.deepEqual(Object.keys(state.records), ['a'])
  assert.deepEqual(Object.keys(state.placements), ['/repo'])
  assert.equal(state.placements['/repo'].mode, 'local')
})

test('the store remembers one placement per canonical workspace path', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dwt-state-'))
  const store = createStateStore(join(dir, 'state.json'))
  assert.equal(await store.getPlacement('/repo'), null)
  assert.equal(await store.getPlacement(''), null)
  await store.setPlacement('/repo/', 'local')
  assert.deepEqual((await store.getPlacement('/repo'))?.mode, 'local')
  assert.equal(placementKey('/repo///'), '/repo')
  assert.deepEqual((await store.placements()).map((row) => row.workspacePath), ['/repo'])
  await assert.rejects(() => store.setPlacement('', 'local'), /workspacePath is required/)
  await assert.rejects(() => store.setPlacement('/repo', 'server'), /placement must be/)

  // A v1 sidecar on disk is adopted and rewritten with placements.
  const raw = JSON.parse(await readFile(join(dir, 'state.json'), 'utf8'))
  assert.equal(raw.schemaVersion, 3)
  assert.equal(raw.placements['/repo'].mode, 'local')
  assert.deepEqual(raw.snapshots, {})
})

test('stale placements are dropped past the retention window', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dwt-state-'))
  const file = join(dir, 'state.json')
  const now = Date.now()
  await writeFile(
    file,
    JSON.stringify({
      schemaVersion: 2,
      records: {},
      placements: {
        '/old': { mode: 'local', updatedAt: new Date(now - PLACEMENT_TTL_MS - 1000).toISOString() },
        '/fresh': { mode: 'worktree', updatedAt: new Date(now).toISOString() },
      },
    }),
    'utf8',
  )
  const store = createStateStore(file)
  assert.deepEqual((await store.placements()).map((row) => row.workspacePath), ['/fresh'])
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

test('coerceState migrates a v2 document and keeps only well-formed snapshot rows', () => {
  const { state } = coerceState({
    schemaVersion: 2,
    records: { a: { path: '/p', repoRoot: '/r' } },
    placements: { '/repo': { mode: 'local', updatedAt: '2026-01-01T00:00:00.000Z' } },
    snapshots: {
      'refs/dsh-codex-worktree/261020-120000-123456': {
        ref: 'refs/dsh-codex-worktree/261020-120000-123456',
        repoRoot: '/r',
        commit: 'a'.repeat(40),
        sessionId: 'session-1',
        createdAt: '2026-01-01T00:00:00.000Z',
      },
      malformed: { repoRoot: '/r' },
      '/also-bad': { ref: '/also-bad', commit: 'abc' },
    },
  })
  assert.equal(state.schemaVersion, 3)
  assert.deepEqual(Object.keys(state.records), ['a'])
  assert.deepEqual(Object.keys(state.placements), ['/repo'])
  assert.deepEqual(Object.keys(state.snapshots), ['refs/dsh-codex-worktree/261020-120000-123456'])
  assert.equal(state.snapshots['refs/dsh-codex-worktree/261020-120000-123456'].commit, 'a'.repeat(40))
})

test('the store round-trips snapshot rows and marks restores durably', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dwt-state-'))
  const store = createStateStore(join(dir, 'state.json'))
  assert.deepEqual(await store.snapshots(), [])
  const ref = 'refs/dsh-codex-worktree/261020-120000-123456'
  await store.setSnapshot({
    ref,
    repoRoot: '/repo',
    commit: 'b'.repeat(40),
    sessionId: 'session-1',
    createdAt: '2026-01-01T00:00:00.000Z',
  })
  assert.equal((await store.getSnapshot(ref))?.commit, 'b'.repeat(40))
  assert.equal((await store.snapshots('/repo')).length, 1)
  assert.equal((await store.snapshots('/other')).length, 0)
  const marked = await store.markSnapshotRestored(ref, '/repo/.agents/worktrees/wt-restored-1')
  assert.equal(marked?.restoredPath, '/repo/.agents/worktrees/wt-restored-1')
  const raw = JSON.parse(await readFile(join(dir, 'state.json'), 'utf8'))
  assert.equal(raw.schemaVersion, 3)
  assert.equal(raw.snapshots[ref].restoredPath, '/repo/.agents/worktrees/wt-restored-1')
})
