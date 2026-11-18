/**
 * 本地内核的读写层：知识库、文档、会话、采集、任务。
 *
 * 只做「把文件读成对象 / 把对象写成文件」，检索与 HTTP 在别的模块。
 * 所有写入走 paths.js 的原子写；所有读取对损坏文件宽容（坏一篇不影响整库）。
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  SCHEMA_VERSION,
  layout,
  ensureDir,
  readJson,
  writeFileAtomic,
  writeJsonAtomic,
  slugify,
  shortId,
  hashText,
  nowIso,
} from './paths.js';
import { chunkText, detectType, extractText, isSupported, summarize } from './text.js';

export function createStore(options = {}) {
  const L = layout(options.root);
  /** 分块缓存：正文没变（mtime+size 相同）就不重复解析。索引不落盘，这是唯一副本。 */
  const chunkCache = new Map();

  async function loadConfig() {
    const cfg = await readJson(L.config, null);
    if (!cfg || !Array.isArray(cfg.kbs)) {
      return { schemaVersion: SCHEMA_VERSION, createdAt: nowIso(), kbs: [] };
    }
    return { ...cfg, schemaVersion: SCHEMA_VERSION };
  }

  async function saveConfig(cfg) {
    await writeJsonAtomic(L.config, { ...cfg, updatedAt: nowIso() });
  }

  /* ------------------------------------------------------------ 知识库 */

  async function listKbs() {
    const cfg = await loadConfig();
    const out = [];
    for (const kb of cfg.kbs) {
      const docs = await listDocs(kb.id);
      out.push({
        ...kb,
        knowledgeCount: docs.length,
        chunkCount: docs.reduce((sum, d) => sum + (d.chunkCount || 0), 0),
      });
    }
    return out.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  }

  async function getKb(kbId) {
    const cfg = await loadConfig();
    return cfg.kbs.find((k) => k.id === kbId) || null;
  }

  async function createKb(input = {}) {
    const name = String(input.name || '').trim();
    if (!name) {
      const error = new Error('知识库名称不能为空');
      error.code = 'VALIDATION_ERROR';
      throw error;
    }
    const cfg = await loadConfig();
    if (cfg.kbs.some((k) => k.name === name)) {
      const error = new Error(`已存在同名知识库「${name}」`);
      error.code = 'CONFLICT';
      throw error;
    }
    const kb = {
      id: `kb-${shortId()}`,
      name,
      description: String(input.description || ''),
      type: String(input.type || 'document'),
      // 本地内核默认用内置检索（关键词 + 可选本地向量）；选了模型就只是记下来，由搜索层用
      embeddingModelId: String(input.embeddingModelId || ''),
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    cfg.kbs.push(kb);
    await saveConfig(cfg);
    await ensureDir(L.docsDir(kb.id));
    return kb;
  }

  async function deleteKb(kbId) {
    const cfg = await loadConfig();
    const next = cfg.kbs.filter((k) => k.id !== kbId);
    if (next.length === cfg.kbs.length) return false;
    await saveConfig({ ...cfg, kbs: next });
    // 只删子目录，根目录留着（可能有别人的东西）
    await fs.rm(L.kbDir(kbId), { recursive: true, force: true }).catch(() => {});
    return true;
  }

  /* ------------------------------------------------------------- 文档 */

  async function readDocMeta(file) {
    const meta = await readJson(file, null);
    if (!meta || !meta.id) return null;
    return meta;
  }

  /** 扫描某个库的 docs 目录。文件名就是 id 的稳定钥匙：`<slug>-<docId>.md`。 */
  async function listDocs(kbId) {
    const dir = L.docsDir(kbId);
    let names = [];
    try {
      names = await fs.readdir(dir);
    } catch (_e) {
      return [];
    }
    const metas = await Promise.all(
      names.filter((n) => n.endsWith('.json')).map((n) => readDocMeta(path.join(dir, n))),
    );
    return metas
      .filter(Boolean)
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  }

  async function findDoc(docId) {
    const cfg = await loadConfig();
    for (const kb of cfg.kbs) {
      const docs = await listDocs(kb.id);
      const hit = docs.find((d) => d.id === docId);
      if (hit) return { kb, doc: hit };
    }
    return null;
  }

  function publicDoc(meta) {
    return {
      id: meta.id,
      title: meta.title,
      fileName: meta.fileName,
      fileType: meta.fileType,
      fileSize: meta.fileSize,
      parseStatus: meta.parseStatus,
      embeddingModelId: meta.embeddingModelId || '',
      createdAt: meta.createdAt,
      processedAt: meta.processedAt || null,
      errorMessage: meta.errorMessage || '',
      pendingSubtasksCount: 0,
      chunkCount: meta.chunkCount || 0,
      lastActivityAt: meta.processedAt || meta.createdAt,
    };
  }

  /** 读正文 + 元数据，算出分块（带缓存）。正文按需读取，列表页不会把所有文档正文拉进内存。 */
  async function chunksOf(kbId, meta) {
    const mdPath = L.docPath(kbId, meta.fileBase);
    let stat;
    try {
      stat = await fs.stat(mdPath);
    } catch (_e) {
      return [];
    }
    const cached = chunkCache.get(mdPath);
    if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) return cached.chunks;
    const text = await fs.readFile(mdPath, 'utf8');
    const chunks = chunkText(text);
    chunkCache.set(mdPath, { mtimeMs: stat.mtimeMs, size: stat.size, chunks });
    return chunks;
  }

  async function getDocDetail(docId) {
    const found = await findDoc(docId);
    if (!found) return null;
    const mdPath = L.docPath(found.kb.id, found.doc.fileBase);
    let content = '';
    try {
      content = await fs.readFile(mdPath, 'utf8');
    } catch (_e) {
      content = '';
    }
    const chunks = await chunksOf(found.kb.id, found.doc);
    return {
      doc: publicDoc(found.doc),
      kbId: found.kb.id,
      content,
      chunks,
      summary: summarize(content, 240),
    };
  }

  /**
   * 上传/写入一篇文档。解析失败的文档也会落盘（正文留空、状态 failed、带原因），
   * 因为「为什么没进来」和「进来了」同样重要，不能静默丢掉用户上传的文件。
   */
  async function addDoc(kbId, input) {
    const kb = await getKb(kbId);
    if (!kb) {
      const error = new Error(`知识库不存在：${kbId}`);
      error.code = 'NOT_FOUND';
      throw error;
    }
    const fileName = String(input.fileName || 'untitled.txt');
    const buffer = Buffer.isBuffer(input.buffer) ? input.buffer : Buffer.from(String(input.text || ''), 'utf8');
    const docId = input.id || `doc-${shortId()}`;
    // 覆盖已有文档时必须复用原文件名：否则换个标题就多出一份孤儿文件，
    // 而 OneDrive 会把它同步成「同一篇文档的两个副本」——这正是本地存储最不该出现的形态。
    const previous = input.id ? (await listDocs(kbId)).find((d) => d.id === input.id) : null;
    const fileBase = previous
      ? previous.fileBase
      : `${slugify(fileName.replace(/\.[^.]+$/, ''), 40)}-${docId.slice(-6)}`;
    let text = '';
    let parseStatus = 'completed';
    let errorMessage = '';
    let note = '';
    let format = detectType(fileName);

    try {
      if (!isSupported(fileName)) {
        throw new Error(`本地内核不支持 .${format || '?'} 类型（支持 md/txt/csv/json/html/docx/pdf）`);
      }
      const extracted = extractText(buffer, fileName);
      text = extracted.text;
      format = extracted.format;
      note = extracted.note || '';
      if (!text.trim()) throw new Error('抽取到 0 个字符，可能是空文件或扫描件');
    } catch (error) {
      parseStatus = 'failed';
      errorMessage = error && error.message ? error.message : String(error);
    }

    const rev = hashText(text);
    const chunks = parseStatus === 'completed' ? chunkText(text) : [];
    await writeFileAtomic(L.docPath(kbId, fileBase), text ? `${text.replace(/\s+$/, '')}\n` : '');
    const meta = {
      schemaVersion: SCHEMA_VERSION,
      id: docId,
      fileBase,
      title: String(input.title || fileName.replace(/\.[^.]+$/, '')),
      fileName,
      fileType: format,
      fileSize: buffer.length,
      parseStatus,
      errorMessage,
      note,
      embeddingModelId: String(input.embeddingModelId || kb.embeddingModelId || ''),
      rev,
      chunkCount: chunks.length,
      createdAt: (previous && previous.createdAt) || input.createdAt || nowIso(),
      processedAt: nowIso(),
    };
    await writeJsonAtomic(L.docMeta(kbId, fileBase), meta);
    chunkCache.delete(L.docPath(kbId, fileBase));
    await saveConfig({ ...(await loadConfig()) }); // 触达 updatedAt，让「最近更新」有依据
    return publicDoc(meta);
  }

  async function deleteDoc(docId) {
    const found = await findDoc(docId);
    if (!found) return false;
    await fs.rm(L.docPath(found.kb.id, found.doc.fileBase), { force: true }).catch(() => {});
    await fs.rm(L.docMeta(found.kb.id, found.doc.fileBase), { force: true }).catch(() => {});
    chunkCache.delete(L.docPath(found.kb.id, found.doc.fileBase));
    return true;
  }

  /** 全库分块视图，检索层用它建倒排。带上 kb 与文档标题，命中结果才能标出处。 */
  async function allChunks(kbIds) {
    const cfg = await loadConfig();
    const wanted = Array.isArray(kbIds) && kbIds.length ? new Set(kbIds) : null;
    const out = [];
    for (const kb of cfg.kbs) {
      if (wanted && !wanted.has(kb.id)) continue;
      const docs = await listDocs(kb.id);
      for (const doc of docs) {
        if (doc.parseStatus !== 'completed') continue;
        const chunks = await chunksOf(kb.id, doc);
        for (const chunk of chunks) {
          out.push({
            id: `${doc.id}-c${chunk.index}`,
            kbId: kb.id,
            kbName: kb.name,
            knowledgeId: doc.id,
            knowledgeTitle: doc.title,
            knowledgeFilename: doc.fileName,
            chunkIndex: chunk.index,
            heading: chunk.heading,
            content: chunk.content,
            startAt: chunk.startAt,
            endAt: chunk.endAt,
            rev: doc.rev,
          });
        }
      }
    }
    return out;
  }

  /* ------------------------------------------------------------- 会话 */

  async function listSessions() {
    let names = [];
    try {
      names = await fs.readdir(L.sessionsDir);
    } catch (_e) {
      return [];
    }
    const list = await Promise.all(
      names
        .filter((n) => n.endsWith('.json'))
        .map(async (n) => readJson(path.join(L.sessionsDir, n), null)),
    );
    return list
      .filter((s) => s && s.id)
      .map(({ id, title, description, createdAt, updatedAt, messages }) => ({
        id,
        title,
        description: description || '',
        createdAt,
        updatedAt,
        messageCount: Array.isArray(messages) ? messages.length : 0,
      }))
      .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  }

  async function getSession(sessionId) {
    return readJson(L.sessionPath(sessionId), null);
  }

  async function createSession(input = {}) {
    const session = {
      id: `sess-${shortId()}`,
      title: String(input.title || '新会话'),
      description: String(input.description || ''),
      createdAt: nowIso(),
      updatedAt: nowIso(),
      messages: [],
    };
    await writeJsonAtomic(L.sessionPath(session.id), session);
    return session;
  }

  async function appendMessage(sessionId, message) {
    let session = await getSession(sessionId);
    if (!session) session = await createSession({ title: '新会话' });
    if (session.id !== sessionId) {
      // 前端可能拿着一个还不存在的会话 id 直接发问：就地落成这个 id，别另起一个
      session.id = sessionId;
    }
    session.messages.push(message);
    session.updatedAt = nowIso();
    if (!session.title || session.title === '新会话') {
      const firstUser = session.messages.find((m) => m.role === 'user');
      if (firstUser) session.title = summarize(firstUser.content, 24);
    }
    await writeJsonAtomic(L.sessionPath(session.id), session);
    return session;
  }

  async function listMessages(sessionId, limit = 30) {
    const session = await getSession(sessionId);
    if (!session) return [];
    const all = Array.isArray(session.messages) ? session.messages : [];
    return limit > 0 ? all.slice(-limit) : all;
  }

  /* ------------------------------------------------------------- 采集 */

  async function createClip(input = {}) {
    const clip = {
      id: `clip-${shortId()}`,
      status: 'draft',
      captureMode: String(input.captureMode || 'markdown'),
      sourceUrl: String(input.sourceUrl || ''),
      title: String(input.title || '未命名采集'),
      content: String(input.content || ''),
      targetKbId: String(input.targetKbId || ''),
      engineeringMetadata: input.engineeringMetadata || {},
      dedupeKey: hashText(`${input.sourceUrl || ''}|${input.title || ''}|${String(input.content || '').slice(0, 4000)}`),
      revision: 1,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    await writeJsonAtomic(L.clipPath(clip.id), clip);
    return clip;
  }

  async function getClip(clipId) {
    return readJson(L.clipPath(clipId), null);
  }

  /**
   * 提交采集：写进目标库。
   *
   * 幂等：同一个 idempotencyKey 再来一次直接返回上次结果，不重复建文档 —— 网络重试
   * 与「连点两下」在本地同样会发生（界面上的按钮没有防抖）。
   * 版本：命中 dedupeKey 时复用同一篇文档做覆盖（revision+1），而不是堆第二份。
   */
  async function commitClip(clipId, input = {}) {
    const clip = await getClip(clipId);
    if (!clip) {
      const error = new Error(`采集不存在：${clipId}`);
      error.code = 'NOT_FOUND';
      throw error;
    }
    if (input.idempotencyKey && clip.lastIdempotencyKey === input.idempotencyKey) {
      return clip;
    }
    if (typeof input.expectedRevision === 'number' && input.expectedRevision !== clip.revision) {
      const error = new Error(`采集已被修改：期望 revision ${input.expectedRevision}，实际 ${clip.revision}`);
      error.code = 'CONFLICT';
      throw error;
    }
    const targetKbId = String(input.targetKbId || clip.targetKbId || '');
    const kb = await getKb(targetKbId);
    if (!kb) {
      const error = new Error('提交失败：没有可写入的知识库');
      error.code = 'VALIDATION_ERROR';
      throw error;
    }

    const existing = (await listDocs(targetKbId)).find((d) => d.rev === hashText(clip.content));
    const doc = await addDoc(targetKbId, {
      id: existing ? existing.id : undefined,
      fileName: `${slugify(clip.title, 40)}.md`,
      text: clip.content,
      title: clip.title,
      createdAt: existing ? existing.createdAt : undefined,
    });

    const jobId = `job-${shortId()}`;
    const job = {
      id: jobId,
      status: 'succeeded',
      clipId: clip.id,
      documentId: doc.id,
      kbId: targetKbId,
      createdAt: nowIso(),
      finishedAt: nowIso(),
      note: existing ? '内容与已有文档一致，已覆盖同一篇（版本 +1）' : '新建文档',
    };
    await writeJsonAtomic(L.jobPath(jobId), job);

    const next = {
      ...clip,
      status: 'committed',
      targetKbId,
      documentId: doc.id,
      jobId,
      revision: clip.revision + 1,
      lastIdempotencyKey: input.idempotencyKey || '',
      committedAt: nowIso(),
      updatedAt: nowIso(),
    };
    await writeJsonAtomic(L.clipPath(clip.id), next);
    return next;
  }

  async function getJob(jobId) {
    return readJson(L.jobPath(jobId), null);
  }

  /* ------------------------------------------------------------- 统计 */

  async function stats() {
    const kbs = await listKbs();
    const docs = kbs.reduce((n, k) => n + (k.knowledgeCount || 0), 0);
    const chunks = kbs.reduce((n, k) => n + (k.chunkCount || 0), 0);
    return { root: L.root, kbCount: kbs.length, docCount: docs, chunkCount: chunks };
  }

  return {
    root: L.root,
    layout: L,
    loadConfig,
    listKbs,
    getKb,
    createKb,
    deleteKb,
    listDocs,
    findDoc,
    getDocDetail,
    addDoc,
    deleteDoc,
    chunksOf,
    allChunks,
    listSessions,
    getSession,
    createSession,
    appendMessage,
    listMessages,
    createClip,
    getClip,
    commitClip,
    getJob,
    stats,
  };
}
