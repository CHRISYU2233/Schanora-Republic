# WeKnora 插件调研与移植记录（C 阶段）

> 对象：Tencent/WeKnora `main`（2026-11 上游）、`packages/dsh-weknora@0.1.0`、本地 `WeKnora_plugin_byDHS@0.4.0`
> 结论：WeKnora 的插件分三层，只有「Agent 侧插件里的判定内核」可以零改造进前端；其余需要 Go 宿主或服务端。
> 移植结果：`src/lib/gate.js`（证据门槛）、`src/lib/cite.js`（引用校验），已接入检索页与问答页。

## 一、调研范围

| 来源 | 看的是什么 |
| --- | --- |
| `packages/dsh-weknora` | 官方 DSH 插件：4 个只读工具、配置层、兼容性说明 |
| `WeKnora_plugin_byDHS@0.4.0`（本地包） | 增强版 DSH 插件：7 个工具 + 证据门槛 + 引用自检，附 66 个单测 |
| PR #3720（2026-09 合入） | 代码插件体系：HTTP 扩展协议、Go SDK、plugin host、网页搜索与数据源适配器 |
| `examples/mcp-demo` | WeKnora 作为 MCP 客户端的接入示例（6 个演示工具） |
| `examples/skills` | Agent Skills 包格式（`SKILL.md` + 沙箱脚本） |
| 官方文档《RAG Pipeline》 | 服务端 RAG 管线本身就是插件链（意图识别 → 改写 → 检索 → 重排 → 组装） |

## 二、插件清单

### A. Agent 侧（DSH 插件 / MCP / Skill）

| 插件 | 功能 | 依赖 | 适用场景 | 能否直接进前端 |
| --- | --- | --- | --- | --- |
| `@wxg-prc-cpg/dsh-weknora` 0.1.0 | 4 个只读工具：列库、混合检索、按序读全文、WeKnora 自带引用的成稿回答 | dsh `0.1.0-rc.8`、WeKnora `0.8.0`、API Key（`retrieve`，ask 另需 `chat`）、Node ≥ 20.11，零运行时依赖 | 让编码 Agent 在对话里查企业知识库 | 否：注册的是宿主工具，不是 UI；工具语义可参考 |
| `WeKnora_plugin_byDHS` 0.4.0 | 7 个工具 + `agent/pre-step` 预检索注入 + 证据门槛 + 引用自检 + 采样降温 | dsh 0.2.x、WeKnora 0.8+/0.9、凭据库；零依赖 | 要求「不查就答」被硬性拦住、引用可对账的场景 | **部分**：`gate.js` / `cite.js` / `evidence.js` 是纯函数，可移植 |
| `tencent-weknora-mcp`（`mcp-server/`） | 29 个工具，stdio / SSE / HTTP | Python、WeKnora 部署 | Claude、Cursor、WorkBuddy 等任意 MCP 客户端 | 否：需要 MCP 客户端运行时 |
| `examples/mcp-demo` | 6 个演示工具（echo/add/时间/政策/联系人/模拟告警） | Python venv、HTTP Streamable，默认 `127.0.0.1:8010` | 验证 WeKnora 作为 MCP 客户端、工具人工审批 | 否：演示服务 |
| `examples/skills/pdf-processing` | PDF 文本/表格抽取、表单分析 | `SKILL.md` + 沙箱脚本（Docker / E2B / Cube） | Agent 需要可执行脚本的技能 | 否：需要沙箱运行时 |

### B. 服务端代码插件（PR #3720）

| 插件 | 功能 | 依赖 | 适用场景 | 能否直接进前端 |
| --- | --- | --- | --- | --- |
| 网页搜索 Provider 插件 | 以插件形式提供搜索源（Tavily/Bing 等同类），走 `api_key + extra_config` | WeKnora 插件宿主、Go SDK `pluginsdk`、出网白名单 | 需要替换/新增搜索源 | 否：进程外 Go 程序 |
| 数据源 Connector 插件（含 RSS 示例） | 增量同步外部内容，NDJSON 流式返回 items/checkpoint，可断点续传 | 同上；`.wkp` 打包 | 定时把 RSS/飞书/Notion/语雀/GitLab/钉钉 文档灌进知识库 | 否：服务端同步任务 |

### C. RAG 管线插件（Go，进程内）

| 插件类 | 功能 | 依赖 | 适用场景 |
| --- | --- | --- | --- |
| 意图识别 / 问题改写 | 判断是否检索、改写查询 | WeKnora 服务端 | 提升召回 |
| 检索 / 重排 | 向量 + 关键词召回、rerank | 向量库、rerank 服务 | RAG 主链路 |
| `PluginWikiBoost` | 重排后对 Wiki 页面加权 | WeKnora Wiki | Wiki 模式 |

