# 架构与接入契约

本文记录这个插件**依赖 DSH 的哪些契约**、为什么这样设计,以及 DSH 升级时应该检查什么。
所有锚点都对 DSH `0.1.5-rc.2` 与 `0.1.7-rc.2` 两版核对过(路径为 DSH 仓库内路径);
0.1.7 的复核结论见 §5 第 10 条(会话格式 v4),0.2.0-rc.2 的复核结论见 §5 第 11、12 条
(凭据服务仍提供 `resolve`/`describe`/`set`,三个路由与清单解析在真机实测通过)。

## 1. 两个产物,两条契约

| 产物 | 形态 | 契约要点 |
|---|---|---|
| `lib/index.js` | Node ESM cordis 插件 | ① 成为一行 **live Loader row**(浏览器半边的唯一到达手段);② 注册 `GET /cost-stats/usage`,给统计页与胶囊兜底提供数据 |
| `lib/client.js` | 浏览器 **classic script + CJS 闭包工厂** | `window.__ModuleLoader__.load({ id: <包名>, factory: (require) => { ... return module.exports } })` |

### 为什么必须挂一行 host entry

`dsh-client-modules` 的 node 半边会遍历 live Loader entries,按 entry 的解析位置找到最近归属的
`package.json`,读它的 `dsh.client` 声明,把 `lib/client.js` 编进浏览器的 boot graph。

所以挂载一行 host entry 是**唯一**让浏览器半边到达的手段。这一行同时承担了本插件唯一需要
宿主能力的地方:读取持久化会话日志。它不进会话循环、不订阅任何事件、不改任何状态。

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

页面自身的形态(与 DSH 契约无关,只是交互取舍):日期/月份各是一个日历浮层(`Pickers.tsx`,
共用锚定浮层机制),日期筛选初值为本地**今天**;明细是唯一一张表,四列左对齐,费用 ¥/$ 同行;
分页 15 条由纯函数 `paginate` 决定,合计卡片始终覆盖**整个选择**(不是当前页)。

## 3. 数据流

### 3.1 聊天胶囊(逐回合,精确)

```
供应商 usage ──> token-meter 投影(分档,精确)
      └─> 客户端 chat 节点:TurnTailChatData.tokenUsage(+ routes:[{provider,model}])
              └─> 本插件:useChat(选择器)→ selectTurnUsage / selectTurnLocation / selectTurnNumber
                        ├─(有 tokenUsage)─> pricing.estimateTurnUsage(...) → 胶囊 + 明细面板
                        └─(没有 tokenUsage)─> usage-store(宿主路由) → 按 会话+回合号 取行
                                  └─> 同一套 estimateTurnUsage(...) → 胶囊(标题标注「按日志重算」)
```

**两条路径,先官方后兜底。** 核心的回合用量折算是「全有或全无」的:
`packages/llm/token-meter/src/turn-usage.ts` 只要遇到一次没有回报 `usage` 的尝试
(典型场景:请求失败 → `llm/retry` → 重试成功)、或发现 `turn/end` 之后还有事件,
就把整个回合的 `tokenUsage` 判为 `undefined`;`TurnTailNodeView` 用
`data.tokenUsage !== undefined` 决定是否渲染官方「用量」胶囊,所以**官方胶囊会整块消失**。

插件读的是同一个字段,因此同样会消失。选择**不改内核**、只在插件侧补:
`usage-store.ts` 用一条同源请求(30 秒 TTL、并发合并)拿到宿主折叠出的逐条回复,
按 `sessionId + turn` 精确定位本回合,再用**同一个** `estimateTurnUsage` 算价。
所以两条路径的数字口径一致,差别只在数据来源,并且回退值在标题(`cost.fold.title`)
与浮层备注(`cost.note.fold`)里都写明是重算值。

### 3.2 统计页(逐条计费项,来自持久化日志)

