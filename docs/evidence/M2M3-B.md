# 模块 2 / 3 前端交付说明（B）

> 2026-11-12 · 对照 A 的 `docs/api.md`（模块 1–3 定稿版）
> 代码位置：`plugins/schanora/client/`（DSH 客户端插件），预览：`preview/`

## 一、做了什么

| 模块 | 能力 | 对应接口 |
|---|---|---|
| 1（补齐） | 知识库列表改用真实字段（文档数/分块数/更新时间）、新建知识库表单、**向量模型动态拉取** | `GET/POST /api/v1/knowledge-bases`、`GET /api/v1/models?type=Embedding` |
| 2 | 文档列表、拖放/多选上传、逐项上传进度、同名同大小重复提示、空/加载/失败态 | `GET/POST /api/v1/knowledge-bases/{kbId}/documents` |
| 3 | 处理状态轮询、文档详情、5 阶段轨迹、失败原因与错误码、分块列表（分页/字符区间/索引状态）、重新上传 | `GET /api/v1/documents/{id}`、`/spans`、`/chunks` |

关键点：

- **上传 ≠ 处理完成**：上传成功后文档为 `pending`，列表每 3s 轮询，全部进入终态自动停止；界面右上角显示「自动刷新中 · 3s · N 个处理中」。
- **状态不映射成假的**：WeKnora 原生还有 `finalizing` / `deleting` / `cancelled`，契约只写了 4 个。界面按真实值显示，未知值回落到「未知状态」，不硬塞进 4 个枚举。
- **重复文件**：按契约由前端比对 `fileName + fileSize`，确认弹层明说「WeKnora 不去重，继续会生成新文档 ID」。
- **分块**：显示块号、字符区间、索引状态（ready/processing/failed）、截断提示（超过 160 字折叠，可展开），分页按 `page_size` 判断是否还有下一页。
- **没有重试接口**：只给「重新上传」，并在旁边写明会生成新的文档 ID——没有假装有 reparse。

## 二、验证

### 1. 构建与静态自检

```
node scripts/gen-assets.mjs      # 品牌图内联（symbol 96×96、wordmark 480×160）
node scripts/build-client.mjs    # 生成 client.js（219KB，含 base64 图）
node scripts/check-bundle.mjs    # 3 个槽位、221 条字典中英对齐、无 BOM/乱码
```

结果：`[check] 全部通过 · 3 个槽位注册 · 247 条字典`

### 2. 界面状态截图（16 张，控制台 0 错误）

```
node scripts/shoot.mjs <chrome> http://127.0.0.1:8124/preview/ docs/evidence/shots-M2M3
```

| 文件 | 覆盖 |
|---|---|
| `01-home-light` | 首页：顶部应用条（字标）+ 左侧模块导航 + 知识库表 |
| `01a-nav-collapsed` | 左侧导航收起为图标栏 |
| `01d-modules-drawer` | 模块抽屉：注册表里 6 个模块、状态、所需接口 |
| `01e-planned-module` | 未接入模块：只列接口，没有任何假按钮 |
| `01b-kb-create` / `01c-kb-created` | 建库表单、模型下拉（默认 `bge-m3`）、创建成功 |
| `02-docs-list` | 文档列表：失败 / 处理中 / 已完成 |
| `03-doc-props` | 详情：属性 + 失败原因 + 重新上传 |
| `04-doc-trace` | 5 阶段轨迹：解析✅ 分块✅ 向量化❌ 多模态已取消 后处理已取消 |
| `05-doc-chunks` | 分块：字符区间、索引失败标记、分页 |
| `06` / `07` / `08` | 深色 / 英文 / 窄窗 |
| `09-upload-duplicate` | 拖放同名同大小文件 → 重复确认弹层 |
| `10` / `11` | 上传队列（已接收）→ 3s 后自动变为处理中 |
| `12-error` | 网关不可达：错误条 + 重试，侧栏底部转红 |
| `13`–`15` | **真 HTTP 通路**：网关实时 → 文档列表 → 轨迹 |

### 3. 真 HTTP 链路（不依赖 WeKnora / Python）

```
node scripts/fake-gateway.mjs                    # 127.0.0.1:8000，形状同 A 的 gateway
SHOOT_HTTP=1 node scripts/shoot.mjs <chrome> …   # 自动切到「网关实时」再截图
```

假网关按 A 的实现返回 `{code:0,message,data}`、camelCase、`/health` 老字段、`/capabilities` 404。
这条链路证明前端不是只对演示数据生效：列表、详情、轨迹、分块、上传都走了真实 `fetch` / `XHR`。

## 二·补、界面改版与模块接口

