/**
 * The cost chip and its detail panel.
 *
 * Renders into the assistant-message action row
 * (`conversation.chat.assistant-actions`, list slot, session scope) — the strip
 * that also carries copy / branch and the native turn-usage pill. The chip shows
 * the turn's estimated cost in CNY and renders NOTHING when the turn cannot be
 * priced (no usage yet, no route attribution, or a model with no published
 * price), so it never invents a number.
 *
 * @module dsh-session-cost/client/CostChip
 */

import {
  useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState,
  type CSSProperties, type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { estimateTurnUsage, formatExactTokens, formatMoney, type TurnEstimate } from '../pricing.ts'
import type { CostChipProps, Translator, TurnTokenUsage, UseChatLike } from './contract.ts'
import { fallbackTranslator } from './locales.ts'
import { CLASS } from './styles.ts'
import { collectLoadedTurns, selectTurnLocation, selectTurnUsage, turnWindowOf, type LoadedTurn } from './select.ts'

/** Selector hook stand-in used when the host hands none down (defensive). */
const NO_CHAT: UseChatLike = () => undefined as never

/** Panel position before its first measurement: rendered hidden, then placed. */
const HIDDEN: CSSProperties = { visibility: 'hidden', left: 0, top: 0 }

/**
 * Chinese-yuan glyph in a circle, drawn inline so the plugin needs no icon
 * dependency.
 * @returns the 15px-optimized glyph.
 */
function CostIcon(): ReactNode {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true">
      <circle cx="8" cy="8" r="6.3" />
      <path d="M5.5 4.9 8 8.2l2.5-3.3M8 8.2v3.2M6.1 9.2h3.8M6.1 10.7h3.8" strokeLinecap="round" />
    </svg>
  )
}

/**
 * Percent of prompt input served from cache, matching the native usage dialog.
 * @param usage - the turn's buckets.
 * @returns a one-decimal percentage label, or undefined when it cannot be derived.
 */
function cacheHitLabel(usage: TurnTokenUsage): string | undefined {
  const cacheRead = usage.cacheReadTokens
  if (cacheRead === undefined) return undefined
  const prompt = usage.totalTokens - usage.outputTokens
  if (!(prompt > 0)) return undefined
  return `${((cacheRead / prompt) * 100).toFixed(1)}%`
}

/**
 * One itemized money row: label, tokens × rate, cost.
 * @param props - row content.
 * @returns the three grid cells.
 */
function ItemRow(props: {
  label: string
  tokens: number
  rate: number
  cost: number
  tr: Translator
  extra?: ReactNode
}): ReactNode {
  const { label, tokens, rate, cost, tr, extra } = props
  return (
    <>
      <dt>{label}</dt>
      <dd>
        {formatExactTokens(tokens)} tok {tr('cost.perMillion', { rate: `¥${rate}` })}
        {extra}
      </dd>
      <dd className={CLASS.cost}>{formatMoney(cost, 'CNY')}</dd>
    </>
  )
}

/** Folded session total over the turns currently loaded in the chat window. */
interface SessionTotals {
  readonly turns: number
  readonly cny: number
  readonly usd: number
}

/**
 * Sum every loaded turn that can be priced.
 * @param turns - loaded turns carrying usage.
 * @returns the totals, or undefined when nothing could be priced.
 */
function foldSession(turns: readonly LoadedTurn[]): SessionTotals | undefined {
  let counted = 0
  let cny = 0
  let usd = 0
  for (const turn of turns) {
    const estimate = estimateTurnUsage(turn.usage, turnWindowOf(turn.location))
    if (estimate === undefined || estimate.unpricedModels.length > 0) continue
    counted += 1
    cny += estimate.cny.total
    usd += estimate.usd.total
  }
  return counted === 0 ? undefined : { turns: counted, cny, usd }
}

/**
 * Session-cumulative line inside the panel (loaded turns only).
 * @param props - translator and the chat selector hook.
 * @returns the total row, or null while no turn is priced.
 */
function SessionTotal({ tr, useChat }: { tr: Translator; useChat?: UseChatLike | undefined }): ReactNode {
  const select = useChat ?? NO_CHAT
  const nodes = select(snapshot => snapshot.nodes)
  // `order` changes identity exactly when the node list changes; subscribing to
  // it re-folds this memo when a turn lands, without re-rendering per chunk.
  const order = select(snapshot => snapshot.order)
  const totals = useMemo(
    () => foldSession(nodes === undefined ? [] : collectLoadedTurns({ nodes })),
    [nodes, order],
  )
  if (totals === undefined) return null
  return (
    <div className={CLASS.total}>
      <span>{`${tr('cost.session')} · ${tr('cost.sessionTurns', { turns: totals.turns })}`}</span>
      <span>{`≈${formatMoney(totals.cny, 'CNY')} · ≈${formatMoney(totals.usd, 'USD')}`}</span>
    </div>
  )
}

