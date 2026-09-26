/**
 * The balance route: `GET /cost-stats/balance`.
 *
 * Sequence per request: refuse non-local callers → resolve the API key from
 * DSH's credential service → call DeepSeek once → return numbers only. The key
 * appears in the outbound `Authorization` header and nowhere else: it is not
 * logged, not echoed, and not part of any response, so this route can be public
 * code without being a leak.
 *
 * A short cache (below) exists for one reason: opening the settings page is a
 * human action, and a human can open it five times in ten seconds. DeepSeek's
 * endpoint is rate limited, so the plugin absorbs that instead of forwarding it.
 *
 * @module dsh-cost-stats/host/balance-route
 */

import { BALANCE_URL, isLocalRequest, parseBalance } from './balance.ts'
import { API_KEY_REF, readApiKey } from './api-key.ts'
import { BALANCE_ROUTE } from '../routes.ts'
import type { BalancePayload } from '../balance.ts'
import type { HostContextLike, ServerRequestLike, ServerResponseLike } from './contract.ts'

/** How long one successful answer is reused, in ms. */
export const BALANCE_TTL_MS = 15_000

/** How long to wait for DeepSeek before giving up, in ms. */
const TIMEOUT_MS = 8_000

/** A cached answer, keyed by nothing (one account per harness). */
let cached: { readonly at: number, readonly payload: BalancePayload } | undefined

/** The last successful answer, whatever its age: served while a refresh fails. */
let lastGood: BalancePayload | undefined

/** Reset the module's memo. Used by tests and by the route's own force path. */
export function resetBalanceCache(): void {
  cached = undefined
  lastGood = undefined
}

/** Fetch-shaped function, injectable for tests. */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

/** Dependencies the route needs, injectable so the sequence is testable. */
export interface BalanceDeps {
  readonly ctx: object
  readonly fetchImpl?: FetchLike
  readonly now?: () => number
  readonly ttlMs?: number
}

/**
 * Answer with a failure payload without touching the network.
 * @param reason - machine-readable kind.
 * @param message - short human-readable detail.
 * @returns the payload.
 */
function failure(reason: BalancePayload['reason'], message: string): BalancePayload {
  return { ok: false, reason, message }
}

/**
 * Query DeepSeek for the current balance.
 *
 * The key is read here and handed straight to `fetch`; it is never stored in a
 * module-level variable, which is why the cache can only ever hold numbers.
 * @param deps - context, fetch, clock and TTL.
 * @param force - ignore the cache (the page's refresh action).
 * @returns the payload to serve.
 */
export async function readBalance(deps: BalanceDeps, force = false): Promise<BalancePayload> {
  const now = deps.now ?? Date.now
  const ttl = deps.ttlMs ?? BALANCE_TTL_MS
  if (!force && cached !== undefined && now() - cached.at < ttl) return cached.payload

  const key = await readApiKey(deps.ctx)
  if (!key.ok) {
    // A configuration problem is not a network failure: report it plainly, and
    // do not cache it, so fixing the key shows up on the next open.
    return failure(key.reason, key.reason === 'no-key'
      ? `未找到凭据 ${API_KEY_REF}(在 DSH 的模型设置里配置后即可显示余额)`
      : '读取凭据服务失败,无法取得 API key')
  }

  const doFetch = deps.fetchImpl ?? ((input, init) => fetch(input, init))
  let response: Response
  try {
    response = await doFetch(BALANCE_URL, {
      headers: { authorization: `Bearer ${key.key}`, accept: 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch {
    // Never surface the underlying error text: a fetch failure message can
    // include the request (and therefore headers) in some runtimes.
    return lastGood ?? failure('network', '调用 DeepSeek 余额接口失败(网络或超时)')
  }

  if (response.status === 401 || response.status === 403) {
    return failure('unauthorized', `DeepSeek 拒绝了这个 API key(HTTP ${String(response.status)})`)
  }
  if (!response.ok) {
    return lastGood ?? failure('network', `DeepSeek 余额接口返回 HTTP ${String(response.status)}`)
  }

  let payload: BalancePayload
  try {
    payload = parseBalance(await response.json())
  } catch {
    return lastGood ?? failure('bad-response', 'DeepSeek 余额接口返回了无法解析的内容')
  }
  if (!payload.ok) return lastGood ?? payload

  const answered = { ...payload, at: now() }
  cached = { at: answered.at ?? now(), payload: answered }
  lastGood = answered
  return answered
}

/**
 * Serve the route.
 * @param ctx - host context.
 * @param req - incoming request.
 * @param res - response to write.
 * @param deps - injectable dependencies (tests).
 * @returns nothing.
 */
export async function handleBalanceRequest(
  ctx: object,
  req: ServerRequestLike,
  res: ServerResponseLike,
  deps: Partial<BalanceDeps> = {},
): Promise<void> {
  const respond = (status: number, body: BalancePayload): void => {
    res.statusCode = status
    res.setHeader('content-type', 'application/json; charset=utf-8')
    res.setHeader('cache-control', 'no-store')
    res.end(JSON.stringify(body))
  }

  if (!isLocalRequest(req)) {
    respond(403, failure('forbidden', '余额接口仅对本机请求开放'))
    return
  }

  const force = (req.url ?? '').includes('refresh=1')
  const payload = await readBalance({ ctx, ...deps }, force)
  // Always 200: the payload's own `ok` distinguishes "queried" from "could not
  // query", and a page should render that reason instead of treating an empty
  // balance as an HTTP error.
  respond(200, payload)
}

/** Register the route. @returns the disposer. */
export function registerBalanceRoute(ctx: HostContextLike): () => void {
  return ctx.webServer.register({
    kind: 'exact',
    path: BALANCE_ROUTE,
    handler: (req, res) => {
      handleBalanceRequest(ctx, req as ServerRequestLike, res).catch(() => {
        // Any escape hatch still answers, so the page shows a state instead of
        // hanging; the failure is deliberately not logged with details.
        res.statusCode = 200
        res.setHeader('content-type', 'application/json; charset=utf-8')
        res.end(JSON.stringify(failure('network', '查询余额时发生未预期的错误')))
      })
    },
  })
}
