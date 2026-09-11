#!/usr/bin/env node
/**
 * Bundle-contract smoke test: run `lib/client.js` OUTSIDE the browser and prove
 * what the DSH client loader and this plugin's isolation contract depend on,
 * before ever restarting the host:
 *
 * 1. the artifact registers the factory under EXACTLY the package name
 *    (`window.__ModuleLoader__.load({ id, factory })`) — the client-modules
 *    compose keys on the package name, so drift here means the row never
 *    materializes;
 * 2. the factory resolves its externals through the injected `require` and
 *    returns a module with `inject` + `apply` (the cordis plugin shape);
 * 3. `apply` registers exactly one entry into
 *    `conversation.chat.assistant-actions`, tagged with this plugin's locale
 *    namespace, and injects one tagged stylesheet;
 * 4. the registered entry is the chip BEHIND the containment boundary, and that
 *    boundary really degrades to nothing instead of letting a render error
 *    escape — the promise that a failure here cannot take the official
 *    usage/time/branch controls of the same row down with it;
 * 5. the chip prices a real turn from a mirrored snapshot, and renders nothing
 *    for a turn with no route attribution.
 *
 * React is stubbed with a miniature element renderer: this checks the plugin's
 * own contract, not React's behavior. Run `pnpm run build` first.
 *
 * Usage: node scripts/smoke-client-bundle.mjs
 *
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

/** Minimal React surface: hooks pass through, `Component` supports boundaries. */
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
  useEffect: () => {},
  useLayoutEffect: () => {},
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

const registrations = []
const styleTags = []
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
    __ModuleLoader__: { load: (registration) => { registrations.push(registration) } },
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
check('registers exactly one factory', registrations.length === 1)
const registration = registrations[0]
check(`registration id is the package name (${packageJson.name})`, registration?.id === packageJson.name)
check('registration exposes a factory function', typeof registration?.factory === 'function')

// 2. Plugin shape.
const moduleExports = registration.factory(requireStub)
check('plugin exports inject', Array.isArray(moduleExports.inject) && moduleExports.inject.includes('slots'))
check('plugin exports apply', typeof moduleExports.apply === 'function')

// 3. Slot contribution.
let registered = null
let slotKeys = []
const context = {
  effect: (callback) => { callback() },
  get: () => undefined,
  slots: {
    inject: (key, contribute) => { slotKeys.push(key); contribute() },
    register: (options, component) => { registered = { options, component }; return () => {} },
  },
}
moduleExports.apply(context)
check('style tag injected exactly once', styleTags.length === 1)
check('targets the assistant action slot', slotKeys.length === 1 && slotKeys[0] === 'conversation.chat.assistant-actions')
check('entry id, order and locale are set',
  registered?.options.id === 'session-cost' && registered?.options.order === 20 && registered?.options.locale === 'session-cost')

// 4. Containment: an exploding snapshot must yield nothing, not an escaped throw.
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

let contained = 'escaped'
try {
  const exploding = renderTree(registered.component({
    messageId: 'm1',
    useChat: () => { throw new Error('boom') },
    t: undefined,
  }))
  contained = exploding === null ? 'null' : String(exploding)
} catch (error) {
  contained = `threw: ${error.message}`
}
check(`a throwing render is contained to null (got ${contained})`, contained === 'null')

// 5. Pricing behavior through the real component.
const chip = renderTree(registered.component({
  messageId: 'm1',
  useChat: (selector) => selector(snapshotOf(pricedNode)),
  t: undefined,
}))
const chipText = collectText(chip).join('')
check(`chip renders for a priced turn (got "${chipText}")`, chipText.includes('≈¥5'))
check('chip exposes a dialog trigger', chipText !== '' && JSON.stringify(chip).includes('aria-haspopup'))

const unpriced = renderTree(registered.component({
  messageId: 'm2',
  useChat: (selector) => selector(snapshotOf({
    ...pricedNode,
    data: { ...pricedNode.data, closing: { finalNode: { messageId: 'm2' } }, tokenUsage: { ...pricedUsage, routes: [] } },
  })),
  t: undefined,
}))
check('chip renders nothing without route attribution', unpriced === null)

if (failures.length > 0) {
  console.error(`smoke: ${failures.length} check(s) failed`)
  process.exit(1)
}
console.log('smoke: all checks passed')
