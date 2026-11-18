# WeKnora 生态插件移植 · 实施与验收记录

日期：2026-11-16 · 版本：Schanora 客户端 0.5.3（§10 为 0.5.2 联调记录，§12 为 0.5.3 复验）· 执行：WorkBuddy（B 前端 CHRISYU2233 范围）
环境：Windows + Node 22.22 + Chrome headless（CDP）。**已接入 A 的真网关 `172.20.10.3:8000`（contract 3.0.0）并完成 6 步全流程联调**；
仍无真实 DSH 运行时、无 OneDrive/Graph 授权，对应验收项（T04/T08/T09/T12）继续标 mock_only / blocked_env，不以 Mock 冒充移植成功。

## 0. 结论先行

| 插件 | 实施方式 | 客户端完成度 | 真实环境验收 |
|---|---|---|---|
| P3 dsh-weknora 桥接 | 差距适配（不重复实现四工具） | ✅ 显式范围、范围快照、证据/深度研究分流、错误 requestId、引用版本 | ✅ 真网关联调通过（T03b 转 verified_live；角标待 A 给引用标记） |
| P1 知识管理助手 | **行为重实现**（上游源码未核实，不称源码移植） | ✅ 四采集方式、预览、工程元数据、去重/版本、管线到 documentId | 🟡 OneDrive + WeKnora 接入后复验 |
| P2 BrowserSkill | 配置接入 + 候选交接（不重写浏览器内核） | ✅ 连接态、任务隔离、暂停/取消/登录协助、下载校验、迟到丢弃 | ⛔ 需官方插件 + A 侧桥 |
| P4 WeKnora Skill | 工作流改写（不冒称独立插件） | ✅ 批量清单、逐项幂等、失败续跑、报告 | 🟡 同 P1 后端 |

自动化核对：`node scripts/verify-plugins.mjs http://127.0.0.1:8124/preview/` → **通过 19 · 失败 0 · 环境缺项 2**。
截图：`docs/evidence/shots-M4M5/`（53 张全套，0 控制台错误）。

## 1. P3 · dsh-weknora 桥接差距适配

- 负责人 A/B：xiqing5678-rgb / CHRISYU2233
- 上游版本：`@wxg-prc-cpg/dsh-weknora`（README 与工具范围行为可查；**本机未安装**，未核实下载量）
- 实施方式：**差距适配**。四工具（列库/检索/读文档/问答）在客户端已有对应视图，未重复注册第二套工具
- 改动文件：`src/ui.js`（QaView/SearchView/AnswerBody/ReferenceList/normalizeHit/ApiError 请求链）

| 缺口 | 处理 | 证据 |
|---|---|---|
| 空范围被展开为全库 | 删除「全部知识库」；空范围返回 `null`，检索/问答直接拒绝并提示 | T01：hits=0 且提示出现；T01b：选库后 hits=4 |
| 范围随用户切库漂移 | 发送瞬间快照 `{ids, names, revision, at}`，答案回显锁定范围 | T02：气泡显示「检索范围（发送时锁定）：工程标准库」 |
| 两套回答链路 | 默认证据检索（DSH 主对话作答），仅「深度研究」走 WeKnora 合成 | `20b-chat-evidence.png` / `21-chat-answer.png` |
| 错误无法定位请求 | `ApiError.extra.requestId` 透传并在界面展示 | 代码 `requestJson/postJson` + 错警样式 |
| 引用未绑定版本 | `normalizeHit` 增 `versionId`，引用行显示版本角标 | `normalizeHit` / `ReferenceList` |

会话隔离：范围改为按 `sessionId` 读取/写入（`schanora.scope.v1.<sid>`），切会话重读 —— E2E T02b 验证会话 B 范围为空。

## 2. P1 · 网页剪藏与工程速记（行为重实现）

