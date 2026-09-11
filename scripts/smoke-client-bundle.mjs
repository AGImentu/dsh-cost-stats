#!/usr/bin/env node
/**
 * Bundle-contract smoke test: run `lib/client.js` OUTSIDE the browser and prove
 * what the DSH client loader and this plugin's isolation contract depend on,
 * before ever restarting the host.
 *
 * Loader contract
 *  1. the artifact registers the factory under EXACTLY the package name
 *     (`window.__ModuleLoader__.load({ id, factory })`);
 *  2. the factory resolves its externals through the injected `require` and
 *     returns `inject` + `apply` (the cordis plugin shape);
 *  3. `apply` contributes exactly two entries — the turn chip into
 *     `conversation.chat.assistant-actions` and the stats page into
 *     `settings.section` — injecting one tagged stylesheet.
 *
 * Isolation contract
 *  4. both entries sit behind the error boundary and that boundary degrades to
 *     nothing: the chip with a throwing selector, the page with a throwing
 *     translator. Nothing may escape into the action row or the settings column.
 *
 * Behavior
 *  5. the chip prices a real turn from a mirrored snapshot and renders nothing
 *     without route attribution;
 *  6. the stats page renders its query switch and fetches the plugin host route.
 *
 * React is stubbed with a miniature element renderer: this checks the plugin's
 * own contract, not React's behavior. Run `pnpm run build` first.
 *
 * @usage node scripts/smoke-client-bundle.mjs
 * @module dsh-session-cost/scripts/smoke-client-bundle
 */

import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const packageJson = JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8'))
const bundlePath = join(repo, 'lib', 'client.js')

const failures = []
const check = (label, condition) => {
  if (condition) {
    console.log(`  ok   ${label}`)
  } else {
    failures.push(label)
    console.log(`  FAIL ${label}`)
  }
}

/** Minimal React surface: hooks pass through, effects run, class components catch. */
class Component {
  constructor(props) {
    this.props = props
    this.state = {}
  }

  setState(patch) {
    this.state = { ...this.state, ...patch }
  }
}
Component.prototype.isReactComponent = {}

const reactStub = {
  Component,
  useCallback: (fn) => fn,
  useEffect: (fn) => { fn() },
  useLayoutEffect: (fn) => { fn() },
  useMemo: (fn) => fn(),
  useRef: (value) => ({ current: value }),
  useState: (value) => [value, () => {}],
}
const jsxStub = {
  jsx: (type, props, key) => ({ type, props: props ?? {}, key }),
  jsxs: (type, props, key) => ({ type, props: props ?? {}, key }),
}
const reactDomStub = { createPortal: (node) => node }

/** Miniature renderer: function components render once, class components may catch. */
function renderTree(node) {
  if (node === null || node === undefined || typeof node !== 'object') return node
  if (Array.isArray(node)) return node.map(renderTree)
  const { type, props } = node
  if (typeof type === 'function') {
    if (type.prototype?.isReactComponent !== undefined) {
      const instance = new type(props)
      try {
        return renderTree(instance.render())
      } catch (error) {
        if (typeof type.getDerivedStateFromError !== 'function') throw error
        instance.state = type.getDerivedStateFromError(error)
        return renderTree(instance.render())
      }
    }
    return renderTree(type(props))
  }
  return { type, props: { ...props, children: renderTree(props.children) }, key: node.key }
}

/** Collect every rendered string from a stub element tree. */
function collectText(node) {
  if (typeof node === 'string' || typeof node === 'number') return [String(node)]
  if (Array.isArray(node)) return node.flatMap(collectText)
  if (node === null || typeof node !== 'object') return []
  return collectText(node.props?.children)
}

const loaded = []
const styleTags = []
const fetched = []
const sandbox = {
  console,
  Intl,
  Date,
  Map,
  Set,
  Math,
  Number,
  Object,
  Array,
  JSON,
  String,
  fetch: (url) => {
    fetched.push(String(url))
    return Promise.resolve({ ok: false, status: 503, statusText: 'stub', json: async () => ({}) })
  },
  document: {
    querySelector: () => null,
    createElement: () => {
      const tag = { dataset: {}, textContent: '', remove: () => {} }
      styleTags.push(tag)
      return tag
    },
    head: { appendChild: () => {} },
    body: {},
    addEventListener: () => {},
    removeEventListener: () => {},
  },
  window: {
    __ModuleLoader__: { load: (registration) => { loaded.push(registration) } },
    addEventListener: () => {},
    removeEventListener: () => {},
    innerWidth: 1280,
    innerHeight: 800,
  },
}
sandbox.globalThis = sandbox
const requireStub = (specifier) => {
  if (specifier === 'react') return reactStub
  if (specifier === 'react/jsx-runtime') return jsxStub
  if (specifier === 'react-dom') return reactDomStub
  throw new Error(`unexpected external require: ${specifier}`)
}

