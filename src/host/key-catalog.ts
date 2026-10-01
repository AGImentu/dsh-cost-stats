/**
 * Which API keys this harness could query — names only, never values.
 *
 * The page's key dropdown has to offer the same keys the reader sees in
 * DSH's own model settings, and it has to do that without this plugin ever
 * holding a secret. Both halves of that requirement are met here:
 *
 * 1. **Discovery is textual and shallow.** Candidate names come from DSH's local
 *    credential store (the `refs:` block of the private YAML, which maps NAMES
 *    to values — only the names are read) and from every `apiKeyEnv:` a profile
 *    configuration names. Configuration files hold reference names, never
 *    secrets, so reading them is safe.
 * 2. **Configuration state comes from the service, not from the file.** For each
 *    candidate, `describeApiKey` asks DSH whether it is configured and — by
 *    design — is never answered with a value. A build without `describe` falls
 *    back to the textual evidence above.
 *
 * Everything that touches text is a pure function, so the parsers are unit
 * tested against real file shapes instead of against hopes.
 *
 * @module dsh-cost-stats/host/key-catalog
 */

import { readFile, readdir, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { API_KEY_REF, credentialsOf, describeApiKey, isApiKeyRef } from './api-key.ts'
import type { KeyRefInfo, KeyRefOrigin, KeysPayload } from '../balance.ts'

/** Structural keys of the credential store, never credentials themselves. */
const STORE_STRUCTURE = new Set(['version', 'records', 'refs', 'kind', 'payload', 'id', 'secret', 'token', 'issuer'])

/** Refuse absurd inputs rather than reading a user's whole disk into memory. */
const MAX_FILE_BYTES = 256 * 1024

/** How many configuration files one profile may contribute. */
const MAX_CONFIG_FILES = 8

/**
 * Names for references this plugin knows by contract rather than by file.
 *
 * `DEEPSEEK_API_KEY` is declared by the DeepSeek provider that ships inside the
 * harness, whose configuration is not a file on disk — so no scan can discover
 * the name 「设置 → 模型」 shows for it. This map is that one fact, kept in one
 * place; every other entry takes its label from the profile configuration.
 */
const DEFAULT_LABELS: Readonly<Record<string, string>> = {
  DEEPSEEK_API_KEY: 'DeepSeek',
}

/**
 * The `refs:` block of the credential store: the names that ARE credentials.
 *
 * The store is a small YAML document (`version`, `records`, then `refs`), and
 * only the last block holds plain API keys. Parsing is line-based on purpose:
 * pulling in a YAML parser for one flat block would add a runtime dependency to
 * a plugin whose whole selling point is that it has none.
 * @param text - the store file's contents.
 * @returns the reference names, in file order, deduplicated.
 */
export function refsFromCredentialStore(text: string): string[] {
  const lines = text.split(/\r?\n/)
  const found: string[] = []
  let blockIndent: number | undefined
  /** Whether a `refs:` block was seen at all. */
  let sawBlock = false

  const remember = (name: string): void => {
    if (isApiKeyRef(name) && !found.includes(name)) found.push(name)
  }

  for (const line of lines) {
    const indent = /^[ \t]*/.exec(line)?.[0].length ?? 0
    const trimmed = line.trim()
    if (blockIndent !== undefined) {
      if (trimmed === '' || trimmed.startsWith('#')) continue
      if (indent <= blockIndent) {
        blockIndent = undefined
        continue
      }
    }
    const match = /^([ \t]*)(?:"([^"]+)"|'([^']+)'|([A-Za-z_][\w.-]*))\s*:(.*)$/.exec(line)
    if (match === null) continue
    const name = match[2] ?? match[3] ?? match[4] ?? ''
    if (blockIndent !== undefined) {
      remember(name)
      continue
    }
    if (name === 'refs' && (match[5] ?? '').trim() === '') {
      blockIndent = indent
      sawBlock = true
      continue
    }
    // A store without a `refs:` block is a flat name → value map; only
    // top-level entries count, and the structural keys never are credentials.
    if (!sawBlock && indent === 0 && !STORE_STRUCTURE.has(name)) remember(name)
  }
  return found
}

/** One provider's declared key reference. */
export interface ConfigKeyRef {
  /** The `apiKeyEnv` name the provider reads its key from. */
  readonly ref: string
  /** The provider id that declared it (`mixtoken`), when one could be found. */
  readonly provider?: string
  /** The provider's `displayName` — the name 「设置 → 模型」 shows for it. */
  readonly label?: string
}

