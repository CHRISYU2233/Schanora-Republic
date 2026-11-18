/**
 * 文档标签（分类）——WorkBuddy 资料库「分类/标签」能力的本面板实现。
 *
 * 落点：文档级标签是纯前端标注（localStorage），不对接网关 —— 网关契约
 * （docs/api.md 3.x）没有标签端点，服务端持久化属 A 侧待办，不在 B 侧伪造。
 * 数据结构与导出格式保持简单稳定：
 *   标签表  { [docId]: string[] }          —— doc → 标签列表（去重、保序）
 *   导出件  { kind, version, exportedAt, tags }
 * 全部判定逻辑写成纯函数，单测在 test/tags.test.mjs。
 */

/** 单个标签的规范化：去空白、去首部 #、压缩内部空白、限长。 */
export function normalizeTag(raw) {
  const s = String(raw ?? '').trim().replace(/^#+/, '').replace(/\s+/g, ' ').trim();
  return s.slice(0, 24);
}

/** 标签输入解析：逗号（中英）/分号/顿号分隔 → 规范化 + 去重保序，单文档上限 12 个。
 *  空白不算分隔符：标签内部允许空格（如「GB/T 5782」）。 */
export function parseTagInput(input) {
  const parts = String(input ?? '').split(/[,，;；、]+/);
  const seen = new Set();
  const out = [];
  for (const part of parts) {
    const tag = normalizeTag(part);
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    out.push(tag);
    if (out.length >= 12) break;
  }
  return out;
}

/** 标签表规范化：丢空值、每文档去重，空数组文档整体剔除。 */
export function normalizeTagMap(map) {
  const out = {};
  if (!map || typeof map !== 'object') return out;
  for (const [docId, tags] of Object.entries(map)) {
    if (!docId || !Array.isArray(tags)) continue;
    const seen = new Set();
    const list = [];
    for (const raw of tags) {
      const tag = normalizeTag(raw);
      if (!tag || seen.has(tag)) continue;
      seen.add(tag);
      list.push(tag);
    }
    if (list.length) out[docId] = list;
  }
  return out;
}

/** 全部标签清单（按引用文档数降序，同数按字典序），用于筛选 chips。 */
export function allTags(map) {
  const counts = new Map();
  for (const tags of Object.values(normalizeTagMap(map))) {
    for (const tag of tags) counts.set(tag, (counts.get(tag) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => (b[1] - a[1]) || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([tag, n]) => ({ tag, n }));
}

/** 按标签过滤文档列表（OR：任一命中即保留）；tag 为空返回原列表。 */
export function filterDocsByTag(docs, tag, map) {
  if (!tag) return docs;
  const norm = normalizeTagMap(map);
  return (docs || []).filter((doc) => doc && (norm[doc.id] || []).includes(tag));
}

/** 导入合并：同文档标签取并集（保序：先已有后新增），两边都规范化。 */
export function mergeTagMaps(base, incoming) {
  const out = normalizeTagMap(base);
  for (const [docId, tags] of Object.entries(normalizeTagMap(incoming))) {
    const seen = new Set(out[docId] || []);
    const merged = out[docId] ? [...out[docId]] : [];
    for (const tag of tags) {
      if (seen.has(tag)) continue;
      seen.add(tag);
      merged.push(tag);
      if (merged.length >= 12) break;
    }
    if (merged.length) out[docId] = merged;
  }
  return out;
}

/** 导出件序列化：固定信封，便于异机/异库辨认与导入校验。 */
export function serializeTags(map) {
  return JSON.stringify(
    { kind: 'schanora.doctags', version: 1, exportedAt: new Date().toISOString(), tags: normalizeTagMap(map) },
    null,
    2,
  );
}

/** 导入件解析：只认本信封（kind + version），返回 { tags } 或抛错（中文消息）。 */
export function parseImportedTags(text) {
  let raw;
  try {
    raw = JSON.parse(String(text ?? ''));
  } catch (_e) {
    throw new Error('文件不是合法的 JSON');
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('文件结构不对：需要标签导出件');
  if (raw.kind !== 'schanora.doctags') throw new Error('文件 kind 不符：这不是 Schanora 标签导出件');
  if (Number(raw.version) !== 1) throw new Error(`不支持的导出件版本：${raw.version}`);
  return { tags: normalizeTagMap(raw.tags) };
}

/** 最近打开记录的收敛：去重（同 id 只留最新）、按时间倒序、封顶 limit 条。 */
export function pushRecent(list, entry, limit = 10) {
  const rest = (list || []).filter((x) => x && x.id !== entry.id);
  return [entry, ...rest].slice(0, limit);
}
