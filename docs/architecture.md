# 架构与接入契约

本文记录这个插件**依赖 DSH 的哪些契约**、为什么这样设计,以及 DSH 升级时应该检查什么。
所有锚点都对 DSH `0.1.5-rc.2` 核对过(路径为 DSH 仓库内路径)。

## 1. 两个产物,两条契约

| 产物 | 形态 | 契约要点 |
|---|---|---|
| `lib/index.js` | Node ESM cordis 插件(**故意空实现**) | 它的存在是为了成为一行 **live Loader row**;`dsh-client-modules` 只扫描"配置树里实际挂载了"的 row |
| `lib/client.js` | 浏览器 **classic script + CJS 闭包工厂** | `window.__ModuleLoader__.load({ id: <包名>, factory: (require) => { ... return module.exports } })` |

### 为什么 host 半边是空的

`dsh-client-modules` 的 node 半边会遍历 live Loader entries,按 entry 的解析位置找到最近归属的
`package.json`,读它的 `dsh.client` 声明,把 `lib/client.js` 编进浏览器的 boot graph。

因此挂载一行 host entry 是**唯一**让浏览器半边到达的手段,而这一行本身不需要做任何事:
本插件不提供 host 服务、不进会话循环、不注册路由。真正的功能全在浏览器里,读的是聊天 UI 已经拿到的用量。

### 清单字段(必须与 builder 一致)

```jsonc
"dsh": {
  "bundle": { "patch": "./cordis.patch.yml" },   // 让 dsh plugin add 把本包并入 bundles 层
  "client": {
    "platform": "web",                            // 必须;非 web 直接跳过
    "inject": [                                   // 依赖的**包 row**,不是服务名
      "@deepseek-ai/dsh-client-ui-renderer",      // 提供 ctx.slots(SlotCore)
      "@deepseek-ai/dsh-client-ui-chat"           // 声明 conversation.chat.assistant-actions 插槽
    ]
  }
}
```

`exports["./client"]` 必须存在(`string` 或含 `default` 的对象)——client-modules 靠它定位 bundle:

```jsonc
"exports": { ".": {...}, "./client": { "default": "./lib/client.js" } }
```

## 2. UI 挂载点

### 2.1 聊天尾行的费用胶囊

| 项 | 值 | 出处 |
|---|---|---|
| 插槽 | `conversation.chat.assistant-actions`(kind `list`,scope `session`) | `packages/client/ui-chat/src/client/contract/slots.ts` |
| owner | `{ messageId }` | 同上 |
| 渲染位置 | `MessageIconActions` 的 `extraActions`(复制键与分支键之间;原生「用量/用时」胶囊在其右侧) | `.../chat/TurnTailNodeView.tsx`、`.../chat/MessageIconActions.tsx` |
| 组件 props | owner + 框架 standard kit(`useChat` 选择器 hook、`sessionId`、`useProjection`)+ `locale` 席位绑定的 `t` | `.../ui-renderer/src/client/scoped-slots.tsx`、`.../ui-chat/.../contract/slots.ts`(`SessionStandardProps` 合并) |
| 注册 API | `ctx.slots.inject(key, () => ctx.slots.register({ name, id, order, locale }, Component))`;服务名 `slots` | `.../ui-renderer/src/client/registry.ts`(`new SlotCore()`);对照实现 `ui-message-feedback/src/client/index.ts` |

### 2.2 设置面板的统计页

| 项 | 值 | 出处 |
|---|---|---|
| 插槽 | `settings.section`(kind `list`,scope **`root`**) | `packages/client/ui-settings/src/client/contract/slots.ts` |
| owner | 空(`SettingsSectionOwnerProps`)——页面的文案与内容全部由注册方自己拥有 | 同上 |
| register 选项 | `id`(节键)/ `order`(导航位置)/ `label`(注册方本地化文案,可为 thunk)/ `locale` | 同上;`label` 为 thunk 的语义见 ui-slots `SlotOptions` |
| 组件 props | `useSessions`(会话列表 + 当前选择,root 标准席位)+ `locale` 绑定的 `t` | `.../ui-session/src/client/index.ts`(`GlobalStandardProps` 合并);`.../ui-renderer/.../scoped-slots.tsx` |
| 渲染位置 | 设置面板左侧导航一格 + 右侧内容列(`.options`,padding `0 24px 24px`,内容宽度约 560px) | `.../ui-settings-general/src/client/SettingsRoot.module.css` |
| 声明方 | 运行时由 `ui-settings-general` 在自己的 children 声明表里登记 `settings.section` | 同包 `index.ts` |

因为作用域是 `root`,这里**拿不到**会话作用域的 `useChat`——这正是统计页改用宿主投影(见 §3)的原因,而不是设计偏好。

## 3. 数据流

### 3.1 聊天胶囊(逐回合,精确)

```
供应商 usage ──> token-meter 投影(分档,精确)
      └─> 客户端 chat 节点:TurnTailChatData.tokenUsage(+ routes:[{provider,model}])
              └─> 本插件:useChat(选择器)→ selectTurnUsage / selectTurnLocation
                        └─> pricing.estimateTurnUsage(...) → 胶囊 + 明细面板
```

### 3.2 统计页(逐会话,来自宿主投影)

```
供应商 usage ──> 宿主会话投影:tokenUsage(累计分档)、modelSelection(实际使用的路由)
                        └─> 客户端会话列表每行的 projectionValues(+ updatedAt / origin / title)
                              └─> useSessions(选择器)→ session-costs.scanSessions(...)
                                    └─> 日/月分桶 + 合计 → StatsSection
```

