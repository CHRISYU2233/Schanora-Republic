# A ↔ B 现场联调记录（真网关）

> 日期：2026-11-16 · 联调对象：A 的 Gateway（`http://172.20.10.3:8000`）
> 手册：`联调手册.md`（A → B）· 脚本：`scripts/verify-live.mjs`
> **发给 A 的正式同步单**：`docs/handoff/A-SYNC-2026-11-16.md`（3 项待办含改法与验收判据）；
> 网络恢复后的复验见 **§七** 与 `A-SYNC-2026-11-16-R2.md`；A 修复后的收官复验见 **§八** 与 `B-REPLY-R2-2026-11-16.md`
> 结论：**6 步全流程走通，全部为真数据**；发现 1 处真实缺陷（已修）+ 1 项上游待补
> （14:0x 复验：上游已补 SSE 侧，落库侧仍缺 —— 见 §七；15:3x 复验：A 修复 `d06638d`，落库侧已补，
> **11 通过 / 0 失败 / 0 缺项**，A-1 关闭 —— 见 §八）

---

## 一、结论速览

| 步骤 | 结果 | 关键证据 |
|---|---|---|
| 0 网络 | ✅ | `/health` `status:ok`；`/capabilities` contract `3.0.0`，五个能力全 `true` |
| 1 切网关实时 | ✅ | 界面内「测试连接」成功；刷新后库列表 11 条 = 网关 11 条，演示库 0 残留 |
| 2 建库 | ✅ | 界面出现「联调-20261116024605」，网关侧同 id `2db34aa7…`，模型 `bge-m3` |
| 3 上传 | ✅ | 界面出现文档行，网关侧 `1d625a0f…`，`parseStatus=pending` |
| 4 状态 | ✅ | 9–13 秒后 `completed`（bge-m3 本地向量化），界面徽标同步「已完成」 |
| 5 分块 | ✅ | 网关 `total=20`，界面分页「第 1 页 → 第 2 页」内容不同，无「可能还有更多」 |
| 6 检索 | ✅ | 界面命中 5 条，网关同查询命中 7 条，命中片段含本次上传文档正文 |
| 7 问答 | ✅ 合成答案流式收束；⊘ 角标待 A | 证据模式 257 字；深度研究 432 字（网关落库 316 字），无「答案提前结束」 |

联调脚本最终输出：**9 通过 · 0 失败 · 1 缺项**（缺项为上游未给引用标记，见第四节）。

---

## 二、前置检查（第 1 步在界面里也做了一遍）

```
GET /health        → 200 {"status":"ok","version":"0.1.0"}
GET /capabilities → contractVersion 3.0.0
features = {"knowledgeBases":true,"documents":true,"chunks":true,"search":true,"sessions":true}
```

CORS 实测：`OPTIONS /api/v1/knowledge-bases`（`Origin: http://127.0.0.1:8124`）返回
`access-control-allow-origin: *`、`allow-headers: content-type,authorization`，
所以 `127.0.0.1:8124` → `172.20.10.3:8000` 的跨域预检通过，前端不需要代理。

模型下拉实测包含 `bge-m3`（`builtin-ollama-embedding`，`isDefault:true`），
与手册第五节的建库要求一致。

---

## 三、契约对账（前端 ↔ 网关）

| 项 | 网关实际 | 前端处理 | 结论 |
|---|---|---|---|
| 响应信封 | `{code:0,message,data,retryable,requestId}` | `unwrap()` 认 `code===0` / `'OK'`，失败信封把 `requestId` 带进 `ApiError.extra` | 一致 |
| 知识库列表 | `data` 为裸数组 | `toList()` 收敛数组与 `{items,total}` | 一致 |
| 分块分页 | `data:{items,total,page,pageSize}` | 读 `total` 决定页码与下一页可用性 | 一致（手册 P0 补的分页确实生效） |
| 检索 | `data:{items:[…],meta?}` | `items` 逐个 `normalizeHit` | 一致 |
| 上传 | 表单字段名 `file` | XHR `FormData.append('file',…)`，兼容 `{knowledge:{…}}` 包裹 | 一致 |
| 问答 SSE | `responseType`: references → answer(流式) → complete；error 带 code/retryable/requestId | 按行切 `data:`，`answer` 拼接、`complete` 才算完成、提前断流报 `STREAM_INCOMPLETE` | 一致 |
| 引用格式 | **答案正文用 `<kb doc="…" chunk_id="…" kb_id="…" />` 内联标签** | 原先只认 `[n]` → 裸标签直接显示 | **不一致，已在 B 侧修（见第四节）** |

