/**
 * 假网关：在没装 WeKnora / 没装 Python 依赖的机器上，验证前端的真实 HTTP 通路。
 *
 * 它只做一件事：按 A 的 `gateway/` 当前实现，返回同样的形状——
 *   {code:0, message:"ok", data:…}、camelCase、统一错误包裹（422/502）、
 *   /health 真探活、/capabilities 能力声明、chunks 带 total/分页、/search、/sessions + SSE。
 * 不连 WeKnora、不做鉴权、不落盘；数据在内存里，重启即恢复。
 *
 * 用法：
 *   node scripts/fake-gateway.mjs            # 127.0.0.1:8000
 *   PORT=8010 node scripts/fake-gateway.mjs
 *
 * 然后在预览里把「连接设置 → 网关实时 → 地址」指过来，或用
 *   SHOOT_HTTP=1 node scripts/shoot.mjs …
 * 直接跑一遍真 HTTP 的截图。
 */
import { createServer } from 'node:http';

const PORT = Number(process.env.PORT || 8000);
const HOST = process.env.HOST || '127.0.0.1';

const now = Date.now();
const iso = (msAgo) => new Date(now - msAgo).toISOString();

const kbs = [
  {
    id: 'kb-std-001',
    name: '工程标准库',
    description: '企业标准、国标与供应商规范（GB/T、Q/SC 系列）',
    type: 'document',
    embeddingModelId: 'builtin-ollama-embedding',
    knowledgeCount: 3,
    chunkCount: 46,
    createdAt: iso(86400000 * 12),
    updatedAt: iso(3600000),
  },
  {
    id: 'kb-prj-2026',
    name: '项目 P-2026 资料库',
    description: '装配图纸、BOM 与试验报告',
    type: 'document',
    embeddingModelId: 'builtin-ollama-embedding',
    knowledgeCount: 1,
    chunkCount: 4,
    createdAt: iso(86400000 * 5),
    updatedAt: iso(600000),
  },
];

const docs = {
  'kb-std-001': [
    {
      id: 'doc-err-003',
      title: '供应商试验报告 2026Q3',
      fileName: '供应商试验报告_2026Q3.pdf',
      fileType: 'pdf',
      fileSize: 2564096,
      parseStatus: 'failed',
      embeddingModelId: 'builtin-ollama-embedding',
      createdAt: iso(3480000),
      processedAt: iso(2760000),
      errorMessage: '向向量库写入失败：collection kb-std-001 不存在',
      attempt: 4,
      failedStage: 'embedding',
    },
    {
      id: 'doc-run-002',
      title: '装配工艺卡 P-2026-018',
      fileName: '装配工艺卡P-2026-018.docx',
      fileType: 'docx',
      fileSize: 880640,
      parseStatus: 'processing',
      embeddingModelId: 'builtin-ollama-embedding',
      createdAt: iso(360000),
    },
    {
      id: 'doc-ok-001',
      title: 'GB/T 3452.1 液压气动用 O 形橡胶密封圈',
      fileName: 'GBT_3452.1-2005.pdf',
      fileType: 'pdf',
      fileSize: 2564096,
      parseStatus: 'completed',
      embeddingModelId: 'builtin-ollama-embedding',
      createdAt: iso(86400000 * 2),
      processedAt: iso(86400000 * 2 - 60000),
    },
  ],
  'kb-prj-2026': [
    {
      id: 'doc-ok-005',
      title: '项目周报 2026W45',
      fileName: '项目周报_2026W45.md',
      fileType: 'md',
      fileSize: 18432,
      parseStatus: 'completed',
      embeddingModelId: 'builtin-ollama-embedding',
      createdAt: iso(60000000),
      processedAt: iso(60000000),
    },
  ],
};

const STAGES = ['docreader', 'chunking', 'embedding', 'multimodal', 'postprocess'];

function spansFor(doc) {
  const failedIdx = doc.failedStage ? STAGES.indexOf(doc.failedStage) : -1;
  const children = STAGES.map((name, i) => {
    let status = 'pending';
    if (doc.parseStatus === 'completed') status = 'done';
    else if (doc.parseStatus === 'processing') status = i < 2 ? 'done' : i === 2 ? 'running' : 'pending';
    else if (doc.parseStatus === 'failed') status = i < failedIdx ? 'done' : i === failedIdx ? 'failed' : 'cancelled';
    const node = { name, status, startedAt: iso(3000000 - i * 200000) };
    if (status === 'done') node.durationMs = 1200 + i * 900;
    if (status === 'failed') {
      node.errorCode = 'VECTORSTORE_WRITE_FAILED';
      node.errorMessage = doc.errorMessage;
      node.finishedAt = iso(2700000);
    }
    return node;
  });
  const failed = children.find((c) => c.status === 'failed');
  return {
    knowledgeId: doc.id,
    attempt: doc.attempt || 1,
    latestAttempt: doc.attempt || 1,
    currentAttempt: doc.attempt || 1,
    parseStatus: doc.parseStatus,
    currentStage: 'embedding',
    trace: { name: 'knowledge_processing', status: doc.parseStatus, children },
    lastError: failed
      ? { stage: failed.name, code: failed.errorCode, message: failed.errorMessage }
      : null,
  };
}

