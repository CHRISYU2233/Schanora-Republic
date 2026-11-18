# 接口契约（Project API）

> 前后端唯一共享契约。**谁要改接口，先改这里，再通知对方。**
> 当前进度：模块 1（知识库管理，含模型列表）、模块 2（文档接收）、模块 3（文档处理状态）、模块 4（文档检索）、模块 5（会话与问答）、模块 6（Wiki）均已定稿。
> 更新时间：2026-11-17（模块 6 定稿；§0.1/§0.2 按实测修正）

---

## 0. 通用约定

### 0.1 统一响应包裹

所有接口返回统一结构：

```json
{
  "code": 0,
  "message": "ok",
  "data": { }
}
```

- `code = 0` 表示成功；**出错时 `code` 是字符串**（见 §0.2），不是 HTTP 状态码。
- `data` 为业务数据（对象或数组）。
- **每个响应都带 `X-Request-Id`（响应头）**，成功与失败都有；前端传入 `X-Request-Id` 时会原样透传，便于把前后端日志串成一条链路。
- 失败响应额外带 `retryable` 与 body 内的 `requestId`（与响应头同值）。

失败响应示例（实测）：

```json
{
  "code": "NOT_FOUND",
  "message": "知识库不存在",
  "data": null,
  "retryable": false,
  "requestId": "2fed89131333"
}
```

### 0.2 错误码

> 旧版这里写的是数字码（400/401/…），与实现不符，已按实测更正。

| code（字符串） | HTTP | 含义 | 可重试 |
|---|---|---|---|
| `BAD_REQUEST` | 400 | 参数错误 / 业务前置条件不满足（如知识库未开 Wiki） | 否 |
| `UNAUTHORIZED` | 401 | 未认证 / API Key 无效 | 否 |
| `FORBIDDEN` | 403 | 无权限 | 否 |
| `NOT_FOUND` | 404 | 资源不存在 | 否 |
| `VALIDATION_ERROR` | 422 | 入参校验失败（`message` 形如 `knowledgeBaseIds: ...`） | 否 |
| `INTERNAL_ERROR` | 500 | 网关内部错误（非上游问题，需后端排查） | 否 |
| `UPSTREAM_ERROR` | 502 | 上游 WeKnora 不可达或返回错误 | 是 |
| `UPSTREAM_TIMEOUT` | 504 | 上游超时 | 是 |
| `HTTP_ERROR` | 其它 | 未归类的 HTTP 错误 | 否 |
| `UPSTREAM_REJECTED` | — | 仅用于 SSE `error` 事件：上游返回 4xx（重试无用） | 否 |

> 前端判断可重试：优先看 `retryable` 字段，不要靠 HTTP 状态码枚举。
> **504 是 2026-11-17 新增的**（此前上游超时会被笼统报成 502），错误分支请同时兼容 502 / 504。


### 0.3 命名与格式

- 字段统一 **camelCase**（由 A 的 Gateway 负责转换，前端无需关心 WeKnora 的 snake_case）。
- 时间字段统一 **ISO 8601**，如 `2026-11-09T16:26:46+08:00`。
- ID 字段为字符串 UUID。

---

## 1. 知识库管理（模块 1）

### 1.1 查询知识库列表

```
GET /api/v1/knowledge-bases
```

响应：

```json
{
  "code": 0,
  "message": "ok",
  "data": [
    {
      "id": "d94e04ce-b5e6-484c-9b61-f43dab91f30a",
      "name": "test1",
      "description": "",
      "type": "document",
      "embeddingModelId": "builtin-ollama-embedding",
      "knowledgeCount": 2,
      "chunkCount": 0,
      "createdAt": "2026-11-09T16:26:46+08:00",
      "updatedAt": "2026-11-09T16:26:49+08:00"
    }
  ]
}
```

关键字段说明：

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | string | 知识库 ID（kbId），传给后续模块 |
| `name` | string | 库名 |
| `description` | string | 描述 |
| `type` | string | 类型：`document` / `faq` / `wiki` |
| `embeddingModelId` | string | 绑定的 Embedding 模型 ID |
| `knowledgeCount` | number | 文档数 |
| `chunkCount` | number | 分块数 |

> 完整响应还包含其他配置字段（chunkingConfig、indexingStrategy 等），前端按需取用，不必全部展示。