- 上游：WeKnora Chrome「知识管理助手」（商店约 4,000 用户 / 3 条评分，2026-11-13 页面；**源码与许可未核实**）
- 实施方式：**行为重实现**，不复制商店扩展文件；界面在 DSH 面板内，不引入第四个知识库
- 新增文件：`src/lib/clip.js`（`normalizeUrl` / `contentHash` / `dedupeKey` / `sourceKey` / 状态机 / `resolveVersion` / `planBatch` / `resolveAssetUrl` / `validateClipMeta`）
- 新增测试：`test/clip.test.mjs`（18 条，覆盖上述全部纯函数）

| 验收 | 实际输入 | 实际输出 | 证据 |
|---|---|---|---|
| T04 静态 URL 入库 | `https://supplier.example.com/ds?part=SC-1024&utm_source=mail`，库 `kb-std-001` | `doc-clip-rmqsl3` v1，状态到 `ready` | `34-clip-done.png` |
| T05 重复同内容 | 同 URL 同标题再提交 | `outcome=reuse`，同 documentId，记录/版本数 1→1 | `35-clip-reuse.png`；E2E T05 |
| T06 内容变化 | 标题改 `Rev.C` | 同 documentId，v1→v2，`previousVersionId=v1` | `36-clip-newversion.png`；E2E T06 |
| T07 参数与出处 | URL 带 `utm_source` + `part=SC-1024` | 去重键保留 `part`、剔除 `utm_source`；原始 URL 完整保存 | E2E T07 |
| 三输入方式 | URL / 选段粘贴 / Markdown 笔记 | 同一候选模型；笔记字段独立于原文，摘要不覆盖原文 | `32-clip-form.png` |
| 工程元数据 | 料号/图号/版次/类型/供应商 | 版次格式告警不拦截；`lifecycleStatus` 固定 `unknown` | `33-clip-prefilled.png` |
| 动态页面边界 | — | 不做「自动读取当前网页」；引导到「浏览器」页签 | 文案 `clip.mode.url.desc` |

失败与未通过项：
- OneDrive `source/web-clips` 落盘、WeKnora 摄取、真实 `documentId` 为 A 侧职责，未接环境 → **未验证**
- http 模式下 ClipService 未部署，提交返回 `NOT_IMPLEMENTED` 并在界面明示（`clip.httpNote`）

## 3. P2 · BrowserSkill 协同

- 上游：`@wxg-prc-cpg/browser-skill-dsh-plugin`（peer 范围 `^0.1.5-rc.3 || ^0.2.0-rc.1`，执行时需重新核对）、bsk CLI/daemon、浏览器扩展 ≥0.4.1
- 实施方式：**配置接入 + 桥接层**，不复制浏览器内核、不默认远程 daemon 是用户本机
- 改动：`src/ui.js` 新增 BrowserView、`mockBrowser*` 演示运行时、`api.browserStatus`；`HeaderChip` 上报 `activeSessionId`

| 验收 | 实际输入 | 实际输出 | 证据 |
|---|---|---|---|
| T08 动态表格 | `https://sup.example.com/spec-table` | 任务 done，返回 Markdown 表格（SC-1024/SC-2048 参数） | `38-browser-done.png` |
| T08b 交接 P1 | 点「送入采集面板」 | 切到采集页签并预填 121 字符正文 | `39-clip-handoff.png`；E2E T08b |
| T09 登录协助 | `https://login.supplier.example.com/portal` | `needsLogin` → 用户确认 → 继续并完成 | `40-browser-login.png` / `41-browser-logindone.png` |
| T09 下载校验 | `https://sup.example.com/report.pdf` | 结果含文件名/大小/sha256 且 `verified` | E2E T09a |
| T10 取消与迟到 | 启动后 300ms 取消 | 状态 `cancelled` → 1.2s 后 `discarded`，注明不入库 | `42-browser-discarded.png`；E2E T10a |
| T10 双会话 | 会话 A 有 3 个任务，切 B | B 的任务列表为空（按 sessionId 隔离） | E2E T10b |

