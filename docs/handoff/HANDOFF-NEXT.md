# Schanora v0.6.0 后续维护

2026-11-18。发布候选已同步到 `D:/Desktop/Schanora-release`，承接 GitHub 主分支历史。用户运行入口为 DSH 本地插件。数据默认放用户目录，可选 OneDrive 共享文件夹。

以[本轮交接](CODEX-HANDOFF.md)和[安装说明](../../README.md)为准。以下为前期界面与远程网关联调记录，供维护历史功能时参考。

---

## 0. 结论先行

| 维度 | 状态 |
|---|---|
| 产品代码 | ✅ 完整。B 侧前端插件（M1–M5、P1–P4、7 常驻页签 + ⋯ 菜单）已交付，界面已做精简收口；**v0.6.0 起自带本地内核，前后端一体** |
| 真网关联调 | ✅ 6 步全流程真数据走通（建库→上传→状态→分块→检索→问答）；15:3x 收官复验 **11 通过 / 0 失败 / 0 缺项** |
| 本地内核 | ✅ `npm run verify:local` **8 通过 / 0 失败 / 0 缺项**（真文件、真 BM25、真 SSE、真落盘） |
| 测试 | ✅ `npm test` 67 条 · `npm run check` 全绿 · 演示态 E2E 21 通过/0 失败/2 环境缺项 · 真网关 11 通过/0 失败/0 缺项 |
| 失败项 | ✅ 无。**A-1 已关闭**（A 修复 `d06638d`，SSE 与落库引用现同源；L7f pass） |
| 其余未完成项 | 🟡 全部在 A 侧或环境：ClipService 四端点 + browser/status（A 暂缓）、M6 Wiki 真接口、plugins 目录、DSH 安装卸载 |
| 网络现状 | 🟡 15:31 `/health` 0.11s 正常、跑完 11/0/0；**15:56 复测 `/health` 无响应、库详情 502**（疑似 A 重启加载修复），以 `curl /health` 为准。ICMP 一直被过滤，别用 ping 判断 |

**最重要的纪律**：Mock 通过 ≠ 真链路通过。验收表 `verified_mock` / `mock_only` / `verified_live` / `blocked_env`
四种状态不可混写；端点 404 时界面如实显示「未实现」，不得伪造成功。

---

## 1. 快速上手（按顺序跑）

```bash
cd D:/Desktop/Schanora_wb
node -v            # 22.22.2（≥20.11 即可）
npm test           # 37 条单测（clip 18 + cite 13 + gate 6）+ bundle 自检
npm run check      # 3 槽位 / 533 字典中英成对 / 32 token / 0 裸色值
npm run build      # 由 src 生成 plugins/schanora/client/client.js（build-client.mjs 会剥离 export 内联 lib）

# 本地预览台：真实 bundle + 假 DSH 宿主
python -m http.server 8124 --bind 127.0.0.1
# 浏览器打开 http://127.0.0.1:8124/preview/

npm run verify     # 演示态 E2E（headless Chrome + CDP，21 项断言）
npm run shots      # 53 张状态截图 → docs/evidence/shots-M4M5/
npm run design     # 重生成设计目录页
npm run pack       # 产物 → dist/Schanora-frontend/（再用 Compress-Archive 压 zip）
```

真网关联调（网关可达时）：

```bash
# 复用既有库，不在 A 后台堆数据
LIVE_KB_ID=7e9a78c3-3374-483a-bc12-e217722d5c30 \
LIVE_DOC_ID=7c89ceaa-275b-49bb-a4fd-1e0167f918d0 \
node scripts/verify-live.mjs http://127.0.0.1:8124/preview/ http://172.20.10.3:8000
# 断言原始 JSON 落在 docs/evidence/live-<时间戳>.json
```

---

## 2. 代码地图

| 路径 | 职责 / 注意点 |
|---|---|
| `plugins/schanora/client/src/ui.js` | 主源码（约 9.5k 行）：CSS token、字典 zh/en、全部视图、api 封装、mock 运行时、注册表。**改完必须 `npm run build`**，否则预览台跑的是旧 bundle |
| `plugins/schanora/client/src/lib/clip.js` | P1/P4 纯函数：URL 规范化、内容哈希、双键去重、状态机、批量计划 |
| `plugins/schanora/client/src/lib/cite.js` | 角标校验三态 + `normalizeCitations()`（`<kb chunk_id>` → `[n]`）、`verifyCitations()` |
| `plugins/schanora/client/src/lib/gate.js` | 证据门槛覆盖率判定 |
| `plugins/schanora/client/client.js` | 构建产物，勿手改 |
| `preview/harness.js` | 假 DSH 宿主（非产品代码）：侧栏、顶栏、评审条、`window.__HARNESS_UI__` 测试钩子。会话 A/B 切换在评审条内（默认收起）；顶栏**不再有**面板开关按钮，需要无面板态时用 `__HARNESS_UI__.set({active:null})` |
| `preview/index.html` | 预览台入口 |
| `scripts/verify-plugins.mjs` | 演示态 E2E 断言（T01–T12 的 mock 部分） |
| `scripts/verify-live.mjs` | 真网关联调：浏览器断言 + 网关直查双证据。**L7c 只数最后一条助手消息的引用**；**L7f 读落库 `chunkIndex` 判 A-1**；L7b 超时会打印每条助手消息实况 |
| `scripts/shoot.mjs` | 截图剧本（53 张） |
| `scripts/build-client.mjs` | 构建：剥离 `export` 前缀、内联 lib 到 ui.js |
| `scripts/check-bundle.mjs` / `check-design.mjs` | 3 槽位/字典成对/占位符一致；字号 9 档/圆角 4 档/字重 3 档/0 裸色值 |
| `scripts/pack.mjs` | 打包清单；`SKIP` 排除临时目录；按 `live-*.json` 前缀收录联调断言 |
| `test/*.test.mjs` | 37 条单测（clip/cite/gate） |

