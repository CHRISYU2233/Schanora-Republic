/**
 * 本地内核的 HTTP 面：把 store + searcher 包成前端已经在用的那套 `/api/v1` 契约。
 *
 * 为什么还是 HTTP（而不是直接的进程内调用）：
 *   · 前端是浏览器里的 bundle，宿主注入的只有 slots/locale/layout，没有 IPC 通道；
 *   · 同一份内核既要能被宿主插件拉起，也要能用 `node scripts/local-server.mjs` 单独跑（预览台、
 *     无 DSH 环境、排查问题），HTTP 是两边唯一的公共面；
 *   · 契约不变 ⇒ 前端只改 baseUrl 与模式判断，其余代码一行不动，回归风险最小。
 *
 * 服务只监听 127.0.0.1（回环），不加鉴权但也不出网 —— 这是「本地跑」的前提。
 */
import http from 'node:http';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createStore } from './store.js';
import { createSearcher, probeOllama, composeExtractive, OLLAMA } from './search.js';
import { shortId, nowIso } from './paths.js';
import { summarize } from './text.js';
import { createBackup } from './backup.js';

const VERSION = '0.7.0-local';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.md': 'text/markdown; charset=utf-8',
  '.woff2': 'font/woff2',
};

function sendJson(res, status, data, requestId) {
  const body = JSON.stringify({ code: 0, data, requestId: requestId || null });
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'X-Request-Id': requestId || '',
  });
  res.end(body);
}

function sendError(res, status, code, message, requestId) {
  const body = JSON.stringify({ code, message, requestId: requestId || null });
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'X-Request-Id': requestId || '',
  });
  res.end(body);
}

async function readBody(req, limit = 64 * 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) {
      const error = new Error('请求体过大（上限 64MB）');
      error.code = 'PAYLOAD_TOO_LARGE';
      throw error;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function readJsonBody(req) {
  const raw = await readBody(req);
  if (!raw.length) return {};
  try {
    return JSON.parse(raw.toString('utf8'));
  } catch (_e) {
    const error = new Error('请求体不是合法 JSON');
    error.code = 'VALIDATION_ERROR';
    throw error;
  }
}

/**
 * 最小 multipart 解析。只取「第一个带 filename 的部分」——上传接口一次只收一份文件，
 * 不需要完整实现 RFC 7578，但边界与 CRLF 的处理必须严格，否则文件末尾会多两个字节。
 */
export function parseMultipart(buffer, contentType) {
  const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType || '');
  if (!m) return null;
  const boundary = `--${(m[1] || m[2]).trim()}`;
  const delim = Buffer.from(boundary);
  const parts = [];
  let cursor = buffer.indexOf(delim);
  while (cursor >= 0) {
    const start = cursor + delim.length;
    if (buffer[start] === 0x2d && buffer[start + 1] === 0x2d) break; // 结束标记 --
    const next = buffer.indexOf(delim, start);
    if (next < 0) break;
    let partStart = start;
    if (buffer[partStart] === 0x0d) partStart += 1;
    if (buffer[partStart] === 0x0a) partStart += 1;
    let partEnd = next;
    if (buffer[partEnd - 1] === 0x0a) partEnd -= 1;
    if (buffer[partEnd - 1] === 0x0d) partEnd -= 1;
    const part = buffer.subarray(partStart, partEnd);
    const headerEnd = part.indexOf('\r\n\r\n');
    if (headerEnd > 0) {
      const headers = part.subarray(0, headerEnd).toString('utf8');
      const body = part.subarray(headerEnd + 4);
      const nameMatch = /name="([^"]*)"/i.exec(headers);
      const fileMatch = /filename="([^"]*)"/i.exec(headers);
      parts.push({
        name: nameMatch ? nameMatch[1] : '',
        fileName: fileMatch ? fileMatch[1] : '',
        body,
      });
    }
    cursor = next;
  }
  return parts;
}

/** 本机模型目录：Ollama 有什么就报什么，没模型时给一个内置项，建库表单不至于空着。 */
function builtinModel() {
  return {
    id: 'local-builtin',
    name: '内置关键词检索（无需模型）',
    displayName: '内置关键词检索（无需模型）',
    type: 'Keyword',
    source: 'builtin',
    isDefault: true,
  };
}

