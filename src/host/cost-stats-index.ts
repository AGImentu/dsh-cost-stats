/**
 * Session cost index: enumerate stored sessions, fold each durable log into
 * billable turns, and price every turn with the official tables.
 *
 * This is the host-side counterpart of the chat chip. The chip prices ONE turn
 * from data the browser already has; this index prices EVERY turn of EVERY
 * stored session, which is what the statistics page needs — and it can only do
 * that here, because the durable logs live on the host.
 *
 * Cost of correctness: reading logs. Mitigations are explicit rather than
 * hidden: only the newest {@link MAX_SESSIONS} non-empty sessions are read, the
 * payload is cached for {@link CACHE_TTL_MS}, concurrent callers share one build,
 * and a session that fails to read is counted as skipped instead of failing the
 * whole response.
 *
 * @module dsh-cost-stats/host/cost-stats-index
 */

import { estimateTurnUsage } from '../pricing.ts'
import type { TurnCostRow, UsagePayload } from '../rows.ts'
import type { HostContextLike } from './contract.ts'
import { foldSessionEvents, type DurableEventLike, type FoldedCompaction, type FoldedTurn } from './turn-fold.ts'

/** Newest sessions read per payload build. */
export const MAX_SESSIONS = 120

/** How long one built payload is served before a rebuild. */
export const CACHE_TTL_MS = 20_000

/** Last path segment of a workspace path, without importing `node:path`. */
function baseName(path: string | undefined): string | undefined {
  if (path === undefined) return undefined
  const trimmed = path.replace(/[\\/]+$/, '')
  const index = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'))
  const name = index === -1 ? trimmed : trimmed.slice(index + 1)
  return name.length > 0 ? name : undefined
}

/** The token buckets and route one row prices. */
interface PricedSource {
  readonly provider?: string | undefined
  readonly model?: string | undefined
  readonly uncachedInputTokens: number
  readonly cacheReadTokens: number
  readonly cacheWriteTokens: number
  readonly outputTokens: number
  readonly reasoningTokens: number
}

/**
 * Price one billed item.
 * @param sessionId - owning session.
 * @param title - display title.
 * @param subagent - whether the session is a subagent's.
 * @param source - the buckets and route to price.
 * @param window - the item's start/end instants (peak classification input).
 * @param turn - turn number; `0` for a compaction row.
 * @param attempts - billed attempts folded into this item.
 * @param compaction - whether this item is a compaction call.
 * @returns the response row.
 */
function rowFor(
  sessionId: string,
  title: string,
  subagent: boolean,
  source: PricedSource,
  window: { startMs: number, endMs?: number },
  turn: number,
  attempts: number,
  compaction = false,
): TurnCostRow {
  const attributed = source.provider !== undefined && source.model !== undefined
  const estimate = estimateTurnUsage(
    {
      uncachedInputTokens: source.uncachedInputTokens,
      outputTokens: source.outputTokens,
      cacheReadTokens: source.cacheReadTokens,
      cacheWriteTokens: source.cacheWriteTokens,
      reasoningTokens: source.reasoningTokens,
      ...(attributed ? { routes: [{ provider: source.provider as string, model: source.model as string }] } : {}),
    },
    window,
    window.startMs,
  )
  const priced = estimate !== undefined && estimate.unpricedModels.length === 0
  return {
    sessionId,
    sessionTitle: title,
    subagent,
    turn,
    ...(compaction ? { compaction: true } : {}),
    at: window.startMs,
    ...(source.provider === undefined ? {} : { provider: source.provider }),
    ...(source.model === undefined ? {} : { model: source.model }),
    ...(priced && estimate !== undefined ? { plan: estimate.plan.label } : {}),
    priced,
    cny: priced && estimate !== undefined ? estimate.cny.total : 0,
    usd: priced && estimate !== undefined ? estimate.usd.total : 0,
    uncachedInputTokens: source.uncachedInputTokens,
    cacheReadTokens: source.cacheReadTokens,
    outputTokens: source.outputTokens,
    reasoningTokens: source.reasoningTokens,
    tokens: source.uncachedInputTokens + source.cacheReadTokens + source.outputTokens,
    attempts,
  }
}

/**
 * Price one folded turn.
 * @param sessionId - owning session.
 * @param title - display title.
 * @param subagent - whether the session is a subagent's.
 * @param turn - the folded turn.
 * @returns the response row.
 */
function turnRow(sessionId: string, title: string, subagent: boolean, turn: FoldedTurn): TurnCostRow {
  return rowFor(
    sessionId,
    title,
    subagent,
    turn,
    { startMs: turn.startedAt, ...(turn.endedAt === undefined ? {} : { endMs: turn.endedAt }) },
    turn.turn,
    turn.attempts,
  )
}

