# 模型接入三个问题的答案（embedding / Wiki / DSH 模型）

> 2026-11-17 · v0.5.8
>
> 起因：接入 embedding 模型时到底改哪里？Wiki 能不能自己生成？对话用的模型能不能直接走 DSH？
> 下面每条都指到具体文件/接口，不写「大概在哪」。

## 一、embedding 模型：只需要动 WeKnora，前端一行不用改

三层里只有第一层是真正的改动点：

| 层 | 位置 | 要做什么 |
| --- | --- | --- |
| ① WeKnora | 它的模型配置（`config.yaml` 的模型段 / 管理界面） | **注册模型**：走 Ollama 就先 `ollama pull bge-m3`；走云服务（OpenAI 兼容 / TEI / Xinference）填 `provider`、`base_url`、`api_key`、`model_name` |
| ② 网关 | `GET /api/v1/models?type=Embedding` | 不用改，透传 WeKnora 的模型目录。**注意：网关代码不在本仓库**（本仓只有前端插件 + 预览台 + 演示数据），这条路径是前端实际在调的 |
| ③ 前端 | `plugins/schanora/client/src/ui.js` | 不用改。建库表单的模型下拉来自 `ui.js:2858` 的 `requestJson(..., '/api/v1/models?type=Embedding')`；选中后随 `POST /api/v1/knowledge-bases` 以 `embeddingModelId` 提交 |

验证顺序（三步，任一步不通就停在那一步排查）：

```bash
# 1. 模型有没有注册进 WeKnora 的目录
curl -s "http://127.0.0.1:8000/api/v1/models?type=Embedding" | head -c 400
# 2. 建库时带上它（{id} 用上一步返回的模型 id）
curl -s -X POST http://127.0.0.1:8000/api/v1/knowledge-bases \
  -H 'content-type: application/json' \
  -d '{"name":"验证库","type":"document","embeddingModelId":"{id}"}'
# 3. 传一份小文档，等解析完成后在文档详情看「向量化」这一段是否成功、分块数是否 > 0
```

两个必须知道的约束：

- **embedding 是库级绑定**。已建的库是用旧模型算的向量，换模型后维度/语义空间都变了 —— 必须重建 collection 并重新向量化，否则检索要么报错要么分数全乱。新库直接选新模型最省事。
- **embedding 管召回，rerank 管排序**，是两个独立开关。之前联调时 rerank 因欠费被关，只配 embedding 也能检索，但排序质量会差一截。

## 二、Wiki 能不能自己生成：能，但要 A 侧先给「生成」接口

前端已经把两侧的读取端写好了（`ui.js:2956` / `2964`）：

- `GET /api/v1/knowledge-bases/{kbId}/wiki/tree`
- `GET /api/v1/knowledge-bases/{kbId}/wiki/pages/{slug}`

网关现在回 `NOT_IMPLEMENTED`（A 侧模块 6 未接），所以界面上是「网关还没有 Wiki 接口」。演示模式下可以看完整界面。

要让它「自己生成」，缺的不是前端，是 A 侧的两件事：

1. **生成动作**（异步 job，别做成同步长请求）：
   `POST /api/v1/knowledge-bases/{kbId}/wiki/generate` → `{ jobId }`，内部：取库内已就绪的分块 → 按主题聚类 → 让 LLM 生成页面 → 落库。
2. **页面存储**：`wiki_pages(slug, title, content_markdown, source_chunk_ids[], version, generated_at)`，加上 `wiki_tree` 的层级。生成结果必须记 `source_chunk_ids`，否则页面上没法标「这句来自哪份文档」，也就失去了知识库 Wiki 的意义。

现成的两个 GET 直接读这张表，前端不需要改。生成入口我预留成能力探测：接口在就显示「生成 Wiki」，不在就隐藏，不做假按钮。

成本提醒：生成是 LLM 批量调用，一个中等库（几十份文档）一次全量生成要几分钟到十几分钟，所以必须是后台 job + 进度；而且**生成内容必须可回看原文**（点引用跳回分块），否则用户不敢用。

## 三、对话模型能不能直接走 DSH：现在不行，但有替代路径

事实：插件从宿主只拿到四项能力 —— `ctx.slots`、`ctx.locale`、`ctx.layout`、`ctx.effect`（`ui.js` 全量 grep）。**没有模型/对话相关的句柄**，所以插件拿不到 DSH 正在用的那个模型。

三条路，按可行性排：

1. **现在就能用（已实现）**：插件不生成答案，只负责检索出证据，把证据交给 DSH 主对话组织回答。问答页「深度研究」不打开时就是这种模式（文案在 `chat.evidence.desc`），答案由 DSH 的模型写，天然共用同一份对话上下文。
2. **半程**：插件调网关的 `/sessions/{id}/messages`（SSE）自己生成答案 —— 也就是现在「深度研究」那条路。模型 key 在网关/WeKnora 侧，与 DSH 的模型是两套，风格/上下文不共享。
3. **最理想**：宿主开放 `ctx.model.chat({ messages })` 或「注册为 DSH 工具」。前者让插件复用宿主模型（省一份云端调用、答案风格统一）；后者让 DSH 主对话直接调用「检索知识库」工具，插件退成纯检索后端。两者都要 DSH 侧支持，当前 API 没有。

结论：**「直接调用 DSH 的模型」不是配置问题，是接口问题**。短期用路径 1（证据交给 DSH）体验最自然；要真正打通，需要把 `ctx.model.chat` / 工具注册提给 DSH 侧评估 —— 这跟 `ctx.conversation.*` 是同一批诉求。

**插件侧已经准备好了（v0.5.9）**：`src/lib/host.js` 会在启动时探一遍 `ctx.model` / `ctx.tools` / `ctx.conversation`，宿主一旦按任意合理形状挂上，问答立刻改由宿主模型作答（气泡标注「宿主模型作答」），并把 `schanora_search` 注册成工具供主对话直接调用 —— 不需要插件再发版。当前 DSH 里这三项显示为「未提供」是事实，不是没做。给 DSH 侧的接口提案与验收清单见 `docs/handoff/DSH-API-PROPOSAL.md`；想在本地看「开放后长什么样」，打开 `/preview/?hostcaps=model,tools`。