console.log(`smoke: ${bundlePath}`)
vm.runInNewContext(readFileSync(bundlePath, 'utf8'), sandbox, { filename: bundlePath })

// 1. Registration contract.
check('registers exactly one factory', loaded.length === 1)
const registration = loaded[0]
check(`registration id is the package name (${packageJson.name})`, registration?.id === packageJson.name)
check('registration exposes a factory function', typeof registration?.factory === 'function')

// 2. Plugin shape.
const moduleExports = registration.factory(requireStub)
check('plugin exports inject', Array.isArray(moduleExports.inject) && moduleExports.inject.includes('slots'))
check('plugin exports apply', typeof moduleExports.apply === 'function')

// 3. Slot contributions.
const registrations = new Map()
const context = {
  effect: (callback) => { callback() },
  get: () => undefined,
  on: () => {},
  slots: {
    inject: (_key, contribute) => { contribute() },
    register: (options, component) => { registrations.set(options.name, { options, component }); return () => {} },
  },
}
moduleExports.apply(context)
check('style tag injected exactly once', styleTags.length === 1)
check('contributes exactly two entries', registrations.size === 2)
const chipEntry = registrations.get('conversation.chat.assistant-actions')
const statsEntry = registrations.get('settings.section')
check('chip targets the assistant action slot',
  chipEntry?.options.id === 'session-cost' && chipEntry?.options.order === 20 && chipEntry?.options.locale === 'session-cost')
check('stats page targets settings.section',
  statsEntry?.options.id === 'session-cost' && statsEntry?.options.order === 300 && statsEntry?.options.locale === 'session-cost')
const label = typeof statsEntry?.options.label === 'function' ? statsEntry.options.label() : statsEntry?.options.label
check(`stats nav label is registrant copy (got "${label}")`, typeof label === 'string' && label.length > 0)

// 4. Containment.
let chipContained = 'escaped'
try {
  chipContained = String(renderTree(chipEntry.component({
    messageId: 'm1',
    useChat: () => { throw new Error('boom') },
    t: undefined,
  })))
} catch (error) {
  chipContained = `threw: ${error.message}`
}
check(`a throwing chip render is contained to null (got ${chipContained})`, chipContained === 'null')

let statsContained = 'escaped'
try {
  statsContained = String(renderTree(statsEntry.component({
    t: () => { throw new Error('boom') },
  })))
} catch (error) {
  statsContained = `threw: ${error.message}`
}
check(`a throwing stats render is contained to null (got ${statsContained})`, statsContained === 'null')

// 5. Chip pricing behavior.
const pricedUsage = {
  uncachedInputTokens: 1_000_000,
  outputTokens: 1_000_000,
  totalTokens: 2_000_000,
  routes: [{ provider: 'deepseek-official', model: 'deepseek-flash' }],
}
const pricedNode = {
  kind: 'turn-tail',
  data: { turn: 1, closing: { finalNode: { messageId: 'm1' } }, tokenUsage: pricedUsage },
  location: { turn: { start: { time: Date.UTC(2026, 8, 14, 5, 0, 0) }, end: { time: Date.UTC(2026, 8, 14, 5, 1, 0) } } },
}
const snapshotOf = (node) => ({ nodes: { values: () => [node] }, order: ['k'] })

const chipText = collectText(renderTree(chipEntry.component({
  messageId: 'm1',
  useChat: (selector) => selector(snapshotOf(pricedNode)),
  t: undefined,
}))).join(' ')
check(`chip renders for a priced turn (got "${chipText}")`, chipText.includes('≈¥5'))

const unpricedChip = renderTree(chipEntry.component({
  messageId: 'm2',
  useChat: (selector) => selector(snapshotOf({
    ...pricedNode,
    data: { ...pricedNode.data, closing: { finalNode: { messageId: 'm2' } }, tokenUsage: { ...pricedUsage, routes: [] } },
  })),
  t: undefined,
}))
check('chip renders nothing without route attribution', unpricedChip === null)

// 6. Stats page: renders the calendar pickers and asks the host for its payload.
const statsText = collectText(renderTree(statsEntry.component({ t: undefined }))).join(' ')
check(`stats page renders its heading (got "${statsText.slice(0, 40)}")`, statsText.includes('费用统计'))
check('stats page offers a day picker and a month picker',
  statsText.includes('选择日期') && statsText.includes('选择月份'))
check(`stats page fetches the plugin host route (got ${JSON.stringify(fetched)})`,
  fetched.includes('/session-cost/usage'))

if (failures.length > 0) {
  console.error(`smoke: ${failures.length} check(s) failed`)
  process.exit(1)
}
console.log('smoke: all checks passed')