```
持久化会话日志($DSH_HOME/sessions/**)
   └─> host:ctx.sessionPersistence.list() → open(id,'read') → handle.read()
         └─> host/turn-fold.ts:事件 → 每次回复 + 每次压缩(窗口 / 模型 / 分档 token)
               └─> pricing.estimateTurnUsage(...) → GET /cost-stats/usage(JSON,TTL 缓存)
                     └─> client:fetch → stats-model(日/月键 + 合计 + 分页)→ StatsSection
```

### 3.3 标题右侧的余额(唯一会用到凭据的路径)

```
页面每次挂载(打开设置 → 费用统计)
   ├─> client/key-store.ts:load() ──> GET /cost-stats/keys          ← 一次/页面,只回名字
   │       └─> host/key-catalog.ts
   │             ├─ 凭据文件($DSH_HOME/.credentials.yaml)的 refs: 段 → **只读名字**(行解析)
   │             ├─ 各 profile 配置里的 apiKeyEnv: 名 → 供应商 id      ← 配置文件里只有名字
   │             └─ ctx.credentials.describe(ref) → 已配置 / 未配置(**永不返回值**)
   └─> client/balance-store.ts:load({ref}) ──> GET /cost-stats/balance?ref=<名字>
         └─> client/balance-store.ts:load({key}) ──> POST /cost-stats/balance   ← 手动粘贴时
               └─> host/balance-route.ts
                     ├─ isLocalRequest():peer 地址或 Host 非本机 → 403,且不碰凭据
                     ├─ 名字:ctx.credentials.resolve(<名字>)  ← **现取现用,不落盘、不缓存、不记录**
                     ├─ 手动:请求体里的 key(不进 URL),可选 credentials.set(名字, key) 写入 DSH 凭据库
                     ├─ GET https://api.deepseek.com/user/balance(8 秒超时)
                     └─ host/balance.ts:parseBalance() → **只回数字 + 名字**
                           └─> client/BalanceChip.tsx:余额 ¥5.50 / 查询中 / 未配置 / 失败(悬停带「来源:xxx」)
```

- **下拉里的名字从哪来**:`key-catalog.ts` 只做"发现"——凭据文件的 `refs:` 段(值从不读取,
  只取每行冒号前的名字)+ 各 profile 配置文件里声明的 `apiKeyEnv`(配置里出现的是引用名,不是密钥),
  再用 `describe` 问出配置状态。两个解析函数都是纯函数,单测按**真实文件形态**覆盖(含引号名、注释,
  没有 `refs:` 段的旧形态、被两个供应商共用的名字、以及"值不像名字"的行)。
- **页面显示的是「模型」的名字,不是凭据名(0.9.2)**:每一项还带一个 `label` —— provider 块里的
  `displayName`(读取范围严格限定在声明了该 `apiKeyEnv` 的那个块内,遇到缩进回到 provider 同级即停,
  所以不会借用下一个 provider 的 displayName);没有 displayName 时退回 provider id;
  连 provider 都没有(只在凭据库里出现的名字)才显示凭据名。
  唯一取不到的是**harness 自带**的 DeepSeek provider ——它的配置在 app 内、不是磁盘上的文件,
  因此有一张一行的内置表(`DEEPSEEK_API_KEY → DeepSeek`)。凭据名与配置状态移进选项的悬停提示,
  信息不丢。这样做是因为读者在「设置 → 模型」里认的是模型名(有的 profile 甚至把 displayName 写成 base URL),
  下拉与那一页逐字一致才不会让人怀疑"这是不是另一个东西"。
- **为什么缓存按 key 名分开**:同一个账号的两把 key 查出同一个数(接口是账号级的),但换 key 这件事本身
  必须立刻改口径 —— 所以页面与宿主两层缓存都以**凭据名**为键,手动粘贴的 key **完全不缓存**,点一次查一次。