### 1.2 创建知识库

```
POST /api/v1/knowledge-bases
```

请求体（camelCase）：

```json
{
  "name": "库名",
  "description": "可选描述",
  "type": "document",
  "embeddingModelId": "builtin-ollama-embedding"
}
```

| 字段 | 必填 | 说明 |
|---|---|---|
| `name` | 是 | 库名 |
| `description` | 否 | 描述 |
| `type` | 否 | 默认 `document` |
| `embeddingModelId` | 否 | 不传则用系统默认 |

响应：`data` 为创建好的知识库对象（结构同 1.1 列表元素），其中 `id` 即新知识库的 kbId。

### 1.3 查询单个知识库

```
GET /api/v1/knowledge-bases/{kbId}
```

响应：`data` 为单个知识库对象（结构同 1.1）。

### 1.4 模型列表

```
GET /api/v1/models
GET /api/v1/models?type=Embedding    # 只取向量模型
```

用途：前端建库时动态拉取可用模型，**避免写死 `embeddingModelId`**。

响应：`data` 为模型对象数组：

```json
{
  "code": 0,
  "message": "ok",
  "data": [
    {
      "id": "builtin-ollama-embedding",
      "name": "bge-m3",
      "displayName": "bge-m3 (本地 Ollama)",
      "type": "Embedding",
      "source": "local",
      "isDefault": true,
      "isBuiltin": true,
      "status": "active"
    }
  ]
}
```

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | string | 模型 ID，即建库时的 `embeddingModelId` |
| `name` | string | 模型名 |
| `displayName` | string | 展示名 |
| `type` | string | `Embedding` / `Rerank` / `KnowledgeQA` / `VLLM` / `ASR` |
| `source` | string | `local`（本地 Ollama）/ `remote`（云端） |
| `isDefault` | bool | 是否默认 |
| `status` | string | `active` 等 |

> ⚠️ 此接口要求 Gateway 侧 API Key 具备 `manage_models`（管理模型）权限，否则 WeKnora 返回 403。

---

## 2. 文档接收（模块 2）

> ⚠️ 关键认知：**上传 ≠ 处理完成**。上传成功只表示文件已交给 WeKnora，会返回 `parseStatus: "pending"`，随后进入异步处理（`pending` → `processing` → `finalizing` → `completed` / `failed`，另有 `cancelled` / `deleting` 终态）。处理状态由模块 3 的接口查询。

### 2.1 查询文档列表

```
GET /api/v1/knowledge-bases/{kbId}/documents
```

响应：`data` 为文档对象数组（结构见 2.3）。

### 2.2 上传文档

```
POST /api/v1/knowledge-bases/{kbId}/documents
Content-Type: multipart/form-data
```

| 字段 | 必填 | 说明 |
|---|---|---|
| `file` | 是 | 上传的文件（PDF / Word / Excel / PPT / Markdown 等） |
| `fileName` | 否 | 自定义文件名，默认取原文件名 |

响应：`data` 为刚创建的文档对象，其中 **`id` 即 knowledgeId**（传给模块 3 查处理状态）。

### 2.3 文档对象字段说明

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | string | **knowledgeId**（模块 2 的产出，模块 3 的输入） |
| `title` | string | 文档标题 |
| `fileName` | string | 文件名 |
| `fileType` | string | 文件类型：`pdf` / `md` / `docx` 等 |
| `fileSize` | number | 文件大小（字节） |
| `parseStatus` | string | 处理状态：`pending` / `processing` / `finalizing` / `completed` / `failed` / `cancelled` / `deleting` |
| `embeddingModelId` | string | 绑定的 Embedding 模型 |
| `createdAt` | string | 创建时间（ISO 8601） |
| `errorMessage` | string | 处理失败时的错误信息 |

> 实测说明：WeKnora 0.9.0 上传**相同内容的文件不返回 409**（不去重），每次都会生成新的 knowledgeId。如需前端做去重提示，由 B 在界面层对比 `fileSize` + 文件名判断，Gateway 不做强制去重。

---

## 3. 文档处理状态（模块 3）

> 文档上传后进入异步处理，处理状态用本模块接口查询。处理管线各阶段：`docreader`（解析）→ `chunking`（分块）→ `embedding`（向量化）→ `multimodal` / `postprocess`（后处理）。

### 3.1 查询文档详情