---

## 3. 必知约定与坑

1. **双键去重**：内容幂等键 = `库::规范化URL::内容hash`（同内容不建副本）；资料身份键 = `库::规范化URL`（内容变化成同文档新版本）。曾踩坑：把 hash 放进身份键导致更新变新文档。
2. **P3 范围**：`effectiveScope` 空范围返回 `null`（不展开全库）；发送瞬间 `snapshotScope` 锁定 `{ids,names,revision,at}`；范围按 `sessionId` 存 localStorage，头部徽标同步。
3. **引用有两份数据，已同源，但别假设永远一致**：SSE `references` 事件是**实时渲染**用的；`GET /messages` 的 `knowledgeReferences` 是**刷新后回读**用的。A-1 已修（`d06638d`），两份现在逐字段相等（条数 / `chunkIndex` / `score` / `id`）。**但两点仍成立**：①修复前已回答的老消息不回填，F5 后仍退化到 1 条 `[0]`；②网关缓存是**进程内存**，网关重启后重启前答的消息同样退化。判断「A-1 是否回退」看 L7f。
4. **角标口径（与 A 已对齐）**：硬性 = 引用列表渲染 + 无裸 `<kb/` 泄漏；信息项 = 答案带 `[n]`。上游不给标记时不算失败、不换模型。
5. **E2E 断言要看范围**：整页 `.sch-refs .sch-ref` 会把上一条证据气泡的命中算进来，答案没渲染也能判 pass。已改为只看最后一条助手消息 —— 新增同类断言时照此办理。
6. **失败注入**：演示批次用 `[[FAIL_ONCE]]` 标记，按幂等键全局只失败一次（`MOCK_FAIL_ONCE_SEEN`），重试建新候选仍能成功。
7. **E2E baseUrl 必须带 `/preview`**：`node scripts/verify-plugins.mjs http://127.0.0.1:8124/preview`；少了会卡在第一个页签点击。
8. **注册表 `tab: def.tab !== false`**：Wiki/插件中心靠 `more:true` 收进 ⋯ 菜单；漏掉这行字段会导致页签找不到。
9. **字典键不要静态删**：`t(mod.title)`、`t(\`wiki.status.${s}\`)` 等动态取键很多，静态扫描的「未引用」是误报。
10. **不擅动 A 的数据**：联调建的 `联调-*` 库由 A 自行确认后清理；10:42–10:46 的 4 个库 A 已清理，14:0x 复验复用 `联调-20261116051949` 未删。
11. **网络判断别看 ping**：A 机的安全组/防火墙拦 ICMP，`ping` 100% 丢包时 TCP 8000 也可能通。判链路用 `curl /health`。

---

## 4. 挂起事项（谁做、做什么、怎么验收）

| 编号 | 归属 | 事项 | 验收方式 |
|---|---|---|---|
| A-1（落库侧） | ✅ **已关闭**（A，`d06638d`） | 15:3x 复验：SSE 与落库逐字段相等（`2=2`、`3=3`、`4=4`，`chunkIndex` 分散且 score 降序），L7f 转 pass | 已完成；若日后 L7f 又 fail，先查网关是否重启（缓存丢）或代码回退 |
| A-2 | A（暂缓） | ClipService 四端点（`POST /clips`、`/clips/{id}/commit`、`GET /clips/{id}`、`GET /jobs/{id}`） | 15:40 仍 404 且响应体与随机路径一致（路由未注册）；按 `D-CLIP-SERVICE.md` 打通 create→commit→job |
| A-3 | A（暂缓） | `GET /api/v1/browser/status` | 同上，合同 §3；恢复触发：bsk daemon + Graph 授权 |
| M6 | A 实现 / B 已定口径 | Wiki tree + 单页；15:40 实测 `wiki/tree`、`wiki/index` 仍 404 | 网关返回统一信封；B 侧 `normalizeWikiPage` 对缺省值有兜底，注册后无需改前端 |
| A-4 | A（低） | `GET /api/v1/plugins` 404，插件中心页读不到目录 | 返回插件列表信封即可；不影响 P1–P4 主链路 |
| A-5 | A（P0，见 `A-TODO-R3.md`） | ①`test1`/`AX-200` 绑定模型 `Qwen3.8 Max` 404，错误串被当答案落库；②`AX-200` 库 `capabilities.vector/keyword` 全 `false`，检索必 0 命中 | A-TODO-R3 的 P0-2 / P0-3 / P1-1；B 侧 L7b 已能识别错误答案，改完不再假通过 |
| 网络 | A | 15:31 正常 → 15:56 502 → 16:04 `/health` 8s 超时（http=000）。先 `curl /health`，再 `netstat -ano \| findstr :8000` | `/health` 返回 `status:ok`；新 IP 请同步给 B |
| T12 | 环境 | 真实 DSH 安装/升级/卸载 | 需 DSH 运行时，现 `blocked_env` |

