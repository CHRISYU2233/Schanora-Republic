/**
 * 检索与作答：本地倒排（BM25）+ 可选本地向量。
 *
 * ── 为什么默认是 BM25，而不是先上向量 ──
 *
 * 用户当前的 embedding 模型还没落地。这个内核必须**在没有任何模型、没有任何 API Key 的情况下
 * 就能用**，否则「全部本地跑」是空话。BM25 对中文按 2-gram 切，工程文档里的标准号
 * （GB/T 3098.1、M10、8.8 级）恰好是它的强项 —— 精确词面命中。
 *
 * 一旦本机有 Ollama 且在库上选了 embedding 模型，就自动升级成混合检索
 * （向量管语义召回、BM25 管精确词面），不需要改任何配置。降级也是自动的：Ollama 掉了就退回 BM25，
 * 并在 meta.mode 里如实说明本次是怎么检索的。
 */
import { tokenize, summarize } from './text.js';

const OLLAMA = () => {
  const endpoint = new URL(process.env.OLLAMA_HOST || 'http://127.0.0.1:11434');
  if (!['http:', 'https:'].includes(endpoint.protocol) ||
      !['127.0.0.1', 'localhost', '[::1]'].includes(endpoint.hostname) ||
      endpoint.username || endpoint.password || endpoint.search || endpoint.hash) {
    throw new Error('Ollama 只支持本机回环地址');
  }
  return endpoint.href.replace(/\/+$/, '');
};

/* --------------------------------------------------------------- 倒排索引 */

/**
 * 建索引。语料变了才重建 —— 用「块数 + 内容哈希」做签名，比逐块比较便宜得多。
 * 索引只存在内存里（见 paths.js：不落盘就不会被同步盘玩坏）。
 */
export function buildIndex(chunks) {
  const df = new Map();
  const postings = new Map(); // term -> Map(chunkPos -> tf)
  let totalLen = 0;
  const lens = new Array(chunks.length);
  chunks.forEach((chunk, pos) => {
    const toks = tokenize(`${chunk.heading || ''} ${chunk.content}`);
    lens[pos] = toks.length;
    totalLen += toks.length;
    const tfLocal = new Map();
    for (const term of toks) tfLocal.set(term, (tfLocal.get(term) || 0) + 1);
    for (const [term, tf] of tfLocal) {
      if (!postings.has(term)) postings.set(term, new Map());
      postings.get(term).set(pos, tf);
      df.set(term, (df.get(term) || 0) + 1);
    }
  });
  return { chunks, df, postings, lens, avgLen: chunks.length ? totalLen / chunks.length : 0, N: chunks.length };
}

/** BM25（k1=1.2, b=0.75）。中文 2-gram 的 idf 天然偏低，这里的下限保护避免长文档通吃。 */
export function bm25(index, query, topK = 8) {
  const terms = tokenize(query);
  if (!terms.length || !index.N) return [];
  const k1 = 1.2;
  const b = 0.75;
  const scores = new Float64Array(index.N);
  for (const term of new Set(terms)) {
    const posting = index.postings.get(term);
    if (!posting) continue;
    const dfTerm = index.df.get(term) || 0;
    const idf = Math.log(1 + (index.N - dfTerm + 0.5) / (dfTerm + 0.5));
    for (const [pos, tf] of posting) {
      const norm = 1 - b + (b * (index.lens[pos] || 0)) / (index.avgLen || 1);
      scores[pos] += idf * ((tf * (k1 + 1)) / (tf + k1 * norm));
    }
  }
  const ranked = [];
  for (let i = 0; i < scores.length; i++) {
    if (scores[i] > 0) ranked.push({ pos: i, score: scores[i] });
  }
  ranked.sort((a, b2) => b2.score - a.score);
  return ranked.slice(0, topK);
}

/* ------------------------------------------------------------- 本机模型 */

async function fetchJson(url, options = {}, timeoutMs = 1200) {
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = setTimeout(() => ctrl && ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, redirect: 'error', signal: ctrl ? ctrl.signal : undefined });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/** 探本机 Ollama。探不到不是错误 —— 只是没有本地模型，检索退回纯 BM25。 */
export async function probeOllama() {
  try {
    const data = await fetchJson(`${OLLAMA()}/api/tags`, {}, 900);
    const models = Array.isArray(data.models) ? data.models : [];
    return models.filter((m) => {
      const name = String(m.name || m.model || '');
      return !m.remote_model && !m.remote_host && !/[-:]cloud(?:$|:)/i.test(name);
    }).map((m) => ({
      id: String(m.name || m.model || ''),
      name: String(m.name || m.model || ''),
      displayName: String(m.name || m.model || ''),
      source: 'ollama',
      type: guessModelType(m),
      isDefault: false,
    })).filter((m) => m.id);
  } catch (_e) {
    return null;
  }
}

const EMBED_HINTS = ['bge', 'embed', 'gte', 'e5', 'text-embedding', 'm3e', 'jina'];
const CHAT_HINTS = ['llama', 'qwen', 'deepseek', 'mistral', 'gemma', 'phi', 'glm', 'yi'];

function guessModelType(model) {
  const name = String(model.name || model.model || '').toLowerCase();
  if (EMBED_HINTS.some((h) => name.includes(h))) return 'Embedding';
  if (CHAT_HINTS.some((h) => name.includes(h))) return 'Chat';
  return 'Unknown';
}

/** 取向量。优先 /api/embed（批量），老版本 Ollama 只有 /api/embeddings（单条）。 */
export async function embedTexts(texts, model) {
  const clean = texts.map((t) => String(t || '').slice(0, 4000));
  try {
    const data = await fetchJson(
      `${OLLAMA()}/api/embed`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model, input: clean }) },
      20000,
    );
    if (Array.isArray(data.embeddings) && data.embeddings.length === clean.length) return data.embeddings;
  } catch (_e) {
    /* 落到单条接口 */
  }
  const out = [];
  for (const text of clean) {
    const data = await fetchJson(
      `${OLLAMA()}/api/embeddings`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model, prompt: text }) },
      20000,
    );
    out.push(data.embedding || []);
  }
  return out;
}

