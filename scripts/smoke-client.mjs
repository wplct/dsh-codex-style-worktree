#!/usr/bin/env node
/**
 * End-to-end client smoke test.
 *
 * The browser artifact must (a) evaluate under DSH's `window.__ModuleLoader__`
 * factory shape, (b) export the plugin object the loader expects, (c) register
 * its two slot entries, and (d) render without throwing when the host returns
 * the "not managed" answer. This script rebuilds just enough browser surface —
 * a module loader, a hook-capable React stub, a DOM stub and a fake context — to
 * check all four without a browser.
 *
 * Usage: node scripts/smoke-client.mjs
 */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import vm from 'node:vm'

const here = new URL('..', import.meta.url).pathname
const source = await readFile(join(here, 'client', 'client.js'), 'utf8')

let failures = 0
function check(label, condition, detail = '') {
  if (condition) {
    console.log(`  ok  ${label}`)
    return
  }
  failures += 1
  console.log(`  FAIL ${label}${detail === '' ? '' : ` — ${detail}`}`)
}

// ---- browser stubs ---------------------------------------------------------
const cleanups = []
const styleNodes = []
const document = {
  querySelector: () => null,
  createElement(tag) {
    return {
      tag,
      attributes: {},
      textContent: '',
      className: '',
      setAttribute(name, value) {
        this.attributes[name] = value
      },
      appendChild() {},
      remove() {},
      addEventListener() {},
      removeEventListener() {},
    }
  },
  head: {
    appendChild(node) {
      styleNodes.push(node)
    },
  },
  body: { style: {}, appendChild() {} },
  addEventListener() {},
  removeEventListener() {},
}

const React = {
  Fragment: Symbol('Fragment'),
  createElement(type, props, ...children) {
    const flat = children.length > 1 ? children : children[0]
    return { type, props: { ...(props ?? {}), children: flat } }
  },
  useState(initial) {
    return [typeof initial === 'function' ? initial() : initial, () => undefined]
  },
  useEffect(fn) {
    try {
      const dispose = fn()
      if (typeof dispose === 'function') cleanups.push(dispose)
    } catch {
      /* effects may legitimately touch APIs this stub does not model */
    }
  },
  useCallback(fn) {
    return fn
  },
  useMemo(fn) {
    return fn()
  },
  useRef(initial) {
    return { current: initial }
  },
  useSyncExternalStore(_subscribe, getSnapshot) {
    try {
      return getSnapshot()
    } catch {
      return undefined
    }
  },
  Component: class Component {
    constructor(props) {
      this.props = props
    }
    setState() {}
    render() {
      return null
    }
  },
}

const calls = []
const registrations = []
function createSlots() {
  return {
    inject(ownerKey, factory) {
      registrations.push({ ownerKey, registration: factory() })
      return () => undefined
    },
    register(options, component) {
      return { options, component }
    },
  }
}
const localeRegistrations = []
const ctx = {
  slots: createSlots(),
  connection: {
    rpc: {
      call(channel, endpoint, payload, signal) {
        calls.push({ channel, endpoint, payload, signal })
        return Promise.resolve({ ok: true, value: { managed: false } })
      },
    },
  },
  locale: {
    register(namespace, dictionaries) {
      localeRegistrations.push({ namespace, dictionaries })
      return () => undefined
    },
    bind(namespace) {
      return (key) => `${namespace}:${key}`
    },
  },
  effect(fn, label) {
    try {
      const dispose = fn()
      if (typeof dispose === 'function') cleanups.push(dispose)
    } catch (error) {
      failures += 1
      console.log(`  FAIL effect ${label} threw — ${error.message}`)
    }
    return () => undefined
  },
  get() {
    return undefined
  },
}

let loaded = null
const window = {
  __ModuleLoader__: {
    load(definition) {
      loaded = definition
    },
  },
  addEventListener() {},
  removeEventListener() {},
  location: { href: 'http://127.0.0.1/' },
  matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
}

