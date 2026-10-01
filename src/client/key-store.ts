/**
 * The model catalog store: which models the dropdown offers, and which one is picked.
 *
 * Two very different kinds of state live here:
 *
 * - the **catalog** is a module-level cache of `GET /cost-stats/keys` — model
 *   names, provider ids and configured flags, all of them safe to keep and to
 *   re-render;
 * - the **selection** is one of: 「全部」(no filter at all, the default) or a
 *   credential NAME. Only a name is remembered (in `localStorage`), and a name
 *   is not a secret — the host resolves the value.
 *
 * @module dsh-cost-stats/client/key-store
 */

import { KEYS_ROUTE } from '../routes.ts'
import type { KeyRefInfo, KeysPayload } from '../balance.ts'

/** `localStorage` slot remembering the credential NAME the reader picked. */
export const REF_STORAGE_KEY = 'dsh-cost-stats.balance.ref'

/** What the statistics page is currently pointed at. */
export type Selection =
  /** No model filter: every reply, and the harness default key for a balance. */
  | { readonly kind: 'all' }
  /** One configured credential: its traffic, and its own balance. */
  | { readonly kind: 'ref', readonly ref: string }

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
    .catch((): KeysPayload => ({ ok: false, default: 'DEEPSEEK_API_KEY', refs: [] }))
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
 * same model, without the page holding a secret across reloads.
 * @param payload - the catalog to validate against.
 * @returns the name to preselect, or undefined for 「全部」.
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

/**
 * The catalog row for a credential.
 * @param ref - the credential name.
 * @param payload - the catalog.
 * @returns the row, or undefined.
 */
export function rowOf(ref: string, payload: KeysPayload | undefined): KeyRefInfo | undefined {
  return payload?.refs.find(row => row.ref === ref)
}

/**
 * The model-provider ids the picked credential pays for.
 *
 * This is the page's filter: a stored reply names the provider that served it, so
 * the rows belonging to one model are the rows whose `provider` is in this set.
 * `undefined` means "no filter" — the 「全部」 selection.
 * @param selection - the current selection.
 * @param payload - the catalog.
 * @returns the provider ids, or undefined for no filter.
 */
export function providerIdsOf(selection: Selection, payload: KeysPayload | undefined): readonly string[] | undefined {
  if (selection.kind === 'all') return undefined
  return rowOf(selection.ref, payload)?.providers ?? []
}

/** Drop the memo. Used by tests. */
export function reset(): void {
  catalog = undefined
  inFlight = undefined
}
