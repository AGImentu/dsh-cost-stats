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
 *
 * Usage semantics: `inputTokens` is the UNCACHED prompt count (the provider
 * adapter subtracts the cache reads), `outputTokens` already contains the
 * reasoning tokens, and `totalTokens` is prompt + output. Invalid or negative
 * counts are dropped rather than summed into a wrong number.
 *
 * @module dsh-session-cost/host/turn-fold
 */

/** One durable event, narrowed to what the fold reads. */
export interface DurableEventLike {
  readonly type: string
  readonly time?: number
  readonly data?: unknown
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

/** One folded session. */
export interface FoldedSession {
  readonly id: string
  readonly title?: string
  readonly cwd?: string
  readonly createdAt?: number
  readonly delegationDepth: number
  readonly turns: readonly FoldedTurn[]
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

/**
 * Fold one session's events.
 * @param sessionId - fallback id when the header is missing.
 * @param events - the durable events, in seq order.
 * @returns the session with its billable turns, ordered by turn number.
 */
export function foldSessionEvents(
  sessionId: string,
  events: readonly DurableEventLike[],
): FoldedSession {
  let id = sessionId
  let title: string | undefined
  let cwd: string | undefined
  let createdAt: number | undefined
  let delegationDepth = 0
  let selectionProvider: string | undefined
  let selectionModel: string | undefined
  const turns = new Map<number, TurnAccumulator>()
  let openTurn: number | undefined

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

  for (const event of events) {
    const data = record(event.data)
    const at = isCount(event.time) ? event.time : 0
    switch (event.type) {
      case 'session': {
        if (data === undefined) break
        id = text(data.id) ?? id
        cwd = text(data.cwd) ?? cwd
        if (isCount(data.createdAt)) createdAt = data.createdAt
        if (isCount(data.delegationDepth)) delegationDepth = data.delegationDepth
        break
      }
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
        const usage = record(data.usage)
        if (usage === undefined) break
        const turn = isCount(data.turn) ? data.turn : openTurn
        if (turn === undefined) break
        // Mirror DSH's own meter: an attempt whose usage does not validate is
        // dropped entirely rather than counted with zeroes, so a corrupt sample
        // can never inflate the attempt count or understate a bill.
        if (!isCount(usage.inputTokens) || !isCount(usage.outputTokens)) break
        if (usage.cacheReadTokens !== undefined && !isCount(usage.cacheReadTokens)) break
        if (usage.cacheWriteTokens !== undefined && !isCount(usage.cacheWriteTokens)) break
        if (usage.reasoningTokens !== undefined
          && (!isCount(usage.reasoningTokens) || usage.reasoningTokens > usage.outputTokens)) break
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
        accumulator.uncachedInputTokens += usage.inputTokens
        accumulator.cacheReadTokens += count(usage.cacheReadTokens)
        accumulator.cacheWriteTokens += count(usage.cacheWriteTokens)
        accumulator.outputTokens += usage.outputTokens
        accumulator.reasoningTokens += count(usage.reasoningTokens)
        accumulator.attempts += 1
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
  }
}
