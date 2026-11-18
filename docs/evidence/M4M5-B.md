# 模块 4 / 5 前端交付说明（B）

> 2026-11-13 · 对照 A 的《模块1-5进度同步》与 `docs/api.md` 4、5 两节
> 代码：`plugins/schanora/client/src/ui.js`（唯一实现）· 预览：`preview/` · 截图：`docs/evidence/shots-M4M5`

## 一、编号对齐（先说这个）

A 的进度文档把模块拆成了 7 个：M4 = 文档检索、M5 = RAG 问答、M6 = Wiki。此前根 README 里写的是 M4 = 问答、M5 = Wiki、M6 = DSH 接入。**以 A 的为准**（后端能力是事实来源），前端注册表同步改成：

| 注册 id | 名称 | 编号 | 状态 | 页签 |
|---|---|---|---|---|
| `kb` | 知识库 | M1 | ready | ✓ |
| `docs` | 文档 | M2 | partial | ✓ |
| `doc-detail` | 文档详情 | M3 | partial | —（详情视图） |
| `search` | 检索 | **M4** | **ready** | ✓ |
| `qa` | 工程问答 | **M5** | **ready** | ✓ |
| `wiki` | Wiki | **M6** | planned | ✓ |
| `interop` | 跨插件 | DSH | planned | — |

左侧导航现在 5 项：知识库 / 文档 / 检索 / 工程问答 / Wiki。

## 二、模块 4：检索

| 能力 | 实现 |
|---|---|
| 查询 | 输入框 Enter 或「检索」按钮；空查询禁用 |
| 范围 | 知识库多选胶囊，「全部知识库」= 展开为当前全部库 id |
| 结果 | 命中数 + 耗时 + rerank 状态；每条显示序号 / 文档标题 / 块号 / 命中类型（向量·关键词）/ 相关度 |
| 原文 | 正文两行截断，点「展开原文」原地展开（不跳页） |
| 状态 | 空态、加载骨架、0 命中、错误条（带 code） |

**关键实现点**：契约 4.1 写明 `knowledgeBaseIds` / `knowledgeBaseId` 至少传一个，否则上游 400。界面上的「全部」是空数组，**落到请求必须展开成真实 id**（`effectiveScope()`）。否则一选「全部」就必然报错——这是最容易漏的一条。

`meta.rerank.outcome` 如实展示：`disabled` 时写明「rerank 已关闭（云端模型不可用），当前是向量 + 关键词混合召回」。

## 三、模块 5：RAG 问答（SSE）

| 能力 | 实现 |
|---|---|
| 会话 | 列表、新建、切换；标题为空显示「未命名会话」；自动生成标题时原地更新 |
| 历史 | `GET /sessions/{id}/messages?limit=30`，按返回顺序渲染 |
| 提问 | `POST /sessions/{id}/messages`，`fetch` + `ReadableStream` 读 SSE（`EventSource` 不支持 POST） |
| 引用 | `references` 事件渲染为可展开的引用块，点开看原文，不跳页 |
| 停止 | `AbortController`；停止后半截答案保留并标注「已停止」 |
| 错误 | 流内 `error` 事件、HTTP 非 2xx、网络中断三种分别提示 |

**SSE 解析照搬了 DSH 里已装的 `@rdkb/dsh-weknora-ground`**（同一上游、同一批 `responseType`）。三条硬规则：

1. `answer` 是分片，按序拼接，最后一个分片 `done=true`；
2. **只有 `complete` 才算结束**——流在它之前断掉说明答案不完整，必须报错，不能把半句话当全文；
3. 流里会混 `[DONE]` 和非 JSON 行，跳过、不抛。

另外做了 rAF 节流：分片按帧合并再 setState，长答案不会一帧一次重渲染。

## 四、验证

```
node scripts/build-client.mjs   # 318KB / 5741 行
node scripts/check-bundle.mjs   # 3 槽位 · 299 条字典 · 中英对齐
node scripts/shoot.mjs <chrome> http://127.0.0.1:8124/preview/ docs/evidence/shots-M4M5
# 31 个状态全部出图，控制台 0 错误
```

