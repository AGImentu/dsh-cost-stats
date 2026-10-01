import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as balanceStore from '../src/client/balance-store.ts'
import * as keyStore from '../src/client/key-store.ts'
import type { KeysPayload } from '../src/balance.ts'

/** A catalog with two models, each mapped to the provider ids it pays for. */
function catalog(): KeysPayload {
  return {
    ok: true,
    default: 'DEEPSEEK_API_KEY',
    refs: [
      { ref: 'DEEPSEEK_API_KEY', label: 'DeepSeek', configured: true, origin: 'default', providers: ['deepseek-official'] },
      { ref: 'MIXTOKEN_API_KEY', label: 'https://api.mixtoken.ai/v1', configured: true, origin: 'store', provider: 'mixtoken', providers: ['mixtoken'] },
    ],
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

describe('the catalog cache', () => {
  it('fetches once per page and joins concurrent callers', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(catalog()), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }))
    globalThis.fetch = fetchMock as unknown as typeof fetch
    const [first, second] = await Promise.all([keyStore.load(), keyStore.load()])
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(first).toBe(second)
    expect(String((fetchMock.mock.calls[0] as unknown[])[0])).toBe('/cost-stats/keys')
    await keyStore.load()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('degrades to an empty catalog instead of rejecting', async () => {
    globalThis.fetch = vi.fn(async () => { throw new Error('offline') }) as unknown as typeof fetch
    const payload = await keyStore.load()
    expect(payload.ok).toBe(false)
    expect(payload.refs).toEqual([])
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

describe('the model filter', () => {
  it('filters nothing for 「全部」', () => {
    expect(keyStore.providerIdsOf({ kind: 'all' }, catalog())).toBeUndefined()
    expect(keyStore.providerIdsOf({ kind: 'all' }, undefined)).toBeUndefined()
  })

  it('maps a picked credential to the provider ids its traffic carries', () => {
    expect(keyStore.providerIdsOf({ kind: 'ref', ref: 'DEEPSEEK_API_KEY' }, catalog())).toEqual(['deepseek-official'])
    expect(keyStore.providerIdsOf({ kind: 'ref', ref: 'MIXTOKEN_API_KEY' }, catalog())).toEqual(['mixtoken'])
  })

  it('filters everything out for a credential with no known provider', () => {
    // An empty set is the honest answer: nothing can be attributed to that key,
    // so the table shows nothing rather than everything.
    expect(keyStore.providerIdsOf({ kind: 'ref', ref: 'UNKNOWN_KEY' }, catalog())).toEqual([])
  })

  it('finds a row by reference, and says so when there is none', () => {
    expect(keyStore.rowOf('MIXTOKEN_API_KEY', catalog())?.label).toBe('https://api.mixtoken.ai/v1')
    expect(keyStore.rowOf('UNKNOWN_KEY', catalog())).toBeUndefined()
    expect(keyStore.rowOf('MIXTOKEN_API_KEY', undefined)).toBeUndefined()
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
    await balanceStore.load('MIXTOKEN_API_KEY')
    const [url, init] = mock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/cost-stats/balance?ref=MIXTOKEN_API_KEY')
    expect(init.method).toBeUndefined()
    expect(JSON.stringify(init)).not.toContain('sk-')
  })

  it('caches per name and joins concurrent callers of the same name', async () => {
    const mock = stubFetch({ ok: true, infos: [] })
    await Promise.all([
      balanceStore.load('A_KEY'),
      balanceStore.load('A_KEY'),
    ])
    expect(mock).toHaveBeenCalledTimes(1)
    await balanceStore.load('B_KEY')
    expect(mock).toHaveBeenCalledTimes(2)
    await balanceStore.load('A_KEY')
    expect(mock).toHaveBeenCalledTimes(2)
    expect(balanceStore.snapshot('A_KEY')).toBeDefined()
    expect(balanceStore.snapshot('C_KEY')).toBeUndefined()
  })

  it('forces a refetch when asked, and turns a broken response into a payload', async () => {
    const mock = stubFetch({ ok: true, infos: [] })
    await balanceStore.load('A_KEY')
    await balanceStore.load('A_KEY', true)
    const [url] = mock.mock.calls[1] as unknown as [string]
    expect(url).toContain('refresh=1')
    expect(mock).toHaveBeenCalledTimes(2)

    globalThis.fetch = vi.fn(async () => { throw new Error('offline') }) as unknown as typeof fetch
    const payload = await balanceStore.load('OFFLINE_KEY')
    expect(payload.ok).toBe(false)
    expect(payload.reason).toBe('network')
  })
})
