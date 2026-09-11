import { describe, expect, it } from 'vitest'
import {
  computeCost, estimateTurnUsage, FLASH_PLAN, formatMoney, isPeak, PRO_PLAN, PRO_SUNSET_MS, resolvePlan,
} from '../src/pricing.ts'

/** Beijing 2026-09-14 (a Monday) at the given Beijing wall-clock hour. */
const beijing = (hour: number, minute = 0): number =>
  Date.UTC(2026, 8, 14, hour - 8, minute, 0)

describe('resolvePlan', () => {
  const beforeSunset = PRO_SUNSET_MS - 60_000
  const afterSunset = PRO_SUNSET_MS + 60_000

  it('bills the canonical Flash id as Flash', () => {
    const resolved = resolvePlan('deepseek-official', 'deepseek-flash', beforeSunset)
    expect(resolved?.plan.id).toBe('flash')
    expect(resolved?.aliased).toBe(false)
  })

  it('bills retired Flash ids as Flash and marks them aliased', () => {
    for (const model of ['deepseek-v4-flash', 'deepseek-v4-flash-vision-exp']) {
      const resolved = resolvePlan('deepseek-official', model, beforeSunset)
      expect(resolved?.plan.id).toBe('flash')
      expect(resolved?.aliased).toBe(true)
    }
  })

  it('bills v4-pro as Pro until the sunset instant, then as Flash', () => {
    expect(resolvePlan('deepseek-official', 'deepseek-v4-pro', beforeSunset)).toMatchObject({
      plan: { id: 'pro' }, aliased: false,
    })
    expect(resolvePlan('deepseek-official', 'deepseek-v4-pro', afterSunset)).toMatchObject({
      plan: { id: 'flash' }, aliased: true,
    })
  })

  it('leaves unknown providers and models unpriced', () => {
    expect(resolvePlan('openrouter', 'deepseek-flash', beforeSunset)).toBeUndefined()
    expect(resolvePlan('deepseek-official', 'gpt-5', beforeSunset)).toBeUndefined()
  })
})

describe('isPeak', () => {
  it('applies the published Beijing windows on weekdays', () => {
    expect(isPeak(beijing(8, 59))).toBe(false)
    expect(isPeak(beijing(9))).toBe(true)
    expect(isPeak(beijing(11, 59))).toBe(true)
    // Window ends are exclusive: 12:00 is already off-peak.
    expect(isPeak(beijing(12))).toBe(false)
    expect(isPeak(beijing(14))).toBe(true)
    expect(isPeak(beijing(17, 59))).toBe(true)
    expect(isPeak(beijing(18))).toBe(false)
  })

  it('treats weekends as off-peak', () => {
    const saturday = Date.UTC(2026, 8, 12, 2, 0, 0) // Beijing Saturday 10:00
    expect(isPeak(saturday)).toBe(false)
  })

  it('is independent of the host timezone', () => {
    const instant = beijing(10)
    expect(isPeak(instant)).toBe(true)
  })
})

