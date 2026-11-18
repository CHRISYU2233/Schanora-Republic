# 本地内核（前后端一体）· 实施与验收记录

> 2026-11-18 发布候选复验记录见 [CODEX-HANDOFF](../handoff/CODEX-HANDOFF.md)。正式插件使用本地内核，开发预览才提供三档切换。下方记录为 WorkBuddy 首轮基线。

> 目标：插件自己带后端，**不用网关、不联网**也能建库、上传、分块、检索、问答、采集入库；
> 数据以文件形式落在可同步的目录（OneDrive 共享文件夹）里。
> 远程网关与演示数据保留为另外两档，互不影响。

## 1 结构

```
plugins/schanora/client/
  index.js                 # 宿主入口：apply() 时 startLocalKernel()，卸载时停止
  src/server/
    paths.js               # 数据根解析 + 目录布局（SCHANORA_ROOT → OneDrive → ~/.schanora）
    text.js                # 类型识别、docx/pdf/文本抽取、分块、分词
    store.js               # 库/文档/分块/会话/消息/采集/任务/Wiki 的文件读写
    search.js              # BM25 打分 + topK
    http.js                # 零依赖 http 服务：/health、/capabilities、/api/v1/*
    index.js               # 单例 start/stop，端口 4317 起、被占则 +1（最多 5 个）
scripts/local-server.mjs   # 独立启动：内核 + 静态预览台同端口
scripts/seed-local.mjs     # 演示语料（工程标准库 3 篇，幂等）
scripts/verify-local.mjs   # 真实浏览器验收（L1–L8）
```

`src/server/*` **不会进浏览器 bundle**：`scripts/build-client.mjs` 只内联 `src/lib/*.js`。
它在宿主 Node 环境里跑，由 `client/index.js` 直接 import。

## 2 数据布局（文件即真相）

```
<数据根>/
  schanora.json
  kbs/<kbId>/kb.json
  kbs/<kbId>/docs/<标题>-<后缀>.md | .json | chunks.json
  sessions/<sessionId>.json
  clips/<clipId>.json
  jobs/<jobId>.json
```

写盘走「临时文件 + rename」的原子写，同步盘不会读到半个 JSON。
数据根按顺序取：`--root` / `SCHANORA_ROOT` → `~/OneDrive/Schanora`（存在就用）→ `~/.schanora`。

## 3 接口面（与网关契约同名，前端零分支）

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/health` | 版本以 `-local` 结尾，前端据此确认「这是自家内核」而不是占着端口的别人 |
| GET | `/capabilities` | `storeRoot` + features（`search.vector` / `chat` / `browser` 如实报 false） |
| GET/POST | `/api/v1/knowledge-bases` | 列表 / 建库 |
| GET/DELETE | `/api/v1/knowledge-bases/{id}` | 详情 / 删库 |
| GET/POST | `/api/v1/knowledge-bases/{id}/documents` | 文档列表 / multipart 上传（即解析分块写盘） |
| GET | `/api/v1/documents/{id}/chunks?page&page_size` | 分块分页 |
| POST | `/api/v1/search` | BM25 检索，返回 `score` 与 `meta{mode,took,scanned}` |
| GET/POST | `/api/v1/sessions`、`/api/v1/sessions/{id}/messages` | 会话；POST 为 SSE（references → answer 分片 → complete） |
| POST | `/api/v1/clips`、`/api/v1/clips/{id}/commit` | 采集草稿与入库（内容哈希相同则覆盖同一篇，版本 +1） |
| GET | `/api/v1/knowledge-bases/{id}/wiki/tree`、`/wiki/pages/{slug}` | 由文档标题与首段自动生成的 Wiki |
| GET | `/api/v1/local/info`、POST `/api/v1/local/reveal` | 统计 / 在系统文件管理器里打开数据目录 |

## 4 前端改动

- `DEFAULT_SETTINGS.mode = 'local'`，`baseUrl` 置空（本地档用端口探测，不需要人填）。
- `baseOf(settings)` 统一出口：本地档返回探测到的 `http://127.0.0.1:43xx`，探不到也**不返回空串**
  （空串会变成相对路径，请求打到预览页自己身上，报一堆 404）。
- `isRemote(settings)` / `sourceLabel(t, mode)` 取代原先把 `mode === 'http'` 当「真后端」的硬判断。
- 设置抽屉按档位显示各自字段：本地（数据目录 + 打开文件夹）、远程（地址 + API Key）、演示（场景）；
  「测试连接」跟着草稿当前档位探测，演示档不显示该按钮。
- 顶栏数据来源徽标三档各有名字：本地内核 / 网关实时 / 演示数据。
- CORS 放行 `X-API-Key`（远程档填了 Key 时本地不再需要，但同一套代码要能跑）。

## 5 验收（`npm run verify:local`，2026-11-18）

前置：`npm run local` + `npm run seed:local`，浏览器跑 `http://127.0.0.1:4317/preview/`。

| 编号 | 断言 | 结果 |
| --- | --- | --- |
| L1 | 面板连上本地内核（不显示「内核没有响应」） | ✓ |
| L2 | 知识库列表读自磁盘（工程标准库） | ✓ |
| L3 | 未选库不发请求、提示先选范围 | ✓ |
| L4 | 选库后 BM25 命中本地文件 | ✓ hits=2 |
| L5 | 长文档分块翻页（11 块 / 每页 10） | ✓ 第 1 页 → 第 2 页 |
| L6 | 采集正文提交入库：列表 +1 且磁盘出现对应文件 | ✓ 3→4，磁盘有 |
| L7 | 设置抽屉三档模式 + 数据目录与「打开文件夹」 | ✓ 目录 = 实际 storeRoot |
| L8 | 问答 SSE 出引用且消息落库（问 + 答都能查到） | ✓ |

截图：`docs/evidence/shots-local/01-kb-local.png`、`02-qa-local.png`、`03-settings-local.png`、`04-settings-http.png`。

另外跑过一次 curl 级整链（建库 → 上传 → 分块 → 检索 → SSE 问答 → 拉消息），确认 `sessions/<id>.json`
里同时有 user 与 assistant 两条，且 assistant 带 `knowledgeReferences`。

## 6 过程中改掉的两个问题

1. **设置页误报「工具注册失败」**：宿主压根没提供工具接口时也会红字提示注册失败，容易被当成装坏了。
   改成只有「宿主给了 `registerTool` 但调用失败」才报，未提供仍显示「未提供」。
2. **CORS 未放行 `X-API-Key`**：预览台与服务同源时看不出问题，一旦预览走 8124、内核走 4317 就会被预检拦住。

## 7 与网关档的关系

同一个前端，同一套接口名。网关档验证的是「契约与真实 WeKnora」，本地档验证的是「无外部依赖时产品仍可用」。
两档共用 `normalizeKb/normalizeDoc/normalizeHit/...`，所以字段形状不会分叉；差异只在后端是谁。

## 8 未做

- 向量检索：要装 Ollama + embedding 模型，本机没装时 `search.vector=false`，只用 BM25。
- 生成式回答：同上，没对话模型时走原文摘录并标注。
- 多机并发写冲突检测：当前是「最后落盘为准」。
- 采集的网页抓取：本地内核不含浏览器桥，只能粘贴正文 / 上传文件。
