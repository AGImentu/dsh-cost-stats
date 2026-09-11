/**
 * Dictionaries for this plugin's locale namespace.
 *
 * Registered with the locale service and bound to the slot entry through the
 * `locale` register option, so the chip follows the DSH interface language the
 * same way core surfaces do. A built-in zh fallback keeps the panel readable if
 * the locale service is missing.
 *
 * @module dsh-session-cost/client/locales
 */

import type { Translator } from './contract.ts'

/** Locale namespace owned by this plugin. */
export const NS = 'session-cost'

/** Chinese dictionary (also the built-in fallback). */
export const zh: Readonly<Record<string, string>> = {
  'cost.chip': '≈{amount}',
  'cost.title': '本回合费用',
  'cost.model': '计费模型',
  'cost.requested': '请求模型',
  'cost.window': '计费时段',
  'cost.peak': '高峰时段',
  'cost.offPeak': '空闲时段',
  'cost.cacheHit': '缓存命中',
  'cost.uncached': '未缓存输入',
  'cost.cacheRead': '缓存读取',
  'cost.cacheWrite': '缓存写入',
  'cost.output': '输出',
  'cost.reasoning': '（其中推理 {tokens}）',
  'cost.total': '合计',
  'cost.session': '本次会话',
  'cost.sessionTurns': '已加载 {turns} 回合',
  'cost.perMillion': '×{rate}/M',
  'cost.note.estimate': '为按官方价目表计算的估算值，非账单金额。',
  'cost.note.mixed': '本回合混用了多个计费模型，按其中最高价估算上界。',
  'cost.note.straddle': '本回合跨越了高峰/空闲切换点，按回合起始时刻计价。',
  'cost.note.alias': '该模型名已下线，请求由 {label} 提供并按此计价。',
  'cost.note.excluded': '子代理、后台会话与压缩请求不计入。',
  'cost.note.cacheWrite': '官方价目表无独立缓存写入档，写入已计入未缓存输入。',
  'cost.unpriced': '该模型无官方公示价，未计费。',
  'stats.nav': '费用统计',
  'stats.title': '费用统计',
  'stats.subtitle': '按每次回复汇总的官方价目估算（¥ / $）',
  'stats.mode.turns': '全部回复',
  'stats.mode.day': '按日',
  'stats.mode.month': '按月',
  'stats.total': '费用合计',
  'stats.refresh': '刷新',
  'stats.metric.replies': '回复',
  'stats.metric.sessions': '会话',
  'stats.metric.subagents': '含子代理 {count}',
  'stats.metric.tokens': '用量',
  'stats.metric.unpriced': '未计价 {count}',
  'stats.col.time': '时间',
  'stats.col.session': '会话',
  'stats.col.tokens': '用量',
  'stats.col.cost': '费用',
  'stats.col.replies': '回复数',
  'stats.col.day': '日期',
  'stats.col.month': '月份',
  'stats.clearSelection': '取消选择',
  'stats.selected': '已选 {bucket}',
  'stats.loading': '正在汇总会话日志…',
  'stats.error': '读取费用数据失败（宿主侧路由不可用）。',
  'stats.empty': '暂无可统计的用量。',
  'stats.tag.subagent': '子代理',
  'stats.tag.unpriced': '无价目',
}

/** English dictionary. */
export const en: Readonly<Record<string, string>> = {
  'cost.chip': '≈{amount}',
  'cost.title': 'Turn cost',
  'cost.model': 'Billed model',
  'cost.requested': 'Requested model',
  'cost.window': 'Rate window',
  'cost.peak': 'Peak',
  'cost.offPeak': 'Off-peak',
  'cost.cacheHit': 'Cache hit',
  'cost.uncached': 'Uncached input',
  'cost.cacheRead': 'Cached input',
  'cost.cacheWrite': 'Cache write',
  'cost.output': 'Output',
  'cost.reasoning': ' ({tokens} reasoning)',
  'cost.total': 'Total',
  'cost.session': 'This session',
  'cost.sessionTurns': '{turns} turns loaded',
  'cost.perMillion': '×{rate}/M',
  'cost.note.estimate': 'Estimated from the official price table; not an invoice.',
  'cost.note.mixed': 'This turn mixed billing models; priced with the costliest one as an upper bound.',
  'cost.note.straddle': 'This turn crossed a peak/off-peak boundary; priced at its start.',
  'cost.note.alias': 'This model id is retired; requests are served by {label} and billed at its rate.',
  'cost.note.excluded': 'Subagent, background-session and compaction requests are excluded.',
  'cost.note.cacheWrite': 'The official table has no separate cache-write tier; writes bill as uncached input.',
  'cost.unpriced': 'No published price for this model; not billed here.',
  'stats.nav': 'Cost stats',
  'stats.title': 'Cost statistics',
  'stats.subtitle': 'Per-reply estimate from the official price table (CNY / USD)',
  'stats.mode.turns': 'All replies',
  'stats.mode.day': 'By day',
  'stats.mode.month': 'By month',
  'stats.total': 'Total cost',
  'stats.refresh': 'Refresh',
  'stats.metric.replies': 'Replies',
  'stats.metric.sessions': 'Sessions',
  'stats.metric.subagents': '{count} subagent',
  'stats.metric.tokens': 'Tokens',
  'stats.metric.unpriced': '{count} unpriced',
  'stats.col.time': 'Time',
  'stats.col.session': 'Session',
  'stats.col.tokens': 'Tokens',
  'stats.col.cost': 'Cost',
  'stats.col.replies': 'Replies',
  'stats.col.day': 'Day',
  'stats.col.month': 'Month',
  'stats.clearSelection': 'Clear selection',
  'stats.selected': 'Selected {bucket}',
  'stats.loading': 'Summarizing session logs…',
  'stats.error': 'Could not read cost data (the host route is unavailable).',
  'stats.empty': 'No usage to summarize yet.',
  'stats.tag.subagent': 'subagent',
  'stats.tag.unpriced': 'unpriced',
}

/**
 * Substitute `{name}` placeholders.
 * @param template - dictionary value.
 * @param vars - substitution values.
 * @returns the rendered string.
 */
function interpolate(template: string, vars?: Readonly<Record<string, string | number>>): string {
  if (vars === undefined) return template
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = vars[name]
    return value === undefined ? match : String(value)
  })
}

/**
 * Built-in Chinese translator, used when the locale seat is unavailable.
 * @param key - dictionary key.
 * @param vars - substitution values.
 * @returns the Chinese string, or the key itself when unknown.
 */
export const fallbackTranslator: Translator = (key, vars) =>
  interpolate(zh[key] ?? key, vars)
