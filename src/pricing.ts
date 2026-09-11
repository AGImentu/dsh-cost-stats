/**
 * Cost model for one assistant turn: pure, dependency-free, and shared by the
 * browser chip and the test suite.
 *
 * Prices are the official published DeepSeek API rates (元 or $ per 1M tokens).
 * The two published tables are independent values, not a converted pair, so both
 * are carried verbatim:
 *
 * - CNY (platform: api-docs.deepseek.com/zh-cn/quick_start/pricing)
 * - USD (platform: api-docs.deepseek.com/quick_start/pricing)
 *
 * Sources of truth for the route → plan mapping:
 * - `deepseek-flash` is DeepSeek-V4.1-Flash (the canonical id).
 * - `deepseek-v4-flash` and `deepseek-v4-flash-vision-exp` are retired ids still
 *   accepted by the API; their requests are served by V4.1-Flash and billed at
 *   the Flash price.
 * - `deepseek-v4-pro` is DeepSeek-V4-Pro-0813 until 2026-09-14 12:00 Beijing,
 *   and routed to V4.1-Flash (Flash price) from that instant onward, until a
 *   future V4.1 Pro ships.
 *
 * @module dsh-cost-stats/pricing
 */

/** Currencies the official tables are published in. */
export type Currency = 'CNY' | 'USD'

/** Rates for one billing window, in `currency` per 1M tokens. */
export interface PriceTier {
  /** Input tokens served from the provider's prompt cache. */
  readonly cacheHit: number
  /** Input tokens not served from cache (cache writes are billed here too). */
  readonly cacheMiss: number
  /** Output tokens, reasoning tokens included. */
  readonly output: number
}

/** Off-peak and peak rates of one plan. */
export interface PriceBand {
  readonly offPeak: PriceTier
  readonly peak: PriceTier
}

/** One billable model: the rates it is charged at, in both published currencies. */
export interface PricePlan {
  /** Stable plan id used by the panel and by tests. */
  readonly id: 'flash' | 'pro'
  /** Billed model name (what the invoice calls it). */
  readonly label: string
  readonly cny: PriceBand
  readonly usd: PriceBand
}

/** DeepSeek-V4.1-Flash — the current Flash model. */
export const FLASH_PLAN: PricePlan = {
  id: 'flash',
  label: 'DeepSeek-V4.1-Flash',
  cny: {
    offPeak: { cacheHit: 0.02, cacheMiss: 1, output: 4 },
    peak: { cacheHit: 0.04, cacheMiss: 2, output: 8 },
  },
  usd: {
    offPeak: { cacheHit: 0.003, cacheMiss: 0.15, output: 0.6 },
    peak: { cacheHit: 0.006, cacheMiss: 0.3, output: 1.2 },
  },
}

/** DeepSeek-V4-Pro-0813 — scheduled to be routed to Flash from 2026-09-14 12:00 Beijing. */
export const PRO_PLAN: PricePlan = {
  id: 'pro',
  label: 'DeepSeek-V4-Pro-0813',
  cny: {
    offPeak: { cacheHit: 0.15, cacheMiss: 4.5, output: 13.5 },
    peak: { cacheHit: 0.3, cacheMiss: 9, output: 27 },
  },
  usd: {
    offPeak: { cacheHit: 0.022, cacheMiss: 0.66, output: 1.98 },
    peak: { cacheHit: 0.044, cacheMiss: 1.32, output: 3.96 },
  },
}

/** Every plan this build knows how to price. */
export const PRICE_PLANS: readonly PricePlan[] = [FLASH_PLAN, PRO_PLAN]

/**
 * The instant `deepseek-v4-pro` stops being billed as V4 Pro:
 * 2026-09-14 12:00 Beijing (UTC+8) = 2026-09-14 04:00 UTC.
 */
export const PRO_SUNSET_MS = Date.parse('2026-09-14T04:00:00Z')

/** Model ids billed at the Flash price. */
const FLASH_MODELS: readonly string[] = [
  'deepseek-flash',
  'deepseek-v4-flash',
  'deepseek-v4-flash-vision-exp',
]

