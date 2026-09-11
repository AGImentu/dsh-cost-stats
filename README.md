# dsh-session-cost

**在 DeepSeek Harness 的每条助手消息旁,显示这次对话花了多少钱。**

一个纯客户端的 DSH Web 插件:在消息尾行的原生「用量 612K tok」胶囊旁边,加一个 `≈¥0.709` 的费用胶囊;
点开可以看到这一次对话的分档明细、计费模型、高峰/空闲时段,以及本次会话的累计费用。

> 数据来源与原生「用量」弹窗**完全同源**(供应商上报的 token 分档),不是估算 token 再套平均价;
> 价格用官方公布的两套价目表(人民币 + 美元),含旧模型名的计费归属与 2026-09-14 的 v4-pro 改路规则。

---

## ✨ 功能

| | |
|---|---|
| **每条消息一个费用胶囊** | 位置在复制键与分支键之间(原生「用量」胶囊的左侧),显示 `≈¥0.709`,跟随 DSH 主题令牌与字号设置 |
| **点击展开明细** | 计费模型 / 计费时段 / 缓存命中率 / 未缓存输入·缓存读取·输出 三项「token × 单价 = 金额」/ 合计(¥ 与 $ 同时给出) |
| **本次会话累计** | 面板底部给出**已加载回合**的累计费用(¥ 与 $),便于和账户余额变化对照 |
| **设置页「费用统计」** | 设置 → **费用统计**(在「侧边卡片」之后):**日历选日期 / 日历选月份**(互斥,另有清除与刷新),**逐条列出每一次回复**的时间/会话/用量/费用;顶部**费用合计跟随查询**。数据由插件自己的宿主路由折遍所有会话日志得到 |
| **绝不编数字** | 拿不到路由归属(不知道用哪个模型计费)或模型无官方公示价时,**胶囊不显示**、统计页标 `无价目` 且不计入合计,而不是显示 0 或猜测值 |
| **官方数据缺失时自动兜底** | DSH 核心的回合用量是「全有或全无」:一次重试请求没回报用量,官方「用量」胶囊就会整块消失(插件读的是同一个字段)。此时胶囊改用**插件自己的宿主侧日志重算**补上,并在标题与浮层里标注「按日志重算」,不与官方口径混淆;官方数据正常时永远优先用官方值 |
| **不碰官方控件** | 两个条目都包在**错误边界**里:本插件渲染出错只会让自己那一块消失,绝不牵连同一行的复制/反馈/分支/用量/用时控件,也不影响设置面板内容列(冒烟脚本里有专门的"抛错必须被隔离"断言) |
| **零凭据、零外网** | 不读 API key、不写任何后端、不访问外部网络。唯一的请求是发往**本机 DSH 自己**的插件路由(`GET /session-cost/usage`,同源),且只在「统计页打开」或「官方数据缺失需要兜底」时发生 |
| **中英双语** | 字典跟随 DSH 界面语言(`locale` 命名空间 `session-cost`) |
| **无内核改动** | 只使用 DSH 公开的插件插槽 `conversation.chat.assistant-actions`、`settings.section` 与平台种子模块(`react` / `react-dom`) |

---

## 📦 安装

前置:DSH 已能正常运行(`dsh web` 起得来),`~/.dsh/profiles/<profile>` 已初始化。默认 profile 名是 `web`。

### 方式一:官方 CLI(推荐,从 npm 安装)

```sh
dsh plugin --profile web add dsh-session-cost
```

### 方式二:从源码/克隆安装(`link:`,便于本地改代码)

```sh
git clone https://github.com/<you>/dsh-session-cost && cd dsh-session-cost
pnpm install
pnpm run build
node scripts/install-local.mjs --profile web
```

`install-local.mjs` 做两件事,与 `dsh plugin` 的语义一致:`pnpm add link:<克隆目录>` + 按已安装状态对账 `dsh.profile.bundles`(声明了 `dsh.bundle.patch` 的依赖追加为 bundle 层)。它是幂等的。

### 装完必须做的一步

**重启 `dsh web`,然后硬刷新浏览器(Ctrl/Cmd+Shift+R)。**
新 bundle 行只在 profile 启动时装载,刷新页面不够。

---

## 🧮 它怎么算

### 价目表(官方公布值,单位:元 或 美元 / 百万 token)