- **为什么 key 不落插件**:插件是公开仓库,任何"把 key 存进插件配置"的设计都会随仓库泄露。
  名字类查询的 key 唯一来源是 DSH 自己的凭据服务(与模型配置同一份),宿主半边每次查询现场取用,
  用完立刻随作用域释放;手动粘贴的 key 只活在页面内存里,经同源 POST 交给本机宿主。
  唯一可能的落盘是读者**明确勾选**「存入 DSH 凭据库」——那写的是 **DSH 的**凭据文件,不是插件的地盘;
  `lib/` 产物、插件配置文件、路由响应、日志里都没有它。
- **为什么只对本机开放**:这两个路由是唯一触碰凭据的路径。判定是"一侧保守":能确证非本机(peer 地址或
  `Host` 头)就 403,而拿不到这两个信息的未知形态仍放行 —— 否则会在 DSH 的小版本升级中把功能弄坏,
  而 DSH 默认只监听回环地址这件事本身已经挡住了远程调用。
- **为什么手动 key 走请求体而不是查询串**:URL 会进浏览器历史、缓存键、Referer 与访问日志。
  请求体有 16 KB 上限,超限或非 JSON 都回一个可读的 `bad-request`。
- **为什么有 15 秒缓存**:打开设置页是人的动作,人可以在十秒里开五次。DeepSeek 的余额接口有速率限制,
  插件把它吸收掉而不是转发出去;"亲自点刷新"则用 `?refresh=1` 同时绕过页面与宿主两层缓存。
- **失败也要可读**:未配置 key、凭据服务不可用、401/403、网络失败、无法解析,各自有原因码与中文说明;
  上一次成功的结果会在刷新失败时继续显示,而不是把余额变成空白或 0。

- **为什么在宿主侧**:逐条历史只存在于持久化日志里;浏览器只有当前会话已加载的窗口。
  宿主读日志是唯一能覆盖"所有会话、全部历史"的位置,而且不需要激活任何冷会话。
- **逐次精确**:模型取该次回复的 `message.source.provider/model`(缺失时回退到最近一条 `model/selection`),
  高峰/空闲按该回合自身的 `turn/start`/`turn/end` 判定——比"按会话最近模型/最后活动"准。
- **压缩单独成行**:`compaction/summary` 是一次独立的模型调用(实测一次约 $0.2,高峰),
  它不属于任何回复,**官方「用量」胶囊也不显示它**。0.6.0 起折叠为 `FoldedCompaction`
  并生成 `compaction: true` 的行(`turn: 0`):钱 / 用量 / 会话数计入合计,但**不计入「回复」数**;
  胶囊兜底按 `sessionId + turn` 取行,并显式跳过它(否则压缩会被当成某个回复的价格)。
  这是「与账户余额对账」发现的缺口:不加这一项时,一次压缩就让复算比余额少 $0.2。
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
- **回合号也走选择器**(`selectTurnNumber`):它只在 `tokenUsage` 缺失时被用到,
  但必须与 `tokenUsage` 用同一套节点匹配规则,否则兜底会取错回合。
- `usage-store` 的快照引用只在发布时变化,所以 `useSyncExternalStore` 不会因每次渲染而重订阅;
  订阅与请求都在 `FoldChip` 这个**只在官方路径没算出价时才挂载**的子组件里 ——
  因此正常情况下(绝大多数回合)胶囊完全不接触这条链路,也不会因为兜底数据到达而重渲染。

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
| 官方用量缺失时**插件侧兜底**,不动内核 | 内核那条 `tokenUsage` 置空规则有它的道理(它只肯给"能证明"的总量),改它等于改官方语义与官方胶囊。插件侧兜底把"少一个胶囊"变成"多一个标注过的估算",且官方数据在时永远优先。代价:多一条同源请求(有 TTL 与并发合并),以及两条路径必须在 UI 上可区分(标题/备注已区分) |
| 兜底按 `sessionId + turn` 取行,不按时间或顺序 | 时间戳可能相同、回复数未必连续;只有"会话 + 回合号"是稳定键,取错行的代价比不显示更高 |
| 统计页**默认筛选 = 今天**,并且分页而是滚动全部 | 打开页面第一眼想看的是"今天花了多少",而不是全部历史;固定的每页 15 条让列宽与行高稳定,长历史也不会变成一堵墙。分页算术是纯函数 `paginate`(越界夹取在渲染期完成),所以换筛选不会出现空白页或少一帧 |
| **压缩单独成行**而不是悄悄并入附近回合 | 压缩不属于任何回合,却真实扣费(实测一次 $0.218)。并进某个回合会让那个回合的价格无法解释;单独一行 + 一个「压缩」标签,既让合计对得上账单,也不冒充回复。合计里它计入钱与用量、不计入「回复」数,同理 |
| 余额对账靠**脚本 + 人工读余额**,不自动调 API | 插件不持有、不读取任何凭据(这是它的硬边界)。代价是对账需要一个外部读数,收益是"零凭据"这条承诺可以原样成立 |
| 明细四列**统一左对齐**,费用 ¥/$ **同行** | 数值右对齐在只有一列数字时好看,但这里四列里有三列是文本/混合内容,混排会显得零散;¥ 与 $ 分两行会把每行撑高、其余单元格被 `vertical-align: top` 顶到上面 —— 左对齐 + 居中 + 同行,是这三件事同一个修法 |

