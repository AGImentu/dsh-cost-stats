/**
 * Unit tests for the client-side usage cache that backs the chip's fallback.
 *
 * The properties that matter are the boring ones: one request per window, one
 * request for concurrent callers, stale rows kept when a refresh fails, and a
 * lookup that never returns another session's or another turn's reply.
 */

import { describe, expect, it, vi } from 'vitest'
import type { TurnCostRow, UsagePayload } from '../src/rows.ts'
import { USAGE_TTL_MS, UsageStore } from '../src/client/usage-store.ts'

/** One reply row; only the identity fields matter to the store. */
function row(sessionId: string, turn: number, cny = 1): TurnCostRow {
  return {
    sessionId,
    sessionTitle: 'session',
    subagent: false,
    turn,
    at: 1_700_000_000_000,
    provider: 'deepseek-official',
    model: 'deepseek-flash',
    plan: 'DeepSeek-V4.1-Flash',
    priced: true,
    cny,
    usd: cny / 7.2,
    uncachedInputTokens: 10,
    cacheReadTokens: 20,
    outputTokens: 30,
    reasoningTokens: 0,
    tokens: 60,
    attempts: 1,
  }
}

/** A payload with the given rows. */
function payload(rows: readonly TurnCostRow[]): UsagePayload {
  return { generatedAt: 1_700_000_000_000, stored: 1, read: 1, skipped: 0, rows }
}

/** Response stub good enough for the store. */
function okResponse(body: UsagePayload): Response {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => body,
  } as unknown as Response
}

/**
 * Build a store over a scripted fetch and a controllable clock.
 * @param responses - queued results; a thrown value rejects that request.
 * @param calls - receives every requested URL.
 * @returns the store, the clock, and the recorded URLs.
 */
function harness(responses: readonly (UsagePayload | Error)[], now: { value: number }) {
  const urls: string[] = []
  let index = 0
  const fetchImpl = vi.fn(async (url: string) => {
    urls.push(url)
    const next = responses[Math.min(index, responses.length - 1)]
    index += 1
    if (next instanceof Error) throw next
    return okResponse(next as UsagePayload)
  })
  const store = new UsageStore(() => fetchImpl as never, USAGE_TTL_MS, () => now.value)
  return { store, urls, fetchImpl }
}

/** Let the store's promise chain settle. */
const settle = async (): Promise<void> => { await new Promise(resolve => { setTimeout(resolve, 0) }) }

describe('UsageStore', () => {
  it('starts idle with no rows', () => {
    const { store } = harness([payload([])], { value: 0 })
    expect(store.getSnapshot()).toEqual({ status: 'idle', rows: [] })
  })

  it('fetches once and publishes the rows', async () => {
    const { store, urls } = harness([payload([row('s1', 3)])], { value: 0 })
    store.ensure()
    await settle()
    expect(urls).toEqual(['/cost-stats/usage'])
    expect(store.getSnapshot().status).toBe('ready')
    expect(store.getSnapshot().rows).toHaveLength(1)
  })

  it('joins concurrent callers into one request', async () => {
    const { store, urls } = harness([payload([row('s1', 3)])], { value: 0 })
    store.ensure()
    store.ensure()
    store.ensure()
    await settle()
    expect(urls).toHaveLength(1)
  })

  it('reuses a fresh payload and refetches after the TTL', async () => {
    const now = { value: 0 }
    const { store, urls } = harness([payload([row('s1', 3)]), payload([row('s1', 4)])], now)
    store.ensure()
    await settle()
    now.value += USAGE_TTL_MS - 1
    store.ensure()
    await settle()
    expect(urls).toHaveLength(1)
    now.value += 2
    store.ensure()
    await settle()
    expect(urls).toHaveLength(2)
    expect(store.getSnapshot().rows[0]?.turn).toBe(4)
  })

  it('bypasses the cache when forced, marking the request', async () => {
    const { store, urls } = harness([payload([]), payload([])], { value: 0 })
    store.ensure(true)
    await settle()
    expect(urls).toEqual(['/cost-stats/usage?refresh=1'])
  })

  it('keeps stale rows and reports the error when a refresh fails', async () => {
    const now = { value: 0 }
    const { store } = harness([payload([row('s1', 3)]), new Error('503 Service Unavailable')], now)
    store.ensure()
    await settle()
    now.value += USAGE_TTL_MS + 1
    store.ensure()
    await settle()
    const snapshot = store.getSnapshot()
    expect(snapshot.status).toBe('error')
    expect(snapshot.error).toBe('503 Service Unavailable')
    expect(snapshot.rows).toHaveLength(1)
    expect(snapshot.fetchedAt).toBe(0)
  })

  it('reports a non-ok response as an error', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 500, statusText: 'boom' } as unknown as Response))
    const store = new UsageStore(() => fetchImpl as never, USAGE_TTL_MS, () => 0)
    store.ensure()
    await settle()
    expect(store.getSnapshot().status).toBe('error')
    expect(store.getSnapshot().error).toBe('500 boom')
  })

  it('looks up one reply by session and turn', async () => {
    const { store } = harness([payload([row('s1', 3, 2), row('s2', 3, 9)])], { value: 0 })
    store.ensure()
    await settle()
    expect(store.lookup('s2', 3)?.cny).toBe(9)
    expect(store.lookup('s1', 4)).toBeUndefined()
    expect(store.lookup(undefined, 3)).toBeUndefined()
    expect(store.lookup('s1', undefined)).toBeUndefined()
  })

  it('never returns a compaction row in place of a reply', async () => {
    const compaction = { ...row('s1', 0, 7), compaction: true as const }
    const { store } = harness([payload([compaction])], { value: 0 })
    store.ensure()
    await settle()
    expect(store.lookup('s1', 0)).toBeUndefined()
    expect(store.lookup('s1', 3)).toBeUndefined()
  })

  it('notifies subscribers and stops after unsubscribe', async () => {
    const { store } = harness([payload([row('s1', 3)])], { value: 0 })
    const seen = vi.fn()
    const off = store.subscribe(seen)
    store.ensure()
    await settle()
    expect(seen.mock.calls.length).toBeGreaterThanOrEqual(2)
    const before = seen.mock.calls.length
    off()
    store.ensure(true)
    await settle()
    expect(seen.mock.calls.length).toBe(before)
  })
})
