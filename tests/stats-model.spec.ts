import { describe, expect, it } from 'vitest'
import { dayKeyOf, monthKeyOf, paginate, totalsOf } from '../src/client/stats-model.ts'
import type { TurnCostRow } from '../src/rows.ts'

/** Local wall-clock instant, so day/month keys are timezone-independent. */
const local = (year: number, month: number, day: number, hour = 12): number =>
  new Date(year, month - 1, day, hour, 0, 0).getTime()

/** One priced reply row. */
function row(over: Partial<TurnCostRow> = {}): TurnCostRow {
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
    tokens: 1_000,
    attempts: 1,
    ...over,
  }
}

describe('group keys', () => {
  it('builds zero-padded local keys', () => {
    expect(dayKeyOf(local(2026, 9, 4, 9))).toBe('2026-09-04')
    expect(monthKeyOf(local(2026, 12, 31, 23))).toBe('2026-12')
    expect(monthKeyOf(local(2026, 1, 1, 0))).toBe('2026-01')
  })

  it('keeps one local calendar day on one key across its hours', () => {
    expect(dayKeyOf(local(2026, 9, 11, 0))).toBe('2026-09-11')
    expect(dayKeyOf(local(2026, 9, 11, 23))).toBe('2026-09-11')
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
    expect(totalsOf([])).toMatchObject({ replies: 0, compactions: 0, sessions: 0, cny: 0, usd: 0, tokens: 0 })
  })

  it('counts a compaction separately while its money joins the total', () => {
    const rows = [
      row({ turn: 1, cny: 1, usd: 0.15, tokens: 100 }),
      row({ turn: 0, compaction: true, cny: 2, usd: 0.3, tokens: 200 }),
    ]
    const totals = totalsOf(rows)
    expect(totals.replies).toBe(1)
    expect(totals.compactions).toBe(1)
    expect(totals.sessions).toBe(1)
    expect(totals.cny).toBeCloseTo(3, 8)
    expect(totals.usd).toBeCloseTo(0.45, 8)
    expect(totals.tokens).toBe(300)
  })

  it('never counts a compaction as a subagent reply', () => {
    const totals = totalsOf([row({ turn: 0, compaction: true, subagent: true })])
    expect(totals.compactions).toBe(1)
    expect(totals.subagents).toBe(0)
    expect(totals.replies).toBe(0)
  })
})

describe('paginate', () => {
  const rows = Array.from({ length: 45 }, (_value, index) => index)

  it('cuts the requested page into rows-per-page slices', () => {
    expect(paginate(rows, 1, 20)).toEqual({ page: 1, pages: 3, rows: rows.slice(0, 20) })
    expect(paginate(rows, 2, 20)).toEqual({ page: 2, pages: 3, rows: rows.slice(20, 40) })
    expect(paginate(rows, 3, 20)).toEqual({ page: 3, pages: 3, rows: rows.slice(40, 45) })
  })

  it('clamps a page that a shrunken selection left out of range', () => {
    expect(paginate(rows.slice(0, 5), 3, 20)).toEqual({ page: 1, pages: 1, rows: rows.slice(0, 5) })
    expect(paginate(rows.slice(0, 21), 9, 20)).toEqual({ page: 2, pages: 2, rows: rows.slice(20, 21) })
  })

  it('treats a non-positive or fractional page as the first page', () => {
    expect(paginate(rows, 0, 20).page).toBe(1)
    expect(paginate(rows, -4, 20).page).toBe(1)
    expect(paginate(rows, 1.7, 20).page).toBe(1)
    expect(paginate(rows, Number.NaN, 20).page).toBe(1)
  })

  it('always offers one page, even for an empty selection', () => {
    expect(paginate([], 1, 20)).toEqual({ page: 1, pages: 1, rows: [] })
  })

  it('never divides by a zero page size', () => {
    expect(paginate(rows, 1, 0)).toEqual({ page: 1, pages: 45, rows: [0] })
  })
})