```
GET /api/v1/documents/{knowledgeId}
```

响应：`data` 为文档对象（结构同 2.3），重点字段：

| 字段 | 说明 |
|---|---|
| `parseStatus` | `pending` / `processing` / `finalizing` / `completed` / `failed` / `cancelled` / `deleting` |
| `errorMessage` | 失败原因（仅 `failed` 时有值） |
| `processedAt` | 处理完成时间 |

### 3.2 查询处理轨迹

```
GET /api/v1/documents/{knowledgeId}/spans
```

响应：`data` 含 `trace` 对象，展示各阶段执行情况：

```
data: {
  parseStatus: "failed",
  attempt: 4,                     // 重试次数
  trace: {
    errorCode: "VECTORSTORE_WRITE_FAILED",
    children: [
      { name: "docreader",  status: "done" },
      { name: "chunking",   status: "done" },
      { name: "embedding",  status: "failed" },
      ...
    ]
  }
}
```

各阶段 `status`：`done`（成功）/ `failed`（失败）/ `cancelled`（被取消）/ `running`（进行中）。

### 3.3 查询分块列表

```
GET /api/v1/documents/{knowledgeId}/chunks
```

响应：`data` 为分块数组（每个 chunk 含文本内容 + 向量化状态）。处理未完成或向量化失败时可能为空数组。

---

## 4. 文档检索（模块 4）

> 检索不含 LLM 总结，与产品内问答共用同一检索流程（召回 → rerank → 合并）。
> ⚠️ **rerank 默认关闭**：阿里云 qwen3-rerank 欠费（`Arrearage`），Gateway 默认下发 `rerank.enabled=false`，检索走纯「向量 + 关键词」混合召回，不依赖云端模型。需要精排时由前端显式传 `rerank` 覆盖。

### 4.1 检索文档

```
POST /api/v1/search
```

请求体（camelCase）：

```json
{
  "query": "员工报销流程是什么",
  "knowledgeBaseIds": ["d94e04ce-b5e6-484c-9b61-f43dab91f30a"],
  "matchCount": 10
}
```

| 字段 | 必填 | 说明 |
|---|---|---|
| `query` | 是 | 检索问题 / 关键词 |
| `knowledgeBaseIds` | 否* | 知识库 ID 数组（支持多库检索） |
| `knowledgeBaseId` | 否* | 单个知识库 ID（兼容单库场景） |
| `matchCount` | 否 | 返回条数上限，默认走租户配置 |

> \* `knowledgeBaseIds` / `knowledgeBaseId` 至少传一个，否则 WeKnora 返回 400。

响应：`data.items` 为命中片段数组，`data.meta` 为诊断信息：

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "items": [
      {
        "id": "80452162-440c-4e65-b735-11d674a3ecf6",
        "content": "面向公司普通员工的 AI 知识助手……",
        "knowledgeId": "f42b2a9d-5a6e-4f1a-b1d4-3c55c6718d15",
        "knowledgeTitle": "企业AI知识助手_产品构想与需求说明.pdf",
        "knowledgeFilename": "企业AI知识助手_产品构想与需求说明.pdf",
        "chunkIndex": 0,
        "startAt": 0,
        "endAt": 463,
        "score": 0.7047,
        "matchType": 0,
        "knowledgeBaseId": "910db1aa-e14d-440e-806b-98922144c72e"
      }
    ],
    "meta": {
      "rerank": {
        "applied": false,
        "outcome": "disabled"
      }
    }
  }
}
```

关键字段说明：

| 字段 | 类型 | 说明 |
|---|---|---|
| `items[].id` | string | 命中分块（chunk）ID |
| `items[].content` | string | 命中片段正文（用于展示引用原文） |
| `items[].knowledgeTitle` | string | 所属文档标题 |
| `items[].knowledgeFilename` | string | 所属文件名 |
| `items[].chunkIndex` | number | 分块序号 |
| `items[].score` | number | 融合相关度分（越大越相关） |
| `items[].matchType` | number | `0` = 向量命中，`1` = 关键词命中 |
| `items[].knowledgeBaseId` | string | 所属知识库 ID |
| `meta.rerank.outcome` | string | rerank 阶段结果：`disabled`（已关闭）/ `ok`（正常精排）/ `model_error`（模型异常，已降级为召回顺序）等 |

---

## 5. 会话与问答（模块 5）

> 问答采用「会话（session）」模型支持多轮对话。一次问答的完整链路：
> **检索 → 生成**（LLM 总结）。检索复用模块 4 的流程（rerank 同样默认关闭），生成由 LLM 完成。
> ⚠️ 提问接口返回的是 **SSE 流**（`text/event-stream`），不是普通 JSON，前端需用 EventSource / fetch 流式读取。

### 5.1 创建会话

```
POST /api/v1/sessions
```

请求体（camelCase）：

```json
{ "title": "报销流程咨询", "description": "可选描述" }
```

| 字段 | 必填 | 说明 |
|---|---|---|
| `title` | 否 | 会话标题 |
| `description` | 否 | 描述 |
| `kind` | 否 | 默认 `assistant` |

响应：`data` 为会话对象，**`id` 即 sessionId**（传给后续提问 / 历史接口）：

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "id": "9d233366-dcc1-4379-a3d7-348fbf77fb39",
    "title": "报销流程咨询",
    "description": "",
    "createdAt": "2026-11-13T09:55:54+08:00",
    "updatedAt": "2026-11-13T09:55:54+08:00"
  }
}
```

