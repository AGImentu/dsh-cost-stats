/**
 * The "which model?" row above the statistics: the filter dropdown, the button
 * that asks DeepSeek for a balance, and the answer to its right.
 *
 * The dropdown lists 「全部」(no filter, the default) and then the model providers
 * this harness has credentials for, labelled the way 「设置 → 模型」 labels them.
 * Picking one does two things at once: the table below is filtered to the replies
 * that provider served, and the button becomes "query THIS key's balance".
 *
 * Nothing is fetched until the button is pressed — the balance is a deliberate
 * question, not a decoration. Picking a model sends only its NAME, which the host
 * resolves through DSH's credential service; the page never sees a key value.
 *
 * @module dsh-cost-stats/client/KeyPicker
 */

import type { ReactNode } from 'react'
import type { BalanceInfo, BalancePayload, KeysPayload } from '../balance.ts'
import type { Translator } from './contract.ts'
import { CLASS } from './styles.ts'

/** The `<select>` value that means "no model filter". */
export const ALL_OPTION = '__all__'

/** Currency symbol for the amounts DeepSeek reports. */
function symbolOf(currency: string): string {
  if (currency === 'CNY') return '¥'
  if (currency === 'USD') return '$'
  return `${currency} `
}

/**
 * One amount, always with the API's own two decimals.
 * @param info - the currency's balance entry.
 * @returns the formatted amount.
 */
function amountOf(info: BalanceInfo): string {
  return `${symbolOf(info.currency)}${info.total.toFixed(2)}`
}

