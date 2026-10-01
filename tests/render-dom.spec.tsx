// @vitest-environment jsdom
/**
 * Real-React render test for the settings page.
 *
 * Why this exists: the bundle smoke test renders with a **miniature** React stub
 * that implements hooks but NOT element semantics — no `ref` handling, no
 * re-render, no `act`, no events. 0.9.0 shipped `<KeyPicker ref={name}>`, i.e. a
 * STRING `ref` on a function component; React throws on those
 * ("Function components cannot have string refs"), the plugin's error boundary
 * caught it, and the app showed the settings page as an empty column while every
 * check in `pnpm run smoke` stayed green.
 *
 * This file therefore drives the page the way a reader does: it renders with the
 * real renderer into a DOM, clicks the query button, changes the model dropdown,
 * and asserts what the DOM says — plus that React never complained.
 *
 * @module dsh-cost-stats/tests/render-dom
 */

import { createElement, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CostStatsEntry } from '../src/client/index.tsx'
import * as balanceStore from '../src/client/balance-store.ts'
import * as keyStore from '../src/client/key-store.ts'
import type { KeysPayload } from '../src/balance.ts'

/** The catalog the host would answer with: two models, never a value. */
const keysPayload: KeysPayload = {
  ok: true,
  default: 'DEEPSEEK_API_KEY',
  refs: [
    // DSH's login account: no key at all, listed so its usage can be filtered to.
    { ref: 'deepseek-account', label: 'DeepSeek 账号', configured: false, origin: 'harness', providers: ['deepseek-account'], account: true },
    { ref: 'DEEPSEEK_API_KEY', label: 'DeepSeek', configured: true, origin: 'default', providers: ['deepseek-official'] },
    { ref: 'MIXTOKEN_API_KEY', label: 'https://api.mixtoken.ai/v1', configured: true, origin: 'store', provider: 'mixtoken', providers: ['mixtoken'] },
  ],
}

/** One priced reply per provider, both inside today's window. */
const usagePayload = {
  generatedAt: 1_700_000_000_000,
  stored: 2,
  read: 2,
  skipped: 0,
  rows: [
    {
      sessionId: 's1',
      sessionTitle: 'official session',
      subagent: false,
      turn: 1,
      at: Date.now(),
      provider: 'deepseek-official',
      model: 'deepseek-flash',
      plan: 'DeepSeek-V4.1-Flash',
      priced: true,
      cny: 1,
      usd: 0.14,
      uncachedInputTokens: 1_000,
      cacheReadTokens: 0,
      outputTokens: 1_000,
      reasoningTokens: 0,
      tokens: 2_000,
      attempts: 1,
    },
    {
      sessionId: 's2',
      sessionTitle: 'relay session',
      subagent: false,
      turn: 2,
      at: Date.now(),
      provider: 'mixtoken',
      model: 'deepseek-v4.1-flash',
      plan: 'DeepSeek-V4.1-Flash',
      priced: true,
      cny: 2,
      usd: 0.28,
      uncachedInputTokens: 2_000,
      cacheReadTokens: 0,
      outputTokens: 2_000,
      reasoningTokens: 0,
      tokens: 4_000,
      attempts: 1,
    },
    {
      sessionId: 's3',
      sessionTitle: 'account session',
      subagent: false,
      turn: 3,
      at: Date.now(),
      provider: 'deepseek-account',
      model: 'deepseek-flash',
      plan: 'DeepSeek-V4.1-Flash',
      priced: true,
      cny: 3,
      usd: 0.42,
      uncachedInputTokens: 3_000,
      cacheReadTokens: 0,
      outputTokens: 3_000,
      reasoningTokens: 0,
      tokens: 6_000,
      attempts: 1,
    },
  ],
}
const balancePayload = {
  ok: true,
  available: true,
  infos: [{ currency: 'CNY', total: 12.34, granted: 0, toppedUp: 12.34 }],
  at: 1_700_000_000_000,
  ref: 'DEEPSEEK_API_KEY',
}
/** What the account route answers for the login account. */
const accountPayload = {
  ok: true,
  available: true,
  infos: [{ currency: 'CNY', total: 1.85, granted: 0.37, toppedUp: 1.48 }],
  at: 1_700_000_000_000,
  account: true,
  ref: 'deepseek-account',
}

