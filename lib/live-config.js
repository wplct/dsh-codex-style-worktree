/**
 * Live (volatile) config support.
 *
 * DSH's Settings service can only edit fields a plugin declares with
 * `.volatile()`. Schemastery resolves such a field into a *reference*
 * (`{ get(), [symbol]: set }`, frozen) instead of a plain value, and the loader
 * commits a profile edit by mutating those references in place and emitting
 * `loader/volatile-update` on this plugin's fiber.
 *
 * The runtime wants one plain, mutable snapshot whose properties it reads at
 * call time (git timeouts, pool directory, placement default, …). This module
 * unwraps the references and keeps that snapshot in place, so a saved setting
 * takes effect on the next decision without re-mounting the plugin.
 *
 * Dependency-free on purpose: the plugin is copied into a DSH profile, so the
 * only importable things are Node builtins and what the profile already has.
 */

/**
 * Whether a resolved config value is a schemastery volatile reference.
 *
 * The reference protocol is `@deepseek-ai/cosmokit`'s `createVolatile`: a frozen
 * object carrying `get` plus exactly one symbol-keyed writer. Detecting it
 * structurally keeps this plugin free of a cosmokit dependency (and of the
 * version skew a second copy would bring).
 * @param {unknown} value resolved config value.
 * @returns {boolean}
 */
export function isVolatileRef(value) {
  if (value === null || typeof value !== 'object' || !Object.isFrozen(value)) return false
  if (typeof /** @type {any} */ (value).get !== 'function') return false
  return Object.getOwnPropertySymbols(value).length === 1
}

/**
 * Read one resolved config value, following a volatile reference when present.
 * @param {unknown} value resolved config value.
 */
export function readConfigValue(value) {
  return isVolatileRef(value) ? /** @type {any} */ (value).get() : value
}

/**
 * Turn a resolved Schemastery config (which may contain volatile references)
 * into a plain object of current values.
 * @param {Record<string, unknown>|undefined} resolved resolved loader config.
 * @returns {Record<string, unknown>}
 */
export function unwrapVolatileConfig(resolved) {
  const source = resolved !== null && typeof resolved === 'object' ? resolved : {}
  const plain = {}
  for (const [key, value] of Object.entries(source)) plain[key] = readConfigValue(value)
  return plain
}

/**
 * Build one mutable config snapshot and expose a refresh function.
 *
 * The returned `config` object keeps its identity for the whole plugin
 * lifetime: every consumer (`lib/git.js`, the runtime, the routes) holds that
 * reference and reads properties at call time, so mutating it in place is what
 * makes a saved setting live.
 *
 * @param {Record<string, unknown>|undefined} resolved resolved loader config.
 * @param {(plain: Record<string, unknown>) => object} resolve validates/normalizes the plain object.
 * @returns {{config: object, refresh: (resolved: Record<string, unknown>|undefined) => object, read: () => Record<string, unknown>}}
 */
export function createLiveConfig(resolved, resolve) {
  const config = resolve(unwrapVolatileConfig(resolved))
  return {
    config,
    /** Re-read the volatile references and overwrite the live snapshot in place. */
    refresh(nextResolved) {
      let next
      try {
        next = resolve(unwrapVolatileConfig(nextResolved))
      } catch {
        // A rejected candidate leaves the running snapshot untouched; the
        // loader has already logged and kept the previous references.
        return config
      }
      Object.assign(config, next)
      return config
    },
    /** Current plain values (tests and diagnostics). */
    read() {
      return { ...config }
    },
  }
}