/** Local clock label for the query time. */
function clockOf(at: number): string {
  const date = new Date(at)
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/**
 * One option's label: what 「设置 → 模型」 calls this provider, plus a marker when
 * the credential is not configured.
 *
 * The credential's own name (`DEEPSEEK_API_KEY`) is deliberately not the visible
 * text — the reader picks a MODEL, so the dropdown reads like the model settings
 * page. The reference stays on the option's tooltip for anyone who needs to know
 * which credential a row resolves.
 * @param row - one catalog entry.
 * @param tr - translator.
 * @returns the label.
 */
function optionLabel(row: KeysPayload['refs'][number], tr: Translator): string {
  const head = row.label ?? row.ref
  // 「未配置」 would be wrong for the login account: it is not an unset key, it is
  // 「未配置」 would be wrong for the login account: it is not an unset key, it is
  // a model that has no key by design.
  if (row.account === true || row.configured) return head
  return `${head}${tr('stats.key.unconfigured')}`
}

/**
 * The tooltip for one option: which credential it is, and what it filters to.
 * @param row - one catalog entry.
 * @param tr - translator.
 * @returns the tooltip text.
 */
function optionHint(row: KeysPayload['refs'][number], tr: Translator): string {
  const providers = row.providers ?? []
  const parts = [tr('stats.key.optionRef', { ref: row.ref })]
  parts.push(providers.length === 0
    ? tr('stats.key.optionNoProvider')
    : tr('stats.key.optionProviders', { providers: providers.join(', ') }))
  if (row.account === true) parts.push(tr('stats.key.accountHint'))
  else parts.push(row.configured ? tr('stats.key.optionSet') : tr('stats.key.optionUnset'))
  return parts.join('\n')
}

/** Props for the row. All state is owned by the page, so a refresh can reuse it. */
export interface KeyPickerProps {
  /** Catalog of selectable models (names only, by construction). */
  readonly catalog: KeysPayload | undefined
  /** The picked credential name, or undefined for 「全部」. */
  readonly selectedRef: string | undefined
  /**
   * The balance of the picked credential, once the reader asked for it.
   * `undefined` means "not queried yet" — the page does not ask on its own.
   */
  readonly balance: BalancePayload | undefined
  /** Whether a balance query is in flight. */
  readonly loading: boolean
  readonly onPickRef: (ref: string | undefined) => void
  readonly onQuery: () => void
  readonly tr: Translator
}

/**
 * The balance readout: numbers when there are numbers, and a readable reason when
 * there are none. It is a `<span>`, not a button — the query button sits to its
 * left and is the only thing that fires a request.
 * @param props - the payload, the loading flag and the translator.
 * @returns the readout.
 */
function BalanceText(props: {
  payload: BalancePayload | undefined
  loading: boolean
  tr: Translator
}): ReactNode {
  const { payload, loading, tr } = props
  const hint = tr('stats.balance.hint')
  if (loading) return <span className={CLASS.keyBalance} data-tone="warn">{tr('stats.balance.loading')}</span>
  if (payload === undefined) {
    return <span className={CLASS.keyBalance} data-tone="warn">{tr('stats.balance.notQueried')}</span>
  }

  if (!payload.ok) {
    const label = payload.reason === 'no-key' || payload.reason === 'credentials-unavailable'
      ? tr('stats.balance.noKey')
      : payload.reason === 'account-unavailable'
        ? tr('stats.balance.accountUnavailable')
        : payload.reason === 'forbidden'
          ? tr('stats.balance.localOnly')
          : payload.reason === 'bad-request'
            ? tr('stats.balance.badKey')
            : tr('stats.balance.retry')
    return (
      <span className={CLASS.keyBalance} data-tone="warn" title={[payload.message, hint].filter(Boolean).join('\n')}>
        {label}
      </span>
    )
  }

  const infos = payload.infos ?? []
  const detail = infos
    .map(info => tr('stats.balance.breakdown', {
      total: amountOf(info),
      toppedUp: `${symbolOf(info.currency)}${info.toppedUp.toFixed(2)}`,
      granted: `${symbolOf(info.currency)}${info.granted.toFixed(2)}`,
    }))
    .join(' · ')
  const when = payload.at === undefined ? '' : tr('stats.balance.at', { time: clockOf(payload.at) })
  return (
    <span
      className={CLASS.keyBalance}
      data-tone={payload.available === false ? 'warn' : undefined}
      title={[payload.available === false ? tr('stats.balance.unavailable') : undefined, detail, when, hint]
        .filter(part => part !== undefined && part !== '')
        .join('\n')}
    >
      {tr('stats.balance.label', { amount: infos.map(amountOf).join(' · ') })}
    </span>
  )
}

/**
 * The model row.
 * @param props - catalog, current selection, the balance to show and the actions.
 * @returns the row.
 */
export function KeyPicker(props: KeyPickerProps): ReactNode {
  const { catalog, selectedRef, balance, loading, onPickRef, onQuery, tr } = props
  const rows = catalog?.refs ?? []
  /** The picked model: `undefined` for 「全部」, which stands for no model at all. */
  const picked = selectedRef === undefined ? undefined : rows.find(row => row.ref === selectedRef)
  /** DSH's login account: no API key, but DSH's own account service has its balance. */
  const account = picked?.account === true

  return (
    <div className={CLASS.keyRow}>
      <span className={CLASS.keyLabel} title={tr('stats.key.hint')}>{tr('stats.key.label')}</span>
      <select
        className={CLASS.keySelect}
        aria-label={tr('stats.key.label')}
        value={selectedRef ?? ALL_OPTION}
        onChange={(event) => {
          const value = event.target.value
          onPickRef(value === ALL_OPTION ? undefined : value)
        }}
      >
        {/* 「全部」 is the default: no filter, every reply in the selected range. */}
        <option value={ALL_OPTION} title={tr('stats.key.allHint')}>{tr('stats.key.all')}</option>
        {/* A harness whose catalog is still loading simply has nothing else yet;
            the option above keeps the select renderable in the meantime. */}
        {rows.map(row => (
          <option key={row.ref} value={row.ref} title={optionHint(row, tr)}>{optionLabel(row, tr)}</option>
        ))}
      </select>

      <button
        type="button"
        className={CLASS.keyQuery}
        onClick={onQuery}
        disabled={loading}
        // The account's balance comes from DSH itself, not from an API key; the
        // tooltip says so, because a reader may wonder where it comes from.
        title={account ? tr('stats.key.accountHint') : undefined}
      >
        {tr('stats.key.query')}
      </button>

      <BalanceText payload={balance} loading={loading} tr={tr} />
    </div>
  )
}