## 5. DSH 升级时检查这 9 处

聊天侧(浏览器):

1. `packages/client/web/src/platform.ts` 的 `PLATFORM_MODULES` —— 与 `tsdown.config.ts` 里的同名常量保持一致;
2. `ui-chat` 的 `SlotMap` 中 `conversation.chat.assistant-actions` 是否仍为 list/session/`{messageId}`;
3. `TurnTailChatData.tokenUsage`(`TurnTokenUsage` 的分档字段与 `routes`)**与 `turn`**
   —— 兜底路径要在没有 `tokenUsage` 的情况下仍能读到回合号;
4. `TurnTailChatData.closing.finalNode.messageId`(选择器的匹配键);
5. `ui-settings` 的 `SlotMap` 中 `settings.section` 是否仍为 list/`root`,以及 register 选项里的 `label`(可为 thunk)语义。

宿主侧(统计页数据):

6. `ctx.sessionPersistence` 的 `list()` / `open(id, access)` / `handle.read()` 是否仍存在且返回 `{ events }`
   (`packages/session/session-persistence/src/index.ts`、`handle.ts`);
7. `ctx.webServer.register({ kind, path, handler })` 的签名与 `req`/`res` 形态(`packages/host/webserver`);
8. 会话头字段 `id` / `createdAt` / `cwd` / `delegationDepth`(`packages/session/session-format/src/types.ts`);
9. 持久化事件形状:`turn/start|end.data.turn`、`assistant/message.data.usage`、
   `assistant/message.data.message.source.provider|model`、`model/selection.data.provider|model`、`session/title.data.title`、
   **`compaction/summary.data.usage` + `.provider` + `.model` 与事件的 `time`**(压缩计费项的来源;
   事件本身没有 `data.turn`,所以窗口只能取 `event.time`)。

