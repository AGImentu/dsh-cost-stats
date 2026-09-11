import { describe, expect, it } from 'vitest'
import { foldSessionEvents, type DurableEventLike } from '../src/host/turn-fold.ts'

/** One instant to hang fixture events off. */
const T0 = Date.UTC(2026, 8, 11, 4, 0, 0)

/** Build a fixture log. */
function log(): readonly DurableEventLike[] {
  return [
    { type: 'session', time: T0, data: { id: 's1', cwd: 'D:\\work\\app', createdAt: T0, delegationDepth: 0 } },
    { type: 'session/title', time: T0 + 1, data: { title: 'My chat' } },
    { type: 'model/selection', time: T0 + 2, data: { provider: 'deepseek-official', model: 'deepseek-flash' } },
    { type: 'turn/start', time: T0 + 10, data: { turn: 1 } },
    {
      type: 'assistant/message',
      time: T0 + 20,
      data: {
        turn: 1,
        step: 1,
        message: { source: { kind: 'model', provider: 'deepseek-official', model: 'deepseek-flash' } },
        usage: { inputTokens: 100, outputTokens: 50, cacheReadTokens: 1000, reasoningTokens: 10, totalTokens: 1150 },
      },
    },
    // No source block: the durable selection supplies the route.
    {
      type: 'assistant/message',
      time: T0 + 30,
      data: { turn: 1, step: 2, usage: { inputTokens: 5, outputTokens: 7, cacheReadTokens: 3 } },
    },
    { type: 'turn/end', time: T0 + 40, data: { turn: 1, reason: { kind: 'completed' } } },
    { type: 'turn/start', time: T0 + 50, data: { turn: 2 } },
    { type: 'model/selection', time: T0 + 55, data: { provider: 'deepseek-official', model: 'deepseek-v4-pro' } },
    {
      type: 'assistant/message',
      time: T0 + 60,
      data: { turn: 2, step: 1, usage: { inputTokens: 9, outputTokens: 11 } },
    },
    { type: 'turn/end', time: T0 + 70, data: { turn: 2, reason: { kind: 'completed' } } },
  ]
}

describe('foldSessionEvents', () => {
  it('reads the header, title and delegation depth', () => {
    const session = foldSessionEvents('fallback', log())
    expect(session.id).toBe('s1')
    expect(session.title).toBe('My chat')
    expect(session.cwd).toBe('D:\\work\\app')
    expect(session.createdAt).toBe(T0)
    expect(session.delegationDepth).toBe(0)
  })

  it('sums every billed attempt into its turn and keeps the window', () => {
    const session = foldSessionEvents('s1', log())
    expect(session.turns).toHaveLength(2)
    const [first, second] = session.turns
    expect(first).toMatchObject({
      turn: 1,
      startedAt: T0 + 10,
      endedAt: T0 + 40,
      provider: 'deepseek-official',
      model: 'deepseek-flash',
      uncachedInputTokens: 105,
      cacheReadTokens: 1003,
      outputTokens: 57,
      reasoningTokens: 10,
      attempts: 2,
    })
    expect(second).toMatchObject({
      turn: 2,
      startedAt: T0 + 50,
      endedAt: T0 + 70,
      model: 'deepseek-v4-pro',
      uncachedInputTokens: 9,
      outputTokens: 11,
      cacheReadTokens: 0,
      attempts: 1,
    })
  })

  it('flags a subagent session through the header depth', () => {
    const session = foldSessionEvents('s1', [
      { type: 'session', time: T0, data: { id: 's1', delegationDepth: 2 } },
      ...log().slice(3),
    ])
    expect(session.delegationDepth).toBe(2)
  })

  it('drops invalid usage instead of summing a wrong number', () => {
    const session = foldSessionEvents('s1', [
      { type: 'turn/start', time: T0, data: { turn: 1 } },
      { type: 'assistant/message', time: T0 + 1, data: { turn: 1, usage: { inputTokens: -5, outputTokens: 3.5 } } },
      { type: 'assistant/message', time: T0 + 2, data: { turn: 1, usage: { inputTokens: 4, outputTokens: 2 } } },
    ])
    expect(session.turns[0]).toMatchObject({ uncachedInputTokens: 4, outputTokens: 2, attempts: 1 })
  })

  it('ignores a usage event that belongs to no turn', () => {
    const session = foldSessionEvents('s1', [
      { type: 'assistant/message', time: T0, data: { usage: { inputTokens: 100, outputTokens: 100 } } },
    ])
    expect(session.turns).toEqual([])
  })

  it('folds a retried attempt reported as assistant/attempt', () => {
    const session = foldSessionEvents('s1', [
      { type: 'turn/start', time: T0, data: { turn: 1 } },
      { type: 'assistant/attempt', time: T0 + 1, data: { turn: 1, usage: { inputTokens: 10, outputTokens: 1 } } },
      { type: 'assistant/message', time: T0 + 2, data: { turn: 1, usage: { inputTokens: 20, outputTokens: 2 } } },
    ])
    expect(session.turns[0]).toMatchObject({ uncachedInputTokens: 30, outputTokens: 3, attempts: 2 })
  })

  it('tolerates an unknown event type and a missing data block', () => {
    const session = foldSessionEvents('s1', [
      { type: 'unknown/event', time: T0 },
      { type: 'turn/start', time: T0, data: undefined },
      { type: 'turn/start', time: T0 + 1, data: { turn: 3 } },
    ])
    expect(session.turns.map(turn => turn.turn)).toEqual([3])
  })
})

