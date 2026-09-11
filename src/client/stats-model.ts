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

/** One rendered page of a row selection. */
export interface PageSlice<T> {
  /** 1-based page actually rendered, clamped into range. */
  readonly page: number
  /** Total number of pages; at least 1, so an empty selection still has a page. */
  readonly pages: number
  /** The rows belonging to {@link page}. */
  readonly rows: readonly T[]
}

/**
 * Cut one page out of a row selection.
 *
 * Clamping lives here rather than in a state update: a filter change or a reload
 * can shrink the selection under the stored page number, and deriving the safe
 * page during render avoids a frame that shows an empty page.
 * @param rows - the whole selection.
 * @param page - requested 1-based page.
 * @param size - rows per page.
 * @returns the clamped page number, the page count, and that page's rows.
 */
export function paginate<T>(rows: readonly T[], page: number, size: number): PageSlice<T> {
  const perPage = Math.max(1, Math.trunc(size))
  const pages = Math.max(1, Math.ceil(rows.length / perPage))
  const requested = Number.isFinite(page) ? Math.trunc(page) : 1
  const current = Math.min(Math.max(1, requested), pages)
  const start = (current - 1) * perPage
  return { page: current, pages, rows: rows.slice(start, start + perPage) }
}
