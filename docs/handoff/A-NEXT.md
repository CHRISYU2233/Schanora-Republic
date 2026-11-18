# A · 下一步做什么（v3）

> v3 · 2026-11-13 · 对照 `Schanora-main/gateway`（含 `routers/search.py`、`routers/qa.py` 的那版）与 `docs/api.md` 4、5 两节逐文件核对。
> v2 的 5 条已经全部落地，本版把它们标为「已完成、别再动」，只保留 **2 条新的**。
> 编号以你的《模块1-5进度同步》为准：M4 = 文档检索、M5 = RAG 问答、M6 = Wiki。

## 0. 你已经做完的（核对过代码，别再动）

| 项 | 证据 |
|---|---|
| 文档 4 个路由转 camelCase + `{code,data}` | `documents.py` 四处都用 `kb_ok(...)` 包裹 |
| 挂上 chunks 路由 | `GET /api/v1/documents/{id}/chunks` 已注册 |
| `/api/v1/models?type=Embedding` | `routers/models.py`，按 `type` 过滤，`403` 前提写在 docstring |
| 建库 / 列表 / 单查 | `knowledge_bases.py` |
| **`/chunks` 分页 + `total`**（v2 的 P0-1） | 已透传 `page`/`page_size`，返回 `{items,total,page,pageSize}` |
| **统一错误包裹**（v2 的 P0-2） | `main.py` 两个 `exception_handler`，输出 `{code,message,data,retryable,requestId}` + `X-Request-Id` |
| **`/health` 真探活**（v2 的 P1-1） | `_health_cache` + `HEALTH_TTL`，返回 `status`/`version`/`checkedAt`，上游挂了不 500 |
| **`/capabilities`**（v2 的 P1-2） | `main.py` 已注册，`features` 按已实现能力给 |
| **`parseStatus` 补到 7 个值** | `docs/api.md` 第 202 / 225 行已改 |
| M4 / M5 两个模块的路由 | `routers/search.py`、`routers/qa.py` 均已在 `main.py` 挂上 |

前端这边对应的适配也已完成：`search`、`qa` 两个页签 `ready`，SSE 解析按 `api.md` 5.4 的 `responseType` 枚举实现。见 `docs/evidence/M4M5-B.md`。

下面只剩 **2 条**，都不卡验收，但联调时会被问到。

---

## P1-1 · `POST /api/v1/search` 缺入参校验

### 现状

```python
class SearchRequest(BaseModel):
    query: str
    knowledgeBaseIds: Optional[List[str]] = None
    knowledgeBaseId: Optional[str] = None
```

两个知识库字段都是可选，且没有 `model_validator`。前端不传（或传空数组）时请求会原样打到
WeKnora 的 `knowledge-search`，上游返回 400，网关再包成 502 `UPSTREAM_ERROR`。

后果：**这是调用方的参数错误，却报成上游故障**。前端只能显示「网关 502，可重试」，
而重试永远不会成功——排查方向直接被带偏。

### 改法（`routers/search.py`，加 6 行）

```python
from pydantic import model_validator

class SearchRequest(BaseModel):
    model_config = {"extra": "allow"}
    query: str
    knowledgeBaseIds: Optional[List[str]] = None
    knowledgeBaseId: Optional[str] = None
    matchCount: Optional[int] = None

    @model_validator(mode="after")
    def _need_scope(self):
        if not self.knowledgeBaseIds and not self.knowledgeBaseId:
            raise ValueError("knowledgeBaseIds 或 knowledgeBaseId 至少传一个")
        return self
```

`RequestValidationError` 的处理器你已经有了，所以自动变成 422 `VALIDATION_ERROR` + `requestId`，
前端不用改。

### 验收

```bash
curl -s -X POST localhost:8000/api/v1/search \
  -H 'content-type: application/json' -d '{"query":"报销"}' -w '\n%{http_code}\n'
# 期望 422 + {"code":"VALIDATION_ERROR", ...}
```

---

## P1-2 · SSE 的 `error` 事件没有 `code` / `retryable`

### 现状

```python
err = {"id": "", "responseType": "error", "content": e.message, "done": True}
```

流已经建立（HTTP 200）后才可能出错，只能靠事件告知——这个判断是对的。但事件里**只有一句中文**：

- 前端区分不了「上游超时（可重试）」和「API Key 没权限（重试无用）」；
- 没有 `requestId`，出问题时两边的日志对不上同一次请求；
- `content` 直接是 `WeKnora 返回错误(502): ...`，用户看到的是给开发看的话。

### 改法（`routers/qa.py`，`gen()` 里那一处）

```python
except WeKnoraError as e:
    err = {
        "id": "",
        "responseType": "error",
        "content": e.message,                      # 原样保留，便于排查
        "code": "UPSTREAM_ERROR" if e.status_code >= 500 else "UPSTREAM_REJECTED",
        "retryable": e.status_code in (502, 504) or e.status_code == 429,
        "requestId": request_id,                   # 与 HTTP 响应头同一个 id
        "done": True,
    }
    yield f"data: {json.dumps(err, ensure_ascii=False)}\n\n"
```

前端已经按「有 `code` 就用，没有就退回通用文案」写好了，加字段是纯增益。

### 验收

```bash
curl -N -X POST localhost:8000/api/v1/sessions/<sid>/messages \
  -H 'content-type: application/json' -d '{"query":"测试"}'
# 故意把 API Key 改错，期望最后一条事件带 code / retryable / requestId
```

---

## 联调 SOP（M4 / M5 加进来了）

### A 侧

