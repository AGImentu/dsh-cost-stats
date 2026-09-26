#!/usr/bin/env node
/**
 * Balance cross-check (diagnostics, not part of the plugin's runtime).
 *
 * Recomputes every stored session's cost straight from the durable logs, using
 * the same fold (`src/host/turn-fold.ts`) and the same official tables
 * (`src/pricing.ts`) the plugin ships, then prints:
 *
 * - per-session and per-day subtotals,
 * - the grand total in ¥ and $,
 * - the cumulative total at each checkpoint instant you pass on the command
 *   line, so a checkpoint's DELTA can be compared with the API balance's own
 *   delta over the same interval.
 *
 * This bypasses the host entirely (it reads `$DSH_HOME/sessions/**` and decodes
 * the concatenated Zstandard frames itself), which is exactly why it is a useful
 * independent check of what the plugin reports.
 *
 * Usage:
 *   node scripts/verify-balance.mjs 2026-09-11T11:07 2026-09-11T12:20
 *
 * @module dsh-cost-stats/scripts/verify-balance
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { zstdDecompressSync } from 'node:zlib'
import { estimateTurnUsage, formatMoney } from '../src/pricing.ts'
import { foldSessionEvents } from '../src/host/turn-fold.ts'

const ZSTD_MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])

/**
 * Decode a concatenated-Zstandard JSONL log by scanning frame magic.
 * @param buffer - raw file bytes.
 * @returns the decoded text.
 */
function decodeLog(buffer) {
  if (!buffer.subarray(0, 4).equals(ZSTD_MAGIC)) return buffer.toString('utf8')
  const starts = []
  for (let index = 0; index + 4 <= buffer.length; index += 1) {
    if (buffer[index] === 0x28 && buffer[index + 1] === 0xb5
      && buffer[index + 2] === 0x2f && buffer[index + 3] === 0xfd) starts.push(index)
  }
  const chunks = []
  for (let index = 0; index < starts.length; index += 1) {
    const end = index + 1 < starts.length ? starts[index + 1] : buffer.length
    try {
      chunks.push(zstdDecompressSync(buffer.subarray(starts[index], end)))
    } catch {
      // A payload byte pair can look like frame magic, and the live log may end
      // in a torn frame; both are skipped rather than aborting the scan.
    }
  }
  return Buffer.concat(chunks).toString('utf8')
}

/**
 * Recursively collect ONE log per session: its newest format generation.
 *
 * DSH keeps released generations and publishes successors next to them (a v3
 * session gets a v4 file after an upgrade; an old one may still have v2 and v3).
 * The running plugin reads through `sessionPersistence`, which lists one logical
 * session per id, so reading every file here would count that session's early
 * turns twice and inflate the very totals this script exists to check.
 * @param root - sessions directory.
 * @returns the log path of each session's current generation.
 */
function collectLogs(root) {
  /** Directory → { version, path } of the newest generation seen. */
  const newest = new Map()
  const walk = (dir) => {
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(path)
        continue
      }
      const match = /^session(?:\.v(\d+))?\.jsonl(?:\.zstd)?$/.exec(entry.name)
      if (match === null) continue
      const version = match[1] === undefined ? -1 : Number(match[1])
      const current = newest.get(dir)
      if (current === undefined || version > current.version) newest.set(dir, { version, path })
    }
  }
  walk(root)
  return [...newest.values()].map(entry => entry.path)
}

/**
 * Parse checkpoint arguments into epoch ms.
 * @param value - `YYYY-MM-DDTHH:mm` in local time, or an ISO string.
 * @returns epoch ms.
 */
function parseCheckpoint(value) {
  const local = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value) ? `${value}:00` : value
  const at = Date.parse(local)
  if (!Number.isFinite(at)) throw new Error(`cannot parse checkpoint ${value}`)
  return at
}

const dshHome = process.env.DSH_HOME ?? join(homedir(), '.dsh')
const sessionsRoot = join(dshHome, 'sessions')
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const checkpoints = process.argv.slice(2).map(parseCheckpoint)
const localStamp = (at) => new Date(at).toLocaleString('sv-SE')

const logs = collectLogs(sessionsRoot).sort()
const turns = []
let sessions = 0
let unreadable = 0
let unpriced = 0
let compactionCount = 0
let seededSessions = 0
let inheritedEvents = 0
const formatCounts = new Map()
const eventHistogram = new Map()

/**
 * How many logs of each session-format generation were read.
 *
 * Printed because 0.1.7 publishes v4 successors next to the released v3 files:
 * seeing the mix makes a format upgrade visible instead of silent.
 * @returns a label such as `v3×12 v4×2 legacy×1`.
 */
function formatMix() {
  if (formatCounts.size === 0) return 'none'
  return [...formatCounts.entries()]
    .sort((left, right) => left[0].localeCompare(right[0]))
    .map(([label, count]) => `${label}×${String(count)}`)
    .join(' ')
}