11. **凭据服务(0.8.0 新增,0.8.1 修正取法)**:`ctx.credentials.resolve(ref) → { value, source } | undefined`,其中 `ref` 是
    "POSIX 环境变量名"形式的引用(`packages/credentials/credentials/src/types.ts` 的 `CredentialRef`),
    DeepSeek 用的名字就是 **`DEEPSEEK_API_KEY`**;默认实现 `credentials-local` 存于本机私有 YAML,
    **环境变量优先**。同一族还有 `describe(ref)`(只回答"配了没",永不返回值)与 `set/unset`。

     **0.9.0 起用到同族的另外两个成员**,并在 DSH `0.2.0-rc.2` 上实测过:`describe` 存在并返回配置状态
     (`GET /cost-stats/keys` 因此能列出名字而不取值),`set` 存在并可写(`POST /cost-stats/balance`
     带 `remember` 时返回 `remembered: "saved"`,写入后清单立刻出现该名字)。两者都是**可选能力**——
     缺失时分别退化为"按文本证据判断"与 `remembered: "unsupported"`,不会让余额查询本身失败。
     `describe` 的返回形态做成了宽容解析(`boolean` / `{configured}` / `{set}` 三种都认,认不出即 `unknown`)。
     另外:接受的名字必须匹配 `^[A-Za-z_][A-Za-z0-9_]{0,63}$`,粘贴的值必须无空白且长度在 8–512 之间——
     校验在**碰凭据服务与网络之前**完成,所以一个带换行的粘贴不会变成一次失败的请求。

    ⚠️ **取法有坑(0.8.1 踩过)**:cordis 的 context 是 Proxy,它的 `get` 陷阱对**未被本插件 `inject` 声明的服务**
    会抛 `cannot get property "<name>" without inject`(`vendor/cordis/src/reflect.ts:144`)。
    DSH 里 `credentials` 由兄弟插件 `credentials-local` 提供,所以 `ctx.credentials` 这种自然写法**必然抛错**。
    非抛错的取法是 **`ctx.get(name, false)`**(`ReflectService.get` 的非严格模式,miss 时返回 `undefined`),
    其次是 `ctx.reflect.get(name, false)`。本插件三种依次尝试,并**故意不把 `credentials` 写进 `inject`**:
    注入失败会导致整个插件不挂载,而余额只是页面上的一个装饰 —— 少了它应该降级显示"读不到 key",
    而不是让统计页一起消失。

    实测(真实 cordis 运行时、服务由兄弟插件提供):裸属性访问抛错;`ctx.get` / `ctx.reflect.get` / `ctx.inject` 均可;
    端到端(真实凭据 + 真实接口)HTTP 200 且响应体不含 key。

前 5 处任一变化,`pnpm run smoke` 会先失败(它断言注册 id、插件形状、两个插槽名与真实算价);
第 6–9 处会先由 `tsc` 报错(镜像类型),再在真机上表现为统计页报错或行数变少 —— 用 `pnpm run verify:balance` 可直接定位到折叠层;
第 11 处(凭据服务)失效时,余额胶囊会显示"未配置 API key",统计页其余部分照常工作。

14. **浏览器侧的 locale 服务(0.9.3 踩过)**:字典靠 `ctx.get('locale')` 取服务后 `register(NS, {zh, en})` 发布。
    但**严格取法**对没写进 `inject` 的服务答"没有" —— 第 11 条那个 cordis 坑的浏览器版。
    后果非常"安静":字典没注册上,框架的翻译函数就把 **key 原样返回**,设置页于是显示
    `stats.title` / `stats.key.query`(而导航项正常,因为它走的是插件自带的字典 thunk)。
    两条纪律:① 取服务一律用 `ctx.get(name, false)`(或 `ctx.reflect.get`),注册本身也要 try/catch;
    ② 插件**不能假定**字典一定注册成功 —— `withFallback(t)` 把"翻译结果 === key"当作一次 miss,
    回退到自带字典,于是最坏情况是"语言不对",而不是"满屏标识符"。
    `locale` 仍然不写进 `inject`:没有该 provider 的宿主应当照常挂载。
    回归测试:`tests/locale-service.spec.ts`(取法与兜底)、`tests/render-dom.spec.tsx`(用"只回显 key"的
    翻译函数渲染入口组件,整页仍须是中文)、冒烟脚本(字典必须经非严格取法注册成功;回显翻译函数下不得出现原始 key)。

