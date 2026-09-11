/**
 * The "Cost stats" settings page.
 *
 * Registered into `settings.section` (a ROOT-scope list slot): DSH's settings
 * shell puts one nav cell per entry and renders the entry inside its content
 * column, so this file owns the whole page.
 *
 * The page is deliberately one list: every assistant reply with its time,
 * session, tokens and cost. Date and month are chosen through calendar pickers
 * (`Pickers.tsx`) rather than tabs, and the single total card follows whatever is
 * selected — there is no second, aggregate table to drift out of sync with the
 * rows below it.
 *
 * Data comes from the plugin's own host route (`GET /session-cost/usage`), which
 * folds every stored session log into per-reply priced rows.
 *
 * @module dsh-session-cost/client/StatsSection
 */

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { formatMoney } from '../pricing.ts'
import { USAGE_ROUTE } from '../routes.ts'
import type { TurnCostRow, UsagePayload } from '../rows.ts'
import type { CostStatsProps, Translator } from './contract.ts'
import { fallbackTranslator } from './locales.ts'
import { DayPicker, MonthPicker } from './Pickers.tsx'
import { dayKeyOf, monthKeyOf, totalsOf } from './stats-model.ts'
import { CLASS } from './styles.ts'

/** Replies rendered at once; the pickers and total still cover every row. */
const ROW_LIMIT = 300

/**
 * Compact token label (1.2M / 345.0K / 812).
 * @param value - token count.
 * @returns the label.
 */
