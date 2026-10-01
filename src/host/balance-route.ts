/**
 * The balance route: `GET /cost-stats/balance`.
 *
 * Sequence per request: refuse non-local callers → resolve the credential the
 * page named from DSH's store → call DeepSeek once → return numbers only. The
 * key value appears in the outbound `Authorization` header and nowhere else: it
 * is not logged, not echoed, not cached and not part of any response, so this
 * route can be public code without being a leak.
 *
 * Caches exist for one reason: a reader can click the query button five times in
 * ten seconds. DeepSeek's endpoint is rate limited, so the plugin absorbs that
 * instead of forwarding it. The cache is per credential NAME, so switching
 * models can never show the other key's money.
 *
 * @module dsh-cost-stats/host/balance-route
 */

import { BALANCE_URL, isLocalRequest, parseBalance } from './balance.ts'
import { API_KEY_REF, isApiKeyRef, readApiKey } from './api-key.ts'
import { BALANCE_ROUTE } from '../routes.ts'
import type { BalancePayload } from '../balance.ts'
import type { HostContextLike, ServerRequestLike, ServerResponseLike } from './contract.ts'

/** How long one successful answer is reused, in ms. */
export const BALANCE_TTL_MS = 15_000

/** How long to wait for DeepSeek before giving up, in ms. */
const TIMEOUT_MS = 8_000

/** One successful answer per credential name. */
let cached = new Map<string, { readonly at: number, readonly payload: BalancePayload }>()

/** The last successful answer per name: served while a refresh fails. */
let lastGood = new Map<string, BalancePayload>()

/** Reset the module's memo. Used by tests and by the route's own force path. */
export function resetBalanceCache(): void {
  cached = new Map()
  lastGood = new Map()
}

/** Fetch-shaped function, injectable for tests. */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

/** What one query asks for. */
export interface BalanceQuery {
  /** Credential name to resolve from DSH's store. */
  readonly ref?: string
  /** Ignore the cache (a deliberate click on the page's query button). */
  readonly force?: boolean
}

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
 * Query DeepSeek for the balance of one key.
 *
 * The key is read here and handed straight to `fetch`; it is never stored in a
 * module-level variable, which is why the caches can only ever hold numbers.
 * @param deps - context, fetch, clock and TTL.
 * @param query - which key to use, and whether to force a refetch.
 * @returns the payload to serve.
 */
export async function readBalance(deps: BalanceDeps, query: BalanceQuery = {}): Promise<BalancePayload> {
  const now = deps.now ?? Date.now
  const ttl = deps.ttlMs ?? BALANCE_TTL_MS

  const ref = query.ref ?? API_KEY_REF
  if (!isApiKeyRef(ref)) {
    return failure('bad-request', `凭据名不合法:${String(query.ref)}`)
  }
  const cacheKey = ref
  if (query.force !== true) {
    const hit = cached.get(cacheKey)
    if (hit !== undefined && now() - hit.at < ttl) return hit.payload
  }

  const key = await readApiKey(deps.ctx, ref)
  if (!key.ok) {
    // A configuration problem is not a network failure: report it plainly, and
    // do not cache it, so fixing the key shows up on the next click.
    const missing = key.reason === 'no-key'
    return failure(key.reason, missing
      ? `凭据 ${ref} 没有配置,或值为空(在 DSH 的模型设置里配置后即可查询)`
      : '读取凭据服务失败,无法取得 API key')
  }

  const doFetch = deps.fetchImpl ?? ((input, init) => fetch(input, init))
  /** Stamp the answer with the credential it belongs to (a NAME, never a value). */
  const decorate = (payload: BalancePayload): BalancePayload => ({ ...payload, ref })
  const previous = lastGood.get(cacheKey)
  let response: Response
  try {
    response = await doFetch(BALANCE_URL, {
      headers: { authorization: `Bearer ${key.key}`, accept: 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch {
    // Never surface the underlying error text: a fetch failure message can
    // include the request (and therefore headers) in some runtimes.
    return previous ?? decorate(failure('network', '调用 DeepSeek 余额接口失败(网络或超时)'))
  }

  if (response.status === 401 || response.status === 403) {
    return decorate(failure('unauthorized',
      `DeepSeek 拒绝了这个 API key(HTTP ${String(response.status)});只有 DeepSeek 官方的 key 能查余额`))
  }
  if (!response.ok) {
    return previous ?? decorate(failure('network', `DeepSeek 余额接口返回 HTTP ${String(response.status)}`))
  }

  let payload: BalancePayload
  try {
    payload = parseBalance(await response.json())
  } catch {
    return previous ?? decorate(failure('bad-response', 'DeepSeek 余额接口返回了无法解析的内容'))
  }
  if (!payload.ok) return previous ?? decorate(payload)

  const answered = decorate({ ...payload, at: now() })
  cached.set(cacheKey, { at: answered.at ?? now(), payload: answered })
  lastGood.set(cacheKey, answered)
  return answered
}

/**
 * Serve the route.
 *
 * `GET ?ref=<NAME>&refresh=1` is the whole surface: the page's model dropdown
 * picks a credential by NAME, and the host resolves the value from DSH's own
 * store. No key value ever arrives from the page, so there is no request body
 * to read — and therefore no path by which a secret could reach a URL, a log
 * line or the browser's history.
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

  const method = (req.method ?? 'GET').toUpperCase()
  if (method !== 'GET' && method !== 'HEAD') {
    respond(200, failure('bad-request', '余额接口只接受 GET'))
    return
  }

  const url = new URL(req.url ?? BALANCE_ROUTE, 'http://localhost')
  const refParam = url.searchParams.get('ref')
  const payload = await readBalance({ ctx, ...deps }, {
    ...(refParam === null || refParam === '' ? {} : { ref: refParam }),
    force: url.searchParams.get('refresh') === '1',
  })
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
      handleBalanceRequest(ctx, req as ServerRequestLike, res).catch((error: unknown) => {
        // Any escape hatch still answers, so the page shows a state instead of
        // hanging. The MESSAGE is logged (never a key: nothing here holds one),
        // because the first release of this route swallowed a thrown service
        // lookup into "unexpected error" and cost a round trip to diagnose.
        const message = error instanceof Error ? error.message : String(error)
        ctx.logger?.warn(`dsh-cost-stats: balance route failed: ${message}`)
        res.statusCode = 200
        res.setHeader('content-type', 'application/json; charset=utf-8')
        res.end(JSON.stringify(failure('network', `查询余额时发生未预期的错误:${message}`)))
      })
    },
  })
}
