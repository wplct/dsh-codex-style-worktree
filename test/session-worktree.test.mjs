/**
 * Integration tests: real git repositories, real processes, fake DSH context.
 *
 * These cover the wave the plugin exists for: the user remembers a work
 * location per workspace, sends the first prompt, and the checkout is created
 * then — with every step published to the session projection.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { realpath, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createGit } from '../lib/git.js'
import { resolveConfig } from '../lib/config.js'
import { createRuntime } from '../lib/session-worktree.js'
import { createStateStore } from '../lib/state.js'
import { createAgent, createFakeCtx, git, makeRepo, makeTempDir } from './helpers.mjs'

/** A projection publisher stand-in that records every published state. */
export function recordingProjection(stateOfValue = undefined) {
  const states = []
  return {
    states,
    stateOf: () => stateOfValue,
    publish(session, state) {
      states.push(state)
      return true
    },
    publishById() {
      return false
    },
    clear(session) {
      states.push(null)
      return true
    },
    clearById() {
      states.push(null)
      return true
    },
  }
}

/** Build one isolated environment: repository + sidecar + runtime. */
async function setup(overrides = {}, projection = recordingProjection()) {
  const repo = await makeRepo()
  const stateDir = await makeTempDir()
  const config = resolveConfig({ directory: '.agents/worktrees', ...overrides })
  const { ctx, logs, roots } = createFakeCtx()
  const store = createStateStore(join(stateDir, 'state.json'))
  const gitApi = createGit(ctx, config)
  const runtime = createRuntime({ ctx, config, store, git: gitApi, projection })
  return { repo, stateDir, config, ctx, logs, roots, store, gitApi, runtime, projection }
}

const detach = async (env, agent) => env.runtime.ensureForAgent({ agent, source: 'startup' })