失败与未通过项：
- 官方 DSH 插件与 bsk daemon 未安装 → 真实 Edge 采集、真实下载**未验证**；http 模式任务创建被显式禁用
- 共享 WeKnora 服务误连服务器本机浏览器 → 需 A 侧桥的 `daemonHost` 校验，本次未实测

## 4. P4 · 可选 Skill 工作流（批量导入）

- 上游：ClawHub `lyingbug/weknora` v1.0.1（Skill，不计入三插件；下载量未取得）
- 实施方式：**工作流改写**为 Schanora 客户端批量页，不复制旧 REST 示例，不冒称独立插件
- 改动：`src/ui.js` BatchView + `planBatch` 幂等计划 + `schanora.mockbatch-done.v1` 键集

| 验收 | 实际输入 | 实际输出 | 证据 |
|---|---|---|---|
| T11 部分失败 | 3 份笔记（第 3 份含 `[[FAIL_ONCE]]`） | 成功 2 / 失败 1 / 跳过 0，失败项有可读原因 | `45-batch-report.png` |
| T11 续跑不重复 | 点「重试失败项」 | 仅失败项重跑成功，成功项 documentId 不变 | `46-batch-retry.png`（成功1 失败0） |
| T11 再次续跑 | 重新载入同一批次并开始 | 3 项全部「跳过（已存在）」，成功0 失败0 跳过3 | `47-batch-rerun-skip.png` |

## 5. 公共设施

- 合同：`docs/handoff/D-CLIP-SERVICE.md`（ClipService + 浏览器桥 + P3 范围规则，状态：提案未部署）
- 单测：`npm test` → 30 条通过（12 条既有 + 18 条 clip）
- 自查：`npm run check` → 3 槽位 / 533 条字典中英成对 / 32 token / 0 裸色值
- E2E：`node scripts/verify-plugins.mjs <baseUrl>` → 通过 19 · 失败 0 · 环境缺项 2
- 截图：`node scripts/shoot.mjs <baseUrl> docs/evidence/shots-M4M5` → 53 张，0 控制台错误

## 6. 失败与未通过项（汇总）

| 项 | 原因 | 后续条件 |
|---|---|---|
| T03 真实分页与深度问答 | 无真实网关；客户端分页已用演示分块验证（第 1→2 页内容不同），深度问答 UI 已就绪 | 接 A 侧 `/api/v1/documents/{id}/chunks` 与 WeKnora 问答实测 |
| T12 安装/升级/卸载 | 无 DSH 运行时，未安装任何插件 | 在目标 DSH 环境按 README 安装后复验；卸载不得删除知识库与 OneDrive 资料 |
| OneDrive 落盘与引擎摄取 | 无 Graph 授权与 WeKnora 实例 | A 侧接入后跑 P1 全链路 |
| 真实浏览器采集 | 未安装 bsk/扩展 | 安装官方插件后按 T08/T09 复验 |

## 7. 升级 / 卸载 / 回退

- 客户端为单文件 bundle（`client.js`），升级即替换文件；无数据库迁移
- 演示数据仅存 `localStorage`（`schanora.mockclips.v1`、`schanora.mockbatch-done.v1`、`schanora.scope.v1.*`），清除不影响真实知识库
- 卸载插件不删除知识库与已落 OneDrive 的资料；停止采集不撤销已保存资料（P2 边界）
- 回退：恢复上一版 `client.js` 即可；设置项 `normalizeSettings` 兼容旧字段

## 8. 下一项先决条件

1. A 侧实现 `docs/handoff/D-CLIP-SERVICE.md` 的四个 ClipService 端点 + `browser/status`
2. 提供可访问的 WeKnora 实例与 OneDrive/Graph 授权，用于 T03/T04 真实链路
3. 目标 DSH 版本 + 官方 browser-skill 插件版本锁定后，复验 T08/T09/T12

## 9. 界面精简（0.5.1，同日第二轮）