/** React's act() environment flag, set for the whole file. */
declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined
}

let container: HTMLDivElement
let root: Root | undefined
let errors: string[]
let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  keyStore.reset()
  balanceStore.reset()
  // jsdom keeps `localStorage` for the whole file: without this, one test's
  // model choice would decide the next test's default.
  try { globalThis.localStorage?.clear() } catch { /* storage is optional */ }
  errors = []
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    errors.push(args.map(part => String(part)).join(' '))
  })
  fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    const body = url.includes('/cost-stats/keys')
      ? keysPayload
      : url.includes('account=1')
        ? accountPayload
        : url.includes('/cost-stats/balance')
          ? balancePayload
          : usagePayload
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
  })
  globalThis.fetch = fetchMock as unknown as typeof fetch
  container = document.createElement('div')
  document.body.append(container)
})

afterEach(() => {
  vi.restoreAllMocks()
})

/** Every request URL the page asked for. */
function urls(): string[] {
  return fetchMock.mock.calls.map(call => String(call[0]))
}

/** The query button, by its visible label. */
function queryButton(): HTMLButtonElement {
  const button = [...container.querySelectorAll('button')]
    .find(candidate => (candidate.textContent ?? '').includes('查询余额'))
  if (button === undefined) throw new Error('query button not found')
  return button as HTMLButtonElement
}

/** Change a `<select>` the way React notices. */
function pickOption(select: HTMLSelectElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(globalThis.HTMLSelectElement.prototype, 'value')?.set
  setter?.call(select, value)
  select.dispatchEvent(new Event('change', { bubbles: true }))
}

/**
 * Render the page and let its effects and fetches settle.
 * @param element - the element to mount.
 * @returns nothing.
 */
async function mount(element: ReactElement): Promise<void> {
  await act(async () => {
    root = createRoot(container)
    root.render(element)
  })
  await act(async () => { await new Promise(resolve => { setTimeout(resolve, 30) }) })
}

