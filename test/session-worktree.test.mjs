/**
 * Integration tests: real git repositories, real processes, fake DSH context.
 *
 * These cover the wave the plugin exists for: a new session gets its own
 * checkout automatically, without a name, and can be named or cleaned later.
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

/** Build one isolated environment: repository + sidecar + runtime. */
async function setup(overrides = {}) {
  const repo = await makeRepo()
  const stateDir = await makeTempDir()
  const config = resolveConfig({ directory: '.agents/worktrees', ...overrides })
  const { ctx, logs, roots } = createFakeCtx()
  const store = createStateStore(join(stateDir, 'state.json'))
  const gitApi = createGit(ctx, config)
  const runtime = createRuntime({ ctx, config, store, git: gitApi })
  return { repo, stateDir, config, ctx, logs, roots, store, gitApi, runtime }
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

test('a checkout with uncommitted work cannot be cleaned without force', async () => {
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
  }
  {
    const env = await setup()
    const repo = await makeRepo()
    await rm(join(repo, '.git'), { recursive: true, force: true })
    git(repo, ['init', '-q', '-b', 'main'])
    const agent = createAgent(repo)
    env.roots.push(agent)
    assert.equal((await detach(env, agent)).reason, 'no-commit')
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
  const refs = git(env.repo, ['for-each-ref', '--format=%(refname) %(objectname)', 'refs/dsh-codex-worktree'])
  assert.match(refs, new RegExp(head))
  git(env.repo, ['update-ref', '-d', pruned.snapshots[0].ref])
})

test('the new-worktree button creates a checkout ahead of its session, which adopts it', async () => {
  const env = await setup({ autoPrune: false })
  const repo = await realpath(env.repo)

  const record = await env.runtime.createCheckout({ repoPath: env.repo })
  assert.equal(record.pending, true)
  assert.match(record.sessionId, /^pending-/)
  assert.equal(record.mode, 'detached')
  assert.equal(record.branch, null)
  assert.equal(await realpath(record.repoRoot), repo)
  assert.equal(await realpath(record.path).then((p) => p.startsWith(join(repo, '.agents', 'worktrees'))), true)
  assert.ok(existsSync(record.path), 'checkout directory exists')
  assert.equal(await env.store.get(record.sessionId), record)

  // The session that starts inside the checkout inherits the existing record.
  const agent = createAgent(await realpath(record.path), 'session-button')
  env.roots.push(agent)
  const result = await detach(env, agent)
  assert.equal(result.created, false)
  assert.equal(result.reason, 'adopted')
  assert.equal(result.record.sessionId, 'session-button')
  assert.equal(result.record.pending, false)
  assert.equal((await env.store.get('session-button'))?.path, record.path)
  assert.equal(await env.store.get(record.sessionId), null)
})

test('createCheckout reports the failure reasons the button renders', async () => {
  {
    const env = await setup()
    const outside = await makeTempDir()
    await assert.rejects(
      () => env.runtime.createCheckout({ repoPath: outside }),
      (error) => error.code === 'not-git-repository',
    )
  }
  {
    const env = await setup({ enabled: false })
    await assert.rejects(
      () => env.runtime.createCheckout({ repoPath: env.repo }),
      (error) => error.code === 'disabled',
    )
  }
  {
    const env = await setup()
    const repo = await makeRepo()
    await rm(join(repo, '.git'), { recursive: true, force: true })
    git(repo, ['init', '-q', '-b', 'main'])
    await assert.rejects(
      () => env.runtime.createCheckout({ repoPath: repo }),
      (error) => error.code === 'no-commit',
    )
  }
  {
    const env = await setup({ maxPerRepo: 1 })
    await env.runtime.createCheckout({ repoPath: env.repo })
    await assert.rejects(
      () => env.runtime.createCheckout({ repoPath: env.repo }),
      (error) => error.code === 'limit-reached',
    )
  }
})

test('createCheckout respects the per-repository disable marker', async () => {
  const env = await setup()
  await writeFile(join(env.repo, '.dsh-codex-worktree-off'), '', 'utf8')
  await assert.rejects(
    () => env.runtime.createCheckout({ repoPath: env.repo }),
    (error) => error.code === 'disabled',
  )
})
