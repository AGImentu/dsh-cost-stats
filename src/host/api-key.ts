/**
 * The only module that ever holds an API key VALUE.
 *
 * No key is stored by this plugin, and none is written to any file by it: a key
 * is either resolved at call time from DSH's own credential service — the same
 * store the model configuration uses — or handed in by the page for exactly one
 * request. Either way it lives in a local variable for as long as one HTTP
 * request takes. That is why the plugin can be published to GitHub without
 * leaking anything: there is no key in the repository, in its settings, or in
 * any request it serves.
 *
 * The rest of this module is deliberately value-free:
 *
 * - `describeApiKey` asks the service "is this configured?" and never receives
 *   the secret, which is what makes the page's key dropdown safe to build;
 * - `rememberApiKey` writes a key the reader typed into DSH's own credential
 *   store (the supported place for it), and reports whether this build can.
 *
 * @module dsh-cost-stats/host/api-key
 */

import type { RememberOutcome } from '../balance.ts'

/** Credential reference (a POSIX-style environment-variable name) to resolve. */
export const API_KEY_REF = 'DEEPSEEK_API_KEY'

/** One resolved credential, narrowed to what this plugin reads. */
export interface CredentialHitLike {
  readonly value?: string
  readonly source?: string
}

/** What `describe(ref)` may answer: a boolean, or an object carrying one. */
type DescribeAnswer = boolean | { readonly configured?: boolean, readonly set?: boolean } | undefined

/** The credential service slice this plugin uses. */
export interface CredentialsLike {
  /**
   * Resolve one credential reference.
   * @param ref - the reference name.
   * @returns the hit (value + source), or undefined when unset.
   */
  resolve(ref: string): Promise<CredentialHitLike | undefined>
  /**
   * Answer whether a reference is configured, WITHOUT resolving its value.
   * @param ref - the reference name.
   * @returns the answer, in whichever shape this build uses.
   */
  describe?(ref: string): Promise<DescribeAnswer> | DescribeAnswer
  /**
   * Store a value under a reference.
   * @param ref - the reference name.
   * @param value - the secret to store.
   * @returns nothing.
   */
  set?(ref: string, value: string): Promise<void> | void
}

/** Why the key could not be read. */
export type ApiKeyFailure = 'credentials-unavailable' | 'no-key'

/** The lookup's outcome: a key to use, or the reason there is none. */
export type ApiKeyResult =
  | { readonly ok: true, readonly key: string }
  | { readonly ok: false, readonly reason: ApiKeyFailure, readonly ref: string }

/** Whether a reference is configured: `undefined` means "this build cannot say". */
export type ApiKeyState = 'set' | 'unset' | 'unknown'

/**
 * The reference shape this plugin accepts.
 *
 * The credential store is a YAML document keyed by these names, and the model
 * configuration writes them the same way, so anything else is a programming
 * error rather than a credential.
 */
const REF_PATTERN = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/

/**
 * Whether a string is a usable credential reference.
 * @param value - candidate.
 * @returns whether it may be handed to the credential service.
 */
export function isApiKeyRef(value: unknown): value is string {
  return typeof value === 'string' && REF_PATTERN.test(value)
}

/**
 * Whether a string is a usable pasted key.
 *
 * Bounded and whitespace-free: a pasted key with a newline in it, or a
 * megabyte of text, is a mistake worth refusing before it reaches a request
 * header (a header with a CR/LF is rejected by the runtime anyway, but the page
 * should hear "that is not a key" instead of a network error).
 * @param value - candidate.
 * @returns whether it may be used as a bearer token.
 */
export function isApiKeyValue(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const trimmed = value.trim()
  if (trimmed.length < 8 || trimmed.length > 512) return false
  // eslint-disable-next-line no-control-regex
  return !/[\s\u0000-\u001f\u007f]/.test(trimmed)
}

/**
 * The context shapes this module probes.
 *
 * cordis resolves services through a Proxy whose `get` trap THROWS
 * `cannot get property "<name>" without inject` for any service the calling
 * plugin did not declare in `inject` (see `vendor/cordis/src/reflect.ts`).
 * 0.8.0 shipped with a bare `ctx.credentials` read and died on exactly that:
 * the page showed "余额查询失败" while the real cause was a thrown lookup.
 * Every access below is therefore both guarded and non-strict.
 */
interface ProbeContext {
  /** cordis's service lookup: `get(name, strict)`, which returns undefined on a miss. */
  get?: (name: string, strict?: boolean) => unknown
  readonly reflect?: { get?: (name: string, strict?: boolean) => unknown }
  readonly credentials?: unknown
}

/** Whether a value looks like the credential service. */
function isCredentials(value: unknown): value is CredentialsLike {
  return value !== null && typeof value === 'object'
    && typeof (value as CredentialsLike).resolve === 'function'
}