### 5.2 会话列表

```
GET /api/v1/sessions
```

响应：`data` 为会话对象数组（结构同 5.1）。

### 5.3 会话消息历史

```
GET /api/v1/sessions/{sessionId}/messages?limit=20
```

| 参数 | 必填 | 说明 |
|---|---|---|
| `limit` | 否 | 返回条数上限，默认 20 |

响应：`data` 为消息数组，每条含 `role`（`user` / `assistant`）、`content`、`createdAt`、`knowledgeReferences`（助手消息的引用）等。前端按 `createdAt` 排序渲染聊天记录。

### 5.4 提问（SSE 流式）

```
POST /api/v1/sessions/{sessionId}/messages
```

请求体（camelCase）：

```json
{
  "query": "员工报销流程是什么",
  "knowledgeBaseIds": ["d94e04ce-b5e6-484c-9b61-f43dab91f30a"]
}
```

| 字段 | 必填 | 说明 |
|---|---|---|
| `query` | 是 | 用户问题 |
| `knowledgeBaseIds` | 否 | 知识库 ID 数组（多库检索） |
| `knowledgeIds` | 否 | 限定到具体文档 |

响应：`Content-Type: text/event-stream`，逐条事件，格式为：

```
data: {json}
```

每个事件的 `data` 是一个 JSON 对象（已转 camelCase）：

```json
{
  "id": "be721387-...",
  "responseType": "answer",
  "content": "员工报销流程是……",
  "done": false,
  "knowledgeReferences": [ { "id": "...", "content": "...", "knowledgeTitle": "...", "chunkIndex": 0, "score": 0.7 } ],
  "sessionId": "9d233366-...",
  "assistantMessageId": "510f7308-..."
}
```

| 字段 | 类型 | 说明 |
|---|---|---|
| `responseType` | string | 事件类型（见下表） |
| `content` | string | 该事件的文本内容 |
| `done` | bool | 该事件是否终结（`answer` 的最后一个分片为 `true`） |
| `knowledgeReferences` | array | 引用片段（`references` 事件携带） |
| `sessionId` / `assistantMessageId` | string | 会话 / 助手消息 ID |

**responseType 枚举**（前端据此决定如何渲染）：

| responseType | 含义 | 前端处理 |
|---|---|---|
| `agentQuery` | 请求已受理 | 可忽略 / 展示"正在思考" |
| `thinking` | 思考过程 | 可折叠展示 |
| `toolCall` / `toolResult` | 内部工具调用（理解问题、检索） | 可忽略 |
| `references` | 命中的引用片段 | 渲染引用来源 |
| `answer` | 生成的答案（可能分多个分片，逐段追加） | **拼接展示，最后一个分片 `done=true`** |
| `complete` | 整次问答结束 | 结束 loading 态 |
| `error` | 出错（`content` 为错误信息） | 展示错误 |
| `stop` | 用户手动停止 | 结束 |
| `sessionTitle` | 会话标题已自动生成 | 可刷新标题 |

> 前端要点：把连续多个 `answer` 事件的 `content` 顺序拼接，直到收到 `complete`（或 `done=true`）视为一次完整回答。

