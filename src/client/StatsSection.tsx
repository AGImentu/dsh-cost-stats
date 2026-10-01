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
 * Data comes from the plugin's own host route (`GET /cost-stats/usage`), which
 * folds every stored session log into per-reply priced rows.
 *
 * @module dsh-cost-stats/client/StatsSection
 */

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { formatMoney } from '../pricing.ts'
import { USAGE_ROUTE } from '../routes.ts'
import type { TurnCostRow, UsagePayload } from '../rows.ts'
import type { BalancePayload, KeysPayload } from '../balance.ts'
import * as balanceStore from './balance-store.ts'
import * as keyStore from './key-store.ts'
import { BalanceChip } from './BalanceChip.tsx'
import { KeyPicker } from './KeyPicker.tsx'
import type { CostStatsProps, Translator } from './contract.ts'
import { fallbackTranslator } from './locales.ts'
import { DayPicker, MonthPicker } from './Pickers.tsx'
import { dayKeyOf, monthKeyOf, paginate, totalsOf } from './stats-model.ts'
import { CLASS } from './styles.ts'

/** Replies shown per page; the pickers and the total still cover every row. */
const PAGE_SIZE = 15

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
  /**
   * `YYYY-MM-DD` day filter; mutually exclusive with `month`. Defaults to TODAY:
   * the page opens on the current day's replies, which is what a glance wants,
   * and the pickers are one click away from any other day or month.
   */
  const [day, setDay] = useState<string | undefined>(() => dayKeyOf(Date.now()))
  /** `YYYY-MM` month filter. */
  const [month, setMonth] = useState<string | undefined>(undefined)
  /** 1-based page inside the current selection. */
  const [page, setPage] = useState(1)
  /**
   * Which key the money comes from. A NAME (`DEEPSEEK_API_KEY`, a relay's key)
   * is all the page ever holds in this mode — the host resolves the value.
   */
  const [mode, setMode] = useState<'ref' | 'manual'>('ref')
  const [ref, setRef] = useState<string | undefined>(() => keyStore.storedRef(undefined))
  /** A pasted key. Component state only: never persisted, never in a URL. */
  const [manualKey, setManualKey] = useState('')
  const [remember, setRemember] = useState(false)
  const [rememberAs, setRememberAs] = useState('')
  /** The catalog of selectable key names (names and flags only). */
  const [catalog, setCatalog] = useState<KeysPayload | undefined>(() => keyStore.snapshot())
  /**
   * The account balance. Seeded from the store for the key the reader is most
   * likely pointed at (the remembered name, else the harness default), so a
   * reopen shows money instead of a spinner — and never another key's money,
   * because the seed is looked up BY NAME like every other read.
   */
  const [balance, setBalance] = useState<BalancePayload | undefined>(() => {
    const known = keyStore.snapshot()
    const pointer = keyStore.storedRef(known) ?? known?.default
    return pointer === undefined ? undefined : balanceStore.snapshot({ kind: 'ref', ref: pointer })
  })
  const [balanceLoading, setBalanceLoading] = useState(true)

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

  // The catalog is fetched once per page; the last stored name is only honoured
  // if it is still offered, so a deleted key cannot leave the page pointed at
  // nothing.
  useEffect(() => {
    let alive = true
    const apply = (next: KeysPayload): void => {
      if (!alive) return
      setCatalog(next)
      setRef(current => current ?? keyStore.storedRef(next) ?? next.default)
    }
    void keyStore.load().then(apply)
    const off = keyStore.subscribe(apply)
    return () => { alive = false; off() }
  }, [])

  /** The named credential the readout is pointed at, when one is chosen. */
  const targetRef = mode === 'manual' ? undefined : (ref ?? catalog?.default)

  /**
   * Follow the current pointer: show whatever is already known for THAT key
   * (`undefined` for a key nobody queried yet), then query it.
   *
   * Depending on the pointer rather than on every render is what keeps switching
   * keys from ever showing another key's money: a different name is a different
   * problem, and the cache is keyed by name for the same reason.
   */
  useEffect(() => {
    if (mode === 'manual') {
      // A pasted key is never queried just because the page opened: it is sent
      // on the click that asked for it.
      setBalance(balanceStore.snapshot({ kind: 'manual', key: '' }))
      setBalanceLoading(false)
      return
    }
    if (targetRef === undefined) return
    setBalance(balanceStore.snapshot({ kind: 'ref', ref: targetRef }))
    setBalanceLoading(true)
    void balanceStore.load({ kind: 'ref', ref: targetRef }).then((next) => {
      setBalance(next)
      setBalanceLoading(false)
    })
  }, [mode, targetRef])

  /**
   * Query the balance of whatever is currently picked — the button, the chip and
   * the page's own 「刷新」 all land here, so none of them can query a different
   * key than the one on screen.
   */
  const queryBalance = useCallback((): void => {
    if (mode === 'manual') {
      const key = manualKey.trim()
      if (key.length === 0) return
      setBalanceLoading(true)
      void balanceStore.load({
        kind: 'manual',
        key,
        ...(remember ? { remember: true } : {}),
        ...(rememberAs.trim() === '' ? {} : { rememberAs: rememberAs.trim() }),
      }, true).then((next) => { setBalance(next); setBalanceLoading(false) })
      return
    }
    if (targetRef === undefined) return
    setBalanceLoading(true)
    void balanceStore.load({ kind: 'ref', ref: targetRef }, true).then((next) => {
      setBalance(next)
      setBalanceLoading(false)
    })
  }, [mode, manualKey, remember, rememberAs, targetRef])

  // The usage payload is queried on open; the balance follows its own pointer.
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
  // A selection change or a reload can leave the stored page out of range; the
  // clamp happens inside `paginate`, so no effect and no extra frame is involved.
  const { page: current, pages, rows: visible } = paginate(selected, page, PAGE_SIZE)
  const now = Date.now()
  const scope = day ?? month ?? tr('stats.scope.all')

  /** Switch the day filter, dropping the month filter and restarting at page 1. */
  const pickDay = useCallback((key: string | undefined): void => {
    setDay(key)
    if (key !== undefined) setMonth(undefined)
    setPage(1)
  }, [])

  /** Switch the month filter, dropping the day filter and restarting at page 1. */
  const pickMonth = useCallback((key: string | undefined): void => {
    setMonth(key)
    if (key !== undefined) setDay(undefined)
    setPage(1)
  }, [])

  /** What the chip's tooltip calls the money's source: the model's own name. */
  const sourceLabel = mode === 'manual'
    ? tr('stats.balance.manualSource')
    : (catalog?.refs.find(row => row.ref === targetRef)?.label ?? targetRef)

  return (
    <div className={CLASS.stats} data-cost-stats-page>
      <div className={CLASS.statsHead}>
        <div className={CLASS.statsHeadText}>
          <div className={CLASS.statsTitle}>{tr('stats.title')}</div>
          <div className={CLASS.statsSubtitle}>{tr('stats.subtitle')}</div>
        </div>
        <BalanceChip
          payload={balance}
          loading={balanceLoading}
          onQuery={queryBalance}
          tr={tr}
          source={sourceLabel}
          disabled={mode === 'manual' && manualKey.trim().length === 0}
        />
      </div>

      <KeyPicker
        catalog={catalog}
        mode={mode}
        selectedRef={targetRef}
        manualKey={manualKey}
        remember={remember}
        rememberAs={rememberAs}
        loading={balanceLoading}
        disabled={mode === 'manual' && manualKey.trim().length === 0}
        onPickRef={(next) => {
          setMode('ref')
          setRef(next)
          keyStore.storeRef(next)
        }}
        onPickManual={() => { setMode('manual') }}
        onManualKey={setManualKey}
        onRemember={(next) => {
          setRemember(next)
          // A name is required to store a key; offering one that is still free
          // is the difference between "works" and "silently overwrote my key".
          if (next && rememberAs.trim() === '') setRememberAs(keyStore.suggestRefName(catalog))
        }}
        onRememberAs={setRememberAs}
        onQuery={queryBalance}
        tr={tr}
      />

      <div className={CLASS.toolbar}>
        <DayPicker
          tr={tr}
          value={day}
          dataDays={dataDays}
          onPick={pickDay}
        />
        <MonthPicker
          tr={tr}
          value={month}
          dataMonths={dataMonths}
          onPick={pickMonth}
        />
        {(day !== undefined || month !== undefined) && (
          <button
            type="button"
            className={CLASS.pickerAction}
            onClick={() => { pickDay(undefined); setMonth(undefined) }}
          >
            {tr('stats.scope.clear')}
          </button>
        )}
        <button
          type="button"
          className={CLASS.pickerAction}
          onClick={() => { load(true); queryBalance() }}
        >
          {tr('stats.refresh')}
        </button>
      </div>

      <div className={CLASS.statsTotal}>
        <div className={CLASS.statsSubtitle}>{`${tr('stats.total')} · ${scope}`}</div>
        {/* Money and metrics share one row, so they sit on one baseline. */}
        <div className={CLASS.statsTotalRow}>
          <div className={CLASS.statsTotalValue}>
            {formatMoney(totals.cny, 'CNY')}
            <span className={CLASS.moneyInline}>{formatMoney(totals.usd, 'USD')}</span>
          </div>
          <div className={CLASS.statsMetrics}>
            <span className={CLASS.metric}>{tr('stats.metric.replies')} {totals.replies}</span>
            {totals.compactions > 0 && (
              <span className={CLASS.metric}>{tr('stats.metric.compactions')} {totals.compactions}</span>
            )}
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
        <>
          <table className={CLASS.table}>
            <thead>
              <tr>
                <th>{tr('stats.col.time')}</th>
                <th>{tr('stats.col.session')}</th>
                <th>{tr('stats.col.tokens')}</th>
                <th>{tr('stats.col.cost')}</th>
              </tr>
            </thead>
            <tbody>
              {visible.map(row => (
                <ReplyRow key={`${row.sessionId}:${String(row.turn)}`} row={row} tr={tr} now={now} />
              ))}
            </tbody>
          </table>
          <div className={CLASS.pager}>
            <span className={CLASS.pagerInfo}>
              {tr('stats.page.summary', { page: current, pages, count: selected.length, size: PAGE_SIZE })}
            </span>
            <span className={CLASS.pagerActions}>
              <button
                type="button"
                className={CLASS.pagerAction}
                disabled={current <= 1}
                onClick={() => { setPage(Math.max(1, current - 1)) }}
              >
                {tr('stats.page.prev')}
              </button>
              <button
                type="button"
                className={CLASS.pagerAction}
                disabled={current >= pages}
                onClick={() => { setPage(Math.min(pages, current + 1)) }}
              >
                {tr('stats.page.next')}
              </button>
            </span>
          </div>
        </>
      )}
    </div>
  )
}

