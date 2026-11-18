# @schanora/client

Schanora 的 DSH 安装包。Host 入口 `index.js` 启停本机 Node 内核，Client 入口 `client.js` 渲染知识库、文档、检索、问答、采集和 Wiki。数据文件保存在设置中显示的目录。

## 安装与更改数据目录

在目标 DSH profile 中加入 `@schanora/client` 包与 bundle，然后重启 DSH。可在发布仓库根运行 `node scripts/install-dsh.mjs --profile desktop` 查看变更，确认路径后加 `--apply`。

通过 `SCHANORA_ROOT` 或 `schanora-client` 的 `root` 配置指定资料目录。OneDrive 是可选同步位置。共享资料库使用一台写入机，其余机器在同步完成后读取并刷新。

## 开发

`src/ui.js` 是界面源码。`node scripts/build-client.mjs` 生成浏览器 bundle。Host 端 `src/server/` 按模块独立加载。

## 依赖的宿主接口（实测过，不是猜的）

| 接口 | 用法 |
|---|---|
| `window.__ModuleLoader__.load({id, factory})` | bundle 加载入口，`factory(require)` 里 `require('react')` |
| `ctx.slots.register(slot, id, Component)` + `inject` | 三个槽位：`sidebar.panellist`、`main`、`conversation.session.header.utilities` |
| `ctx.locale` | 字典 zh + en 必须齐全（299 条，`check-bundle.mjs` 校验 key 一一对应） |
| `sessionId` prop | Session 作用域槽位注入，用于各会话独立状态 |

依据：DSH 0.2.2-rc.1 内置 bundle 的真实调用，不是文档推测。

## 已知限制

- 选库只写 `localStorage`，不同步到后端。
- 没有 Host 插件，因此没有工具调用、没有服务端 Session 身份校验。
- 真实 DSH 内的截图验收还没做（宿主重启后已确认面板挂载，截图待补）。
- 真实 WeKnora 联调待与 A 约时间；前端已对着假网关跑通真 `fetch` 与真 SSE 解析，
  但真上游的字段取值、断开时机、rerank 行为尚未验证。剩余后端事项见 `docs/handoff/A-NEXT.md`。
- 引用块只在原地展开原文，没有跳到 M3 文档详情（跨模块跳转未做）。
