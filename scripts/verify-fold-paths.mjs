#!/usr/bin/env node
/**
 * Fold-path parity check (diagnostics, not part of the plugin's runtime).
 *
 * The fold runs behind two different readers, and they see different inputs:
 *
 * - the **verification script** decodes raw log lines, so the physical header
 *   record is present and the fold finds a fork's inherited seam by itself;
 * - the **host route** gets its events from `sessionPersistence`, which separates
 *   that header record from the event rows — so `isSeeded` is nowhere in the
 *   input and the cut must arrive as `inheritedEventCount` instead.
 *
 * 0.7.1 taught the fold only about the first shape and looked correct here while
 * the page still double-billed every fork. This script replays both shapes over
 * the real logs and fails when they disagree, which is the guard that would have
 * caught it.
 *
 * Usage:
 *   node scripts/verify-fold-paths.mjs
 *
 * @module dsh-cost-stats/scripts/verify-fold-paths
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { zstdDecompressSync } from 'node:zlib'
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

/** Recursively collect the current-format session logs under the DSH home. */
function collectLogs(root) {
  const found = []
  const walk = (dir) => {
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) walk(path)
      else if (/^session\.v3\.jsonl(\.zstd)?$/.test(entry.name)) found.push(path)
    }
  }
  walk(root)
  return found
}

/**
 * The cut the persistence layer reports: how many leading events are inherited.
 *
 * The format derives it from the last `session/end-seed` marker tagged
 * `inherited: true`, which is also how this check derives it.
 * @param body - the event rows, header record excluded.
 * @returns the inherited event count.
 */
function inheritedCut(body) {
  let cut = 0
  body.forEach((event, index) => {
    if (event.type === 'session/end-seed' && event.data?.inherited === true) cut = index + 1
  })
  return cut
}

/**
 * The parts of a fold a difference would change: everything that is billed.
 *
 * `delegationDepth` is deliberately outside the comparison — the route cannot
 * read it from the events (no header record) and takes it from the session
 * snapshot instead, which this script has no snapshot for. It changes the
 * `subagent` badge, never a number.
 */
function shape(session) {
  return JSON.stringify({
    turns: session.turns.map(turn => [
      turn.turn, turn.startedAt, turn.uncachedInputTokens, turn.cacheReadTokens, turn.outputTokens, turn.attempts,
    ]),
    compactions: session.compactions.map(entry => [entry.at, entry.uncachedInputTokens, entry.outputTokens]),
    inheritedEvents: session.inheritedEvents,
  })
}

const dshHome = process.env.DSH_HOME ?? join(homedir(), '.dsh')
const logs = collectLogs(join(dshHome, 'sessions')).sort()

let checked = 0
let mismatches = 0
let seeded = 0
let inherited = 0

for (const path of logs) {
  let events
  try {
    events = decodeLog(readFileSync(path)).split('\n').filter(Boolean).map((line) => {
      try { return JSON.parse(line) } catch { return undefined }
    }).filter(Boolean)
  } catch {
    continue
  }
  if (statSync(path).size < 100_000) continue
  const header = events.find(event => event.type === 'session')
  const body = events.filter(event => event.type !== 'session')
  const cut = inheritedCut(body)

  const raw = foldSessionEvents(path, events)
  const route = foldSessionEvents(path, body, { inheritedEventCount: cut })
  const same = shape(raw) === shape(route)

  checked += 1
  if (header?.isSeeded === true) seeded += 1
  inherited += raw.inheritedEvents
  if (!same) {
    mismatches += 1
    console.error(`DIFF ${path}`)
    console.error(`  raw  : ${shape(raw)}`)
    console.error(`  route: ${shape(route)}`)
  } else {
    console.log(`  ok   ${path.split(/[\\/]/).slice(-2)[0].slice(0, 28).padEnd(30)} `
      + `seeded=${String(header?.isSeeded === true).padEnd(5)} inherited=${String(raw.inheritedEvents).padStart(5)} `
      + `turns=${String(raw.turns.length).padStart(3)} compactions=${raw.compactions.length}`)
  }
}

console.log(`\nlogs checked : ${checked}`)
console.log(`seeded logs  : ${seeded} (${inherited} inherited events skipped)`)
console.log(`mismatches   : ${mismatches}`)
if (mismatches > 0) {
  console.error('\nverify-fold-paths: the two fold entry points disagree — a fork would be billed twice.')
  process.exit(1)
}
console.log('verify-fold-paths: both entry points agree')