/** Model ids billed at the Pro price until {@link PRO_SUNSET_MS}. */
const PRO_MODELS: readonly string[] = ['deepseek-v4-pro']

/** How one requested route resolves to a billable plan. */
export interface PlanResolution {
  /** The plan the request is billed under for the resolved instant. */
  readonly plan: PricePlan
  /** The model id the request asked for, verbatim. */
  readonly requestedModel: string
  /** Whether the billed model differs from the requested id (retired alias / reroute). */
  readonly aliased: boolean
}

/**
 * Whether a provider id belongs to the official DeepSeek routes these prices
 * describe. Provider ids seen in DSH: `deepseek-official` (the shipped model
 * catalog) and any user-defined `deepseek*` alias of the same adapter.
 * @param provider - provider id from the turn's route attribution.
 * @returns whether the official price table applies.
 */
export function isPricedProvider(provider: string): boolean {
  return /deepseek/i.test(provider)
}

/**
 * Resolve one billed route to its plan at a given instant.
 * @param provider - provider id of the attempt.
 * @param model - model id of the attempt, as requested.
 * @param atMs - epoch ms the attempt is billed at (the turn's start time).
 * @returns the resolution, or `undefined` for a model with no published price.
 */
export function resolvePlan(provider: string, model: string, atMs: number): PlanResolution | undefined {
  if (!isPricedProvider(provider)) return undefined
  const id = model.trim().toLowerCase()
  if (FLASH_MODELS.includes(id)) {
    return { plan: FLASH_PLAN, requestedModel: model, aliased: id !== 'deepseek-flash' }
  }
  if (PRO_MODELS.includes(id)) {
    // Before the sunset instant the id is billed as V4 Pro; from it onward the
    // platform routes the same id to V4.1-Flash and bills Flash rates.
    return Number.isFinite(atMs) && atMs >= PRO_SUNSET_MS
      ? { plan: FLASH_PLAN, requestedModel: model, aliased: true }
      : { plan: PRO_PLAN, requestedModel: model, aliased: false }
  }
  return undefined
}

/** Beijing wall-clock fields of one instant. */
export interface BeijingClock {
  /** `Mon` .. `Sun`. */
  readonly weekday: string
  /** 0-23. */
  readonly hour: number
  /** 0-59. */
  readonly minute: number
}

/** Beijing-time formatter; the peak windows are published in Beijing time. */
const BEIJING_CLOCK = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Shanghai',
  weekday: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})

/**
 * Read the Beijing wall clock of an instant, independent of the host timezone.
 * @param atMs - epoch ms.
 * @returns weekday plus hour/minute in Beijing time.
 */
export function beijingClock(atMs: number): BeijingClock {
  const parts = BEIJING_CLOCK.formatToParts(new Date(atMs))
  let weekday = ''
  let hour = 0
  let minute = 0
  for (const part of parts) {
    if (part.type === 'weekday') weekday = part.value
    else if (part.type === 'hour') hour = Number(part.value)
    else if (part.type === 'minute') minute = Number(part.value)
  }
  return { weekday, hour, minute }
}

/** Peak windows (Beijing, Monday-Friday): 09:00-12:00 and 14:00-18:00. */
const PEAK_WINDOWS: readonly (readonly [number, number])[] = [[9, 12], [14, 18]]

/**
 * Classify an instant as peak or off-peak under the published windows.
 * Weekends are entirely off-peak; window ends are excluded (12:00 is off-peak).
 * @param atMs - epoch ms.
 * @returns whether peak rates apply.
 */
export function isPeak(atMs: number): boolean {
  if (!Number.isFinite(atMs)) return false
  const { weekday, hour, minute } = beijingClock(atMs)
  if (weekday === 'Sat' || weekday === 'Sun') return false
  const minutes = hour * 60 + minute
  return PEAK_WINDOWS.some(([from, to]) => minutes >= from * 60 && minutes < to * 60)
}

