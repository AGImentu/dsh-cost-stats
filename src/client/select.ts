/**
 * Snapshot selectors.
 *
 * Every selector returns a REFERENCE the store already holds (a node's payload
 * object) or a primitive — never a freshly built object. The chat snapshot hooks
 * compare selector results by identity, so returning a new object on each call
 * would re-render on every stream chunk.
 *
 * @module dsh-cost-stats/client/select
 */

import type {
  ChatNodeLike, ChatSnapshotLike, TurnLocationLike, TurnTailData, TurnTokenUsage,
} from './contract.ts'

/**
 * Find the turn-tail node that renders the action row of one assistant message.
 * @param snapshot - current chat snapshot.
 * @param messageId - durable assistant message id.
 * @returns the node, or undefined while its turn is not materialized.
 */
function tailNodeFor(snapshot: ChatSnapshotLike, messageId: string): ChatNodeLike | undefined {
  const nodes = snapshot.nodes?.values?.()
  if (nodes === undefined) return undefined
  for (const node of nodes) {
    if (node.kind !== 'turn-tail') continue
    const data = node.data as TurnTailData | undefined
    if (data?.closing?.finalNode?.messageId === messageId) return node
  }
  return undefined
}

/**
 * Select one turn's exact provider-reported usage.
 * @param snapshot - current chat snapshot.
 * @param messageId - durable assistant message id.
 * @returns the stored usage object, or undefined while unavailable.
 */
export function selectTurnUsage(snapshot: ChatSnapshotLike, messageId: string): TurnTokenUsage | undefined {
  const data = tailNodeFor(snapshot, messageId)?.data as TurnTailData | undefined
  return data?.tokenUsage
}

/**
 * Select one turn's timeline location (start/end instants, peak classification).
 * @param snapshot - current chat snapshot.
 * @param messageId - durable assistant message id.
 * @returns the stored location object, or undefined while unavailable.
 */
export function selectTurnLocation(
  snapshot: ChatSnapshotLike,
  messageId: string,
): TurnLocationLike | undefined {
  return tailNodeFor(snapshot, messageId)?.location?.turn
}

/**
 * Select one turn's number.
 *
 * Read even when `tokenUsage` is absent: the number is what lets the chip fall
 * back to the host's log fold for a turn whose core usage was withheld.
 * @param snapshot - current chat snapshot.
 * @param messageId - durable assistant message id.
 * @returns the turn number, or undefined while unavailable.
 */
export function selectTurnNumber(snapshot: ChatSnapshotLike, messageId: string): number | undefined {
  const data = tailNodeFor(snapshot, messageId)?.data as TurnTailData | undefined
  return typeof data?.turn === 'number' ? data.turn : undefined
}

/** One loaded turn with the usage this plugin prices. */
export interface LoadedTurn {
  readonly turn: number
  readonly usage: TurnTokenUsage
  readonly location?: TurnLocationLike | undefined
}

/**
 * Collect every loaded turn that carries usage, in node order.
 *
 * This DOES build a new array, so it must run during render (memoized on the
 * snapshot's order array) rather than inside a selector.
 * @param snapshot - current chat snapshot.
 * @returns the turns available in the loaded window.
 */
export function collectLoadedTurns(snapshot: ChatSnapshotLike): readonly LoadedTurn[] {
  const nodes = snapshot.nodes?.values?.()
  if (nodes === undefined) return []
  const turns: LoadedTurn[] = []
  const seen = new Set<number>()
  for (const node of nodes) {
    if (node.kind !== 'turn-tail') continue
    const data = node.data as TurnTailData | undefined
    const usage = data?.tokenUsage
    if (data === undefined || usage === undefined) continue
    if (seen.has(data.turn)) continue
    seen.add(data.turn)
    turns.push({ turn: data.turn, usage, location: node.location?.turn })
  }
  return turns
}

/** A turn window reduced to the instants the pricing model reads. */
export interface TurnWindow {
  readonly startMs?: number | undefined
  readonly endMs?: number | undefined
}

/**
 * Reduce a timeline location to the two instants the cost model needs.
 * @param location - turn location from the chat node.
 * @returns epoch-ms bounds; each may be absent.
 */
export function turnWindowOf(location: TurnLocationLike | undefined): TurnWindow {
  const startMs = location?.start?.time
  const endMs = location?.end?.time
  return {
    ...(typeof startMs === 'number' && Number.isFinite(startMs) ? { startMs } : {}),
    ...(typeof endMs === 'number' && Number.isFinite(endMs) ? { endMs } : {}),
  }
}
