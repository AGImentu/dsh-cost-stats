/**
 * Reading the DeepSeek balance: the parse rules and the local-only guard.
 *
 * Pure and dependency-free so both are unit-testable, and so the ONE module that
 * ever touches the API key stays next door in `api-key.ts` with nothing else to
 * distract a reader from the rule "the value never leaves this process".
 *
 * @module dsh-cost-stats/host/balance
 */

import type { BalanceInfo, BalancePayload } from '../balance.ts'

/** DeepSeek's balance endpoint (public, API-key authenticated). */
export const BALANCE_URL = 'https://api.deepseek.com/user/balance'

/**
 * Read a money amount from DeepSeek's string-encoded decimal.
 *
 * The API returns amounts as STRINGS (`"5.24"`), which is right for money, but a
 * mistyped or absent field must not become `NaN` in the page's arithmetic — a
 * rejected field is dropped instead.
 * @param value - raw field.
 * @returns the amount, or undefined when it is not a usable number.
 */
function amount(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) && value >= 0 ? value : undefined
  if (typeof value !== 'string') return undefined
  const parsed = Number(value.trim())
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined
}

/**
 * Turn DeepSeek's balance response into the wire payload.
 *
 * A currency entry with an unusable `total_balance` is dropped: the readout's
 * job is to show real money, so a broken entry is a broken answer rather than a
 * zero.
 * @param payload - the parsed JSON response.
 * @returns the payload, or a `bad-response` failure.
 */
export function parseBalance(payload: unknown): BalancePayload {
  if (payload === null || typeof payload !== 'object') {
    return { ok: false, reason: 'bad-response', message: '余额接口返回了非对象内容' }
  }
  const source = payload as Record<string, unknown>
  const raw = Array.isArray(source.balance_infos) ? source.balance_infos : []
  const infos: BalanceInfo[] = []
  for (const entry of raw) {
    if (entry === null || typeof entry !== 'object') continue
    const record = entry as Record<string, unknown>
    const total = amount(record.total_balance)
    const currency = typeof record.currency === 'string' && record.currency.length > 0 ? record.currency : undefined
    if (total === undefined || currency === undefined) continue
    infos.push({
      currency,
      total,
      granted: amount(record.granted_balance) ?? 0,
      toppedUp: amount(record.topped_up_balance) ?? 0,
    })
  }
  if (infos.length === 0) {
    return { ok: false, reason: 'bad-response', message: '余额接口没有返回可读的币种余额' }
  }
  return {
    ok: true,
    // `is_available` is advisory: absent means "assume usable" rather than
    // hiding a perfectly good balance.
    available: source.is_available !== false,
    infos,
  }
}

/** The request shape the guard reads. */
export interface LocalCheckRequest {
  readonly headers?: Readonly<Record<string, string | readonly string[] | undefined>>
  readonly socket?: { readonly remoteAddress?: string }
}

/** Whether an address is loopback in any of the forms a local server sees. */
function isLoopbackAddress(address: string): boolean {
  const value = address.toLowerCase()
  return value === '::1'
    || value === '127.0.0.1'
    || value.startsWith('127.')
    || value === '::ffff:127.0.0.1'
    || value.startsWith('::ffff:127.')
}

/** Whether a host header names this machine. */
function isLoopbackHost(host: string): boolean {
  const name = host.replace(/:\d+$/, '').replace(/^\[|\]$/g, '').toLowerCase()
  return name === 'localhost' || name === '127.0.0.1' || name === '::1'
}

/** Read a header value, tolerating the array form. */
function header(headers: LocalCheckRequest['headers'], name: string): string | undefined {
  const value = headers?.[name]
  if (typeof value === 'string') return value
  return Array.isArray(value) ? value[0] : undefined
}

/**
 * Whether a request may read the balance.
 *
 * This route is the only one in the plugin that touches a credential, so it
 * answers local callers only. The check is deliberately one-sided: a request is
 * refused when the peer address or the `Host` header is *provably* not local,
 * while an unknown shape (a mirror or a future transport that exposes neither)
 * still works — the alternative would break the feature on a version bump to
 * protect against a threat that DSH's loopback binding already covers.
 * @param request - the incoming request.
 * @returns true when the request looks local.
 */
export function isLocalRequest(request: LocalCheckRequest): boolean {
  const address = request.socket?.remoteAddress
  if (typeof address === 'string' && address.length > 0 && !isLoopbackAddress(address)) return false
  const host = header(request.headers, 'host')
  if (typeof host === 'string' && host.length > 0 && !isLoopbackHost(host)) return false
  return true
}
