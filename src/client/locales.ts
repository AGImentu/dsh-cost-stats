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
  'stats.balance.label': '余额 {amount}',
  'stats.balance.loading': '余额查询中…',
  'stats.balance.retry': '余额查询失败 · 点击重试',
  'stats.balance.query': '查询余额',
  'stats.balance.badKey': '这个 key 不合法',
  'stats.balance.clickToQuery': '点击重新查询',
  'stats.balance.localOnly': '余额仅本机可查',
  'stats.balance.noKey': '未配置 API key',
  'stats.balance.unavailable': '余额不足或不可用',
  'stats.balance.breakdown': '总额 {total}（充值 {toppedUp} / 赠金 {granted}）',
  'stats.balance.at': '{time} 查询',
  'stats.balance.source': '来源:{source}',
  'stats.balance.manualSource': '手动输入的 key',
  'stats.balance.saved': '已存入 DSH 凭据库',
  'stats.balance.saveUnsupported': '这台 DSH 不支持从插件写入凭据,请在「设置 → 模型」里配置这个 key',
  'stats.balance.saveFailed': '存入 DSH 凭据库失败',
  'stats.balance.hint': '来自 DeepSeek 官方 /user/balance 接口;只有 DeepSeek 官方的 key 能查到余额。key 由 DSH 凭据服务提供,本插件不保存、页面也拿不到',
  'stats.key.label': '模型',
  'stats.key.hint': '下拉里是「设置 → 模型」里已经配好的模型供应商(显示的名字与那一页一致;只有名字,插件和页面都拿不到 key 的值)。选一个,再点「查询余额」,插件就用那把 key 去查 DeepSeek 官方余额。只有 DeepSeek 官方的 key 能查到余额;手动输入的 key 只在本次页面里存在,不写进任何文件。',
  'stats.key.none': '(读不到模型清单)',
  'stats.key.manual': '手动输入 key…',
  'stats.key.placeholder': '粘贴 DeepSeek 官方 API key',
  'stats.key.unconfigured': '(未配置)',
  'stats.key.optionRef': '凭据:{ref}',
  'stats.key.optionProvider': '供应商:{provider}',
  'stats.key.optionSet': '已配置',
  'stats.key.optionUnset': '未配置',
  'stats.key.remember': '存入 DSH 凭据库',
  'stats.key.rememberHint': '把这次输入的 key 写进 DSH 自己的凭据文件(和你在「设置 → 模型」里配的 key 放在一起),以后可以直接从下拉里选到;不勾选则只本次有效。',
  'stats.key.rememberAs': '存为',
  'stats.key.rememberAsPlaceholder': '存为(如 DEEPSEEK_API_KEY_2)',
  'stats.key.query': '查询余额',
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
  'stats.balance.label': 'Balance {amount}',
  'stats.balance.loading': 'Balance…',
  'stats.balance.retry': 'Balance unavailable · retry',
  'stats.balance.query': 'Check balance',
  'stats.balance.badKey': 'That key is not usable',
  'stats.balance.clickToQuery': 'Click to query again',
  'stats.balance.localOnly': 'Balance is local-only',
  'stats.balance.noKey': 'No API key configured',
  'stats.balance.unavailable': 'Balance too low for calls',
  'stats.balance.breakdown': '{total} (paid {toppedUp} / granted {granted})',
  'stats.balance.at': 'queried {time}',
  'stats.balance.source': 'from {source}',
  'stats.balance.manualSource': 'the key you pasted',
  'stats.balance.saved': 'Stored in the DSH credential store',
  'stats.balance.saveUnsupported': 'This DSH build cannot be written from a plugin; configure the key under Settings → Models',
  'stats.balance.saveFailed': 'Storing the key in the DSH credential store failed',
  'stats.balance.hint': 'From DeepSeek\'s official /user/balance endpoint; only an official DeepSeek key has a balance there. The key comes from the DSH credential service and is neither stored by this plugin nor exposed to this page',
  'stats.key.label': 'Model',
  'stats.key.hint': 'The list holds the model providers configured under Settings → Models, labelled exactly as that page does (names only — neither the plugin nor this page ever sees a value). Pick one and press the button to query its official balance; only an official DeepSeek key has one. A pasted key lives in this page only and is written to no file.',
  'stats.key.none': '(no model list available)',
  'stats.key.manual': 'Paste a key…',
  'stats.key.placeholder': 'Paste an official DeepSeek API key',
  'stats.key.unconfigured': ' (not configured)',
  'stats.key.optionRef': 'credential: {ref}',
  'stats.key.optionProvider': 'provider: {provider}',
  'stats.key.optionSet': 'configured',
  'stats.key.optionUnset': 'not configured',
  'stats.key.remember': 'Store in DSH',
  'stats.key.rememberHint': 'Write the pasted key into DSH\'s own credential file (next to the keys you configured under Settings → Models) so it shows up in this list later. Unticked, it is valid for this page only.',
  'stats.key.rememberAs': 'Store as',
  'stats.key.rememberAsPlaceholder': 'store as (e.g. DEEPSEEK_API_KEY_2)',
  'stats.key.query': 'Check balance',
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