诉求：找出冗杂/重复/低频部分做减法，保留核心路径，统一间距与信息层级。做法与验收：

| 改动 | 内容 | 验证 |
|---|---|---|
| 页签 9 → 7 | Wiki、插件中心移入顶栏 `⋯` 菜单（注册表新字段 `more: true`）；当前模块在菜单里时 `⋯` 按钮呈品牌绿激活态 | 截图 01-home-light（7 枚页签）/ 01e（`⋯` 激活态）/ 30-plugins |
| `⋯` 菜单去重 | 删掉与常驻按钮重复的「设置」项，保留 Wiki / 插件 / 模块清单 / 诊断 | 菜单项实测 = `["Wiki","插件","模块","诊断"]` |
| 页说明去重 | pagehint 删掉与选中页签重复的 14px 粗体标题，只留 12px 描述；≤900px 整行隐藏 | 截图 01-home-light / 08-docs-narrow |
| 间距收敛 | 内联 14/18/22px 手调值统一为 16/16/20；CSS 布局级越档值（卡片栅格 gap、抽屉头、Wiki 内距等）同步归位 | 扫描：内联 margin/padding 已无越档值 |
| 插件卡片降噪 | 「纯前向执行…」脚注行与虚线上边框删除，开关收到卡片右上角 | 截图 30-plugins |
| 死样式清理 | 删除 9 个零引用 CSS 类（`.sch-ktr` / `.sch-cards` / `.sch-card` 族 / `.sch-foot` / `.sch-brand-sub` / `.sch-section-head`）；复扫归零 | 扫描：CSS 定义 240 类，未引用 0 |
| 字典键不动 | `t()` 存在大量动态取键（`t(mod.title)`、`t(\`wiki.status.\${s}\`)` 等），静态扫描的 117 个「未引用」全是误报 | 抽查确认全部命中动态路径 |

回归结果（全部重跑）：`npm test` 30 条通过 · `npm run check` 3 槽位/533 字典/32 token/0 裸色值 ·
`verify-plugins.mjs` **19 通过 · 0 失败 · 2 环境缺项**（与精简前一致，功能无回退）· 47 张截图重出、0 控制台错误。
README 同步改写为图文版功能详解（18 张界面截图，逐模块说明入口与操作路径）。

## 10. 真网关联调（0.5.2，2026-11-16）

A 侧 Gateway 就绪后按《联调手册》走通全流程，脚本 `scripts/verify-live.mjs` 驱动真实浏览器 +
网关直查做双证据。详细记录见 `docs/evidence/LIVE-INTEGRATION.md`。

| 步骤 | 结果 | 证据 |
|---|---|---|
| 网络与能力 | ✅ | `/health` ok；`/capabilities` contract 3.0.0，5 能力全 true；CORS 允许 `127.0.0.1:8124` |
| 切网关实时 | ✅ | 界面「测试连接」成功；刷新后库列表与网关 11 条一致，演示库 0 残留 |
| 建库 | ✅ | `联调-20261116024605` → 网关 id `2db34aa7…`，模型 `bge-m3` |
| 上传 | ✅ | 文档 `1d625a0f…`，1.1 万字 Markdown，XHR 上传带进度 |
| 处理状态 | ✅ | 9–13 秒 `completed`，界面徽标同步 |
| 分块分页 | ✅ | 网关 `total=20`，界面第 1 页→第 2 页内容不同，无「可能还有更多」 |
| 检索 | ✅ | 界面 5 条命中 / 网关 7 条，片段含本次文档正文 |
| 问答 | ✅ / ⊘ | 证据模式 257 字（P3 分流生效）；深度研究 SSE 432 字收束、网关落库 316 字；**角标**：上游未给引用标记 → 待 A |

脚本输出：**9 通过 · 0 失败 · 1 缺项**。

### 联调中修掉的真缺陷

