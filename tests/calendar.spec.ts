import { describe, expect, it } from 'vitest'
import {
  dayKeyShifted, monthGrid, parseYearMonthKey, shiftMonth, yearMonthKey,
} from '../src/client/calendar.ts'

describe('monthGrid', () => {
  it('always returns six Monday-first weeks of seven cells', () => {
    const grid = monthGrid(2026, 9)
    expect(grid).toHaveLength(6)
    for (const week of grid) expect(week).toHaveLength(7)
    // 2026-09-01 is a Tuesday, so the grid opens on Monday 2026-08-31.
    expect(grid[0]![0]!.key).toBe('2026-08-31')
    expect(grid[0]![1]!.key).toBe('2026-09-01')
    expect(grid[0]![1]!.inMonth).toBe(true)
    expect(grid[0]![0]!.inMonth).toBe(false)
  })

  it('covers every day of the month exactly once', () => {
    const grid = monthGrid(2026, 9)
    const inMonth = grid.flat().filter(cell => cell.inMonth)
    expect(inMonth).toHaveLength(30)
    expect(inMonth[0]!.label).toBe('1')
    expect(inMonth.at(-1)!.label).toBe('30')
  })

  it('handles a leap February', () => {
    const inMonth = monthGrid(2028, 2).flat().filter(cell => cell.inMonth)
    expect(inMonth).toHaveLength(29)
    expect(inMonth.at(-1)!.key).toBe('2028-02-29')
  })

  it('handles a month that starts on Monday', () => {
    const grid = monthGrid(2026, 6)
    expect(grid[0]![0]!.key).toBe('2026-06-01')
    expect(grid[0]![0]!.inMonth).toBe(true)
  })
})

describe('shiftMonth', () => {
  it('moves forward and backward across year boundaries', () => {
    expect(shiftMonth({ year: 2026, month: 12 }, 1)).toEqual({ year: 2027, month: 1 })
    expect(shiftMonth({ year: 2026, month: 1 }, -1)).toEqual({ year: 2025, month: 12 })
    expect(shiftMonth({ year: 2026, month: 9 }, -8)).toEqual({ year: 2026, month: 1 })
    expect(shiftMonth({ year: 2026, month: 1 }, -12)).toEqual({ year: 2025, month: 1 })
  })
})

describe('key formatting', () => {
  it('pads months and parses valid keys only', () => {
    expect(yearMonthKey({ year: 2026, month: 9 })).toBe('2026-09')
    expect(parseYearMonthKey('2026-09')).toEqual({ year: 2026, month: 9 })
    expect(parseYearMonthKey('2026-13')).toBeUndefined()
    expect(parseYearMonthKey('2026-9')).toBeUndefined()
    expect(parseYearMonthKey(undefined)).toBeUndefined()
  })

  it('shifts a local day key by whole days', () => {
    const at = new Date(2026, 8, 1, 12).getTime()
    expect(dayKeyShifted(at, -1)).toBe('2026-08-31')
    expect(dayKeyShifted(at, 0)).toBe('2026-09-01')
  })
})