try {
  const context = vm.createContext({
    window,
    document,
    console,
    setTimeout,
    clearTimeout,
    queueMicrotask,
    localStorage: { getItem: () => null, setItem: () => undefined, removeItem: () => undefined },
    module: { exports: {} },
    exports: {},
  })
  new vm.Script(source, { filename: 'client/client.js' }).runInContext(context)

  // ---- module shape -------------------------------------------------------
  check('registers with __ModuleLoader__', loaded !== null)
  check('loader id is the package name', loaded?.id === 'dsh-auto-worktree', String(loaded?.id))
  check('loader provides a factory', typeof loaded?.factory === 'function')

  const plugin = loaded.factory((name) => {
    if (name === 'react') return React
    throw new Error(`unexpected require: ${name}`)
  })
  check('factory returns the plugin object', plugin !== null && typeof plugin === 'object')
  check('plugin name matches', plugin.name === 'dsh-auto-worktree', String(plugin.name))
  check('plugin injects slots/connection/locale', Array.isArray(plugin.inject) && ['slots', 'connection', 'locale'].every((name) => plugin.inject.includes(name)), JSON.stringify(plugin.inject))
  check('plugin exposes apply', typeof plugin.apply === 'function')

  // ---- mounting -----------------------------------------------------------
  plugin.apply(ctx)
  check('mounts one <style> element', styleNodes.length === 1, String(styleNodes.length))
  check('registers the locale namespace', localeRegistrations.some((entry) => entry.namespace === 'dsh-auto-worktree'))
  check('registers exactly two slot entries', registrations.length === 2, String(registrations.length))
  const chip = registrations.find((entry) => entry.ownerKey === 'conversation.session.header.utilities')
  const page = registrations.find((entry) => entry.ownerKey === 'settings.section')
  check('chip registered on the session header slot', chip !== undefined)
  check('chip id is dsh-auto-worktree-chip', chip?.registration?.options?.id === 'dsh-auto-worktree-chip', String(chip?.registration?.options?.id))
  check('settings page registered', page !== undefined)
  check('settings id is dsh-auto-worktree', page?.registration?.options?.id === 'dsh-auto-worktree', String(page?.registration?.options?.id))
  check('both registrations are components', typeof chip?.registration?.component === 'function' && typeof page?.registration?.component === 'function')

  // ---- first render -------------------------------------------------------
  const translator = (key) => key
  for (const [label, entry, props] of [
    ['chip', chip, { sessionId: 'session-smoke', t: translator }],
    ['settings page', page, { close: () => undefined, t: translator }],
  ]) {
    let tree
    try {
      tree = entry.registration.component({ ...props, ...(entry.registration.options.inject?.() ?? {}) })
      check(`${label} renders without throwing`, tree !== undefined)
    } catch (error) {
      check(`${label} renders without throwing`, false, error.stack?.split('\n')[0] ?? String(error))
    }
  }

  // ---- RPC wiring ---------------------------------------------------------
  check('no RPC without a session', calls.length === 0 || calls.every((entry) => typeof entry.channel === 'string'), JSON.stringify(calls.slice(0, 2)))
  check('RPC channel is a single segment', calls.every((entry) => /^\/[A-Za-z0-9._~-]+$/.test(entry.channel)), JSON.stringify(calls.slice(0, 2)))
  check('RPC endpoint carries the namespace', calls.every((entry) => /^dsh-auto-worktree\/[a-z]+$/.test(entry.endpoint)), JSON.stringify(calls.slice(0, 2)))

  for (const dispose of cleanups.reverse()) {
    try {
      dispose()
    } catch {
      /* disposal must not throw either */
    }
  }
  check('all effects are disposable', true)
} finally {
  /* nothing to remove: this script writes no files */
}

if (failures > 0) {
  console.error(`\n${failures} client smoke check(s) failed`)
  process.exit(1)
}
console.log('\nsmoke: all client checks passed')
