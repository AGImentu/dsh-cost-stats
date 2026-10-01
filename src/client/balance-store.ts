/**
 * The balance readout's store: one fetch per credential, shared by both entries.
 *
 * A module-level cache with an in-flight join, because the settings page can be
 * opened, closed and reopened in seconds. Nothing is fetched until the reader
 * clicks the query button: the balance is a deliberate question, not decoration,
 * and every answer already in the cache is keyed by credential NAME so switching
 * models can never show the previous one's money.
 *
 * The store only ever holds the payload the host sent: numbers, a name, a reason
 * code. No key value ever reaches this half of the plugin, and nothing here can
 * send one: the host resolves the credential from DSH's own store.
 *
 * @module dsh-cost-stats/client/balance-store
 */

import { BALANCE_ROUTE } from '../routes.ts'
import { ACCOUNT_CHOICE_ID } from '../balance.ts'
import type { BalancePayload } from '../balance.ts'

/** How long a page-local answer is reused, in ms (matches the host's own TTL). */
export const BALANCE_CLIENT_TTL_MS = 15_000

interface Entry {
  readonly at: number
  readonly payload: BalancePayload
}

/** Answers by credential name. */
const entries = new Map<string, Entry>()
/** In-flight queries by credential name. */
const pending = new Map<string, Promise<BalancePayload>>()
const listeners = new Set<(ref: string, payload: BalancePayload) => void>()

/**
 * Subscribe to completed loads.
 * @param listener - called with the credential name and its payload.
 * @returns the unsubscribe function.
 */
export function subscribe(listener: (ref: string, payload: BalancePayload) => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/**
 * The most recent answer for one credential, if any.
 * @param ref - the credential name.
 * @returns the cached payload, or undefined.
 */
export function snapshot(ref: string): BalancePayload | undefined {
  return entries.get(ref)?.payload
}

/**
 * Query one credential's balance, joining concurrent callers.
 * @param ref - the model id the host should answer for: a credential NAME, or
 * `ACCOUNT_CHOICE_ID` for DSH's login account (which the host reads through the
 * harness's own account service, because that account has no API key).
 * @param force - bypass both the client cache and the host cache.
 * @param now - clock, injectable for tests.
 * @returns the payload (never rejects: a failure is a payload with `ok: false`).
 */
export function load(ref: string, force = false, now: () => number = Date.now): Promise<BalancePayload> {
  const hit = entries.get(ref)
  if (!force && hit !== undefined && now() - hit.at < BALANCE_CLIENT_TTL_MS) {
    return Promise.resolve(hit.payload)
  }
  const joined = pending.get(ref)
  if (joined !== undefined) return joined
  const started = now()
  const query = ref === ACCOUNT_CHOICE_ID
    ? `account=1${force ? '&refresh=1' : ''}`
    : `ref=${encodeURIComponent(ref)}${force ? '&refresh=1' : ''}`
  const result = fetch(
    `${BALANCE_ROUTE}?${query}`,
    { credentials: 'same-origin', headers: { accept: 'application/json' } },
  )
    .then(async (response) => await response.json() as BalancePayload)
    .catch((): BalancePayload => ({ ok: false, reason: 'network', message: 'fetch failed' }))
    .then((payload) => {
      entries.set(ref, { at: started, payload })
      for (const listener of listeners) listener(ref, payload)
      return payload
    })
    .finally(() => { pending.delete(ref) })
  pending.set(ref, result)
  return result
}

/** Drop the memo. Used by tests. */
export function reset(): void {
  entries.clear()
  pending.clear()
}