> 这三层都依赖 Go 运行时或宿主进程，**不能**直接搬进 DSH 前端插件。前端的正确做法是「消费它们的输出」：把判定逻辑在 UI 侧重算一遍，让用户看见证据强弱。

## 三、选型结果

| 候选 | 结论 | 理由 |
| --- | --- | --- |
| `gate.js` 证据门槛 | **移植** | 纯函数、零依赖；前端已有 `knowledgeId/chunkIndex/content`，可直接算覆盖率；补上「检索结果看起来都很像」的可信度盲区 |
| `cite.js` 引用校验 | **移植** | 纯函数；当前答案角标 `[n]` 只有样式、点不开、也不校验，正好补上 |
| `evidence.js` 证据块渲染 | 不移植 | 输出的是给模型的 `<kb-evidence>` 文本块，前端没有消费方 |
| `shouldGround` 预检索判定 | 不移植 | 是否检索由网关决定，前端拦不住；强行判断只会造成 UI 与真实请求不一致 |
| 官方 DSH 4 工具 | 不移植 | 属于 Host 侧 `ctx.tools.register()`，与本仓库「Host 入口保持空实现」的约定冲突 |
| 数据源 / 搜索 Provider 插件 | 不移植 | 需要 WeKnora 插件宿主与 Go 二进制，前端无法承载 |
| MCP / Skills | 不移植 | 需要 MCP 客户端或沙箱运行时，属于部署侧能力 |

## 四、移植清单

| 文件 | 类型 | 说明 |
| --- | --- | --- |
| `plugins/schanora/client/src/lib/gate.js` | 新增 | `queryTerms` / `coverageOf` / `hasProvenance` / `annotateHits`，门槛 `MIN_COVERAGE = 0.34` 与上游一致 |
| `plugins/schanora/client/src/lib/cite.js` | 新增 | `parseMarkers` / `verifyCitations`，三态：`verified` / `orphan` / `unverifiable` |
| `plugins/schanora/client/src/ui.js` | 修改 | 角标可点、引用自检徽标、检索页覆盖率徽标与门槛统计、问答页弱证据提示 |
| `scripts/build-client.mjs` | 修改 | 把 `src/lib/*.js` 去掉 `export` 后内联进 bundle（DSH bundle 是函数体，不能有 ESM 语法） |
| `test/gate.test.mjs` / `test/cite.test.mjs` | 新增 | 12 条单测，`npm test` 先跑单测再跑 bundle 自检 |
| `package.json` | 修改 | `test` 脚本加入 `node --test` |

### 适配差异（相对上游）

| 点 | 上游 | 本项目 | 原因 |
| --- | --- | --- | --- |
| 字段名 | `knowledge_id` / `chunk_index` | `knowledgeId` / `chunkIndex` | 前端 `normalizeHit` 已统一为 camelCase |
| 角标格式 | `[K1]` + 内联 `knowledge_id … chunk N` | `[1] [2]`（1 基，顺序即引用列表） | 现有答案与 SSE 的引用编号就是这种 |
| 门槛结果 | 过滤掉低分片段 | 全部保留、逐条标注 | 检索页要展示召回全集，用户自己判断 |
| 前端提示 | 无（给模型看） | 覆盖率徽标 / 门槛统计 / 弱证据提示 | 把「能不能引」翻译成人能读的信号 |

## 五、Wiki（M6）接口约定

前端按下面两个接口实现，`knowledgeId` 走路径参数，响应体与其它接口一样包在 `{ok, data}` 里：

```http
GET /api/v1/knowledge-bases/{kbId}/wiki/tree
→ data.items[]: { slug, title, type, status, summary, version, updatedAt, sources[] }

GET /api/v1/knowledge-bases/{kbId}/wiki/pages/{slug}
→ data: 上述字段 + content（markdown 子集：段落、- 列表、**粗体**、`代码`）
```

### 已定口径（2026-11-16，B 侧拍板）

1. **`type` 归一化到 `topic | entity | hub`；`status` 透传 `draft | published`**（2026-11-17 R3 定稿，
   覆盖 11-16 那版「直接透传」口径 —— 上游 `page_type` 实测 6 种，透传会让 15 页里 7 页显示裸 i18n key）。
   映射关系与兜底见 `docs/api.md` §6；上游原值另存 `pageType` 仅供排查，前端分组只用 `type`。
   `normalizeWikiPage` 对缺省值的兜底（`topic` / `published`）保留。
   理由：前端字典只需三值，上游枚举演进不牵动 B 的界面。
