import { describe, expect, it } from 'vitest'
import {
  bucketKeyOf, bucketRows, dayKeyOf, filterRows, matchesBucket, monthKeyOf, totalsOf,
} from '../src/client/stats-model.ts'
import type { TurnCostRow } from '../src/rows.ts'

/** Local wall-clock instant, so day/month keys are timezone-independent. */
const local = (year: number, month: number, day: number, hour = 12): number =>
  new Date(year, month - 1, day, hour, 0, 0).getTime()

/** One priced reply row. */
function row(over: Partial<TurnCostRow> = {}): TurnCostRow {
  const tokens = over.tokens ?? 1_000
  return {
    sessionId: 's1',
    sessionTitle: 'Session one',
    subagent: false,
    turn: 1,
    at: local(2026, 9, 11, 10),
    provider: 'deepseek-official',
    model: 'deepseek-flash',
    plan: 'DeepSeek-V4.1-Flash',
    priced: true,
    cny: 0.5,
    usd: 0.075,
    uncachedInputTokens: 100,
    cacheReadTokens: 800,
    outputTokens: 100,
    reasoningTokens: 20,
    tokens,
    attempts: 1,
    ...over,
  }
}

describe('day and month keys', () => {
  it('builds zero-padded local keys', () => {
    expect(dayKeyOf(local(2026, 9, 4, 9))).toBe('2026-09-04')
    expect(monthKeyOf(local(2026, 12, 31, 23))).toBe('2026-12')
    expect(bucketKeyOf(local(2026, 1, 1), 'day')).toBe('2026-01-01')
    expect(bucketKeyOf(local(2026, 1, 1), 'month')).toBe('2026-01')
  })
})

describe('bucketRows', () => {
  const rows = [
    row({ turn: 1, at: local(2026, 9, 11, 9), cny: 1, usd: 0.15, tokens: 100 }),
    row({ turn: 2, at: local(2026, 9, 11, 18), cny: 2, usd: 0.3, tokens: 200 }),
    row({ turn: 1, at: local(2026, 8, 31, 12), cny: 4, usd: 0.6, tokens: 400 }),
  ]

  it('groups by local day, newest first', () => {
    const buckets = bucketRows(rows, 'day')
    expect(buckets.map(bucket => bucket.key)).toEqual(['2026-09-11', '2026-08-31'])
    expect(buckets[0]).toMatchObject({ replies: 2, cny: 3, tokens: 300 })
    expect(buckets[1]).toMatchObject({ replies: 1, cny: 4 })
  })

  it('groups by local month, newest first', () => {
    const buckets = bucketRows(rows, 'month')
    expect(buckets.map(bucket => bucket.key)).toEqual(['2026-09', '2026-08'])
    expect(buckets[0]).toMatchObject({ replies: 2, cny: 3 })
  })

  it('gives every row its own bucket set (no cross-bucket leakage)', () => {
    const buckets = bucketRows([row({ at: local(2026, 9, 11, 1) })], 'day')
    expect(buckets).toHaveLength(1)
    expect(buckets[0]!.tokens).toBe(1_000)
  })
})

describe('filterRows and matchesBucket', () => {
  const rows = [
    row({ turn: 1, at: local(2026, 9, 11, 9) }),
    row({ turn: 2, at: local(2026, 8, 31, 9) }),
  ]

  it('filters to one bucket and back', () => {
    expect(filterRows(rows, 'day', '2026-08-31').map(item => item.turn)).toEqual([2])
    expect(filterRows(rows, 'month', '2026-09').map(item => item.turn)).toEqual([1])
    expect(filterRows(rows, 'day', undefined)).toHaveLength(2)
    expect(matchesBucket(rows[0]!, 'month', '2026-08')).toBe(false)
    expect(matchesBucket(rows[0]!, 'month', undefined)).toBe(true)
  })
})

describe('totalsOf', () => {
  it('sums money, tokens and the session/subagent/unpriced split', () => {
    const rows = [
      row({ turn: 1, cny: 1, usd: 0.15, tokens: 100 }),
      row({ turn: 2, sessionId: 's1', cny: 2, usd: 0.3, tokens: 200 }),
      row({ turn: 1, sessionId: 's2', subagent: true, cny: 3, usd: 0.45, tokens: 300 }),
      row({ turn: 1, sessionId: 's3', priced: false, cny: 0, usd: 0, tokens: 400 }),
    ]
    const totals = totalsOf(rows)
    expect(totals.replies).toBe(4)
    expect(totals.sessions).toBe(3)
    expect(totals.subagents).toBe(1)
    expect(totals.unpriced).toBe(1)
    expect(totals.cny).toBeCloseTo(6, 8)
    expect(totals.usd).toBeCloseTo(0.9, 8)
    expect(totals.tokens).toBe(1_000)
  })

  it('reports an empty selection as zeroes rather than undefined', () => {
    expect(totalsOf([])).toMatchObject({ replies: 0, sessions: 0, cny: 0, usd: 0, tokens: 0 })
  })
})