---

## 6. Wiki（模块 6）

知识库把文档自动整编成的 Wiki 页面，按主题与实体组织。**wiki 是异步生成的**：文档入库后上游才会跑 ingest，页面会分多轮陆续出现（实测 2KB 文档约 5 分钟出首页，之后继续增补），所以列表页需要有刷新入口。

### 6.1 目录列表

```http
GET /api/v1/knowledge-bases/{kbId}/wiki/tree
```

响应：

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "items": [
      {
        "slug": "concept/部署方式",
        "title": "部署方式",
        "type": "topic",
        "pageType": "concept",
        "status": "draft",
        "summary": "",
        "version": 1,
        "updatedAt": "2026-11-17T03:20:11Z",
        "sources": [
          { "knowledgeId": "e6af2c66-…", "title": "", "chunkCount": 2 }
        ]
      }
    ]
  }
}
```

| 字段 | 类型 | 说明 |
|---|---|---|
| `slug` | string | 页面路径，**含 `/` 且可能含中文**（如 `concept/边缘计算能力`）。按路径参数原样传，**不要**做二次编码 |
| `title` | string | 页面标题，有值 |
| `type` | `topic` \| `entity` \| `hub` | **前端分组只用这个字段**，枚举固定三值 |
| `pageType` | string | 上游原始类型，仅排查用，前端不用渲染 |
| `status` | `published` \| `draft` | 自动生成的页面**全部是 `draft`** |
| `summary` | string | 可能为空串 |
| `version` | int | 版本号 |
| `updatedAt` | string | ISO 8601 |
| `sources` | array | 引用来源，见下 |

**`type` 的取值口径**（上游有 6 种 page_type，网关归一化成 3 种，不要用 slug 前缀判断类型）：

| 上游 `page_type` | 对外 `type` | 含义 |
|---|---|---|
| `concept` | `topic` | 概念/主题页（如「部署方式」） |
| `synthesis` / `comparison` | `topic` | 综合分析 / 对比页，归入主题 |
| `entity` | `entity` | 实体页（产品型号、组织等） |
| `summary` | `hub` | 单文档摘要页，性质是文档入口 |
| `index` | `hub` | Wiki 索引页 |
| 其它 / 空 | `topic` | 兜底，不会漏出裸值 |

> ⚠️ 实测存在 `slug=concept/xxx` 但 `pageType=entity` 的情况，**分组必须用 `type`，不能用 slug 前缀**。
>
> 📌 此映射为**当前实现**。`A-TODO-R3.md` P1-2 曾提出「透传不做映射、B 侧字典跟上」，与本节冲突，待 B 确认后可能调整；确认前按本节实现。详见 `docs/handoff/模块6-Wiki接口说明-2026-11-17.md` 第五节。

**`sources[]` 说明**：`sources[].title` **恒为空串**——上游 `source_refs` 只给 `knowledgeId`，不带标题。要显示文档名得用 `knowledgeId` 反查文档接口。`chunkCount` 是该来源的分块数，回填失败时为 `0`（不影响列表返回）。

### 6.2 单页

```http
GET /api/v1/knowledge-bases/{kbId}/wiki/pages/{slug}
```

`{slug}` 含 `/`，直接作为路径传入（如 `wiki/pages/concept/部署方式`），中文原样或百分号编码均可。

响应 `data` 为 §6.1 的全部字段 **+ `content`**（markdown：段落、`- ` 列表、`**粗体**`、`` `代码` ``、标题；表格与图片暂不支持）。

### 6.3 错误场景

| 场景 | HTTP | code | 前端建议文案 |
|---|---|---|---|
| 知识库未开启 Wiki | 400 | `BAD_REQUEST` | 「该知识库未开启 Wiki」 |
| 知识库不存在 | 404 | `NOT_FOUND` | 「知识库不存在」 |
| slug 不存在 | 404 | `NOT_FOUND` | 「页面不存在」 |
| 上游不可达 / 超时 | 502 / 504 | `UPSTREAM_ERROR` / `UPSTREAM_TIMEOUT` | 按 `retryable` 给重试 |

**Wiki 已开启但还没有任何页面时，返回 `200` + `items: []`**（不是 400，也不是 404）——这种情况要显示「这个知识库还没有 Wiki 页面」，而不是报错。

