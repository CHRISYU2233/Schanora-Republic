# ClipService 与浏览器桥接 · 客户端提案合同

版本 0.1（2026-11-13）· 状态：**提案，未部署**。本文件描述 Schanora 客户端已经按什么形状调用
A 侧（Gateway）接口；A 侧实现时可以改名，但字段语义需保持一致，否则客户端会如实显示
`NOT_IMPLEMENTED`，不会假装成功。

对应交接包：`HANDOFF.md` §5（P1 网页剪藏）、§7（P3 知识桥接）、§9（ClipService 设计目标）。
客户端实现：`plugins/schanora/client/src/ui.js`（视图 + api 客户端）、`src/lib/clip.js`（去重/版本/状态机纯函数）。

---

## 1. 数据模型

### 1.1 采集候选 Clip

| 字段 | 类型 | 说明 |
|---|---|---|
| id | string | 候选 id，`clip_` 前缀 |
| status | enum | `draft` `capturing` `previewReady` `committing` `queued` `processing` `ready` `failed` `cancelled` |
| captureMode | enum | `url` / `selection` / `markdown` / `browserDownload` |
| targetKbId | string | 目标知识库（必填；缺失时服务端 400 `SCOPE_REQUIRED`） |
| originUrl | string | 原始 URL（保留原样，含跟踪参数；用于展示出处） |
| normalizedUrl | string | 规范化后的 URL（去跟踪参数、保留业务参数） |
| title | string | 标题 |
| contentMarkdown | string | 原文正文（Markdown） |
| note | string | 用户笔记，**与原文分开存储，不覆盖原文** |
| summary | string | AI 摘要，**只读展示，不覆盖原文** |
| assetRefs | string[] | 图片/附件引用（相对地址已按 originUrl 解析为绝对地址） |
| engineeringMetadata | object | `{ partNumber, drawingNumber, revision, docType, supplier }` |
| lifecycleStatus | enum | 默认 `unknown`；网页更新不等于企业批准有效版 |
| dedupeKey | string | `targetKbId::normalizedUrl|note::contentHash` — **内容级幂等键** |
| sourceKey | string | `targetKbId::normalizedUrl`（有 URL）或 `targetKbId::note::title` — **资料身份键** |
| contentHash | string | 内容指纹（客户端提示用；服务端必须自行重算） |
| versionId / previousVersionId | string | 版本裁决结果 |
| documentId | string | 真实入库映射建立后才返回，否则空 |
| jobId | string | 摄取任务 id（`GET /api/v1/jobs/{jobId}` 轮询） |
| revision | number | 候选自身修订号，commit 时用于乐观锁 |

**版本语义（验收 T05/T06）**

- 同一 `sourceKey` 下，`contentHash` 相同 → `outcome: "reuse"`，返回现有 `versionId`，**不新增版本**
- 同一 `sourceKey` 下，`contentHash` 不同 → `outcome: "new_version"`，新增版本并停用旧版，`documentId` 不变
- 无记录 → `outcome: "create"`

### 1.2 状态机

```
draft → capturing → previewReady → committing → queued → processing → ready
                                   ↘ failed ↗（retry 回到 previewReady）
任意可取消态 → cancelled（终态；ready 不可取消）
```

客户端只接受表内迁移；收到表外状态按 `draft` 兜底并记日志，不静默吞掉。

---

## 2. 端点

### 2.1 创建候选

`POST /api/v1/clips`

```json
{
  "captureMode": "url",
  "targetKbId": "kb-std-001",
  "originUrl": "https://supplier.example.com/ds?part=SC-1024&utm_source=mail",
  "title": "SC-1024 数据表",
  "contentMarkdown": "",
  "note": "",
  "engineeringMetadata": { "partNumber": "SC-1024", "revision": "B2", "docType": "standard" },
  "assetRefs": [],
  "hostScopeRef": "sess-a-7f3c2a11"
}
```

`url` 模式下服务端负责受控抓取正文（静态页）；需要登录/动态交互时返回
`CAPTURE_NEEDS_BROWSER`，客户端引导用户去「浏览器」页签。

响应 `200`：

```json
{ "code": "OK", "requestId": "req_...", "data": {
  "id": "clip_01", "status": "previewReady", "revision": 1,
  "normalizedUrl": "https://supplier.example.com/ds?part=SC-1024",
  "contentHash": "…", "dedupeKey": "…", "sourceKey": "…",
  "preview": { "assets": [], "excerpt": "…", "fetchedAt": "…" }
} }
```

### 2.2 读取候选 / 预览

`GET /api/v1/clips/{clipId}` → 同结构；`preview.assets` 给解析后的绝对地址。

### 2.3 提交入库

`POST /api/v1/clips/{clipId}/commit`

```json
{ "expectedRevision": 1, "idempotencyKey": "kb-std-001::https://…::hash" }
```

- `expectedRevision` 不匹配 → `409 REVISION_CONFLICT`（客户端提示重新预览）
- 同一 `idempotencyKey` 重复提交 → 返回同一结果（`outcome` 为 `reuse` 或原任务）
- 成功响应的 `status` 至少为 `queued`，`jobId` 非空；也可直接 `ready`（幂等命中）

### 2.4 摄取状态

`GET /api/v1/jobs/{jobId}` → `{ status: "queued|processing|ready|failed", documentId, error }`
（复用既有 jobs 合同，不新造第二套成功状态。OneDrive 已保存但 WeKnora 未就绪时，
`status=processing` 且 `documentId` 为空。）

---

## 3. 浏览器桥（P2）

官方 BrowserSkill DSH 插件负责浏览器内核与任务生命周期，本合同的端点只是
**Schanora 面板 ↔ A 侧桥**的状态读取与候选交接，不重写浏览器引擎。

| 端点 | 用途 |
|---|---|
| `GET /api/v1/browser/status` | `{ connected, browser, bskVersion, daemonHost }`；`daemonHost` 必须是用户本机，不是共享服务器 |
| `POST /api/v1/browser/tasks` | `{ sessionId, kind: "table"|"download", url }` |
| `GET /api/v1/browser/tasks/{id}` | `{ status: "running|paused|needsLogin|done|cancelled", progress, result }` |
| `POST /api/v1/browser/tasks/{id}/pause|resume|cancel` | 生命周期控制 |

约束：

- 任务按 DSH `sessionId` 隔离；迟到结果必须带 `sessionId`，服务端拒绝写入其它会话
- `download` 任务的 `result` 必须含 `fileName` `sizeBytes` `sha256` `verified`，未校验不得进入摄取链路
- 登录/人机验证交还用户，daemon 不代填凭据

---

## 4. P3 范围规则（客户端已强制）

1. `knowledgeBaseIds` 必须非空；空范围**不展开为全库**，直接拒绝并提示选库（T01）
2. 每次提问在发送瞬间快照范围（`scopeRevision`），在途请求不受后续切库影响；气泡回显锁定范围（T02）
3. 普通问题只做证据检索，答案由 DSH 主对话组织；仅显式「深度研究」调用 WeKnora 合成问答
4. 引用回指 `documentId + chunkIndex (+ versionId)`；`versionId` 缺失时界面不显示版本角标
5. 错误信封带 `requestId`，界面原样展示，便于按请求排障

## 5. 未实现时的行为

客户端对 `404` 统一显示「网关还没有该接口」，并在模块 `requires` 里列出缺失端点；
演示模式走本机 mock（去重记录持久化在 `localStorage`），mock 通过只证明隔离逻辑，
不替代真实环境验收。