test('a new session gets its own detached checkout and enters it', async () => {
  const env = await setup()
  const agent = createAgent(env.repo)
  env.roots.push(agent)

  const result = await detach(env, agent)
  assert.equal(result.created, true, JSON.stringify(result))
  const record = result.record
  const repo = await realpath(env.repo)
  assert.equal(record.mode, 'detached')
  assert.equal(record.branch, null)
  assert.equal(record.placement, 'worktree')
  assert.equal(await realpath(record.repoRoot), repo)
  assert.equal(await realpath(record.workspaceRoot), repo)
  assert.equal(record.baseCommit, git(env.repo, ['rev-parse', 'HEAD']))
  assert.ok(existsSync(record.path), 'checkout directory exists')
  assert.equal(await realpath(record.path), join(repo, '.agents', 'worktrees', record.path.split('/').pop()))

  // The checkout is registered and detached.
  assert.match(git(env.repo, ['worktree', 'list', '--porcelain']), new RegExp(record.path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  assert.throws(() => git(record.path, ['symbolic-ref', '-q', 'HEAD']), /exited with|Command failed/)

  // The main checkout stays clean thanks to the self-ignoring pool.
  assert.equal(git(env.repo, ['status', '--porcelain']), '')
  assert.match(git(env.repo, ['status', '--porcelain', '--ignored']), /!! \.agents\//)

  // The session now works in the checkout, and the sidecar records it.
  assert.equal(env.ctx.workingDirectory.get(agent.session), record.path)
  assert.equal(await env.store.get(agent.session.id), record)

  // The projection saw prepare → checkout → finalize → ready.
  const states = env.projection.states
  assert.equal(states.at(-1).phase, 'ready')
  assert.equal(states.at(-1).path, record.path)
  const creating = states.filter((state) => state !== null && state.phase === 'creating')
  assert.deepEqual(
    creating.map((state) => state.step),
    ['prepare', 'checkout', 'finalize'],
  )
  assert.equal(creating[1].path, record.path)
  assert.equal(creating[1].baseCommit, record.baseCommit)
})

test('a workspace remembered as local creates no checkout', async () => {
  const env = await setup()
  await env.store.setPlacement(env.repo, 'local')
  const agent = createAgent(env.repo)
  env.roots.push(agent)

  const result = await detach(env, agent)
  assert.equal(result.created, false)
  assert.equal(result.reason, 'local-placement')
  assert.equal(await env.store.get(agent.session.id), null)
  assert.equal(existsSync(join(env.repo, '.agents')), false)
  assert.equal(env.ctx.workingDirectory.get(agent.session), env.repo)
  assert.deepEqual(env.projection.states, [])
})

test('defaultPlacement decides the value for a fresh workspace', async () => {
  {
    const env = await setup({ defaultPlacement: 'local' })
    const agent = createAgent(env.repo)
    env.roots.push(agent)
    assert.equal((await detach(env, agent)).reason, 'local-placement')
  }
  {
    const env = await setup()
    const agent = createAgent(env.repo)
    env.roots.push(agent)
    assert.equal((await detach(env, agent)).created, true)
  }
})

test('the remembered placement is read through placementFor/setPlacementFor', async () => {
  const env = await setup()
  const initial = await env.runtime.placementFor(env.repo)
  assert.equal(initial.mode, 'worktree')
  assert.equal(initial.defaultMode, 'worktree')
  assert.equal(initial.isGit, true)
  assert.equal(initial.workspacePath.endsWith(env.repo.split('/').pop()), true)

  const written = await env.runtime.setPlacementFor(env.repo, 'local')
  assert.equal(written.mode, 'local')
  assert.equal((await env.runtime.placementFor(env.repo)).mode, 'local')
  assert.equal((await env.store.getPlacement(env.repo)).mode, 'local')

  await env.runtime.setPlacementFor(env.repo, 'worktree')
  assert.equal((await env.runtime.placementFor(env.repo)).mode, 'worktree')

  const outside = await makeTempDir()
  const foreign = await env.runtime.placementFor(outside)
  assert.equal(foreign.isGit, false)
  await assert.rejects(() => env.runtime.setPlacementFor(outside, 'worktree'), (error) => error.code === 'not-git-repository')
  // local is always allowed, even outside git.
  assert.equal((await env.runtime.setPlacementFor(outside, 'local')).mode, 'local')
})

test('two sessions in the same second get distinct checkouts', async () => {
  const env = await setup()
  const first = createAgent(env.repo, 'session-a')
  const second = createAgent(env.repo, 'session-b')
  env.roots.push(first, second)

  const [a, b] = await Promise.all([detach(env, first), detach(env, second)])
  assert.equal(a.created, true, JSON.stringify(a))
  assert.equal(b.created, true, JSON.stringify(b))
  assert.notEqual(a.record.path, b.record.path)
  assert.equal((await env.store.list()).length, 2)
})

test('a checkout with uncommitted work cannot be cleaned without force, and clean clears the projection', async () => {
  const env = await setup()
  const agent = createAgent(env.repo)
  env.roots.push(agent)
  const { record } = await detach(env, agent)
  await writeFile(join(record.path, 'b.txt'), 'b\n', 'utf8')

  await assert.rejects(
    () => env.runtime.clean({ sessionId: agent.session.id, session: agent.session }),
    (error) => {
      assert.match(error.message, /uncommitted change/)
      assert.equal(error.code, 'worktree-dirty')
      return true
    },
  )

  const cleaned = await env.runtime.clean({ sessionId: agent.session.id, force: true, session: agent.session })
  assert.equal(cleaned.removed, true)
  assert.equal(existsSync(record.path), false)
  const remaining = git(env.repo, ['worktree', 'list', '--porcelain']).split('\n').filter((line) => line.startsWith('worktree '))
  assert.equal(remaining.length, 1)
  assert.equal(await env.store.get(agent.session.id), null)
  assert.equal(env.projection.states.at(-1), null, 'cleanup publishes a null projection')
})

test('cleaning can delete the branch created by mode=branch', async () => {
  const env = await setup({ mode: 'branch', branchPrefix: 'task/' })
  const agent = createAgent(env.repo)
  env.roots.push(agent)
  const { record } = await detach(env, agent)
  assert.equal(record.branch.startsWith('task/'), true)
  await env.runtime.clean({ sessionId: agent.session.id, force: true, deleteBranch: true, session: agent.session })
  assert.equal(git(env.repo, ['branch', '--list', record.branch]), '')
  assert.equal(existsSync(record.path), false)
})

test('mode=branch creates the prefixed branch up front', async () => {
  const env = await setup({ mode: 'branch', branchPrefix: 'wt/' })
  const agent = createAgent(env.repo)
  env.roots.push(agent)
  const { record } = await detach(env, agent)
  assert.equal(record.branch.startsWith('wt/'), true)
  assert.equal(git(record.path, ['symbolic-ref', '--short', 'HEAD']), record.branch)
})

test('non-git directories, missing commits, child agents, markers and switches skip cleanly', async () => {
  {
    const env = await setup()
    const outside = await makeTempDir()
    const agent = createAgent(outside)
    env.roots.push(agent)
    assert.equal((await detach(env, agent)).reason, 'not-git')
    assert.deepEqual(env.projection.states, [], 'a non-git workspace is not an error card')
  }
  {
    const env = await setup()
    const repo = await makeRepo()
    await rm(join(repo, '.git'), { recursive: true, force: true })
    git(repo, ['init', '-q', '-b', 'main'])
    const agent = createAgent(repo)
    env.roots.push(agent)
    assert.equal((await detach(env, agent)).reason, 'no-commit')
    assert.equal(env.projection.states.at(-1)?.phase, 'error')
    assert.equal(env.projection.states.at(-1)?.step, 'prepare')
  }
  {
    const env = await setup()
    const child = createAgent(env.repo, 'session-child')
    // roots stays empty: the agent is owned by another agent.
    assert.equal((await detach(env, child)).reason, 'child-agent')
  }
  {
    const env = await setup()
    const agent = createAgent(env.repo)
    env.roots.push(agent)
    await writeFile(join(env.repo, '.dsh-codex-style-worktree-off'), '', 'utf8')
    assert.equal((await detach(env, agent)).reason, 'marker')
  }
  {
    // The pre-rename marker is still honored after the package rename.
    const env = await setup()
    const agent = createAgent(env.repo)
    env.roots.push(agent)
    await writeFile(join(env.repo, '.dsh-codex-worktree-off'), '', 'utf8')
    assert.equal((await detach(env, agent)).reason, 'marker')
  }
  {
    const env = await setup({ enabled: false })
    const agent = createAgent(env.repo)
    env.roots.push(agent)
    assert.equal((await detach(env, agent)).reason, 'disabled')
  }
  {
    const env = await setup({ maxPerRepo: 1 })
    const first = createAgent(env.repo, 'session-limit-1')
    const second = createAgent(env.repo, 'session-limit-2')
    env.roots.push(first, second)
    assert.equal((await detach(env, first)).created, true)
    assert.equal((await detach(env, second)).reason, 'limit')
    assert.equal(env.projection.states.at(-1)?.phase, 'error')
  }
})

test('a failing git never breaks the session', async () => {
  const env = await setup({ gitCommand: 'definitely-not-git' })
  const agent = createAgent(env.repo)
  env.roots.push(agent)
  const result = await detach(env, agent)
  assert.equal(result.created, false)
  assert.ok(['error', 'not-git'].includes(result.reason), JSON.stringify(result))
  assert.equal(env.ctx.workingDirectory.get(agent.session), env.repo)
  assert.deepEqual(await env.store.list(), [])
})

test('a recorded session is not entered twice, even by a fresh runtime', async () => {
  const env = await setup()
  const agent = createAgent(env.repo)
  env.roots.push(agent)
  assert.equal((await detach(env, agent)).created, true)
  assert.equal((await detach(env, agent)).reason, 'attempted')

  const second = createRuntime({ ctx: env.ctx, config: env.config, store: env.store, git: env.gitApi })
  assert.equal((await second.ensureForAgent({ agent, source: 'startup' })).reason, 'recorded')
})

test('an unknown session id is ignored', async () => {
  const env = await setup()
  assert.equal((await env.runtime.ensureForAgent({ agent: { session: { id: '' } } })).reason, 'no-session')
})

test('a stale ready projection for a missing checkout is repaired to null', async () => {
  const projection = recordingProjection({ phase: 'ready', path: '/definitely/not/here' })
  const env = await setup({}, projection)
  const agent = createAgent(env.repo)
  env.roots.push(agent)
  await detach(env, agent)
  assert.equal(projection.states[0], null, 'repair appends a null state first')
})

test('an external root is refused when the session sandbox cannot write it', async () => {
  const external = await makeTempDir('dwt-ext-')
  const env = await setup({ root: external })
  env.ctx.sandboxPolicy = { resolve: () => ({ mode: 'workspace-write' }) }
  const agent = createAgent(env.repo)
  env.roots.push(agent)
  const result = await detach(env, agent)
  assert.equal(result.created, false)
  assert.equal(result.reason, 'root-outside-sandbox')
  assert.equal(env.ctx.workingDirectory.get(agent.session), env.repo)
  assert.equal(await env.store.get(agent.session.id), null)
})

test('an external root works for a full-access session', async () => {
  const external = await makeTempDir('dwt-ext-')
  const env = await setup({ root: external })
  env.ctx.sandboxPolicy = { resolve: () => ({ mode: 'danger-full-access' }) }
  const agent = createAgent(env.repo)
  env.roots.push(agent)
  const result = await detach(env, agent)
  assert.equal(result.created, true, JSON.stringify(result))
  assert.equal((await realpath(result.record.path)).startsWith(await realpath(external)), true)
})

test('fetchBeforeCreate warns but never blocks when there is no origin', async () => {
  const env = await setup({ fetchBeforeCreate: true })
  const agent = createAgent(env.repo)
  env.roots.push(agent)
  const result = await detach(env, agent)
  assert.equal(result.created, true, JSON.stringify(result))
  assert.equal(env.logs.some((line) => line.includes('skipped upstream fetch')), true, env.logs.join('\n'))
})

test('auto-prune removes the oldest clean checkouts and keeps dirty ones', async () => {
  const env = await setup({ autoPrune: false, autoPruneKeep: 1, pruneGraceMs: 0 })
  const agents = [createAgent(env.repo, 'session-p1'), createAgent(env.repo, 'session-p2'), createAgent(env.repo, 'session-p3')]
  env.roots.push(...agents)
  const created = []
  for (const agent of agents) created.push((await detach(env, agent)).record)

  // The oldest checkout carries uncommitted work and must survive.
  await writeFile(join(created[0].path, 'wip.txt'), 'wip\n', 'utf8')

  const pruned = await env.runtime.prune({ repoRoot: await realpath(env.repo) })
  assert.equal(pruned.removed.length, 1, JSON.stringify(pruned))
  assert.equal(pruned.removed[0].sessionId, 'session-p2')
  assert.equal(existsSync(created[0].path), true)
  assert.equal(existsSync(created[1].path), false)
  assert.equal(existsSync(created[2].path), true)
  assert.equal((await env.store.list()).length, 2)
})

test('pruning a detached checkout preserves its commits as a snapshot ref', async () => {
  const env = await setup({ autoPrune: false, autoPruneKeep: 0, pruneGraceMs: 0 })
  const agent = createAgent(env.repo)
  env.roots.push(agent)
  const { record } = await detach(env, agent)
  await writeFile(join(record.path, 'b.txt'), 'b\n', 'utf8')
  git(record.path, ['add', '.'])
  git(record.path, ['-c', 'user.email=test@example.com', '-c', 'user.name=Test', 'commit', '-qm', 'wip'])
  const head = git(record.path, ['rev-parse', 'HEAD'])

  const pruned = await env.runtime.prune({ repoRoot: await realpath(env.repo) })
  assert.equal(pruned.removed.length, 1, JSON.stringify(pruned))
  assert.equal(pruned.snapshots.length, 1, JSON.stringify(pruned))
  assert.equal(pruned.snapshots[0].commit, head)
  const refs = git(env.repo, ['for-each-ref', '--format=%(refname) %(objectname)', 'refs/dsh-codex-style-worktree'])
  assert.match(refs, new RegExp(head))
  git(env.repo, ['update-ref', '-d', pruned.snapshots[0].ref])
})

test('a Cordis context that throws on uninjected services still creates a worktree', async () => {
  const repo = await makeRepo()
  const stateDir = await makeTempDir()
  const config = resolveConfig({ directory: '.agents/worktrees' })
  const { ctx, roots } = createFakeCtx()
  for (const name of ['sandbox', 'sandboxPolicy']) {
    Object.defineProperty(ctx, name, {
      configurable: true,
      get() {
        throw new Error(`cannot get property "${name}" without inject`)
      },
    })
  }
  const store = createStateStore(join(stateDir, 'state.json'))
  const runtime = createRuntime({ ctx, config, store, git: createGit(ctx, config), projection: recordingProjection() })
  const agent = createAgent(repo)
  roots.push(agent)
  const result = await runtime.ensureForAgent({ agent, source: 'startup' })
  assert.equal(result.created, true, JSON.stringify(result))
})

test('clean refuses a checkout another live session is working in, and force overrides', async () => {
  const env = await setup()
  const owner = createAgent(env.repo, 'session-owner')
  const guest = createAgent(env.repo, 'session-guest')
  env.roots.push(owner, guest)
  const created = await detach(env, owner)
  assert.equal(created.created, true)
  await env.ctx.workingDirectory.set(guest, created.record.path)

  await assert.rejects(
    () => env.runtime.clean({ sessionId: owner.session.id, session: owner.session }),
    (error) => error.code === 'worktree-in-use' && error.details.path === created.record.path,
  )

  const forced = await env.runtime.clean({ sessionId: owner.session.id, session: owner.session, force: true })
  assert.equal(forced.removed, true)
  assert.equal(existsSync(created.record.path), false)
  assert.equal(await env.store.get(owner.session.id), null)
})

test('cleaning your own checkout moves the session back to the workspace root', async () => {
  const env = await setup()
  const agent = createAgent(env.repo, 'session-self')
  env.roots.push(agent)
  const created = await detach(env, agent)
  assert.equal(env.ctx.workingDirectory.get(agent.session), created.record.path)

  const cleaned = await env.runtime.clean({ sessionId: agent.session.id, session: agent.session })
  assert.equal(cleaned.removed, true)
  assert.equal(cleaned.movedTo, created.record.workspaceRoot)
  assert.equal(env.ctx.workingDirectory.get(agent.session), created.record.workspaceRoot)
  assert.equal(await env.store.get(agent.session.id), null)
})

test('a detached checkout with new commits is snapshotted on clean and can be restored', async () => {
  const env = await setup()
  const agent = createAgent(env.repo, 'session-snapshot')
  env.roots.push(agent)
  const created = await detach(env, agent)
  const record = created.record

  await writeFile(join(record.path, 'b.txt'), 'b\n', 'utf8')
  git(record.path, ['add', '.'])
  git(record.path, ['commit', '-qm', 'work'])
  const head = git(record.path, ['rev-parse', 'HEAD'])

  const cleaned = await env.runtime.clean({ sessionId: agent.session.id, session: agent.session })
  assert.equal(cleaned.removed, true)
  assert.equal(cleaned.snapshots.length, 1)
  const [snapshot] = cleaned.snapshots
  assert.equal(snapshot.commit, head)
  assert.equal(git(env.repo, ['rev-parse', snapshot.ref]), head)
  assert.equal((await env.store.snapshots()).length, 1)
  assert.equal(git(env.repo, ['for-each-ref', '--format=%(refname)', 'refs/dsh-codex-style-worktree']).includes(snapshot.ref), true)

  const restored = await env.runtime.restoreSnapshot({ ref: snapshot.ref })
  assert.equal(git(restored.path, ['rev-parse', 'HEAD']), head)
  assert.ok(existsSync(join(restored.path, 'b.txt')))
  assert.match(restored.path, /wt-restored-/)
  assert.throws(() => git(restored.path, ['symbolic-ref', '-q', 'HEAD']), /exited with|Command failed/)
  assert.equal((await env.store.getSnapshot(snapshot.ref))?.restoredPath, restored.path)

  await assert.rejects(
    () => env.runtime.restoreSnapshot({ ref: 'refs/dsh-codex-style-worktree/missing' }),
    (error) => error.code === 'snapshot-not-found',
  )
  await assert.rejects(() => env.runtime.restoreSnapshot({ ref: '  ' }), (error) => error.code === 'bad-request')
})

test('cleanupOnArchive sweeps archived clean checkouts and leaves dirty ones alone', async () => {
  const env = await setup({ cleanupOnArchive: true })
  env.ctx.workspaceRegistry = { archivedSessionIds: [] }
  const keeper = createAgent(env.repo, 'session-keep')
  const archivedClean = createAgent(env.repo, 'session-archived-clean')
  const archivedDirty = createAgent(env.repo, 'session-archived-dirty')
  env.roots.push(keeper, archivedClean, archivedDirty)

  await detach(env, keeper)
  const cleanRecord = (await detach(env, archivedClean)).record
  const dirtyRecord = (await detach(env, archivedDirty)).record
  await writeFile(join(dirtyRecord.path, 'dirty.txt'), 'x\n', 'utf8')

  env.ctx.workspaceRegistry.archivedSessionIds = [archivedClean.session.id, archivedDirty.session.id]
  const sweep = await env.runtime.sweepArchived({})
  assert.equal(sweep.removed.length, 1)
  assert.equal(sweep.removed[0].sessionId, archivedClean.session.id)
  assert.equal(existsSync(cleanRecord.path), false)
  assert.equal(existsSync(dirtyRecord.path), true)
  assert.equal(await env.store.get(archivedClean.session.id), null)
  assert.ok(await env.store.get(archivedDirty.session.id))
  assert.ok(await env.store.get(keeper.session.id))

  // Default is off: the same sweep is a no-op without the setting.
  const off = await setup()
  off.ctx.workspaceRegistry = { archivedSessionIds: ['session-any'] }
  assert.deepEqual(await off.runtime.sweepArchived({}), { removed: [] })
})
