# A · 模块 0 待办（本地跑通基线）

> **存档说明**：本卡是 2026-11-12 上午的 M0 待办，部分已落地（`/health` 仍待改，响应包裹部分做了）。
> **当前有效的执行清单是 [`A-NEXT.md`](A-NEXT.md)**，两者冲突时以 A-NEXT 为准。

> 只做「能起来 + 能被调用 + 有证据」。
> 上传、分块、问答、Wiki、选库、模型目录、身份认证一律不在本卡内（分别属于模块 1–5）。
> 验收口径：干净克隆 → 一条命令 → 打开 `/docs` 能用。

## 1. 一条命令启动

- 依赖锁版本：`requirements.txt` 全是 `>=`，等于没锁。给 `requirements.lock`（`pip freeze`）或改 `pyproject.toml`。
- `scripts/dev.ps1` + `scripts/dev.sh`：建 `.venv` → 装依赖 → `uvicorn app.main:app --host 127.0.0.1 --port 8000`。
- **无 WeKnora 也必须能启动**：连接惰性化，启动阶段不发上游请求。

验收：`git clone` 后执行一条命令，`/docs` 出现 5 个已有路由。

## 2. `/health` 真探活

按 `contracts/openapi.json` 的 `Health`（`additionalProperties: false`，不要加自定义字段）：

```
GET /health
{ "status": "ok" | "degraded" | "unavailable", "version": "0.1.0", "checkedAt": "2026-11-12T03:20:00Z" }
```

- 上游探测 3s 超时，结果缓存 3s，避免前端轮询打爆。
- **上游挂掉返回 `200` + `status:"degraded"`**，不要 `500`：前端要能显示「网关在、上游不在」这种可诊断状态，而不是白屏。
- 真的连不上网关时，由前端自己显示「无法连接」，后端不需要造一个 `unavailable` 之外的语义。
- 上游地址/版本不放在 `/health` 里（合同不允许）；需要的话单独开 `/diagnostics`，不要偷偷加字段。

验收：停掉上游进程，`/health` 仍 200 且 `status:"degraded"`；恢复后自动回 `ok`。

## 3. `/capabilities`

```
GET /capabilities
{ "contractVersion": "3.0.0",
  "features": { "knowledgeBases": true, "documents": false },
  "upstreamVersions": { "weknora": "0.9.0" } }
```

- `features` 是 `string -> boolean` 的 map（合同里的 `Capabilities` 只允许这三个字段）。**不要为没探测的能力写 `false`**：缺席才代表「未探测」，写 `false` 是「明确不支持」，两者语义不同。
- 前端把缺席显示为「未探测」，把 `false` 显示为「不支持」。M0 阶段至少报 `knowledgeBases: true`。
- 前端靠它显示「未支持/未配置」，不允许给假开关。

## 4. 统一响应形状（只改现有 5 个路由）

现状问题：`HTTPException(detail=...)` 输出 `{"detail": "..."}`，与 `{code,message,data}` 不同形状，前端无法统一处理。

建议 M0 内一次性定死为 v3 合同形状（改 `wrap()` 一个函数 + `docs/api.md` 一行）：

```
成功: { "code": "OK", "message": "", "data": {...}, "requestId": "..." }
失败: { "code": "SCOPE_REQUIRED" | "UPSTREAM_TIMEOUT" | ..., "message": "...",
        "details": {...}, "retryable": true, "requestId": "..." }
```

- 需加全局 exception handler，保证 404/422/500 也是这个形状。
- `requestId` 每请求生成，回写响应头 `X-Request-Id`。
- 顺带把 `documents.py` 四个裸透传路由包成同一形状（不实现新功能，只统一外层）。

验收：正常、404、上游 500 三种情况响应结构一致。

## 5. 假上游（本地跑通的关键）

`scripts/fake_weknora.py`：独立进程，实现
`GET/POST /api/v1/knowledge-bases`、`GET /api/v1/knowledge/{id}`，固定数据集，`?fail=1` 触发 500。

用途：本机没有 Go、没有 Docker（已实测），B 也能跑「前端 → 网关 → 上游」真实 HTTP 链路，而不是前端自造 Mock。

验收：`python scripts/fake_weknora.py` + 网关指向它，创建→列表→详情全通。

## 6. 版本记录

填 `templates/compatibility-lock.json`：python / fastapi / httpx / WeKnora / DSH 版本与来源。没验证的字段保持 `null`，不要写 `latest`。

## 本卡明确不做

选库/session-scope（模块 1）、模型目录（模块 1）、上传（模块 2）、分块与状态（模块 3）、检索问答（模块 4）、Wiki（模块 5）、OneDrive、身份认证、生产 Docker 部署。

## B（前端）在 M0 的对应交付

- 插件壳：侧栏入口 + 主面板 + Session 头部动作，装进 DSH 后入口不重复、卸载干净。
- 连接状态卡：读 `/health`，区分 `ok / degraded / unreachable / mock` 四态。
- 数据适配：`mock` 与 `http` 双源，配置切换，界面常驻数据来源标识。
- 两个并行 Session 各自显示，不串用。

> 来源标注：本卡基于 2026-11-12 对 Schanora 仓库的代码审阅与本机环境实测（fastapi 未安装、无 docker、无 go、8000/8080 无监听）。
