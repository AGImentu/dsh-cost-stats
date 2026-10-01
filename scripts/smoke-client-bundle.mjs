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
 *  6. the stats page renders its query switch, opens on today's replies, fetches
 *     the plugin host route, and lists the key catalog so the reader can pick
 *     which key the balance query is about (by NAME — never a value);
 *  7. when the core store WITHHOLDS a turn's usage, the chip prices that reply
 *     from the host fold instead and labels the number as recomputed.
 *
 * React is stubbed with a miniature element renderer: this checks the plugin's
 * own contract, not React's behavior. Run `pnpm run build` first.
 *
 * @usage node scripts/smoke-client-bundle.mjs
 * @module dsh-cost-stats/scripts/smoke-client-bundle
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
  // React accepts either a value or a lazy initializer; a single-pass renderer
  // must honor both and then ignore updates.
  useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
  // The store publishes a new snapshot object per change; this stub re-reads it
  // on every render, which is what a re-render after a publish would do.
  useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot(),
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

/** Collect one prop's values from every element in a stub tree (attributes). */
function collectProp(node, key) {
  if (node === null || typeof node !== 'object') return []
  if (Array.isArray(node)) return node.flatMap(child => collectProp(child, key))
  const own = key in (node.props ?? {}) ? [node.props[key]] : []
  return [...own, ...collectProp(node.props?.children, key)]
}

/**
 * Every `ref` prop in a stub tree, as `[type, value]` pairs.
 *
 * React reserves that prop name, and this miniature renderer does NOT model it —
 * which is exactly how 0.9.0 shipped a `<KeyPicker ref={name}>`: a function
 * component never receives `ref`, and a STRING ref makes React throw
 * ("Element ref was specified as a string ... but no owner was set"). The error
 * boundary then caught it and the settings page rendered blank in the app while
 * every check here stayed green. So the checks below police the prop directly.
 * @param node - the stub element tree.
 * @param out - accumulator.
 * @returns the `[type, refValue]` pairs found.
 */
function collectRefs(node, out = []) {
  if (node === null || typeof node !== 'object') return out
  if (Array.isArray(node)) {
    for (const child of node) collectRefs(child, out)
    return out
  }
  if ('ref' in (node.props ?? {})) out.push([node.type, node.props.ref])
  collectRefs(node.props?.children, out)
  return out
}

/** Whether an element type is one React can legally hand a ref to. */
function canHoldRef(type) {
  return typeof type !== 'function' || type.prototype?.isReactComponent !== undefined
}

/** One reply row for the host-fold fallback, priced off-peak Flash: ¥5. */
const foldRow = {
  sessionId: 's1',
  sessionTitle: 'folded session',
  subagent: false,
  turn: 7,
  at: Date.UTC(2026, 8, 14, 5, 0, 0),
  provider: 'deepseek-official',
  model: 'deepseek-flash',
  plan: 'DeepSeek-V4.1-Flash',
  priced: true,
  cny: 5,
  usd: 0.694,
  uncachedInputTokens: 1_000_000,
  cacheReadTokens: 0,
  outputTokens: 1_000_000,
  reasoningTokens: 0,
  tokens: 2_000_000,
  attempts: 2,
}
const usagePayload = { generatedAt: foldRow.at, stored: 1, read: 1, skipped: 0, rows: [foldRow] }

/** The balance route's canned answer, in the shape the host sends. */
const balancePayload = {
  ok: true,
  available: true,
  infos: [{ currency: 'USD', total: 5.24, granted: 0, toppedUp: 5.24 }],
  at: foldRow.at,
  ref: 'DEEPSEEK_API_KEY',
}

/** The key catalog's canned answer: names and flags, never values. */
const keysPayload = {
  ok: true,
  default: 'DEEPSEEK_API_KEY',
  refs: [
    { ref: 'DEEPSEEK_API_KEY', configured: true, origin: 'default' },
    { ref: 'MIXTOKEN_API_KEY', configured: true, origin: 'store', provider: 'mixtoken' },
  ],
  canRemember: true,
}

const loaded = []
const styleTags = []
const fetched = []
const requests = []
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
  fetch: (url, init) => {
    const target = String(url)
    fetched.push(target)
    requests.push({ url: target, method: init?.method, body: init?.body })
    return Promise.resolve({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => {
        if (target.includes('/cost-stats/keys')) return keysPayload
        if (target.includes('/cost-stats/balance')) return balancePayload
        return usagePayload
      },
    })
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
  chipEntry?.options.id === 'cost-stats' && chipEntry?.options.order === 20 && chipEntry?.options.locale === 'cost-stats')
check('stats page targets settings.section',
  statsEntry?.options.id === 'cost-stats' && statsEntry?.options.order === 300 && statsEntry?.options.locale === 'cost-stats')
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
const nowDate = new Date()
const pad2 = (value) => String(value).padStart(2, '0')
const todayKey = `${String(nowDate.getFullYear())}-${pad2(nowDate.getMonth() + 1)}-${pad2(nowDate.getDate())}`
check('stats page offers a day field and a month picker',
  statsText.includes(todayKey) && statsText.includes('选择月份'))
check(`stats page opens on today's replies (field shows ${todayKey}, got "${statsText.slice(0, 60)}")`,
  statsText.includes(todayKey))
