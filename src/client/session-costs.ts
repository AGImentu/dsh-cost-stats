/**
 * Session-level cost aggregation for the statistics page.
 *
 * Pure and dependency-free so the folding rules are unit-testable without a
 * browser.
 *
 * Data source: the client session list (`useSessions`), whose rows carry the
 * host-computed projection values — cumulative `tokenUsage` buckets and the
 * durable `modelSelection`. That is exactly the pair this plugin prices, and it
 * arrives without activating the session (no chat history has to load, no cold
 * session is woken), which is why the statistics page can cover the whole
 * session list rather than only the conversation on screen.
 *
 * Granularity, stated honestly: a row is one SESSION, priced with the model that
 * session last used. A session that switched models mid-way is therefore an
 * approximation, and the peak/off-peak window is classified from the session's
 * last activity rather than from each request. The per-turn numbers in the chat
 * chip remain the exact view; this page is the overview.
 *
 * @module dsh-session-cost/client/session-costs
 */

import { estimateTurnUsage, type TurnUsageLike } from '../pricing.ts'
import type { SessionListStateLike, SessionSummaryLike } from './contract.ts'

/** Granularity of the statistics table. */
export type StatsMode = 'sessions' | 'day' | 'month'

/** Granularity that groups rows into buckets. */
export type BucketMode = Exclude<StatsMode, 'sessions'>

/** One priced session row. */
export interface SessionCostRow {
  readonly id: string
  readonly title: string
  /** Epoch ms the session is grouped by (its last durable activity). */
  readonly at: number
  readonly subagent: boolean
  readonly running: boolean
  /** Provider/model id used for pricing, or undefined when unattributed. */
  readonly model: string | undefined
  readonly provider: string | undefined
  /** Billed model name when the route resolved to a published plan. */
  readonly plan: string | undefined
  /** Whether a published price covered this row. */
  readonly priced: boolean
  readonly cny: number
  readonly usd: number
  /** Prompt plus output tokens. */
  readonly tokens: number
  /** Input tokens served from the provider cache. */
  readonly cacheReadTokens: number
  /** Input tokens billed at the miss rate. */
  readonly uncachedInputTokens: number
  readonly outputTokens: number
}

/** Outcome of scanning the session list. */
export interface SessionScan {
  readonly rows: readonly SessionCostRow[]
  /** Sessions skipped because they carry no usage projection (e.g. never ran). */
  readonly skipped: number
}

/** Totals over a row selection. */
export interface CostTotals {
  readonly sessions: number
  /** Sessions inside the selection that could not be priced. */
  readonly unpriced: number
  /** Sessions spawned by a subagent rather than a human chat. */
  readonly subagents: number
  readonly cny: number
  readonly usd: number
  readonly tokens: number
}

