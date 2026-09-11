/**
 * The "Cost stats" settings page.
 *
 * Registered into `settings.section` (a ROOT-scope list slot): DSH's settings
 * shell puts one nav cell per entry and renders the entry inside its content
 * column, so this file owns the whole page — heading, query switch, total card,
 * tables and states — and contributes no chrome back to the shell.
 *
 * Data comes from the plugin's own host route (`GET /session-cost/usage`), which
 * folds every stored session log into per-reply priced rows. The page itself
 * only groups and totals those rows, so day/month queries are exact arithmetic
 * over the same numbers the host billed.
 *
 * @module dsh-session-cost/client/StatsSection
 */

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { formatMoney } from '../pricing.ts'
import { USAGE_ROUTE } from '../routes.ts'
import type { TurnCostRow, UsagePayload } from '../rows.ts'
import type { CostStatsProps, Translator } from './contract.ts'
import { fallbackTranslator } from './locales.ts'
import { CLASS } from './styles.ts'
import { bucketRows, filterRows, totalsOf, type BucketMode, type StatsMode } from './stats-model.ts'

/** Replies rendered at once; the buckets above always cover every row. */
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

/** Mode switch labels, in tab order. */
const MODES: readonly StatsMode[] = ['day', 'month', 'turns']

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
  const [mode, setMode] = useState<StatsMode>('day')
  const [bucket, setBucket] = useState<string | undefined>(undefined)

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
  const grouping: BucketMode | undefined = mode === 'turns' ? undefined : mode
  const buckets = useMemo(
    () => (grouping === undefined ? [] : bucketRows(rows, grouping)),
    [rows, grouping],
  )
  const selected = useMemo(
    () => (grouping === undefined ? rows : filterRows(rows, grouping, bucket)),
    [rows, grouping, bucket],
  )
  const totals = useMemo(() => totalsOf(selected), [selected])
  const visible = selected.slice(0, ROW_LIMIT)
  const now = Date.now()

  const modeLabel = (value: StatsMode): string => tr(
    value === 'day' ? 'stats.mode.day' : value === 'month' ? 'stats.mode.month' : 'stats.mode.turns',
  )

  return (
    <div className={CLASS.stats} data-session-cost-stats>
      <div className={CLASS.statsHead}>
        <div className={CLASS.statsTitle}>{tr('stats.title')}</div>
        <div className={CLASS.statsSubtitle}>{tr('stats.subtitle')}</div>
      </div>

      <div className={CLASS.tabs} role="group">
        {MODES.map(value => (
          <button
            key={value}
            type="button"
            className={CLASS.tab}
            aria-pressed={mode === value}
            onClick={() => { setMode(value); setBucket(undefined) }}
          >
            {modeLabel(value)}
          </button>
        ))}
        {bucket !== undefined && (
          <button type="button" className={CLASS.tab} onClick={() => { setBucket(undefined) }}>
            {tr('stats.clearSelection')}
          </button>
        )}
        <button type="button" className={CLASS.tab} onClick={() => { load(true) }}>
          {tr('stats.refresh')}
        </button>
      </div>

      <div className={CLASS.statsTotal}>
        <div>
          <div className={CLASS.statsSubtitle}>
            {tr('stats.total')}
            {bucket === undefined ? '' : ` · ${tr('stats.selected', { bucket })}`}
          </div>
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

      {error === undefined && !loading && rows.length === 0 && (
        <div className={CLASS.empty}>{tr('stats.empty')}</div>
      )}

      {rows.length > 0 && (
        <>
          {grouping !== undefined && buckets.length > 0 && (
            <table className={CLASS.table}>
              <thead>
                <tr>
                  <th>{tr(grouping === 'day' ? 'stats.col.day' : 'stats.col.month')}</th>
                  <th className={CLASS.num}>{tr('stats.col.replies')}</th>
                  <th className={CLASS.num}>{tr('stats.col.tokens')}</th>
                  <th className={CLASS.num}>{tr('stats.col.cost')}</th>
                </tr>
              </thead>
              <tbody>
                {buckets.map(row => (
                  <tr
                    key={row.key}
                    className={row.key === bucket ? CLASS.selected : CLASS.selectable}
                    onClick={() => { setBucket(row.key === bucket ? undefined : row.key) }}
                  >
                    <td>{grouping === 'day' ? row.key.slice(5) : row.key}</td>
                    <td className={CLASS.num}>{row.replies}</td>
                    <td className={CLASS.num}>{formatTokens(row.tokens)}</td>
                    <td className={CLASS.num}>
                      {formatMoney(row.cny, 'CNY')}
                      <span className={CLASS.moneySub}>{formatMoney(row.usd, 'USD')}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

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
        </>
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