---

## 四、发现与处理

### 4.1 已修：引用标签 `<kb/>` 没有被转换（真实缺陷）

- 现象：A 的历史答案里出现 `<kb doc=".tmp_test_doc.md" chunk_id="fc791c69-…" kb_id="9d56b682…" />`，
  前端 `inlineMd()` 只把 `[n]` 渲染成角标，标签被当正文原样显示。
- 处理：`src/lib/cite.js` 新增 `normalizeCitations()` / `citationIndex()`，渲染前把标签换成 `[n]`：
  `chunk_id` 能对上 `knowledgeReferences` 的某条 → 用该条序号（与下方引用列表编号一致）；
  对不上 → 删除标签，不编造落不回列表的假出处；同一 chunk 多次出现用同一序号。
- 验证：13 条单测（`test/cite.test.mjs`）；并用网关里那条**真实历史答案**回放，
  输出 `…住宿费一晚最多可以报销500元。 [1]`，裸标签 0 处、序号落到引用第 1 条。

### 4.2 待 A：合成答案不带任何引用标记

- 现象：本次两次深度研究问答（419/432 字）正文既无 `[n]`，也无 `<kb/>` 标签；
  `knowledgeReferences` 只回 1 条，且指向文档第 1 块（与答案实际引用的第 5 节不符）。
- 影响：验收清单第 6 步「带 `[n]` 引用角标」目前无法成立；用户能看到答案与 1 条参考，
  但角标无法回指原文。
- 建议 A 侧二选一：① 在合成 prompt 里要求模型输出 `[n]` 或 `<kb …/>`；
  ② 直接把本轮命中的分块按引用顺序回填 `knowledgeReferences`（现在这条与答案不对应）。
- B 侧已就绪：只要 A 给标记，前端立刻能渲染成可点的 `[n]`（4.1 的适配 + 既有角标三态校验）。

### 4.3 未覆盖（不声称通过）

- P1 采集真实入库（OneDrive → WeKnora）：`/api/v1/clips` 仍 404，A 侧未实现 `D-CLIP-SERVICE.md` 的四端点。
- P2 浏览器桥：`/api/v1/browser/status` 仍 404，需 A 侧桥 + 本机 bsk daemon。
- 真 DSH 安装/升级/卸载（T12）：本机无 DSH 运行时。

---

## 五、复现方式

```bash
# 1. 与 A 同网络，先确认链路
curl http://172.20.10.3:8000/health          # {"status":"ok",…}

# 2. 仓库根起静态预览
python -m http.server 8124 --bind 127.0.0.1

# 3. 全流程联调（建库→上传→状态→分块→检索→问答）
node scripts/verify-live.mjs http://127.0.0.1:8124/preview/ http://172.20.10.3:8000
```

复验（不再新建库，避免在 A 后台堆测试数据）：

```bash
LIVE_KB_ID=2db34aa7-71ff-43fc-adf6-6a9f5269c34d \
LIVE_DOC_ID=1d625a0f-c6db-414b-acd7-3ce6d713239d \
node scripts/verify-live.mjs http://127.0.0.1:8124/preview/ http://172.20.10.3:8000
```

脚本产出 `docs/evidence/live-<时间戳>.json`（逐项断言 + 控制台异常），本机已有
`live-20261116024240.json`、`live-20261116024605.json`、`live-20261116025058.json`。

---

## 六、联调产生的测试数据（供 A 后台核对/清理）

| 知识库 | 创建时间 | id | 文档 |
|---|---|---|---|
| 联调-20261116024200 | 10:42:09 | `094bcf2e-50f5-4fe2-8050-9b0a06bf1ffa` | 联调文档-20261116024200.md |
| 联调-20261116024240 | 10:42:50 | `a41e8218-2b27-4cd7-961d-eb094a2cfaa3` | 联调文档-20261116024240.md |
| 联调-20261116024423 | 10:44:31 | `d7753789-0721-4f78-92b9-b91c2d8c81f3` | 联调文档-20261116024423.md |
| 联调-20261116024605 | 10:46:14 | `2db34aa7-71ff-43fc-adf6-6a9f5269c34d` | `1d625a0f-c6db-414b-acd7-3ce6d713239d`（复验复用） |

