/**
 * Dictionaries for this plugin's locale namespace.
 *
 * Registered with the locale service and bound to the slot entry through the
 * `locale` register option, so the chip follows the DSH interface language the
 * same way core surfaces do. A built-in zh fallback keeps the panel readable if
 * the locale service is missing.
 *
 * @module dsh-cost-stats/client/locales
 */

import type { Translator } from './contract.ts'

/** Locale namespace owned by this plugin. */
export const NS = 'cost-stats'

/** Chinese dictionary (also the built-in fallback). */
export const zh: Readonly<Record<string, string>> = {
  'cost.chip': '≈{amount}',
  'cost.title': '本回合费用',
  'cost.fold.title': '本回合费用（按日志重算）',
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
  'cost.note.fold': '官方用量统计未给出本回合（该回合含未回报用量的重试请求），此数由插件重算会话日志得出；日志同样缺少的那部分用量会让此数偏低。',
  'cost.note.mixed': '本回合混用了多个计费模型，按其中最高价估算上界。',
  'cost.note.straddle': '本回合跨越了高峰/空闲切换点，按回合起始时刻计价。',
  'cost.note.alias': '该模型名已下线，请求由 {label} 提供并按此计价。',
  'cost.note.excluded': '子代理与后台会话的请求不计入；压缩是独立计费项，见费用统计页。',
  'cost.note.cacheWrite': '官方价目表无独立缓存写入档，写入已计入未缓存输入。',
  'cost.unpriced': '该模型无官方公示价，未计费。',
  'stats.nav': '费用统计',
  'stats.title': '费用统计',
  'stats.subtitle': '按每次回复汇总的官方价目估算（¥ / $）',
  'stats.total': '费用合计',
  'stats.scope.all': '全部时间',
  'stats.scope.clear': '清除筛选',
  'stats.refresh': '刷新',
  'stats.pick.day': '选择日期',
  'stats.pick.month': '选择月份',
  'stats.pick.prev': '上一页',
  'stats.pick.next': '下一页',
  'stats.pick.clear': '清除',
  'stats.pick.today': '今天',
  'stats.pick.thisMonth': '本月',
  'stats.pick.monthShort': '{month}月',
  'stats.metric.replies': '回复',
  'stats.metric.compactions': '压缩',
  'stats.metric.sessions': '会话',
  'stats.metric.subagents': '含子代理 {count}',
  'stats.metric.tokens': '用量',
  'stats.metric.unpriced': '未计价 {count}',
  'stats.col.time': '时间',
  'stats.col.session': '会话',
  'stats.col.tokens': '用量',
  'stats.col.cost': '费用',
  'stats.page.summary': '第 {page} / {pages} 页 · 共 {count} 条 · 每页 {size} 条',
  'stats.page.prev': '上一页',
  'stats.page.next': '下一页',
  'stats.loading': '正在汇总会话日志…',
  'stats.error': '读取费用数据失败（宿主侧路由不可用）。',
  'stats.empty': '这段时间没有可统计的用量。换个日期/月份，或点「清除筛选」看全部。',
  'stats.tag.subagent': '子代理',
  'stats.tag.unpriced': '无价目',
  'stats.tag.compaction': '压缩',
}

/** English dictionary. */
export const en: Readonly<Record<string, string>> = {
  'cost.chip': '≈{amount}',
  'cost.title': 'Turn cost',
  'cost.fold.title': 'Turn cost (recomputed from the log)',
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
  'cost.note.fold': 'The official usage meter withheld this turn (it contains a retried request that reported no usage), so the plugin recomputed it from the durable session log; the same missing usage makes this number a lower bound.',
  'cost.note.mixed': 'This turn mixed billing models; priced with the costliest one as an upper bound.',
  'cost.note.straddle': 'This turn crossed a peak/off-peak boundary; priced at its start.',
  'cost.note.alias': 'This model id is retired; requests are served by {label} and billed at its rate.',
  'cost.note.excluded': 'Subagent and background-session requests are excluded; compactions are a separate item on the stats page.',
  'cost.note.cacheWrite': 'The official table has no separate cache-write tier; writes bill as uncached input.',
  'cost.unpriced': 'No published price for this model; not billed here.',
  'stats.nav': 'Cost stats',
  'stats.title': 'Cost statistics',
  'stats.subtitle': 'Per-reply estimate from the official price table (CNY / USD)',
  'stats.mode.turns': 'All replies',
  'stats.mode.day': 'By day',
  'stats.mode.month': 'By month',
  'stats.total': 'Total cost',
  'stats.scope.all': 'All time',
  'stats.scope.clear': 'Clear filters',
  'stats.refresh': 'Refresh',
  'stats.pick.day': 'Pick a day',
  'stats.pick.month': 'Pick a month',
  'stats.pick.prev': 'Previous',
  'stats.pick.next': 'Next',
  'stats.pick.clear': 'Clear',
  'stats.pick.today': 'Today',
  'stats.pick.thisMonth': 'This month',
  'stats.pick.monthShort': '{month}',
  'stats.metric.replies': 'Replies',
  'stats.metric.compactions': 'Compactions',
  'stats.metric.sessions': 'Sessions',
  'stats.metric.subagents': '{count} subagent',
  'stats.metric.tokens': 'Tokens',
  'stats.metric.unpriced': '{count} unpriced',
  'stats.col.time': 'Time',
  'stats.col.session': 'Session',
  'stats.col.tokens': 'Tokens',
  'stats.col.cost': 'Cost',
  'stats.page.summary': 'Page {page} of {pages} · {count} replies · {size} per page',
  'stats.page.prev': 'Previous',
  'stats.page.next': 'Next',
  'stats.loading': 'Summarizing session logs…',
  'stats.error': 'Could not read cost data (the host route is unavailable).',
  'stats.empty': 'No usage in this range. Pick another day/month, or clear the filter to see everything.',
  'stats.tag.subagent': 'subagent',
  'stats.tag.unpriced': 'unpriced',
  'stats.tag.compaction': 'compaction',
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
