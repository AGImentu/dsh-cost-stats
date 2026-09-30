/**
 * The balance route: `GET|POST /cost-stats/balance`.
 *
 * Sequence per request: refuse non-local callers → decide which key to use
 * (a named credential from DSH's store, or the one the reader just typed) →
 * call DeepSeek once → return numbers only. A key value appears in the outbound
 * `Authorization` header and nowhere else: it is not logged, not echoed, not
 * cached and not part of any response, so this route can be public code without
 * being a leak.
 *
 * Caches exist for one reason: opening the settings page is a human action, and
 * a human can open it five times in ten seconds. DeepSeek's endpoint is rate
 * limited, so the plugin absorbs that instead of forwarding it. The cache is
 * per credential NAME (switching keys must never show the other key's money),
 * and a key typed into the page is never cached at all.
 *
 * @module dsh-cost-stats/host/balance-route
 */

import { BALANCE_URL, isLocalRequest, parseBalance } from './balance.ts'
import { API_KEY_REF, isApiKeyRef, isApiKeyValue, readApiKey, rememberApiKey } from './api-key.ts'
import { BALANCE_ROUTE } from '../routes.ts'
import type { BalancePayload, RememberOutcome } from '../balance.ts'
import type { HostContextLike, ServerRequestLike, ServerResponseLike } from './contract.ts'

/** How long one successful answer is reused, in ms. */
export const BALANCE_TTL_MS = 15_000

/** How long to wait for DeepSeek before giving up, in ms. */
const TIMEOUT_MS = 8_000

