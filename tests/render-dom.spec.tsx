// @vitest-environment jsdom
/**
 * Real-React render test for the settings page.
 *
 * Why this exists: the bundle smoke test renders with a **miniature** React stub
 * that implements hooks but NOT element semantics — no `ref` handling, no
 * re-render, no `act`. 0.9.0 shipped `<KeyPicker ref={name}>`, i.e. a STRING
 * `ref` on a function component. React reserves that prop name: the component
 * never receives it, and in a development build React throws
 * ("Element ref was specified as a string (...) but no owner was set"). The
 * plugin's own error boundary caught the throw, so the app showed the settings
 * page as an empty column while every check in `pnpm run smoke` stayed green.
 *
 * Rendering the page with the real renderer in a DOM closes that gap: React's
 * own complaints are captured and asserted to be empty, and the interactive
 * state (the dropdown's selected value) is asserted through the DOM rather than
 * through a stub tree.
 *
 * @module dsh-cost-stats/tests/render-dom
 */

import { createElement, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CostStatsSection } from '../src/client/StatsSection.tsx'
import { fallbackTranslator } from '../src/client/locales.ts'
import * as balanceStore from '../src/client/balance-store.ts'
import * as keyStore from '../src/client/key-store.ts'
import type { KeysPayload } from '../src/balance.ts'

/** The catalog the host would answer with: two names, never a value. */
const keysPayload: KeysPayload = {
  ok: true,
  default: 'DEEPSEEK_API_KEY',
  refs: [
    { ref: 'DEEPSEEK_API_KEY', label: 'DeepSeek', configured: true, origin: 'default' },
    { ref: 'MIXTOKEN_API_KEY', label: 'https://api.mixtoken.ai/v1', configured: true, origin: 'store', provider: 'mixtoken' },
  ],
  canRemember: true,
}

/** One priced reply and one balance answer, in the host's wire shapes. */
const usagePayload = {
  generatedAt: 1_700_000_000_000,
  stored: 1,
  read: 1,
  skipped: 0,
  rows: [{
    sessionId: 's1',
    sessionTitle: 'session',
    subagent: false,
    turn: 1,
    at: 1_700_000_000_000,
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
  }],
}
const balancePayload = {
  ok: true,
  available: true,
  infos: [{ currency: 'CNY', total: 12.34, granted: 0, toppedUp: 12.34 }],
  at: 1_700_000_000_000,
  ref: 'DEEPSEEK_API_KEY',
}

/** React's act() environment flag, set for the whole file. */
declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined
}

let container: HTMLDivElement
let root: Root | undefined
let errors: string[]

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  keyStore.reset()
  balanceStore.reset()
  errors = []
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    errors.push(args.map(part => String(part)).join(' '))
  })
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    const body = url.includes('/cost-stats/keys')
      ? keysPayload
      : url.includes('/cost-stats/balance')
        ? balancePayload
        : usagePayload
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
  }) as unknown as typeof fetch
  container = document.createElement('div')
  document.body.append(container)
})

afterEach(() => {
  vi.restoreAllMocks()
})

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
  it('renders, lists the configured keys, and never makes React complain', async () => {
    await mount(createElement(CostStatsSection, { t: fallbackTranslator }))

    const text = container.textContent ?? ''
    expect(text).toContain('费用统计')
    expect(text).toContain('查询余额')
    // The row is labelled 模型 and names the providers the way 「设置 → 模型」 does
    // — the credential references stay in the option tooltips, not the labels.
    expect(text).toContain('模型')
    expect(text).toContain('DeepSeek')
    expect(text).toContain('https://api.mixtoken.ai/v1')
    expect(text).not.toContain('DEEPSEEK_API_KEY')
    expect(text).not.toContain('MIXTOKEN_API_KEY')
    // The money of the picked credential, once the host answer landed.
    expect(text).toContain('余额 ¥12.34')

    // The prop that broke 0.9.0 was `ref`: React diverts it, so the component
    // saw nothing and the select fell back to "no selection". Asserting the
    // DOM's own value is what makes that visible.
    const select = container.querySelector('select')
    expect(select).not.toBeNull()
    expect(select?.value).toBe('DEEPSEEK_API_KEY')
    expect([...container.querySelectorAll('option')].map(option => option.value))
      .toEqual(['DEEPSEEK_API_KEY', 'MIXTOKEN_API_KEY', '__manual__'])
    expect([...container.querySelectorAll('option')].map(option => option.textContent))
      .toEqual(['DeepSeek', 'https://api.mixtoken.ai/v1', '手动输入 key…'])

    // A throw inside the page is caught by the plugin's boundary and turns the
    // section into nothing; React logs it first, so "no complaints" is the
    // assertion that matters.
    expect(errors.join('\n')).toBe('')

    await act(async () => { root?.unmount() })
    root = undefined
  })

  it('keeps the manual entry reachable and the key itself out of the page', async () => {
    await mount(createElement(CostStatsSection, { t: fallbackTranslator }))
    const html = container.innerHTML

    expect(html).not.toMatch(/sk-[A-Za-z0-9_-]{8,}/)
    expect(html).toContain('手动输入 key')
    expect(container.querySelector('input[type="password"]')).toBeNull()
    // The balance query named the picked credential (a NAME, never a value).
    const urls = (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls.map(call => String(call[0]))
    expect(urls).toContain('/cost-stats/balance?ref=DEEPSEEK_API_KEY')
    expect(errors.join('\n')).toBe('')

    await act(async () => { root?.unmount() })
    root = undefined
  })
})
