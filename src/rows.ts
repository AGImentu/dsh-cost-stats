/**
 * The wire shape shared by the host route and the statistics page.
 *
 * Types only — the client imports this, the host produces it, and nothing
 * runtime crosses between the two halves.
 *
 * @module dsh-session-cost/rows
 */

/** One billed item: an assistant reply (turn) or a context-compaction call. */
export interface TurnCostRow {
  readonly sessionId: string
  readonly sessionTitle: string
  /** `true` when the session was spawned by a subagent (`delegationDepth > 0`). */
  readonly subagent: boolean
  /**
   * Turn number inside its session; `0` for a compaction row, which belongs to
   * no turn. Compaction rows are also flagged by {@link compaction}, so a reader
   * never has to interpret the zero.
   */
  readonly turn: number
  /**
   * `true` when this row is a billed context-compaction call rather than an
   * assistant reply. Compactions are charged by the provider but belong to no
   * reply, so they carry their own row instead of being hidden.
   */
  readonly compaction?: boolean
  /** Epoch ms the turn started (the compaction's own time for a compaction row). */
  readonly at: number
  readonly provider?: string
  readonly model?: string
  /** Billed model name, present only when a published price covered the reply. */
  readonly plan?: string
  readonly priced: boolean
  readonly cny: number
  readonly usd: number
  readonly uncachedInputTokens: number
  readonly cacheReadTokens: number
  readonly outputTokens: number
  readonly reasoningTokens: number
  /** Prompt plus output tokens. */
  readonly tokens: number
  /** Billed attempts folded into this reply (`1` for a compaction). */
  readonly attempts: number
}

/** The `GET /session-cost/usage` payload. */
export interface UsagePayload {
  readonly generatedAt: number
  /** Stored sessions the backend reports. */
  readonly stored: number
  /** Sessions actually read for this payload. */
  readonly read: number
  /** Sessions that yielded no priced reply (empty, unreadable, or unpriced). */
  readonly skipped: number
  /** Every priced reply, newest first. */
  readonly rows: readonly TurnCostRow[]
}
