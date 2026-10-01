/**
 * The login account's balance, through DSH's own account service.
 *
 * The official `/user/balance` endpoint only answers for API keys, and DSH's
 * login account has none: measured, its stored credential is a login token and
 * that endpoint refuses it with `401 Authentication Fails, Your api key … is
 * invalid`. The account balance the harness itself shows under 「设置 → 账号与余额」
 * comes from a different place — the host service `deepseekAccount` — and this
 * module is the same read, mirrored defensively like every other DSH contract in
 * this plugin:
 *
 * ```
 * deepseekAccount.getBalance({ version, locale, timezoneOffsetSeconds })
 *   -> { status: 'ready', value: [{ currency, balance }], bonusWallets: [{ currency, balance }] }
 * ```
 *
 * `value` is the money the reader topped up, `bonusWallets` is granted credit —
 * the two lines that page shows — so the plugin reports them in the same shape it
 * uses for a key: `toppedUp`, `granted`, and their sum as `total`.
 *
 * Everything here is optional by construction: a host without the service, a
 * reader who is signed out, and a status this build does not know all degrade to
 * a readable reason instead of an error.
 *
 * @module dsh-cost-stats/host/account-balance
 */

import { ACCOUNT_CHOICE_ID } from '../balance.ts'
import type { BalanceInfo, BalancePayload } from '../balance.ts'

/** One wallet line in the service's answer. */
interface WalletLike {
  readonly currency?: unknown
  readonly balance?: unknown
}

/** What `getBalance` answers. */
interface AccountBalanceLike {
  readonly status?: unknown
  readonly value?: unknown
  readonly bonusWallets?: unknown
}

/** The account service slice this plugin uses. */
export interface AccountServiceLike {
  /**
   * Read the signed-in account's balance.
   * @param request - `{ version, locale, timezoneOffsetSeconds }`; the service
   * needs a number, a locale string and a number, all of which it stringifies.
   * @returns the tagged answer, or something this plugin cannot read.
   */
  getBalance?(request: AccountRequest): Promise<unknown> | unknown
  /** Sign-in status and the platform links, when the service offers them. */
  getState?(): unknown
}

/** The request object the service expects. */
export interface AccountRequest {
  readonly version: number
  readonly locale: string
  readonly timezoneOffsetSeconds: number
}

/** Whether a value looks like the account service. */
function isAccountService(value: unknown): value is AccountServiceLike {
  return value !== null && typeof value === 'object'
    && (typeof (value as AccountServiceLike).getBalance === 'function'
      || typeof (value as AccountServiceLike).getState === 'function')
}

/** The context shapes probed below; every read is guarded (see `host/api-key`). */
interface ProbeContext {
  get?: (name: string, strict?: boolean) => unknown
  readonly reflect?: { get?: (name: string, strict?: boolean) => unknown }
  readonly deepseekAccount?: unknown
}

/**
 * Reach DSH's account service without making it a hard dependency.
 *
 * Same three-attempt shape as `credentialsOf`: cordis's non-strict lookup first,
 * then the reflect store, then a guarded property read — because a service this
 * plugin does not `inject` is not reachable by the strict form.
 * @param ctx - host context.
 * @returns the service, or undefined on a host that has none.
 */
export function accountServiceOf(ctx: object): AccountServiceLike | undefined {
  const probe = ctx as ProbeContext
  const attempts: readonly (() => unknown)[] = [
    () => (typeof probe.get === 'function' ? probe.get.call(ctx, 'deepseekAccount', false) : undefined),
    () => (typeof probe.reflect?.get === 'function'
      ? probe.reflect.get.call(probe.reflect, 'deepseekAccount', false)
      : undefined),
    () => probe.deepseekAccount,
  ]
  for (const attempt of attempts) {
    try {
      const candidate = attempt()
      if (isAccountService(candidate)) return candidate
    } catch {
      // A throwing accessor only means "not via this route"; try the next one.
    }
  }
  return undefined
}

