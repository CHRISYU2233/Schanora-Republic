# A · 现在还要做什么（R3，2026-11-16 16:0x）

> **收件**：A（xiqing5678-rgb / Gateway + WeKnora）
> **上一轮已闭环**：R2 的 P0（落库引用恒第 0 块）已由 `d06638d` 修好，B 于 15:31–15:41 复验
> **11 通过 / 0 失败 / 0 缺项**，L7f 转 pass。**本文件只列尚未完成的事**，不必再回头看 R2 任务卡。
> **判据来源**：B 侧 15:31 / 15:40 / 15:56 / 16:04 四次实测 + 你的回复单，命令与返回都写在每项里。
> **B 侧当前无待办**：产品代码、脚本、37 条单测、演示态 E2E（19 通过/0 失败/2 环境缺项）全绿。

---

## 0. 一张表看完

| 优先级 | 事 | 性质 | 卡住谁 |
|---|---|---|---|
| **P0-1** | 网关起回来 | 运维 | 卡所有真链路验收（现在全不可用） |
| **P0-2** | `error` 事件不要落成 answer | 代码（约十几行） | 卡演示：界面会把 API 报错当答案显示 |
| **P0-3** | 换一个可用的生成模型 | 配置 | 卡 `test1` / `AX-200` 两个库的问答 |
| P1-1 | `AX-200` 打开检索通道 | 配置，仅该库要演示时 | 卡该库检索与问答 |
| P1-2 | M6 Wiki 两个端点 | 实现（口径已定） | 卡 Wiki 页签，不卡主链路 |
| P2-1 | `GET /api/v1/plugins` | 实现（很低） | 卡插件中心页显示「未实现」 |
| 暂缓 | A-2 clips 四端点 / A-3 browser | 已同意冻结 | 不卡任何已验收项 |
| 回一句 | 老消息回填 / 缓存落库 | 决策 | 不卡验收，只影响老会话体验 |

---

## P0-1 网关起回来

**现状（四段实测，可直接复现）**

| 时间 | 探测 | 返回 |
|---|---|---|
| 15:31 | `GET /health` | `200`，`{"status":"ok","version":"0.1.0"}`，0.11s |
| 15:41 | `verify-live` 全流程 | 11 通过 / 0 失败 / 0 缺项（跑得通） |
| 15:56 | `GET /health` / `GET /knowledge-bases/{id}` | 无响应 / **502 Bad Gateway** |
| 16:04 | `GET /health` | `000`，8.00s 超时 |

**改法**

1. 确认进程是否在跑：`netstat -ano | findstr :8000`，再 `curl -s http://127.0.0.1:8000/health`（先本机，再对外）。
2. 若是为加载 `d06638d` 而重启：属预期，确认服务起回即可。
3. **若 IP 或端口变了，请告知新地址** —— B 侧脚本与界面都要传 baseUrl，不告知我无法复验。
4. 若是 A 机换了网络/热点：同理，只告知新 IP 即可。

**必须知道的一点**：重启会清空引用缓存（§见 P3 说明）。**重启前答过的消息会退回 1 条 `chunkIndex=0`，这是缓存丢失，不是 A-1 回退**；新问答会重新缓存。不要为了这个改动 `qa.py`。

**自查**：`curl -s http://<A机IP>:8000/health` → `{"status":"ok",...}`
**验收**：B 跑一次 `verify-live`，应回到 11 通过 / 0 失败 / 0 缺项；若 L7f fail，先确认网关是否刚重启、且本轮问答是重启后新提的。

---

## P0-2 `error` 事件不要落成 answer

**现状（实测报文）**

在 `test1`（`d94e04ce…`）提「这份文档讲了什么？」时，SSE 事件序列为：

```
agent_query → tool_call(query_understand) → tool_result → tool_call(knowledge_search)
→ tool_result(检索到 11 条) → references(3 条) → error → complete
```

- `error.content`：
  `create chat completion stream: API request failed with status 404: {"error":{"message":"The model \`Qwen3.8 Max\` does not exist or you do not have access to it.",...,"code":"model_not_found"}}`
- `complete.data.finalContent`：同一段错误串；
- `GET /messages` 回读：该条 `content` **283 字，就是这段错误串**，且 `knowledgeReferences` 照常回填 3 条。