/**
 * Price one folded compaction call.
 *
 * It gets its own row because the provider bills it, yet it belongs to no reply:
 * without this row the page's total silently trails the invoice (measured: one
 * compaction can be ~$0.2 at peak rates).
 * @param sessionId - owning session.
 * @param title - display title.
 * @param subagent - whether the session is a subagent's.
 * @param compaction - the folded compaction.
 * @returns the response row.
 */
function compactionRow(
  sessionId: string,
  title: string,
  subagent: boolean,
  compaction: FoldedCompaction,
): TurnCostRow {
  // Priced at its own instant: a compaction is one request, so start = end.
  return rowFor(
    sessionId,
    title,
    subagent,
    compaction,
    { startMs: compaction.at, endMs: compaction.at },
    0,
    1,
    true,
  )
}

/** Builds and caches the statistics payload. */
export class CostStatsIndex {
  private cached: { readonly at: number; readonly payload: UsagePayload } | undefined
  private inFlight: Promise<UsagePayload> | undefined

  /**
   * @param ctx - host context carrying the persistence service.
   * @param now - clock, injectable for tests.
   * @param ttlMs - cache lifetime.
   */
  constructor(
    private readonly ctx: HostContextLike,
    private readonly now: () => number = Date.now,
    private readonly ttlMs: number = CACHE_TTL_MS,
  ) {}

  /**
   * Serve the payload, rebuilding at most once per TTL.
   * @param force - bypass the cache (the client's refresh action).
   * @returns the payload.
   */
  async payload(force = false): Promise<UsagePayload> {
    const at = this.now()
    if (!force && this.cached !== undefined && at - this.cached.at < this.ttlMs) return this.cached.payload
    if (this.inFlight !== undefined) return await this.inFlight
    const build = this.build()
      .then((payload) => {
        this.cached = { at: this.now(), payload }
        return payload
      })
      .finally(() => { this.inFlight = undefined })
    this.inFlight = build
    return await build
  }

  /** Read every candidate session and price its turns. */
  private async build(): Promise<UsagePayload> {
    const stored = await this.ctx.sessionPersistence.list()
    const candidates = stored
      .filter(snapshot => (snapshot.eventCount ?? 1) !== 0)
      .sort((left, right) => (right.header.createdAt ?? 0) - (left.header.createdAt ?? 0))
      .slice(0, MAX_SESSIONS)

    const rows: TurnCostRow[] = []
    let skipped = 0
    for (const snapshot of candidates) {
      try {
        const session = await this.readSession(snapshot.header.id)
        // Header fields come from the snapshot, not from the folded events: the
        // persistence layer returns event rows without the physical header
        // record, so `session.cwd` / `session.delegationDepth` are usually
        // absent here while the snapshot always carries them.
        const title = session.title
          ?? baseName(snapshot.header.cwd ?? session.cwd)
          ?? `session ${session.id.slice(0, 8)}`
        const subagent = (snapshot.header.delegationDepth ?? session.delegationDepth) > 0
        let priced = 0
        for (const turn of session.turns) {
          if (turn.attempts === 0) continue
          const row = turnRow(session.id, title, subagent, turn)
          rows.push(row)
          if (row.priced) priced += 1
        }
        for (const compaction of session.compactions) {
          const row = compactionRow(session.id, title, subagent, compaction)
          rows.push(row)
          if (row.priced) priced += 1
        }
        if (priced === 0) skipped += 1
      } catch {
        // An unreadable or malformed session must not fail the whole page; it is
        // reported through the skipped count instead.
        skipped += 1
      }
    }
    rows.sort((left, right) => (right.at - left.at) || (left.turn - right.turn))
    return { generatedAt: this.now(), stored: stored.length, read: candidates.length, skipped, rows }
  }

  /**
   * Open, read, and fold one stored session.
   *
   * The handle's `inheritedEventCount` is handed to the fold because the read
   * output carries no `session` header event: without it a fork's inherited
   * prefix would be priced as if the child had produced it (the parent's own log
   * bills those turns), which showed up as the same reply listed three times.
   */
  private async readSession(id: string) {
    const handle = await this.ctx.sessionPersistence.open(id, 'read')
    try {
      const { events } = await handle.read()
      return foldSessionEvents(id, events as readonly DurableEventLike[], {
        inheritedEventCount: handle.inheritedEventCount,
      })
    } finally {
      await handle.close().catch(() => {})
    }
  }
}