/**
 * The `apiKeyEnv:` names a profile configuration declares.
 *
 * These are the keys the reader sees as "the key of provider X" in the model
 * settings, which is exactly the list they expect in this page's dropdown. The
 * enclosing provider block is recovered by walking up to the nearest shallower
 * key, and its `displayName` (read from inside that block) becomes the entry's
 * label — so the dropdown carries the same wording the model settings do,
 * including a provider whose display name is a base URL.
 * @param text - one configuration file's contents.
 * @returns the declared references, in file order, deduplicated.
 */
export function refsFromConfig(text: string): ConfigKeyRef[] {
  const lines = text.split(/\r?\n/)
  const found: ConfigKeyRef[] = []
  const seen = new Set<string>()

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? ''
    const match = /^([ \t]*)apiKeyEnv\s*:\s*(?:"([^"]+)"|'([^']+)'|([A-Za-z_][\w.-]*))/.exec(line)
    if (match === null) continue
    const ref = match[2] ?? match[3] ?? match[4] ?? ''
    if (!isApiKeyRef(ref) || seen.has(ref)) continue
    seen.add(ref)

    const indent = (match[1] ?? '').length
    let provider: string | undefined
    let blockStart = -1
    let providerIndent = -1
    for (let above = index - 1; above >= 0; above -= 1) {
      const candidate = lines[above] ?? ''
      const outer = /^([ \t]*)([A-Za-z_][\w.-]*)\s*:\s*$/.exec(candidate)
      if (outer === null) continue
      if ((outer[1] ?? '').length >= indent) continue
      provider = outer[2]
      blockStart = above
      providerIndent = (outer[1] ?? '').length
      break
    }

    // `displayName` lives in the same block as `apiKeyEnv`; the block ends where
    // the indentation returns to the provider's own level.
    let label: string | undefined
    if (blockStart >= 0) {
      for (let below = blockStart + 1; below < lines.length; below += 1) {
        const inner = lines[below] ?? ''
        const innerIndent = /^[ \t]*/.exec(inner)?.[0].length ?? 0
        if (inner.trim() !== '' && innerIndent <= providerIndent) break
        const named = /^[ \t]*displayName\s*:\s*(?:"([^"]*)"|'([^']*)'|(.+?))\s*$/.exec(inner)
        if (named === null) continue
        const value = (named[1] ?? named[2] ?? named[3] ?? '').trim()
        if (value !== '') label = value
        break
      }
    }

    found.push({
      ref,
      ...(provider === undefined ? {} : { provider }),
      ...(label === undefined ? {} : { label }),
    })
  }
  return found
}

/** Everything the catalog knows before it asks the credential service. */
export interface CatalogInput {
  /** The harness default reference. */
  readonly defaultRef: string
  /** Names found in the credential store. */
  readonly storeRefs: readonly string[]
  /** References declared by profile configurations. */
  readonly configRefs: readonly ConfigKeyRef[]
  /** Whether an environment variable of that name carries a value. */
  readonly envHas: (ref: string) => boolean
  /** The service's answer per reference, when it can answer. */
  readonly state: (ref: string) => 'set' | 'unset' | 'unknown'
}

/**
 * Merge every source into the list the page renders.
 *
 * The default reference always comes first — it is what the harness itself uses
 * to talk to DeepSeek, so it is the one a reader almost always wants — then the
 * remaining names in a stable order (store first, then configuration). A name
 * seen twice keeps its earliest, most authoritative origin.
 * @param input - the collected evidence.
 * @returns the catalog rows.
 */
export function buildCatalog(input: CatalogInput): KeyRefInfo[] {
  const rows: KeyRefInfo[] = []
  const stateOf = (ref: string): boolean => {
    const state = input.state(ref)
    return state === 'unknown'
      // No `describe` on this build: fall back to the evidence we do have.
      ? input.storeRefs.includes(ref) || input.envHas(ref)
      : state === 'set'
  }
  const add = (ref: string, origin: KeyRefOrigin, provider?: string, label?: string): void => {
    if (!isApiKeyRef(ref)) return
    // A name the harness's own model configuration owns but no readable file
    // declares: the provider's shipped name is what 「设置 → 模型」 shows.
    const called = label ?? DEFAULT_LABELS[ref]
    const existing = rows.find(row => row.ref === ref)
    if (existing !== undefined) {
      // A name seen twice keeps its earliest (most authoritative) origin, but a
      // provider or label discovered later still helps the reader recognize it.
      const provider2 = existing.provider ?? provider
      const label2 = existing.label ?? called
      if (provider2 !== existing.provider || label2 !== existing.label) {
        rows[rows.indexOf(existing)] = {
          ...existing,
          ...(provider2 === undefined ? {} : { provider: provider2 }),
          ...(label2 === undefined ? {} : { label: label2 }),
        }
      }
      return
    }
    rows.push({
      ref,
      configured: stateOf(ref),
      origin,
      ...(provider === undefined ? {} : { provider }),
      ...(called === undefined ? {} : { label: called }),
    })
  }

  add(input.defaultRef, 'default')
  for (const ref of input.storeRefs) add(ref, 'store')
  for (const entry of input.configRefs) add(entry.ref, 'config', entry.provider, entry.label)
  return rows
}

