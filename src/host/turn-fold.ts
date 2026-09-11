/**
 * Fold one durable session log into billable turns.
 *
 * Pure and Node-free so it can be unit-tested against fixture events and reused
 * by the standalone verification script. The fold mirrors what DSH's own
 * turn-usage meter needs, in the order the log stores it:
 *
 * - `session`                 → header (id / createdAt / cwd / delegationDepth)
 * - `session/title`           → display title
 * - `model/selection`         → the route subsequent requests use
 * - `turn/start` / `turn/end` → the turn's window (peak/off-peak input)
 * - `assistant/message`       → one billed attempt: `data.usage` buckets plus the
 *                               route that actually answered, taken from
 *                               `data.message.source` (per-attempt precision),
 *                               falling back to the session's last selection
 * - `assistant/attempt`       → the same shape for a retried attempt (billed too)
 * - `compaction/summary`      → a billed context-compaction call. It is NOT an
 *                               assistant reply, but the provider charges it, and
 *                               neither the native turn-usage pill nor a
 *                               reply-only fold can see it; it is folded into
 *                               {@link FoldedSession.compactions} so the page's
 *                               total can match the invoice.
 *
 * Usage semantics: `inputTokens` is the UNCACHED prompt count (the provider
 * adapter subtracts the cache reads), `outputTokens` already contains the
 * reasoning tokens, and `totalTokens` is prompt + output. Invalid or negative
 * counts are dropped rather than summed into a wrong number.
 *
 * @module dsh-cost-stats/host/turn-fold
 */

/**
 * One durable event, narrowed to what the fold reads.
 *
 * The `session` header carries its fields at the TOP level (`id`, `cwd`,
 * `createdAt`, `delegationDepth`, `isSeeded`, `parentSession`), unlike every
 * other event whose payload sits under `data`; both shapes are accepted.
 */
export interface DurableEventLike {
  readonly type: string
  readonly seq?: number
  readonly time?: number
  readonly data?: unknown
  readonly id?: string
  readonly cwd?: string
  readonly createdAt?: number
  readonly delegationDepth?: number
  readonly isSeeded?: boolean
  readonly parentSession?: string
  readonly origin?: string
}

/** One billed turn of a session. */
export interface FoldedTurn {
  readonly turn: number
  /** Epoch ms of `turn/start`. */
  readonly startedAt: number
  /** Epoch ms of `turn/end`, when the turn closed. */
  readonly endedAt?: number
  /** Route that answered the turn's attempts (per attempt when available). */
  readonly provider?: string
  readonly model?: string
  readonly uncachedInputTokens: number
  readonly cacheReadTokens: number
  readonly cacheWriteTokens: number
  readonly outputTokens: number
  readonly reasoningTokens: number
  /** Billed attempts folded into this turn. */
  readonly attempts: number
}

/** One billed context-compaction call of a session. */
export interface FoldedCompaction {
  /** Epoch ms of the summary that carries the usage. */
  readonly at: number
  /** Route the compaction request went to (the event names it directly). */
  readonly provider?: string
  readonly model?: string
  readonly uncachedInputTokens: number
  readonly cacheReadTokens: number
  readonly cacheWriteTokens: number
  readonly outputTokens: number
  readonly reasoningTokens: number
}

/** Inputs the fold cannot read from the events alone. */
export interface FoldOptions {
  /**
   * Exact number of leading events inherited from the parent session.
   *
   * Supplied by the host route from `handle.inheritedEventCount`: the
   * persistence layer hands out event rows without the physical header record,
   * so a seeded session's own events arrive with no `isSeeded` to read.
   * Omitted by callers that parse raw log lines and still see the header.
   */
  readonly inheritedEventCount?: number
}

/** One folded session. */
export interface FoldedSession {
  readonly id: string
  readonly title?: string
  readonly cwd?: string
  readonly createdAt?: number
  readonly delegationDepth: number
  readonly turns: readonly FoldedTurn[]
  /** Every billed compaction call, in log order. */
  readonly compactions: readonly FoldedCompaction[]
  /** Whether this log is a fork whose head is a copy of its parent's events. */
  readonly isSeeded: boolean
  /** How many leading events were inherited from the parent and skipped. */
  readonly inheritedEvents: number
}

/** Whether a value is a non-negative safe integer. */
function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

/** Read a non-negative count, defaulting to 0 for anything else. */
function count(value: unknown): number {
  return isCount(value) ? value : 0
}

/** Narrow an unknown value to a record. */
function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : undefined
}

/** Read a non-empty string field. */
function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

/** Mutable accumulator for one turn. */
interface TurnAccumulator {
  turn: number
  startedAt: number
  endedAt?: number
  provider?: string
  model?: string
  uncachedInputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  outputTokens: number
  reasoningTokens: number
  attempts: number
}

