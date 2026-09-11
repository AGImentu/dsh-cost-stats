/**
 * Statistics-page model: bucket, filter and total the per-reply rows the host
 * route returns.
 *
 * Pure and dependency-free so the query semantics are unit-testable without a
 * browser. Granularity here is the REPLY (one assistant turn), which is what the
 * page lists; day and month views are groupings over the same rows.
 *
 * @module dsh-session-cost/client/stats-model
 */

import type { TurnCostRow } from '../rows.ts'

/** Granularity of the statistics table. */
export type StatsMode = 'day' | 'month' | 'turns'

/** Granularity that groups rows into buckets. */
export type BucketMode = Exclude<StatsMode, 'turns'>

/** Totals over a row selection. */
export interface CostTotals {
  /** Replies inside the selection. */
  readonly replies: number
  readonly sessions: number
  /** Replies inside the selection that could not be priced. */
  readonly unpriced: number
  /** Replies produced by a subagent session. */
  readonly subagents: number
  readonly cny: number
  readonly usd: number
  readonly tokens: number
}

/** One day or month bucket. */
export interface BucketRow {
  /** Sortable bucket key: `YYYY-MM-DD` or `YYYY-MM`. */
  readonly key: string
  readonly replies: number
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
 * Bucket key for one grouping mode.
 * @param at - epoch ms.
 * @param mode - day or month.
 * @returns the bucket key.
 */
export function bucketKeyOf(at: number, mode: BucketMode): string {
  return mode === 'day' ? dayKeyOf(at) : monthKeyOf(at)
}

/**
 * Aggregate rows into day or month buckets, newest first.
 * @param rows - reply rows.
 * @param mode - grouping granularity.
 * @returns bucket rows.
 */
export function bucketRows(rows: readonly TurnCostRow[], mode: BucketMode): readonly BucketRow[] {
  const buckets = new Map<string, { replies: number, cny: number, usd: number, tokens: number }>()
  for (const row of rows) {
    const key = bucketKeyOf(row.at, mode)
    const bucket = buckets.get(key) ?? { replies: 0, cny: 0, usd: 0, tokens: 0 }
    bucket.replies += 1
    bucket.cny += row.cny
    bucket.usd += row.usd
    bucket.tokens += row.tokens
    buckets.set(key, bucket)
  }
  return [...buckets.entries()]
    .map(([key, bucket]) => ({ key, ...bucket }))
    .sort((left, right) => (left.key < right.key ? 1 : left.key > right.key ? -1 : 0))
}

/**
 * Whether a row belongs to a bucket key.
 * @param row - reply row.
 * @param mode - grouping granularity.
 * @param key - bucket key, or undefined for "no bucket filter".
 * @returns whether the row is inside the selection.
 */
export function matchesBucket(row: TurnCostRow, mode: BucketMode, key: string | undefined): boolean {
  return key === undefined || bucketKeyOf(row.at, mode) === key
}

/**
 * Filter rows by an optional bucket key.
 * @param rows - reply rows.
 * @param mode - grouping granularity.
 * @param key - bucket key, or undefined for every row.
 * @returns the rows inside the selection.
 */
export function filterRows(
  rows: readonly TurnCostRow[],
  mode: BucketMode,
  key: string | undefined,
): readonly TurnCostRow[] {
  return key === undefined ? rows : rows.filter(row => matchesBucket(row, mode, key))
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
