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
 * Two sources feed it, in this order:
 *
 * 1. The provider-reported buckets the chat snapshot already carries. This is the
 *    normal path and it costs nothing.
 * 2. The plugin's host fold, read through {@link usageStore}, used only when
 *    path 1 has nothing to show. DSH's core meter is all-or-nothing: one retried
 *    request that reported no usage erases the whole turn's `tokenUsage`, so the
 *    native pill and the exact chip both disappear even though the turn did
 *    bill tokens. The host fold reads the durable log directly and can still
 *    price that reply — the panel labels it as a recomputation so the two
 *    numbers are never confused.
 *
 * @module dsh-session-cost/client/CostChip
 */

import {
  useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore,
  type CSSProperties, type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { estimateTurnUsage, formatExactTokens, formatMoney, type TurnEstimate } from '../pricing.ts'
import type { TurnCostRow } from '../rows.ts'
import type { CostChipProps, Translator, TurnTokenUsage, UseChatLike } from './contract.ts'
import { fallbackTranslator } from './locales.ts'
import { CLASS } from './styles.ts'
import { collectLoadedTurns, selectTurnLocation, selectTurnNumber, selectTurnUsage, turnWindowOf, type LoadedTurn } from './select.ts'
import { usageStore } from './usage-store.ts'

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
 * Rebuild the chat-shaped usage object for one host-folded reply.
 *
 * The panel prices from a `TurnTokenUsage`, so the fallback hands it the same
 * shape instead of a second, parallel renderer: identical itemization, one code
 * path. The host row's `tokens` is uncached + cache-read + output, matching the
 * contract's `totalTokens`.
 * @param row - one reply row from the host payload.
 * @returns the usage object, or undefined when the reply has no route to price.
 */
function usageFromRow(row: TurnCostRow): TurnTokenUsage | undefined {
  if (row.provider === undefined || row.model === undefined) return undefined
  return {
    uncachedInputTokens: row.uncachedInputTokens,
    outputTokens: row.outputTokens,
    totalTokens: row.tokens,
    cacheReadTokens: row.cacheReadTokens,
    ...(row.reasoningTokens > 0 ? { reasoningTokens: row.reasoningTokens } : {}),
    routes: [{ provider: row.provider, model: row.model }],
  }
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
  /** `true` when the numbers come from the host fold instead of the chat store. */
  estimated?: boolean
}): ReactNode {
  const { estimate, usage, tr, useChat, estimated = false } = props
  const { cny, usd } = estimate
  const hit = cacheHitLabel(usage)
  const reasoning = usage.reasoningTokens
  return (
    <>
      <div className={CLASS.title}>
        <span className={CLASS.titleLabel}>
          <CostIcon />
          {tr(estimated ? 'cost.fold.title' : 'cost.title')}
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
        {estimated && (<>{tr('cost.note.fold')}<br /></>)}
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
  /** `true` when the numbers come from the host fold instead of the chat store. */
  estimated?: boolean
  onClose: () => void
}): ReactNode {
  const { estimate, usage, tr, anchor, useChat, estimated = false, onClose } = props
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
      aria-label={tr(estimated ? 'cost.fold.title' : 'cost.title')}
      data-session-cost-panel
      className={CLASS.panel}
      style={pos === undefined ? HIDDEN : { left: pos.left, top: pos.top }}
    >
      <PanelBody estimate={estimate} usage={usage} tr={tr} useChat={useChat} estimated={estimated} />
    </div>,
    document.body,
  )
}

/**
 * Trigger and panel, shared by both data sources.
 *
 * Owns the open/closed state and the anchor, so neither source duplicates the
 * markup. `estimated` only changes the copy (title and note), never the
 * arithmetic, so a reader can always tell a provider-reported total from a
 * recomputed one.
 * @param props - the money label, the estimate, the buckets behind it, and the seats.
 * @returns the chip and, while open, its panel.
 */
