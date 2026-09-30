import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as balanceStore from '../src/client/balance-store.ts'
import * as keyStore from '../src/client/key-store.ts'
import type { KeysPayload } from '../src/balance.ts'

/** A catalog with two named keys. */
function catalog(): KeysPayload {
  return {
    ok: true,
    default: 'DEEPSEEK_API_KEY',
    refs: [
      { ref: 'DEEPSEEK_API_KEY', configured: true, origin: 'default' },
      { ref: 'MIXTOKEN_API_KEY', configured: true, origin: 'store', provider: 'mixtoken' },
    ],
    canRemember: true,
  }
}

/** A `localStorage` stand-in that can also fail, like a disabled one. */
function memoryStorage(): Storage {
  const map = new Map<string, string>()
  return {
    get length() { return map.size },
    clear: () => { map.clear() },
    getItem: (key: string) => map.get(key) ?? null,
    key: (index: number) => [...map.keys()][index] ?? null,
    removeItem: (key: string) => { map.delete(key) },
    setItem: (key: string, value: string) => { map.set(key, value) },
  }
}

const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
const originalFetch = globalThis.fetch

beforeEach(() => {
  balanceStore.reset()
  keyStore.reset()
  Object.defineProperty(globalThis, 'localStorage', { value: memoryStorage(), configurable: true })
})

afterEach(() => {
  if (originalStorage === undefined) Reflect.deleteProperty(globalThis, 'localStorage')
  else Object.defineProperty(globalThis, 'localStorage', originalStorage)
  globalThis.fetch = originalFetch
  vi.restoreAllMocks()
})

describe('suggestRefName', () => {
  it('offers a name that is still free', () => {
    expect(keyStore.suggestRefName(undefined)).toBe('DEEPSEEK_API_KEY_2')
    const taken: KeysPayload = {
      ...catalog(),
      refs: [
        ...catalog().refs,
        { ref: 'DEEPSEEK_API_KEY_2', configured: true, origin: 'store' },
      ],
    }
    expect(keyStore.suggestRefName(taken)).toBe('DEEPSEEK_API_KEY_3')
  })
})

describe('the remembered selection', () => {
  it('remembers a NAME only, and drops one the catalog no longer offers', () => {
    expect(keyStore.storedRef(catalog())).toBeUndefined()
    keyStore.storeRef('MIXTOKEN_API_KEY')
    expect(keyStore.storedRef(catalog())).toBe('MIXTOKEN_API_KEY')
    // The stored name is all that is kept: no key material reaches storage.
    expect(JSON.stringify(globalThis.localStorage)).not.toContain('sk-')
    expect(keyStore.storedRef({ ...catalog(), refs: [catalog().refs[0]!] })).toBeUndefined()
    keyStore.storeRef(undefined)
    expect(keyStore.storedRef(catalog())).toBeUndefined()
  })

  it('survives a page without usable storage', () => {
    Object.defineProperty(globalThis, 'localStorage', {
      value: {
        getItem: () => { throw new Error('denied') },
        setItem: () => { throw new Error('denied') },
        removeItem: () => { throw new Error('denied') },
      },
      configurable: true,
    })
    expect(keyStore.storedRef(catalog())).toBeUndefined()
    expect(() => { keyStore.storeRef('A_KEY') }).not.toThrow()
  })
})

describe('balance-store', () => {
  /** Install a fetch stub and record every call. */
  function stubFetch(payload: unknown = { ok: true, infos: [] }): ReturnType<typeof vi.fn> {
    const mock = vi.fn(async () => new Response(JSON.stringify(payload), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }))
    globalThis.fetch = mock as unknown as typeof fetch
    return mock
  }

  it('queries a named credential by NAME, and never puts a key in the page', async () => {
    const mock = stubFetch({ ok: true, at: 1, ref: 'MIXTOKEN_API_KEY', infos: [] })
    await balanceStore.load({ kind: 'ref', ref: 'MIXTOKEN_API_KEY' })
    const [url, init] = mock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/cost-stats/balance?ref=MIXTOKEN_API_KEY')
    expect(init.method).toBeUndefined()
    expect(JSON.stringify(init)).not.toContain('sk-')
  })

  it('caches per name and joins concurrent callers of the same name', async () => {
    const mock = stubFetch({ ok: true, infos: [] })
    await Promise.all([
      balanceStore.load({ kind: 'ref', ref: 'A_KEY' }),
      balanceStore.load({ kind: 'ref', ref: 'A_KEY' }),
    ])
    expect(mock).toHaveBeenCalledTimes(1)
    await balanceStore.load({ kind: 'ref', ref: 'B_KEY' })
    expect(mock).toHaveBeenCalledTimes(2)
    await balanceStore.load({ kind: 'ref', ref: 'A_KEY' })
    expect(mock).toHaveBeenCalledTimes(2)
    expect(balanceStore.snapshot({ kind: 'ref', ref: 'A_KEY' })).toBeDefined()
    expect(balanceStore.snapshot({ kind: 'ref', ref: 'C_KEY' })).toBeUndefined()
  })

  it('sends a pasted key in the request body, never in the URL, and caches nothing', async () => {
    const mock = stubFetch({ ok: true, manual: true, infos: [] })
    const request = { kind: 'manual' as const, key: 'sk-pasted-1234567890', remember: true, rememberAs: 'A_KEY' }
    await balanceStore.load(request, true)
    await balanceStore.load(request, true)
    const [url, init] = mock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/cost-stats/balance')
    expect(JSON.parse(String(init.body))).toEqual({
      key: 'sk-pasted-1234567890',
      remember: true,
      rememberAs: 'A_KEY',
    })
    // Two clicks, two queries: a one-off secret is never reused from a cache.
    expect(mock).toHaveBeenCalledTimes(2)
  })

  it('forces a refetch when asked, and turns a broken response into a payload', async () => {
    const mock = stubFetch({ ok: true, infos: [] })
    await balanceStore.load({ kind: 'ref', ref: 'A_KEY' })
    await balanceStore.load({ kind: 'ref', ref: 'A_KEY' }, true)
    const [url] = mock.mock.calls[1] as unknown as [string]
    expect(url).toContain('refresh=1')
    expect(mock).toHaveBeenCalledTimes(2)

    globalThis.fetch = vi.fn(async () => { throw new Error('offline') }) as unknown as typeof fetch
    const payload = await balanceStore.load({ kind: 'ref', ref: 'OFFLINE_KEY' })
    expect(payload.ok).toBe(false)
    expect(payload.reason).toBe('network')
  })
})