上游合成答案的引用是内联标签 `<kb doc="…" chunk_id="…" kb_id="…" />`，而面板只认 `[n]`，
裸标签会被当正文显示。新增 `src/lib/cite.js#normalizeCitations()`：按 `chunk_id` 对上
`knowledgeReferences` 的序号换成 `[n]`，对不上就删标签不编假出处；13 条单测 + 真网关历史答案回放验证
（`…住宿费一晚最多可以报销500元。 [1]`，裸标签 0 处）。

### 待 A 侧（2026-11-16 下午更新：A 已回文）

1. **引用列表回填错位（必修，与模型无关）**：`knowledgeReferences` 恒回第 0 块，需改为按本轮召回
   按 score 降序回填。角标标记本身经双方对齐后**降为信息项**（B 降级已是现状，不为角标换模型）——
   见 `docs/handoff/B-REPLY-2026-11-16.md` §2。
   **14:0x 复验更新**：SSE `references` 侧已按 score 降序回填真实召回块，`GET /messages` 落库侧仍只有
   1 条且 `chunkIndex=0`，刷新后引用列表退化 —— 详见 §12.1 与 `A-SYNC-2026-11-16-R2.md`。
2. ClipService 四端点与 `/api/v1/browser/status`：**A 已决定暂缓**（需求边界未定 + 缺 bsk/Graph 环境），
   恢复触发条件：需求范围对齐 / bsk daemon 环境就绪。T04/T08/T09 维持 `mock_only`。
3. M6 Wiki：A 开始推进，WeKnora 原生 API 调研结果与契约映射见 `docs/handoff/B-REPLY-2026-11-16.md` §3。

### 复验与回归

- 真网关：`node scripts/verify-live.mjs http://127.0.0.1:8124/preview/ http://172.20.10.3:8000`
  （复验加 `LIVE_KB_ID` / `LIVE_DOC_ID` 复用既有库，避免在 A 后台堆数据）
- 演示态回归：`verify-plugins.mjs` **19 通过 · 0 失败 · 2 环境缺项**（引用适配无回退）
- 单测：`npm test` **37 条通过**（clip 18 + cite 13 + gate 6）；`npm run check` 全绿

## 11. 收尾交接（2026-11-16 下午）

| 改动 | 内容 | 验证 |
|---|---|---|
| M6 三项口径拍板 | ①枚举透传上游原生值（契约占位作废）②tree 主用 `/index`，不足回退 `/folders+/pages` ③给出 `SourceRefs` 按 `\|` 解析为文档级 `sources[]` 的格式说明 | 写入 `C-PLUGIN-PORT.md` 五章与 `B-REPLY-2026-11-16.md` §3.6 |
| 预览台顶栏瘦身 | 「会话 A / 会话 B」两个 tab 从顶栏移入收起的评审条；会话状态与 E2E 钩子不变（走 `window.__HARNESS_UI__.set`） | 评审条切换后 `store.session=B`；E2E 回归 19/0/2 |
| 预览台「隐藏面板」按钮 | 该按钮只供人工演示，53 张截图与 E2E 均不依赖；已删除，保留 `__HARNESS_UI__.set({ active: null })` 程序化入口 | 顶栏不再有该按钮；预览台加载与 E2E 均正常 |
| 交接单 | 新增 `docs/handoff/HANDOFF-NEXT.md`：现状/命令/代码地图/坑/挂起项/文档索引/接手清单，README 挂入口 | 随包交付 |

## 12. 真网关复验 R2（0.5.3，2026-11-16 14:0x，网络恢复后）

> 背景：13:1x 起因 A 机离开热点，到 `172.20.10.3:8000` 的 TCP 全超时；14:0x 恢复。本轮按
> `HANDOFF-NEXT.md` §6 第 3 步复验，并顺带核 A-2/A-3/M6。

**结论：`verify-live` 10 通过 · 1 失败 · 0 缺项。唯一失败项是 A-1 的落库侧，已单独出同步单**
`docs/handoff/A-SYNC-2026-11-16-R2.md`。

