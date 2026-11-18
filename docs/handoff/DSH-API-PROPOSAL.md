# 给 DSH 侧的接口提案：让插件复用宿主模型与工具

> 2026-11-17 · Schanora 前端插件 v0.5.9
>
> 一句话：插件已经做好了「门」，宿主把下面三个能力按任意一种合理形状暴露出来，插件无需改代码就会自动启用；没有就保持现状，不报错、不降级成假数据。

## 一、现状（已核实，不是推测）

插件从宿主 `ctx` 只能拿到四项：

```
ctx.slots   槽位注册（侧栏 / 主面板 / 会话头部）
ctx.locale  词典注册与绑定
ctx.layout  面板切换
ctx.effect  生命周期
```

`plugins/schanora/client/src/ui.js` 里对 `ctx.*` 的全部使用就是这四项（`inject = ['slots', 'locale', 'layout']`）。

后果：**问答页只能自建网关会话**。检索证据走 Schanora 网关，答案由 WeKnora 侧模型生成；与本机 DSH 主对话的模型是两套，风格不统一，多轮上下文也不共享。用户看到的是「插件里问一句、DSH 里再问一句，两个答案口吻不同」。

## 二、三个诉求（按价值排序）

### 诉求 1：模型调用（价值最高，改动最小）

```ts
ctx.model.chat(
  messages: { role: 'system' | 'user' | 'assistant'; content: string }[],
  opts?: { signal?: AbortSignal; maxTokens?: number; temperature?: number; tag?: string }
): Promise<string | { content: string }>
```

- 只要返回值能取出正文即可，`string` / `{content}` / `{message:{content}}` / OpenAI `choices[0].message.content` 四种形状插件都能认（已实现 `normalizeChatReply`）。
- 不要求流式。要流式的话给 `AsyncIterable<{delta:string}>` 或 `onDelta` 回调，插件会接。
- 失败请抛带 `code` 的错误；插件把 `code` 原样显示在浮层提示里，不吞。

落实后插件立即变成：检索仍走知识库网关，**答案由 DSH 的模型写** —— 省一次云端合成调用，答案风格与主对话一致，且能吃到宿主的模型配置（换模型、限流、计费都归宿主管）。

### 诉求 2：工具注册（让主对话能直接查知识库）

```ts
const dispose = ctx.tools.register({
  name: 'schanora_search',
  description: string,
  parameters: JSONSchema,           // { type:'object', properties:{...}, required:[...] }
  readOnly?: boolean,               // 建议支持：只读工具免二次确认
  handler: (args) => Promise<unknown>,
})
```

- `handler` 的入参就是按 `parameters` 校验后的对象；返回任意可 JSON 序列化的值，插件已把它压成 `{count, items:[{index, score, docTitle, chunkIndex, content}]}`。
- 期望返回 dispose 函数（卸载时注销）；返回 `Promise<void>` 也能接受。
- 建议有开关：会话内允许工具 / 每次调用需确认。知识库检索是只读，默认放行最自然。

落实后 DSH 主对话可以直接说「查一下 M10 的拧紧力矩」，模型自行调用 `schanora_search`，插件退成纯检索后端 —— 这才是插件与 harness 的正确分工。

### 诉求 3：对话读取（让检索带上多轮上下文）

```ts
ctx.conversation.getMessages(): Promise<{id, role, content, createdAt}[]>
ctx.conversation.subscribe(fn): () => void          // 新消息到达
ctx.conversation.appendMessage({role, content, citations?}): Promise<void>   // 可选：结果写回
```

只读的两个就够用：能读历史就能做「带上下文的追问」和「勾选某条回答当证据」。`appendMessage` 是加分项。

## 三、插件侧已经就绪的部分（不需要等接口）

| 项 | 实现 | 验证 |
| --- | --- | --- |
| 能力探测（鸭子类型 + 异常吞掉） | `src/lib/host.js`：`ctx.model` / `ctx.llm` / `ctx.ai`、`ctx.tools` / `ctx.tool`、`ctx.conversation` / `ctx.chat` 任一形状都认 | 13 条单测（`test/host.test.mjs`） |
| 模型作答链路 | 检索证据 → `composeEvidencePrompt`（带 [1][2] 编号与出处）→ `ctx.model.chat` → 气泡标注「宿主模型作答」 | 预览台 `?hostcaps=model` 可复现 |
| 工具注册 | `apply(ctx)` 里注册 `schanora_search`，失败只记状态不影响面板 | 预览台 `?hostcaps=tools` 下 `window.__HARNESS_TOOL__` 可见完整 spec |
| 能力可见 | 设置 →「DSH 能力」三行只读清单：亮绿点 + 实际挂到的属性名，未提供写「未提供」 | 截图见 `docs/evidence/shots-host/` |
| 降级 | 三项全无 → 与现在完全一致（网关 SSE + 无工具），无报错 | 默认预览台即此状态 |

也就是说：**DSH 只要把接口挂上，用户换一版 client.js 就能用**，不需要插件再发版适配。

## 四、一个必须说明的坑：cordis 的 inject 语义

插件现在是 `inject = ['slots', 'locale', 'layout']`（数组形式）。若 DSH 的 cordis 版本要求「未 inject 的服务不能访问」，那么即使宿主提供了 `ctx.model`，插件在 `apply` 里读到也会抛错 —— 我们已用 `try/catch` 兜住（视为「没有」），所以不会崩，但**也永远不会启用**。

两条解法，任选其一：

1. 宿主侧把这三项做成不需要 inject 也能读的全局服务（`ctx.model` 直接可读）；
2. 或确认 cordis 支持对象形式 `inject = { required: ['slots','locale','layout'], optional: ['model','tools','conversation'] }`，我们把声明改成对象形式即可（一行改动，我们可以在确认后发版）。

这一条建议在接入时先验证：随便写个 `ctx.model` 探测打印，看是真对象还是抛错。

## 五、验收清单（宿主侧接入后逐条过）

1. 设置 →「DSH 能力」：宿主模型 / 工具注册 / 对话读取三行是否亮绿（对应属性名显示正确）；
2. 问答页开「深度研究」提问：气泡标注应从「WeKnora 合成」变成「宿主模型作答」，正文由宿主模型产出；
3. 在 DSH 主对话里说「查一下 XX 的规范」：模型应调用 `schanora_search`，返回带 `docTitle` 与 `chunkIndex` 的片段；
4. 断网（网关不可用）时：检索失败走浮层提示，宿主模型能力仍在（两者互不牵连）；
5. 卸载插件：工具应注销（`dispose` 被调用），主对话里不再出现 `schanora_search`。