/** The turn's token buckets, as the chat contract reports them. */
export interface UsageBuckets {
  /** Prompt input tokens not served from cache. */
  readonly uncachedInputTokens: number
  /** Output tokens; reasoning tokens are already a subset of these. */
  readonly outputTokens: number
  /** Prompt input tokens served from the provider cache. */
  readonly cacheReadTokens?: number | undefined
  /** Output subset that was reasoning, for the panel's "of which reasoning" line. */
  readonly reasoningTokens?: number | undefined
  /**
   * Cache-write tokens. DeepSeek's published table has no separate write tier
   * (writes bill as uncached input) and its adapter does not report the bucket,
   * so this is carried for display only and never priced separately.
   */
  readonly cacheWriteTokens?: number | undefined
}

/** One currency's itemized cost for a set of buckets. */
export interface CostBreakdown {
  readonly currency: Currency
  readonly plan: PricePlan
  /** Whether the peak rates were applied. */
  readonly peak: boolean
  readonly tier: PriceTier
  readonly cacheHitTokens: number
  readonly cacheMissTokens: number
  readonly outputTokens: number
  readonly cacheHitCost: number
  readonly cacheMissCost: number
  readonly outputCost: number
  /** Sum of the three itemized costs. */
  readonly total: number
}

/**
 * Select the rate tier for one plan, window, and currency.
 * @param plan - the billed plan.
 * @param peak - whether peak rates apply.
 * @param currency - which published table to read.
 * @returns the selected rates.
 */
export function tierFor(plan: PricePlan, peak: boolean, currency: Currency): PriceTier {
  const band = currency === 'CNY' ? plan.cny : plan.usd
  return peak ? band.peak : band.offPeak
}

/**
 * Itemize one turn's cost in one currency. Tokens are priced per 1M, so the
 * arithmetic is exact for the integer buckets the provider reports.
 * @param usage - the turn's token buckets.
 * @param plan - the billed plan.
 * @param peak - whether peak rates apply.
 * @param currency - which published table to read.
 * @returns the itemized breakdown.
 */
export function computeCost(
  usage: UsageBuckets,
  plan: PricePlan,
  peak: boolean,
  currency: Currency,
): CostBreakdown {
  const tier = tierFor(plan, peak, currency)
  const cacheHitTokens = Math.max(0, usage.cacheReadTokens ?? 0)
  const cacheMissTokens = Math.max(0, usage.uncachedInputTokens)
  const outputTokens = Math.max(0, usage.outputTokens)
  const perMillion = (tokens: number, rate: number): number => (tokens / 1_000_000) * rate
  const cacheHitCost = perMillion(cacheHitTokens, tier.cacheHit)
  const cacheMissCost = perMillion(cacheMissTokens, tier.cacheMiss)
  const outputCost = perMillion(outputTokens, tier.output)
  return {
    currency,
    plan,
    peak,
    tier,
    cacheHitTokens,
    cacheMissTokens,
    outputTokens,
    cacheHitCost,
    cacheMissCost,
    outputCost,
    total: cacheHitCost + cacheMissCost + outputCost,
  }
}

/** One provider/model route that contributed a billed attempt to the turn. */
export interface TurnUsageRoute {
  readonly provider: string
  readonly model: string
}

/** The turn payload this plugin consumes, mirroring DSH's `TurnTokenUsage`. */
export interface TurnUsageLike extends UsageBuckets {
  /** Present when every billed attempt carries provider/model attribution. */
  readonly routes?: readonly TurnUsageRoute[] | undefined
}

/** The turn's wall-clock window, used to classify peak versus off-peak. */
export interface TurnWindowLike {
  readonly startMs?: number | undefined
  readonly endMs?: number | undefined
}

/** Both currencies' itemization plus the caveats the panel must disclose. */
export interface TurnEstimate {
  readonly cny: CostBreakdown
  readonly usd: CostBreakdown
  readonly plan: PricePlan
  /** Requested model ids, verbatim, in route order. */
  readonly requestedModels: readonly string[]
  /** Whether any requested id is billed under a different model. */
  readonly aliased: boolean
  /** Whether peak rates were applied. */
  readonly peak: boolean
  /** Whether the turn crossed a peak boundary, so one tier is an approximation. */
  readonly straddlesWindow: boolean
  /** Whether the turn mixed plans; the total is then an upper-bound estimate. */
  readonly mixed: boolean
  /** Routes with no published price (empty when the estimate is complete). */
  readonly unpricedModels: readonly string[]
}