10. **会话格式 v4(0.1.7-rc.2 复核新增)**:0.1.7 引入 `session-format-v3-to-v4`
    (工具结果提升为工具角色、重命名生产者来源、补齐中断回合、追加父目录事实)。
    复核结论:插件**不需要改折算逻辑**——宿主路由走 `sessionPersistence`(与格式无关),
    而实测同一会话的 v3/v4 两份日志在共同回合上**逐条数字完全一致**;
    `assistant/message.data.usage`、`message.source.provider|model`、`compaction/summary`、
    `session/end-seed`、`model/selection` 与顶层 `session` 头字段在 v4 中均保持。
    唯一受影响的是**诊断脚本的文件名过滤**:v4 会与 v3 并存,只扫 `session.v3.*` 会漏掉正在写入的那份,
    因此 `verify-balance` / `verify-fold-paths` 都按 `session.v*.jsonl*` 读取所有代际。
    升级到 0.1.7 时还应顺带确认:`TurnTailChatData.tokenUsage` 仍在
    (`packages/client/ui-chat/src/client/contract/chat-nodes.ts`),官方胶囊在 0.1.7 起受
    「性能与用量 = 详细」模式控制,而本插件渲染在 `extraActions`,不受该模式影响。

12. **凭据清单与三个路由(0.9.0 新增)**:
    - `credentials-local` 的存储格式:`$DSH_HOME/.credentials.yaml` 是 `version` / `records`
      (不透明,内含浏览器会话密钥、账号 token)+ `refs:`(纯 API key 的 **名字 → 值**)。清单只解析
      `refs:` 段的**名字**,用"缩进回到同级即结束"界定该段;没有 `refs:` 段的旧形态退化为顶层平面映射,
      并显式排除 `version`/`records`/`kind`/`payload`/`id`/`secret`/`token`/`issuer` 这些结构键。
    - 供应商声明:各 profile 的 `cordis.patch.yml` 里 `providers.<id>.apiKeyEnv: <名字>`;
      供应商 id 由"向上找最近的、缩进更浅的裸键行"得到(不是 `displayName`,它常被写成 URL)。
    - 路由三个:`GET /cost-stats/usage`、`GET /cost-stats/keys`、`GET /cost-stats/balance`
      (`packages/host/webserver` 的 `register({kind,path,handler})`)。0.10.0 起余额路由**只接受 GET**:
      页面无法提交 key,所以没有请求体可读,也就没有"把密钥塞进请求"的路径。
    - 失效时的表现:清单为空 → 下拉只剩「全部」+ 手动配置的 provider(功能不消失);`describe` 缺失 → 见第 11 条。

15. **登录账号的余额(0.12.0 新增,走 DSH 自己的账号服务)**:官方 `/user/balance` 只认 API key,
    而「DeepSeek 账号」是**登录账号**,凭据是登录令牌(存在凭据库 `deepseek-account-platform/default`
    的 `payload.token`),实测拿它问官方接口得到 `401 Authentication Fails, Your api key … is invalid`。
    它的余额由 DSH 的宿主服务 **`ctx.deepseekAccount`** 提供(与「设置 → 账号与余额」同一来源):

    ```
    getBalance({ version, locale, timezoneOffsetSeconds })
      -> { status: 'ready', value: [{currency,balance}], bonusWallets: [{currency,balance}] }
    ```

    `value` 是充值余额、`bonusWallets` 是赠金余额(两项相加即那一页显示的口径)。
    **这两个事实(服务名与调用形状)是实测出来的**,不是读源码得到的 —— 打包后的 app 里源码不可读,
    于是用一次性探针插件在临时实例上做:① 逐个试候选服务名,发现 `deepseekAccount`;
    ② 打印它的原型方法名,找到 `getState/getProfile/getBalance`;
    ③ 用一个"记录字段访问"的 Proxy 当参数,从报错里反推出它要 `{version, locale, timezoneOffsetSeconds}`。
    用法上仍是第 11 条那套**三路非严格取法**,并且**完全不碰凭据服务**(有测试钉住 `resolve` 未被调用)。
    `status !== 'ready'`(例如未登录)时,把状态原文带进可读原因;服务不存在时同样降级为一句人话。
    这是本插件唯一一处依赖 DSH **未文档化**的内部服务:它被完整镜像 + 全程可选,
    DSH 若改动它,表现为"账号余额读不到",其余功能不受影响。