const CHUNK_TEXTS = [
  '表 3 螺栓拧紧力矩（N·m）\n规格 M8 8.8 级：24 N·m；M10 8.8 级：49 N·m；M12 8.8 级：86 N·m。\n拧紧顺序按对角线交叉进行。',
  '4.2 密封件安装\nO 形圈安装前应检查表面，不得有划伤、缺胶及老化裂纹。安装时使用无尖锐边缘的导入工具。',
  '5.1 试验条件\n环境温度 23±5 ℃，相对湿度 45%~75%，试验介质为 46 号抗磨液压油，系统压力 16 MPa。',
  '6.3 判定\n保压期间任何结合面不得出现渗漏；试验后 O 形圈外观无异常变形。',
  '附录 A 记录表格式与填写要求（略）。',
];

function chunksFor(doc, page, pageSize) {
  const total = 5;
  const start = (page - 1) * pageSize;
  const items = [];
  for (let i = start; i < Math.min(total, start + pageSize); i += 1) {
    items.push({
      id: `${doc.id}-c${i + 1}`,
      content: CHUNK_TEXTS[i % CHUNK_TEXTS.length],
      chunkIndex: i,
      startAt: i * 640,
      endAt: i * 640 + CHUNK_TEXTS[i % CHUNK_TEXTS.length].length,
      chunkType: 'text',
      indexStatus: doc.parseStatus === 'failed' ? 'failed' : 'ready',
      isEnabled: true,
    });
  }
  return { items, total };
}

const json = (res, status, body) => {
  const buf = Buffer.from(JSON.stringify(body));
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': buf.length });
  res.end(buf);
};

// 契约 0.2：错误也是统一包裹（A 已加异常处理器，422/502 都长这样）
const ok = (res, data) => json(res, 200, { code: 0, message: 'ok', data });
const fail = (res, status, message) => {
  const requestId = Math.random().toString(36).slice(2, 14);
  json(res, status, {
    code: status === 422 ? 'VALIDATION_ERROR' : status === 502 ? 'UPSTREAM_ERROR' : 'HTTP_ERROR',
    message,
    data: null,
    retryable: status === 502 || status === 504,
    requestId,
  });
};

const sessions = [
  {
    id: 'sess-fake-001',
    title: '装配力矩与密封件',
    description: '',
    createdAt: iso(7200000),
    updatedAt: iso(1800000),
  },
];

const messages = {
  'sess-fake-001': [
    { id: 'm1', role: 'user', content: 'M10 螺栓拧紧力矩是多少？', createdAt: iso(1900000) },
    {
      id: 'm2',
      role: 'assistant',
      content: 'M10、8.8 级为 **49 N·m**，按对角线交叉顺序分两次拧紧。',
      createdAt: iso(1800000),
      knowledgeReferences: [],
    },
  ],
};

/** 检索命中：块文本 + 文档标题，分数按中文二元组命中率（与界面 Mock 同一套算法）。 */
function hitsFor(query, kbIds, matchCount) {
  const q = String(query || '').replace(/\s+/g, '');
  const grams = Array.from(new Set(Array.from({ length: Math.max(0, q.length - 1) }, (_, i) => q.slice(i, i + 2))));
  const out = [];
  for (const kbId of kbIds) {
    for (const doc of docs[kbId] || []) {
      CHUNK_TEXTS.forEach((text, ci) => {
        let matched = 0;
        grams.forEach((g) => {
          if (text.indexOf(g) >= 0) matched += 1;
        });
        const score = grams.length
          ? Math.min(0.94, Number((0.3 + (matched / grams.length) * 0.58).toFixed(4)))
          : 0.32;
        out.push({
          id: `${doc.id}-c${ci + 1}`,
          content: text,
          knowledgeId: doc.id,
          knowledgeTitle: doc.title,
          knowledgeFilename: doc.fileName,
          chunkIndex: ci,
          startAt: ci * 640,
          endAt: ci * 640 + text.length,
          score,
          matchType: ci % 3 === 0 ? 1 : 0,
          knowledgeBaseId: kbId,
        });
      });
    }
  }
  out.sort((a, b) => b.score - a.score);
  return out.slice(0, matchCount || 6);
}

