import { describe, expect, it, vi } from 'vitest'
import { activeLocaleOf, localeOf, withFallback } from '../src/client/locale-service.ts'
import { fallbackTranslator, zh } from '../src/client/locales.ts'
import type { LocaleServiceLike, Translator } from '../src/client/contract.ts'

/** A locale service that records what it was asked to register. */
function service(): LocaleServiceLike & { registered: string[] } {
  const registered: string[] = []
  return {
    registered,
    register: (ns) => { registered.push(ns); return () => {} },
    getSnapshot: () => ({ active: 'zh-CN' }),
  }
}

describe('localeOf', () => {
  it('passes strict=false, so a service the plugin did not inject is reachable', () => {
    const locale = service()
    const calls: unknown[][] = []
    const ctx = {
      get: (...args: unknown[]) => {
        calls.push(args)
        // The strict form answers nothing; only the non-strict form resolves it.
        return args[1] === false ? locale : undefined
      },
    }
    expect(localeOf(ctx)).toBe(locale)
    expect(calls[0]).toEqual(['locale', false])
  })

  it('never asks the strict form, which on some cordis builds throws', () => {
    const locale = service()
    const ctx = {
      get: (name: string, strict?: boolean) => {
        if (strict !== false) throw new Error('cannot get property "locale" without inject')
        return locale
      },
    }
    expect(localeOf(ctx)).toBe(locale)
  })

  it('falls back to ctx.reflect.get, then to a bare property', () => {
    const locale = service()
    const reflect = { get: (name: string, strict?: boolean) => (name === 'locale' && strict === false ? locale : undefined) }
    expect(localeOf({ reflect })).toBe(locale)
    expect(localeOf({ locale })).toBe(locale)
  })

  it('answers undefined instead of throwing on a hostile context', () => {
    const throwing = new Proxy({}, {
      get: (_target, prop) => {
        if (prop === 'get' || prop === 'reflect') return undefined
        throw new Error(`cannot get property "${String(prop)}" without inject`)
      },
    })
    expect(localeOf(throwing)).toBeUndefined()
    expect(localeOf({})).toBeUndefined()
    expect(localeOf({ get: () => ({ register: 'not a function' }) })).toBeUndefined()
  })

  it('reports the active locale, and gives up quietly when it cannot', () => {
    expect(activeLocaleOf(service())).toBe('zh-CN')
    expect(activeLocaleOf(undefined)).toBeUndefined()
    expect(activeLocaleOf({ register: () => () => {}, getSnapshot: () => { throw new Error('nope') } })).toBeUndefined()
  })
})

describe('withFallback', () => {
  it('is the bundled Chinese dictionary when the seat passed no translator', () => {
    const tr = withFallback(undefined)
    expect(tr('stats.title')).toBe(zh['stats.title'])
    expect(tr('stats.balance.label', { amount: '¥5.00' })).toBe(zh['stats.balance.label']?.replace('{amount}', '¥5.00'))
  })

  it('replaces a translator that echoes the key — the raw-key symptom on screen', () => {
    // This is exactly what DSH's translator does for a namespace it does not
    // know: the settings page read `stats.title` / `stats.key.query` instead of
    // 费用统计 / 查询余额.
    const echo: Translator = (key) => key
    const tr = withFallback(echo)
    expect(tr('stats.title')).toBe('费用统计')
    expect(tr('stats.key.query')).toBe('查询余额')
    expect(tr('stats.key.label')).toBe('模型')
  })

  it('treats an empty answer as a miss too', () => {
    expect(withFallback(() => '')('stats.title')).toBe('费用统计')
    expect(withFallback(() => undefined as unknown as string)('stats.subtitle')).toBe(zh['stats.subtitle'])
  })

  it('keeps a real translation, substitutions and all', () => {
    const real: Translator = (key, vars) => (key === 'stats.total' ? `合计-${String(vars?.n)}` : key)
    const tr = withFallback(real)
    expect(tr('stats.total', { n: 3 })).toBe('合计-3')
    // …and still rescues the keys that translator does not know.
    expect(tr('stats.key.query')).toBe('查询余额')
  })

  it('passes the key through untouched when even the fallback has nothing', () => {
    expect(withFallback(undefined)('stats.not.a.key')).toBe('stats.not.a.key')
  })

  it('never invents a string from a throwing translator', () => {
    const tr = withFallback(vi.fn(() => { throw new Error('boom') }))
    // The throw is the caller's problem (the error boundary's), not silently
    // swallowed into a half-translated page.
    expect(() => tr('stats.title')).toThrow()
  })
})
