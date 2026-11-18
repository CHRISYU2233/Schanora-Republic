[README1.md](https://github.com/user-attachments/files/35007171/README1.md)
# Schanora v0.7.0 安装、验证与数据迁移

Schanora 是面向工程资料的本地知识库。它支持独立浏览器和 DSH 插件两个入口，两者使用同一份界面代码和文件存储格式。新电脑可以先用浏览器完成全流程验证，再按需接入 DSH。

## 1. 获取代码与检查环境

准备 Git、Node.js 和 Chrome、Edge 或其他支持现代 JavaScript 的浏览器。建议用 **Node.js 24**，可运行产品、单测和有 WebSocket 的浏览器验收脚本。浏览器版核心使用 Node 自带模块，React 静态文件随库提供。浏览器版启动无需先安装 npm 项目依赖。

```text
git clone https://github.com/CHRISYU2233/Schanora.git
cd Schanora
node --version
git status --short --branch
```

获取仓库时使用你在 GitHub 上已有的访问权限。如果拿到的是发布 ZIP，解压后进入含有 `package.json`、`scripts/` 和 `plugins/` 的目录。下文命令从这个目录执行。

## 2. 浏览器版快速启动

```text
npm run web
```

也可以直接用 Node 启动。

```text
node scripts/local-server.mjs --web
```

在终端找到「浏览器」一行，打开它显示的地址，通常是 `http://127.0.0.1:4317/`。端口被占用时会依次尝试后续端口，以实际输出为准。在运行终端按 Ctrl+C 可以关闭。启动命令绑定本机回环地址，其他电脑各自启动自己的服务。

页面右上方应显示「本地内核已连接」。创建一个知识库，上传例如 Markdown 文本，再进入检索页选库并查询。问答页选中知识库后输入问题。需要产生可回看的完整会话时，可在「深度研究」模式下发送。设置中显示当前数据目录并提供打开文件夹的入口。

如果修改了界面源码，先运行 `node scripts/build-client.mjs`，再刷新页面。发布包已经包含构建产物。

## 3. 指定数据目录或 OneDrive

指定目录适用于切换个人资料、团队共享库或恢复后的备份。在 Windows PowerShell 中，路径有空格时使用引号。

```powershell
node scripts/local-server.mjs --web --root "D:\SchanoraData" --port 4317
node scripts/local-server.mjs --web --root "D:\OneDrive - 公司\工程共享\Schanora" --port 4317
```

在 macOS 或 Linux 中使用本机路径。Linux 如果使用共享目录，先由团队现有同步工具将资料同步到该路径。

```bash
node scripts/local-server.mjs --web --root "$HOME/SchanoraData" --port 4317
```

一次执行其中适合自己的命令。没有 `--root` 时，内核读取 `SCHANORA_ROOT`。新安装的默认位置是用户目录下的 `Schanora`。已有旧版 OneDrive 数据目录时，内核可继续识别其中的 `schanora.json`。启动日志和设置页显示最终目录。

每台电脑的 OneDrive 客户端应同步同一个共享文件夹，Windows 建议设为「始终保留在此设备上」。项目以 Markdown 和 JSON 保存资料和会话，检索索引在本机重建。目录中包含 `schanora.json`、`kbs/`，以及使用后产生的 `sessions/`、`clips/` 和 `jobs/`。

团队共享采用一台机器写入，其余同事在同步完成后刷新读取。浏览器版与 DSH 同时使用时，给两者不同的可写目录，或先退出一个再打开另一个。当前版本的 OneDrive 目录没有跨进程或跨电脑的写入锁。同一个共享数据根会同步其中的会话记录。仅想分享资料时，使用独立的团队资料目录，并在自己的个人工作区保存会话。

## 4. 配置本机模型

基础模式只需 Node。BM25 可以进行工程编号及关键词检索，问答可返回来源摘录。希望使用语义检索或生成回答时，可提前安装并运行本机 Ollama，再下载合适的 Embedding 模型或对话模型。

- 内核默认探测 `http://127.0.0.1:11434`。若使用本机其他端口，启动前设置 `OLLAMA_HOST`。地址使用本机回环地址。
- Embedding 模型与对话模型作用不同。创建知识库时选择已检测到的 Embedding 模型，才会用于该库的语义检索。
- 内核根据模型目录判断是否可用。当前对话模型由本机内核从检测到的对话模型中选取。若未识别模型，深度问答仍可输出带出处的摘录。
- 首次安装及下载模型需要网络。已经下载的模型、已同步的 OneDrive 文件及本地索引可离线使用。

在 PowerShell 中检查运行状态。

```powershell
$base = "http://127.0.0.1:4317"  # 改为终端实际显示的地址
(Invoke-RestMethod "$base/health").data
(Invoke-RestMethod "$base/capabilities").data.features
```

`/health` 应返回 `version=0.7.0-local` 和 `runtime=web`。未发现本机模型时 `chat` 或 `search.vector` 可能显示为 false，基础检索仍可用。

## 5. 备份与迁移

在浏览器版点「下载数据备份」。备份包含知识库清单、已落盘的正文与元数据、会话和采集记录。每个文件带 SHA-256 校验值。它包含知识库实际内容，应和原资料一起管理。备份时暂停写入，可以减少备份过程中多份文件对应到不同时间点的情况。

也可在服务关闭时用命令导出，再在另一台电脑校验并恢复。

```powershell
node scripts/backup-local.mjs export "D:\SchanoraData" "D:\schanora-backup.json"
node scripts/backup-local.mjs verify "D:\schanora-backup.json"
node scripts/backup-local.mjs restore "D:\schanora-backup.json" "D:\SchanoraRestored"
node scripts/local-server.mjs --web --root "D:\SchanoraRestored"
```

恢复目录必须尚不存在，父目录需已存在。恢复会先核对文件名、格式和内容校验值，现有数据目录不会被覆盖。下载备份上限为 64 MB 的数据内容，较大的库可在全部写入进程停止后备份整个数据目录。当前内核保存它实际入库的 Markdown 与元数据。另行保存的上游原始 Excel、PDF 或其他二进制附件需要和原资料一起转移。

## 6. DSH 插件配置

已经安装 DSH 的同事可以启用 `@schanora/client`。从仓库根开始，确认实际 profile 名和插件目录。

```text
node scripts/install-dsh.mjs --profile desktop
node scripts/install-dsh.mjs --profile desktop --apply
```

第一条为预检。第二条会备份并更新指定 profile 的 `package.json`。按脚本输出进入该 profile，使用当前 DSH 随附的 pnpm 或已配置的 `corepack pnpm install` 安装 profile 依赖。退出并重启 DSH，在侧栏打开「知识库」，到设置核对所用的数据路径。DSH 从实际启动进程读取 `SCHANORA_ROOT`，或从 `schanora-client` 插件配置读取 `root`。浏览器不读取 DSH profile。

若要从 Windows 已打开的桌面程序切换版本，先退出旧宿主，再执行配置并重启。回退时使用安装器打印的备份，恢复该 profile 的 `package.json` 并重新安装依赖。

## 7. 给 AI 工具的配置任务

可把以下任务连同本文件交给 WorkBuddy、Codex 或其他具备终端能力的工具。

> 在当前仓库按 README1.md 配置 Schanora 浏览器版。先核对 Node、仓库版本与代码目录。用新的临时数据目录启动本机服务，使用日志的实际端口。确认 `/health` 返回 `runtime=web`，调用种子脚本后检查示例库、文档分块和检索。用真实浏览器打开主页，完成选库、采集和带来源的问答。记录实际地址、数据目录、可用模型和验证结果。临时测试通过后，再按我提供的目录连接正式资料。如果需要 DSH，先运行 profile 预检，并根据我指定的 profile 完成配置。请把未验证的步骤与已通过的结果分别列出。

开发验证命令。

```text
node scripts/build-client.mjs
node --test test/*.test.mjs
node scripts/check-bundle.mjs
node scripts/check-design.mjs
```

可以用一个新终端窗口启动临时库，再在另一窗口填入相同的实际端口并运行验收。

```text
node scripts/local-server.mjs --web --root .tmp-browser-verify --port 4326
node scripts/seed-local.mjs --base http://127.0.0.1:4326
node scripts/verify-local.mjs http://127.0.0.1:4326/
```

`verify-local.mjs` 需要本机 Chrome，或将 Chromium 浏览器可执行文件设为 `CHROME_PATH`。这个脚本会创建测试资料和问答，使用临时目录。样例为虚构测试内容。

## 8. 常见问题

| 现象 | 处理 |
| --- | --- |
| 浏览器打不开 | 保持启动终端运行，打开「浏览器」行给出的完整地址。 |
| 打开了旧页面或空知识库 | 对照 `/health` 与设置中的 `storeRoot`，检查是否使用正确端口和目录。 |
| OneDrive 新文件没出现 | 等同步完成并确认文件已经下载到本机，再刷新页面。新增普通文件要通过上传或迁移入口导入。 |
| 无生成回答或语义召回 | 检查本机模型是否运行，核对 `/capabilities` 和新建库时选择的模型。 |
| PDF 没有可读文本 | 本地解析优先读取文本。扫描件先用现有工具做 OCR，再上传可检索副本。 |
| 备份验证失败 | 核对是否下载了完整 JSON，暂停写入后重新导出，或从原目录复制已同步资料。 |
| GitHub Pages 只显示静态网页 | 完整运行需要启动本机 Node 服务。GitHub 可托管源代码和发版 ZIP。 |

## 9. 打包

```text
node scripts/build-client.mjs
node scripts/pack.mjs
```

生成 `dist/Schanora-frontend/`。ZIP 可以用系统压缩工具生成。包内带浏览器入口、DSH 插件、启动和恢复脚本、README1 与验收材料。GitHub 仓库提交源码、构建后的客户端和说明。团队知识库、备份、实测临时目录和个人配置由本机或团队共享目录保存。
