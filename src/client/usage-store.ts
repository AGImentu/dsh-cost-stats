/**
 * Lazy, shared cache of the host's per-reply payload.
 *
 * The cost chip normally prices a turn from the provider-reported buckets the
 * chat UI already has. When the core meter withholds those buckets (it refuses a
 * total it cannot prove — e.g. a turn containing a retried request that reported
 * no usage), the chip falls back to the host's own log fold instead of showing
 * nothing. That fallback needs this payload, and it must not cost a request per
 * message: one fetch per TTL, shared by every chip, concurrent callers joining
 * the same request.
 *
 * @module dsh-session-cost/client/usage-store
 */

import { USAGE_ROUTE } from '../routes.ts'
import type { TurnCostRow, UsagePayload } from '../rows.ts'

/** What observers see. */
export interface UsageSnapshot {
  readonly status: 'idle' | 'loading' | 'ready' | 'error'
  /** Every per-reply row the host reported for the newest build. */
  readonly rows: readonly TurnCostRow[]
  /** When the rows were fetched (absent before the first success). */
  readonly fetchedAt?: number
  /** Last failure message, kept while stale rows may still be served. */
  readonly error?: string
}

const EMPTY: UsageSnapshot = { status: 'idle', rows: [] }

/** How long one fetched payload is reused. */
export const USAGE_TTL_MS = 30_000

/** Fetch-shaped function, resolved lazily so tests can stub the global. */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

/** Observable cache over the host's `/session-cost/usage` payload. */
export class UsageStore {
  private snapshot: UsageSnapshot = EMPTY
  private readonly listeners = new Set<() => void>()
  private inFlight: Promise<void> | undefined

  /**
   * @param fetchImpl - fetch to use; defaults to the global one at call time.
   * @param ttlMs - reuse window for a successful payload.
   * @param now - clock, injectable for tests.
   */
  constructor(
    private readonly fetchImpl: () => FetchLike = () => globalThis.fetch,
    private readonly ttlMs: number = USAGE_TTL_MS,
    private readonly now: () => number = Date.now,
  ) {}

  /**
   * Subscribe to snapshot changes.
   * @param listener - called on every publish.
   * @returns the unsubscribe function.
   */
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /**
   * Read the current snapshot (stable reference between publishes).
   * @returns the snapshot.
   */
  getSnapshot = (): UsageSnapshot => this.snapshot

  /**
   * Load the payload unless a fresh one (or an in-flight request) exists.
   * @param force - ignore the TTL and refetch.
   */
  ensure(force = false): void {
    const fresh = this.snapshot.status === 'ready'
      && this.snapshot.fetchedAt !== undefined
      && this.now() - this.snapshot.fetchedAt < this.ttlMs
    if (this.inFlight !== undefined) return
    if (!force && fresh) return
    this.inFlight = this.load(force).finally(() => { this.inFlight = undefined })
  }

  /**
   * Find one assistant reply's row.
   *
   * Compaction rows are skipped even though they carry the same session id: a
   * compaction belongs to no turn, so it must never stand in for the reply the
   * chip is pricing (whose turn number is always ≥ 1).
   * @param sessionId - session id, when known.
   * @param turn - turn number inside that session.
   * @returns the reply's row, or undefined while the payload lacks it.
   */
  lookup(sessionId: string | undefined, turn: number | undefined): TurnCostRow | undefined {
    if (sessionId === undefined || turn === undefined) return undefined
    return this.snapshot.rows.find(row =>
      row.compaction !== true && row.sessionId === sessionId && row.turn === turn)
  }

  /** Fetch once and publish the result. */
  private async load(force: boolean): Promise<void> {
    this.publish({
      ...this.snapshot,
      status: this.snapshot.rows.length === 0 ? 'loading' : this.snapshot.status,
    })
    try {
      const response = await this.fetchImpl()(
        force ? `${USAGE_ROUTE}?refresh=1` : USAGE_ROUTE,
        { credentials: 'same-origin', headers: { accept: 'application/json' } },
      )
      if (!response.ok) throw new Error(`${String(response.status)} ${response.statusText}`)
      const payload = await response.json() as UsagePayload
      this.publish({ status: 'ready', rows: payload.rows ?? [], fetchedAt: this.now() })
    } catch (error) {
      this.publish({
        status: 'error',
        rows: this.snapshot.rows,
        error: error instanceof Error ? error.message : String(error),
        ...(this.snapshot.fetchedAt === undefined ? {} : { fetchedAt: this.snapshot.fetchedAt }),
      })
    }
  }

  /** Replace the snapshot and notify observers. */
  private publish(next: UsageSnapshot): void {
    this.snapshot = next
    for (const listener of this.listeners) listener()
  }
}

/** The plugin's shared store. */
export const usageStore = new UsageStore()