function cosine(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (!na || !nb) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/* ---------------------------------------------------------------- 检索器 */

export function createSearcher(store) {
  let cache = { key: '', index: null };
  const embedCache = new Map(); // `${rev}:${chunkIndex}` -> vector

  async function indexFor(kbIds) {
    const chunks = await store.allChunks(kbIds);
    const revs = chunks.map((c) => c.rev).join('|');
    const key = `${chunks.length}:${revs.length}:${chunks.length ? chunks[0].id : ''}:${chunks.length ? chunks[chunks.length - 1].id : ''}`;
    if (cache.key === key && cache.index) return cache.index;
    cache = { key, index: buildIndex(chunks) };
    return cache.index;
  }

  /**
   * 检索。
   * @returns {{items: Array, meta: {mode: string, took: number, scanned: number, model?: string}}}
   */
  async function search(input = {}) {
    const started = Date.now();
    const query = String(input.query || '').trim();
    const matchCount = Math.min(Math.max(Number(input.matchCount) || 6, 1), 50);
    if (!query) return { items: [], meta: { mode: 'empty', took: 0, scanned: 0 } };

    const index = await indexFor(input.kbIds);
    // 多取一些候选，向量重排只在候选集上做（全量算向量对本地 CPU 太贵）
    const lexical = bm25(index, query, Math.max(matchCount * 4, 24));
    if (!lexical.length) {
      return { items: [], meta: { mode: 'bm25', took: Date.now() - started, scanned: index.N } };
    }
    const maxScore = lexical[0].score || 1;
    const candidates = lexical.map((hit) => {
      const chunk = index.chunks[hit.pos];
      return {
        chunk,
        lexical: hit.score / maxScore,
        score: hit.score / maxScore,
      };
    });

    // 有本地 embedding 模型就把语义分混进来
    let mode = 'bm25';
    let model = '';
    const cfg = await store.loadConfig();
    const wanted = (input.kbIds && input.kbIds.length
      ? cfg.kbs.filter((k) => input.kbIds.includes(k.id))
      : cfg.kbs
    ).map((k) => k.embeddingModelId).filter(Boolean);
    if (wanted.length) {
      model = wanted[0];
      try {
        const queryVec = (await embedTexts([query], model))[0];
        if (queryVec && queryVec.length) {
          const need = candidates.filter((c) => !embedCache.has(`${c.chunk.rev}:${c.chunk.chunkIndex}`));
          if (need.length) {
            const vectors = await embedTexts(need.map((c) => c.chunk.content), model);
            need.forEach((c, i) => {
              if (vectors[i]) embedCache.set(`${c.chunk.rev}:${c.chunk.chunkIndex}`, vectors[i]);
            });
          }
          for (const c of candidates) {
            const vec = embedCache.get(`${c.chunk.rev}:${c.chunk.chunkIndex}`);
            const semantic = vec ? Math.max(0, cosine(queryVec, vec)) : 0;
            c.score = 0.62 * semantic + 0.38 * c.lexical;
          }
          mode = 'hybrid';
        }
      } catch (_e) {
        // 模型掉了就诚实退回关键词，不假装混合过
        mode = 'bm25';
        model = '';
      }
    }

    candidates.sort((a, b) => b.score - a.score);
    const items = candidates.slice(0, matchCount).map((c) => ({
      id: c.chunk.id,
      content: c.chunk.content,
      knowledgeId: c.chunk.knowledgeId,
      knowledgeTitle: c.chunk.knowledgeTitle,
      knowledgeFilename: c.chunk.knowledgeFilename,
      knowledgeBaseId: c.chunk.kbId,
      chunkIndex: c.chunk.chunkIndex,
      score: Math.round(c.score * 1000) / 1000,
      matchType: mode === 'hybrid' ? 2 : 1,
      versionId: c.chunk.rev,
      startAt: c.chunk.startAt,
      endAt: c.chunk.endAt,
    }));

    return {
      items,
      meta: {
        mode,
        ...(model ? { model } : {}),
        took: Date.now() - started,
        scanned: index.N,
        // 判据用：告诉调用方这次到底用没用向量，避免「看起来混合了其实只有关键词」
        embedAvailable: mode === 'hybrid',
      },
    };
  }

  return { search };
}

/* ---------------------------------------------------------------- 作答 */

/**
 * 无模型时的抽取式作答。
 *
 * 不做「假装生成」：直接说明这是**摘录**，按命中顺序编号，每条后面标来源。
 * 有本地 chat 模型时走 streamAnswer（在 http.js 里），这里只负责兜底。
 */
export function composeExtractive(query, hits) {
  if (!hits.length) {
    return `库里没有检索到与「${query}」相关的片段。可以换个问法，或确认所需文档已经处理完成。`;
  }
  const lines = [`按「${query}」检索到 ${hits.length} 段资料，以下为原文摘录（本机未接生成模型）：`, ''];
  hits.slice(0, 4).forEach((hit, i) => {
    lines.push(`【${i + 1}】${summarize(hit.content, 260)}`);
    lines.push(`　　— ${hit.knowledgeTitle || hit.knowledgeFilename || '未知文档'} 第 ${(hit.chunkIndex ?? 0) + 1} 块`);
    lines.push('');
  });
  lines.push('提示：接上本机 Ollama 的对话模型后，这里会改成生成式回答，检索与引用不变。');
  return lines.join('\n');
}

export { OLLAMA };