**为什么必须改**：界面把这段当正常答案渲染；B 侧判据也会因为它「内容非空」而判通过 —— 真失败被掩盖成成功。

**改法（择一，建议 A，改动小且不影响现有契约）**

- **A 案**：本轮只要出现过 `error` 事件，落库时 `content` 留空，另存 `status: "failed"` 与 `error` 原文；
- **B 案**：直接返回 HTTP 5xx，让前端走失败态（前端已有 `.sch-alert.err` 通道，可直接显示）。

两种都可，**别把错误串写进 `content`**——前端无法把它和真答案区分开。

建议顺带在 `GET /messages` 的每条消息上加 `status`（`ok|failed`）或 `error` 字段，前端即可给失败气泡加标记。

**自查**

```bash
GW=http://<A机IP>:8000
# 用一个绑了错误模型的库提问，再回读最后一条
curl -s "$GW/api/v1/sessions/<SID>/messages?limit=3" | grep -c "create chat completion stream"   # 期望 0
```

**验收**：B 侧已补判据（`verify-live` 的 L7b 会识别错误答案文本，命中即 fail），A 改完后同类问题不会再被当成通过。

---

## P0-3 换一个可用的生成模型

**现状**：`test1`（`d94e04ce…`）与 `AX-200`（`cdb50e48…`）绑定的生成模型是 `Qwen3.8 Max`，
上游返回 `404 model_not_found`（`The model \`Qwen3.8 Max\` does not exist or you do not have access to it.`）。
联调库 `联调-20261116051949`（`7e9a78c3…`）正常，B 的 11/0/0 就是它跑出来的。

**改法**：在 WeKnora 后台把这两个库的模型改成与联调库一致（或任一实际可用的模型）。

**自查**：对每个库各提一问，SSE 里不应出现 `responseType=error`，`content` 应为正常答案。
**验收**：B 侧抽查两个库各一次问答，`GET /messages` 的 `content` 不含 `create chat completion stream`。

---

## P1-1 `AX-200` 打开检索通道（仅该库要参与演示时）

**现状**：`GET /knowledge-bases/cdb50e48…` 返回

```json
"capabilities": { "faq": false, "graph": false, "keyword": false, "vector": false, "wiki": true }
```

两篇文档都是 `completed`，但检索必 0 命中；问答固定回
`Sorry, I am unable to answer this question.`（实测 `references` 0 条）。

**改法**：打开 `vector` 与 `keyword`（至少 `vector`）。若该库只是旧测试库、不参与演示，可跳过。
**验收**：该库 `capabilities.vector/keyword` 为 `true`；同题问答有答案且 `references` 非空。

---

## P1-2 M6 Wiki 两个端点

**现状**：15:40 实测 `wiki/tree`、`wiki/index`、`wiki/folders`、`wiki/pages` 全部 `404 NOT_FOUND`（路由未注册）。
契约与口径已在 `docs/handoff/C-PLUGIN-PORT.md` §五 定死，**B 侧无需再改前端**，注册即可接。

**要求（照抄契约即可）**

```http
GET /api/v1/knowledge-bases/{kbId}/wiki/tree
→ { ok, data: { items: [ { slug, title, type, status, summary, version, updatedAt, sources[] } ] } }

GET /api/v1/knowledge-bases/{kbId}/wiki/pages/{slug}
→ { ok, data: { ...同上..., content } }        # markdown 子集：段落 / - 列表 / **粗体** / `代码`
```

1. `type` / `status` **透传上游原生值**，不做语义映射（B 侧字典会跟上）；
2. tree 主用 `GET /index`，信息不足时回退 `/folders + /pages` 拼装，**对外仍是 `/wiki/tree`**；
3. `sources[]` 第一版只到文档级：`SourceRefs` 按 `|` 切分 → 库内解析出 `{knowledgeId, title, chunkCount}`，
   解析不出的项丢弃并记日志，**不要塞进数组充数**；`ChunkRefs` 第一版不暴露。

**自查**：两个 curl 能返回统一信封、`items` 非空、单页 `content` 有正文。
**验收**：B 侧 Wiki 页签能出目录、点开单页能渲染；届时 `ACCEPTANCE-PLUGINS.csv` 的 M6 从「A 实现中」改为实测状态。

