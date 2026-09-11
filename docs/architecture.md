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
| 组件 props | 只有 `locale` 绑定的 `t`——页面自带数据来源(插件自己的宿主路由) | `.../ui-renderer/.../scoped-slots.tsx` |
| 渲染位置 | 设置面板左侧导航一格 + 右侧内容列(`.options`,padding `0 24px 24px`,内容宽度约 560px) | `.../ui-settings-general/src/client/SettingsRoot.module.css` |
| 声明方 | 运行时由 `ui-settings-general` 在自己的 children 声明表里登记 `settings.section` | 同包 `index.ts` |

因为作用域是 `root`,这里**拿不到**会话作用域的 `useChat`;而页面要的是"每一次回复"的全局明细,
浏览器手里只有当前会话已加载的那一段。所以统计页改用**插件自有的宿主路由**(见 §3.2),而不是设计偏好。

## 3. 数据流

### 3.1 聊天胶囊(逐回合,精确)

```
供应商 usage ──> token-meter 投影(分档,精确)
      └─> 客户端 chat 节点:TurnTailChatData.tokenUsage(+ routes:[{provider,model}])
              └─> 本插件:useChat(选择器)→ selectTurnUsage / selectTurnLocation
                        └─> pricing.estimateTurnUsage(...) → 胶囊 + 明细面板
```

### 3.2 统计页(逐次回复,来自持久化日志)

```
持久化会话日志($DSH_HOME/sessions/**)
   └─> host:ctx.sessionPersistence.list() → open(id,'read') → handle.read()
         └─> host/turn-fold.ts:事件 → 每次回复(窗口 / 模型 / 分档 token)
               └─> pricing.estimateTurnUsage(...) → GET /session-cost/usage(JSON,TTL 缓存)
                     └─> client:fetch → stats-model(日/月分桶 + 筛选 + 合计)→ StatsSection
```

- **为什么在宿主侧**:逐条历史只存在于持久化日志里;浏览器只有当前会话已加载的窗口。
  宿主读日志是唯一能覆盖"所有会话、全部历史"的位置,而且不需要激活任何冷会话。
- **逐次精确**:模型取该次回复的 `message.source.provider/model`(缺失时回退到最近一条 `model/selection`),
  高峰/空闲按该回合自身的 `turn/start`/`turn/end` 判定——比"按会话最近模型/最后活动"准。
- **一次折叠,两处使用**:`turn-fold.ts` 是纯函数,宿主路由与 `scripts/verify-balance.mjs` 都用它,
  所以"界面上显示的"和"独立复算的"不可能因为实现分叉而不一致。
- **有界**:只读最近 `MAX_SESSIONS`(120)个非空会话,载荷按 `CACHE_TTL_MS`(20s)缓存,并发请求共享一次构建,
  读不动的会话计入 `skipped` 而不是让整页失败。

### 3.3 选择器的引用纪律(聊天侧)

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
| 统计页走**插件自有宿主路由 + 日志折叠** | 设置页是 `root` 作用域,拿不到 `useChat`;而"每一次回复"的全局明细只存在于持久化日志里。宿主读日志是唯一能覆盖全部历史的实现,且客户端只做分组合计 → 明细与合计永远同一批数字 |
| 折叠逻辑放在**纯函数**里(`host/turn-fold.ts`) | 宿主路由与 `scripts/verify-balance.mjs` 共用同一份实现,独立复算才有意义(实现分叉就不是独立验证了) |
| 宿主路由带 **TTL 缓存 + 并发去重 + 会话上限** | 每次请求都读全部日志太贵;缓存 20s、并发共享一次构建、只读最近 120 个非空会话,兼顾新鲜度与开销 |
| 导航文案用 **label thunk** + 监听 `locale/change` | 契约规定 label 由注册方本地化、shell 每次渲染重新求值;这样语言切换不需要重新注册,插件也不用订阅 locale 状态 |
| 没有设置项(v1–v3) | 价目表随代码走,升级即更新;少一层状态持久化 |

## 5. DSH 升级时检查这 9 处

聊天侧(浏览器):

1. `packages/client/web/src/platform.ts` 的 `PLATFORM_MODULES` —— 与 `tsdown.config.ts` 里的同名常量保持一致;
2. `ui-chat` 的 `SlotMap` 中 `conversation.chat.assistant-actions` 是否仍为 list/session/`{messageId}`;
3. `TurnTailChatData.tokenUsage`(`TurnTokenUsage` 的分档字段与 `routes`);
4. `TurnTailChatData.closing.finalNode.messageId`(选择器的匹配键);
5. `ui-settings` 的 `SlotMap` 中 `settings.section` 是否仍为 list/`root`,以及 register 选项里的 `label`(可为 thunk)语义。

宿主侧(统计页数据):

6. `ctx.sessionPersistence` 的 `list()` / `open(id, access)` / `handle.read()` 是否仍存在且返回 `{ events }`
   (`packages/session/session-persistence/src/index.ts`、`handle.ts`);
7. `ctx.webServer.register({ kind, path, handler })` 的签名与 `req`/`res` 形态(`packages/host/webserver`);
8. 会话头字段 `id` / `createdAt` / `cwd` / `delegationDepth`(`packages/session/session-format/src/types.ts`);
9. 持久化事件形状:`turn/start|end.data.turn`、`assistant/message.data.usage`、
   `assistant/message.data.message.source.provider|model`、`model/selection.data.provider|model`、`session/title.data.title`。

前 5 处任一变化,`pnpm run smoke` 会先失败(它断言注册 id、插件形状、两个插槽名与真实算价);
第 6–9 处会先由 `tsc` 报错(镜像类型),再在真机上表现为统计页报错或行数变少 —— 用 `pnpm run verify:balance` 可直接定位到折叠层。

## 6. 测试策略

| 层 | 工具 | 覆盖 |
|---|---|---|
| 计费纯函数 | `vitest`(`tests/pricing.spec.ts`) | 别名/改路规则、高峰窗口边界(含 12:00、周末、跨时区)、三档金额、混用模型、无路由不猜 |
| 日志折叠 | `vitest`(`tests/turn-fold.spec.ts`) | 头部/标题、回合窗口、多尝试累加、`message.source` 优先与 `model/selection` 回退、非法用量整条丢弃、无人认领的 usage、`assistant/attempt` 重试、未知事件容错 |
| 统计模型 | `vitest`(`tests/stats-model.spec.ts`) | 日/月键与分桶、按桶筛选、合计(回复数/会话数/子代理/未计价/金额/用量)、空选择返回 0 |
| 产物契约 | `node scripts/smoke-client-bundle.mjs` | bundle 注册 id = 包名、工厂返回 `inject`/`apply`、两个插槽各注册一项、导航 label 非空、**两个条目的渲染抛错都被隔离成 null**、胶囊对真实分档算出 `≈¥5`、无路由不渲染、统计页发起宿主请求 |
| 独立复算 | `node scripts/verify-balance.mjs` | 绕过宿主直读日志复算全部会话累计,并与 API 余额的差值对账(2026-09-11 实测 Δ$0.249 vs 余额 Δ$0.25) |
| 真机 | 手动 | 重启 `dsh web` + 硬刷新:核对胶囊与原生用量弹窗的分档一致性、统计页逐条明细与合计 |
