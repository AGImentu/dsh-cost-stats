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
 * @module dsh-session-cost/host/session-cost-index
 */

import { estimateTurnUsage } from '../pricing.ts'
import type { TurnCostRow, UsagePayload } from '../rows.ts'
import type { HostContextLike } from './contract.ts'
import { foldSessionEvents, type DurableEventLike, type FoldedTurn } from './turn-fold.ts'

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

/**
 * Price one folded turn.
 * @param session - folded session owning the turn.
 * @param turn - the folded turn.
 * @returns the response row.
 */
function rowFor(sessionId: string, title: string, subagent: boolean, turn: FoldedTurn): TurnCostRow {
  const attributed = turn.provider !== undefined && turn.model !== undefined
  const estimate = estimateTurnUsage(
    {
      uncachedInputTokens: turn.uncachedInputTokens,
      outputTokens: turn.outputTokens,
      cacheReadTokens: turn.cacheReadTokens,
      cacheWriteTokens: turn.cacheWriteTokens,
      reasoningTokens: turn.reasoningTokens,
      ...(attributed ? { routes: [{ provider: turn.provider as string, model: turn.model as string }] } : {}),
    },
    { startMs: turn.startedAt, ...(turn.endedAt === undefined ? {} : { endMs: turn.endedAt }) },
    turn.startedAt,
  )
  const priced = estimate !== undefined && estimate.unpricedModels.length === 0
  return {
    sessionId,
    sessionTitle: title,
    subagent,
    turn: turn.turn,
    at: turn.startedAt,
    ...(turn.provider === undefined ? {} : { provider: turn.provider }),
    ...(turn.model === undefined ? {} : { model: turn.model }),
    ...(priced && estimate !== undefined ? { plan: estimate.plan.label } : {}),
    priced,
    cny: priced && estimate !== undefined ? estimate.cny.total : 0,
    usd: priced && estimate !== undefined ? estimate.usd.total : 0,
    uncachedInputTokens: turn.uncachedInputTokens,
    cacheReadTokens: turn.cacheReadTokens,
    outputTokens: turn.outputTokens,
    reasoningTokens: turn.reasoningTokens,
    tokens: turn.uncachedInputTokens + turn.cacheReadTokens + turn.outputTokens,
    attempts: turn.attempts,
  }
}

/** Builds and caches the statistics payload. */
export class SessionCostIndex {
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
        const title = session.title
          ?? baseName(session.cwd)
          ?? `session ${session.id.slice(0, 8)}`
        const subagent = session.delegationDepth > 0
        let priced = 0
        for (const turn of session.turns) {
          if (turn.attempts === 0) continue
          const row = rowFor(session.id, title, subagent, turn)
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

  /** Open, read, and fold one stored session. */
  private async readSession(id: string) {
    const handle = await this.ctx.sessionPersistence.open(id, 'read')
    try {
      const { events } = await handle.read()
      return foldSessionEvents(id, events as readonly DurableEventLike[])
    } finally {
      await handle.close().catch(() => {})
    }
  }
}