for (const path of logs) {
  let text
  try {
    text = decodeLog(readFileSync(path))
  } catch {
    unreadable += 1
    continue
  }
  const events = text.split('\n').filter(line => line.trim() !== '').map((line) => {
    try {
      return JSON.parse(line)
    } catch {
      return undefined
    }
  }).filter(event => event !== undefined)
  for (const event of events) {
    eventHistogram.set(event.type, (eventHistogram.get(event.type) ?? 0) + 1)
  }
  const session = foldSessionEvents(path, events)
  if (session.turns.length > 0) sessions += 1
  const formatLabel = session.formatVersion === undefined ? 'legacy' : `v${String(session.formatVersion)}`
  formatCounts.set(formatLabel, (formatCounts.get(formatLabel) ?? 0) + 1)
  // A fork's log starts with a copy of its parent's events; those are skipped
  // (the parent's own log already bills them), and the count is reported so the
  // suppression stays visible instead of silent.
  if (session.isSeeded) {
    seededSessions += 1
    inheritedEvents += session.inheritedEvents
  }
  /** Price one billed item with the shipped tables (the same call the host makes). */
  const price = (source, window) => {
    const attributed = source.provider !== undefined && source.model !== undefined
    return estimateTurnUsage(
      {
        uncachedInputTokens: source.uncachedInputTokens,
        outputTokens: source.outputTokens,
        cacheReadTokens: source.cacheReadTokens,
        cacheWriteTokens: source.cacheWriteTokens,
        reasoningTokens: source.reasoningTokens,
        ...(attributed ? { routes: [{ provider: source.provider, model: source.model }] } : {}),
      },
      window,
      window.startMs,
    )
  }
  for (const turn of session.turns) {
    if (turn.attempts === 0) continue
    const estimate = price(turn, { startMs: turn.startedAt, ...(turn.endedAt === undefined ? {} : { endMs: turn.endedAt }) })
    const priced = estimate !== undefined && estimate.unpricedModels.length === 0
    if (!priced) unpriced += 1
    turns.push({
      session: session.title ?? session.id.slice(0, 8),
      subagent: session.delegationDepth > 0,
      at: turn.startedAt,
      tokens: turn.uncachedInputTokens + turn.cacheReadTokens + turn.outputTokens,
      cny: priced ? estimate.cny.total : 0,
      usd: priced ? estimate.usd.total : 0,
    })
  }
  // Compaction calls belong to no reply but are real charges; without them the
  // recompute cannot match the balance (measured: ~$0.2 per compaction at peak).
  for (const compaction of session.compactions) {
    const estimate = price(compaction, { startMs: compaction.at, endMs: compaction.at })
    const priced = estimate !== undefined && estimate.unpricedModels.length === 0
    if (!priced) unpriced += 1
    compactionCount += 1
    turns.push({
      session: `${session.title ?? session.id.slice(0, 8)} [compaction]`,
      subagent: false,
      at: compaction.at,
      tokens: compaction.uncachedInputTokens + compaction.cacheReadTokens + compaction.outputTokens,
      cny: priced ? estimate.cny.total : 0,
      usd: priced ? estimate.usd.total : 0,
    })
  }
}

turns.sort((left, right) => left.at - right.at)
const sum = (rows) => rows.reduce(
  (acc, row) => ({ cny: acc.cny + row.cny, usd: acc.usd + row.usd, tokens: acc.tokens + row.tokens, replies: acc.replies + 1 }),
  { cny: 0, usd: 0, tokens: 0, replies: 0 },
)

console.log(`repo        : ${repo}`)
console.log(`sessions dir: ${sessionsRoot}`)
console.log(`logs found  : ${logs.length} (folded ${sessions} with turns, unreadable ${unreadable})`)
console.log(`formats     : ${formatMix()}`)
console.log(`seeded logs : ${seededSessions} fork(s), ${inheritedEvents} inherited events skipped (their parent bills them)`)
console.log(`replies     : ${turns.length - compactionCount} priced rows + ${compactionCount} compactions, ${unpriced} unpriced\n`)

console.log('=== per session ===')
const bySession = new Map()
for (const turn of turns) {
  const key = `${turn.session}${turn.subagent ? ' [subagent]' : ''}`
  bySession.set(key, [...(bySession.get(key) ?? []), turn])
}
for (const [key, rows] of [...bySession.entries()].sort((a, b) => sum(b[1]).cny - sum(a[1]).cny)) {
  const totals = sum(rows)
  console.log(`  ${key.padEnd(42)} replies=${String(totals.replies).padStart(4)} tokens=${String(totals.tokens).padStart(11)} `
    + `${formatMoney(totals.cny, 'CNY').padStart(10)} ${formatMoney(totals.usd, 'USD').padStart(9)}`)
}

console.log('\n=== per day (turns grouped by turn start) ===')
const byDay = new Map()
for (const turn of turns) {
  const key = new Date(turn.at).toISOString().slice(0, 10)
  byDay.set(key, [...(byDay.get(key) ?? []), turn])
}
for (const [key, rows] of [...byDay.entries()].sort()) {
  const totals = sum(rows)
  console.log(`  ${key}  replies=${String(totals.replies).padStart(4)} ${formatMoney(totals.cny, 'CNY').padStart(10)} ${formatMoney(totals.usd, 'USD').padStart(9)}`)
}

const grand = sum(turns)
console.log(`\nGRAND TOTAL : ${formatMoney(grand.cny, 'CNY')} / ${formatMoney(grand.usd, 'USD')} over ${grand.replies} billed items `
  + `(${grand.replies - compactionCount} replies + ${compactionCount} compactions)`)

if (checkpoints.length > 0) {
  console.log('\n=== cumulative at checkpoints (compare DELTAS with the API balance) ===')
  let previous
  for (const at of checkpoints) {
    const upto = sum(turns.filter(turn => turn.at <= at))
    const delta = previous === undefined ? '' : `  Δ ${formatMoney(upto.usd - previous.usd, 'USD')} / ${formatMoney(upto.cny - previous.cny, 'CNY')}`
    console.log(`  ${localStamp(at)}  cumulative ${formatMoney(upto.usd, 'USD')} / ${formatMoney(upto.cny, 'CNY')}${delta}`)
    previous = upto
  }
}

console.log('\n=== event types present (undercount sources) ===')
for (const type of ['assistant/message', 'assistant/attempt', 'compaction/summary', 'session/title-llm-request', 'request/header', 'llm/retry-started']) {
  console.log(`  ${type.padEnd(28)} ${String(eventHistogram.get(type) ?? 0).padStart(6)}`)
}
