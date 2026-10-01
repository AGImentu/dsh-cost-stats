/**
 * The "which key?" row above the statistics: a dropdown, an optional pasted key,
 * and the button that queries DeepSeek's official balance endpoint with it.
 *
 * The dropdown lists the credential NAMES this harness knows (DSH's own
 * `DEEPSEEK_API_KEY`, a relay's key, …) because that is the same set the reader
 * sees in the model settings. Picking one sends only its NAME: the host resolves
 * the value and the page never sees it.
 *
 * "手动输入" exists for a key that is not configured in DSH at all. Such a key is
 * held in this component's state, sent in a request BODY on the click that asked
 * for it, and stored nowhere — unless the reader ticks 「存入 DSH 凭据库」, which
 * asks the host to write it into DSH's own credential store (the supported place
 * for a secret), never into this plugin's files.
 *
 * @module dsh-cost-stats/client/KeyPicker
 */

import type { ReactNode } from 'react'
import type { KeysPayload } from '../balance.ts'
import type { Translator } from './contract.ts'
import { CLASS } from './styles.ts'
import { MANUAL_OPTION } from './key-store.ts'

/** Props for the row. All state is owned by the page, so a refresh can reuse it. */
export interface KeyPickerProps {
  /** Catalog of selectable key names (names only, by construction). */
  readonly catalog: KeysPayload | undefined
  /** `'ref'` = use a named credential, `'manual'` = use the pasted key. */
  readonly mode: 'ref' | 'manual'
  /**
   * The picked credential name (ignored in manual mode).
   *
   * Deliberately NOT named `ref`: React reserves that prop. A function component
   * never receives it (the value is diverted before props), and a STRING `ref`
   * makes React throw ("Element ref was specified as a string ... but no owner
   * was set"). 0.9.0 shipped with `ref={targetRef}`, the boundary caught that
   * throw, and the settings page rendered blank.
   */
  readonly selectedRef: string | undefined
  /** The pasted key; lives in memory only. */
  readonly manualKey: string
  /** Whether the pasted key should be written into DSH's credential store. */
  readonly remember: boolean
  /** The name to store it under. */
  readonly rememberAs: string
  /** Whether a query is in flight. */
  readonly loading: boolean
  /** Whether the current pointer can be queried at all. */
  readonly disabled: boolean
  readonly onPickRef: (ref: string) => void
  readonly onPickManual: () => void
  readonly onManualKey: (value: string) => void
  readonly onRemember: (value: boolean) => void
  readonly onRememberAs: (value: string) => void
  readonly onQuery: () => void
  readonly tr: Translator
}

/**
 * One option's label: what 「设置 → 模型」 calls this provider, plus a marker when
 * the reference is not configured.
 *
 * The credential's own name (`DEEPSEEK_API_KEY`) is deliberately not the visible
 * text — the reader picks a MODEL PROVIDER, so the dropdown reads like the model
 * settings page. The reference stays on the option's tooltip for anyone who
 * needs to know which credential a row resolves.
 * @param row - one catalog entry.
 * @param tr - translator.
 * @returns the label.
 */
function optionLabel(row: KeysPayload['refs'][number], tr: Translator): string {
  const head = row.label ?? row.ref
  return row.configured ? head : `${head}${tr('stats.key.unconfigured')}`
}

/**
 * The tooltip for one option: which credential it is, and where it came from.
 * @param row - one catalog entry.
 * @param tr - translator.
 * @returns the tooltip text.
 */
function optionHint(row: KeysPayload['refs'][number], tr: Translator): string {
  const parts = [tr('stats.key.optionRef', { ref: row.ref })]
  if (row.provider !== undefined && row.provider !== '') {
    parts.push(tr('stats.key.optionProvider', { provider: row.provider }))
  }
  parts.push(row.configured ? tr('stats.key.optionSet') : tr('stats.key.optionUnset'))
  return parts.join('\n')
}

/**
 * The key row.
 * @param props - catalog, current pointer, paste state and the actions.
 * @returns the row.
 */
export function KeyPicker(props: KeyPickerProps): ReactNode {
  const {
    catalog, mode, selectedRef, manualKey, remember, rememberAs, loading, disabled,
    onPickRef, onPickManual, onManualKey, onRemember, onRememberAs, onQuery, tr,
  } = props
  const rows = catalog?.refs ?? []
  const manual = mode === 'manual'

  return (
    <div className={CLASS.keyRow}>
      <span className={CLASS.keyLabel} title={tr('stats.key.hint')}>{tr('stats.key.label')}</span>
      <select
        className={CLASS.keySelect}
        aria-label={tr('stats.key.label')}
        value={manual ? MANUAL_OPTION : (selectedRef ?? '')}
        onChange={(event) => {
          const value = event.target.value
          if (value === MANUAL_OPTION) onPickManual()
          else onPickRef(value)
        }}
      >
        {/* A harness whose catalog is still loading (or unavailable) still needs
            a value the select can hold, and the manual entry must stay reachable
            — that is exactly the case where the reader has to paste a key. */}
        {rows.length === 0 && <option value="">{tr('stats.key.none')}</option>}
        {rows.map(row => (
          <option key={row.ref} value={row.ref} title={optionHint(row, tr)}>{optionLabel(row, tr)}</option>
        ))}
        <option value={MANUAL_OPTION}>{tr('stats.key.manual')}</option>
      </select>

      {manual && (
        <input
          className={CLASS.keyInput}
          type="password"
          value={manualKey}
          spellCheck={false}
          autoComplete="off"
          placeholder={tr('stats.key.placeholder')}
          aria-label={tr('stats.key.placeholder')}
          onChange={(event) => { onManualKey(event.target.value) }}
        />
      )}

      {manual && catalog?.canRemember === true && (
        <label className={CLASS.keyRemember} title={tr('stats.key.rememberHint')}>
          <input
            type="checkbox"
            checked={remember}
            onChange={(event) => { onRemember(event.target.checked) }}
          />
          {tr('stats.key.remember')}
        </label>
      )}

      {manual && remember && catalog?.canRemember === true && (
        <input
          className={CLASS.keyInput}
          type="text"
          value={rememberAs}
          spellCheck={false}
          autoComplete="off"
          placeholder={tr('stats.key.rememberAsPlaceholder')}
          aria-label={tr('stats.key.rememberAs')}
          onChange={(event) => { onRememberAs(event.target.value) }}
        />
      )}

      <button
        type="button"
        className={CLASS.keyQuery}
        onClick={onQuery}
        disabled={loading || disabled}
      >
        {tr('stats.key.query')}
      </button>
    </div>
  )
}