/**
 * One row of the list: stamp, session name with tags, tokens, money.
 *
 * A compaction row is not a reply: it has no turn number, carries the
 * 「压缩」badge, and its tooltip says so too. Money keeps both currencies on one
 * line (the column is the narrowest of the four, and a stacked second line was
 * what made every row look tall and top-heavy), and the USD half stays muted so
 * the CNY figure reads first.
 * @param props - the priced row, translator, and the reference instant.
 * @returns the table row.
 */
function ReplyRow({ row, tr, now }: { row: TurnCostRow, tr: Translator, now: number }): ReactNode {
  const isCompaction = row.compaction === true
  const suffix = row.model === undefined ? '' : ` · ${row.model}`
  const label = isCompaction
    ? `${row.sessionTitle} · ${tr('stats.tag.compaction')}${suffix}`
    : `${row.sessionTitle} · #${String(row.turn)}${suffix}`
  return (
    <tr>
      <td>{formatStamp(row.at, now)}</td>
      <td className={CLASS.session} title={label}>
        {row.sessionTitle}
        {isCompaction && <span className={CLASS.badge}>{tr('stats.tag.compaction')}</span>}
        {row.subagent && <span className={CLASS.badge}>{tr('stats.tag.subagent')}</span>}
        {!row.priced && <span className={CLASS.badge}>{tr('stats.tag.unpriced')}</span>}
      </td>
      <td>{formatTokens(row.tokens)}</td>
      <td className={CLASS.moneyCell}>
        {row.priced ? formatMoney(row.cny, 'CNY') : '—'}
        <span className={CLASS.moneyInline}>
          {row.priced ? formatMoney(row.usd, 'USD') : (row.model ?? '')}
        </span>
      </td>
    </tr>
  )
}
