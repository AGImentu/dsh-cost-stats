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

| 项 | 值 | 出处 |
|---|---|---|
| 插槽 | `conversation.chat.assistant-actions`(kind `list`,scope `session`) | `packages/client/ui-chat/src/client/contract/slots.ts` |
| owner | `{ messageId }` | 同上 |
| 渲染位置 | `MessageIconActions` 的 `extraActions`(复制键与分支键之间;原生「用量/用时」胶囊在其右侧) | `.../chat/TurnTailNodeView.tsx`、`.../chat/MessageIconActions.tsx` |
| 组件 props | owner + 框架 standard kit(`useChat` 选择器 hook、`sessionId`、`useProjection`)+ `locale` 席位绑定的 `t` | `.../ui-renderer/src/client/scoped-slots.tsx`、`.../ui-chat/.../contract/slots.ts`(`SessionStandardProps` 合并) |
| 注册 API | `ctx.slots.inject(key, () => ctx.slots.register({ name, id, order, locale }, Component))`;服务名 `slots` | `.../ui-renderer/src/client/registry.ts`(`new SlotCore()`);对照实现 `ui-message-feedback/src/client/index.ts` |

## 3. 数据流

```
供应商 usage ──> token-meter 投影(分档,精确)
      └─> 客户端 chat 节点:TurnTailChatData.tokenUsage(+ routes:[{provider,model}])
              └─> 本插件:useChat(选择器)→ selectTurnUsage / selectTurnLocation
                        └─> pricing.estimateTurnUsage(...) → 胶囊 + 明细面板
```

- 选中 `turn-tail` 节点的方式:遍历 `snapshot.nodes.values()`,匹配
  `data.closing.finalNode.messageId === <本行 owner 的 messageId>`。
- **选择器必须返回存储引用**(节点里的 `tokenUsage` / `location` 对象)或原始值。
  快照选择器按引用比较,返回新对象会导致每个流式 chunk 都重渲染。
- 会话累计在**面板**里折叠(`collectLoadedTurns` + `useMemo`,依赖 `snapshot.order` 的引用变化),
  不在胶囊的每次渲染里做,避免流式期间的无谓开销。

## 4. 设计取舍

| 取舍 | 理由 |
|---|---|
| 类型用**镜像声明**而非 import | npm 上的 DSH 客户端内部包版本严重滞后(`0.1.2-alpha.x`/`0.0.1-rc.x` vs shell `0.1.5-rc.2`),import 它们等于把插件钉在一个并不存在的宿主上。镜像 + 运行时防御读取 → 字段消失时退化为"不渲染" |
| 只依赖 `react` / `react/jsx-runtime` / `react-dom` | 三者都在 shell 的冻结模块表种子(`packages/client/web/src/seed.ts`);其余一律不引,所以不会被内部包版本卡住 |
| 样式用**纯 CSS 字符串 + `data-plugin` 标签** | 官方 CSS Modules 能力在 DSH 的 tsdown 预设里,外部工程无法 import;本插件样式很小,类名哈希收益为零 |
| 面板用 `createPortal` + 视口钳制定位 | 与核心 stat 弹窗一致(`ui-chat/.../stat-dialog.module.css` 的皮肤),避免被聊天列的滚动容器裁剪 |
| `order: 20` | 排在核心反馈条目(order 10)之后;原生用量/用时胶囊不是 list 条目,所以本插件独占插件单元格 |
| 无设置界面(v1) | 价目表随代码走,升级即更新;少一层状态持久化 |

## 5. DSH 升级时检查这 5 处

1. `packages/client/web/src/platform.ts` 的 `PLATFORM_MODULES` —— 与 `tsdown.config.ts` 里的同名常量保持一致;
2. `ui-chat` 的 `SlotMap` 中 `conversation.chat.assistant-actions` 是否仍为 list/session/`{messageId}`;
3. `TurnTailChatData.tokenUsage`(`TurnTokenUsage` 的分档字段与 `routes`);
4. `TurnTailChatData.closing.finalNode.messageId`(选择器的匹配键);
5. 插槽 register 选项(`name`/`id`/`order`/`locale`)与 `ctx.slots.inject` 的语义。

前 4 处任一变化,`pnpm run smoke` 会先失败(它断言注册 id、插件形状、插槽名与真实算价)。

## 6. 测试策略

| 层 | 工具 | 覆盖 |
|---|---|---|
| 计费纯函数 | `vitest`(`tests/pricing.spec.ts`) | 别名/改路规则、高峰窗口边界(含 12:00、周末、跨时区)、三档金额、混用模型、无路由不猜 |
| 产物契约 | `node scripts/smoke-client-bundle.mjs` | bundle 注册 id = 包名、工厂返回 `inject`/`apply`、注册进正确插槽、对真实分档算出 `≈¥5.00`、无路由不渲染 |
| 真机 | 手动 | 重启 `dsh web` + 硬刷新,核对胶囊与原生用量弹窗的分档一致性,并与账户余额的 `$` 变化对照 |
