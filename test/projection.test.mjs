import test from 'node:test'
import assert from 'node:assert/strict'
import { PROJECTION_EVENT as EVENT_TYPE } from '../lib/constants.js'
import {
  applyProjection,
  createProjectionPublisher,
  creatingState,
  errorState,
  parseProjectionState,
  PHASE_CREATING,
  PHASE_ERROR,
  PHASE_READY,
  projectionDefinition,
  readyState,
  STEP_CHECKOUT,
  STEP_PREPARE,
  withStep,
} from '../lib/projection.js'

test('the projection value schema validates the fixed shape', () => {
  assert.equal(parseProjectionState(null), null)
  const creating = creatingState({ repoRoot: '/r', workspaceRoot: '/r', placement: 'worktree', mode: 'detached' })
  assert.equal(parseProjectionState(creating).phase, PHASE_CREATING)
  const ready = readyState({ path: '/p', repoRoot: '/r', workspaceRoot: '/r', mode: 'detached', branch: null, baseCommit: 'abc' })
  assert.equal(parseProjectionState(ready).path, '/p')
  assert.equal(parseProjectionState(errorState({ repoRoot: '/r', workspaceRoot: '/r', mode: 'detached', error: 'no-commit' })).phase, PHASE_ERROR)
  assert.throws(() => parseProjectionState({ phase: 'weird' }), /phase must be/)
  assert.throws(() => parseProjectionState('x'), /must be null or an object/)
  assert.throws(() => parseProjectionState([]), /must be null or an object/)
  assert.throws(() => parseProjectionState({ ...ready, step: 'deploy' }), /step must be/)
  assert.throws(() => parseProjectionState({ ...ready, path: 3 }), /path must be/)
  assert.throws(() => parseProjectionState({ ...ready, placement: 'server' }), /placement must be/)
  assert.throws(() => parseProjectionState({ ...ready, branch: 7 }), /branch must be/)
  assert.throws(() => parseProjectionState({ ...ready, updatedAt: 1 }), /updatedAt must be/)
  assert.equal(projectionDefinition.stateVersion, 1)
  assert.equal(projectionDefinition.key, 'codexWorktree')
  assert.equal(projectionDefinition.init(), null)
  assert.equal(projectionDefinition.stateSchema.safeParse({ phase: 'ready' }).success, false)
  assert.equal(EVENT_TYPE, 'codex-worktree/state')
})

test('apply folds only this unit\'s event and keeps the reference otherwise', () => {
  assert.equal(applyProjection(null, { type: 'user/message', data: {} }), null)
  const state = readyState({ path: '/p', repoRoot: '/r', workspaceRoot: '/r', mode: 'detached', branch: null, baseCommit: 'abc' })
  const before = applyProjection(null, { type: EVENT_TYPE, data: { state } })
  assert.deepEqual(before, state)
  assert.equal(applyProjection(before, { type: 'other/event', data: {} }), before)
  assert.equal(applyProjection(before, { type: EVENT_TYPE, data: {} }), before)
  assert.equal(applyProjection(before, { type: EVENT_TYPE, data: { state: null } }), null)
  // The wire view must stay reference-stable for unrelated events.
  assert.equal(projectionDefinition.wire.view(before), before)
})

test('the publisher stays inert until a registry is attached', () => {
  const appended = []
  const session = { append: (type, data) => appended.push({ type, data }) }
  const publisher = createProjectionPublisher({ ctx: { logger: { warn() {} } } })
  assert.equal(publisher.enabled, false)
  assert.equal(
    publisher.publish(session, readyState({ path: '/p', repoRoot: '/r', workspaceRoot: '/r', mode: 'detached', branch: null, baseCommit: 'abc' })),
    false,
  )
  assert.deepEqual(appended, [])

  const registry = { stateOf: () => ({ phase: PHASE_READY }) }
  publisher.attach(registry)
  assert.equal(publisher.enabled, true)
  assert.equal(publisher.publish(session, creatingState({ repoRoot: '/r', workspaceRoot: '/r', mode: 'detached' })), true)
  assert.equal(appended.length, 1)
  assert.equal(appended[0].type, EVENT_TYPE)
  assert.equal(appended[0].data.state.phase, PHASE_CREATING)
  assert.deepEqual(publisher.stateOf(session), { phase: PHASE_READY })

  assert.equal(publisher.clear(session), true)
  assert.equal(appended.at(-1).data.state, null)

  publisher.detach()
  assert.equal(publisher.publish(session, null), false)
})

test('the publisher resolves live sessions by id and warns on append failure', () => {
  const events = []
  const session = { append: (type, data) => events.push({ type, data }) }
  const ctx = {
    logger: { warn: () => undefined },
    agents: { get: (id) => (id === 'live' ? { session } : undefined) },
  }
  const publisher = createProjectionPublisher({ ctx })
  publisher.attach({ stateOf: () => undefined })
  assert.equal(publisher.publishById('dead', null), false)
  assert.equal(publisher.publishById('live', null), true)
  assert.equal(events.length, 1)

  const broken = {
    append() {
      throw new Error('detached session')
    },
  }
  assert.equal(publisher.publish(broken, null), false)
  const warns = []
  const noisy = createProjectionPublisher({ ctx, log: (message) => warns.push(message) })
  noisy.attach({ stateOf: () => undefined })
  noisy.publish(broken, null)
  assert.match(warns[0], /could not publish worktree state/)
})

test('step builders publish progressively richer states', () => {
  const base = creatingState({ repoRoot: '/r', workspaceRoot: '/r', placement: 'worktree', mode: 'detached' })
  assert.equal(base.phase, PHASE_CREATING)
  assert.equal(base.step, STEP_PREPARE)
  assert.equal(base.path, null)
  assert.equal(base.baseCommit, null)
  const checkout = withStep(base, STEP_CHECKOUT, { path: '/p', baseCommit: 'abc' })
  assert.equal(checkout.phase, PHASE_CREATING)
  assert.equal(checkout.step, STEP_CHECKOUT)
  assert.equal(checkout.path, '/p')
  assert.equal(checkout.baseCommit, 'abc')
  const ready = readyState({ path: '/p', repoRoot: '/r', workspaceRoot: '/r', mode: 'detached', branch: null, baseCommit: 'abc' })
  assert.equal(ready.phase, PHASE_READY)
  assert.equal('step' in ready, false)
})