| | 缓存命中(空闲/高峰) | 未缓存输入(空闲/高峰) | 输出(空闲/高峰) |
|---|---|---|---|
| **DeepSeek-V4.1-Flash**(`deepseek-flash`) | ¥0.02 / ¥0.04 | ¥1 / ¥2 | ¥4 / ¥8 |
| **DeepSeek-V4-Pro-0813**(`deepseek-v4-pro`) | ¥0.15 / ¥0.30 | ¥4.5 / ¥9 | ¥13.5 / ¥27 |

美元表同样内置(Flash:`$0.003/0.006`、`$0.15/0.3`、`$0.6/1.2`;Pro:`$0.022/0.044`、`$0.66/1.32`、`$1.98/3.96`)。
**两套表是官方各自独立公布的,不是换算关系**,所以面板把两个数都给出来。

### 模型名 → 计费归属

| 请求的模型名 | 按哪个模型计费 |
|---|---|
| `deepseek-flash` | V4.1-Flash(规范名) |
| `deepseek-v4-flash`、`deepseek-v4-flash-vision-exp` | **V4.1-Flash**(旧名已下线,请求仍可用但由 V4.1-Flash 提供服务并按 Flash 计费) |
| `deepseek-v4-pro` | V4-Pro-0813;自**北京时间 2026-09-14 12:00** 起改路由到 V4.1-Flash 并按 Flash 计费 |
| 其他 provider / 模型 | 无公示价 → 胶囊不显示 |

### 高峰时段

北京时间 **周一至周五 09:00–12:00 与 14:00–18:00**(窗口右端点不含:12:00 已属空闲);其余时间与周末为空闲。
面板按**回合起始时刻**归类,并在跨时段时明确标注。

### 精度边界(重要,如实列出)

1. **token 分档是精确的**——供应商上报值,与原生用量弹窗逐位一致;金额 = 分档 token × 单价,没有二次估算。
2. **跨高峰边界的回合**按起始时刻计价(DSH 的回合用量是聚合值,不含逐次请求时间戳),面板会标注。
3. **一个回合内混用了多个计费模型**时无法把 token 拆到各模型,按其中**最高价**估算上界,面板会标注。
4. **子代理、后台会话、压缩(compaction)请求不计入**——它们属于各自的会话/账目,不在当前对话的回合用量里。
5. **这是估算值,不是账单**:不含四舍五入、促销、provider 侧的最终结算细节。
6. **缓存写入**:官方价目表没有独立的缓存写入档(写入按未缓存输入计费),所以不单独计价。

---

## 📊 费用统计页(设置 → 费用统计)

注册进 DSH 设置面板的 `settings.section` 插槽,导航位置排在「侧边卡片」之后(同一个设置面板,不是弹窗套弹窗)。

- **两个日历选择器**(不是选项卡):
  - **选择日期** → 周一开头的日历(6×7 网格、可翻月、「今天」有标记),点某一天 → 下方只显示那一天的明细;
  - **选择月份** → 12 个月 + 可翻年的月份网格,点某个月 → 下方只显示那个月的明细;
  - 有数据的日期/月份在网格里**加点**显示,没数据的日子也能点(显示空态);两者互斥,另有「清除筛选」。
- **费用合计卡片**:标注当前范围(`费用合计 · 2026-09-11` / `· 2026-09` / `· 全部时间`),
  显示 ¥ 主、$ 次,以及 回复数 / 会话数 / 用量 / 子代理数 / 未计价数。
- **一张明细表**:每条助手回复一行 —— 时间(`MM-DD HH:mm`)、会话(带 `子代理` / `无价目` 标记)、用量、费用(¥ 主 / $ 次);
  悬停会话名可看到 `会话 · #回合 · 计费模型`。页面没有第二张汇总表,所以不存在两套口径。

### 数据来自哪里

统计页读的是**插件自己的宿主路由** `GET /session-cost/usage`。宿主半边会:

1. `ctx.sessionPersistence.list()` 枚举存储里的会话(取最近的非空会话);
2. 逐个打开并读取**完整持久化日志**(`open(id,'read')` → `handle.read()`);
3. 用 `src/host/turn-fold.ts` 把日志折叠成逐次回复:回合窗口(`turn/start`/`turn/end`)、
   该次回复实际使用的 `message.source.provider/model`(缺失时回退到最近一条 `model/selection`)、
   以及 `assistant/message`(与重试的 `assistant/attempt`)里的分档 usage;
4. 用与聊天胶囊**完全相同**的价目表与高峰窗口逐条计价,按 TTL 缓存后返回 JSON。

因为走的是持久化日志(而不是浏览器已加载的聊天窗口),页面能覆盖**所有会话、全部历史**,不需要激活任何冷会话。
逐条明细与日/月合计用的是同一批数字,所以合计不会有第二套口径。