/** Whether a validated usage payload's buckets, or undefined when it is unusable. */
function usageBuckets(usage: Record<string, unknown> | undefined):
{ uncachedInputTokens: number, cacheReadTokens: number, cacheWriteTokens: number, outputTokens: number, reasoningTokens: number } | undefined {
  if (usage === undefined) return undefined
  // Mirror DSH's own meter: a sample whose counts do not validate is dropped
  // entirely rather than counted with zeroes, so a corrupt payload can never
  // inflate an attempt count or understate a bill.
  if (!isCount(usage.inputTokens) || !isCount(usage.outputTokens)) return undefined
  if (usage.cacheReadTokens !== undefined && !isCount(usage.cacheReadTokens)) return undefined
  if (usage.cacheWriteTokens !== undefined && !isCount(usage.cacheWriteTokens)) return undefined
  if (usage.reasoningTokens !== undefined
    && (!isCount(usage.reasoningTokens) || usage.reasoningTokens > usage.outputTokens)) return undefined
  return {
    uncachedInputTokens: usage.inputTokens,
    cacheReadTokens: count(usage.cacheReadTokens),
    cacheWriteTokens: count(usage.cacheWriteTokens),
    outputTokens: usage.outputTokens,
    reasoningTokens: count(usage.reasoningTokens),
  }
}

/**
 * Read the fields of a `session` header, tolerating both shapes.
 *
 * DSH 0.1.5 writes them at the top level of the event; older logs nested them
 * under `data`. Reading both means one parser covers every log on disk.
 * @param event - the `session` event.
 * @returns the header's fields (each possibly absent).
 */
function sessionHeader(event: DurableEventLike): Record<string, unknown> {
  const data = record(event.data) ?? {}
  return {
    id: event.id ?? data.id,
    cwd: event.cwd ?? data.cwd,
    createdAt: event.createdAt ?? data.createdAt,
    delegationDepth: event.delegationDepth ?? data.delegationDepth,
    isSeeded: event.isSeeded ?? data.isSeeded,
    parentSession: event.parentSession ?? data.parentSession,
  }
}

/**
 * Find the boundary of a fork's inherited prefix.
 *
 * A fork (a side thread, a `session.fork`, any seeded start) writes the parent's
 * events into its own log and then marks the seam with a `session/end-seed`
 * carrying `data.inherited: true`. Without honouring that seam the parent's
 * turns are counted a second time here — measured on this machine: one side
 * thread copied 712 assistant messages, which showed up as three identical rows
 * per turn on the stats page.
 *
 * The inherited marker is preferred; the last seed boundary of any kind is the
 * fallback, and `undefined` means "seeded but the seam cannot be located".
 * @param events - the session's events, in seq order.
 * @returns the last inherited seq, or undefined.
 */
function inheritedBoundary(events: readonly DurableEventLike[]): number | undefined {
  let inherited: number | undefined
  let anySeed: number | undefined
  for (const event of events) {
    if (event.type !== 'session/end-seed') continue
    if (!isCount(event.seq)) continue
    anySeed = Math.max(anySeed ?? -1, event.seq)
    if (record(event.data)?.inherited === true) inherited = Math.max(inherited ?? -1, event.seq)
  }
  return inherited ?? anySeed
}

/**
 * Fold one session's events.
 *
 * A seeded log only contributes what happened AFTER its inherited prefix: the
 * prefix is a copy of the parent session's own log, which is folded separately,
 * so counting it here would bill the same tokens twice.
 * @param sessionId - fallback id when the header is missing.
 * @param events - the durable events, in seq order.
 * @param options - the caller's fork cut, when it has one.
 * @returns the session with its billable turns and compactions.
 */
