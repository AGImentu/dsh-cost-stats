/**
 * The wire shape shared by the host route and the statistics page.
 *
 * Types only — the client imports this, the host produces it, and nothing
 * runtime crosses between the two halves.
 *
 * @module dsh-session-cost/rows
 */

/** One assistant reply (turn) with its priced usage. */
export interface TurnCostRow {
  readonly sessionId: string
  readonly sessionTitle: string
  /** `true` when the session was spawned by a subagent (`delegationDepth > 0`). */
  readonly subagent: boolean
  /** Turn number inside its session. */
  readonly turn: number
  /** Epoch ms the turn started: the row's time and its peak/off-peak input. */
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
  /** Billed attempts folded into this reply. */
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
