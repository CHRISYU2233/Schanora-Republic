# Schanora 面板模块接口（v1）

Schanora 客户端插件不再把功能写死在面板里，而是暴露一个注册点。五个模块页签、模块抽屉、未接入占位页都由同一份注册表驱动。

## 一个模块长什么样

```js
window.__SCHANORA_MODULES__.add({
  id: 'm6-wiki',            // 必填，唯一；重复 add 会覆盖
  title: 'mod.wiki',        // 必填，字典键或直接文案
  module: 'M6',             // 可选，交接包编号，只用于展示
  status: 'planned',        // ready | partial | planned
  order: 30,                // 页签顺序，小的在前
  tab: true,                // false = 只是详情视图，不占页签
  icon: MyIcon,             // 可选，React 组件
  requires: ['GET /api/v1/wiki/tree'],
  mount: (ctx) => <YourView {...ctx} />,
});
```

`add()` 返回一个注销函数，插件卸载时调用即可把模块摘掉。

## ctx 里有什么

| 字段 | 说明 |
|---|---|
| `t(key)` | 当前语言的文案；找不到时原样返回 key |
| `snap` | 面板快照：`phase`、`health`、`capabilities`、`kbs`、`error`、`requestId` |
| `settings` | 连接设置（`mode: 'mock' \| 'http'`、`baseUrl`、`timeoutMs`） |
| `kbs` / `loading` | 已规范化的知识库列表与加载态 |
| `onToast({ tone, text })` | 顶部提示条 |
| `onOpenKb(kb)` | 跳到某个知识库的文档视图 |
| `kbId` / `onPickKb(id)` | 文档模块的当前库与切换 |
| `onGotoKb()` | 跳到知识库页签 |

## 交接包卡片 → 注册表

编号以 A 的《模块1-5进度同步》为准：**M4 = 文档检索、M5 = RAG 问答、M6 = Wiki**（此前按「M4 问答 / M5 Wiki」排过一版，已废弃）。

| 卡片 | 注册 id | 界面位置 | 状态 | 缺什么 |
|---|---|---|---|---|
| M0 接入基线 | —（无页面） | 宿主里的入口、主题、连接设置 | 已实现 | 宿主内截图与卸载验证 |
| M1 知识库与选库 | `kb` | 左侧「知识库」页签 | ready | 选库写后端（现在只存本地） |
| M2 OneDrive 与文档 | `docs` | 左侧「文档」页签 | partial | OneDrive / Graph 接收 |
| M3 处理状态与分块 | `doc-detail` | 文档详情抽屉（不占页签） | partial | 分页 `total`、reparse 接口 |
| **M4 文档检索** | `search` | 左侧「检索」页签 | **ready** | 真网关联调（本机只有假网关） |
| **M5 RAG 问答** | `qa` | 左侧「工程问答」页签 | **ready** | 真网关 SSE 联调、超长答案压测 |
| M6 Wiki | `wiki` | 左侧「Wiki」页签 | planned | `GET /api/v1/wiki/tree`、导出 |
| DSH 跨插件互操作 | `interop` | 模块抽屉（不占页签） | planned | MCP `search/read/wiki`、scopeHandle |

未接入模块**不是空白页**：页面上列出它需要的接口，按钮一个都没有，避免看起来像做好了。

## 约束

- 只能用宿主注入的 `react`，不引第三方 UI 库（bundle 里没有打包依赖）。
- 不直连 WeKnora，所有请求走网关 `/api/v1`；API Key 不进入前端。
- 模块自己负责 loading / empty / error 三态，不要用占位数据冒充成功。
- 文案走 `t()`，中英必须成对，`scripts/check-bundle.mjs` 会校验 key 一致性。

## 验证

```bash
node scripts/build-client.mjs      # 生成 client.js
node scripts/check-bundle.mjs      # 槽位、字典、编码、占位符
node scripts/shoot.mjs <chrome> http://127.0.0.1:8124/preview/ docs/evidence/shots-M4M5
```

打开面板右上角「模块」按钮，能看到当前运行时里所有注册模块及其状态——这份列表就是注册表的真实输出，不是写死的。