describe('the statistics page under the real renderer', () => {
  it('lists the models, filters nothing by default, and never makes React complain', async () => {
    await mount(createElement(CostStatsEntry, { t: undefined }))

    const text = container.textContent ?? ''
    expect(text).toContain('费用统计')
    expect(text).toContain('查询余额')
    expect(text).toContain('模型')
    expect(text).toContain('全部')
    // The dropdown names the models the way 「设置 → 模型」 does — not the
    // credential references.
    expect(text).toContain('DeepSeek')
    expect(text).toContain('DeepSeek 账号')
    expect(text).toContain('https://api.mixtoken.ai/v1')
    expect(text).not.toContain('DEEPSEEK_API_KEY')
    expect(text).not.toContain('MIXTOKEN_API_KEY')

    // 「全部」 is preselected and nothing is filtered out.
    const select = container.querySelector('select')
    expect(select).not.toBeNull()
    expect(select?.value).toBe('__all__')
    expect([...container.querySelectorAll('option')].map(option => option.value))
      .toEqual(['__all__', 'deepseek-account', 'DEEPSEEK_API_KEY', 'MIXTOKEN_API_KEY'])
    expect(container.querySelectorAll('tbody tr')).toHaveLength(3)

    // The 模型 column names each row's model the way the dropdown does, so
    // 「全部」 still says who spent what.
    expect([...container.querySelectorAll('thead th')].map(th => th.textContent))
      .toEqual(['时间', '会话', '模型', '用量', '费用'])
    expect([...container.querySelectorAll('tbody tr td:nth-child(3)')].map(td => td.textContent))
      .toEqual(['DeepSeek', 'https://api.mixtoken.ai/v1', 'DeepSeek 账号'])
    // …and the raw ids stay reachable in the tooltip.
    expect([...container.querySelectorAll('tbody tr td:nth-child(3)')].map(td => td.getAttribute('title')))
      .toEqual(['deepseek-official · deepseek-flash', 'mixtoken · deepseek-v4.1-flash', 'deepseek-account · deepseek-flash'])

    // The page must not ask for a balance on its own: only the button does that.
    expect(urls().some(url => url.includes('/cost-stats/balance'))).toBe(false)
    expect(container.textContent).toContain('未查询')

    // A throw inside the page is caught by the plugin's boundary and turns the
    // section into nothing; React logs it first, so "no complaints" is the
    // assertion that matters.
    expect(errors.join('\n')).toBe('')

    await act(async () => { root?.unmount() })
    root = undefined
  })

  it('filters the table when a model is picked, and queries only that model\'s balance', async () => {
    await mount(createElement(CostStatsEntry, { t: undefined }))
    const select = container.querySelector('select') as HTMLSelectElement

    await act(async () => { pickOption(select, 'MIXTOKEN_API_KEY') })
    await act(async () => { await new Promise(resolve => { setTimeout(resolve, 10) }) })

    // Only the relay's reply survives the filter (and its own money is what the
    // total card now covers).
    const rows = [...container.querySelectorAll('tbody tr')].map(row => row.textContent ?? '')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toContain('relay session')
    expect(container.textContent).toContain('¥2.00')

    // Picking alone must not query: the balance is still unasked for.
    expect(urls().some(url => url.includes('/cost-stats/balance'))).toBe(false)
    expect(container.textContent).toContain('未查询')

    await act(async () => { queryButton().click() })
    await act(async () => { await new Promise(resolve => { setTimeout(resolve, 30) }) })

    expect(urls().some(url => url.includes('/cost-stats/balance?ref=MIXTOKEN_API_KEY'))).toBe(true)
    expect(container.textContent).toContain('余额 ¥12.34')
    expect(errors.join('\n')).toBe('')

    await act(async () => { root?.unmount() })
    root = undefined
  })

  it('queries the harness default key while 「全部」 is selected, and keeps keys out of the page', async () => {
    await mount(createElement(CostStatsEntry, { t: undefined }))

    await act(async () => { queryButton().click() })
    await act(async () => { await new Promise(resolve => { setTimeout(resolve, 30) }) })

    expect(urls().some(url => url.startsWith('/cost-stats/balance?ref=DEEPSEEK_API_KEY')), urls().join(' | ')).toBe(true)
    expect(container.textContent).toContain('余额 ¥12.34')
    // No credential-shaped string, and no way to type one: the page cannot even
    // submit a key.
    expect(container.innerHTML).not.toMatch(/sk-[A-Za-z0-9_-]{8,}/)
    expect(container.querySelector('input')).toBeNull()
    expect(errors.join('\n')).toBe('')

    await act(async () => { root?.unmount() })
    root = undefined
  })

  it('lists the login account, filters to it, and reads its balance through DSH', async () => {
    await mount(createElement(CostStatsEntry, { t: undefined }))
    const select = container.querySelector('select') as HTMLSelectElement

    await act(async () => { pickOption(select, 'deepseek-account') })
    await act(async () => { await new Promise(resolve => { setTimeout(resolve, 10) }) })

    // The account is a filter like any other: only its own replies remain.
    const rows = [...container.querySelectorAll('tbody tr')].map(row => row.textContent ?? '')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toContain('account session')
    // It has no API key, so nothing is asked for on selection…
    expect(urls().some(url => url.includes('account=1'))).toBe(false)
    expect(container.textContent).toContain('未查询')

    // …and the click goes to the ACCOUNT route, which DSH answers itself.
    const button = queryButton()
    expect(button.disabled).toBe(false)
    await act(async () => { button.click() })
    await act(async () => { await new Promise(resolve => { setTimeout(resolve, 30) }) })

    expect(urls().some(url => url.includes('/cost-stats/balance?account=1'))).toBe(true)
    expect(container.textContent).toContain('余额 ¥1.85')
    // The two lines the account page shows are both in the tooltip.
    const titles = [...container.querySelectorAll('span')].map(span => span.getAttribute('title') ?? '').join('\n')
    expect(titles).toContain('充值 ¥1.48')
    expect(titles).toContain('赠金 ¥0.37')
    expect(errors.join('\n')).toBe('')

    await act(async () => { root?.unmount() })
    root = undefined
  })
})