13. **浏览器侧的保留 prop(0.9.1 踩过,务必记住)**:React 会把 `ref` 从 props 里摘走,函数组件**根本收不到**;
    传**字符串** ref 时 React 18 在 `coerceRef` 里直接抛:
    ```
    Error: Function components cannot have string refs. We recommend using useRef() instead.
    ```
    这个异常被本插件的错误边界接住 → **设置页整块空白、而导航项照旧在**(注册成功了),极难自查。
    而只做桩渲染的冒烟测试**不会**发现:它的迷你渲染器不实现 ref、不重渲染、不跑 `act`。
    因此有两条纪律:① 插件自己组件的 prop **永远不要叫 `ref`**(用 `selectedRef` 这类名字);
    ② 改完界面必须跑 `tests/render-dom.spec.tsx`(真 React + jsdom,断言 `console.error` 为空),
    冒烟脚本里也有一个"保留 prop 警察"遍历桩树,断言没有字符串 ref、也没有函数组件收到 ref。

## 6. 测试策略

| 层 | 工具 | 覆盖 |
|---|---|---|
| 计费纯函数 | `vitest`(`tests/pricing.spec.ts`) | 别名/改路规则、高峰窗口边界(含 12:00、周末、跨时区)、三档金额、混用模型、无路由不猜 |
| 日志折叠 | `vitest`(`tests/turn-fold.spec.ts`) | 头部/标题、回合窗口、多尝试累加、`message.source` 优先与 `model/selection` 回退、非法用量整条丢弃、无人认领的 usage、`assistant/attempt` 重试、未知事件容错、**压缩折叠(独立计费项 / 自带路由 / 非法用量丢弃 / 无路由不猜)**、**分叉继承段(按接缝跳过 / 只按 handle 切点跳过 / 无接缝整份不计 / 非 seeded 不受影响)**、**会话格式 v4(顶层 v4 头 / 忽略工具角色与系统消息 / 与 v3 数字一致 / v4 的分叉接缝)** |
| 统计模型 | `vitest`(`tests/stats-model.spec.ts`) | 日/月键、合计(回复/压缩分开计数、会话数、子代理、未计价、金额、用量)、空选择返回 0、分页(切页/越界夹取/非正数与 NaN/空选择/每页 0 条) |
| 兜底缓存 | `vitest`(`tests/usage-store.spec.ts`) | 并发三次只发一次请求、TTL 内复用 / 过期重取、`?refresh=1`、失败保留旧数据并记录错误、非 2xx 视为错误、按 `会话+回合` 查找(不串会话、**不取压缩行**)、订阅与退订 |
| 产物契约 | `node scripts/smoke-client-bundle.mjs` | bundle 注册 id = 包名、工厂返回 `inject`/`apply`、两个插槽各注册一项、导航 label 非空、**两个条目的渲染抛错都被隔离成 null**、胶囊对真实分档算出 `≈¥5`、无路由不渲染、统计页发起宿主请求、**官方用量缺失时首屏不渲染 → 兜底拿到数据后渲染 `≈¥5` → 标题标注为「按日志重算」→ 不借用其他会话的行**、**统计页挂载即请求余额路由 → 重开页面时余额数字已就位 → 余额文本里不出现任何 `sk-…` 形状的字符串**、**挂载即请求 key 清单 → 重开页面时下拉渲染出配置过的名字 → 按钮为「查询KEY余额」→ 余额请求带 `ref=<名字>` 且是 GET 无请求体 → 胶囊标题写明「来源:xxx」→ 页面与请求里都没有 `sk-…`** |
| 余额与凭据 | `vitest`(`tests/balance.spec.ts`、`tests/api-key.spec.ts`) | 金额字符串解析与非法条目丢弃、`is_available: false` 传递、币种齐全、仅本机守卫(回环各种写法 / 外部 peer / 外部 Host / 未知形态)、凭据缺失与抛错的降级、**key 只出现在 Authorization 头且失败信息里不含 key**、缓存与 `?refresh=1`、刷新失败时保留上次好数据、非本机请求 403 且不调用凭据服务、**按名字取值 / 按名字隔离缓存(换 key 不串数字)/ 非法名字与非法值的提前拒绝 / POST 请求体解析(含坏 JSON)/ 手动 key 不缓存与不回显 / `describe` 三种形态与缺成员·抛错 / `set` 的 saved·unsupported·failed** |
| key 清单 | `vitest`(`tests/key-catalog.spec.ts`) | 只读 `refs:` 段的名字 / 段结束即停 / 引号与注释 / 无 `refs:` 段的平面形态 / `apiKeyEnv` 与供应商识别 / 被共用的名字去重 / 非名字的值被忽略 / 合并规则(默认第一、来源优先、供应商补全、无 `describe` 时按文本证据、非法名字丢弃)/ 载荷里没有 `sk-` |
| key 选择与缓存 | `vitest`(`tests/key-store.spec.ts`) | 建议名跳过已占用 / 只记**名字**(存储里不出现 `sk-` 形状)/ 存储不可用时抛错仍安全 / 按名字查询且 URL 只带名字 / 同名字合并并发、不同名字各自缓存 / 手动 key 走请求体且两次点击发两次请求 / `refresh=1` / 网络失败降级为载荷 |
| **真 React 渲染** | `vitest` + **jsdom**(`tests/render-dom.spec.tsx`) | 用真 React 18 + 真 DOM 把设置页整页渲染出来:文字与下拉选项都在(=**没有被错误边界兜掉**)、下拉的选中值确实是那把 key、下拉文本是模型名而非凭据名、**用"只回显 key"的翻译函数渲染入口组件时整页仍是中文**、`console.error` **一次都没被调用**。补住"迷你渲染器不实现元素语义"的盲区:0.9.1 的保留 prop 事故就是它抓出来的(见 §5 第 13 条) |
| **locale 取法与兜底** | `vitest`(`tests/locale-service.spec.ts`) | 只用 `ctx.get(name, false)` 取服务并断言**从不调用严格形式** / `ctx.reflect.get` 与属性两种后备 / 恶意 context 不抛错 / 活动语言取不到时安静降级 / `withFallback` 对"回显 key""空串""真翻译""自己不认识的 key"的行为 / 翻译函数抛错不被吞掉(仍交给边界) |
| **账号余额** | `vitest`(`tests/account-balance.spec.ts`) | 只用非严格取法拿 `ctx.deepseekAccount`(并断言传了 `false`)、reflect/属性后备、恶意 context 不抛错;`{status:'ready', value, bonusWallets}` 的映射(充值 + 赠金 = 总额、多币种、只有赠金、坏行丢弃);非 ready 状态把原文带进可读原因;不可读答案;请求形状(`version/locale/timezoneOffsetSeconds`);抛错消息**单行且有上限**;路由 `?account=1` **不调用凭据服务**;失败时保留上次好数据 |
| 独立复算 | `node scripts/verify-balance.mjs` | 绕过宿主直读日志复算全部会话累计,并与 API 余额的差值对账(2026-09-11 实测 Δ$0.249 vs 余额 Δ$0.25) |
| **双入口一致性** | `node scripts/verify-fold-paths.mjs` | 对每份真实日志(**所有代际**:v3 与 0.1.7 起的 v4 并存)用两种输入各折一遍(有头部→自行找接缝;无头部+`inheritedEventCount`→路由形态)并逐条比对。0.7.1 曾只在第一种形态下正确,页面仍重复计费;这道门就是为那类「离线通过、真机不一致」而加的 |
| **格式升级对账** | `node scripts/verify-fold-paths.mjs` + 一次性探针 | 0.7.3 适配 0.1.7 时,对同一会话的 v3/v4 两份真实日志逐回合比对:共同回合**全部一致**,v4 只是多了升级后的新回合 —— 这才是「格式升级没有改变历史数字」的证据,而不是口头保证 |
| 真机 | 手动 | 重启 `dsh web` **并硬刷新浏览器**:核对胶囊与原生用量弹窗的分档一致性、统计页逐条明细与合计 |
