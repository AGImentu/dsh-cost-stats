/**
 * The balance readout's store: one fetch per credential, shared by every opener.
 *
 * Mirrors `usage-store.ts`: a module-level cache with an in-flight join, because
 * the settings page can be opened, closed and reopened in seconds and neither
 * DeepSeek's rate limit nor the page should pay for that. "Query on open" is
 * still honoured — every mount calls `load()` — and the host applies its own
 * short TTL, so a deliberate refresh is what actually forces a new request.
 *
 * Two rules make switching keys safe:
 *
 * - the cache is keyed by credential NAME, so picking another key can never show
 *   the previous one's money;
 * - a key typed into the page is **never cached and never joined**: it is sent on
 *   the click that asked for it, and the store keeps only the numbers that came
 *   back (its own slot, cleared on reload).
 *
 * The store only ever holds the payload the host sent: numbers, a name, a reason
 * code. No key value ever reaches this half of the plugin.
 *
 * @module dsh-cost-stats/client/balance-store
 */

import { BALANCE_ROUTE } from '../routes.ts'
import type { BalancePayload } from '../balance.ts'

/** How long a page-local answer is reused, in ms (matches the host's own TTL). */
export const BALANCE_CLIENT_TTL_MS = 15_000

/** What one balance query is about. */
export type BalanceRequest =
  /** A named credential, resolved by the host from DSH's own store. */
  | { readonly kind: 'ref', readonly ref: string }
  /** A key the reader typed, used for this request only. */
  | { readonly kind: 'manual', readonly key: string, readonly remember?: boolean, readonly rememberAs?: string }

interface Entry {
  readonly at: number
  readonly payload: BalancePayload
}

/** Named-credential answers, by name. */
const entries = new Map<string, Entry>()
/** In-flight named queries, by name. */
const pending = new Map<string, Promise<BalancePayload>>()
/** The last answer that came from a typed key: one slot, this page only. */
let manual: Entry | undefined
const listeners = new Set<(request: BalanceRequest, payload: BalancePayload) => void>()

/**
 * Subscribe to completed loads.
 * @param listener - called with the request and its payload.
 * @returns the unsubscribe function.
 */
export function subscribe(listener: (request: BalanceRequest, payload: BalancePayload) => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/**
 * The most recent answer for one request, if any.
 * @param request - the request to look up.
 * @returns the cached payload, or undefined.
 */
export function snapshot(request: BalanceRequest): BalancePayload | undefined {
  if (request.kind === 'manual') return manual?.payload
  return entries.get(request.ref)?.payload
}

/**
 * Load the balance, joining concurrent callers that ask for the same key.
 * @param request - which key to query.
 * @param force - bypass both the client cache and the host cache.
 * @param now - clock, injectable for tests.
 * @returns the payload (never rejects: a failure is a payload with `ok: false`).
 */
export function load(
  request: BalanceRequest,
  force = false,
  now: () => number = Date.now,
): Promise<BalancePayload> {
  if (request.kind === 'ref') {
    const hit = entries.get(request.ref)
    if (!force && hit !== undefined && now() - hit.at < BALANCE_CLIENT_TTL_MS) {
      return Promise.resolve(hit.payload)
    }
    const joined = pending.get(request.ref)
    if (joined !== undefined) return joined
  }
  const started = now()
  const query = request.kind === 'ref'
    ? fetch(
      `${BALANCE_ROUTE}?ref=${encodeURIComponent(request.ref)}${force ? '&refresh=1' : ''}`,
      { credentials: 'same-origin', headers: { accept: 'application/json' } },
    )
    // A typed key travels in a request BODY, never in a URL: the browser keeps
    // URLs in its history, its cache keys and often in logs, and a key has no
    // business in any of them.
    : fetch(BALANCE_ROUTE, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify({
        key: request.key,
        ...(request.remember === true ? { remember: true } : {}),
        ...(request.rememberAs === undefined ? {} : { rememberAs: request.rememberAs }),
      }),
    })
  const result = query
    .then(async (response) => await response.json() as BalancePayload)
    .catch((): BalancePayload => ({ ok: false, reason: 'network', message: 'fetch failed' }))
    .then((payload) => {
      if (request.kind === 'ref') entries.set(request.ref, { at: started, payload })
      else manual = { at: started, payload }
      for (const listener of listeners) listener(request, payload)
      return payload
    })
    .finally(() => {
      if (request.kind === 'ref') pending.delete(request.ref)
    })
  if (request.kind === 'ref') pending.set(request.ref, result)
  return result
}

/** Drop the memo. Used by tests. */
export function reset(): void {
  entries.clear()
  pending.clear()
  manual = undefined
}
