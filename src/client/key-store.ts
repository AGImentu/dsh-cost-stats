/**
 * The key catalog store: which keys the dropdown offers, and which one is picked.
 *
 * Two very different kinds of state live here, and the difference is the point:
 *
 * - the **catalog** is a module-level cache of `GET /cost-stats/keys` — names,
 *   origins and configured flags, all of them safe to keep and to re-render;
 * - the **selection** is only remembered as a NAME. A key typed into the page is
 *   never stored here (not in this module, not in `localStorage`, not in any
 *   request the page makes on its own): it lives in the component's state for as
 *   long as the reader leaves it there.
 *
 * @module dsh-cost-stats/client/key-store
 */

import { KEYS_ROUTE } from '../routes.ts'
import type { KeysPayload } from '../balance.ts'

/** `localStorage` slot remembering the credential NAME the reader picked. */
export const REF_STORAGE_KEY = 'dsh-cost-stats.balance.ref'

/** The `<select>` value that means "let me type a key instead". */
export const MANUAL_OPTION = '__manual__'

/** What the balance readout is currently pointed at. */
export type Selection =
  /** A named credential, resolved by the host from DSH's own store. */
  | { readonly kind: 'ref', readonly ref: string }
  /** A key the reader typed; it exists only in memory. */
  | { readonly kind: 'manual' }

let catalog: KeysPayload | undefined
let inFlight: Promise<KeysPayload> | undefined
const listeners = new Set<(payload: KeysPayload) => void>()

/** The most recent catalog, if any. */
export function snapshot(): KeysPayload | undefined {
  return catalog
}

/**
 * Subscribe to completed catalog loads.
 * @param listener - called with each new payload.
 * @returns the unsubscribe function.
 */
export function subscribe(listener: (payload: KeysPayload) => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/**
 * Load the catalog once per page, joining concurrent callers.
 * @returns the payload (never rejects: a failure is a payload with `ok: false`).
 */
export function load(): Promise<KeysPayload> {
  if (catalog !== undefined && catalog.ok) return Promise.resolve(catalog)
  if (inFlight !== undefined) return inFlight
  const pending = fetch(KEYS_ROUTE, { credentials: 'same-origin', headers: { accept: 'application/json' } })
    .then(async (response) => {
      if (!response.ok) throw new Error(String(response.status))
      return await response.json() as KeysPayload
    })
    .catch((): KeysPayload => ({ ok: false, default: 'DEEPSEEK_API_KEY', refs: [], canRemember: false }))
    .then((payload) => {
      catalog = payload
      for (const listener of listeners) listener(payload)
      return payload
    })
    .finally(() => { inFlight = undefined })
  inFlight = pending
  return pending
}

/**
 * The credential name the reader last picked, if it is still offered.
 *
 * Remembering a NAME (never a key) is what makes reopening the page land on the
 * key you were looking at, without the page holding a secret across reloads.
 * @param payload - the catalog to validate against.
 * @returns the name to preselect, or undefined.
 */
export function storedRef(payload: KeysPayload | undefined): string | undefined {
  let name: string | undefined
  try {
    name = globalThis.localStorage?.getItem(REF_STORAGE_KEY) ?? undefined
  } catch {
    // A page without storage (or with it disabled) simply has no preference.
    return undefined
  }
  if (name === undefined || name === '') return undefined
  if (payload === undefined) return name
  return payload.refs.some(row => row.ref === name) ? name : undefined
}

/**
 * Remember the picked credential name.
 * @param ref - the name to store, or undefined to forget it.
 * @returns nothing.
 */
export function storeRef(ref: string | undefined): void {
  try {
    if (ref === undefined) globalThis.localStorage?.removeItem(REF_STORAGE_KEY)
    else globalThis.localStorage?.setItem(REF_STORAGE_KEY, ref)
  } catch {
    // Storage is a convenience: losing it costs one dropdown click.
  }
}

/** Drop the memo. Used by tests. */
export function reset(): void {
  catalog = undefined
  inFlight = undefined
}

/**
 * A free credential name to offer when the reader wants to store a pasted key.
 *
 * Storing under a name that is already taken would silently replace the key the
 * harness uses for its own model calls, so the suggestion walks past every name
 * the catalog already knows.
 * @param payload - the catalog, when one has loaded.
 * @returns a name that is not in use.
 */
export function suggestRefName(payload: KeysPayload | undefined): string {
  const taken = new Set((payload?.refs ?? []).map(row => row.ref))
  for (let index = 2; index < 100; index += 1) {
    const candidate = `DEEPSEEK_API_KEY_${String(index)}`
    if (!taken.has(candidate)) return candidate
  }
  return 'DEEPSEEK_API_KEY_CUSTOM'
}
