import { describe, expect, it, vi } from 'vitest'
import {
  API_KEY_REF,
  credentialsOf,
  describeApiKey,
  isApiKeyRef,
  isApiKeyValue,
  readApiKey,
  rememberApiKey,
} from '../src/host/api-key.ts'
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

/**
 * A POST request stub whose body arrives through the async iterator, which is
 * how Node hands a request body to a route handler.
 * @param body - the value to serialize, or a raw string for a malformed body.
 * @returns the request stub.
 */
function postStub(body: unknown): Parameters<typeof handleBalanceRequest>[1] {
  const text = typeof body === 'string' ? body : JSON.stringify(body)
  return {
    method: 'POST',
    url: '/cost-stats/balance',
    headers: { host: '127.0.0.1:3080', 'content-type': 'application/json' },
    socket: { remoteAddress: '::1' },
    [Symbol.asyncIterator]: (): AsyncIterator<unknown> => {
      let sent = false
      return {
        next: async (): Promise<IteratorResult<Uint8Array>> => {
          if (sent) return { done: true, value: undefined }
          sent = true
          return { done: false, value: new TextEncoder().encode(text) }
        },
      }
    },
  }
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
    expect(await readApiKey(contextWith(async () => undefined)))
      .toEqual({ ok: false, reason: 'no-key', ref: API_KEY_REF })
    expect(await readApiKey(contextWith(async () => ({ value: '   ' }))))
      .toEqual({ ok: false, reason: 'no-key', ref: API_KEY_REF })
  })

  it('reports credentials-unavailable when the service is missing', async () => {
    expect(await readApiKey({})).toEqual({ ok: false, reason: 'credentials-unavailable', ref: API_KEY_REF })
  })

  it('treats a throwing resolver as unavailable, not as "no key"', async () => {
    const ctx = contextWith(async () => { throw new Error('locked') })
    expect(await readApiKey(ctx)).toEqual({ ok: false, reason: 'credentials-unavailable', ref: API_KEY_REF })
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

  it('survives a cordis context that THROWS on an uninjected service property', async () => {
    // The 0.8.0 bug: cordis's proxy get-trap raises
    // `cannot get property "credentials" without inject` for any service the
    // plugin did not declare in `inject`, and the bare `ctx.credentials` read sat
    // outside the guard — the page showed "余额查询失败" for a thrown lookup.
    const throwing = new Proxy({}, {
      get: (_target, prop) => {
        if (prop === 'get') return undefined
        throw new Error(`cannot get property "${String(prop)}" without inject`)
      },
    })
    expect(credentialsOf(throwing)).toBeUndefined()
    // Crucially: a reason code, not an escaping exception.
    expect(await readApiKey(throwing)).toEqual({ ok: false, reason: 'credentials-unavailable', ref: API_KEY_REF })
  })

  it('prefers a working ctx.get over a throwing property', async () => {
    const service = { resolve: async () => ({ value: 'sk-from-get' }) }
    const ctx = {
      get: (name: string) => (name === 'credentials' ? service : undefined),
    }
    // A context where the property probe WOULD throw (no `credentials` own key).
    expect(await readApiKey(ctx)).toEqual({ ok: true, key: 'sk-from-get' })
  })

  it('passes strict=false to the cordis lookup so an inactive service is not required', async () => {
    const calls: unknown[][] = []
    const ctx = {
      get: (...args: unknown[]) => {
        calls.push(args)
        return { resolve: async () => ({ value: 'sk-test' }) }
      },
    }
    await readApiKey(ctx)
    expect(calls[0]).toEqual(['credentials', false])
  })

  it('falls back to ctx.reflect.get when a throwing property comes first', async () => {
    const service = { resolve: async () => ({ value: 'sk-from-reflect' }) }
    const reflect = { get: (name: string, strict?: boolean) => (name === 'credentials' && strict === false ? service : undefined) }
    const ctx = new Proxy({ reflect } as Record<string, unknown>, {
      get: (target, prop) => {
        if (prop === 'reflect') return target.reflect
        // `get` and `credentials` both unavailable/illegal here.
        throw new Error(`cannot get property "${String(prop)}" without inject`)
      },
    })
    expect(await readApiKey(ctx)).toEqual({ ok: true, key: 'sk-from-reflect' })
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
    await readBalance(deps, { force: true })
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

  it('queries the credential named in the query string', async () => {
    resetBalanceCache()
    const resolve = vi.fn(async (ref: string) => ({ value: `sk-${ref}` }))
    const fetchImpl = vi.fn(async (_input: string, _init?: RequestInit) => new Response(JSON.stringify({
      balance_infos: [{ currency: 'CNY', total_balance: '1.00' }],
    }), { status: 200 }))
    const { res, body } = responseStub()
    await handleBalanceRequest(
      { credentials: { resolve } },
      {
        url: '/cost-stats/balance?ref=MIXTOKEN_API_KEY',
        headers: { host: '127.0.0.1:3080' },
        socket: { remoteAddress: '::1' },
      },
      res,
      { fetchImpl: fetchImpl as never },
    )
    expect(resolve).toHaveBeenCalledWith('MIXTOKEN_API_KEY')
    expect((fetchImpl.mock.calls[0]?.[1] as RequestInit).headers).toMatchObject({ authorization: 'Bearer sk-MIXTOKEN_API_KEY' })
    // The payload names the key so the chip can say whose money this is…
    expect(body().ref).toBe('MIXTOKEN_API_KEY')
    // …and still carries no value.
    expect(JSON.stringify(body())).not.toContain('sk-')
  })

  it('takes a pasted key from a POST body and echoes no trace of it', async () => {
    resetBalanceCache()
    const fetchImpl = vi.fn(async (_input: string, _init?: RequestInit) => new Response(JSON.stringify({
      balance_infos: [{ currency: 'CNY', total_balance: '9.99' }],
    }), { status: 200 }))
    const { res, body } = responseStub()
    await handleBalanceRequest(
      { credentials: { resolve: vi.fn() } },
      postStub({ key: 'sk-pasted-secret-1234' }),
      res,
      { fetchImpl: fetchImpl as never },
    )
    expect((fetchImpl.mock.calls[0]?.[1] as RequestInit).headers)
      .toMatchObject({ authorization: 'Bearer sk-pasted-secret-1234' })
    expect(body().ok).toBe(true)
    expect(body().manual).toBe(true)
    expect(body().ref).toBeUndefined()
    expect(JSON.stringify(body())).not.toContain('sk-pasted')
    expect(String(fetchImpl.mock.calls[0]?.[0])).not.toContain('sk-pasted')
  })

  it('answers bad-request for a body that is not JSON, without querying', async () => {
    resetBalanceCache()
    const fetchImpl = vi.fn()
    const { res, body } = responseStub()
    await handleBalanceRequest(
      { credentials: { resolve: vi.fn() } },
      postStub('not json at all'),
      res,
      { fetchImpl: fetchImpl as never },
    )
    expect(res.statusCode).toBe(200)
    expect(body().reason).toBe('bad-request')
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})

describe('isApiKeyRef and isApiKeyValue', () => {
  it('accepts the POSIX-style names the credential store is keyed by', () => {
    for (const name of ['DEEPSEEK_API_KEY', 'MIXTOKEN_API_KEY', '_x', 'A1']) {
      expect(isApiKeyRef(name)).toBe(true)
    }
  })

  it('refuses names that are not references', () => {
    for (const name of ['', '1ABC', 'has-dash', 'has space', 'a'.repeat(65), 'sk-abc', null, 42]) {
      expect(isApiKeyRef(name)).toBe(false)
    }
  })

  it('accepts a plausible key and refuses whitespace, control characters and absurd lengths', () => {
    expect(isApiKeyValue('sk-1234567890abcdef')).toBe(true)
    expect(isApiKeyValue('  sk-1234567890abcdef \n')).toBe(true)
    expect(isApiKeyValue('sk-1234')).toBe(false)
    expect(isApiKeyValue('sk-1234 5678')).toBe(false)
    expect(isApiKeyValue('sk-1234\n5678')).toBe(false)
    expect(isApiKeyValue('x'.repeat(600))).toBe(false)
    expect(isApiKeyValue(undefined)).toBe(false)
  })
})

describe('describeApiKey', () => {
  it('maps a boolean answer', async () => {
    expect(await describeApiKey({ credentials: { resolve: vi.fn(), describe: () => true } }, 'A_KEY')).toBe('set')
    expect(await describeApiKey({ credentials: { resolve: vi.fn(), describe: () => false } }, 'A_KEY')).toBe('unset')
  })

  it('maps the object shapes a build may use', async () => {
    expect(await describeApiKey({ credentials: { resolve: vi.fn(), describe: () => ({ configured: true }) } }, 'A_KEY'))
      .toBe('set')
    expect(await describeApiKey({ credentials: { resolve: vi.fn(), describe: () => ({ set: false }) } }, 'A_KEY'))
      .toBe('unset')
  })

  it('answers unknown when this build has no describe, or when it throws', async () => {
    expect(await describeApiKey({ credentials: { resolve: vi.fn() } }, 'A_KEY')).toBe('unknown')
    expect(await describeApiKey({ credentials: { resolve: vi.fn() } }, 'not a ref')).toBe('unset')
    const throwing = { credentials: { resolve: vi.fn(), describe: () => { throw new Error('locked') } } }
    expect(await describeApiKey(throwing, 'A_KEY')).toBe('unknown')
  })

  it('never sees a value: the answer it passes on is a state, not a secret', async () => {
    // The service is asked for a state; whatever a build returns, only a state
    // leaves this function.
    const service = { resolve: vi.fn(), describe: async () => ({ configured: true, value: 'sk-LEAK' }) }
    const state = await describeApiKey({ credentials: service }, 'A_KEY')
    expect(state).toBe('set')
    expect(JSON.stringify(state)).not.toContain('sk-')
  })
})

describe('rememberApiKey', () => {
  it('writes through the credential service, trimmed', async () => {
    const set = vi.fn()
    const ctx = { credentials: { resolve: vi.fn(), set } }
    expect(await rememberApiKey(ctx, 'DEEPSEEK_API_KEY_2', '  sk-1234567890abcdef  ')).toBe('saved')
    expect(set).toHaveBeenCalledWith('DEEPSEEK_API_KEY_2', 'sk-1234567890abcdef')
  })

  it('reports unsupported when the service cannot write', async () => {
    expect(await rememberApiKey({ credentials: { resolve: vi.fn() } }, 'A_KEY', 'sk-1234567890abcdef'))
      .toBe('unsupported')
    expect(await rememberApiKey({}, 'A_KEY', 'sk-1234567890abcdef')).toBe('unsupported')
  })

  it('reports failed without the service message, and never calls set for junk', async () => {
    const set = vi.fn(() => { throw new Error('cannot store sk-1234567890abcdef') })
    expect(await rememberApiKey({ credentials: { resolve: vi.fn(), set } }, 'A_KEY', 'sk-1234567890abcdef'))
      .toBe('failed')
    set.mockClear()
    expect(await rememberApiKey({ credentials: { resolve: vi.fn(), set } }, 'not a ref', 'sk-1234567890abcdef'))
      .toBe('failed')
    expect(await rememberApiKey({ credentials: { resolve: vi.fn(), set } }, 'A_KEY', 'sk-123'))
      .toBe('failed')
    expect(set).not.toHaveBeenCalled()
  })
})

describe('readBalance by credential name', () => {
  /** A context whose two keys resolve to different values. */
  function twoKeys(): object {
    return {
      credentials: {
        resolve: async (ref: string) => ({ value: ref === 'A_KEY' ? 'sk-aaa' : 'sk-bbb' }),
      },
    }
  }

  it('resolves the requested reference instead of the default', async () => {
    resetBalanceCache()
    const fetchImpl = vi.fn(async (_input: string, _init?: RequestInit) => new Response(JSON.stringify({
      balance_infos: [{ currency: 'CNY', total_balance: '1.00' }],
    }), { status: 200 }))
    const payload = await readBalance({ ctx: twoKeys(), fetchImpl: fetchImpl as never }, { ref: 'A_KEY' })
    expect((fetchImpl.mock.calls[0]?.[1] as RequestInit).headers).toMatchObject({ authorization: 'Bearer sk-aaa' })
    expect(payload.ref).toBe('A_KEY')
  })

  it('caches per name, so switching keys never shows the other key\'s money', async () => {
    resetBalanceCache()
    let total = '1.00'
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      balance_infos: [{ currency: 'CNY', total_balance: total }],
    }), { status: 200 }))
    const deps = { ctx: twoKeys(), fetchImpl: fetchImpl as never, now: () => 1000, ttlMs: 60_000 }
    const first = await readBalance(deps, { ref: 'A_KEY' })
    total = '2.00'
    const second = await readBalance(deps, { ref: 'B_KEY' })
    const again = await readBalance(deps, { ref: 'A_KEY' })
    expect(first.infos?.[0]?.total).toBe(1)
    expect(second.infos?.[0]?.total).toBe(2)
    // The cached A answer is still A's, and no third request was needed.
    expect(again.infos?.[0]?.total).toBe(1)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('names the reference in the failure too, and refuses a malformed one without the service', async () => {
    resetBalanceCache()
    const resolve = vi.fn(async () => undefined)
    const payload = await readBalance({ ctx: { credentials: { resolve } }, fetchImpl: vi.fn() as never }, { ref: 'B_KEY' })
    expect(payload.reason).toBe('no-key')
    expect(payload.message).toContain('B_KEY')

    const untouched = vi.fn()
    const bad = await readBalance(
      { ctx: { credentials: { resolve: untouched } }, fetchImpl: vi.fn() as never },
      { ref: 'not a ref' },
    )
    expect(bad.reason).toBe('bad-request')
    expect(untouched).not.toHaveBeenCalled()
  })
})

describe('readBalance with a pasted key', () => {
  it('uses the key, marks the payload manual, and caches nothing', async () => {
    resetBalanceCache()
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      balance_infos: [{ currency: 'CNY', total_balance: '7.00' }],
    }), { status: 200 }))
    const deps = { ctx: {}, fetchImpl: fetchImpl as never, now: () => 1000, ttlMs: 60_000 }
    const first = await readBalance(deps, { key: 'sk-pasted-1234567890' })
    const second = await readBalance(deps, { key: 'sk-pasted-1234567890' })
    expect(first.manual).toBe(true)
    expect(second.manual).toBe(true)
    // A one-off secret is never reused: two clicks mean two requests.
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('refuses a malformed key before it reaches a request header', async () => {
    resetBalanceCache()
    const fetchImpl = vi.fn()
    const payload = await readBalance({ ctx: {}, fetchImpl: fetchImpl as never }, { key: 'sk-bad\nkey' })
    expect(payload.reason).toBe('bad-request')
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('stores the key only when asked, and reports what happened', async () => {
    resetBalanceCache()
    const set = vi.fn()
    const fetchImpl = async (): Promise<Response> => new Response(JSON.stringify({
      balance_infos: [{ currency: 'CNY', total_balance: '7.00' }],
    }), { status: 200 })
    const query = { key: 'sk-pasted-1234567890', remember: true, rememberAs: 'A_KEY' }

    const saved = await readBalance(
      { ctx: { credentials: { resolve: vi.fn(), set } }, fetchImpl: fetchImpl as never },
      query,
    )
    expect(set).toHaveBeenCalledWith('A_KEY', 'sk-pasted-1234567890')
    expect(saved.remembered).toBe('saved')
    expect(saved.ok).toBe(true)
    expect(JSON.stringify(saved)).not.toContain('sk-pasted')

    const unsupported = await readBalance({ ctx: {}, fetchImpl: fetchImpl as never }, query)
    expect(unsupported.remembered).toBe('unsupported')
    // Failing to store still answers with the balance: the query was the point.
    expect(unsupported.ok).toBe(true)
  })
})
