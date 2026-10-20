import test from 'node:test'
import assert from 'node:assert/strict'
import { createLiveConfig, isVolatileRef, readConfigValue, unwrapVolatileConfig } from '../lib/live-config.js'
import { resolveConfig } from '../lib/config.js'

/** Build a frozen volatile reference shaped like @deepseek-ai/cosmokit's createVolatile. */
function makeRef(initial) {
  let current = initial
  const write = Symbol('write')
  return Object.freeze({
    get: () => current,
    [write]: (value) => {
      current = value
    },
  })
}

test('volatile references are detected structurally, plain values are not', () => {
  const ref = makeRef(true)
  assert.equal(isVolatileRef(ref), true)
  assert.equal(readConfigValue(ref), true)
  assert.equal(isVolatileRef(true), false)
  assert.equal(isVolatileRef(null), false)
  assert.equal(isVolatileRef(['a']), false)
  // A frozen object without `get` is a plain value, not a reference.
  assert.equal(isVolatileRef(Object.freeze({ value: 1 })), false)
  // A mutable object with `get` is not the protocol either (the protocol freezes).
  assert.equal(isVolatileRef({ get: () => 1 }), false)
  assert.equal(readConfigValue('plain'), 'plain')
})

test('unwrapVolatileConfig reads every reference', () => {
  const plain = unwrapVolatileConfig({
    enabled: makeRef(false),
    directory: makeRef('.agents/wt'),
    gitTimeoutMs: 1234,
    skipSessionIdPatterns: makeRef(['^x-']),
  })
  assert.deepEqual(plain, {
    enabled: false,
    directory: '.agents/wt',
    gitTimeoutMs: 1234,
    skipSessionIdPatterns: ['^x-'],
  })
  assert.deepEqual(unwrapVolatileConfig(undefined), {})
})

test('a live config snapshot keeps its identity and picks up committed references', () => {
  const enabled = makeRef(true)
  const directory = makeRef('.agents/worktrees')
  const autoPruneKeep = makeRef(15)
  const resolved = { enabled, directory, autoPruneKeep }
  const live = createLiveConfig(resolved, resolveConfig)
  assert.equal(live.config.enabled, true)
  assert.equal(live.config.autoPruneKeep, 15)
  const identity = live.config

  // The loader mutates the references in place, then emits loader/volatile-update.
  enabled[Object.getOwnPropertySymbols(enabled)[0]](false)
  directory[Object.getOwnPropertySymbols(directory)[0]]('.other/pool')
  autoPruneKeep[Object.getOwnPropertySymbols(autoPruneKeep)[0]](3)

  const refreshed = live.refresh(resolved)
  assert.equal(refreshed, identity, 'same object identity for the runtime')
  assert.equal(live.config.enabled, false)
  assert.equal(live.config.directory, '.other/pool')
  assert.equal(live.config.autoPruneKeep, 3)
  // Everything not mentioned keeps its value.
  assert.equal(live.config.mode, 'detached')
  assert.equal(live.config.gitTimeoutMs, 20000)
})

test('an invalid candidate leaves the running snapshot untouched', () => {
  const live = createLiveConfig({ directory: makeRef('.agents/worktrees') }, resolveConfig)
  live.refresh({ directory: makeRef('/absolute/is/not/allowed') })
  assert.equal(live.config.directory, '.agents/worktrees')
  live.refresh({ directory: makeRef(''), mode: makeRef('weird') })
  assert.equal(live.config.directory, '.agents/worktrees')
  assert.equal(live.config.mode, 'detached')
})

test('read returns a detached plain snapshot', () => {
  const live = createLiveConfig({ enabled: makeRef(true) }, resolveConfig)
  const snapshot = live.read()
  snapshot.enabled = false
  assert.equal(live.config.enabled, true)
})