/** The resolved location of DSH's private files. */
function dshPaths(): { home: string, store: string, profiles: string } {
  const home = process.env.DSH_HOME ?? join(homedir(), '.dsh')
  return { home, store: join(home, '.credentials.yaml'), profiles: join(home, 'profiles') }
}

/**
 * Read a small text file, tolerating every failure.
 * @param path - absolute path.
 * @returns the text, or undefined when unreadable or oversized.
 */
async function readSmallFile(path: string): Promise<string | undefined> {
  try {
    const info = await stat(path)
    if (!info.isFile() || info.size > MAX_FILE_BYTES) return undefined
    return await readFile(path, 'utf8')
  } catch {
    return undefined
  }
}

/**
 * Gather the evidence the catalog is built from.
 *
 * Failures are silent by design: every source is a convenience, and a harness
 * whose profile directory cannot be listed should still offer its default key.
 * @returns the store names and the configuration references.
 */
async function gatherEvidence(): Promise<{ storeRefs: string[], configRefs: ConfigKeyRef[] }> {
  const paths = dshPaths()
  const storeText = await readSmallFile(paths.store)
  const configRefs: ConfigKeyRef[] = []

  const profileDirs = await readdir(paths.profiles, { withFileTypes: true }).catch(() => [])
  for (const entry of profileDirs) {
    if (!entry.isDirectory()) continue
    let names: string[] = []
    try {
      names = await readdir(join(paths.profiles, entry.name))
    } catch {
      continue
    }
    const yaml = names
      .filter(name => name.endsWith('.yml') || name.endsWith('.yaml'))
      .slice(0, MAX_CONFIG_FILES)
    for (const name of yaml) {
      const text = await readSmallFile(join(paths.profiles, entry.name, name))
      if (text === undefined) continue
      configRefs.push(...refsFromConfig(text))
    }
  }
  // The harness-wide settings file can name a provider too.
  const settings = await readSmallFile(join(paths.home, 'settings.yaml'))
  if (settings !== undefined) configRefs.push(...refsFromConfig(settings))

  return { storeRefs: storeText === undefined ? [] : refsFromCredentialStore(storeText), configRefs }
}

/**
 * Build the page's key catalog for this harness.
 *
 * The result never contains a value, by construction: nothing here ever resolves
 * a credential. `canRemember` tells the page whether the "store this key in DSH"
 * checkbox can do anything on this build.
 * @param ctx - host context carrying the credential service.
 * @returns the `GET /cost-stats/keys` payload.
 */
export async function keysPayload(ctx: object): Promise<KeysPayload> {
  const evidence = await gatherEvidence()
  const caps = credentialsOf(ctx)
  const asked = new Map<string, 'set' | 'unset' | 'unknown'>()
  // `buildCatalog` is a pure function, so every answer is collected first and
  // then handed to it as a lookup.
  const state = (ref: string): 'set' | 'unset' | 'unknown' => asked.get(ref) ?? 'unknown'
  // Resolve the per-reference state once, up front, so `buildCatalog` can stay pure.
  const candidates = new Set<string>([API_KEY_REF, ...evidence.storeRefs, ...evidence.configRefs.map(entry => entry.ref)])
  await Promise.all([...candidates].map(async (ref) => {
    asked.set(ref, await describeApiKey(ctx, ref))
  }))

  const refs = buildCatalog({
    defaultRef: API_KEY_REF,
    storeRefs: evidence.storeRefs,
    configRefs: evidence.configRefs,
    envHas: ref => (process.env[ref] ?? '').length > 0,
    state,
  })
  return {
    ok: true,
    default: API_KEY_REF,
    refs,
    canRemember: typeof caps?.set === 'function',
  }
}