> A-1 的完整取证与改法（含 A 侧可直跑的三条 curl）在 `docs/handoff/A-SYNC-2026-11-16-R2.md`；
> **A 修完后的验收回执是 `docs/handoff/B-REPLY-R2-2026-11-16.md`**（11/0/0 + 两条边界 + 两处环境问题）；
> **A 当前该做什么，看 `docs/handoff/A-TODO-R3.md`**（P0/P1/P2 分级，每项含现状实测、改法、自查、验收）。

---

## 5. 文档索引

| 文档 | 内容 |
|---|---|
| `README.md` | 图文版功能详解（12 小节 / 27 图），面向使用者 |
| `DESIGN.md` / `docs/handoff/B-DESIGN.md` | 设计规范与版式迭代记录（最新 v9 界面精简） |
| `docs/handoff/A-TODO-R2.md` | **给 A 的执行版任务卡（已闭环，留档）**：P0-1 引用落库（现状/改法/自查三条 curl/验收） |
| `docs/handoff/A-TODO-R3.md` | **给 A 的当前任务卡**：P0 网关恢复 / error 不落成 answer / 换可用模型；P1 AX-200 检索通道、M6 Wiki；P2 plugins；含自测命令合集 |
| `docs/handoff/A-REPLY-R2-2026-11-16.md` | A 的回复单（原文归档）：称 `d06638d` 已修 + 根因更正为父子块 Merge |
| `docs/handoff/B-REPLY-R2-2026-11-16.md` | **B 的验收回执**：A-1 关闭（11/0/0 + 逐字段对齐）、两条边界、两处环境问题、端点现状 |
| `docs/handoff/A-SYNC-2026-11-16.md` | B → A 同步单 R1（10:42–10:51 那轮，三项待办） |
| `docs/handoff/A-SYNC-2026-11-16-R2.md` | B → A 同步单 R2（14:0x 复验）：A-1 落库侧未修的硬证据与改法 |
| `docs/handoff/B-REPLY-2026-11-16.md` | B → A 回复（角标口径、暂缓确认、M6 调研与三项决策、网络诊断） |
| `docs/handoff/C-PLUGIN-PORT.md` | 插件移植合同（含 M6 已定口径） |
| `docs/handoff/D-CLIP-SERVICE.md` | ClipService 提案合同（A 暂缓，冻结不改） |
| `docs/evidence/LIVE-INTEGRATION.md` | 真网关联调完整记录（6 步 + 修缺陷 + 待 A 项 + §七 14:0x 复验 + §八 15:3x 收官复验） |
| `docs/evidence/PLUGINS-REPORT.md` | 实施与验收报告（§9 界面精简、§10 联调、§12 复验 R2、§13 A-1 收官） |
| `docs/evidence/ACCEPTANCE-PLUGINS.csv` | T01–T12 状态映射（四种状态，勿混写） |
| `docs/evidence/live-*.json` | 每轮联调逐项断言原始结果 |

---

## 6. 接手第一步（Checklist）

1. `npm test && npm run check && npm run build` 确认基线全绿（build 前后 bundle MD5 应一致，说明 src 与产物同步）；
2. 起 8124 预览服务，`npm run verify` 确认 19/0/2 无回退；
3. 网关可达时，带 `LIVE_KB_ID` / `LIVE_DOC_ID` 跑 `verify-live.mjs`，应为 **11 通过 / 0 失败 / 0 缺项**（L7f 判「落库引用与 SSE 同源」：条数相等 + 块号非全 0 + score 降序）；若 L7f 又 fail，先确认网关是否重启过（进程内缓存丢失）；
4. 再做新需求：**只改相关文件**，跑全量回归，更新验收表与本报告，最后 `npm run pack` 重打包；
5. 与 A 往来继续用 `docs/handoff/A-SYNC-*` / `B-REPLY-*` 的文档编号风格，新增文档在本索引登记。