export function foldSessionEvents(
  sessionId: string,
  events: readonly DurableEventLike[],
  options: FoldOptions = {},
): FoldedSession {
  let id = sessionId
  let title: string | undefined
  let cwd: string | undefined
  let createdAt: number | undefined
  let delegationDepth = 0
  let selectionProvider: string | undefined
  let selectionModel: string | undefined
  const turns = new Map<number, TurnAccumulator>()
  const compactions: FoldedCompaction[] = []
  let openTurn: number | undefined

  // Read the header first: whether this log is a fork decides how much of it
  // belongs to this session at all.
  let isSeeded = false
  for (const event of events) {
    if (event.type !== 'session') continue
    const header = sessionHeader(event)
    id = text(header.id) ?? id
    cwd = text(header.cwd) ?? cwd
    if (isCount(header.createdAt)) createdAt = header.createdAt
    if (isCount(header.delegationDepth)) delegationDepth = header.delegationDepth
    isSeeded = header.isSeeded === true
    break
  }
  // Two callers, two sources for the cut. A caller whose events came from the
  // persistence handle passes the handle's own number, because that layer strips
  // the physical header record and with it `isSeeded`; a caller reading raw log
  // lines (the verification script) leaves the header visible and gets the seam
  // parsed from the inherited-end-seed markers instead.
  const handleCut = options.inheritedEventCount
  const cut = isCount(handleCut)
    ? handleCut
    : isSeeded
      ? inheritedBoundary(events)
      : 0
  const seeded = isSeeded || (isCount(cut) && cut > 0)
  let inheritedEvents = 0

  const accumulatorFor = (turn: number, at: number): TurnAccumulator => {
    const existing = turns.get(turn)
    if (existing !== undefined) return existing
    const created: TurnAccumulator = {
      turn,
      startedAt: at,
      uncachedInputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
      attempts: 0,
    }
    turns.set(turn, created)
    return created
  }

  let index = 0
  for (const event of events) {
    if (event.type === 'session') continue
    const position = index
    index += 1
    if (seeded) {
      // The handle's cut counts EVENTS (the persistence layer slices its own
      // array by it), while a raw-line caller's seam is a seq. Both identify the
      // same prefix, so each source gets the comparison it is defined in.
      let inherited: boolean
      if (isCount(handleCut)) inherited = position < handleCut
      else if (cut === undefined) inherited = true
      else inherited = !isCount(event.seq) || event.seq <= cut
      if (inherited) {
        inheritedEvents += 1
        continue
      }
    }
    const data = record(event.data)
    const at = isCount(event.time) ? event.time : 0
    switch (event.type) {
      case 'session/title': {
        if (data === undefined) break
        title = text(data.title) ?? title
        break
      }
      case 'model/selection': {
        if (data === undefined) break
        selectionProvider = text(data.provider) ?? selectionProvider
        selectionModel = text(data.model) ?? selectionModel
        break
      }
      case 'turn/start': {
        const turn = data === undefined ? undefined : data.turn
        if (!isCount(turn)) break
        openTurn = turn
        accumulatorFor(turn, at)
        break
      }
      case 'turn/end': {
        const turn = data === undefined ? undefined : data.turn
        if (!isCount(turn)) break
        const accumulator = turns.get(turn)
        if (accumulator !== undefined) accumulator.endedAt = at
        if (openTurn === turn) openTurn = undefined
        break
      }
      case 'assistant/message':
      case 'assistant/attempt': {
        if (data === undefined) break
        const buckets = usageBuckets(record(data.usage))
        if (buckets === undefined) break
        const turn = isCount(data.turn) ? data.turn : openTurn
        if (turn === undefined) break
        const accumulator = accumulatorFor(turn, at)
        // Per-attempt route from the message that answered; the session's last
        // durable selection is the fallback for logs without a source block.
        const message = record(data.message)
        const source = message === undefined ? undefined : record(message.source)
        const provider = text(source?.provider) ?? selectionProvider
        const model = text(source?.model) ?? selectionModel
        if (provider !== undefined && model !== undefined) {
          accumulator.provider = provider
          accumulator.model = model
        }
        accumulator.uncachedInputTokens += buckets.uncachedInputTokens
        accumulator.cacheReadTokens += buckets.cacheReadTokens
        accumulator.cacheWriteTokens += buckets.cacheWriteTokens
        accumulator.outputTokens += buckets.outputTokens
        accumulator.reasoningTokens += buckets.reasoningTokens
        accumulator.attempts += 1
        break
      }
      case 'compaction/summary': {
        if (data === undefined) break
        const buckets = usageBuckets(record(data.usage))
        if (buckets === undefined) break
        // The summary event names its own route, so no selection fallback here:
        // a compaction can run on a different model than the session's turns.
        const provider = text(data.provider)
        const model = text(data.model)
        compactions.push({
          at,
          ...(provider === undefined ? {} : { provider }),
          ...(model === undefined ? {} : { model }),
          ...buckets,
        })
        break
      }
      default:
        break
    }
  }

  const folded: FoldedTurn[] = [...turns.values()]
    .sort((left, right) => left.turn - right.turn)
    .map(accumulator => ({
      turn: accumulator.turn,
      startedAt: accumulator.startedAt,
      ...(accumulator.endedAt === undefined ? {} : { endedAt: accumulator.endedAt }),
      ...(accumulator.provider === undefined ? {} : { provider: accumulator.provider }),
      ...(accumulator.model === undefined ? {} : { model: accumulator.model }),
      uncachedInputTokens: accumulator.uncachedInputTokens,
      cacheReadTokens: accumulator.cacheReadTokens,
      cacheWriteTokens: accumulator.cacheWriteTokens,
      outputTokens: accumulator.outputTokens,
      reasoningTokens: accumulator.reasoningTokens,
      attempts: accumulator.attempts,
    }))

  return {
    id,
    ...(title === undefined ? {} : { title }),
    ...(cwd === undefined ? {} : { cwd }),
    ...(createdAt === undefined ? {} : { createdAt }),
    delegationDepth,
    turns: folded,
    compactions,
    isSeeded: seeded,
    inheritedEvents,
  }
}
