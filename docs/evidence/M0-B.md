# 模块 0 · 证据（B 前端）

日期：2026-11-12　角色：B（@CHRISYU2233）　范围：DSH 客户端插件
状态：**代码与本地验证已完成；真实 DSH 安装与真实网关联调未通过。**

## 1. 环境实测

| 项 | 实测值 | 来源 |
|---|---|---|
| DSH 核心 | `0.2.2-rc.1` | `D:\DeepSeek Harness\resources\app.asar` 内 `@deepseek-ai/dsh-client-*` 包版本 |
| DSH 安装路径 | `D:\DeepSeek Harness` | 进程 `DeepSeek Harness.exe` 正在运行 |
| DSH profile | `C:\Users\ych12\.dsh\profiles\desktop` | 目录实测 |
| 宿主 React | `^18.2.0` | 内置 client 包 peerDependencies |
| Node | `v22.22.2` | `node -v` |
| OS | Windows x64 | — |
| 网关 / WeKnora | **均无服务监听**（8000 / 8080） | `curl` 实测 |

## 2. 宿主接口依据（读源码，不是猜）

| 接口 | 依据位置 |
|---|---|
| `window.__ModuleLoader__.load({id, factory})` + `exports.apply/inject` | `dsh-client-ui-open-in-app/lib/client.js` 文件末尾 |
| `main` 键控槽位用 `key`，侧栏入口用 `id` | `dsh-client-ui-plugin-manager/lib/client.js` 7750 / 7821 |
| `conversation.session.header.utilities` 是 session 作用域 list | `dsh-client-ui-conversation/lib/client.js` 22928 |
| Session 槽位把 `sessionId` 注入 props | 同上 children 声明 + `inject: (sessionId, actions) => ...` |
| 字典必须 zh + en | `dsh-client-locale/README.zh.md`「注册字典」 |
| 主题 token `--dsw-alias-*` | `dsh-client-ui-layout` 主题呈现器说明 |

## 3. 变更文件

| 文件 | 作用 |
|---|---|
| `plugins/schanora/client/src/ui.js` | 唯一界面实现（React `h()`，无 JSX、无构建依赖） |
| `plugins/schanora/client/client.js` | 生成物：loader 包裹后的 bundle |
| `plugins/schanora/client/{package.json,index.js,cordis.patch.yml,icon.svg}` | 插件清单、Host 空入口、插入条目、图标 |
| `preview/{index.html,harness.js,harness.css,vendor/*}` | 本地评审台（真 bundle + 假宿主） |
| `scripts/{build-client,check-bundle,shoot}.mjs` | 构建守卫、无浏览器自检、CDP 截图 |
| `scripts/install-dsh.ps1` | 装进 profile（默认演练，`-Apply` 才写） |
| `docs/handoff/A-TODO-M0.md` | 给 A 的模块 0 待办与契约要求 |
| `docs/evidence/shots-M0/*.png` | 10 张状态截图 |

## 4. 实际执行命令与结果

```text
$ node scripts/build-client.mjs
[build-client] 已生成 plugins\schanora\client\client.js · 55497 bytes · 1461 行

$ node scripts/check-bundle.mjs
  ✓ 无 BOM            ✓ 无乱码          ✓ UTF-8 可解码
  ✓ 注册 module id    ✓ 导出 inject     ✓ 导出 apply
  ✓ 侧栏入口          ✓ 主面板          ✓ Session 头部控件
  ✓ key/id 一致       ✓ zh/en 91 键一致 ✓ 占位符两侧一致
[check] 全部通过 · 3 个槽位注册 · 91 条字典

$ python -m http.server 8124 --bind 127.0.0.1
$ node scripts/shoot.mjs "<chrome>" http://127.0.0.1:8124/preview/ docs/evidence/shots-M0
  ✓ 01-main-light   ✓ 02-main-dark    ✓ 03-diagnostics  ✓ 04-scope-popover-empty
  ✓ 05-scope-selected ✓ 06-session-b-independent ✓ 07-degraded ✓ 08-error
  ✓ 09-english      ✓ 10-narrow
[shoot] 控制台无错误
```

截图覆盖：浅色、深色、诊断抽屉、弹层空态、已选 2 库、Session B 独立（A 选 2 个、B 显示未选）、
上游降级、连接失败、英文、窄窗 860px。

## 5. 本轮抓到并修掉的真实缺陷

1. **中文乱码**：DSH 上一版 `client.js` 把中文写成了 `Mock 婕旂ず` 这种双编码坏字。
   本版在 `build-client.mjs` 里加了乱码/BOM 守卫，命中即拒绝落盘。
2. **token 变量作用域错**：变量只挂在 `.sch-root`，而 Session 头部控件在 root 之外，
   导致弹层背景透明、文字回落到宿主默认色。改为 `.sch-tokens` 独立承载变量。
3. **弹层被视口裁掉**：`left:0` 锚定导致右侧越界。改为右锚 + `width:min(320px,100vw-24px)`。
4. **深色选择器误判**：按属性存在判断，`data-ds-dark-theme="false"` 也进深色。
   改为 `:not([data-ds-dark-theme='false'])`。
5. **能力语义错**：演示数据把未实现能力写成 `false`，界面显示「不支持」。
   改为只上报已知能力，其余显示「未探测」。

## 6. 与合同的差异（需 A 确认）

| 项 | v3 合同 | A 现有实现 | 我的取舍 |
|---|---|---|---|
| 路径 | `/v1/...` | `/api/v1/...` | 知识库用 `/api/v1`（A 已实现）；health/capabilities 用根路径 |
| 成功包裹 | `code:"OK"` | `code:0` | 前端 `unwrap()` 两种都认；建议统一 `"OK"` |
| `Health` | `status/version/checkedAt` | 无此接口 | 按合同渲染，缺字段显示「未实现」 |
| `Capabilities` | `features: map<string,boolean>` | 无此接口 | 缺席=未探测，`false`=不支持 |
| `Kb` | 无文档数字段 | — | 界面不显示文档数，不编造 |

## 7. 未通过 / 未验证

- **DSH 内安装、重启入口不重复、卸载干净**：未执行。需要改 profile 并重启宿主。
- **两个真实 Session 的作用域键**：未执行。界面层证明了「按 sessionId 隔离」，但完整键需要 Host 上报。
- **真实网关 HTTP**：未执行。A 没有 `/health`、`/capabilities`；本机 8000 无服务。
- 窄窗只测到 860px，820px 以下三栏折叠未测。

## 8. 下一模块前置

- A：`/health`、`/capabilities`、统一错误形状、`scripts/fake_weknora.py`（见 `docs/handoff/A-TODO-M0.md`）
- B：DSH 实装截图、卸载验证、把数据源从 mock 切到 http 后复测同样 10 个状态
- 需要用户决定：是否现在写入 profile 并重启 DSH