function pickChatModel(models) {
  if (!models) return '';
  const chat = models.find((m) => m.type === 'Chat');
  return chat ? chat.id : '';
}

export function createServer(options = {}) {
  const store = createStore({ root: options.root });
  const searcher = createSearcher(store);
  const staticRoot = options.staticRoot ? path.resolve(options.staticRoot) : '';
  const runtime = ['plugin', 'web'].includes(options.runtime) ? options.runtime : 'preview';
  let ollamaCache = { at: 0, models: null };

  async function models(force = false) {
    if (!force && ollamaCache.models && Date.now() - ollamaCache.at < 15000) return ollamaCache.models;
    const probed = await probeOllama();
    ollamaCache = { at: Date.now(), models: probed };
    return probed;
  }

  async function capabilities() {
    const found = await models();
    const hasOllama = Array.isArray(found) && found.length > 0;
    const hasChat = hasOllama && found.some((m) => m.type === 'Chat');
    const hasEmbed = hasOllama && found.some((m) => m.type === 'Embedding');
    return {
      version: VERSION,
      mode: 'local',
      storeRoot: store.root,
      features: {
        documents: true,
        // 检索永远可用（BM25 兜底）；向量是增强，单独标出来
        search: true,
        'search.vector': Boolean(hasEmbed),
        chat: hasChat,
        wiki: true,
        clips: true,
        plugins: true,
        // 本地内核没有浏览器桥，如实标 false，前端会显示「未接」
        browser: false,
      },
      localModels: hasOllama ? found : [],
    };
  }

  /* ------------------------------------------------------------- 路由 */

  const routes = [];
  const route = (method, pattern, handler) => routes.push({ method, pattern, handler });

  route('GET', /^\/health$/, async () => ({ status: 'ok', version: VERSION, mode: 'local', runtime, storeRoot: store.root }));
  route('GET', /^\/capabilities$/, async () => capabilities());

  route('GET', /^\/api\/v1\/models$/, async (ctx) => {
    const type = ctx.query.get('type') || '';
    const found = await models(true);
    const items = found ? found.slice() : [];
    if (!type || type === 'Embedding' || type === 'Keyword') items.push(builtinModel());
    const filtered = type ? items.filter((m) => m.type === type || m.source === 'builtin') : items;
    return { items: filtered.length ? filtered : [builtinModel()], total: filtered.length };
  });

  route('GET', /^\/api\/v1\/local\/info$/, async () => {
    const stats = await store.stats();
    return { ...stats, version: VERSION };
  });

  route('POST', /^\/api\/v1\/local\/reveal$/, async () => {
    // 服务在本机进程里，所以「打开文件夹」是真能做到的（浏览器做不到）
    const { spawn } = await import('node:child_process');
    const cmd = process.platform === 'win32' ? 'explorer' : process.platform === 'darwin' ? 'open' : 'xdg-open';
    try {
      spawn(cmd, [store.root], { detached: true, stdio: 'ignore' }).unref();
      return { opened: true, path: store.root };
    } catch (error) {
      return { opened: false, path: store.root, reason: error.message };
    }
  });

  /* --- 知识库 --- */
  route('GET', /^\/api\/v1\/knowledge-bases$/, async () => ({ items: await store.listKbs() }));
  route('POST', /^\/api\/v1\/knowledge-bases$/, async (ctx) => store.createKb(ctx.body));
  route('GET', /^\/api\/v1\/knowledge-bases\/([^/]+)$/, async (ctx) => {
    const kb = await store.getKb(decodeURIComponent(ctx.params[0]));
    if (!kb) {
      const error = new Error('知识库不存在');
      error.code = 'NOT_FOUND';
      throw error;
    }
    return kb;
  });
  route('DELETE', /^\/api\/v1\/knowledge-bases\/([^/]+)$/, async (ctx) => ({
    deleted: await store.deleteKb(decodeURIComponent(ctx.params[0])),
  }));

  /* --- 文档 --- */
  route('GET', /^\/api\/v1\/knowledge-bases\/([^/]+)\/documents$/, async (ctx) => {
    const kbId = decodeURIComponent(ctx.params[0]);
    const items = await store.listDocs(kbId);
    return { items, total: items.length };
  });

  route('POST', /^\/api\/v1\/knowledge-bases\/([^/]+)\/documents$/, async (ctx) => {
    const kbId = decodeURIComponent(ctx.params[0]);
    const ct = ctx.req.headers['content-type'] || '';
    if (ct.startsWith('multipart/form-data')) {
      const raw = await readBody(ctx.req);
      const parts = parseMultipart(raw, ct);
      const file = (parts || []).find((p) => p.fileName);
      if (!file) {
        const error = new Error('没有收到文件字段');
        error.code = 'VALIDATION_ERROR';
        throw error;
      }
      // 浏览器上传的文件名可能是完整路径（老 IE/某些客户端），只取最后一段
      const fileName = file.fileName.split(/[\\/]/).pop();
      return store.addDoc(kbId, { fileName, buffer: file.body });
    }
    const body = await readJsonBody(ctx.req);
    return store.addDoc(kbId, body);
  });

  route('GET', /^\/api\/v1\/documents\/([^/]+)$/, async (ctx) => {
    const detail = await store.getDocDetail(decodeURIComponent(ctx.params[0]));
    if (!detail) {
      const error = new Error('文档不存在');
      error.code = 'NOT_FOUND';
      throw error;
    }
    return detail.doc;
  });

  route('GET', /^\/api\/v1\/documents\/([^/]+)\/chunks$/, async (ctx) => {
    const detail = await store.getDocDetail(decodeURIComponent(ctx.params[0]));
    if (!detail) {
      const error = new Error('文档不存在');
      error.code = 'NOT_FOUND';
      throw error;
    }
    const page = Math.max(1, Number(ctx.query.get('page')) || 1);
    const size = Math.min(100, Math.max(1, Number(ctx.query.get('page_size')) || 20));
    const slice = detail.chunks.slice((page - 1) * size, page * size);
    return {
      items: slice.map((c) => ({
        id: `${detail.doc.id}-c${c.index}`,
        knowledgeId: detail.doc.id,
        chunkIndex: c.index,
        content: c.content,
        heading: c.heading,
        startAt: c.startAt,
        endAt: c.endAt,
      })),
      total: detail.chunks.length,
      page,
      pageSize: size,
    };
  });

  // 本地内核没有「处理轨迹」，返回空 trace 让界面显示「无轨迹」，而不是报错
  route('GET', /^\/api\/v1\/documents\/([^/]+)\/spans$/, async (ctx) => {
    const found = await store.findDoc(decodeURIComponent(ctx.params[0]));
    if (!found) {
      const error = new Error('文档不存在');
      error.code = 'NOT_FOUND';
      throw error;
    }
    return {
      documentId: found.doc.id,
      trace: { status: found.doc.parseStatus, children: [], source: 'local' },
      note: '本地内核同步解析，没有异步处理轨迹',
    };
  });

  route('DELETE', /^\/api\/v1\/documents\/([^/]+)$/, async (ctx) => ({
    deleted: await store.deleteDoc(decodeURIComponent(ctx.params[0])),
  }));

  /* --- 检索 --- */
  route('POST', /^\/api\/v1\/search$/, async (ctx) => {
    const result = await searcher.search({
      query: ctx.body.query,
      kbIds: ctx.body.knowledgeBaseIds,
      matchCount: ctx.body.matchCount,
    });
    return { items: result.items, total: result.items.length, meta: result.meta };
  });

  /* --- 会话与问答 --- */
  route('GET', /^\/api\/v1\/sessions$/, async () => ({ items: await store.listSessions() }));
  route('POST', /^\/api\/v1\/sessions$/, async (ctx) => store.createSession(ctx.body || {}));
  route('GET', /^\/api\/v1\/sessions\/([^/]+)\/messages$/, async (ctx) => {
    const limit = Number(ctx.query.get('limit')) || 30;
    const items = await store.listMessages(decodeURIComponent(ctx.params[0]), limit);
    return { items, total: items.length };
  });
  // POST 由 handleAsk 单独处理（要写 SSE）

  /* --- 采集 --- */
  route('POST', /^\/api\/v1\/clips$/, async (ctx) => store.createClip(ctx.body || {}));
  route('GET', /^\/api\/v1\/clips\/([^/]+)$/, async (ctx) => {
    const clip = await store.getClip(decodeURIComponent(ctx.params[0]));
    if (!clip) {
      const error = new Error('采集不存在');
      error.code = 'NOT_FOUND';
      throw error;
    }
    return clip;
  });
  route('POST', /^\/api\/v1\/clips\/([^/]+)\/commit$/, async (ctx) =>
    store.commitClip(decodeURIComponent(ctx.params[0]), ctx.body || {}),
  );
  route('GET', /^\/api\/v1\/jobs\/([^/]+)$/, async (ctx) => {
    const job = await store.getJob(decodeURIComponent(ctx.params[0]));
    if (!job) {
      const error = new Error('任务不存在');
      error.code = 'NOT_FOUND';
      throw error;
    }
    return job;
  });

  /* --- 插件与浏览器桥 --- */
  route('GET', /^\/api\/v1\/plugins$/, async () => ({
    items: [
      {
        id: 'local-core',
        name: '本地内核',
        version: VERSION,
        status: 'ready',
        note: '数据在本机共享目录；不联网',
      },
      {
        id: 'ollama',
        name: '本机模型（Ollama）',
        version: '',
        status: (await models()) ? 'ready' : 'absent',
        note: (await models()) ? '可用于生成式回答与向量检索' : '未检测到 127.0.0.1:11434',
      },
    ],
  }));
  route('GET', /^\/api\/v1\/browser\/status$/, async () => ({
    connected: false,
    browser: '',
    bskVersion: '',
    note: '本地内核不含浏览器桥；采集请用「粘贴正文」或上传文件',
  }));

  /* --- Wiki --- */
  route('GET', /^\/api\/v1\/knowledge-bases\/([^/]+)\/wiki\/tree$/, async (ctx) => {
    const kbId = decodeURIComponent(ctx.params[0]);
    const kb = await store.getKb(kbId);
    if (!kb) {
      const error = new Error('知识库不存在');
      error.code = 'NOT_FOUND';
      throw error;
    }
    const pages = await buildWikiTree(kbId, kb.name);
    return { items: pages, total: pages.length };
  });

  route('GET', /^\/api\/v1\/knowledge-bases\/([^/]+)\/wiki\/pages\/([^/]+)$/, async (ctx) => {
    const kbId = decodeURIComponent(ctx.params[0]);
    const slug = decodeURIComponent(ctx.params[1]);
    const pages = await buildWikiTree(kbId, '');
    const page = pages.find((p) => p.slug === slug);
    if (!page) {
      const error = new Error(`页面不存在：${slug}`);
      error.code = 'NOT_FOUND';
      throw error;
    }
    return page;
  });

  /**
   * 本地 Wiki 树：一台「索引页」+ 每篇文档一页 + 高频主题页。
   *
   * 不调模型 —— 生成式 Wiki 需要 LLM（见 docs/evidence/MODEL-CONFIG.md）。这里给的是**可检索的
   * 结构化视图**：主题页由文档间的共现词聚出来，正文是原文摘录 + 来源清单，所以每句话都能追到文件，
   * 不会出现「模型编出来的条目」。有本机模型时可以再上层做摘要，接口形状不用变。
   */
  async function buildWikiTree(kbId, kbName) {
    const docs = (await store.listDocs(kbId)).filter((d) => d.parseStatus === 'completed');
    const pages = [];
    pages.push({
      slug: 'index',
      title: `${kbName || '知识库'} · 索引`,
      type: 'hub',
      status: 'published',
      summary: `${docs.length} 篇文档的本地索引`,
      content: [
        `# ${kbName || '知识库'} · 索引`,
        '',
        ...docs.map((d) => `- [${d.title}](#${d.id}) — ${d.chunkCount} 块`),
      ].join('\n'),
      version: 1,
      updatedAt: nowIso(),
      sources: docs.map((d) => ({ knowledgeId: d.id, title: d.title, chunkCount: d.chunkCount })),
    });

    for (const doc of docs) {
      const detail = await store.getDocDetail(doc.id);
      pages.push({
        slug: `doc-${doc.id}`,
        title: doc.title,
        type: 'doc',
        status: 'published',
        summary: detail ? detail.summary : '',
        content: detail ? detail.content : '',
        version: 1,
        updatedAt: doc.processedAt || doc.createdAt,
        sources: [{ knowledgeId: doc.id, title: doc.title, chunkCount: doc.chunkCount }],
      });
    }

    // 主题页：跨文档出现 ≥2 次的词（2-gram 里通常是术语、标准号、零件名）
    const chunks = await store.allChunks([kbId]);
    const docFreq = new Map();
    for (const chunk of chunks) {
      const terms = new Set(
        (chunk.content.match(/[\u4e00-\u9fff]{2,6}|[A-Za-z]{2,}[0-9./-]*/g) || []).map((t) => t.trim()),
      );
      for (const term of terms) {
        if (!docFreq.has(term)) docFreq.set(term, new Set());
        docFreq.get(term).add(chunk.knowledgeId);
      }
    }
    const topics = [...docFreq.entries()]
      .filter(([term, set]) => set.size >= 2 && term.length >= 2 && term.length <= 12)
      .sort((a, b) => b[1].size - a[1].size)
      .slice(0, 8);
    for (const [term] of topics) {
      const hits = chunks.filter((c) => c.content.includes(term)).slice(0, 12);
      const sources = [...new Set(hits.map((h) => h.knowledgeId))];
      pages.push({
        slug: `topic-${encodeURIComponent(term).replace(/%/g, '')}`,
        title: term,
        type: 'topic',
        status: 'published',
        summary: `${sources.length} 篇文档提到「${term}」`,
        content: [
          `# ${term}`,
          '',
          ...hits.map(
            (h, i) => `**${i + 1}.** ${summarize(h.content, 220)}\n\n　来源：${h.knowledgeTitle} 第 ${h.chunkIndex + 1} 块`,
          ),
        ].join('\n\n'),
        version: 1,
        updatedAt: nowIso(),
        sources: sources.map((id) => ({
          knowledgeId: id,
          title: (docs.find((d) => d.id === id) || {}).title || id,
          chunkCount: hits.filter((h) => h.knowledgeId === id).length,
        })),
      });
    }
    return pages;
  }

  /* -------------------------------------------------------- SSE 问答流 */

  async function handleAsk(req, res, sessionId, body, requestId) {
    const query = String(body.query || body.content || '').trim();
    if (!query) {
      sendError(res, 400, 'VALIDATION_ERROR', '问题不能为空', requestId);
      return;
    }
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Request-Id': requestId,
    });
    let closed = false;
    req.on('close', () => {
      closed = true;
    });
    const emit = (obj) => {
      if (!closed) res.write(`data: ${JSON.stringify(obj)}\n\n`);
    };

    const assistantId = `msg-${shortId()}`;
    const found = await models();
    const chatModel = pickChatModel(found);

    let hits = [];
    try {
      const result = await searcher.search({
        query,
        kbIds: body.knowledgeBaseIds,
        matchCount: body.matchCount || 6,
      });
      hits = result.items;
      if (hits.length) {
        emit({
          responseType: 'references',
          knowledgeReferences: hits,
          sessionId,
          assistantMessageId: assistantId,
        });
      }
    } catch (error) {
      emit({ responseType: 'error', content: `检索失败：${error.message}` });
      emit({ responseType: 'complete' });
      res.end();
      return;
    }

    let answer = '';
    try {
      if (chatModel) {
        answer = await streamOllamaChat({
          model: chatModel,
          query,
          hits,
          emit,
          isClosed: () => closed,
        });
      } else {
        answer = composeExtractive(query, hits);
        // 抽取式也按片发，界面上的「流式」体验一致；但要快，别让用户干等
        for (let i = 0; i < answer.length; i += 28) {
          if (closed) break;
          emit({ responseType: 'answer', content: answer.slice(i, i + 28), sessionId, assistantMessageId: assistantId });
          await new Promise((r) => setTimeout(r, 12));
        }
      }
    } catch (error) {
      emit({ responseType: 'error', content: `生成失败：${error.message}` });
    }

    // 落库必须在 complete 之前：前端收到 complete 就会立刻去拉消息列表，
    // 先发 complete 再写盘会稳定地读到「空的」——这是上一版就踩过的时序坑。
    try {
      await store.appendMessage(sessionId, {
        id: `msg-${shortId()}`,
        role: 'user',
        content: query,
        createdAt: nowIso(),
      });
      await store.appendMessage(sessionId, {
        id: assistantId,
        role: 'assistant',
        content: answer,
        knowledgeReferences: hits,
        model: chatModel || 'local-extractive',
        createdAt: nowIso(),
      });
    } catch (_e) {
      /* 落库失败不影响本次回答，但内存里已经没有第二份副本可救 —— 界面重开会看不到这轮 */
    }

    emit({ responseType: 'complete', sessionId, assistantMessageId: assistantId });
    res.end();
  }

  /** Ollama /api/chat 的 NDJSON 流 → 我们的 SSE answer 分片。 */
  async function streamOllamaChat({ model, query, hits, emit, isClosed }) {
    const context = hits
      .slice(0, 6)
      .map((h, i) => `[${i + 1}] ${h.knowledgeTitle}：${h.content.slice(0, 600)}`)
      .join('\n\n');
    const messages = [
      {
        role: 'system',
        content:
          '你是工程资料助手。只依据给定资料回答，用中文，结论先行；引用资料时用 [编号] 标注。资料没有的内容直接说没有，不要编。',
      },
      { role: 'user', content: `资料：\n${context || '（本次没有检索到资料）'}\n\n问题：${query}` },
    ];
    const res = await fetch(`${OLLAMA()}/api/chat`, {
      method: 'POST',
      redirect: 'error',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages, stream: true }),
    });
    if (!res.ok || !res.body) throw new Error(`Ollama HTTP ${res.status}`);
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let text = '';
    while (true) {
      if (isClosed()) break;
      const step = await reader.read();
      if (step.done) break;
      buffer += decoder.decode(step.value, { stream: true });
      let nl = buffer.indexOf('\n');
      while (nl >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (line) {
          try {
            const obj = JSON.parse(line);
            const piece = obj.message && obj.message.content;
            if (piece) {
              text += piece;
              emit({ responseType: 'answer', content: piece });
            }
          } catch (_e) {
            /* 半行，忽略 */
          }
        }
        nl = buffer.indexOf('\n');
      }
    }
    return text;
  }

  /* ------------------------------------------------------------ 分发 */

  async function handle(req, res) {
    const requestId = `local-${Date.now().toString(36)}`;
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    const pathname = decodeURI(url.pathname);

    // DSH 页面与内核可在不同回环端口。只接受回环 Host 和浏览器 Origin。
    const isLoopback = (address) => {
      try {
        const parsed = new URL(address);
        return ['http:', 'https:'].includes(parsed.protocol)
          && ['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname)
          && !parsed.username && !parsed.password;
      } catch {
        return false;
      }
    };
    const origin = req.headers.origin;
    if (!req.headers.host || !isLoopback(`http://${req.headers.host}`)
        || (origin && (!isLoopback(origin) || (runtime === 'web' && origin !== `http://${req.headers.host}`)))
        || (!origin && req.headers['sec-fetch-site'] === 'cross-site')) {
      sendError(res, 403, 'LOCAL_ORIGIN_REQUIRED', '请从本机 Schanora 启动地址访问。', requestId);
      return;
    }
    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Accept,Authorization,X-API-Key');
    res.setHeader('Access-Control-Expose-Headers', 'X-Request-Id');
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    // SSE：问答
    const askMatch = /^\/api\/v1\/sessions\/([^/]+)\/messages$/.exec(pathname);
    if (askMatch && req.method === 'POST') {
      try {
        const body = await readJsonBody(req);
        await handleAsk(req, res, decodeURIComponent(askMatch[1]), body, requestId);
      } catch (error) {
        if (!res.headersSent) sendError(res, 400, error.code || 'LOCAL_ERROR', error.message, requestId);
        else res.end();
      }
      return;
    }

    for (const r of routes) {
      if (r.method !== req.method) continue;
      const m = r.pattern.exec(pathname);
      if (!m) continue;
      const ctx = {
        req,
        res,
        query: url.searchParams,
        params: m.slice(1),
        body: {},
        requestId,
      };
      try {
        if (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH') {
          const ct = req.headers['content-type'] || '';
          if (ct.startsWith('application/json')) ctx.body = await readJsonBody(req);
        }
        const data = await r.handler(ctx);
        sendJson(res, 200, data, requestId);
      } catch (error) {
        const status =
          error.code === 'NOT_FOUND' ? 404 : error.code === 'CONFLICT' ? 409 : error.code === 'VALIDATION_ERROR' ? 400 : 500;
        sendError(res, status, error.code || 'LOCAL_ERROR', error.message || '本地内核错误', requestId);
      }
      return;
    }

    if (req.method === 'GET' && pathname === '/api/v1/local/backup' && runtime === 'web') {
      try {
        const body = JSON.stringify(await createBackup(store.root));
        res.writeHead(200, {
          'Content-Type': 'application/json; charset=utf-8',
          'Content-Disposition': 'attachment; filename="schanora-backup.json"',
          'Cache-Control': 'no-store',
        });
        res.end(body);
      } catch (error) {
        sendError(res, 422, 'BACKUP_UNAVAILABLE', error.message, requestId);
      }
      return;
    }

    if (req.method === 'GET' && staticRoot) {
      if (await serveStatic(req, res, pathname, staticRoot)) return;
    }
    sendError(res, 404, 'NOT_IMPLEMENTED', `本地内核没有这个路由：${req.method} ${pathname}`, requestId);
  }

  async function serveStatic(req, res, pathname, rootDir) {
    const rel = pathname.replace(/^\/+/, '');
    const relativePath = rel || (runtime === 'web' ? 'web/index.html' : 'preview/index.html');
    const bundle = 'plugins/schanora/client/client.js';
    if (runtime === 'web') {
      const assets = new Set([
        'web/index.html', 'web/workspace.css', 'web/workspace.js', bundle,
        'preview/vendor/react.production.min.js', 'preview/vendor/react-dom.production.min.js',
      ]);
      if (!assets.has(relativePath)) return false;
    } else if (!relativePath.startsWith('preview/') && relativePath !== bundle) return false;
    let file = path.resolve(rootDir, relativePath);
    if (relativePath.startsWith('preview/')) {
      const previewRoot = path.join(rootDir, 'preview');
      if (file !== previewRoot && !file.startsWith(previewRoot + path.sep)) return false;
    }
    try {
      const stat = await fs.stat(file);
      if (stat.isDirectory()) file = path.join(file, 'index.html');
    } catch (_e) {
      return false;
    }
    try {
      const data = await fs.readFile(file);
      if (runtime === 'web' && relativePath === 'web/index.html') {
        res.setHeader('Content-Security-Policy',
          "default-src 'self'; connect-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; object-src 'none'; frame-ancestors 'none'");
      }
      res.writeHead(200, {
        'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
        'Content-Length': data.length,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      });
      res.end(data);
      return true;
    } catch (_e) {
      return false;
    }
  }

  const server = http.createServer((req, res) => {
    handle(req, res).catch((error) => {
      if (!res.headersSent) sendError(res, 500, 'LOCAL_ERROR', error.message || '本地内核异常');
      else res.end();
    });
  });

  return { server, store, searcher, capabilities, handle };
}