/** One day or month bucket. */
export interface BucketRow {
  /** Sortable bucket key: `YYYY-MM-DD` or `YYYY-MM`. */
  readonly key: string
  readonly sessions: number
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
 * Read the usage buckets of one session, or undefined when it has none.
 * @param session - session-list row.
 * @returns the pricing input, or undefined when the row carries no usage.
 */
function usageOf(session: SessionSummaryLike): TurnUsageLike | undefined {
  const projection = session.projectionValues?.tokenUsage
  if (projection === undefined) return undefined
  const uncachedInputTokens = projection.uncachedInputTokens ?? 0
  const outputTokens = projection.outputTokens ?? 0
  const cacheReadTokens = projection.cacheReadTokens ?? 0
  const cacheWriteTokens = projection.cacheWriteTokens ?? 0
  if (uncachedInputTokens + outputTokens + cacheReadTokens + cacheWriteTokens === 0) return undefined
  const selection = session.projectionValues?.modelSelection
  const route = selection?.lastUsed ?? selection?.next ?? undefined
  return {
    uncachedInputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    ...(route === undefined ? {} : { routes: [{ provider: route.provider, model: route.model }] }),
  }
}

/**
 * Fold the session list into priced rows.
 * @param state - `useSessions` snapshot.
 * @param nowMs - fallback instant for a row without `updatedAt`.
 * @returns priced rows plus the number of skipped sessions.
 */
export function scanSessions(state: SessionListStateLike, nowMs: number = Date.now()): SessionScan {
  const rows: SessionCostRow[] = []
  let skipped = 0
  for (const id of state.ids ?? []) {
    const session = state.byId?.[id]
    if (session === undefined) continue
    const usage = usageOf(session)
    if (usage === undefined) {
      skipped += 1
      continue
    }
    const at = Number.isFinite(session.updatedAt) ? (session.updatedAt as number) : nowMs
    const estimate = estimateTurnUsage(usage, { startMs: at, endMs: at }, nowMs)
    const route = usage.routes?.[0]
    const priced = estimate !== undefined && estimate.unpricedModels.length === 0
    const cacheReadTokens = usage.cacheReadTokens ?? 0
    const uncachedInputTokens = usage.uncachedInputTokens
    const outputTokens = usage.outputTokens
    rows.push({
      id,
      title: session.displayTitle ?? session.title ?? id.slice(0, 8),
      at,
      subagent: session.origin === 'subagent',
      running: session.running === true,
      model: route?.model,
      provider: route?.provider,
      plan: priced ? estimate?.plan.label : undefined,
      priced,
      cny: priced ? (estimate?.cny.total ?? 0) : 0,
      usd: priced ? (estimate?.usd.total ?? 0) : 0,
      tokens: uncachedInputTokens + cacheReadTokens + outputTokens,
      cacheReadTokens,
      uncachedInputTokens,
      outputTokens,
    })
  }
  rows.sort((left, right) => right.at - left.at)
  return { rows, skipped }
}

/**
 * Aggregate rows into day or month buckets, newest first.
 * @param rows - priced rows.
 * @param mode - grouping granularity.
 * @returns bucket rows.
 */
export function bucketRows(rows: readonly SessionCostRow[], mode: BucketMode): readonly BucketRow[] {
  const buckets = new Map<string, { sessions: number, cny: number, usd: number, tokens: number }>()
  for (const row of rows) {
    const key = bucketKeyOf(row.at, mode)
    const bucket = buckets.get(key) ?? { sessions: 0, cny: 0, usd: 0, tokens: 0 }
    bucket.sessions += 1
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
 * Totals over a row selection.
 * @param rows - selected rows.
 * @returns session count, money, tokens, and the unpriced/subagent split.
 */
export function totalsOf(rows: readonly SessionCostRow[]): CostTotals {
  let cny = 0
  let usd = 0
  let tokens = 0
  let unpriced = 0
  let subagents = 0
  for (const row of rows) {
    cny += row.cny
    usd += row.usd
    tokens += row.tokens
    if (!row.priced) unpriced += 1
    if (row.subagent) subagents += 1
  }
  return { sessions: rows.length, unpriced, subagents, cny, usd, tokens }
}

/**
 * Whether a row belongs to a bucket key.
 * @param row - priced row.
 * @param mode - grouping granularity.
 * @param key - bucket key, or undefined for "no bucket filter".
 * @returns whether the row is inside the selection.
 */
export function matchesBucket(row: SessionCostRow, mode: BucketMode, key: string | undefined): boolean {
  return key === undefined || bucketKeyOf(row.at, mode) === key
}

/**
 * Filter rows by an optional bucket key.
 * @param rows - priced rows.
 * @param mode - grouping granularity.
 * @param key - bucket key, or undefined for every row.
 * @returns the rows inside the selection.
 */
export function filterRows(
  rows: readonly SessionCostRow[],
  mode: BucketMode,
  key: string | undefined,
): readonly SessionCostRow[] {
  return key === undefined ? rows : rows.filter(row => matchesBucket(row, mode, key))
}