```bash
cd gateway
python -m venv .venv && .venv/Scripts/activate
pip install -r requirements.txt
cp .env.example .env          # WEKNORA_BASE_URL=http://127.0.0.1:8080 + API Key
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

自检：

```bash
curl -s localhost:8000/health
curl -s localhost:8000/capabilities
curl -s localhost:8000/api/v1/knowledge-bases
# M4
curl -s -X POST localhost:8000/api/v1/search -H 'content-type: application/json' \
  -d '{"query":"报销","knowledgeBaseIds":["<kb>"]}' | head -c 400
# M5（先建会话，再流式提问）
SID=$(curl -s -X POST localhost:8000/api/v1/sessions -H 'content-type: application/json' \
  -d '{}' | python -c "import json,sys;print(json.load(sys.stdin)['data']['id'])")
curl -N -X POST localhost:8000/api/v1/sessions/$SID/messages \
  -H 'content-type: application/json' -d '{"query":"报销流程是什么","knowledgeBaseIds":["<kb>"]}'
```

### B 侧

```bash
python -m http.server 8124 --bind 127.0.0.1
# http://127.0.0.1:8124/preview/
#   ⋯ → 连接设置 → 网关实时 → http://127.0.0.1:8000
#   左侧「检索」页签验证 M4，「工程问答」验证 M5
```

### 现象 → 原因

| 界面现象 | 大概率原因 |
|---|---|
| 顶部「无法连接网关」 | 地址/端口错、CORS、网关没起 |
| 知识库列表空但 `/health` 是 ok | `data` 形状不是数组也不是 `{items}` |
| 文档标题正常、状态全「未知」 | `parse_status` 不在 7 个枚举里 |
| 分块只有 10 条、翻页不动 | `page`/`page_size` 没透传 |
| 失败文档看不到具体原因 | 错误里没有 `code` |
| 建库表单模型下拉为空 | API Key 缺 `manage_models` 权限（403） |
| **检索一按就 502** | `/search` 的 `knowledgeBaseIds` 是空的——见 P1-1，前端「全部知识库」本该展开成真实 id |
| **检索分数偏低、彼此接近** | 网关把 `rerank.enabled` 默认关成 `false`（阿里云 rerank 欠费），当前是向量+关键词混合召回，分数口径与开启 rerank 时不同，属预期 |
| **问答一直转圈不收尾** | 从来没收到 `complete` 事件；前端把「流断了」当失败报错，查上游是否中途崩 |
| **回答只出一半就报错** | 正常情况下这是对的（见下）——流在 `complete` 之前断掉就是不完整，不该静默成功 |
| **点引用看不到内容** | `references` 事件的 `content` 为空（只给了 id） |

---

## 完成定义

- [x] `chunks` 支持 `page` / `page_size`，返回 `{items,total,page,pageSize}`
- [x] 错误响应统一 `{code,message,data,retryable,requestId}`，成功响应也带 `requestId`
- [x] `/health` 有真探活（3s 超时 + 3s 缓存）、`version`、`checkedAt`
- [x] `/capabilities` 存在，`features` 只写已实现的能力
- [x] `docs/api.md` 的 `parseStatus` 补到 7 个值
- [x] M4 `POST /api/v1/search` 可用，返回 `{items,meta}`
- [x] M5 `POST /api/v1/sessions/{id}/messages` 走 SSE，事件带 `responseType`
- [x] `/search` 入参校验返回 422（P1-1）—— 2026-11-17 实测：不传 kb / 传空数组均返回 422 `VALIDATION_ERROR`
- [x] SSE `error` 事件带 `code` / `retryable` / `requestId`（P1-2）—— 2026-11-17 实测：上游不可达时事件含四字段
- [x] 上游不可达时**不再裸 500**，统一 `{code,message,data,retryable,requestId}`（2026-11-17 补，见 `联调回复-上游不可达错误包裹-2026-11-17.md`）
- [x] **成功响应也带 `X-Request-Id`**（2026-11-17 修正：此前只有异常处理器生成 id，成功响应既无响应头也无 body `requestId`，打勾是虚的。现由 middleware 统一注入，客户端传入值透传，CORS 已 `expose_headers`）
- [x] **`/capabilities` 声明 `wiki`**（2026-11-17 补：漏声明会让前端 `capabilityState()` 显示「未探测」；`contractVersion` → `3.1.0`）
- [x] **模块 6 `type` 归一化到 `topic|entity|hub`**（2026-11-17 补：原先透传上游 6 种 `page_type`，违反 B 契约，15 页里 7 页会显示裸 i18n key；原值另存 `pageType`）
- [x] **A 侧单独在真环境走通**：建库 → 上传 → 状态 → 分块 → 检索 → wiki tree/page（2026-11-17 实测，见 `docs/evidence/M6-wiki-真链路.md`）
- [ ] **与 B 端一起**走完整链路：含问答 SSE 的 `references` 真实渲染与角标跳转（A 侧 `search`/`wiki` 已单独验过，问答的引用展示需要 B 的界面参与才能确认）

---

## 不要做

- **不要在网关里造假数据**骗过界面。前端有演示模式，需求是「真链路能通」。
- **不要改字段名**（`parseStatus` / `fileName` / `startAt` / `endAt` / `knowledgeReferences` 等）。
  前端已按这套写完并自测；改了不会报错，只会静默显示空列表——最难查的一类问题。
- **不要用 `kb_ok()` 包分页接口**，它只取 `data`，`total` 会丢。
- **不要给未实现的能力写 `false`**，那是「明确不支持」的意思；缺席才是「未探测」。
- **不要在 `answer` 分片里做截断去重**。前端按 `done=true` 的最后一个分片收尾，
  中间任何一个分片被吞都会让答案缺字，而且看起来「很正常」。