---

## 🔍 与账户余额核对

两条路,建议用第一条(我做完 v0.3.0 时就是这么验的):

**A. 独立复算脚本(推荐)**

```sh
pnpm run build
node scripts/verify-balance.mjs 2026-09-11T11:07 2026-09-11T12:20
```

它绕过宿主、直接解码 `$DSH_HOME/sessions/**` 的会话日志,用同一套折叠与价目表复算,并给出你指定时刻的**累计值**;
把两次累计值相减,就是这段时间的真实花费,可直接与 API 余额的差值对比。

2026-09-11 的实测对齐结果:

| 时刻 | 账户余额 | 独立复算累计 | Δ |
|---|---|---|---|
| 11:07 | $9.03 | $3.50 | — |
| 12:20 | $8.78 | $3.75 | **$0.249** |

余额同区间下降 **$0.25** —— 与复算差值一致到 1 美分以内。

**B. 只看界面**

1. 在**设置 → 费用统计**里读合计的 `$`(选「按日」并点当天那一行,就是当天花费);或读聊天里某个回合胶囊的 `$`;
2. 与 API 平台余额的变化量对比(**余额以美元计**,看 `$` 那一栏,不要直接拿 `¥` 去比);
3. 口径提示:余额还会包含**标题生成、压缩**等少量模型调用,以及仍在进行的请求 —— 所以
   `余额下降 ≥ 插件合计` 是正常的。

人民币与美元的官方价目表相差约 7 倍(Flash 未缓存输入:¥1 ↔ $0.15),这是官方两套公布值,不是本插件做了汇率换算。

---

## 🛠️ 开发

```sh
pnpm install
pnpm run typecheck   # tsc --noEmit
pnpm test            # 35 项单测:计费/时段/别名规则 + 日志折叠 + 日历 + 逐条统计(vitest)
pnpm run build       # lib/index.js(host 半边:路由 + 日志折叠) + lib/client.js(浏览器半边)
pnpm run smoke       # 产物契约冒烟:在 Node 里跑 client.js,验证注册 id / 插件形状 / 两个插槽 / 真实算价 / 抛错隔离 / 宿主请求
pnpm run verify      # typecheck + test + build + smoke
pnpm run verify:balance   # 独立复算全部会话累计 ← 与 API 余额对账用
pnpm run watch       # 开发时增量重建(配合 dsh 的 client HMR;host 改动仍需重启)
```

`pnpm run smoke` 是这个项目里最有用的一道门:**不需要浏览器、不需要重启 DSH**,就能证明 `lib/client.js`
①以**包名**注册了工厂、②导出了 `inject`/`apply`、③把胶囊注册进 `conversation.chat.assistant-actions`、
④把统计页注册进 `settings.section`、⑤对真实分档数据算出正确金额、⑥对无法计价的数据不渲染、
⑦两个条目的渲染抛错都被隔离成"不显示"、⑧统计页确实向宿主路由取数。
改了计费逻辑或页面结构先跑它。

### 目录结构

```
src/
  pricing.ts              计费模型:价目表、别名与改路规则、高峰窗口、cost 计算、金额格式化(纯函数,单测覆盖)
  rows.ts                 宿主路由与统计页共享的 wire 类型(逐条回复行 / 载荷)
  routes.ts               路由常量(两半边共用,避免字符串漂移)
  index.ts                host 半边:注册 GET /session-cost/usage,并作为一行 live Loader row
  host/
    turn-fold.ts          纯折叠:持久化事件 → 每次回复(窗口 / 模型 / 分档 token)
    session-cost-index.ts 索引:枚举会话 → 读日志 → 折叠 → 逐条计价 → TTL 缓存
    contract.ts           host 侧契约镜像(sessionPersistence / webServer)
  client/
    index.tsx             浏览器半边:注入样式、注册字典、注册两个插槽条目(胶囊 + 统计页)
    CostChip.tsx          费用胶囊 + 明细面板(portal + 定位 + Esc/外部点击关闭)
    StatsSection.tsx      设置页「费用统计」:合计卡片 + 逐次回复明细表(单一列表)
    Pickers.tsx           两个日历选择器(选日期 / 选月份)+ 共享的锚定浮层
    calendar.ts           纯日历数学:周一为首的 6×7 网格、跨年月份平移、月份键解析
    stats-model.ts        统计模型(纯函数):日/月键 + 合计
    select.ts             从聊天快照里取回合用量/时间窗/回合号的选择器(必须返回存储引用,避免逐 chunk 重渲染)
    usage-store.ts        宿主数据的共享缓存(30 秒有效期、并发合并):胶囊兜底路径的唯一数据来源
    contract.ts           本插件读取的 DSH 浏览器契约的镜像类型(见下)
    Boundary.tsx          错误边界:让插件的渲染失败只影响自己那一块
    locales.ts            中英字典 + 内置中文兜底
    styles.ts             插件自有样式(仅消费 DSH 设计令牌)
cordis.patch.yml          bundle patch:把本包挂成 profile 的一层
tsdown.config.ts          产出 host 半边(ESM)与浏览器半边(CJS 闭包工厂)
scripts/
  install-local.mjs       本地 link 安装 + bundles 对账
  smoke-client-bundle.mjs 产物契约冒烟(无浏览器)
  verify-balance.mjs      独立复算(绕过宿主直读会话日志)← 余额对账
docs/architecture.md      接入契约与设计取舍
```