/**
 * A number from a service answer, which sends decimals as strings.
 * @param value - candidate.
 * @returns the number, or undefined when it is not one.
 */
function numberOf(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return undefined
}

/**
 * One currency's line, added to an accumulator.
 * @param wallets - the rows.
 * @param into - currency → amount.
 * @returns nothing.
 */
function addWallets(wallets: unknown, into: Map<string, number>): void {
  if (!Array.isArray(wallets)) return
  for (const wallet of wallets as readonly WalletLike[]) {
    if (wallet === null || typeof wallet !== 'object') continue
    const currency = typeof wallet.currency === 'string' && wallet.currency !== '' ? wallet.currency : undefined
    const amount = numberOf(wallet.balance)
    if (currency === undefined || amount === undefined) continue
    into.set(currency, (into.get(currency) ?? 0) + amount)
  }
}

/**
 * Turn the service's answer into this plugin's balance payload.
 * @param answer - whatever `getBalance` returned.
 * @param at - the query instant.
 * @returns the payload.
 */
export function parseAccountBalance(answer: unknown, at: number): BalancePayload {
  if (answer === null || typeof answer !== 'object') {
    return { ok: false, reason: 'account-unavailable', message: '账号服务返回了无法识别的内容', account: true, ref: ACCOUNT_CHOICE_ID }
  }
  const result = answer as AccountBalanceLike
  const status = typeof result.status === 'string' ? result.status : undefined
  if (status !== 'ready') {
    // 'credential-stored' means signed in but nothing fetched; anything else is
    // this build's business. Either way the reader hears the status verbatim.
    return {
      ok: false,
      reason: 'account-unavailable',
      message: status === undefined
        ? '账号服务没有给出余额(可能未登录)'
        : `账号服务返回状态 ${status}(未登录时请到「设置 → 账号与余额」登录)`,
      account: true,
      ref: ACCOUNT_CHOICE_ID,
    }
  }

  const toppedUp = new Map<string, number>()
  const granted = new Map<string, number>()
  addWallets(result.value, toppedUp)
  addWallets(result.bonusWallets, granted)

  const infos: BalanceInfo[] = []
  for (const currency of new Set([...toppedUp.keys(), ...granted.keys()])) {
    const paid = toppedUp.get(currency) ?? 0
    const bonus = granted.get(currency) ?? 0
    infos.push({ currency, granted: bonus, toppedUp: paid, total: paid + bonus })
  }
  if (infos.length === 0) {
    return { ok: false, reason: 'bad-response', message: '账号余额里没有可读的金额', account: true, ref: ACCOUNT_CHOICE_ID }
  }
  return { ok: true, available: true, infos, at, account: true, ref: ACCOUNT_CHOICE_ID }
}

/**
 * Ask DSH for the login account's balance.
 * @param ctx - host context carrying the account service.
 * @param now - clock, injectable for tests.
 * @returns the payload to serve.
 */
export async function readAccountBalance(ctx: object, now: () => number = Date.now): Promise<BalancePayload> {
  const service = accountServiceOf(ctx)
  if (service?.getBalance === undefined) {
    return {
      ok: false,
      reason: 'account-unavailable',
      message: '这台 DSH 没有提供账号余额接口(插件只读它的账号服务)',
      account: true,
      ref: ACCOUNT_CHOICE_ID,
    }
  }
  const request: AccountRequest = {
    version: 1,
    locale: Intl.DateTimeFormat().resolvedOptions().locale || 'zh-CN',
    timezoneOffsetSeconds: -new Date().getTimezoneOffset() * 60,
  }
  try {
    return parseAccountBalance(await service.getBalance(request), now())
  } catch (error) {
    // One line, bounded: an internal message may carry a stack or a field dump,
    // and the page shows it in a tooltip.
    const message = (error instanceof Error ? error.message : String(error))
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 160)
    return {
      ok: false,
      reason: 'account-unavailable',
      message: `读取账号余额失败:${message}`,
      account: true,
      ref: ACCOUNT_CHOICE_ID,
    }
  }
}
