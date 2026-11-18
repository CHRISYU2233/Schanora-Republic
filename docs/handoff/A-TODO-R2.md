# A · 现在要做什么（R2，2026-11-16 14:0x 复验后）

> **状态：P0-1 已完成并验收通过**（A 修复 `d06638d`；B 于 15:3x 复验 11 通过 / 0 失败，L7f pass）。
> 本文件保留作当时的问题描述与验收判据；闭环结论见 `B-REPLY-R2-2026-11-16.md`。
> 剩余待确认项（clips / browser / wiki / plugins）仍未注册，见该回执 §五。

> **收件**：A（xiqing5678-rgb / Gateway + WeKnora）
> **网关**：`http://172.20.10.3:8000`（`0.1.0`，`contractVersion 3.0.0`），14:05 `/health` 恢复
> **一句话**：**只有 1 件事必须做** —— 合成问答的引用列表在**写库/回读**这条路上仍是文档第 0 块；
> 实时推送（SSE）那份你已经改对了。其余 4 项只需回一句「仍暂缓」或给个时间点，不用写代码。
> 取证与原始断言：`A-SYNC-2026-11-16-R2.md` · `docs/evidence/live-2026111606*.json`

---

## 0. 先看清楚：同一条答案，现在有两份不一样的引用数据

用仍保留的库 `联调-20261116051949` / 文档 `7c89ceaa-…`（20 块）实测，问题是
「第14节的扭矩标准是多少」，同一条答案：

| 取的哪条路 | 返回的引用 | 用户看到什么 |
|---|---|---|
| **SSE `references` 事件**（刚答完，实时渲染） | 2 条：`chunkIndex=12 score=0.5813`、`chunkIndex=3 score=0.5518` | ✅ 界面就显示这 2 条（另一道题实测 5 条），点开跳到第 12 / 3 块，正确 |
| **`GET /sessions/{id}/messages`**（刷新后回读） | 1 条：`chunkIndex=0 score=0.5723 startAt=0 endAt=5657` | ❌ 按 F5 后只剩 1 条，点开跳到文档开头 |

也就是说：**写入数据库那一版被换成了第 0 块**，推送那一版是对的。这就是本轮唯一要改的地方。

---

## P0-1 · 引用列表落库要存「本轮召回」，不是「文档第 0 块」

### 现状

`GET /api/v1/sessions/{id}/messages` 返回的 `knowledgeReferences` 与同一次问答的 SSE `references`
不是同一组数据：条数从 2（或多条）变成 1，`chunkIndex` 恒为 `0`，`startAt` 恒为 `0`，`endAt=5657`
（覆盖文档开头一大段），`score` 也与推送那份对不上（0.5723 vs 0.5813）。

### 为什么会这样（三种可能，按可能性排）

1. 写 assistant message 时**另查了一次**分块接口并取 `items[0]`；
2. 写库时把 SSE 那份数组**只取了第一个元素**；
3. 回读接口 `GET /messages` 在组装响应时**重新回填**了引用，而不是读库里存的那份。

三处只要有一处这么做，结果就是现在这样。

### 改法（3 步，都只在落库/回读链路上，别动 SSE）

1. **写库**：把 SSE `references` 事件里的 `knowledgeReferences` 数组**整体**写进这条 assistant 消息
   的 `knowledgeReferences` 字段，条数、顺序、`score` 原样保留（已是 score 降序，不要重排）。
2. **不要二次查询**：不要为了「补全标题」再打一次 `/documents/{id}/chunks`，更不要取 `items[0]`。
   推送那份里 `knowledgeTitle`、`knowledgeId`、`chunkIndex`、`startAt`、`endAt`、`score` 都已齐全。
3. **回读原样返回**：`GET /messages` 直接把库里的数组序列化出去，不要在读路径上再加工。

字段口径（前端按下标 + 1 显示角标，全部按这个走）：

| 字段 | 要求 |
|---|---|
| `id` | **分块 id**（如 `06f83ffd-…`），不是文档 id |
| `chunkIndex` | 与 `GET /documents/{id}/chunks` 的 `chunkIndex` 同源，可直接用于定位原文 |
| `score` | 保留原值，数组按 score 降序 |
| `startAt` / `endAt` | 保留原值，前端不需要但排查要用 |
| 条数 | 与 SSE 那次推送一致，不截断 |

### 自查（三条命令，不用起前端）

