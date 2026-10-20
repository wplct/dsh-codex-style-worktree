/**
 * Settings bridge: the host half of the editable config page.
 *
 * DSH's Settings service is the only supported way for a plugin to persist a
 * live configuration edit: it validates against the plugin's Config schema,
 * writes the active profile's `cordis.patch.yml` through the configuration
 * editor, and applies volatile (`loader/volatile-update`) values without a
 * restart. The plugin never writes profile files itself.
 *
 * The service is optional (a headless composition or a profile-less boot has no
 * `settings`); every entry point degrades to `settings-unavailable` so the page
 * can fall back to read-only.
 */
import { EDITABLE_FIELDS, editableDefaults, resolveConfig } from './config.js'
import { SETTINGS_NS } from './constants.js'
import { errorText, getService } from './util.js'

/** Stable machine codes the route layer passes to the client. */
export const SETTINGS_UNAVAILABLE = 'settings-unavailable'
export const SETTINGS_CONFLICT = 'conflict'
export const SETTINGS_INVALID = 'invalid-config'

/** Editable field keys, in form order. */
export const EDITABLE_KEYS = EDITABLE_FIELDS.map((field) => field.key)

/** Build a structured settings failure. */
function settingsError(code, message, details) {
  const error = new Error(message)
  error.code = code
  if (details !== undefined) error.details = details
  return error
}

/** Pick only the editable fields out of one service value object. */
function pickEditable(value) {
  const source = value !== null && typeof value === 'object' ? value : {}
  const picked = {}
  for (const key of EDITABLE_KEYS) {
    if (Object.hasOwn(source, key) && source[key] !== undefined) picked[key] = source[key]
  }
  return picked
}

/**
 * @param {object} options
 * @param {object} options.ctx plugin context.
 * @param {object} options.config live resolved config (diagnostics fallback).
 */
export function createSettingsApi({ ctx, config }) {
  /** The Settings service, or undefined when the composition lacks one. */
  function service() {
    const value = getService(ctx, 'settings')
    if (value === undefined || typeof value.describe !== 'function') return undefined
    return value
  }

  function requireService() {
    const found = service()
    if (found === undefined) {
      throw settingsError(SETTINGS_UNAVAILABLE, 'the settings service is not available in this composition')
    }
    return found
  }

  /** The descriptor for this plugin's profile entry, or undefined. */
  function describeEntry(svc) {
    const descriptors = svc.describe()
    if (!Array.isArray(descriptors)) return undefined
    return descriptors.find((row) => row !== null && typeof row === 'object' && row.ns === SETTINGS_NS)
  }

  /** Public form payload: values, defaults, controls and the current revision. */
  function form(descriptor) {
    return {
      ns: SETTINGS_NS,
      revision: typeof descriptor?.revision === 'number' ? descriptor.revision : 0,
      writable: true,
      values: pickEditable(descriptor?.value),
      defaults: editableDefaults(),
      fields: EDITABLE_FIELDS,
    }
  }

  function current() {
    const svc = requireService()
    let descriptor
    try {
      descriptor = describeEntry(svc)
    } catch (error) {
      throw settingsError(SETTINGS_UNAVAILABLE, `cannot read settings: ${errorText(error)}`)
    }
    if (descriptor === undefined) {
      // The entry is not editable: either this profile row is missing, the
      // plugin is not active on a uniquely addressed entry, or the composition
      // has no profile context.
      throw settingsError(SETTINGS_UNAVAILABLE, 'this profile exposes no editable entry for dsh-codex-worktree')
    }
    return form(descriptor)
  }

  /**
   * Validate one patch against the plugin's own config rules before it reaches
   * the profile: the Settings service validates the schema, this enforces the
   * cross-field/path rules the schema cannot express.
   */
  function validatePatch(base, patch) {
    if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) {
      throw settingsError(SETTINGS_INVALID, 'patch must be an object')
    }
    for (const key of Object.keys(patch)) {
      if (!EDITABLE_KEYS.includes(key)) {
        throw settingsError(SETTINGS_INVALID, `unknown or non-editable field: ${key}`)
      }
    }
    let resolved
    try {
      resolved = resolveConfig({ ...base, ...patch })
    } catch (error) {
      throw settingsError(SETTINGS_INVALID, errorText(error))
    }
    return resolved
  }

  /** Map one thrown service failure onto a public code. */
  function translate(error) {
    if (error?.code === 'SETTINGS_CONFLICT' || error?.name === 'SettingsConflictError') {
      const details = { expected: error.expected, actual: error.actual }
      throw settingsError(SETTINGS_CONFLICT, 'configuration was changed elsewhere; reload the form', details)
    }
    if (typeof error?.code === 'string' && error.code.startsWith('SETTINGS_')) {
      throw settingsError(error.code.toLowerCase().replace(/_/g, '-'), errorText(error))
    }
    throw error
  }

  async function write(patch, revision) {
    const svc = requireService()
    let descriptor
    try {
      descriptor = describeEntry(svc)
    } catch (error) {
      throw settingsError(SETTINGS_UNAVAILABLE, `cannot read settings: ${errorText(error)}`)
    }
    if (descriptor === undefined) {
      throw settingsError(SETTINGS_UNAVAILABLE, 'this profile exposes no editable entry for dsh-codex-worktree')
    }
    const base = pickEditable(descriptor.value)
    validatePatch(base, patch)
    const expected = typeof revision === 'number' ? revision : descriptor.revision
    try {
      await svc.update(SETTINGS_NS, patch, expected)
    } catch (error) {
      translate(error)
    }
    return current()
  }

  return {
    /** Whether the composition can persist config edits at all. */
    get available() {
      return service() !== undefined
    },

    /** `settings {action:'get'}` */
    async get() {
      return current()
    },

    /**
     * `settings {action:'set', patch, revision}`
     * @param {{patch: object, revision?: number}} input
     */
    async set({ patch, revision } = {}) {
      return write(patch, revision)
    },

    /**
     * `settings {action:'reset', revision}` — write every editable field back to
     * its schema default (the profile row then keeps no user override).
     * @param {{revision?: number}} input
     */
    async reset({ revision } = {}) {
      return write(editableDefaults(), revision)
    },

    /** Plain diagnostics for the log line. */
    summary() {
      return { available: service() !== undefined, ns: SETTINGS_NS, config: config?.enabled === false ? 'disabled' : 'enabled' }
    },
  }
}