describe('compaction folding', () => {
  it('reports no compactions for a log without any', () => {
    expect(foldSessionEvents('s1', log()).compactions).toEqual([])
  })

  it('folds a compaction as its own billed item, with its own route', () => {
    const session = foldSessionEvents('s1', [
      ...log(),
      {
        type: 'compaction/summary',
        time: T0 + 100,
        data: {
          compactionId: 'c1',
          provider: 'deepseek-official',
          model: 'deepseek-v4-pro',
          usage: { inputTokens: 700, outputTokens: 40, cacheReadTokens: 20, reasoningTokens: 0, totalTokens: 760 },
        },
      },
    ])
    expect(session.compactions).toEqual([{
      at: T0 + 100,
      provider: 'deepseek-official',
      model: 'deepseek-v4-pro',
      uncachedInputTokens: 700,
      cacheReadTokens: 20,
      cacheWriteTokens: 0,
      outputTokens: 40,
      reasoningTokens: 0,
    }])
    // It must not be folded into a turn, and it must not change the turn count.
    expect(session.turns).toHaveLength(2)
    expect(session.turns[0]?.uncachedInputTokens).toBe(105)
  })

  it('drops a compaction whose usage does not validate', () => {
    const session = foldSessionEvents('s1', [
      { type: 'compaction/summary', time: T0, data: { provider: 'deepseek-official', model: 'deepseek-flash', usage: { inputTokens: 5 } } },
      { type: 'compaction/summary', time: T0 + 1, data: { provider: 'deepseek-official', model: 'deepseek-flash' } },
    ])
    expect(session.compactions).toEqual([])
  })

  it('keeps a compaction with no route, leaving it unpriced rather than guessed', () => {
    const session = foldSessionEvents('s1', [
      { type: 'compaction/summary', time: T0, data: { usage: { inputTokens: 10, outputTokens: 2 } } },
    ])
    expect(session.compactions).toHaveLength(1)
    expect(session.compactions[0]?.provider).toBeUndefined()
  })
})