| 变化 | 内容 |
|---|---|
| 布局 | 品牌整体迁到左侧栏顶部：整条绿色品牌带（#00642F）放绿底白字字标，收起态换白色符号；侧栏 242px ↔ 64px，状态存 localStorage，<900px 自动收起 |
| 交互与动效 | 模块切换 180ms 淡入上浮（`key` 变化触发）、弹层 140ms 缩放淡入、抽屉 200ms 右侧滑入、忙时状态点 1.1s 呼吸；全部只动 opacity/transform，并支持 `prefers-reduced-motion` |\n| 效率 | `/` 直达搜索、`Esc` 清空退出（已用 CDP 验证：聚焦→筛选 3→1→清空回到 3）；弹层由 320px 放宽到 360px，表单不再挤 |\n| 一致性审计 | 收敛为三档圆角（3/8/12）、一支绿（#00642F，hover #00783A）、一条字阶；补齐 `focus-visible`、细滚动条、按钮过渡 |\n| 交互与动效 | 模块切换 180ms 淡入上浮（`key` 变化触发）、弹层 140ms 缩放淡入、抽屉 200ms 右侧滑入、忙时状态点 1.1s 呼吸；全部只动 opacity/transform，并支持 `prefers-reduced-motion` |
| 效率 | `/` 直达搜索、`Esc` 清空退出（已用 CDP 验证：聚焦→筛选 3→1→清空回到 3）；弹层由 320px 放宽到 360px，表单不再挤 |
| 一致性审计 | 收敛为三档圆角（3/8/12）、一支绿（#00642F，hover #00783A）、一条字阶；补齐 `focus-visible`、细滚动条、按钮过渡 |
| 绿色主题 | 侧栏浅绿底（#EFF6F1）、选中项实心绿、主按钮/搜索焦点/卡片图标块统一品牌绿；深色下侧栏转墨绿、选中项用高亮绿 |
| 知识库页 | 表格改卡片网格（图标块 + 名称 + 类型 + 两行描述 + 统计/时间），顶部加搜索框按名称/描述过滤 |
| 顶栏 | 4 个图标收成「来源状态 + 刷新 + ⋯」，设置/模块/诊断进二级菜单；页脚 requestId、后端能力、延迟等技术信息只在降级或失败时出现 |
| 分组 | 导航分「工作区」与「规划中」两组，未接入模块不再和可用功能混排 |
| 视觉 | 去掉大色块横幅与胶囊徽标，圆角收到 6–8px，表头去底色只留细线，数字用等宽对齐 |
| 模块接口 | 新增 `window.__SCHANORA_MODULES__` 注册表，页签 / 模块抽屉 / 占位页同源；契约见 `docs/handoff/PLUGIN-API.md` |
| 模块数 | 交接包 7 张卡 → 6 个注册模块（M0 是基线，本身没有页面）：4 个页签 + M3 详情视图 + M6 跨插件 |
| 会话 | 预览台的两个会话各自持有 scope key，顶部控件的选库互不影响；说明写在对话页上 |

## 三、给 A 的契约偏差（按阻塞程度）

| # | 问题 | 影响 | 建议 |
|---|---|---|---|
| 1 | `parseStatus` 枚举不全：上游还有 `finalizing` / `deleting` / `cancelled` | 前端只能自己兜底，验收时会被问「为什么有未知状态」 | 在 `docs/api.md` 2.3 补齐 7 个值 |
| 2 | `/documents/{id}/chunks` **不透传 `page`/`page_size`**，且 `total` 被 `kb_ok` 丢掉 | 永远只能拿到第 1 页 10 块；UI 只能提示「可能还有更多」 | 透传分页参数，并把 `total/page/page_size` 包进 `data` |
| 3 | 文档列表同样丢 `total` | 列表只能显示「已知 N 条」 | 同上 |
| 4 | 错误没有走 `{code,message,data}`：`HTTPException` 输出 `{"detail": "..."}`，HTTP 状态 502 | 前端要特判两种形状；`code` 拿不到 | 加全局 exception handler + `requestId` |
| 5 | 没有重试/reparse 接口 | 失败文档只能整份重传 | 若上游有 `POST /knowledge/{id}/reparse`，暴露出来 |
| 6 | `/api/v1/models` 需要 `manage_models` 权限，否则 403 | 建库表单拿不到模型就退化成手填 | 文档里标注权限要求，或由网关侧降级为默认模型 |
| 7 | `/health` 仍是配置回显，没有 version/探活 | 状态带只能显示「已连接」，版本显示为空 | M0 遗留项，不阻塞模块 3 |

已对齐的：`code:0` 成功（前端同时兼容 `"OK"`）、camelCase、`knowledgeId` = 文档 `id`、上传字段只用 `file`。

## 四、未验证（不写「通过」）

1. **真实 WeKnora 0.9.0 联调**：本机 8080 没有服务、没有 Go/Docker，只能用假网关验证形状。
2. **DSH 内实装**：profile 已指向本仓库并完成 `pnpm install`（详见 README「装进 DeepSeek Harness」），但**宿主内截图仍待补**；现有截图全部来自 `preview/`（真 bundle + 假宿主）。
3. **上传大文件 / 超时**：未压测；客户端只在 >200MB 时拦一道。

## 五、设计说明

- 主色沿用交接包 tokens：主操作绿 `#006B32`；品牌横幅底色取字标 PNG 实测值 `#00642F`，保证图片与背景无缝。
- Logo 按 `UI_SPEC` 用：`schanora-symbol.png` 缩到 96×96 放在白色圆角板上做插件图标（深色主题可辨）；`schanora-green-white.png` 缩到 480×160 作首页横幅，保留原长宽比、不重绘。
- 为「更简洁」做的一处结构收敛：首页原来三张状态卡合成一条状态带（状态 / 能力 / 延迟 / requestId），细节仍在「诊断」抽屉。
- 尺寸与间距按 `UI_SPEC`：4/8/12/16/24，正文 13px（表格）/14px（正文），表格 13px；宽窗单列居中，<880px 隐藏大小与时间列。
