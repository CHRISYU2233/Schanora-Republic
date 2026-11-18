---
version: alpha
name: Schanora-design-system
description: "Schanora 是 DeepSeek Harness 里的知识库工作区插件：52px 顶栏（品牌符号 + 横向分段导航）+ 全宽内容区，日间/夜间双主题由宿主属性切换。面板内不再画侧栏——宿主已经有一条，第二条只会挤窄内容。视觉基调取自 Spotify 的 DESIGN.md（深色面 + 单一品牌绿 + 二值字重 + 胶囊控件），但重心不是消费级播放器，而是密集的知识工作台——文字更小（11–13px 为主）、表格与列表承担主要信息量、强调色只出现在可操作处。品牌只在顶栏左侧留一枚字标（透明底绿字的位图，字形高 30px；暗色下 CSS 提亮，不垫底板），导航整体居中——宿主侧栏已经占了导航位，面板再铺一条品牌带只会重复。"
colors:
  # 面（由浅到深 = 由底到顶）
  canvas: "#FFFFFF"
  surface-1: "#F1F3F1"
  surface-2: "#E7EBE8"
  # 文字
  ink: "#17251E"
  ink-muted: "#5A6560"
  ink-subtle: "#6C7671"
  # 品牌
  brand: "#00642F"
  brand-hover: "#00783A"
  brand-tint: "#E8F3EC"
  on-brand: "#FFFFFF"
  # 语义
  success: "#0B7A3B"
  warning: "#9A5B00"
  warning-bg: "#FFF4E0"
  danger: "#B42318"
  danger-bg: "#FDECEC"
  # 深色（只覆盖变化的键）
  dark-canvas: "#121212"
  dark-surface-1: "#181818"
  dark-surface-2: "#1F1F1F"
  dark-ink: "#E8ECE9"
  dark-ink-muted: "#B3B8B4"
  dark-ink-subtle: "#8A918C"
  dark-brand: "#2C8F55"
  dark-brand-hover: "#34A363"
  dark-success: "#4FBF7F"
  dark-warning: "#E0A253"
  dark-danger: "#F0726A"
typography:
  display:
    fontFamily: system-ui
    fontSize: 21px
    fontWeight: 700
    lineHeight: 1.35
    letterSpacing: -0.022em
  title:
    fontFamily: system-ui
    fontSize: 14px
    fontWeight: 700
    lineHeight: 1.35
    letterSpacing: -0.01em
  subhead:
    fontFamily: system-ui
    fontSize: 13px
    fontWeight: 700
    lineHeight: 1.4
    letterSpacing: -0.005em
  body:
    fontFamily: system-ui
    fontSize: 12px
    fontWeight: 400
    lineHeight: 1.6
    letterSpacing: 0
  control:
    fontFamily: system-ui
    fontSize: 11px
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: 0
  eyebrow:
    fontFamily: system-ui
    fontSize: 10px
    fontWeight: 700
    lineHeight: 1.3
    letterSpacing: 0.11em
  badge:
    fontFamily: system-ui
    fontSize: 10.5px
    fontWeight: 600
    lineHeight: 1
    letterSpacing: 0.02em
  mono:
    fontFamily: ui-monospace
    fontSize: 11px
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: 0
rounded:
  sm: 4px
  md: 6px
  lg: 8px
  xl: 12px
  pill: 999px
  circle: 50%
spacing:
  xxs: 2px
  xs: 4px
  sm: 6px
  md: 8px
  lg: 10px
  xl: 12px
  xxl: 16px
  section: 20px
---

# Schanora 设计系统