function formatTokens(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`
  return String(value)
}

/**
 * Local-time row label: `MM-DD HH:mm`, with the year when it differs.
 * @param at - epoch ms.
 * @param now - reference instant.
 * @returns the label.
 */
function formatStamp(at: number, now: number): string {
  const date = new Date(at)
  const pad = (value: number): string => String(value).padStart(2, '0')
  const sameYear = date.getFullYear() === new Date(now).getFullYear()
  const day = `${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
  return `${sameYear ? day : `${date.getFullYear()}-${day}`} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/**
 * The statistics page.
 * @param props - locale translator from the slot seat.
 * @returns the page.
 */
export function CostStatsSection({ t }: CostStatsProps): ReactNode {
  const tr = t ?? fallbackTranslator
  const [payload, setPayload] = useState<UsagePayload | undefined>(undefined)
  const [error, setError] = useState<string | undefined>(undefined)
  const [loading, setLoading] = useState(true)
  /** `YYYY-MM-DD` day filter; mutually exclusive with `month`. */
  const [day, setDay] = useState<string | undefined>(undefined)
  /** `YYYY-MM` month filter. */
  const [month, setMonth] = useState<string | undefined>(undefined)

  /**
   * Load the payload from the host route.
   * @param force - bypass the host's own payload cache.
   */
  const load = useCallback((force = false): void => {
    setLoading(true)
    setError(undefined)
    const url = force ? `${USAGE_ROUTE}?refresh=1` : USAGE_ROUTE
    void fetch(url, { credentials: 'same-origin', headers: { accept: 'application/json' } })
      .then(async (response) => {
        if (!response.ok) throw new Error(`${String(response.status)} ${response.statusText}`)
        return await response.json() as UsagePayload
      })
      .then((next) => { setPayload(next); setLoading(false) })
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : String(cause))
        setLoading(false)
      })
  }, [])

  useEffect(() => { load(false) }, [load])

  const rows = payload?.rows ?? []
  const dataDays = useMemo(() => new Set(rows.map(row => dayKeyOf(row.at))), [rows])
  const dataMonths = useMemo(() => new Set(rows.map(row => monthKeyOf(row.at))), [rows])
  const selected = useMemo(() => {
    if (day !== undefined) return rows.filter(row => dayKeyOf(row.at) === day)
    if (month !== undefined) return rows.filter(row => monthKeyOf(row.at) === month)
    return rows
  }, [rows, day, month])
  const totals = useMemo(() => totalsOf(selected), [selected])
  const visible = selected.slice(0, ROW_LIMIT)
  const now = Date.now()
  const scope = day ?? month ?? tr('stats.scope.all')

  return (
    <div className={CLASS.stats} data-session-cost-stats>
      <div className={CLASS.statsHead}>
        <div className={CLASS.statsTitle}>{tr('stats.title')}</div>
        <div className={CLASS.statsSubtitle}>{tr('stats.subtitle')}</div>
      </div>

      <div className={CLASS.toolbar}>
        <DayPicker
          tr={tr}
          value={day}
          dataDays={dataDays}
          onPick={(key) => { setDay(key); if (key !== undefined) setMonth(undefined) }}
        />
        <MonthPicker
          tr={tr}
          value={month}
          dataMonths={dataMonths}
          onPick={(key) => { setMonth(key); if (key !== undefined) setDay(undefined) }}
        />
        {(day !== undefined || month !== undefined) && (
          <button
            type="button"
            className={CLASS.pickerAction}
            onClick={() => { setDay(undefined); setMonth(undefined) }}
          >
            {tr('stats.scope.clear')}
          </button>
        )}
        <button type="button" className={CLASS.pickerAction} onClick={() => { load(true) }}>
          {tr('stats.refresh')}
        </button>
      </div>

      <div className={CLASS.statsTotal}>
        <div>
          <div className={CLASS.statsSubtitle}>{`${tr('stats.total')} · ${scope}`}</div>
          <div className={CLASS.statsTotalValue}>{formatMoney(totals.cny, 'CNY')}</div>
          <span className={CLASS.moneySub}>{formatMoney(totals.usd, 'USD')}</span>
        </div>
        <div className={CLASS.statsMetrics}>
          <span className={CLASS.metric}>{tr('stats.metric.replies')} {totals.replies}</span>
          <span className={CLASS.metric}>{tr('stats.metric.sessions')} {totals.sessions}</span>
          <span className={CLASS.metric}>{tr('stats.metric.tokens')} {formatTokens(totals.tokens)}</span>
          {totals.subagents > 0 && (
            <span className={CLASS.metric}>{tr('stats.metric.subagents', { count: totals.subagents })}</span>
          )}
          {totals.unpriced > 0 && (
            <span className={CLASS.metric}>{tr('stats.metric.unpriced', { count: totals.unpriced })}</span>
          )}
        </div>
      </div>

      {error !== undefined && (
        <div className={CLASS.empty}>
          {tr('stats.error')}
          <br />
          <span className={CLASS.moneySub}>{error}</span>
        </div>
      )}

      {error === undefined && loading && rows.length === 0 && (
        <div className={CLASS.empty}>{tr('stats.loading')}</div>
      )}

      {error === undefined && !loading && selected.length === 0 && (
        <div className={CLASS.empty}>{tr('stats.empty')}</div>
      )}

      {selected.length > 0 && (
        <table className={CLASS.table}>
          <thead>
            <tr>
              <th className={CLASS.num}>{tr('stats.col.time')}</th>
              <th>{tr('stats.col.session')}</th>
              <th className={CLASS.num}>{tr('stats.col.tokens')}</th>
              <th className={CLASS.num}>{tr('stats.col.cost')}</th>
            </tr>
          </thead>
          <tbody>
            {visible.map(row => (
              <ReplyRow key={`${row.sessionId}:${String(row.turn)}`} row={row} tr={tr} now={now} />
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

/**
 * One reply row: stamp, session name with tags, tokens, money.
 * @param props - the priced row, translator, and the reference instant.
 * @returns the table row.
 */
function ReplyRow({ row, tr, now }: { row: TurnCostRow, tr: Translator, now: number }): ReactNode {
  const label = `${row.sessionTitle} · #${String(row.turn)}${row.model === undefined ? '' : ` · ${row.model}`}`
  return (
    <tr>
      <td className={CLASS.num}>{formatStamp(row.at, now)}</td>
      <td className={CLASS.session} title={label}>
        {row.sessionTitle}
        {row.subagent && <span className={CLASS.badge}>{tr('stats.tag.subagent')}</span>}
        {!row.priced && <span className={CLASS.badge}>{tr('stats.tag.unpriced')}</span>}
      </td>
      <td className={CLASS.num}>{formatTokens(row.tokens)}</td>
      <td className={CLASS.num}>
        {row.priced ? formatMoney(row.cny, 'CNY') : '—'}
        <span className={CLASS.moneySub}>{row.priced ? formatMoney(row.usd, 'USD') : (row.model ?? '')}</span>
      </td>
    </tr>
  )
}