describe('computeCost', () => {
  // The real usage panel numbers from a long session (off-peak Flash).
  const usage = {
    uncachedInputTokens: 219_568,
    cacheReadTokens: 7_128_576,
    outputTokens: 86_687,
    reasoningTokens: 66_067,
  }

  it('itemizes the three buckets at the published off-peak CNY rates', () => {
    const cost = computeCost(usage, FLASH_PLAN, false, 'CNY')
    expect(cost.cacheHitCost).toBeCloseTo(0.14257152, 8)
    expect(cost.cacheMissCost).toBeCloseTo(0.219568, 8)
    expect(cost.outputCost).toBeCloseTo(0.346748, 8)
    expect(cost.total).toBeCloseTo(0.70888752, 8)
  })

  it('itemizes the same buckets at the published off-peak USD rates', () => {
    const cost = computeCost(usage, FLASH_PLAN, false, 'USD')
    expect(cost.total).toBeCloseTo(0.1063331, 7)
  })

  it('doubles at peak and switches to the Pro table', () => {
    const offPeak = computeCost(usage, FLASH_PLAN, false, 'CNY').total
    expect(computeCost(usage, FLASH_PLAN, true, 'CNY').total).toBeCloseTo(offPeak * 2, 8)
    // Pro is not a flat multiple of Flash: cache hit is 7.5x, uncached input
    // 4.5x and output 3.375x, so the blended total is asserted directly.
    expect(computeCost(usage, PRO_PLAN, false, 'CNY').total).toBeCloseTo(3.2276169, 7)
  })

  it('treats a missing cache bucket as zero rather than NaN', () => {
    const cost = computeCost({ uncachedInputTokens: 1_000_000, outputTokens: 0 }, FLASH_PLAN, false, 'CNY')
    expect(cost.total).toBeCloseTo(1, 8)
  })
})

describe('estimateTurnUsage', () => {
  const usage = {
    uncachedInputTokens: 1_000_000,
    outputTokens: 1_000_000,
    totalTokens: 2_000_000,
    routes: [{ provider: 'deepseek-official', model: 'deepseek-flash' }],
  }

  it('returns undefined without route attribution (never a guess)', () => {
    expect(estimateTurnUsage({ uncachedInputTokens: 1, outputTokens: 1 }, {})).toBeUndefined()
  })

  it('prices a plain off-peak turn in both currencies', () => {
    const estimate = estimateTurnUsage(usage, { startMs: beijing(13) })
    expect(estimate?.peak).toBe(false)
    expect(estimate?.cny.total).toBeCloseTo(5, 8)
    expect(estimate?.usd.total).toBeCloseTo(0.75, 8)
    expect(estimate?.unpricedModels).toEqual([])
    expect(estimate?.mixed).toBe(false)
  })

  it('flags a turn that crosses a peak boundary and prices it at its start', () => {
    const estimate = estimateTurnUsage(usage, { startMs: beijing(11, 59), endMs: beijing(12, 5) })
    expect(estimate?.peak).toBe(true)
    expect(estimate?.straddlesWindow).toBe(true)
    expect(estimate?.cny.total).toBeCloseTo(10, 8)
  })

  it('prices a mixed-model turn with the costliest plan and flags it', () => {
    // Beijing 08:00 on 2026-09-14 is off-peak AND before the 12:00 Pro sunset,
    // so the two routes genuinely bill under two different plans. With 1M
    // uncached input plus 1M output, the Pro table gives 4.5 + 13.5 = 18.
    const estimate = estimateTurnUsage({
      ...usage,
      routes: [
        { provider: 'deepseek-official', model: 'deepseek-flash' },
        { provider: 'deepseek-official', model: 'deepseek-v4-pro' },
      ],
    }, { startMs: beijing(8) })
    expect(estimate?.mixed).toBe(true)
    expect(estimate?.plan.id).toBe('pro')
    expect(estimate?.cny.total).toBeCloseTo(18, 8)
  })

  it('reports unpriced routes instead of a fabricated zero', () => {
    const estimate = estimateTurnUsage({
      ...usage,
      routes: [{ provider: 'openrouter', model: 'llama' }],
    }, { startMs: beijing(13) })
    expect(estimate?.unpricedModels).toEqual(['llama'])
  })
})

describe('formatMoney', () => {
  it('keeps sub-cent amounts meaningful', () => {
    expect(formatMoney(0, 'CNY')).toBe('¥0')
    expect(formatMoney(0.00005, 'CNY')).toBe('<¥0.0001')
    expect(formatMoney(0.70888752, 'CNY')).toBe('¥0.709')
    expect(formatMoney(0.0031, 'USD')).toBe('$0.0031')
    expect(formatMoney(12.3456, 'CNY')).toBe('¥12.35')
  })
})
