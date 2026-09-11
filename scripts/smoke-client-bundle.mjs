#!/usr/bin/env node
/**
 * Bundle-contract smoke test: run `lib/client.js` OUTSIDE the browser and prove
 * the three things the DSH client loader depends on, before ever restarting the
 * host:
 *
 * 1. the artifact registers the factory under EXACTLY the package name
 *    (`window.__ModuleLoader__.load({ id, factory })`) — the client-modules
 *    compose keys on the package name, so a drift here means the row never
 *    materializes;
 * 2. the factory resolves its externals through the injected `require` and
 *    returns a module with `inject` + `apply` (the cordis plugin shape);
 * 3. `apply` registers the chip into `conversation.chat.assistant-actions`, and
 *    the registered component prices a real turn from a mirrored snapshot while
 *    returning nothing for an unpriced one.
 *
 * React and react-dom are stubbed: this checks the plugin's own contract, not
 * React's behavior. Run `pnpm run build` first.
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

/** Minimal hook/react stubs: enough for module evaluation and one render. */
const reactStub = {
  useCallback: (fn) => fn,
  useEffect: () => {},
  useLayoutEffect: () => {},
  useMemo: (fn) => fn(),
  useRef: (value) => ({ current: value }),
  useState: (value) => [value, () => {}],
}
const jsxStub = { jsx: (type, props, key) => ({ type, props, key }), jsxs: (type, props, key) => ({ type, props, key }) }
const reactDomStub = { createPortal: (node) => node }

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
    __ModuleLoader__: {
      load: (registration) => { registrations.push(registration) },
    },
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

check('registers exactly one factory', registrations.length === 1)
const registration = registrations[0]
check(`registration id is the package name (${packageJson.name})`, registration?.id === packageJson.name)
check('registration exposes a factory function', typeof registration?.factory === 'function')

const moduleExports = registration.factory(requireStub)
check('plugin exports inject', Array.isArray(moduleExports.inject) && moduleExports.inject.includes('slots'))
check('plugin exports apply', typeof moduleExports.apply === 'function')

let registered = null
const context = {
  effect: (callback) => { callback() },
  get: () => undefined,
  slots: {
    inject: (_key, contribute) => { contribute() },
    register: (options, component) => { registered = { options, component }; return () => {} },
  },
}
moduleExports.apply(context)
check('style tag injected once', styleTags.length === 1)
check('registers into conversation.chat.assistant-actions',
  registered?.options.name === 'conversation.chat.assistant-actions')
check('entry id and locale are set', registered?.options.id === 'session-cost' && registered?.options.locale === 'session-cost')

// One priced turn: 1M uncached input + 1M output on Flash off-peak = ¥5.
const usage = {
  uncachedInputTokens: 1_000_000,
  outputTokens: 1_000_000,
  totalTokens: 2_000_000,
  routes: [{ provider: 'deepseek-official', model: 'deepseek-flash' }],
}
const node = {
  kind: 'turn-tail',
  data: { turn: 1, closing: { finalNode: { messageId: 'm1' } }, tokenUsage: usage },
  location: { turn: { start: { time: Date.UTC(2026, 8, 14, 5, 0, 0) }, end: { time: Date.UTC(2026, 8, 14, 5, 1, 0) } } },
}
const snapshot = { nodes: { values: () => [node] }, order: ['k'] }
const chip = registered.component({
  messageId: 'm1',
  useChat: (selector) => selector(snapshot),
  t: undefined,
})
check('chip renders for a priced turn', chip !== null && chip !== undefined)

/** Collect every rendered string from the stub element tree. */
const collectText = (node) => {
  if (typeof node === 'string' || typeof node === 'number') return [String(node)]
  if (Array.isArray(node)) return node.flatMap(collectText)
  if (node === null || typeof node !== 'object') return []
  return collectText(node.props?.children)
}
const chipText = collectText(chip).join('')
check(`chip label carries the off-peak CNY total (got "${chipText}")`, chipText.includes('≈¥5'))

const unpricedSnapshot = {
  nodes: {
    values: () => [{
      kind: 'turn-tail',
      data: { turn: 1, closing: { finalNode: { messageId: 'm2' } }, tokenUsage: { ...usage, routes: [] } },
      location: node.location,
    }],
  },
  order: ['k'],
}
const hidden = registered.component({
  messageId: 'm2',
  useChat: (selector) => selector(unpricedSnapshot),
  t: undefined,
})
check('chip renders nothing without route attribution', hidden === null)

if (failures.length > 0) {
  console.error(`smoke: ${failures.length} check(s) failed`)
  process.exit(1)
}
console.log('smoke: all checks passed')
