# 后端（Gateway）启动与联调说明

> 2026-11-17 · 由 A 侧交接文档脱敏整理（原文档含账号、密钥指纹与本机路径，不入库）
>
> 面向：拿到仓库要跑起 `gateway/` 并和前端联调的人。

## 一、整体结构

```
浏览器 / DSH 客户端  →  gateway/（Project API，8000）  →  WeKnora（8080）
      前端（B）             后端（A）                       上游引擎
```

- **网关**用 FastAPI 封装 Project API：字段转换（WeKnora 的 `snake_case` → 对外 `camelCase`）、统一响应包裹与错误码、服务端保管 API Key、上游故障降级。
- **前端**只认 HTTP，不接触密钥；`docs/api.md` 是双方唯一共享契约。
- **API Key 只在服务端**：放在 `gateway/.env`，该文件已被 `.gitignore` 覆盖。

## 二、环境要求

| 项 | 要求 |
| --- | --- |
| Python | 3.11+（开发环境实测 3.13） |
| WeKnora | Docker 部署，API 暴露在 `http://localhost:8080`（`X-API-Key` 鉴权），后台在 `http://localhost` |
| Ollama（可选） | 本地模型推理；`bge-m3` 做 embedding、`qwen2.5:3b` 做生成。纯 CPU 推理时 Wiki 生成一次约 5 分钟 |
| 网关端口 | `8000`（前端默认 `http://127.0.0.1:8000`） |

> Docker Desktop 在 Windows 上依赖 WSL2；若由自动化进程拉起会自行退出，需人工启动后再继续。网关本身是纯 Python，不依赖 Docker，可以先单独起。

## 三、启动步骤

```bash
cd gateway
python -m venv .venv
# Windows: .venv/Scripts/activate    macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env        # 填 WEKNORA_BASE_URL 与 WEKNORA_API_KEY
uvicorn app.main:app --host 127.0.0.1 --port 8000
```

自检：

```bash
curl -s http://127.0.0.1:8000/health          # → ok
curl -s http://127.0.0.1:8000/capabilities    # → features 里各模块布尔值
curl -s "http://127.0.0.1:8000/api/v1/models?type=Embedding"
```

契约回归测试（不依赖 Docker，用假上游）：

```bash
cd gateway && python -m pytest -q
```

## 四、密钥怎么来

- WeKnora 后台（`http://localhost`）→「设置 / API Keys」创建，填进 `gateway/.env` 的 `WEKNORA_API_KEY`。
- 启动后若请求返回 **401**：是该 key 失效或被重置，重新创建并重启网关 —— 不要去换另一把"看起来对"的 key。
- **不要把密钥写进文档、日志或前端**。排查问题需要核对时只记录首尾指纹，不记明文。

## 五、模型清单与注意事项

| 用途 | 模型 | 说明 |
| --- | --- | --- |
| 生成 | `builtin-ollama-chat`（qwen2.5:3b） | 本地，可用 |
| embedding（本地） | `builtin-ollama-embedding`（bge-m3） | 本地，可用 |
| embedding（远端） | `text-embedding-v4` | 云端，**按量计费**；欠费时上游返回 `Access denied` |

- **embedding 是库级绑定**：换 embedding 模型必须重建 collection 并重新向量化，否则维度/语义空间不一致，检索会失败或分数异常。
- embedding 管召回、rerank 管排序，是两个独立开关。
- 上游某篇文档 `parse=failed`（例如云端额度问题）时，检索会 0 命中 —— 先查文档解析状态，再怀疑检索。

## 六、Wiki（模块 6）实现口径

对接 `docs/api.md` §6，实现要点（改之前先读契约）：

- **`type` 归一化到 `topic | entity | hub`**：上游 6 种 `page_type` → `concept/synthesis/comparison → topic`、`summary/index → hub`、`entity → entity`，未知兜底 `topic`；上游原值另存 `pageType` 仅供排查。**不要改回透传**：实测 15 页里有 7 页会因此显示裸 i18n key。
- `status` 透传（上游只有 `draft` / `published`；自动生成的页面全是 `draft`）。
- `tree` 用 `GET /wiki/pages` 分页拉全再拼装（`/index` 缺 status/version/updatedAt/sources，信息不足）。
- `sources[]` 从 `SourceRefs` 按 `|` 切分解析成 `{knowledgeId, title, chunkCount}`，解析不出的项丢弃并记日志，不塞空值；`chunk_refs` 第一版不暴露。
- `slug` 用 `{slug:path}` 匹配（含 `/` 与中文）。
- 回填 `chunkCount` 有并发上限（4）与 5s 超时，失败降级为 0，不阻断 tree。
- 未开启 Wiki 的库返回 **400**（不是 502）；已开启但无页面返回 `items: []`（不是 400/404）。
- `/capabilities.features.wiki = true`。

## 七、工程约定

1. **改接口先改 `docs/api.md`**，再通知前端；不要口头改契约。
2. SSE 的 `references` 是数组，不要改回单条；不要截断引用条数。
3. 不要把引用编号（角标）依赖到某个特定模型上。
4. 任何推送 GitHub 前先经对方同意，按分支 + PR 流程走（见根 `README.md`「提交与评审」）。
5. 上游不可达时统一 `{code, message, data, retryable, requestId}`，不允许裸 500；成功响应也带 `X-Request-Id`。
