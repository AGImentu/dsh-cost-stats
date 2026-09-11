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
