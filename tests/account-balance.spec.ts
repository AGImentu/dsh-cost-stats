import { describe, expect, it, vi } from 'vitest'
import {
  accountServiceOf,
  parseAccountBalance,
  readAccountBalance,
  type AccountRequest,
} from '../src/host/account-balance.ts'
import { handleBalanceRequest, resetBalanceCache } from '../src/host/balance-route.ts'
import { ACCOUNT_CHOICE_ID } from '../src/balance.ts'
import type { BalancePayload } from '../src/balance.ts'

/** A service answering with one canned payload. */
function serviceWith(getBalance: (request: AccountRequest) => unknown): object {
  return { get: (name: string, strict?: boolean) => (name === 'deepseekAccount' && strict === false ? { getBalance } : undefined) }
}

/** The shape DSH's service answers with for a signed-in account. */
const READY = {
  status: 'ready',
  value: [{ currency: 'CNY', balance: '1.4800000000000000' }],
  bonusWallets: [{ currency: 'CNY', balance: '0.3700000000000000' }],
}

describe('accountServiceOf', () => {
  it('reaches the service with the non-strict lookup only', () => {
    const calls: unknown[][] = []
    const service = { getBalance: vi.fn() }
    const ctx = {
      get: (...args: unknown[]) => {
        calls.push(args)
        // A strict lookup answers nothing (this service is not injected).
        return args[1] === false ? service : undefined
      },
    }
    expect(accountServiceOf(ctx)).toBe(service)
    expect(calls[0]).toEqual(['deepseekAccount', false])
  })

  it('falls back to the reflect store, then to a bare property', () => {
    const service = { getBalance: vi.fn() }
    const reflect = { get: (name: string, strict?: boolean) => (name === 'deepseekAccount' && strict === false ? service : undefined) }
    expect(accountServiceOf({ reflect })).toBe(service)
    expect(accountServiceOf({ deepseekAccount: service })).toBe(service)
  })

  it('answers undefined instead of throwing on a hostile context', () => {
    const throwing = new Proxy({}, {
      get: (_target, prop) => {
        if (prop === 'get' || prop === 'reflect') return undefined
        throw new Error(`cannot get property "${String(prop)}" without inject`)
      },
    })
    expect(accountServiceOf(throwing)).toBeUndefined()
    expect(accountServiceOf({})).toBeUndefined()
    expect(accountServiceOf({ deepseekAccount: { notAService: true } })).toBeUndefined()
  })
})

describe('parseAccountBalance', () => {
  it('reports the paid and granted lines as one total per currency', () => {
    const payload = parseAccountBalance(READY, 1_700_000_000_000)
    expect(payload).toEqual({
      ok: true,
      available: true,
      infos: [{ currency: 'CNY', toppedUp: 1.48, granted: 0.37, total: 1.85 }],
      at: 1_700_000_000_000,
      account: true,
      ref: ACCOUNT_CHOICE_ID,
    })
  })

  it('keeps every currency the account holds, summing each wallet list', () => {
    const payload = parseAccountBalance({
      status: 'ready',
      value: [{ currency: 'CNY', balance: '1.00' }, { currency: 'USD', balance: '2.00' }],
      bonusWallets: [{ currency: 'CNY', balance: '0.50' }, { currency: 'USD', balance: '0.25' }],
    }, 1)
    expect(payload.infos).toEqual([
      { currency: 'CNY', toppedUp: 1, granted: 0.5, total: 1.5 },
      { currency: 'USD', toppedUp: 2, granted: 0.25, total: 2.25 },
    ])
  })

  it('reads a granted-only account, and drops rows it cannot parse', () => {
    const payload = parseAccountBalance({
      status: 'ready',
      value: [{ currency: 'CNY', balance: 'not-a-number' }],
      bonusWallets: [{ currency: 'CNY', balance: '0.37' }, { balance: '1' }, null],
    }, 1)
    expect(payload.infos).toEqual([{ currency: 'CNY', toppedUp: 0, granted: 0.37, total: 0.37 }])
  })

  it('turns a non-ready status into a readable reason, quoting the status', () => {
    const payload = parseAccountBalance({ status: 'credential-stored' }, 1)
    expect(payload.ok).toBe(false)
    expect(payload.reason).toBe('account-unavailable')
    expect(payload.message).toContain('credential-stored')
    expect(payload.account).toBe(true)
    // No numbers are invented for a signed-out account.
    expect(payload.infos).toBeUndefined()
  })

  it('refuses answers it cannot read at all', () => {
    expect(parseAccountBalance('nope', 1).reason).toBe('account-unavailable')
    expect(parseAccountBalance(null, 1).reason).toBe('account-unavailable')
    expect(parseAccountBalance({ status: 'ready', value: [], bonusWallets: [] }, 1).reason).toBe('bad-response')
  })
})

describe('readAccountBalance', () => {
  it('asks with the shape the service needs, and never touches a credential', async () => {
    const request = vi.fn(async () => READY)
    const payload = await readAccountBalance(serviceWith(request), () => 42)
    expect(payload.ok).toBe(true)
    expect(payload.ref).toBe(ACCOUNT_CHOICE_ID)
    const [args] = request.mock.calls[0] as unknown as [AccountRequest]
    expect(args.version).toBe(1)
    expect(typeof args.locale).toBe('string')
    expect(args.locale.length).toBeGreaterThan(0)
    expect(Number.isFinite(args.timezoneOffsetSeconds)).toBe(true)
  })

  it('reports a missing service instead of failing the page', async () => {
    const payload = await readAccountBalance({}, () => 1)
    expect(payload.reason).toBe('account-unavailable')
    expect(payload.message).toContain('账号')
  })

  it('reports a throwing service as ONE bounded line (no stack dump)', async () => {
    const payload = await readAccountBalance(
      serviceWith(() => { throw new Error(`boom\nat somewhere\n${'x'.repeat(400)}`) }),
      () => 1,
    )
    expect(payload.reason).toBe('account-unavailable')
    const message = payload.message ?? ''
    expect(message).not.toContain('\n')
    expect(message.length).toBeLessThanOrEqual(200)
  })
})

describe('the balance route\'s account branch', () => {
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

  it('serves the account balance for ?account=1 without asking for any credential', async () => {
    resetBalanceCache()
    const resolve = vi.fn()
    const { res, body } = responseStub()
    await handleBalanceRequest(
      { credentials: { resolve }, ...serviceWith(async () => READY) },
      { url: '/cost-stats/balance?account=1', headers: { host: '127.0.0.1:3080' }, socket: { remoteAddress: '::1' } },
      res,
    )
    expect(res.statusCode).toBe(200)
    expect(body().account).toBe(true)
    expect(body().ref).toBe(ACCOUNT_CHOICE_ID)
    expect(body().infos?.[0]?.total).toBe(1.85)
    // The account has no key: the credential service must not be consulted.
    expect(resolve).not.toHaveBeenCalled()
  })

  it('keeps the last good account answer when a later read fails', async () => {
    resetBalanceCache()
    const service = { get: () => ({ getBalance: async () => READY }) }
    const local = { url: '/cost-stats/balance?account=1&refresh=1', headers: { host: '127.0.0.1:3080' }, socket: { remoteAddress: '::1' } }
    const first = responseStub()
    await handleBalanceRequest(service, local, first.res)
    expect(first.body().ok).toBe(true)

    const broken = { get: () => ({ getBalance: async () => { throw new Error('nope') } }) }
    const second = responseStub()
    await handleBalanceRequest(broken, local, second.res)
    expect(second.body().ok).toBe(true)
    expect(second.body().infos?.[0]?.total).toBe(1.85)
  })
})