- 这条路径**不加载聊天历史、不唤醒冷会话**:投影随会话列表一起到达(这就是它能覆盖整个列表的原因)。
- `SessionSummary.projectionValues` 的类型是 `Partial<SessionProjectionMap>`——即所有投影键的并集;
  未持有投影的行(从未跑过请求)会被 `scanSessions` 计入 `skipped`,界面上明确说明,而不是当成 0。
- 选择器同样只返回存储引用(`state.ids` / `state.byId`),折叠发生在 `useMemo` 里。

### 3.3 选择器的引用纪律(两条路径共有)

- 选中 `turn-tail` 节点的方式:遍历 `snapshot.nodes.values()`,匹配
  `data.closing.finalNode.messageId === <本行 owner 的 messageId>`。
- **选择器必须返回存储引用**(节点里的 `tokenUsage` / `location` 对象)或原始值。
  快照选择器按引用比较,返回新对象会导致每个流式 chunk 都重渲染。
- 会话累计在**面板**里折叠(`collectLoadedTurns` + `useMemo`,依赖 `snapshot.order` 的引用变化),
  不在胶囊的每次渲染里做,避免流式期间的无谓开销。

## 4. 设计取舍

| 取舍 | 理由 |
|---|---|
| 条目包在**错误边界**(`Boundary.tsx`)里注册 | 它渲染在官方控件(复制/分支/用量/用时)所在的同一行子树里。React 的未捕获渲染错误会一直向上抛到最近边界——如果那层边界在整行之上的话,官方控件会被一起卸载。边界放在本插件内部,等于把"插件坏了只会少一个胶囊"变成结构性保证,`scripts/smoke-client-bundle.mjs` 里有对应的抛错隔离断言 |
| 类型用**镜像声明**而非 import | npm 上的 DSH 客户端内部包版本严重滞后(`0.1.2-alpha.x`/`0.0.1-rc.x` vs shell `0.1.5-rc.2`),import 它们等于把插件钉在一个并不存在的宿主上。镜像 + 运行时防御读取 → 字段消失时退化为"不渲染" |
| 只依赖 `react` / `react/jsx-runtime` / `react-dom` | 三者都在 shell 的冻结模块表种子(`packages/client/web/src/seed.ts`);其余一律不引,所以不会被内部包版本卡住 |
| 样式用**纯 CSS 字符串 + `data-plugin` 标签** | 官方 CSS Modules 能力在 DSH 的 tsdown 预设里,外部工程无法 import;本插件样式很小,类名哈希收益为零 |
| 面板用 `createPortal` + 视口钳制定位 | 与核心 stat 弹窗一致(`ui-chat/.../stat-dialog.module.css` 的皮肤),避免被聊天列的滚动容器裁剪 |
| `order: 20` | 排在核心反馈条目(order 10)之后;原生用量/用时胶囊不是 list 条目,所以本插件独占插件单元格 |
| 统计页 `order: 300` | 设置导航里排在出货分区与「侧边卡片」(order 100)之后——就是被要求的位置 |
| 统计页走**宿主投影**而不是聊天快照 | 设置页是 `root` 作用域,拿不到 `useChat`;而会话列表每行自带 `projectionValues`,于是整表可算且无需唤醒冷会话。代价是粒度降到会话级(见 §3.2 与 CHANGELOG 的边界说明) |
| 导航文案用 **label thunk** + 监听 `locale/change` | 契约规定 label 由注册方本地化、shell 每次渲染重新求值;这样语言切换不需要重新注册,插件也不用订阅 locale 状态 |
| 没有设置项(v1/v2) | 价目表随代码走,升级即更新;少一层状态持久化 |

## 5. DSH 升级时检查这 6 处

1. `packages/client/web/src/platform.ts` 的 `PLATFORM_MODULES` —— 与 `tsdown.config.ts` 里的同名常量保持一致;
2. `ui-chat` 的 `SlotMap` 中 `conversation.chat.assistant-actions` 是否仍为 list/session/`{messageId}`;
3. `TurnTailChatData.tokenUsage`(`TurnTokenUsage` 的分档字段与 `routes`);
4. `TurnTailChatData.closing.finalNode.messageId`(选择器的匹配键);
5. `ui-settings` 的 `SlotMap` 中 `settings.section` 是否仍为 list/`root`,以及 register 选项里的 `label`(可为 thunk)语义;
6. 会话列表行(`SessionSummary`)是否仍带 `projectionValues`(`tokenUsage` / `modelSelection`)、`updatedAt`、`origin`。

前 4 处任一变化,`pnpm run smoke` 会先失败(它断言注册 id、插件形状、两个插槽名与真实算价);第 5、6 处会先由 `tsc` 报错(镜像类型),再在界面上退化为"空表 + 未纳入计数"。

## 6. 测试策略

| 层 | 工具 | 覆盖 |
|---|---|---|
| 计费纯函数 | `vitest`(`tests/pricing.spec.ts`) | 别名/改路规则、高峰窗口边界(含 12:00、周末、跨时区)、三档金额、混用模型、无路由不猜 |
| 会话聚合 | `vitest`(`tests/session-costs.spec.ts`) | 日/月键与分桶、按桶筛选、合计、子代理标记、无价目会话、`lastUsed→next` 回退、无投影会话计入 skipped |
| 产物契约 | `node scripts/smoke-client-bundle.mjs` | bundle 注册 id = 包名、工厂返回 `inject`/`apply`、两个插槽各注册一项、导航 label 非空、**两个条目的渲染抛错都被隔离成 null**、胶囊与统计页对真实分档算出正确金额、无路由不渲染 |
| 真机 | 手动 | 重启 `dsh web` + 硬刷新:核对胶囊与原生用量弹窗的分档一致性、统计页的合计与余额 `$` 变化对照 |
