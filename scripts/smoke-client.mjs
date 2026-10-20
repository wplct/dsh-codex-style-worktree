#!/usr/bin/env node
/**
 * End-to-end client smoke test for dsh-codex-worktree 0.3.0.
 *
 * The browser artifact must evaluate under DSH's `window.__ModuleLoader__` factory
 * shape, register the five 0.3.0 slot entries, and behave correctly in the
 * event-driven model (Session projections, no polling). This script rebuilds just
 * enough browser surface to check that without a browser:
 *   - a module loader + style/document stub,
 *   - a hook-capable mini React renderer (state, effects, class boundary),
 *   - a fake clock (setTimeout only — the client must not use setInterval),
 *   - fake `connection.rpc`, `locale`, `sessions` (projection snapshot) and
 *     `workspaces` services.
 *
 * Covered assertions (spec §10.4): five slot ids/orders; placement both states and
 * the non-Git hidden state; the progress-card state machine with a fake clock
 * (steps, ≥1s minimum, cancel, error); the sidebar marker (ready → icon,
 * null → nothing, not clickable); settings save/conflict/reset payloads; the RPC
 * namespace; and "no setInterval" in the source.
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

/* ================================================================== *
 * Fake clock (setTimeout only; the client must not use setInterval)   *
 * ================================================================== */
let clock = 0
let timerSeq = 0
const timers = []
function fakeSetTimeout(callback, delay) {
  const id = ++timerSeq
  timers.push({ id, at: clock + Math.max(0, Number(delay) || 0), callback })
  return id
}
function fakeClearTimeout(id) {
  const index = timers.findIndex((timer) => timer.id === id)
  if (index !== -1) timers.splice(index, 1)
}
function advance(ms) {
  const target = clock + ms
  for (;;) {
    const due = timers
      .filter((timer) => timer.at <= target)
      .sort((left, right) => left.at - right.at)[0]
    if (!due) break
    timers.splice(timers.indexOf(due), 1)
    clock = due.at
    try {
      due.callback()
    } catch (error) {
      failures += 1
      console.log(`  FAIL timer callback threw — ${error.message}`)
    }
  }
  clock = target
}

/* ================================================================== *
 * Browser stubs                                                       *
 * ================================================================== */
const styleNodes = []
const documentListeners = []
const document = {
  querySelector: (selector) =>
    selector.indexOf('style[') === 0
      ? styleNodes.find((node) => Object.prototype.hasOwnProperty.call(node.attributes, selector.slice(6, -1))) || null
      : null,
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
    removeChild(node) {
      const index = styleNodes.indexOf(node)
      if (index !== -1) styleNodes.splice(index, 1)
    },
  },
  body: { style: {}, appendChild() {} },
  addEventListener(type, handler) {
    documentListeners.push({ type, handler })
  },
  removeEventListener(type, handler) {
    const index = documentListeners.findIndex((entry) => entry.type === type && entry.handler === handler)
    if (index !== -1) documentListeners.splice(index, 1)
  },
  documentElement: { style: { setProperty() {} } },
}

/* ================================================================== *
 * Mini React renderer (state + effects + class boundary)              *
 * ================================================================== */
const Fragment = Symbol.for('react.fragment')
const instances = new Map()
let scope = 'default'
let current = null
let dirty = false

class Component {
  constructor(props) {
    this.props = props
    this.state = {}
  }
  setState(next) {
    this.state = Object.assign({}, this.state, typeof next === 'function' ? next(this.state) : next)
    dirty = true
  }
}

function createElement(type, props) {
  const children = Array.prototype.slice.call(arguments, 2)
  const merged = Object.assign({}, props || {})
  const flat = []
  for (const child of children) {
    if (Array.isArray(child)) flat.push.apply(flat, child)
    else flat.push(child)
  }
  if (flat.length === 1) merged.children = flat[0]
  else if (flat.length > 1) merged.children = flat
  return { $$el: true, type, props: merged }
}
const h = createElement

function getInstance(key) {
  const scoped = `${scope}|${key}`
  let instance = instances.get(scoped)
  if (!instance) {
    instance = { key: scoped, hooks: [], index: 0, effects: [] }
    instances.set(scoped, instance)
  }
  return instance
}

function depsChanged(previous, next) {
  if (!previous || !next || previous.length !== next.length) return true
  for (let index = 0; index < next.length; index += 1) if (!Object.is(previous[index], next[index])) return true
  return false
}

function useState(initial) {
  const instance = current
  const index = instance.index++
  if (!instance.hooks[index]) instance.hooks[index] = { value: typeof initial === 'function' ? initial() : initial }
  const hook = instance.hooks[index]
  if (!hook.setter) {
    hook.setter = (next) => {
      const value = typeof next === 'function' ? next(hook.value) : next
      if (Object.is(value, hook.value)) return
      hook.value = value
      dirty = true
    }
  }
  return [hook.value, hook.setter]
}

function useEffect(callback, deps) {
  const instance = current
  const index = instance.index++
  const hook = instance.hooks[index] || { deps: undefined, cleanup: undefined }
  instance.hooks[index] = hook
  if (!depsChanged(hook.deps, deps)) return
  hook.deps = deps ? deps.slice() : undefined
  instance.effects.push(() => {
    if (typeof hook.cleanup === 'function') hook.cleanup()
    const cleanup = callback()
    hook.cleanup = typeof cleanup === 'function' ? cleanup : undefined
  })
}

function useRef(initial) {
  const instance = current
  const index = instance.index++
  if (!instance.hooks[index]) instance.hooks[index] = { current: initial }
  return instance.hooks[index]
}

function useCallback(callback, deps) {
  const instance = current
  const index = instance.index++
  const hook = instance.hooks[index] || {}
  instance.hooks[index] = hook
  if (depsChanged(hook.deps, deps)) {
    hook.deps = deps ? deps.slice() : undefined
    hook.value = callback
  }
  return hook.value
}