> 这份文件是样式的**唯一权威**。`README.md` 只留摘要并指回这里；
> `plugins/schanora/client/src/ui.js` 里的 `--sch-*` 变量是它的代码投影；
> `scripts/check-design.mjs` 负责检查两者有没有漂移。
>
> 依据：[`VoltAgent/awesome-design-md`](https://github.com/VoltAgent/awesome-design-md) 里 **Spotify** 那份 DESIGN.md 的方法论
> （Stitch DESIGN.md 格式：YAML front matter + 分节正文 + Do/Don't + Iteration Guide）。

## 1. Visual Theme & Atmosphere

**一句话**：一个装在 AI 对话宿主里的知识工作台——安静、密、字重硬，绿色只在"能点"的地方亮。

- **密度优先**：正文 12px、控件 11px、表格行 40px 上下。这是应用界面而不是营销页，字号不追大，靠留白和明度分层做呼吸。
- **层级靠明度，不靠描边**：`canvas → surface-1 → surface-2` 三级面，卡片无边框，只有 hover 才出现阴影和抬升 1px。
- **字重二值制**：700 做标题与控件标签，400 做正文。600 只给"次级强调"（表格头、徽标、引用标题），不做 500 / 640 / 650 这类中间档——它们看起来像渲染不干净。
- **绿色是动词**：品牌绿只出现在可操作或已选中的东西上（主按钮、选中导航、命中序号、引用角标）。装饰性用绿会让"可点"这件事失去信号。
- **深色是宿主的一部分**：不是另做一版，只覆盖需要变的 token。宿主加 `data-ds-dark-theme` 属性即切换。

## 2. Color Palette & Roles

token 全部定义在 `ui.js` 的 `.sch-tokens` 里（浅色）与 `body[data-ds-dark-theme] .sch-tokens`（深色覆盖）。

### 面 Surface

| Token | 浅色 | 深色 | 用在哪 |
|---|---|---|---|
| `--sch-bg` | `#FFFFFF` | `#121212` | 页面底、输入框、弹层内的静态区域 |
| `--sch-layer` | `#F1F3F1` | `#181818` | 卡片、表格、气泡、空状态——**一级面** |
| `--sch-layer-2` | `#E7EBE8` | `#1F1F1F` | 卡片 hover、内嵌块、引用块——**二级面** |
| `--sch-plate` | `#FFFFFF` | `#FFFFFF` | 品牌图底板，两主题都保持白，避免 logo 被染色 |

### 文字 Ink

| Token | 浅色 | 深色 | 用在哪 |
|---|---|---|---|
| `--sch-text` | `#17251E` | `#E8ECE9` | 标题、正文、表格主列、气泡正文 |
| `--sch-text-2` | `#5A6560` | `#B3B8B4` | 副标题、次要列、说明文字 |
| `--sch-text-3` | `#6C7671` | `#8A918C` | 元信息、时间、占位符、分组标题（白底 4.7:1） |

### 品牌 Brand

| Token | 浅色 | 深色 | 用在哪 |
|---|---|---|---|
| `--sch-green` | `#00642F` | `#2C8F55` | 主按钮底、选中导航底、命中序号文字 |
| `--sch-green-2` | `#00783A` | `#34A363` | 主按钮 hover、焦点环、链接 |
| `--sch-brand-green` | `#00642F` | `#00642F` | 顶栏 fallback 字符（字标图缺失时才出现）。2026-11-17 起字标位图自带透明底 + 品牌绿字，不再垫底板；暗色下 fallback 改用 `--sch-green` |
| `--sch-green-tint` | `#E8F3EC` | `rgba(0,140,60,.16)` | 用户气泡、选中项底、成功提示底。**不取宿主的 success-secondary** |
| `--sch-on-green` | `#FFFFFF` | `#FFFFFF` | 绿底上的文字 |

**这三档不留给宿主决定**：`--sch-layer` / `--sch-layer-2` / `--sch-green-tint` / `--sch-text-3` 在明亮态是自己给的值，不再写成 `var(--dsw-alias-*)`。原因是宿主那几个 token 的口径和这里要表达的意思不一致——`state-success-secondary` 在 DSH 明亮态是**实心亮绿**，铺在气泡和选中的会话上就是荧光笔；`label-tertiary` 在白底只有 3.2:1。深色那侧仍然只覆盖变化的键。

### 语义 Semantic

| Token | 浅色 | 深色 | 用在哪 |
|---|---|---|---|
| `--sch-ok` / `--sch-err` / `--sch-warn` | `#0B7A3B` / `#B42318` / `#9A5B00` | `#4FBF7F` / `#F0726A` / `#E0A253` | 状态点、状态文字、错误条文字 |
| `--sch-err-bg` / `--sch-warn-bg` | `#FDECEC` / `#FFF4E0` | `rgba(...,.16)` | 提示条底 |

其余结构性 token：`--sch-border`（14%/14% 白）、`--sch-border-soft`（8%/8%）、`--sch-hover`、`--sch-scrim`、`--sch-focus-ring`、`--sch-gloss` / `--sch-gloss-strong`（微交互高光）、`--sch-shadow-1/2/3`。

## 3. Typography

**家族**：跟随宿主。正文 `var(--ds-font-family-body)`（`-apple-system / Segoe UI / PingFang SC / Microsoft YaHei`），等宽 `var(--ds-font-family-code)`。不引第三方字体，也不打包字体文件——插件跑在别人的壳里，加载新字体等于制造 FOUT。

**9 档字阶**（`check-design.mjs` 会拦下任何越界字号）：

| 档位 | 字号 | 字重 | 行高 | 字距 | 用在哪 |
|---|---|---|---|---|---|
| display | 21px | 700 | 1.35 | -0.022em | 页面标题（「文档」「工程问答」） |
| title | 14px | 700 | 1.35 | -0.01em | 卡片标题、抽屉标题、空状态标题 |
| subhead | 13px | 700 | 1.4 | -0.005em | 区块标题、工具栏标题、弹层标题 |
| body | 12px | 400 | 1.6 | 0 | 正文、表格主列、气泡、说明 |
| control | 11px | 600 | 1.4 | 0 | 按钮标签、表格头、徽标外的控件 |
| eyebrow | 10px | 700 | 1.3 | +0.11em | 「工作区」「规划中」这类分组标签（全大写） |
| badge | 10.5px | 600 | 1 | +0.02em | 状态徽标（`演示数据` / `网关实时`） |
| mono | 11px | 400 | 1.5 | 0 | 时间、字节数、块号、接口路径 |

**原则**

1. 中文不做 `text-transform: uppercase`；只有英文 eyebrow 才加正字距。
2. 标题一律负字距（-0.005 ~ -0.022em），正文不加。
3. 数字列用 `font-variant-numeric: tabular-nums`，否则时间列会左右跳。
4. 行高只允许 1 / 1.3 / 1.35 / 1.4 / 1.5 / 1.6 / 1.65：单行控件用 1，多行正文用 1.6。

## 4. Shapes

| Token | 值 | 用在哪 |
|---|---|---|
| `--sch-radius-sm` | 8px | 卡片、表格容器、输入框、命中卡 |
| `--sch-radius` | 12px | 气泡、弹层、抽屉、重复文件对话框 |
| 4px | 徽标、序号块、内联代码、块号 |
| 6px | 会话列表项、引用块、小内嵌块 |
| 999px | 按钮、导航项、范围 chip、提示条 |
| 50% | 图标按钮、状态点、头像位 |

**规则**：胶囊只给**可点**的东西。徽标不是胶囊（4px），因为徽标不可点——这个区分一旦糊掉，用户会去点徽标。

## 5. Components

### 按钮 `button`

- 基础：高 30px、左右内距 14px、`999px` 胶囊、字重 700、`surface` 透明 + 1px `--sch-border` 描边。
- 主按钮 `.primary`：`--sch-green` 底 + `--sch-on-green` 字 + `shadow-1`，hover 换 `--sch-green-2` 并抬到 `shadow-2`。
- 图标按钮 `.icon`：30×30 正圆，无文字。
- 小号 `.sm`：高 27px、内距 11px，用于表格行内操作。
- 按下：`translateY(.5px) scale(.985)`，不弹回。

### 徽标 `badge`

高 20px、内距 7px、4px 圆角、10.5px/600。四种色调：`plain`（`surface-2` 底 + `text-2`）、`live`（绿 tint + 绿字）、`warn`、`err`。**不是按钮，不给 hover。**

### 范围 chip `scopechip`

高 26px、`999px`、字重 600。未选：`surface` 透明 + 描边；已选：`--sch-green-tint` 底 + `--sch-green` 字 + 1px 绿边；hover 抬 1px。

### 输入 `input` / `textarea`

`surface` 透明（浅色下即白） + `box-shadow: inset 0 0 0 1px var(--sch-border)`——**不用实线 border**，避免聚焦时布局跳动。聚焦：inset 换 `--sch-green-2` + 3px `--sch-focus-ring` 光晕。

问答页的输入框是主输入面，不是搜索框：圆角 12px、正文 14px、内距 12×14、高度 96–240px 随内容自动长高（`resize:none`，不给拖拽手柄——手柄会把贴底的输入区撑出可视区）。发送按钮与它同排，40px 高、`999px`。

### 卡片 `kbcard` / 命中卡 `hit`

`surface-1` 底、无边框、8px 圆角。hover：底色升到 `surface-2`、`shadow-2`、`translateY(-1px)`，并在顶部叠一条 inset 高光。选中/展开态回到 `canvas` 底 + `shadow-1`（看起来"被拿起来"）。

### 表格行 `dtr` / `tr`

无外框，行间 1px `--sch-border-soft` 分隔。表头 11px/600 + `text-3`，行高约 40px。主列两行（标题 12px/`text` + 文件名 11px/`text-2`），数字列右对齐、等宽、`tabular-nums`。行内操作固定右对齐，与表头同列同向。

### 气泡 `bubble`

助手：`surface-1` 底、12px 圆角、`shadow-1`、正文用 `--sch-text`（**不能用 `text-2`，深色下会发灰**），最大宽度 `min(72ch, 100%)`。用户：`--sch-green-tint` 底、无阴影、右对齐。滚出视口的气泡由滚动区上下 14px 的 mask 淡出，不做硬切。

### 引用 `ref`

`surface-2` 底、6px 圆角、无边框。行内序号 15×15 的 4px 方块 + 绿字；hover 时按钮左内距 0 → 10px 渐入（提示可展开）。列表头部右侧是引用自检结论：全部可定位用 `--sch-green`，有对不上的用 `--sch-warn`。

### 引用角标 `cite`

正文里的 `[n]` 渲染成 10px/700 上标。可定位：绿字 + `--sch-green-tint` 底、4px 圆角、`cursor:pointer`，点击展开对应引用；越界：`--sch-warn` 字 + `--sch-warn-bg` 底 + 删除线——**颜色之外还有线型**，不靠单一通道表意。角标只在回答结束（非流式）且已有引用列表时判越界，避免流式过程中误标。

### 导航 `navitem`

高 36px、`999px`。未选：透明 + `text-2`；hover：`--sch-hover`；选中：`--sch-green` 底 + `on-green` 字 + 700。分组标签用 eyebrow 样式（10px/700/正字距/`text-3`）。

### 提示条 `toast` / `alert`

`999px`、内距 8×12、`border: 1px solid transparent`（占位防跳动）、底色走 tint、文字走语义色。错误条与成功条结构一致，**只有颜色不同**。

全局连接状态与各页面的请求失败**共用同一种浮层警示**：贴在面板顶部、浮在内容之上，单行、超长省略、可堆叠（最多 3 条），每条右侧一个 × 收起，6 秒后也会自动消失，重试只是一个文字按钮。**不要再做成满宽红块 + 大按钮**——那会把内容整体顶下去，看起来像排版坏了；也不要在各页面各画一种样式。

### 空状态 `empty` 与骨架 `skel`

空状态：`surface-1` 底、8px 圆角、30×22 内距，标题 14px/700 + 说明 12px/`text-2`，**不放大插画**。
骨架：`--sch-hover` 底的圆角条，1.1s 呼吸，不加 shimmer 扫光。

### 弹层 `pop` / `drawer`

`canvas` 底、12px 圆角、`shadow-3`、1px `--sch-border-soft`。抽屉从右侧滑入，200ms。弹层点外部或按 Esc 关闭。

### 设置行 `setrow` 与开关 `switch`

设置抽屉里的每行：左列标题 13px/600 + 说明 11px/`text-3`，右列控件。行间 1px `--sch-border-soft`，最后一行无分隔线。分组标题是 eyebrow（11px/700/正字距/`text-3`）。

开关：38×22、`999px`，关＝`surface-2` 底 + 16px 白点靠左；开＝`--sch-green` 底 + `on-green` 圆点右移 16px。只用 `aria-pressed` 表达状态，不写 `checked`——它是按钮不是复选框。

### 插件卡 `plugin`

`surface-1` 底、8px 圆角、无描边、内距 12×14。结构：30×30 图标块（开启时 `--sch-green-tint` 底、绿图标；关闭转 `surface-2` + `text-3`）→ 名称 13px/700 + 状态徽标 → 说明 12px/`text-2` → 依赖 chip（11px 等宽、`surface-2` 底、6px 圆角）→ 底部虚线分隔 + 说明 + 开关。启用的本地插件回到 `canvas` 底 + `shadow-1`，和卡片"被拿起来"的规则一致。

### 采集卡 `clip-card`
Draft/预览/结果三态共用一张卡：`1px` 软边框 + 12px 圆角 + 纸面底色，标题 13px/600。
表单与预览在 ≥1180px 时两列（`1.15fr / 1fr`），窄窗单列。卡内不再套第二层卡片。

### 状态时间线 `step`
候选状态（draft→…→ready）排成一行：8px 圆点 + 11px 文字 + 14px 连接线。
已过节点用 `ok` 语义色，当前节点用品牌绿并加 600 字重，未到节点用 `layer-2` 灰。
禁止用颜色之外的方式（图标/动效）表达进度，避免与徽标语义冲突。

### 浏览器任务 `brow-task`
任务卡比 `clip-card` 轻一档：软边框、8px 圆角、页面底色；标题行左「类型徽标 + URL（等宽、单行省略）」、右状态徽标。
操作按钮（暂停/继续/取消/送入采集）放卡片底部一行，主操作只有一个 primary。
下载校验结果用 `ok` 语义色 + 等宽哈希前缀；迟到丢弃用 `warn` 提示条，不弹窗。

### 批次行 `batch-row`
清单行：徽标（左）+ 标题 / 文档 id / 错误（中）+ 移除（右）。行间 `1px` 软分隔，最后一行无分隔线。
完成报告用 `alert` 容器承载，只报计数，不逐条重复列已在上方展示的项。

### 范围锁定说明 `msg-note`
答案气泡顶部的一行元信息：11px、`text-3`，内容为「检索范围（发送时锁定）：…」。
它属于证据元数据，不参与正文排版，也不加背景色。

## 6. Depth & Elevation

| 级 | 处理 | 用在哪 |
|---|---|---|
| 0 | 无阴影、无边框 | 页面底、表头、分组标签 |
| 1 | `shadow-1` | 卡片静止、主按钮静止 |
| 2 | `shadow-2` + `translateY(-1px)` | 卡片 hover、主按钮 hover |
| 3 | `shadow-3` | 弹层、抽屉、重复文件对话框、提示条容器 |

浅色阴影是**绿黑**（`rgba(10,20,15,…)`）而不是纯黑，压在绿底上不发脏。深色阴影是纯黑且更重（.40/.50/.55）——深色里阴影是唯一的层级线索。**不要用 `border: 1px` 代替阴影做抬升**。

## 7. Layout & Spacing

- 顶栏固定 52px，三轨 grid（`minmax(auto,1fr) minmax(0,auto) minmax(auto,1fr)`）：左侧字标、**居中**的横向分段导航、右侧工具。
  两条等宽弹性轨保证导航几何居中；放不下时两侧先保住自己的最小内容宽度，中轨收缩并横滚（<640px 直接回落左对齐），避免压住字标。930px 以下隐藏连接状态胶囊，把宽度让给导航。
- 面板高度贴合宿主可视区（`--sch-panel-h` 由 `Panel` 量出）：滚动只发生在内容区内部。问答页是 `fit` 模块——消息流自己滚，输入区贴底常驻，页面整体不滚。
- 页签栏只放高频模块（当前 7 枚）；低频模块注册时标 `more: true`，收进顶栏 `⋯` 菜单，当前模块在菜单里时 `⋯` 按钮呈品牌绿激活态。`⋯` 菜单不重复常驻按钮已有的入口（如设置）。
- 内容区左右内距 28px（<900px 收 16px），顶部一行 12px 模块说明（页名与选中页签重复，已删），不再用 21px 大标题；≤900px 该行整行隐藏。
- 内容区左右内距 16px、区块间距 16–20px、卡片内距 12–16px、控件间距 8–10px。
- 间距只用 2 / 4 / 6 / 8 / 10 / 12 / 16 / 20 这几档，不出现 13、15、18 这类手调值。
- 一屏内的信息密度目标：桌面 1080p 下文档列表 6–8 行、知识库网格 3 列。

## 8. Do's and Don'ts

**Do**

- 改颜色先改 `.sch-tokens`，再同步这份文件的 `colors:`，最后跑 `node scripts/check-design.mjs`。
- 层级优先用 `canvas / surface-1 / surface-2` 三档明度差表达。
- 标题用 700，正文用 400；需要"轻一点但更重"用 600，不要发明 500 或 650。
- 强调色只给可点/已选中的元素；一个界面里绿色面积控制在 5% 以内。
- 中文文案不做 uppercase；英文 eyebrow 才加正字距。
- 深色下先检查文字是否继承了 `--sch-text-2`——这是深色可读性最常见的坑。

**Don't**

- 不要给卡片加 1px 灰描边来表示层级（会显得像早年的后台模板）。
- 不要把徽标做成胶囊、不要给徽标加 hover。
- 不要用实线 `border` 做输入框（聚焦突变会抖）。
- 不要新增字重（500 / 640 / 650）、字号（11.5 / 12.5 / 14.5）、圆角（3 / 10 / 14）。
- 不要在 CSS 里写裸色值；确需例外（如 mask 必须用 `#000`）要加 `design-ok: 理由` 注释。
- 不要用渐变、玻璃拟态、动效弹跳来"增加高级感"——这套系统的质感来自克制的明度和字重。
- 不要把整页改成绿底。顶栏字标是**透明底绿字**（2026-11-17 换版），直接落在顶栏背景上：不要再给它垫绿底板，也不要垫白底板；暗色靠 `filter: brightness(1.7) saturate(.98)` 提亮，并保留 `.28s` 过渡。
- 不要在 `main` 槽里再画一条侧栏。宿主已经有导航侧栏，第二条会让内容区在 1080 窗口下只剩 570px。

## 9. Responsive Behavior

| 断点 | 变化 |
|---|---|
| ≥1200px | 知识库 3 列、表格 5 列全显；问答页保留 184px 会话列 |
| 1000–1199px | 知识库 2 列；隐藏顶栏连接状态胶囊，宽度让给导航 |
| 900–999px | 知识库 2 列；问答页会话列收起，改用头部下拉切换 |
| <900px | 表格隐藏「大小 / 接收时间」两列；页头说明文字隐藏，只留页名 |
| <680px | 知识库单列；工具条按钮收进 `⋯`；采集表单与预览合并单列 |

触控目标：按钮 ≥27px（移动端 ≥36px），图标按钮 ≥30px，导航项 36px。窄窗下不堆叠小按钮，宁可收进菜单。

## 10. Iteration Guide

1. 一次只改一个组件，并用本文的组件名指代它（`badge` 不是「那个小标签」）。
2. 动样式前先问：这是 token 的事，还是组件的事？token 的事只改 `.sch-tokens`。
3. 新增组件先看 §5 有没有可复用的形状，避免第 7 种圆角。
4. 改完跑 `npm run check`（含 `check-design`），再跑 `npm run shots` 看 47 张截图（含 `28-chat-composer` / `29-settings` / `30-plugins` / `32–47` 插件页签）。
5. 深色必须单独看一遍：`24-chat-dark`、`06-docs-dark` 是回归位。
6. 任何"顺手加个效果"的想法先记到 issue，不要混进功能提交。

## 11. Known Gaps

- **字体是宿主的**：DSH 换字体，这里的字阶会整体偏移，未做自测。
- **对比度未系统测量**：只保证"能读"，没有跑 WCAG 全量校验；`--sch-text-3` 浅色下已提到 4.7:1、深色 7.2:1，仍只用于元信息（10–11px），不承载正文。
- **深色只覆盖存在的键**：宿主若新增主题（如高对比度），需要在这里补一组覆盖。
- **`preview.html` 不是产品页**：它只渲染色卡与组件态，用来验收 token，不含真实数据流。
- **动效时长未参数化**：120–200ms 散在各处，没有统一 token。
- **面板高度是量出来的**：`Panel` 用最近可滚动祖先的下沿算 `--sch-panel-h`。宿主若把面板放进「没有高度、且已滚动」的容器，首帧可能偏高——输入区有 sticky 兜底，但高度不会自愈。
- **插件中心只读服务端状态**：`GET /api/v1/plugins` 未实现时，服务端插件显示「读不到」，没有伪造开关。
- **API Key 存 localStorage**：比写进代码强，但仍不是系统钥匙串；共用机器上需要用户自己清。
- **采集/浏览器/批量只有演示后端**：ClipService 与浏览器桥是提案端点，未部署前这三页跑本机 mock；mock 状态迁移、去重、失败注入与真实服务同构，但不代表真实 OneDrive/WeKnora 链路已通。
- **浏览器任务无虚拟列表**：任务数上百时列表会变长，未做窗口化；当前按会话只保留演示量级。
- **状态时间线是水平的**：窄窗下 9 个节点会换行两次；未做折叠成「第 n/9 步」的紧凑形态。
