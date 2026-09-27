/**
 * The only module that ever holds the API key.
 *
 * The key is NOT stored by this plugin, not passed in by the page, and not
 * written to any file: it is resolved at call time from DSH's own credential
 * service — the same `DEEPSEEK_API_KEY` the model configuration uses — and lives
 * in a local variable for exactly as long as one HTTP request takes. That is why
 * the plugin can be published to GitHub without leaking anything: there is no
 * key in the repository, in its settings, or in any request it serves.
 *
 * @module dsh-cost-stats/host/api-key
 */

/** Credential reference (a POSIX-style environment-variable name) to resolve. */
export const API_KEY_REF = 'DEEPSEEK_API_KEY'

/** One resolved credential, narrowed to what this plugin reads. */
export interface CredentialHitLike {
  readonly value?: string
  readonly source?: string
}

/** The credential service slice this plugin uses. */
export interface CredentialsLike {
  /**
   * Resolve one credential reference.
   * @param ref - the reference name.
   * @returns the hit (value + source), or undefined when unset.
   */
  resolve(ref: string): Promise<CredentialHitLike | undefined>
}

/** Why the key could not be read. */
export type ApiKeyFailure = 'credentials-unavailable' | 'no-key'

/** The lookup's outcome: a key to use, or the reason there is none. */
export type ApiKeyResult =
  | { readonly ok: true, readonly key: string }
  | { readonly ok: false, readonly reason: ApiKeyFailure }

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
 * Resolve the DeepSeek API key.
 *
 * The value is returned to the caller and never logged, echoed, or cached: on
 * failure the caller only learns a reason code, so a credential cannot end up in
 * a log line or an error message.
 * @param ctx - host context carrying the credential service.
 * @returns the key, or the reason it is unavailable.
 */
export async function readApiKey(ctx: object): Promise<ApiKeyResult> {
  const credentials = credentialsOf(ctx)
  if (credentials === undefined) return { ok: false, reason: 'credentials-unavailable' }
  try {
    const hit = await credentials.resolve(API_KEY_REF)
    const value = hit?.value
    if (typeof value !== 'string' || value.trim().length === 0) return { ok: false, reason: 'no-key' }
    return { ok: true, key: value.trim() }
  } catch {
    // A throwing resolver means "cannot read", not "no key": the page says so.
    return { ok: false, reason: 'credentials-unavailable' }
  }
}