/**
 * 起服务。
 *
 * 端口策略：默认 4317，被占用就往后试 5 个。返回实际端口，宿主与前端据此对齐
 * （前端固定按 4317 起探，最多探 5 个，见 ui.js 的 detectLocalBase）。
 */
export async function startServer(options = {}) {
  const { server, store } = createServer(options);
  const restorePending = await fs.access(path.join(store.root, '.schanora-restore-incomplete'))
    .then(() => true, () => false);
  if (restorePending) throw new Error('数据目录包含未完成的恢复。请把备份恢复到另一个新目录。');
  const host = '127.0.0.1';
  const preferred = Number(options.port) || 4317;
  const attempts = options.port === 0 ? 1 : 5;
  let lastError = null;
  for (let i = 0; i < attempts; i++) {
    const port = options.port === 0 ? 0 : preferred + i;
    try {
      await new Promise((resolve, reject) => {
        const onError = (error) => {
          server.removeListener('listening', onListening);
          reject(error);
        };
        const onListening = () => {
          server.removeListener('error', onError);
          resolve();
        };
        server.once('error', onError);
        server.once('listening', onListening);
        server.listen(port, host);
      });
      const actual = server.address().port;
      return {
        server,
        store,
        root: store.root,
        port: actual,
        host,
        baseUrl: `http://${host}:${actual}`,
        close: () => new Promise((resolve) => server.close(() => resolve())),
      };
    } catch (error) {
      lastError = error;
      if (error.code !== 'EADDRINUSE') throw error;
    }
  }
  throw lastError || new Error('本地内核端口都被占用');
}
