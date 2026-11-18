# Schanora

![Schanora](brand/schanora-green-white.png)

**Schanora 是面向工程资料的本地知识库。** 可以在浏览器中独立使用，也可以作为 DeepSeek Harness（DSH）插件安装。适合整理技术规范、工艺文件、试验报告和工程笔记，并从指定知识库中查找依据。两个入口使用同一套本地处理内核和数据格式。

[快速开始](#快速开始) · [日常使用](#日常使用) · [数据目录与-onedrive](#数据目录与-onedrive) · [备份与迁移](#备份与迁移) · [交给-ai-工具配置](#交给-ai-工具配置) · [常见问题](#常见问题)

## 功能简介

| 功能 | 适合做什么 |
| --- | --- |
| 知识库与文档 | 按部门、项目或资料性质建库，上传文件，查看处理状态、抽取内容和文档分块 |
| 检索与引用 | 查找图号、料号、标准号和技术术语，限定查询范围并查看命中的原文片段 |
| 工程问答 | 针对已选资料提问，沿引用查看证据。安装本机模型后可使用生成式回答 |
| Wiki 浏览 | 从已处理的文档中浏览库索引、文档页与主题摘录 |
| 采集与批量导入 | 将网页选段、Markdown 笔记等已获取的正文保存到指定知识库 |
| 数据备份与迁移 | 通过浏览器导出资料和会话，在另一台电脑校验并恢复 |
| OneDrive 共享文件夹 | 将本机数据目录设为已同步的共享文件夹，让团队分发同一份资料 |

**基础模式可离线运行。** Node.js 内核在本机完成文本抽取、分块、关键词检索和带出处的摘录。语义排序及生成式问答需要可用的本机 Ollama 模型。DSH 的主对话和浏览器自动采集依赖相应宿主接口或扩展。

## 快速开始

### 1. 准备环境

- **浏览器版**需要 Node.js 和 Chrome、Edge 等现代浏览器。建议从 [Node.js 官网](https://nodejs.org/en/download)安装 **Node.js 24**。Windows 安装后重新打开终端，让新的 PATH 生效。安装器附带 npm，浏览器版启动所需的 React 文件已随项目提供。
- **DSH 版**需要已经运行过的 DeepSeek Harness，以及该环境用于管理插件依赖的 pnpm。
- 从 GitHub 克隆需要 Git 和仓库访问权限。使用项目 ZIP 时，解压后进入含有 `package.json` 和 `scripts/` 的目录即可。

```bash
git clone https://github.com/CHRISYU2233/Schanora-Republic.git
cd Schanora-Republic
node --version
npm --version
```

在仓库根目录确认能看到 `package.json`、`DESIGN.md`、`scripts/` 和 `web/`。浏览器版无需执行 `npm install`。如果能运行 `node` 但当前环境没有 npm，可以直接执行下文的 Node 命令。

### 2. 启动浏览器版

在项目根目录执行以下命令。

```bash
npm run web
```

也可以直接用 Node 启动。

```bash
node scripts/local-server.mjs --web
```

在终端找到「浏览器」一行并打开给出的完整地址，通常是 `http://127.0.0.1:4317/`。端口被占用时，以启动日志显示的地址为准。页面右上角出现「本地内核已连接」即可使用。终端需保持运行，退出时按 Ctrl+C。

### 3. 用样例熟悉流程

想先试用，再导入正式资料时，使用独立的临时目录。先在一个终端启动服务。

```bash
npm run web -- --root .tmp-browser-demo --port 4326
```

在另一个终端填入上一步的实际地址，导入三份虚构示例文档。

```bash
npm run seed:local -- --base http://127.0.0.1:4326
```

只有 Node 时，分别使用 `node scripts/local-server.mjs --web --root .tmp-browser-demo --port 4326` 和 `node scripts/seed-local.mjs --base http://127.0.0.1:4326`。

打开浏览器进入「知识库」，确认出现「工程标准库」。进入「检索」并选中该库，搜索 `GB/T 3452`，展开命中片段查看出处。再到「问答」选库并开启「深度研究」，询问「O 形圈的压缩率一般取多少？」。有本机对话模型时可生成回答，其余情况下显示带出处的原文摘录。样例仅用于演示流程。

### 4. 安装 DSH 插件

在项目根目录执行预检。将 `desktop` 替换成实际使用的 DSH profile 名称。

```bash
node scripts/install-dsh.mjs --profile desktop
```

确认显示的 profile 和本地插件路径后执行配置。

```bash
node scripts/install-dsh.mjs --profile desktop --apply
```

安装器会备份并更新指定 profile 的 `package.json`。按输出进入该 profile 目录，使用 DSH 随附的 pnpm 或已配置的 `corepack pnpm install` 安装依赖。完全退出并重新启动 DSH，在左侧栏打开「知识库」。进入「设置」查看内核连接状态和实际数据目录。若要回退，恢复安装器打印的备份文件，再安装一次 profile 依赖并重启 DSH。

## 日常使用

### 创建和整理知识库

1. 在「知识库」点击「新建知识库」，填写名称与说明。例如为「装配工艺」和「试验报告」分别建库。
2. 基础关键词检索可使用默认配置。需要向量排序时，在创建时选择已检测到的本机 Embedding 模型。
3. 打开目标库，通过「导入资料 → 上传文件」添加资料。处理结束后，在「文档」查看结果。
4. 打开文档详情，查看处理状态、失败原因和分块。确认能看到原文段落后再问答。
5. 可为文档添加标签并按标签筛选。标签保存在当前浏览器，换浏览器或换电脑时使用文档列表的「导出标签」和「导入标签」。

| 资料类型 | 导入方式 |
| --- | --- |
| Markdown、TXT、CSV、TSV、JSON、YAML、HTML 等 | 直接上传文本。中文文本建议使用 UTF-8 |
| DOCX | 本机抽取正文。关键参数可在分块中核对 |
| 文本型 PDF | 尝试抽取文字。检查表头、单位与特殊字符是否保留 |
| 扫描型 PDF、图片 | 先用 OCR 得到可编辑文字，再上传文本或带文本层的 PDF |
| Excel、CAD 及其他工程二进制文件 | 将需检索的内容导出为 CSV、文本或带文本层的 PDF。保留原件供核查 |

### 检索资料

1. 打开「检索」，选择本次要查的知识库。
2. 输入图号、标准号或工艺关键词。可组合对象与条件，例如「M10 装配 扭矩」。
3. 展开命中，核对文档标题、相关段落和分块。找不到结果时，可缩短问题、换用原文常用术语，或检查资料是否完成处理。

基础检索采用 **BM25**。本机 Embedding 可对关键词召回的候选进行语义重排。因此查工程编号和专有术语时，保留编号原文、单位和具体条件通常更有效。结果分数用于排序，实际设计参数以出处为依据。

### 问答与查证

1. 打开「问答」，新建会话或从列表打开已有会话。
2. 选择知识库范围，再输入问题。例如「试验报告中高温工况的转速和温度分别是多少？」。
3. **普通模式**列出证据。要在 Schanora 面板内生成或保存完整的一轮问答，开启**深度研究**后发送。
4. 点击引用角标或打开引用列表，回到来源片段，核对版本、单位和适用条件。若证据不足，补充相应资料或缩小问题范围。

深度研究在有本机对话模型时生成答案。没有模型时，内核保存问答记录并提供带出处的原文摘录。历史会话保存在数据目录的 `sessions/` 中。

### 采集笔记与网页选段

1. 进入对应知识库，在「导入资料 → 网页与笔记」中选择「Markdown 笔记」或「网页选段」。
2. 填写标题、正文和目标库。已有来源网址时可一并记录。
3. 确认内容后点击「提交入库」，回到文档列表核对处理结果。
4. 有多份 Markdown 笔记时，可使用「批量导入」，逐项查看提交与失败结果。

独立本地版的常用采集方式是粘贴正文或上传已下载文件。「浏览器采集」是扩展接入入口，自动读取页面及网站下载取决于当前环境的浏览器桥接能力。

### 浏览 Wiki

在知识库内切换到「Wiki」。本地内核根据已经处理的文档组织索引页、文档页和主题页。打开主题页可查看原文摘录和来源。刚建立的空库会先显示索引，导入文档后刷新即可查看内容。当前 Wiki 以资料浏览和出处追溯为主。

## 数据目录与 OneDrive

### 使用本机目录

新安装默认使用用户目录下的 `Schanora` 文件夹。已有旧版 OneDrive 数据目录且含有 `schanora.json` 时，内核可继续识别。浏览器版可通过 `--root` 指定数据目录，也可在启动环境中设置 `SCHANORA_ROOT`。

```powershell
node scripts/local-server.mjs --web --root "D:\SchanoraData" --port 4317
```

在 macOS 或 Linux 终端中可指定对应的本机目录。

```bash
node scripts/local-server.mjs --web --root "$HOME/SchanoraData" --port 4317
```

DSH 插件读取宿主进程的 `SCHANORA_ROOT`，也可通过 `schanora-client` 的 `root` 配置指定目录。改动后重启宿主，打开插件「设置」核对实际路径。

### 使用 OneDrive 共享文件夹

1. 让每台电脑同步同一个团队共享文件夹。在 Windows 的 OneDrive 文件夹选项中，将团队资料目录设为「始终保留在此设备上」。
2. 将各台电脑的 Schanora 指向该文件夹在本机的绝对路径。每台电脑盘符和目录名可以不同。
3. 由一台机器负责编写和更新资料，其他成员等待 OneDrive 同步完成后刷新查看。

```powershell
node scripts/local-server.mjs --web --root "D:\OneDrive - 公司\工程共享\Schanora" --port 4317
```

| 数据项 | 位置与迁移方式 |
| --- | --- |
| 知识库清单 | `schanora.json` |
| 已入库文档和元数据 | `kbs/` 中的 Markdown 和 JSON |
| 问答历史 | `sessions/` |
| 采集和任务记录 | `clips/` 与 `jobs/` |
| 关键词索引 | 各机本地重建 |
| 文档标签 | 当前浏览器，通过标签导入导出功能迁移 |

**同一个可写数据目录建议只由一个 Schanora 实例使用。** 浏览器版和 DSH 可错开运行，或者各自指定数据目录。当前版本没有跨机器写锁。深度问答也会写入会话文件。如果同事需要用共享资料问答，同时保留个人会话，可以先将共享库的备份恢复为个人副本，再从副本启动。普通文件复制到共享目录后，还需要通过上传流程纳入知识库。

## 配置本机模型

基础检索随服务启动，资料保存在本地文件中，日常启动无需配置 WeKnora、网关地址或生产数据库。需要生成式回答或语义重排时，先安装并启动本机 Ollama，再准备对应的对话模型与 Embedding 模型。Schanora 默认探测 `http://127.0.0.1:11434`，支持通过 `OLLAMA_HOST` 指定其他本机端口。启动时读取环境变量。

```powershell
$env:OLLAMA_HOST = "http://127.0.0.1:11434"
node scripts/local-server.mjs --web
```

打开实际服务端口的诊断接口。

```powershell
$base = "http://127.0.0.1:4317"
(Invoke-RestMethod "$base/health").data
(Invoke-RestMethod "$base/capabilities").data.features
```

`health` 提供运行模式、版本和数据目录。浏览器版的 `runtime` 为 `web`，DSH 插件内核为 `plugin`。`capabilities` 中的 `chat` 和 `search.vector` 表示本机内核探测到的模型能力。向量排序还需要该知识库配置 Embedding 模型。模型不可用时可继续使用关键词检索和原文摘录。

## 备份与迁移

### 下载备份

浏览器版右上角提供「下载数据备份」。备份包含已经落盘的知识库清单、正文、元数据、会话及采集记录，每个文件都带 SHA-256 校验值。备份前暂停对资料库的写入，可以避免不同的文件读到不同时间点的数据。当前下载备份适用于不超过 64 MB 的数据内容，较大的库可在停止写入后复制整个数据目录。

服务关闭时，也可以用命令导出。

```powershell
node scripts/backup-local.mjs export "D:\SchanoraData" "D:\schanora-backup.json"
```

### 在另一台电脑恢复

1. 将备份文件和 Schanora 安装包复制到目标电脑。
2. 校验备份，再恢复到一个尚不存在的新目录。该目录的父目录需已存在。
3. 启动 Schanora，指定恢复路径。核对库、文档、问答和引用。

```powershell
node scripts/backup-local.mjs verify "D:\schanora-backup.json"
node scripts/backup-local.mjs restore "D:\schanora-backup.json" "D:\SchanoraRestored"
node scripts/local-server.mjs --web --root "D:\SchanoraRestored"
```

恢复前会核对文件路径、格式和内容校验值。现有数据目录可以继续保留。浏览器标签和未入库的原始工程文件需单独迁移。

## 交给 AI 工具配置

可将下面这段话连同本 README 交给 Codex、WorkBuddy 或其他能运行命令的开发工具。

> 请按本 README 配置当前仓库的 Schanora。先核对项目路径、Node 版本和 `package.json`。使用独立临时数据目录启动浏览器版，读取实际启动端口，通过 `/health` 核对 `runtime=web` 和资料路径。导入样例并打开浏览器验证选库、分块、检索和带出处的问答，再验证备份校验与新目录恢复。确认通过后，按我提供的路径配置正式目录。需要安装 DSH 时，请先用安装脚本核对我所用的 profile。交接时请记录已验证的命令、浏览器地址、数据路径，以及 Ollama 或 OneDrive 还有哪些项目待在目标电脑核验。

### 验收命令

构建与基础检查在项目根目录运行。

```bash
npm run build
npm test
npm run check
```

只有 Node 时，分别运行 `node scripts/build-client.mjs`、`node --test test/*.test.mjs`、`node scripts/check-bundle.mjs` 和 `node scripts/check-design.mjs`。

如需运行浏览器验收，先按快速开始启动独立临时库并灌入样例，再运行下面的命令。填入实际端口。脚本需要 Chrome 或 `CHROME_PATH` 指定的 Chromium 系浏览器。脚本会写入临时测试资料与问答记录。

```bash
npm run verify:local -- http://127.0.0.1:4326/
```

只有 Node 时执行 `node scripts/verify-local.mjs http://127.0.0.1:4326/`。Windows 使用 Edge 验收时，可在运行前将 `CHROME_PATH` 设为实际的 `msedge.exe` 路径。

v0.7.0 的已记录验证包括 **68 项 Node 测试**、**8 项浏览器验收**、干净解压后启动、备份恢复，以及 DSH 0.2.2-rc.3 的独立 profile 插件加载。更多细节见[发布验收记录](docs/handoff/CODEX-HANDOFF.md)。

## 常见问题

| 现象 | 建议检查 |
| --- | --- |
| 找不到 `node` | 安装 Node.js 24，关闭并重新打开终端，再执行 `node --version` |
| PowerShell 拒绝执行 `npm.ps1` | 尝试 `npm.cmd --version` 及 `npm.cmd run web`，或使用上述纯 Node 启动命令 |
| npm 找不到 `package.json` | 进入公开仓库根目录。若下载的版本缺少该文件，从更新后的仓库或完整交付包重新获取 |
| 设计检查找不到 `DESIGN.md` | 确认根目录包含设计规范文件。若缺失，补齐该文件再执行 `npm run check` |
| 浏览器打不开 | 保持 Node 启动终端运行，重新复制「浏览器」行的完整地址 |
| 端口和文档示例不一样 | 端口冲突后可能切到后续端口，以实际启动日志为准 |
| 显示空库或旧库 | 检查「设置」和 `/health` 的 `storeRoot`，确认是预期的路径 |
| 选库后仍无检索结果 | 查看文件是否处理完成，先用标题、料号或文档里的关键词试查 |
| PDF 无法分块 | 扫描件或部分特殊编码 PDF 可能无法抽出可用文本，先转换为带文本层的 PDF 或文本 |
| 问答只返回证据或原文摘录 | 检查是否开启深度研究、本机 Ollama 是否有可用对话模型 |
| OneDrive 有文件但列表不更新 | 等待本机同步，核对资料目录后刷新。新增普通文件需要上传入库 |
| DSH 里找不到「知识库」 | 确认安装到正确 profile，依赖已更新，然后完整重启 DSH |
| 备份恢复时提示目标已存在 | 改用一个尚不存在的新目录，确保其父目录已创建 |
| 在 GitHub 页面看到了代码，如何使用 | 克隆或解压项目，按快速开始启动本机 Node 服务 |

## 目录与打包

```text
web/                         独立浏览器入口
plugins/schanora/client/     DSH 插件 Host、前端与本地内核
preview/                     开发预览与演示验收
scripts/                     启动、构建、测试、备份和插件配置
test/                        本地内核与 UI 逻辑回归测试
docs/                        接口文档、交接与验收记录
```

修改 `plugins/schanora/client/src/ui.js` 后通过构建脚本生成 `client.js`。发布前可执行下列命令，生成 `dist/Schanora-frontend/` 交付目录。

```bash
npm run build
npm run pack
```

只有 Node 时使用 `node scripts/build-client.mjs` 和 `node scripts/pack.mjs`。

GitHub 仓库用于发布代码、手册和交付 ZIP。完整浏览器功能由用户本机 Node 服务提供。团队知识库和数据备份通过本机目录或团队共享位置管理。

[MIT 许可证](LICENSE)
