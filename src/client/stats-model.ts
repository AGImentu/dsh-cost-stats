/**
 * Statistics-page model: group keys and totals over the per-reply rows the host
 * route returns.
 *
 * Pure and dependency-free so the query semantics are unit-testable without a
 * browser. Granularity here is the REPLY (one assistant turn); the day and month
 * pickers only change which rows are selected, never the row shape.
 *
 * @module dsh-session-cost/client/stats-model
 */

import type { TurnCostRow } from '../rows.ts'

/** Totals over a row selection. */
export interface CostTotals {
  /** Replies inside the selection. */
  readonly replies: number
  /** Distinct sessions the selected replies belong to. */
  readonly sessions: number
  /** Replies inside the selection that could not be priced. */
  readonly unpriced: number
  /** Replies produced by a subagent session. */
  readonly subagents: number
  readonly cny: number
  readonly usd: number
  readonly tokens: number
}

const pad = (value: number): string => String(value).padStart(2, '0')

/**
 * Local-time day key of an instant.
 * @param at - epoch ms.
 * @returns `YYYY-MM-DD`.
 */
export function dayKeyOf(at: number): string {
  const date = new Date(at)
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/**
 * Local-time month key of an instant.
 * @param at - epoch ms.
 * @returns `YYYY-MM`.
 */
export function monthKeyOf(at: number): string {
  return dayKeyOf(at).slice(0, 7)
}

/**
 * Totals over a row selection.
 * @param rows - selected rows.
 * @returns reply/session counts, money, tokens, and the unpriced/subagent split.
 */
export function totalsOf(rows: readonly TurnCostRow[]): CostTotals {
  let cny = 0
  let usd = 0
  let tokens = 0
  let unpriced = 0
  let subagents = 0
  const sessions = new Set<string>()
  for (const row of rows) {
    cny += row.cny
    usd += row.usd
    tokens += row.tokens
    if (!row.priced) unpriced += 1
    if (row.subagent) subagents += 1
    sessions.add(row.sessionId)
  }
  return { replies: rows.length, sessions: sessions.size, unpriced, subagents, cny, usd, tokens }
}