2. **tree 主用 `GET /index`**（`GetIndexView` 返回 `{intro, groups}` 结构化目录，单请求、最接近 tree 形态）；
   若 `/index` 信息不足（缺草稿页 / 缺引用统计），网关侧回退 `/folders + /pages` 拼装。
   无论哪条路，对 B 暴露的契约端点不变：`/knowledge-bases/{kbId}/wiki/tree`。
3. **`sources[]` 解析说明（给 A 的格式约定）**：上游 `SourceRefs` 是 `|` 分隔的字符串
   （形如 `文档标识1|文档标识2`），另有 `ChunkRefs` 分块级引用。第一版只解析到**文档级**：
   按 `|` 切分 → 逐项在库内解析出 `{knowledgeId, title, chunkCount}` → 组装为对象数组；
   解析不出来的项**丢弃并计入网关日志**，不塞进 `sources[]` 冒充来源。`ChunkRefs` 第一版不暴露。

网关未实现时返回 404 → 前端 `ApiError('NOT_IMPLEMENTED')`，页面给出「网关还没有 Wiki 接口」而不是空白页。演示模式（mock）内置 5 页，可直接验收交互。

## 六、验证记录

| 项 | 结果 |
| --- | --- |
| `npm test` | 12 条单测通过 + bundle 自检 3 槽位 / 331 条字典 |
| `npm run check` | 31 token、0 裸色值、字重/圆角/字号合规 |
| 门槛通过场景 | 查询「形圈 渗漏 保压」→ `2/6 条达引用门槛`，100% / 33% 徽标区分明显 |
| 门槛拦截场景 | 查询「给水泵扬程」→ `0/6` 并出现「结果仅供召回参考」提示 |
| 引用跳转 | 点击角标 [1] → 引用列表第 1 条展开并滚动到视口 |
| 弱证据提示 | 引用全部低于门槛时，答案下方出现「依据偏弱」提示 |
| 控制台 | 全流程 0 报错（headless Chrome 1280×900） |

截图：`docs/evidence/design/port-gate-pass.png`、`port-gate-block.png`、`port-chat-zoom.png`、`wiki-1280.png`。

## 七、后续

- 真实 SSE 若改用 `[K#]` 角标，`cite.js` 需要再加一个 `MARKER_K` 分支（当前只认 `[n]`）。
- 覆盖率是词面指标，对同义改写不敏感；后续可把 rerank 分数纳入，形成「词面 + 语义」双门槛。
- Wiki 正文当前用项目内 `RichText`（段落/列表/粗体/代码），表格与图片未支持；真实 Wiki 若带表格，需要先扩渲染器。

## 八、插件中心（v7）

移植完两个判定模块后，插件能力在界面上是「散落」的：证据门槛只在检索页可见，引用校验只在答案里可见，用户没法确认它们到底装没装、开没开。v7 加了一页「插件」，按运行时把 WeKnora 生态分三层摆出来：

| 层 | 内容 | 状态来源 | 能否开关 |
| --- | --- | --- | --- |
| 本地内置 | 证据门槛 `lib/gate.js`、引用校验 `lib/cite.js` | `localStorage['schanora.settings.v1'].plugins` | 能，立即生效 |
| 服务端 | 网页搜索 Provider、数据源连接器（RSS / 飞书 / Notion / 语雀 / GitLab / 钉钉） | `GET /api/v1/plugins`（可选） | 不能，只读 |
| Agent 侧 | MCP 服务、技能沙箱 | 无（面板不代跑） | 不能，只说明依赖 |

三条硬规则：

1. **没有的接口不装**。网关不提供 `/api/v1/plugins` 时，标题栏显示「网关无 /api/v1/plugins」，每张服务端卡片标「状态未知」；演示模式下标「需网关启用」——不出现假开关。
2. **开关必须真的改变行为**。关掉证据门槛：检索页不再渲染覆盖率徽标、工具栏不再显示 `n/m 达门槛`、答案不再提示依据偏弱；关掉引用校验：角标退回纯文字上标，不做可点与越界判定。
3. **开关落盘即生效**。插件页的开关直接调 `setSettings`，写 `localStorage` 并刷新快照，不用回设置页再保存。

与设置页的关系：设置抽屉的「本地插件」段和插件页是同一份状态，两处任意切换都立刻同步（都走 `normalizeSettings`）。
