/**
 * The calendar rule behind DeepSeek's off-peak rates.
 *
 * DeepSeek bills peak and off-peak prices (off-peak is exactly half), and its
 * published rule is wider than "weekends plus two windows on weekdays":
 *
 * > 调休上班的周末、中国法定节假日全天均按空闲时段计费。
 * > (Weekends worked as make-up days, and Chinese statutory holidays, are billed
 * > at the off-peak rate all day.)
 *
 * — DeepSeek's API peak/off-peak notice, 2026-09-19.
 *
 * Two consequences for this plugin:
 *
 * 1. A **weekday inside a statutory holiday** is off-peak all day. 0.13.0 priced
 *    those at peak rates: on 2026-10-01 (National Day, a Thursday) a 15:44 turn
 *    was estimated at ¥2.51 when DeepSeek charged about half that. That is the
 *    bug this module fixes.
 * 2. A **weekend that is a make-up workday** stays off-peak. That already falls
 *    out of `isPeak`'s weekend rule, so the dates below deliberately do NOT
 *    include them — they are listed here only as a comment, so a future reader
 *    does not "fix" them into peak days by mistake.
 *
 * The list is data, not logic: it comes from 《国务院办公厅关于2026年部分节假日安排的通知》
 * (published 2025-11-04) and must be extended when the State Council publishes
 * the next year's arrangement. Until then a future year's holidays simply bill at
 * peak rates on their weekdays — the same behaviour as before this module, and
 * the plugin's estimates are documented as estimates.
 *
 * @module dsh-cost-stats/holidays
 */

/**
 * Every date inside a 2026 statutory holiday range, in Beijing time.
 *
 * Ranges are included in full (weekends and all) even though the weekend rule
 * already covers part of them: one flat list is easier to verify against the
 * official notice, and a duplicate reason for "off-peak" can never be wrong.
 *
 * 2026 arrangements: 元旦 1/1–1/3 · 春节 2/15–2/23 · 清明 4/4–4/6 ·
 * 劳动节 5/1–5/5 · 端午 6/19–6/21 · 中秋 9/25–9/27 · 国庆 10/1–10/7.
 *
 * Make-up workdays on weekends (1/4, 2/14, 2/28, 5/9, 9/20, 10/10) are NOT listed
 * on purpose: DeepSeek bills them at off-peak, and the weekend rule already does.
 */
const HOLIDAY_RANGES_2026: readonly (readonly [string, string])[] = [
  ['2026-01-01', '2026-01-03'],
  ['2026-02-15', '2026-02-23'],
  ['2026-04-04', '2026-04-06'],
  ['2026-05-01', '2026-05-05'],
  ['2026-06-19', '2026-06-21'],
  ['2026-09-25', '2026-09-27'],
  ['2026-10-01', '2026-10-07'],
]

/**
 * Expand an inclusive `YYYY-MM-DD` range into its dates, in UTC arithmetic.
 *
 * The keys are calendar dates in Beijing time, so they are manipulated as plain
 * dates (UTC) and never as instants — no timezone can shift a day boundary here.
 * @param from - first date.
 * @param to - last date, inclusive.
 * @returns the dates, or an empty list when the range is malformed or reversed.
 */
function expandRange(from: string, to: string): string[] {
  const start = Date.parse(`${from}T00:00:00Z`)
  const end = Date.parse(`${to}T00:00:00Z`)
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return []
  const days: string[] = []
  // A guard, not a rule: no statutory range is anywhere near this long.
  for (let at = start; at <= end && days.length < 60; at += 86_400_000) {
    days.push(new Date(at).toISOString().slice(0, 10))
  }
  return days
}

/** The dates billed at off-peak rates all day, whatever the hour. */
export const OFF_PEAK_ALL_DAY: ReadonlySet<string> = new Set(
  HOLIDAY_RANGES_2026.flatMap(([from, to]) => expandRange(from, to)),
)

/**
 * Whether a Beijing calendar date is off-peak all day.
 * @param beijingDate - `YYYY-MM-DD` in Beijing time.
 * @returns whether DeepSeek bills it at the off-peak rate around the clock.
 */
export function isOffPeakAllDay(beijingDate: string): boolean {
  return OFF_PEAK_ALL_DAY.has(beijingDate)
}
