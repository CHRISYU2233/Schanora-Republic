# Schanora

![Schanora](brand/schanora-green-white.png)

**Schanora 是面向舍弗勒工程团队的知识库工作台。** 在浏览器里建库、导入工程资料、检索、问答和查看 Wiki。GitHub Copilot、Cursor 等 AI 客户端可通过 MCP 使用同一个知识库，DeepSeek Harness 可从插件侧栏打开完整工作台。

[Windows 浏览器版](#windows-浏览器快速开始) · [导入-OneDrive-资料](#onedrive-资料与向量化) · [Copilot-与其他-AI](#接入-github-copilot-与其他-ai-客户端) · [交给-AI-工具配置](#交给-ai-工具配置)

| 使用入口 | 能做什么 | 在哪里运行 |
| --- | --- | --- |
| 浏览器工作台 | 登录、建库、上传、分块核验、检索、问答、Wiki | 本机 Schanora 服务，Edge、Chrome 等浏览器访问 |
| GitHub Copilot CLI / VS Code Copilot | 在当前会话按库检索技术资料、读原文并引用 | 同一台电脑的本地 Copilot 会话，经 MCP |
| Cursor、Claude Code、其它支持 Streamable HTTP 的 AI 客户端 | 使用同一 MCP 端点查询 | AI 客户端所在环境必须能访问端点 |
| DeepSeek Harness | 侧栏打开工作台，在任意会话用工具查库、检索、问答 | 本机 DSH profile |
| GitHub.com Copilot 云代理 | 可配置组织部署的 HTTPS MCP | 需单独提供云端可访问且经过批准的端点 |

## Windows 浏览器快速开始

### 安装与打开

1. 在 Windows x64 上准备 Node.js 24。可安装 [Node.js 官方发行版](https://nodejs.org/en/download)，也可将单位批准的便携版解压到本地。运行 `node --version` 确认可用。
2. 下载当前仓库并解压到本地目录，或者用 Git 克隆。Windows 浏览器版只需 Node.js 和运行时包。Windows x64 包由上游固定版本构建，包含第三方许可。
3. 打开 PowerShell，在仓库根目录运行下面的命令。安装器会下载约 89 MB 的运行时、校验固定的 SHA-256，并解包到 `runtime/weknora-0.9.0`。已有完整安装会直接复用。

```powershell
git clone https://github.com/CHRISYU2233/Schanora-Republic.git
Set-Location Schanora-Republic
node --version
powershell.exe -NoProfile -File .\scripts\install-weknora.ps1
.\open-schanora.cmd
```

也可以从 [GitHub 源码 ZIP](https://github.com/CHRISYU2233/Schanora-Republic/archive/refs/heads/main.zip) 开始。解压后进入带有 `open-schanora.cmd` 的目录，执行上述后两条命令。能联网但自动下载受限时，从 [运行时 Release](https://github.com/CHRISYU2233/Schanora-Republic/releases/tag/weknora-lite-0.9.0-windows-x64) 下载运行时包，然后运行

```powershell
powershell.exe -NoProfile -File .\scripts\install-weknora.ps1 -Archive 'D:\Downloads\WeKnora-Lite-0.9.0-windows-x64.zip'
.\open-schanora.cmd
```

默认浏览器地址是 [本机 Schanora](http://127.0.0.1:8080/schanora/workspace.html)。启动后保留终端窗口。下次可以双击 `open-schanora.cmd`，服务就绪后会打开浏览器。终端按 Ctrl+C 停止服务。工作台登录沿用已有账号，启用了本地注册的实例可在 Schanora 登录页点「创建账号」。

```powershell
# 端口被别的程序占用时使用备用端口
.\open-schanora.cmd --port 8088
# 新部署时选择专用本地数据库路径
.\open-schanora.cmd --root 'D:\SchanoraData\weknora'
# 隔离试用，在临时目录运行，使用独立端口
.\open-schanora.cmd --demo --port 18080
# 检查常用实例是否启动
Invoke-RestMethod http://127.0.0.1:8080/health
```

端口和资料目录分别用来访问服务和保存数据。升级时用旧部署的 `--root` 和端口，账号、知识库及配置才会接上。默认数据目录是 `%USERPROFILE%\Schanora\weknora-0.9.0`。便携 Node 未加入 PATH 时，在启动前设置 `$env:SCHANORA_NODE = 'D:\Tools\node-v24-win-x64\node.exe'`，路径填实际位置。双击方式需要 Node 可由启动器找到。

## WeKnora v0.9.0 接入

运行时固定为官方 [v0.9.0](https://github.com/Tencent/WeKnora/releases/tag/v0.9.0)，提交 `f17ee8a8da901bd658a4cb25f40b5fd41adbfdd7`。Lite 使用本机 SQLite、FTS5 和 sqlite-vec。浏览器直接连接 WeKnora，DSH 也调用同一实例的 API。文档处理、混合检索、引用和 Wiki 由 WeKnora 实现。Lite 支持的解析引擎与协作功能见[官方版本说明](https://github.com/Tencent/WeKnora/blob/v0.9.0/docs/LITE.md)。

### 准备运行时

Windows x64 优先使用上面的运行时包。需要从源码复核或自建运行时，可在独立目录从官方 v0.9.0 构建服务和前端。构建需要 Go 1.26、64 位 MinGW-w64 POSIX/UCRT、Node.js 和 npm，以及能下载构建依赖的网络。

```powershell
git clone --branch v0.9.0 --depth 1 https://github.com/Tencent/WeKnora.git
Set-Location WeKnora
git rev-parse HEAD
go mod download github.com/mattn/go-sqlite3
$sqlite = (go mod download -json github.com/mattn/go-sqlite3 | ConvertFrom-Json).Dir
$include = New-Item -ItemType Directory -Force .schanora-include
Copy-Item (Join-Path $sqlite 'sqlite3-binding.h') (Join-Path $include.FullName 'sqlite3.h')
$env:CGO_ENABLED = '1'
$env:CGO_CFLAGS = '-I"' + $include.FullName.Replace('\', '/') + '"'
$env:CGO_LDFLAGS = '-lwinpthread'
$prefix = 'github.com/Tencent/WeKnora/internal/handler'
go build -tags sqlite_fts5 -ldflags "-s -w -X ${prefix}.Version=0.9.0 -X ${prefix}.Edition=lite -X ${prefix}.CommitID=f17ee8a8da901bd658a4cb25f40b5fd41adbfdd7" -o WeKnora-lite.exe ./cmd/server
npm.cmd --prefix frontend ci
npm.cmd --prefix frontend run build
Copy-Item frontend/dist web -Recurse
```

如链接时提示找不到 `-lrstrtmgr` 或 DuckDB 的 C++ 符号，使用新版 MinGW-w64 POSIX/UCRT 工具链。完成后，运行时目录应包含 `WeKnora-lite.exe`、`web/index.html`、`config/config.yaml` 与 `migrations/sqlite/`。

### 启动工作台和配置模型

把准备好的运行时放在项目的 `runtime/weknora-0.9.0/` 目录。Windows 从 Schanora 根目录运行 `.\start-web.cmd`，有 npm 时也可运行 `npm run web`。运行时在其他位置时可以指定绝对路径。验收时加 `--demo` 使用系统临时数据目录。

```powershell
node scripts/start-weknora.mjs --runtime 'D:\Work\WeKnora-0.9.0' --demo
```

打开启动时显示的 Schanora 工作台地址。使用 Schanora 登录页登录已有账号，或在实例允许时注册。「管理控制台」提供账号、数据源和 Wiki 高级设置。

1. 打开 Schanora 顶栏的「设置 → 模型与 API Key」，在「模型配置」里选择「添加模型」。选好用途（对话、Embedding 或 Rerank）和服务商，填写服务商提供的模型 ID。
2. 用 DeepSeek 官方对话接口时，在「服务商 API Key」粘贴 DeepSeek 密钥，Base URL 留空时使用官方地址。使用兼容接入点时，填写服务商给出的 Base URL 和所需密钥。Embedding 还需要填写模型的输出维度。选择本机 Ollama 时，填写已拉取的模型名，连接使用 WeKnora 服务的 Ollama 配置。
3. 点「保存并测试」。保存成功后会立刻用固定示例调用该模型。若配置保存成功但试调失败，页面会分别说明保存和测试状态。更换密钥时，在「模型配置」选已有的远程模型，填入新的服务商 API Key，再点「保存并测试」。需要重新检查已保存配置时可单独点击「测试模型」。添加模型、换密钥和测试需要管理员权限。
4. 新建知识库时选择对应的 Embedding 模型。普通问答的对话模型在输入框上方直接选择，使用「模型 · 自动」时由内核按当前问答配置选取。切换对话模型会生效于下一次发送。智能体用其自身配置的对话模型和 Rerank。「资料范围」展开后的「智能体」可切换到已配置的智能体。

建库后可以上传文档、查看状态与分块，并指定库检索和提问。库内的 Wiki 标签读取 WeKnora 已有页面。生成式 Wiki 需要给目标库开启 Wiki 索引并配置生成模型。日常使用时可直接使用默认数据目录，也可用 `--root 'D:\SchanoraData\weknora'` 指定一个专用目录。

浏览器里的单库文档页支持上传文件、导入本地文件夹、查看处理阶段和分块。文件夹导入保留相对目录。解析失败时可进入文档详情点「重新解析」，重新处理原文件并沿用文档记录。已有问答和引用会作为历史保留。新会话的内置提示词会以 Schanora 介绍身份，自定义智能体可在管理控制台设置自己的系统提示词。

### 工程工作台的功能入口

| 日常任务 | 在 Schanora 中完成 |
| --- | --- |
| 按项目和设备建立资料库 | 「知识库」新建文档库，选 Embedding。从库页「索引设置」打开该库高级设置，配置分块和检索策略 |
| 导入技术文件和核验质量 | 单库「文档」上传文件或文件夹，核对相对路径、处理状态、失败原因和实际分块 |
| 查标准号、设备号、故障代码或技术要求 | 「检索」选择目标资料库并查看命中的原文。跨库提问可用「问答」自动范围 |
| 形成可复核的答复 | 「问答」直接选对话模型，点引用查看片段。「下载引用」保存回答、文档与已有分块 ID 及引用原文 |
| 浏览库内知识总结 | 单库「Wiki」浏览页面和来源，开启 Wiki 索引及生成模型后处理上游资料 |
| 管理模型和对接其它 AI | 「设置 → 模型与 API Key」和顶栏「连接 AI」 |

账号、数据源和索引高级选项走管理控制台。IM、嵌入渠道、浏览器自动化等通用模块由原生控制台管理，工程资料查阅的主导航集中在知识库、检索和问答。

### 在工作台提问

1. 打开「问答」，输入问题后按 Enter。默认检索当前账号可用的全部知识库。没有知识库时，直接调用对话模型。
2. 需要缩小范围时，点击输入框上方显示当前范围的按钮，点选一个或多个知识库。浏览器会记住这组选择。点「自动」恢复全部可用库，点「直接问模型」可切换到模型问答。
3. 使用智能体时，从资料范围按钮进入「智能体」。可以选用已配置的智能体，也可以点击「管理智能体」配置对话模型、知识检索和工具。启用了知识检索（`search_knowledge`）的自定义智能体需要绑定 Rerank 重排模型。选择「自动」时，智能体使用其配置的资料范围。
4. 智能体回答会流式显示，同时列出本轮调用的工具和返回的知识库引用。点击「停止」会向 WeKnora 请求停止本轮生成。遇到需要确认、授权或补充输入的情况，点击回答下方的「打开 WeKnora 会话」继续，完成后刷新 Schanora 查看最新记录。

例如，可以在「设备维修手册」和「工程变更」两个库中选定范围，再请智能体核对某型号设备的保养周期，列出处并标注资料版本。工具和模型由 WeKnora 管理，模型能否完成多轮工具调用取决于它所支持的能力。

## OneDrive 资料与向量化

### 数据在哪一层

```text
OneDrive 云端共享资料
  → OneDrive 客户端同步到本地文件夹
  → Schanora 读取同步副本并送入指定知识库
  → WeKnora 解析 → 分块 → Embedding → 本机向量索引
  → 用户提问 → 混合检索 → Rerank（已启用时）→ 对话模型生成带引用的回答
```

固定的 WeKnora v0.9.0 源码列出了 OneDrive 类型，但该版本尚未注册可用的 OneDrive 直连器。Schanora 通过 OneDrive 桌面客户端读取已经同步的文件。OneDrive 是源资料的共享位置，本机库负责生成和保存向量。若期望几台电脑同时看到同一份已建好的索引，让它们访问同一个授权部署的服务。每台电脑独立部署时，各自从相同的 OneDrive 源建立索引。

### 配好模型和知识库

1. 在 Schanora「设置 → 模型与 API Key」分别添加对话、Embedding、Rerank。记录服务商的模型 ID、Base URL 和 Embedding 输出维度。密钥填在对应的保存表单，保存后逐个点「测试模型」。
2. 新建一个文档知识库，在编辑页面确认选中了 Embedding 模型，在索引策略中启用向量检索。工作台简化表单没有显示高级设置时，从「管理控制台」进入该知识库的设置。
3. 在普通问答或目标智能体的检索配置中绑定 Rerank 模型。部署先用一个小库验证 Embedding 和检索，随后再开启 Rerank 比较前几条命中。改用不同 Embedding 模型或向量维度后，按目标库的索引设置重建，已有文件也需重新生成向量。

| 模型 | 执行时机 | 可观察的结果 |
| --- | --- | --- |
| Embedding | 导入时计算分块向量，查询时计算问题向量 | 文件处理完成并能用换一种说法的问题检索到 |
| Rerank | 召回后给候选片段重排 | 最相关的章节或现行文件更靠前，返回数量可随检索设置变化 |
| 对话模型 | 根据检索证据组织回答 | 给出答案，能沿引用打开原文 |

### 首次导入

在 Windows OneDrive 客户端完成公司账号登录，将目标共享目录同步到文件资源管理器，右键选「始终保留在此设备上」。等目录和待导入文件显示完成同步后再开始。用浏览器时，进入目标库的文档页，点击「导入文件夹」，选择本机 OneDrive 下的目录并确认。文件进入处理队列后，可查看解析状态和分块。扫描 PDF 请先用当前部署支持的 OCR 或文档解析方案跑一个样本。

### 后续增量导入

指定一个已完成模型配置的知识库，从「管理控制台 → 设置 → 发布与集成 → API」创建仅覆盖它的 API Key，勾选 `retrieve` 和 `ingest`。从该库详情页复制库 ID。导入脚本使用的 API Key 与 MCP Token、模型 API Key 各自独立。

```powershell
$folder = 'D:\OneDrive - 公司名\Engineering\Work Instructions'
$kb = '填写真实知识库ID'
$base = 'http://127.0.0.1:8080'

# 预览只读源目录与本地同步记录
node scripts/sync-onedrive.mjs --folder $folder --kb $kb --base $base

# 在 PowerShell 7 中隐藏输入，密钥只进入当前进程环境
$env:WEKNORA_API_KEY = Read-Host '知识库导入 API Key' -MaskInput
try {
    node scripts/sync-onedrive.mjs --folder $folder --kb $kb --base $base --apply
    node scripts/sync-onedrive.mjs --folder $folder --kb $kb --base $base --status
} finally { Remove-Item Env:WEKNORA_API_KEY -ErrorAction SilentlyContinue }
```

- 脚本递归扫描常见办公文档和文本，跳过隐藏文件、Office 临时文件和符号链接。默认限制单文件 50 MiB，服务端上限也需允许。同步时先读取完整文件，用 SHA-256 判断是否变化，再提交原生上传接口。
- 执行结果用 JSON Lines 输出。 `submitted` 表示上传被接收，`--status` 显示实际解析状态。文件名、相对路径、文档 ID 和历史版本 ID 记录在本机 `%USERPROFILE%\Schanora\onedrive-sync`。可用 `--state` 指定同步目录以外的本地文件。
- 修改后的文件作为新版本提交，输出中的 `previousIds` 是之前的文档。确认新版处理完成后，由资料管理员按公司版本规则归档旧文档，避免问答同时命中新旧内容。若云端移动或删除源文件，脚本会报告 `source-missing`，库内资料由管理员处理。
- 重跑同一条命令可继续导入新文件和失败后尚未记录的文件。已经接收但解析失败时，修正模型或文件问题后在文档详情点击「重新解析」。同步记录锁防止同一配置并发写入。
- 最后用文档中的独特术语和一条同义问法分别检索。打开命中项，核对原文、版本和分块。OneDrive 暂未下载的文件需先完成同步，工作台无法解析仅有云端链接的文件。

## 接入 GitHub Copilot 与其他 AI 客户端

### 创建共用 MCP 端点

1. 启动 Schanora，在工作台顶栏点击「连接 AI」。会打开本机的 MCP 服务设置。需要管理员创建端点。
2. 新建名为 `schanora-engineering` 的端点，指定要开放的工程知识库，勾选 `list_knowledge_bases`、`search_knowledge`、`grep_chunks` 和 `read_document`。可按需补 Wiki 读取工具。希望调用内核智能体生成完整答案时，再启用 `ask` 并绑定该端点的默认智能体和对话模型。日常 Copilot 使用上述检索工具，即可由 Copilot 自己组织答案。
3. 保存并复制完整端点 URL 和一次性显示的 MCP Token。地址应形如 `http://127.0.0.1:8080/mcp/实际端点ID`。每个端点维护自己的工具、知识库范围与限流。
4. 验证成功后再打开 AI 宿主。更换端口后同步改端点 URL，更换 Token 后同步改宿主的凭据。

```powershell
$url = 'http://127.0.0.1:8080/mcp/填写实际端点ID'
$env:SCHANORA_MCP_TOKEN = Read-Host 'Schanora MCP Token' -MaskInput
node scripts/check-mcp.mjs --url $url
```

看到工具表和 `MCP list_knowledge_bases is callable.` 就说明协议和凭据已经通过。接下来让 AI 实际完成「查库 → 查词 → 读一段原文」。

### GitHub Copilot CLI 和 VS Code 的 Copilot 本地会话

使用 [Copilot 原生配置模板](integrations/copilot-cli.mcp.example.json)，将 `mcpServers.schanora` 合并到个人 `~/.copilot/mcp-config.json` 的 `mcpServers`。文件不存在时可从模板新建。使用自定义 `COPILOT_HOME` 时改用该目录。把 URL 替换为实际值，保留模板对 `${SCHANORA_MCP_TOKEN}` 的引用。在已设置该变量的终端启动 `copilot`，用 `/mcp list` 或 `/mcp show schanora` 检查状态。

VS Code 的 Copilot 本地会话也优先使用这份原生配置。通过命令面板打开 `Chat: Open Customizations`，在 Copilot Global 的 MCP Servers 核对服务器。启动 VS Code 的进程也要拿到变量。可以在设置变量的终端运行 `code .`，如果旧 VS Code 进程仍在运行，先关闭后再启动。仍使用编辑器管理型 Local 会话的环境，可在个人 MCP 设置中合并 [VS Code 编辑器模板](integrations/vscode.mcp.example.json)，由编辑器启动时询问 URL 和 Token。[Copilot CLI 文档](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-mcp-servers) · [VS Code MCP 配置](https://code.visualstudio.com/docs/agents/reference/mcp-configuration)

### Cursor、Claude Code 与其它客户端

- **Cursor** 可在个人 MCP 配置中合并 [通用 HTTP 模板](integrations/http.mcp.example.json)，填入实际 URL 和 Token，也可在宿主界面添加 Streamable HTTP 服务和 `Authorization` 请求头。
- **Claude Code** 可从「连接 AI」所在的管理页复制为该端点生成的 Claude Code 配置。建议使用个人配置范围，在本机完成设置。
- **其它客户端** 选择 Streamable HTTP，填写端点 URL 和请求头 `Authorization: Bearer 你的MCP令牌`。只有 stdio 的客户端可按管理页提供的桥接示例配置。先验证原生 HTTP 端点，再安装桥接作为可选依赖。
- 在宿主的工具面板启用 Schanora，然后问「使用 Schanora 在工程资料库中检索 SOP-113。先找文档，再读对应片段，给出文件标题、版本和引用。没有证据时说明缺少哪份资料。」

### GitHub.com Copilot 云代理

云代理运行在 GitHub 环境。若公司提供了可从云代理访问的 Schanora MCP HTTPS 服务，通过仓库 `Settings → Copilot → Cloud agent` 的 MCP 配置添加远程 HTTP 服务。把专用低权限令牌保存到 GitHub 的 Agents secrets，例如 `COPILOT_MCP_SCHANORA_TOKEN`，配置中引用变量。选择只读工具，并用测试库完成首次验收。本机启动脚本仅绑定回环地址，用于本机浏览器及本机 AI 客户端。[GitHub 云代理 MCP 设置](https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/configure-mcp-servers)

### 故障定位

| 现象 | 检查 |
| --- | --- |
| 浏览器无法连接 | 确认终端仍在运行，访问 `/health`，核对端口和本机运行目录 |
| MCP 返回 404 | 使用包含真实端点 ID 的 `/mcp/...`，确认在同一台服务中创建且启用了端点 |
| MCP 返回 401 / 403 | 检查 Bearer Token 是否对应当前端点，确认启用状态、库范围及工具权限 |
| MCP 已连接却查不到资料 | 用客户端先调用 `list_knowledge_bases`，检查端点允许访问的库，再回浏览器核对解析和分块 |
| 模型下拉只有「自动」 | 先添加并测试类型为「对话」的模型，保存后返回问答 |
| 找不到已上传版本 | 运行 `--status`，先看文件是否处理完成，再看库是否启用了向量检索以及模型是否可用 |

## 交给 AI 工具配置

把以下内容和此仓库的 GitHub 链接发给能操作本机终端的 AI 工具。账号密码和各类 Token 在对应本机界面或隐藏输入中填写。

```text
请部署 CHRISYU2233/Schanora-Republic 的 main，按仓库 README 的最新版流程执行。
1. 识别 Windows 架构、Node 版本、浏览器和现有部署。记录本机端口及数据目录。
2. 对干净的 Windows x64 部署，通过 scripts/install-weknora.ps1 安装并校验运行时。
   在独立端口使用 --demo 验收。启动后检查 /health、Schanora 工作台和品牌登录页。
3. 正式启动要复用已有端口和数据目录。确认同一端口没有其它服务占用。
4. 如需 OneDrive，先确认本机同步的实际目录。请我在 Schanora 中配置并测试模型，
   创建文档库并启用向量检索。用一份合成文档预览、导入和验证分块，再处理正式资料。
5. 如需 Copilot，先在工作台「连接 AI」创建指定库的只读 MCP 端点。
   请我填写 MCP Token。在本机运行 scripts/check-mcp.mjs，按实际宿主合并配置，
   保留原有 MCP 条目。启动后从会话调用 list_knowledge_bases、search_knowledge、read_document。
6. 回报运行地址、端口、实际资料目录、MCP 的连接状态和合成资料的入库及检索结果。
   只有应用本身与宿主各自验证通过，才把该使用场景标为完成。
```

### 在 DSH 会话引用同一知识库

使用单独的 DSH profile 先验收。将下例中的 `desktop` 改为要配置的 profile。第一步打印预检结果，第二步写入依赖并自动备份该 profile 的 `package.json`。

```powershell
node scripts/install-dsh.mjs --profile desktop
node scripts/install-dsh.mjs --profile desktop --apply
```

按脚本提示在该 profile 目录执行 `pnpm install`。在 WeKnora 界面为 DSH 创建可访问目标库的 API key，启用检索权限，调用问答工具时另需对话权限。给 DSH 启动进程设置 `WEKNORA_BASE_URL` 和 `WEKNORA_API_KEY`，地址填写同一个本机服务，如 `http://127.0.0.1:8080`，密钥通过当前进程的环境或 DSH 的私有配置提供。在 DSH 的 Schanora 侧栏点击「打开 Schanora 工作区」，窗口会打开浏览器的完整工作区。在任意会话用 `weknora_list_knowledge_bases` 查库 ID，把选择的 ID 作为 `knowledge_base_ids` 传给 `weknora_search` 或 `weknora_ask`，可用 `weknora_read_document` 回查命中的 `knowledge_id`。[官方 DSH 插件文档](https://github.com/Tencent/WeKnora/blob/v0.9.0/packages/dsh-weknora/README.md)

要从 DSH 调用智能体，先在 Schanora「问答」选中智能体并点「复制智能体 ID」。在 DSH 会话中指定调用 `weknora_ask`，把复制的值传给 `agent_id`，并传入目标库的 `knowledge_base_ids`。如需为某个 DSH profile 设定默认智能体，将该 ID 写入其启动环境的 `WEKNORA_AGENT_ID`。单次调用传入的 `agent_id` 优先。

### 迁移现有资料

先用原版 Schanora 导出备份，保留原始文件，再将文档上传到新建的 WeKnora 知识库重新建索引。两个版本使用各自的存储格式和文档 ID。OneDrive 适合分发源资料。各电脑的运行中 SQLite 应放在各自的本地目录，避免文件同步过程中出现不一致状态。需要备份此实例时，先停止服务，再将数据目录整体复制到私有备份位置，其中的 `.weknora-secrets.json` 用于解密该实例的模型凭据等数据。部署时通过环境指定的密钥也需跟随实例保存。

### 本机验收

Windows 运行了从官方标签编译的 WeKnora Lite，登录后经 `/api/v1/system/info` 核对版本和提交。向原生上传接口提交合成工程文档，核对处理状态、分块与指定库检索。用独立的 DSH 配置启动真实会话，验证官方工具拿到同一个 WeKnora 文档 ID 和原文片段，再通过官方 `ask` 客户端核对问答引用包含该 ID。验收用本机固定响应的模型替身覆盖接口链路，企业模型的生成效果和 Wiki 自动生成需要接入实际模型后复验。

智能体验收使用同样隔离的资料目录和测试模型。在浏览器选择自定义智能体和知识库，核对模型调用检索工具、回答流式显示、引用展开原文、刷新后恢复引用，以及停止请求。再在真实 DSH 会话中向 `weknora_ask` 显式传入同一智能体 ID，核对返回内容引用同一分块。

## 原版 Node.js 指南

[快速开始](#快速开始) · [日常使用](#日常使用) · [数据目录与-onedrive](#数据目录与-onedrive) · [备份与迁移](#备份与迁移) · [原版迁移验收](#原版迁移验收) · [常见问题](#常见问题)

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

- **浏览器版**需要 **Node.js 24**（推荐）和 Chrome、Edge 等现代浏览器。启动、导入样例和验收都可以直接使用 Node.js。浏览器所需的前端文件随项目提供，无需 `npm install`。
- **DSH 版**需要已经运行过的 DeepSeek Harness，以及该环境用于管理插件依赖的 pnpm。
- 推荐首次部署时将 [main 的完整 ZIP](https://github.com/CHRISYU2233/Schanora-Republic/archive/refs/heads/main.zip) 解压到一个新建目录。也可以用 Git 克隆。已有工作区如果有未提交改动，保留它并另建副本即可继续部署。

```bash
git clone https://github.com/CHRISYU2233/Schanora-Republic.git
cd Schanora-Republic
node --version
```

在仓库根目录确认能看到 `package.json`、`DESIGN.md`、`start-web.cmd`、`scripts/` 和 `web/`。下载 ZIP 后如果外层目录还有一层 `Schanora-Republic-main`，进入内层再执行命令。

### 2. Windows 找不到 Node 或 npm 时

在 PowerShell 运行 `node --version`。只要 Node 可运行，就可继续下一步。推荐使用 [Node.js 官网](https://nodejs.org/en/download)提供的 Node.js 24，安装后关闭并重新打开终端再检查。

也可以使用企业允许的便携版。从 [Node.js 24 Windows 官方下载目录](https://nodejs.org/dist/latest-v24.x/)选择与电脑匹配的 ZIP（x64 或 ARM64），将其解压至本机目录。在当前 PowerShell 为启动器指定实际路径即可，无需修改系统 PATH。

```powershell
$env:SCHANORA_NODE = 'C:\Tools\node-v24-win-x64\node.exe' # 改成实际解压路径
& $env:SCHANORA_NODE --version
```

如企业电脑限制运行或安装 Node.js，请使用 IT 提供的可用运行时。拿到可执行文件后可直接使用上面的路径方式。

### 3. 一条命令启动演示

在项目根目录使用 Node 启动原版演示。

```bash
node scripts/local-server.mjs --demo --port 0
```

启动器会在系统临时目录里新建一个 `schanora-demo-*` 数据目录，并自动导入三份虚构示例文档。演示模式使用独立目录，即使环境中已设置 `SCHANORA_ROOT` 也可以运行。每次启动产生一份新的演示数据，退出后可以保留或清理日志所示的演示目录。 `--port 0` 让系统挑选可用端口。

终端显示「本地内核已启动」后，打开「浏览器」一行给出的**实际地址**。保持终端运行，退出时按 Ctrl+C。可在另一个 PowerShell 中检查服务，用实际端口替换示例值：

```powershell
$base = 'http://127.0.0.1:4326' # 改成「浏览器」行的实际地址
(Invoke-RestMethod "$base/health").data
```

确认 `runtime` 为 `web`，`storeRoot` 指向本次新建的 `schanora-demo-*` 目录。打开「知识库」确认出现「工程标准库」。在「检索」选中该库并搜索 `GB/T 3452`，展开命中查看出处。到「问答」选库后开启「深度研究」，询问「O 形圈的压缩率一般取多少？」。有本机对话模型时可生成回答，其余情况下显示带出处的原文摘录。样例仅用于演示流程。

### 4. 启动日常使用的浏览器版

各平台均可直接运行：

```bash
node scripts/local-server.mjs --web
```

通常使用 `http://127.0.0.1:4317/`。初次打开或更换数据目录时，参考[数据目录与 OneDrive](#数据目录与-onedrive)，通过 `--root` 指定资料目录并在页面设置里核对实际路径。若已配置 npm，`npm run web:legacy` 也可启动原版。

### 5. 安装 DSH 插件

在项目根目录执行预检。将 `desktop` 替换成实际使用的 DSH profile 名称。

```bash
node scripts/install-dsh.mjs --legacy --profile desktop
```

确认显示的 profile 和本地插件路径后执行配置。

```bash
node scripts/install-dsh.mjs --legacy --profile desktop --apply
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

## 原版迁移验收

要从原版导出及迁移时，可以将下列验收任务交给能操作终端的 AI 工具。

> 请按这份 README 在本机验收原版 Schanora，以便导出现有资料。先在独立目录检查 Node，运行 `node scripts/local-server.mjs --demo --port 0`。读取实际地址，通过 `/health` 核对 `runtime=web` 和演示数据目录。检查样例知识库、分块、检索、带出处的问答，以及备份校验和恢复。分别报告源码准备、服务启动和功能验收结果。

### 验收命令

浏览器初次启动可以直接使用仓库自带的构建产物。若要验收源码，在独立副本的项目根目录运行以下命令。如果 Node 未加入 PATH，在当前 PowerShell 设置 `SCHANORA_NODE`，将每条命令开头的 `node` 改为 `& $env:SCHANORA_NODE`。

```bash
node scripts/build-client.mjs
node --test test/*.test.mjs
node scripts/check-bundle.mjs
node scripts/check-design.mjs
```

如需运行浏览器验收，保持演示服务运行，在第二个终端进入同一项目根目录，填入启动日志中的实际地址。验收脚本会写入测试资料与问答记录，请使用演示实例。

```bash
node scripts/verify-local.mjs http://127.0.0.1:4326/
```

脚本自动查找常见路径下的 Chrome 或 Edge。其他安装位置可以通过 `CHROME_PATH` 指定，例如 Windows 的 `$env:CHROME_PATH = 'C:\实际安装目录\msedge.exe'`。如果 Node 未加入 PATH，在第二个终端设置 `SCHANORA_NODE` 后将命令开头的 `node` 改为 `& $env:SCHANORA_NODE`。浏览器验收以「通过 8/8、失败 0、缺项 0」为完成标准。最后按[备份与迁移](#备份与迁移)校验演示库备份并恢复到一个新目录，检查恢复后的资料能被检索。

v0.7.0 的已记录验证包括 **68 项 Node 测试**、**8 项浏览器验收**、干净解压后启动、备份恢复，以及 DSH 0.2.2-rc.3 的独立 profile 插件加载。更多细节见[发布验收记录](docs/handoff/CODEX-HANDOFF.md)。

## 常见问题

| 现象 | 建议检查 |
| --- | --- |
| 找不到 `node` | 安装 Node.js 24 后重开终端，或用 `SCHANORA_NODE` 指定已有 `node.exe` 的绝对路径 |
| 找不到 `npm` 或 PowerShell 拒绝执行 `npm.ps1` | 直接用 Node 启动。需要调用已安装的 Windows npm 时，可用 `npm.cmd` |
| 旧工作区有未提交改动 | 将 main 克隆或解压到另一个目录，从新副本部署 |
| 缺少 `package.json`、`start-web.cmd` 或 `DESIGN.md` | 确认已进入项目根目录。如是旧包，重新下载 [main 的完整 ZIP](https://github.com/CHRISYU2233/Schanora-Republic/archive/refs/heads/main.zip) |
| 无法确认部署是否完成 | 先核对 `/health` 的实际模式和数据目录，再验证浏览器样例。仅下载或解压源码表示准备完成 |
| 需要联调外部 WeKnora | 仓库提供内置本地内核。外部 WeKnora 联调另需已部署的服务与适配配置，可在本地部署验收后单独进行 |
| 浏览器打不开 | 保持 Node 启动终端运行，重新复制「浏览器」行的完整地址 |
| 端口和文档示例不一样 | 端口冲突后可能切到后续端口，以实际启动日志为准 |
| 显示空库或旧库 | 检查「设置」和 `/health` 的 `storeRoot`，确认是预期的路径 |
| 选库后仍无检索结果 | 查看文件是否处理完成，先用标题、料号或文档里的关键词试查 |
| PDF 无法分块 | 扫描件或部分特殊编码 PDF 可能无法抽出可用文本，先转换为带文本层的 PDF 或文本 |
| 原版 Node.js 问答只返回证据或原文摘录 | 检查是否开启深度研究、本机 Ollama 是否有可用对话模型 |
| 工作台生成失败 | 在「设置 → 模型与 API Key」测试对话模型，再从输入框上方选中该模型重试 |
| OneDrive 有文件但列表不更新 | 等待本机同步，核对资料目录后刷新。新增普通文件需要上传入库 |
| DSH 里找不到「知识库」 | 确认安装到正确 profile，依赖已更新，然后完整重启 DSH |
| 备份恢复时提示目标已存在 | 改用一个尚不存在的新目录，确保其父目录已创建 |
| 在 GitHub 页面看到了代码，如何使用 | 克隆或解压项目，按快速开始启动本机 Node 服务 |

## 目录与打包

```text
web/                         独立浏览器入口
start-web.cmd                Windows 浏览器启动器
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