describe('seeded (forked) logs', () => {
  /**
   * A side thread's log: the parent's events under a `session/end-seed` seam,
   * then the child's own events. The header carries its fields at the top level,
   * the way DSH 0.1.5 writes them.
   */
  function seededLog(): readonly DurableEventLike[] {
    return [
      {
        type: 'session',
        id: 'child',
        cwd: 'D:\\work\\app',
        createdAt: T0,
        delegationDepth: 1,
        isSeeded: true,
        parentSession: 'parent',
        origin: 'subagent',
      },
      // ---- inherited prefix: a copy of the parent's billed turn ----
      { type: 'model/selection', seq: 1, time: T0 + 1, data: { provider: 'deepseek-official', model: 'deepseek-flash' } },
      { type: 'turn/start', seq: 2, time: T0 + 10, data: { turn: 1 } },
      { type: 'assistant/message', seq: 3, time: T0 + 20, data: { turn: 1, usage: { inputTokens: 1000, outputTokens: 500 } } },
      { type: 'turn/end', seq: 4, time: T0 + 30, data: { turn: 1 } },
      { type: 'session/end-seed', seq: 5, time: T0 + 31, data: {} },
      { type: 'session/end-seed', seq: 9, time: T0 + 40, data: { inherited: true } },
      // ---- the child's own events ----
      { type: 'turn/start', seq: 10, time: T0 + 100, data: { turn: 7 } },
      { type: 'assistant/message', seq: 11, time: T0 + 110, data: { turn: 7, usage: { inputTokens: 3, outputTokens: 4 } } },
      { type: 'turn/end', seq: 12, time: T0 + 120, data: { turn: 7 } },
    ]
  }

  it("ignores the inherited prefix and keeps the child's own turn", () => {
    const session = foldSessionEvents('fallback', seededLog())
    expect(session.isSeeded).toBe(true)
    expect(session.inheritedEvents).toBe(6)
    expect(session.turns).toHaveLength(1)
    expect(session.turns[0]).toMatchObject({
      turn: 7,
      startedAt: T0 + 100,
      uncachedInputTokens: 3,
      outputTokens: 4,
      attempts: 1,
    })
  })

  it('reads delegation depth and route from the top-level header', () => {
    const session = foldSessionEvents('fallback', seededLog())
    expect(session.id).toBe('child')
    expect(session.cwd).toBe('D:\\work\\app')
    expect(session.delegationDepth).toBe(1)
  })

  it('folds nothing when a seeded log has no locatable seam', () => {
    const session = foldSessionEvents('s1', [
      { type: 'session', id: 'child', isSeeded: true },
      { type: 'turn/start', seq: 1, time: T0, data: { turn: 1 } },
      { type: 'assistant/message', seq: 2, time: T0 + 1, data: { turn: 1, usage: { inputTokens: 9, outputTokens: 9 } } },
    ])
    expect(session.isSeeded).toBe(true)
    expect(session.turns).toEqual([])
  })

  it('still folds a non-seeded log in full', () => {
    const session = foldSessionEvents('s1', [
      { type: 'session', id: 'plain', isSeeded: false, delegationDepth: 0 },
      ...log().slice(1),
    ])
    expect(session.isSeeded).toBe(false)
    expect(session.inheritedEvents).toBe(0)
    expect(session.turns).toHaveLength(2)
    expect(session.turns[0]?.uncachedInputTokens).toBe(105)
  })

  it('also reads a header that nests its fields under data (older logs)', () => {
    const session = foldSessionEvents('s1', [
      { type: 'session', time: T0, data: { id: 'old', delegationDepth: 2, isSeeded: false } },
      ...log().slice(3),
    ])
    expect(session.id).toBe('old')
    expect(session.delegationDepth).toBe(2)
    expect(session.turns).toHaveLength(2)
  })

  it('honours the persistence handle cut when no header event is present', () => {
    // This is the host route's shape: handle.read() returns event rows WITHOUT
    // the physical header record, so `isSeeded` appears nowhere in the input.
    const session = foldSessionEvents('child', seededLog().slice(1), { inheritedEventCount: 6 })
    expect(session.isSeeded).toBe(true)
    expect(session.inheritedEvents).toBe(6)
    expect(session.turns.map(turn => turn.turn)).toEqual([7])
  })

  it('prices the whole log when the handle reports no inherited prefix', () => {
    const session = foldSessionEvents('child', seededLog().slice(1), { inheritedEventCount: 0 })
    expect(session.isSeeded).toBe(false)
    expect(session.inheritedEvents).toBe(0)
    expect(session.turns.map(turn => turn.turn)).toEqual([1, 7])
  })
})
