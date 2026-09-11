import { describe, expect, it } from 'vitest'
import {
  bucketKeyOf, bucketRows, dayKeyOf, filterRows, matchesBucket, monthKeyOf, scanSessions, totalsOf,
} from '../src/client/session-costs.ts'
import type { SessionListStateLike, SessionSummaryLike } from '../src/client/contract.ts'

/** Local wall-clock instant, so day/month keys are timezone-independent. */
const local = (year: number, month: number, day: number, hour = 12): number =>
  new Date(year, month - 1, day, hour, 0, 0).getTime()

/** Beijing wall-clock instant on Monday 2026-09-14, so peak/off-peak is fixed. */
const beijing = (hour: number): number => Date.UTC(2026, 8, 14, hour - 8, 0, 0)

/** One session-list row with Flash usage. */
function session(over: Partial<SessionSummaryLike> = {}, tokens: {
  uncachedInputTokens?: number
  outputTokens?: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
} = {
  uncachedInputTokens: 1_000_000,
  outputTokens: 1_000_000,
  cacheReadTokens: 0,
}): SessionSummaryLike {
  return {
    id: 's1',
    displayTitle: 'Session one',
    updatedAt: beijing(3),
    projectionValues: {
      tokenUsage: tokens,
      modelSelection: { lastUsed: { provider: 'deepseek-official', model: 'deepseek-flash' } },
    },
    ...over,
  }
}

/** Wrap rows into a `useSessions` snapshot. */
function state(rows: readonly SessionSummaryLike[]): SessionListStateLike {
  const byId: Record<string, SessionSummaryLike> = {}
  for (const row of rows) byId[row.id] = row
  return { ids: rows.map(row => row.id), byId }
}

describe('day and month keys', () => {
  it('builds zero-padded local keys', () => {
    expect(dayKeyOf(local(2026, 9, 4, 9))).toBe('2026-09-04')
    expect(monthKeyOf(local(2026, 12, 31, 23))).toBe('2026-12')
    expect(bucketKeyOf(local(2026, 1, 1), 'day')).toBe('2026-01-01')
    expect(bucketKeyOf(local(2026, 1, 1), 'month')).toBe('2026-01')
  })
})

describe('scanSessions', () => {
  it('prices a Flash session with the published off-peak rates', () => {
    const scan = scanSessions(state([session()]))
    expect(scan.skipped).toBe(0)
    expect(scan.rows).toHaveLength(1)
    const row = scan.rows[0]!
    expect(row.priced).toBe(true)
    expect(row.plan).toBe('DeepSeek-V4.1-Flash')
    expect(row.cny).toBeCloseTo(5, 8)
    expect(row.usd).toBeCloseTo(0.75, 8)
    expect(row.tokens).toBe(2_000_000)
  })

  it('charges peak rates when the session was last active inside a peak window', () => {
    const scan = scanSessions(state([session({ updatedAt: beijing(10) })]))
    expect(scan.rows[0]!.cny).toBeCloseTo(10, 8)
  })

  it('skips rows with no usage projection and keeps the count', () => {
    const scan = scanSessions(state([
      session({ id: 'with', displayTitle: 'With usage' }),
      { id: 'without', displayTitle: 'Cold' },
      { id: 'empty', projectionValues: { tokenUsage: { uncachedInputTokens: 0, outputTokens: 0 } } },
    ]))
    expect(scan.rows.map(row => row.id)).toEqual(['with'])
    expect(scan.skipped).toBe(2)
  })

  it('leaves a session unpriced when its model has no published price', () => {
    const scan = scanSessions(state([session({
      projectionValues: {
        tokenUsage: { uncachedInputTokens: 1_000_000, outputTokens: 0 },
        modelSelection: { lastUsed: { provider: 'openrouter', model: 'llama-4' } },
      },
    })]))
    const row = scan.rows[0]!
    expect(row.priced).toBe(false)
    expect(row.cny).toBe(0)
    expect(row.usd).toBe(0)
    expect(row.tokens).toBe(1_000_000)
    expect(row.model).toBe('llama-4')
  })

  it('flags subagent origin and sorts newest first', () => {
    const scan = scanSessions(state([
      session({ id: 'old', updatedAt: beijing(3) }, { uncachedInputTokens: 1, outputTokens: 0 }),
      session({ id: 'sub', origin: 'subagent', updatedAt: beijing(5), running: true }, { uncachedInputTokens: 1, outputTokens: 0 }),
    ]))
    expect(scan.rows.map(row => row.id)).toEqual(['sub', 'old'])
    expect(scan.rows[0]!.subagent).toBe(true)
    expect(scan.rows[0]!.running).toBe(true)
  })

  it('falls back to the pending selection when nothing was used yet', () => {
    const scan = scanSessions(state([session({
      projectionValues: {
        tokenUsage: { uncachedInputTokens: 1_000_000, outputTokens: 0 },
        modelSelection: { lastUsed: null, next: { provider: 'deepseek-official', model: 'deepseek-v4-pro' } },
      },
    })]))
    expect(scan.rows[0]!.plan).toBe('DeepSeek-V4-Pro-0813')
  })
})

describe('bucketRows', () => {
  const rows = scanSessions(state([
    session({ id: 'a', updatedAt: local(2026, 9, 11, 9) }, { uncachedInputTokens: 1_000_000, outputTokens: 0 }),
    session({ id: 'b', updatedAt: local(2026, 9, 11, 18) }, { uncachedInputTokens: 1_000_000, outputTokens: 0 }),
    session({ id: 'c', updatedAt: local(2026, 8, 31, 12) }, { uncachedInputTokens: 1_000_000, outputTokens: 0 }),
  ])).rows

  it('groups by local day, newest first', () => {
    const buckets = bucketRows(rows, 'day')
    expect(buckets.map(bucket => bucket.key)).toEqual(['2026-09-11', '2026-08-31'])
    expect(buckets[0]!.sessions).toBe(2)
    expect(buckets[0]!.tokens).toBe(2_000_000)
  })

  it('groups by local month', () => {
    const buckets = bucketRows(rows, 'month')
    expect(buckets.map(bucket => bucket.key)).toEqual(['2026-09', '2026-08'])
    expect(buckets[0]!.sessions).toBe(2)
  })

  it('filters a selection down to one bucket', () => {
    expect(filterRows(rows, 'day', '2026-08-31').map(row => row.id)).toEqual(['c'])
    expect(matchesBucket(rows[0]!, 'month', '2026-09')).toBe(true)
    expect(filterRows(rows, 'day', undefined)).toHaveLength(3)
  })
})

describe('totalsOf', () => {
  it('sums money, tokens, and the subagent/unpriced split', () => {
    const rows = scanSessions(state([
      session({ id: 'a' }, { uncachedInputTokens: 1_000_000, outputTokens: 0 }),
      session({ id: 'b', origin: 'subagent' }, { uncachedInputTokens: 1_000_000, outputTokens: 0 }),
      session({
        id: 'c',
        projectionValues: {
          tokenUsage: { uncachedInputTokens: 1_000_000, outputTokens: 0 },
          modelSelection: { lastUsed: { provider: 'openrouter', model: 'llama-4' } },
        },
      }),
    ])).rows
    const totals = totalsOf(rows)
    expect(totals.sessions).toBe(3)
    expect(totals.subagents).toBe(1)
    expect(totals.unpriced).toBe(1)
    // Each priced session is 1M uncached input at the off-peak Flash rate (¥1).
    expect(totals.cny).toBeCloseTo(2, 8)
    expect(totals.tokens).toBe(3_000_000)
  })
})
