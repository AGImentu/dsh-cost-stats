/**
 * The balance readout in the statistics page header.
 *
 * Shows the DeepSeek account balance — numbers the host fetched with the
 * harness's own API key. This component never sees the key: the payload it reads
 * is `{ ok, available, infos, at }` and nothing else, which is exactly why the
 * plugin can live in a public repository.
 *
 * @module dsh-cost-stats/client/BalanceChip
 */

import type { ReactNode } from 'react'
import type { BalanceInfo, BalancePayload } from '../balance.ts'
import type { Translator } from './contract.ts'
import { CLASS } from './styles.ts'

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

/** Wallet glyph, drawn inline so the plugin needs no icon dependency. */
function WalletIcon(): ReactNode {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true">
      <rect x="1.8" y="3.6" width="12.4" height="8.8" rx="2" />
      <path d="M1.8 6.6h12.4" />
      <circle cx="11.4" cy="9.6" r="1" fill="currentColor" stroke="none" />
    </svg>
  )
}

/**
 * The chip itself.
 * @param props - the payload, whether a query is in flight, and the translator.
 * @returns the readout.
 */
export function BalanceChip(props: {
  payload: BalancePayload | undefined
  loading: boolean
  tr: Translator
}): ReactNode {
  const { payload, loading, tr } = props

  if (loading && payload === undefined) {
    return (
      <span className={CLASS.balance} title={tr('stats.balance.hint')}>
        <WalletIcon />
        <span data-tone="warn">{tr('stats.balance.loading')}</span>
      </span>
    )
  }

  if (payload === undefined || !payload.ok) {
    const reason = payload?.reason
    const label = reason === 'no-key' || reason === 'credentials-unavailable'
      ? tr('stats.balance.noKey')
      : tr('stats.balance.failed')
    return (
      <span className={CLASS.balance} title={payload?.message ?? tr('stats.balance.hint')}>
        <WalletIcon />
        <span data-tone="warn">{label}</span>
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
  const unavailable = payload.available === false
  return (
    <span
      className={CLASS.balance}
      title={[unavailable ? tr('stats.balance.unavailable') : undefined, detail, when, tr('stats.balance.hint')]
        .filter(part => part !== undefined && part !== '')
        .join('\n')}
    >
      <WalletIcon />
      <span className={CLASS.balanceValue}>
        {tr('stats.balance.label', { amount: infos.map(amountOf).join(' · ') })}
      </span>
    </span>
  )
}