check(`stats page fetches the plugin host route (got ${JSON.stringify(fetched)})`,
  fetched.includes('/cost-stats/usage'))

// 6b. The key row: opening the page asks which keys exist (names only). The
// rendered dropdown and the balance request that carries the picked NAME are
// asserted below, after the module stores have settled, because this miniature
// renderer has no re-render pass.
check(`stats page asks the host for the key catalog on mount (got ${JSON.stringify(fetched)})`,
  fetched.includes('/cost-stats/keys'))

// 7. Fallback path: core withheld the turn's usage, the host fold still prices it.
const withheldNode = {
  kind: 'turn-tail',
  // No `tokenUsage`: exactly the shape a turn with an unusable attempt produces.
  data: { turn: 7, closing: { finalNode: { messageId: 'm7' } } },
  location: { turn: { start: { time: foldRow.at }, end: { time: foldRow.at + 1_000 } } },
}
const withheldProps = {
  messageId: 'm7',
  sessionId: 's1',
  useChat: (selector) => selector(snapshotOf(withheldNode)),
  t: undefined,
}
const firstPass = renderTree(chipEntry.component(withheldProps))
check('chip renders nothing on the first pass, while the fold is unfetched', firstPass === null)

await new Promise((resolve) => { setTimeout(resolve, 20) })
const secondPass = renderTree(chipEntry.component(withheldProps))
const fallbackText = collectText(secondPass).join(' ')
check(`chip prices the withheld turn from the host fold (got "${fallbackText}")`, fallbackText.includes('≈¥5'))
check('the fallback chip is labelled as recomputed, not as the official total',
  collectProp(secondPass, 'title').includes('本回合费用（按日志重算）'))

const otherSession = renderTree(chipEntry.component({ ...withheldProps, sessionId: 's9' }))
check('the fallback never borrows another session\'s reply', otherSession === null)

// 8. The balance number itself, now that the stores have settled: a reopen
// starts from the store's snapshot, so the page shows money instead of a
// spinner.
//
// The catalog decides which name to ask about, so the balance request only
// happens on a render that already sees the catalog — this "priming" render is
// that one, and the assertion renders after its answer arrived.
renderTree(statsEntry.component({ t: undefined }))
await new Promise((resolve) => { setTimeout(resolve, 20) })
const reopenedTree = renderTree(statsEntry.component({ t: undefined }))
const reopened = collectText(reopenedTree).join(' ')
check(`stats page shows the queried balance on reopen (got "${reopened.slice(0, 80)}")`,
  reopened.includes('余额 $5.24'))
check('the balance readout never carries a credential-shaped string',
  !/sk-[A-Za-z0-9_-]{8,}/.test(reopened))
// A failed read — or a page opened before the key was configured — must be one
// click from another attempt, which is why the readout is a button.
check('the balance readout is clickable, so a failed query can be retried',
  collectProp(reopenedTree, 'onClick').some(handler => typeof handler === 'function'))

// 8b. The key row: the dropdown lists the catalog's NAMES (plus the manual
// entry), the button says what it does, and the balance query names the key it
// was asked about instead of silently using "whatever is configured".
check(`stats page lists the configured key names (got "${reopened.slice(0, 140)}")`,
  reopened.includes('DEEPSEEK_API_KEY') && reopened.includes('MIXTOKEN_API_KEY'))
check('the key dropdown keeps a manual entry reachable', reopened.includes('手动输入 key'))
check('the key row carries the query button', reopened.includes('查询KEY余额'))
check(`the balance query names the picked credential (got ${JSON.stringify(fetched)})`,
  fetched.includes('/cost-stats/balance?ref=DEEPSEEK_API_KEY'))
check('the balance query is a GET with no body, and no key ever reaches a URL',
  requests.filter(entry => entry.url.includes('/cost-stats/balance'))
    .every(entry => entry.method === undefined && entry.body === undefined))
check('the chip says which key the money belongs to',
  collectProp(reopenedTree, 'title').some(title => String(title).includes('来源:DEEPSEEK_API_KEY')))
check('the page never renders a credential-shaped string',
  !/sk-[A-Za-z0-9_-]{8,}/.test(reopened) && !/sk-[A-Za-z0-9_-]{8,}/.test(JSON.stringify(requests)))

// 8c. Reserved-prop police (see `collectRefs`): a string ref throws in React and
// a ref on a function component never arrives — both blank the page in the app
// while this miniature renderer stays happy.
const refs = [...collectRefs(reopenedTree), ...collectRefs(renderTree(chipEntry.component({
  messageId: 'm1',
  useChat: (selector) => selector(snapshotOf(pricedNode)),
  t: undefined,
})))]
check(`no element is handed a string ref (got ${JSON.stringify(refs.map(([, value]) => value).filter(value => typeof value === 'string'))})`,
  refs.every(([, value]) => typeof value !== 'string'))
check(`no function component is handed a ref (got ${JSON.stringify(refs.filter(([type]) => !canHoldRef(type)).map(([type]) => type?.name ?? 'anonymous'))})`,
  refs.every(([type]) => canHoldRef(type)))

if (failures.length > 0) {
  console.error(`smoke: ${failures.length} check(s) failed`)
  process.exit(1)
}
console.log('smoke: all checks passed')