> 四个库都是脚本按时间戳新建的「空壳 + 一份 1.1 万字测试文档」，每个库 1 个文档，
> 全部落在 10:42–10:46 的联调窗口内（多出来的是脚本首次超时重跑时又建了一次）。
> **未删除**：等 A 在 WeKnora 后台确认「界面建的库/文档确实在后台可见」之后自行清理 ——
> 我不动 A 的数据。
>
> 后续：A 已于当日下午清理上述 4 个库；14:0x 复验改为复用仍保留的 `联调-20261116051949`（见 §七）。

---

## 七、14:0x 复验（网络恢复后）

### 7.1 网络变更

13:1x–14:05 期间本机到 `172.20.10.3:8000` 完全不可达：本机 `172.20.10.2/28` 与目标同网段，
`ping` 3 包全丢、TCP 8000 超时 —— 当时判断「A 机离开热点」而非「只拦 8000 入站」。14:05 `/health`
自行恢复（0.12s，`status:ok`），ICMP 仍被过滤但对验收无影响。

### 7.2 复验结果：10 通过 · 1 失败 · 0 缺项

复用 `联调-20261116051949`（`7e9a78c3-…`，文档 `7c89ceaa-…`，20 块，`completed`），未新建库。
断言原文：`docs/evidence/live-2026111606*.json`。

| 项 | 状态 | 实测 |
|---|---|---|
| L0 网关可用、五能力齐全 | pass | `0.1.0` / `contract 3.0.0` / features 全 `true` |
| L1a 测试连接 | pass | 真 `/health` |
| L1b 切网关实时 | pass | 界面 3 库 = 网关 3 库，演示残留 0 |
| L2 / L3 | skip | 复用既有库与文档 |
| L4 处理状态 | pass | `completed` ↔ 界面「已完成」 |
| L5 分块分页 | pass | `total=20`，第 1 页 → 第 2 页内容不同 |
| L6 检索 | pass | 界面 4 = 网关 4，片段含本文档正文 |
| L7a 证据模式 | pass | 255 字证据气泡，4 条命中 |
| L7b 深度研究 SSE | pass | 界面 357 字 / 落库 118 字，`complete`，无提前结束 |
| L7c 引用列表（硬性） | pass | 最后一条答案引用 5 条，无裸 `<kb/>` |
| L7e `[n]` 角标（信息） | skip | 上游仍未给标记 |
| **L7f 引用落库（A-1）** | **fail** | 界面 5 条 / 落库 1 条 `chunkIndex=[0]` |

### 7.3 A-1 的实际状态：实时对、刷新错

取原始 SSE 事件后，同一条答案存在两份引用数据：

| 来源 | 内容 | 用户可见效果 |
|---|---|---|
| SSE `references` 事件 | `[chunkIndex=12 score=0.5813, chunkIndex=3 score=0.5518]` | 刚答完：引用列表 5 条，指向真实块 |
| `GET /sessions/{id}/messages` | `[{chunkIndex:0, score:0.5723, startAt:0, endAt:5657}]` | 按 F5 后：只剩 1 条，指向文档开头 |

前端 `normalizeMessage()` 只读 `knowledgeReferences`，不存在「渲染丢数据」的可能；问题在落库/回读侧。
已出 `docs/handoff/A-SYNC-2026-11-16-R2.md`，含 A 侧可直跑的三条 curl 自查。

### 7.4 判据收紧（本轮 B 侧改动）

1. `L7c` 原来统计整页 `.sch-refs .sch-ref`，会把上一条证据气泡的命中算进来 —— 14:10 那轮答案没渲染
   却判了 pass。现改为「只看最后一条助手消息 + 本轮答案必须存在」。
2. 新增 `L7f`：直接读网关落库 `chunkIndex`，同时打印界面(SSE)条数与落库条数，专门抓这类「两份数据不一致」。
3. `L7b` 超时时打印每条助手消息实况（字数 / note / refs 数），便于区分「没渲染」与「被别的消息顶上来」。

### 7.5 A-2 / A-3 / M6 复测

