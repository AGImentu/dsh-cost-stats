/**
 * Calendar math for the statistics page's date/month pickers.
 *
 * Pure and dependency-free so the grid rules are unit-testable: a Monday-first
 * 6×7 grid that always covers the whole month (leading/trailing days included so
 * the layout never jumps), month arithmetic across year boundaries, and
 * `YYYY-MM` key parsing.
 *
 * @module dsh-session-cost/client/calendar
 */

import { dayKeyOf } from './stats-model.ts'

/** One cell of the day grid. */
export interface CalendarCell {
  /** `YYYY-MM-DD` local day key. */
  readonly key: string
  /** Day-of-month label. */
  readonly label: string
  /** Whether the cell belongs to the month being displayed. */
  readonly inMonth: boolean
}

/** Weekday header labels, Monday first. */
export const WEEKDAYS: readonly string[] = ['一', '二', '三', '四', '五', '六', '日']

/** A resolved year/month pair (1-based month). */
export interface YearMonth {
  readonly year: number
  readonly month: number
}

/**
 * Build the Monday-first 6×7 day grid for a month.
 * @param year - full year.
 * @param month - 1-based month.
 * @returns six weeks of seven cells.
 */
export function monthGrid(year: number, month: number): readonly (readonly CalendarCell[])[] {
  const first = new Date(year, month - 1, 1)
  const offset = (first.getDay() + 6) % 7
  const weeks: CalendarCell[][] = []
  for (let week = 0; week < 6; week += 1) {
    const cells: CalendarCell[] = []
    for (let day = 0; day < 7; day += 1) {
      const cellDate = new Date(year, month - 1, 1 - offset + week * 7 + day)
      cells.push({
        key: dayKeyOf(cellDate.getTime()),
        label: String(cellDate.getDate()),
        inMonth: cellDate.getMonth() === month - 1 && cellDate.getFullYear() === year,
      })
    }
    weeks.push(cells)
  }
  return weeks
}

/**
 * Move a year/month by whole months, wrapping years.
 * @param at - starting pair.
 * @param delta - months to add (negative moves back).
 * @returns the shifted pair.
 */
export function shiftMonth(at: YearMonth, delta: number): YearMonth {
  const index = at.year * 12 + (at.month - 1) + delta
  return { year: Math.floor(index / 12), month: (index % 12 + 12) % 12 + 1 }
}

/**
 * Format a year/month pair as a `YYYY-MM` key.
 * @param at - the pair.
 * @returns the key.
 */
export function yearMonthKey(at: YearMonth): string {
  return `${String(at.year).padStart(4, '0')}-${String(at.month).padStart(2, '0')}`
}

/**
 * Parse a `YYYY-MM` key.
 * @param key - the key, or undefined.
 * @returns the pair, or undefined when the key is absent or malformed.
 */
export function parseYearMonthKey(key: string | undefined): YearMonth | undefined {
  if (key === undefined) return undefined
  const match = /^(\d{4})-(\d{2})$/.exec(key)
  if (match === null) return undefined
  const year = Number(match[1])
  const month = Number(match[2])
  if (month < 1 || month > 12) return undefined
  return { year, month }
}

/**
 * Local day key of "today" shifted by whole days.
 * @param nowMs - reference instant.
 * @param deltaDays - days to add.
 * @returns the day key.
 */
export function dayKeyShifted(nowMs: number, deltaDays: number): string {
  const date = new Date(nowMs)
  return dayKeyOf(new Date(date.getFullYear(), date.getMonth(), date.getDate() + deltaDays).getTime())
}