| 项 | 结果 | 实测 |
|---|---|---|
| L0–L6 | pass | 网关 `0.1.0` / `contract 3.0.0`；库 3 条；分块 `total=20` 真翻页；检索界面 4 = 网关 4 |
| L7a 证据模式 | pass | 255 字符证据气泡，4 条命中 |
| L7b 深度研究 SSE | pass | 界面 357 字 / 网关落库 118 字，`complete` 正常，无「答案提前结束」 |
| L7c 引用列表（硬性） | pass | 只看最后一条答案：引用 5 条，无裸 `<kb/>` |
| L7e `[n]` 角标（信息） | skip | 上游仍未给标记，按约定不阻塞 |
| **L7f 引用落库（A-1）** | **fail** | 界面(SSE)=5 条 / 落库=1 条 `chunkIndex=[0]`，文档 20 块 |

### 12.1 A-1 拆成两半，只修好了一半

原判断是「引用列表恒指第 0 块」一条缺陷，本轮取原始事件后要拆成两个路径分别看：

- **SSE `references` 事件（实时渲染这条）已修好**：同一次问答里给出
  `[chunkIndex=12 score=0.5813, chunkIndex=3 score=0.5518]`，按 score 降序、指向真实召回块，
  不再是固定第 0 块。界面因此能显示 5 条正确出处。
- **`GET /api/v1/sessions/{id}/messages` 回读（刷新后这条）未修**：同一条答案落库后
  `knowledgeReferences` 只有 **1 条**、`chunkIndex=0`、`startAt=0 endAt=5657`、`score=0.5723`，
  与 SSE 那份不是同一组数据。

**用户可见后果**：刚答完引用列表正确（5 条，指向第 12/3 块）；按 F5 刷新后引用列表退化成 1 条，
且指向文档开头。前端 `normalizeMessage()` 只读 `knowledgeReferences`，所以这不是渲染问题。

### 12.2 判据 tighten（B 侧本轮改动）

原 `L7c` 统计整页 `.sch-refs .sch-ref`，会把上一条证据气泡的命中一起数进来 —— 14:10 那轮就是这样
在答案根本没渲染的情况下判了 pass（假阳性）。本轮改为：

1. `L7c` 只看最后一条助手消息自己的引用列表，且本轮答案必须存在；
2. 新增 `L7f`，直接读网关落库的 `chunkIndex` 判定 A-1，并同时打印「界面(SSE)条数 / 落库条数」；
3. `L7b` 超时时打印每条助手消息的实况（字数 / note / refs 数），不再只说「没等到」。

### 12.3 A-2 / A-3 / M6 仍全是 404

14:05 复测，响应体与随机路径一致（网关全局 404 兜底，路由未注册）：

```
GET  /api/v1/knowledge-bases/{id}/wiki/tree    404 NOT_FOUND
GET  /api/v1/knowledge-bases/{id}/wiki/index   404 NOT_FOUND
POST /api/v1/clips                             404 NOT_FOUND
GET  /api/v1/jobs/{id}                         404 NOT_FOUND
GET  /api/v1/browser/status                    404 NOT_FOUND
GET  /api/v1/plugins                           404 NOT_FOUND
```

`/api/v1/plugins` 是插件中心页读的目录接口，一并缺失（不影响 P1–P4 主链路，仅该页显示「未实现」）。

### 12.4 本轮复验未新建知识库

A 已清理 10:42–10:46 的 4 个联调库；本轮复用仍保留的 `联调-20261116051949`
（`7e9a78c3-3374-483a-bc12-e217722d5c30`，文档 `7c89ceaa-…`）。但问答会在该库上产生会话，
本轮新增会话：`B-探针-引用回填`、`B-探针-回填取证` 及脚本自动建的几条 —— 供 A 自行清理。

---

## 13. A-1 收官复验（0.5.3，2026-11-16 15:3x）

