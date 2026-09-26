/**
 * The balance readout's store: one fetch shared by every opener.
 *
 * Mirrors `usage-store.ts`: a module-level cache with an in-flight join, because
 * the settings page can be opened, closed and reopened in seconds and neither
 * DeepSeek's rate limit nor the page should pay for that. "Query on open" is
 * still honoured — every mount calls `load()` — and the host applies its own
 * short TTL, so a deliberate refresh is what actually forces a new request.
 *
 * The store only ever holds the payload the host sent: numbers and a reason
 * code. The API key never reaches this half of the plugin.
 *
 * @module dsh-cost-stats/client/balance-store
 */

import { BALANCE_ROUTE } from '../routes.ts'
import type { BalancePayload } from '../balance.ts'

/** How long a page-local answer is reused, in ms (matches the host's own TTL). */
export const BALANCE_CLIENT_TTL_MS = 15_000

interface Entry {
  readonly at: number
  readonly payload: BalancePayload
}

let entry: Entry | undefined
let inFlight: Promise<BalancePayload> | undefined
const listeners = new Set<(payload: BalancePayload) => void>()

/** The most recent answer, if any. */
export function snapshot(): BalancePayload | undefined {
  return entry?.payload
}

/**
 * Subscribe to completed loads.
 * @param listener - called with each new payload.
 * @returns the unsubscribe function.
 */
export function subscribe(listener: (payload: BalancePayload) => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/**
 * Load the balance, joining concurrent callers.
 * @param force - bypass both the client cache and the host cache.
 * @param now - clock, injectable for tests.
 * @returns the payload (never rejects: a failure is a payload with `ok: false`).
 */
export function load(force = false, now: () => number = Date.now): Promise<BalancePayload> {
  if (!force && entry !== undefined && now() - entry.at < BALANCE_CLIENT_TTL_MS) {
    return Promise.resolve(entry.payload)
  }
  if (inFlight !== undefined) return inFlight
  const url = force ? `${BALANCE_ROUTE}?refresh=1` : BALANCE_ROUTE
  const pending = fetch(url, { credentials: 'same-origin', headers: { accept: 'application/json' } })
    .then(async (response) => await response.json() as BalancePayload)
    .catch((): BalancePayload => ({ ok: false, reason: 'network', message: 'fetch failed' }))
    .then((payload) => {
      entry = { at: now(), payload }
      for (const listener of listeners) listener(payload)
      return payload
    })
    .finally(() => { inFlight = undefined })
  inFlight = pending
  return pending
}

/** Drop the memo. Used by tests. */
export function reset(): void {
  entry = undefined
  inFlight = undefined
}