function readBody(req) {
  return new Promise((resolve) => {
    const parts = [];
    req.on('data', (c) => parts.push(c));
    req.on('end', () => resolve(Buffer.concat(parts)));
  });
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const path = url.pathname;
  const method = req.method || 'GET';
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Access-Control-Allow-Methods', '*');
  if (method === 'OPTIONS') {
    res.writeHead(204).end();
    return;
  }

  // A 的 /health：真探活（ok / degraded / unavailable），不再回显配置
  if (path === '/health') {
    json(res, 200, { status: 'ok', version: '0.1.0-fake', checkedAt: new Date().toISOString() });
    return;
  }

  if (path === '/api/v1/models') {
    const type = url.searchParams.get('type');
    const all = [
      { id: 'builtin-ollama-embedding', name: 'bge-m3', displayName: 'bge-m3 (本地 Ollama)', type: 'Embedding', source: 'local', isDefault: true, isBuiltin: true, status: 'active' },
      { id: 'qwen3-embedding', name: 'qwen3-embedding', displayName: 'qwen3-embedding (云端)', type: 'Embedding', source: 'remote', isDefault: false, status: 'active' },
    ];
    ok(res, type ? all.filter((m) => m.type === type) : all);
    return;
  }

  if (path === '/api/v1/knowledge-bases' && method === 'GET') {
    ok(res, kbs);
    return;
  }

  if (path === '/api/v1/knowledge-bases' && method === 'POST') {
    const body = JSON.parse((await readBody(req)).toString('utf8') || '{}');
    const kb = {
      id: `kb-${Math.random().toString(36).slice(2, 8)}`,
      name: body.name || '未命名',
      description: body.description || '',
      type: body.type || 'document',
      embeddingModelId: body.embeddingModelId || 'builtin-ollama-embedding',
      knowledgeCount: 0,
      chunkCount: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    kbs.unshift(kb);
    docs[kb.id] = [];
    ok(res, kb);
    return;
  }

  const docList = path.match(/^\/api\/v1\/knowledge-bases\/([^/]+)\/documents$/);
  if (docList && method === 'GET') {
    ok(res, docs[docList[1]] || []);
    return;
  }
  if (docList && method === 'POST') {
    const raw = (await readBody(req)).toString('utf8');
    const m = raw.match(/filename="([^"]*)"/);
    const fileName = m ? Buffer.from(m[1], 'latin1').toString('utf8') : 'upload.bin';
    const kbId = docList[1];
    const doc = {
      id: `doc-${Math.random().toString(36).slice(2, 10)}`,
      title: fileName.replace(/\.[^.]+$/, ''),
      fileName,
      fileType: (fileName.split('.').pop() || '').toLowerCase(),
      fileSize: raw.length,
      parseStatus: 'pending',
      embeddingModelId: 'builtin-ollama-embedding',
      createdAt: new Date().toISOString(),
    };
    docs[kbId] = [doc, ...(docs[kbId] || [])];
    // 3s 后进入处理中，模拟「上传 ≠ 处理完成」
    setTimeout(() => {
      doc.parseStatus = 'processing';
    }, 3000);
    ok(res, doc);
    return;
  }

  const detail = path.match(/^\/api\/v1\/documents\/([^/]+)$/);
  if (detail && method === 'GET') {
    const id = detail[1];
    if (id === 'boom') {
      fail(res, 502, 'WeKnora 返回错误(500): internal error');
      return;
    }
    for (const list of Object.values(docs)) {
      const hit = list.find((d) => d.id === id);
      if (hit) {
        ok(res, hit);
        return;
      }
    }
    fail(res, 404, '文档不存在');
    return;
  }

  const spans = path.match(/^\/api\/v1\/documents\/([^/]+)\/spans$/);
  if (spans) {
    for (const list of Object.values(docs)) {
      const hit = list.find((d) => d.id === spans[1]);
      if (hit) {
        ok(res, spansFor(hit));
        return;
      }
    }
    fail(res, 404, '文档不存在');
    return;
  }

  const chunks = path.match(/^\/api\/v1\/documents\/([^/]+)\/chunks$/);
  if (chunks) {
    const page = Number(url.searchParams.get('page') || 1);
    const pageSize = Number(url.searchParams.get('page_size') || 10);
    for (const list of Object.values(docs)) {
      const hit = list.find((d) => d.id === chunks[1]);
      if (hit) {
        // A 已修：分页参数透传 + 返回 {items,total,page,pageSize}（P0-1）
        const pageData = chunksFor(hit, page, pageSize);
        ok(res, { items: pageData.items, total: pageData.total, page, pageSize });
        return;
      }
    }
    fail(res, 404, '文档不存在');
    return;
  }

  // ---- 模块 4：检索 ---------------------------------------------------------
  if (path === '/api/v1/search' && method === 'POST') {
    const body = JSON.parse((await readBody(req)).toString('utf8') || '{}');
    if (!body.query) {
      fail(res, 422, 'body.query: field required');
      return;
    }
    const kbIds = body.knowledgeBaseIds && body.knowledgeBaseIds.length
      ? body.knowledgeBaseIds
      : body.knowledgeBaseId
        ? [body.knowledgeBaseId]
        : [];
    if (kbIds.length === 0) {
      // 契约 4.1：两个字段至少传一个，否则上游 400 —— 这里如实模拟
      fail(res, 502, 'WeKnora 返回错误(400): knowledge_base_ids is required');
      return;
    }
    ok(res, { items: hitsFor(body.query, kbIds, body.matchCount), meta: { rerank: { applied: false, outcome: 'disabled' } } });
    return;
  }

  // ---- 模块 5：会话与问答 ---------------------------------------------------
  if (path === '/api/v1/sessions' && method === 'GET') {
    ok(res, sessions);
    return;
  }
  if (path === '/api/v1/sessions' && method === 'POST') {
    const body = JSON.parse((await readBody(req)).toString('utf8') || '{}');
    const session = {
      id: `sess-${Math.random().toString(36).slice(2, 10)}`,
      title: body.title || '',
      description: body.description || '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    sessions.unshift(session);
    messages[session.id] = [];
    ok(res, session);
    return;
  }

  const msgRoute = path.match(/^\/api\/v1\/sessions\/([^/]+)\/messages$/);
  if (msgRoute && method === 'GET') {
    ok(res, messages[msgRoute[1]] || []);
    return;
  }
  if (msgRoute && method === 'POST') {
    const sid = msgRoute[1];
    const body = JSON.parse((await readBody(req)).toString('utf8') || '{}');
    if (!body.query) {
      fail(res, 422, 'body.query: field required');
      return;
    }
    const kbIds = body.knowledgeBaseIds && body.knowledgeBaseIds.length ? body.knowledgeBaseIds : kbs.map((k) => k.id);
    const refs = hitsFor(body.query, kbIds, 3);
    const answer = [
      `根据《${refs[0] ? refs[0].knowledgeTitle : '知识库'}》第 ${refs[0] ? refs[0].chunkIndex + 1 : 1} 块的原文，能确认的是：`,
      '',
      refs[0] ? refs[0].content.split('\n').filter(Boolean).slice(0, 2).join('；') : '（没有命中片段）',
      '',
      '要点：',
      '',
      '- 上述条件仅在该文档规定的范围内成立',
      '- 原文没写的部分不作推断',
    ].join('\n');

    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });
    let closed = false;
    req.on('close', () => {
      closed = true;
    });
    const emit = (obj) => {
      if (closed) return false;
      res.write(`data: ${JSON.stringify(obj)}\n\n`);
      return true;
    };
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));

    (async () => {
      emit({ id: 'e0', responseType: 'agentQuery', content: '', done: false, sessionId: sid });
      await wait(160);
      emit({
        id: 'e1',
        responseType: 'references',
        content: '',
        done: false,
        knowledgeReferences: refs,
        sessionId: sid,
        assistantMessageId: `msg-${Date.now()}`,
      });
      await wait(120);
      const step = 6;
      for (let i = 0; i < answer.length && !closed; i += step) {
        const last = i + step >= answer.length;
        emit({ id: `a${i}`, responseType: 'answer', content: answer.slice(i, i + step), done: last, sessionId: sid });
        await wait(38);
      }
      emit({ id: 'done', responseType: 'complete', content: '', done: true, sessionId: sid });
      if (!closed) res.end();
    })().catch(() => {
      if (!closed) res.end();
    });
    return;
  }

  // /capabilities 在 A 的网关里已有（P1-2），这里如实返回
  if (path === '/capabilities') {
    json(res, 200, {
      contractVersion: '3.0.0',
      features: { knowledgeBases: true, documents: true, chunks: true, search: true, sessions: true },
      upstreamVersions: { weknora: '0.9.0-fake' },
    });
    return;
  }

  fail(res, 404, `Not Found: ${path}`);
});

server.listen(PORT, HOST, () => {
  console.log(`[fake-gateway] http://${HOST}:${PORT}  知识库 ${kbs.length} 个，文档 ${Object.values(docs).flat().length} 个`);
});