14:05 全部仍 404，响应体与随机路径一字不差（全局 404 兜底，路由未注册）：
`wiki/tree`、`wiki/index`、`wiki/folders`、`wiki/pages`、`POST /clips`、`GET /jobs/{id}`、
`browser/status`、`plugins`。故 T04/T08/T09 维持 `mock_only`，M6 维持「A 实现中」。

---

## 八、15:3x 复验：A-1 关闭（A 修复 `d06638d` 后）

### 8.1 结果：11 通过 · 0 失败 · 0 缺项

复用 `联调-20261116051949`（`7e9a78c3-…` / 文档 `7c89ceaa-…` / 20 块），未新建库。断言原文 `docs/evidence/live-2026111607*.json`。

| 项 | 状态 | 实测 |
|---|---|---|
| L0–L6 | pass | 与 §7.2 同（`contract 3.0.0`、3 库对齐、`total=20` 翻页、检索 4=4） |
| L7a 证据模式 | pass | 256 字证据气泡 |
| L7b 深度研究 SSE | pass | 界面 308 字 / 落库 126 字，`complete`，无提前结束（界面多出的是检索范围与引用列表文案） |
| L7c 引用列表（硬性） | pass | 最后一条答案引用 3 条，无裸 `<kb/>` |
| **L7f 引用落库（A-1）** | **pass** | 界面(SSE)=3 条 / 落库=3 条，`chunkIndex=[12,8,15]`，score 降序 |

同日 15:33 另一轮为 `4 条 / 4 条 chunkIndex=[4,19,8,15]`，同样一致。

### 8.2 逐字段对齐（独立探针，不经前端）

会话 `e589eebe…`，两轮问答：

| 轮次 | SSE `references` | `GET /messages` 落库 |
|---|---|---|
| 第 1 问 | `12 / 0.6184 / 06f83ffd`、`3 / 0.5939 / 8313c0b2` | 完全一致 |
| 第 2 问 | `14 / 0.5964 / b96196df`、`12 / 0.5619 / 06f83ffd` | 完全一致，且第 1 问那条未被覆盖 |

多轮各自正确 → 网关缓存是按 `assistantMessageId` 分键，不是「会话级最近一次」。

### 8.3 A 给出的根因（已接受）

- `Rerank skip reason="empty_model_id"`：rerank 模型未配置（欠费），重排阶段直接跳过；
- `Merge chunk_cnt=19 → merged_chunks=1`：父子块文档在 Merge 阶段被合成 1 个父块（`chunk_index=0`），
  这才是「恒第 0 块、`startAt=0 endAt=5657` 整篇跨度」的来源；普通分块文档不受影响。
- 修法是网关侧兜底：chat 流式时缓存 `assistantMessageId → 正确多块`，`GET /messages` 返回时替换。
  治本需改 WeKnora 的 Merge 逻辑，双方同意暂缓。

### 8.4 判据再加严（本轮 B 侧改动）

`L7f` 原来只判「落库有 `chunkIndex` 且不全为 0」，理论上「只落 1 条真实块」也能过、刷新后仍会少几条。现加两条：

1. 落库条数必须等于 SSE 条数；
2. `score` 必须降序（引用列表按相关度排）。

失败时直接打印「条数与 SSE 不一致」/「score 非降序」，不必回头对数。

### 8.5 两条边界（A 已确认，非 B 待办）

1. **旧消息不回填**：修复前已回答的消息仍为 1 条 `chunkIndex=0`（实测 15:04、15:18 两条），老会话按 F5 仍退化；重问一次即可。
2. **网关重启丢缓存**：缓存是进程内存，重启后重启前的消息退回 `[0]`。

### 8.6 顺手发现的两处环境问题

| 问题 | 证据 | 影响 |
|---|---|---|
| `test1` / `AX-200` 绑定模型 `Qwen3.8 Max` 返回 404 `model_not_found` | SSE `responseType=error` 原文，且该错误串被当 `answer` 落库（283 字） | 界面把报错当答案显示；B 侧 L7b 因「非空」判 pass，需 A 侧改「error 不落成 answer」 |
| `AX-200` 库 `capabilities.vector/keyword` 全 `false` | `GET /knowledge-bases/cdb50e48…` | 检索必 0 命中，问答固定回 `Sorry, I am unable to answer this question.` |
