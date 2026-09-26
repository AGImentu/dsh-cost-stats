import { describe, expect, it, vi } from 'vitest'
import { credentialsOf, readApiKey, API_KEY_REF } from '../src/host/api-key.ts'
import { handleBalanceRequest, readBalance, resetBalanceCache } from '../src/host/balance-route.ts'
import type { BalancePayload } from '../src/balance.ts'

/** A host context whose credential service returns whatever the test wants. */
function contextWith(resolve: (ref: string) => Promise<{ value?: string } | undefined>): object {
  return { credentials: { resolve: vi.fn(resolve) } }
}

/** A response stub that records what the route wrote. */
function responseStub(): { res: Parameters<typeof handleBalanceRequest>[2], body: () => BalancePayload } {
  let text = ''
  const res = {
    statusCode: 0,
    setHeader: vi.fn(),
    end: (chunk?: string) => { text = chunk ?? '' },
  }
  return { res, body: () => JSON.parse(text) as BalancePayload }
}

/** A fetch stub returning one canned response. */
function fetchReturning(status: number, payload: unknown): typeof fetch {
  return vi.fn(async () => new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  })) as unknown as typeof fetch
}

describe('readApiKey', () => {
  it('resolves DEEPSEEK_API_KEY from the credential service', async () => {
    const result = await readApiKey(contextWith(async ref => (ref === API_KEY_REF ? { value: 'sk-test' } : undefined)))
    expect(result).toEqual({ ok: true, key: 'sk-test' })
  })

  it('trims a padded value', async () => {
    expect(await readApiKey(contextWith(async () => ({ value: '  sk-test \n' })))).toEqual({ ok: true, key: 'sk-test' })
  })

  it('reports no-key when the reference is unset or empty', async () => {
    expect(await readApiKey(contextWith(async () => undefined))).toEqual({ ok: false, reason: 'no-key' })
    expect(await readApiKey(contextWith(async () => ({ value: '   ' })))).toEqual({ ok: false, reason: 'no-key' })
  })

  it('reports credentials-unavailable when the service is missing', async () => {
    expect(await readApiKey({})).toEqual({ ok: false, reason: 'credentials-unavailable' })
  })

  it('treats a throwing resolver as unavailable, not as "no key"', async () => {
    const ctx = contextWith(async () => { throw new Error('locked') })
    expect(await readApiKey(ctx)).toEqual({ ok: false, reason: 'credentials-unavailable' })
  })

  it('never returns the key in a failure and never logs it', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    const ctx = contextWith(async () => { throw new Error('sk-secret-in-message') })
    const result = await readApiKey(ctx)
    expect(JSON.stringify(result)).not.toContain('sk-secret')
    expect(warn).not.toHaveBeenCalled()
    expect(log).not.toHaveBeenCalled()
    warn.mockRestore()
    log.mockRestore()
  })

  it('finds the service through ctx.get as well as the property', async () => {
    const get = vi.fn((name: string) => (name === 'credentials' ? { resolve: async () => ({ value: 'sk-via-get' }) } : undefined))
    const ctx = { get } as unknown as object
    expect(credentialsOf(ctx)).toBeDefined()
    expect(await readApiKey(ctx)).toEqual({ ok: true, key: 'sk-via-get' })
  })
})

describe('readBalance', () => {
  it('returns the parsed balance and stamps the query time', async () => {
    resetBalanceCache()
    const payload = await readBalance({
      ctx: contextWith(async () => ({ value: 'sk-test' })),
      fetchImpl: fetchReturning(200, {
        is_available: true,
        balance_infos: [{ currency: 'USD', total_balance: '5.24', granted_balance: '0.00', topped_up_balance: '5.24' }],
      }) as never,
      now: () => 1_700_000_000_000,
    })
    expect(payload.ok).toBe(true)
    expect(payload.at).toBe(1_700_000_000_000)
    expect(payload.infos?.[0]?.total).toBe(5.24)
  })

  it('sends the key only in the Authorization header', async () => {
    resetBalanceCache()
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      balance_infos: [{ currency: 'USD', total_balance: '1.00' }],
    }), { status: 200 }))
    await readBalance({
      ctx: contextWith(async () => ({ value: 'sk-secret' })),
      fetchImpl: fetchImpl as never,
    })
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.deepseek.com/user/balance')
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer sk-secret')
    // The URL must never carry the credential.
    expect(url).not.toContain('sk-secret')
  })

  it('maps 401 to unauthorized without leaking the response body', async () => {
    resetBalanceCache()
    const payload = await readBalance({
      ctx: contextWith(async () => ({ value: 'sk-secret' })),
      fetchImpl: fetchReturning(401, { error: 'invalid key sk-secret' }) as never,
    })
    expect(payload.reason).toBe('unauthorized')
    expect(JSON.stringify(payload)).not.toContain('sk-secret')
  })

  it('reports no-key without calling the network', async () => {
    resetBalanceCache()
    const fetchImpl = vi.fn()
    const payload = await readBalance({ ctx: contextWith(async () => undefined), fetchImpl: fetchImpl as never })
    expect(payload.reason).toBe('no-key')
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('serves the cache inside the TTL and refetches when forced', async () => {
    resetBalanceCache()
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      balance_infos: [{ currency: 'USD', total_balance: '2.00' }],
    }), { status: 200 }))
    const deps = { ctx: contextWith(async () => ({ value: 'sk-test' })), fetchImpl: fetchImpl as never, now: () => 1000, ttlMs: 1000 }
    await readBalance(deps)
    await readBalance(deps)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    await readBalance({ ...deps, now: () => 3000 })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    await readBalance(deps, true)
    expect(fetchImpl).toHaveBeenCalledTimes(3)
  })

  it('keeps the last good numbers when a refresh fails', async () => {
    resetBalanceCache()
    const ok = vi.fn(async () => new Response(JSON.stringify({
      balance_infos: [{ currency: 'USD', total_balance: '3.00' }],
    }), { status: 200 }))
    const deps = { ctx: contextWith(async () => ({ value: 'sk-test' })), fetchImpl: ok as never, now: () => 1000, ttlMs: 1 }
    await readBalance(deps)
    const payload = await readBalance({ ...deps, fetchImpl: (async () => { throw new Error('offline') }) as never })
    expect(payload.ok).toBe(true)
    expect(payload.infos?.[0]?.total).toBe(3)
  })
})

describe('handleBalanceRequest', () => {
  it('answers 403 for a non-local caller without touching the credential service', async () => {
    resetBalanceCache()
    const resolve = vi.fn()
    const { res, body } = responseStub()
    await handleBalanceRequest(
      { credentials: { resolve } },
      { headers: { host: 'example.com' }, socket: { remoteAddress: '203.0.113.9' } },
      res,
    )
    expect(res.statusCode).toBe(403)
    expect(body().reason).toBe('forbidden')
    expect(resolve).not.toHaveBeenCalled()
  })

  it('answers 200 with the numbers for a local caller', async () => {
    resetBalanceCache()
    const { res, body } = responseStub()
    await handleBalanceRequest(
      { credentials: { resolve: async () => ({ value: 'sk-test' }) } },
      { url: '/cost-stats/balance', headers: { host: '127.0.0.1:3080' }, socket: { remoteAddress: '::1' } },
      res,
      { fetchImpl: fetchReturning(200, { balance_infos: [{ currency: 'CNY', total_balance: '38.10' }] }) as never },
    )
    expect(res.statusCode).toBe(200)
    expect(body().ok).toBe(true)
    expect(body().infos?.[0]?.currency).toBe('CNY')
  })
})
