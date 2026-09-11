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
| **设置页「费用统计」** | 设置 → **费用统计**(在「侧边卡片」之后):按**日 / 月 / 全部会话**查询,列出每个会话的用量与费用,点日/月行即可筛到该桶;顶部**费用合计**跟随查询变化 |
| **绝不编数字** | 拿不到路由归属(不知道用哪个模型计费)或模型无官方公示价时,**胶囊不显示**、统计页标 `无价目` 且不计入合计,而不是显示 0 或猜测值 |
| **不碰官方控件** | 两个条目都包在**错误边界**里:本插件渲染出错只会让自己那一块消失,绝不牵连同一行的复制/反馈/分支/用量/用时控件,也不影响设置面板内容列(冒烟脚本里有专门的"抛错必须被隔离"断言) |
| **零网络、零凭据** | 完全在浏览器里算;不发请求、不读 API key、不写入任何后端 |
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

- **顶部查询**:`按日` / `按月` / `全部会话` 三个切换,外加"取消选择"。
- **费用合计卡片**:始终跟随当前查询 —— 选中某一天/某一月时就是那一天/那一月的合计;显示 ¥ 主、$ 次,以及会话数、用量、
  子代理数、未计价条数。
- **分桶表**(按日/按月模式):日期或月份 / 会话数 / 用量 / 费用,点任意一行把下方明细筛到该桶,再点一次取消。
- **会话明细表**:时间(`MM-DD HH:mm`)、会话标题(带 `子代理` / `进行中` / `无价目` 标记)、用量、费用(¥ 主 / $ 次)。
- **页脚说明**:把"这是估算、按会话计价、子代理独立、跳过多少条无投影会话"都写在页面上,而不是藏在文档里。

### 数据来自哪里(以及为什么不用激活会话)

每个会话的用量取自**宿主已经算好的会话投影**,挂在客户端会话列表的每一行上:

| 字段 | 投影 | 用途 |
|---|---|---|
| 分档 token | `tokenUsage`(未缓存输入 / 缓存读取 / 输出 / 缓存写入) | 计价的三档 |
| 模型归属 | `modelSelection.lastUsed`(回退 `next`) | 决定用哪张价目表 |
| 最后活动时刻 | `updatedAt` | 按日/按月分桶与高峰/空闲归类 |
| 会话类型 | `origin === 'subagent'` | 单独成行并打标 |

好处:统计页覆盖**整个会话列表**,包括从未打开过的冷会话——因为不需要加载它们的聊天历史,也不需要唤醒它们。
代价是粒度:见下节边界。

---

## 🔍 与账户余额核对

想验证算得准不准,可以这样做:

1. 在**设置 → 费用统计**里读合计的 **$ 金额**(它覆盖所有会话,最适合和余额对账);或读聊天里某个回合胶囊的 `$`;
2. 与 API 平台余额的变化量对比(**余额以美元计**,所以看 `$` 那一栏,不要直接拿 `¥` 去比);
3. 注意口径:余额变化包含插件**不计入**的部分(压缩请求、标题生成、以及任何没有用量投影的会话),以及仍在进行的请求。
   所以 `余额下降 ≥ 插件合计` 是正常的;若余额下降**远大于**插件合计,通常说明这段工作大量使用了子代理会话。

人民币与美元的官方价目表相差约 7 倍(Flash 未缓存输入:¥1 ↔ $0.15),这是官方两套公布值,不是本插件做了汇率换算。

---

## 🛠️ 开发

```sh
pnpm install
pnpm run typecheck   # tsc --noEmit
pnpm test            # 28 项单测:计费/时段/别名规则 + 会话聚合/日周月分桶/合计(vitest)
pnpm run build       # lib/index.js(host 半边) + lib/client.js(浏览器半边)
pnpm run smoke       # 产物契约冒烟:在 Node 里跑 client.js,验证注册 id / 插件形状 / 两个插槽 / 真实算价 / 抛错隔离
pnpm run verify      # typecheck + test + build + smoke
pnpm run watch       # 开发时增量重建(配合 dsh 的 client HMR)
```

`pnpm run smoke` 是这个项目里最有用的一道门:**不需要浏览器、不需要重启 DSH**,就能证明 `lib/client.js`
①以**包名**注册了工厂、②导出了 `inject`/`apply`、③把胶囊注册进 `conversation.chat.assistant-actions`、
④把统计页注册进 `settings.section`、⑤对真实分档数据算出正确金额、⑥对无法计价的数据不渲染、⑦两个条目的渲染抛错都被隔离成"不显示"。
改了计费逻辑或页面结构先跑它。

### 目录结构

```
src/
  pricing.ts              计费模型:价目表、别名与改路规则、高峰窗口、cost 计算、金额格式化(纯函数,单测覆盖)
  index.ts                host 半边:空 cordis 插件(只是为了成为一行 live Loader row)
  client/
    index.tsx             浏览器半边:注入样式、注册字典、注册两个插槽条目(胶囊 + 统计页)
    CostChip.tsx          费用胶囊 + 明细面板(portal + 定位 + Esc/外部点击关闭)
    StatsSection.tsx      设置页「费用统计」:查询切换、合计卡片、日/月分桶表、会话明细表
    session-costs.ts      会话级聚合(纯函数):会话 → 已计价行 → 日/月分桶 → 合计/筛选
    select.ts             从聊天快照里取回合用量与时间窗的选择器(必须返回存储引用,避免逐 chunk 重渲染)
    contract.ts           本插件读取的 DSH 浏览器契约的镜像类型(见下)
    Boundary.tsx          错误边界:让插件的渲染失败只影响自己那一块
    locales.ts            中英字典 + 内置中文兜底
    styles.ts             插件自有样式(仅消费 DSH 设计令牌)
cordis.patch.yml          bundle patch:把本包挂成 profile 的一层
tsdown.config.ts          产出 host 半边(ESM)与浏览器半边(CJS 闭包工厂)
scripts/
  install-local.mjs       本地 link 安装 + bundles 对账
  smoke-client-bundle.mjs 产物契约冒烟(无浏览器)
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
  想看全部会话,用**设置 → 费用统计**(它走宿主投影,不需要加载聊天历史)。
- 统计页是**会话**级:金额按该会话**最近使用**的模型计价,中途换过模型的会话是近似值;高峰/空闲按会话**最后活动时刻**归类。
  逐回合的精确视图仍是聊天里的费用胶囊。
- 统计页对没有任何用量投影的会话(从未跑过请求、或宿主还没投影)会计数并显示"未纳入",不会伪装成 0。
- 只在 DeepSeek 官方路由(`provider` 含 `deepseek`)上有价目;第三方 provider 在统计页显示 `无价目` 且不计入合计。
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
