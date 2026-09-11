/**
 * The "Cost stats" settings page.
 *
 * Registered into `settings.section` (a ROOT-scope list slot): DSH's settings
 * shell puts one nav cell per entry and renders the entry inside its content
 * column, so this file owns the whole page — heading, query switch, total card,
 * tables and notes — and contributes no chrome back to the shell.
 *
 * Data comes from the session list's projection values (see `session-costs.ts`),
 * which is what lets the page cover every session the object layer knows about
 * without activating any of them. Every number here is an estimate from the
 * official price table; the page says so where it matters.
 *
 * @module dsh-session-cost/client/StatsSection
 */

import { useMemo, useState, type ReactNode } from 'react'
import { formatMoney } from '../pricing.ts'
import type { CostStatsProps, Translator } from './contract.ts'
import { fallbackTranslator } from './locales.ts'
import { CLASS } from './styles.ts'
import {
  bucketRows, filterRows, scanSessions, totalsOf,
  type BucketMode, type SessionCostRow, type StatsMode,
} from './session-costs.ts'

/** Newest session rows rendered at once; the buckets above stay complete. */
const ROW_LIMIT = 200

/** Empty session list used until the standard seat hands one down. */
const NO_SESSIONS = { ids: [] as readonly string[], byId: {} as Readonly<Record<string, undefined>> }

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
const MODES: readonly StatsMode[] = ['day', 'month', 'sessions']

/**
 * The statistics page.
 * @param props - session-list hook and locale translator from the slot seats.
 * @returns the page.
 */
export function CostStatsSection({ useSessions, t }: CostStatsProps): ReactNode {
  const tr = t ?? fallbackTranslator
  const select = useSessions
  const ids = select?.(state => state.ids)
  const byId = select?.(state => state.byId)
  const [mode, setMode] = useState<StatsMode>('day')
  const [bucket, setBucket] = useState<string | undefined>(undefined)

  const scan = useMemo(
    () => scanSessions(ids === undefined || byId === undefined ? NO_SESSIONS : { ids, byId }),
    [ids, byId],
  )
  const grouping: BucketMode | undefined = mode === 'sessions' ? undefined : mode
  const buckets = useMemo(
    () => (grouping === undefined ? [] : bucketRows(scan.rows, grouping)),
    [scan.rows, grouping],
  )
  const selected = useMemo(
    () => (grouping === undefined ? scan.rows : filterRows(scan.rows, grouping, bucket)),
    [scan.rows, grouping, bucket],
  )
  const totals = useMemo(() => totalsOf(selected), [selected])
  const visible = selected.slice(0, ROW_LIMIT)
  const now = Date.now()

  const modeLabel = (value: StatsMode): string => tr(
    value === 'day' ? 'stats.mode.day' : value === 'month' ? 'stats.mode.month' : 'stats.mode.sessions',
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

      {scan.rows.length === 0 ? (
        <div className={CLASS.empty}>
          {tr('stats.empty')}
          <br />
          {tr('stats.emptyHint')}
        </div>
      ) : (
        <>
          {grouping !== undefined && buckets.length > 0 && (
            <table className={CLASS.table}>
              <thead>
                <tr>
                  <th>{tr(grouping === 'day' ? 'stats.col.day' : 'stats.col.month')}</th>
                  <th className={CLASS.num}>{tr('stats.col.count')}</th>
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
                    <td className={CLASS.num}>{row.sessions}</td>
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
                <SessionRow key={row.id} row={row} tr={tr} now={now} />
              ))}
            </tbody>
          </table>

          {selected.length > ROW_LIMIT && (
            <div className={CLASS.statsNote}>
              <span>{tr('stats.note.limit', { count: ROW_LIMIT })}</span>
            </div>
          )}
        </>
      )}

      <div className={CLASS.statsNote}>
        <span>{tr('stats.note.scope')}</span>
        <span>{tr('stats.note.subagent')}</span>
        {scan.skipped > 0 && <span>{tr('stats.skipped', { count: scan.skipped })}</span>}
      </div>
    </div>
  )
}

/**
 * One session row: stamp, title with tags, tokens, money.
 * @param props - the priced row, translator, and the reference instant.
 * @returns the table row.
 */
function SessionRow({ row, tr, now }: { row: SessionCostRow, tr: Translator, now: number }): ReactNode {
  return (
    <tr>
      <td className={CLASS.num}>{formatStamp(row.at, now)}</td>
      <td className={CLASS.session} title={row.title}>
        {row.title}
        {row.subagent && <span className={CLASS.badge}>{tr('stats.tag.subagent')}</span>}
        {row.running && <span className={CLASS.badge}>{tr('stats.tag.running')}</span>}
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