---

## P2-1 `GET /api/v1/plugins`

**现状**：`404 NOT_FOUND`。插件中心页因此显示「未实现」。
**改法**：返回插件目录信封即可，`{ ok, data: { items: [] } }` 也能让页面不再显示未实现。
**验收**：插件中心页列表不再报「网关还没有该接口」。

---

## 暂缓（无需动作，合同冻结）

| 编号 | 端点 | 现状 |
|---|---|---|
| A-2 ClipService | `POST /clips`、`POST /clips/{id}/commit`、`GET /clips/{id}`、`GET /jobs/{id}` | 15:40 仍 404；合同 `D-CLIP-SERVICE.md` 冻结 |
| A-3 浏览器桥 | `GET /api/v1/browser/status` | 同上；恢复触发：bsk daemon + Graph 授权 |

恢复前不需要回消息；真要启动时按各自合同里的验收条目走即可。

---

## 只需回一句的两件事（不用写代码）

| 问题 | B 侧立场 | 需要你回的 |
|---|---|---|
| 修复前的老消息要不要回填 | 可暂缓；演示若用老会话，重问一次即可 | 「做 / 不做 / 什么时候做」三选一 |
| 引用缓存要不要落库治本 | B 同意暂缓（治本要改 WeKnora Merge，代价大） | 排期，或确认「暂缓 + 写进运维须知」 |

**运维须知（无论是否治本都成立）**：网关重启后，重启前答过的消息会退回 1 条 `[0]`；演示前若重启过，**先重问一次**再展示。

---

## 别动这三处

1. **SSE `references` 不要改回单条** —— 现在多块是对的，改回会把 3 条正确退成 1 条错误；
2. **不要为 `[n]` 角标换模型** —— 角标是信息项，上游不给也不阻塞验收；
3. **不要为了让判据通过而截断引用条数** —— B 侧 L7f 已加严（落库条数必须等于 SSE 条数、`score` 降序），截断会直接判 fail。

---

## 附：A 侧自测命令合集（复制即可跑）

```bash
GW=http://<A机IP>:8000
KB=7e9a78c3-3374-483a-bc12-e217722d5c30     # 联调库，请保留

# 1) 网关与契约
curl -s $GW/health
curl -s $GW/capabilities | head -c 300

# 2) 端点注册现状（404 = 未注册，属预期 P1/P2）
for p in /api/v1/plugins /api/v1/clips /api/v1/browser/status \
         /api/v1/knowledge-bases/$KB/wiki/tree /api/v1/knowledge-bases/$KB/wiki/index; do
  printf "%-58s " "$p"; curl -s -m 8 -o /dev/null -w "%{http_code}\n" "$GW$p"
done

# 3) 引用回填仍然正确（P0 回归自测）
SID=$(curl -s -X POST -H 'content-type: application/json' \
      -d "{\"title\":\"自测-引用\",\"knowledgeBaseIds\":[\"$KB\"]}" \
      $GW/api/v1/sessions | python -c "import sys,json;print(json.load(sys.stdin)['data']['id'])")

curl -sN -X POST -H 'content-type: application/json' -H 'accept: text/event-stream' \
     -d "{\"query\":\"第14节的装配扭矩是多少？\",\"knowledgeBaseIds\":[\"$KB\"]}" \
     "$GW/api/v1/sessions/$SID/messages" | grep '"responseType": *"references"'

curl -s "$GW/api/v1/sessions/$SID/messages?limit=3"
# 判据：两份的条数、chunkIndex、score 应一致，且 chunkIndex 不全为 0
```

---

## 附：B 侧本轮的判据改动（供你对照，不用你改）

| 项 | 改动 | 状态 |
|---|---|---|
| L7b | 新增「错误答案」识别：答案或落库内容命中 `create chat completion stream` / `API request failed with status NNN` / `model_not_found` 即判 fail | 已改并用真实 404 报文 + 两条正常答案做过三组样例校验；因网关不可达，本轮无法整链实跑 |
| L7f | 落库条数必须等于 SSE 条数，且 `score` 降序 | 已实跑通过（11/0/0） |