截图里与本模块直接相关的：

| 文件 | 覆盖 |
|---|---|
| `16-search-idle` | 检索空态（搜索框 + 范围胶囊） |
| `17-search-results` | 6 条命中：标题/块号/类型/相关度/rerank 说明 |
| `18-search-expanded` | 展开原文，链接变「收起」 |
| `19-chat-history` | 会话列表 + 历史消息 |
| `20-chat-streaming` | 流式生成中（光标 + 只有引用已到） |
| `21-chat-answer` | 完成态：提问 + 回答开头 + 要点列表 |
| `22-chat-reference` | 点引用展开原文 |
| `23-chat-stopped` | 半途停止：保留半截 + 「已停止」 |
| `24-chat-dark` | 深色主题 |
| `25-http-search` / `26-http-chat-stream` / `27-http-chat-answer` | **真 HTTP**：假网关真 SSE，走真 fetch 与真解析 |

### 假网关也升级了

`scripts/fake-gateway.mjs` 之前只覆盖 M1–M3，且停留在「A 的老形状」。这轮按 A 的新实现补齐：

- 统一错误包裹 `{code,message,data,retryable,requestId}`（422 / 502 都按这个）；
- `/health` 改成真探活形状（`status` / `version` / `checkedAt`）；
- `/capabilities` 返回 `features`；
- `/chunks` 返回 `{items,total,page,pageSize}`；
- 新增 `/search`、`/sessions`（GET/POST）、`/sessions/{id}/messages`（GET + POST SSE）。

所以 `25–27` 三张图证明的不是「界面能显示假数据」，而是**前端适配器 + SSE 解析器对着真实 HTTP 跑通了**。

## 五、仍然没验证的

1. **对真 WeKnora 的联调**——按 A 的说法异地，约时间一起走。本机无 Docker，8080 无服务。
2. **SSE 事件口径**——A 转发的 `responseType` 我已按契约实现，但真实上游是否会夹带 `toolCall` / `thinking` 之类的额外事件，只做到「忽略而不报错」，没做折叠展示。
3. **长答案性能**——rAF 节流是按 3B 本地模型的速度估的，未做超长（>5000 字）答案的压测。
4. **引用与文档详情的联动**——引用块只在原地展开原文，没有跳到 M3 的文档详情。跨模块跳转要改文档模块的状态归属，这轮没做。

## 六、给 A 的两条反馈

| # | 事项 | 说明 |
|---|---|---|
| 1 | `POST /search` 缺参数校验 | 两个库字段都不传时，上游返回 400；建议网关直接返回 422 `VALIDATION_ERROR`，前端就不用先自己兜一层 |
| 2 | SSE 的 `error` 事件没有 `code` / `requestId` | 目前只有 `content` 字符串，前端只能原样展示，无法区分「可重试」与「配置错」 |

## 七、视觉规范对齐（本轮，功能零改动）