/** Pick the plan a mixed turn is estimated with: the most expensive output rate. */
function costliestPlan(plans: readonly PricePlan[]): PricePlan {
  let winner = plans[0]!
  for (const plan of plans) {
    if (plan.cny.offPeak.output > winner.cny.offPeak.output) winner = plan
  }
  return winner
}

/**
 * Estimate one turn's cost in both published currencies.
 *
 * Pricing needs the turn's route attribution; without it the answer would be a
 * guess, so the function returns `undefined` and the caller renders nothing.
 * A turn that mixed plans cannot be split by model from the aggregate buckets,
 * so it is priced with the costliest plan present and flagged `mixed`.
 * @param usage - the turn's buckets and route attribution.
 * @param window - the turn's start/end instants (peak classification input).
 * @param nowMs - fallback instant for a turn whose start time is unknown.
 * @returns the estimate, or `undefined` when the turn cannot be priced.
 */
export function estimateTurnUsage(
  usage: TurnUsageLike,
  window: TurnWindowLike = {},
  nowMs: number = Date.now(),
): TurnEstimate | undefined {
  const routes = usage.routes ?? []
  if (routes.length === 0) return undefined
  const atMs = window.startMs ?? window.endMs ?? nowMs
  const resolutions = routes.map(route => resolvePlan(route.provider, route.model, atMs))
  const resolved = resolutions.filter((entry): entry is PlanResolution => entry !== undefined)
  if (resolved.length === 0) {
    return {
      cny: computeCost(usage, PRICE_PLANS[0]!, false, 'CNY'),
      usd: computeCost(usage, PRICE_PLANS[0]!, false, 'USD'),
      plan: PRICE_PLANS[0]!,
      requestedModels: routes.map(route => route.model),
      aliased: false,
      peak: false,
      straddlesWindow: false,
      mixed: false,
      unpricedModels: routes.map(route => route.model),
    }
  }
  const plans = resolved.map(entry => entry.plan)
  const unique = new Map(plans.map(plan => [plan.id, plan]))
  const mixed = unique.size > 1 && resolutions.some(entry => entry === undefined) === false
  const plan = costliestPlan([...unique.values()])
  const peak = isPeak(atMs)
  const endMs = window.endMs
  const straddlesWindow = endMs !== undefined && Number.isFinite(endMs) && isPeak(endMs) !== peak
  return {
    cny: computeCost(usage, plan, peak, 'CNY'),
    usd: computeCost(usage, plan, peak, 'USD'),
    plan,
    requestedModels: routes.map(route => route.model),
    aliased: resolutions.some(entry => entry?.aliased === true),
    peak,
    straddlesWindow,
    mixed,
    unpricedModels: routes
      .filter((_route, index) => resolutions[index] === undefined)
      .map(route => route.model),
  }
}

/** Thousand-separated integer, matching the native usage dialog. */
export function formatExactTokens(value: number): string {
  return Math.round(value).toLocaleString('en-US')
}

/**
 * Money label for the chip and the panel.
 * Sub-cent amounts keep enough decimals to stay meaningful instead of rounding
 * to a flat zero.
 * @param value - amount in `currency`.
 * @param currency - which symbol and precision ladder to use.
 * @returns the formatted label, always with its symbol.
 */
export function formatMoney(value: number, currency: Currency): string {
  const symbol = currency === 'CNY' ? '¥' : '$'
  const amount = Number.isFinite(value) ? Math.max(0, value) : 0
  if (amount === 0) return `${symbol}0`
  if (amount < 0.0001) return `<${symbol}0.0001`
  const digits = amount < 0.01 ? 4 : amount < 1 ? 3 : 2
  return symbol + amount.toFixed(digits)
}
