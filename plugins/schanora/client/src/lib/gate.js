/**
 * 证据门槛：判断一条检索片段够不够格当"证据"。
 *
 * 移植自 WeKnora_plugin_byDHS 0.4.0 `gate.js`（MIT）。上游是给宿主用的：
 * 低于门槛的片段直接不进模型上下文。本项目是前端，用户要看到"召回全集"，
 * 所以这里只标注、不丢弃 —— 把 kept/dropped 的判定留给界面去表达。
 *
 * 相对上游的改动：
 *   1. 字段名从 snake_case 换成前端 normalizeHit 的 camelCase；
 *   2. 不返回筛选后的数组，改为逐条附带 coverage / hasProvenance / meetsGate；
 *   3. 保留 minCoverage 默认值 0.34 与分词规则，保证同一句话在两端判定一致。
 */

const CJK_RUN = /[\u3400-\u9fff\uf900-\ufaff]+/g;
const LATIN_WORD = /[a-z0-9][a-z0-9_+#.-]{1,}/g;

/** 疑问句里不承载检索信息的字/词，参与覆盖率会稀释结果。 */
const STOP_CHARS = /[的了吗呢啊呀吧嘛哦嗯是]/g;
const STOP_WORDS = /(多少|什么|怎么|怎样|如何|为什么|哪些|哪个|是否|可以|能不能|请问|一下|我们|你们|他们|这个|那个|有没有)/g;

/** 上游默认门槛：词面覆盖率低于 34% 的片段不足以支撑引用。 */
export const MIN_COVERAGE = 0.34;

/**
 * 把查询拆成用于覆盖率计算的词项：拉丁词 + 中文单字与二元组。
 * 不用分词器：二元组足以让中文覆盖率有区分度，且零依赖。
 * @param {string} text
 * @returns {string[]}
 */
export function queryTerms(text) {
  const lower = String(text ?? '').toLowerCase().replace(STOP_WORDS, ' ').replace(STOP_CHARS, '');
  const terms = new Set();
  for (const word of lower.match(LATIN_WORD) ?? []) terms.add(word);
  for (const run of lower.match(CJK_RUN) ?? []) {
    if (run.length === 1) terms.add(run);
    for (let i = 0; i + 1 < run.length; i += 1) terms.add(run.slice(i, i + 2));
  }
  return [...terms];
}

/**
 * 查询词项在片段里出现的比例，0..1。
 * @param {string[]} terms
 * @param {string} content
 * @returns {number}
 */
export function coverageOf(terms, content) {
  if (!terms.length) return 1;
  const haystack = String(content ?? '').toLowerCase();
  let hit = 0;
  for (const term of terms) if (haystack.includes(term)) hit += 1;
  return hit / terms.length;
}

/**
 * 片段是否可以事后核对：必须有文档 id、非负分块号、正文。
 * 缺任何一项都无法把引用落回原文，因而不算证据（上游同规则）。
 * @param {object} hit
 * @returns {boolean}
 */
export function hasProvenance(hit) {
  if (!hit || typeof hit !== 'object') return false;
  const docId = String(hit.knowledgeId ?? '');
  const chunkOk = Number.isInteger(hit.chunkIndex) && hit.chunkIndex >= 0;
  return docId !== '' && chunkOk && String(hit.content ?? '') !== '';
}

function round(value, digits = 4) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

/**
 * 给每条命中算覆盖率并判定是否过门槛。
 * @param {string} query
 * @param {object[]} hits 前端 normalizeHit 的形状
 * @param {{minCoverage?: number}} [options]
 * @returns {{hits: object[], diagnostics: object}}
 */
export function annotateHits(query, hits, options = {}) {
  const minCoverage = typeof options.minCoverage === 'number' ? options.minCoverage : MIN_COVERAGE;
  const terms = queryTerms(query);
  const rows = [];
  const diagnostics = {
    total: 0,
    kept: 0,
    lowCoverage: 0,
    missingProvenance: 0,
    queryTerms: terms.length,
    minCoverage,
    topCoverage: 0,
  };

  for (const hit of Array.isArray(hits) ? hits : []) {
    diagnostics.total += 1;
    const provenance = hasProvenance(hit);
    const coverage = round(coverageOf(terms, hit.content));
    diagnostics.topCoverage = Math.max(diagnostics.topCoverage, coverage);
    if (!provenance) diagnostics.missingProvenance += 1;
    else if (coverage < minCoverage) diagnostics.lowCoverage += 1;
    else diagnostics.kept += 1;
    rows.push({ ...hit, coverage, hasProvenance: provenance, meetsGate: provenance && coverage >= minCoverage });
  }

  return { hits: rows, diagnostics };
}
