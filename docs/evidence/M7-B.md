# M7 验收记录 · 输入区贴底 / 设置抽屉 / 插件中心（v0.4.0）

验证环境：无头 Chrome（`--headless=new`），CDP 直连，`file://` 加载预览台，
宿主高度不确定的情况用「把面板丢进普通文档流」模拟（见 §二）。
所有数字都是脚本实测输出，不是目测。

## 一、输入框不再随页面滚动

| 检查 | 方法 | 结果 |
| --- | --- | --- |
| 面板贴合可视区 | 读 `--sch-panel-h` 与 `.sch-panel` 的 rect | 1080×868：`820px`，面板 46 → 866（视口 868） |
| 页面是否可滚 | `scrollHeight > clientHeight` | `false`（修前：面板比视口高约 24px，整页可滚） |
| 滚页面后输入框位置 | `window.scrollTo(0,240)` 再读 composer 的 top | `scrollY 0`，top 不变（`662`） |
| 滚消息流后输入框位置 | `.sch-thread.scrollTop = 0` 再读 | 输入框 top 仍 `662`，消息流自身 `max=1226` |
| 长会话 | 连发 3 轮问答 | 消息 6 条，消息流可滚，页面不滚，输入框不动 |

## 二、宿主高度不确定时的表现

宿主（DSH）的 main 槽没有确定高度，`height:100%` 解不出来是这次问题的根因。
脚本把 `.panel-host` 改成 `height:auto;overflow:visible` 复现：

| 指标 | 修前 | 修后 |
| --- | --- | --- |
| 页面可滚 | 是（面板按内容长高） | 否（`document.scrollingElement.scrollHeight === clientHeight`） |
| 输入框 | 随页面移出视口 | 固定在面板底部 |

## 三、输入区尺寸

| 项 | 修前 | 修后 |
| --- | --- | --- |
| textarea 高度 | 56–60px | 96–240px，随内容自动增高 |
| 字号 / 行高 | 12px / 1.6 | 14px / 1.65 |
| 内距 | 8×10 | 12×14 |
| 缩放 | `resize:vertical`（可拖出可视区） | `resize:none` + 自动增高 |
| 发送按钮 | 30px 高 | 40px 高、20px 内距 |
| 输入区整体 | 约 120px | 约 179px（含范围行与说明） |

实测：输入 30 段文字后 textarea 长到 116px，输入区整体上移，页面仍不滚（`pageScroll:false`）。

## 四、设置（顶栏常驻入口 + 抽屉）

| 检查 | 结果 |
| --- | --- |
| 入口可见 | 顶栏右侧「⚙ 设置」常驻（≤820px 只留图标，`title`/`aria-label` 仍在） |
| 分组 | 连接 / 检索与问答 / 本地插件，三段 |
| 字段 | 数据来源、演示场景、网关地址、API Key、超时、召回条数、引用门槛、两个插件开关 |
| API Key | `password` 类型 + 显示/隐藏切换；`X-API-Key` 头随请求发送；空值不发 |
| 测试连接 | 用草稿里的 key 探测，`finally` 还原全局 key，不因测试而落盘 |
| 保存 | 写 `localStorage['schanora.settings.v1']`，实测 `{"mode":"http","key":"sk-test-123","topK":6,"cov":0.34,...}` |
| 关闭 | 点抽屉外部 / 按 Esc / 右上 ×；点抽屉内部不会关（先修了一个「点内部就关」的回归） |
| 老配置兼容 | `normalizeSettings` 补齐新字段并夹住取值范围（超时 3–120s、条数 1–30、门槛 0–1） |

## 五、插件中心

| 检查 | 结果 |
| --- | --- |
| 卡片数 | 6（本地 2 / 服务端 2 / Agent 侧 2） |
| 状态 | 本地：已启用/已关闭；服务端：需网关启用（演示模式）/ 状态未知（网关无接口）；Agent：DSH 侧 |
| 开关 | 2 个，点击即落盘并刷新 |
| 关掉证据门槛后 | 检索页徽标 18 → 12（覆盖率徽标全部消失，只剩类型徽标），工具栏从「6 个命中 · 4/6 条达引用门槛」变为「6 个命中」 |
| 关掉引用校验后 | 角标退回纯文字上标，不再判越界、不再可点 |
| 假开关 | 无。服务端与 Agent 卡片只有说明，没有点击后不生效的按钮 |

## 六、这一轮顺手修掉的缺陷

| # | 现象 | 根因 | 修法 |
| --- | --- | --- | --- |
| 1 | 新会话发第一句，气泡被清空 | `setActiveId` 触发「拉历史」，mock 新会话返回空列表覆盖了乐观消息 | `freshRef` 标记刚建的会话，跳过那一次拉取 |
| 2 | 流式回答时往上翻会被拽回底部 | 每次 `messages` 变化都无条件 `scrollTop = scrollHeight`（注释写着「已贴底才滚」，代码没做） | 记录 `stickRef`（距底 <80px 才算贴底），只在贴底时跟随 |
| 3 | 切换会话时上一轮的流还在写 | 没有取消，`busy` 也不会复位 | 切会话先 `cancel()` + 清 buffer + `setBusy(false)` |
| 4 | 中文输入法选词回车直接发送 | 只判 `key === 'Enter'` | 加 `isComposing` 与 `keyCode 229` 判定 |
| 5 | 900 / 800 宽度导航压到工具按钮上 | 顶栏两侧 `minmax(0,1fr)` 可缩到 0，中轨 `auto` 不缩 | 两侧 `minmax(auto,1fr)`、中轨 `minmax(0,auto)`；≤1000px 隐藏状态胶囊 |
| 6 | 弹层点外部不关 | 顶栏 `⋯`、设置、会话范围 chip 都只有开没有关 | 统一 `pointerdown` + Esc；抽屉内部点击不误关 |
| 7 | 门槛设成 0 反而回到 34% | `settings.minCoverage \|\| MIN_COVERAGE`，0 被当假值 | 改 `== null` 判断 |
| 8 | 严格模式下文档页整页不加载 | `aliveRef` 只在卸载时置 false，重新挂载后仍是 false | 挂载时置回 true |
| 9 | 引用门槛文案写死 34% | 阈值可配了但文案没跟上 | 去掉写死数字，改「门槛可在设置里调」 |

## 七、回归

- `npm test`：12 条单测通过 + bundle 自检（3 槽位 / 388 条字典）
- `npm run check`：32 token、0 裸色值、字重/圆角/字号全在规范内
- `npm run shots`：31 张截图全部生成，控制台 0 报错（新增 `28-chat-composer`、`29-settings`、`30-plugins`、`31-plugins-dark`）

## 八、仍未验证

- 真网关的 `/api/v1/plugins`（契约是猜的：`items[].id/enabled/status`）；网关一旦提供，卡片状态会自动接上。
- 真实 SSE 下的输入框行为（停止按钮、长回答时贴底）：mock 与真流共用同一套 `finish/handlers`，但没有真网关可压测。
- Safari / Firefox：`overflow:clip`、`field-sizing` 未使用，但 `position:sticky` 在旧 Safari 上的表现没测。