/** Panel body: the billed route, the rate window, and the itemized buckets. */
function PanelBody(props: {
  estimate: TurnEstimate
  usage: TurnTokenUsage
  tr: Translator
  useChat?: UseChatLike | undefined
}): ReactNode {
  const { estimate, usage, tr, useChat } = props
  const { cny, usd } = estimate
  const hit = cacheHitLabel(usage)
  const reasoning = usage.reasoningTokens
  return (
    <>
      <div className={CLASS.title}>
        <span className={CLASS.titleLabel}>
          <CostIcon />
          {tr('cost.title')}
        </span>
        <span className={CLASS.titleValue}>{`≈${formatMoney(cny.total, 'CNY')}`}</span>
      </div>
      <div className={CLASS.rule} aria-hidden />
      <dl className={CLASS.details}>
        <dt>{tr('cost.model')}</dt>
        <dd>{estimate.plan.label}</dd>
        {estimate.aliased && (
          <>
            <dt>{tr('cost.requested')}</dt>
            <dd>{estimate.requestedModels.join(', ')}</dd>
          </>
        )}
        <dt>{tr('cost.window')}</dt>
        <dd>{tr(estimate.peak ? 'cost.peak' : 'cost.offPeak')}</dd>
        {hit !== undefined && (
          <>
            <dt>{tr('cost.cacheHit')}</dt>
            <dd>{hit}</dd>
          </>
        )}
      </dl>
      <dl className={CLASS.items}>
        <ItemRow tr={tr} label={tr('cost.uncached')} tokens={cny.cacheMissTokens} rate={cny.tier.cacheMiss} cost={cny.cacheMissCost} />
        <ItemRow tr={tr} label={tr('cost.cacheRead')} tokens={cny.cacheHitTokens} rate={cny.tier.cacheHit} cost={cny.cacheHitCost} />
        <ItemRow
          tr={tr}
          label={tr('cost.output')}
          tokens={cny.outputTokens}
          rate={cny.tier.output}
          cost={cny.outputCost}
          extra={reasoning === undefined
            ? undefined
            : <span className={CLASS.reasoning}>{tr('cost.reasoning', { tokens: formatExactTokens(reasoning) })}</span>}
        />
      </dl>
      <div className={CLASS.total}>
        <span>{tr('cost.total')}</span>
        <span>{`≈${formatMoney(cny.total, 'CNY')} · ≈${formatMoney(usd.total, 'USD')}`}</span>
      </div>
      <SessionTotal tr={tr} useChat={useChat} />
      <div className={CLASS.note}>
        {tr('cost.note.estimate')}
        <br />
        {tr('cost.note.excluded')}
        {estimate.mixed && (<><br />{tr('cost.note.mixed')}</>)}
        {estimate.straddlesWindow && (<><br />{tr('cost.note.straddle')}</>)}
        {estimate.aliased && (<><br />{tr('cost.note.alias', { label: estimate.plan.label })}</>)}
        {(usage.cacheWriteTokens ?? 0) > 0 && (<><br />{tr('cost.note.cacheWrite')}</>)}
      </div>
    </>
  )
}

/**
 * Anchored panel: fixed-position portal placed above the trigger, clamped into
 * the viewport, closing on Escape, outside press, or resize.
 * @param props - panel content, anchor element, and close callback.
 * @returns the portaled panel.
 */
function CostPanel(props: {
  estimate: TurnEstimate
  usage: TurnTokenUsage
  tr: Translator
  anchor: HTMLElement | null
  useChat?: UseChatLike | undefined
  onClose: () => void
}): ReactNode {
  const { estimate, usage, tr, anchor, useChat, onClose } = props
  const panelRef = useRef<HTMLDivElement | null>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | undefined>(undefined)

  const place = useCallback((): void => {
    const panel = panelRef.current
    if (anchor === null || panel === null) return
    const rect = anchor.getBoundingClientRect()
    const width = panel.offsetWidth
    const height = panel.offsetHeight
    const left = Math.min(Math.max(12, rect.left), Math.max(12, window.innerWidth - width - 12))
    const above = rect.top - height - 8
    const top = above >= 12
      ? above
      : Math.min(Math.max(12, rect.bottom + 8), Math.max(12, window.innerHeight - height - 12))
    setPos({ left, top })
  }, [anchor])

  useLayoutEffect(() => { place() }, [place])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    const onPointerDown = (event: MouseEvent): void => {
      const target = event.target as Node | null
      if (target === null) return
      if (panelRef.current?.contains(target) === true) return
      if (anchor?.contains(target) === true) return
      onClose()
    }
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('mousedown', onPointerDown, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('mousedown', onPointerDown, true)
    }
  }, [anchor, onClose, place])

  return createPortal(
    <div
      ref={panelRef}
      role="dialog"
      aria-label={tr('cost.title')}
      data-session-cost-panel
      className={CLASS.panel}
      style={pos === undefined ? HIDDEN : { left: pos.left, top: pos.top }}
    >
      <PanelBody estimate={estimate} usage={usage} tr={tr} useChat={useChat} />
    </div>,
    document.body,
  )
}

/**
 * Cost chip entry of the assistant action row.
 * @param props - message identity, chat selector hook, and locale translator.
 * @returns the chip, or null when this turn cannot be priced.
 */
export function CostChip({ messageId, useChat, t }: CostChipProps): ReactNode {
  const select = useChat ?? NO_CHAT
  const tr = t ?? fallbackTranslator
  const usage = select(snapshot => selectTurnUsage(snapshot, messageId))
  const location = select(snapshot => selectTurnLocation(snapshot, messageId))
  const estimate = useMemo(
    () => (usage === undefined ? undefined : estimateTurnUsage(usage, turnWindowOf(location))),
    [usage, location],
  )
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const close = useCallback((): void => { setOpen(false) }, [])

  if (usage === undefined || estimate === undefined || estimate.unpricedModels.length > 0) return null
  const amount = formatMoney(estimate.cny.total, 'CNY')
  return (
    <span className={CLASS.root}>
      <button
        ref={triggerRef}
        type="button"
        className={CLASS.trigger}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={tr('cost.title')}
        onClick={() => { setOpen(value => !value) }}
      >
        <CostIcon />
        <span className={CLASS.label}>{tr('cost.chip', { amount })}</span>
      </button>
      {open && (
        <CostPanel
          estimate={estimate}
          usage={usage}
          tr={tr}
          anchor={triggerRef.current}
          useChat={useChat}
          onClose={close}
        />
      )}
    </span>
  )
}
