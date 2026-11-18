/**
 * 引用校验：答案里的角标能不能落回本轮真实检索到的片段。
 *
 * 移植自 WeKnora_plugin_byDHS 0.4.0 `cite.js`（MIT）。上游校验的是 `[K#]` +
 * 内联 `knowledge_id/chunk`；本项目的答案角标是 `[1] [2]`（1 基，顺序即引用列表
 * 顺序），所以只保留"角标 → 证据"这条主线，内联 id 解析不适用，未移植。
 *
 * 判定三态：
 *   verified      角标序号落在本轮引用列表内，且该引用有文档 id 与分块号
 *   orphan        角标越界（例如只有 3 条引用却写了 [7]）
 *   unverifiable  引用本身缺文档 id / 分块号，点开也对不回原文
 */

/** 答案里出现的角标序号，去重、保序。 */
export function parseMarkers(answer) {
  const seen = new Set();
  const out = [];
  for (const match of String(answer ?? '').matchAll(/\[(\d{1,2})\]/g)) {
    const index = Number(match[1]);
    if (!seen.has(index)) {
      seen.add(index);
      out.push(index);
    }
  }
  return out;
}

function canTrace(ref) {
  if (!ref || typeof ref !== 'object') return false;
  const docId = String(ref.knowledgeId ?? '');
  const chunkOk = Number.isInteger(ref.chunkIndex) && ref.chunkIndex >= 0;
  return docId !== '' && chunkOk;
}

/**
 * 把答案里的每个角标对账到 refs（顺序即 [1]..[n]）。
 * @param {{answer: string, refs: object[]}} input
 * @returns {{ok: boolean, total: number, verified: number, unverified: number,
 *   citations: {index: number, status: string, title: string}[], orphans: number[]}}
 */
export function verifyCitations(input) {
  const answer = String(input?.answer ?? '');
  const refs = Array.isArray(input?.refs) ? input.refs : [];
  const citations = [];

  for (const index of parseMarkers(answer)) {
    const ref = refs[index - 1];
    if (!ref) {
      citations.push({ index, status: 'orphan', title: '' });
      continue;
    }
    citations.push({
      index,
      status: canTrace(ref) ? 'verified' : 'unverifiable',
      title: String(ref.title || ref.fileName || ''),
    });
  }

  const verified = citations.filter((c) => c.status === 'verified').length;
  const unverified = citations.length - verified;
  return {
    ok: citations.length > 0 && unverified === 0,
    total: citations.length,
    verified,
    unverified,
    citations,
    orphans: citations.filter((c) => c.status === 'orphan').map((c) => c.index),
  };
}

/* ------------------------------------------------------------------ 标签适配 */

/**
 * 现场联调发现（2026-11-16，A 真网关）：WeKnora 的合成答案里引用不一定是 `[n]`，
 * 也可能是内联标签：
 *
 *   <kb doc="差旅报销制度.md" chunk_id="fc791c69-…" kb_id="9d56b68…" />
 *
 * 面板的角标渲染只认 `[n]`，不转换就会把裸标签当正文显示。转换规则：
 *   · `chunk_id` 能对上引用列表里的某条 → 换成该条序号 `[n]`（1 基，与下方引用
 *     列表编号一致，点角标才落得回原文）；
 *   · 对不上 → 整段标签删掉（宁可不给角标，也不编一个落不回列表的假出处）；
 *   · 同一 chunk 多次出现 → 同一个序号，不重复编号。
 * 上游若完全不给引用标记，本函数无从下手 —— 答案就是无角标的，这是上游行为。
 */
export const KB_TAG = /<kb\b[^>]*>/gi;

/** 取标签属性值，单双引号都认（上游两种都出现过）。 */
export function tagAttr(tag, name) {
  const re = new RegExp(`${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i');
  const m = re.exec(String(tag || ''));
  if (!m) return '';
  return m[2] != null ? m[2] : m[3] != null ? m[3] : '';
}

/** 标签该落哪个序号：按 chunk_id 在引用列表中的位置（1 基）；落不回返回 0。 */
export function citationIndex(tag, refs) {
  const chunkId = tagAttr(tag, 'chunk_id');
  if (!chunkId) return 0;
  const list = Array.isArray(refs) ? refs : [];
  for (let i = 0; i < list.length; i += 1) {
    const ref = list[i];
    if (ref && (String(ref.id || '') === chunkId || String(ref.chunkId || '') === chunkId)) return i + 1;
  }
  return 0;
}

/** 把文本里的 `<kb/>` 换掉；没有标签时原样返回。 */
export function normalizeCitations(content, refs) {
  const text = content == null ? '' : String(content);
  if (!text || text.toLowerCase().indexOf('<kb') === -1) return text;
  return text.replace(KB_TAG, (tag) => {
    const n = citationIndex(tag, refs);
    return n ? `[${n}]` : '';
  });
}