function useSyncExternalStore(subscribe, getSnapshot) {
  const instance = current
  const index = instance.index++
  const hook = instance.hooks[index] || { value: undefined, unsubscribe: undefined }
  instance.hooks[index] = hook
  hook.value = getSnapshot()
  if (!hook.unsubscribe) {
    try {
      hook.unsubscribe = subscribe(() => {
        dirty = true
      })
    } catch {
      hook.unsubscribe = () => {}
    }
  }
  return hook.value
}

const React = {
  createElement,
  Fragment,
  Component,
  useState,
  useEffect,
  useRef,
  useCallback,
  useSyncExternalStore,
}

function renderNode(node, key) {
  if (node === null || node === undefined || node === false || node === true) return null
  if (Array.isArray(node)) {
    const out = []
    for (let index = 0; index < node.length; index += 1) out.push(renderNode(node[index], `${key}.${index}`))
    return out.filter(Boolean)
  }
  if (typeof node === 'string' || typeof node === 'number') return { text: String(node) }
  if (!node.$$el) throw new Error(`not an element: ${String(node)}`)
  const type = node.type
  const props = node.props || {}
  if (type === Fragment) return renderNode(props.children, `${key}.f`)
  if (typeof type === 'function') {
    if (type.prototype && type.prototype.render) {
      const scoped = `${scope}|${key}`
      const instance = instances.get(scoped) || new type(props)
      instances.set(scoped, instance)
      instance.props = props
      return renderNode(instance.render(), `${key}.r`)
    }
    const instance = getInstance(key)
    const previous = current
    current = instance
    instance.index = 0
    instance.effects = []
    let output
    try {
      output = type(props)
    } finally {
      current = previous
    }
    for (const effect of instance.effects) effect()
    return renderNode(output, `${key}.o`)
  }
  const children = Array.isArray(props.children) ? props.children : [props.children]
  const rendered = []
  for (let index = 0; index < children.length; index += 1) rendered.push(renderNode(children[index], `${key}.${index}`))
  return { type, props, children: rendered.filter(Boolean) }
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

async function mount(node, scopeName) {
  const previousScope = scope
  scope = scopeName || 'default'
  try {
    let tree = null
    for (let index = 0; index < 80; index += 1) {
      dirty = false
      tree = renderNode(node, 'root')
      await flush()
      if (!dirty) return tree
    }
    throw new Error('render loop did not settle')
  } finally {
    scope = previousScope
  }
}

function walk(tree, visit) {
  if (!tree) return
  if (Array.isArray(tree)) {
    tree.forEach((node) => walk(node, visit))
    return
  }
  if (typeof tree !== 'object') return
  if (tree.type) {
    visit(tree)
    walk(tree.children, visit)
  }
}

function textOf(tree) {
  if (tree === null || tree === undefined) return ''
  if (typeof tree === 'string') return tree
  if (Array.isArray(tree)) return tree.map(textOf).join('')
  if (tree.text !== undefined) return tree.text
  if (tree.children) return tree.children.map(textOf).join('')
  if (tree.props && tree.props.children !== undefined) return textOf(tree.props.children)
  return ''
}

function findAll(tree, predicate) {
  const out = []
  walk(tree, (node) => {
    if (predicate(node)) out.push(node)
  })
  return out
}

function buttons(tree) {
  return findAll(tree, (node) => node.type === 'button')
}

function byText(tree, needle) {
  return buttons(tree).find((button) => textOf(button).indexOf(needle) !== -1) || null
}

/* ================================================================== *
 * Fake host services                                                  *
 * ================================================================== */
const calls = []
let handler = defaultHandler

const localeRegistrations = []
const locale = {
  register(namespace, dictionaries) {
    localeRegistrations.push({ namespace, dictionaries })
    return () => {}
  },
  bind() {
    return (key, params) => {
      const dict = localeRegistrations.length > 0 ? localeRegistrations[0].dictionaries.en : {}
      let text = dict[key]
      if (text === undefined) return key
      if (params) text = text.replace(/\{(\w+)\}/g, (match, name) => (params[name] === undefined ? match : String(params[name])))
      return text
    }
  },
  getSnapshot() {
    return { active: 'en', locales: ['en', 'zh'], revision: 1 }
  },
  subscribe() {
    return () => {}
  },
}

const sessions = {
  byId: {},
  listeners: new Set(),
  list: {
    getSnapshot() {
      return { byId: sessions.byId, ids: Object.keys(sessions.byId) }
    },
    subscribe(listener) {
      sessions.listeners.add(listener)
      return () => sessions.listeners.delete(listener)
    },
  },
}

function setProjection(sessionId, value) {
  const previous = sessions.byId[sessionId] || { id: sessionId }
  sessions.byId[sessionId] = Object.assign({}, previous, {
    id: sessionId,
    projectionValues: Object.assign({}, previous.projectionValues || {}, { codexWorktree: value }),
  })
  for (const listener of [...sessions.listeners]) listener()
}

const workspaces = {
  list: {
    getSnapshot() {
      return {
        items: [
          { workspaceId: 'ws-1', path: '/repo', title: 'repo', sessionIds: ['s1'] },
          { workspaceId: 'ws-2', path: '/repo2', title: 'repo2', sessionIds: [] },
          { workspaceId: 'ws-3', path: '/repo-fail', title: 'repo-fail', sessionIds: [] },
          { workspaceId: 'ws-4', path: '/repo-local', title: 'repo-local', sessionIds: [] },
          { workspaceId: 'ws-5', path: '/repo-ws', title: 'repo-ws', sessionIds: ['s-placement-workspace'] },
        ],
      }
    },
  },
}

const registrations = []
const effects = []
const slots = {
  inject(ownerKey, factory) {
    return factory()
  },
  register(options, component) {
    const entry = { options, component }
    registrations.push(entry)
    return entry
  },
}

const ctx = {
  connection: {
    rpc: {
      call(channel, endpoint, payload, signal) {
        calls.push({ channel, endpoint, payload, signal })
        return Promise.resolve(handler(endpoint, payload))
      },
    },
  },
  locale,
  sessions,
  workspaces,
  slots,
  effect(factory, label) {
    try {
      const dispose = factory()
      if (typeof dispose === 'function') effects.push({ label, dispose })
    } catch (error) {
      failures += 1
      console.log(`  FAIL effect ${label} threw — ${error.message}`)
    }
    return () => {}
  },
  get(name) {
    if (name === 'connection') return ctx.connection
    if (name === 'locale') return locale
    if (name === 'slots') return slots
    if (name === 'sessions') return sessions
    if (name === 'workspaces') return workspaces
    return undefined
  },
}

/* ---------------- fake RPC responses ---------------- */
const settingsFields = [
  { key: 'enabled', type: 'boolean' },
  { key: 'defaultPlacement', type: 'select', options: [{ value: 'worktree' }, { value: 'local' }] },
  { key: 'directory', type: 'text' },
  { key: 'autoPruneKeep', type: 'number', min: 0 },
  { key: 'skipPresets', type: 'lines' },
  { key: 'mode', type: 'select', options: [{ value: 'detached' }, { value: 'branch' }] },
  { key: 'namePrefix', type: 'text' },
]
const settingsState = {
  revision: 2,
  values: {
    enabled: true,
    defaultPlacement: 'worktree',
    directory: '.agents/worktrees',
    autoPruneKeep: 15,
    skipPresets: ['^session-taskboard-'],
    mode: 'detached',
    namePrefix: 'wt-',
  },
}
function settingsDescriptor(overrideValues) {
  return {
    ns: 'codex-worktree',
    revision: settingsState.revision,
    writable: true,
    values: Object.assign({}, settingsState.values, overrideValues || {}),
    defaults: Object.assign({}, settingsState.values, { enabled: true, autoPruneKeep: 15 }),
    fields: settingsFields,
  }
}
function listValue() {
  return {
    repos: [
      {
        repoRoot: '/repo',
        records: [
          {
            sessionId: 's1',
            path: '/repo/.agents/worktrees/wt-abc',
            mode: 'detached',
            branch: null,
            baseCommit: 'abcdef1234',
            createdAt: '2026-10-20T10:00:00.000Z',
            dirty: 2,
          },
        ],
      },
    ],
    config: {},
  }
}
function defaultHandler(endpoint, payload) {
  if (endpoint === 'dsh-codex-worktree/placement') {
    const workspacePath = typeof payload.workspacePath === 'string' ? payload.workspacePath : '/repo'
    if (placementBehavior.respond) return placementBehavior.respond(workspacePath, payload.mode)
    return { ok: true, value: { workspacePath, mode: payload.mode || 'worktree', defaultMode: 'worktree', isGit: placementBehavior.isGit !== false } }
  }
  if (endpoint === 'dsh-codex-worktree/status') {
    return {
      ok: true,
      value: {
        managed: true,
        path: '/repo/.agents/worktrees/wt-abc',
        workspaceRoot: '/repo',
        repoRoot: '/repo',
        mode: 'detached',
        branch: null,
        baseCommit: 'abcdef1234',
        createdAt: '2026-10-20T10:00:00.000Z',
        dirty: 2,
      },
    }
  }
  if (endpoint === 'dsh-codex-worktree/list') return { ok: true, value: listValue() }
  if (endpoint === 'dsh-codex-worktree/prune') return { ok: true, value: { removed: [{ path: '/repo/x', sessionId: 's9' }], snapshots: [] } }
  if (endpoint === 'dsh-codex-worktree/clean') return { ok: true, value: { removed: true, path: '/repo/.agents/worktrees/wt-abc', branchDeleted: false } }
  if (endpoint === 'dsh-codex-worktree/settings') {
    if (payload.action === 'get') {
      if (settingsBehavior.getError) return { ok: false, error: settingsBehavior.getError }
      return { ok: true, value: settingsDescriptor() }
    }
    if (payload.action === 'set') {
      if (settingsBehavior.setError) {
        const error = settingsBehavior.setError
        settingsBehavior.setError = null
        return { ok: false, error }
      }
      settingsState.revision += 1
      settingsState.values = Object.assign({}, settingsState.values, payload.patch)
      return { ok: true, value: settingsDescriptor() }
    }
    if (payload.action === 'reset') {
      settingsState.revision += 1
      settingsState.values = Object.assign({}, settingsState.values, { enabled: true, autoPruneKeep: 15 })
      return { ok: true, value: settingsDescriptor() }
    }
  }
  return { ok: false, error: { code: 'bad-request', message: `unknown endpoint: ${endpoint}`, details: {} } }
}
const placementBehavior = { isGit: true, respond: null }
const settingsBehavior = { getError: null, setError: null }

/* ================================================================== *
 * Load the artifact                                                   *
 * ================================================================== */
let loaderDefinition = null
const window = {
  __ModuleLoader__: {
    load(definition) {
      loaderDefinition = definition
    },
  },
  addEventListener() {},
  removeEventListener() {},
  location: { href: 'http://127.0.0.1/' },
  matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
}

const context = vm.createContext({
  window,
  document,
  console,
  setTimeout: fakeSetTimeout,
  clearTimeout: fakeClearTimeout,
  queueMicrotask,
  AbortController,
  navigator: { language: 'en' },
  localStorage: { getItem: () => null, setItem: () => undefined, removeItem: () => undefined },
  module: { exports: {} },
  exports: {},
})
new vm.Script(source, { filename: 'client/client.js' }).runInContext(context)

const plugin = loaderDefinition.factory((specifier) => {
  if (specifier === 'react') return React
  throw new Error(`unexpected require: ${specifier}`)
})

function entryOf(slotName) {
  return registrations.find((entry) => entry.options.name === slotName)
}
function withInjected(entry, props) {
  const injected = entry.options.inject ? entry.options.inject() : {}
  return Object.assign({}, injected, props || {})
}
async function render(entry, props, scopeName) {
  return mount(h(entry.component, withInjected(entry, props)), scopeName)
}
function callsFor(endpoint) {
  return calls.filter((call) => call.endpoint === `dsh-codex-worktree/${endpoint}`)
}

async function main() {
  /* ---------------- module shape ---------------- */
  check('registers with __ModuleLoader__', loaderDefinition !== null)
  check('loader id is the package name', loaderDefinition?.id === 'dsh-codex-worktree', String(loaderDefinition?.id))
  check('factory returns the plugin object', plugin !== null && typeof plugin === 'object')
  check('plugin name matches', plugin.name === 'dsh-codex-worktree', String(plugin.name))
  check(
    'plugin injects slots/connection/locale/workspaces/sessions',
    Array.isArray(plugin.inject) && ['slots', 'connection', 'locale', 'workspaces', 'sessions'].every((name) => plugin.inject.includes(name)),
    JSON.stringify(plugin.inject),
  )
  check('plugin exposes apply', typeof plugin.apply === 'function')

  plugin.apply(ctx)

  check('mounts one <style> element', styleNodes.length === 1, String(styleNodes.length))
  check('style uses the renamed attribute', Boolean(styleNodes[0]?.attributes['data-dsh-codex-worktree-style'] !== undefined))
  check('locale namespace registered', localeRegistrations.some((entry) => entry.namespace === 'dsh-codex-worktree'))
  const dictionaries = localeRegistrations[0]?.dictionaries ?? {}
  check('zh dictionaries registered', Boolean(dictionaries.zh))
  check('en dictionaries registered', Boolean(dictionaries.en))
  for (const key of ['placement.worktree', 'placement.local', 'placement.hint', 'progress.title', 'progress.failed', 'marker.title', 'settings.save', 'settings.conflict']) {
    check(`locale key ${key} present in zh+en`, Boolean(dictionaries.zh?.[key] && dictionaries.en?.[key]))
  }

  /* ---------------- slot registrations ---------------- */
  const expectedSlots = [
    ['conversation.hero.options', 'dsh-codex-worktree-placement', 10],
    ['conversation.input.dock', 'dsh-codex-worktree-progress', 30],
    ['sidebar.session.row.leading', 'dsh-codex-worktree-marker', 20],
    ['conversation.session.header.utilities', 'dsh-codex-worktree-chip', -20],
    ['settings.section', 'dsh-codex-worktree', 40],
  ]
  check('registers exactly five slot entries', registrations.length === 5, String(registrations.length))
  for (const [slot, id, order] of expectedSlots) {
    const entry = entryOf(slot)
    check(`slot ${slot} registered`, Boolean(entry))
    check(`slot ${slot} id is ${id}`, entry?.options?.id === id, String(entry?.options?.id))
    check(`slot ${slot} order is ${order}`, entry?.options?.order === order, String(entry?.options?.order))
    check(`slot ${slot} locale is the renamed namespace`, entry?.options?.locale === 'dsh-codex-worktree')
  }

  check('source has no setInterval', !/setInterval/.test(source))
  check('source no longer uses a create endpoint', !/dsh-codex-worktree\/create/.test(source))
  check('source no longer creates Workspaces', !/workspaces\.create/.test(source))

  /* ================================================================ *
   * 1. Work-location selector (conversation.hero.options)              *
   * ================================================================ */
  const placementEntry = entryOf('conversation.hero.options')
  check('placement does NOT shadow conversation.hero.workspace', entryOf('conversation.hero.workspace') === undefined)

  // Session-scoped slot props: the runtime hands down sessionId + selector hooks.
  sessions.byId['s-placement'] = { id: 's-placement', blank: true, cwd: '/repo' }
  sessions.byId['s-placement-not-blank'] = { id: 's-placement-not-blank', blank: false, cwd: '/repo' }
  sessions.byId['s-placement-no-workspace'] = { id: 's-placement-no-workspace', blank: true }
  sessions.byId['s-placement-workspace'] = { id: 's-placement-workspace', blank: true }
  sessions.byId['s-placement-non-git'] = { id: 's-placement-non-git', blank: true, cwd: '/repo2' }
  sessions.byId['s-placement-fail'] = { id: 's-placement-fail', blank: true, cwd: '/repo-fail' }
  sessions.byId['s-placement-local'] = { id: 's-placement-local', blank: true, cwd: '/repo-local' }
  const sessionHookProps = {
    useSessions: (selector) => selector(sessions.list.getSnapshot()),
    useWorkspaces: (selector) => selector(workspaces.list.getSnapshot()),
  }
  const placementProps = (sessionId) => Object.assign({ sessionId }, sessionHookProps)

  let placementTree = await render(placementEntry, placementProps('s-placement'), 'placement-initial')
  let pill = findAll(placementTree, (node) => node.props && node.props['data-dsh-codex-worktree-placement'] !== undefined)[0]
  check('placement pill renders for a selected Git Workspace', Boolean(pill))
  check('placement pill starts on the default worktree mode', pill ? textOf(pill).indexOf('New local worktree') !== -1 : false, pill ? textOf(pill) : '')
  check('placement pill advertises its menu', pill?.props['aria-haspopup'] === 'menu')
  check('placement GET uses the workspace path', callsFor('placement').some((call) => call.payload.workspacePath === '/repo' && call.payload.mode === undefined))

  pill.props.onClick()
  let openTree = await render(placementEntry, placementProps('s-placement'), 'placement-initial')
  const menu = findAll(openTree, (node) => node.props && node.props.role === 'menu')[0]
  check('placement menu opens', Boolean(menu))
  check('placement menu offers 本地', menu ? textOf(menu).indexOf('Local') !== -1 : false)
  check('placement menu offers 新建本地工作树', menu ? textOf(menu).indexOf('New local worktree') !== -1 : false)
  check('placement menu shows the footer hint', menu ? textOf(menu).indexOf('does not add a Workspace') !== -1 : false)
  const localOption = findAll(openTree, (node) => node.type === 'button' && node.props.role === 'menuitemradio' && textOf(node).indexOf('Local') !== -1)[0]
  check('local option rendered', Boolean(localOption))
  localOption.props.onClick()
  await render(placementEntry, placementProps('s-placement'), 'placement-initial')
  await flush()
  const placementWrites = callsFor('placement').filter((call) => call.payload.mode !== undefined)
  check('picking Local calls placement SET', placementWrites.length === 1, JSON.stringify(placementWrites.map((call) => call.payload)))
  check('placement SET payload is {workspacePath, mode:local}', placementWrites[0]?.payload.workspacePath === '/repo' && placementWrites[0]?.payload.mode === 'local', JSON.stringify(placementWrites[0]?.payload))

  const afterPickTree = await render(placementEntry, placementProps('s-placement'), 'placement-initial')
  const afterPickPill = findAll(afterPickTree, (node) => node.props && node.props['data-dsh-codex-worktree-placement'] !== undefined)[0]
  check('placement pill reflects the chosen mode', afterPickPill ? textOf(afterPickPill).indexOf('Local') !== -1 : false, afterPickPill ? textOf(afterPickPill) : '')

  placementBehavior.isGit = false
  const nonGitTree = await render(placementEntry, placementProps('s-placement-non-git'), 'placement-non-git')
  check('placement hidden for a non-Git Workspace', nonGitTree === null)
  placementBehavior.isGit = true

  const noWorkspaceTree = await render(placementEntry, placementProps('s-placement-no-workspace'), 'placement-missing')
  check('placement hidden when the Workspace is unknown', noWorkspaceTree === null)

  const notBlankTree = await render(placementEntry, placementProps('s-placement-not-blank'), 'placement-not-blank')
  check('placement hidden for a non-blank Session', notBlankTree === null)

  const fallbackPathTree = await render(placementEntry, placementProps('s-placement-workspace'), 'placement-workspace-fallback')
  const fallbackPill = findAll(fallbackPathTree, (node) => node.props && node.props['data-dsh-codex-worktree-placement'] !== undefined)[0]
  check('placement falls back to the Workspace path when the Session has no cwd', Boolean(fallbackPill))
  check('placement fallback path is used by the GET', callsFor('placement').some((call) => call.payload.workspacePath === '/repo-ws' && call.payload.mode === undefined))

  placementBehavior.respond = () => ({ ok: false, error: { code: 'bad-request', message: 'placement failed', details: {} } })
  const failureTree = await render(placementEntry, placementProps('s-placement-fail'), 'placement-failure')
  const failurePill = findAll(failureTree, (node) => node.props && node.props['data-dsh-codex-worktree-placement'] !== undefined)[0]
  check('placement degrades to a read-only fallback on RPC failure', Boolean(failurePill) && failurePill.props.disabled === true)
  check('placement fallback shows the default mode', failurePill ? textOf(failurePill).indexOf('New local worktree') !== -1 : false)
  placementBehavior.respond = null

  placementBehavior.respond = (workspacePath) => ({ ok: true, value: { workspacePath, mode: 'local', defaultMode: 'local', isGit: true } })
  const localDefaultTree = await render(placementEntry, placementProps('s-placement-local'), 'placement-local-default')
  const localDefaultPill = findAll(localDefaultTree, (node) => node.props && node.props['data-dsh-codex-worktree-placement'] !== undefined)[0]
  check('placement renders the sticky local mode', localDefaultPill ? textOf(localDefaultPill).indexOf('Local') !== -1 : false)
  placementBehavior.respond = null

  /* ================================================================ *
   * 2. Progress card state machine (conversation.input.dock)          *
   * ================================================================ */
  const progressEntry = entryOf('conversation.input.dock')
  function projection(phase, step, extra) {
    return Object.assign(
      {
        phase,
        step,
        path: '/repo/.agents/worktrees/wt-abc',
        repoRoot: '/repo',
        workspaceRoot: '/repo',
        mode: 'detached',
        branch: null,
        baseCommit: 'abcdef1234',
        updatedAt: `2026-10-20T10:00:0${clock % 10}.000Z`,
      },
      extra || {},
    )
  }

  setProjection('s-progress', projection('creating', 'prepare'))
  let progressTree = await render(progressEntry, { sessionId: 's-progress' }, 'progress-steps')
  check('progress card appears while creating', textOf(progressTree).indexOf('Creating worktree') !== -1)
  const progressSteps = findAll(progressTree, (node) => node.props && node.props['data-step'] !== undefined && node.props['data-status'] !== undefined)
  check('progress card shows three steps', progressSteps.length === 3, String(progressSteps.length))
  check('prepare is the current step', progressSteps[0]?.props['data-status'] === 'current', JSON.stringify(progressSteps.map((node) => [node.props['data-step'], node.props['data-status']])))
  check('later steps are pending', progressSteps[1]?.props['data-status'] === 'pending' && progressSteps[2]?.props['data-status'] === 'pending')
  check('progress card offers cancel', Boolean(findAll(progressTree, (node) => node.type === 'button' && node.props['data-action'] === 'cancel')[0]))

  advance(300)
  setProjection('s-progress', projection('creating', 'checkout'))
  progressTree = await render(progressEntry, { sessionId: 's-progress' }, 'progress-steps')
  check('prepare completes when checkout starts', Boolean(findAll(progressTree, (node) => node.props['data-step'] === 'prepare' && node.props['data-status'] === 'done')[0]))

  advance(400)
  setProjection('s-progress', projection('creating', 'finalize'))
  progressTree = await render(progressEntry, { sessionId: 's-progress' }, 'progress-steps')
  check('checkout completes when finalize starts', Boolean(findAll(progressTree, (node) => node.props['data-step'] === 'checkout' && node.props['data-status'] === 'done')[0]))

  // Ready arrives after the 1s minimum already elapsed: the done state shows at once.
  setProjection('s-progress', projection('ready', null))
  advance(300)
  progressTree = await render(progressEntry, { sessionId: 's-progress' }, 'progress-steps')
  check('all steps are done on ready', findAll(progressTree, (node) => node.props && node.props['data-status'] === 'done').length === 3)
  check('ready shows 已创建工作树', textOf(progressTree).indexOf('Worktree created') !== -1)
  check('done card has no cancel action', !findAll(progressTree, (node) => node.type === 'button' && node.props['data-action'] === 'cancel')[0])
  advance(400)
  progressTree = await render(progressEntry, { sessionId: 's-progress' }, 'progress-steps')
  check('done card fades out after ~400ms', progressTree === null)

  // Minimum display time: ready immediately, the card stays for at least 1000ms.
  setProjection('s-fast', projection('creating', 'prepare'))
  let fastTree = await render(progressEntry, { sessionId: 's-fast' }, 'progress-min')
  check('fast creation shows the creating card', textOf(fastTree).indexOf('Creating worktree') !== -1)
  setProjection('s-fast', projection('ready', null))
  fastTree = await render(progressEntry, { sessionId: 's-fast' }, 'progress-min')
  check('ready is held back until the 1s minimum', textOf(fastTree).indexOf('Worktree created') === -1)
  advance(999)
  fastTree = await render(progressEntry, { sessionId: 's-fast' }, 'progress-min')
  check('card still shown just before 1s', textOf(fastTree).indexOf('Worktree created') === -1)
  advance(1)
  fastTree = await render(progressEntry, { sessionId: 's-fast' }, 'progress-min')
  check('card completes at 1s', textOf(fastTree).indexOf('Worktree created') !== -1)
  advance(400)
  fastTree = await render(progressEntry, { sessionId: 's-fast' }, 'progress-min')
  check('minimum-time card fades out', fastTree === null)

  // Cancel only hides locally; creation continues and the card does not return.
  setProjection('s-cancel', projection('creating', 'prepare'))
  let cancelTree = await render(progressEntry, { sessionId: 's-cancel' }, 'progress-cancel')
  findAll(cancelTree, (node) => node.type === 'button' && node.props['data-action'] === 'cancel')[0].props.onClick()
  cancelTree = await render(progressEntry, { sessionId: 's-cancel' }, 'progress-cancel')
  check('cancel hides the progress card immediately', cancelTree === null)
  setProjection('s-cancel', projection('creating', 'finalize'))
  cancelTree = await render(progressEntry, { sessionId: 's-cancel' }, 'progress-cancel')
  check('cancelled card stays hidden while creating continues', cancelTree === null)
  setProjection('s-cancel', projection('ready', null))
  cancelTree = await render(progressEntry, { sessionId: 's-cancel' }, 'progress-cancel')
  check('cancelled card does not reappear on ready', cancelTree === null)

  // Error state shows the reason and still offers cancel (hide only).
  setProjection('s-error', projection('error', null, { error: 'no-commit' }))
  let errorTree = await render(progressEntry, { sessionId: 's-error' }, 'progress-error')
  check('error card shows the failure copy', textOf(errorTree).indexOf('Could not create the worktree') !== -1)
  check('error card shows the reason code', textOf(errorTree).indexOf('no-commit') !== -1)
  findAll(errorTree, (node) => node.type === 'button' && node.props['data-action'] === 'cancel')[0].props.onClick()
  errorTree = await render(progressEntry, { sessionId: 's-error' }, 'progress-error')
  check('error card can be dismissed', errorTree === null)

  // A Session without a projection renders nothing at all.
  const noProjectionTree = await render(progressEntry, { sessionId: 's-none' }, 'progress-none')
  check('progress card hidden without a projection', noProjectionTree === null)

  /* ================================================================ *
   * 3. Sidebar marker (sidebar.session.row.leading)                   *
   * ================================================================ */
  const markerEntry = entryOf('sidebar.session.row.leading')
  setProjection('s-marker', projection('ready', null))
  let markerTree = await render(markerEntry, { sessionId: 's-marker' }, 'marker-ready')
  const marker = findAll(markerTree, (node) => node.props && node.props['data-dsh-codex-worktree-marker'] !== undefined)[0]
  check('marker renders for a ready projection', Boolean(marker))
  check('marker is not a button', marker?.type !== 'button')
  check('marker has no click handler', !marker?.props.onClick)
  check('marker has no tabIndex', marker?.props.tabIndex === undefined)
  check('marker tooltip carries the worktree path', typeof marker?.props.title === 'string' && marker.props.title.indexOf('/repo/.agents/worktrees/wt-abc') !== -1, String(marker?.props.title))
  check('marker contains the 14px tree icon', findAll(markerTree, (node) => node.type === 'svg').length > 0)

  setProjection('s-marker-null', null)
  const nullMarkerTree = await render(markerEntry, { sessionId: 's-marker-null' }, 'marker-null')
  check('marker hidden for a null projection', nullMarkerTree === null)

  setProjection('s-marker-creating', projection('creating', 'prepare'))
  const creatingMarkerTree = await render(markerEntry, { sessionId: 's-marker-creating' }, 'marker-creating')
  check('marker hidden while creating', creatingMarkerTree === null)

  /* ================================================================ *
   * 4. Session-header chip (projection base state + status popover)   *
   * ================================================================ */
  const chipEntry = entryOf('conversation.session.header.utilities')
  setProjection('s-chip', projection('ready', null, { branch: 'wt/login' }))
  const chipTree = await render(chipEntry, { sessionId: 's-chip' }, 'chip-ready')
  const chip = findAll(chipTree, (node) => node.props && node.props['data-dsh-codex-worktree-chip'] !== undefined)[0]
  check('chip renders for a ready projection', Boolean(chip))
  check('chip shows the branch name', chip ? textOf(chip).indexOf('wt/login') !== -1 : false, chip ? textOf(chip) : '')
  check('chip base state needs no status RPC', callsFor('status').length === 0, String(callsFor('status').length))

  chip.props.onClick()
  const chipPopoverTree = await render(chipEntry, { sessionId: 's-chip' }, 'chip-ready')
  await render(chipEntry, { sessionId: 's-chip' }, 'chip-ready')
  const popover = findAll(chipPopoverTree, (node) => node.props && node.props['data-dsh-codex-worktree-popover'] !== undefined)[0] || findAll(await render(chipEntry, { sessionId: 's-chip' }, 'chip-ready'), (node) => node.props && node.props['data-dsh-codex-worktree-popover'] !== undefined)[0]
  check('chip popover opens', Boolean(popover))
  const statusCalls = callsFor('status')
  check('opening the popover reads status once', statusCalls.length === 1, String(statusCalls.length))
  check('status payload carries the sessionId', statusCalls[0]?.payload.sessionId === 's-chip')
  check('popover shows the dirty count', popover ? textOf(popover).indexOf('2') !== -1 : false)

  setProjection('s-chip-null', null)
  const unmanagedTree = await render(chipEntry, { sessionId: 's-chip-null' }, 'chip-null')
  const unmanagedChip = findAll(unmanagedTree, (node) => node.props && node.props['data-dsh-codex-worktree-chip'] !== undefined)[0]
  check('chip shows 未托管 without a projection', unmanagedChip ? textOf(unmanagedChip).indexOf('No worktree') !== -1 : false, unmanagedChip ? textOf(unmanagedChip) : '')

  setProjection('s-chip-creating', projection('creating', 'prepare'))
  const creatingChipTree = await render(chipEntry, { sessionId: 's-chip-creating' }, 'chip-creating')
  const creatingChip = findAll(creatingChipTree, (node) => node.props && node.props['data-dsh-codex-worktree-chip'] !== undefined)[0]
  check('chip shows the loading state while creating', creatingChip ? textOf(creatingChip).indexOf('Checking') !== -1 : false, creatingChip ? textOf(creatingChip) : '')

  setProjection('s-chip-error', projection('error', null, { error: 'limit-reached' }))
  const errorChipTree = await render(chipEntry, { sessionId: 's-chip-error' }, 'chip-error')
  const errorChip = findAll(errorChipTree, (node) => node.props && node.props['data-dsh-codex-worktree-chip'] !== undefined)[0]
  check('chip shows the error state', errorChip ? textOf(errorChip).indexOf('Status unknown') !== -1 : false, errorChip ? textOf(errorChip) : '')

  /* ================================================================ *
   * 5. Settings: editable config + management list                    *
   * ================================================================ */
  const settingsEntry = entryOf('settings.section')
  check('settings nav label is the branded title', settingsEntry.options.label() === 'Codex-style Worktree', settingsEntry.options.label())
  const settingsProps = { close() {} }
  let settingsTree = await render(settingsEntry, settingsProps, 'settings-config')
  let settingsText = textOf(settingsTree)
  check('settings page title branded', settingsText.indexOf('Codex-style Worktree') !== -1)
  check('settings renders the configuration block', settingsText.indexOf('Configuration') !== -1)
  check('settings renders boolean field label', settingsText.indexOf('Automatic creation') !== -1)
  check('settings renders select field label', settingsText.indexOf('Default work location') !== -1)
  check('settings renders number field label', settingsText.indexOf('Keep at most') !== -1)
  check('settings renders lines field label', settingsText.indexOf('Skip presets matching') !== -1)
  check('settings renders text field label', settingsText.indexOf('Name prefix') !== -1)
  check('settings starts in the saved state', settingsText.indexOf('Saved') !== -1)
  const settingsGets = callsFor('settings').filter((call) => call.payload.action === 'get')
  check('settings GET called on mount', settingsGets.length === 1, String(settingsGets.length))

  const saveButton = findAll(settingsTree, (node) => node.type === 'button' && node.props['data-action'] === 'save')[0]
  check('save button rendered', Boolean(saveButton))
  check('save disabled without changes', saveButton?.props.disabled === true)

  const switchControl = findAll(settingsTree, (node) => node.type === 'button' && node.props.role === 'switch')[0]
  check('boolean switch rendered', Boolean(switchControl))
  switchControl.props.onClick({ preventDefault() {} })
  settingsTree = await render(settingsEntry, settingsProps, 'settings-config')
  settingsText = textOf(settingsTree)
  check('editing flips the state to unsaved', settingsText.indexOf('Unsaved changes') !== -1)
  const dirtySave = findAll(settingsTree, (node) => node.type === 'button' && node.props['data-action'] === 'save')[0]
  check('save enabled after a change', dirtySave?.props.disabled === false)
  dirtySave.props.onClick()
  await render(settingsEntry, settingsProps, 'settings-config')
  await flush()
  const setCalls = callsFor('settings').filter((call) => call.payload.action === 'set')
  check('save calls settings set once', setCalls.length === 1, String(setCalls.length))
  check('save payload carries the diff patch', Boolean(setCalls[0] && JSON.stringify(setCalls[0].payload.patch) === JSON.stringify({ enabled: false })), JSON.stringify(setCalls[0]?.payload))
  check('save payload carries the revision', setCalls[0]?.payload.revision === 2, String(setCalls[0]?.payload.revision))
  settingsTree = await render(settingsEntry, settingsProps, 'settings-config')
  check('successful save reports saved', textOf(settingsTree).indexOf('Saved') !== -1)

  // Conflict: the server rejects the revision; the form refreshes and explains.
  settingsBehavior.setError = { code: 'conflict', message: 'revision mismatch', details: { actual: 9 } }
  const conflictSwitch = findAll(settingsTree, (node) => node.type === 'button' && node.props.role === 'switch')[0]
  conflictSwitch.props.onClick({ preventDefault() {} })
  settingsTree = await render(settingsEntry, settingsProps, 'settings-config')
  findAll(settingsTree, (node) => node.type === 'button' && node.props['data-action'] === 'save')[0].props.onClick()
  await render(settingsEntry, settingsProps, 'settings-config')
  await flush()
  await render(settingsEntry, settingsProps, 'settings-config')
  await flush()
  settingsTree = await render(settingsEntry, settingsProps, 'settings-config')
  settingsText = textOf(settingsTree)
  check('conflict text shown', settingsText.indexOf('Configuration changed elsewhere') !== -1)
  const getsAfterConflict = callsFor('settings').filter((call) => call.payload.action === 'get').length
  check('conflict triggers an automatic re-GET', getsAfterConflict > settingsGets.length, `${settingsGets.length} -> ${getsAfterConflict}`)

  // Invalid value: the message is shown and the draft is kept.
  settingsBehavior.setError = { code: 'invalid-config', message: 'namePrefix must not start with "-"', details: {} }
  const invalidSwitch = findAll(settingsTree, (node) => node.type === 'button' && node.props.role === 'switch')[0]
  invalidSwitch.props.onClick({ preventDefault() {} })
  settingsTree = await render(settingsEntry, settingsProps, 'settings-config')
  findAll(settingsTree, (node) => node.type === 'button' && node.props['data-action'] === 'save')[0].props.onClick()
  await render(settingsEntry, settingsProps, 'settings-config')
  await flush()
  settingsTree = await render(settingsEntry, settingsProps, 'settings-config')
  settingsText = textOf(settingsTree)
  check('invalid value message shown', settingsText.indexOf('Invalid value') !== -1 && settingsText.indexOf('namePrefix') !== -1, settingsText.slice(0, 400))

  // Reset: writes the reset action with the current revision.
  const resetButton = findAll(settingsTree, (node) => node.type === 'button' && node.props['data-action'] === 'reset')[0]
  check('reset button rendered', Boolean(resetButton))
  resetButton.props.onClick()
  await render(settingsEntry, settingsProps, 'settings-config')
  await flush()
  const resetCalls = callsFor('settings').filter((call) => call.payload.action === 'reset')
  check('reset calls settings reset', resetCalls.length === 1, String(resetCalls.length))
  check('reset payload carries a revision', typeof resetCalls[0]?.payload.revision === 'number')

  // Management list: records, prune, delete confirmation.
  settingsTree = await render(settingsEntry, settingsProps, 'settings-config')
  settingsText = textOf(settingsTree)
  check('management block renders records', settingsText.indexOf('/repo/.agents/worktrees/wt-abc') !== -1)
  check('management block shows the repo', settingsText.indexOf('/repo') !== -1)
  const pruneButton = findAll(settingsTree, (node) => node.type === 'button' && node.props['data-action'] === 'prune')[0]
  check('prune button rendered', Boolean(pruneButton))
  pruneButton.props.onClick()
  await render(settingsEntry, settingsProps, 'settings-config')
  await flush()
  check('prune calls the prune endpoint', callsFor('prune').length === 1, String(callsFor('prune').length))
  settingsTree = await render(settingsEntry, settingsProps, 'settings-config')
  const deleteButton = byText(settingsTree, 'Delete')
  check('delete button rendered', Boolean(deleteButton))
  deleteButton.props.onClick()
  settingsTree = await render(settingsEntry, settingsProps, 'settings-config')
  check('delete asks for confirmation', textOf(settingsTree).indexOf('Delete this worktree?') !== -1)
  const confirmDelete = byText(settingsTree, 'Confirm delete')
  confirmDelete.props.onClick()
  await render(settingsEntry, settingsProps, 'settings-config')
  await flush()
  const cleanCalls = callsFor('clean')
  check('delete calls clean with force=false and deleteBranch=true', Boolean(cleanCalls[0]) && cleanCalls[0].payload.force === false && cleanCalls[0].payload.deleteBranch === true, JSON.stringify(cleanCalls[0]?.payload))

  // Headless degrade: settings service unavailable → read-only hint, no crash.
  settingsBehavior.getError = { code: 'settings-unavailable', message: 'no settings service', details: {} }
  const unavailableTree = await render(settingsEntry, settingsProps, 'settings-unavailable')
  check('settings unavailable renders the read-only hint', textOf(unavailableTree).indexOf('Settings service unavailable') !== -1)
  settingsBehavior.getError = null

  /* ---------------- RPC namespace ---------------- */
  check('every RPC uses the /api channel', calls.every((call) => call.channel === '/api'), JSON.stringify(calls.slice(0, 3)))
  check(
    'every RPC endpoint carries the renamed namespace',
    calls.every((call) => /^dsh-codex-worktree\/(status|clean|list|prune|placement|settings)$/.test(call.endpoint)),
    JSON.stringify([...new Set(calls.map((call) => call.endpoint))]),
  )

  /* ---------------- disposal ---------------- */
  for (const entry of effects.reverse()) {
    try {
      entry.dispose()
    } catch {
      /* disposal must not throw either */
    }
  }
  check('all plugin effects are disposable', true)
}

try {
  await main()
} finally {
  /* nothing to remove: this script writes no files */
}

if (failures > 0) {
  console.error(`\n${failures} client smoke check(s) failed`)
  process.exit(1)
}
console.log('\nsmoke: all client checks passed')
