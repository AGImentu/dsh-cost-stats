/**
 * Reaching DSH's locale service, and surviving it not being reachable.
 *
 * Two lessons are encoded here, both learned the hard way:
 *
 * 1. **A service that is not in `inject` is not readable by a plain lookup.**
 *    cordis resolves services through a Proxy, and `ctx.get(name)` is the strict
 *    form: on this host it answers `undefined` (and on others it throws) for a
 *    service the caller did not declare. The host half of this plugin hit the
 *    same wall with `credentials` in 0.8.0; the fix there — and here — is the
 *    non-strict `ctx.get(name, false)`, with `ctx.reflect.get` and a guarded
 *    property read as fallbacks.
 * 2. **The dictionaries are an enhancement, not a dependency.** If the service
 *    cannot be reached, or is reached but does not know this namespace, the
 *    framework's translator answers with the KEY ITSELF — the settings page then
 *    reads `stats.title` / `stats.key.query` on screen. `withFallback` wraps the
 *    seat's translator so that outcome degrades to this plugin's own Chinese
 *    dictionary instead: readable UI, no raw identifiers.
 *
 * @module dsh-cost-stats/client/locale-service
 */

import type { ClientContextLike, LocaleServiceLike, Translator } from './contract.ts'
import { fallbackTranslator } from './locales.ts'

/**
 * The context shapes probed below. Every read is guarded: a cordis proxy can
 * throw on a property the plugin did not inject.
 */
interface ProbeContext {
  get?: (name: string, strict?: boolean) => unknown
  readonly reflect?: { get?: (name: string, strict?: boolean) => unknown }
  readonly locale?: unknown
}

/** Whether a value looks like the locale service. */
function isLocaleService(value: unknown): value is LocaleServiceLike {
  return value !== null && typeof value === 'object'
    && typeof (value as LocaleServiceLike).register === 'function'
}

/**
 * Reach the locale service without making it a hard dependency.
 * @param ctx - browser-side cordis context.
 * @returns the service, or undefined when this host cannot offer it.
 */
export function localeOf(ctx: object): LocaleServiceLike | undefined {
  const probe = ctx as ProbeContext
  const attempts: readonly (() => unknown)[] = [
    // The non-strict form: `undefined` on a miss instead of a thrown lookup.
    () => (typeof probe.get === 'function' ? probe.get.call(ctx, 'locale', false) : undefined),
    () => (typeof probe.reflect?.get === 'function'
      ? probe.reflect.get.call(probe.reflect, 'locale', false)
      : undefined),
    // A context that HAS injected the service exposes it as a plain property.
    () => probe.locale,
  ]
  for (const attempt of attempts) {
    try {
      const candidate = attempt()
      if (isLocaleService(candidate)) return candidate
    } catch {
      // A throwing accessor only means "not via this route"; try the next one.
    }
  }
  return undefined
}

/**
 * Wrap the locale seat's translator so an unknown key falls back to Chinese.
 *
 * The framework's translator returns the key when it has no entry — either
 * because this plugin's dictionaries never registered, or because a key was
 * added after them. Detecting "the answer IS the question" is what turns that
 * from `stats.title` on screen into 「费用统计」.
 * @param t - the seat's translator, when the host passed one.
 * @returns a translator that always says something readable.
 */
export function withFallback(t: Translator | undefined): Translator {
  if (t === undefined) return fallbackTranslator
  return (key, vars) => {
    const translated = t(key, vars)
    if (typeof translated !== 'string' || translated === '' || translated === key) {
      return fallbackTranslator(key, vars)
    }
    return translated
  }
}

/**
 * The active locale id, tolerating a service that cannot report one.
 * @param locale - the service, when one was found.
 * @returns the id, or undefined.
 */
export function activeLocaleOf(locale: LocaleServiceLike | undefined): string | undefined {
  try {
    return locale?.getSnapshot?.().active
  } catch {
    return undefined
  }
}