---

## 🧩 为什么不 import DSH 的内部类型?

`src/client/contract.ts` 里的类型是**镜像声明**而不是 import,这是刻意的:

- DSH 的客户端内部包(`@deepseek-ai/dsh-client-ui-chat` 等)在 npm 上的发布版本**远落后于运行中的 shell**(npm 上是 `0.1.2-alpha.x` / `0.0.1-rc.x`,而 shell 已是 `0.1.5-rc.2`),跟着 npm 版本写类型会描述一个并不存在的宿主;
- 因此本插件只依赖两样东西:**冻结的平台模块表**(`react` / `react/jsx-runtime` / `react-dom`)与**插槽契约**;
- 每个字段在运行时都做了防御性读取:DSH 版本换代删改字段时,退化为「不渲染胶囊」而不是崩溃。

契约锚点与更多设计取舍见 [`docs/architecture.md`](docs/architecture.md)。

---

## 🚀 发布到 GitHub / npm(清单)

- [ ] 填 `package.json` 的 `repository`(GitHub 地址)与 `author`
- [ ] `pnpm run verify` 全绿
- [ ] `git init && git add -A && git commit -m "feat: dsh-session-cost 0.1.0"`
- [ ] (可选)发布 npm:`pnpm publish --access public`(包名 `dsh-session-cost` 需可用)
- [ ] (可选)给仓库打 `dsh-plugin` / `deepseek-harness` topic,便于被发现
- [ ] 价目表变化时更新 `src/pricing.ts` 与 `tests/pricing.spec.ts`,并在 CHANGELOG 记录

---

## ⚠️ 已知边界

- 聊天面板的「本次会话」只统计**已加载到聊天窗口**的回合;更早的历史需要向上滚动加载后才会计入。
  想看全部历史,用**设置 → 费用统计**(它走宿主路由读持久化日志)。
- 统计页读取存储里**最近 120 个非空会话**的完整日志,按 TTL 缓存;读取失败或没有任何已计价回复的会话计入 `skipped`,不影响其余行。
- 统计页与胶囊都是**按官方价目表的估算**,不是账单:不含四舍五入、促销与 provider 侧最终结算细节;
  标题生成、压缩等少量模型调用不在折叠范围内(实测差值 < 1 美分)。
- 只在 DeepSeek 官方路由(`provider` 含 `deepseek`)上有价目;第三方 provider 标 `无价目` 且不计入合计。
- 统计页需要**宿主半边**加载(即需要重启过 `dsh web`);只刷新页面而没重启时,页面会显示"宿主侧路由不可用"。
- 极窄视口下胶囊跟随原生 stat pill 的收缩策略(本插件未额外做图标化折叠)。

## 📄 License

[MIT](LICENSE)

---

## English (overview)

`dsh-session-cost` is a client-only DeepSeek Harness Web plugin that shows the **cost of each assistant
turn** next to the native turn-usage pill, using the provider-reported token buckets (exact) and the
official published DeepSeek price tables in both CNY and USD. Clicking the chip opens an itemized panel
(billed model, peak/off-peak window, cache-hit ratio, uncached/cached input and output lines, turn total,
session total over the loaded turns). It renders **nothing** when a turn cannot be priced, makes no
network request, reads no credentials, and needs no core change — it registers into the documented
`conversation.chat.assistant-actions` slot and depends only on the frozen platform modules.

Install: `dsh plugin --profile web add dsh-session-cost` (or `node scripts/install-local.mjs` from a
checkout), then restart `dsh web` and hard-refresh the page.
