import { describe, expect, it } from 'vitest'
import { isLocalRequest, parseBalance } from '../src/host/balance.ts'

describe('parseBalance', () => {
  it('reads DeepSeek\'s string amounts and the availability flag', () => {
    const payload = parseBalance({
      is_available: true,
      balance_infos: [{ currency: 'USD', total_balance: '5.24', granted_balance: '0.00', topped_up_balance: '5.24' }],
    })
    expect(payload).toEqual({
      ok: true,
      available: true,
      infos: [{ currency: 'USD', total: 5.24, granted: 0, toppedUp: 5.24 }],
    })
  })

  it('keeps every currency the account holds', () => {
    const payload = parseBalance({
      is_available: true,
      balance_infos: [
        { currency: 'CNY', total_balance: '38.10', granted_balance: '1.10', topped_up_balance: '37.00' },
        { currency: 'USD', total_balance: '5.24', granted_balance: '0.00', topped_up_balance: '5.24' },
      ],
    })
    expect(payload.ok).toBe(true)
    expect(payload.infos?.map(info => info.currency)).toEqual(['CNY', 'USD'])
    expect(payload.infos?.[0]?.granted).toBe(1.1)
  })

  it('reports an unusable entry instead of pretending the balance is zero', () => {
    const payload = parseBalance({ is_available: true, balance_infos: [{ currency: 'USD', total_balance: 'n/a' }] })
    expect(payload.ok).toBe(false)
    expect(payload.reason).toBe('bad-response')
  })

  it('drops only the broken entry when others are readable', () => {
    const payload = parseBalance({
      balance_infos: [
        { currency: 'USD', total_balance: '1.00' },
        { currency: 'CNY', total_balance: null },
      ],
    })
    expect(payload.infos).toHaveLength(1)
    expect(payload.infos?.[0]?.currency).toBe('USD')
    // Absent components fall back to 0 rather than NaN.
    expect(payload.infos?.[0]?.granted).toBe(0)
  })

  it('carries is_available: false through as "not usable"', () => {
    const payload = parseBalance({ is_available: false, balance_infos: [{ currency: 'USD', total_balance: '0.00' }] })
    expect(payload.available).toBe(false)
    expect(payload.ok).toBe(true)
  })

  it('rejects non-objects and empty currency lists', () => {
    expect(parseBalance('nope').reason).toBe('bad-response')
    expect(parseBalance(null).reason).toBe('bad-response')
    expect(parseBalance({ is_available: true }).reason).toBe('bad-response')
  })

  it('refuses negative amounts', () => {
    expect(parseBalance({ balance_infos: [{ currency: 'USD', total_balance: '-3' }] }).ok).toBe(false)
  })
})

describe('isLocalRequest', () => {
  it('accepts loopback peers in every address form a local server sees', () => {
    for (const remoteAddress of ['127.0.0.1', '127.0.0.5', '::1', '::ffff:127.0.0.1']) {
      expect(isLocalRequest({ socket: { remoteAddress }, headers: { host: '127.0.0.1:3080' } })).toBe(true)
    }
  })

  it('accepts a localhost Host header', () => {
    expect(isLocalRequest({ headers: { host: 'localhost:3080' } })).toBe(true)
    expect(isLocalRequest({ headers: { host: 'localhost' } })).toBe(true)
  })

  it('refuses a remote peer', () => {
    expect(isLocalRequest({ socket: { remoteAddress: '10.0.0.7' }, headers: { host: 'localhost:3080' } })).toBe(false)
  })

  it('refuses a public Host header even when the peer address is missing', () => {
    expect(isLocalRequest({ headers: { host: 'example.com' } })).toBe(false)
  })

  it('reads the array header form', () => {
    expect(isLocalRequest({ headers: { host: ['example.com', 'x'] } })).toBe(false)
  })

  it('allows an unknown shape so a transport that exposes neither still works', () => {
    expect(isLocalRequest({})).toBe(true)
  })
})