/**
 * Reach the credential service without making it a hard dependency.
 *
 * `inject: ['credentials']` would refuse to mount this plugin at all on a host
 * without that provider — the statistics page would vanish because a decoration
 * on it could not read a key. Instead the service is looked up per request, and
 * the lookup prefers cordis's own non-throwing form (`ctx.get(name, false)`);
 * the plain property read stays as a last resort inside a guard, because it is
 * the shape that works on a context that HAS injected the service.
 * @param ctx - host context, possibly carrying the service.
 * @returns the service, or undefined.
 */
export function credentialsOf(ctx: object): CredentialsLike | undefined {
  const probe = ctx as ProbeContext
  const attempts: readonly (() => unknown)[] = [
    () => (typeof probe.get === 'function' ? probe.get.call(ctx, 'credentials', false) : undefined),
    () => (typeof probe.reflect?.get === 'function'
      ? probe.reflect.get.call(probe.reflect, 'credentials', false)
      : undefined),
    () => probe.credentials,
  ]
  for (const attempt of attempts) {
    try {
      const candidate = attempt()
      if (isCredentials(candidate)) return candidate
    } catch {
      // A throwing accessor (an uninjected cordis service) only means "not via
      // this route"; the next attempt may still find the service.
    }
  }
  return undefined
}

/**
 * Resolve one credential.
 *
 * The value is returned to the caller and never logged, echoed, or cached: on
 * failure the caller only learns a reason code, so a credential cannot end up in
 * a log line or an error message.
 * @param ctx - host context carrying the credential service.
 * @param ref - the reference to resolve; defaults to the DeepSeek one.
 * @returns the key, or the reason it is unavailable.
 */
export async function readApiKey(ctx: object, ref: string = API_KEY_REF): Promise<ApiKeyResult> {
  if (!isApiKeyRef(ref)) return { ok: false, reason: 'no-key', ref: API_KEY_REF }
  const credentials = credentialsOf(ctx)
  if (credentials === undefined) return { ok: false, reason: 'credentials-unavailable', ref }
  try {
    const hit = await credentials.resolve(ref)
    const value = hit?.value
    if (typeof value !== 'string' || value.trim().length === 0) return { ok: false, reason: 'no-key', ref }
    return { ok: true, key: value.trim() }
  } catch {
    // A throwing resolver means "cannot read", not "no key": the page says so.
    return { ok: false, reason: 'credentials-unavailable', ref }
  }
}

/**
 * Ask whether a reference is configured, without ever seeing its value.
 *
 * `describe` is the value-free member of the credential family; a build that
 * lacks it answers `'unknown'` and the catalog falls back to its own evidence
 * (presence in the store file, or an environment variable of that name).
 * @param ctx - host context carrying the credential service.
 * @param ref - the reference to ask about.
 * @returns `'set'`, `'unset'`, or `'unknown'` when this build cannot say.
 */
export async function describeApiKey(ctx: object, ref: string): Promise<ApiKeyState> {
  if (!isApiKeyRef(ref)) return 'unset'
  const credentials = credentialsOf(ctx)
  if (credentials?.describe === undefined) return 'unknown'
  try {
    const answer = await credentials.describe(ref)
    if (typeof answer === 'boolean') return answer ? 'set' : 'unset'
    if (answer !== null && typeof answer === 'object') {
      if (typeof answer.configured === 'boolean') return answer.configured ? 'set' : 'unset'
      if (typeof answer.set === 'boolean') return answer.set ? 'set' : 'unset'
    }
    return 'unknown'
  } catch {
    // A throwing describe is not evidence that the key is absent.
    return 'unknown'
  }
}

/**
 * Store a key in DSH's own credential store.
 *
 * This is the supported way for a key the reader typed to become a named
 * credential: it lands in the same private file the model configuration uses,
 * not in this plugin's files, not in the repository lookups, and not in the
 * page. A build without a writable service reports `'unsupported'` so the page
 * can say where to put the key by hand instead.
 * @param ctx - host context carrying the credential service.
 * @param ref - the name to store the key under.
 * @param value - the key itself.
 * @returns what happened.
 */
export async function rememberApiKey(ctx: object, ref: string, value: string): Promise<RememberOutcome> {
  if (!isApiKeyRef(ref) || !isApiKeyValue(value)) return 'failed'
  const credentials = credentialsOf(ctx)
  if (credentials === undefined) return 'unsupported'
  if (typeof credentials.set !== 'function') return 'unsupported'
  try {
    await credentials.set(ref, value.trim())
    return 'saved'
  } catch {
    // The message may quote the argument; it is discarded on purpose.
    return 'failed'
  }
}