function ChipSurface(props: {
  amount: string
  label: string
  priced: TurnEstimate
  buckets: TurnTokenUsage
  estimated: boolean
  tr: Translator
  useChat?: UseChatLike | undefined
}): ReactNode {
  const { amount, label, priced, buckets, estimated, tr, useChat } = props
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const close = useCallback((): void => { setOpen(false) }, [])
  return (
    <span className={CLASS.root}>
      <button
        ref={triggerRef}
        type="button"
        className={CLASS.trigger}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={label}
        onClick={() => { setOpen(value => !value) }}
      >
        <CostIcon />
        <span className={CLASS.label}>{tr('cost.chip', { amount })}</span>
      </button>
      {open && (
        <CostPanel
          estimate={priced}
          usage={buckets}
          tr={tr}
          anchor={triggerRef.current}
          useChat={useChat}
          estimated={estimated}
          onClose={close}
        />
      )}
    </span>
  )
}

/**
 * Fallback chip: the host fold's price for a reply the core meter withheld.
 *
 * Mounted only when the exact path has nothing, so a reply the core meter is
 * happy with never subscribes to the store and never re-renders when a payload
 * lands. Renders nothing until (and unless) the payload carries this reply.
 * @param props - the reply's address, the locale seat, and the chat hook.
 * @returns the chip, or null.
 */
function FoldChip(props: {
  sessionId?: string | undefined
  turn?: number | undefined
  tr: Translator
  useChat?: UseChatLike | undefined
}): ReactNode {
  const { sessionId, turn, tr, useChat } = props
  const snapshot = useSyncExternalStore(usageStore.subscribe, usageStore.getSnapshot, usageStore.getSnapshot)
  useEffect(() => { usageStore.ensure() }, [])
  const row = useMemo(
    () => usageStore.lookup(sessionId, turn),
    [sessionId, turn, snapshot],
  )
  const folded = useMemo(() => {
    if (row === undefined) return undefined
    const buckets = usageFromRow(row)
    if (buckets === undefined) return undefined
    const priced = estimateTurnUsage(buckets, { startMs: row.at, endMs: row.at })
    if (priced === undefined || priced.unpricedModels.length > 0) return undefined
    return { buckets, priced }
  }, [row])
  if (folded === undefined) return null
  return (
    <ChipSurface
      amount={formatMoney(folded.priced.cny.total, 'CNY')}
      label={tr('cost.fold.title')}
      priced={folded.priced}
      buckets={folded.buckets}
      estimated
      tr={tr}
      useChat={useChat}
    />
  )
}

/**
 * Cost chip entry of the assistant action row.
 *
 * The chat store is tried first; the host fold is a child component that renders
 * only when the store could not price this reply at all, so the common path
 * stays exactly what it was before the fallback existed.
 * @param props - message identity, current session, chat selector hook, and translator.
 * @returns the chip, or null when neither source can price this turn.
 */
export function CostChip({ messageId, sessionId, useChat, t }: CostChipProps): ReactNode {
  const select = useChat ?? NO_CHAT
  const tr = t ?? fallbackTranslator
  const usage = select(snapshot => selectTurnUsage(snapshot, messageId))
  const location = select(snapshot => selectTurnLocation(snapshot, messageId))
  const turn = select(snapshot => selectTurnNumber(snapshot, messageId))
  const estimate = useMemo(
    () => (usage === undefined ? undefined : estimateTurnUsage(usage, turnWindowOf(location))),
    [usage, location],
  )
  if (usage === undefined || estimate === undefined || estimate.unpricedModels.length > 0) {
    return <FoldChip sessionId={sessionId} turn={turn} tr={tr} useChat={useChat} />
  }
  return (
    <ChipSurface
      amount={formatMoney(estimate.cny.total, 'CNY')}
      label={tr('cost.title')}
      priced={estimate}
      buckets={usage}
      estimated={false}
      tr={tr}
      useChat={useChat}
    />
  )
}
