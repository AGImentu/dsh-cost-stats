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
 * Reach the credential service without making it a hard dependency.
 *
 * `inject: ['credentials']` would refuse to mount this plugin at all on a host
 * without that provider — the statistics page would vanish because a decoration
 * on it could not read a key. Reading the service lazily keeps the page working
 * and degrades the balance readout instead.
 * @param ctx - host context, possibly carrying the service.
 * @returns the service, or undefined.
 */
export function credentialsOf(ctx: object): CredentialsLike | undefined {
  const direct = (ctx as { credentials?: CredentialsLike }).credentials
  if (direct !== undefined && typeof direct.resolve === 'function') return direct
  const get = (ctx as { get?: (name: string) => unknown }).get
  if (typeof get !== 'function') return undefined
  const viaGet = get.call(ctx, 'credentials')
  if (viaGet !== undefined && typeof (viaGet as CredentialsLike).resolve === 'function') {
    return viaGet as CredentialsLike
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