/** Cap on a request body: a key and three flags, nothing more. */
const MAX_BODY_BYTES = 16 * 1024

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
  /** A key the reader typed into the page; never cached, never logged. */
  readonly key?: string
  /** Ignore the cache (the page's refresh action). */
  readonly force?: boolean
  /** Store `key` under `ref` in DSH's credential store first. */
  readonly remember?: boolean
  /** The name to store a remembered key under. */
  readonly rememberAs?: string
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
  const manual = query.key !== undefined

  // A pasted key with a newline in it (or a stray paste of a whole file) never
  // reaches a request header: the page hears about it instead.
  if (manual && !isApiKeyValue(query.key)) {
    return failure('bad-request', '输入的 key 不合法(可能带空格/换行,或长度不对)')
  }
  const ref = query.ref ?? API_KEY_REF
  if (!manual && !isApiKeyRef(ref)) {
    return failure('bad-request', `凭据名不合法:${String(query.ref)}`)
  }
  // Only named credentials are cached: a typed key is a one-off secret.
  const cacheKey = manual ? undefined : ref
  if (!manual && query.force !== true && cacheKey !== undefined) {
    const hit = cached.get(cacheKey)
    if (hit !== undefined && now() - hit.at < ttl) return hit.payload
  }

  let remembered: RememberOutcome | undefined
  if (manual && query.remember === true && isApiKeyRef(query.rememberAs)) {
    // Storing is the reader's explicit choice, and the outcome is reported so
    // the page can say "saved" or "this build cannot". Failure never blocks the
    // query: they asked for a balance, and they get one.
    remembered = await rememberApiKey(deps.ctx, query.rememberAs, query.key ?? '')
  }

  const resolved = await (async (): Promise<{ ok: true, key: string } | { ok: false, payload: BalancePayload }> => {
    if (manual) return { ok: true, key: (query.key ?? '').trim() }
    const key = await readApiKey(deps.ctx, ref)
    if (key.ok) return key
    // A configuration problem is not a network failure: report it plainly, and
    // do not cache it, so fixing the key shows up on the next open.
    const missing = key.reason === 'no-key'
    return {
      ok: false,
      payload: failure(key.reason, missing
        ? `凭据 ${ref} 没有配置,或值为空(在 DSH 的模型设置里配置后即可查询)`
        : '读取凭据服务失败,无法取得 API key'),
    }
  })()
  if (!resolved.ok) return resolved.payload
  const key = resolved.key

  const doFetch = deps.fetchImpl ?? ((input, init) => fetch(input, init))
  const decorate = (payload: BalancePayload): BalancePayload => ({
    ...payload,
    ...(manual ? { manual: true } : { ref }),
    ...(remembered === undefined ? {} : { remembered }),
  })
  let response: Response
  try {
    response = await doFetch(BALANCE_URL, {
      headers: { authorization: `Bearer ${key}`, accept: 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch {
    // Never surface the underlying error text: a fetch failure message can
    // include the request (and therefore headers) in some runtimes.
    const previous = cacheKey === undefined ? undefined : lastGood.get(cacheKey)
    return previous ?? decorate(failure('network', '调用 DeepSeek 余额接口失败(网络或超时)'))
  }

  if (response.status === 401 || response.status === 403) {
    return decorate(failure('unauthorized',
      `DeepSeek 拒绝了这个 API key(HTTP ${String(response.status)});只有 DeepSeek 官方的 key 能查余额`))
  }
  if (!response.ok) {
    const previous = cacheKey === undefined ? undefined : lastGood.get(cacheKey)
    return previous ?? decorate(failure('network', `DeepSeek 余额接口返回 HTTP ${String(response.status)}`))
  }

  let payload: BalancePayload
  try {
    payload = parseBalance(await response.json())
  } catch {
    const previous = cacheKey === undefined ? undefined : lastGood.get(cacheKey)
    return previous ?? decorate(failure('bad-response', 'DeepSeek 余额接口返回了无法解析的内容'))
  }
  if (!payload.ok) {
    const previous = cacheKey === undefined ? undefined : lastGood.get(cacheKey)
    return previous ?? decorate(payload)
  }

  const answered = decorate({ ...payload, at: now() })
  if (cacheKey !== undefined) {
    cached.set(cacheKey, { at: answered.at ?? now(), payload: answered })
    lastGood.set(cacheKey, answered)
  }
  return answered
}

/**
 * Read a JSON request body without trusting its size.
 * @param req - the incoming request.
 * @returns the parsed body, or undefined when there is none readable.
 */
async function readJsonBody(req: ServerRequestLike): Promise<unknown> {
  const iterate = req[Symbol.asyncIterator]
  if (typeof iterate !== 'function') return undefined
  const source = { [Symbol.asyncIterator]: iterate.bind(req) }
  const chunks: string[] = []
  let size = 0
  for await (const chunk of source) {
    const text = typeof chunk === 'string'
      ? chunk
      : chunk instanceof Uint8Array
        ? new TextDecoder().decode(chunk)
        : ''
    size += text.length
    if (size > MAX_BODY_BYTES) throw new Error('request body too large')
    chunks.push(text)
  }
  if (chunks.length === 0) return undefined
  return JSON.parse(chunks.join('')) as unknown
}

/** Narrow an unknown body to the fields this route reads. */
function queryOfBody(body: unknown): BalanceQuery {
  if (body === null || typeof body !== 'object') return {}
  const source = body as Record<string, unknown>
  const string = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined)
  const flag = (value: unknown): boolean => value === true
  return {
    ...(string(source.ref) === undefined ? {} : { ref: string(source.ref) }),
    ...(string(source.key) === undefined ? {} : { key: string(source.key) }),
    ...(string(source.rememberAs) === undefined ? {} : { rememberAs: string(source.rememberAs) }),
    force: flag(source.refresh),
    remember: flag(source.remember),
  }
}

/**
 * Serve the route.
 *
 * `GET ?ref=<NAME>&refresh=1` covers named credentials, which is what the page's
 * dropdown uses. `POST` with `{ ref?, key?, refresh?, remember?, rememberAs? }`
 * additionally accepts a key typed into the page — a body, not a query string,
 * so a pasted secret never lands in a URL (and therefore never in a log line or
 * the browser's history).
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
  const url = new URL(req.url ?? BALANCE_ROUTE, 'http://localhost')
  const refParam = url.searchParams.get('ref')
  let query: BalanceQuery = {
    ...(refParam === null || refParam === '' ? {} : { ref: refParam }),
    force: url.searchParams.get('refresh') === '1',
  }
  if (method === 'POST') {
    let body: unknown
    try {
      body = await readJsonBody(req)
    } catch {
      respond(200, failure('bad-request', '请求体不是合法的 JSON,或太大了'))
      return
    }
    query = { ...query, ...queryOfBody(body) }
  }

  const payload = await readBalance({ ctx, ...deps }, query)
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
