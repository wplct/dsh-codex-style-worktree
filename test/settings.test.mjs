import test from 'node:test'
import assert from 'node:assert/strict'
import { createSettingsApi, EDITABLE_KEYS } from '../lib/settings.js'
import { editableDefaults, resolveConfig } from '../lib/config.js'
import { SETTINGS_NS } from '../lib/constants.js'

/** A Settings-service double with revisions, validation hand-off and conflict errors. */
function createFakeSettings(options = {}) {
  const values = { ...editableDefaults(), ...(options.values ?? {}) }
  const calls = { update: [], describe: 0 }
  let revision = options.revision ?? 7
  const service = {
    describe() {
      calls.describe += 1
      return [
        { ns: 'some-other-plugin', revision: 1, value: { x: 1 } },
        { ns: SETTINGS_NS, revision, value: { ...values }, writable: true },
      ]
    },
    async update(ns, patch, expectedRevision) {
      calls.update.push({ ns, patch: { ...patch }, expectedRevision })
      if (options.onUpdate !== undefined) return options.onUpdate({ ns, patch, expectedRevision, bump })
      assert.equal(ns, SETTINGS_NS)
      if (expectedRevision !== revision) {
        const error = new Error('revision mismatch')
        error.code = 'SETTINGS_CONFLICT'
        error.expected = expectedRevision
        error.actual = revision
        throw error
      }
      // Validate the candidate the way the real service would.
      resolveConfig({ ...values, ...patch })
      Object.assign(values, patch)
      bump()
      return { ns, revision }
    },
  }
  function bump() {
    revision += 1
  }
  return { service, calls, values, bump, get revision() { return revision } }
}

test('get returns the form shape for this plugin entry only', async () => {
  const fake = createFakeSettings()
  const api = createSettingsApi({ ctx: { settings: fake.service }, config: resolveConfig({}) })
  const form = await api.get()
  assert.equal(form.ns, SETTINGS_NS)
  assert.equal(form.revision, 7)
  assert.equal(form.writable, true)
  assert.deepEqual(Object.keys(form.values).sort(), [...EDITABLE_KEYS].sort())
  assert.deepEqual(form.defaults, editableDefaults())
  assert.deepEqual(form.fields.map((field) => field.key), EDITABLE_KEYS)
  assert.equal(form.fields.find((field) => field.key === 'mode').type, 'select')
  assert.deepEqual(form.fields.find((field) => field.key === 'mode').options, ['detached', 'branch'])
  assert.equal(form.fields.find((field) => field.key === 'skipSessionIdPatterns').type, 'lines')
  assert.equal(api.available, true)
})

test('set merges the patch, passes the revision and returns the new form', async () => {
  const fake = createFakeSettings()
  const api = createSettingsApi({ ctx: { settings: fake.service }, config: resolveConfig({}) })
  const form = await api.set({ patch: { enabled: false, autoPruneKeep: 4 }, revision: 7 })
  assert.deepEqual(fake.calls.update[0], { ns: SETTINGS_NS, patch: { enabled: false, autoPruneKeep: 4 }, expectedRevision: 7 })
  assert.equal(form.revision, 8)
  assert.equal(form.values.enabled, false)
  assert.equal(form.values.autoPruneKeep, 4)
})

test('a stale revision surfaces as a conflict with both revisions', async () => {
  const fake = createFakeSettings()
  fake.bump()
  const api = createSettingsApi({ ctx: { settings: fake.service }, config: resolveConfig({}) })
  await assert.rejects(() => api.set({ patch: { enabled: false }, revision: 7 }), (error) => {
    assert.equal(error.code, 'conflict')
    assert.equal(error.details.expected, 7)
    assert.equal(error.details.actual, 8)
    assert.match(error.message, /changed elsewhere/)
    return true
  })
})

test('invalid patches never reach the settings service', async () => {
  const fake = createFakeSettings()
  const api = createSettingsApi({ ctx: { settings: fake.service }, config: resolveConfig({}) })
  await assert.rejects(() => api.set({ patch: { nope: 1 }, revision: 7 }), (error) => error.code === 'invalid-config')
  await assert.rejects(() => api.set({ patch: { directory: '/absolute' }, revision: 7 }), (error) => {
    assert.equal(error.code, 'invalid-config')
    assert.match(error.message, /relative/)
    return true
  })
  await assert.rejects(() => api.set({ patch: { mode: 'weird' }, revision: 7 }), (error) => error.code === 'invalid-config')
  await assert.rejects(() => api.set({ patch: 'nope', revision: 7 }), (error) => error.code === 'invalid-config')
  await assert.rejects(() => api.set({ patch: [1, 2], revision: 7 }), (error) => error.code === 'invalid-config')
  assert.equal(fake.calls.update.length, 0)
})

test('reset writes every editable default', async () => {
  const fake = createFakeSettings({ values: { enabled: false, defaultPlacement: 'local', maxPerRepo: 2 } })
  const api = createSettingsApi({ ctx: { settings: fake.service }, config: resolveConfig({}) })
  const form = await api.reset({ revision: 7 })
  assert.deepEqual(fake.calls.update[0].patch, editableDefaults())
  assert.equal(form.values.enabled, true)
  assert.equal(form.values.defaultPlacement, 'worktree')
  assert.equal(form.values.maxPerRepo, 32)
})

test('a composition without settings degrades to settings-unavailable', async () => {
  const api = createSettingsApi({ ctx: {}, config: resolveConfig({}) })
  assert.equal(api.available, false)
  for (const call of [() => api.get(), () => api.set({ patch: { enabled: false }, revision: 0 }), () => api.reset({})]) {
    await assert.rejects(call, (error) => {
      assert.equal(error.code, 'settings-unavailable')
      return true
    })
  }
})

test('a profile without an editable entry is unavailable instead of throwing raw errors', async () => {
  const service = { describe: () => [{ ns: 'other', revision: 1, value: {} }], update: async () => undefined }
  const api = createSettingsApi({ ctx: { settings: service }, config: resolveConfig({}) })
  await assert.rejects(() => api.get(), (error) => error.code === 'settings-unavailable')
  await assert.rejects(() => api.set({ patch: { enabled: false }, revision: 1 }), (error) => error.code === 'settings-unavailable')
  const throwing = {
    describe() {
      throw new Error('loader not settled')
    },
    update: async () => undefined,
  }
  const broken = createSettingsApi({ ctx: { settings: throwing }, config: resolveConfig({}) })
  await assert.rejects(() => broken.get(), (error) => error.code === 'settings-unavailable')
})