```bash
GW=http://172.20.10.3:8000
KB=7e9a78c3-3374-483a-bc12-e217722d5c30
SID=$(curl -s -X POST -H 'content-type: application/json' \
  -d "{\"title\":\"A-自查\",\"knowledgeBaseIds\":[\"$KB\"]}" $GW/api/v1/sessions \
  | python -c "import sys,json;print(json.load(sys.stdin)['data']['id'])")

# ① 推送那份（这条已经是好的，留作对照）
curl -sN -X POST -H 'content-type: application/json' -H 'accept: text/event-stream' \
  -d "{\"query\":\"第14节和第17节的装配扭矩分别是多少\",\"knowledgeBaseIds\":[\"$KB\"]}" \
  $GW/api/v1/sessions/$SID/messages | grep '"responseType": "references"'

# ② 落库那份（这条是要修的）
curl -s "$GW/api/v1/sessions/$SID/messages?limit=5"
```

**判据**：② 的 `knowledgeReferences` 与 ① 的条数、`chunkIndex`、`score` 一致。
现在的输出是 ② 只有 1 条且 `chunkIndex=0`，一眼就能对上。

### 验收（B 侧一条命令，你那边不用跑前端）

```bash
LIVE_KB_ID=$KB LIVE_DOC_ID=7c89ceaa-275b-49bb-a4fd-1e0167f918d0 \
node scripts/verify-live.mjs http://127.0.0.1:8124/preview/ http://172.20.10.3:8000
```

期望：`L7f` 由 `fail` 转 `pass`，脚本收敛为 **11 通过 / 0 失败 / 0 缺项**。
现在的失败行原文：

```
L7f fail | 界面(SSE)=5 条 / 落库=1 条 chunkIndex=[0] 文档共 20 块 · 落库全部指向第 0 块：刷新后引用列表会退化
```

> 上面这行的「界面 5 条」是脚本那轮用的题目；本节表格里的 2 条是另一次探针的题目。
> 题目不同导致命中块数不同，**但落库一律只有 1 条 `chunkIndex=0`**，这是要修的那个常量。

---

## 1. 只需确认状态的 4 项（不用写代码）

14:05 复测，以下端点全 404，响应体与随机路径一字不差（`{"code":"NOT_FOUND","message":"Not Found",…}`，
说明是网关全局 404 兜底、路由未注册，不是资源不存在）：

| 端点 | 现状 | 需要你回什么 |
|---|---|---|
| `POST /api/v1/clips`、`POST /clips/{id}/commit`、`GET /clips/{id}`、`GET /jobs/{id}` | 404 | 仍按「暂缓」处理？恢复触发条件是什么（何时/等什么） |
| `GET /api/v1/browser/status` | 404 | 同上 |
| `GET /knowledge-bases/{id}/wiki/tree`、`/wiki/index`、`/wiki/folders`、`/wiki/pages` | 404 | 计划什么时候注册；口径已冻结在 `C-PLUGIN-PORT.md` 五章，注册后 B 侧不用改 |
| `GET /api/v1/plugins` | 404 | 插件中心页读的目录接口。不影响 P1–P4 主链路，是否计划补 |

**这些不影响本轮验收**，但 B 侧界面现在是「如实显示未实现」，需要知道要等多久。

---

## 2. 现在别再动的两处

1. **SSE `references` 不要改回单条**：现在是 score 降序、指向真实召回块，是对的。
   如果为了「统一两份数据」把它也降级成第 0 块，前端会从 5 条正确退到 1 条错误，比现在更差。
2. **不要为 `[n]` 角标换模型**：答案正文仍无 `[n]`，这是**信息项**、不阻塞验收。
   上游一旦给标记，前端 `normalizeCitations()` 会自动转成可点角标（已用你们 09:07 那条历史答案回放验证）。

---

## 3. 术语对照（避免歧义）

| 词 | 含义 |
|---|---|
| `references` 事件 | SSE 流里 `responseType=references` 的那一条，随答案推送，供**实时渲染** |
| `knowledgeReferences` | 消息落库字段，`GET /messages` 读它，供**刷新后渲染** |
| `chunkIndex` | 分块在文档内的序号，从 0 开始；第 0 块 = 文档开头那段 |
| `L7f` | 本轮新加的验收断言，专门比对「推送那份」与「落库那份」是否一致 |

---

## 4. 改完之后

- B 侧会在下一轮复验里跑 `verify-live`，把 `L7f` 结果写进 `docs/evidence/live-<时间戳>.json` 与验收表；
- 若 `L7f` 仍 fail，B 侧会把 ① 与 ② 的原始 JSON 并排贴回这份文档，不再互相猜测；
- 本轮 B 侧未新建知识库，复用 `7e9a78c3-…`；产生的会话（`B-探针-*` 与脚本自动建的几条）请你按需清理。
