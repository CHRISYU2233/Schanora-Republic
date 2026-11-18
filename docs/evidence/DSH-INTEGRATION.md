# DSH 深度对接：现状与下一步

> 2026-11-17 · v0.5.7
>
> 目标：Schanora 不是 DSH 里一个「独立的网页」，而是能用上当前对话、能把结果带回对话的插件。

## 一、已经接上的部分（本期可用）

| 能力 | 实现方式 | 状态 |
| --- | --- | --- |
| 会话身份 | 注册 `conversation.session.header.utilities` 槽位，用宿主注入的 `sessionId` 做范围/草稿/浏览器任务隔离 | 已完成 |
| 会话级范围 | `schanora.scope.v1.<sessionId>`，同会话内选库保持一致；换会话互不影响 | 已完成 |
| 会话级草稿 | `schanora.qadraft.v1.<sessionId>`，边输边存，切会话再回来还在 | 已完成 |
| **引用 DSH 对话选区** | 监听 `document.selectionchange`（插件与宿主同一 document），把面板外的选区收成「DSH 对话选区 · N 字」，问答页一键「引用到提问」填进输入框 | 本期新增（v0.5.7） |
| 选区存进知识库 | 同一条选区上的「存入知识库」：走 `POST /api/v1/clips` → `/commit`（带 revision / 幂等键），落到本会话已选库（未选库则第一个库）；成功/失败都走统一浮层提示 | 本期新增（v0.5.8） |
| **宿主能力桥** | `src/lib/host.js` 鸭子类型探测 `ctx.model` / `ctx.tools` / `ctx.conversation`（多形状 + 异常吞掉）；拿到就启用，拿不到退回现状 | 本期新增（v0.5.9） |
| **宿主模型作答** | 宿主给了 `ctx.model.chat`：检索仍走网关，答案由 DSH 模型生成，气泡标注「宿主模型作答」（不再是「WeKnora 合成」） | 本期新增（v0.5.9） |
| **检索注册为工具** | 宿主给了 `ctx.tools.register`：注册 `schanora_search`（JSON Schema 参数 + 只读），DSH 主对话可直接调用 | 本期新增（v0.5.9） |
| 能力可见 | 设置 →「DSH 能力」三行只读清单：亮绿点 + 实际属性名，未提供写「未提供」 | 本期新增（v0.5.9） |
| 侧栏/面板入口 | `sidebar.panellist` 注册面板，`ctx.layout.selectPanel` 唤起 | 已完成 |

选区引用的边界：只接收**面板之外**的选区（插件内部划选不触发）；超过 4000 字截断；点「引用到提问」或 × 后清掉宿主选区，避免又被 `selectionchange` 填回来。

「存入知识库」的两个设计取舍：

- 走采集（clips）而不是「新建文档」接口：采集链路自带 `revision / dedupeKey / sourceKey` 版本判定，同一段选区连点两次会命中版本规则变成新版本，不会在库里堆重复文档。
- 落库目标取本会话已选库的第一个；一个库都没有时明确拒绝并提示「先建一个知识库」，不静默失败、也不偷偷建库。演示模式下提交成功会真的出现在文档列表（`_live` 文档由演示管线推进），不做假成功。

## 二、还差什么（需要宿主/网关配合）

「引用对话」可以分四步，越往下越需要 DSH 开放接口：

1. **选区引用（已做）**：不需要任何私有 API，纯前端。
2. **选区入库（已做）**：选区直接写进知识库，之后检索/问答自然能引用到它。
3. **结构化对话引用**：要拿到「当前会话的消息数组（role/content/时间）」，才能把某条助手回答当作证据、或让检索带上多轮上下文。
   - 需要宿主提供形如 `ctx.conversation.getMessages()` / `ctx.conversation.subscribe()` 的只读能力；
   - 或者退一步：宿主把消息渲染成带 `data-ds-message-id` 的 DOM，插件按节点读取（脆弱，不建议作为长期方案）。
4. **把结果写回对话**：把检索到的证据/生成的引用回填成一条 DSH 消息，或注册为 DSH 的工具（tool）供主对话调用。
   - 需要宿主的消息写入/工具注册接口，当前插件 API 里没有。

**插件侧已经不再等接口了**：`src/lib/host.js` 会把上面三类能力都探一遍，宿主按任意合理形状挂上（`ctx.model.chat` / `ctx.llm.complete`、`ctx.tools.register` / `ctx.tool.define`、`ctx.conversation.getMessages` / `ctx.chat.history`），插件立刻启用；拿不到就当没有，行为与 v0.5.7 完全一致。给 DSH 侧的完整提案（签名、语义、cordis inject 那个坑、验收清单）见 **`docs/handoff/DSH-API-PROPOSAL.md`**。

建议的宿主接口（供 A 侧评估）：

```ts
// 只读：当前会话消息
ctx.conversation.getMessages(): Promise<{ id, role, content, createdAt }[]>
// 增量：新消息到达
ctx.conversation.subscribe(fn): () => void
// 写入：把插件结果作为一条消息/引用回填
ctx.conversation.appendMessage({ role: 'assistant', content, citations }): Promise<void>
```

## 三、拿到接口后，插件侧怎么接

1. `inject` 里加 `'conversation'`；`apply(ctx)` 里做能力探测：拿不到就退回当前行为，不 block 面板渲染。
2. 问答页的范围上方加「引用当前对话」抽屉：列出最近 N 条消息，勾选后把内容作为 `context` 传给网关（`POST /search` 增加 `extraContext` 字段），而不是塞进 query。
3. 引用落库（**已实现**，v0.5.8）：选中的对话片段走已有的 `clip` 导入通道写入知识库，之后检索/问答自然能引用到它。
4. 回填：答案生成后调用 `appendMessage` 把「答案 + 引用」写回主对话，形成 DSH 内的闭环。

## 四、验证方式

- 选区引用：在 DSH 对话里划选一段 → 打开问答页 → 出现「DSH 对话选区 · N 字」→ 点「引用到提问」→ 输入框出现该段文字。
- 选区入库：同一条选区点「存入知识库」→ 顶部绿色浮层「已提交到「库名」」→ 进该库文档列表能看到「DSH 对话选区 MM-DD HH:mm」这条（演示模式为「等待处理」并自动推进）。
- 会话隔离：两个会话分别选库/写草稿，互不串（E2E T02/T08/T10 覆盖）。
- 结构化引用（待接口）：`ctx.conversation` 存在时抽屉可见；不存在时入口隐藏且不报错。