依据 [`VoltAgent/awesome-design-md`](https://github.com/VoltAgent/awesome-design-md) 的 Spotify DESIGN.md 重写样式层，细则与取值表在根 `README.md` 第五节。对评审最相关的四条：

1. **字重二值制** `700 / 400`——之前的 750/650/550 混排会让标题和正文糊在一起，这是「模板感」的主要来源；
2. **卡片不描边**——层级改由 `bg → layer → layer-2` 三级明度和重阴影表达，只有 hover 才给阴影；
3. **按钮全胶囊、徽标不是胶囊**——胶囊只给可点元素，徽标 4px 圆角，二者视觉语义分开；
4. **输入框用 `inset` 描边环**，聚焦叠 3px 绿光晕，不因出现边框而跳动。

唯一刻意偏差：Spotify 规定绿色不用于背景，但品牌带必须整条绿底白字（产品要求），所以绿色只在侧栏顶部作背景，内容区只做强调色。

微交互（按钮径向高光、卡片顶部 inset 高光、命中项序号转绿等）全部包在 `@media (prefers-reduced-motion:no-preference)` 内，系统开启「减少动态效果」时自动关闭。

对照图：`01-home-light`（浅色整体）、`17-search-results`（命中列表）、`24-chat-dark`（深色层次）。

## 八、去侧栏化（结构层适配宿主）

用户在宿主里截图反馈「问答界面太小」。量出来是三层竖栏叠加：

| 层 | 宽 | 谁画的 |
|---|---|---|
| DSH 侧栏 | 280 | 宿主 |
| 面板内模块侧栏 | 242 | 本插件（已删） |
| 问答页会话列 | 212 | 本插件（窄容器下已收起） |
| 剩下给消息区 | **570** | — |

改动：

1. **模块导航从 242px 侧栏搬到 52px 顶栏**——品牌只留一枚绿底字标，导航变横向胶囊并几何居中，模块多了横向滚动（`design/preview*.html` 的「顶栏与分段导航」有样例）。
2. **问答页会话列在 <1180px 收起**，切换改用头部下拉；聊天区改为填充剩余高度，不再用 `100vh` 算。
3. **内容区拿回整幅宽度**：1080 窗口下消息区从 570 → 1012。
4. 顺带修掉三处：检索结果的延迟与 rerank 长句收进 `title`（异常才提示）、mock 检索不再出现两篇文档同分、文档页选库行的数字补单位。

新增约束写进 `DESIGN.md` §8：**不要在 `main` 槽里再画侧栏**。

截图变化：`01a-nav-collapsed` 随侧栏一起删除（顶栏没有折叠态），总数 32 → 31。


## 九、明亮模式配色修正 + 顶栏字标（v6）

宿主内明亮态截图暴露出四类问题，都出在「借了宿主的语义 token」：

1. **气泡与选中项是实心亮绿**（`#4ED17E`，宿主的 `state-success-secondary`）——荧光笔效果；
2. **三级文字 3.2:1**——时间戳、脚注发灰；
3. **卡片与白底只差 1–2%**——纯白页面上等于没有边界；
4. 会话列表标题过长时冒出**横滚条**（那张截图里选中的会话下面那条灰条）。

改法：`--sch-green-tint` / `--sch-text-3` / `--sch-layer` / `--sch-layer-2` 四个键改为自持，
深色覆盖**一字未改**（深色本来就是本地覆盖的，所以一直是对的）。

同时把顶栏品牌从手绘矢量 S 换成真字标（`schanora-wordmark-trim.png`，20px 高、外框 105×30），
导航改三轨 grid（`1fr auto 1fr`）几何居中；<640px 回落左对齐避免压住字标。

数值前后对照、对比度计算与理由写在 `docs/handoff/B-DESIGN.md` 第七节。


## 十、引用自检 + 证据门槛（移植，v0.3）

来自 WeKnora 插件生态的两个纯函数模块，接进检索与问答：

| 位置 | 行为 | 截图 |
| --- | --- | --- |
| 检索页 · 工具栏 | `6 个命中 · 2/6 条达引用门槛`，全部不达标时提示「结果仅供召回参考」 | `design/port-gate-pass.png` / `port-gate-block.png` |
| 检索页 · 每条命中 | `覆盖 xx%` 徽标：达标绿、低于 34% 标黄；缺文档 id/分块号的另标「缺出处」 | 同上 |
| 问答页 · 正文角标 | 可定位的角标有底色、可点击；越界划掉标黄 | `design/port-chat-zoom.png` |
| 问答页 · 引用列表头 | `3 处引用都可定位` / `n 处引用无法定位` | 同上 |
| 问答页 · 弱证据提示 | 本轮引用全部低于门槛时，答案下方提示「依据偏弱」 | 同上 |

数据来源：`annotateHits(query, refs)` 与 `verifyCitations({answer, refs})`，
纯函数、零依赖，单测见 `test/gate.test.mjs` / `test/cite.test.mjs`（12 条）。

适配差异（`[K#]` → `[n]`、snake_case → camelCase、门槛只标注不丢弃）写在
`docs/handoff/C-PLUGIN-PORT.md` 第四节。
