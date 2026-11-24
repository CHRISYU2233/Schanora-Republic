# Schanora 舍弗勒工程知识库

![SCHANORA](brand/schanora-green-white.png)

Schanora 是面向舍弗勒工程团队的知识库工作台。用浏览器管理作业指导书、维修手册和设计变更记录，按文件名、料号或自然语言查找资料，并从回答打开原文。也可以让 GitHub Copilot 等 AI 客户端查询同一套知识库。

[快速安装](#1-安装并打开浏览器) · [配置模型](#2-配置模型并建库) · [导入 OneDrive 资料](#3-导入-onedrive-资料) · [问答与 Wiki](#4-检索问答与-wiki) · [智能体](#41-使用和配置智能体) · [对话插件](#42-在对话里运行内置插件) · [接入 Copilot](#5-接入-github-copilot-与其它-ai-客户端) · [交给 AI 部署](#7-交给-ai-工具部署)

![Schanora 问答界面。可以在输入框上方选资料范围和模型，并从回答展开引用](docs/images/schanora-qa.png)

## 1 安装并打开浏览器

### Windows x64 快速安装

准备 **Node.js 24**。Git 用于克隆或更新源码。使用 ZIP 时可以省去 Git。安装器会从本仓库的 Release 下载 Windows x64 运行时、核对 SHA-256 并解包。运行时以 WeKnora v0.9.0 Lite 为基础，包含本地 SQLite、文本和向量检索，以及 Schanora 的工作账号注册和登录校验。首次安装需要访问 GitHub。本机浏览器连接本机服务。

```powershell
git clone https://github.com/CHRISYU2233/Schanora-Republic.git
Set-Location Schanora-Republic
node --version
powershell.exe -NoProfile -File .\scripts\install-weknora.ps1
.\open-schanora.cmd
```

也可以下载 [仓库的完整 ZIP](https://github.com/CHRISYU2233/Schanora-Republic/archive/refs/heads/main.zip)，解压后进入包含 `open-schanora.cmd` 的目录。执行上面的安装和启动命令。若网络要求先手动下载，打开 [Windows x64 运行时 Release](https://github.com/CHRISYU2233/Schanora-Republic/releases/tag/weknora-lite-0.9.0-company-accounts-win-x64) 获取 ZIP，再传入文件路径。

```powershell
powershell.exe -NoProfile -File .\scripts\install-weknora.ps1 -Archive "D:\Downloads\Schanora-WeKnora-Lite-0.9.0-company-accounts-win-x64.zip"
```

下次可以直接双击 `open-schanora.cmd`。启动成功后会打开 [本机 Schanora 工作台](http://127.0.0.1:8080/schanora/workspace.html)。使用期间保留启动窗口。按 Ctrl+C 停止服务。

### 首次开通与再次登录

1. 允许的工作邮箱域为 `schaeffler.com`、`mail.schaeffler.com` 和 `vitesco.com`。域名必须完整匹配。
2. 管理员先启动服务，再在同一台电脑另开一个终端进入仓库目录，为实际的工作邮箱生成开通码。服务使用自定义 `--root` 时，生成开通码也传入相同目录。

```powershell
node scripts/approve-account.mjs --email "employee@mail.schaeffler.com"
```

3. 管理员把开通码发到对应的工作邮箱。开通码与该邮箱绑定，有效期两小时。员工在登录页选择「创建账号」，填写工作邮箱、开通码和密码。默认用户名取 `@` 前的部分。同一部署里发生重名时会用完整地址区分。
4. 同一个浏览器再次打开登录页时会显示上次登录的邮箱，只需输入密码。点击「使用其他邮箱」可更换账号。

![Schanora 登录页，需要工作邮箱和密码](docs/images/schanora-login.png)

### 账户、头像和主题

点击工作台右上角的头像或用户名，即可打开账户菜单。你可以上传 PNG、JPEG 或 WebP 头像、恢复默认绿底白字头像、打开「设置」或退出登录。主题可选「浅色」「深色」或「跟随系统」。跟随系统时，切换系统外观会即时更新页面。主题和自定义头像保存于当前浏览器，刷新后会保留。

![Schanora 深色工作台，右上角账户菜单可切换主题、设置头像及配置模型](docs/images/schanora-account-theme.png)

| 场景 | 操作 |
| --- | --- |
| 测试安装 | `.\open-schanora.cmd --demo --port 18080`，启动一个独立临时实例 |
| 默认端口被占用 | `.\open-schanora.cmd --port 8088`，浏览器和 MCP 都用新端口 |
| 选择数据位置 | `.\open-schanora.cmd --root "D:\SchanoraData\weknora"`，正式运行持续使用同一路径 |
| 检查服务 | `Invoke-RestMethod http://127.0.0.1:8080/health`，预期 `status` 为 `ok` |
| 使用便携 Node | `$env:SCHANORA_NODE = "D:\Tools\node-v24-win-x64\node.exe"`，在同一终端启动 |

**默认数据目录**为 `%USERPROFILE%\Schanora\weknora-0.9.0`。更新源码后重启时复用原来的 `--root`。账号、已导入文件、索引以及模型设置随这套数据保留。Windows x64 运行时已验证。其他系统需要准备与其平台匹配的内核和官方前端，通过 `node scripts/start-weknora.mjs --runtime <运行时目录>` 启动。[固定版本源码](https://github.com/Tencent/WeKnora/tree/v0.9.0) · [Node.js 下载](https://nodejs.org/en/download)

<details>
<summary>从官方源码构建 Windows x64 运行时</summary>

固定上游提交为 `f17ee8a8da901bd658a4cb25f40b5fd41adbfdd7`。需要 Go 1.26、MinGW-w64 POSIX/UCRT、Node.js 和 npm。从 Schanora 仓库根目录开始。运行时目录应包含 `WeKnora-lite.exe`、`SCHANORA-COMPANY-ACCOUNTS`、`web/index.html`、`config/config.yaml` 和 `migrations/sqlite/`。建议选择不含空格的构建路径，便于配置 CGO。

```powershell
$patch = (Resolve-Path .\patches\weknora-company-accounts.patch).Path
$buildDir = Join-Path (Split-Path $PWD.Path -Parent) "WeKnora-v0.9.0"
git clone --branch v0.9.0 --depth 1 https://github.com/Tencent/WeKnora.git $buildDir
Set-Location $buildDir
git rev-parse HEAD
git apply --check $patch
git apply $patch
go mod download github.com/mattn/go-sqlite3
$sqlite = (go mod download -json github.com/mattn/go-sqlite3 | ConvertFrom-Json).Dir
$include = New-Item -ItemType Directory -Force .schanora-include
Copy-Item (Join-Path $sqlite "sqlite3-binding.h") (Join-Path $include.FullName "sqlite3.h")
$env:CGO_ENABLED = "1"
$env:CGO_CFLAGS = "-I" + $include.FullName.Replace("\", "/")
$env:CGO_LDFLAGS = "-lwinpthread"
$prefix = "github.com/Tencent/WeKnora/internal/handler"
$auth = "github.com/Tencent/WeKnora/internal/application/service"
go build -tags sqlite_fts5 -ldflags "-s -w -X ${prefix}.Version=0.9.0 -X ${prefix}.Edition=lite -X ${prefix}.CommitID=f17ee8a8da901bd658a4cb25f40b5fd41adbfdd7 -X ${auth}.SchanoraAccounts=on" -o WeKnora-lite.exe ./cmd/server
if ($LASTEXITCODE -ne 0) { throw "WeKnora runtime build failed" }
Set-Content -Encoding ascii .\SCHANORA-COMPANY-ACCOUNTS "0.9.0"
npm.cmd --prefix frontend ci
npm.cmd --prefix frontend run build
Copy-Item frontend/dist web -Recurse
```

回到 Schanora 根目录，用 `--runtime` 指向上述目录。若链接阶段提示 `-lrstrtmgr` 或 DuckDB 的 C++ 符号缺失，请核对 MinGW-w64 工具链版本。

</details>

## 2 配置模型并建库

点击右上角「头像 → 设置」，在「模型与 API Key」选择「添加模型」。一次配置一种用途。填写服务商提供的模型 ID、接入地址和 API Key，再点「保存并测试」。页面会分别显示保存状态和测试结果。密钥默认隐藏。编辑已有远程模型时可更新 Key 或只点「测试模型」。

<img src="docs/images/schanora-model-settings.png" alt="Schanora 模型设置，包含模型用途、服务商、模型 ID、地址和 API Key" width="470">

| 类型 | 用途 | 填写与绑定 |
| --- | --- | --- |
| 对话模型 | 根据资料生成有引用的答案 | DeepSeek 使用官方默认 Base URL，兼容服务填实际地址。在问答输入框上方直接切换 |
| Embedding | 为文档分块和检索问题计算向量 | 填服务商提供的向量维度。建库时绑定此模型，随后启用向量检索 |
| Rerank | 给召回的候选片段重新排序 | 填服务商的重排接口，如其文档指定的完整 `/v1/rerank` 地址。在相应的问答或智能体检索配置中绑定 |

1. 在「知识库」新建文档库。推荐按业务场景命名，例如「设备维修手册」「工艺规程」「设计变更记录」。
2. 选择已测试通过的 Embedding。在库页点「索引设置」打开高级配置，检查向量检索是否开启。先用默认分块参数验证一份文档，再按资料结构调整。
3. 先验证文件能完成解析、可以查看分块。再用一条关键词和一条同义问法测试检索。最后开启 Rerank，核对最相关的章节是否排到了前面。

**变更 Embedding 的后续处理**。已有向量来自原模型。同一个库换模型或维度时，先核对高级配置及索引重建流程，重新生成受影响资料的向量后再做检索验收。对话模型和 Rerank 的切换一般无需重建文档向量。

## 3 导入 OneDrive 资料

OneDrive 保存工程源文件。Schanora 从 **OneDrive 客户端已同步到本地的副本**读取文件，在本机知识库里生成并保存索引。多台电脑独立部署时，各自从同一源建索引。要共享同一份已经生成的索引，需要使用由组织部署且账号可访问的同一实例。

```mermaid
flowchart LR
  A["OneDrive 云端共享资料"] --> B["本机同步文件夹"]
  B --> C["导入指定知识库"]
  C --> D["解析与分块"]
  D --> E["Embedding 向量索引"]
  Q["用户提问"] --> F["关键词与向量检索"]
  E --> F
  F --> G["Rerank 重排"]
  G --> H["答案与原文引用"]
```

### 在浏览器导入文件或文件夹

1. 在 OneDrive 桌面客户端登录公司账号，找到同步后的共享目录。右键选择「始终保留在此设备上」，等同步完成。
2. 在 Schanora 打开目标知识库的「文档」。点「导入文件夹」并选择本机 OneDrive 目录，也可以单独上传文件。
3. 等待文档状态变为「已完成」，打开详情核对文件路径、解析阶段和分块。扫描 PDF 应先确认可提取正文或具备合适的 OCR。
4. 如果配置错误、设备断开或文件暂时无法处理，先在详情中看失败原因。问题解决后点击「重新解析」，沿用该文档的记录。

### 使用脚本增量导入

适合反复处理同一个共享目录。先到「管理控制台 → 设置 → 发布与集成 → API」，为目标库创建带 `retrieve` 和 `ingest` 权限的 **知识库 API Key**，并记录实际库 ID。以下例子使用 PowerShell 7 的隐藏输入。

```powershell
$folder = "D:\OneDrive - 公司名\Engineering\Work Instructions"
$kb = "填写实际知识库ID"
$base = "http://127.0.0.1:8080"

# 预览要导入或更新的相对路径
node scripts/sync-onedrive.mjs --folder $folder --kb $kb --base $base

$env:WEKNORA_API_KEY = Read-Host "导入用 API Key" -MaskInput
try {
    node scripts/sync-onedrive.mjs --folder $folder --kb $kb --base $base --apply
    node scripts/sync-onedrive.mjs --folder $folder --kb $kb --base $base --status
} finally {
    Remove-Item Env:WEKNORA_API_KEY -ErrorAction SilentlyContinue
}
```

脚本递归读取常见办公文档和文本，跳过隐藏文件、Office 临时文件和符号链接。单文件默认上限为 50 MiB，可用 `--max-mib` 调整，仍需符合服务端的上传限制。用 SHA-256 跳过未修改的内容。同步记录默认在 `%USERPROFILE%\Schanora\onedrive-sync`，也可用 `--state` 指向源文件夹以外的本地记录。

| 输出状态 | 怎么处理 |
| --- | --- |
| `new` / `changed` | 预览发现新增或内容变化，检查范围后用 `--apply` 提交 |
| `submitted` | 服务已接收。用 `--status` 或浏览器查看是否真正解析完成 |
| `completed` | 可以检索文档并打开原文分块 |
| `failed` | 阅读浏览器里的处理错误，修复后重新解析 |
| `source-missing` | 云端或本机源文件已移动或删除，由资料管理员核对库内对应文档 |

变更文件会作为新版提交，脚本返回 `previousIds`。新版通过检索和引用验收后，由资料管理员归档旧版，避免答案同时命中不同修订。OneDrive 适合共享源文件或停止服务后生成的备份。运行中的 SQLite、文件索引和密钥配置保存在本机数据目录。

## 4 检索问答与 Wiki

| 任务 | 入口与操作 |
| --- | --- |
| 查找精确料号、标准号和段落 | 「检索」选择范围，输入关键词，打开命中片段 |
| 根据资料提问 | 「问答」直接输入后按 Enter。默认检索当前账号可用的全部库，点击资料范围可缩小。Shift+Enter 换行 |
| 切换生成模型 | 输入框上方「模型 · 自动」下拉。仅显示已配置的对话模型 |
| 使用专业智能体 | 在问答输入框上方点「智能体」，选择本次会话的任务配置 |
| 运行插件 | 点输入框上方「插件」，运行内置工程工具，或给当前问题选取一个已经接入的 MCP 插件 |
| 引用当前或历史对话 | 在消息上点击「引用」。也可在输入框旁点「添加引用 → 历史对话」，选择会话和消息 |
| 指定知识库原文 | 在回答的来源卡片点「引用此段」，或用「添加引用 → 知识库原文」检索并选择片段 |
| 复核与分享回答 | 点击引用展开原文，「下载引用」导出 Markdown，包含回答、文档、原文片段及可用标识 |
| 浏览知识库的 Wiki | 进入目标库的「Wiki」。先在库配置启用 Wiki 索引和生成模型，再处理资料生成页面 |

可用提问示例。

> 查找设备 SCN-7781 的试验扭矩。请给出文件名称、修订版本和原文引用。有冲突时列出各版本差异。

添加引用后，检查输入框上方的引用条，再输入本轮问题。引用可在发送前移除，每轮最多四条。所选内容作为本轮上下文交给模型。使用「直接问模型」时也会发送这些手动引用，自动知识库检索保持关闭。

![Schanora 问答输入框上方显示已选中的知识库原文引用](docs/images/schanora-quote.png)

内置会话提示词把助手身份设为 **Schanora，面向舍弗勒工程团队的知识库助手**。对话模型是设置中添加的服务商模型。已有会话消息保留。自定义智能体可在管理控制台独立编辑身份提示词。

### 4.1 使用和配置智能体

智能体将任务提示词、模型、知识库范围和允许调用的工具配置在一起。安装后已包含三种面向工程部的智能体。

| 内置智能体 | 准备的资料 | 提问示例 |
| --- | --- | --- |
| 工艺规程助手 | 作业指导书、工艺卡、检验规程 | 查找 SCN-7781 在工位 OP30 的试验扭矩及验收条件，按文档版本和章节列出处 |
| 图纸与版本核对 | 已完成解析的图纸说明、BOM 或工程变更单 | 对照 SCN-7781 的 B 版与 C 版，逐项列出旧值、新值、受影响对象和原文 |
| 设备故障排查 | 设备型号、维修手册、故障码与历史记录 | 设备 X 出现 E-103 时，手册建议先核对什么？给出检查前提、判据和出处 |

1. 在「头像 → 设置」配置支持工具调用的对话模型。需要查库的任务还需配置 Embedding 和 Rerank，上传资料并等解析完成。
2. 打开「问答」，点击输入框上方「智能体」，选择对应助手。智能体使用其绑定模型或工作区默认对话模型。要缩小范围，点「资料范围」并选中具体的库。
3. 发送包含料号、设备型号、工序或明确版本的问题。查看回答的原文引用及「已调用工具」。切回「知识库问答」可恢复普通问答。
4. 要创建自己的智能体，从同一面板点「管理智能体」。在管理页新建并选择「智能推理」，指定对话模型、资料范围和任务要求。需要查库时启用知识检索、阅读原文所需工具。若要调用外部 MCP，按下节关联服务。保存后回到问答重新打开工具面板。

![Schanora 智能体入口位于问答输入框上方，可直接选择工程助手](docs/images/schanora-agents.png)

三种工程助手使用原生的检索、读文档和列文档工具，默认关闭联网和 MCP。图纸核对依赖入库后的文字与表格内容。几何、公差标注和发布状态须以原件或对应发布系统核对。 [内核智能体与工具说明](https://github.com/Tencent/WeKnora/blob/v0.9.0/website-docs/03-features/07-agent.md)

### 4.2 在对话里运行内置插件

打开「问答 → 插件 → 内置工程工具」。工具可先独立运行，再将结果作为本轮引用交给模型。

| 内置插件 | 具体操作 | 结果示例 |
| --- | --- | --- |
| 工程单位换算 | 选择量纲，填数值、原单位和目标单位，然后点「运行工具」 | 选扭矩并换算 `37 N·m` 到 `N·mm`，得到 `37000 N·mm` |
| 版本字段对比 | 在两个文本框分别粘贴旧版和新版，按每行「字段名：值」输入并运行 | 旧版输入 `扭矩：37 N·m`，新版输入 `扭矩：40 N·m`，工具列出字段的旧值和新值 |

单位换算支持长度、力、压力、扭矩、转速和绝对温度。界面只提供同一量纲的单位。版本对比每版最多 16 个字段、900 字符，按字段名匹配，输出新增、删除和修改。同一版内的字段名必须唯一。完整 BOM、图纸文件与 STEP 模型可通过对应解析或专用服务处理。

检查输出后点「引用结果」。输入框上方会出现引用条，此时可继续提问，例如「结合这两版数值和作业指导书帮我列出需要复核的工位」。浏览器直接计算结果，只有发送问题时才会将结果随此次对话提交给模型。 [Pint 的量纲和偏移单位设计](https://github.com/hgrecco/pint) · [工程 BOM 版本对比参考](https://github.com/mst-sg/mechanical-design-tools)

![在问答中运行扭矩单位换算，并可将结果附进下一条消息](docs/images/schanora-engineering-tools.png)

### 4.3 添加并在对话中调用外部 MCP 插件

以下以「图纸版本查询」为例。实际服务地址、允许查询的资料范围和凭据由对应系统管理员提供。

1. **接入服务**。从「问答 → 插件 → 管理 MCP 插件」进入工具箱，选择新增 MCP 服务。填写易识别的名称、服务商给的 URL 和传输方式，例如 Streamable HTTP 或 SSE。需要 Token 或 OAuth 时在服务配置中完成。启用服务后先测试连接，再同步工具目录，确认能看到预期工具，例如 `lookup_spec_revision`。
2. **配置智能体**。从「问答 → 智能体 → 管理智能体」新建或编辑一个「智能推理」智能体。在其 MCP 选项中选定上述服务，绑定支持工具调用的对话模型。已有智能体的工具和知识库范围仍由其配置控制。
3. **在问答调用**。点击输入框上方「插件」，选择已启用的「图纸版本查询」，然后输入「查 SCN-7781 的已发布图纸版本和发布日期」。没有手动选智能体时，Schanora 会为本轮选用一个有权限的智能体，并在输入框上方显示名字。选定插件会提高它在本轮的调用优先级。问句中写明要查的对象及预期字段。
4. **核对实际调用**。回答中的「已调用工具」来自内核报告的成功调用。服务连接、认证或工具执行失败时查看失败项及管理员配置。部分工具会等用户授权或确认，按回答中的链接进入相应会话处理。所选插件在发送后清空，下一轮有需要时重新点选。

![问答从 MCP 插件得到样例图纸版本查询结果，并列出实际运行的工具](docs/images/schanora-plugin-result.png)

| 现象 | 排查 |
| --- | --- |
| 列表里找不到插件 | 核对当前工作空间、服务是否启用。配置后返回问答，重新打开「插件」 |
| 插件在列表里但不可选 | 当前选中的智能体没有该服务的权限。选有权限的智能体，或由管理员修改其 MCP 范围 |
| 回答里没有出现插件的工具 | 检查模型是否支持工具调用、是否真的选中了插件、服务工具目录是否已同步。再用明确的料号或任务重试 |
| 企业图纸需要几何级比较 | 在组织具备 CAD 解析服务后接入专用 MCP。可评估使用 Open CASCADE 查询 STEP 的开源服务。MarkItDown 可作为需要额外 Office 转 Markdown 时的独立转换服务 |

这一步的方向是「Schanora 问答调用外部工具」。向 Copilot 等客户端发布 Schanora 检索能力，见下一节。 [内核 MCP 接入说明](https://github.com/Tencent/WeKnora/blob/v0.9.0/website-docs/03-features/08-mcp.md) · [STEP CAD MCP 项目](https://github.com/ottonic/cad-mcp-server) · [Microsoft MarkItDown](https://github.com/microsoft/markitdown)

## 5 接入 GitHub Copilot 与其它 AI 客户端

### 创建并验证 MCP 端点

1. 打开工作台顶栏「连接 AI」。在 MCP 管理页创建一个端点，选定可用的知识库。
2. 建议给日常工程查询启用 `list_knowledge_bases`、`search_knowledge`、`grep_chunks` 和 `read_document`。Wiki 可按需开放。需要从 AI 客户端调用 Schanora 内核生成完整回答时，再启用 `ask`，并为端点绑定默认智能体。
3. 保存端点，复制完整 URL 和创建时显示的 MCP Token。URL 形如 `http://127.0.0.1:8080/mcp/实际端点ID`。
4. 在同一台电脑运行以下验证。脚本会完成握手、读取工具并实际调用列库工具。

```powershell
$mcpUrl = "http://127.0.0.1:8080/mcp/填写实际端点ID"
$env:SCHANORA_MCP_TOKEN = Read-Host "Schanora MCP Token" -MaskInput
node scripts/check-mcp.mjs --url $mcpUrl
```

输出 `MCP list_knowledge_bases is callable.` 表示该端点已通过协议和认证验证。**模型 API Key** 填在模型设置，**知识库 API Key** 用于导入脚本，**MCP Token** 用于 AI 客户端的 `Authorization: Bearer …`。轮换 Token 后同步更新客户端凭据。

### GitHub Copilot CLI 与 VS Code

使用 [Copilot 配置模板](integrations/copilot-cli.mcp.example.json)，将 `mcpServers.schanora` 合并到个人 `~/.copilot/mcp-config.json`。若设置了 `COPILOT_HOME`，用该目录。保留原有 MCP 条目，把模板 URL 替换为实际地址，JSON 中保留 `${SCHANORA_MCP_TOKEN}` 作为环境变量引用。保存后从设置过该变量的终端启动 `copilot`，运行 `/mcp show schanora`。

在 VS Code 使用 Copilot 本地会话时，可复用 Copilot 原生配置。先设置环境变量并启动 VS Code，在 `Chat: Open Customizations` 的 MCP Servers 中检查 Schanora。若编辑器仍使用旧的 Local 模式，可从 [编辑器管理配置模板](integrations/vscode.mcp.example.json) 合并到个人 MCP 设置，按提示填写 URL 与 Token。 [Copilot CLI 官方配置](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-mcp-servers) · [VS Code 官方配置](https://code.visualstudio.com/docs/agents/reference/mcp-configuration)

### 其它 AI 客户端

| 客户端 | 设置方式 |
| --- | --- |
| Cursor 或支持自定义 HTTP MCP 的桌面应用 | 选择 **Streamable HTTP**，填 URL 和 `Authorization` 请求头。可合并 [通用 JSON 模板](integrations/http.mcp.example.json) 到个人配置 |
| Claude Code | 在「连接 AI」的端点页复制对应的 Claude Code 命令，在本机以个人范围配置 |
| 仅支持 stdio 的客户端 | 使用端点页提供的兼容桥接配置，先通过独立脚本验证原生 HTTP |
| GitHub.com Copilot 云代理 | 配置由组织提供且云代理可访问的 HTTPS MCP。仓库设置中限制工具范围，凭据存放在 GitHub Agents secrets |

本机 `127.0.0.1` 面向在同一台电脑执行的客户端。云端会话和远程开发容器需要能从各自的执行环境访问端点。 [GitHub 云代理 MCP 文档](https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/configure-mcp-servers)

验收时让客户端完成一次真实的「列库 → 检索 → 读取原文」。例如要求它到工程资料库找 `SCN-7781`，给出命中的文档和引用，再和浏览器里的原文对照。

## 6 更新备份与排查

### 更新和备份

- 使用 Git 的部署在仓库目录执行 `git pull --ff-only`，运行安装命令更新配套内核，然后用原启动参数重启。使用 ZIP 的部署可以将新版解压到单独目录，安装运行时，启动时指向原数据目录。
- 备份前停止服务。完整备份数据目录，包含 SQLite、文件目录和 `.weknora-secrets.json`。恢复时解压到专用目录，用 `--root` 指向它。用原有账号登录后抽查一条文档和一个模型。
- 各电脑独立部署时保留各自的数据与同步记录。OneDrive 改变云端源资料后，执行 `--apply` 将变化提交到对应实例。
- 从旧版升级且仍依赖历史非工作邮箱账户时，由实例管理员先核对迁移方式。需要临时登录旧账户，可在已备份的正式本机实例启动参数中加入 `--legacy-account-id <实际用户 UUID>`。一次只接受一位明确指定的历史账户，注册仍执行工作邮箱和开通码校验。迁移后去掉该参数。

### 常见问题

| 现象 | 检查方式 |
| --- | --- |
| 运行时安装失败 | 检查 Windows 架构、下载权限或安全策略、ZIP 校验结果和 `runtime` 目录状态。可使用 `-Archive` 从正确的本地 ZIP 安装 |
| 浏览器打不开或仍显示旧版 | 核对启动窗口、端口和 `/health`。从已更新的仓库重启服务，再刷新浏览器 |
| 工作邮箱注册失败 | 核对完整后缀、开通码对应邮箱、有效期，以及生成时使用的实例数据目录 |
| 保存模型成功但测试失败 | 核对模型 ID、API Key、Base URL、模型用途和出站访问。Embedding 还需核对输出维度 |
| OneDrive 文件没有进入库 | 确认文件已实际同步到本机，检查 `--status`、权限和支持的解析格式 |
| 文件已完成但找不到 | 检查实际检索范围、Embedding、向量索引和分块。先用文件里的独特术语检索 |
| MCP 返回 401 或 403 | 确认 MCP Token、端点启用状态、库范围和工具权限。用 `scripts/check-mcp.mjs` 在宿主之外排查 |
| Copilot 的工具列表为空 | 核对配置文件所在宿主、是否继承 `SCHANORA_MCP_TOKEN`、工作区信任及企业 MCP 策略 |

<details>
<summary>其它兼容入口和旧版资料迁移</summary>

DeepSeek Harness 可用 `node scripts/install-dsh.mjs --profile desktop` 预检，再加 `--apply` 写入对应 profile。按提示安装依赖。在进程中配置 `WEKNORA_BASE_URL` 和对应知识库 API Key，从侧栏打开 Schanora，或在会话中调用 `weknora_search`。原 Node.js 版的备份及旧版迁移参见[交接记录](docs/handoff/CODEX-HANDOFF.md)。

</details>

## 7 交给 AI 工具部署

将仓库链接和下面的任务一并交给能运行本机终端的 AI 工具。登录及凭据步骤在对应的本机界面完成。

```text
请部署 CHRISYU2233/Schanora-Republic 的 main，严格依据仓库 README。
1. 核对 Windows 架构、Node.js 版本、监听端口和旧数据目录。保留已有部署的数据。
2. 在一个干净的 Windows x64 checkout 安装发布的运行时。先用 --demo 启动独立端口，
   检查 /health 和浏览器登录页。实际开通时请管理员用 scripts/approve-account.mjs
   为该实例和工作邮箱生成开通码。由员工本人在浏览器设置密码并登录。
   正式升级前备份已有数据并确认旧账号的登录方式，再复用原端口和原数据目录。
3. 如需 OneDrive，从我实际同步到本机的文件夹读取。配置并测试对话、Embedding、Rerank。
   为测试库绑定 Embedding、启用向量检索。用合成文件依次验证预览、上传、解析、分块和检索。
4. 如需 Copilot 或其它 AI 客户端，在「连接 AI」创建指定库的 MCP 端点并校验。
   按目标宿主合并模板，保留已有配置。请我在本机提供凭据，勿把值写进仓库或报告。
   在宿主里验证列库、检索和读原文三个调用。
5. 回报实际浏览器地址、数据目录、所用版本、各项测试结果以及尚需我完成的操作。
```

### 维护者校验

```powershell
node scripts/build-client.mjs
node --test test/*.test.mjs
node scripts/check-bundle.mjs
node scripts/check-design.mjs
```

Windows 验证覆盖运行时解包、工作邮箱校验、浏览器登录、浅色与深色切换、跟随系统、主题刷新保留、模型切换、自动范围、对话与原文引用、工程助手、内置插件、在对话中实际调用 MCP、OneDrive 同步目录入库及去重，以及向客户端提供 MCP。界面截图使用合成邮箱、工程资料和测试模型。
