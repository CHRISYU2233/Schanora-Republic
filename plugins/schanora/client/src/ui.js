/**
 * Schanora 知识库工作区 · 客户端界面（唯一实现）
 *
 * 这份文件同时被两处使用：
 *   1. `scripts/build-client.mjs` 把它内联进 `plugins/schanora/client/client.js`（DSH 插件 bundle）
 *   2. `preview/index.html` 直接以普通脚本加载，配一个最小 ctx 桩，在浏览器里看真界面
 *
 * 只依赖宿主提供的 React 18，不引入任何第三方库、不需要构建工具。
 * 所有文案走 ctx.locale（zh/en 必须齐全，这是 DSH 客户端插件的约束）。
 *
 * 当前覆盖模块 1–3（对照 A 的 docs/api.md 2026-11-12 版）：
 *   1 知识库：列表 / 创建（模型目录动态拉取）
 *   2 文档接收：列表 / 拖放上传 / 重复文件提示
 *   3 处理状态：状态轮询 / 处理轨迹 / 分块浏览
 *
 * 已知边界（界面上如实标注，不假装已通）：
 *   - 选库只写本地暂存，模块 1 的 session scope 后端还没有
 *   - /health、/capabilities 仍不在网关里，显示「未实现」
 *   - 网关的 spans / chunks 未透传分页，分块只能拿到第 1 页
 */

function createSchanoraClient(React) {
  const h = React.createElement;
  const { useState, useEffect, useLayoutEffect, useMemo, useRef, useCallback } = React;

  const NS = 'schanora';
  const PANEL_ID = 'schanora';
  const STORAGE_SETTINGS = 'schanora.settings.v1';
  const STORAGE_SCOPE_PREFIX = 'schanora.scope.v1.';
  // 资料库迁移：文档标签（分类）与最近打开 —— 本机浏览器存储，不随网关同步
  const STORAGE_DOCTAGS = 'schanora.doctags.v1';
  const STORAGE_RECENT_DOCS = 'schanora.recentdocs.v1';
  // 报错横幅只做瞬时提醒：出现后自动收起，不长时间占着版面（信息保留在失败气泡/重试入口上）
  const ERROR_BANNER_MS = 8000;
  // 全局连接状态那条小警示更短：它只是「现在连不上」，不必久留
  const NOTICE_MS = 6000;

  /* ---------------------------------------------------------------- 字典 */

  const DICT = {
    zh: {
      'panel.label': '知识库',
      'panel.title': 'Schanora 知识库工作区',
      'panel.subtitle': '工程资料检索与引用',
      'panel.open': '打开工作区',
      'panel.refresh': '刷新',
      'panel.settings': '设置',
      'panel.diagnostics': '诊断',
      'panel.close': '关闭',
      'panel.contract': '契约',
      'panel.footer': '模块 1–3 · 建库 / 接收 / 处理',
      'panel.more': '更多',

      /* ---- 模块页签 / 插件接口 ---- */
      'mod.kb': '知识库',
      'mod.kb.desc': '按资料类型组织，管理文档与向量模型',
      'mod.docs': '文档',
      'mod.docs.desc': '接收本地上传，跟踪解析进度与分块',
      'mod.qa': '工程问答',
      'mod.qa.desc': '基于知识库检索的问答，回答带引用',
      'mod.wiki': 'Wiki',
      'mod.wiki.desc': '按主题与实体浏览知识库自动整编的 Wiki 页面',
      'wiki.pickKb': '选择知识库',
      'wiki.pick': '选择页面',
      'wiki.filter': '筛选页面…',
      'wiki.pickPage': '从左侧选择一页',
      'wiki.empty': '这个知识库还没有 Wiki 页面',
      'wiki.failed': '加载失败',
      'wiki.unavailable.title': '网关还没有 Wiki 接口',
      'wiki.unavailable.desc': 'A 侧模块 6 未接入；切到演示数据可以看界面与交互，真实接口就绪后自动可用。',
      'wiki.type.topic': '主题',
      'wiki.type.entity': '实体',
      'wiki.type.hub': '索引',
      'wiki.status.published': '已发布',
      'wiki.status.draft': '草稿',
      'wiki.version': '版本 {n}',
      'wiki.updated': '更新于 {time}',
      'wiki.sources': '来源 {n} 篇',
      'wiki.chunks': '{n} 个分块',
      'mod.search': '检索',
      'mod.search.desc': '在选定知识库里找原文片段，只给命中，不下结论',

      'search.placeholder': '问一个问题，或输入几个关键词',
      'search.run': '检索',
      'search.scope': '范围',
      'search.scope.all': '全部知识库',
      'search.needKb': '还没有知识库，先去「知识库」建一个。',
      'search.idle.title': '在知识库里找原文',
      'search.idle.desc': '检索只做召回，不做总结。想看带引用的回答，去「工程问答」。',
      'search.running': '检索中',
      'search.count': '{n} 个命中',
      'search.took': '{ms}ms',
      'search.score': '相关度',
      'search.type.vector': '向量',
      'search.type.keyword': '关键词',
      'search.chunk': '第 {n} 块',
      'search.expand': '展开原文',
      'search.collapse': '收起',
      'search.noHit.title': '没有命中',
      'search.noHit.desc': '换几个词，或把范围放宽到全部知识库。也可能这些文档还没处理完。',
      'search.stale.title': '检索条件已更改',
      'search.stale.desc': '下面的结果对应改之前的条件，已收起。请重新检索，或把条件改回去查看原结果。',
      'search.coverage': '覆盖 {p}%',
      'search.gate': '{kept}/{total} 条达引用门槛',
      'search.gate.tip': '查询词在片段中的词面覆盖率 {p}%；低于门槛的片段不宜作为引用依据。',
      'search.gate.none': '没有片段达到引用门槛，结果仅供召回参考，不建议据此作答；门槛可在设置里调。',
      'search.gate.nochunk': '缺出处',
      'search.gate.provenance': '缺文档 id 或分块号，引用无法回指原文',
      'search.failed': '检索失败',
      'search.rerank.disabled': 'rerank 已关闭（云端模型不可用），当前是向量 + 关键词混合召回',
      'search.rerank.ok': '已 rerank',
      'search.rerank.error': 'rerank 异常，已按召回顺序返回',

      'chat.sessions': '会话',
      'chat.new': '新会话',
      'chat.untitled': '未命名会话',
      'chat.pick': '选择会话',
      'chat.you': '我',
      'chat.assistant': 'Schanora',
      'chat.idle.title': '基于知识库回答，带引用',
      'chat.idle.desc': '先选一个会话。回答只来自命中的片段，找不到证据时会直说。',
      'chat.empty': '这个会话还没有消息',
      'chat.placeholder': '输入问题，Enter 发送，Shift+Enter 换行',
      'chat.send': '发送',
      'chat.stop': '停止',
      'chat.thinking': '正在检索并生成',
      'chat.references': '{n} 处引用',
      'chat.failed': '生成失败',
      'chat.stopped': '已停止',
      'chat.incomplete': '答案没生成完就断了（网关或上游中断）',
      'chat.retry': '重试',
      'chat.scope': '检索范围',
      'chat.agent.label': '智能体',
      'chat.agent.none': '知识库问答',
      'chat.agent.empty': '暂无可用的智能体',
      'chat.agent.loadFailed': '无法加载智能体列表',
      'chat.agent.manage': '管理智能体',
      'chat.agent.copy': '复制智能体 ID',
      'chat.agent.copied': '已复制智能体 ID',
      'chat.agent.copyFailed': '无法复制，请手动选择智能体 ID。',
      'chat.agent.badge': '智能体 · {name}',
      'chat.agent.tools': '已调用工具',
      'chat.agent.pending': '智能体需要操作，请在 WeKnora 会话中继续。',
      'chat.agent.open': '打开 WeKnora 会话',
      'chat.agent.hint': '智能体使用所选知识库及其在 WeKnora 中配置的工具。请核对引用。',
      'chat.agent.unavailable': '选中的智能体已不可用，请重新选择。',
      'chat.disclaimer': '答案由本地模型生成，可能不准确；以引用的原文为准。',
      'cite.ok': '{n} 处引用都可定位',
      'cite.bad': '{n} 处引用无法定位',
      'cite.none': '正文没有角标',
      'cite.jump': '查看第 {n} 处引用的原文',
      'cite.missing': '角标 [{n}] 没有对应引用',
      'cite.legend': '角标数字对应下方引用列表；点角标可展开原文',
      'chat.gate.weak': '这 {n} 条引用的词面覆盖都低于门槛，答案的依据偏弱，建议点开原文核对。',
      'mod.detail': '文档详情',
      'mod.interop': '跨插件',
      'mods.title': '模块',
      'mods.subtitle': 'Schanora 工作区内的模块，对应交接包 M0–M6。',
      'mods.count': '{n} 个注册',
      'mods.status.ready': '可用',
      'mods.status.partial': '部分可用',
      'mods.status.planned': '未接入',
      'mods.tab': '页签',
      'mods.detail': '详情视图',
      'mods.requires': '所需接口',
      'mods.none': '没有注册任何模块',
      'mods.planned.title': '接口未接入',
      'mods.planned.desc': '模块位已注册，网关侧接口就绪后才有内容。下面列出它需要的接口，先不摆假功能。',
      'mods.contract': '注册接口',
      'mods.contract.desc': '其他客户端插件在 apply 时调用即可挂到本面板，无需改本插件代码；id 相同会覆盖。',
      'mods.docs.pick': '先选一个知识库',
      'mods.docs.pickDesc': '文档属于某个知识库。选择后进入列表，上传与处理进度都在那里。',
      'mods.docs.empty': '还没有知识库，先去「知识库」新建一个。',
      'mods.goto.kb': '去知识库',
      'nav.collapse': '收起导航',
      'nav.expand': '展开导航',
      'nav.workspace': '工作区',
      'nav.planned': '规划中',
      'nav.back': '返回知识库',
      'hero.tagline': '工程资料检索 · 引用可追溯',
      'hero.note': 'API Key 只在网关侧，浏览器不持有',

      /* ---- 知识库列表 / 创建 ---- */
      'kbs.create': '新建知识库',
      'kbs.col.docs': '文档',
      'kbs.col.chunks': '分块',
      'kbs.col.updated': '更新',
      'kbs.col.kind': '类型',
      'kbs.open': '文档',
      'kbs.empty.action': '新建第一个知识库',
      'kbs.needName': '先给知识库起个名字',

      'kbForm.title': '新建知识库',
      'kbForm.name': '名称',
      'kbForm.namePlaceholder': '例如：装配标准库',
      'kbForm.desc': '描述（可选）',
      'kbForm.type': '类型',
      'kbForm.model': '向量模型',
      'kbForm.modelLoading': '正在读取模型…',
      'kbForm.modelEmpty': '没有可用的向量模型',
      'kbForm.modelFailed': '模型列表读取失败：{msg}',
      'kbForm.modelHint': '来自 GET /api/v1/models?type=Embedding，默认项已预选。',
      'kbForm.submit': '创建',
      'kbForm.cancel': '取消',
      'kbForm.submitting': '创建中…',
      'kbForm.created': '已创建「{name}」',
      'kbForm.failed': '创建失败：{msg}',

      /* ---- 模块 2：文档列表 / 上传 ---- */
      'docs.title': '文档',
      'docs.count': '共 {n} 个',
      'docs.unit': '{n} 份文档',
      'docs.loading': '正在读取文档…',
      'docs.empty.title': '这个库还没有文档',
      'docs.empty.desc': '把 PDF、Word、Excel、Markdown 拖到上面的区域开始接收。',
      'docs.error.title': '读取文档失败',
      'docs.retry': '重试',
      'docs.col.name': '文档',
      'docs.col.status': '处理状态',
      'docs.col.size': '大小',
      'docs.col.time': '接收时间',
      'docs.col.action': '操作',
      'docs.tags': '标签',
      'docs.tags.edit': '标签',
      'docs.tags.placeholder': '用逗号分隔，如：标准, 装配图纸',
      'docs.tags.save': '保存标签',
      'docs.tags.cancel': '取消',
      'docs.tags.all': '全部文档',
      'docs.tags.none': '暂无标签',
      'docs.tags.filterEmpty': '没有文档带这个标签',
      'docs.tags.explain': '标签存在本机浏览器（localStorage），不随网关同步',
      'docs.tags.export': '导出标签',
      'docs.tags.import': '导入标签',
      'docs.tags.imported': '已合并 {n} 个文档的标签',
      'docs.tags.import.bad': '导入失败',
      'docs.recent': '最近打开',
      'docs.open': '详情',
      'docs.polling': '自动刷新中 · {s}s',
      'docs.busyCount': '{n} 个处理中',
      'docs.polledAt': '更新于 {time}',
      'docs.failedCount': '{n} 个文档处理失败',
      'docs.totalUnknown': '网关未返回总数',

      'up.title': '接收文档',
      'up.drop': '把文件拖到这里',
      'up.or': '或',
      'up.choose': '选择文件',
      'up.multiple': '支持多选；上传成功 ≠ 处理完成，处理进度在列表里跟踪。',
      'up.dragging': '松开即可上传',
      'up.queued': '等待上传',
      'up.uploading': '上传中 {p}%',
      'up.uploaded': '已接收',
      'up.uploadFailed': '上传失败',
      'up.done': '已接收「{name}」',
      'up.error': '「{name}」上传失败：{msg}',
      'up.tooBig': '「{name}」超过 200MB，未上传',
      'up.remove': '移除',
      'up.retry': '重试',
      'up.dup.title': '{n} 个文件与已有文档同名同大小',
      'up.dup.desc': 'WeKnora 对相同内容不去重，继续会生成新的文档 ID。',
      'up.dup.continue': '仍然上传',
      'up.dup.cancel': '取消',

      /* ---- 模块 3：处理状态 ---- */
      'parse.pending': '等待处理',
      'parse.pendingHint': '已接收，等待解析',
      'parse.processing': '处理中',
      'parse.finalizing': '收尾中',
      'parse.completed': '已完成',
      'parse.failed': '处理失败',
      'parse.cancelled': '已取消',
      'parse.deleting': '删除中',
      'parse.unknown': '未知状态',
      'parse.stage': '阶段 {i}/5 · {name}',

      'doc.title': '文档详情',
      'doc.tab.props': '属性',
      'doc.tab.trace': '处理轨迹',
      'doc.tab.chunks': '分块',
      'doc.field.id': '文档 ID',
      'doc.field.file': '文件名',
      'doc.field.type': '类型',
      'doc.field.size': '大小',
      'doc.field.status': '处理状态',
      'doc.field.model': '向量模型',
      'doc.field.created': '接收时间',
      'doc.field.processed': '完成时间',
      'doc.field.error': '失败原因',
      'doc.field.chunks': '分块数',
      'doc.field.subtasks': '剩余子任务',
      'doc.copy': '复制 ID',
      'doc.copied': '已复制',
      'doc.reupload': '重新上传',
      'doc.reuploadHint': '网关暂无重试接口；重新上传会生成新的文档 ID。',
      'doc.refresh': '刷新',
      'doc.loading': '读取中…',
      'doc.loadFailed': '读取文档失败：{msg}',

      'trace.title': '处理轨迹',
      'trace.attempt': '第 {n} 次尝试',
      'trace.current': '当前阶段 {name}',
      'trace.errorCode': '错误码',
      'trace.noData': '还没有阶段数据：文档未开始处理，或处理前就被取消。',
      'trace.stage.docreader': '解析',
      'trace.stage.chunking': '分块',
      'trace.stage.embedding': '向量化',
      'trace.stage.multimodal': '多模态',
      'trace.stage.postprocess': '后处理',
      'trace.state.done': '完成',
      'trace.state.failed': '失败',
      'trace.state.cancelled': '已取消',
      'trace.state.running': '进行中',
      'trace.state.pending': '待执行',
      'trace.state.skipped': '已跳过',
      'trace.state.unknown': '未知',
      'trace.more': '其他子阶段 {n} 项',
      'trace.raw': '原始轨迹',

      'chunks.title': '分块',
      'chunks.count': '已知 {n} 块',
      'chunks.loading': '正在读取分块…',
      'chunks.empty': '还没有分块：处理未完成，或向量化失败。',
      'chunks.error': '读取分块失败：{msg}',
      'chunks.more': '可能还有更多分块：网关当前未透传分页参数',
      'chunks.next': '下一页',
      'chunks.prev': '上一页',
      'chunks.page': '第 {n} 页',
      'chunks.expand': '展开全文',
      'chunks.collapse': '收起',
      'chunks.chars': '{n} 字符',
      'chunks.range': '字符 {a}–{b}',
      'chunks.index.ready': '已索引',
      'chunks.index.processing': '索引中',
      'chunks.index.failed': '索引失败',

      'toast.close': '关闭',

      'source.mock': '演示数据',
      'source.local': '本地内核',
      'source.http': '网关实时',
      'source.mockHint': '演示数据是固定样例，不代表真实联调结果。',
      'source.localHint': '数据在本机（或 OneDrive 同步目录）里，随插件启动。',
      'source.httpHint': '正在读取远程网关。',

      'status.loading': '连接中…',
      'status.ok': '已连接',
      'status.degraded': '上游降级',
      'status.degraded.desc': '网关在线，上游 WeKnora 不可达；列表可能不完整。',
      'status.unavailable': '上游不可用',
      'status.unreachable': '无法连接网关',
      'status.notImplemented': '未实现',
      'status.unknown': '未探测',
      'status.checking': '检测中…',

      'card.gateway.title': '网关',
      'card.gateway.desc': '读取 /health',
      'card.caps.title': '后端能力',
      'card.caps.desc': '读取 /capabilities',
      'card.scope.title': '当前 Session',
      'card.scope.desc': '范围只作用于本会话',
      'card.scope.none': '未选库',
      'card.scope.count': '已选 {n} 个库',

      'kbs.title': '知识库',
      'kbs.count': '共 {n} 个',
      'kbs.search': '搜索知识库',
      'kbs.cardMeta': '{docs} 文档 · {chunks} 分块',
      'kbs.empty.title': '还没有知识库',
      'kbs.empty.desc': '现在可以直接创建；也可以等网关侧建好后刷新同步。',
      'kbs.loading': '正在读取知识库…',
      'kbs.error.title': '读取失败',
      'kbs.retry': '重试',
      'kbs.col.name': '名称',
      'kbs.col.kind': '类型',
      'kbs.col.status': '状态',
      'kbs.col.revision': '修订',
      'kbs.docCount': '文档数',
      'kbs.docCountUnknown': '待模块 2',

      'kind.document': '文档库',
      'kind.faq': '问答库',
      'kind.wiki': 'Wiki 库',
      'kb.status.ready': '可用',
      'kb.status.building': '构建中',
      'kb.status.failed': '失败',
      'kb.status.archived': '已归档',

      'caps.title': '能力探测',
      'caps.feature': '能力',
      'caps.state': '状态',
      'caps.supported': '可用',
      'caps.unsupported': '不支持',
      'caps.unverified': '未探测',
      'caps.hint': '未探测 = 网关没有报告这项能力，不等于不支持。',
      'caps.contractVersion': '契约版本',

      'diag.title': '诊断',
      'diag.health': '健康检查',
      'diag.scopeKey': '作用域键',
      'diag.scopeKeyHint': '完整键由 Host 上报；客户端不伪造 hostInstanceId / profileId。',
      'diag.requestId': '请求 ID',
      'diag.checkedAt': '检测时间',
      'diag.raw': '原始响应',
      'diag.contract': '接口',

      'set.title': '设置',
      'set.subtitle': '连接、检索与插件开关；改动只影响这台机器。',
      'set.mode': '数据来源',
      'set.mode.local': '本地内核',
      'set.mode.localHint': '插件自带内核，无网关、无外网；数据落在下面的目录里。',
      'set.mode.http': '远程网关',
      'set.mode.httpHint': '走 HTTP 网关（部署在服务器上的那一套）。',
      'set.mode.mock': '演示数据',
      'set.mode.mockHint': '不联网，用固定样例演示界面。',
      'set.storeRoot': '数据目录',
      'set.storeRootHint': '知识库、文档和会话保存在此目录。可将 SCHANORA_ROOT 指向已同步的 OneDrive 共享文件夹。',
      'set.storeRootUnknown': '内核未上报（未连接或非本地模式）',
      'set.reveal': '打开文件夹',
      'set.revealOk': '已在系统文件管理器中打开',
      'set.baseUrl': '网关地址',
      'set.baseUrlHint': '例如 https://kb.example.com；留空表示同源。',
      'set.apiKey': 'API Key',
      'set.apiKeyPlaceholder': '网关未开鉴权时留空',
      'set.apiKeyNote': '只存在本机 localStorage，请求时作为 X-API-Key 头发送，不写日志、不进导出包。',
      'set.apiKeyShow': '显示',
      'set.apiKeyHide': '隐藏',
      'set.timeout': '超时（秒）',
      'set.timeoutHint': '单次请求上限，3–120 秒。',
      'set.scenario': '演示场景',
      'set.scenario.ok': '正常',
      'set.scenario.degraded': '上游降级',
      'set.scenario.error': '连接失败',
      'set.group.conn': '连接',
      'set.models.title': '模型与 API Key',
      'set.models.select': '模型配置',
      'set.models.new': '添加模型',
      'set.models.type': '模型用途',
      'set.models.chat': '对话模型',
      'set.models.embedding': '向量模型（Embedding）',
      'set.models.rerank': '重排模型（Rerank）',
      'set.models.provider': '服务商',
      'set.models.compatible': '兼容 API / 自定义端点',
      'set.models.ollama': 'Ollama（本机）',
      'set.models.name': '模型 ID（服务商提供的名称）',
      'set.models.url': 'Base URL',
      'set.models.urlInvalid': '请输入有效的 HTTP 或 HTTPS 地址。',
      'set.models.dimension': '向量维度',
      'set.models.key': '服务商 API Key',
      'set.models.replaceKey': '新的服务商 API Key',
      'set.models.keySet': '已配置 API Key',
      'set.models.keyHint': '填写模型服务商发放的密钥，保存后由 WeKnora 保管。',
      'set.models.save': '保存模型',
      'set.models.saveKey': '更新 API Key',
      'set.models.saved': '模型已保存。',
      'set.models.keySaved': 'API Key 已更新。',
      'set.models.test': '测试模型',
      'set.models.testing': '正在调用模型…',
      'set.models.tested': '模型连接成功。',
      'set.models.testFailed': '模型调用失败，请核对 API Key、接入地址和模型 ID。',
      'set.models.dimensionMismatch': '服务返回 {actual} 维，配置为 {expected} 维。',
      'set.models.advanced': '在 WeKnora 中管理现有模型',
      'set.models.admin': '添加模型、更新密钥和测试需要 WeKnora 管理员权限。',
      'set.group.conn.desc': '默认本地内核：零网关、零外网。也可以指向远程网关，或切到演示数据。',
      'set.group.retrieval': '检索与问答',
      'set.group.host': 'DSH 能力',
      'set.group.host.desc': '显示 DSH 宿主开放的接口。Schanora 的问答使用本机模型或原文摘录。',
      'set.host.none': '未提供',
      'set.host.toolErr': '工具注册失败',
      'set.group.retrieval.desc': '影响召回条数，以及「够不够当证据」的判定线。',
      'set.topK': '默认返回条数',
      'set.topKHint': '检索页与问答每轮召回的上限，1–30。',
      'set.minCoverage': '引用门槛（%）',
      'set.minCoverageHint': '片段与问题的词面覆盖率低于此值就标「依据偏弱」，默认 34%。',
      'set.group.plugins': '本地插件',
      'set.group.plugins.desc': '这两个插件在前端执行，关掉后界面不再标注。',
      'set.save': '保存',
      'set.reset': '恢复默认',
      'set.test': '测试连接',
      'set.saved': '已保存',
      'set.testing': '测试中…',
      'set.testOk': '连接成功',
      'set.testFail': '连接失败：{msg}',
      'set.testNoHealth': '可达但无 /health',
      'set.localOnly': '设置只在本机生效；API Key 不会随插件包分发。',

      'mod.plugins': '插件',
      'mod.plugins.desc': '本地插件开关与服务端插件状态',
      'plug.count': '已启用 {n} 个本地插件',
      'plug.group.local': '本地内置',
      'plug.group.local.desc': '在前端执行的纯函数插件，开关立刻生效。',
      'plug.group.server': '服务端插件',
      'plug.group.server.desc': '需要网关加载 WeKnora 插件宿主（Go，进程外）；前端只读状态。',
      'plug.group.agent': 'Agent 侧',
      'plug.group.agent.desc': '由 DSH 侧注册成工具或沙箱执行，工作区面板不代跑。',
      'plug.state.on': '已启用',
      'plug.state.off': '已关闭',
      'plug.state.agent': 'DSH 侧',
      'plug.state.unknown': '状态未知',
      'plug.state.offline': '需网关启用',
      'plug.state.absent': '未安装',
      'plug.state.loading': '读取中…',
      'plug.state.remoteOk': '网关插件接口可用',
      'plug.unsupported': '网关无 /api/v1/plugins',
      'plug.gate.name': '证据门槛',
      'plug.gate.short': '片段覆盖率不足时标注「依据偏弱」',
      'plug.gate.desc': '按词面覆盖率给每条召回打分：低于门槛的片段在检索页标黄、在答案里提示依据偏弱。只标注，不丢结果。',
      'plug.cite.name': '引用校验',
      'plug.cite.short': '角标 [n] 三态，可点击回指原文',
      'plug.cite.desc': '把答案里的 [n] 角标与引用列表对账：能定位的可点开原文，越界或缺失的划掉标黄，并在列表头汇总「n 处可定位」。',
      'plug.websearch.name': '网页搜索 Provider',
      'plug.websearch.desc': '给 RAG 管线补一路外部网页召回；需要插件宿主与出网白名单，前端无法代跑。',
      'plug.connectors.name': '数据源连接器',
      'plug.connectors.desc': '把 RSS、飞书、Notion、语雀、GitLab、钉钉的内容持续同步进知识库，同样是服务端插件。',
      'plug.mcp.name': 'MCP 服务',
      'plug.mcp.desc': 'WeKnora 的 mcp-server 暴露检索、读全文、建库等工具，供外部 Agent 调用。',
      'plug.skills.name': '技能沙箱',
      'plug.skills.desc': '示例技能跑在 Docker / E2B / Cube 沙箱里，负责下载、解析、成稿这类带副作用的动作。',
      'plug.note.local': '纯前端执行，关掉后界面不再标注',
      'plug.note.server': '需要网关启用插件宿主，面板只显示状态',
      'plug.note.agent': '由 DSH 注册为工具，面板不代为执行',
      'plug.footnote': '本地插件关掉后，检索页不再出现覆盖率徽标，答案里的角标也不再做可点校验；服务端插件要到 WeKnora 侧安装并启用，这里才会显示为已启用。',

      /* ---- P3：显式范围 / 深度研究 / 错误定位 ---- */
      'search.scope.required': '先选知识库：未选范围时不查询，避免把全库结果当成范围结果。',
      'chat.scope.required': '先选择知识库，再发送问题。',
      // DSH 对话选区 → 引用提问（插件与宿主在同一 document，selectionchange 可见）
      'chat.quote.label': 'DSH 对话选区 · {n} 字',
      'chat.quote.use': '引用到提问',
      'chat.quote.save': '存入知识库',
      'chat.quote.saving': '存入中…',
      'chat.quote.saved': '已提交到「{kb}」',
      'chat.quote.savedCode': '已存入选区',
      'chat.quote.nokb': '先建一个知识库，再存这段选区。',
      'chat.quote.fail': '存入失败',
      'chat.quote.clear': '取消引用',
      'chat.mode.deep': '深度研究',
      'chat.mode.deep.tip': '开启后由 WeKnora 合成完整答案；默认只检索证据，答案由 DSH 主对话基于证据组织。',
      'chat.deep.badge': 'WeKnora 合成',
      'chat.host.badge': '宿主模型作答',
      'chat.evidence.title': '证据已就绪（{n} 条）',
      'chat.evidence.none': '没有命中证据：换几个关键词，或确认所选知识库里已有相关文档。',
      'chat.evidence.desc': '普通问题不在本面板生成答案：以上证据交给 DSH 主对话组织回答。需要完整合成答案时开启「深度研究」。',
      'chat.scope.locked': '检索范围（发送时锁定）：{names}',
      'error.requestId': '请求标识',
      'ref.version': '版本 {v}',

      /* ---- P1：采集（网页剪藏与工程速记）---- */
      'mod.clip': '采集',
      'mod.clip.desc': '网页 / 选段 / 笔记采集入库，带工程元数据与版本去重',
      'clip.form': '采集资料',
      'clip.mode': '采集方式',
      'clip.mode.url': '网页 URL',
      'clip.mode.selection': '网页选段',
      'clip.mode.markdown': 'Markdown 笔记',
      'clip.mode.browserDownload': '浏览器下载',
      'clip.mode.url.desc': '静态页面由服务端受控获取器提取正文；需要登录或动态交互的页面请用「浏览器」页签。',
      'clip.mode.selection.desc': '粘贴浏览器扩展 / BrowserSkill 抓到的选段正文；本面板读不到浏览器当前页面，不放「自动读取」按钮。',
      'clip.mode.markdown.desc': '工程速记：直接写 Markdown，保存为笔记来源，与原文分开。',
      'clip.mode.browserDownload.desc': '来自「浏览器」页签交接的下载文件，已校验文件名、大小与哈希。',
      'clip.targetKb': '目标知识库',
      'clip.targetKb.pick': '选择要入库的知识库',
      'clip.url': '来源 URL',
      'clip.url.invalid': 'URL 无法解析：{reason}',
      'clip.url.fetchNote': 'URL 方式的正文由服务端抓取：入库后在文档详情里核对原文。',
      'clip.title': '标题',
      'clip.content': '正文（Markdown）',
      'clip.content.ph': '粘贴或撰写正文；原文与笔记分开保存',
      'clip.note': '我的笔记（与原文分开保存，不覆盖原文）',
      'clip.note.ph': '备注、现场情况、与其他资料的关系…',
      'clip.meta': '工程元数据',
      'clip.meta.part': '料号',
      'clip.meta.drawing': '图号',
      'clip.meta.rev': '版次',
      'clip.meta.type': '资料类型',
      'clip.meta.supplier': '供应商',
      'clip.meta.type.standard': '标准/规范',
      'clip.meta.type.drawing': '图纸',
      'clip.meta.type.report': '试验报告',
      'clip.meta.type.process': '工艺',
      'clip.meta.type.vendor': '供应商资料',
      'clip.meta.type.other': '其他',
      'clip.meta.lifecycle': '生命周期状态',
      'clip.meta.lifecycle.desc': '默认 unknown：网页刚更新不等于企业批准的有效版本。',
      'clip.meta.sparse': '工程元数据偏少，检索维度会受限（不阻断提交）。',
      'clip.meta.revWarn': '版次格式看起来不像 A / B2 / Rev.C，请确认。',
      'clip.check': '提交前查重',
      'clip.check.create': '新资料：该库还没有同键内容，将创建首个版本。',
      'clip.check.reuse': '已有相同内容（版本 {v}）：重复提交不会新建副本。',
      'clip.check.newVersion': '同键内容有变化：提交将形成新版本（当前 {v}）。',
      'clip.check.http': '查重由服务端在提交时裁决；这里显示客户端预检的去重键。',
      'clip.check.key': '去重键',
      'clip.submit': '提交入库',
      'clip.submitting': '提交中…',
      'clip.again': '再采一条',
      'clip.step.draft': '草稿',
      'clip.step.capturing': '抓取/接收',
      'clip.step.previewReady': '预览确认',
      'clip.step.committing': '提交',
      'clip.step.queued': '排队',
      'clip.step.processing': '处理中',
      'clip.step.ready': '就绪',
      'clip.step.failed': '失败',
      'clip.step.cancelled': '已取消',
      'clip.outcome': '入库结果',
      'clip.outcome.create': '已入库：新文档',
      'clip.outcome.reuse': '内容未变化：复用现有版本 {v}，未新建副本',
      'clip.outcome.newVersion': '内容有变化：新版本 {v}（上一版 {p}）',
      'clip.doc': '文档 ID',
      'clip.version': '版本',
      'clip.prevVersion': '上一版本',
      'clip.origin': '来源',
      'clip.capturedAt': '采集时间',
      'clip.original': '原文摘要',
      'clip.noteTag': '笔记',
      'clip.failed': '入库失败：可重试（同一幂等键，不会产生重复版本）。',
      'clip.retry': '重试',
      'clip.needKb': '先选择目标知识库。',
      'clip.needContent': '正文不能为空。',
      'clip.fromBrowser': '已接收来自「浏览器」页签的交接内容：确认元数据后提交。',
      'clip.candidate.title': '浏览器传来一段候选内容',
      'clip.candidate.desc': '当前表单里还有未提交的草稿。用候选替换草稿，或保留草稿稍后再说。',
      'clip.candidate.replace': '用候选替换',
      'clip.candidate.keep': '保留当前草稿',
      'clip.httpNote': 'http 模式：ClipService（/api/v1/clips）为 A 侧待实现接口，未部署前提交会返回 NOT_IMPLEMENTED，不会假装入库成功。',
      'clip.pipeline': '入库管线',
      'clip.pipelineNote': '入库链路：候选 → 预览 → OneDrive source/web-clips 落盘 → WeKnora 摄取 → 就绪。documentId 只在真实入库映射建立后给出。',
      'clip.preview': '预览',
      'clip.result': '结果',

      /* ---- P2：BrowserSkill 协同 ---- */
      'mod.browser': '浏览器',
      'mod.browser.desc': 'BrowserSkill 协同：动态页面 / 登录页采集与文件下载',
      'brow.conn': '连接',
      'brow.conn.ok': '已连接：{browser}（bsk {ver}）',
      'brow.conn.off': '未连接',
      'brow.conn.loading': '探测中',
      'brow.conn.unknown': '状态未知',
      'brow.conn.unsupported': '桥接未实现',
      'brow.conn.mock': '演示模式：模拟 Edge + bsk daemon，未真实连接。',
      'brow.conn.notimpl': '网关未提供 /api/v1/browser/status：需要 A 侧桥接端点与本机 bsk daemon，探测不到就不假装已连接。',
      'brow.notimpl': 'http 模式暂不能驱动浏览器：官方 BrowserSkill DSH 插件与 A 侧桥接未接入前，任务创建被禁用（演示模式可看完整流程）。',
      'brow.session.isolated': '任务按 DSH 会话隔离：切换会话互不可见，迟到结果不串库。',
      'brow.session.none': '未检测到 Session 头部控件：任务映射需要它出现后再建。',
      'brow.new': '新建任务',
      'brow.task.type': '任务类型',
      'brow.task.table': '采集动态表格',
      'brow.task.download': '下载文件',
      'brow.run': '开始',
      'brow.pause': '暂停',
      'brow.resume': '继续',
      'brow.cancel': '取消',
      'brow.login.need': '页面需要登录：请在浏览器完成登录 / 人机验证，然后点「已完成登录」。',
      'brow.login.done': '已完成登录',
      'brow.login.hint': 'URL 含 login / portal 时会先要求登录；登录由用户完成，daemon 不代填凭据。',
      'brow.tasks': '任务',
      'brow.none': '本会话还没有浏览器任务。',
      'brow.st.running': '进行中',
      'brow.st.paused': '已暂停',
      'brow.st.login': '等待登录',
      'brow.st.done': '已完成',
      'brow.st.cancelled': '已取消',
      'brow.st.discarded': '迟到结果已丢弃',
      'brow.discard.note': '任务取消后到达的结果不入库：本结果已丢弃。',
      'brow.send': '送入采集面板',
      'brow.verify.ok': '文件完整：{name} · {size}',
      'brow.note': '浏览器操作不直接写知识库：结果先成为采集候选，经「采集」页签确认后入库。',

      /* ---- P4：批量导入 ---- */
      'mod.batch': '批量导入',
      'nav.kb': '知识库',
      'nav.search': '检索',
      'nav.qa': '问答',
      'nav.sub.docs': '文档',
      'nav.sub.wiki': 'Wiki',
      'nav.import': '导入资料',
      'nav.import.upload': '上传文件',
      'nav.import.clip': '网页与笔记',
      'nav.import.browser': '浏览器采集',
      'nav.import.batch': '批量导入',
      'nav.back': '返回库列表',
      'panel.features': '功能区域',
      'panel.features.desc': '插件与连接问题的集中入口。',
      'settings.plugins': '插件中心',
      'settings.diag': '诊断',
      'mod.batch.desc': 'Markdown 工程笔记批量入库：逐项幂等、失败可续跑',
      'batch.target': '目标知识库',
      'batch.add': '添加笔记',
      'batch.add.ph': '笔记标题…',
      'batch.file': '导入 .md 文件',
      'batch.demo': '载入演示批次（3 份，其中 1 份会失败一次）',
      'batch.list': '导入清单',
      'batch.start': '开始导入',
      'batch.retry': '重试失败项',
      'batch.remove': '移除',
      'batch.st.queued': '排队',
      'batch.st.running': '导入中',
      'batch.st.done': '已入库',
      'batch.st.failed': '失败',
      'batch.st.skipped': '跳过（已存在）',
      'batch.report': '完成报告',
      'batch.report.line': '成功 {ok} · 失败 {fail} · 跳过 {skip}',
      'batch.empty': '清单为空：粘贴或导入 Markdown 笔记后开始。',
      'batch.hint': '每份笔记按「库 + note + 内容 hash」幂等：续跑时已成功项自动跳过，失败项单独重试。',
      'panel.sourceHint': '数据来源：演示模式为本地模拟数据；http 模式直连网关。',

      'scope.popover.title': '本会话的知识库',
      'scope.popover.empty': '还没有可选的库',
      'scope.popover.localOnly': '选择只暂存在本地，模块 1 接入后会写入后端。',
      'scope.popover.clear': '清空',

      'err.network': '请求失败：{msg}',
      'err.timeout': '请求超时（{s}s）',
      'err.http': 'HTTP {status}',
      'err.notImplemented': '网关尚未提供该接口',
      'tag.unverified': '未联调',
    },
    en: {
      'panel.label': 'Knowledge',
      'panel.title': 'Schanora Knowledge Workspace',
      'panel.subtitle': 'Engineering documents, retrieval and citations',
      'panel.open': 'Open workspace',
      'panel.refresh': 'Refresh',
      'panel.settings': 'Settings',
      'panel.diagnostics': 'Diagnostics',
      'panel.close': 'Close',
      'panel.contract': 'Contract',
      'panel.footer': 'Modules 1–3 · create / receive / process',
      'panel.more': 'More',

      /* ---- module tabs / plugin interface ---- */
      'mod.kb': 'Knowledge bases',
      'mod.kb.desc': 'Organized by document type; documents and embedding models',
      'mod.docs': 'Documents',
      'mod.docs.desc': 'Receive local uploads, track parsing and chunks',
      'mod.qa': 'Engineering Q&A',
      'mod.qa.desc': 'Retrieval-grounded answers with citations',
      'mod.wiki': 'Wiki',
      'mod.wiki.desc': 'Browse wiki pages the knowledge base compiles, by topic and entity',
      'wiki.pickKb': 'Choose a knowledge base',
      'wiki.pick': 'Choose a page',
      'wiki.filter': 'Filter pages…',
      'wiki.pickPage': 'Pick a page on the left',
      'wiki.empty': 'No wiki pages in this knowledge base yet',
      'wiki.failed': 'Load failed',
      'wiki.unavailable.title': 'The gateway has no wiki endpoints yet',
      'wiki.unavailable.desc': 'Module 6 is not wired on the A side. Switch to demo data to see the UI; it goes live once the endpoints land.',
      'wiki.type.topic': 'Topic',
      'wiki.type.entity': 'Entity',
      'wiki.type.hub': 'Hub',
      'wiki.status.published': 'Published',
      'wiki.status.draft': 'Draft',
      'wiki.version': 'v{n}',
      'wiki.updated': 'Updated {time}',
      'wiki.sources': '{n} sources',
      'wiki.chunks': '{n} chunks',
      'mod.search': 'Search',
      'mod.search.desc': 'Find verbatim passages in selected knowledge bases — recalls, never summarises',

      'search.placeholder': 'Ask a question, or type a few keywords',
      'search.run': 'Search',
      'search.scope': 'Scope',
      'search.scope.all': 'All knowledge bases',
      'search.needKb': 'No knowledge base yet — create one under Knowledge bases.',
      'search.idle.title': 'Find passages in your knowledge bases',
      'search.idle.desc': 'Search only recalls; it never summarises. For cited answers, use Engineering Q&A.',
      'search.running': 'Searching',
      'search.count': '{n} hits',
      'search.took': '{ms}ms',
      'search.score': 'Score',
      'search.type.vector': 'Vector',
      'search.type.keyword': 'Keyword',
      'search.chunk': 'Chunk {n}',
      'search.expand': 'Show full text',
      'search.collapse': 'Collapse',
      'search.noHit.title': 'No hits',
      'search.noHit.desc': 'Try different words, or widen the scope. The documents may also still be processing.',
      'search.stale.title': 'Search criteria changed',
      'search.stale.desc': 'The previous results no longer match your current criteria and were collapsed. Search again, or revert the criteria to view them.',
      'search.coverage': 'Match {p}%',
      'search.gate': '{kept}/{total} pass the evidence gate',
      'search.gate.tip': 'Lexical coverage of the query in this passage is {p}%; passages below the gate are not citable.',
      'search.gate.none': 'No passage passes the evidence gate. These results are recall only; do not answer from them. The threshold is configurable in Settings.',
      'search.gate.nochunk': 'No source',
      'search.gate.provenance': 'Missing document id or chunk index, so the citation cannot point back to the original',
      'search.failed': 'Search failed',
      'search.rerank.disabled': 'rerank is off (cloud model unavailable); results are hybrid vector + keyword recall',
      'search.rerank.ok': 'Reranked',
      'search.rerank.error': 'rerank failed; recall order returned as-is',

      'chat.sessions': 'Sessions',
      'chat.new': 'New session',
      'chat.untitled': 'Untitled session',
      'chat.pick': 'Session',
      'chat.you': 'You',
      'chat.assistant': 'Schanora',
      'chat.idle.title': 'Answers grounded in your knowledge bases',
      'chat.idle.desc': 'Pick a session first. Answers come only from retrieved passages; with no evidence it says so.',
      'chat.empty': 'No messages in this session yet',
      'chat.placeholder': 'Ask something — Enter to send, Shift+Enter for a new line',
      'chat.send': 'Send',
      'chat.stop': 'Stop',
      'chat.thinking': 'Retrieving and generating',
      'chat.references': '{n} references',
      'chat.failed': 'Generation failed',
      'chat.stopped': 'Stopped',
      'chat.incomplete': 'The answer ended early (gateway or upstream broke off)',
      'chat.retry': 'Retry',
      'chat.scope': 'Retrieval scope',
      'chat.agent.label': 'Agent',
      'chat.agent.none': 'Knowledge base Q&A',
      'chat.agent.empty': 'No agents available',
      'chat.agent.loadFailed': 'Could not load agents',
      'chat.agent.manage': 'Manage agents',
      'chat.agent.copy': 'Copy agent ID',
      'chat.agent.copied': 'Agent ID copied',
      'chat.agent.copyFailed': 'Copy unavailable. Select the agent ID manually.',
      'chat.agent.badge': 'Agent · {name}',
      'chat.agent.tools': 'Tools used',
      'chat.agent.pending': 'The agent requires your input. Continue in the WeKnora session.',
      'chat.agent.open': 'Open WeKnora session',
      'chat.agent.hint': 'The agent uses the selected knowledge bases and its configured WeKnora tools. Verify the cited sources.',
      'chat.agent.unavailable': 'The selected agent is unavailable. Choose another option.',
      'chat.disclaimer': 'Generated by a local model and may be wrong; the cited passages are authoritative.',
      'cite.ok': '{n} citations resolved',
      'cite.bad': '{n} citations unresolved',
      'cite.none': 'No citations in the answer',
      'cite.jump': 'Open the source of citation {n}',
      'cite.missing': 'Citation [{n}] has no matching source',
      'cite.legend': 'Citation numbers map to the list below; click one to open its source',
      'chat.gate.weak': 'All {n} references fall below the lexical-coverage gate; the answer rests on weak evidence — check the sources.',
      'mod.detail': 'Document detail',
      'mod.interop': 'Interop',
      'mods.title': 'Modules',
      'mods.subtitle': 'Modules inside the Schanora workspace, mapped to handoff M0–M6.',
      'mods.count': '{n} registered',
      'mods.status.ready': 'Available',
      'mods.status.partial': 'Partial',
      'mods.status.planned': 'Not connected',
      'mods.tab': 'Tab',
      'mods.detail': 'Detail view',
      'mods.requires': 'Required endpoints',
      'mods.none': 'No modules registered',
      'mods.planned.title': 'Endpoints not connected',
      'mods.planned.desc': 'The slot is registered; content arrives once the gateway implements it. No fake buttons here.',
      'mods.contract': 'Registration API',
      'mods.contract.desc': 'Any client plugin can attach a module in apply; ids replace existing entries.',
      'mods.docs.pick': 'Pick a knowledge base first',
      'mods.docs.pickDesc': 'Documents belong to a knowledge base. Pick one to see the list, uploads and processing.',
      'mods.docs.empty': 'No knowledge base yet — create one under Knowledge bases.',
      'mods.goto.kb': 'Go to knowledge bases',
      'nav.collapse': 'Collapse navigation',
      'nav.expand': 'Expand navigation',
      'nav.workspace': 'Workspace',
      'nav.planned': 'Planned',
      'nav.back': 'Back to knowledge bases',
      'hero.tagline': 'Engineering documents, traceable citations',
      'hero.note': 'The API key stays on the gateway; the browser never holds it',

      /* ---- knowledge bases ---- */
      'kbs.create': 'New knowledge base',
      'kbs.col.docs': 'Documents',
      'kbs.col.chunks': 'Chunks',
      'kbs.col.updated': 'Updated',
      'kbs.col.kind': 'Kind',
      'kbs.open': 'Documents',
      'kbs.empty.action': 'Create the first one',
      'kbs.needName': 'Give the knowledge base a name first',

      'kbForm.title': 'New knowledge base',
      'kbForm.name': 'Name',
      'kbForm.namePlaceholder': 'e.g. Assembly standards',
      'kbForm.desc': 'Description (optional)',
      'kbForm.type': 'Type',
      'kbForm.model': 'Embedding model',
      'kbForm.modelLoading': 'Loading models…',
      'kbForm.modelEmpty': 'No embedding model available',
      'kbForm.modelFailed': 'Failed to load models: {msg}',
      'kbForm.modelHint': 'From GET /api/v1/models?type=Embedding; the default is preselected.',
      'kbForm.submit': 'Create',
      'kbForm.cancel': 'Cancel',
      'kbForm.submitting': 'Creating…',
      'kbForm.created': 'Created “{name}”',
      'kbForm.failed': 'Create failed: {msg}',

      /* ---- module 2 ---- */
      'docs.title': 'Documents',
      'docs.count': '{n} total',
      'docs.unit': '{n} docs',
      'docs.loading': 'Loading documents…',
      'docs.empty.title': 'No documents in this knowledge base',
      'docs.empty.desc': 'Drop PDF, Word, Excel or Markdown files into the area above to receive them.',
      'docs.error.title': 'Failed to load documents',
      'docs.retry': 'Retry',
      'docs.col.name': 'Document',
      'docs.col.status': 'Processing',
      'docs.col.size': 'Size',
      'docs.col.time': 'Received',
      'docs.col.action': 'Actions',
      'docs.tags': 'Tags',
      'docs.tags.edit': 'Tags',
      'docs.tags.placeholder': 'Comma separated, e.g. standards, drawings',
      'docs.tags.save': 'Save tags',
      'docs.tags.cancel': 'Cancel',
      'docs.tags.all': 'All documents',
      'docs.tags.none': 'No tags yet',
      'docs.tags.filterEmpty': 'No document carries this tag',
      'docs.tags.explain': 'Tags live in this browser (localStorage) and do not sync through the gateway',
      'docs.tags.export': 'Export tags',
      'docs.tags.import': 'Import tags',
      'docs.tags.imported': 'Merged tags for {n} documents',
      'docs.tags.import.bad': 'Import failed',
      'docs.recent': 'Recent',
      'docs.open': 'Details',
      'docs.polling': 'Auto-refresh · {s}s',
      'docs.busyCount': '{n} processing',
      'docs.polledAt': 'Updated {time}',
      'docs.failedCount': '{n} document(s) failed',
      'docs.totalUnknown': 'the gateway returns no total',

      'up.title': 'Receive documents',
      'up.drop': 'Drop files here',
      'up.or': 'or',
      'up.choose': 'Choose files',
      'up.multiple': 'Multiple files allowed; uploaded ≠ processed — track progress in the list.',
      'up.dragging': 'Release to upload',
      'up.queued': 'Queued',
      'up.uploading': 'Uploading {p}%',
      'up.uploaded': 'Received',
      'up.uploadFailed': 'Upload failed',
      'up.done': 'Received “{name}”',
      'up.error': '“{name}” failed to upload: {msg}',
      'up.tooBig': '“{name}” exceeds 200MB and was skipped',
      'up.remove': 'Remove',
      'up.retry': 'Retry',
      'up.dup.title': '{n} file(s) match an existing document by name and size',
      'up.dup.desc': 'WeKnora does not deduplicate identical content — continuing creates new document IDs.',
      'up.dup.continue': 'Upload anyway',
      'up.dup.cancel': 'Cancel',

      /* ---- module 3 ---- */
      'parse.pending': 'Queued',
      'parse.pendingHint': 'Received; waiting to parse',
      'parse.processing': 'Processing',
      'parse.finalizing': 'Finalizing',
      'parse.completed': 'Completed',
      'parse.failed': 'Failed',
      'parse.cancelled': 'Cancelled',
      'parse.deleting': 'Deleting',
      'parse.unknown': 'Unknown status',
      'parse.stage': 'Stage {i}/5 · {name}',

      'doc.title': 'Document details',
      'doc.tab.props': 'Properties',
      'doc.tab.trace': 'Trace',
      'doc.tab.chunks': 'Chunks',
      'doc.field.id': 'Document ID',
      'doc.field.file': 'File name',
      'doc.field.type': 'Type',
      'doc.field.size': 'Size',
      'doc.field.status': 'Status',
      'doc.field.model': 'Embedding model',
      'doc.field.created': 'Received',
      'doc.field.processed': 'Processed',
      'doc.field.error': 'Failure',
      'doc.field.chunks': 'Chunks',
      'doc.field.subtasks': 'Pending subtasks',
      'doc.copy': 'Copy ID',
      'doc.copied': 'Copied',
      'doc.reupload': 'Upload again',
      'doc.reuploadHint': 'The gateway has no retry endpoint yet; uploading again creates a new document ID.',
      'doc.refresh': 'Refresh',
      'doc.loading': 'Loading…',
      'doc.loadFailed': 'Failed to load the document: {msg}',

      'trace.title': 'Processing trace',
      'trace.attempt': 'Attempt {n}',
      'trace.current': 'Current stage {name}',
      'trace.errorCode': 'Error code',
      'trace.noData': 'No stage data: the document has not started, or was cancelled before processing.',
      'trace.stage.docreader': 'Parse',
      'trace.stage.chunking': 'Chunking',
      'trace.stage.embedding': 'Embedding',
      'trace.stage.multimodal': 'Multimodal',
      'trace.stage.postprocess': 'Post-process',
      'trace.state.done': 'Done',
      'trace.state.failed': 'Failed',
      'trace.state.cancelled': 'Cancelled',
      'trace.state.running': 'Running',
      'trace.state.pending': 'Pending',
      'trace.state.skipped': 'Skipped',
      'trace.state.unknown': 'Unknown',
      'trace.more': '{n} other sub-stages',
      'trace.raw': 'Raw trace',

      'chunks.title': 'Chunks',
      'chunks.count': '{n} known',
      'chunks.loading': 'Loading chunks…',
      'chunks.empty': 'No chunks yet: processing unfinished, or embedding failed.',
      'chunks.error': 'Failed to load chunks: {msg}',
      'chunks.more': 'There may be more chunks: the gateway does not forward pagination yet',
      'chunks.next': 'Next',
      'chunks.prev': 'Previous',
      'chunks.page': 'Page {n}',
      'chunks.expand': 'Show full text',
      'chunks.collapse': 'Collapse',
      'chunks.chars': '{n} chars',
      'chunks.range': 'chars {a}–{b}',
      'chunks.index.ready': 'Indexed',
      'chunks.index.processing': 'Indexing',
      'chunks.index.failed': 'Index failed',

      'toast.close': 'Dismiss',

      'source.mock': 'Demo data',
      'source.local': 'Local kernel',
      'source.http': 'Gateway live',
      'source.mockHint': 'Demo data is fixed sample content, not a real integration result.',
      'source.localHint': 'Data lives on this machine (or a synced OneDrive folder) and starts with the plugin.',
      'source.httpHint': 'Reading the remote gateway.',

      'status.loading': 'Connecting…',
      'status.ok': 'Connected',
      'status.degraded': 'Upstream degraded',
      'status.degraded.desc': 'Gateway is up but WeKnora is unreachable; lists may be incomplete.',
      'status.unavailable': 'Upstream unavailable',
      'status.unreachable': 'Gateway unreachable',
      'status.notImplemented': 'Not implemented',
      'status.unknown': 'Not probed',
      'status.checking': 'Checking…',

      'card.gateway.title': 'Gateway',
      'card.gateway.desc': 'Reads /health',
      'card.caps.title': 'Capabilities',
      'card.caps.desc': 'Reads /capabilities',
      'card.scope.title': 'Current Session',
      'card.scope.desc': 'Scope applies to this session only',
      'card.scope.none': 'No knowledge base',
      'card.scope.count': '{n} selected',

      'kbs.title': 'Knowledge bases',
      'kbs.count': '{n} total',
      'kbs.search': 'Search knowledge bases',
      'kbs.cardMeta': '{docs} docs · {chunks} chunks',
      'kbs.empty.title': 'No knowledge base yet',
      'kbs.empty.desc': 'Create one here, or refresh after the gateway admin creates it.',
      'kbs.loading': 'Loading knowledge bases…',
      'kbs.error.title': 'Failed to load',
      'kbs.retry': 'Retry',
      'kbs.col.name': 'Name',
      'kbs.col.kind': 'Kind',
      'kbs.col.status': 'Status',
      'kbs.col.revision': 'Revision',
      'kbs.docCount': 'Documents',
      'kbs.docCountUnknown': 'module 2',

      'kind.document': 'Documents',
      'kind.faq': 'FAQ',
      'kind.wiki': 'Wiki',
      'kb.status.ready': 'Ready',
      'kb.status.building': 'Building',
      'kb.status.failed': 'Failed',
      'kb.status.archived': 'Archived',

      'caps.title': 'Capabilities',
      'caps.feature': 'Feature',
      'caps.state': 'State',
      'caps.supported': 'Available',
      'caps.unsupported': 'Unsupported',
      'caps.unverified': 'Not probed',
      'caps.hint': 'Not probed means the gateway did not report it — not the same as unsupported.',
      'caps.contractVersion': 'Contract version',

      'diag.title': 'Diagnostics',
      'diag.health': 'Health',
      'diag.scopeKey': 'Scope key',
      'diag.scopeKeyHint': 'The full key is reported by the Host; the client never fabricates hostInstanceId / profileId.',
      'diag.requestId': 'Request ID',
      'diag.checkedAt': 'Checked at',
      'diag.raw': 'Raw response',
      'diag.contract': 'Endpoints',

      'set.title': 'Settings',
      'set.subtitle': 'Connection, retrieval and plugins — saved on this machine only.',
      'set.mode': 'Data source',
      'set.mode.local': 'Local kernel',
      'set.mode.localHint': 'Bundled kernel — no gateway, no internet. Data lives in the folder below.',
      'set.mode.http': 'Remote gateway',
      'set.mode.httpHint': 'Use an HTTP gateway (the server-side deployment).',
      'set.mode.mock': 'Demo data',
      'set.mode.mockHint': 'Offline, fixed sample content to show the UI.',
      'set.storeRoot': 'Data folder',
      'set.storeRootHint': 'Knowledge bases, documents and sessions are stored here. Set SCHANORA_ROOT to use a synced OneDrive folder.',
      'set.storeRootUnknown': 'Not reported by the kernel (offline or not local mode)',
      'set.reveal': 'Open folder',
      'set.revealOk': 'Opened in the system file manager',
      'set.baseUrl': 'Gateway base URL',
      'set.baseUrlHint': 'e.g. https://kb.example.com; empty means same origin.',
      'set.apiKey': 'API key',
      'set.apiKeyPlaceholder': 'Leave empty if the gateway has no auth',
      'set.apiKeyNote': 'Stored in local localStorage only, sent as the X-API-Key header; never logged or exported.',
      'set.apiKeyShow': 'Show',
      'set.apiKeyHide': 'Hide',
      'set.timeout': 'Timeout (s)',
      'set.timeoutHint': 'Per-request limit, 3–120 seconds.',
      'set.scenario': 'Demo scenario',
      'set.scenario.ok': 'Healthy',
      'set.scenario.degraded': 'Upstream degraded',
      'set.scenario.error': 'Unreachable',
      'set.group.conn': 'Connection',
      'set.models.title': 'Models and API keys',
      'set.models.select': 'Model configuration',
      'set.models.new': 'Add a model',
      'set.models.type': 'Model type',
      'set.models.chat': 'Chat model',
      'set.models.embedding': 'Embedding model',
      'set.models.rerank': 'Rerank model',
      'set.models.provider': 'Provider',
      'set.models.compatible': 'Compatible API / custom endpoint',
      'set.models.ollama': 'Ollama (local)',
      'set.models.name': 'Model ID (name from the provider)',
      'set.models.url': 'Base URL',
      'set.models.urlInvalid': 'Enter a valid HTTP or HTTPS URL.',
      'set.models.dimension': 'Embedding dimension',
      'set.models.key': 'Provider API key',
      'set.models.replaceKey': 'New provider API key',
      'set.models.keySet': 'API key configured',
      'set.models.keyHint': 'Enter the key issued by your model provider. WeKnora stores it.',
      'set.models.save': 'Save model',
      'set.models.saveKey': 'Update API key',
      'set.models.saved': 'Model saved.',
      'set.models.keySaved': 'API key updated.',
      'set.models.test': 'Test model',
      'set.models.testing': 'Calling the model…',
      'set.models.tested': 'Model connection succeeded.',
      'set.models.testFailed': 'Model call failed. Check the API key, endpoint, and model ID.',
      'set.models.dimensionMismatch': 'The model returned {actual} dimensions. The configuration specifies {expected}.',
      'set.models.advanced': 'Manage existing models in WeKnora',
      'set.models.admin': 'Adding models, changing keys, and testing require WeKnora administrator access.',
      'set.group.conn.desc': 'Local kernel by default: no gateway, no internet. You can point it at a remote gateway or switch to demo data.',
      'set.group.retrieval': 'Retrieval & answers',
      'set.group.host': 'DSH capabilities',
      'set.group.host.desc': 'Shows the services exposed by DSH. Schanora answers use a local model or source excerpts.',
      'set.host.none': 'Not provided',
      'set.host.toolErr': 'Tool registration failed',
      'set.group.retrieval.desc': 'Controls how many passages come back and when they count as evidence.',
      'set.topK': 'Passages per query',
      'set.topKHint': 'Upper bound for search and each answer turn, 1–30.',
      'set.minCoverage': 'Citation threshold (%)',
      'set.minCoverageHint': 'Below this word-level coverage a passage is marked weak evidence. Default 34%.',
      'set.group.plugins': 'Local plugins',
      'set.group.plugins.desc': 'These two run in the front end; turning them off removes their annotations.',
      'set.save': 'Save',
      'set.reset': 'Reset',
      'set.test': 'Test connection',
      'set.saved': 'Saved',
      'set.testing': 'Testing…',
      'set.testOk': 'Connected',
      'set.testFail': 'Failed: {msg}',
      'set.testNoHealth': 'reachable, no /health',
      'set.localOnly': 'Settings apply locally; the API key never ships with the plugin package.',

      'mod.plugins': 'Plugins',
      'mod.plugins.desc': 'Local plugin switches and server-side plugin status',
      'plug.count': '{n} local plugins enabled',
      'plug.group.local': 'Built in',
      'plug.group.local.desc': 'Pure functions that run in the front end; toggles take effect immediately.',
      'plug.group.server': 'Server plugins',
      'plug.group.server.desc': 'Need the WeKnora plugin host (Go, out of process); the panel only reads their status.',
      'plug.group.agent': 'Agent side',
      'plug.group.agent.desc': 'Registered as tools or sandbox runs on the DSH side; the panel does not execute them.',
      'plug.state.on': 'Enabled',
      'plug.state.off': 'Off',
      'plug.state.agent': 'DSH side',
      'plug.state.unknown': 'Unknown',
      'plug.state.offline': 'Needs gateway',
      'plug.state.absent': 'Not installed',
      'plug.state.loading': 'Reading…',
      'plug.state.remoteOk': 'Gateway plugin API available',
      'plug.unsupported': 'No /api/v1/plugins on the gateway',
      'plug.gate.name': 'Evidence gate',
      'plug.gate.short': 'Marks answers as weak evidence when coverage is low',
      'plug.gate.desc': 'Scores each passage by lexical coverage: below the threshold it turns yellow in search and the answer gets a weak-evidence note. Nothing is dropped.',
      'plug.cite.name': 'Citation check',
      'plug.cite.short': 'Three-state [n] markers that link back to the source',
      'plug.cite.desc': 'Reconciles [n] markers with the reference list: resolvable ones open their source, out-of-range ones are struck through, and the header summarises how many resolve.',
      'plug.websearch.name': 'Web search provider',
      'plug.websearch.desc': 'Adds a web-recall channel to the RAG pipeline; needs the plugin host and an egress allowlist, so the front end cannot run it.',
      'plug.connectors.name': 'Data source connectors',
      'plug.connectors.desc': 'Continuously syncs RSS, Feishu, Notion, Yuque, GitLab and DingTalk content into knowledge bases. Also a server plugin.',
      'plug.mcp.name': 'MCP server',
      'plug.mcp.desc': 'WeKnora mcp-server exposes search, full-text read and knowledge-base tools to external agents.',
      'plug.skills.name': 'Skill sandbox',
      'plug.skills.desc': 'Example skills run in Docker / E2B / Cube sandboxes for downloads, parsing and drafting.',
      'plug.note.local': 'Runs in the front end; turning it off removes its annotations',
      'plug.note.server': 'Needs the plugin host enabled on the gateway; the panel only reports status',
      'plug.note.agent': 'Registered as a tool by DSH; the panel does not run it',
      'plug.footnote': 'With the local plugins off, search no longer shows coverage badges and citations are no longer clickable. Server plugins appear as enabled only after they are installed and turned on in WeKnora itself.',

      /* ---- P3: explicit scope / deep research / error tracing ---- */
      'search.scope.required': 'Pick knowledge bases first: with no scope selected we refuse to query, rather than silently searching everything.',
      'chat.scope.required': 'Select knowledge bases before sending.',
      'chat.quote.label': 'DSH selection · {n} chars',
      'chat.quote.use': 'Quote into question',
      'chat.quote.save': 'Save to library',
      'chat.quote.saving': 'Saving…',
      'chat.quote.saved': 'Submitted to “{kb}”',
      'chat.quote.savedCode': 'Selection saved',
      'chat.quote.nokb': 'Create a knowledge base first, then save this selection.',
      'chat.quote.fail': 'Save failed',
      'chat.quote.clear': 'Remove quote',
      'chat.mode.deep': 'Deep research',
      'chat.mode.deep.tip': 'When on, WeKnora synthesizes a full answer; by default we only retrieve evidence and the DSH host conversation composes the answer.',
      'chat.deep.badge': 'WeKnora synthesis',
      'chat.host.badge': 'Answered by host model',
      'chat.evidence.title': 'Evidence ready ({n} hits)',
      'chat.evidence.none': 'No evidence hit: try different keywords, or check that the selected knowledge bases actually contain relevant documents.',
      'chat.evidence.desc': 'Ordinary questions are not answered in this panel: the evidence above is handed to the DSH host conversation. Turn on "Deep research" for a fully synthesized answer.',
      'chat.scope.locked': 'Scope (locked at send): {names}',
      'error.requestId': 'Request ID',
      'ref.version': 'version {v}',

      /* ---- P1: clip (web clipper & engineering notes) ---- */
      'mod.clip': 'Capture',
      'mod.clip.desc': 'Clip pages / selections / notes into libraries with engineering metadata and version dedupe',
      'clip.form': 'Capture material',
      'clip.mode': 'Capture mode',
      'clip.mode.url': 'Page URL',
      'clip.mode.selection': 'Page selection',
      'clip.mode.markdown': 'Markdown note',
      'clip.mode.browserDownload': 'Browser download',
      'clip.mode.url.desc': 'Static pages are fetched by the server-side controlled fetcher; pages needing login or dynamic interaction belong to the Browser tab.',
      'clip.mode.selection.desc': 'Paste the selection captured by a browser extension / BrowserSkill; this panel cannot read your browser page, so there is no "auto-read" button.',
      'clip.mode.markdown.desc': 'Engineering quick notes: write Markdown directly, stored as a note source separate from originals.',
      'clip.mode.browserDownload.desc': 'A download handed over from the Browser tab, with file name, size and hash verified.',
      'clip.targetKb': 'Target knowledge base',
      'clip.targetKb.pick': 'Pick a knowledge base to import into',
      'clip.url': 'Source URL',
      'clip.url.invalid': 'URL cannot be parsed: {reason}',
      'clip.url.fetchNote': 'For URL mode the server fetches the body: verify the original text in the document detail view after import.',
      'clip.title': 'Title',
      'clip.content': 'Body (Markdown)',
      'clip.content.ph': 'Paste or write the body; originals and notes are stored separately',
      'clip.note': 'My note (stored separately, never overwrites the original)',
      'clip.note.ph': 'Remarks, field context, relations to other material…',
      'clip.meta': 'Engineering metadata',
      'clip.meta.part': 'Part no.',
      'clip.meta.drawing': 'Drawing no.',
      'clip.meta.rev': 'Revision',
      'clip.meta.type': 'Material type',
      'clip.meta.supplier': 'Supplier',
      'clip.meta.type.standard': 'Standard / spec',
      'clip.meta.type.drawing': 'Drawing',
      'clip.meta.type.report': 'Test report',
      'clip.meta.type.process': 'Process',
      'clip.meta.type.vendor': 'Vendor material',
      'clip.meta.type.other': 'Other',
      'clip.meta.lifecycle': 'Lifecycle status',
      'clip.meta.lifecycle.desc': 'Defaults to unknown: a freshly updated page is not an approved effective version.',
      'clip.meta.sparse': 'Engineering metadata is sparse; retrieval dimensions will be limited (not blocking).',
      'clip.meta.revWarn': 'The revision does not look like A / B2 / Rev.C — please double-check.',
      'clip.check': 'Pre-submit dedupe check',
      'clip.check.create': 'New material: no same-key content in this library; a first version will be created.',
      'clip.check.reuse': 'Identical content exists (version {v}): resubmitting will not create a duplicate.',
      'clip.check.newVersion': 'Same-key content changed: submitting forms a new version (current {v}).',
      'clip.check.http': 'Dedupe is decided by the server at commit; shown here is the client-side pre-check key.',
      'clip.check.key': 'Dedupe key',
      'clip.submit': 'Submit',
      'clip.submitting': 'Submitting…',
      'clip.again': 'Capture another',
      'clip.step.draft': 'Draft',
      'clip.step.capturing': 'Capture',
      'clip.step.previewReady': 'Preview',
      'clip.step.committing': 'Commit',
      'clip.step.queued': 'Queued',
      'clip.step.processing': 'Processing',
      'clip.step.ready': 'Ready',
      'clip.step.failed': 'Failed',
      'clip.step.cancelled': 'Cancelled',
      'clip.outcome': 'Import outcome',
      'clip.outcome.create': 'Imported: new document',
      'clip.outcome.reuse': 'Content unchanged: reusing existing version {v}, no duplicate created',
      'clip.outcome.newVersion': 'Content changed: new version {v} (previous {p})',
      'clip.doc': 'Document ID',
      'clip.version': 'Version',
      'clip.prevVersion': 'Previous version',
      'clip.origin': 'Source',
      'clip.capturedAt': 'Captured at',
      'clip.original': 'Body excerpt',
      'clip.noteTag': 'Note',
      'clip.failed': 'Import failed: retry with the same idempotency key (no duplicate versions).',
      'clip.retry': 'Retry',
      'clip.needKb': 'Select a target knowledge base first.',
      'clip.needContent': 'Body cannot be empty.',
      'clip.fromBrowser': 'Received a handover from the Browser tab: confirm the metadata and submit.',
      'clip.candidate.title': 'A browser capture candidate arrived',
      'clip.candidate.desc': 'The form still holds an unsent draft. Replace it with the candidate, or keep the draft for later.',
      'clip.candidate.replace': 'Replace draft',
      'clip.candidate.keep': 'Keep current draft',
      'clip.httpNote': 'HTTP mode: ClipService (/api/v1/clips) is a pending A-side contract; until deployed, submits return NOT_IMPLEMENTED instead of pretending to succeed.',
      'clip.pipeline': 'Import pipeline',
      'clip.pipelineNote': 'Pipeline: candidate → preview → OneDrive source/web-clips → WeKnora ingestion → ready. documentId is returned only after a real ingestion mapping exists.',
      'clip.preview': 'Preview',
      'clip.result': 'Result',

      /* ---- P2: BrowserSkill bridge ---- */
      'mod.browser': 'Browser',
      'mod.browser.desc': 'BrowserSkill coordination: dynamic pages / login-gated capture and file downloads',
      'brow.conn': 'Connection',
      'brow.conn.ok': 'Connected: {browser} (bsk {ver})',
      'brow.conn.off': 'Disconnected',
      'brow.conn.loading': 'Probing',
      'brow.conn.unknown': 'Unknown',
      'brow.conn.unsupported': 'Bridge not implemented',
      'brow.conn.mock': 'Demo mode: simulated Edge + bsk daemon, not a real connection.',
      'brow.conn.notimpl': 'The gateway does not expose /api/v1/browser/status: an A-side bridge plus a local bsk daemon are required; we do not fake a connection.',
      'brow.notimpl': 'HTTP mode cannot drive a browser yet: until the official BrowserSkill DSH plugin and the A-side bridge are wired in, task creation is disabled (demo mode shows the full flow).',
      'brow.session.isolated': 'Tasks are isolated per DSH session: switching sessions hides other tasks; late results never leak across.',
      'brow.session.none': 'No session header control detected: task mapping requires it to appear first.',
      'brow.new': 'New task',
      'brow.task.type': 'Task type',
      'brow.task.table': 'Capture dynamic table',
      'brow.task.download': 'Download file',
      'brow.run': 'Start',
      'brow.pause': 'Pause',
      'brow.resume': 'Resume',
      'brow.cancel': 'Cancel',
      'brow.login.need': 'The page requires login: finish login / human verification in the browser, then press "Login done".',
      'brow.login.done': 'Login done',
      'brow.login.hint': 'URLs containing login / portal will ask for login first; the user logs in — the daemon never types credentials.',
      'brow.tasks': 'Tasks',
      'brow.none': 'No browser tasks in this session yet.',
      'brow.st.running': 'Running',
      'brow.st.paused': 'Paused',
      'brow.st.login': 'Waiting for login',
      'brow.st.done': 'Done',
      'brow.st.cancelled': 'Cancelled',
      'brow.st.discarded': 'Late result discarded',
      'brow.discard.note': 'Results arriving after cancellation are not imported: this one was dropped.',
      'brow.send': 'Send to Capture tab',
      'brow.verify.ok': 'File intact: {name} · {size}',
      'brow.note': 'Browser operations never write to knowledge bases directly: results become capture candidates and are confirmed in the Capture tab.',

      /* ---- P4: batch import ---- */
      'mod.batch': 'Batch import',
      'nav.kb': 'Knowledge bases',
      'nav.search': 'Search',
      'nav.qa': 'Q&A',
      'nav.sub.docs': 'Documents',
      'nav.sub.wiki': 'Wiki',
      'nav.import': 'Import materials',
      'nav.import.upload': 'Upload files',
      'nav.import.clip': 'Web pages and notes',
      'nav.import.browser': 'Browser capture',
      'nav.import.batch': 'Batch import',
      'nav.back': 'Back to knowledge bases',
      'panel.features': 'Feature areas',
      'panel.features.desc': 'Central entry for plugins and connection issues.',
      'settings.plugins': 'Plugin center',
      'settings.diag': 'Diagnostics',
      'mod.batch.desc': 'Bulk-import Markdown engineering notes: per-item idempotency, resumable after failures',
      'batch.target': 'Target knowledge base',
      'batch.add': 'Add note',
      'batch.add.ph': 'Note title…',
      'batch.file': 'Import .md files',
      'batch.demo': 'Load demo batch (3 notes, 1 fails once)',
      'batch.list': 'Import list',
      'batch.start': 'Start import',
      'batch.retry': 'Retry failed',
      'batch.remove': 'Remove',
      'batch.st.queued': 'Queued',
      'batch.st.running': 'Importing',
      'batch.st.done': 'Imported',
      'batch.st.failed': 'Failed',
      'batch.st.skipped': 'Skipped (exists)',
      'batch.report': 'Report',
      'batch.report.line': 'Succeeded {ok} · failed {fail} · skipped {skip}',
      'batch.empty': 'The list is empty: paste or import Markdown notes to begin.',
      'batch.hint': 'Each note is idempotent by "library + note + content hash": reruns skip succeeded items; failures retry individually.',
      'panel.sourceHint': 'Data source: demo mode uses local simulated data; HTTP mode connects directly to the gateway.',

      'scope.popover.title': 'Knowledge bases in this session',
      'scope.popover.empty': 'Nothing to select yet',
      'scope.popover.localOnly': 'Selection is stored locally only; module 1 will persist it on the gateway.',
      'scope.popover.clear': 'Clear',

      'err.network': 'Request failed: {msg}',
      'err.timeout': 'Timeout after {s}s',
      'err.http': 'HTTP {status}',
      'err.notImplemented': 'The gateway does not serve this endpoint yet',
      'tag.unverified': 'Not integrated',
    },
  };

  /* ----------------------------------------------------------------- 样式 */

  const CSS = `
/* 变量挂在 .sch-tokens 上而不是 .sch-root：Session 头部的范围控件在 .sch-root 之外，
   少了这层，弹层背景会变成透明、文字回到宿主默认色。 */
.sch-tokens{
  /* 全部设计 token 只在这里定义一次；DESIGN.md 的 colors 与这张表一一对应，
     深色只覆盖需要变的键，不另起一套。改色先改这里，再改 DESIGN.md。 */
  --sch-bg: var(--dsw-alias-bg-base,#FFFFFF);
  /* 面：不再取宿主的 layer-1/2。宿主明亮态的两级面只差 1–2%，卡片在纯白底上
     等于消失；这里自己给一档看得见但仍克制的灰（与暗色 121212→181818 的层次对应）。 */
  --sch-layer:#F1F3F1;
  --sch-layer-2:#E7EBE8;
  --sch-border: var(--dsw-alias-border-l3,rgba(16,24,20,.14));
  --sch-border-soft: var(--dsw-alias-border-l2,rgba(16,24,20,.08));
  --sch-text: var(--dsw-alias-label-primary,#17251E);
  --sch-text-2: var(--dsw-alias-label-secondary,#5A6560);
  /* 三级文字：宿主给的是 #8A948F（白底 3.2:1，不到 4.5），时间戳/说明会发虚 */
  --sch-text-3:#6C7671;
  --sch-hover: var(--dsw-alias-interactive-bg-hover,rgba(16,24,20,.05));
  --sch-green:#00642F;
  --sch-green-2:#00783A;
  /* 品牌绿：2026-11-17 起字标图自带透明底 + 绿字，不再用它铺底板；
     保留给顶栏 fallback 字符，保证两主题下字标位都是品牌绿。 */
  --sch-brand-green:#00642F;
  --sch-on-green:#FFFFFF;
  /* 浅绿底：绝不能取宿主的 success-secondary——DSH 明亮态把它定义成实心亮绿，
     整块铺在气泡和选中的会话上就是荧光笔效果。这里用品牌绿的 8% 提亮版。 */
  --sch-green-tint:#E8F3EC;
  --sch-ok:#0B7A3B;
  --sch-warn:#9A5B00;
  --sch-warn-bg:#FFF4E0;
  --sch-err:#B42318;
  --sch-err-bg:#FDECEC;
  --sch-plate:#FFFFFF;
  --sch-scrim:rgba(8,16,11,.32);
  --sch-focus-ring:rgba(0,120,58,.24);
  --sch-gloss:rgba(255,255,255,.22);
  --sch-gloss-strong:rgba(255,255,255,.55);
  --sch-shadow-1:0 1px 2px rgba(10,20,15,.06);
  --sch-shadow-2:0 8px 24px rgba(10,20,15,.12);
  --sch-shadow-3:0 8px 24px rgba(10,20,15,.20);
  /* 向上投影：给贴底的输入区做分隔，避免它在消息滚过时有「浮起来」的错觉 */
  --sch-shadow-up:0 -10px 20px -18px rgba(10,20,15,.28);
  --sch-radius:12px;
  --sch-radius-sm:8px;
  --sch-mono:var(--ds-font-family-code,ui-monospace,SFMono-Regular,Menlo,Consolas,monospace);
  color:var(--sch-text);
  font-family:var(--ds-font-family-body,-apple-system,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif);
}
.sch-root{
  box-sizing:border-box;height:100%;overflow-y:auto;background:var(--sch-bg);
  font-size:13px;line-height:1.6;
}
/* 暗色 token：宿主切暗色时生效（面板不自己管主题，跟随宿主是唯一来源）。 */
body[data-ds-dark-theme]:not([data-ds-dark-theme='false']) .sch-tokens{
  --sch-bg: var(--dsw-alias-bg-base,#121212);
  --sch-layer: var(--dsw-alias-bg-layer-1,#181818);
  --sch-layer-2: var(--dsw-alias-bg-layer-2,#1F1F1F);
  --sch-border: var(--dsw-alias-border-l3,rgba(255,255,255,.14));
  --sch-border-soft: var(--dsw-alias-border-l2,rgba(255,255,255,.08));
  --sch-text: var(--dsw-alias-label-primary,#E8ECE9);
  --sch-text-2:#B3B8B4;
  --sch-text-3:#8A918C;
  --sch-hover: var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.06));
  --sch-green:#2C8F55;
  --sch-green-2:#34A363;
  --sch-brand-green:#00642F;
  --sch-green-tint:rgba(0,140,60,.16);
  --sch-ok:#4FBF7F;
  --sch-warn:#E0A253;
  --sch-warn-bg:rgba(180,110,0,.16);
  --sch-err:#F0726A;
  --sch-err-bg:rgba(180,35,24,.16);
  --sch-scrim:rgba(0,0,0,.48);
  --sch-focus-ring:rgba(52,163,99,.32);
  --sch-gloss:rgba(255,255,255,.10);
  --sch-gloss-strong:rgba(255,255,255,.10);
  --sch-shadow-1:0 1px 2px rgba(0,0,0,.40);
  --sch-shadow-2:0 8px 24px rgba(0,0,0,.50);
  --sch-shadow-3:0 8px 24px rgba(0,0,0,.55);
  --sch-shadow-up:0 -10px 20px -18px rgba(0,0,0,.55);
}
.sch-root *{box-sizing:border-box}
.sch-content::-webkit-scrollbar{width:8px}
.sch-content::-webkit-scrollbar-thumb{border-radius:8px;background:var(--sch-border)}
.sch-content::-webkit-scrollbar-track{background:transparent}
  .sch-main{flex:1 1 auto;min-width:0;min-height:0;display:flex;flex-direction:column;background:var(--sch-bg)}
  .sch-main-actions{display:flex;align-items:center;gap:6px;flex:none}
  .sch-content{flex:1 1 auto;min-width:0;min-height:0;overflow-y:auto;scrollbar-width:thin;
    scrollbar-color:var(--sch-border) transparent;padding:10px 28px 24px;display:flex;flex-direction:column}
.sch-modwrap{flex:1 0 auto;display:flex;flex-direction:column}
.sch-modbody{display:flex;flex-direction:column;gap:12px;flex:1 0 auto}
.sch-toolbar{display:flex;align-items:center;gap:10px;flex-wrap:wrap;min-height:30px}
.sch-toolbar-title{font-size:13px;font-weight:600}
.sch-toolbar-meta{font-size:11px;color:var(--sch-text-3)}
.sch-toolbar-spacer{flex:1 1 auto}
.sch-tools{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.sch-btn{display:inline-flex;align-items:center;gap:6px;height:28px;padding:0 10px;border-radius:8px;
  border:1px solid var(--sch-border);background:transparent;color:var(--sch-text);font:inherit;font-size:12px;
  cursor:pointer;white-space:nowrap;transition:background .15s,border-color .15s}
.sch-btn:hover{background:var(--sch-hover)}
.sch-btn:focus-visible{outline:2px solid var(--sch-green-2);outline-offset:1px}
.sch-btn[disabled]{opacity:.5;cursor:default}
.sch-btn.icon{width:28px;padding:0;justify-content:center}
.sch-btn.sm{height:26px;padding:0 9px;font-size:12px;gap:5px}
.sch-btn.icon.sm{width:26px;padding:0}
.sch-btn.primary{background:var(--sch-green);border-color:var(--sch-green);color:var(--sch-on-green)}
.sch-btn.primary:hover{background:var(--sch-green-2);border-color:var(--sch-green-2)}
.sch-badge{display:inline-flex;align-items:center;gap:5px;height:19px;padding:0 6px;border-radius:4px;
  font-size:11px;line-height:1;border:1px solid transparent;white-space:nowrap}
.sch-badge.mock{background:var(--sch-warn-bg);color:var(--sch-warn)}
.sch-badge.live{background:var(--sch-green-tint);color:var(--sch-green)}
.sch-badge.plain{background:var(--sch-layer-2);color:var(--sch-text-2)}
.sch-badge.warn{background:var(--sch-warn-bg);color:var(--sch-warn)}
.sch-badge.err{background:var(--sch-err-bg);color:var(--sch-err)}
.sch-dot{width:7px;height:7px;border-radius:50%;flex:none;background:var(--sch-text-3)}
.sch-dot.ok{background:var(--sch-ok)}
.sch-dot.warn{background:var(--sch-warn)}
.sch-dot.err{background:var(--sch-err)}
.sch-dot.busy{background:var(--sch-text-3);animation:sch-pulse 1.1s ease-in-out infinite}
@keyframes sch-pulse{0%,100%{opacity:.35}50%{opacity:1}}
.sch-card-desc{font-size:11px;color:var(--sch-text-3);margin-top:4px}
.sch-mono{font-family:var(--sch-mono);font-size:12px}
.sch-section{margin-top:20px}
.sch-section-title{font-size:12px;font-weight:600;letter-spacing:.01em}
.sch-section-title::before{content:none}
.sch-section-meta{font-size:11px;color:var(--sch-text-3)}
.sch-table{border:1px solid var(--sch-border-soft);border-radius:8px;overflow:hidden;background:var(--sch-bg)}
.sch-tr{display:grid;grid-template-columns:minmax(0,1fr) 96px 104px 64px;gap:10px;align-items:center;
  padding:11px 14px;border-top:1px solid var(--sch-border-soft)}
.sch-tr:first-child{border-top:0}
.sch-tr.head{background:var(--sch-green-tint);color:var(--sch-text-2);font-size:11px;padding:8px 14px}
.sch-tr.body:hover{background:var(--sch-hover)}
.sch-kb-name{font-weight:600;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sch-kb-desc{font-size:11px;color:var(--sch-text-3);margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sch-empty{border:1px solid var(--sch-border-soft);border-radius:12px;padding:24px 20px;text-align:center;background:var(--sch-layer)}
.sch-empty-title{font-size:13px;font-weight:600}
.sch-empty-desc{font-size:12px;color:var(--sch-text-2);margin-top:6px;max-width:460px;margin-left:auto;margin-right:auto}
.sch-skel{height:44px;border-radius:8px;background:linear-gradient(90deg,var(--sch-layer) 25%,var(--sch-layer-2) 37%,var(--sch-layer) 63%);
  background-size:400% 100%;animation:sch-shimmer 1.4s ease infinite;margin-top:8px}
@keyframes sch-shimmer{0%{background-position:100% 0}100%{background-position:0 0}}
.sch-alert{display:flex;gap:10px;align-items:flex-start;padding:10px 12px;border-radius:var(--sch-radius-sm);
  background:var(--sch-warn-bg);color:var(--sch-warn);font-size:12px;margin-top:12px}
.sch-alert.err{background:var(--sch-err-bg);color:var(--sch-err)}
.sch-chip{display:inline-flex;align-items:center;gap:7px;height:26px;padding:0 9px;border-radius:999px;
  border:1px solid var(--sch-border);background:transparent;color:var(--sch-text-2);font:inherit;font-size:12px;cursor:pointer}
.sch-chip:hover{background:var(--sch-hover);color:var(--sch-text)}
.sch-chip .sch-badge{height:18px;padding:0 6px;font-size:10.5px}
.sch-pop{position:absolute;top:calc(100% + 6px);right:0;left:auto;z-index:60;
  width:min(360px,calc(100vw - 24px));max-height:min(70vh,520px);overflow-y:auto;padding:12px;border-radius:var(--sch-radius);
  background:var(--sch-bg);border:1px solid var(--sch-border);box-shadow:var(--sch-shadow-3)}
.sch-pop-title{font-size:12px;font-weight:700;margin-bottom:8px}
.sch-popmenu{width:176px;padding:5px;overflow:visible}
.sch-popmenu button{display:flex;align-items:center;gap:9px;width:100%;height:32px;padding:0 9px;border:0;
  border-radius:8px;background:none;color:var(--sch-text-2);font:inherit;font-size:12px;cursor:pointer;text-align:left}
.sch-popmenu button:hover{background:var(--sch-hover);color:var(--sch-text)}
.sch-popmenu .sep{height:1px;background:var(--sch-border-soft);margin:5px 4px}
.sch-pop-row{display:flex;align-items:center;gap:8px;padding:7px 6px;border-radius:8px;cursor:pointer}
.sch-pop-row:hover{background:var(--sch-hover)}
.sch-pop-row span{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px}
.sch-pop-note{font-size:11px;color:var(--sch-text-3);margin-top:8px;line-height:1.5}
.sch-pop-actions{display:flex;gap:8px;margin-top:10px}
.sch-drawer{position:fixed;top:0;right:0;bottom:0;width:min(460px,92vw);z-index:80;background:var(--sch-bg);
  border-left:1px solid var(--sch-border);box-shadow:var(--sch-shadow-3);padding:20px;overflow-y:auto}
.sch-drawer-head{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:12px}
.sch-kv{display:grid;grid-template-columns:104px minmax(0,1fr);gap:8px 10px;font-size:12px;margin-top:10px}
.sch-kv dt{color:var(--sch-text-3)}
.sch-kv dd{margin:0;color:var(--sch-text);word-break:break-all}
.sch-pre{margin:10px 0 0;padding:10px;border-radius:8px;background:var(--sch-layer);border:1px solid var(--sch-border-soft);
  font-family:var(--sch-mono);font-size:11px;line-height:1.55;white-space:pre-wrap;word-break:break-all;max-height:280px;overflow:auto}
.sch-field{display:flex;flex-direction:column;gap:6px;margin-top:12px}
.sch-field label{font-size:12px;color:var(--sch-text-2)}
.sch-input{height:32px;padding:0 10px;border-radius:8px;border:1px solid var(--sch-border);background:var(--sch-bg);
  color:var(--sch-text);font:inherit;font-size:12px;width:100%}
.sch-input:focus{outline:2px solid var(--sch-green-2);outline-offset:-1px}
.sch-seg{display:inline-flex;padding:2px;border-radius:8px;background:var(--sch-layer-2);gap:2px}
.sch-seg button{height:26px;padding:0 10px;border:0;border-radius:6px;background:transparent;color:var(--sch-text-2);
  font:inherit;font-size:12px;cursor:pointer}
.sch-seg button.on{background:var(--sch-bg);color:var(--sch-text);box-shadow:var(--sch-shadow-1)}
.sch-row{display:flex;align-items:center;justify-content:space-between;gap:10px}

/* --------------------------------------------------- 品牌 / 面包屑 / 横幅 */
.sch-plate{display:inline-flex;align-items:center;justify-content:center;flex:none;
  background:var(--sch-plate);border-radius:8px;border:1px solid var(--sch-border-soft)}
.sch-plate img{display:block;width:100%;height:100%;object-fit:contain}
.sch-crumb{display:flex;align-items:center;gap:6px;font-size:12px;color:var(--sch-text-3);margin-bottom:12px;flex-wrap:wrap}
.sch-crumb button{display:inline-flex;align-items:center;gap:4px;border:0;background:none;padding:0;color:var(--sch-text-2);
  font:inherit;font-size:12px;cursor:pointer;border-radius:8px}
.sch-crumb button:hover{color:var(--sch-text);text-decoration:underline}
.sch-strip{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-top:12px;padding:0 0 10px;
  border-bottom:1px solid var(--sch-border-soft);font-size:11px;color:var(--sch-text-3)}
.sch-strip b{font-weight:600;color:var(--sch-text-2)}
.sch-strip .sep{width:1px;height:12px;background:var(--sch-border)}

/* --------------------------------------------------------- 知识库卡片 */
.sch-kbhead{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:0 0 16px}
.sch-search{position:relative;display:flex;align-items:center;flex:1 1 260px;max-width:300px}
.sch-search svg{position:absolute;left:9px;width:15px;height:15px;color:var(--sch-text-3);pointer-events:none}
.sch-search input{height:32px;width:100%;padding:0 26px 0 30px;border-radius:8px;border:1px solid var(--sch-border);
  background:var(--sch-bg);color:var(--sch-text);font:inherit;font-size:12px}
.sch-search input::placeholder{color:var(--sch-text-3)}
.sch-search input:focus{outline:none;border-color:var(--sch-green-2);box-shadow:0 0 0 3px var(--sch-green-tint)}
.sch-search-key{position:absolute;right:7px;top:50%;transform:translateY(-50%);height:17px;padding:0 5px;
  display:flex;align-items:center;border:1px solid var(--sch-border);border-radius:4px;background:var(--sch-bg);
  font-family:var(--sch-mono);font-size:10.5px;color:var(--sch-text-3);pointer-events:none}
.sch-search:focus-within .sch-search-key{display:none}
.sch-kbgrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(268px,1fr));gap:16px;align-content:start}
.sch-kbcard{display:flex;flex-direction:column;padding:16px 16px 12px;border:1px solid var(--sch-border-soft);
  border-radius:12px;background:var(--sch-bg);text-align:left;font:inherit;color:inherit;cursor:pointer;
  transition:border-color .15s,box-shadow .15s,transform .15s}
.sch-kbcard:hover{border-color:var(--sch-green-2);box-shadow:var(--sch-shadow-2);transform:translateY(-1px)}
.sch-kbcard:focus-visible{outline:2px solid var(--sch-green-2);outline-offset:2px}
.sch-kbcard-top{display:flex;align-items:flex-start;gap:11px;min-width:0}
.sch-kbcard-tile{width:38px;height:38px;border-radius:8px;flex:none;display:flex;align-items:center;
  justify-content:center;background:var(--sch-green-tint);color:var(--sch-ok)}
.sch-kbcard-tile svg{width:19px;height:19px}
.sch-kbcard-head{min-width:0;flex:1 1 auto}
.sch-kbcard-name{font-size:14px;font-weight:600;line-height:1.35;color:var(--sch-text);
  display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;word-break:break-word}
.sch-kbcard-kind{font-size:11px;color:var(--sch-text-3);margin-top:3px}
.sch-kbcard-desc{flex:1 1 auto;font-size:12px;line-height:1.6;color:var(--sch-text-2);margin-top:12px;
  display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;word-break:break-word}
.sch-kbcard-desc.muted{color:var(--sch-text-3)}
.sch-kbcard-foot{display:flex;align-items:center;gap:12px;margin-top:12px;padding-top:10px;
  border-top:1px solid var(--sch-border-soft);font-size:11px;color:var(--sch-text-3);white-space:nowrap}
.sch-kbcard-stat{font-variant-numeric:tabular-nums}
.sch-kbcard-time{margin-left:auto;font-variant-numeric:tabular-nums}
.sch-empty-brand{display:flex;flex-direction:column;align-items:center;gap:10px;padding:32px 20px;
  border:1px solid var(--sch-border-soft);border-radius:12px;background:var(--sch-layer);text-align:center}
.sch-empty-brand .sch-side-name{align-items:center;margin-top:2px}
.sch-empty-brand .sch-side-name b{font-size:16px}

/* ------------------------------------------------------------- 文档表 */
.sch-dtr{display:grid;grid-template-columns:minmax(0,1fr) 150px 84px 96px 56px;gap:10px;align-items:center;
  padding:10px 12px;border-top:1px solid var(--sch-border-soft);cursor:pointer}
.sch-dtr:first-child{border-top:0}
.sch-dtr.head{background:transparent;color:var(--sch-text-3);font-size:11px;letter-spacing:.04em;
  padding:7px 12px;cursor:default;border-bottom:1px solid var(--sch-border)}
.sch-dtr.body:hover{background:var(--sch-hover)}
.sch-status{display:inline-flex;align-items:center;gap:6px;font-size:12px;min-width:0;white-space:nowrap}
.sch-status .hint{color:var(--sch-text-3);font-size:11px}
@media (max-width:880px){
  .sch-dtr{grid-template-columns:minmax(0,1fr) 128px 56px}
  .sch-dtr .col-size,.sch-dtr .col-time{display:none}
}

/* --------------------------------------------------------------- 上传区 */
.sch-drop{border:1px dashed var(--sch-border);border-radius:8px;padding:16px;text-align:center;
  background:transparent;transition:background .15s,border-color .15s}
.sch-drop.over{border-color:var(--sch-green-2);background:var(--sch-green-tint)}
.sch-drop.over .sch-drop-title{color:var(--sch-ok)}
.sch-drop-title{font-size:13px;font-weight:700;display:flex;align-items:center;justify-content:center;gap:8px;flex-wrap:wrap}
.sch-drop-note{font-size:11px;color:var(--sch-text-3);margin-top:5px}
.sch-linkbtn{border:0;background:none;padding:0;color:var(--sch-green-2);font:inherit;font-size:12px;cursor:pointer;text-decoration:underline;text-underline-offset:2px}
.sch-linkbtn:hover{color:var(--sch-green)}
.sch-queue{margin-top:10px;display:flex;flex-direction:column;gap:6px}
.sch-qitem{display:flex;align-items:center;gap:10px;padding:8px 10px;border:1px solid var(--sch-border-soft);
  border-radius:8px;background:var(--sch-bg);font-size:12px;min-width:0}
.sch-qname{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sch-bar{width:110px;height:4px;border-radius:999px;background:var(--sch-layer-2);overflow:hidden;flex:none}
.sch-bar > i{display:block;height:100%;background:var(--sch-green-2);transition:width .18s}
.sch-bar.err > i{background:var(--sch-err)}
.sch-qmeta{color:var(--sch-text-3);font-size:11px;flex:none}

/* --------------------------------------------------------------- 详情抽屉 */
.sch-drawer.wide{width:min(580px,96vw);padding:0;display:flex;flex-direction:column}
.sch-drawer-head.sticky{margin:0;padding:16px 20px 12px;border-bottom:1px solid var(--sch-border-soft);
  position:sticky;top:0;background:var(--sch-bg);z-index:2}
.sch-drawer-title{font-size:14px;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sch-drawer-sub{font-size:11px;color:var(--sch-text-3);margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sch-tabs{display:flex;gap:2px;padding:0 20px;border-bottom:1px solid var(--sch-border-soft);flex:none}
.sch-tabbtn{height:36px;padding:0 10px;border:0;background:none;color:var(--sch-text-2);font:inherit;font-size:12px;
  cursor:pointer;border-bottom:2px solid transparent;margin-bottom:-1px}
.sch-tabbtn:hover{color:var(--sch-text)}
.sch-tabbtn.on{color:var(--sch-text);border-bottom-color:var(--sch-green)}
.sch-drawer-body{padding:16px 20px 28px;overflow-y:auto;flex:1 1 auto;min-height:0}

/* --------------------------------------------------------------- 处理轨迹 */
.sch-stages{margin-top:6px}
.sch-stage{display:flex;gap:10px;align-items:flex-start;padding:9px 0;position:relative}
.sch-stage + .sch-stage{border-top:1px dashed var(--sch-border-soft)}
.sch-stage-idx{width:20px;height:20px;border-radius:50%;flex:none;display:flex;align-items:center;justify-content:center;
  font-size:10.5px;font-variant-numeric:tabular-nums;background:var(--sch-layer-2);color:var(--sch-text-2);margin-top:1px}
.sch-stage-idx.done{background:var(--sch-green-tint);color:var(--sch-ok)}
.sch-stage-idx.failed{background:var(--sch-err-bg);color:var(--sch-err)}
.sch-stage-idx.running{background:var(--sch-layer-2);color:var(--sch-text-2);animation:sch-pulse 1.1s ease-in-out infinite}
.sch-stage-main{flex:1 1 auto;min-width:0}
.sch-stage-name{font-size:12px;font-weight:600;display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.sch-stage-meta{font-size:11px;color:var(--sch-text-3);margin-top:2px}
.sch-empty-inline{font-size:12px;color:var(--sch-text-3);padding:12px 0}

/* --------------------------------------------------------------- 分块 */
.sch-chunk{border:1px solid var(--sch-border-soft);border-radius:8px;padding:10px 12px;margin-top:8px;background:var(--sch-layer)}
.sch-chunk-head{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:11px;color:var(--sch-text-3);margin-bottom:6px}
.sch-chunk-idx{font-weight:700;color:var(--sch-text-2);font-variant-numeric:tabular-nums}
.sch-chunk-text{font-size:12px;line-height:1.72;white-space:pre-wrap;word-break:break-word;color:var(--sch-text)}
.sch-chunk-text.clamp{display:-webkit-box;-webkit-line-clamp:4;-webkit-box-orient:vertical;overflow:hidden}
.sch-pager{display:flex;align-items:center;gap:8px;margin-top:12px;flex-wrap:wrap}
.sch-pager .meta{font-size:11px;color:var(--sch-text-3)}


/* ------------------------------------------------- 模块清单 / 未接入模块 */
.sch-planned{max-width:660px;padding:16px;border:1px solid var(--sch-border-soft);border-radius:8px;background:var(--sch-layer)}
.sch-planned-tag{display:inline-block;font-size:10.5px;letter-spacing:.08em;color:var(--sch-text-3)}
.sch-planned-title{font-size:13px;font-weight:600;margin-top:2px}
.sch-planned-desc{font-size:12px;color:var(--sch-text-2);margin-top:6px;line-height:1.7}
.sch-reqs{display:flex;flex-wrap:wrap;gap:6px;margin-top:12px}
.sch-reqs.tight{margin-top:6px}
.sch-req-head{width:100%;font-size:11px;color:var(--sch-text-3)}
.sch-req{font-family:var(--sch-mono);font-size:11px;padding:2px 6px;border-radius:4px;
  background:var(--sch-layer-2);color:var(--sch-text-2);white-space:nowrap}
.sch-pickrow{display:flex;align-items:center;gap:10px;width:100%;padding:9px 12px;border:0;
  border-top:1px solid var(--sch-border-soft);background:transparent;color:var(--sch-text);font:inherit;
  text-align:left;cursor:pointer}
.sch-pickrow:first-child{border-top:0}
.sch-pickrow:hover{background:var(--sch-hover)}
.sch-pickrow-main{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;gap:2px}
.sch-pickrow .num{color:var(--sch-text-3);font-size:12px;flex:none}
.sch-modlist{margin-top:10px;border:1px solid var(--sch-border-soft);border-radius:8px;overflow:hidden}
.sch-modrow{display:flex;gap:10px;align-items:flex-start;padding:10px 12px;border-top:1px solid var(--sch-border-soft)}
.sch-modrow:first-child{border-top:0}
.sch-modrow .sch-dot{margin-top:6px}
.sch-modrow-main{min-width:0;flex:1 1 auto}
.sch-modrow-title{display:flex;align-items:center;gap:8px;font-size:12px;font-weight:600}
.sch-modrow-code{font-size:10.5px;color:var(--sch-text-3);font-weight:400}
.sch-modrow-meta{font-size:11px;color:var(--sch-text-3);margin-top:2px}
@media (max-width:900px){
  .sch-pagehint{display:none}
  .sch-content{padding:4px 16px 20px}
  .sch-top{padding:0 12px}
  .sch-kbgrid{grid-template-columns:1fr}
}

/* --------------------------------------------------------------- 提示条 */
.sch-toast{position:sticky;top:0;z-index:40;display:flex;align-items:center;gap:8px;margin-top:12px;padding:8px 12px;
  border-radius:12px;background:var(--sch-green-tint);color:var(--sch-ok);font-size:12px;border:1px solid transparent}
.sch-toast.err{background:var(--sch-err-bg);color:var(--sch-err)}
.sch-toast button{margin-left:auto;border:0;background:none;color:inherit;cursor:pointer;padding:0;display:flex}

/* 浮层警示（全站统一）：贴面板顶部浮在内容之上，不占布局、不推内容；可堆叠、逐条可关。
   以前各页面自己画一块满宽 sch-alert，一报错就把整页顶下去，看起来像排版坏了。 */
.sch-noticestack{position:absolute;top:50px;left:0;right:0;z-index:48;display:flex;flex-direction:column;
  align-items:center;gap:6px;padding:0 16px;pointer-events:none}
.sch-notice{pointer-events:auto;display:flex;align-items:center;gap:8px;max-width:min(640px,100%);
  padding:3px 6px 3px 10px;border-radius:999px;background:var(--sch-err-bg);color:var(--sch-err);
  border:1px solid var(--sch-border-soft);box-shadow:var(--sch-shadow-2);
  font-size:12px;line-height:1.5;animation:sch-pop-in .14s ease-out both}
.sch-notice.warn{background:var(--sch-warn-bg);color:var(--sch-warn)}
/* 成功态：和错误/警告同一条壳，只换颜色与图标 —— 一屏内所有反馈长得一样，用户不用重新认 */
.sch-notice.ok{background:var(--sch-green-tint);color:var(--sch-ok)}
.sch-notice-main{display:flex;align-items:center;gap:7px;min-width:0}
.sch-notice-msg{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sch-notice>svg{flex:none;width:14px;height:14px}
.sch-notice b{flex:none;font-weight:600;letter-spacing:.01em}
.sch-notice-txt{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sch-notice-btn{flex:none;border:0;background:none;color:inherit;font:inherit;font-size:12px;font-weight:600;
  padding:2px 7px;border-radius:999px;cursor:pointer}
.sch-notice-btn:hover{background:var(--sch-hover)}
.sch-notice-x{flex:none;display:flex;border:0;background:none;color:inherit;padding:3px;border-radius:999px;
  cursor:pointer;opacity:.7}
.sch-notice-x:hover{opacity:1;background:var(--sch-hover)}
.sch-notice-x svg{width:12px;height:12px}
.sch-dup{position:fixed;left:50%;top:18%;transform:translateX(-50%);z-index:90;width:min(520px,92vw);
  padding:16px;border-radius:12px;background:var(--sch-bg);border:1px solid var(--sch-border);
  box-shadow:var(--sch-shadow-3)}
.sch-scrim{position:fixed;inset:0;z-index:85;background:var(--sch-scrim)}
.sch-dup-list{margin:8px 0 0;padding-left:18px;font-size:12px;color:var(--sch-text-2);max-height:160px;overflow:auto}
.sch-dup-list li{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}

/* ----------------------------------------------------------------- 动效
   原则：只动 opacity/transform；120–200ms；ease-out；不做弹跳/炫技。
   系统开了「减少动态效果」就全部关掉（无障碍底线）。 */
@keyframes sch-fade{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}
@keyframes sch-pop-in{from{opacity:0;transform:translateY(-4px) scale(.985)}to{opacity:1;transform:none}}
@keyframes sch-slide-in{from{opacity:0;transform:translateX(12px)}to{opacity:1;transform:none}}
@keyframes sch-fade-in{from{opacity:0}to{opacity:1}}
@keyframes sch-dup-in{from{opacity:0;transform:translateX(-50%) translateY(8px)}to{opacity:1;transform:translateX(-50%)}}
@keyframes sch-pulse{0%,100%{opacity:1}50%{opacity:.35}}
.sch-modwrap{animation:sch-fade .18s ease-out both}
.sch-pop,.sch-popmenu{animation:sch-pop-in .14s ease-out both;transform-origin:top right}
.sch-drawer{animation:sch-slide-in .2s cubic-bezier(.22,1,.36,1) both}
.sch-dup{animation:sch-dup-in .16s ease-out both}
.sch-scrim,.sch-toast{animation:sch-fade-in .16s ease-out both}
.sch-dot.busy{animation:sch-pulse 1.1s ease-in-out infinite}
.sch-btn{transition:background-color .12s ease,border-color .12s ease,color .12s ease}
.sch-btn:active{transform:translateY(.5px)}
/* ---- 模块 4：检索 ---- */
.sch-searchbar{display:flex;flex-direction:column;gap:6px}
.sch-searchbox{display:flex;align-items:center;gap:8px;color:var(--sch-text-3);flex:1 1 auto;min-width:0;max-width:520px}
.sch-search-input{flex:1 1 auto;height:34px}
.sch-scoperow{display:flex;align-items:center;gap:6px;flex-wrap:wrap;padding:2px 0 6px}
.sch-scoperow.compact{padding:0 0 8px}
.sch-agent-picker{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px}
.sch-agent-picker select{min-width:0;max-width:100%}
.sch-scoperow-label{font-size:10.5px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;
  color:var(--sch-text-3);margin-right:2px}
.sch-scopechip{height:24px;padding:0 9px;border-radius:999px;border:1px solid var(--sch-border);
  background:transparent;color:var(--sch-text-2);font:inherit;font-size:11px;cursor:pointer;
  max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
  transition:background .14s,border-color .14s,color .14s}
.sch-scopechip:hover{background:var(--sch-hover)}
.sch-scopechip.on{background:var(--sch-green-tint);border-color:var(--sch-green);color:var(--sch-green);font-weight:600}
.sch-note{font-size:11px;color:var(--sch-text-3)}
.sch-note.warn{color:var(--sch-warn)}
.sch-hits{display:flex;flex-direction:column;gap:8px;margin-top:2px}
.sch-hit{border:1px solid var(--sch-border-soft);border-radius:var(--sch-radius);background:var(--sch-layer);
  padding:10px 12px;transition:border-color .15s,background .15s}
.sch-hit:hover{border-color:var(--sch-border)}
.sch-hit.open{background:var(--sch-bg);border-color:var(--sch-border)}
.sch-hit-head{display:flex;align-items:center;gap:8px;flex-wrap:wrap;min-width:0}
.sch-hit-idx{width:18px;height:18px;border-radius:4px;background:var(--sch-layer-2);color:var(--sch-text-3);
  font-size:10.5px;font-weight:700;display:flex;align-items:center;justify-content:center;flex:none;
  font-variant-numeric:tabular-nums}
.sch-hit-title{font-size:12px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
  max-width:min(420px,58%)}
.sch-hit-meta,.sch-hit-kb{font-size:11px;color:var(--sch-text-3)}
.sch-hit-body{margin:8px 0 0;font-size:12px;line-height:1.7;color:var(--sch-text-2);white-space:pre-wrap;
  display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.sch-hit-body.open{display:block;-webkit-line-clamp:unset;color:var(--sch-text)}
.sch-hit-foot{display:flex;align-items:center;gap:10px;margin-top:8px;min-height:16px}
.sch-hit-foot .sch-linkbtn{margin-left:auto;font-size:11px;line-height:1.2;white-space:nowrap}

/* ---- 模块 5：问答 ---- */
/* 问答页要「整块贴合内容区」：消息流自己滚，输入区常驻底部。
   fit 由模块注册里的 fit:true 打开（见 .sch-modwrap.fit）；overflow:clip 只裁圆角、不建滚动容器。 */
.sch-chat{display:flex;flex:1 1 auto;min-height:380px;min-width:0;
  border:1px solid var(--sch-border-soft);border-radius:var(--sch-radius);
  overflow:hidden;overflow:clip;background:var(--sch-bg)}
.sch-modwrap.fit{flex:1 1 auto;min-height:0}
.sch-modwrap.fit > .sch-modbody{flex:1 1 auto;min-height:0}
.sch-modwrap.fit .sch-chat{flex:1 1 auto;min-height:0}
.sch-chat-side{width:184px;flex:none;display:flex;flex-direction:column;padding:10px;
  border-right:1px solid var(--sch-border-soft);background:var(--sch-layer);min-height:0}
.sch-chat-new{width:100%;justify-content:center}
.sch-sesslist{display:flex;flex-direction:column;gap:2px;overflow-y:auto;overflow-x:hidden;min-height:0;
  margin-top:2px;scrollbar-width:thin}
.sch-sess{display:flex;flex-direction:column;gap:2px;padding:7px 8px;border:0;border-radius:8px;
  background:transparent;text-align:left;font:inherit;cursor:pointer;color:var(--sch-text-2);min-width:0}
.sch-sess:hover{background:var(--sch-hover)}
.sch-sess.on{background:var(--sch-green-tint)}
.sch-sess-title{font-size:12px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sch-sess.on .sch-sess-title{color:var(--sch-green)}
.sch-sess-time{font-size:10.5px;color:var(--sch-text-3);font-variant-numeric:tabular-nums}
.sch-chat-main{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;min-height:0}
.sch-chat-head{flex:none;display:flex;align-items:center;gap:8px;padding:9px 14px;
  border-bottom:1px solid var(--sch-border-soft)}
.sch-chat-title{font-size:12px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sch-thread{flex:1 1 auto;min-height:0;overflow-y:auto;padding:14px;display:flex;flex-direction:column;
  gap:14px;scrollbar-width:thin}
.sch-chat-idle{margin:auto;text-align:center;max-width:400px;padding:18px}
.sch-msg{display:flex;flex-direction:column;gap:5px;max-width:min(560px,92%)}
.sch-msg.user{align-self:flex-end;align-items:flex-end}
.sch-msg-who{font-size:10.5px;color:var(--sch-text-3);display:flex;gap:8px;align-items:center}
.sch-msg-time{font-variant-numeric:tabular-nums}
.sch-bubble{border:1px solid var(--sch-border-soft);border-radius:var(--sch-radius);padding:9px 12px;
  background:var(--sch-layer);font-size:13px;line-height:1.7;min-width:0;word-break:break-word}
.sch-msg.user .sch-bubble{background:var(--sch-green-tint);border-color:transparent}
.sch-rich p{margin:0 0 8px}
.sch-rich p:last-child{margin-bottom:0}
.sch-rich-list{margin:0 0 8px;padding-left:18px}
.sch-rich-list:last-child{margin-bottom:0}
.sch-rich-list li{margin:2px 0}
.sch-code{font-family:var(--sch-mono);font-size:11px;background:var(--sch-layer-2);padding:1px 4px;border-radius:4px}
.sch-cite{font-size:10px;color:var(--sch-green);font-weight:700;margin-left:1px}
.sch-cite.ok{background:var(--sch-green-tint);padding:0 3px;border-radius:4px;cursor:pointer}
.sch-cite.ok:hover{background:var(--sch-green-tint);text-decoration:underline}
.sch-cite.bad{background:var(--sch-warn-bg);color:var(--sch-warn);padding:0 3px;border-radius:4px;text-decoration:line-through}
.sch-cursor{display:inline-block;width:6px;height:13px;background:var(--sch-green);vertical-align:-2px;
  margin-left:2px;animation:sch-blink 1s steps(2,start) infinite}
@keyframes sch-blink{to{opacity:0}}
.sch-typing{display:inline-flex;gap:3px;align-items:center;height:16px}
.sch-typing i{width:5px;height:5px;border-radius:50%;background:var(--sch-text-3);
  animation:sch-pulse 1.1s ease-in-out infinite}
.sch-typing i:nth-child(2){animation-delay:.15s}
.sch-typing i:nth-child(3){animation-delay:.3s}
.sch-msg-note{font-size:11px;color:var(--sch-text-3);margin-top:6px}
.sch-msg-note.err{color:var(--sch-err)}
.sch-msg-note.warn{color:var(--sch-warn)}
.sch-refs{margin-top:10px;border-top:1px dashed var(--sch-border-soft);padding-top:8px}
.sch-refs-head{display:flex;align-items:center;gap:8px;font-size:10.5px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;
  color:var(--sch-text-3);margin-bottom:5px}
.sch-refstat{margin-left:auto;font-size:11px;font-weight:600;letter-spacing:0;text-transform:none;color:var(--sch-text-3)}
.sch-refstat.ok{color:var(--sch-green)}
.sch-refstat.bad{color:var(--sch-warn)}
.sch-refs-list{display:flex;flex-direction:column;gap:3px}
.sch-ref{border:1px solid var(--sch-border-soft);border-radius:8px;background:var(--sch-bg);overflow:hidden}
.sch-ref-btn{display:flex;align-items:center;gap:7px;width:100%;padding:5px 8px;border:0;
  background:transparent;font:inherit;font-size:11px;color:var(--sch-text-2);cursor:pointer;text-align:left}
.sch-ref-btn:hover{background:var(--sch-hover)}
.sch-ref-idx{width:15px;height:15px;border-radius:4px;background:var(--sch-green-tint);color:var(--sch-green);
  font-size:10px;font-weight:700;display:flex;align-items:center;justify-content:center;flex:none}
.sch-ref-title{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sch-ref-meta{font-size:10.5px;color:var(--sch-text-3);flex:none}
.sch-ref-quote{padding:6px 8px 8px;font-size:12px;line-height:1.65;color:var(--sch-text-2);
  white-space:pre-wrap;border-top:1px dashed var(--sch-border-soft);margin-top:2px}
/* 输入区：贴底常驻。sticky 是兜底——万一宿主那层高度量不准、整页还能滚，
   输入区也会粘在可视区底部，而不是跟着滚走。 */
.sch-composer{flex:none;position:sticky;bottom:0;z-index:5;background:var(--sch-bg);
  border-top:1px solid var(--sch-border-soft);padding:12px 16px 10px;
  box-shadow:var(--sch-shadow-up)}
.sch-composer-row{display:flex;align-items:flex-end;gap:10px}
/* DSH 对话选区引用条：一行，前缀 + 预览 + 引用/取消 */
.sch-quote{display:flex;align-items:center;gap:8px;margin-bottom:8px;padding:6px 8px 6px 10px;min-width:0;
  border-radius:8px;background:var(--sch-layer);border:1px solid var(--sch-border-soft);font-size:11px;color:var(--sch-text-2)}
.sch-quote-label{flex:none;font-weight:600;color:var(--sch-green)}
.sch-quote-preview{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--sch-text-3)}
.sch-composer-row .sch-btn{height:40px;padding:0 20px;font-size:13px;flex:none}
.sch-ta{flex:1 1 auto;min-height:96px;max-height:240px;resize:none;overflow-y:auto;padding:12px 14px;
  border-radius:12px;border:1px solid var(--sch-border);background:var(--sch-bg);color:var(--sch-text);
  font:inherit;font-size:14px;line-height:1.65}
.sch-ta::placeholder{color:var(--sch-text-3)}
.sch-ta:focus-visible{outline:2px solid var(--sch-green-2);outline-offset:1px}
.sch-composer-note{font-size:11px;color:var(--sch-text-3);margin-top:8px}
.sch-alert-sub{font-size:11px;color:var(--sch-text-2);margin-top:2px;word-break:break-word}
/* 窄容器（宿主面板通常只有 800–1160）里，会话列让位给消息区，切换改用头部下拉 */
@media (max-width:1180px){
  .sch-chat-side{display:none}
  .sch-chat-title{display:none}
  .sch-chat-pick{display:block}
}

/* 模块 6：Wiki —— 左列页面索引、右侧正文，窄窗折叠成下拉 */
.sch-wiki{display:flex;flex:1 1 auto;min-height:420px;min-width:0;
  border:1px solid var(--sch-border-soft);border-radius:var(--sch-radius);overflow:hidden;background:var(--sch-bg)}
.sch-wiki-side{width:216px;flex:none;display:flex;flex-direction:column;gap:8px;padding:12px 10px;
  border-right:1px solid var(--sch-border-soft);background:var(--sch-layer);min-height:0;overflow-y:auto;overflow-x:hidden}
.sch-wiki-filter{display:flex;align-items:center;gap:6px;padding:0 8px;border:1px solid var(--sch-border);
  border-radius:8px;background:var(--sch-bg);color:var(--sch-text-3)}
.sch-wiki-filter .sch-input{border:0;padding:6px 0;background:transparent;box-shadow:none}
.sch-wiki-item{display:flex;flex-direction:column;gap:3px;padding:7px 8px;border:0;border-radius:8px;
  background:transparent;text-align:left;font:inherit;cursor:pointer;color:var(--sch-text-2);min-width:0}
.sch-wiki-item:hover{background:var(--sch-hover)}
.sch-wiki-item.on{background:var(--sch-green-tint)}
.sch-wiki-item-title{font-size:12px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sch-wiki-item.on .sch-wiki-item-title{color:var(--sch-green)}
.sch-wiki-item-meta{display:flex;align-items:center;gap:6px;font-size:10px;color:var(--sch-text-3)}
.sch-wiki-page{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;min-height:0;overflow-y:auto;padding:16px 20px}
.sch-wiki-pick{display:none;margin-bottom:10px;width:100%;padding:7px 10px;border:1px solid var(--sch-border);
  border-radius:8px;background:var(--sch-bg);font:inherit;font-size:12px;color:var(--sch-text)}
.sch-wiki-pickkb{display:none;margin-bottom:6px;width:100%;padding:7px 10px;border:1px solid var(--sch-border);
  border-radius:8px;background:var(--sch-bg);font:inherit;font-size:12px;color:var(--sch-text)}
.sch-wiki-article{max-width:720px}
.sch-wiki-head{margin-bottom:12px}
.sch-wiki-title{font-size:21px;font-weight:700;margin:0 0 8px;letter-spacing:-.01em}
.sch-wiki-meta{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:11px;color:var(--sch-text-3)}
.sch-wiki-summary{font-size:12px;color:var(--sch-text-2);margin:10px 0 0;line-height:1.6}
.sch-wiki-src{margin-top:16px;border-top:1px dashed var(--sch-border-soft);padding-top:12px}
.sch-wiki-src-head{font-size:10px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;
  color:var(--sch-text-3);margin-bottom:8px}
.sch-wiki-src-item{display:flex;align-items:center;gap:8px;padding:6px 8px;border:1px solid var(--sch-border-soft);
  border-radius:8px;margin-bottom:6px;background:var(--sch-bg)}
.sch-wiki-src-title{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
  font-size:12px;font-weight:600}
.sch-wiki-src-meta{font-size:10px;color:var(--sch-text-3);flex:none}
/* 必须写在上面的基础规则之后：同一属性的媒体查询只有靠后者才生效 */
@media (max-width:1180px){
  .sch-wiki-side{display:none}
  .sch-wiki-pick{display:block}
  .sch-wiki-pickkb{display:block}
}

/* 顶栏改造时被一并删掉、但别处仍在用的基础规则（恢复） */
  /* --sch-panel-h 由 Panel 量出来（面板顶边到窗口底边）：宿主那层没有确定高度时，
     height:100% 解不出来，整页就会滚，输入框也跟着跑。max-height 兜住「宿主本来就有高度」的情况。 */
  .sch-panel{position:relative;display:flex;flex-direction:column;height:var(--sch-panel-h,100%);max-height:100%;
    overflow:hidden;padding:0;margin:0;background:var(--sch-bg);
    /* 宿主翻转明暗时底色渐变，不闪一下白 */
    transition:background-color .24s ease,color .24s ease}
  .sch-source{display:inline-flex;align-items:center;gap:6px;height:28px;padding:0 8px;border:0;border-radius:8px;
    background:transparent;color:var(--sch-text-3);font:inherit;font-size:11px;cursor:pointer;white-space:nowrap}
  .sch-source:hover{background:var(--sch-hover);color:var(--sch-text-2)}
  .sch-statusline{display:flex;align-items:center;gap:7px;min-width:0;flex:1 1 auto;
    font-size:11px;color:var(--sch-text-3)}
  .sch-statusline span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .sch-head{display:flex;align-items:flex-start;gap:12px;flex-wrap:wrap;justify-content:space-between}
  .sch-brand-txt{min-width:0}
  /* 资料库迁移：最近打开 + 标签筛选行 */
  .sch-docbar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:10px;min-width:0}
  .sch-docbar-label{font-size:11px;color:var(--sch-text-3);flex:none}
  .sch-docbar .sch-toolbar-spacer{flex:1 1 auto}
  .sch-recentchip{border:0;border-radius:999px;background:var(--sch-hover);color:var(--sch-text-2);
    font:inherit;font-size:11px;padding:3px 10px;cursor:pointer;max-width:150px;overflow:hidden;
    text-overflow:ellipsis;white-space:nowrap;flex:none}
  .sch-recentchip:hover{color:var(--sch-green)}
  .sch-tagrow{display:flex;flex-wrap:wrap;gap:4px;margin-top:4px}
  .sch-doctag{font-size:10.5px;line-height:1;padding:3px 7px;border-radius:999px;flex:none;
    background:var(--sch-green-tint);color:var(--sch-green)}
  .sch-tag-edit{display:flex;align-items:center;gap:6px;margin-top:6px}
  .sch-tag-edit .sch-input{flex:1 1 auto;min-width:120px;padding:5px 8px;font-size:12px}

/* ============================================================================
   视觉统一 v3 —— 依据 Spotify DESIGN.md（VoltAgent/awesome-design-md）执行：
     · 字重二值制：标题/导航 700，正文 400，600 只做次级强调
     · 层级靠明度差 + 重阴影，不靠灰描边
     · 按钮/导航全胶囊，图标按钮正圆；徽标反而用 4px 小圆角（不是胶囊）
     · 输入框用 inset 描边环，不用实线边框
   品牌绿保留为唯一强调色（Schanora 品牌带例外，见 README「设计规范」）。
   只覆盖观感，不改任何交互或数据流。
   ============================================================================ */
/* 字号区间收在 10–21px（Spotify 是 10–24，应用型密度），字重只走 700/400 */
.sch-toolbar-title,.sch-section-title{font-weight:700;letter-spacing:-.005em}
.sch-kbcard-name{font-size:14px;font-weight:700;letter-spacing:-.01em}
.sch-navgroup{font-size:10px;font-weight:700;letter-spacing:.11em;color:var(--sch-text-3)}

/* 按钮：全胶囊；图标按钮 50%；标签字重 700（中文不做 uppercase） */
.sch-btn{height:30px;padding:0 14px;border-radius:999px;font-weight:700;border-color:var(--sch-border-soft)}
.sch-btn.icon{width:30px;height:30px;padding:0;border-radius:50%}
.sch-btn.icon.on{color:var(--sch-green-2);border-color:var(--sch-green-2)}
.sch-btn.primary{box-shadow:var(--sch-shadow-1)}
.sch-btn.primary:hover{box-shadow:var(--sch-shadow-2)}
.sch-btn.sm{height:27px;padding:0 11px}
.sch-navitem{border-radius:999px;height:36px}
.sch-navitem.on{font-weight:700}
.sch-source{height:28px;border-radius:999px;font-weight:600}

/* 面：底色分层，hover 才抬升（卡片无描边） */
.sch-kbcard{border-color:transparent;background:var(--sch-layer);box-shadow:none;border-radius:8px;
  transition:background .16s ease,box-shadow .16s ease,transform .16s ease}
.sch-kbcard:hover{background:var(--sch-layer-2);box-shadow:var(--sch-shadow-2);transform:translateY(-1px)}
.sch-table{border-color:transparent;background:var(--sch-layer);border-radius:8px}
.sch-tr{transition:background .14s ease}
.sch-tr:hover{background:var(--sch-layer-2)}
.sch-hit{border-color:transparent;background:var(--sch-layer);box-shadow:none;border-radius:8px;
  transition:background .16s ease,box-shadow .16s ease,transform .16s ease}
.sch-hit:hover{background:var(--sch-layer-2);box-shadow:var(--sch-shadow-2);transform:translateY(-1px)}
.sch-hit.open{background:var(--sch-bg);box-shadow:var(--sch-shadow-1)}
.sch-empty{border-color:transparent;background:var(--sch-layer);border-radius:8px;padding:30px 22px}
.sch-empty-title{font-size:14px;font-weight:700;letter-spacing:-.01em}
.sch-empty-desc{font-size:12px;line-height:1.65}
.sch-drop{border-color:var(--sch-border);background:var(--sch-layer);border-radius:8px}

/* 徽标：小圆角 + 10.5px/600（Spotify 的 badge 不是胶囊，胶囊只给按钮） */
.sch-badge{height:20px;padding:0 7px;border-radius:4px;font-size:10.5px;font-weight:600;letter-spacing:.02em}
.sch-scopechip{height:26px;padding:0 11px;font-weight:600}
.sch-chip{border-radius:999px}

/* 弹层：层级用阴影表达 */
.sch-pop,.sch-popmenu{border:1px solid var(--sch-border-soft);border-radius:12px;box-shadow:var(--sch-shadow-3)}
.sch-drawer{box-shadow:var(--sch-shadow-3)}
.sch-toast{border-radius:999px}

/* 输入：inset 描边环（Spotify 的 recessed input），不用实线边框 */
.sch-input,.sch-ta{border-color:transparent;box-shadow:inset 0 0 0 1px var(--sch-border)}
.sch-input:focus,.sch-ta:focus{box-shadow:inset 0 0 0 1px var(--sch-green-2)}
.sch-ta{border-radius:12px}

/* 链接：静态无下划线，hover 才出现 */
.sch-linkbtn{text-decoration:none;font-weight:700;color:var(--sch-green-2)}
.sch-linkbtn:hover{text-decoration:underline;text-underline-offset:3px}

/* 检索结果 */
.sch-hit-idx{border-radius:4px;font-size:10px}
.sch-hit-title{font-size:13px;font-weight:700}
.sch-hit-meta,.sch-hit-kb{font-size:11px}

/* 问答：气泡 12px、留白 16、引用块用明度分层 */
.sch-thread{padding:16px;gap:16px}
.sch-bubble{border-color:transparent;background:var(--sch-layer);border-radius:12px;padding:11px 14px;
  box-shadow:var(--sch-shadow-1);color:var(--sch-text)}
.sch-msg.user .sch-bubble{background:var(--sch-green-tint);box-shadow:none}
.sch-msg-who{font-size:10px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--sch-text-3)}
.sch-sess{border-radius:6px}
.sch-sess.on{background:var(--sch-green-tint)}
.sch-sess.on .sch-sess-title{font-weight:700}
.sch-ref{border-color:transparent;background:var(--sch-layer-2);border-radius:6px}
.sch-ref-btn{border-radius:6px}

/* 走查修正 v4（对着 32 张截图逐张看出来的四处） */
/* 1. 次级按钮要看得见：border-soft 只有 8% 黑，浅色下等于没有，「停止」「详情」会变成裸文字 */
.sch-btn{border-color:var(--sch-border)}
.sch-btn:hover{border-color:var(--sch-text-3)}
/* scope chip 是控件不是徽标，字重回 600（500 不在二值制里） */
.sch-scopechip{font-weight:600}
/* 2. 长答案限宽：满宽 1000px+ 的行长读起来会串行，72ch 以内 */
.sch-msg.assistant .sch-bubble{max-width:min(72ch,100%)}
/* 3. 滚动区上下淡出：否则滚到中间时气泡会被硬边切一半，看着像渲染坏了 */
.sch-thread{
  -webkit-mask-image:linear-gradient(to bottom,transparent 0,#000 14px,#000 calc(100% - 14px),transparent 100%);/* design-ok: mask 语法 */
  mask-image:linear-gradient(to bottom,transparent 0,#000 14px,#000 calc(100% - 14px),transparent 100%)}/* design-ok: mask 语法 */
/* 4. 表头「操作」跟右边那列按钮对齐，否则标题悬在按钮左边 */
.sch-dtr.head > :last-child{text-align:right}

/* 中轨用 minmax(0,auto)、两侧用 minmax(auto,1fr)：够宽时导航几何居中（两条 1fr 等宽），
   放不下时两侧先保住自己的最小内容宽度，中轨收缩并自己横滚。
   早先两侧写 minmax(0,1fr) 会让工具按钮直接压到导航上（900/800 宽度实测重叠）。 */
.sch-top{flex:none;display:grid;grid-template-columns:minmax(auto,1fr) minmax(0,auto) minmax(auto,1fr);
  align-items:center;gap:12px;height:52px;padding:0 14px 0 12px;
  border-bottom:1px solid var(--sch-border-soft);background:var(--sch-bg);
  transition:background-color .24s ease,border-color .24s ease}
/* 品牌字标（2026-11-17 换版：透明底 + 品牌绿字）：不垫底板，直接落在顶栏背景上。
   暗色下品牌绿太重，用 filter 提亮；transition 让主题切换是渐变而不是闪变。 */
.sch-top-brand{display:flex;align-items:center;justify-self:start;flex:none;height:40px;padding:0 4px}
.sch-top-glyph{display:block;height:30px;width:auto;transition:filter .28s ease}
body[data-ds-dark-theme]:not([data-ds-dark-theme='false']) .sch-tokens .sch-top-glyph{filter:brightness(1.7) saturate(.98)}
/* fallback 只在字标图缺失时出现：浅色用品牌绿；暗色换较轻的 --sch-green，否则看不见 */
.sch-top-fallback{font-size:13px;font-weight:700;color:var(--sch-brand-green)}
body[data-ds-dark-theme]:not([data-ds-dark-theme='false']) .sch-tokens .sch-top-fallback{color:var(--sch-green)}
/* 库内工作区子导航：返回 + 库名 + 文档/Wiki + 导入资料（§2 导航重组） */
.sch-kbsub{flex:none;display:flex;align-items:center;gap:10px;padding:8px 20px 0;min-width:0}
.sch-kbsub-back{display:inline-flex;align-items:center;gap:4px;border:0;background:transparent;
  color:var(--sch-text-3);font:inherit;font-size:12px;cursor:pointer;padding:4px 6px;border-radius:6px;flex:none}
.sch-kbsub-back:hover{background:var(--sch-hover);color:var(--sch-text)}
.sch-kbsub-name{font-size:13px;font-weight:600;color:var(--sch-text);max-width:220px;overflow:hidden;
  text-overflow:ellipsis;white-space:nowrap;flex:none}
.sch-kbsub .sch-toolbar-spacer{flex:1 1 auto}
.sch-pop-import{right:0;left:auto}
/* 两根等宽弹性轨夹住导航，几何上居中；两侧空间归品牌与工具 */
.sch-tabs{display:flex;align-items:center;justify-self:center;gap:2px;max-width:100%;overflow-x:auto;
  scrollbar-width:none;-ms-overflow-style:none}
.sch-tabs::-webkit-scrollbar{display:none}
.sch-tab{display:inline-flex;align-items:center;gap:7px;height:30px;padding:0 12px;border:0;
  border-radius:999px;background:transparent;color:var(--sch-text-2);font:inherit;font-size:13px;
  font-weight:600;white-space:nowrap;cursor:pointer;flex:none;
  transition:background-color .12s ease,color .12s ease}
.sch-tab:hover{background:var(--sch-hover);color:var(--sch-text)}
.sch-tab.on{background:var(--sch-green);color:var(--sch-on-green)}
.sch-tab.on:hover{background:var(--sch-green-2);color:var(--sch-on-green)}
.sch-tab:focus-visible{outline:2px solid var(--sch-green-2);outline-offset:1px}
.sch-tab-icon{display:flex;flex:none;color:inherit}
.sch-tab-icon svg{width:15px;height:15px}
.sch-tabsep{flex:none;width:1px;height:16px;margin:0 6px;background:var(--sch-border-soft)}
.sch-main-actions{justify-self:end}
.sch-chat-pick{display:none;flex:1 1 auto;min-width:0;max-width:340px;height:26px;padding:0 8px;
  border:0;border-radius:6px;background:var(--sch-layer-2);color:var(--sch-text);
  font:inherit;font-size:12px;font-weight:600;cursor:pointer}
.sch-chat-pick:focus-visible{outline:2px solid var(--sch-green-2);outline-offset:1px}
.sch-pagehint{flex:none;display:flex;align-items:baseline;padding:8px 28px 0;min-width:0}
.sch-pagehint span{font-size:12px;color:var(--sch-text-3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
/* 面板窄到放不下「品牌 + 居中导航 + 工具」时，居中会压住品牌：改回左对齐，导航自己横滚 */
@media (max-width:640px){
  .sch-top{grid-template-columns:auto minmax(0,1fr) auto;gap:8px;padding:0 10px 0 8px}
  .sch-top-brand{height:32px;padding:0 8px}
  .sch-top-glyph{height:23px}
  .sch-tabs{justify-self:start}
  .sch-tab{padding:0 10px}
}
@media (max-width:1180px){.sch-chat-pick{display:block}}
.sch-refs-head{letter-spacing:.09em;font-weight:700}

/* 侧栏：品牌带收紧 + 一点纵向渐变（保留绿色主体，不弱化） */

/* 滚动条：细、低对比 */
.sch-root *::-webkit-scrollbar{width:8px;height:8px}
.sch-root *::-webkit-scrollbar-thumb{background:var(--sch-border);border-radius:999px}
.sch-root *::-webkit-scrollbar-thumb:hover{background:var(--sch-text-3)}
.sch-root *::-webkit-scrollbar-track{background:transparent}

/* 焦点：统一 2px 绿环（键盘可见、鼠标不打扰） */
.sch-root button:focus-visible,.sch-root input:focus-visible,.sch-root textarea:focus-visible,
.sch-root [tabindex]:focus-visible{outline:2px solid var(--sch-green-2);outline-offset:2px;border-radius:8px}

body[data-ds-dark-theme]:not([data-ds-dark-theme='false']) .sch-kbcard:hover,
body[data-ds-dark-theme]:not([data-ds-dark-theme='false']) .sch-hit:hover{background:var(--sch-layer-2)}

/* 微交互（uiverse 那类小细节）：只在允许动效时启用，且都很轻 */
@media (prefers-reduced-motion:no-preference){
  .sch-btn{position:relative;overflow:hidden}
  .sch-btn::after{content:'';position:absolute;inset:0;border-radius:inherit;pointer-events:none;
    background:radial-gradient(120px 56px at 50% 130%,var(--sch-gloss),transparent 72%);
    opacity:0;transition:opacity .22s ease}
  .sch-btn:hover::after{opacity:1}
  .sch-btn:active{transform:translateY(.5px) scale(.985)}

  .sch-navitem{position:relative}
  .sch-navitem .sch-navitem-icon{transition:transform .18s ease}
  .sch-navitem:hover .sch-navitem-icon{transform:translateY(-1px) scale(1.05)}

  .sch-kbcard,.sch-hit{position:relative}
  .sch-kbcard::after,.sch-hit::after{content:'';position:absolute;inset:0;border-radius:inherit;
    pointer-events:none;box-shadow:inset 0 1px 0 var(--sch-gloss-strong);
    opacity:0;transition:opacity .18s ease}
  .sch-kbcard:hover::after,.sch-hit:hover::after{opacity:1}

  .sch-input:focus,.sch-ta:focus{box-shadow:inset 0 0 0 1px var(--sch-green-2),0 0 0 3px var(--sch-focus-ring)}
  .sch-scopechip{transition:background .14s ease,border-color .14s ease,color .14s ease,transform .14s ease}
  .sch-scopechip:hover{transform:translateY(-1px)}
  .sch-sess{transition:background .14s ease,transform .14s ease}
  .sch-sess:hover{transform:translateX(2px)}
  .sch-hit:hover .sch-hit-idx{background:var(--sch-green-tint);color:var(--sch-green)}
  .sch-ref-btn{transition:background .14s ease,padding-left .14s ease}
  .sch-ref-btn:hover{padding-left:10px}
  .sch-kbcard-tile{transition:transform .2s ease}
  .sch-kbcard:hover .sch-kbcard-tile{transform:scale(1.04) rotate(-2deg)}
}
body[data-ds-dark-theme]:not([data-ds-dark-theme='false']) .sch-kbcard::after,
body[data-ds-dark-theme]:not([data-ds-dark-theme='false']) .sch-hit::after{box-shadow:inset 0 1px 0 var(--sch-gloss-strong)}

@media (prefers-reduced-motion:reduce){
  .sch-modwrap,.sch-pop,.sch-popmenu,.sch-drawer,.sch-dup,.sch-scrim,.sch-toast,.sch-dot.busy,.sch-cursor,.sch-typing i{animation:none!important}
  .sch-side,.sch-btn,.sch-navitem,.sch-kbcard,.sch-scopechip,.sch-sess,.sch-hit{transition:none!important}
  .sch-btn:active{transform:none}
}

/* ============================================================================
   v7：设置抽屉 + 插件中心
     · 设置从「小弹层」升级成抽屉：连接 / 检索 / 本地插件 三段，字段带说明
     · 插件中心用卡片列：状态、依赖、开关都在卡上，与 WeKnora 的插件页同一套信息
   ============================================================================ */
.sch-setgroup{margin-top:16px;padding-top:16px;border-top:1px solid var(--sch-border-soft)}
.sch-setgroup:first-of-type{margin-top:0;padding-top:0;border-top:0}
.sch-setgroup-title{font-size:11px;font-weight:700;letter-spacing:.09em;text-transform:uppercase;color:var(--sch-text-3)}
.sch-setgroup-desc{font-size:11px;color:var(--sch-text-3);line-height:1.6;margin-top:4px}
/* DSH 能力清单：一行一项，左点是口（给了亮绿、没给灰），右侧写实际挂到的属性名。
   不做开关：能力由宿主决定，插件里放个假开关比不显示更误导。 */
.sch-hostcap{display:flex;align-items:center;gap:8px;padding:5px 0;font-size:12px;color:var(--sch-text-2)}
.sch-hostcap-dot{flex:none;width:6px;height:6px;border-radius:50%;background:var(--sch-border-soft)}
.sch-hostcap-dot.on{background:var(--sch-ok)}
.sch-hostcap-name{flex:none;min-width:60px}
.sch-hostcap-via{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--sch-text-3)}
.sch-setgroup-desc.err{color:var(--sch-err)}
.sch-setrow{display:flex;align-items:center;gap:12px;padding:11px 0;border-bottom:1px solid var(--sch-border-soft)}
.sch-setrow:last-child{border-bottom:0;padding-bottom:0}
.sch-setrow-main{flex:1 1 auto;min-width:0}
.sch-setrow-title{font-size:13px;font-weight:600;color:var(--sch-text)}
.sch-setrow-desc{font-size:11px;color:var(--sch-text-3);line-height:1.55;margin-top:3px}
.sch-switch{position:relative;flex:none;width:38px;height:22px;padding:0;border-radius:999px;cursor:pointer;
  border:1px solid var(--sch-border);background:var(--sch-layer-2);transition:background .16s ease,border-color .16s ease}
.sch-switch::after{content:'';position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;
  background:var(--sch-bg);box-shadow:var(--sch-shadow-1);transition:transform .16s ease}
.sch-switch[aria-pressed='true']{background:var(--sch-green);border-color:var(--sch-green)}
.sch-switch[aria-pressed='true']::after{transform:translateX(16px);background:var(--sch-on-green)}
.sch-keyrow{display:flex;align-items:center;gap:8px}
.sch-keyrow .sch-input{flex:1 1 auto;min-width:0}
.sch-model-settings .sch-input{max-width:100%;width:100%;box-sizing:border-box}
.sch-model-actions{display:flex;align-items:center;flex-wrap:wrap;gap:8px;margin-top:12px}
.sch-plugins{display:flex;flex-direction:column;gap:10px}
.sch-plugin{border:1px solid var(--sch-border-soft);border-radius:var(--sch-radius);background:var(--sch-layer);padding:12px 14px}
.sch-plugin.picked{background:var(--sch-bg);border-color:var(--sch-border);box-shadow:var(--sch-shadow-1)}
.sch-plugin-head{display:flex;align-items:flex-start;gap:10px}
.sch-plugin-icon{flex:none;width:30px;height:30px;border-radius:8px;display:flex;align-items:center;justify-content:center;
  background:var(--sch-green-tint);color:var(--sch-green)}
.sch-plugin-icon.off{background:var(--sch-layer-2);color:var(--sch-text-3)}
.sch-plugin-main{flex:1 1 auto;min-width:0}
.sch-plugin-name{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:13px;font-weight:700}
.sch-plugin-desc{font-size:12px;color:var(--sch-text-2);line-height:1.6;margin-top:4px}
.sch-plugin-deps{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}
.sch-plugin-dep{font-family:var(--sch-mono);font-size:11px;padding:2px 6px;border-radius:6px;
  background:var(--sch-layer-2);color:var(--sch-text-3);word-break:break-all}
.sch-plugin-head>.sch-switch{margin-left:auto;flex:none;align-self:center}
.sch-plugbar{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
/* 抽屉操作条：吸在底部，负外边距抵消抽屉的 20px 内距，背景铺满整宽 */
/* 设置抽屉：头部 / 可滚动中段 / 常驻底部操作条 */
.sch-drawer-set{display:flex;flex-direction:column;padding:0;overflow:hidden}
.sch-drawer-set .sch-drawer-head{flex:none;margin:0;padding:16px 20px 12px;border-bottom:1px solid var(--sch-border-soft)}
.sch-drawer-body{flex:1 1 auto;min-height:0;overflow-y:auto;padding:16px 20px 20px;scrollbar-width:thin}
.sch-drawer-foot{flex:none;margin:0;padding:12px 20px;background:var(--sch-bg);
  border-top:1px solid var(--sch-border-soft);box-shadow:var(--sch-shadow-up)}
/* 状态胶囊现在只是状态（不是按钮了），指针不需要手型 */
.sch-source:not(button){cursor:default}
.sch-btn-label{white-space:nowrap}
@media (max-width:820px){
  .sch-btn-label{display:none}
}
/* 面板不够宽时先让状态胶囊让位：连接状态在「设置」里也能看到，导航不能被挤到左边 */
@media (max-width:1000px){
  .sch-source{display:none}
}
@media (max-width:640px){
  .sch-plugin{padding:10px 12px}
  .sch-plugin-icon{display:none}
}

/* ---- P1/P2/P4 插件页签（采集 / 浏览器 / 批量） ---- */
.sch-clip-grid{display:grid;grid-template-columns:minmax(0,1.15fr) minmax(0,1fr);gap:16px;align-items:start}
@media (max-width:1180px){.sch-clip-grid{grid-template-columns:minmax(0,1fr)}}
.sch-clip-card{border:1px solid var(--sch-border-soft);border-radius:var(--sch-radius);padding:12px 16px;background:var(--sch-plate)}
.sch-clip-modes{display:flex;gap:6px;flex-wrap:wrap;align-items:center}
.sch-clip-ta{height:auto;min-height:96px;max-height:260px;padding:10px 12px;line-height:1.6;resize:vertical;font-family:inherit}
.sch-clip-meta{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:0 14px}
.sch-steps{display:flex;flex-wrap:wrap;gap:6px 0;margin-top:12px}
.sch-step{display:inline-flex;align-items:center;gap:6px;font-size:11px;color:var(--sch-text-3);white-space:nowrap}
.sch-step-dot{width:8px;height:8px;border-radius:999px;background:var(--sch-layer-2);flex:none}
.sch-step.done{color:var(--sch-text-2)}
.sch-step.done .sch-step-dot{background:var(--sch-ok)}
.sch-step.now{color:var(--sch-text);font-weight:600}
.sch-step.now .sch-step-dot{background:var(--sch-green)}
.sch-step-sep{width:14px;height:1px;background:var(--sch-border-soft);margin:0 4px}
.sch-brow-task{border:1px solid var(--sch-border-soft);border-radius:var(--sch-radius-sm);padding:10px 12px;background:var(--sch-bg)}
.sch-brow-task + .sch-brow-task{margin-top:10px}
.sch-brow-acts{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px}
.sch-brow-result{border-top:1px dashed var(--sch-border-soft);padding-top:8px}
.sch-progress{height:4px;border-radius:999px;background:var(--sch-layer-2);overflow:hidden;margin-top:8px}
.sch-progress-bar{height:100%;border-radius:999px;background:var(--sch-green-2);transition:width .4s ease}
.sch-batch-row{display:flex;align-items:flex-start;gap:10px;padding:9px 0;border-bottom:1px solid var(--sch-border-soft)}
.sch-batch-row:last-child{border-bottom:0}
`;

  let styleInjected = false;
  function ensureStyle() {
    if (styleInjected || typeof document === 'undefined') return;
    const tag = document.createElement('style');
    tag.setAttribute('data-schanora', '');
    tag.textContent = CSS;
    document.head.appendChild(tag);
    styleInjected = true;
  }

  /* ------------------------------------------------------------- 小工具 */

  const cx = (...parts) => parts.filter(Boolean).join(' ');

  function fmtTime(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    const p = (n) => String(n).padStart(2, '0');
    return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  }

  function text(t, key, vars) {
    let s = t(key);
    if (vars) for (const k of Object.keys(vars)) s = s.replace(`{${k}}`, String(vars[k]));
    return s;
  }

  function fmtBytes(n) {
    if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) return '—';
    const units = ['B', 'KB', 'MB', 'GB'];
    let v = n;
    let i = 0;
    while (v >= 1024 && i < units.length - 1) {
      v /= 1024;
      i += 1;
    }
    return `${v >= 10 || i === 0 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
  }

  function fmtDateTime(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    const p = (n) => String(n).padStart(2, '0');
    return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  const numOrNull = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

  /** 上面这些时间只显示到分；完整 ISO 放 title 里，审查时可见。 */
  function timeCell(iso) {
    return h('span', { className: 'sch-mono', title: iso || '' }, fmtDateTime(iso));
  }

  /* --------------------------------------------------- 契约对象的规范化 */

  /** A 的网关把 snake_case 递归转成了 camelCase，但形状仍随上游变化，这里收敛成一种。 */
  function normalizeKb(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const id = String(raw.id || '');
    if (!id) return null;
    return {
      id,
      name: String(raw.name || id),
      description: String(raw.description || ''),
      type: String(raw.type || raw.kind || 'document'),
      embeddingModelId: String(raw.embeddingModelId || ''),
      knowledgeCount: numOrNull(raw.knowledgeCount),
      chunkCount: numOrNull(raw.chunkCount),
      updatedAt: raw.updatedAt || raw.createdAt || null,
    };
  }

  /** 文档对象。parseStatus 是 WeKnora 的原生枚举，契约只写了 4 个值——
   *  上游还有 finalizing / deleting / cancelled，界面上都按真实值显示，不映射成假的。 */
  const TERMINAL_STATES = new Set(['completed', 'failed', 'cancelled']);

  function normalizeDoc(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const id = String(raw.id || raw.knowledgeId || '');
    if (!id) return null;
    return {
      id,
      title: String(raw.title || raw.fileName || id),
      fileName: String(raw.fileName || raw.title || ''),
      fileType: String(raw.fileType || '').toLowerCase(),
      fileSize: numOrNull(raw.fileSize),
      parseStatus: String(raw.parseStatus || '').toLowerCase(),
      embeddingModelId: String(raw.embeddingModelId || ''),
      createdAt: raw.createdAt || null,
      processedAt: raw.processedAt || null,
      errorMessage: String(raw.errorMessage || ''),
      pendingSubtasks: numOrNull(raw.pendingSubtasksCount),
      stallState: String(raw.stallState || ''),
      lastActivityAt: raw.lastActivityAt || null,
    };
  }

  function normalizeModel(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const id = String(raw.id || '');
    if (!id) return null;
    return {
      id,
      name: String(raw.name || id),
      displayName: String(raw.displayName || raw.name || id),
      type: String(raw.type || ''),
      source: String(raw.source || ''),
      isDefault: Boolean(raw.isDefault),
    };
  }

  /** 上游列表可能是裸数组，也可能是 {data:[…]} / {items:[…]}，收敛成 {items,total}。 */
  function toList(data) {
    if (Array.isArray(data)) return { items: data, total: null };
    if (data && typeof data === 'object') {
      for (const key of ['items', 'data', 'list', 'records']) {
        if (Array.isArray(data[key])) return { items: data[key], total: numOrNull(data.total) };
      }
    }
    return { items: [], total: null };
  }

  /** 检索命中片段（契约 4.1）。id 是 chunk id，knowledgeId 才是文档 id。 */
  function normalizeHit(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const content = String(raw.content ?? '');
    const id = String(raw.id || '');
    if (!id && !content) return null;
    return {
      id: id || `hit-${String(raw.knowledgeId || '')}-${raw.chunkIndex ?? 0}`,
      content,
      title: String(raw.knowledgeTitle || raw.knowledgeFilename || ''),
      fileName: String(raw.knowledgeFilename || ''),
      knowledgeId: String(raw.knowledgeId || ''),
      chunkIndex: numOrNull(raw.chunkIndex),
      score: numOrNull(raw.score),
      matchType: numOrNull(raw.matchType),
      kbId: String(raw.knowledgeBaseId || ''),
      // P3：引用要能绑定到实际文件版本；上游没给就空串（界面上不显示版本角标）
      versionId: String(raw.versionId || raw.knowledgeVersionId || ''),
      startAt: numOrNull(raw.startAt),
      endAt: numOrNull(raw.endAt),
    };
  }

  /** 引用片段与命中片段同构（SSE 的 knowledgeReferences 走这个）。 */
  const normalizeRef = normalizeHit;

  /**
   * Wiki 页面（模块 6）。树接口给列表字段，页接口额外带 content。
   * 两种来源都过这一个归一化，界面不区分。
   */
  function normalizeWikiPage(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const slug = String(raw.slug || raw.id || '');
    if (!slug) return null;
    return {
      slug,
      title: String(raw.title || slug),
      type: String(raw.type || 'topic'),
      status: String(raw.status || 'published'),
      summary: String(raw.summary || ''),
      content: typeof raw.content === 'string' ? raw.content : '',
      version: Number.isFinite(Number(raw.version)) ? Number(raw.version) : 1,
      updatedAt: raw.updatedAt || raw.updated_at || null,
      sources: Array.isArray(raw.sources)
        ? raw.sources
            .map((s) =>
              s && typeof s === 'object'
                ? { knowledgeId: String(s.knowledgeId || ''), title: String(s.title || ''), chunkCount: Number(s.chunkCount) || 0 }
                : null,
            )
            .filter(Boolean)
        : [],
    };
  }

  function normalizeSession(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const id = String(raw.id || raw.sessionId || '');
    if (!id) return null;
    return {
      id,
      title: String(raw.title || ''),
      description: String(raw.description || ''),
      createdAt: raw.createdAt || null,
      updatedAt: raw.updatedAt || raw.createdAt || null,
    };
  }

  function normalizeMessage(raw, sessionId) {
    if (!raw || typeof raw !== 'object') return null;
    const role = String(raw.role || '').toLowerCase() === 'user' ? 'user' : 'assistant';
    const content = String(raw.content ?? '');
    const refs = Array.isArray(raw.knowledgeReferences)
      ? raw.knowledgeReferences.map(normalizeRef).filter(Boolean)
      : [];
    const pending = !!WEKNORA && raw.runState === 'awaiting_input';
    if (!content && refs.length === 0 && !pending) return null;
    return {
      id: String(raw.id || raw.messageId || `${role}-${content.slice(0, 24)}`),
      role,
      content,
      refs,
      agentId: WEKNORA ? raw.agentId : undefined,
      pending,
      sessionId,
      createdAt: raw.createdAt || null,
      streaming: false,
    };
  }

  /**
   * 模块 5 的 SSE 读取器。
   *
   * 事件格式与 @rdkb/dsh-weknora-ground 里那套完全一致（同一个上游、同一批 responseType），
   * 三条硬规则照搬，都是踩过的坑：
   *   1) `answer` 是分片，要按顺序拼，最后一个分片 done=true；
   *   2) `complete` 才代表整次问答结束 —— 流在 complete 之前断掉说明答案不完整，
   *      必须报错而不是当成完成（否则界面会把半句话当全文）；
   *   3) 流里可能夹 `[DONE]` 与非 JSON 行，直接跳过，不抛。
   *
   * 返回 { cancel, promise }：cancel 给「停止」按钮用。
   */
  function streamAnswer(baseUrl, path, body, handlers) {
    const cb = handlers || {};
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const agentTurn = WEKNORA && body.agentId;
    let messageId = '';
    let stopped = false;
    let settled = false;

    const stopAgent = () => {
      const stopPath = path.replace(/\/messages$/, '/stop');
      postJson(baseUrl, stopPath, { messageId }, 8000).then(
        () => ctrl?.abort(),
        (error) => {
          stopped = false;
          if (!settled) cb.onStopError?.(error);
        },
      );
    };

    const run = async () => {
      const target = backendRoute(path, 'POST', body);
      const res = await fetch(joinUrl(baseUrl, target.path), {
        method: 'POST',
        headers: withAuth({ Accept: 'text/event-stream', 'Content-Type': 'application/json' }),
        body: JSON.stringify(target.body || {}),
        signal: ctrl ? ctrl.signal : undefined,
        credentials: 'omit',
      });

      if (!res.ok) {
        let raw = null;
        try {
          raw = await res.json();
        } catch (_e) {
          raw = null;
        }
        const msg = raw?.error?.message || raw?.message || raw?.detail || `HTTP ${res.status}`;
        const code = raw && raw.code && raw.code !== 0 ? String(raw.code) : res.status === 404 ? 'NOT_IMPLEMENTED' : 'HTTP_ERROR';
        throw new ApiError(code, msg, { status: res.status, requestId: raw && raw.requestId });
      }
      if (!res.body || typeof res.body.getReader !== 'function') {
        throw new ApiError('SOURCE_UNAVAILABLE', 'response has no readable stream', {});
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let completed = false;
      let suspended = false;
      let serverStopped = false;
      let failure = null;
      const answerSegments = new Map();

      const consume = (line) => {
        if (completed || failure) return;
        if (line.slice(0, 5) !== 'data:') return;
        const payload = line.slice(5).trim();
        if (!payload || payload === '[DONE]') return;
        let evt;
        try {
          evt = JSON.parse(payload);
          if (WEKNORA) evt = WEKNORA.camel(evt);
        } catch (_e) {
          return; // 心跳/注释行
        }
        if (evt.sessionId) cb.onSessionId && cb.onSessionId(String(evt.sessionId));
        if (evt.assistantMessageId) {
          if (agentTurn && stopped && !messageId) {
            messageId = String(evt.assistantMessageId);
            stopAgent();
          } else {
            messageId = String(evt.assistantMessageId);
          }
          cb.onMessageId?.(messageId);
        }

        const type = String(evt.responseType || evt.response_type || '');
        if (type === 'answer') {
          if (agentTurn && typeof evt.content === 'string' && (evt.content || evt.data?.replace)) {
            const segment = evt.data?.eventId || '';
            const previous = evt.data?.replace ? '' : answerSegments.get(segment) || '';
            answerSegments.set(segment, previous + evt.content);
            cb.onAgentAnswer?.(Array.from(answerSegments.values()).join(''));
          } else if (typeof evt.content === 'string' && evt.content) {
            cb.onAnswer?.(evt.content);
          }
        } else if (type === 'references') {
          const raw = evt.knowledgeReferences || evt.knowledge_references;
          if (Array.isArray(raw)) cb.onReferences && cb.onReferences(raw.map(normalizeRef).filter(Boolean));
        } else if (type === 'thinking') {
          if (typeof evt.content === 'string') cb.onThinking && cb.onThinking(evt.content);
        } else if (type === 'sessionTitle' || type === 'session_title') {
          if (typeof evt.content === 'string') cb.onTitle && cb.onTitle(evt.content);
        } else if (agentTurn && type === 'tool_call') {
          const names = (evt.toolCalls || []).map((call) => call.function?.name || call.name).filter(Boolean);
          if (evt.data?.toolName) names.push(evt.data.toolName);
          if (names.length) cb.onTools?.(names);
        } else if (agentTurn && type === 'run_suspended') {
          suspended = completed = true;
        } else if (agentTurn && ['tool_approval_required', 'agent_prompt_required', 'mcp_oauth_required'].includes(type)) {
          cb.onAgentPrompt?.(true);
        } else if (agentTurn && ['tool_approval_resolved', 'agent_prompt_resolved', 'mcp_oauth_resolved'].includes(type)) {
          cb.onAgentPrompt?.(false);
        } else if (agentTurn && type === 'stop') {
          serverStopped = completed = true;
        } else if (type === 'error') {
          failure = new ApiError('UPSTREAM_ERROR', String(evt.content || 'stream error'), {});
        } else if (type === 'complete') {
          completed = true;
        }
      };

      try {
        while (!completed && !failure) {
          const step = await reader.read();
          if (step.done) break;
          buffer += decoder.decode(step.value, { stream: true });
          let nl = buffer.indexOf('\n');
          while (nl >= 0) {
            consume(buffer.slice(0, nl).replace(/\r$/, ''));
            buffer = buffer.slice(nl + 1);
            if (completed || failure) break;
            nl = buffer.indexOf('\n');
          }
        }
        if (!completed && !failure && buffer.trim()) consume(buffer.replace(/\r$/, ''));
      } finally {
        try {
          await reader.cancel();
        } catch (_e) {
          /* 已关闭 */
        }
      }

      if (failure) throw failure;
      if (!completed) {
        if (stopped && !agentTurn) {
          cb.onStopped && cb.onStopped();
          return;
        }
        throw new ApiError('STREAM_INCOMPLETE', 'stream ended before complete', {});
      }
      if (suspended) cb.onSuspended?.();
      else if (serverStopped) cb.onStopped?.();
      else cb.onDone?.();
    };

    const promise = run().catch((error) => {
      if (error && error.name === 'AbortError') {
        if (cb.onStopped) cb.onStopped();
        return;
      }
      const err = error instanceof ApiError
        ? error
        : new ApiError('SOURCE_UNAVAILABLE', (error && error.message) || 'stream failed', {});
      if (cb.onError) cb.onError(err);
    }).finally(() => { settled = true; });

    return {
      cancel: () => {
        if (stopped || settled) return;
        stopped = true;
        if (agentTurn) {
          if (messageId) stopAgent();
        } else {
          ctrl?.abort();
        }
      },
      promise,
    };
  }

  /* --------------------------------------------------------- 状态元数据 */

  function statusMeta(t, status) {
    const s = String(status || '').toLowerCase();
    const map = {
      pending: { tone: 'plain', dot: 'warn', label: t('parse.pending'), hint: t('parse.pendingHint') },
      processing: { tone: 'plain', dot: 'busy', label: t('parse.processing'), hint: '' },
      finalizing: { tone: 'plain', dot: 'busy', label: t('parse.finalizing'), hint: '' },
      completed: { tone: 'live', dot: 'ok', label: t('parse.completed'), hint: '' },
      failed: { tone: 'err', dot: 'err', label: t('parse.failed'), hint: '' },
      cancelled: { tone: 'plain', dot: 'warn', label: t('parse.cancelled'), hint: '' },
      deleting: { tone: 'plain', dot: 'busy', label: t('parse.deleting'), hint: '' },
    };
    return map[s] || { tone: 'plain', dot: 'warn', label: t('parse.unknown'), hint: String(status || '') };
  }

  /* ----------------------------------------------------------- 处理轨迹 */

  const STAGE_NAMES = ['docreader', 'chunking', 'embedding', 'multimodal', 'postprocess'];

  /**
   * 把 /spans 的 trace.children 摊成 5 个固定阶段 + 其余子阶段。
   * 网关的 camel_keys 会把 error_code 转成 errorCode——两种都认。
   */
  function traceStages(data) {
    const trace = data && data.trace && typeof data.trace === 'object' ? data.trace : null;
    const children = trace && Array.isArray(trace.children) ? trace.children : [];
    const byName = {};
    const extras = [];
    for (const child of children) {
      if (!child || typeof child !== 'object') continue;
      const name = String(child.name || '');
      if (!name) continue;
      if (STAGE_NAMES.includes(name) && !byName[name]) byName[name] = child;
      else extras.push(child);
    }
    return {
      attempt: numOrNull(data && (data.attempt ?? data.currentAttempt)) || 1,
      currentStage: String((data && data.currentStage) || ''),
      parseStatus: String((data && data.parseStatus) || ''),
      lastError: (data && data.lastError) || null,
      rows: STAGE_NAMES.map((name) => ({ name, node: byName[name] || null })),
      extras,
      empty: children.length === 0,
    };
  }

  function stageStatus(t, row, info) {
    const raw = row.node ? String(row.node.status || '').toLowerCase() : '';
    const map = {
      done: { key: 'done', tone: 'done' },
      failed: { key: 'failed', tone: 'failed' },
      running: { key: 'running', tone: 'running' },
      cancelled: { key: 'cancelled', tone: '' },
      pending: { key: 'pending', tone: '' },
      skipped: { key: 'skipped', tone: '' },
    };
    if (map[raw]) return { ...map[raw], label: t(`trace.state.${map[raw].key}`) };
    // 没有 span 行：按整体状态推断，不上「未知」这种吓人的词
    if (info.parseStatus === 'completed') return { key: 'done', tone: 'done', label: t('trace.state.done') };
    if (info.parseStatus === 'failed') return { key: 'pending', tone: '', label: t('trace.state.unknown') };
    return { key: 'pending', tone: '', label: t('trace.state.pending') };
  }

  function stageMetaLine(t, row, state) {
    const node = row.node;
    if (!node) return '';
    const parts = [];
    if (state.key === 'failed') {
      const code = node.errorCode || node.error_code || '';
      const msg = node.errorMessage || node.error_message || '';
      if (code) parts.push(code);
      if (msg) parts.push(msg);
    }
    const dur = numOrNull(node.durationMs ?? node.duration_ms);
    if (dur != null) parts.push(`${Math.round(dur)}ms`);
    if (node.startedAt || node.started_at) parts.push(fmtDateTime(node.startedAt || node.started_at));
    return parts.join(' · ');
  }

  /* ---------------------------------------------------------------- 存储 */

  /** 连接与检索的默认值。apiKey 只留在这台机器的 localStorage，不进代码、不进日志。
   *  plugins 里是本地插件的开关：gate=证据门槛，cite=引用校验，两个都纯前端、可关。 */
  // 开发预览台独有的开关。DSH 宿主加载时只开放本地运行。
  const DEV_PREVIEW = globalThis.__SCHANORA_DEV_PREVIEW__ === true;
  const BROWSER_WORKSPACE = globalThis.__SCHANORA_BROWSER__ === true;
  const WEKNORA = BROWSER_WORKSPACE ? globalThis.__SCHANORA_WEKNORA__ : null;
  const DEFAULT_SETTINGS = {
    // 默认就是本地内核：装好插件即用，不需要网关、不需要配地址、不需要 API Key
    mode: 'local',
    // 只在「远程网关」模式下用得上；本地内核的地址由端口探测决定，不需要人填
    baseUrl: '',
    apiKey: '',
    timeoutMs: 30000,
    topK: 6,
    minCoverage: 0.34,
    scenario: 'ok',
    plugins: { gate: true, cite: true },
  };

  /** 老版本 localStorage 里没有新字段：合并默认值，缺的补上、脏类型的丢掉。 */
  function normalizeSettings(raw) {
    const src = raw && typeof raw === 'object' ? raw : {};
    const num = (v, fallback, min, max) => {
      const n = Number(v);
      if (!Number.isFinite(n)) return fallback;
      return Math.min(max, Math.max(min, n));
    };
    return {
      ...DEFAULT_SETTINGS,
      ...src,
      mode: DEV_PREVIEW && ['http', 'mock'].includes(src.mode) ? src.mode : 'local',
      baseUrl: DEV_PREVIEW && typeof src.baseUrl === 'string' ? src.baseUrl.trim() : '',
      apiKey: DEV_PREVIEW && src.mode === 'http' && typeof src.apiKey === 'string' ? src.apiKey.trim() : '',
      timeoutMs: num(src.timeoutMs, DEFAULT_SETTINGS.timeoutMs, 3000, 120000),
      topK: num(src.topK, DEFAULT_SETTINGS.topK, 1, 30),
      minCoverage: num(src.minCoverage, DEFAULT_SETTINGS.minCoverage, 0, 1),
      scenario: ['ok', 'degraded', 'error'].includes(src.scenario) ? src.scenario : 'ok',
      plugins: {
        gate: !src.plugins || src.plugins.gate !== false,
        cite: !src.plugins || src.plugins.cite !== false,
      },
    };
  }

  /** 网关若开了鉴权，带 X-API-Key；没填就不发这个头。 */
  let AUTH_KEY = '';
  function setAuthKey(key) {
    AUTH_KEY = typeof key === 'string' ? key.trim() : '';
  }
  function withAuth(headers) {
    if (WEKNORA) return WEKNORA.headers(headers);
    return AUTH_KEY ? { ...headers, 'X-API-Key': AUTH_KEY } : headers;
  }

  function readSettings() {
    try {
      const raw = window.localStorage.getItem(STORAGE_SETTINGS);
      if (!raw) return { ...DEFAULT_SETTINGS };
      return normalizeSettings(JSON.parse(raw));
    } catch (_e) {
      return { ...DEFAULT_SETTINGS };
    }
  }

  function writeSettings(next) {
    try {
      window.localStorage.setItem(STORAGE_SETTINGS, JSON.stringify(next));
    } catch (_e) {
      /* 隐私模式下写不进去，内存态仍然可用 */
    }
  }

  // §8 会话级草稿桶（内存 Map，按宿主会话 / 问答会话隔离；面板刷新即清空，属预期）。
  // 问答草稿：key = 问答会话 id（未发送的新会话用 '__fresh'）。
  const QA_DRAFTS = new Map();
  // 采集草稿：key = 宿主会话 id（ClipView 一次只有一个任务上下文）。
  const CLIP_DRAFTS = new Map();

  // 采集草稿是否为空白。目标库不参与判定：它是自动预选的，不代表用户输入过内容。
  function clipDraftEmpty(d) {
    if (!d) return true;
    const meta = d.meta || {};
    return (
      !(d.originUrl || '').trim() &&
      !(d.title || '').trim() &&
      !(d.content || '').trim() &&
      !(d.note || '').trim() &&
      !Object.values(meta).some((v) => (v || '').trim())
    );
  }

  function readScope(sessionId) {
    if (!sessionId) return [];
    try {
      const raw = window.localStorage.getItem(STORAGE_SCOPE_PREFIX + sessionId);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed.filter((x) => typeof x === 'string') : [];
    } catch (_e) {
      return [];
    }  }

  function writeScope(sessionId, ids) {
    if (!sessionId) return;
    try {
      window.localStorage.setItem(STORAGE_SCOPE_PREFIX + sessionId, JSON.stringify(ids));
    } catch (_e) {
      /* ignore */
    }
  }

  /** 文档标签表：{ [docId]: string[] }。读失败给空表（等价于还没打过标签）。 */
  function readDocTags() {
    try {
      return normalizeTagMap(JSON.parse(window.localStorage.getItem(STORAGE_DOCTAGS) || '{}'));
    } catch (_e) {
      return {};
    }
  }

  function writeDocTags(map) {
    try {
      window.localStorage.setItem(STORAGE_DOCTAGS, JSON.stringify(normalizeTagMap(map)));
    } catch (_e) {
      /* 隐私模式写不进去，本次会话内仍可用 */
    }
  }

  /** 最近打开文档：[{ id, title, kbId, at }]。 */
  function readRecentDocs() {
    try {
      const parsed = JSON.parse(window.localStorage.getItem(STORAGE_RECENT_DOCS) || '[]');
      return Array.isArray(parsed) ? parsed.filter((x) => x && typeof x.id === 'string') : [];
    } catch (_e) {
      return [];
    }
  }

  function writeRecentDocs(list) {
    try {
      window.localStorage.setItem(STORAGE_RECENT_DOCS, JSON.stringify(list || []));
    } catch (_e) {
      /* ignore */
    }
  }

  /* ------------------------------------------------------------ 数据适配 */

  /** 合同响应包裹：成功 {code:"OK"|0, message, data, requestId}，失败 {code,message,retryable,requestId}。 */
  function unwrap(payload) {
    if (payload && typeof payload === 'object' && 'code' in payload) {
      const ok = payload.code === 0 || payload.code === 'OK';
      return { ok, data: payload.data, error: ok ? null : payload, requestId: payload.requestId };
    }
    // A 的现网关对部分路由是裸透传（没有包裹），这里当成 data 直接用，不假装统一。
    return { ok: true, data: payload, error: null, requestId: null };
  }

  class ApiError extends Error {
    constructor(code, message, extra) {
      super(message);
      this.code = code;
      this.extra = extra || {};
    }
  }

  /* -------------------------------------------------------- 本地内核寻址 */

  /** 候选端口：宿主插件默认 4317，被占用会往后挪，最多 5 个（见 src/server/index.js）。 */
  const LOCAL_PORTS = [4317, 4318, 4319, 4320, 4321];
  let localBaseCache = '';
  let localProbe = null;

  /**
   * 探测本机内核。
   *
   * 判据是版本号以 `-local` 结尾，而不是「端口通了就用」—— 4317 上完全可能跑着别人的服务，
   * 盲目信任端口会把请求打到不相干的后端上。探到就缓存；探不到不缓存，刷新时还能重试。
   */
  async function detectLocalBase() {
    if (localBaseCache) return localBaseCache;
    if (localProbe) return localProbe;
    localProbe = (async () => {
      const location = globalThis.location;
      if (BROWSER_WORKSPACE) {
        localBaseCache = location.origin;
        return localBaseCache;
      }
      const servedPreview = location?.protocol === 'http:'
        && ['127.0.0.1', 'localhost'].includes(location.hostname)
        && location.pathname.startsWith('/preview/');
      const candidates = new Set([
        ...(servedPreview ? [location.origin] : []),
        ...LOCAL_PORTS.map((port) => `http://127.0.0.1:${port}`),
      ]);
      for (const base of candidates) {
        try {
          const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
          const timer = setTimeout(() => ctrl && ctrl.abort(), 700);
          const res = await fetch(`${base}/health`, {
            signal: ctrl ? ctrl.signal : undefined,
            credentials: 'omit',
          });
          clearTimeout(timer);
          if (!res.ok) continue;
          const body = await res.json().catch(() => null);
          const kernel = body?.data || body;
          const version = String(kernel?.version || '');
          const ownPreview = servedPreview && base === location.origin;
          if (version.endsWith('-local') && (ownPreview || kernel.runtime === 'plugin')) {
            localBaseCache = base;
            return base;
          }
        } catch (_e) {
          /* 这个端口上没服务，试下一个 */
        }
      }
      return '';
    })();
    const found = await localProbe;
    localProbe = null;
    return found;
  }

  /** 请求该打到哪里。本地模式下即使还没探到也绝不返回空串 —— 空串会变成相对路径，
   *  请求就打到预览页自己身上，报出一堆 404 而不是「内核没起来」。 */
  function baseOf(settings) {
    if (BROWSER_WORKSPACE) return globalThis.location.origin;
    if (settings && settings.mode === 'local') return localBaseCache || `http://127.0.0.1:${LOCAL_PORTS[0]}`;
    return (settings && settings.baseUrl) || '';
  }

  /** 「要真后端」的模式：本地内核与远程网关都算，演示数据不算。 */
  function isRemote(settings) {
    return Boolean(settings) && (settings.mode === 'http' || settings.mode === 'local');
  }

  /** 数据来源标签：三档各有各的名字，别再让本地内核自称「网关」。 */
  function sourceLabel(t, mode) {
    if (WEKNORA) return 'WeKnora';
    if (mode === 'mock') return t('source.mock');
    if (mode === 'local') return t('source.local');
    return t('source.http');
  }

  function joinUrl(baseUrl, path) {
    const base = (baseUrl || '').trim().replace(/\/+$/, '');
    return base ? base + path : path;
  }

  function backendRoute(path, method, body) {
    if (!WEKNORA) return { path, body };
    const target = WEKNORA.route(path, method, body);
    if (!target) throw new ApiError('NOT_IMPLEMENTED', '此功能请在 WeKnora 管理页操作。', { status: 404 });
    return target;
  }

  function backendEnvelope(path, payload) {
    return unwrap(WEKNORA ? WEKNORA.reply(path, payload) : payload);
  }

  async function requestJson(baseUrl, path, timeoutMs) {
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = setTimeout(() => controller && controller.abort(), timeoutMs);
    try {
      const target = backendRoute(path, 'GET');
      const res = await fetch(joinUrl(baseUrl, target.path), {
        method: 'GET',
        headers: withAuth({ Accept: 'application/json' }),
        signal: controller ? controller.signal : undefined,
        credentials: 'omit',
      });
      let body = null;
      try {
        body = await res.json();
      } catch (_e) {
        body = null;
      }
      if (res.status === 404) throw new ApiError('NOT_IMPLEMENTED', `HTTP 404 ${path}`, { status: 404, requestId: null });
      if (!res.ok) {
        const env = backendEnvelope(path, body);
        const msg = (env.error && env.error.message) || `HTTP ${res.status}`;
        // P3：原生错误要能定位到请求 —— requestId 原样带回界面
        throw new ApiError(env.error?.code || 'HTTP_ERROR', msg, {
          status: res.status,
          body,
          requestId: (env.error && env.error.requestId) || env.requestId || null,
        });
      }
      return { ...backendEnvelope(path, body), status: res.status };
    } catch (error) {
      if (error && error.name === 'AbortError') {
        throw new ApiError('UPSTREAM_TIMEOUT', `timeout ${timeoutMs}ms`, { timeoutMs });
      }
      if (error instanceof ApiError) throw error;
      throw new ApiError('SOURCE_UNAVAILABLE', (error && error.message) || 'network error', {});
    } finally {
      clearTimeout(timer);
    }
  }

  /** Sends a write request whose response uses the standard JSON envelope. */
  async function sendJson(baseUrl, path, body, timeoutMs, method = 'POST') {
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = setTimeout(() => controller && controller.abort(), timeoutMs);
    try {
      const target = backendRoute(path, method, body);
      const multipart = target.body instanceof FormData;
      const res = await fetch(joinUrl(baseUrl, target.path), {
        method,
        headers: withAuth(multipart ? { Accept: 'application/json' } : { Accept: 'application/json', 'Content-Type': 'application/json' }),
        body: multipart ? target.body : JSON.stringify(target.body),
        signal: controller ? controller.signal : undefined,
        credentials: 'omit',
      });
      let json = null;
      try {
        json = await res.json();
      } catch (_e) {
        json = null;
      }
      if (res.status === 404) throw new ApiError('NOT_IMPLEMENTED', `HTTP 404 ${path}`, { status: 404, requestId: null });
      if (!res.ok) {
        const msg = backendEnvelope(path, json).error?.message || (json && (json.message || json.detail)) || `HTTP ${res.status}`;
        throw new ApiError('HTTP_ERROR', msg, {
          status: res.status,
          body: json,
          requestId: (json && (json.requestId || (json.error && json.requestId))) || null,
        });
      }
      const env = backendEnvelope(path, json);
      if (!env.ok) {
        // 失败信封里的 requestId 是排障线索，随错误一起抛给界面
        throw new ApiError(env.error?.code || 'API_ERROR', env.error?.message || 'error', {
          body: json,
          requestId: env.error?.requestId || env.requestId || null,
        });
      }
      return env.data;
    } catch (error) {
      if (error && error.name === 'AbortError') throw new ApiError('UPSTREAM_TIMEOUT', `timeout ${timeoutMs}ms`, {});
      if (error instanceof ApiError) throw error;
      throw new ApiError('SOURCE_UNAVAILABLE', (error && error.message) || 'network error', {});
    } finally {
      clearTimeout(timer);
    }
  }

  const postJson = sendJson;

  /** 上传必须用 XHR：fetch 拿不到上传进度，而进度条是模块 2 的验收点。 */
  function uploadFileXHR(baseUrl, path, file, onProgress) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      const target = backendRoute(path, 'POST');
      xhr.open('POST', joinUrl(baseUrl, target.path));
      for (const [key, value] of Object.entries(withAuth({}))) xhr.setRequestHeader(key, value);
      xhr.timeout = 180000;
      if (onProgress) {
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) onProgress(e.loaded / e.total);
        };
      }
      const finish = (code, message, body) => reject(new ApiError(code, message, body || {}));
      xhr.onload = () => {
        let json = null;
        try {
          json = JSON.parse(xhr.responseText);
        } catch (_e) {
          json = null;
        }
        if (xhr.status >= 400) {
          const msg = backendEnvelope(path, json).error?.message || (json && (json.message || json.detail)) || `HTTP ${xhr.status}`;
          finish(xhr.status === 502 ? 'UPSTREAM_ERROR' : 'HTTP_ERROR', msg, { status: xhr.status, body: json });
          return;
        }
        const env = backendEnvelope(path, json);
        if (!env.ok) {
          finish(env.error?.code || 'API_ERROR', env.error?.message || 'upload failed', { body: json });
          return;
        }
        // 上游可能包一层 {knowledge:{...}}，两种都认
        const doc = env.data && env.data.knowledge ? env.data.knowledge : env.data;
        resolve(normalizeDoc(doc));
      };
      xhr.onerror = () => finish('SOURCE_UNAVAILABLE', 'network error');
      xhr.ontimeout = () => finish('UPSTREAM_TIMEOUT', 'timeout');
      const fd = new FormData();
      fd.append('file', file, file.name);
      xhr.send(fd); // Content-Type 让浏览器自己带 boundary
    });
  }

  /* ------------------------------------------------------------ 项目 API */

  async function readCollection(settings, path) {
    const base = baseOf(settings);
    const read = async (url) => {
      const response = await requestJson(base, url, 15000);
      if (!response.ok) throw new ApiError(response.error?.code, response.error?.message);
      return toList(response.data);
    };
    const first = await read(path);
    if (!WEKNORA) return first;
    const items = [...first.items];
    for (let page = 2; items.length < first.total; page += 1) {
      const next = await read(`${path}?page=${page}`);
      if (next.items.length === 0) break;
      items.push(...next.items);
    }
    return { ...first, items };
  }

  const api = {
    async listModels(settings) {
      const env = await requestJson(baseOf(settings), '/api/v1/models?type=Embedding', 8000);
      return toList(env.data).items.map(normalizeModel).filter(Boolean);
    },
    async createKb(settings, body) {
      const data = await postJson(baseOf(settings), '/api/v1/knowledge-bases', body, 30000);
      return normalizeKb(data);
    },
    async listDocuments(settings, kbId) {
      const list = await readCollection(settings, `/api/v1/knowledge-bases/${encodeURIComponent(kbId)}/documents`);
      return { items: list.items.map(normalizeDoc).filter(Boolean), total: list.total };
    },
    uploadDocument(settings, kbId, file, onProgress) {
      return uploadFileXHR(
        baseOf(settings),
        `/api/v1/knowledge-bases/${encodeURIComponent(kbId)}/documents`,
        file,
        onProgress,
      );
    },
    async getDocument(settings, docId) {
      const env = await requestJson(baseOf(settings), `/api/v1/documents/${encodeURIComponent(docId)}`, 10000);
      return normalizeDoc(env.data);
    },
    async getSpans(settings, docId) {
      const env = await requestJson(
        baseOf(settings),
        `/api/v1/documents/${encodeURIComponent(docId)}/spans`,
        10000,
      );
      return env.data || null;
    },
    async getChunks(settings, docId, page, pageSize) {
      const env = await requestJson(
        baseOf(settings),
        `/api/v1/documents/${encodeURIComponent(docId)}/chunks?page=${page}&page_size=${pageSize}`,
        15000,
      );
      const list = toList(env.data);
      return {
        items: list.items.map(normalizeChunk).filter(Boolean),
        total: list.total,
      };
    },

    /* --- 模块 4：检索 ------------------------------------------------- */
    async search(settings, input) {
      const body = { query: input.query };
      if (input.kbIds && input.kbIds.length) body.knowledgeBaseIds = input.kbIds;
      if (input.matchCount) body.matchCount = input.matchCount;
      const data = await postJson(baseOf(settings), '/api/v1/search', body, 30000);
      const list = toList(data);
      return {
        items: list.items.map(normalizeHit).filter(Boolean),
        meta: (data && data.meta) || null,
      };
    },

    /* --- 模块 7：插件 ------------------------------------------------ */
    /** 服务端插件清单：网关实现了就返回真实状态，没实现会抛 NOT_IMPLEMENTED，
     *  调用方据此显示「读不到」，而不是假装插件已经装了。 */
    async listPlugins(settings) {
      const env = await requestJson(baseOf(settings), '/api/v1/plugins', 8000);
      const list = toList(env.data);
      return list.items;
    },

    /* --- 模块 5：会话与问答 ------------------------------------------- */
    async listSessions(settings) {
      const env = await requestJson(baseOf(settings), '/api/v1/sessions', 12000);
      return toList(env.data).items.map(normalizeSession).filter(Boolean);
    },
    async createSession(settings, title) {
      const body = title ? { title } : {};
      const data = await postJson(baseOf(settings), '/api/v1/sessions', body, 12000);
      return normalizeSession(data);
    },
    async listMessages(settings, sessionId, limit) {
      const env = await requestJson(
        baseOf(settings),
        `/api/v1/sessions/${encodeURIComponent(sessionId)}/messages?limit=${limit || 30}`,
        15000,
      );
      return toList(env.data).items.map((msg) => normalizeMessage(msg, sessionId)).filter(Boolean);
    },
    async agentReferences(settings, content, refs) {
      // WeKnora agent answers can contain native citation tags without a separate references event.
      const missing = new Map();
      for (const [tag] of content.matchAll(KB_TAG)) {
        const id = tagAttr(tag, 'chunk_id');
        if (id && !missing.has(id) && !citationIndex(tag, refs)) missing.set(id, tag);
      }
      const loaded = await Promise.allSettled(Array.from(missing, async ([id, tag]) => {
        const env = await requestJson(baseOf(settings), `/api/v1/chunks/by-id/${encodeURIComponent(id)}`, 12000);
        const chunk = env.data;
        const kbId = tagAttr(tag, 'kb_id');
        if (chunk?.id !== id || !chunk.knowledgeId || (kbId && kbId !== chunk.knowledgeBaseId)) return null;
        return normalizeRef({ ...chunk, knowledgeTitle: tagAttr(tag, 'doc') });
      }));
      return loaded.flatMap((result) => result.status === 'fulfilled' && result.value ? [result.value] : []);
    },
    askStream(settings, sessionId, body, handlers) {
      return streamAnswer(
        baseOf(settings),
        `/api/v1/sessions/${encodeURIComponent(sessionId)}/messages`,
        body,
        handlers,
      );
    },

    /* --- 模块 6：Wiki（契约见 docs/handoff/C-PLUGIN-PORT.md §五）-------- */
    async wikiTree(settings, kbId) {
      const list = await readCollection(settings, `/api/v1/knowledge-bases/${encodeURIComponent(kbId)}/wiki/tree`);
      return list.items.map(normalizeWikiPage).filter(Boolean);
    },
    async wikiPage(settings, kbId, slug) {
      const env = await requestJson(
        baseOf(settings),
        `/api/v1/knowledge-bases/${encodeURIComponent(kbId)}/wiki/pages/${encodeURIComponent(slug)}`,
        15000,
      );
      return normalizeWikiPage(env.data);
    },

    /* --- P1：ClipService（提案合同见 docs/handoff/D-CLIP-SERVICE.md）---------
     * 四个端点对应 HANDOFF §9 的设计目标：createCandidate / preview /
     * commit(expectedRevision + idempotencyKey) / getImportStatus。
     * 网关没实现时如实抛 NOT_IMPLEMENTED，界面上标「A 侧待实现」，不假装入库成功。 */
    async createClip(settings, body) {
      const data = await postJson(baseOf(settings), '/api/v1/clips', body, 30000);
      return normalizeClip(data);
    },
    async getClip(settings, clipId) {
      const env = await requestJson(baseOf(settings), `/api/v1/clips/${encodeURIComponent(clipId)}`, 15000);
      return normalizeClip(env.data);
    },
    async commitClip(settings, clipId, body) {
      const data = await postJson(
        baseOf(settings),
        `/api/v1/clips/${encodeURIComponent(clipId)}/commit`,
        body,
        30000,
      );
      return normalizeClip(data);
    },
    async getJob(settings, jobId) {
      const env = await requestJson(baseOf(settings), `/api/v1/jobs/${encodeURIComponent(jobId)}`, 15000);
      return env.data || null;
    },
    /* --- P2：BrowserSkill 桥状态（提案端点；需要 A 侧桥 + 本机 bsk daemon）--- */
    async browserStatus(settings) {
      const env = await requestJson(baseOf(settings), '/api/v1/browser/status', 8000);
      return env.data || null;
    },
  };

  /** P1 采集候选（ClipService 提案合同的客户端归一化）。
   *  字段与 HANDOFF §9 一致：状态机、去重键、工程元数据、版本裁决结果。 */
  function normalizeClip(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const id = String(raw.id || raw.clipId || '');
    const status = String(raw.status || 'draft');
    const known = CLIP_TRANSITIONS[status] ? status : 'draft';
    return {
      id: id || `clip-${Math.random().toString(36).slice(2, 8)}`,
      status: known,
      captureMode: String(raw.captureMode || 'url'),
      targetKbId: String(raw.targetKbId || ''),
      originUrl: String(raw.originUrl || ''),
      title: String(raw.title || ''),
      contentMarkdown: String(raw.contentMarkdown || ''),
      note: String(raw.note || ''),
      summary: String(raw.summary || ''),
      dedupeKey: String(raw.dedupeKey || ''),
      contentHash: String(raw.contentHash || ''),
      engineeringMetadata: raw.engineeringMetadata || {},
      lifecycleStatus: String(raw.lifecycleStatus || 'unknown'),
      outcome: String(raw.outcome || ''), // create / reuse / new_version
      versionId: String(raw.versionId || ''),
      previousVersionId: String(raw.previousVersionId || ''),
      documentId: String(raw.documentId || ''),
      jobId: String(raw.jobId || ''),
      revision: raw.revision == null ? null : raw.revision,
      error: raw.error || null,
      preview: raw.preview || null,
      capturedAt: String(raw.capturedAt || ''),
    };
  }

  /** 分块对象：content / chunkIndex / startAt / endAt / indexStatus（契约 3.3）。 */
  function normalizeChunk(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const id = String(raw.id || '');
    const content = String(raw.content ?? '');
    if (!id && !content) return null;
    return {
      id: id || `idx-${raw.chunkIndex ?? 'x'}`,
      content,
      chunkIndex: numOrNull(raw.chunkIndex),
      startAt: numOrNull(raw.startAt),
      endAt: numOrNull(raw.endAt),
      chunkType: String(raw.chunkType || 'text'),
      indexStatus: String(raw.indexStatus || '').toLowerCase(),
      isEnabled: raw.isEnabled !== false,
    };
  }


  /* ----------------------------------------------------------------- Mock */

  // 演示数据与契约字段一一对应（A 的 docs/api.md 2026-11-12 版），
  // 不再发明 revision / chunkingProfile 这类后端没有的字段。
  const MOCK_KBS = [
    {
      id: 'kb-std-001',
      name: '工程标准库',
      description: '企业标准、国标与供应商规范（GB/T、Q/SC 系列）',
      type: 'document',
      embeddingModelId: 'builtin-ollama-embedding',
      knowledgeCount: 3,
      chunkCount: 46,
      updatedAt: '2026-11-12T09:40:00+08:00',
    },
    {
      id: 'kb-prj-2026',
      name: '项目 P-2026 资料库',
      description: '装配图纸、BOM 与试验报告',
      type: 'document',
      embeddingModelId: 'builtin-ollama-embedding',
      knowledgeCount: 2,
      chunkCount: 12,
      updatedAt: '2026-11-12T10:05:00+08:00',
    },
    {
      id: 'kb-fmea',
      name: '故障与 FMEA 库',
      description: '现场失效现象、已确认原因与措施验证记录',
      type: 'faq',
      embeddingModelId: 'builtin-ollama-embedding',
      knowledgeCount: 0,
      chunkCount: 0,
      updatedAt: '2026-11-11T17:22:00+08:00',
    },
  ];

  const MOCK_MODELS = [
    {
      id: 'builtin-ollama-embedding',
      name: 'bge-m3',
      displayName: 'bge-m3（本地 Ollama · 1024 维）',
      type: 'Embedding',
      source: 'local',
      isDefault: true,
    },
    {
      id: 'embed-qwen3-256',
      name: 'qwen3-embedding',
      displayName: 'qwen3-embedding（云端 · 256 维）',
      type: 'Embedding',
      source: 'remote',
      isDefault: false,
    },
  ];

  /** 演示文档：覆盖 pending / processing / failed / completed 与分块、失败轨迹。
   *  日期用相对量生成，截图时永远是「几分钟前」的样子。 */
  function minutesAgo(n) {
    return new Date(Date.now() - n * 60000).toISOString();
  }

  const MOCK_DOCS = {
    'kb-std-001': [
      {
        id: 'doc-err-003',
        title: '供应商试验报告 2026Q3',
        fileName: '供应商试验报告_2026Q3.pdf',
        fileType: 'pdf',
        fileSize: 5 * 1024 * 1024 + 230 * 1024,
        parseStatus: 'failed',
        embeddingModelId: 'builtin-ollama-embedding',
        createdAt: minutesAgo(58),
        processedAt: minutesAgo(46),
        errorMessage: '向向量库写入失败：collection kb-std-001 不存在',
        failedStage: 'embedding',
        errorCode: 'VECTORSTORE_WRITE_FAILED',
        attempt: 4,
      },
      {
        id: 'doc-run-002',
        title: '装配工艺卡 P-2026-018',
        fileName: '装配工艺卡P-2026-018.docx',
        fileType: 'docx',
        fileSize: 860 * 1024,
        parseStatus: 'processing',
        embeddingModelId: 'builtin-ollama-embedding',
        createdAt: minutesAgo(6),
        stageIndex: 2, // 0 基：docreader、chunking 已完成，正在 embedding
        attempt: 1,
      },
      {
        id: 'doc-ok-001',
        title: 'GB/T 3452.1 液压气动用 O 形橡胶密封圈',
        fileName: 'GBT_3452.1-2005.pdf',
        fileType: 'pdf',
        fileSize: 2 * 1024 * 1024 + 460 * 1024,
        parseStatus: 'completed',
        embeddingModelId: 'builtin-ollama-embedding',
        createdAt: minutesAgo(2880),
        processedAt: minutesAgo(2879),
        chunkCount: 12,
        attempt: 1,
      },
    ],
    'kb-prj-2026': [
      {
        id: 'doc-pen-004',
        title: '螺栓拧紧力矩表',
        fileName: '螺栓拧紧力矩表.xlsx',
        fileType: 'xlsx',
        fileSize: 120 * 1024,
        parseStatus: 'pending',
        embeddingModelId: 'builtin-ollama-embedding',
        createdAt: minutesAgo(1),
        attempt: 1,
      },
      {
        id: 'doc-ok-005',
        title: '项目周报 2026W45',
        fileName: '项目周报_2026W45.md',
        fileType: 'md',
        fileSize: 18 * 1024,
        parseStatus: 'completed',
        embeddingModelId: 'builtin-ollama-embedding',
        createdAt: minutesAgo(1000),
        processedAt: minutesAgo(1000),
        chunkCount: 4,
        attempt: 1,
      },
    ],
  };

  const MOCK_CHUNK_TEXTS = [
    '表 3 螺栓拧紧力矩（N·m）\n规格 M8 8.8 级：24 N·m；M10 8.8 级：49 N·m；M12 8.8 级：86 N·m。\n拧紧顺序按对角线交叉进行，分两次拧紧到规定力矩。',
    '4.2 密封件安装\nO 形圈安装前应检查表面，不得有划伤、缺胶及老化裂纹。安装时使用无尖锐边缘的导入工具，禁止直接拉伸后套装。',
    '5.1 试验条件\n环境温度 23±5 ℃，相对湿度 45%~75%。试验介质为 46 号抗磨液压油，系统压力 16 MPa，保压时间不少于 10 min。',
    '6.3 判定\n保压期间任何结合面不得出现渗漏；试验后 O 形圈外观无异常变形。有一项不合格即判该批次不合格。',
  ];

  /**
   * 演示 Wiki（模块 6）：字段与 normalizeWikiPage 一致。
   * 内容引用上面的演示分块与文档，避免Wiki看起来悬空。
   */
  const MOCK_WIKI = {
    'kb-std-001': [
      {
        slug: 'sealing-assembly',
        title: '密封件装配要点',
        type: 'topic',
        status: 'published',
        summary: 'O 形圈安装、检查与禁忌动作的汇总页。',
        version: 3,
        updatedAt: minutesAgo(300),
        sources: [
          { knowledgeId: 'doc-ok-001', title: 'GB/T 3452.1 液压气动用 O 形橡胶密封圈', chunkCount: 4 },
        ],
        content: [
          '本页汇总与 O 形圈装配直接相关的条目，供装配现场查阅。',
          '',
          '安装前检查：',
          '',
          '- 检查 O 形圈表面，不得有划伤、缺胶及老化裂纹',
          '- 使用无尖锐边缘的导入工具',
          '- 禁止直接拉伸后套装',
          '',
          '相关条目：渗漏判定、试验条件。',
        ].join('\n'),
      },
      {
        slug: 'o-ring',
        title: 'O 形圈',
        type: 'entity',
        status: 'published',
        summary: '液压气动密封元件，本库含安装、判定与外观要求。',
        version: 2,
        updatedAt: minutesAgo(1200),
        sources: [
          { knowledgeId: 'doc-ok-001', title: 'GB/T 3452.1 液压气动用 O 形橡胶密封圈', chunkCount: 12 },
        ],
        content: [
          'O 形圈是液压气动系统中用量最大的密封元件。本库覆盖 GB/T 3452.1 给出的尺寸、公差与安装要求。',
          '',
          '判定规则：保压期间任何结合面不得出现渗漏；试验后 O 形圈外观无异常变形。有一项不合格即判该批次不合格。',
        ].join('\n'),
      },
      {
        slug: 'leak-test',
        title: '渗漏判定',
        type: 'topic',
        status: 'published',
        summary: '保压试验的判定条款与适用条件。',
        version: 1,
        updatedAt: minutesAgo(2880),
        sources: [
          { knowledgeId: 'doc-ok-001', title: 'GB/T 3452.1 液压气动用 O 形橡胶密封圈', chunkCount: 2 },
        ],
        content: [
          '试验条件：环境温度 23±5 ℃，相对湿度 45%~75%，试验介质为 46 号抗磨液压油，系统压力 16 MPa，保压不少于 10 min。',
          '',
          '判定：保压期间任何结合面不得出现渗漏；试验后外观无异常变形。',
          '',
          '注：本条款适用于出厂检验批；型式试验另有规定。',
        ].join('\n'),
      },
      {
        slug: 'torque-spec',
        title: '螺栓拧紧力矩规范',
        type: 'topic',
        status: 'draft',
        summary: '8.8 级螺栓拧紧力矩与顺序要求（草稿，待复核）。',
        version: 1,
        updatedAt: minutesAgo(60),
        sources: [
          { knowledgeId: 'doc-pen-004', title: '螺栓拧紧力矩表', chunkCount: 3 },
        ],
        content: [
          '规格 M8 8.8 级：24 N·m；M10 8.8 级：49 N·m；M12 8.8 级：86 N·m。',
          '',
          '拧紧顺序按对角线交叉进行，分两次拧紧到规定力矩。',
          '',
          '本页为草稿：力矩表原始文档仍在处理队列，数值引用前请核对原表。',
        ].join('\n'),
      },
    ],
    'kb-prj-2026': [
      {
        slug: 'project-p2026',
        title: '项目 P-2026 装配档案',
        type: 'hub',
        status: 'draft',
        summary: 'P-2026 项目装配相关的工艺卡、周报汇总入口。',
        version: 1,
        updatedAt: minutesAgo(30),
        sources: [
          { knowledgeId: 'doc-run-002', title: '装配工艺卡 P-2026-018', chunkCount: 6 },
          { knowledgeId: 'doc-ok-005', title: '项目周报 2026W45', chunkCount: 4 },
        ],
        content: [
          '本页是项目 P-2026 的 Wiki 入口：装配工艺卡 P-2026-018 正在处理，周报 2026W45 已入库。',
          '',
          '待办：',
          '',
          '- 工艺卡完成后把装配步骤拆为独立实体页',
          '- 周报引用数达到 8 条后发布本页',
        ].join('\n'),
      },
    ],
  };


  function mockChunksFor(doc, page, pageSize) {
    const total = doc.parseStatus === 'completed' ? doc.chunkCount || 12 : 3;
    const start = (page - 1) * pageSize;
    if (start >= total) return { items: [], total, pageSize };
    const count = Math.min(pageSize, total - start);
    const items = [];
    for (let i = 0; i < count; i += 1) {
      const idx = start + i;
      const content = MOCK_CHUNK_TEXTS[idx % MOCK_CHUNK_TEXTS.length];
      const chars = content.length + 180 * (idx % 3);
      items.push({
        id: `chunk-${doc.id}-${idx + 1}`,
        content: idx % 2 === 0 ? content : content + '\n注：本条款适用于出厂检验批；型式试验另有规定。',
        chunkIndex: idx,
        startAt: idx * 640,
        endAt: idx * 640 + chars,
        chunkType: 'text',
        indexStatus: doc.parseStatus === 'failed' ? 'failed' : 'ready',
        isEnabled: true,
      });
    }
    return { items, total, pageSize };
  }

  /** 演示轨迹：从 parseStatus / stageIndex / failedStage 推导，和上游 spans 同构。 */
  function mockSpansFor(doc) {
    const failedIdx = doc.failedStage ? STAGE_NAMES.indexOf(doc.failedStage) : -1;
    const children = STAGE_NAMES.map((name, i) => {
      let status = 'pending';
      if (doc.parseStatus === 'completed') status = 'done';
      else if (doc.parseStatus === 'pending') status = 'pending';
      else if (doc.parseStatus === 'processing') {
        status = i < (doc.stageIndex || 0) ? 'done' : i === (doc.stageIndex || 0) ? 'running' : 'pending';
      } else if (doc.parseStatus === 'failed') {
        if (failedIdx < 0) status = 'done';
        else status = i < failedIdx ? 'done' : i === failedIdx ? 'failed' : 'cancelled';
      } else if (doc.parseStatus === 'cancelled') {
        status = i < 2 ? 'done' : 'cancelled';
      }
      const node = { name, status, startedAt: minutesAgo(40 - i * 4) };
      if (status === 'failed') {
        node.errorCode = doc.errorCode || 'UNKNOWN';
        node.errorMessage = doc.errorMessage || '';
        node.finishedAt = minutesAgo(30);
      }
      if (status === 'done') node.durationMs = 1200 + i * 900;
      return node;
    });
    const running = children.find((c) => c.status === 'running');
    const failed = children.find((c) => c.status === 'failed');
    return {
      knowledgeId: doc.id,
      attempt: doc.attempt || 1,
      latestAttempt: doc.attempt || 1,
      parseStatus: doc.parseStatus,
      currentStage: running ? running.name : failed ? failed.name : '',
      trace: { name: 'knowledge_processing', status: doc.parseStatus, children },
      lastError: failed
        ? { stage: failed.name, code: failed.errorCode, message: failed.errorMessage }
        : null,
    };
  }

  /** 演示上传：400ms 走完进度，然后文档进入 pending，之后由 mockTick 推进处理。 */
  async function mockUpload(kbId, file, onProgress) {
    for (let i = 1; i <= 10; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await new Promise((r) => setTimeout(r, 40));
      if (onProgress) onProgress(i / 10);
    }
    const doc = {
      id: 'doc-mock-' + Math.random().toString(36).slice(2, 8),
      title: file.name.replace(/\.[^.]+$/, ''),
      fileName: file.name,
      fileType: (file.name.split('.').pop() || '').toLowerCase(),
      fileSize: file.size,
      parseStatus: 'pending',
      embeddingModelId: 'builtin-ollama-embedding',
      createdAt: new Date().toISOString(),
      attempt: 1,
      _live: true, // 只有它会被 mockTick 推进；种子数据保持静止，便于评审状态
    };
    MOCK_DOCS[kbId] = [doc, ...(MOCK_DOCS[kbId] || [])];
    return doc;
  }

  /** 每 3 秒推进一步演示管线：pending → processing(stage0..4) → completed。 */
  function ensureMockTicker() {
    if (mockTicker) return;
    mockTicker = setInterval(() => {
      let live = 0;
      for (const docs of Object.values(MOCK_DOCS)) {
        for (const doc of docs) {
          if (!doc._live) continue;
          live += 1;
          if (doc.parseStatus === 'pending') {
            doc.parseStatus = 'processing';
            doc.stageIndex = 0;
          } else if (doc.parseStatus === 'processing') {
            doc.stageIndex = (doc.stageIndex || 0) + 1;
            if (doc.stageIndex >= STAGE_NAMES.length) {
              doc.parseStatus = 'completed';
              doc.processedAt = new Date().toISOString();
              doc.chunkCount = 6 + Math.floor(Math.random() * 9);
            }
          }
        }
      }
      if (!live && mockTicker) {
        clearInterval(mockTicker);
        mockTicker = null;
      }
    }, 3000);
  }
  let mockTicker = null;

  async function mockListDocs(kbId) {
    await new Promise((r) => setTimeout(r, 180));
    const docs = (MOCK_DOCS[kbId] || []).map((d) => normalizeDoc({ ...d }));
    return { items: docs, total: null };
  }

  async function mockGetDoc(docId) {
    await new Promise((r) => setTimeout(r, 120));
    for (const docs of Object.values(MOCK_DOCS)) {
      const hit = docs.find((d) => d.id === docId);
      if (hit) return normalizeDoc({ ...hit });
    }
    throw new ApiError('NOT_FOUND', `文档不存在（演示数据）：${docId}`);
  }

  async function mockGetSpans(docId) {
    await new Promise((r) => setTimeout(r, 140));
    for (const docs of Object.values(MOCK_DOCS)) {
      const hit = docs.find((d) => d.id === docId);
      if (hit) return mockSpansFor(hit);
    }
    throw new ApiError('NOT_FOUND', `文档不存在（演示数据）：${docId}`);
  }

  async function mockGetChunks(docId, page, pageSize) {
    await new Promise((r) => setTimeout(r, 160));
    for (const docs of Object.values(MOCK_DOCS)) {
      const hit = docs.find((d) => d.id === docId);
      if (hit) return mockChunksFor(hit, page, pageSize);
    }
    throw new ApiError('NOT_FOUND', `文档不存在（演示数据）：${docId}`);
  }

  /* ------------------------------------------------- 模块 4 / 5 的演示数据 */

  /** 演示检索：拿已完成的文档 + 现成块文本拼命中。
   *  打分用「中文二元组命中率」——按空格分词对中文没用，这里直接切 bigram。 */
  function mockSearchHits(query, kbIds) {
    const wanted = kbIds && kbIds.length ? kbIds : MOCK_KBS.map((k) => k.id);
    const hits = [];
    for (const kbId of wanted) {
      const docs = (MOCK_DOCS[kbId] || []).filter((d) => d.parseStatus === 'completed');
      docs.slice(0, 3).forEach((doc, di) => {
        MOCK_CHUNK_TEXTS.forEach((base, ci) => {
          // 每份文档错开一块，避免两个库里出现一模一样的片段（那不像真检索）
          const text = MOCK_CHUNK_TEXTS[(ci + di) % MOCK_CHUNK_TEXTS.length];
          const content = (di + ci) % 2 === 0 ? text : `${text}\n注：本条款适用于出厂检验批；型式试验另有规定。`;
          hits.push({
            id: `hit-${doc.id}-${ci}`,
            content,
            title: doc.title,
            fileName: doc.fileName,
            knowledgeId: doc.id,
            chunkIndex: ci,
            score: 0.3,
            matchType: ci % 3 === 0 ? 1 : 0,
            kbId,
            startAt: ci * 640,
            endAt: ci * 640 + content.length,
          });
        });
      });
    }

    const q = String(query || '').replace(/\s+/g, '');
    const grams = [];
    for (let i = 0; i < q.length - 1; i += 1) grams.push(q.slice(i, i + 2));
    const unique = Array.from(new Set(grams));

    hits.forEach((hit) => {
      if (unique.length === 0) {
        hit.score = 0.32;
        return;
      }
      let matched = 0;
      unique.forEach((gram) => {
        if (hit.content.indexOf(gram) >= 0) matched += 1;
      });
      const ratio = matched / unique.length;
      const titleHit = hit.title.indexOf(q.slice(0, 2)) >= 0 ? 0.06 : 0;
      // 每篇文档、每个块给一点固定偏移：真实检索里两篇文档不可能精确同分，
      // 不加这个，演示时会出现「81% / 81%」这种一眼假的并列。
      let seed = 0;
      const key = String(hit.knowledgeId || '');
      for (let k = 0; k < key.length; k += 1) seed = (seed * 31 + key.charCodeAt(k)) % 97;
      const bias = ((seed % 9) - 4) * 0.006 + (hit.chunkIndex % 4) * 0.004;
      hit.score = Math.min(0.94, Math.max(0.05, Number((0.3 + ratio * 0.58 + titleHit + bias).toFixed(4))));
    });
    hits.sort((a, b) => b.score - a.score);
    return {
      items: hits.slice(0, 6),
      meta: { rerank: { applied: false, outcome: 'disabled' } },
    };
  }

  const MOCK_SESSIONS = [
    {
      id: 'sess-demo-001',
      title: '装配力矩与密封件',
      createdAt: minutesAgo(180),
      updatedAt: minutesAgo(26),
    },
    {
      id: 'sess-demo-002',
      title: '试验条件确认',
      createdAt: minutesAgo(1500),
      updatedAt: minutesAgo(1400),
    },
  ];

  const MOCK_HISTORY = {
    'sess-demo-001': [
      {
        id: 'm-1',
        role: 'user',
        content: 'M10 的螺栓拧紧力矩是多少？',
        createdAt: minutesAgo(30),
      },
      {
        id: 'm-2',
        role: 'assistant',
        content:
          'M10、8.8 级螺栓的规定力矩是 **49 N·m**。\n\n- 按对角线交叉顺序分两次拧紧\n- 第一次到规定值的 50%，第二次到全额\n- 拧紧后做标记，便于复查',
        refs: [],
        createdAt: minutesAgo(29),
      },
    ],
  };

  function mockAnswerText(query, refs) {
    const first = refs[0];
    const src = first ? `《${first.title}》第 ${(first.chunkIndex || 0) + 1} 块` : '知识库';
    const quote = first ? first.content.split('\n').filter(Boolean).slice(0, 2).join('；') : '（演示数据：没有命中片段）';
    // 演示答案要带角标：引用校验、点击跳转才有东西可验（真实 SSE 的答案同样带 [n]）
    const cite = (index) => (refs[index - 1] ? ` [${index}]` : '');
    return [
      `根据 ${src} 的原文${cite(1)}，能确认的是：`,
      '',
      `${quote}${cite(2)}`,
      '',
      '要点：',
      '',
      `- 上述数值与条件仅在该文档规定的范围内成立${cite(3)}`,
      '- 原文没写的部分不作推断',
      '- 需要更完整的结论，请把问题问得更具体些',
      '',
      `（演示模式，问题：${query}）`,
    ].join('\n');
  }

  /** 演示流式：先给 references，再逐字吐 answer，最后 complete。
   *  分片、时序、终止条件都按真实 SSE 的语义走，好让界面状态机被真跑一遍。 */
  function mockAskStream(query, kbIds, handlers) {
    const cb = handlers || {};
    const timers = [];
    let cancelled = false;
    const refs = mockSearchHits(query, kbIds || []).items.slice(0, 3);
    const text = mockAnswerText(query, refs);
    let i = 0;

    const tick = () => {
      if (cancelled) return;
      if (i >= text.length) {
        cb.onDone && cb.onDone();
        return;
      }
      const step = 2 + Math.floor(Math.random() * 4);
      cb.onAnswer && cb.onAnswer(text.slice(i, i + step));
      i += step;
      timers.push(setTimeout(tick, 42));
    };

    timers.push(
      setTimeout(() => {
        if (!cancelled) cb.onReferences && cb.onReferences(refs);
      }, 260),
    );
    timers.push(setTimeout(tick, 520));

    return {
      cancel: () => {
        cancelled = true;
        timers.forEach((id) => clearTimeout(id));
        if (cb.onStopped) cb.onStopped();
      },
      promise: Promise.resolve(),
    };
  }

  async function mockListSessions() {
    await new Promise((r) => setTimeout(r, 120));
    return MOCK_SESSIONS.slice();
  }

  async function mockWikiTree(kbId) {
    await new Promise((r) => setTimeout(r, 140));
    // 树接口不给正文，界面拿到的字段与真实接口一致
    return (MOCK_WIKI[kbId] || []).map((p) => ({ ...p, content: '' }));
  }

  async function mockWikiPage(kbId, slug) {
    await new Promise((r) => setTimeout(r, 160));
    const page = (MOCK_WIKI[kbId] || []).find((p) => p.slug === slug);
    if (!page) throw new ApiError('NOT_FOUND', 'Wiki 页面不存在', { status: 404 });
    return { ...page };
  }

  async function mockCreateSession(title) {
    await new Promise((r) => setTimeout(r, 160));
    const now = new Date().toISOString();
    const session = {
      id: `sess-${Math.random().toString(36).slice(2, 10)}`,
      title: title || '',
      createdAt: now,
      updatedAt: now,
    };
    MOCK_SESSIONS.unshift(session);
    return session;
  }

  async function mockListMessages(sessionId) {
    await new Promise((r) => setTimeout(r, 140));
    return (MOCK_HISTORY[sessionId] || []).map((m) => normalizeMessage(m)).filter(Boolean);
  }

  /* ------------------------------------- P1/P4：采集候选与批量导入演示管线 */

  /**
   * 演示版 ClipService。与真实服务的合同一致（docs/handoff/D-CLIP-SERVICE.md），
   * 差别只在数据落在本机 localStorage：
   *   - 去重记录持久化：刷新页面后重复提交仍能命中「复用现有版本」（T05 可复验）
   *   - 同键新内容 → 追加版本并停用旧版（T06）
   *   - 内容含 [[FAIL_ONCE]] 标记的候选第一次提交失败，同一幂等键重试成功（T11）
   */
  const MOCK_CLIP_STORE_KEY = 'schanora.mockclips.v1';
  const MOCK_BATCH_DONE_KEY = 'schanora.mockbatch-done.v1';

  function mockStoreRead(key, fallback) {
    try {
      const raw = window.localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (_e) {
      return fallback;
    }
  }
  function mockStoreWrite(key, value) {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch (_e) {
      /* 隐私模式写不进去：内存态仍然正确，只是刷新后丢演示记录 */
    }
  }

  function mockClipStore() {
    const store = mockStoreRead(MOCK_CLIP_STORE_KEY, null);
    if (store && typeof store === 'object' && store.records) return store;
    return { seq: 0, records: {} };
  }

  /** 视图层查重预检：提交前就能看到「会复用 / 会出新版本 / 新资料」。
   *  查的是「来源键」（库 + 规范化 URL / 笔记标题），hash 只决定是复用还是新版本。 */
  function mockClipPrecheck(targetKbId, normalizedUrl, hash, title) {
    const key = dedupeKey(targetKbId, normalizedUrl, hash);
    if (!key) return null;
    const src = sourceKey(targetKbId, normalizedUrl, title);
    const existing = mockClipStore().records[src];
    return { key, sourceKey: src, decision: resolveVersion(existing, hash) };
  }

  const MOCK_CLIPS = new Map(); // clipId -> 内部记录（含定时器与失败注入标记）

  function mockClipSnapshot(rec) {
    return normalizeClip({
      ...rec,
      preview: { ...(rec.preview || {}), precheck: rec.precheck || null },
    });
  }

  async function mockCreateClip(input) {
    await new Promise((r) => setTimeout(r, 340));
    const norm = normalizeUrl(input.originUrl);
    if (input.originUrl && !norm.ok) {
      throw new ApiError('INVALID_URL', `URL 无法解析：${norm.reason}`, { reason: norm.reason });
    }
    const hash = contentHash(input.contentMarkdown || input.title || norm.url);
    const key = dedupeKey(input.targetKbId, norm.ok ? norm.url : '', hash);
    if (!key) throw new ApiError('SCOPE_REQUIRED', '缺少目标知识库，候选无法建立', {});
    const store = mockClipStore();
    const src = sourceKey(input.targetKbId, norm.ok ? norm.url : '', input.title || '');
    const rec = {
      id: `clip-${Math.random().toString(36).slice(2, 9)}`,
      status: 'previewReady',
      captureMode: input.captureMode || 'url',
      targetKbId: input.targetKbId,
      originUrl: input.originUrl || '',
      title: input.title || '',
      contentMarkdown: input.contentMarkdown || '',
      note: input.note || '',
      summary: '',
      dedupeKey: key,
      sourceKey: src,
      contentHash: hash,
      normalizedUrl: norm.url,
      engineeringMetadata: input.engineeringMetadata || {},
      lifecycleStatus: 'unknown',
      revision: 1,
      capturedAt: new Date().toISOString(),
      precheck: { key, sourceKey: src, decision: resolveVersion(store.records[src], hash) },
      preview: {
        assets: Array.isArray(input.assetRefs) ? input.assetRefs : [],
        excerpt: String(input.contentMarkdown || '').slice(0, 160),
        fetchedAt: new Date().toISOString(),
      },
      _failOnce: String(input.contentMarkdown || '').includes('[[FAIL_ONCE]]'),
      _timers: [],
    };
    MOCK_CLIPS.set(rec.id, rec);
    return mockClipSnapshot(rec);
  }

  /** 失败注入按幂等键只生效一次：重试（可能换了新候选 id）不会再次失败。 */
  const MOCK_FAIL_ONCE_SEEN = new Set();

  async function mockCommitClip(clipId, body) {
    await new Promise((r) => setTimeout(r, 280));
    const rec = MOCK_CLIPS.get(clipId);
    if (!rec) throw new ApiError('NOT_FOUND', `采集候选不存在（演示数据）：${clipId}`, {});
    const expected = body && body.expectedRevision;
    if (expected != null && expected !== rec.revision) {
      throw new ApiError('REVISION_CONFLICT', `候选已被修改（期望 r${expected}，当前 r${rec.revision}）`, {});
    }
    // 演示失败注入：同一幂等键第一次失败、重试成功 —— 批量页的「续跑不重复」靠它验证。
    // 状态记在幂等键上而不是候选上：重试会建立新候选（新 id），不能又失败一次。
    if (rec._failOnce && !MOCK_FAIL_ONCE_SEEN.has(rec.dedupeKey)) {
      MOCK_FAIL_ONCE_SEEN.add(rec.dedupeKey);
      rec.status = 'failed';
      rec.error = { code: 'MOCK_INGEST_FAILED', message: '演示失败：OneDrive 保存超时；同一幂等键重试可成功。' };
      return mockClipSnapshot(rec);
    }

    const store = mockClipStore();
    const existing = store.records[rec.sourceKey];
    const decision = resolveVersion(existing, rec.contentHash);
    const now = new Date().toISOString();

    if (decision.action === 'reuse') {
      // 同键同内容：不新建副本，直接指回现有文档与版本
      rec.status = 'ready';
      rec.outcome = 'reuse';
      rec.versionId = decision.versionId;
      rec.documentId = existing.documentId;
      rec.finishedAt = now;
      return mockClipSnapshot(rec);
    }

    // create / new_version：queued → processing → ready，视图轮询 getClip 看进度
    store.seq = (store.seq || 0) + 1;
    const versionId = `v${store.seq}`;
    const documentId = existing ? existing.documentId : `doc-clip-${Math.random().toString(36).slice(2, 8)}`;
    const record = existing || { documentId, title: rec.title, versions: [] };
    record.title = rec.title || record.title;
    record.versions.forEach((v) => {
      v.active = false;
    });
    record.versions.push({ versionId, hash: rec.contentHash, active: true, createdAt: now, capturedFrom: rec.originUrl });
    store.records[rec.sourceKey] = record;
    mockClipSaveStore(store);

    rec.status = 'queued';
    rec.outcome = decision.action;
    rec.versionId = versionId;
    rec.previousVersionId = decision.previousVersionId || '';
    rec.documentId = documentId;
    rec.jobId = `job-${Math.random().toString(36).slice(2, 8)}`;

    /* 演示闭环：提交成功就必须能在文档列表里看到这份文档。
       以前只推进 clip 自己的状态，MOCK_DOCS 不动 —— 于是界面上「已提交」，
       进库却查无此文，等于演示层的假成功（2026-11-17 存选区时暴露）。
       new_version 复用同一 documentId，不新增第二份；_live 交给 ticker 推进。 */
    const kbDocs = MOCK_DOCS[rec.targetKbId] || (MOCK_DOCS[rec.targetKbId] = []);
    const known = kbDocs.find((d) => d.id === documentId);
    if (known) {
      known.parseStatus = 'pending';
      known.failedStage = '';
      known.errorMessage = '';
      known._live = true;
      known.attempt = (known.attempt || 1) + 1;
    } else {
      kbDocs.unshift({
        id: documentId,
        title: rec.title || '未命名文档',
        fileName: `${rec.title || '未命名文档'}.md`,
        fileType: 'md',
        fileSize: String(rec.contentMarkdown || '').length,
        parseStatus: 'pending',
        embeddingModelId: 'builtin-ollama-embedding',
        createdAt: now,
        attempt: 1,
        _live: true,
      });
    }
    const kbMeta = MOCK_KBS.find((k) => k.id === rec.targetKbId);
    if (kbMeta) kbMeta.knowledgeCount = kbDocs.length;

    rec._timers.push(setTimeout(() => {
      rec.status = 'processing';
    }, 800));
    rec._timers.push(setTimeout(() => {
      rec.status = 'ready';
      rec.finishedAt = new Date().toISOString();
    }, 1900));
    return mockClipSnapshot(rec);
  }

  function mockClipSaveStore(store) {
    mockStoreWrite(MOCK_CLIP_STORE_KEY, store);
  }

  async function mockGetClip(clipId) {
    await new Promise((r) => setTimeout(r, 130));
    const rec = MOCK_CLIPS.get(clipId);
    if (!rec) throw new ApiError('NOT_FOUND', `采集候选不存在（演示数据）：${clipId}`, {});
    return mockClipSnapshot(rec);
  }

  /* --------------------------------------------- P2：BrowserSkill 演示运行时 */

  /**
   * 演示版浏览器协同：任务生命周期（running / needsLogin / paused / done /
   * cancelled / discarded）按上游 BrowserSkill 的语义走。要点：
   *   - 任务按 DSH Session 隔离，切换会话互不可见（T10）
   *   - 取消后迟到结果标记 discarded，不交接入库（T10）
   *   - 下载完成必须校验文件名/大小/哈希后才算 done（T09）
   */
  const MOCK_BROWSER_TASKS = new Map(); // taskId -> 记录
  let mockBrowserSeq = 0;

  function mockBrowserTaskList(sessionId) {
    const out = [];
    MOCK_BROWSER_TASKS.forEach((task) => {
      if (task.sessionId === sessionId) out.push({ ...task, _timers: undefined });
    });
    return out.reverse(); // 新任务在前
  }

  function mockBrowserTaskPatch(taskId, patch) {
    const task = MOCK_BROWSER_TASKS.get(taskId);
    if (!task) return null;
    Object.assign(task, patch);
    return task;
  }

  function mockBrowserClearTimers(task) {
    (task._timers || []).forEach((id) => clearTimeout(id));
    task._timers = [];
  }

  function mockBrowserFinish(task) {
    // 结果落地：表格给 Markdown，下载给校验过的文件元数据
    if (task.kind === 'download') {
      task.result = {
        fileName: `datasheet-${task.id.slice(-4)}.pdf`,
        sizeBytes: 2418000 + (mockBrowserSeq % 5) * 102400,
        sha256: `demo-${task.id}-${Math.random().toString(36).slice(2, 10)}`,
        verified: true,
      };
    } else {
      task.result = {
        pageTitle: `供应商参数表 · ${task.url.replace(/^https?:\/\//, '').slice(0, 40)}`,
        contentMarkdown: [
          '| 料号 | 额定电流 | 工作温度 | 版次 |',
          '| --- | --- | --- | --- |',
          '| SC-1024 | 16 A | -40~85 ℃ | B2 |',
          '| SC-2048 | 32 A | -40~85 ℃ | C1 |',
        ].join('\n'),
        assetRefs: [],
      };
    }
    task.status = 'done';
    task.progress = 100;
  }

  function mockBrowserStart(sessionId, input) {
    mockBrowserSeq += 1;
    const task = {
      id: `btask-${String(mockBrowserSeq).padStart(3, '0')}`,
      sessionId,
      kind: input.kind === 'download' ? 'download' : 'table',
      url: input.url || '',
      status: 'running',
      progress: 10,
      result: null,
      note: '',
      createdAt: new Date().toISOString(),
      _timers: [],
    };
    MOCK_BROWSER_TASKS.set(task.id, task);

    const needsLogin = /login|signin|portal/i.test(task.url);
    const runTail = () => {
      task.progress = 60;
      task._timers.push(setTimeout(() => {
        task.progress = 85;
      }, 700));
      task._timers.push(setTimeout(() => mockBrowserFinish(task), 1500));
    };
    if (needsLogin) {
      // 登录与人机验证交还用户：daemon 只等结果，不代填凭据
      task._timers.push(setTimeout(() => {
        task.status = 'needsLogin';
        task.note = 'login';
      }, 900));
      task._resumeAfterLogin = runTail;
    } else {
      runTail();
    }
    return { ...task, _timers: undefined };
  }

  function mockBrowserPause(taskId) {
    const task = MOCK_BROWSER_TASKS.get(taskId);
    if (!task || (task.status !== 'running' && task.status !== 'needsLogin')) return null;
    mockBrowserClearTimers(task);
    task.status = 'paused';
    return task;
  }

  function mockBrowserResume(taskId) {
    const task = MOCK_BROWSER_TASKS.get(taskId);
    if (!task || task.status !== 'paused') return null;
    task.status = 'running';
    task._resumeAfterLogin ? task._resumeAfterLogin() : mockBrowserFinishLater(task);
    return task;
  }

  function mockBrowserFinishLater(task) {
    task._timers.push(setTimeout(() => {
      task.progress = 85;
    }, 600));
    task._timers.push(setTimeout(() => mockBrowserFinish(task), 1300));
  }

  function mockBrowserConfirmLogin(taskId) {
    const task = MOCK_BROWSER_TASKS.get(taskId);
    if (!task || task.status !== 'needsLogin') return null;
    task.status = 'running';
    task.note = '';
    if (task._resumeAfterLogin) task._resumeAfterLogin();
    return task;
  }

  function mockBrowserCancel(taskId) {
    const task = MOCK_BROWSER_TASKS.get(taskId);
    if (!task || task.status === 'done' || task.status === 'cancelled' || task.status === 'discarded') return null;
    mockBrowserClearTimers(task);
    task.status = 'cancelled';
    // 迟到结果：上游 daemon 可能仍会把抓取结果送回来。这里 1.2s 后演示一次，
    // 状态翻成 discarded —— 迟到结果不入库，界面上明说。
    task._timers.push(
      setTimeout(() => {
        task.status = 'discarded';
        task.note = 'late';
      }, 1200),
    );
    return task;
  }


  const FEATURE_LABELS = [
    ['knowledgeBases', '知识库管理'],
    ['documents', '文档接收'],
    ['retrieval', '混合检索'],
    ['wiki', 'Wiki 生成'],
    ['sessionScope', '会话选库'],
    ['onedrive', 'OneDrive 同步'],
    ['mcp', 'MCP 对外'],
  ];

  function mockSnapshot(scenario) {
    const now = new Date().toISOString();
    const requestId = 'mock-' + Math.random().toString(36).slice(2, 10);

    if (scenario === 'error') {
      const failure = {
        code: 'SOURCE_UNAVAILABLE',
        message: '无法连接网关（演示场景）',
        retryable: true,
        requestId,
      };
      return {
        phase: 'error',
        source: 'mock',
        checkedAt: now,
        requestId,
        health: null,
        capabilities: null,
        kbs: null,
        error: failure,
      };
    }

    const health = {
      status: scenario === 'degraded' ? 'degraded' : 'ok',
      version: '0.1.0-mock',
      checkedAt: now,
    };

    // 只报告确定知道的能力：其余留空 -> 界面显示「未探测」，不把「没实现」写成「不支持」。
    const features = { knowledgeBases: true };
    if (scenario === 'degraded') features.retrieval = true;

    const capabilities = {
      contractVersion: '3.0.0',
      features,
      upstreamVersions: { weknora: '0.9.0-mock', gateway: '0.1.0-mock' },
    };

    return {
      phase: 'ready',
      source: 'mock',
      checkedAt: now,
      requestId,
      health,
      capabilities,
      kbs: { items: MOCK_KBS, nextCursor: null },
      error: null,
    };
  }

  /* ------------------------------------------------------------- 快照读取 */

  async function loadSnapshot(settings) {
    const started = Date.now();
    if (settings.mode === 'mock') {
      await new Promise((r) => setTimeout(r, 260)); // 让加载态可见，便于评审
      const snap = mockSnapshot(settings.scenario);
      return { ...snap, latencyMs: Date.now() - started };
    }

    // 本地模式先确认内核在不在：探不到就直接给出「怎么起」的办法，
    // 而不是让三个请求各自超时、报一堆看不懂的 SOURCE_UNAVAILABLE。
    if (settings.mode === 'local' && !WEKNORA) {
      const found = await detectLocalBase();
      if (!found) {
        return {
          phase: 'error',
          source: 'local',
          checkedAt: new Date().toISOString(),
          requestId: null,
          health: null,
          capabilities: null,
          kbs: null,
          latencyMs: Date.now() - started,
          error: {
            code: 'LOCAL_KERNEL_DOWN',
            message: '本地内核没有响应（4317–4321 都没探到）。装好插件后它会自动启动；也可以手动运行 npm run local。',
            retryable: true,
            requestId: null,
          },
        };
      }
    }

    const base = baseOf(settings);
    const results = await Promise.allSettled([
      requestJson(base, '/health', 6000),
      requestJson(base, '/capabilities', 6000),
      requestJson(base, '/api/v1/knowledge-bases', 6000),
    ]);

    const [healthRes, capsRes, kbsRes] = results;
    const firstFailure = results.find((r) => r.status === 'rejected');

    // 三个请求全挂 -> 视为网关不可达；部分失败保留成功的数据，界面按能力逐项显示。
    if (results.every((r) => r.status === 'rejected')) {
      const reason = firstFailure.reason;
      return {
        phase: 'error',
        source: settings.mode,
        checkedAt: new Date().toISOString(),
        requestId: null,
        health: null,
        capabilities: null,
        kbs: null,
        latencyMs: Date.now() - started,
        error: {
          code: reason?.code || 'SOURCE_UNAVAILABLE',
          message: reason?.message || 'network error',
          retryable: reason?.code !== 'NOT_IMPLEMENTED',
          requestId: null,
        },
      };
    }

    const healthEnv = healthRes.status === 'fulfilled' ? healthRes.value : null;
    const capsEnv = capsRes.status === 'fulfilled' ? capsRes.value : null;
    const kbsEnv = kbsRes.status === 'fulfilled' ? kbsRes.value : null;

    const health = healthEnv ? healthEnv.data : null;
    const capabilities = capsEnv ? capsEnv.data : null;
    let kbs = null;
    let kbError = null;

    if (kbsEnv) {
      const data = kbsEnv.data;
      kbs = Array.isArray(data) ? { items: data, nextCursor: null } : data;
    } else {
      const reason = kbsRes.reason;
      kbError = {
        code: reason?.code || 'SOURCE_UNAVAILABLE',
        message: reason?.message || 'network error',
        retryable: reason?.code !== 'NOT_IMPLEMENTED',
        requestId: null,
      };
    }

    return {
      phase: 'ready',
      source: settings.mode,
      checkedAt: new Date().toISOString(),
      requestId: healthEnv?.requestId || capsEnv?.requestId || kbsEnv?.requestId || null,
      health,
      capabilities,
      kbs,
      kbError,
      healthMissing: !healthEnv,
      capsMissing: !capsEnv,
      latencyMs: Date.now() - started,
      error: null,
    };
  }

  /* ----------------------------------------------------------------- 状态 */

  function createStore(initial) {
    let state = initial;
    const subs = new Set();
    return {
      get: () => state,
      set: (patch) => {
        state = { ...state, ...patch };
        subs.forEach((fn) => fn(state));
      },
      subscribe: (fn) => {
        subs.add(fn);
        return () => subs.delete(fn);
      },
    };
  }

  function useStore(store) {
    const [state, setState] = useState(store.get());
    useEffect(() => {
      setState(store.get());
      return store.subscribe(setState);
    }, [store]);
    return state;
  }

  /** 报错横幅自动收起（§体验）：错误信息出现 ERROR_BANNER_MS 后自动清除。
   *  失败的痕迹不丢 —— 问答气泡上有「生成失败」标记，检索/导入各有重试入口。 */
  function useAutoDismissError(error, setError) {
    useEffect(() => {
      if (!error) return undefined;
      const timer = setTimeout(() => setError(null), ERROR_BANNER_MS);
      return () => clearTimeout(timer);
    }, [error, setError]);
  }

  /* -------------------------------------------------- 模块注册表（插件接口） */

  /**
   * 面板内容的开放注册点。
   *
   * 契约（版本 1）：
   *   id        string   必填，唯一；同 id 再次 add 会覆盖
   *   title     string   必填，字典键或直接文案（t() 找不到时原样显示）
   *   module    string   可选，交接包编号（M1…M6），只用于展示
   *   status    'ready' | 'partial' | 'planned'
   *   order     number   页签顺序，小的在前
   *   tab       boolean  默认 true；false 表示只是详情视图，不占页签
   *   requires  string[] 未接入时列出所需接口，避免界面先造假功能
   *   mount     (ctx) => ReactNode   ctx 见 Panel 里的 mountCtx
   *
   * 注册表挂在 window 上（键固定），这样同一次 DSH 会话里其他客户端插件
   * 也能注册模块，不需要改动本插件的源码。
   */
  const MODULE_REGISTRY_KEY = '__SCHANORA_MODULES__';
  const MODULE_API_VERSION = 1;

  function createModuleRegistry() {
    const items = [];
    const listeners = new Set();
    const emit = () => listeners.forEach((fn) => fn());

    const api = {
      version: MODULE_API_VERSION,
      add(def) {
        if (!def || typeof def.id !== 'string' || !def.id) throw new Error('模块注册失败：缺少 id');
        if (!def.title) throw new Error(`模块 ${def.id} 注册失败：缺少 title`);
        const entry = {
          id: def.id,
          title: def.title,
          module: def.module || '',
          status: def.status || 'ready',
          order: typeof def.order === 'number' ? def.order : 100,
          tab: def.tab !== false,
          // more: 低频模块不占页签栏，收进顶栏 ⋯ 菜单（功能与挂载不变）
          more: def.more === true,
          requires: Array.isArray(def.requires) ? def.requires : [],
          desc: def.desc || '',
          mount: typeof def.mount === 'function' ? def.mount : null,
          icon: def.icon || null,
          // fit: 该模块要「整块贴合可视高度」，内部自己滚动（问答页靠它把输入区钉在底部）
          fit: def.fit === true,
        };
        const existing = items.findIndex((x) => x.id === entry.id);
        if (existing >= 0) items[existing] = entry;
        else items.push(entry);
        emit();
        return () => {
          const i = items.findIndex((x) => x.id === entry.id);
          if (i >= 0) {
            items.splice(i, 1);
            emit();
          }
        };
      },
      list() {
        return items.slice().sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
      },
      get(id) {
        return items.find((x) => x.id === id) || null;
      },
      subscribe(fn) {
        listeners.add(fn);
        return () => listeners.delete(fn);
      },
    };
    return api;
  }

  const MODULES = (() => {
    if (typeof window !== 'undefined' && window[MODULE_REGISTRY_KEY] && window[MODULE_REGISTRY_KEY].version === MODULE_API_VERSION) {
      return window[MODULE_REGISTRY_KEY];
    }
    const api = createModuleRegistry();
    if (typeof window !== 'undefined') window[MODULE_REGISTRY_KEY] = api;
    return api;
  })();

  function useModules() {
    const [list, setList] = useState(() => MODULES.list());
    useEffect(() => {
      setList(MODULES.list());
      return MODULES.subscribe(() => setList(MODULES.list()));
    }, []);
    return list;
  }

  /* --------------------------------------------------------------- 图标 */

  /** 品牌符号：白底圆角板 + 原图，深色主题下仍能看清（UI_SPEC 要求）。 */
  function Mark({ size = 28 }) {
    const inner = Math.round(size * 0.74);
    return h(
      'span',
      {
        className: 'sch-plate',
        style: { width: size, height: size, borderRadius: Math.max(6, Math.round(size * 0.28)) },
        'aria-hidden': 'true',
      },
      ASSETS.symbol
        ? h('img', { src: ASSETS.symbol, alt: '', width: inner, height: inner, draggable: false })
        : null,
    );
  }

  /** 主字标（2026-11-17 换版：透明底 + 品牌绿字）。深绿字必须垫浅色底才看得清，
   *  调用处要套 .sch-plate 或等价的浅色容器。只用于横幅，不做按钮。 */
  function Wordmark({ height = 34 }) {
    if (!ASSETS.wordmark) return null;
    return h('img', {
      src: ASSETS.wordmark,
      alt: 'SCHANORA',
      style: { height, width: 'auto', display: 'block' },
      draggable: false,
    });
  }

  function iconPath(d) {
    return h('svg', {
      width: 15,
      height: 15,
      viewBox: '0 0 24 24',
      fill: 'none',
      stroke: 'currentColor',
      strokeWidth: 1.8,
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
      'aria-hidden': 'true',
      children: h('path', { d }),
    });
  }

  const IconRefresh = () => iconPath('M20 11a8 8 0 1 1-2.3-5.6M20 4v5h-5');
  const IconSliders = () => iconPath('M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0');
  const IconAlert = () => iconPath('M12 8v5M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z');
  const IconCheck = () => iconPath('M20 6 9 17l-5-5');
  const IconX = () => iconPath('M18 6 6 18M6 6l12 12');
  const IconInbox = () => iconPath('M3 12h5l2 3h4l2-3h5M4 12l2-6h12l2 6v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-6Z');
  const IconBook = () => iconPath('M4 5.5A2.5 2.5 0 0 1 6.5 3H19v15H6.5A2.5 2.5 0 0 0 4 20.5V5.5ZM4 20.5A2.5 2.5 0 0 1 6.5 18H19v3H6.5');
  const IconUpload = () => iconPath('M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2');
  const IconFile = () => iconPath('M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Zm0 0v5h5');
  const IconBack = () => iconPath('M15 18l-6-6 6-6');
  const IconCopy = () => iconPath('M9 9h10v10a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2V9Zm0 0V5a2 2 0 0 1 2-2h2');
  const IconPlus = () => iconPath('M12 5v14M5 12h14');
  const IconGrid = () => iconPath('M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z');
  const IconPanelLeft = () => iconPath('M3 5h18v14H3zM9 5v14');
  const IconChat = () => iconPath('M21 12a8 8 0 0 1-8 8H8l-4 3v-4.5A8 8 0 1 1 21 12Z');
  const IconLayers = () => iconPath('M12 3 3 8l9 5 9-5-9-5ZM3 13l9 5 9-5');
  const IconSearch = () =>
    h(
      'svg',
      {
        width: 15,
        height: 15,
        viewBox: '0 0 24 24',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.8,
        strokeLinecap: 'round',
        'aria-hidden': 'true',
      },
      h('circle', { cx: 11, cy: 11, r: 7 }),
      h('path', { d: 'M20 20l-3.7-3.7' }),
    );
  const IconMore = () =>
    h(
      'svg',
      { width: 15, height: 15, viewBox: '0 0 24 24', fill: 'currentColor', 'aria-hidden': 'true' },
      ...[6, 12, 18].map((cy) => h('circle', { key: cy, cx: 12, cy, r: 1.6 })),
    );

  /* ------------------------------------------------------------- 小组件 */

  function StatusDot({ tone }) {
    return h('span', { className: cx('sch-dot', tone) });
  }

  function Badge({ tone = 'plain', children }) {
    return h('span', { className: cx('sch-badge', tone) }, children);
  }

  function cardTone(health) {
    if (!health) return 'err';
    if (health.status === 'ok') return 'ok';
    if (health.status === 'degraded') return 'warn';
    return 'err';
  }

  function healthLabel(t, health, loading, source) {
    if (loading) return t('status.loading');
    if (!health) return t('status.unreachable');
    if (health.status === 'ok') return t('status.ok');
    if (health.status === 'degraded') return t('status.degraded');
    return t('status.unavailable');
  }

  function capabilityState(t, capabilities, id) {
    if (!capabilities) return { tone: 'plain', label: t('caps.unverified') };
    const features = capabilities.features || {};
    if (!Object.prototype.hasOwnProperty.call(features, id)) {
      return { tone: 'plain', label: t('caps.unverified') };
    }
    return features[id]
      ? { tone: 'live', label: t('caps.supported') }
      : { tone: 'plain', label: t('caps.unsupported') };
  }

  /* --------------------------------------------------------------- 设置 */

  /** 设置抽屉：连接（地址 / API Key / 超时）、检索（条数 / 门槛）、本地插件开关。
   *  以前挤在顶栏小弹层里，字段一多就滚成一团，也不容易被发现——现在从顶栏「设置」直接打开。 */
  const MODEL_TYPE_LABELS = {
    KnowledgeQA: 'set.models.chat',
    Embedding: 'set.models.embedding',
    Rerank: 'set.models.rerank',
  };

  function ModelSettings({ t, settings }) {
    const [models, setModels] = useState([]);
    const [modelId, setModelId] = useState('');
    const [form, setForm] = useState({ type: 'KnowledgeQA', provider: 'deepseek', name: '', baseUrl: '', dimension: '' });
    const [apiKey, setApiKey] = useState('');
    const [busy, setBusy] = useState(false);
    const [status, setStatus] = useState(null);
    const [loadError, setLoadError] = useState('');
    const base = baseOf(settings);
    const selected = models.find((model) => model.id === modelId);
    const canReplaceKey = selected?.source === 'remote' && !selected.isBuiltin;
    const local = form.provider === 'ollama';
    const embedding = form.type === 'Embedding';

    useEffect(() => {
      let active = true;
      readCollection(settings, '/api/v1/models').then(
        ({ items }) => {
          if (active) setModels(items.filter((item) => Object.hasOwn(MODEL_TYPE_LABELS, item.type)));
        },
        (error) => { if (active) setLoadError(error.message); },
      );
      return () => { active = false; };
    }, [base]);

    const patch = (key, value) => {
      setForm((prev) => ({ ...prev, [key]: value }));
      setStatus(null);
    };
    const run = async (operation, testing = false) => {
      if (busy) return;
      setBusy(true);
      setStatus(testing ? { message: t('set.models.testing') } : null);
      try {
        setStatus({ message: await operation() });
      } catch (error) {
        const permission = error.extra?.status === 403;
        let message = permission ? t('set.models.admin') : error.message;
        if (apiKey.trim()) message = message.replaceAll(apiKey.trim(), '••••••••');
        setStatus({ error: true, message });
      } finally {
        setBusy(false);
      }
    };
    const save = (event) => {
      event.preventDefault();
      return run(async () => {
        const key = apiKey.trim();
        if (selected) {
          if (!canReplaceKey || !key) return '';
          const path = `/api/v1/models/${encodeURIComponent(selected.id)}/credentials`;
          const { fields } = await sendJson(base, path, { apiKey: key }, 15000, 'PUT');
          setModels((prev) => prev.map((model) => model.id === selected.id ? { ...model, credentials: fields } : model));
          setApiKey('');
          return t('set.models.keySaved');
        }
        const name = form.name.trim();
        if (!name) return '';
        const parameters = {};
        if (!local) {
          parameters.provider = form.provider;
          const address = form.baseUrl.trim() || (form.provider === 'deepseek' ? 'https://api.deepseek.com/v1' : '');
          let url;
          try { url = new URL(address); } catch (_error) { throw new Error(t('set.models.urlInvalid')); }
          if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
            throw new Error(t('set.models.urlInvalid'));
          }
          parameters.base_url = address;
          if (key) parameters.api_key = key;
        }
        if (embedding) parameters.embedding_parameters = { dimension: Number(form.dimension) };
        const model = await postJson(base, '/api/v1/models', {
          name, type: form.type, source: local ? 'local' : 'remote', parameters,
        }, 20000);
        setModels((prev) => [...prev, model]);
        setModelId(model.id);
        setForm((prev) => ({ ...prev, name: '', baseUrl: '', dimension: '' }));
        setApiKey('');
        return t('set.models.saved');
      });
    };
    const testModel = () => run(async () => {
      const formData = new FormData();
      formData.set('input', selected.type === 'KnowledgeQA' ? 'Reply with OK.' : 'Schanora model connection test');
      if (selected.type === 'KnowledgeQA') formData.set('options', JSON.stringify({ max_tokens: 24 }));
      if (selected.type === 'Rerank') formData.set('documents', JSON.stringify(['Schanora model test', 'Unrelated sample']));
      const response = await postJson(base, `/api/v1/models/${encodeURIComponent(selected.id)}/debug`, formData, 45000);
      if (!response?.ok) throw new Error(t('set.models.testFailed'));
      const expected = selected.parameters?.embeddingParameters?.dimension;
      const actual = response.observations?.dimension;
      if (selected.type === 'Embedding' && expected && actual && actual !== expected) {
        throw new Error(text(t, 'set.models.dimensionMismatch', { expected, actual }));
      }
      return t('set.models.tested');
    }, true);

    const field = (id, label, control) => h('div', { className: 'sch-field' },
      h('label', { htmlFor: id }, t(label)), control);
    const input = (id, label, value, onChange, props = {}) => field(id, label, h('input', {
      id, className: 'sch-input', value, onChange: (event) => onChange(event.target.value), spellCheck: false, disabled: busy, ...props,
    }));
    const select = (id, label, value, onChange, options) => field(id, label, h('select', {
      id, className: 'sch-input', value, onChange: (event) => onChange(event.target.value), disabled: busy,
    }, options.map(([key, caption]) => h('option', { key, value: key }, caption))));
    const providers = [['generic', t('set.models.compatible')]];
    if (form.type === 'KnowledgeQA') providers.unshift(['deepseek', 'DeepSeek']);
    if (form.type !== 'Rerank') providers.push(['ollama', t('set.models.ollama')]);
    const showKey = selected ? canReplaceKey : !local;

    return h('section', { className: 'sch-setgroup sch-model-settings', 'aria-labelledby': 'sch-model-heading' },
      h('div', { className: 'sch-setgroup-title', id: 'sch-model-heading' }, t('set.models.title')),
      select('sch-model-entry', 'set.models.select', modelId, (id) => {
        setModelId(id);
        setApiKey('');
        setStatus(null);
      }, [['', t('set.models.new')], ...models.map((model) => [
        model.id, `${model.displayName || model.name} · ${t(MODEL_TYPE_LABELS[model.type])}`,
      ])]),
      loadError ? h('div', { className: 'sch-setgroup-desc err', role: 'alert' }, loadError) : null,
      h('form', { onSubmit: save },
        !selected ? h(React.Fragment, null,
          select('sch-model-type', 'set.models.type', form.type, (type) => {
            setForm((prev) => ({ ...prev, type, provider: type === 'KnowledgeQA' ? 'deepseek' : 'generic', baseUrl: '' }));
            setApiKey('');
            setStatus(null);
          }, Object.entries(MODEL_TYPE_LABELS).map(([type, label]) => [type, t(label)])),
          select('sch-model-provider', 'set.models.provider', form.provider, (provider) => {
            setForm((prev) => ({ ...prev, provider, baseUrl: '' }));
            setApiKey('');
            setStatus(null);
          }, providers),
          input('sch-model-name', 'set.models.name', form.name, (value) => patch('name', value), { required: true }),
          !local ? input('sch-model-endpoint', 'set.models.url', form.baseUrl, (value) => patch('baseUrl', value), {
            type: 'url', required: form.provider !== 'deepseek', placeholder: form.provider === 'deepseek'
              ? 'https://api.deepseek.com/v1' : form.type === 'Rerank' ? 'https://api.example.com/v1/rerank' : 'https://api.example.com/v1',
          }) : null,
          embedding ? input('sch-model-dimension', 'set.models.dimension', form.dimension, (value) => patch('dimension', value),
            { type: 'number', required: true, min: 1, step: 1 }) : null,
        ) : null,
        showKey ? h(React.Fragment, null,
          input('sch-model-api-key', selected ? 'set.models.replaceKey' : 'set.models.key', apiKey, setApiKey, {
            type: 'password', autoComplete: 'new-password', required: !selected && form.provider === 'deepseek',
            placeholder: selected?.credentials?.apiKey?.configured ? t('set.models.keySet') : '',
          }),
          h('div', { className: 'sch-setgroup-desc' }, t('set.models.keyHint')),
        ) : null,
        h('div', { className: 'sch-model-actions' },
          !selected || canReplaceKey
            ? h('button', { type: 'submit', className: 'sch-btn primary', disabled: busy || ((selected || form.provider === 'deepseek') && !apiKey.trim()) },
                t(selected ? 'set.models.saveKey' : 'set.models.save')) : null,
          selected ? h('button', { type: 'button', className: 'sch-btn', disabled: busy, onClick: testModel }, t('set.models.test')) : null,
        ),
      ),
      status ? h('div', { className: cx('sch-setgroup-desc', status.error && 'err'), role: status.error ? 'alert' : 'status' }, status.message) : null,
      h('div', { className: 'sch-setgroup-desc' },
        h('a', { href: '/platform/settings?section=models', target: '_blank', rel: 'noopener noreferrer' }, t('set.models.advanced')),
      ),
    );
  }

  function SettingsDrawer({ t, settings, host, storeRoot, onSave, onClose, onOpenPlugins, onOpenDiag }) {
    const [draft, setDraft] = useState(settings);
    const [testState, setTestState] = useState({ phase: 'idle', message: '' });
    const [showKey, setShowKey] = useState(false);
    const [revealMsg, setRevealMsg] = useState('');
    const boxRef = useRef(null);

    useEffect(() => {
      setDraft(settings);
    }, [settings]);

    useEffect(() => {
      const onKey = (e) => {
        if (e.key === 'Escape') onClose();
      };
      // 点抽屉外面就关：抽屉盖在面板上，不关会一直挡着内容
      const onDown = (e) => {
        const el = boxRef.current;
        if (el && e.target instanceof Node && !el.contains(e.target)) onClose();
      };
      window.addEventListener('keydown', onKey);
      document.addEventListener('pointerdown', onDown, true);
      return () => {
        window.removeEventListener('keydown', onKey);
        document.removeEventListener('pointerdown', onDown, true);
      };
    }, [onClose]);

    const patch = (next) => setDraft((prev) => normalizeSettings({ ...prev, ...next }));
    const patchPlugin = (id, on) =>
      setDraft((prev) => normalizeSettings({ ...prev, plugins: { ...prev.plugins, [id]: on } }));

    const runTest = async () => {
      setTestState({ phase: 'busy', message: t('set.testing') });
      // 先拿草稿里的 key 去探测；没保存就还原，避免「测试」把全局状态改掉
      setAuthKey(draft.apiKey);
      try {
        // 按草稿当前模式探：本地就探本机内核，远程就探网关
        const snap = await loadSnapshot(draft);
        if (snap.phase === 'error') throw new Error(snap.error?.message || 'error');
        const status = snap.health?.status || (snap.healthMissing ? t('set.testNoHealth') : 'unknown');
        setTestState({ phase: 'ok', message: `${t('set.testOk')} · ${status}` });
      } catch (error) {
        setTestState({ phase: 'err', message: text(t, 'set.testFail', { msg: error.message }) });
      } finally {
        setAuthKey(settings.apiKey);
      }
    };

    const seg = (value, options, onPick) =>
      h(
        'div',
        { className: 'sch-seg' },
        options.map(([v, label]) =>
          h('button', { key: v, type: 'button', className: value === v ? 'on' : '', onClick: () => onPick(v) }, label),
        ),
      );

    return h(
      'div',
      {
        className: 'sch-root sch-tokens sch-drawer sch-drawer-set',
        role: 'dialog',
        'aria-modal': 'true',
        'aria-label': t('set.title'),
        ref: boxRef,
      },
      h(
        'div',
        { className: 'sch-drawer-head' },
        h(
          'div',
          null,
          h('div', { className: 'sch-section-title' }, t('set.title')),
          h('div', { className: 'sch-setgroup-desc' }, t('set.subtitle')),
        ),
        h('button', { type: 'button', className: 'sch-btn icon', onClick: onClose, 'aria-label': t('panel.close') }, h(IconX)),
      ),

      // 中段自己滚：头部与底部操作条固定，字段再多也不用满抽屉找「保存」
      h(
        'div',
        { className: 'sch-drawer-body' },

      WEKNORA ? h(ModelSettings, { t, settings }) : null,
      h(
        'div',
        { className: 'sch-setgroup' },
        h('div', { className: 'sch-setgroup-title' }, t('set.group.conn')),
        h('div', { className: 'sch-setgroup-desc' }, WEKNORA
          ? h('a', { href: '/platform/knowledge-bases' }, '在 WeKnora 中管理账号和数据源')
          : t(DEV_PREVIEW ? 'set.group.conn.desc' : 'set.mode.localHint')),
        DEV_PREVIEW ? h(
          'div',
          { className: 'sch-field' },
          h('label', null, t('set.mode')),
          seg(draft.mode, [
            ['local', t('set.mode.local')],
            ['http', t('set.mode.http')],
            ['mock', t('set.mode.mock')],
          ], (v) => patch({ mode: v })),
          h('div', { className: 'sch-card-desc' }, t(`set.mode.${draft.mode}Hint`)),
        ) : null,

        // 每种模式只显示自己那几个字段，省得三个模式的配置挤在一起互相干扰
        draft.mode === 'local' && !WEKNORA
          ? h(
              'div',
              { className: 'sch-field' },
              h('label', { htmlFor: 'sch-root' }, t('set.storeRoot')),
              h(
                'div',
                { className: 'sch-keyrow' },
                h('input', {
                  id: 'sch-root',
                  className: 'sch-input',
                  value: storeRoot || '',
                  readOnly: true,
                  spellCheck: false,
                  placeholder: t('set.storeRootUnknown'),
                }),
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'sch-btn sm',
                    disabled: !storeRoot,
                    onClick: async () => {
                      setRevealMsg('');
                      try {
                        // 内核跑在本机进程里，所以「打开文件夹」是真能开；浏览器自己做不到
                        await postJson(baseOf(draft), '/api/v1/local/reveal', {}, 4000);
                        setRevealMsg(t('set.revealOk'));
                      } catch (error) {
                        setRevealMsg(error?.message || 'error');
                      }
                    },
                  },
                  t('set.reveal'),
                ),
              ),
              h('div', { className: 'sch-card-desc' }, t('set.storeRootHint')),
              revealMsg ? h('div', { className: 'sch-card-desc' }, revealMsg) : null,
            )
          : null,

        draft.mode === 'http'
          ? h(
              'div',
              { className: 'sch-field' },
              h('label', { htmlFor: 'sch-base' }, t('set.baseUrl')),
              h('input', {
                id: 'sch-base',
                className: 'sch-input',
                value: draft.baseUrl,
                placeholder: 'https://kb.example.com',
                spellCheck: false,
                onChange: (e) => patch({ baseUrl: e.target.value }),
              }),
              h('div', { className: 'sch-card-desc' }, t('set.baseUrlHint')),
            )
          : null,

        draft.mode === 'mock'
          ? h(
              'div',
              { className: 'sch-field' },
              h('label', null, t('set.scenario')),
              seg(draft.scenario, [
                ['ok', t('set.scenario.ok')],
                ['degraded', t('set.scenario.degraded')],
                ['error', t('set.scenario.error')],
              ], (v) => patch({ scenario: v })),
            )
          : null,

        // 本地内核没有鉴权，Key 只在远程网关下有意义
        draft.mode === 'http'
          ? h(
              'div',
              { className: 'sch-field' },
              h('label', { htmlFor: 'sch-key' }, t('set.apiKey')),
              h(
                'div',
                { className: 'sch-keyrow' },
                h('input', {
                  id: 'sch-key',
                  className: 'sch-input',
                  type: showKey ? 'text' : 'password',
                  value: draft.apiKey,
                  placeholder: t('set.apiKeyPlaceholder'),
                  autoComplete: 'off',
                  spellCheck: false,
                  onChange: (e) => patch({ apiKey: e.target.value }),
                }),
                h(
                  'button',
                  { type: 'button', className: 'sch-btn sm', onClick: () => setShowKey(!showKey) },
                  t(showKey ? 'set.apiKeyHide' : 'set.apiKeyShow'),
                ),
              ),
              h('div', { className: 'sch-card-desc' }, t('set.apiKeyNote')),
            )
          : null,
        h(
          'div',
          { className: 'sch-field' },
          h('label', { htmlFor: 'sch-timeout' }, t('set.timeout')),
          h('input', {
            id: 'sch-timeout',
            className: 'sch-input',
            type: 'number',
            min: 3,
            max: 120,
            step: 1,
            value: Math.round(draft.timeoutMs / 1000),
            onChange: (e) => patch({ timeoutMs: Number(e.target.value) * 1000 }),
          }),
          h('div', { className: 'sch-card-desc' }, t('set.timeoutHint')),
        ),
      ),

      // DSH 能力：只读诊断。宿主给没给一眼可见 —— 不给就照实写「未提供」，不做假开关
      h(
        'div',
        { className: 'sch-setgroup' },
        h('div', { className: 'sch-setgroup-title' }, t('set.group.host')),
        h('div', { className: 'sch-setgroup-desc' }, t('set.group.host.desc')),
        ...describeCaps(host && host.caps).map((c) =>
          h(
            'div',
            { className: 'sch-hostcap', key: c.key, title: c.via || '' },
            h('span', { className: cx('sch-hostcap-dot', c.ok && 'on') }),
            h('span', { className: 'sch-hostcap-name' }, c.label),
            h('span', { className: 'sch-hostcap-via' }, c.ok ? c.via : t('set.host.none')),
          ),
        ),
        // 只在「宿主给了接口但注册失败」时报警；宿主压根没给接口是上面那行的「未提供」，
        // 再报一次「注册失败」会让人以为装坏了
        host && host.caps && host.caps.tools && host.tool && host.tool.error
          ? h('div', { className: 'sch-setgroup-desc err' }, `${t('set.host.toolErr')}：${host.tool.error}`)
          : null,
      ),

      h(
        'div',
        { className: 'sch-setgroup' },
        h('div', { className: 'sch-setgroup-title' }, t('set.group.retrieval')),
        h('div', { className: 'sch-setgroup-desc' }, t('set.group.retrieval.desc')),
        h(
          'div',
          { className: 'sch-field' },
          h('label', { htmlFor: 'sch-topk' }, t('set.topK')),
          h('input', {
            id: 'sch-topk',
            className: 'sch-input',
            type: 'number',
            min: 1,
            max: 30,
            step: 1,
            value: draft.topK,
            onChange: (e) => patch({ topK: Number(e.target.value) }),
          }),
          h('div', { className: 'sch-card-desc' }, t('set.topKHint')),
        ),
        h(
          'div',
          { className: 'sch-field' },
          h('label', { htmlFor: 'sch-cov' }, t('set.minCoverage')),
          h('input', {
            id: 'sch-cov',
            className: 'sch-input',
            type: 'number',
            min: 0,
            max: 100,
            step: 1,
            value: Math.round(draft.minCoverage * 100),
            onChange: (e) => patch({ minCoverage: Number(e.target.value) / 100 }),
          }),
          h('div', { className: 'sch-card-desc' }, t('set.minCoverageHint')),
        ),
      ),

      h(
        'div',
        { className: 'sch-setgroup' },
        h('div', { className: 'sch-setgroup-title' }, t('set.group.plugins')),
        h('div', { className: 'sch-setgroup-desc' }, t('set.group.plugins.desc')),
        h(
          'div',
          { className: 'sch-setrow' },
          h(
            'div',
            { className: 'sch-setrow-main' },
            h('div', { className: 'sch-setrow-title' }, t('plug.gate.name')),
            h('div', { className: 'sch-setrow-desc' }, t('plug.gate.short')),
          ),
          h('button', {
            type: 'button',
            className: 'sch-switch',
            'aria-pressed': draft.plugins.gate,
            'aria-label': t('plug.gate.name'),
            onClick: () => patchPlugin('gate', !draft.plugins.gate),
          }),
        ),
        h(
          'div',
          { className: 'sch-setrow' },
          h(
            'div',
            { className: 'sch-setrow-main' },
            h('div', { className: 'sch-setrow-title' }, t('plug.cite.name')),
            h('div', { className: 'sch-setrow-desc' }, t('plug.cite.short')),
          ),
          h('button', {
            type: 'button',
            className: 'sch-switch',
            'aria-pressed': draft.plugins.cite,
            'aria-label': t('plug.cite.name'),
            onClick: () => patchPlugin('cite', !draft.plugins.cite),
          }),
        ),
      ),

      testState.phase !== 'idle'
        ? h(
            'div',
            { className: cx('sch-alert', testState.phase === 'err' ? 'err' : '') },
            h(testState.phase === 'err' ? IconAlert : IconCheck),
            h('span', null, testState.message),
          )
        : null,
      h('div', { className: 'sch-card-desc', style: { marginTop: 12 } }, t('set.localOnly')),

      // §2 功能区域：插件与诊断从顶栏收进设置，低频入口集中管理
      onOpenPlugins || onOpenDiag
        ? h(
            'div',
            { style: { marginTop: 16 } },
            h('div', { className: 'sch-setgroup-title' }, t('panel.features')),
            h('div', { className: 'sch-setgroup-desc' }, t('panel.features.desc')),
            h(
              'div',
              { style: { display: 'flex', gap: 8, marginTop: 8 } },
              onOpenPlugins
                ? h(
                    'button',
                    { type: 'button', className: 'sch-btn', onClick: onOpenPlugins },
                    t('settings.plugins'),
                  )
                : null,
              onOpenDiag
                ? h('button', { type: 'button', className: 'sch-btn', onClick: onOpenDiag }, t('settings.diag'))
                : null,
            ),
          )
        : null,
      ),

      // 操作条钉在抽屉底部：改完 API Key 不用先滚到底再找「保存」
      h(
        'div',
        { className: 'sch-pop-actions sch-drawer-foot' },
        h('button', { type: 'button', className: 'sch-btn primary', onClick: () => onSave(draft) }, t('set.save')),
        // 演示模式没有可探的东西，按钮留着只会给人「测过了」的错觉
        draft.mode === 'mock'
          ? null
          : h('button', { type: 'button', className: 'sch-btn', onClick: runTest }, t('set.test')),
        h(
          'button',
          {
            type: 'button',
            className: 'sch-btn',
            onClick: () => {
              setDraft(normalizeSettings({ ...DEFAULT_SETTINGS }));
              setTestState({ phase: 'idle', message: '' });
            },
          },
          t('set.reset'),
        ),
      ),
    );
  }

  /* ---------------------------------------------------- 建库表单（模块1） */

  function CreateKbForm({ t, settings, models, onCreated, onCancel }) {
    const [name, setName] = useState('');
    const [description, setDescription] = useState('');
    const [type, setType] = useState('document');
    const [modelId, setModelId] = useState('');
    const [phase, setPhase] = useState('idle');
    const [error, setError] = useState('');

    useEffect(() => {
      const def = models.items.find((m) => m.isDefault) || models.items[0];
      if (def && !modelId) setModelId(def.id);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [models]);

    const submit = async () => {
      if (!name.trim()) {
        setError(t('kbs.needName'));
        return;
      }
      setPhase('busy');
      setError('');
      try {
        let kb;
        if (settings.mode === 'mock') {
          await new Promise((r) => setTimeout(r, 420));
          const raw = {
            id: 'kb-mock-' + Math.random().toString(36).slice(2, 7),
            name: name.trim(),
            description: description.trim(),
            type,
            embeddingModelId: modelId,
            knowledgeCount: 0,
            chunkCount: 0,
            updatedAt: new Date().toISOString(),
          };
          MOCK_KBS.push(raw);
          kb = normalizeKb(raw);
        } else {
          kb = await api.createKb(settings, {
            name: name.trim(),
            description: description.trim() || undefined,
            type,
            embeddingModelId: modelId || undefined,
          });
        }
        setPhase('done');
        onCreated(kb);
      } catch (err) {
        setPhase('idle');
        setError(text(t, 'kbForm.failed', { msg: (err && err.message) || 'error' }));
      }
    };

    return h(
      'div',
      null,
      h(
        'div',
        { className: 'sch-field' },
        h('label', null, t('kbForm.name')),
        h('input', {
          className: 'sch-input',
          value: name,
          placeholder: t('kbForm.namePlaceholder'),
          onChange: (e) => setName(e.target.value),
          autoFocus: true,
        }),
      ),
      h(
        'div',
        { className: 'sch-field' },
        h('label', null, t('kbForm.desc')),
        h('input', {
          className: 'sch-input',
          value: description,
          onChange: (e) => setDescription(e.target.value),
        }),
      ),
      h(
        'div',
        { className: 'sch-field' },
        h('label', null, t('kbForm.type')),
        h(
          'div',
          { className: 'sch-seg' },
          ...['document', 'faq', 'wiki'].map((value) =>
            h(
              'button',
              { key: value, type: 'button', className: type === value ? 'on' : '', onClick: () => setType(value) },
              t(`kind.${value}`),
            ),
          ),
        ),
      ),
      h(
        'div',
        { className: 'sch-field' },
        h('label', null, t('kbForm.model')),
        models.phase === 'loading'
          ? h('div', { className: 'sch-card-desc' }, t('kbForm.modelLoading'))
          : models.phase === 'error'
            ? h('div', { className: 'sch-card-desc' }, text(t, 'kbForm.modelFailed', { msg: models.error || '' }))
            : models.items.length === 0
              ? h('div', { className: 'sch-card-desc' }, t('kbForm.modelEmpty'))
              : h(
                  'select',
                  {
                    className: 'sch-input',
                    value: modelId,
                    onChange: (e) => setModelId(e.target.value),
                  },
                  ...models.items.map((m) =>
                    h('option', { key: m.id, value: m.id }, `${m.displayName}${m.isDefault ? ' · default' : ''}`),
                  ),
                ),
        h('div', { className: 'sch-card-desc' }, t('kbForm.modelHint')),
      ),
      error ? h('div', { className: 'sch-alert err' }, h(IconAlert), h('span', null, error)) : null,
      h(
        'div',
        { className: 'sch-pop-actions' },
        h(
          'button',
          { type: 'button', className: 'sch-btn primary', disabled: phase === 'busy', onClick: submit },
          phase === 'busy' ? t('kbForm.submitting') : t('kbForm.submit'),
        ),
        h('button', { type: 'button', className: 'sch-btn', onClick: onCancel }, t('kbForm.cancel')),
      ),
    );
  }

  /* ------------------------------------------------------- 状态条（文档页） */

  function StatusStrip({ t, snap, loading }) {
    let caps = null;
    if (snap.capabilities) {
      const features = snap.capabilities.features || {};
      const ids = Object.keys(features);
      caps = `${ids.filter((id) => features[id]).length}/${ids.length}`;
    }
    return h(
      'div',
      { className: 'sch-strip' },
      h(StatusDot, { tone: loading ? 'busy' : cardTone(snap.health) }),
      h('b', null, healthLabel(t, snap.health, loading, snap.source)),
      h('span', { className: 'sep' }),
      h('span', null, `${t('card.caps.title')} ${caps == null ? t('status.unknown') : caps}`),
      snap.latencyMs != null ? h('span', { className: 'sch-mono' }, `${snap.latencyMs}ms`) : null,
      h('span', { className: 'sep' }),
      h('span', { className: 'sch-mono' }, snap.requestId ? `# ${snap.requestId}` : '—'),
    );
  }

  /* --------------------------------------------------- 文档视图（模块2+3） */

  const MAX_UPLOAD_BYTES = 200 * 1024 * 1024; // 客户端的保守护栏，不是后端契约

  function DocsView({ t, settings, kb, snap, onToast, onBack }) {
    const [list, setList] = useState({ phase: 'loading', items: [], total: null, error: null });
    const [polledAt, setPolledAt] = useState(null);
    const [queue, setQueue] = useState([]);
    const [dup, setDup] = useState(null); // {files, dups}
    const [dragging, setDragging] = useState(false);
    const [docId, setDocId] = useState(null);
    const inputRef = useRef(null);
    const aliveRef = useRef(true);

    // 挂载时置回 true：React 18 严格模式下会先卸再挂，只写 false 会让后续请求全部被丢掉
    useEffect(() => {
      aliveRef.current = true;
      return () => {
        aliveRef.current = false;
      };
    }, []);

    const refresh = useCallback(
      async (silent) => {
        if (!silent) setList((p) => ({ ...p, phase: p.items.length ? 'ready' : 'loading', error: null }));
        try {
          const res = settings.mode === 'mock' ? await mockListDocs(kb.id) : await api.listDocuments(settings, kb.id);
          if (!aliveRef.current) return;
          setList({ phase: 'ready', items: res.items, total: res.total, error: null });
          setPolledAt(new Date().toISOString());
        } catch (error) {
          if (!aliveRef.current) return;
          setList((p) => ({
            ...p,
            phase: p.items.length ? 'ready' : 'error',
            error: { message: (error && error.message) || 'error', code: (error && error.code) || 'ERROR' },
          }));
        }
      },
      [settings, kb.id],
    );

    useEffect(() => {
      ensureMockTicker();
      refresh(false);
    }, [refresh]);

    // 有未结束的文档就 3s 轮询；全部终态即停
    const busyCount = list.items.filter((d) => !TERMINAL_STATES.has(d.parseStatus)).length;
    useEffect(() => {
      if (!busyCount) return undefined;
      const timer = setInterval(() => refresh(true), 3000);
      return () => clearInterval(timer);
    }, [busyCount, refresh]);

    const patchEntry = (key, patch) => setQueue((p) => p.map((x) => (x.key === key ? { ...x, ...patch } : x)));

    const startUpload = async (files) => {
      const entries = files.map((file) => ({
        key: `${file.name}/${file.size}/${Math.random().toString(36).slice(2, 6)}`,
        file,
        progress: 0,
        state: 'queued',
        message: '',
      }));
      setQueue((p) => [...entries, ...p]);
      for (const entry of entries) {
        patchEntry(entry.key, { state: 'uploading', progress: 0 });
        try {
          const doc =
            settings.mode === 'mock'
              ? await mockUpload(kb.id, entry.file, (p) => patchEntry(entry.key, { progress: p }))
              : await api.uploadDocument(settings, kb.id, entry.file, (p) => patchEntry(entry.key, { progress: p }));
          ensureMockTicker();
          patchEntry(entry.key, { state: 'uploaded', progress: 1, docId: doc && doc.id });
          onToast({ tone: 'ok', text: text(t, 'up.done', { name: entry.file.name }) });
          refresh(true);
        } catch (error) {
          patchEntry(entry.key, { state: 'failed', message: (error && error.message) || 'error' });
          onToast({
            tone: 'err',
            text: text(t, 'up.error', { name: entry.file.name, msg: (error && error.message) || 'error' }),
          });
        }
      }
    };

    const onFiles = (fileList, ignoreDup) => {
      const files = Array.from(fileList || []).filter(Boolean);
      if (!files.length) return;
      const big = files.filter((f) => f.size > MAX_UPLOAD_BYTES);
      const normal = files.filter((f) => f.size <= MAX_UPLOAD_BYTES);
      if (big.length) onToast({ tone: 'err', text: text(t, 'up.tooBig', { name: big[0].name }) });
      if (!normal.length) return;
      if (!ignoreDup) {
        const dups = normal.filter((f) => list.items.some((d) => d.fileName === f.name && d.fileSize === f.size));
        if (dups.length) {
          setDup({ files: normal, dups });
          return;
        }
      }
      setDup(null);
      startUpload(normal);
    };

    const openPicker = () => inputRef.current && inputRef.current.click();
    const items = list.items;
    const failedCount = items.filter((d) => d.parseStatus === 'failed').length;

    /* ---- 资料库迁移：文档标签（分类）+ 最近打开 ---- */
    const [tagsMap, setTagsMap] = useState(() => readDocTags());
    const [tagFilter, setTagFilter] = useState('');
    const [editTagsId, setEditTagsId] = useState(null);
    const [tagsDraft, setTagsDraft] = useState('');
    const tagsImportRef = useRef(null);
    // 打开/关闭详情抽屉时刷新最近打开列表
    const [recentRev, setRecentRev] = useState(0);
    useEffect(() => {
      if (!docId) return undefined;
      const doc = list.items.find((d) => d.id === docId);
      if (!doc) return undefined;
      writeRecentDocs(pushRecent(readRecentDocs(), { id: doc.id, title: doc.title, kbId: kb.id, at: new Date().toISOString() }));
      setRecentRev((n) => n + 1);
      return undefined;
    }, [docId, list.items, kb.id]);
    const recentDocs = useMemo(
      () => readRecentDocs().filter((r) => r.kbId === kb.id).slice(0, 3),
      [kb.id, recentRev, docId],
    );

    const saveTags = (docId2, input) => {
      const next = { ...tagsMap };
      const parsed = parseTagInput(input);
      if (parsed.length) next[docId2] = parsed;
      else delete next[docId2];
      writeDocTags(next);
      setTagsMap(next);
      setEditTagsId(null);
    };

    const exportTags = () => {
      const blob = new Blob([serializeTags(tagsMap)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `schanora-doctags-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    };

    const importTags = async (file) => {
      try {
        const content = await file.text();
        const { tags } = parseImportedTags(content);
        const merged = mergeTagMaps(tagsMap, tags);
        writeDocTags(merged);
        setTagsMap(merged);
        onToast({ tone: 'ok', text: text(t, 'docs.tags.imported', { n: Object.keys(tags).length }) });
      } catch (err) {
        onToast({ tone: 'err', text: `${t('docs.tags.import.bad')}：${(err && err.message) || 'error'}` });
      }
    };

    const tagChips = useMemo(() => allTags(tagsMap), [tagsMap]);
    const visibleItems = tagFilter ? filterDocsByTag(items, tagFilter, tagsMap) : items;

    const queueLabel = (q) => {
      if (q.state === 'queued') return t('up.queued');
      if (q.state === 'uploading') return text(t, 'up.uploading', { p: Math.round((q.progress || 0) * 100) });
      if (q.state === 'uploaded') return t('up.uploaded');
      return t('up.uploadFailed');
    };

    return h(
      'div',
      null,
      // 面包屑。库内子视图（onBack=null）时返回统一走面板的「返回库列表」，这里只留定位信息
      h(
        'div',
        { className: 'sch-crumb' },
        onBack
          ? h(
              'button',
              { type: 'button', onClick: onBack },
              h(IconBack),
              t('kbs.title'),
            )
          : h('span', null, t('kbs.title')),
        h('span', null, '/'),
        h('b', { style: { color: 'var(--sch-text-2)', fontWeight: 600 } }, kb.name),
      ),

      // 库名之外的元信息。标题已经在主区 header 上，这里不再重复
      h(
        'div',
        { className: 'sch-head' },
        h('div', { className: 'sch-brand-txt' }, h('div', { className: 'sch-card-desc' }, kb.description || kb.id)),
        h(
          'div',
          { className: 'sch-tools' },
          list.phase === 'ready'
            ? h(
                'span',
                { className: 'sch-section-meta' },
                text(t, 'docs.count', { n: items.length }) +
                  (list.total != null ? ` / ${list.total}` : isRemote(settings) ? ` · ${t('docs.totalUnknown')}` : ''),
              )
            : null,
          h(
            'button',
            {
              type: 'button',
              className: 'sch-btn icon',
              title: t('panel.refresh'),
              'aria-label': t('panel.refresh'),
              onClick: () => refresh(false),
              disabled: list.phase === 'loading',
            },
            h(IconRefresh),
          ),
        ),
      ),

      // 一切正常时不占地方；降级或失败才把技术细节顶出来
      snap.phase === 'error' || (snap.health && snap.health.status && snap.health.status !== 'ok')
        ? h(StatusStrip, { t, snap, loading: snap.phase === 'loading' })
        : null,

      busyCount || polledAt
        ? h(
            'div',
            { className: 'sch-card-desc', style: { marginTop: 10 } },
              busyCount
                ? `${text(t, 'docs.polling', { s: 3 })} · ${text(t, 'docs.busyCount', { n: busyCount })}`
                : `${t('docs.polledAt', { time: fmtDateTime(polledAt) })}`,
          )
        : null,

      // 资料库迁移：最近打开 + 标签筛选 + 标签导入导出
      h(
        'div',
        { className: 'sch-docbar' },
        recentDocs.length
          ? [
              h('span', { key: 'rl', className: 'sch-docbar-label' }, t('docs.recent')),
              ...recentDocs.map((r) =>
                h(
                  'button',
                  {
                    key: r.id,
                    type: 'button',
                    className: 'sch-recentchip',
                    title: r.title,
                    onClick: () => setDocId(r.id),
                  },
                  r.title.length > 14 ? `${r.title.slice(0, 14)}…` : r.title,
                ),
              ),
            ]
          : null,
        tagChips.length
          ? [
              h('span', { key: 'tl', className: 'sch-docbar-label' }, t('docs.tags')),
              h(
                'button',
                {
                  key: '__all',
                  type: 'button',
                  className: cx('sch-scopechip', !tagFilter && 'on'),
                  onClick: () => setTagFilter(''),
                },
                t('docs.tags.all'),
              ),
              ...tagChips.map(({ tag, n }) =>
                h(
                  'button',
                  {
                    key: tag,
                    type: 'button',
                    className: cx('sch-scopechip', tagFilter === tag && 'on'),
                    onClick: () => setTagFilter(tagFilter === tag ? '' : tag),
                  },
                  `${tag} (${n})`,
                ),
              ),
            ]
          : null,
        h('span', { className: 'sch-toolbar-spacer' }),
        h(
          'button',
          { type: 'button', className: 'sch-btn sm', onClick: exportTags, title: t('docs.tags.explain') },
          t('docs.tags.export'),
        ),
        h(
          'button',
          {
            type: 'button',
            className: 'sch-btn sm',
            onClick: () => tagsImportRef.current && tagsImportRef.current.click(),
            title: t('docs.tags.explain'),
          },
          t('docs.tags.import'),
        ),
        h('input', {
          ref: tagsImportRef,
          type: 'file',
          accept: 'application/json,.json',
          style: { display: 'none' },
          onChange: (e) => {
            const file = e.target.files && e.target.files[0];
            if (file) importTags(file);
            e.target.value = '';
          },
        }),
      ),
      tagFilter && visibleItems.length === 0 && items.length > 0
        ? h('div', { className: 'sch-empty', style: { marginTop: 12 } }, h('div', { className: 'sch-empty-title' }, t('docs.tags.filterEmpty')))
        : null,

      // 上传区
      h(
        'div',
        {
          className: cx('sch-drop', dragging ? 'over' : ''),
          style: { marginTop: 16 },
          role: 'button',
          tabIndex: 0,
          'aria-label': t('up.title'),
          onClick: openPicker,
          onKeyDown: (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              openPicker();
            }
          },
          onDragOver: (e) => {
            e.preventDefault();
            setDragging(true);
          },
          onDragLeave: () => setDragging(false),
          onDrop: (e) => {
            e.preventDefault();
            setDragging(false);
            onFiles(e.dataTransfer && e.dataTransfer.files);
          },
        },
        h(
          'div',
          { className: 'sch-drop-title' },
          dragging ? t('up.dragging') : t('up.drop'),
          h('span', { style: { opacity: 0.5 } }, t('up.or')),
          h(
            'button',
            {
              type: 'button',
              className: 'sch-linkbtn',
              onClick: (e) => {
                e.stopPropagation();
                openPicker();
              },
            },
            t('up.choose'),
          ),
          h(IconUpload),
        ),
        h('div', { className: 'sch-drop-note' }, t('up.multiple')),
        h('input', {
          ref: inputRef,
          type: 'file',
          multiple: true,
          style: { display: 'none' },
          onChange: (e) => {
            onFiles(e.target.files);
            e.target.value = '';
          },
        }),
      ),

      // 上传队列
      queue.length
        ? h(
            'div',
            { className: 'sch-queue' },
            ...queue.map((q) =>
              h(
                'div',
                { className: 'sch-qitem', key: q.key },
                q.state === 'failed' ? h(IconAlert) : q.state === 'uploaded' ? h(IconCheck) : h(IconFile),
                h(
                  'span',
                  { className: 'sch-qname', title: q.state === 'failed' ? q.message : q.file.name },
                  q.file.name,
                ),
                q.state === 'queued' || q.state === 'uploading'
                  ? h(
                      'div',
                      { className: cx('sch-bar', q.state === 'failed' ? 'err' : '') },
                      h('i', { style: { width: `${Math.round((q.progress || 0) * 100)}%` } }),
                    )
                  : null,
                h(
                  'span',
                  { className: 'sch-qmeta', title: q.message || '' },
                  queueLabel(q),
                  q.state === 'uploaded' && q.docId ? ` · ${q.docId.slice(-6)}` : '',
                ),
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'sch-btn icon sm',
                    style: { width: 24, height: 24, flex: 'none' },
                    title: t('up.remove'),
                    'aria-label': t('up.remove'),
                    onClick: () => setQueue((p) => p.filter((x) => x.key !== q.key)),
                  },
                  h(IconX),
                ),
              ),
            ),
          )
        : null,

      // 重复文件确认
      dup
        ? h(
            'div',
            null,
            h('div', { className: 'sch-scrim', onClick: () => setDup(null) }),
            h(
              'div',
              { className: 'sch-dup', role: 'alertdialog', 'aria-label': t('up.dup.title') },
              h('div', { className: 'sch-pop-title' }, text(t, 'up.dup.title', { n: dup.dups.length })),
              h('div', { className: 'sch-card-desc' }, t('up.dup.desc')),
              h(
                'ol',
                { className: 'sch-dup-list' },
                ...dup.dups.map((f, i) => h('li', { key: i }, `${f.name} · ${fmtBytes(f.size)}`)),
              ),
              h(
                'div',
                { className: 'sch-pop-actions' },
                h(
                  'button',
                  { type: 'button', className: 'sch-btn primary', onClick: () => onFiles(dup.files, true) },
                  t('up.dup.continue'),
                ),
                h('button', { type: 'button', className: 'sch-btn', onClick: () => setDup(null) }, t('up.dup.cancel')),
              ),
            ),
          )
        : null,

      // 失败摘要
      failedCount
        ? h(
            'div',
            { className: 'sch-alert err', style: { marginTop: 12 } },
            h(IconAlert),
            h('span', null, text(t, 'docs.failedCount', { n: failedCount })),
          )
        : null,

      // 文档表
      h(
        'div',
        { className: 'sch-section' },
        list.phase === 'loading'
          ? h('div', null, h('div', { className: 'sch-skel' }), h('div', { className: 'sch-skel' }), h('div', { className: 'sch-skel' }))
          : list.phase === 'error'
            ? h(
                'div',
                { className: 'sch-empty' },
                h('div', { className: 'sch-empty-title' }, t('docs.error.title')),
                h('div', { className: 'sch-empty-desc' }, `${list.error.code} · ${list.error.message}`),
                h(
                  'button',
                  { type: 'button', className: 'sch-btn', style: { marginTop: 10 }, onClick: () => refresh(false) },
                  t('docs.retry'),
                ),
              )
            : items.length === 0
              ? h(
                  'div',
                  { className: 'sch-empty' },
                  h('div', { className: 'sch-empty-title' }, t('docs.empty.title')),
                  h('div', { className: 'sch-empty-desc' }, t('docs.empty.desc')),
                )
              : h(
                  'div',
                  { className: 'sch-table' },
                  h(
                    'div',
                    { className: 'sch-dtr head' },
                    h('div', null, t('docs.col.name')),
                    h('div', null, t('docs.col.status')),
                    h('div', { className: 'col-size' }, t('docs.col.size')),
                    h('div', { className: 'col-time' }, t('docs.col.time')),
                    h('div', null, t('docs.col.action')),
                  ),
                  ...visibleItems.map((doc) => {
                    const meta = statusMeta(t, doc.parseStatus);
                    const docTags = tagsMap[doc.id] || [];
                    const editing = editTagsId === doc.id;
                    return h(
                      'div',
                      {
                        className: 'sch-dtr body',
                        key: doc.id,
                        onClick: () => setDocId(doc.id),
                        title: doc.errorMessage || '',
                      },
                      h(
                        'div',
                        { style: { minWidth: 0 } },
                        h('div', { className: 'sch-kb-name', title: doc.title }, doc.title),
                        h('div', { className: 'sch-kb-desc', title: doc.fileName }, doc.fileName || doc.id),
                        editing
                          ? h(
                              'div',
                              {
                                className: 'sch-tag-edit',
                                onClick: (e) => e.stopPropagation(),
                              },
                              h('input', {
                                className: 'sch-input',
                                value: tagsDraft,
                                placeholder: t('docs.tags.placeholder'),
                                autoFocus: true,
                                onChange: (e) => setTagsDraft(e.target.value),
                                onKeyDown: (e) => {
                                  if (e.key === 'Enter') {
                                    e.preventDefault();
                                    saveTags(doc.id, tagsDraft);
                                  }
                                  if (e.key === 'Escape') {
                                    e.preventDefault();
                                    setEditTagsId(null);
                                  }
                                },
                              }),
                              h(
                                'button',
                                { type: 'button', className: 'sch-btn sm primary', onClick: () => saveTags(doc.id, tagsDraft) },
                                t('docs.tags.save'),
                              ),
                              h(
                                'button',
                                { type: 'button', className: 'sch-btn sm', onClick: () => setEditTagsId(null) },
                                t('docs.tags.cancel'),
                              ),
                            )
                          : docTags.length
                            ? h(
                                'div',
                                { className: 'sch-tagrow' },
                                ...docTags.map((tag) =>
                                  h('span', { key: tag, className: 'sch-doctag', title: t('docs.tags') }, tag),
                                ),
                              )
                            : null,
                      ),
                      h(
                        'div',
                        { className: 'sch-status', title: meta.hint || doc.errorMessage || '' },
                        h(StatusDot, { tone: meta.dot }),
                        h('span', null, meta.label),
                      ),
                      h('div', { className: 'col-size sch-mono', style: { color: 'var(--sch-text-2)', fontSize: 12 } }, fmtBytes(doc.fileSize)),
                      h('div', { className: 'col-time' }, timeCell(doc.createdAt)),
                      h(
                        'div',
                        { style: { display: 'flex', justifyContent: 'flex-end', gap: 4 } },
                        h(
                          'button',
                          {
                            type: 'button',
                            className: 'sch-btn sm',
                            title: t('docs.tags.explain'),
                            onClick: (e) => {
                              e.stopPropagation();
                              if (editing) {
                                setEditTagsId(null);
                              } else {
                                setTagsDraft(docTags.join(', '));
                                setEditTagsId(doc.id);
                              }
                            },
                          },
                          t('docs.tags.edit'),
                        ),
                        h(
                          'button',
                          {
                            type: 'button',
                            className: 'sch-btn sm',
                            onClick: (e) => {
                              e.stopPropagation();
                              setDocId(doc.id);
                            },
                          },
                          t('docs.open'),
                        ),
                      ),
                    );
                  }),
                ),
      ),

      docId
        ? h(DocDrawer, {
            t,
            settings,
            kbId: kb.id,
            docId,
            initialDoc: items.find((d) => d.id === docId) || null,
            onClose: () => setDocId(null),
            onToast,
            onUploaded: () => refresh(true),
          })
        : null,
    );
  }

  /* ------------------------------------------------- 文档详情抽屉（模块3） */

  function DocDrawer({ t, settings, kbId, docId, initialDoc, onClose, onToast, onUploaded }) {
    const [tab, setTab] = useState('props');
    const [doc, setDoc] = useState(initialDoc || null);
    const [docPhase, setDocPhase] = useState(initialDoc ? 'ready' : 'loading');
    const [docError, setDocError] = useState('');
    const [trace, setTrace] = useState({ phase: 'idle', data: null, error: '' });
    const [chunkState, setChunkState] = useState({ phase: 'idle', items: [], page: 1, pageSize: 10, total: null, error: '' });
    const [expanded, setExpanded] = useState({});
    const [copied, setCopied] = useState(false);
    const reInputRef = useRef(null);
    const aliveRef = useRef(true);

    // 挂载时置回 true：React 18 严格模式下会先卸再挂，只写 false 会让后续请求全部被丢掉
    useEffect(() => {
      aliveRef.current = true;
      return () => {
        aliveRef.current = false;
      };
    }, []);

    const loadDoc = useCallback(async () => {
      setDocPhase('loading');
      try {
        const d = settings.mode === 'mock' ? await mockGetDoc(docId) : await api.getDocument(settings, docId);
        if (!aliveRef.current) return;
        setDoc(d);
        setDocPhase('ready');
        setDocError('');
      } catch (error) {
        if (!aliveRef.current) return;
        setDocPhase('error');
        setDocError((error && error.message) || 'error');
      }
    }, [settings, docId]);

    const loadTrace = useCallback(async () => {
      setTrace((p) => ({ ...p, phase: 'loading' }));
      try {
        const data = settings.mode === 'mock' ? await mockGetSpans(docId) : await api.getSpans(settings, docId);
        if (!aliveRef.current) return;
        setTrace({ phase: 'ready', data, error: '' });
      } catch (error) {
        if (!aliveRef.current) return;
        setTrace({ phase: 'error', data: null, error: (error && error.message) || 'error' });
      }
    }, [settings, docId]);

    const loadChunks = useCallback(
      async (page) => {
        setChunkState((p) => ({ ...p, phase: 'loading', page, error: '' }));
        try {
          const res = settings.mode === 'mock'
            ? await mockGetChunks(docId, page, chunkState.pageSize)
            : await api.getChunks(settings, docId, page, chunkState.pageSize);
          if (!aliveRef.current) return;
          setChunkState({ phase: 'ready', items: res.items, page, pageSize: chunkState.pageSize, total: res.total, error: '' });
        } catch (error) {
          if (!aliveRef.current) return;
          setChunkState((p) => ({ ...p, phase: 'error', error: (error && error.message) || 'error' }));
        }
      },
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [settings, docId],
    );

    useEffect(() => {
      loadDoc();
      loadTrace();
      loadChunks(1);
    }, [loadDoc, loadTrace, loadChunks]);

    // 未终态：3s 轮询属性；轨迹仅在轨迹页时同步刷
    const busy = doc && !TERMINAL_STATES.has(doc.parseStatus);
    useEffect(() => {
      if (!busy) return undefined;
      const timer = setInterval(() => {
        loadDoc();
        if (tab === 'trace') loadTrace();
      }, 3000);
      return () => clearInterval(timer);
    }, [busy, tab, loadDoc, loadTrace]);

    useEffect(() => {
      const onKey = (e) => {
        if (e.key === 'Escape') onClose();
      };
      window.addEventListener('keydown', onKey);
      return () => window.removeEventListener('keydown', onKey);
    }, [onClose]);

    const copyId = async () => {
      try {
        await navigator.clipboard.writeText(docId);
        setCopied(true);
        setTimeout(() => aliveRef.current && setCopied(false), 1600);
      } catch (_e) {
        /* 剪贴板可能被宿主禁用；提示已复制就不给了 */
      }
    };

    const reupload = async (file) => {
      try {
        const d =
          settings.mode === 'mock'
            ? await mockUpload(kbId, file, () => {})
            : await api.uploadDocument(settings, kbId, file, () => {});
        ensureMockTicker();
        onToast({ tone: 'ok', text: text(t, 'up.done', { name: file.name }) });
        onUploaded && onUploaded(d);
        onClose();
      } catch (error) {
        onToast({ tone: 'err', text: text(t, 'up.error', { name: file.name, msg: (error && error.message) || 'error' }) });
      }
    };

    const meta = doc ? statusMeta(t, doc.parseStatus) : null;
    const info = trace.phase === 'ready' && trace.data ? traceStages(trace.data) : null;

    return h(
      'div',
      { className: 'sch-root sch-tokens sch-drawer wide', role: 'dialog', 'aria-label': t('doc.title') },
      h(
        'div',
        { className: 'sch-drawer-head sticky' },
        h(
          'div',
          { style: { minWidth: 0, flex: '1 1 auto' } },
          h('div', { className: 'sch-drawer-title', title: doc ? doc.title : docId }, doc ? doc.title : t('doc.loading')),
          h('div', { className: 'sch-drawer-sub sch-mono' }, docId),
        ),
        h(
          'div',
          { style: { display: 'flex', gap: 6, flex: 'none' } },
          h(
            'button',
            {
              type: 'button',
              className: 'sch-btn sm',
              onClick: copyId,
              title: t('doc.copy'),
            },
            copied ? t('doc.copied') : t('doc.copy'),
          ),
          h(
            'button',
            {
              type: 'button',
              className: 'sch-btn icon sm',
              title: t('doc.refresh'),
              'aria-label': t('doc.refresh'),
              onClick: () => {
                loadDoc();
                loadTrace();
                if (tab === 'chunks') loadChunks(chunkState.page);
              },
            },
            h(IconRefresh),
          ),
          h(
            'button',
            { type: 'button', className: 'sch-btn icon sm', onClick: onClose, 'aria-label': t('panel.close') },
            h(IconX),
          ),
        ),
      ),
      h(
        'div',
        { className: 'sch-tabs' },
        ...[
          ['props', t('doc.tab.props')],
          ['trace', t('doc.tab.trace')],
          ['chunks', t('doc.tab.chunks')],
        ].map(([id, label]) =>
          h(
            'button',
            { key: id, type: 'button', className: cx('sch-tabbtn', tab === id ? 'on' : ''), onClick: () => setTab(id) },
            label,
          ),
        ),
      ),
      h(
        'div',
        { className: 'sch-drawer-body' },
        tab === 'props'
          ? h(
              'div',
              null,
              docPhase === 'loading' && !doc
                ? h('div', { className: 'sch-empty-inline' }, t('doc.loading'))
                : docPhase === 'error' && !doc
                  ? h('div', { className: 'sch-alert err' }, h(IconAlert), h('span', null, text(t, 'doc.loadFailed', { msg: docError })))
                  : doc
                    ? h(
                        'div',
                        null,
                        h(
                          'div',
                          { className: 'sch-status', style: { marginBottom: 4 } },
                          h(StatusDot, { tone: meta.dot }),
                          h('b', null, meta.label),
                          doc.pendingSubtasks ? h('span', { className: 'hint' }, text(t, 'doc.field.subtasks', { n: doc.pendingSubtasks })) : null,
                        ),
                        h(
                          'dl',
                          { className: 'sch-kv' },
                          h('dt', null, t('doc.field.file')),
                          h('dd', null, doc.fileName || '—'),
                          h('dt', null, t('doc.field.type')),
                          h('dd', null, doc.fileType || '—'),
                          h('dt', null, t('doc.field.size')),
                          h('dd', null, fmtBytes(doc.fileSize)),
                          h('dt', null, t('doc.field.model')),
                          h('dd', { className: 'sch-mono' }, doc.embeddingModelId || '—'),
                          h('dt', null, t('doc.field.created')),
                          h('dd', null, timeCell(doc.createdAt)),
                          h('dt', null, t('doc.field.processed')),
                          h('dd', null, timeCell(doc.processedAt)),
                        ),
                        doc.errorMessage
                          ? h(
                              'div',
                              { className: 'sch-alert err' },
                              h(IconAlert),
                              h(
                                'div',
                                null,
                                h('div', { style: { fontWeight: 600 } }, t('doc.field.error')),
                                h('div', { style: { fontSize: 12, wordBreak: 'break-all' } }, doc.errorMessage),
                              ),
                            )
                          : null,
                        doc.parseStatus === 'failed'
                          ? h(
                              'div',
                              { style: { marginTop: 12 } },
                              h(
                                'button',
                                { type: 'button', className: 'sch-btn primary', onClick: () => reInputRef.current && reInputRef.current.click() },
                                h(IconUpload),
                                t('doc.reupload'),
                              ),
                              h('div', { className: 'sch-card-desc', style: { marginTop: 6 } }, t('doc.reuploadHint')),
                              h('input', {
                                ref: reInputRef,
                                type: 'file',
                                style: { display: 'none' },
                                onChange: (e) => {
                                  if (e.target.files && e.target.files[0]) reupload(e.target.files[0]);
                                  e.target.value = '';
                                },
                              }),
                            )
                          : null,
                      )
                    : null,
            )
          : tab === 'trace'
            ? h(
                'div',
                null,
                trace.phase === 'loading' && !trace.data
                  ? h('div', { className: 'sch-empty-inline' }, t('doc.loading'))
                  : trace.phase === 'error' && !trace.data
                    ? h(
                        'div',
                        { className: 'sch-alert err' },
                        h(IconAlert),
                        h('span', null, text(t, 'chunks.error', { msg: trace.error })),
                        h(
                          'button',
                          { type: 'button', className: 'sch-btn sm', style: { marginLeft: 8 }, onClick: loadTrace },
                          t('docs.retry'),
                        ),
                      )
                    : info
                      ? h(
                          'div',
                          null,
                          h(
                            'div',
                            { className: 'sch-row', style: { fontSize: 12, color: 'var(--sch-text-2)' } },
                            h('span', null, text(t, 'trace.attempt', { n: info.attempt })),
                            info.currentStage
                              ? h('span', null, text(t, 'trace.current', { name: t(`trace.stage.${info.currentStage}`) || info.currentStage }))
                              : null,
                          ),
                          info.empty
                            ? h('div', { className: 'sch-empty-inline' }, t('trace.noData'))
                            : h(
                                'div',
                                { className: 'sch-stages' },
                                ...info.rows.map((row, i) => {
                                  const state = stageStatus(t, row, info);
                                  const line = stageMetaLine(t, row, state);
                                  return h(
                                    'div',
                                    { className: 'sch-stage', key: row.name },
                                    h('span', { className: cx('sch-stage-idx', state.tone) }, i + 1),
                                    h(
                                      'div',
                                      { className: 'sch-stage-main' },
                                      h(
                                        'div',
                                        { className: 'sch-stage-name' },
                                        t(`trace.stage.${row.name}`) || row.name,
                                        h(Badge, { tone: state.tone === 'failed' ? 'err' : state.tone === 'done' ? 'live' : 'plain' }, state.label),
                                      ),
                                      line ? h('div', { className: 'sch-stage-meta', title: line }, line) : null,
                                    ),
                                  );
                                }),
                              ),
                          info.lastError
                            ? h(
                                'div',
                                { className: 'sch-alert err', style: { marginTop: 10 } },
                                h(IconAlert),
                                h(
                                  'div',
                                  null,
                                  h('div', null, `${t('trace.errorCode')}: ${info.lastError.code || info.lastError.errorCode || '—'}`),
                                  h('div', { style: { fontSize: 12, wordBreak: 'break-all' } }, info.lastError.message || info.lastError.errorMessage || ''),
                                ),
                              )
                            : null,
                          info.extras.length
                            ? h('div', { className: 'sch-card-desc', style: { marginTop: 8 } }, text(t, 'trace.more', { n: info.extras.length }))
                            : null,
                          h(
                            'details',
                            { style: { marginTop: 10 } },
                            h('summary', { className: 'sch-card-desc', style: { cursor: 'pointer' } }, t('trace.raw')),
                            h('pre', { className: 'sch-pre' }, JSON.stringify(trace.data, null, 2)),
                          ),
                        )
                      : h('div', { className: 'sch-empty-inline' }, t('trace.noData')),
              )
            : h(
                'div',
                null,
                chunkState.phase === 'loading' && !chunkState.items.length
                  ? h('div', null, h('div', { className: 'sch-skel' }), h('div', { className: 'sch-skel' }))
                  : chunkState.phase === 'error' && !chunkState.items.length
                    ? h(
                        'div',
                        { className: 'sch-alert err' },
                        h(IconAlert),
                        h('span', null, text(t, 'chunks.error', { msg: chunkState.error })),
                        h(
                          'button',
                          { type: 'button', className: 'sch-btn sm', style: { marginLeft: 8 }, onClick: () => loadChunks(chunkState.page) },
                          t('docs.retry'),
                        ),
                      )
                    : chunkState.items.length === 0
                      ? h('div', { className: 'sch-empty-inline' }, t('chunks.empty'))
                      : h(
                          'div',
                          null,
                          h('div', { className: 'sch-section-meta' }, text(t, 'chunks.count', { n: chunkState.total == null ? chunkState.items.length : chunkState.total })),
                          ...chunkState.items.map((chunk, i) => {
                            const isOpen = Boolean(expanded[chunk.id]);
                            const long = chunk.content.length > 160;
                            const indexLabel = chunk.indexStatus
                              ? t(`chunks.index.${chunk.indexStatus}`) || chunk.indexStatus
                              : '';
                            return h(
                              'div',
                              { className: 'sch-chunk', key: chunk.id },
                              h(
                                'div',
                                { className: 'sch-chunk-head' },
                                // §7 编号口径：块号统一一基显示（与引用列表的「第 n 块」一致），
                                // 旧数据缺 chunkIndex 时退回行序（也是一基），不再出现 #0 / #1 与「第 2 块」并存。
                                h('span', { className: 'sch-chunk-idx' }, `#${chunk.chunkIndex != null ? chunk.chunkIndex + 1 : i + 1}`),
                                chunk.startAt != null && chunk.endAt != null
                                  ? h('span', null, text(t, 'chunks.range', { a: chunk.startAt, b: chunk.endAt }))
                                  : null,
                                indexLabel
                                  ? h(
                                      Badge,
                                      { tone: chunk.indexStatus === 'failed' ? 'err' : chunk.indexStatus === 'ready' ? 'live' : 'plain' },
                                      indexLabel,
                                    )
                                  : null,
                                h(
                                  'button',
                                  {
                                    type: 'button',
                                    className: 'sch-linkbtn',
                                    style: { marginLeft: 'auto', display: long ? 'inline' : 'none' },
                                    onClick: () => setExpanded((p) => ({ ...p, [chunk.id]: !p[chunk.id] })),
                                  },
                                  isOpen ? t('chunks.collapse') : t('chunks.expand'),
                                ),
                              ),
                              h('div', { className: cx('sch-chunk-text', long && !isOpen ? 'clamp' : '') }, chunk.content),
                              h(
                                'div',
                                { className: 'sch-card-desc', style: { marginTop: 4 } },
                                text(t, 'chunks.chars', { n: chunk.content.length }),
                              ),
                            );
                          }),
                          h(
                            'div',
                            { className: 'sch-pager' },
                            h(
                              'button',
                              {
                                type: 'button',
                                className: 'sch-btn sm',
                                disabled: chunkState.page <= 1,
                                onClick: () => loadChunks(chunkState.page - 1),
                              },
                              t('chunks.prev'),
                            ),
                            h('span', { className: 'meta' }, text(t, 'chunks.page', { n: chunkState.page })),
                            h(
                              'button',
                              {
                                type: 'button',
                                className: 'sch-btn sm',
                                disabled: chunkState.items.length < chunkState.pageSize,
                                onClick: () => loadChunks(chunkState.page + 1),
                              },
                              t('chunks.next'),
                            ),
                            chunkState.total == null && chunkState.items.length >= chunkState.pageSize
                              ? h('span', { className: 'meta' }, t('chunks.more'))
                              : null,
                          ),
                        ),
              ),
      ),
    );
  }


  /* --------------------------------------------------------------- 主面板 */

  /* ------------------------------------------------------------ 模块界面 */

  /** M1 · 知识库首页。建库表单放在自己身上，面板只负责编排。 */
  function KbHome({ t, snap, kbs, loading, settings, onOpenKb, onCreated }) {
    const [creating, setCreating] = useState(false);
    const [models, setModels] = useState({ phase: 'idle', items: [], error: null });

    const loadModels = useCallback(async () => {
      setModels({ phase: 'loading', items: [], error: null });
      try {
        const items = settings.mode === 'mock' ? MOCK_MODELS : await api.listModels(settings);
        setModels({ phase: 'ready', items, error: null });
      } catch (error) {
        setModels({ phase: 'error', items: [], error: (error && error.message) || 'error' });
      }
    }, [settings]);

    const openCreate = () => {
      if (models.phase === 'idle') loadModels();
      setCreating((v) => !v);
    };

    // 建库弹层：点外部或 Esc 收起（和设置抽屉一致）。按钮本身在容器内，不会自己关掉再自己开。
    const createRef = useRef(null);
    useEffect(() => {
      if (!creating) return undefined;
      const onDown = (e) => {
        const el = createRef.current;
        if (el && e.target instanceof Node && !el.contains(e.target)) setCreating(false);
      };
      const onKey = (e) => {
        if (e.key === 'Escape') setCreating(false);
      };
      document.addEventListener('pointerdown', onDown, true);
      window.addEventListener('keydown', onKey);
      return () => {
        document.removeEventListener('pointerdown', onDown, true);
        window.removeEventListener('keydown', onKey);
      };
    }, [creating]);

    // 库多了以后按名称/描述过滤，比滚动找快；/ 直达搜索、Esc 清空，手不离开键盘
    const [keyword, setKeyword] = useState('');
    const searchRef = useRef(null);
    useEffect(() => {
      const onKey = (e) => {
        const el = searchRef.current;
        if (!el) return;
        const act = document.activeElement;
        const tag = act ? act.tagName : '';
        const typing = tag === 'INPUT' || tag === 'TEXTAREA' || (act && act.isContentEditable);
        if (e.key === '/' && !typing) {
          e.preventDefault();
          el.focus();
        } else if (e.key === 'Escape' && act === el) {
          if (el.value) {
            e.stopPropagation();
            setKeyword('');
          } else {
            el.blur();
          }
        }
      };
      window.addEventListener('keydown', onKey);
      return () => window.removeEventListener('keydown', onKey);
    }, []);
    const q = keyword.trim().toLowerCase();
    const shown = q
      ? kbs.filter((kb) => `${kb.name || ''} ${kb.description || ''}`.toLowerCase().includes(q))
      : kbs;

    return h(
      'div',
      { className: 'sch-modbody' },
      h(
        'div',
        { className: 'sch-kbhead' },
        h(
          'label',
          { className: 'sch-search' },
          h(IconSearch),
          h('input', {
            type: 'search',
            value: keyword,
            placeholder: t('kbs.search'),
            'aria-label': t('kbs.search'),
            ref: searchRef,
            onChange: (e) => setKeyword(e.target.value),
          }),
          h('span', { className: 'sch-search-key', 'aria-hidden': 'true' }, '/'),
        ),
        h(
          'span',
          { className: 'sch-toolbar-meta' },
          loading ? t('status.loading') : text(t, 'kbs.count', { n: kbs.length }),
        ),
        h('div', { className: 'sch-toolbar-spacer' }),
        h(
          'div',
          { style: { position: 'relative' }, ref: createRef },
          h(
            'button',
            { type: 'button', className: 'sch-btn primary', onClick: openCreate, 'aria-expanded': creating },
            t('kbs.create'),
          ),
          creating
            ? h(
                'div',
                { className: 'sch-pop', style: { right: 0, left: 'auto' } },
                h('div', { className: 'sch-pop-title' }, t('kbForm.title')),
                h(CreateKbForm, {
                  t,
                  settings,
                  models,
                  onCreated: (kb) => {
                    setCreating(false);
                    onCreated(kb);
                  },
                  onCancel: () => setCreating(false),
                }),
              )
            : null,
        ),
      ),
      loading
        ? h(
            'div',
            null,
            h('div', { className: 'sch-skel' }),
            h('div', { className: 'sch-skel' }),
            h('div', { className: 'sch-skel' }),
          )
        : kbs.length === 0
          ? h(
              'div',
              { className: 'sch-empty-brand' },
              h(Mark, { size: 54 }),
              h('div', { className: 'sch-side-name' }, h('b', null, 'SCHANORA'), h('i', null, t('panel.subtitle'))),
              h('div', { className: 'sch-empty-title', style: { marginTop: 10 } }, t('kbs.empty.title')),
              h('div', { className: 'sch-empty-desc' }, t('kbs.empty.desc')),
              h(
                'button',
                { type: 'button', className: 'sch-btn primary', style: { marginTop: 16 }, onClick: openCreate },
                t('kbs.empty.action'),
              ),
            )
          : h(
              'div',
              { className: 'sch-kbgrid' },
              ...shown.map((kb) =>
                h(
                  'button',
                  { type: 'button', className: 'sch-kbcard', key: kb.id, onClick: () => onOpenKb(kb) },
                  h(
                    'div',
                    { className: 'sch-kbcard-top' },
                    h('span', { className: 'sch-kbcard-tile' }, h(kb.type === 'faq' ? IconChat : IconBook)),
                    h(
                      'div',
                      { className: 'sch-kbcard-head' },
                      h('div', { className: 'sch-kbcard-name', title: kb.name }, kb.name),
                      h('div', { className: 'sch-kbcard-kind' }, t(`kind.${kb.type}`) || kb.type),
                    ),
                  ),
                  h(
                    'div',
                    { className: cx('sch-kbcard-desc', kb.description ? '' : 'muted'), title: kb.description || kb.id },
                    kb.description || kb.id,
                  ),
                  h(
                    'div',
                    { className: 'sch-kbcard-foot' },
                    h(
                      'span',
                      { className: 'sch-kbcard-stat' },
                      text(t, 'kbs.cardMeta', {
                        docs: kb.knowledgeCount == null ? '—' : kb.knowledgeCount,
                        chunks: kb.chunkCount == null ? '—' : kb.chunkCount,
                      }),
                    ),
                    h('span', { className: 'sch-kbcard-time' }, timeCell(kb.updatedAt)),
                  ),
                ),
              ),
            ),
    );
  }

  /** M2 · 文档。文档挂在知识库下，没选库就先给一个选择器，而不是空表。 */
  function DocsHome({ t, settings, snap, kbs, kbId, onPickKb, onToast, onGotoKb, hideBack }) {
    const kb = kbs.find((x) => x.id === kbId) || null;

    if (kb) {
      return h(DocsView, {
        t,
        settings,
        kb,
        snap,
        onToast,
        onBack: hideBack ? null : () => onPickKb(null),
      });
    }

    if (!kbs.length) {
      return h(
        'div',
        { className: 'sch-modbody' },
        h(
          'div',
          { className: 'sch-empty' },
          h('div', { className: 'sch-empty-title' }, t('mods.docs.pick')),
          h('div', { className: 'sch-empty-desc' }, t('mods.docs.empty')),
          h('button', { type: 'button', className: 'sch-btn', style: { marginTop: 12 }, onClick: onGotoKb }, t('mods.goto.kb')),
        ),
      );
    }

    return h(
      'div',
      { className: 'sch-modbody' },
      h(
        'div',
        { className: 'sch-toolbar' },
        h('div', { className: 'sch-toolbar-title' }, t('mods.docs.pick')),
        h('div', { className: 'sch-toolbar-spacer' }),
        h('div', { className: 'sch-toolbar-meta' }, t('mods.docs.pickDesc')),
      ),
      h(
        'div',
        { className: 'sch-table' },
        ...kbs.map((item) =>
          h(
            'button',
            { type: 'button', className: 'sch-pickrow', key: item.id, onClick: () => onPickKb(item.id) },
            h(IconBook),
            h(
              'span',
              { className: 'sch-pickrow-main' },
              h('span', { className: 'sch-kb-name' }, item.name),
              h('span', { className: 'sch-kb-desc' }, item.description || item.id),
            ),
            h(
              'span',
              { className: 'sch-mono num' },
              item.knowledgeCount == null ? '—' : text(t, 'docs.unit', { n: item.knowledgeCount }),
            ),
          ),
        ),
      ),
    );
  }

  /** 未接入模块：只说明缺什么接口，不放任何假按钮。 */
  function PlannedModule({ t, mod }) {
    return h(
      'div',
      { className: 'sch-modbody' },
      h(
        'div',
        { className: 'sch-planned' },
        h('div', { className: 'sch-planned-tag sch-mono' }, mod.module || mod.id),
        h('div', { className: 'sch-planned-title' }, t('mods.planned.title')),
        h('div', { className: 'sch-planned-desc' }, t('mods.planned.desc')),
        mod.requires.length
          ? h(
              'div',
              { className: 'sch-reqs' },
              h('div', { className: 'sch-req-head' }, t('mods.requires')),
              ...mod.requires.map((req) => h('code', { className: 'sch-req', key: req }, req)),
            )
          : null,
      ),
    );
  }

  /**
   * 左侧持久导航：品牌在上，模块居中，连接状态在下。
   * 收起时只留图标列（64px），点品牌或底部按钮都能切换。
   */
  function SideNav({ t, modules, activeId, open, status, onPick, onToggle }) {
    // 已接入的排前面；规划中的单独一组，避免和可用功能混在一起
    const ready = modules.filter((mod) => mod.status !== 'planned');
    const planned = modules.filter((mod) => mod.status === 'planned');
    const renderItem = (mod) => {
      const Icon = mod.icon || IconGrid;
      return h(
        'button',
        {
          key: mod.id,
          type: 'button',
          role: 'tab',
          'aria-selected': mod.id === activeId,
          title: open ? undefined : t(mod.title),
          className: cx('sch-navitem', mod.id === activeId ? 'on' : ''),
          onClick: () => onPick(mod.id),
        },
        h('span', { className: 'sch-navitem-icon' }, h(Icon)),
        h('span', { className: 'sch-navitem-label' }, t(mod.title)),
      );
    };
    return h(
      'aside',
      { className: cx('sch-side', open ? '' : 'mini') },
      h(
        'div',
        { className: 'sch-side-brand' },
        h(
          'div',
          { className: 'sch-side-brandmark' },
          open
            ? h(Wordmark, { height: 40 })
            : h('img', { className: 'sch-side-glyph', src: ASSETS.symbol, alt: 'SCHANORA', width: 34, height: 34, draggable: false }),
        ),
      ),
      h(
        'div',
        { className: 'sch-side-nav', role: 'tablist', 'aria-orientation': 'vertical' },
        h('div', { className: 'sch-navgroup' }, t('nav.workspace')),
        ...ready.map(renderItem),
        planned.length ? h('div', { className: 'sch-navgroup' }, t('nav.planned')) : null,
        ...planned.map(renderItem),
      ),
      h(
        'div',
        { className: 'sch-side-foot' },
        h(
          'div',
          { className: 'sch-statusline', title: `${status.label}${status.latency != null ? ` · ${status.latency}ms` : ''}` },
          h(StatusDot, { tone: status.tone }),
          h('span', null, status.label),
        ),
        h(
          'button',
          {
            type: 'button',
            className: 'sch-btn icon sm',
            onClick: onToggle,
            title: open ? t('nav.collapse') : t('nav.expand'),
            'aria-label': open ? t('nav.collapse') : t('nav.expand'),
          },
          h(IconPanelLeft),
        ),
      ),
    );
  }

  function ModulesDrawer({ t, modules, settings, onClose }) {
    return h(
      'div',
      { className: 'sch-root sch-tokens sch-drawer', role: 'dialog', 'aria-label': t('mods.title') },
      h(
        'div',
        { className: 'sch-drawer-head' },
        h(
          'div',
          null,
          // 新字标是透明底绿字：垫白底板，避免深色抽屉里看不清
          h(
            'span',
            { className: 'sch-plate', style: { padding: '6px 8px' } },
            h(Wordmark, { height: 24 }),
          ),
          h('div', { className: 'sch-section-meta', style: { marginTop: 6 } }, t('mods.subtitle')),
        ),
        h('button', { type: 'button', className: 'sch-btn icon', onClick: onClose, 'aria-label': t('panel.close') }, h(IconX)),
      ),
      h('div', { className: 'sch-section-meta' }, text(t, 'mods.count', { n: modules.length })),
      h(
        'div',
        { className: 'sch-modlist' },
        ...modules.map((mod) =>
          h(
            'div',
            { className: 'sch-modrow', key: mod.id },
            h('span', { className: cx('sch-dot', mod.status === 'ready' ? 'ok' : mod.status === 'partial' ? 'warn' : '') }),
            h(
              'div',
              { className: 'sch-modrow-main' },
              h(
                'div',
                { className: 'sch-modrow-title' },
                t(mod.title),
                mod.module ? h('span', { className: 'sch-modrow-code sch-mono' }, mod.module) : null,
              ),
              h(
                'div',
                { className: 'sch-modrow-meta' },
                `${t(`mods.status.${mod.status}`) || mod.status} · ${mod.tab ? t('mods.tab') : t('mods.detail')}`,
              ),
              mod.requires.length && mod.status !== 'ready'
                ? h(
                    'div',
                    { className: 'sch-reqs tight' },
                    ...mod.requires.map((req) => h('code', { className: 'sch-req', key: req }, req)),
                  )
                : null,
            ),
          ),
        ),
      ),
      h('div', { className: 'sch-section-title', style: { marginTop: 20 } }, t('mods.contract')),
      h('div', { className: 'sch-card-desc' }, t('mods.contract.desc')),
      h(
        'pre',
        { className: 'sch-pre' },
        [
          `window.${MODULE_REGISTRY_KEY}.add({`,
          `  id: 'm4-qa',            // 唯一`,
          `  title: '工程问答',`,
          `  module: 'M4',`,
          `  status: 'planned',      // ready | partial | planned`,
          `  order: 30,`,
          `  requires: ['POST /api/v1/qa'],`,
          `  mount: (ctx) => <YourView {...ctx} />,`,
          `})`,
        ].join('\n'),
      ),
      h('div', { className: 'sch-section-meta', style: { marginTop: 10 } }, sourceLabel(t, settings.mode)),
    );
  }

  /* ------------------------------------------- 富文本（答案用的极小 markdown） */

  /**
   * 答案里 95% 是「段落 + 列表 + 少量强调」。不引 marked（40KB，还多一层 XSS 面），
   * 只认这三种 + 引用角标，全程产出 React 节点、不用 innerHTML。
   */
  function inlineMd(content, keyPrefix, cites) {
    const nodes = [];
    const re = /(\*\*[^*]+\*\*|`[^`]+`|\[\d{1,2}\])/g;
    let last = 0;
    let m;
    let i = 0;
    while ((m = re.exec(content)) !== null) {
      if (m.index > last) nodes.push(content.slice(last, m.index));
      const token = m[0];
      const key = `${keyPrefix}-${i}`;
      i += 1;
      if (token.slice(0, 2) === '**') nodes.push(h('b', { key }, token.slice(2, -2)));
      else if (token.slice(0, 1) === '`') nodes.push(h('code', { key, className: 'sch-code' }, token.slice(1, -1)));
      else {
        // 角标不是装饰：序号要能落回引用列表，否则答案看起来有出处、实际点不开。
        const n = Number(token.slice(1, -1));
        const refs = (cites && cites.refs) || [];
        const known = n >= 1 && n <= refs.length;
        const strict = Boolean(cites && cites.strict);
        const bad = strict && !known;
        const label = cites && cites.t ? text(cites.t, bad ? 'cite.missing' : 'cite.jump', { n }) : String(n);
        nodes.push(
          h(
            'sup',
            {
              key,
              className: cx('sch-cite', strict && (bad ? 'bad' : 'ok')),
              role: known ? 'button' : undefined,
              tabIndex: known ? 0 : undefined,
              title: label,
              onClick: known && cites && cites.onCite ? () => cites.onCite(n) : undefined,
              onKeyDown:
                known && cites && cites.onCite
                  ? (e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        cites.onCite(n);
                      }
                    }
                  : undefined,
            },
            token.slice(1, -1),
          ),
        );
      }
      last = m.index + token.length;
    }
    if (last < content.length) nodes.push(content.slice(last));
    return nodes;
  }

  function RichText({ content, refs, strict, t, onCite }) {
    const citeCtx = { refs, strict, t, onCite };
    const blocks = useMemo(() => {
      const out = [];
      String(content || '')
        .split(/\n{2,}/)
        .forEach((para, pi) => {
          const lines = para.split('\n').filter((l) => l.trim() !== '');
          if (lines.length === 0) return;
          const isList = lines.every((l) => /^\s*([-*·]|\d+[.)])\s+/.test(l));
          if (isList) {
            out.push({
              kind: 'list',
              ordered: /^\s*\d+[.)]/.test(lines[0]),
              items: lines.map((l) => l.replace(/^\s*([-*·]|\d+[.)])\s+/, '')),
              key: `b${pi}`,
            });
          } else {
            out.push({ kind: 'p', text: para.trim(), key: `b${pi}` });
          }
        });
      return out;
    }, [content]);

    if (!blocks.length) return null;
    return h(
      'div',
      { className: 'sch-rich' },
      blocks.map((b) => {
        if (b.kind === 'list') {
          return h(
            b.ordered ? 'ol' : 'ul',
            { key: b.key, className: 'sch-rich-list' },
            b.items.map((item, i) => h('li', { key: `${b.key}-${i}` }, inlineMd(item, `${b.key}-${i}`, citeCtx))),
          );
        }
        return h('p', { key: b.key }, inlineMd(b.text, b.key, citeCtx));
      }),
    );
  }

  /* ------------------------------------------------------------- 引用片段 */

  /** 引用不跳页：点击就地展开原文。跨模块跳转要改文档模块的状态归属，
   *  代价大于收益，而且「看引用原文」本身就地就能满足。
   *  focus 由正文里的角标点击传入（1 基），对应列表里的第 n 条。 */
  function ReferenceList({ t, refs, answer, focus }) {
    const [openId, setOpenId] = useState(null);
    const listRef = useRef(null);
    const check = useMemo(() => verifyCitations({ answer: answer || '', refs }), [answer, refs]);

    useEffect(() => {
      if (!focus) return;
      const target = refs[focus - 1];
      if (!target) return;
      setOpenId(target.id);
      const el = listRef.current;
      const row = el && el.querySelector(`[data-ref="${focus}"]`);
      if (row && typeof row.scrollIntoView === 'function') row.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }, [focus]);

    if (!refs || refs.length === 0) return null;
    return h(
      'div',
      { className: 'sch-refs' },
      h(
        'div',
        { className: 'sch-refs-head' },
        h('span', null, text(t, 'chat.references', { n: refs.length })),
        h(
          'span',
          { className: cx('sch-refstat', check.unverified ? 'bad' : 'ok'), title: t('cite.legend') },
          check.total === 0
            ? t('cite.none')
            : check.unverified === 0
              ? text(t, 'cite.ok', { n: check.verified })
              : text(t, 'cite.bad', { n: check.unverified }),
        ),
      ),
      h(
        'div',
        { className: 'sch-refs-list', ref: listRef },
        refs.map((ref, i) => {
          const open = openId === ref.id;
          return h(
            'div',
            { key: ref.id || `ref-${i}`, className: cx('sch-ref', open && 'open'), 'data-ref': i + 1 },
            h(
              'button',
              {
                type: 'button',
                className: 'sch-ref-btn',
                onClick: () => setOpenId(open ? null : ref.id),
                title: t(open ? 'search.collapse' : 'search.expand'),
              },
              h('span', { className: 'sch-ref-idx' }, String(i + 1)),
              h('span', { className: 'sch-ref-title' }, ref.title || ref.fileName || '—'),
              ref.chunkIndex != null ? h('span', { className: 'sch-ref-meta' }, text(t, 'search.chunk', { n: ref.chunkIndex + 1 })) : null,
              // P3：引用绑定实际文件版本（上游带 versionId 时才显示）
              ref.versionId ? h('span', { className: 'sch-ref-meta' }, text(t, 'ref.version', { v: ref.versionId })) : null,
            ),
            open ? h('div', { className: 'sch-ref-quote' }, ref.content) : null,
          );
        }),
      ),
    );
  }

  /** P3：证据检索模式的气泡文案 —— 不生成答案，只列证据并说明由 DSH 主对话作答。 */
  function evidenceText(t, query, refs) {
    if (!refs || refs.length === 0) {
      return [t('chat.evidence.none'), '', t('chat.evidence.desc')].join('\n');
    }
    const lines = refs.slice(0, 4).map((ref, i) => {
      const chunk = ref.chunkIndex != null ? ` · ${text(t, 'search.chunk', { n: ref.chunkIndex + 1 })}` : '';
      const ver = ref.versionId ? ` · ${text(t, 'ref.version', { v: ref.versionId })}` : '';
      return `${i + 1}. ${ref.title || ref.fileName || '—'}${chunk}${ver}`;
    });
    return [text(t, 'chat.evidence.title', { n: refs.length }), '', ...lines, '', t('chat.evidence.desc')].join('\n');
  }

  /** 答案块：正文、流式指示、引用列表。角标点击的焦点状态放在这里，
   *  每条消息各持一份，翻历史消息时不会互相串。 */
  function AnswerBody({ t, m, query, settings, gateOn, citeOn, minCoverage }) {
    const [focus, setFocus] = useState(null);
    const [inlineRefs, setInlineRefs] = useState([]);
    const refs = inlineRefs.length ? [...(m.refs || []), ...inlineRefs] : m.refs || [];
    useEffect(() => {
      if (!WEKNORA || !m.agentId || m.streaming) return undefined;
      let alive = true;
      api.agentReferences(settings, m.content, m.refs).then((loaded) => {
        if (alive) setInlineRefs(loaded);
      });
      return () => { alive = false; };
    }, [m.agentId, m.streaming, m.content, m.refs, baseOf(settings)]);
    const strict = !m.streaming && refs.length > 0 && citeOn !== false;
    // A 侧实测：合成答案的引用是 <kb chunk_id="…" /> 内联标签，不是 [n]。
    // 渲染前统一换成角标，否则用户看到的是裸标签（落不回引用列表）。
    const body = useMemo(() => normalizeCitations(m.content, refs), [m.content, refs]);
    // 门槛在问答页的用法：不是拦结果，而是告诉用户"这段答案的证据其实很弱"。
    const gate = useMemo(
      () =>
        gateOn && query && refs.length && !m.streaming
          ? annotateHits(query, refs, { minCoverage: minCoverage == null ? MIN_COVERAGE : minCoverage })
          : null,
      [query, refs, m.streaming, gateOn, minCoverage],
    );
    const weak = gate && gate.diagnostics.kept === 0;
    return h(
      'div',
      { className: 'sch-answer' },
      // P3：发送时锁定的检索范围与回答方式回显（范围切换不影响已在途的请求）
      m.scope
        ? h(
            'div',
            { className: 'sch-msg-note', title: m.scope.at },
            text(t, 'chat.scope.locked', { names: m.scope.names || m.scope.ids.join('、') }),
            m.deep ? ` · ${t('chat.deep.badge')}` : '',
            m.hostModel ? ` · ${t('chat.host.badge')}` : '',
          )
        : null,
      body ? h(RichText, { content: body, refs, strict, t, onCite: setFocus }) : null,
      m.streaming && !m.content ? h('span', { className: 'sch-typing' }, h('i'), h('i'), h('i')) : null,
      m.streaming && m.content ? h('span', { className: 'sch-cursor' }) : null,
      m.tools?.length
        ? h('div', { className: 'sch-msg-note' }, t('chat.agent.tools'), ' · ', m.tools.join('、'))
        : null,
      m.pending ? h('div', { className: 'sch-msg-note' },
        t('chat.agent.pending'), ' ',
        h('a', {
          href: `/platform/chat/${encodeURIComponent(m.sessionId)}`,
          target: '_blank',
          rel: 'noopener noreferrer',
        }, t('chat.agent.open')),
      ) : null,
      m.stopped ? h('div', { className: 'sch-msg-note' }, t('chat.stopped')) : null,
      m.failed ? h('div', { className: 'sch-msg-note err' }, m.failureMessage || t('chat.incomplete')) : null,
      refs.length && !m.evidence ? h(ReferenceList, { t, refs, answer: body, focus }) : null,
      weak ? h('div', { className: 'sch-msg-note warn' }, text(t, 'chat.gate.weak', { n: refs.length })) : null,
    );
  }

  /* ----------------------------------------------------------- 模块 4：检索 */

  /** P3 范围规则（HANDOFF §7）：Schanora 不复制上游「空范围=所有可见库」的展开行为。
   *  显式范围是硬前提 —— 没选库就返回 null，调用方必须提示选库并拒绝请求，
   *  而不是把全库结果当成范围结果发给用户。 */
  function effectiveScope(scopeIds, kbs) {
    if (scopeIds && scopeIds.length) return scopeIds.slice();
    return null;
  }

  /** 发送时的范围快照（scopeRevision）：请求在途期间用户切库不影响本次请求，
   *  答案气泡上回显“发送时锁定”的范围，事后可核对。 */
  function snapshotScope(scopeIds, kbs) {
    const ids = (scopeIds || []).slice();
    const names = ids
      .map((id) => {
        const kb = (kbs || []).find((x) => x.id === id);
        return kb ? kb.name : id;
      })
      .join('、');
    return { ids, names, revision: ids.join('|'), at: new Date().toISOString() };
  }

  function SearchView({ t, settings, kbs, loading, snap, store, notify }) {
    const [query, setQuery] = useState('');
    const [scopeIds, setScopeIds] = useState([]);
    const [phase, setPhase] = useState('idle');
    const [hits, setHits] = useState([]);
    const [meta, setMeta] = useState(null);
    const [error, setError] = useState(null);
    useAutoDismissError(error, setError);
    const [needScope, setNeedScope] = useState(false);
    const [took, setTook] = useState(null);
    const [gate, setGate] = useState(null);
    const [openId, setOpenId] = useState(null);
    const inputRef = useRef(null);
    // §6 一致性：提交时记一份条件快照（规范化关键词 + 排序后的库集合 + 影响结果的上下文）。
    // 之后用户改条件 → 界面收起旧结果，提示重新检索；改回一致 → 缓存结果恢复显示。
    const [snapshot, setSnapshot] = useState(null);
    const seqRef = useRef(0);

    useEffect(() => {
      if (inputRef.current) inputRef.current.focus();
    }, []);

    // P3：检索范围同样按会话绑定，切会话重读，不继承上一个会话的选库
    const sessionKey = (snap && snap.activeSessionId) || '';
    useEffect(() => {
      setScopeIds(readScope(sessionKey));
      setNeedScope(false);
    }, [sessionKey]);

    const toggleScope = (id) =>
      setScopeIds((prev) => {
        const next = prev.includes(id) ? prev.filter((x) => x !== id) : prev.concat(id);
        writeScope(sessionKey, next);
        if (store) store.publishScope(sessionKey, next);
        return next;
      });

    const gateOn = !settings.plugins || settings.plugins.gate !== false;

    // 快照与当前条件是否一致：片段、分数、覆盖率必须始终对应用户此刻看到的条件。
    const conditionsChanged =
      snapshot != null &&
      (query.trim() !== snapshot.q ||
        [...effectiveScope(scopeIds, kbs)].sort().join(',') !== snapshot.scopeKey ||
        settings.topK !== snapshot.topK ||
        settings.mode !== snapshot.mode ||
        baseOf(settings) !== snapshot.baseUrl);

    const run = () => {
      const q = query.trim();
      if (!q || phase === 'running') return;
      // P3（T01）：未选库直接拒绝，不查全库。提示选库，请求不发出去。
      const scope = effectiveScope(scopeIds, kbs);
      if (!scope) {
        setError(null);
        setNeedScope(true);
        return;
      }
      setNeedScope(false);
      // §6：请求序号。连续提交时旧请求的迟到响应直接丢弃，不许覆盖新结果。
      const mySeq = (seqRef.current += 1);
      const started = Date.now();
      setSnapshot({ q, scopeKey: [...scope].sort().join(','), topK: settings.topK, mode: settings.mode, baseUrl: baseOf(settings) });
      setPhase('running');
      setError(null);
      setOpenId(null);
      setGate(null);

      // 门槛只标注、不筛掉：检索页要展示召回全集，用户自己判断值不值得看。
      // 插件关掉时原样返回，界面上也不出现覆盖率徽标（这是「关」的真实含义）。
      const withGate = (items) => {
        if (!gateOn) return items;
        const annotated = annotateHits(q, items, { minCoverage: settings.minCoverage == null ? MIN_COVERAGE : settings.minCoverage });
        setGate(annotated.diagnostics);
        return annotated.hits;
      };

      const apply = (fn) => {
        if (seqRef.current !== mySeq) return;
        fn();
      };

      if (settings.mode === 'mock') {
        setTimeout(() => {
          apply(() => {
            const res = mockSearchHits(q, scope);
            setHits(withGate(res.items));
            setMeta(res.meta);
            setTook(Date.now() - started);
            setPhase('done');
          });
        }, 300);
        return;
      }

      api
        .search(settings, { query: q, kbIds: scope, matchCount: settings.topK })
        .then((res) => {
          apply(() => {
            setHits(withGate(res.items));
            setMeta(res.meta);
            setTook(Date.now() - started);
            setPhase('done');
          });
        })
        .catch((err) => {
          apply(() => {
            setError({ code: err.code, message: err.message, requestId: (err.extra && err.extra.requestId) || null });
            setPhase('error');
          });
        });
    };

    const kbName = (id) => {
      const hit = kbs.find((kb) => kb.id === id);
      return hit ? hit.name : '';
    };

    // 延迟与 rerank 状态属于运行细节：正常时不占位，只有异常才出现在结果上方。
    // 完整信息挂在计数文字的 title 上，诊断抽屉里也能看到。
    const rerankNote = () => {
      if (!meta || !meta.rerank) return null;
      if (String(meta.rerank.outcome || '') !== 'error') return null;
      return h('span', { className: 'sch-note warn' }, t('search.rerank.error'));
    };
    const runDetail = () => {
      const parts = [];
      if (took != null) parts.push(text(t, 'search.took', { ms: took }));
      if (meta && meta.rerank) {
        const outcome = String(meta.rerank.outcome || '');
        if (outcome === 'ok') parts.push(t('search.rerank.ok'));
        else if (outcome === 'disabled') parts.push(t('search.rerank.disabled'));
      }
      return parts.join(' · ') || undefined;
    };

    if (!loading && kbs.length === 0) {
      return h(
        'div',
        { className: 'sch-modbody' },
        h('div', { className: 'sch-empty' }, h('div', { className: 'sch-empty-title' }, t('search.needKb'))),
      );
    }

    return h(
      'div',
      { className: 'sch-modbody' },
      h(
        'div',
        { className: 'sch-searchbar' },
        h(
          'div',
          { className: 'sch-searchbox' },
          h(IconSearch, { size: 15 }),
          h('input', {
            ref: inputRef,
            className: 'sch-input sch-search-input',
            value: query,
            placeholder: t('search.placeholder'),
            onChange: (e) => setQuery(e.target.value),
            onKeyDown: (e) => {
              if (e.key === 'Enter') run();
            },
          }),
          h(
            'button',
            { type: 'button', className: 'sch-btn primary', disabled: phase === 'running' || !query.trim(), onClick: run },
            t(phase === 'running' ? 'search.running' : 'search.run'),
          ),
        ),
        h(
          'div',
          { className: 'sch-scoperow' },
          h('span', { className: 'sch-scoperow-label' }, t('search.scope')),
          // P3：不再提供「全部知识库」。未选库时给一个可点的提示 chip，点了不动（选择知识库后才可检索）。
          scopeIds.length === 0
            ? h(
                'span',
                { className: 'sch-note warn', role: 'status' },
                t('search.scope.required'),
              )
            : null,
          kbs.map((kb) =>
            h(
              'button',
              {
                key: kb.id,
                type: 'button',
                className: cx('sch-scopechip', scopeIds.includes(kb.id) && 'on'),
                onClick: () => {
                  setNeedScope(false);
                  toggleScope(kb.id);
                },
                title: kb.description || kb.name,
              },
              kb.name,
            ),
          ),
        ),
      ),

      needScope
        ? h(
            'div',
            { className: 'sch-alert', role: 'alert' },
            h(IconAlert),
            h('div', null, t('search.scope.required')),
          )
        : null,

      // 检索失败统一走浮层警示（不自绘红块，避免顶乱排版）
      h(NoticeBridge, {
        notify,
        code: error ? `${t('search.failed')} · ${error.code || 'ERROR'}` : '',
        message: error ? error.message || '' : '',
        requestId: error ? error.requestId : null,
      }),

      phase === 'idle'
        ? h(
            'div',
            { className: 'sch-empty' },
            h('div', { className: 'sch-empty-title' }, t('search.idle.title')),
            h('div', { className: 'sch-empty-desc' }, t('search.idle.desc')),
          )
        : null,

      phase === 'running'
        ? h(
            'div',
            { className: 'sch-hits' },
            [0, 1, 2].map((i) => h('div', { key: i, className: 'sch-skel', style: { height: 86 } })),
          )
        : null,

      phase === 'done' && conditionsChanged
        ? h(
            'div',
            { className: 'sch-alert', role: 'status' },
            h(IconAlert),
            h(
              'div',
              null,
              h('b', null, t('search.stale.title')),
              h('div', { className: 'sch-alert-sub' }, t('search.stale.desc')),
              h(
                'div',
                { style: { marginTop: 8 } },
                h('button', { type: 'button', className: 'sch-btn sm primary', onClick: run }, t('search.run')),
              ),
            ),
          )
        : phase === 'done'
        ? h(
            'div',
            null,
            h(
              'div',
              { className: 'sch-toolbar' },
              h('span', { className: 'sch-toolbar-title', title: runDetail() }, text(t, 'search.count', { n: hits.length })),
              gate
                ? h(
                    'span',
                    { className: cx('sch-note', gate.kept === 0 && 'warn') },
                    text(t, 'search.gate', { kept: gate.kept, total: gate.total }),
                  )
                : null,
              rerankNote(),
              h('span', { className: 'sch-toolbar-spacer' }),
            ),
            hits.length === 0
              ? h(
                  'div',
                  { className: 'sch-empty', style: { marginTop: 12 } },
                  h('div', { className: 'sch-empty-title' }, t('search.noHit.title')),
                  h('div', { className: 'sch-empty-desc' }, t('search.noHit.desc')),
                )
              : h(
                  'div',
                  null,
                  gate && gate.kept === 0
                    ? h('div', { className: 'sch-note warn', style: { marginTop: 10 } }, t('search.gate.none'))
                    : null,
                  h(
                  'div',
                  { className: 'sch-hits' },
                  hits.map((hit, i) => {
                    const open = openId === hit.id;
                    const score = hit.score == null ? null : Math.round(hit.score * 100);
                    return h(
                      'article',
                      { key: hit.id || i, className: cx('sch-hit', open && 'open') },
                      h(
                        'div',
                        { className: 'sch-hit-head' },
                        h('span', { className: 'sch-hit-idx' }, String(i + 1)),
                        h('span', { className: 'sch-hit-title', title: hit.title }, hit.title || '—'),
                        hit.chunkIndex != null
                          ? h('span', { className: 'sch-hit-meta' }, text(t, 'search.chunk', { n: hit.chunkIndex + 1 }))
                          : null,
                        h(
                          'span',
                          { className: cx('sch-badge', hit.matchType === 1 ? 'plain' : 'live') },
                          t(hit.matchType === 1 ? 'search.type.keyword' : 'search.type.vector'),
                        ),
                        hit.coverage != null
                          ? h(
                              'span',
                              {
                                className: cx('sch-badge', hit.meetsGate ? 'live' : 'warn'),
                                title: text(t, 'search.gate.tip', { p: Math.round(hit.coverage * 100) }),
                              },
                              text(t, 'search.coverage', { p: Math.round(hit.coverage * 100) }),
                            )
                          : null,
                        hit.hasProvenance === false
                          ? h('span', { className: 'sch-badge warn', title: t('search.gate.provenance') }, t('search.gate.nochunk'))
                          : null,
                        score != null
                          ? h(
                              'span',
                              {
                                className: cx('sch-badge', score >= 55 ? 'live' : 'plain'),
                                title: t('search.score'),
                                style: { marginLeft: 'auto', fontVariantNumeric: 'tabular-nums' },
                              },
                              `${score}%`,
                            )
                          : null,
                      ),
                      h(
                        'p',
                        { className: cx('sch-hit-body', open && 'open') },
                        hit.content,
                      ),
                      h(
                        'div',
                        { className: 'sch-hit-foot' },
                        hit.kbId && kbName(hit.kbId)
                          ? h('span', { className: 'sch-hit-kb' }, kbName(hit.kbId))
                          : null,
                        h(
                          'button',
                          {
                            type: 'button',
                            className: 'sch-linkbtn',
                            onClick: () => setOpenId(open ? null : hit.id),
                          },
                          t(open ? 'search.collapse' : 'search.expand'),
                        ),
                      ),
                    );
                  }),
                ),
              ),
          )
        : null,
    );
  }

  /* --------------------------------------------------------- 模块 6：Wiki */

  function WikiView({ t, settings, kbs, loading, kbId: kbIdProp, notify }) {
    // §2 库内子视图：面板传入 kbIdProp 时锁定到当前库（不渲染自己的库选择器）
    const [ownKbId, setOwnKbId] = useState('');
    const kbId = kbIdProp || ownKbId;
    const [pages, setPages] = useState(null);
    const [slug, setSlug] = useState('');
    const [page, setPage] = useState(null);
    const [pageLoading, setPageLoading] = useState(false);
    const [filter, setFilter] = useState('');
    const [error, setError] = useState(null);
    useAutoDismissError(error, setError);
    const mock = settings.mode === 'mock';

    useEffect(() => {
      if (!kbId && kbs.length) setOwnKbId(kbs[0].id);
    }, [kbs]);

    useEffect(() => {
      if (!kbId) {
        setPages(null);
        return undefined;
      }
      let alive = true;
      setError(null);
      setPages(null);
      setSlug('');
      setPage(null);
      const loadTree = mock ? mockWikiTree(kbId) : api.wikiTree(settings, kbId);
      loadTree
        .then((list) => {
          if (!alive) return;
          setPages(list);
          if (list.length) setSlug(list[0].slug);
        })
        .catch((err) => {
          if (alive) {
            setPages([]);
            setError({ code: err.code, message: err.message });
          }
        });
      return () => {
        alive = false;
      };
    }, [kbId, settings.mode, baseOf(settings)]);

    useEffect(() => {
      if (!slug || !kbId) return undefined;
      let alive = true;
      setPageLoading(true);
      setError(null);
      const loadPage = mock ? mockWikiPage(kbId, slug) : api.wikiPage(settings, kbId, slug);
      loadPage
        .then((p) => {
          if (alive) setPage(p);
        })
        .catch((err) => {
          if (alive) {
            setPage(null);
            setError({ code: err.code, message: err.message });
          }
        })
        .finally(() => {
          if (alive) setPageLoading(false);
        });
      return () => {
        alive = false;
      };
    }, [slug, kbId, settings.mode, baseOf(settings)]);

    const visible = useMemo(() => {
      const q = filter.trim().toLowerCase();
      if (!pages) return null;
      if (!q) return pages;
      return pages.filter((p) => `${p.title} ${p.summary}`.toLowerCase().includes(q));
    }, [pages, filter]);

    const kbName = (id) => {
      const kb = kbs.find((k) => k.id === id);
      return kb ? kb.name : '';
    };

    // Wiki 失败（含未实现）也走统一浮层：不自绘红块
    const errorView = h(NoticeBridge, {
      notify,
      code: error
        ? error.code === 'NOT_IMPLEMENTED'
          ? t('wiki.unavailable.title')
          : `${t('wiki.failed')} · ${error.code || 'ERROR'}`
        : '',
      message: error ? (error.code === 'NOT_IMPLEMENTED' ? t('wiki.unavailable.desc') : error.message || '') : '',
      requestId: error ? error.requestId : null,
    });

    if (!loading && kbs.length === 0) {
      return h(
        'div',
        { className: 'sch-modbody' },
        h('div', { className: 'sch-empty' }, h('div', { className: 'sch-empty-title' }, t('search.needKb'))),
      );
    }

    return h(
      'div',
      { className: 'sch-modbody' },
      errorView,
      h(
        'div',
        { className: 'sch-wiki' },
        h(
          'aside',
          { className: 'sch-wiki-side' },
          kbIdProp
            ? null
            : h(
                'select',
                {
                  className: 'sch-input',
                  value: kbId,
                  'aria-label': t('wiki.pickKb'),
                  onChange: (e) => setOwnKbId(e.target.value),
                },
                kbs.map((kb) => h('option', { key: kb.id, value: kb.id }, kb.name)),
              ),
          h(
            'div',
            { className: 'sch-wiki-filter' },
            h(IconSearch, { size: 14 }),
            h('input', {
              className: 'sch-input',
              value: filter,
              placeholder: t('wiki.filter'),
              onChange: (e) => setFilter(e.target.value),
            }),
          ),
          pages === null
            ? [0, 1, 2].map((i) => h('div', { key: i, className: 'sch-skel', style: { height: 44, marginBottom: 6 } }))
            : visible && visible.length
              ? visible.map((p) =>
                  h(
                    'button',
                    {
                      key: p.slug,
                      type: 'button',
                      className: cx('sch-wiki-item', p.slug === slug && 'on'),
                      onClick: () => setSlug(p.slug),
                      title: p.summary || p.title,
                    },
                    h('span', { className: 'sch-wiki-item-title' }, p.title),
                    h(
                      'span',
                      { className: 'sch-wiki-item-meta' },
                      h('span', { className: cx('sch-badge', p.status === 'draft' ? 'plain' : 'live') }, t(`wiki.status.${p.status}`)),
                      h('span', null, t(`wiki.type.${p.type}`)),
                    ),
                  ),
                )
              : h('div', { className: 'sch-empty-inline' }, t('wiki.empty')),
        ),
        h(
          'section',
          { className: 'sch-wiki-page' },
          kbIdProp
            ? null
            : h(
                'select',
                {
                  className: 'sch-wiki-pickkb',
                  value: kbId,
                  'aria-label': t('wiki.pickKb'),
                  onChange: (e) => setOwnKbId(e.target.value),
                },
                kbs.map((kb) => h('option', { key: kb.id, value: kb.id }, kb.name)),
              ),
          h(
            'select',
            {
              className: 'sch-wiki-pick',
              value: slug,
              'aria-label': t('wiki.pick'),
              onChange: (e) => setSlug(e.target.value),
            },
            (pages || []).map((p) => h('option', { key: p.slug, value: p.slug }, p.title)),
          ),
          pageLoading
            ? h('div', { className: 'sch-skel', style: { height: 120 } })
            : !page
              ? h(
                  'div',
                  { className: 'sch-chat-idle' },
                  h('div', { className: 'sch-empty-title' }, t('wiki.pickPage')),
                )
              : h(
                  'article',
                  { className: 'sch-wiki-article' },
                  h(
                    'header',
                    { className: 'sch-wiki-head' },
                    h('h2', { className: 'sch-wiki-title' }, page.title),
                    h(
                      'div',
                      { className: 'sch-wiki-meta' },
                      h('span', { className: cx('sch-badge', page.status === 'draft' ? 'plain' : 'live') }, t(`wiki.status.${page.status}`)),
                      h('span', null, t(`wiki.type.${page.type}`)),
                      h('span', null, text(t, 'wiki.version', { n: page.version })),
                      page.updatedAt ? h('span', null, text(t, 'wiki.updated', { time: fmtDateTime(page.updatedAt) })) : null,
                    ),
                    page.summary ? h('p', { className: 'sch-wiki-summary' }, page.summary) : null,
                  ),
                  h(RichText, { content: page.content }),
                  page.sources.length
                    ? h(
                        'div',
                        { className: 'sch-wiki-src' },
                        h('div', { className: 'sch-wiki-src-head' }, text(t, 'wiki.sources', { n: page.sources.length })),
                        page.sources.map((s, i) =>
                          h(
                            'div',
                            { key: s.knowledgeId || i, className: 'sch-wiki-src-item' },
                            h('span', { className: 'sch-wiki-src-title' }, s.title || s.knowledgeId),
                            h('span', { className: 'sch-wiki-src-meta' }, text(t, 'wiki.chunks', { n: s.chunkCount })),
                          ),
                        ),
                      )
                    : null,
                ),
        ),
      ),
    );
  }

  /* --------------------------------------------------------- 模块 7：插件 */

  /** 插件目录。分三层，和后端能力边界一致：
   *  local  = 前端纯函数，开关真实生效；
   *  server = WeKnora 的代码插件（Go，进程外），前端只能读状态；
   *  agent  = DSH 侧注册的工具/沙箱，工作区不代跑。
   *  服务端那几项的启用状态优先取 GET /api/v1/plugins，网关没有这个接口就如实标「读不到」。 */
  const PLUGIN_CATALOG = [
    {
      id: 'gate',
      kind: 'local',
      icon: 'shield',
      deps: ['src/lib/gate.js', 'coverage ≥ {p}%'],
    },
    {
      id: 'cite',
      kind: 'local',
      icon: 'quote',
      deps: ['src/lib/cite.js', '[n] → 原文'],
    },
    {
      id: 'websearch',
      kind: 'server',
      icon: 'globe',
      deps: ['Go plugin', '.wkp', '出网白名单'],
    },
    {
      id: 'connectors',
      kind: 'server',
      icon: 'plug',
      deps: ['RSS', '飞书', 'Notion', '语雀', 'GitLab', '钉钉'],
    },
    {
      id: 'mcp',
      kind: 'agent',
      icon: 'grid',
      deps: ['mcp-server', 'Python 运行时'],
    },
    {
      id: 'skills',
      kind: 'agent',
      icon: 'layers',
      deps: ['Docker / E2B / Cube'],
    },
  ];

  function pluginIcon(kind, name) {
    if (name === 'shield') return IconCheck;
    if (name === 'quote') return IconChat;
    if (name === 'globe') return IconSearch;
    if (name === 'plug') return IconLayers;
    if (name === 'layers') return IconLayers;
    return IconGrid;
  }

  function PluginsView({ t, settings, onSettings }) {
    const [remote, setRemote] = useState({ phase: 'idle', map: {}, supported: false, error: '' });

    const pluginsOn = settings.plugins || { gate: true, cite: true };
    const threshold = Math.round((settings.minCoverage == null ? MIN_COVERAGE : settings.minCoverage) * 100);

    useEffect(() => {
      if (!isRemote(settings)) {
        setRemote({ phase: 'skipped', map: {}, supported: false, error: '' });
        return undefined;
      }
      let alive = true;
      setRemote({ phase: 'loading', map: {}, supported: false, error: '' });
      api
        .listPlugins(settings)
        .then((items) => {
          if (!alive) return;
          const map = {};
          items.forEach((item) => {
            if (!item || !item.id) return;
            map[String(item.id)] = item;
          });
          setRemote({ phase: 'done', map, supported: true, error: '' });
        })
        .catch((err) => {
          if (!alive) return;
          setRemote({
            phase: 'error',
            map: {},
            supported: false,
            error: err.code === 'NOT_IMPLEMENTED' ? '' : err.message || '',
          });
        });
      return () => {
        alive = false;
      };
    }, [settings.mode, baseOf(settings)]);

    const setPlugin = (id, on) => {
      onSettings(normalizeSettings({ ...settings, plugins: { ...pluginsOn, [id]: on } }));
    };

    const enabledCount = ['gate', 'cite'].filter((id) => pluginsOn[id] !== false).length;

    const badgeFor = (item) => {
      if (item.kind === 'local') {
        const on = pluginsOn[item.id] !== false;
        return h('span', { className: cx('sch-badge', on ? 'live' : 'plain') }, t(on ? 'plug.state.on' : 'plug.state.off'));
      }
      if (item.kind === 'agent') return h('span', { className: 'sch-badge plain' }, t('plug.state.agent'));
      const hit = remote.map[item.id];
      if (hit) {
        const on = hit.enabled !== false && String(hit.status || 'enabled') !== 'disabled';
        return h('span', { className: cx('sch-badge', on ? 'live' : 'plain') }, t(on ? 'plug.state.on' : 'plug.state.off'));
      }
      if (remote.phase === 'loading') return h('span', { className: 'sch-badge plain' }, t('plug.state.loading'));
      // 演示模式不联网：这里只能说「要网关启用」，不能假装知道状态
      if (remote.phase === 'skipped') return h('span', { className: 'sch-badge plain' }, t('plug.state.offline'));
      if (!remote.supported) return h('span', { className: 'sch-badge warn' }, t('plug.state.unknown'));
      return h('span', { className: 'sch-badge plain' }, t('plug.state.absent'));
    };

    // 开关收到卡片右上角：卡片底部不再重复一遍与分组说明同义的脚注
    const switchFor = (item) => {
      if (item.kind !== 'local') return null;
      const on = pluginsOn[item.id] !== false;
      return h('button', {
        type: 'button',
        className: 'sch-switch',
        'aria-pressed': on,
        'aria-label': t(item.id === 'gate' ? 'plug.gate.name' : 'plug.cite.name'),
        onClick: () => setPlugin(item.id, !on),
      });
    };

    const groups = [
      ['local', 'plug.group.local', 'plug.group.local.desc'],
      ['server', 'plug.group.server', 'plug.group.server.desc'],
      ['agent', 'plug.group.agent', 'plug.group.agent.desc'],
    ];

    return h(
      'div',
      { className: 'sch-modbody' },
      h(
        'div',
        { className: 'sch-plugbar' },
        h('span', { className: 'sch-toolbar-title' }, text(t, 'plug.count', { n: enabledCount })),
        !isRemote(settings)
          ? h('span', { className: 'sch-badge mock' }, t('source.mock'))
          : remote.phase === 'loading'
            ? h('span', { className: 'sch-badge plain' }, t('plug.state.loading'))
            : remote.supported
              ? h('span', { className: 'sch-badge live' }, t('plug.state.remoteOk'))
              : h('span', { className: 'sch-badge warn' }, t('plug.unsupported')),
        remote.error ? h('span', { className: 'sch-note warn' }, remote.error) : null,
      ),
      groups.map(([kind, titleKey, descKey]) =>
        h(
          'div',
          { key: kind, className: 'sch-section' },
          h('div', { className: 'sch-section-title' }, t(titleKey)),
          h('div', { className: 'sch-section-meta', style: { margin: '4px 0 10px' } }, t(descKey)),
          h(
            'div',
            { className: 'sch-plugins' },
            PLUGIN_CATALOG.filter((item) => item.kind === kind).map((item) =>
              h(
                'div',
                { key: item.id, className: cx('sch-plugin', item.kind === 'local' && pluginsOn[item.id] !== false && 'picked') },
                h(
                  'div',
                  { className: 'sch-plugin-head' },
                  h(
                    'span',
                    { className: cx('sch-plugin-icon', item.kind === 'local' && pluginsOn[item.id] === false && 'off') },
                    h(pluginIcon(item.kind, item.icon)),
                  ),
                  h(
                    'div',
                    { className: 'sch-plugin-main' },
                    h(
                      'div',
                      { className: 'sch-plugin-name' },
                      t(`plug.${item.id}.name`),
                      badgeFor(item),
                    ),
                    h('div', { className: 'sch-plugin-desc' }, t(`plug.${item.id}.desc`)),
                    h(
                      'div',
                      { className: 'sch-plugin-deps' },
                      item.deps.map((dep, i) =>
                        h('span', { key: `${item.id}-${i}`, className: 'sch-plugin-dep' }, dep.replace('{p}', String(threshold))),
                      ),
                    ),
                  ),
                  switchFor(item),
                ),
              ),
            ),
          ),
        ),
      ),
            h('div', { className: 'sch-card-desc', style: { marginTop: 12 } }, t('plug.footnote')),
    );
  }

  /* --------------------------------------------------------- 模块 5：问答 */

  function QaView({ t, settings, kbs, snap, store, notify, hostQuote, onQuoteUsed }) {
    const [sessions, setSessions] = useState(null);
    const [activeId, setActiveId] = useState(null);
    const [messages, setMessages] = useState([]);
    const [draft, setDraft] = useState('');
    // §3/§8：草稿按问答会话隔离 —— 切历史不带走输入，切回来还在。
    // 未发送前的新会话草稿放 '__fresh' 桶，避免和已有会话互串。
    const draftKeyRef = useRef('__fresh');
    useEffect(() => {
      const nextKey = activeId || '__fresh';
      if (nextKey === draftKeyRef.current) return;
      QA_DRAFTS.set(draftKeyRef.current, draft);
      draftKeyRef.current = nextKey;
      setDraft(QA_DRAFTS.get(nextKey) || '');
    }, [activeId]);
    useEffect(() => {
      QA_DRAFTS.set(draftKeyRef.current, draft);
    }, [draft]);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(null);
    useAutoDismissError(error, setError);
    const [scopeIds, setScopeIds] = useState([]);
    const [needScope, setNeedScope] = useState(false);
    const [deep, setDeep] = useState(false); // P3：显式深度研究才走 WeKnora 合成问答
    const [agents, setAgents] = useState(null);
    const [agentsError, setAgentsError] = useState(false);
    const [agentChoices, setAgentChoices] = useState(() => new Map());
    // DSH 选区 → 知识库：《存入知识库》的进行中标记。存库走的是和「批量导入」同一条
    // createClip → commitClip 链路，所以真网关与演示数据行为一致（含幂等键去重）。
    const [quoteBusy, setQuoteBusy] = useState(false);
    const [loadingMsgs, setLoadingMsgs] = useState(false);
    const streamRef = useRef(null);
    const threadRef = useRef(null);
    const taRef = useRef(null);
    const stickRef = useRef(true); // 消息流是否贴着底（用户往上翻时应为 false）
    const freshRef = useRef(null); // 刚建的会话 id：跳过「拉历史」，否则会覆盖刚发出的消息
    const bufRef = useRef({ text: '', raf: 0 });

    const mock = settings.mode === 'mock';
    const agentsEnabled = WEKNORA && !mock && snap?.capabilities?.capabilities?.agents?.supported !== false;
    const agentId = agentsEnabled ? agentChoices.get(activeId) || '' : '';
    const pickedAgent = agents?.find((agent) => agent.id === agentId);

    useEffect(() => {
      if (!agentsEnabled) return undefined;
      let request = 0;
      const load = async () => {
        const current = ++request;
        try {
          const env = await requestJson(baseOf(settings), '/api/v1/agents', 12000);
          if (current !== request) return;
          setAgents(toList(env.data).items);
          setAgentsError(false);
        } catch (_error) {
          if (current === request) setAgentsError(true);
        }
      };
      load();
      window.addEventListener('focus', load);
      return () => {
        request += 1;
        window.removeEventListener('focus', load);
      };
    }, [agentsEnabled, baseOf(settings)]);

    // P3：范围按 DSH 会话绑定。切会话必须重读该会话自己的选库，
    // 否则会把会话 A 的范围带进会话 B（T02 的反例）。
    const sessionKey = (snap && snap.activeSessionId) || '';
    useEffect(() => {
      setScopeIds(readScope(sessionKey));
      setNeedScope(false);
    }, [sessionKey]);

    // 输入框随内容长高（96–240px 由 CSS 夹住），不出现内部滚动条也就不用手动拖拽
    useLayoutEffect(() => {
      const el = taRef.current;
      if (!el) return;
      el.style.height = 'auto';
      el.style.height = `${Math.min(Math.max(el.scrollHeight, 96), 240)}px`;
    }, [draft]);

    useEffect(() => {
      let alive = true;
      const load = mock ? mockListSessions() : api.listSessions(settings);
      load
        .then((list) => {
          if (!alive) return;
          setSessions(list);
          if (list.length && !activeId) setActiveId(list[0].id);
        })
        .catch((err) => {
          if (!alive) return;
          setSessions([]);
          setError({ code: err.code, message: err.message });
        });
      return () => {
        alive = false;
      };
    }, [settings.mode, baseOf(settings)]);

    useEffect(() => {
      // 切会话：先把上一轮的流收掉，否则它会把内容写进已经换掉的消息列表
      if (activeId !== freshRef.current && streamRef.current) {
        streamRef.current.cancel();
        streamRef.current = null;
        bufRef.current.text = '';
        if (bufRef.current.raf) {
          cancelAnimationFrame(bufRef.current.raf);
          bufRef.current.raf = 0;
        }
        setBusy(false);
      }
      stickRef.current = true;
      if (!activeId) {
        setMessages([]);
        return undefined;
      }
      // 刚建的会话：消息就在本地，再拉一次空列表会把刚发出的气泡抹掉
      if (activeId === freshRef.current) {
        freshRef.current = null;
        setLoadingMsgs(false);
        return undefined;
      }
      let alive = true;
      setLoadingMsgs(true);
      const load = mock ? mockListMessages(activeId) : api.listMessages(settings, activeId);
      load
        .then((list) => {
          if (alive) setMessages(list);
        })
        .catch((err) => {
          if (alive) setError({ code: err.code, message: err.message });
        })
        .finally(() => {
          if (alive) setLoadingMsgs(false);
        });
      return () => {
        alive = false;
      };
    }, [activeId, settings.mode, baseOf(settings)]);

    // 新内容进来就贴底；用户已经往上翻时不动（流式回答每帧都在长，抢位置就没法回看）
    useEffect(() => {
      const el = threadRef.current;
      if (!el || !stickRef.current) return;
      el.scrollTop = el.scrollHeight;
    }, [messages]);

    useEffect(
      () => () => {
        if (streamRef.current) streamRef.current.cancel();
      },
      [],
    );

    const toggleScope = (id) =>
      setScopeIds((prev) => {
        const next = prev.includes(id) ? prev.filter((x) => x !== id) : prev.concat(id);
        // 选库落在本会话：刷新/切走再回来仍然是这一组范围
        writeScope(sessionKey, next);
        if (store) store.publishScope(sessionKey, next);
        return next;
      });

    const patchBot = (id, patch) =>
      setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, ...patch } : m)));

    /**
     * 把 DSH 对话里选中的那段文字存进知识库（2026-11-17，DSH 对接第二层）。
     *
     * 为什么走 clips 而不是新开一个「导入文本」接口：采集链路已经具备
     * 版本判定（revision / dedupeKey / sourceKey）与幂等提交，直接用它对
     * **同一段选区重复点两次** 会命中版本规则，不会在库里堆重复文档。
     *
     * 落库目标是「本会话已选库」里的第一个；没选库就用第一个库；一个库都没有
     * 就明确拒绝并提示，不静默失败、也不偷偷建库。
     */
    const saveQuote = async () => {
      if (!hostQuote || quoteBusy) return;
      const picked = scopeIds.length ? kbs.filter((k) => scopeIds.includes(k.id)) : [];
      const kb = picked[0] || (scopeIds.length ? null : kbs[0]) || null;
      if (!kb) {
        notify({ tone: 'err', code: t('chat.quote.fail'), message: t('chat.quote.nokb') });
        return;
      }
      setQuoteBusy(true);
      try {
        const stamp = new Date();
        const pad = (n) => String(n).padStart(2, '0');
        const body = {
          captureMode: 'markdown',
          targetKbId: kb.id,
          originUrl: '',
          title: `DSH 对话选区 ${pad(stamp.getMonth() + 1)}-${pad(stamp.getDate())} ${pad(stamp.getHours())}:${pad(stamp.getMinutes())}`,
          contentMarkdown: hostQuote.text,
          note: '来自 DSH 对话选区',
          // 标出出处，方便之后在文档详情里区分「采集来的网页」和「对话里摘的片段」
          engineeringMetadata: { docType: 'note', source: 'dsh-selection' },
          assetRefs: [],
        };
        const created = mock ? await mockCreateClip(body) : await api.createClip(settings, body);
        const committed = mock
          ? await mockCommitClip(created.id, { expectedRevision: created.revision, idempotencyKey: created.dedupeKey })
          : await api.commitClip(settings, created.id, { expectedRevision: created.revision, idempotencyKey: created.dedupeKey });
        if (committed && committed.status === 'failed') {
          throw new ApiError(
            (committed.error && committed.error.code) || 'INGEST_FAILED',
            (committed.error && committed.error.message) || 'ingest failed',
            {},
          );
        }
        notify({ tone: 'ok', code: t('chat.quote.savedCode'), message: text(t, 'chat.quote.saved', { kb: kb.name }) });
        onQuoteUsed();
      } catch (e) {
        notify({ tone: 'err', code: (e && e.code) || 'ERROR', message: (e && e.message) || '' });
      } finally {
        setQuoteBusy(false);
      }
    };

    const flush = (id) => {
      bufRef.current.raf = 0;
      const add = bufRef.current.text;
      bufRef.current.text = '';
      if (!add) return;
      setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, content: m.content + add } : m)));
    };

    const startNewSession = async () => {
      if (busy) return;
      setError(null);
      setBusy(true);
      try {
        const created = mock ? await mockCreateSession('') : await api.createSession(settings, '');
        if (!created) throw new ApiError('API_ERROR', '网关没有返回会话 id');
        freshRef.current = created.id;
        setSessions((prev) => [created, ...(prev || [])]);
        setActiveId(created.id);
        setMessages([]);
      } catch (err) {
        setError({ code: err.code, message: err.message });
      } finally {
        setBusy(false);
      }
    };

    const send = async () => {
      const q = draft.trim();
      if (!q || busy || loadingMsgs) return;
      if (agentId && !pickedAgent) {
        setError({ code: t('chat.agent.label'), message: t('chat.agent.unavailable') });
        return;
      }
      // P3（T01）：没选知识库就不发请求，提示先选库 —— 不做「空范围=全库」。
      const scope = effectiveScope(scopeIds, kbs);
      if (!scope) {
        setError(null);
        setNeedScope(true);
        return;
      }
      setNeedScope(false);
      setError(null);
      stickRef.current = true; // 自己发的消息一定要滚进视野
      setBusy(true);

      let sid = activeId;
      if (!sid) {
        try {
          const created = mock ? await mockCreateSession(q.slice(0, 16)) : await api.createSession(settings, q.slice(0, 16));
          if (!created) throw new ApiError('API_ERROR', '网关没有返回会话 id');
          freshRef.current = created.id;
          setSessions((prev) => [created, ...(prev || [])]);
          sid = created.id;
          if (agentId) {
            setAgentChoices((prev) => {
              const next = new Map(prev);
              next.delete(null);
              next.set(created.id, agentId);
              return next;
            });
          }
          setActiveId(created.id);
          setMessages([]);
        } catch (err) {
          setBusy(false);
          setError({ code: err.code, message: err.message });
          return;
        }
      }

      // P3（T02）：范围在发送瞬间快照锁定（scopeRevision）。请求在途时用户切库，
      // 不影响本次请求；气泡上回显锁定范围，事后可核对。
      const scopeSnapshot = snapshotScope(scopeIds, kbs);
      const deepMode = deep && !pickedAgent;

      setDraft('');
      const botId = `bot-${Date.now()}`;
      setMessages((prev) =>
        prev.concat([
          { id: `me-${Date.now()}`, role: 'user', content: q, refs: [], createdAt: new Date().toISOString() },
          { id: botId, role: 'assistant', content: '', refs: [], streaming: true, scope: scopeSnapshot, deep: deepMode, agentId, sessionId: sid },
        ]),
      );

      const finish = (patch) => {
        if (bufRef.current.raf) {
          cancelAnimationFrame(bufRef.current.raf);
          flush(botId);
        }
        patchBot(botId, { streaming: false, ...patch });
        setBusy(false);
        streamRef.current = null;
      };

      // P3：普通问题只检索证据（DSH 主对话基于证据作答）；仅显式开启
      // 「深度研究」才调用 WeKnora 合成问答，避免两轮不必要的模型回答。
      if (!deepMode && !pickedAgent) {
        const evidenceToMessage = (refs) => ({
          content: evidenceText(t, q, refs),
          refs: refs.slice(0, 4),
          // 证据模式下正文里已经逐条列出，不再渲染重复的引用列表
          evidence: true,
        });
        const runEvidence = mock
          ? new Promise((resolve) => setTimeout(() => resolve(mockSearchHits(q, scopeSnapshot.ids)), 340))
          : api.search(settings, { query: q, kbIds: scopeSnapshot.ids, matchCount: settings.topK });
        runEvidence
          .then((res) => {
            finish(evidenceToMessage(res.items || []));
          })
          .catch((err) => {
            finish({ failed: true });
            setError({ code: err.code, message: err.message, requestId: (err.extra && err.extra.requestId) || null });
          });
        return;
      }

      /* 宿主模型优先（DSH 深度对接第二层）。
         宿主给了 ctx.model.chat 就用它作答：检索仍走网关，答案由 DSH 的模型写 ——
         省一次云端合成调用，答案风格与本机主对话一致。宿主没给则照旧走网关 SSE。 */
      const hostModel = snap && snap.host && snap.host.caps && snap.host.caps.model;
      if (hostModel && DEV_PREVIEW && !pickedAgent) {
        const runSearch = mock
          ? Promise.resolve(mockSearchHits(q, scopeSnapshot.ids))
          : api.search(settings, { query: q, kbIds: scopeSnapshot.ids, matchCount: settings.topK });
        runSearch
          .then(async (res) => {
            const refs = (res && res.items) || [];
            // 宿主作答不是 WeKnora 合成：把 deep 标记摘掉，气泡上只留「宿主模型作答」
            patchBot(botId, { refs, deep: false });
            const messages = composeEvidencePrompt({
              question: q,
              evidences: refs.map((r) => ({ docTitle: r.docTitle || r.title, content: r.content })),
            });
            const raw = await hostModel.chat(messages, { tag: 'schanora.qa' });
            finish({ content: normalizeChatReply(raw), hostModel: true });
          })
          .catch((err) => {
            finish({ failed: true });
            setError({
              code: (err && err.code) || 'HOST_CHAT_FAILED',
              message: (err && err.message) || '宿主模型作答失败',
            });
          });
        return;
      }

      const handlers = {
        onAnswer: (chunk) => {
          bufRef.current.text += chunk;
          if (!bufRef.current.raf) bufRef.current.raf = requestAnimationFrame(() => flush(botId));
        },
        onReferences: (refs) => patchBot(botId, { refs }),
        onAgentAnswer: (content) => patchBot(botId, { content }),
        onTools: (names) => setMessages((prev) => prev.map((m) => m.id === botId
          ? { ...m, tools: [...new Set([...(m.tools || []), ...names])] }
          : m)),
        onAgentPrompt: (pending) => patchBot(botId, { pending }),
        onTitle: (title) => {
          if (!title) return;
          setSessions((prev) => (prev || []).map((s) => (s.id === sid ? { ...s, title } : s)));
        },
        onDone: () => finish({ pending: false }),
        onStopped: () => finish({ stopped: true, pending: false }),
        onSuspended: () => finish({ pending: true }),
        onStopError: (err) => setError({ code: err.code, message: err.message }),
        onError: (err) => {
          finish({ failed: true, pending: false, failureMessage: pickedAgent ? err.message : '' });
          setError({ code: err.code, message: err.message, requestId: (err.extra && err.extra.requestId) || null });
        },
      };

      streamRef.current = mock
        ? mockAskStream(q, scopeSnapshot.ids, handlers)
        : api.askStream(
            settings,
            sid,
            { query: q, knowledgeBaseIds: scopeSnapshot.ids, agentId: pickedAgent?.id },
            handlers,
          );
    };

    const stop = () => {
      if (streamRef.current) streamRef.current.cancel();
    };

    const activeSession = (sessions || []).find((s) => s.id === activeId) || null;

    return h(
      'div',
      { className: 'sch-modbody' },
      // 问答失败走统一浮层；气泡上仍有「生成失败」标记可回查
      h(NoticeBridge, {
        notify,
        code: error ? error.code || 'ERROR' : '',
        message: error ? error.message || '' : '',
        requestId: error ? error.requestId : null,
      }),
      h(
        'div',
        { className: 'sch-chat' },
        h(
          'aside',
          { className: 'sch-chat-side' },
          h(
            'button',
            { type: 'button', className: 'sch-btn primary sch-chat-new', disabled: busy, onClick: startNewSession },
            h(IconPlus, { size: 14 }),
            t('chat.new'),
          ),
          h('div', { className: 'sch-navgroup', style: { padding: '12px 2px 6px' } }, t('chat.sessions')),
          sessions === null
            ? h('div', { className: 'sch-skel', style: { height: 34, marginTop: 6 } })
            : sessions.length === 0
              ? h('div', { className: 'sch-empty-inline' }, '—')
              : h(
                  'div',
                  { className: 'sch-sesslist' },
                  sessions.map((s) =>
                    h(
                      'button',
                      {
                        key: s.id,
                        type: 'button',
                        className: cx('sch-sess', s.id === activeId && 'on'),
                        disabled: busy,
                        onClick: () => setActiveId(s.id),
                        title: s.title || s.id,
                      },
                      h('span', { className: 'sch-sess-title' }, s.title || t('chat.untitled')),
                      h('span', { className: 'sch-sess-time' }, fmtDateTime(s.updatedAt || s.createdAt)),
                    ),
                  ),
                ),
        ),
        h(
          'section',
          { className: 'sch-chat-main' },
          h(
            'header',
            { className: 'sch-chat-head' },
            h('span', { className: 'sch-chat-title' }, activeSession ? activeSession.title || t('chat.untitled') : t('chat.idle.title')),
            h(
              'select',
              {
                className: 'sch-chat-pick',
                value: activeId || '',
                disabled: busy,
                'aria-label': t('chat.pick'),
                onChange: (e) => {
                  const next = e.target.value;
                  if (next === '__new') startNewSession();
                  else if (next) setActiveId(next);
                },
              },
              h('option', { value: '', disabled: true }, t('chat.pick')),
              ...(sessions || []).map((s) => h('option', { key: s.id, value: s.id }, s.title || t('chat.untitled'))),
              h('option', { value: '__new' }, `+ ${t('chat.new')}`),
            ),
            settings.mode === 'mock' ? h('span', { className: 'sch-badge plain' }, t('source.mock')) : null,
          ),
          h(
            'div',
            {
              className: 'sch-thread',
              ref: threadRef,
              // 距底 80px 内算「贴着底」：新内容进来时才自动跟随
              onScroll: (e) => {
                const el = e.currentTarget;
                stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
              },
            },
            loadingMsgs
              ? h('div', { className: 'sch-skel', style: { height: 60 } })
              : messages.length === 0
                ? h(
                    'div',
                    { className: 'sch-chat-idle' },
                    h('div', { className: 'sch-empty-title' },
                      activeSession ? t('chat.empty') : t('chat.idle.title')),
                    h('div', { className: 'sch-empty-desc' }, t('chat.idle.desc')),
                  )
                : messages.map((m, mi) =>
                    h(
                      'div',
                      { key: m.id, className: cx('sch-msg', m.role) },
                      h(
                        'div',
                        { className: 'sch-msg-who' },
                        m.role === 'user' ? t('chat.you')
                          : m.agentId ? text(t, 'chat.agent.badge', { name: agents?.find((a) => a.id === m.agentId)?.name || t('chat.assistant') })
                            : t('chat.assistant'),
                        m.createdAt ? h('span', { className: 'sch-msg-time' }, fmtDateTime(m.createdAt)) : null,
                      ),
                      h('div', { className: 'sch-bubble' }, h(AnswerBody, {
                        t,
                        m,
                        settings,
                        query: mi > 0 && messages[mi - 1].role === 'user' ? messages[mi - 1].content : '',
                        gateOn: !settings.plugins || settings.plugins.gate !== false,
                        citeOn: !settings.plugins || settings.plugins.cite !== false,
                        minCoverage: settings.minCoverage,
                      })),
                    ),
                  ),
          ),
          h(
            'div',
            { className: 'sch-composer' },
            agentsEnabled ? h(
              'div',
              { className: 'sch-agent-picker' },
              h('label', { className: 'sch-scoperow-label', htmlFor: 'sch-qa-agent' }, t('chat.agent.label')),
              h('select', {
                id: 'sch-qa-agent',
                className: 'sch-input',
                value: agentId,
                disabled: busy || !agents?.length && !agentId,
                onChange: (e) => {
                  const id = e.target.value;
                  setAgentChoices((prev) => new Map(prev).set(activeId, id));
                },
              },
              h('option', { value: '' }, t('chat.agent.none')),
              agentId && !pickedAgent
                ? h('option', { value: agentId, disabled: true }, t('chat.agent.unavailable')) : null,
              ...(agents || []).map((a) => h('option', { key: a.id, value: a.id }, a.name)),
              ),
              h('a', {
                className: 'sch-btn sm',
                href: '/platform/agents',
                target: '_blank',
                rel: 'noopener noreferrer',
              }, t('chat.agent.manage')),
              pickedAgent ? h('button', {
                type: 'button',
                className: 'sch-btn sm',
                onClick: async () => {
                  try {
                    await navigator.clipboard.writeText(pickedAgent.id);
                    notify({ tone: 'ok', code: t('chat.agent.copied'), message: '' });
                  } catch (_error) {
                    notify({ tone: 'warn', code: t('chat.agent.copyFailed'), message: pickedAgent.id });
                  }
                },
              }, t('chat.agent.copy')) : null,
              agentsError || agents?.length === 0
                ? h('span', { className: 'sch-composer-note', role: 'status' },
                    t(agentsError ? 'chat.agent.loadFailed' : 'chat.agent.empty')) : null,
            ) : null,
            kbs.length
              ? h(
                  'div',
                  { className: 'sch-scoperow compact' },
                  h('span', { className: 'sch-scoperow-label' }, t('chat.scope')),
                  // P3：不再有「全部知识库」；未选库给提示，选了才能发
                  scopeIds.length === 0
                    ? h('span', { className: 'sch-note warn', role: 'status' }, t('chat.scope.required'))
                    : null,
                  kbs.map((kb) =>
                    h(
                      'button',
                      {
                        key: kb.id,
                        type: 'button',
                        className: cx('sch-scopechip', scopeIds.includes(kb.id) && 'on'),
                        onClick: () => {
                          setNeedScope(false);
                          toggleScope(kb.id);
                        },
                      },
                      kb.name,
                    ),
                  ),
                  !agentId ? h(
                    'button',
                    {
                      type: 'button',
                      className: cx('sch-scopechip', deep && 'on'),
                      'aria-pressed': deep,
                      title: t('chat.mode.deep.tip'),
                      onClick: () => setDeep(!deep),
                    },
                    t('chat.mode.deep'),
                  ) : null,
                )
              : null,
            needScope ? h('div', { className: 'sch-note warn', role: 'alert' }, t('chat.scope.required')) : null,
            // DSH 对接：宿主对话里的选区，一键引用进提问框
            hostQuote
              ? h(
                  'div',
                  { className: 'sch-quote' },
                  h('span', { className: 'sch-quote-label' }, text(t, 'chat.quote.label', { n: hostQuote.chars })),
                  h('span', { className: 'sch-quote-preview' }, hostQuote.text.replace(/\s+/g, ' ').slice(0, 90)),
                  h(
                    'button',
                    {
                      type: 'button',
                      className: 'sch-btn sm primary',
                      onClick: () => {
                        setDraft((d) => (d.trim() ? `${d.trim()}\n\n${hostQuote.text}` : hostQuote.text));
                        onQuoteUsed();
                      },
                    },
                    t('chat.quote.use'),
                  ),
                  h(
                    'button',
                    {
                      type: 'button',
                      className: cx('sch-btn sm', quoteBusy && 'busy'),
                      disabled: quoteBusy,
                      title: t('chat.quote.save'),
                      onClick: saveQuote,
                    },
                    quoteBusy ? t('chat.quote.saving') : t('chat.quote.save'),
                  ),
                  h(
                    'button',
                    {
                      type: 'button',
                      className: 'sch-btn icon',
                      'aria-label': t('chat.quote.clear'),
                      title: t('chat.quote.clear'),
                      onClick: onQuoteUsed,
                    },
                    h(IconX),
                  ),
                )
              : null,
            h(
              'div',
              { className: 'sch-composer-row' },
              h('textarea', {
                className: 'sch-ta',
                ref: taRef,
                rows: 3,
                value: draft,
                placeholder: t('chat.placeholder'),
                onChange: (e) => setDraft(e.target.value),
                onKeyDown: (e) => {
                  // 中文输入法选词时按回车只是上屏，不能当发送
                  const composing = e.nativeEvent && e.nativeEvent.isComposing;
                  if (e.key === 'Enter' && !e.shiftKey && !composing && e.keyCode !== 229) {
                    e.preventDefault();
                    send();
                  }
                },
              }),
              busy
                ? h('button', { type: 'button', className: 'sch-btn', onClick: stop }, t('chat.stop'))
                : h(
                    'button',
                    { type: 'button', className: 'sch-btn primary', disabled: !draft.trim() || loadingMsgs, onClick: send },
                    t('chat.send'),
                  ),
            ),
            h('div', { className: 'sch-composer-note' }, t(agentId ? 'chat.agent.hint' : 'chat.disclaimer')),
          ),
        ),
      ),
    );
  }

  /* ------------------------------------------------- P1：采集资料（网页剪藏） */

  const IconGlobe = () => iconPath('M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 0c2.5 2.4 4 5.6 4 9s-1.5 6.6-4 9c-2.5-2.4-4-5.6-4-9s1.5-6.6 4-9ZM3.5 9h17M3.5 15h17');
  const IconClip = () => iconPath('M9 3h6v3H9zM7 6h10v13a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2V6Zm3 5v5m4-5v5');

  /**
   * P1 网页剪藏与工程速记（对应上游「知识管理助手」浏览器插件的行为重实现）。
   *
   * 边界如实标注：静态 URL 的正文抓取发生在服务端（受控获取器）；
   * 网页选段要靠浏览器扩展 / BrowserSkill 提供真实选段，本面板只收粘贴正文，
   * 不放「自动读取当前网页」这种做不到的按钮；需要登录或动态交互的页面
   * 引导到「浏览器」页签。演示模式走本机 mock 管线（去重记录持久化）。
   */
  function ClipView({ t, settings, kbs, snap, onToast, clipDraft, onClipDraftConsumed, importKbId, notify }) {
    // §8 草稿会话级恢复：切页/关抽屉再回来，表单字段原样回来。
    const clipSessionKey = (snap && snap.activeSessionId) || '';
    const savedDraft = CLIP_DRAFTS.get(clipSessionKey) || null;
    const [mode, setMode] = useState(savedDraft ? savedDraft.mode : 'url');
    const [targetKb, setTargetKb] = useState((savedDraft && savedDraft.targetKb) || '');
    const [originUrl, setOriginUrl] = useState((savedDraft && savedDraft.originUrl) || '');
    const [title, setTitle] = useState((savedDraft && savedDraft.title) || '');
    const [content, setContent] = useState((savedDraft && savedDraft.content) || '');
    const [note, setNote] = useState((savedDraft && savedDraft.note) || '');
    const [meta, setMeta] = useState((savedDraft && savedDraft.meta) || { partNumber: '', drawingNumber: '', revision: '', docType: '', supplier: '' });
    const [clip, setClip] = useState(null);
    const [phase, setPhase] = useState('form'); // form | busy | pipeline | done | failed
    const [error, setError] = useState(null);
    useAutoDismissError(error, setError);
    const [fromBrowser, setFromBrowser] = useState(false);
    // §8 浏览器候选不自动覆盖未提交草稿：有内容时先问用户（替换 / 保留）。
    const [candidate, setCandidate] = useState(null);

    const applyBrowserDraft = (d) => {
      setMode(d.captureMode || 'selection');
      setOriginUrl(d.originUrl || '');
      setTitle(d.title || '');
      setContent(d.contentMarkdown || '');
      setFromBrowser(true);
      setClip(null);
      setError(null);
      setPhase('form');
    };

    // 浏览器页签的交接草稿：预填表单后立刻交还，避免重复消费。
    // 已有未提交内容时挂起候选，由用户选择，不静默覆盖。
    useEffect(() => {
      if (!clipDraft) return;
      if (clipDraftEmpty({ mode, targetKb, originUrl, title, content, note, meta })) {
        applyBrowserDraft(clipDraft);
      } else {
        setCandidate(clipDraft);
      }
      if (onClipDraftConsumed) onClipDraftConsumed();
    }, [clipDraft]);

    // 草稿实时写桶：切页卸载后再回来从桶里水合。
    useEffect(() => {
      const d = { mode, targetKb, originUrl, title, content, note, meta };
      if (clipDraftEmpty(d)) CLIP_DRAFTS.delete(clipSessionKey);
      else CLIP_DRAFTS.set(clipSessionKey, d);
    }, [clipSessionKey, mode, targetKb, originUrl, title, content, note, meta]);

    // §2 库内导入入口：目标库预填当前库（草稿里已有目标时不覆盖用户选择）
    useEffect(() => {
      if (importKbId && !targetKb) setTargetKb(importKbId);
    }, [importKbId]);

    const norm = useMemo(() => normalizeUrl(originUrl), [originUrl]);
    const hash = useMemo(() => contentHash(content || title || norm.url), [content, title, norm.url]);
    // 查重预检（演示模式可查本机记录；http 模式由服务端在提交时裁决）
    const precheck = useMemo(
      () =>
        settings.mode === 'mock' && targetKb
          ? mockClipPrecheck(targetKb, norm.ok ? norm.url : '', hash, title)
          : null,
      [settings.mode, targetKb, norm.url, hash, title],
    );
    const metaCheck = useMemo(() => validateClipMeta(meta), [meta]);

    const clipId = clip && clip.id;
    const clipStatus = clip && clip.status;
    useEffect(() => {
      if (!clipId) return undefined;
      if (clipStatus !== 'queued' && clipStatus !== 'processing') return undefined;
      const id = setInterval(() => {
        const pull = settings.mode === 'mock' ? mockGetClip(clipId) : api.getClip(settings, clipId);
        pull
          .then((next) => {
            setClip(next);
            if (next.status === 'ready') setPhase('done');
            if (next.status === 'failed') setPhase('failed');
          })
          .catch(() => {
            /* 单次轮询失败不打断：下一拍再试；连续失败靠提交时的错误呈现 */
          });
      }, 700);
      return () => clearInterval(id);
    }, [clipId, clipStatus, settings.mode, baseOf(settings)]);

    const buildBody = () => ({
      captureMode: mode,
      targetKbId: targetKb,
      originUrl: mode === 'markdown' ? '' : originUrl.trim(),
      title: title.trim(),
      contentMarkdown: content,
      note,
      summary: '',
      engineeringMetadata: { ...meta },
      assetRefs: [],
      hostScopeRef: snap.activeSessionId || '',
    });

    const commit = async (candidate) => {
      const body = { expectedRevision: candidate.revision, idempotencyKey: candidate.dedupeKey };
      const next =
        settings.mode === 'mock'
          ? await mockCommitClip(candidate.id, body)
          : await api.commitClip(settings, candidate.id, body);
      setClip(next);
      if (next.status === 'failed') {
        setPhase('failed');
        setError(next.error ? { code: next.error.code, message: next.error.message } : null);
      } else if (next.status === 'ready') {
        setPhase('done');
      } else {
        setPhase('pipeline');
      }
      return next;
    };

    const submit = async () => {
      if (!targetKb) {
        setError({ code: 'SCOPE_REQUIRED', message: t('clip.needKb') });
        return;
      }
      if (mode === 'url' && !norm.ok) {
        setError({ code: 'INVALID_URL', message: text(t, 'clip.url.invalid', { reason: norm.reason }) });
        return;
      }
      if (mode !== 'url' && !content.trim()) {
        setError({ code: 'EMPTY_CONTENT', message: t('clip.needContent') });
        return;
      }
      setError(null);
      setPhase('busy');
      try {
        const created =
          settings.mode === 'mock' ? await mockCreateClip(buildBody()) : await api.createClip(settings, buildBody());
        setClip(created);
        // §8：提交成功即绑定提交时快照，草稿桶随之清空 —— 后续交接新内容不再被旧值挡住。
        CLIP_DRAFTS.delete(clipSessionKey);
        setOriginUrl('');
        setTitle('');
        setContent('');
        setNote('');
        setFromBrowser(false);
        await commit(created);
      } catch (err) {
        setError({ code: err.code, message: err.message, requestId: (err.extra && err.extra.requestId) || null });
        setPhase('failed');
      }
    };

    const retry = async () => {
      if (!clip) return;
      setError(null);
      setPhase('busy');
      try {
        await commit(clip);
      } catch (err) {
        setError({ code: err.code, message: err.message, requestId: (err.extra && err.extra.requestId) || null });
        setPhase('failed');
      }
    };

    const reset = () => {
      setClip(null);
      setPhase('form');
      setError(null);
      setFromBrowser(false);
      setContent('');
      setNote('');
      setTitle('');
    };

    const setMetaField = (key, value) => setMeta((prev) => ({ ...prev, [key]: value }));

    const MODES = [
      ['url', 'clip.mode.url', 'clip.mode.url.desc'],
      ['selection', 'clip.mode.selection', 'clip.mode.selection.desc'],
      ['markdown', 'clip.mode.markdown', 'clip.mode.markdown.desc'],
    ];
    if (fromBrowser || mode === 'browserDownload') {
      MODES.push(['browserDownload', 'clip.mode.browserDownload', 'clip.mode.browserDownload.desc']);
    }

    const stepStates = CLIP_STATE_ORDER.map((state) => {
      const idx = CLIP_STATE_ORDER.indexOf(clipStatus);
      const order = CLIP_STATE_ORDER.indexOf(state);
      return {
        state,
        label: t(`clip.step.${state}`),
        done: clipStatus && order < idx,
        now: clipStatus === state || (clipStatus === 'failed' && state === 'processing'),
      };
    });

    const outcomeLine = () => {
      if (!clip || clip.status !== 'ready') return null;
      if (clip.outcome === 'reuse') return text(t, 'clip.outcome.reuse', { v: clip.versionId });
      if (clip.outcome === 'new_version') {
        return text(t, 'clip.outcome.newVersion', { v: clip.versionId, p: clip.previousVersionId || '—' });
      }
      return t('clip.outcome.create');
    };

    /* ---- 表单态 ---- */
    if (phase === 'form' || phase === 'busy') {
      return h(
        'div',
        { className: 'sch-modbody' },
        error
          ? h(NoticeBridge, {
              notify,
              code: error.code || 'ERROR',
              message: error.message || '',
              requestId: error.requestId,
            })
          : null,
        candidate
          ? h(
              'div',
              { className: 'sch-alert', role: 'alert' },
              h(IconAlert),
              h(
                'div',
                null,
                h('b', null, t('clip.candidate.title')),
                h('div', { className: 'sch-alert-sub' }, t('clip.candidate.desc')),
                h(
                  'div',
                  { style: { display: 'flex', gap: 6, marginTop: 8 } },
                  h(
                    'button',
                    {
                      type: 'button',
                      className: 'sch-btn sm primary',
                      onClick: () => {
                        applyBrowserDraft(candidate);
                        setCandidate(null);
                      },
                    },
                    t('clip.candidate.replace'),
                  ),
                  h(
                    'button',
                    { type: 'button', className: 'sch-btn sm', onClick: () => setCandidate(null) },
                    t('clip.candidate.keep'),
                  ),
                ),
              ),
            )
          : null,
        fromBrowser && !candidate ? h('div', { className: 'sch-alert' }, h(IconCheck), h('span', null, t('clip.fromBrowser'))) : null,
        settings.mode !== 'mock'
          ? h('div', { className: 'sch-note warn' }, t('clip.httpNote'))
          : null,
        h(
          'div',
          { className: 'sch-clip-grid' },
          h(
            'div',
            { className: 'sch-clip-card' },
            h('div', { className: 'sch-section-title' }, t('clip.form')),
            h(
              'div',
              { className: 'sch-clip-modes', role: 'radiogroup', 'aria-label': t('clip.mode') },
              MODES.map(([id, labelKey]) =>
                h(
                  'button',
                  {
                    key: id,
                    type: 'button',
                    role: 'radio',
                    'aria-checked': mode === id,
                    className: cx('sch-scopechip', mode === id && 'on'),
                    onClick: () => setMode(id),
                  },
                  t(labelKey),
                ),
              ),
            ),
            h('div', { className: 'sch-section-meta', style: { marginTop: 6 } }, t(`clip.mode.${mode}.desc`)),
            h(
              'div',
              { className: 'sch-field' },
              h('label', null, t('clip.targetKb')),
              h(
                'select',
                {
                  className: 'sch-input',
                  value: targetKb,
                  onChange: (e) => setTargetKb(e.target.value),
                  'aria-label': t('clip.targetKb'),
                },
                h('option', { value: '' }, t('clip.targetKb.pick')),
                kbs.map((kb) => h('option', { key: kb.id, value: kb.id }, kb.name)),
              ),
            ),
            mode !== 'markdown'
              ? h(
                  'div',
                  { className: 'sch-field' },
                  h('label', null, t('clip.url')),
                  h('input', {
                    className: 'sch-input',
                    value: originUrl,
                    placeholder: 'https://…',
                    onChange: (e) => setOriginUrl(e.target.value),
                  }),
                  originUrl && !norm.ok
                    ? h('div', { className: 'sch-note warn' }, text(t, 'clip.url.invalid', { reason: norm.reason }))
                    : null,
                )
              : null,
            h(
              'div',
              { className: 'sch-field' },
              h('label', null, t('clip.title')),
              h('input', {
                className: 'sch-input',
                value: title,
                onChange: (e) => setTitle(e.target.value),
              }),
            ),
            mode !== 'url'
              ? h(
                  'div',
                  { className: 'sch-field' },
                  h('label', null, t('clip.content')),
                  h('textarea', {
                    className: 'sch-input sch-clip-ta',
                    value: content,
                    placeholder: t('clip.content.ph'),
                    onChange: (e) => setContent(e.target.value),
                  }),
                )
              : h('div', { className: 'sch-section-meta', style: { marginTop: 6 } }, t('clip.url.fetchNote')),
            h(
              'div',
              { className: 'sch-field' },
              h('label', null, t('clip.note')),
              h('textarea', {
                className: 'sch-input sch-clip-ta',
                style: { minHeight: 64 },
                value: note,
                placeholder: t('clip.note.ph'),
                onChange: (e) => setNote(e.target.value),
              }),
            ),
            h(
              'div',
              { className: 'sch-section-title', style: { marginTop: 16 } },
              t('clip.meta'),
              h('span', { className: 'sch-section-meta', style: { marginLeft: 8 } }, t('clip.meta.lifecycle.desc')),
            ),
            h('div', { className: 'sch-clip-meta' },
              h('div', { className: 'sch-field' }, h('label', null, t('clip.meta.part')),
                h('input', { className: 'sch-input', value: meta.partNumber, onChange: (e) => setMetaField('partNumber', e.target.value) })),
              h('div', { className: 'sch-field' }, h('label', null, t('clip.meta.drawing')),
                h('input', { className: 'sch-input', value: meta.drawingNumber, onChange: (e) => setMetaField('drawingNumber', e.target.value) })),
              h('div', { className: 'sch-field' }, h('label', null, t('clip.meta.rev')),
                h('input', { className: 'sch-input', value: meta.revision, placeholder: 'B2', onChange: (e) => setMetaField('revision', e.target.value) })),
              h('div', { className: 'sch-field' }, h('label', null, t('clip.meta.type')),
                h('select', { className: 'sch-input', value: meta.docType, onChange: (e) => setMetaField('docType', e.target.value) },
                  h('option', { value: '' }, '—'),
                  ['standard', 'drawing', 'report', 'process', 'vendor', 'other'].map((k) =>
                    h('option', { key: k, value: k }, t(`clip.meta.type.${k}`))),
                )),
              h('div', { className: 'sch-field' }, h('label', null, t('clip.meta.supplier')),
                h('input', { className: 'sch-input', value: meta.supplier, onChange: (e) => setMetaField('supplier', e.target.value) })),
            ),
            metaCheck.warnings.includes('REVISION_FORMAT')
              ? h('div', { className: 'sch-note warn' }, t('clip.meta.revWarn'))
              : null,
            metaCheck.warnings.includes('META_SPARSE')
              ? h('div', { className: 'sch-section-meta' }, t('clip.meta.sparse'))
              : null,
            h(
              'div',
              { style: { display: 'flex', gap: 8, marginTop: 16 } },
              h(
                'button',
                { type: 'button', className: 'sch-btn primary', disabled: phase === 'busy', onClick: submit },
                phase === 'busy' ? t('clip.submitting') : t('clip.submit'),
              ),
            ),
          ),
          h(
            'div',
            { className: 'sch-clip-card' },
            h('div', { className: 'sch-section-title' }, t('clip.preview')),
            h(
              'dl',
              { className: 'sch-kv' },
              h('dt', null, t('clip.check')),
              h(
                'dd',
                null,
                !targetKb
                  ? t('clip.needKb')
                  : precheck
                    ? precheck.decision.action === 'reuse'
                      ? text(t, 'clip.check.reuse', { v: precheck.decision.versionId })
                      : precheck.decision.action === 'new_version'
                        ? text(t, 'clip.check.newVersion', { v: precheck.decision.active ? precheck.decision.active.versionId : '—' })
                        : t('clip.check.create')
                    : t('clip.check.http'),
              ),
              h('dt', null, t('clip.check.key')),
              h('dd', { className: 'sch-mono', style: { wordBreak: 'break-all' } },
                `${targetKb || '—'}::${norm.ok ? norm.url : 'note'}::${hash.slice(0, 12)}…`),
              h('dt', null, t('clip.original')),
              h('dd', null, (content || '（URL 方式：提交后由服务端抓取正文）').slice(0, 160) || '—'),
              h('dt', null, t('clip.noteTag')),
              h('dd', null, note ? note.slice(0, 120) : '—'),
              h('dt', null, t('clip.meta.lifecycle')),
              h('dd', null, h(Badge, { tone: 'plain' }, 'unknown')),
              h('dt', null, t('clip.capturedAt')),
              h('dd', null, fmtDateTime(new Date().toISOString())),
            ),
            h('div', { className: 'sch-card-desc', style: { marginTop: 10 } }, t('clip.pipelineNote')),
          ),
        ),
      );
    }

    /* ---- 管线 / 结果态 ---- */
    return h(
      'div',
      { className: 'sch-modbody' },
      error
        ? h(NoticeBridge, {
            notify,
            code: error.code || 'ERROR',
            message: error.message || '',
            requestId: error.requestId,
          })
        : null,
      h(
        'div',
        { className: 'sch-clip-card' },
        h('div', { className: 'sch-section-title' }, clip ? clip.title || t('clip.pipeline') : t('clip.pipeline')),
        h(
          'div',
          { className: 'sch-steps' },
          stepStates.map((step, i) =>
            h(
              'span',
              { key: step.state, className: cx('sch-step', step.done && 'done', step.now && 'now') },
              h('span', { className: 'sch-step-dot' }),
              step.label,
              i < stepStates.length - 1 ? h('span', { className: 'sch-step-sep' }) : null,
            ),
          ),
        ),
        clip && clip.status === 'failed'
          ? h('div', { className: 'sch-note warn', style: { marginTop: 10 } }, t('clip.failed'))
          : null,
        clip && (clip.status === 'ready' || clip.status === 'failed')
          ? h(
              'div',
              { style: { display: 'flex', gap: 8, marginTop: 16 } },
              clip.status === 'failed'
                ? h('button', { type: 'button', className: 'sch-btn primary', onClick: retry }, t('clip.retry'))
                : null,
              h('button', { type: 'button', className: 'sch-btn', onClick: reset }, t('clip.again')),
            )
          : null,
      ),
      clip && (clip.status === 'ready' || clip.outcome)
        ? h(
            'div',
            { className: 'sch-clip-card', style: { marginTop: 16 } },
            h('div', { className: 'sch-section-title' }, t('clip.result')),
            h(
              'dl',
              { className: 'sch-kv' },
              h('dt', null, t('clip.outcome')),
              h('dd', null, h(Badge, { tone: clip.outcome === 'reuse' ? 'plain' : 'live' }, outcomeLine() || '—')),
              h('dt', null, t('clip.doc')),
              h('dd', { className: 'sch-mono' }, clip.documentId || '—'),
              h('dt', null, t('clip.version')),
              h('dd', { className: 'sch-mono' }, clip.versionId || '—'),
              clip.previousVersionId
                ? h('dt', null, t('clip.prevVersion'))
                : null,
              clip.previousVersionId ? h('dd', { className: 'sch-mono' }, clip.previousVersionId) : null,
              clip.originUrl ? h('dt', null, t('clip.origin')) : null,
              clip.originUrl ? h('dd', { className: 'sch-mono', style: { wordBreak: 'break-all' } }, clip.originUrl) : null,
              h('dt', null, t('clip.capturedAt')),
              h('dd', null, clip.capturedAt ? fmtDateTime(clip.capturedAt) : '—'),
              h('dt', null, t('clip.check.key')),
              h('dd', { className: 'sch-mono', style: { wordBreak: 'break-all' } }, clip.dedupeKey || '—'),
            ),
          )
        : null,
    );
  }

  /* --------------------------------------------- P2：BrowserSkill 协同 */

  /**
   * P2 浏览器协同页签。BrowserSkill 是技术组件（官方 DSH 插件 + bsk daemon +
   * 浏览器伴随扩展），业务入口仍是 DSH 面板。这里提供：连接状态、任务
   * （暂停/继续/取消/登录协助）、动态表格与下载结果预览、交接 P1 采集候选。
   * 任务按 DSH Session 隔离；取消后迟到结果丢弃不入库。
   * http 模式只探测桥状态 —— A 侧桥接端点未实现时如实说明，不模拟连接。
   */
  function BrowserView({ t, settings, snap, setClipDraft, onGotoTab, notify }) {
    const sessionId = snap.activeSessionId || '';
    const [conn, setConn] = useState({ phase: 'idle', status: '', browser: '', version: '', error: '' });
    const [tasks, setTasks] = useState([]);
    const [url, setUrl] = useState('');
    const [kind, setKind] = useState('table');
    const [error, setError] = useState(null);
    useAutoDismissError(error, setError);

    useEffect(() => {
      if (!isRemote(settings)) {
        setConn({ phase: 'mock', status: 'connected', browser: 'Edge', version: '0.4.1-demo', error: '' });
        return undefined;
      }
      let alive = true;
      setConn({ phase: 'loading', status: '', browser: '', version: '', error: '' });
      api
        .browserStatus(settings)
        .then((data) => {
          if (!alive) return;
          setConn({
            phase: 'done',
            status: data && data.connected !== false ? 'connected' : 'disconnected',
            browser: (data && data.browser) || '',
            version: (data && (data.bskVersion || data.version)) || '',
            error: '',
          });
        })
        .catch((err) => {
          if (!alive) return;
          setConn({
            phase: 'error',
            status: '',
            browser: '',
            version: '',
            error: err.code === 'NOT_IMPLEMENTED' ? '' : err.message || '',
          });
        });
      return () => {
        alive = false;
      };
    }, [settings.mode, baseOf(settings)]);

    // 演示运行时按 600ms 快照刷新；真实桥接由 A 侧实现后改为事件/轮询接口
    const refreshTasks = () => setTasks(mockBrowserTaskList(sessionId));
    useEffect(() => {
      refreshTasks();
      if (settings.mode !== 'mock') return undefined;
      const id = setInterval(refreshTasks, 600);
      return () => clearInterval(id);
    }, [settings.mode, sessionId]);

    const start = () => {
      const target = url.trim();
      if (!target) return;
      setError(null);
      if (settings.mode !== 'mock') {
        // 官方插件接入前不假装能驱动浏览器：如实报「桥接未实现」
        setError({ code: 'NOT_IMPLEMENTED', message: t('brow.notimpl') });
        return;
      }
      if (!sessionId) {
        setError({ code: 'NO_SESSION', message: t('brow.session.none') });
        return;
      }
      mockBrowserStart(sessionId, { kind, url: target });
      // 立刻刷新：不等下一拍轮询，否则新任务行（含取消按钮）有 600ms 空窗
      refreshTasks();
      setUrl('');
    };

    const sendToClip = (task) => {
      if (task.status !== 'done' || !task.result) return;
      setClipDraft({
        captureMode: task.kind === 'download' ? 'browserDownload' : 'selection',
        originUrl: task.url,
        title: task.kind === 'download' ? task.result.fileName : task.result.pageTitle,
        contentMarkdown: task.kind === 'download' ? '' : task.result.contentMarkdown,
        note: task.kind === 'download' ? t('clip.mode.browserDownload.desc') : '',
      });
      onGotoTab('clip');
    };

    const statusBadge = (task) => {
      const map = {
        running: ['live', 'brow.st.running'],
        paused: ['plain', 'brow.st.paused'],
        needsLogin: ['warn', 'brow.st.login'],
        done: ['live', 'brow.st.done'],
        cancelled: ['plain', 'brow.st.cancelled'],
        discarded: ['warn', 'brow.st.discarded'],
      };
      const hit = map[task.status] || ['plain', 'brow.st.running'];
      return h(Badge, { tone: hit[0] }, t(hit[1]));
    };

    return h(
      'div',
      { className: 'sch-modbody' },
      error
        ? h(NoticeBridge, { notify, code: error.code || 'ERROR', message: error.message || '' })
        : null,
      h(
        'div',
        { className: 'sch-clip-card' },
        h(
          'div',
          { className: 'sch-clip-modes', style: { justifyContent: 'space-between' } },
          h('div', { className: 'sch-section-title' }, t('brow.conn')),
          conn.phase === 'mock'
            ? h('span', null, h(Badge, { tone: 'live' }, text(t, 'brow.conn.ok', { browser: conn.browser, ver: conn.version })), ' ',
              h('span', { className: 'sch-section-meta' }, t('brow.conn.mock')))
            : conn.phase === 'loading'
              ? h(Badge, { tone: 'plain' }, t('brow.conn.loading'))
              : conn.phase === 'done'
                ? h(Badge, { tone: conn.status === 'connected' ? 'live' : 'plain' },
                    conn.status === 'connected'
                      ? text(t, 'brow.conn.ok', { browser: conn.browser || '—', ver: conn.version || '—' })
                      : t('brow.conn.off'))
                : conn.error
                  ? h(Badge, { tone: 'warn' }, t('brow.conn.unknown'))
                  : h(Badge, { tone: 'warn' }, t('brow.conn.unsupported')),
        ),
        isRemote(settings) && conn.phase === 'error' && !conn.error
          ? h('div', { className: 'sch-note warn', style: { marginTop: 8 } }, t('brow.conn.notimpl'))
          : null,
        h(
          'div',
          { className: 'sch-section-meta', style: { marginTop: 6 } },
          t('brow.session.isolated'),
          ' ',
          sessionId
            ? h('span', { className: 'sch-mono' }, sessionId)
            : h('span', { className: 'sch-note warn' }, t('brow.session.none')),
        ),
      ),
      h(
        'div',
        { className: 'sch-clip-card', style: { marginTop: 16 } },
        h('div', { className: 'sch-section-title' }, t('brow.new')),
        h(
          'div',
          { style: { display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 } },
          h('input', {
            className: 'sch-input',
            style: { flex: '1 1 260px' },
            value: url,
            placeholder: 'https://portal.supplier.example.com/spec?part=A123',
            onChange: (e) => setUrl(e.target.value),
            onKeyDown: (e) => {
              if (e.key === 'Enter') start();
            },
          }),
          h(
            'select',
            {
              className: 'sch-input',
              value: kind,
              onChange: (e) => setKind(e.target.value),
              'aria-label': t('brow.task.type'),
            },
            h('option', { value: 'table' }, t('brow.task.table')),
            h('option', { value: 'download' }, t('brow.task.download')),
          ),
          h('button', { type: 'button', className: 'sch-btn primary', onClick: start }, t('brow.run')),
        ),
        h('div', { className: 'sch-section-meta', style: { marginTop: 6 } }, t('brow.login.hint')),
      ),
      h(
        'div',
        { className: 'sch-clip-card', style: { marginTop: 16 } },
        h('div', { className: 'sch-section-title' }, t('brow.tasks')),
        h('div', { className: 'sch-section-meta' }, t('brow.note')),
        tasks.length === 0
          ? h('div', { className: 'sch-empty-inline', style: { marginTop: 10 } }, t('brow.none'))
          : h(
              'div',
              { style: { marginTop: 10 } },
              tasks.map((task) =>
                h(
                  'div',
                  { key: task.id, className: 'sch-brow-task' },
                  h(
                    'div',
                    { className: 'sch-clip-modes', style: { justifyContent: 'space-between' } },
                    h(
                      'span',
                      { style: { display: 'flex', gap: 8, alignItems: 'center', minWidth: 0 } },
                      h(Badge, { tone: task.kind === 'download' ? 'plain' : 'live' }, t(task.kind === 'download' ? 'brow.task.download' : 'brow.task.table')),
                      h('span', { className: 'sch-mono', style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, task.url),
                    ),
                    statusBadge(task),
                  ),
                  task.status === 'running' || task.status === 'needsLogin' || task.status === 'paused'
                    ? h('div', { className: 'sch-progress' }, h('div', { className: 'sch-progress-bar', style: { width: `${task.progress}%` } }))
                    : null,
                  task.status === 'needsLogin'
                    ? h('div', { className: 'sch-note warn', style: { marginTop: 8 } }, t('brow.login.need'))
                    : null,
                  task.status === 'discarded'
                    ? h('div', { className: 'sch-note warn', style: { marginTop: 8 } }, t('brow.discard.note'))
                    : null,
                  task.result && task.status === 'done'
                    ? h(
                        'div',
                        { className: 'sch-brow-result', style: { marginTop: 8 } },
                        task.kind === 'download'
                          ? h('div', { className: 'sch-section-meta' }, h(IconCheck), ' ', text(t, 'brow.verify.ok', {
                              name: task.result.fileName,
                              size: `${(task.result.sizeBytes / 1024).toFixed(0)} KB`,
                            }), h('span', { className: 'sch-mono' }, ` · sha256:${task.result.sha256.slice(0, 16)}…`))
                          : h('pre', { className: 'sch-pre', style: { margin: '6px 0 0' } }, task.result.contentMarkdown),
                      )
                    : null,
                  h(
                    'div',
                    { className: 'sch-brow-acts' },
                    task.status === 'running' || task.status === 'needsLogin'
                      ? h('button', { type: 'button', className: 'sch-btn', onClick: () => { mockBrowserPause(task.id); refreshTasks(); } }, t('brow.pause'))
                      : null,
                    task.status === 'paused'
                      ? h('button', { type: 'button', className: 'sch-btn', onClick: () => { mockBrowserResume(task.id); refreshTasks(); } }, t('brow.resume'))
                      : null,
                    task.status === 'needsLogin'
                      ? h('button', { type: 'button', className: 'sch-btn primary', onClick: () => { mockBrowserConfirmLogin(task.id); refreshTasks(); } }, t('brow.login.done'))
                      : null,
                    task.status === 'running' || task.status === 'paused' || task.status === 'needsLogin'
                      ? h('button', { type: 'button', className: 'sch-btn', onClick: () => { mockBrowserCancel(task.id); refreshTasks(); } }, t('brow.cancel'))
                      : null,
                    task.status === 'done'
                      ? h('button', { type: 'button', className: 'sch-btn primary', onClick: () => sendToClip(task) }, t('brow.send'))
                      : null,
                  ),
                ),
              ),
            ),
      ),
    );
  }

  /* --------------------------------------------- P4：批量导入（Skill 工作流） */

  /**
   * P4 批量导入：把多份 Markdown 工程笔记整理入库（对应 WeKnora ClawHub
   * Skill 的工作流程，改为 Schanora 客户端工作流）。逐项幂等：成功项落
   * localStorage 键集，续跑自动跳过；演示批次自带一份「失败一次」的笔记
   * 验证重试与不重复导入（T11）。
   */
  function BatchView({ t, settings, kbs, onToast, importKbId }) {
    const [items, setItems] = useState([]);
    const [titleDraft, setTitleDraft] = useState('');
    const [contentDraft, setContentDraft] = useState('');
    const [targetKb, setTargetKb] = useState('');
    const [running, setRunning] = useState(false);
    const [report, setReport] = useState(null);
    const fileRef = useRef(null);

    const docType = 'notes';

    // §2 库内导入入口：目标库预填当前库
    useEffect(() => {
      if (importKbId && !targetKb) setTargetKb(importKbId);
    }, [importKbId]);

    const doneKeys = () => mockStoreRead(MOCK_BATCH_DONE_KEY, []);

    const keyOf = (item) => {
      const hash = contentHash(item.content);
      return dedupeKey(item.kbId || targetKb, '', hash);
    };

    const addDraft = () => {
      const title = titleDraft.trim();
      const content = contentDraft.trim();
      if (!title || !content) return;
      setItems((prev) =>
        prev.concat([{ id: `bi-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, title, content, status: 'queued', kbId: targetKb, documentId: '', error: '' }]),
      );
      setTitleDraft('');
      setContentDraft('');
    };

    const loadDemoBatch = () => {
      const demo = [
        {
          title: '装配力矩笔记（SC 系列）',
          content: 'M10 8.8 级螺栓规定力矩 49 N·m，分两次对角拧紧。\n来源：装配工艺卡 P-2026-018。',
        },
        {
          title: '密封件选型笔记',
          content: '工作温度 -40~120 ℃ 选用氟橡胶；低于 -40 ℃ 改用硅橡胶。\n来源：供应商试验报告 2026Q3。',
        },
        {
          // 演示失败注入：第一次提交失败（同一幂等键重试成功）
          title: '现场故障速记（会失败一次）',
          content: '客户现场 SC-1024 连接器温升异常。\n处理：更换端子并复测压降。[[FAIL_ONCE]]',
        },
      ];
      setItems((prev) =>
        prev.concat(
          demo.map((d, i) => ({ id: `bi-demo-${Date.now()}-${i}`, title: d.title, content: d.content, status: 'queued', kbId: targetKb, documentId: '', error: '' })),
        ),
      );
    };

    const onFiles = (e) => {
      const files = Array.from((e.target && e.target.files) || []);
      files.forEach((file) => {
        const reader = new FileReader();
        reader.onload = () => {
          const text = String(reader.result || '');
          setItems((prev) =>
            prev.concat([
              {
                id: `bi-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                title: file.name.replace(/\.md$/i, ''),
                content: text,
                status: 'queued',
                kbId: targetKb,
                documentId: '',
                error: '',
              },
            ]),
          );
        };
        reader.readAsText(file);
      });
      e.target.value = '';
    };

    const patchItem = (id, patch) =>
      setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)));

    const importOne = async (item) => {
      const key = keyOf(item);
      const body = {
        captureMode: 'markdown',
        targetKbId: item.kbId || targetKb,
        originUrl: '',
        title: item.title,
        contentMarkdown: item.content,
        note: '',
        engineeringMetadata: { docType },
        assetRefs: [],
      };
      const created = settings.mode === 'mock' ? await mockCreateClip(body) : await api.createClip(settings, body);
      const committed =
        settings.mode === 'mock'
          ? await mockCommitClip(created.id, { expectedRevision: created.revision, idempotencyKey: created.dedupeKey })
          : await api.commitClip(settings, created.id, { expectedRevision: created.revision, idempotencyKey: created.dedupeKey });
      if (committed.status === 'ready') {
        const done = new Set(doneKeys());
        done.add(key);
        mockStoreWrite(MOCK_BATCH_DONE_KEY, Array.from(done));
        return { status: 'done', documentId: committed.documentId, versionId: committed.versionId, outcome: committed.outcome, key };
      }
      if (committed.status === 'failed') {
        throw new ApiError(
          (committed.error && committed.error.code) || 'INGEST_FAILED',
          (committed.error && committed.error.message) || 'ingest failed',
          {},
        );
      }
      // queued/processing：演示管线 700ms 一拍，等它到终态
      return new Promise((resolve, reject) => {
        const poll = async (tries) => {
          const next = settings.mode === 'mock' ? await mockGetClip(created.id) : await api.getClip(settings, created.id);
          if (next.status === 'ready') {
            const done = new Set(doneKeys());
            done.add(key);
            mockStoreWrite(MOCK_BATCH_DONE_KEY, Array.from(done));
            resolve({ status: 'done', documentId: next.documentId, versionId: next.versionId, outcome: next.outcome, key });
            return;
          }
          if (next.status === 'failed') {
            reject(new ApiError((next.error && next.error.code) || 'INGEST_FAILED', (next.error && next.error.message) || 'ingest failed', {}));
            return;
          }
          if (tries > 20) {
            reject(new ApiError('TIMEOUT', '处理超时：稍后用「重试失败项」续跑', {}));
            return;
          }
          setTimeout(() => poll(tries + 1), 500);
        };
        poll(0);
      });
    };

    const runImport = async (onlyFailed) => {
      if (!targetKb) {
        onToast && onToast({ tone: 'err', text: t('clip.needKb') });
        return;
      }
      const done = new Set(doneKeys());
      const targets = items.filter((it) => {
        if (onlyFailed) return it.status === 'failed';
        return it.status === 'queued' || it.status === 'failed';
      });
      if (!targets.length) return;
      setRunning(true);
      setReport(null);
      let ok = 0;
      let fail = 0;
      let skip = 0;
      // 逐项顺序导入：失败不中断后续项（批次幂等、失败续跑是验收点）
      for (const item of targets) {
        const key = keyOf(item);
        if (!onlyFailed && done.has(key)) {
          skip += 1;
          patchItem(item.id, { status: 'skipped' });
          continue;
        }
        patchItem(item.id, { status: 'running', error: '' });
        try {
          // eslint-disable-next-line no-await-in-loop
          const result = await importOne(item);
          ok += 1;
          patchItem(item.id, { status: 'done', documentId: result.documentId, versionId: result.versionId, outcome: result.outcome });
        } catch (err) {
          fail += 1;
          patchItem(item.id, { status: 'failed', error: err.message || String(err) });
        }
      }
      setRunning(false);
      setReport({ ok, fail, skip });
    };

    const removeItem = (id) => setItems((prev) => prev.filter((it) => it.id !== id));

    const statusBadge = (item) => {
      const map = {
        queued: ['plain', 'batch.st.queued'],
        running: ['live', 'batch.st.running'],
        done: ['live', 'batch.st.done'],
        failed: ['warn', 'batch.st.failed'],
        skipped: ['plain', 'batch.st.skipped'],
      };
      const hit = map[item.status] || map.queued;
      return h(Badge, { tone: hit[0] }, t(hit[1]));
    };

    return h(
      'div',
      { className: 'sch-modbody' },
      h(
        'div',
        { className: 'sch-clip-card' },
        h('div', { className: 'sch-section-title' }, t('mod.batch')),
        h('div', { className: 'sch-section-meta' }, t('batch.hint')),
        h(
          'div',
          { style: { display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12, alignItems: 'center' } },
          h(
            'select',
            {
              className: 'sch-input',
              value: targetKb,
              onChange: (e) => {
                const kb = e.target.value;
                setTargetKb(kb);
                setItems((prev) => prev.map((it) => ({ ...it, kbId: kb })));
              },
              'aria-label': t('batch.target'),
            },
            h('option', { value: '' }, t('clip.targetKb.pick')),
            kbs.map((kb) => h('option', { key: kb.id, value: kb.id }, kb.name)),
          ),
          h('button', { type: 'button', className: 'sch-btn', onClick: loadDemoBatch }, t('batch.demo')),
          h('button', { type: 'button', className: 'sch-btn', onClick: () => fileRef.current && fileRef.current.click() }, t('batch.file')),
          h('input', { ref: fileRef, type: 'file', accept: '.md,.markdown,.txt', multiple: true, style: { display: 'none' }, onChange: onFiles }),
        ),
        h(
          'div',
          { className: 'sch-clip-grid', style: { marginTop: 12, gridTemplateColumns: 'minmax(0,1fr)' } },
          h(
            'div',
            { className: 'sch-field', style: { marginTop: 0 } },
            h('label', null, `${t('batch.add')} · ${t('clip.title')}`),
            h('input', { className: 'sch-input', value: titleDraft, placeholder: t('batch.add.ph'), onChange: (e) => setTitleDraft(e.target.value) }),
          ),
          h(
            'div',
            { className: 'sch-field' },
            h('label', null, t('clip.content')),
            h('textarea', { className: 'sch-input sch-clip-ta', value: contentDraft, placeholder: t('clip.content.ph'), onChange: (e) => setContentDraft(e.target.value) }),
          ),
          h('div', null, h('button', { type: 'button', className: 'sch-btn', onClick: addDraft }, `+ ${t('batch.add')}`)),
        ),
      ),
      items.length
        ? h(
            'div',
            { className: 'sch-clip-card', style: { marginTop: 16 } },
            h(
              'div',
              { className: 'sch-clip-modes', style: { justifyContent: 'space-between' } },
              h('div', { className: 'sch-section-title' }, `${t('batch.list')} · ${items.length}`),
              h(
                'div',
                { style: { display: 'flex', gap: 8 } },
                h(
                  'button',
                  { type: 'button', className: 'sch-btn primary', disabled: running || !targetKb, onClick: () => runImport(false) },
                  running ? t('batch.st.running') : t('batch.start'),
                ),
                items.some((it) => it.status === 'failed')
                  ? h('button', { type: 'button', className: 'sch-btn', disabled: running, onClick: () => runImport(true) }, t('batch.retry'))
                  : null,
              ),
            ),
            h(
              'div',
              { style: { marginTop: 8 } },
              items.map((item) =>
                h(
                  'div',
                  { key: item.id, className: 'sch-batch-row' },
                  statusBadge(item),
                  h(
                    'div',
                    { style: { flex: '1 1 auto', minWidth: 0 } },
                    h('div', { className: 'sch-setrow-title' }, item.title),
                    item.documentId
                      ? h('div', { className: 'sch-section-meta sch-mono' }, `${item.documentId}${item.versionId ? ` · ${item.versionId}` : ''}`)
                      : null,
                    item.error ? h('div', { className: 'sch-note warn' }, item.error) : null,
                  ),
                  item.status === 'queued'
                    ? h('button', { type: 'button', className: 'sch-btn icon', title: t('batch.remove'), onClick: () => removeItem(item.id), 'aria-label': t('batch.remove') }, h(IconX))
                    : null,
                ),
              ),
            ),
            report
              ? h(
                  'div',
                  { className: 'sch-alert', style: { marginTop: 12 } },
                  h(IconCheck),
                  h('div', null,
                    h('b', null, t('batch.report')),
                    h('div', { className: 'sch-alert-sub' }, text(t, 'batch.report.line', { ok: report.ok, fail: report.fail, skip: report.skip })),
                  ),
                )
              : null,
          )
        : h('div', { className: 'sch-empty-inline', style: { marginTop: 12 } }, t('batch.empty')),
    );
  }

  /**
   * 浮层警示（2026-11-17 用户反馈：全站统一、弹出式、点叉收回）。
   *
   * 以前每个视图各自画一块满宽 `sch-alert.err`：一报错就把整页内容顶下去，样式还各不相同
   * （有的带大按钮、有的两行、有的只有一行）。现在由 Panel 统一持有通知队列，渲染成贴在
   * 面板顶部、浮在内容之上的胶囊：
   *   · 不占布局 —— 出现和消失都不移动任何内容；
   *   · 可堆叠（最多 3 条），每条一个 ×，点掉就收回；NOTICE_MS 后也会自己消失；
   *   · 视觉只有一种：图标 + 错误码 + 单行消息（超长省略），需要时带一个文字操作。
   *
   * 视图侧只需要 `h(NoticeBridge, {...})`：把本地 error state 推给面板，自己不画任何节点。
   */
  function NoticeStack({ items, onClose }) {
    if (!items.length) return null;
    return h(
      'div',
      { className: 'sch-noticestack', role: 'status', 'aria-live': 'polite' },
      ...items.map((n) =>
        h(
          'div',
          { key: n.id, className: cx('sch-notice', n.tone === 'warn' && 'warn', n.tone === 'ok' && 'ok'), title: [n.code, n.message].filter(Boolean).join(' · ') },
          n.tone === 'ok' ? h(IconCheck) : h(IconAlert),
          h(
            'div',
            { className: 'sch-notice-main' },
            n.code ? h('b', null, n.code) : null,
            n.message ? h('span', { className: 'sch-notice-msg' }, n.message) : null,
          ),
          n.action
            ? h('button', { type: 'button', className: 'sch-notice-btn', onClick: n.action.onClick }, n.action.label)
            : null,
          h(
            'button',
            { type: 'button', className: 'sch-notice-x', onClick: () => onClose(n.id), 'aria-label': 'close' },
            h(IconX),
          ),
        ),
      ),
    );
  }

  /** 把视图里的 error state 转成一条浮层警示：自身不渲染节点，只在 code/message 变化时推一次。 */
  function NoticeBridge({ notify, code, message, requestId, action }) {
    const sig = [code || '', message || '', requestId || ''].join('|');
    useEffect(() => {
      if (!code && !message) return;
      notify({ tone: 'err', code, message, requestId, action });
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [sig]);
    return null;
  }

  function Panel({ t, store, setSettings }) {
    const snap = useStore(store);
    const settings = snap.settings || DEFAULT_SETTINGS;
    const [pop, setPop] = useState(null); // 'settings' | 'diag' | 'plugins' | 'import' | null
    const [toast, setToast] = useState(null); // {tone:'ok'|'err', text}
    const loading = snap.phase === 'loading';
    const rootRef = useRef(null);

    /* 全站统一的浮层警示队列：视图通过 mountCtx.notify 推，面板负责计时、去重、渲染。 */
    const [notices, setNotices] = useState([]);
    const noticeList = useRef([]);
    const noticeSeq = useRef(0);
    const noticeTimers = useRef(new Map());

    const dismissNotice = useCallback((id) => {
      noticeList.current = noticeList.current.filter((n) => n.id !== id);
      setNotices(noticeList.current);
      const timer = noticeTimers.current.get(id);
      if (timer) clearTimeout(timer);
      noticeTimers.current.delete(id);
    }, []);

    const notify = useCallback(
      (n) => {
        const code = n.code || '';
        const message = n.message || '';
        const key = `${code}|${message}`;
        // 同一条重复推送（轮询 / 重渲染）只保留一条，避免刷屏
        if (noticeList.current.some((item) => item.key === key)) return;
        const id = noticeSeq.current + 1;
        noticeSeq.current = id;
        const item = { id, key, tone: n.tone || 'err', code, message, action: n.action || null };
        // 最多同时 3 条，超出丢最早的
        noticeList.current = [...noticeList.current, item].slice(-3);
        setNotices(noticeList.current);
        const timer = setTimeout(() => dismissNotice(id), NOTICE_MS);
        noticeTimers.current.set(id, timer);
      },
      [dismissNotice],
    );

    // 卸载时清掉计时器，避免对已卸载组件 setState
    useEffect(
      () => () => {
        noticeTimers.current.forEach((timer) => clearTimeout(timer));
        noticeTimers.current.clear();
      },
      [],
    );

    /* DSH 对接（第一层，不依赖私有接口）：宿主对话里划选一段文字 → 面板里可以直接引用提问。
       插件与 DSH 会话在同一个 document 里，selectionchange 能拿到跨面板的选区；
       只排除「选区就在本插件面板内」的情况，避免自己引用自己。 */
    const [hostQuote, setHostQuote] = useState(null);
    useEffect(() => {
      const onSelectionChange = () => {
        const sel = window.getSelection();
        if (!sel || sel.isCollapsed) return;
        const text = String(sel).trim();
        if (text.length < 2) return;
        const anchor = sel.anchorNode;
        if (rootRef.current && anchor && rootRef.current.contains(anchor.nodeType === 1 ? anchor : anchor.parentNode)) {
          return; // 面板内的选区不算「宿主对话引用」
        }
        setHostQuote({ text: text.slice(0, 4000), chars: text.length });
      };
      document.addEventListener('selectionchange', onSelectionChange);
      return () => document.removeEventListener('selectionchange', onSelectionChange);
    }, []);

    // 网关级错误也走同一条通道：统一成同一种浮层，不再在内容顶部插块
    useEffect(() => {
      if (snap.phase !== 'error') return;
      notify({
        code: snap.error?.code || 'ERROR',
        message: snap.error?.message || '',
        action: { label: t('kbs.retry'), onClick: () => store.refresh() },
      });
    }, [snap.phase, snap.error?.code, snap.error?.message, notify, store, t]);

    useEffect(() => {
      if (snap.health?.status !== 'degraded') return;
      notify({ tone: 'warn', code: t('status.degraded'), message: t('status.degraded.desc') });
    }, [snap.health?.status, notify, t]);

    const modules = useModules();
    const modById = useMemo(() => {
      const map = new Map();
      modules.forEach((mod) => map.set(mod.id, mod));
      return map;
    }, [modules]);

    // §2 导航重组：顶栏只保留三个主入口（知识库 / 检索 / 问答）+ 设置。
    // 旧页签全部收进库内：文档是库的默认视图，Wiki 与四种导入是库内子视图，
    // 插件与诊断收进设置。模块注册表原样保留，供系统跳转与模块清单用。
    const [nav, setNav] = useState({ view: 'kb', kbId: null }); // view: kb | search | qa
    const [subView, setSubView] = useState('docs'); // docs | wiki | clip | browser | batch
    const inWorkspace = nav.view === 'kb' && Boolean(nav.kbId);

    const NAV_ENTRIES = [
      { id: 'kb', key: 'nav.kb', icon: IconBook },
      { id: 'search', key: 'nav.search', icon: IconSearch },
      { id: 'qa', key: 'nav.qa', icon: IconChat },
    ];
    const renderTab = (entry) => {
      const on = nav.view === entry.id || (entry.id === 'kb' && inWorkspace);
      return h(
        'button',
        {
          key: entry.id,
          type: 'button',
          role: 'tab',
          'aria-selected': on,
          title: t(entry.key),
          className: cx('sch-tab', on ? 'on' : ''),
          onClick: () => setNav({ view: entry.id, kbId: entry.id === 'kb' ? nav.kbId : null }),
        },
        h('span', { className: 'sch-tab-icon' }, h(entry.icon)),
        h('span', { className: 'sch-tab-label' }, t(entry.key)),
      );
    };

    // 库内子视图 → 模块 id（clip / browser / batch / docs / wiki 与模块注册表一一对应）
    const SUB_IDS = { docs: 'docs', wiki: 'wiki', clip: 'clip', browser: 'browser', batch: 'batch' };
    const active = inWorkspace
      ? modById.get(SUB_IDS[subView] || 'docs') || null
      : modById.get(nav.view) || null;

    // P1/P2 交接：浏览器页签把采集候选草稿送到采集子视图（预填后立即消费）
    const [clipDraft, setClipDraft] = useState(null);

    const kbs = useMemo(
      () => (snap.kbs && Array.isArray(snap.kbs.items) ? snap.kbs.items.map(normalizeKb).filter(Boolean) : []),
      [snap.kbs],
    );
    // 当前工作区库对象（子导航显示用；必须晚于 kbs 声明，否则 TDZ 报错）
    const wsKb = kbs.find((x) => x.id === nav.kbId) || null;

    // 提示条 5s 自动消失
    useEffect(() => {
      if (!toast) return undefined;
      const id = setTimeout(() => setToast(null), 5200);
      return () => clearTimeout(id);
    }, [toast]);

    /** 面板贴合可视高度。
     *
     *  宿主把插件挂进 main 槽时，那一层往往没有确定高度（height:100% 解不出来），
     *  面板就按内容长高，整页跟着滚 —— 问答页的输入框也就会跟着滚走。
     *  这里量一次「面板顶边到窗口底边」的距离写成 CSS 变量，让面板正好等于可视区，
     *  滚动随之收敛到 .sch-content 内部。
     *  用文档坐标（rect.top + scrollY）而不是视口坐标：页面滚动时值不变，
     *  不会「量一次 → 布局变 → 再量」地来回抖。
     */
    useLayoutEffect(() => {
      const el = rootRef.current;
      if (!el) return undefined;
      let raf = 0;
      const measure = () => {
        raf = 0;
        const rect = el.getBoundingClientRect();
        if (!rect.height && !rect.top) return;
        // 下边界：优先用最近的可滚动祖先（宿主可能在底部还有状态栏），退回去才用视口
        let limit = window.innerHeight || 0;
        let node = el.parentElement;
        while (node && node !== document.body && node !== document.documentElement) {
          const cs = window.getComputedStyle(node);
          if (/(auto|scroll|hidden|clip)/.test(cs.overflowY)) {
            limit = Math.min(limit, node.getBoundingClientRect().bottom);
            break;
          }
          node = node.parentElement;
        }
        const avail = Math.max(320, Math.round(limit - rect.top - 2));
        el.style.setProperty('--sch-panel-h', `${avail}px`);
      };
      const schedule = () => {
        if (!raf) raf = requestAnimationFrame(measure);
      };
      measure();
      window.addEventListener('resize', schedule);
      const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(schedule) : null;
      if (ro) ro.observe(document.documentElement);
      return () => {
        if (raf) cancelAnimationFrame(raf);
        window.removeEventListener('resize', schedule);
        if (ro) ro.disconnect();
      };
    }, []);

    // 弹层：点空白处或按 Esc 关掉。只点外部才关，弹层内部的点击不处理。
    useEffect(() => {
      if (!pop) return undefined;
      const onDown = (e) => {
        const node = e.target;
        if (!(node instanceof Node)) return;
        // 抽屉是 fixed 的、挂在根节点下，不算「外部」；它自己处理关闭
        if (node.nodeType === 1 && node.closest && node.closest('.sch-drawer')) return;
        // 库内子导航（含导入菜单）与顶栏动作区一样，内部点击不关弹层
        if (node.nodeType === 1 && node.closest && node.closest('.sch-kbsub')) return;
        const host = rootRef.current && rootRef.current.querySelector('.sch-main-actions');
        if (host && host.contains(node)) return;
        setPop(null);
      };
      const onKey = (e) => {
        if (e.key === 'Escape') setPop(null);
      };
      document.addEventListener('pointerdown', onDown, true);
      window.addEventListener('keydown', onKey);
      return () => {
        document.removeEventListener('pointerdown', onDown, true);
        window.removeEventListener('keydown', onKey);
      };
    }, [pop]);

    const onKbCreated = (kb) => {
      setToast({ tone: 'ok', text: text(t, 'kbForm.created', { name: kb.name }) });
      store.refresh();
    };

    const mountCtx = {
      t,
      snap,
      settings,
      kbs,
      loading,
      kbId: nav.kbId,
      importKbId: nav.kbId,
      hideBack: true,
      onOpenKb: (kb) => {
        setSubView('docs');
        setNav({ view: 'kb', kbId: kb.id });
      },
      onCreated: onKbCreated,
      onToast: setToast,
      onPickKb: (id) => setNav({ view: 'kb', kbId: id }),
      onGotoKb: () => setNav({ view: 'kb', kbId: null }),
      // P1/P2/P4 插件的交接通道：浏览器任务结果 → 采集草稿 → 库内采集子视图
      clipDraft,
      setClipDraft,
      onClipDraftConsumed: () => setClipDraft(null),
      onGotoTab: (id) => setSubView(id),
      // 插件中心改开关时直接落盘，不必再回设置页保存
      onSettings: setSettings,
      // 范围同步：面板内选库要同步到 Session 头部徽标（同一份事实）
      store,
      // 统一浮层警示：视图把本地 error 推上来，由面板负责渲染与自动收起
      notify,
      // DSH 对话选区：在宿主对话里划选文字后，问答页可以直接引用成提问
      hostQuote,
      onQuoteUsed: () => {
        // 清掉宿主选区，否则点击按钮后 selectionchange 会把刚消掉的引用又填回来
        try {
          window.getSelection().removeAllRanges();
        } catch (_e) {
          /* 老浏览器无 removeAllRanges 时忽略 */
        }
        setHostQuote(null);
      },
    };

    return h(
      'div',
      {
        className: 'sch-root sch-tokens',
        ref: rootRef,
      },
      h(
        'div',
        { className: 'sch-panel' },
        // 顶栏：品牌 + 三个主入口（知识库 / 检索 / 问答）+ 连接区与设置。
        // 导入、Wiki 收进库内子视图；插件与诊断收进设置 —— 顶栏不再放低频入口。
        h(
          'div',
          { className: 'sch-top' },
          h(
            'span',
            { className: 'sch-top-brand', title: t('panel.title') },
            ASSETS.wordmark
              ? h('img', { className: 'sch-top-glyph', src: ASSETS.wordmark, alt: 'SCHANORA', draggable: false })
              : h('span', { className: 'sch-top-fallback' }, 'S'),
          ),
          h(
            'div',
            { className: 'sch-tabs', role: 'tablist', 'aria-orientation': 'horizontal' },
            ...NAV_ENTRIES.map(renderTab),
          ),
          h(
            'div',
            { className: 'sch-main-actions', style: { position: 'relative' } },
            // 连接区即刷新入口：点状态徽标重新拉取（§2-6 刷新移到连接区）
            h(
              'button',
              {
                type: 'button',
                className: 'sch-source',
                title: t('panel.refresh'),
                'aria-label': t('panel.refresh'),
                onClick: () => store.refresh(),
                disabled: loading,
              },
              h(StatusDot, { tone: loading ? 'busy' : settings.mode === 'mock' ? '' : 'ok' }),
              sourceLabel(t, settings.mode),
            ),
            // 设置是常驻入口：插件中心与诊断作为功能区域收在设置抽屉里
            h(
              'button',
              {
                type: 'button',
                className: 'sch-btn',
                title: t('panel.settings'),
                'aria-label': t('panel.settings'),
                'aria-expanded': pop === 'settings',
                onClick: () => setPop(pop === 'settings' ? null : 'settings'),
              },
              h(IconSliders),
              h('span', { className: 'sch-btn-label' }, t('panel.settings')),
            ),
          ),
        ),
        // 浮层警示栈：绝对定位在顶栏下方，浮在内容之上，不参与布局
        h(NoticeStack, { items: notices, onClose: dismissNotice }),
        h(
          'div',
          { className: 'sch-main' },
          // 库内工作区：子导航（文档 / Wiki / 导入资料）+ 返回库列表。
          // 顶层（库列表 / 检索 / 问答）仍显示模块描述作页提示。
          inWorkspace
            ? h(
                'div',
                { className: 'sch-kbsub' },
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'sch-kbsub-back',
                    onClick: () => setNav({ view: 'kb', kbId: null }),
                  },
                  h(IconBack),
                  h('span', null, t('nav.back')),
                ),
                h('span', { className: 'sch-kbsub-name', title: wsKb ? wsKb.name : '' }, wsKb ? wsKb.name : '—'),
                h('span', { className: 'sch-toolbar-spacer' }),
                h(
                  'div',
                  { className: 'sch-kbsub-tabs', role: 'tablist', 'aria-label': t('panel.title') },
                  [['docs', 'nav.sub.docs'], ['wiki', 'nav.sub.wiki']].map(([id, key]) =>
                    h(
                      'button',
                      {
                        key: id,
                        type: 'button',
                        role: 'tab',
                        'aria-selected': subView === id,
                        className: cx('sch-tabbtn', subView === id && 'on'),
                        onClick: () => setSubView(id),
                      },
                      t(key),
                    ),
                  ),
                ),
                h(
                  'span',
                  { style: { position: 'relative' } },
                  h(
                    'button',
                    {
                      type: 'button',
                      className: cx('sch-tabbtn', subView !== 'docs' && subView !== 'wiki' && 'on'),
                      'aria-expanded': pop === 'import',
                      'aria-haspopup': 'menu',
                      onClick: () => setPop(pop === 'import' ? null : 'import'),
                    },
                    t('nav.import'),
                  ),
                  pop === 'import'
                    ? h(
                        'div',
                        { className: 'sch-pop sch-popmenu sch-pop-import' },
                        // 四种导入一次点达：上传回文档视图，其余进入库内子视图
                        [
                          ['docs', 'nav.import.upload', IconClip],
                          ['clip', 'nav.import.clip', IconGlobe],
                          ['browser', 'nav.import.browser', IconGlobe],
                          ['batch', 'nav.import.batch', IconLayers],
                        ].filter(([id]) => !WEKNORA || id === 'docs').map(([id, key, Icon]) =>
                          h(
                            'button',
                            {
                              key,
                              type: 'button',
                              onClick: () => {
                                setSubView(id);
                                setPop(null);
                              },
                            },
                            h(Icon),
                            h('span', null, t(key)),
                          ),
                        ),
                      )
                    : null,
                ),
              )
            : h(
                'div',
                { className: 'sch-pagehint' },
                // 标题与选中页签重复，只留模块描述（当前位置由页签栏表达）
                h('span', null, active ? t(active.desc || 'panel.subtitle') : t('panel.subtitle')),
              ),
          h(
            'div',
            { className: 'sch-content' },

        // 操作反馈（上传 / 建库结果），5s 自动消失
        toast
          ? h(
              'div',
              { className: cx('sch-toast', toast.tone === 'err' ? 'err' : '') },
              h(toast.tone === 'err' ? IconAlert : IconCheck),
              h('span', null, toast.text),
              h(
                'button',
                { type: 'button', onClick: () => setToast(null), 'aria-label': t('toast.close') },
                h(IconX),
              ),
            )
          : null,

        // 当前模块：内容由注册表提供，这里只负责挂载
        active
          ? h(
              'div',
              { className: cx('sch-modwrap', active.fit && 'fit'), key: active.id },
              active.mount ? active.mount(mountCtx, active) : h(PlannedModule, { t, mod: active }),
            )
          : h(
              'div',
              { className: 'sch-modbody' },
              h('div', { className: 'sch-empty' }, h('div', { className: 'sch-empty-title' }, t('mods.none'))),
            ),

          ),
        ),
      ),
      pop === 'settings'
        ? h(SettingsDrawer, {
            t,
            settings,
            host: snap.host,
            storeRoot: snap.health?.storeRoot || snap.capabilities?.storeRoot || '',
            onClose: () => setPop(null),
            onSave: (next) => {
              setSettings(next);
              setPop(null);
            },
            onOpenPlugins: () => setPop('modules'),
            onOpenDiag: () => setPop('diag'),
          })
        : null,
      pop === 'diag'
        ? h(Diagnostics, { t, snap, settings, onClose: () => setPop(null) })
        : null,
      pop === 'modules'
        ? h(ModulesDrawer, { t, modules, settings, onClose: () => setPop(null) })
        : null,
    );
  }

  /* ---------------------------------------------------------------- 诊断 */

  function Diagnostics({ t, snap, settings, onClose }) {
    const features = snap.capabilities?.features || {};
    const rows = FEATURE_LABELS.map(([id, label]) => {
      const state = capabilityState(t, snap.capabilities, id);
      return { id, label, state };
    });

    return h(
      'div',
      { className: 'sch-root sch-tokens sch-drawer', role: 'dialog', 'aria-label': t('diag.title') },
      h(
        'div',
        { className: 'sch-drawer-head' },
        h('div', { className: 'sch-section-title' }, t('diag.title')),
        h(
          'button',
          { type: 'button', className: 'sch-btn icon', onClick: onClose, 'aria-label': t('panel.close') },
          h(IconX),
        ),
      ),
      h(
        'dl',
        { className: 'sch-kv' },
        h('dt', null, t('diag.health')),
        h('dd', null, snap.health ? `${snap.health.status} · v${snap.health.version}` : '—'),
        h('dt', null, t('diag.checkedAt')),
        h('dd', null, fmtTime(snap.checkedAt)),
        h('dt', null, t('diag.requestId')),
        h('dd', { className: 'sch-mono' }, snap.requestId || '—'),
        h('dt', null, t('diag.scopeKey')),
        h('dd', null, t('diag.scopeKeyHint')),
        h('dt', null, t('diag.contract')),
        h(
          'dd',
          { className: 'sch-mono' },
          settings.mode === 'mock' ? 'mock' : baseOf(settings) || '(same origin)',
        ),
      ),
      h('div', { className: 'sch-section-title', style: { marginTop: 20 } }, t('caps.title')),
      h(
        'div',
        { className: 'sch-table', style: { marginTop: 8 } },
        ...rows.map((row) =>
          h(
            'div',
            { className: 'sch-tr body', key: row.id, style: { gridTemplateColumns: 'minmax(0,1fr) 104px' } },
            h('div', null, row.label, h('span', { className: 'sch-section-meta sch-mono' }, `  ${row.id}`)),
            h('div', null, h(Badge, { tone: row.state.tone }, row.state.label)),
          ),
        ),
      ),
      h('div', { className: 'sch-card-desc', style: { marginTop: 8 } }, t('caps.hint')),
      h('div', { className: 'sch-section-title', style: { marginTop: 20 } }, t('diag.raw')),
      h(
        'pre',
        { className: 'sch-pre' },
        JSON.stringify(
          {
            health: snap.health,
            capabilities: snap.capabilities,
            knowledgeBases: snap.kbs ? { count: (snap.kbs.items || []).length, nextCursor: snap.kbs.nextCursor } : null,
            error: snap.error || snap.kbError || null,
            features,
          },
          null,
          2,
        ),
      ),
    );
  }

  /* ---------------------------------------------------- Session 头部控件 */

  /**
   * 头部只做「会话识别」，不再画控件。
   *
   * 2026-11-17 用户反馈：宿主头部那枚「知识库 · 已选 3 个库」胶囊看不懂，而且和问答页
   * 输入框上方的选库 chip 重复 —— 视觉上纯噪音，删掉。但宿主仍会把 sessionId 注入这个
   * slot，范围、草稿、浏览器任务全都按会话隔离，所以保留注册、只上报 id，不渲染节点。
   */
  function SessionProbe({ sessionId, store }) {
    useEffect(() => {
      if (sessionId) store.set({ activeSessionId: sessionId });
    }, [sessionId, store]);
    return null;
  }

  /* ------------------------------------------------------------ 注入/挂载 */

  const inject = ['slots', 'locale', 'layout'];

  function apply(ctx) {
    ensureStyle();

    ctx.effect(() => ctx.locale.register(NS, DICT), 'schanora: dictionaries');
    const t = ctx.locale.bind(NS);

    let settings = readSettings();
    setAuthKey(settings.apiKey);
    const store = createStore({
      phase: 'loading',
      source: settings.mode,
      settings,
      health: null,
      capabilities: null,
      kbs: null,
      error: null,
      latencyMs: null,
      requestId: null,
      checkedAt: null,
      scope: {},
    });

    /* DSH 深度对接（第二层）：宿主能力探测。
       宿主给了 ctx.model.chat / ctx.tools.register / ctx.conversation.getMessages，
       插件立刻用上；没给就退回现状（网关 SSE + 无工具），不假装、不报错。
       探测结果进 store.host，设置页有一行只读诊断，用户不用猜 DSH 到底给了什么。 */
    const hostCaps = detectHostCaps(ctx);
    let toolState = { ok: false, via: '', error: hostCaps.tools ? '' : '宿主未提供工具注册能力' };
    if (hostCaps.tools) {
      try {
        const spec = buildRetrievalToolSpec({
          // 工具被 DSH 主对话调用时，这里拿最新设置（用户可能中途改过网关地址）
          handler: async (args) => {
            const query = String((args && args.query) || '').trim();
            if (!query) throw new ApiError('INVALID_ARGUMENT', 'query 不能为空', {});
            const cur = settings;
            const kbIds = Array.isArray(args && args.kbIds) && args.kbIds.length ? args.kbIds : null;
            const res =
              cur.mode === 'mock'
                ? mockSearchHits(query, kbIds || MOCK_KBS.map((k) => k.id))
                : await api.search(cur, { query, kbIds: kbIds || undefined, matchCount: (args && args.topK) || cur.topK });
            return toToolResult((res && res.items) || []);
          },
        });
        const registered = hostCaps.tools.register(spec);
        // 注册可能返回 Promise（异步建表/落盘）或 dispose 函数；两者都要接住错误
        if (registered && typeof registered.then === 'function') {
          registered.then(
            () => store.set({ host: { ...store.get().host, tool: { ok: true, via: hostCaps.tools.via, error: '' } } }),
            (err) =>
              store.set({
                host: { ...store.get().host, tool: { ok: false, via: hostCaps.tools.via, error: (err && err.message) || '注册失败' } },
              }),
          );
        } else {
          toolState = { ok: true, via: hostCaps.tools.via, error: '' };
        }
      } catch (err) {
        toolState = { ok: false, via: hostCaps.tools.via, error: (err && err.message) || '注册失败' };
      }
    }
    store.set({ host: { caps: hostCaps, tool: toolState } });

    const load = () => {
      store.set({ phase: 'loading', source: settings.mode });
      loadSnapshot(settings)
        .then((snap) => store.set(snap))
        .catch((error) =>
          store.set({
            phase: 'error',
            error: { code: 'UNEXPECTED', message: error?.message || String(error), retryable: true },
          }),
        );
    };

    store.refresh = load;
    store.publishScope = (sessionId, ids) => store.set({ scope: { ...store.get().scope, [sessionId]: ids } });
    store.openPanel = () => {
      try {
        ctx.layout.selectPanel(PANEL_ID);
      } catch (_e) {
        /* 面板未注册时不影响头部控件 */
      }
    };

    const setSettings = (next) => {
      settings = normalizeSettings(next);
      setAuthKey(settings.apiKey);
      writeSettings(settings);
      store.set({ settings });
      load();
    };

    load();

    // 侧栏入口 + 主面板
    ctx.slots.inject('sidebar.panellist', function* () {
      yield ctx.slots.register(
        { name: 'sidebar.panellist', id: PANEL_ID, order: 30, locale: NS, label: () => t('panel.label') },
        Mark,
      );
    });

    ctx.slots.inject('main', () =>
      ctx.slots.register(
        { name: 'main', key: PANEL_ID, locale: NS },
        () => h(Panel, { t, store, setSettings }),
      ),
    );

    // 当前 Session 头部：不再渲染任何控件，只借宿主注入的 sessionId 做会话隔离
    ctx.slots.inject('conversation.session.header.utilities', () =>
      ctx.slots.register(
        {
          name: 'conversation.session.header.utilities',
          id: 'schanora-session',
          order: 20,
          locale: NS,
          inject: (sessionId) => ({ sessionId }),
        },
        (props) => h(SessionProbe, { sessionId: props.sessionId, store }),
      ),
    );
  }

  /* ------------------------------------------------- 内置模块（M1–M6 映射） */

  /**
   * 交接包 7 张模块卡里，M0 是接入基线（宿主/网关/主题，本身没有页面），
   * 其余 6 个落到注册表：4 个占页签，M3 是文档详情视图，M6 是跨插件能力。
   * 未接入的模块也注册，好处是面板、模块抽屉、文档三处看到的是同一份事实。
   */
  function registerBuiltinModules() {
    if (MODULES.get('kb')) return;

    MODULES.add({
      id: 'kb',
      title: 'mod.kb',
      desc: 'mod.kb.desc',
      module: 'M1',
      order: 10,
      status: 'ready',
      icon: IconBook,
      requires: ['GET /api/v1/knowledge-bases', 'POST /api/v1/knowledge-bases', 'GET /api/v1/models?type=Embedding'],
      mount: (ctx) => h(KbHome, ctx),
    });

    MODULES.add({
      id: 'docs',
      title: 'mod.docs',
      desc: 'mod.docs.desc',
      module: 'M2',
      order: 20,
      status: 'partial',
      icon: IconFile,
      requires: [
        'GET /api/v1/knowledge-bases/{kbId}/documents',
        'POST /api/v1/knowledge-bases/{kbId}/documents',
        'OneDrive / Graph 接收（未接）',
      ],
      mount: (ctx) => h(DocsHome, ctx),
    });

    MODULES.add({
      id: 'doc-detail',
      title: 'mod.detail',
      module: 'M3',
      order: 90,
      tab: false,
      status: 'partial',
      requires: ['GET /api/v1/documents/{id}', 'GET /api/v1/documents/{id}/chunks', 'GET /api/v1/documents/{id}/spans'],
    });

    // 模块编号以 A 的《模块1-5进度同步》为准：M4 = 检索，M5 = 问答，M6 = Wiki。
    MODULES.add({
      id: 'search',
      title: 'mod.search',
      desc: 'mod.search.desc',
      module: 'M4',
      order: 25,
      status: 'ready',
      icon: IconSearch,
      requires: ['POST /api/v1/search'],
      mount: (ctx) => h(SearchView, ctx),
    });

    MODULES.add({
      id: 'qa',
      title: 'mod.qa',
      desc: 'mod.qa.desc',
      module: 'M5',
      order: 30,
      status: 'ready',
      fit: true,
      icon: IconChat,
      requires: [
        'POST /api/v1/sessions',
        'GET /api/v1/sessions/{id}/messages',
        'POST /api/v1/sessions/{id}/messages（SSE）',
      ],
      mount: (ctx) => h(QaView, ctx),
    });

    MODULES.add({
      id: 'wiki',
      title: 'mod.wiki',
      desc: 'mod.wiki.desc',
      module: 'M6',
      order: 40,
      status: 'partial',
      more: true,
      icon: IconLayers,
      requires: [
        'GET /api/v1/knowledge-bases/{kbId}/wiki/tree',
        'GET /api/v1/knowledge-bases/{kbId}/wiki/pages/{slug}',
      ],
      mount: (ctx) => h(WikiView, ctx),
    });

    MODULES.add({
      id: 'plugins',
      title: 'mod.plugins',
      desc: 'mod.plugins.desc',
      module: 'M7',
      order: 50,
      status: 'partial',
      more: true,
      icon: IconGrid,
      requires: ['GET /api/v1/plugins（可选，读不到就只显示本地插件）'],
      mount: (ctx) => h(PluginsView, ctx),
    });

    // ---- WeKnora 生态插件（P1/P2/P4，对应交接包 2026-11-13）----
    // P1 知识管理助手：源码未核实，按 HANDOFF §5 以「行为重实现」落地。
    MODULES.add({
      id: 'clip',
      title: 'mod.clip',
      desc: 'mod.clip.desc',
      module: 'P1',
      order: 22,
      status: 'partial',
      icon: IconClip,
      requires: [
        'POST /api/v1/clips（ClipService 提案，A 侧待实现）',
        'POST /api/v1/clips/{id}/commit',
        'GET /api/v1/jobs/{jobId}',
        'OneDrive source/web-clips 落盘（A 侧）',
      ],
      mount: (ctx) => h(ClipView, ctx),
    });

    // P2 BrowserSkill：优先接入官方 DSH 插件，本页签只做任务协同与候选交接。
    MODULES.add({
      id: 'browser',
      title: 'mod.browser',
      desc: 'mod.browser.desc',
      module: 'P2',
      order: 28,
      status: 'partial',
      icon: IconGlobe,
      requires: [
        '官方插件 @wxg-prc-cpg/browser-skill-dsh-plugin（peer 版本需实测核对）',
        'GET /api/v1/browser/status（桥接提案端点，A 侧待实现）',
        '本机 bsk daemon + 浏览器伴随扩展',
      ],
      mount: (ctx) => h(BrowserView, ctx),
    });

    // P4 批量导入：WeKnora ClawHub Skill 的工作流改写，不冒称独立插件。
    MODULES.add({
      id: 'batch',
      title: 'mod.batch',
      desc: 'mod.batch.desc',
      module: 'P4',
      order: 42,
      status: 'partial',
      icon: IconLayers,
      requires: ['ClipService 同 P1', '批量幂等键集（本机持久化演示）'],
      mount: (ctx) => h(BatchView, ctx),
    });

    MODULES.add({
      id: 'interop',
      title: 'mod.interop',
      module: 'DSH',
      order: 95,
      tab: false,
      status: 'partial',
      requires: ['3 个槽位已注册（侧栏/主面板/Session 头部）', 'MCP: search / read / wiki（Host 侧未实现）', 'scopeHandle 绑定与过期'],
    });
  }

  registerBuiltinModules();

  return { inject, apply, NS, PANEL_ID, DICT, registerModule: (def) => MODULES.add(def), listModules: () => MODULES.list() };
}

if (typeof window !== 'undefined') {
  window.createSchanoraClient = createSchanoraClient;
}