> 背景：A 回《联调回复-R2落库引用修复》称已修（commit `d06638d`，只改网关 `qa.py`），
> 并更正根因——不是 rerank，而是父子块 Merge。B 侧不采信声明，直接复验。

**结论：`verify-live` 11 通过 · 0 失败 · 0 缺项。L7f 由 fail 转 pass，A-1 关闭。**

| 项 | 结果 | 实测 |
|---|---|---|
| L0–L6 | pass | `contract 3.0.0`；界面 3 库 = 网关 3 库；`total=20` 真翻页；检索界面 4 = 网关 4 |
| L7a 证据模式 | pass | 256 字证据气泡 |
| L7b 深度研究 SSE | pass | 界面 308 字 / 落库 126 字（界面多出检索范围与引用列表文案），`complete` |
| L7c 引用列表（硬性） | pass | 只看最后一条答案：引用 3 条，无裸 `<kb/>` |
| L7e `[n]` 角标（信息） | skip | 上游仍未给标记 |
| **L7f 引用落库（A-1）** | **pass** | 界面(SSE)=3 条 / 落库=3 条，`chunkIndex=[12,8,15]`，score 降序 |

同日另一轮为 `4 / 4`、`chunkIndex=[4,19,8,15]`；独立探针（不经前端）两轮分别 `2=2`（`[12,3]`、`[14,12]`），
且第 2 问没有覆盖第 1 问那条 —— 说明网关缓存按 `assistantMessageId` 分键，多轮不串。

### 13.1 判据再加严

原 `L7f` 只判「落库有 `chunkIndex` 且不全为 0」，理论上「只落 1 条真实块」也会算过、刷新后仍会少几条。现加：

1. 落库条数必须等于 SSE 条数；
2. `score` 必须降序（引用列表按相关度排）。

失败时直接打印「条数与 SSE 不一致」/「score 非降序」。加严后复跑仍 11/0/0。

### 13.2 根因（A 侧更正，B 侧接受）

- `Rerank skip reason="empty_model_id"` —— rerank 模型未配置（欠费），重排阶段直接跳过，与引用错位无关；
- `Merge chunk_cnt=19 → merged_chunks=1` —— 父子块文档在 Merge 阶段被合成 1 个父块（`chunk_index=0`），
  这才是「恒第 0 块、`startAt=0 endAt=5657`」的来源；普通分块文档不受影响（`test1` 实测 `2=2` 一致）；
- 修法是网关兜底：chat 流式时缓存 `assistantMessageId → 正确多块`，`GET /messages` 时替换。治本需改 Merge，双方同意暂缓。

### 13.3 两条边界（不阻塞验收）

1. **旧消息不回填**：修复前已答的消息仍 1 条 `chunkIndex=0`（实测 15:04、15:18 两条），老会话按 F5 仍退化；
2. **网关重启丢缓存**：缓存是进程内存，重启后重启前的消息退回 `[0]`。

### 13.4 顺手发现的两处环境问题（已写进给 A 的回执）

| 问题 | 证据 | 影响 |
|---|---|---|
| `test1` / `AX-200` 绑定模型 `Qwen3.8 Max` 404 `model_not_found` | SSE `responseType=error` 原文；该错误串被当 `answer` 落库 283 字 | 界面把报错当答案显示；L7b 因「非空」判 pass。需 A 侧改「error 不落成 answer」或给失败态 |
| `AX-200` 库 `capabilities.vector/keyword` 全 `false` | `GET /knowledge-bases/cdb50e48…` | 检索 0 命中，问答固定回 `Sorry, I am unable to answer this question.` |

### 13.5 文档

新增 `docs/handoff/B-REPLY-R2-2026-11-16.md`（给 A 的验收回执），归档 A 的回复为
`docs/handoff/A-REPLY-R2-2026-11-16.md`；`ACCEPTANCE-PLUGINS.csv` 的 T03b 证据更新为 11/0/0 并补注记 5–7。
