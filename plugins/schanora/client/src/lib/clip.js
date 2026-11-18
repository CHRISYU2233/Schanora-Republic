/**
 * 采集/批量导入的纯函数库（P1 / P4 共用）。
 *
 * 设计依据：交接包 HANDOFF §5（P1 网页剪藏）与 §9（ClipService 设计目标）：
 *   - 去重键 = 目标库 + 规范化 URL + 内容 hash；URL 去跟踪参数但保留业务参数
 *   - 同键同 hash → 复用现有版本，不产生新副本；同键新 hash → 形成可追溯新版本
 *   - 候选状态机 draft→capturing→previewReady→committing→queued→processing→ready/failed/cancelled
 *   - 批量导入逐项幂等：成功项续跑时跳过，失败项可单独重试
 *
 * 这里的 contentHash 是客户端去重提示（演示与预检用）；服务端入库时必须
 * 用自己的实现对内容重新计算哈希，不能信任客户端上报值。
 */

/** 常见跟踪参数：去这些不影响资料定位。业务参数（料号/版本号等）不在名单里。 */
export const TRACKING_PARAMS = new Set([
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'utm_id',
  'gclid',
  'fbclid',
  'msclkid',
  'yclid',
  'spm',
  'scm',
  'share_token',
  'from',
  'is_from_webapp',
  'share_source',
  'tt_from',
  'referrer',
]);

/**
 * 规范化 URL：小写协议/主机、去跟踪参数、去 #fragment、参数按字典序排序。
 * 保留可能影响料号/版本的业务参数（不在 TRACKING_PARAMS 里的全部保留）。
 * 返回 { ok, url, reason }；不合法的输入给 ok:false 与可读原因，不抛异常。
 */
export function normalizeUrl(raw) {
  const input = String(raw == null ? '' : raw).trim();
  if (!input) return { ok: false, url: '', reason: 'EMPTY' };
  let u;
  try {
    u = new URL(input);
  } catch (_e) {
    return { ok: false, url: '', reason: 'INVALID_URL' };
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    return { ok: false, url: '', reason: 'UNSUPPORTED_SCHEME' };
  }
  u.hash = '';
  u.hostname = u.hostname.toLowerCase();
  const keep = [];
  u.searchParams.forEach((value, key) => {
    if (!TRACKING_PARAMS.has(key.toLowerCase())) keep.push([key, value]);
  });
  keep.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  u.search = '';
  keep.forEach(([k, v]) => u.searchParams.append(k, v));
  return { ok: true, url: u.toString(), reason: '' };
}

/**
 * 内容指纹（FNV-1a 32bit × 4 轮不同种子拼接成 32 hex）。
 * 确定性：同一段 Markdown 永远同一个值，跨会话/跨刷新可复现。
 * 不做加密用途，只做去重提示。
 */
export function contentHash(text) {
  const s = String(text == null ? '' : text);
  const seeds = [0x811c9dc5, 0x01000193, 0x7fffffff, 0x9e3779b9];
  const rounds = seeds.map((seed) => {
    let h = seed >>> 0;
    for (let i = 0; i < s.length; i += 1) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h.toString(16).padStart(8, '0');
  });
  return rounds.join('');
}

/** 去重键：目标库 + 规范化 URL（无 URL 的笔记用 origin='note'）+ 内容 hash。
 *  它是「这一次内容」的幂等键：同内容重复提交命中它，不产生副本。 */
export function dedupeKey(targetKbId, normalizedUrl, hash) {
  const kb = String(targetKbId || '').trim();
  if (!kb) return '';
  const origin = String(normalizedUrl || '').trim() || 'note';
  return `${kb}::${origin}::${hash}`;
}

/**
 * 来源键：一份资料的「身份」，不含内容 hash。
 *   - 有 URL：库 + 规范化 URL（同一页面内容更新 = 新版本，不是新文档）
 *   - 笔记无 URL：库 + note + 归一化标题（同一份笔记改动 = 新版本）
 * 版本链挂在来源键下，hash 只用于判断「内容有没有变」。
 */
export function sourceKey(targetKbId, normalizedUrl, title) {
  const kb = String(targetKbId || '').trim();
  if (!kb) return '';
  const url = String(normalizedUrl || '').trim();
  if (url) return `${kb}::${url}`;
  const t = String(title || '').trim().toLowerCase().replace(/\s+/g, ' ');
  return `${kb}::note::${t}`;
}

/** 候选状态机的合法迁移表。任何不在表里的迁移都拒绝。 */
export const CLIP_TRANSITIONS = {
  draft: ['capturing', 'cancelled'],
  capturing: ['previewReady', 'failed', 'cancelled'],
  previewReady: ['committing', 'cancelled'],
  committing: ['queued', 'failed', 'cancelled'],
  queued: ['processing', 'failed', 'cancelled'],
  processing: ['ready', 'failed', 'cancelled'],
  ready: [],
  failed: ['previewReady'], // 失败后允许回到预览重新提交（幂等键不变）
  cancelled: [],
};

export const CLIP_STATE_ORDER = ['draft', 'capturing', 'previewReady', 'committing', 'queued', 'processing', 'ready'];

/** 状态迁移：合法返回下一状态，非法返回 null（调用方必须当 bug 处理，不能静默吞）。 */
export function nextClipState(current, action) {
  const table = CLIP_TRANSITIONS[current];
  if (!table) return null;
  if (action === 'cancel') return table.includes('cancelled') ? 'cancelled' : null;
  if (action === 'retry') return current === 'failed' ? 'previewReady' : null;
  const step = CLIP_STATE_ORDER[CLIP_STATE_ORDER.indexOf(current) + 1];
  if (table.includes(step)) return step;
  return null;
}

/**
 * 版本裁决：给定库内已有的同键记录与本次内容 hash，决定本次提交的结果。
 *   - 同键同 hash → { action:'reuse', versionId } 不新建版本（重复提交只产生一个有效版本）
 *   - 同键新 hash → { action:'new_version', versionId:null, previousVersionId } 内容变化形成新版本
 *   - 无记录     → { action:'create' } 首次入库
 */
export function resolveVersion(existing, hash) {
  if (!existing || !Array.isArray(existing.versions) || existing.versions.length === 0) {
    return { action: 'create', versionId: null, previousVersionId: null };
  }
  const active = existing.versions.find((v) => v.active !== false) || existing.versions[existing.versions.length - 1];
  if (active && active.hash === hash) {
    return { action: 'reuse', versionId: active.versionId, previousVersionId: null, active };
  }
  return { action: 'new_version', versionId: null, previousVersionId: active ? active.versionId : null, active };
}

/**
 * 批量导入计划（P4）：逐项裁决该提交还是跳过。
 * items: [{ key, title, hash }]；doneKeys: 上次运行已成功入库的 key 集合。
 * 返回每项 { key, action: 'commit'|'skip', reason }。失败项不在 doneKeys 里，天然会重试。
 */
export function planBatch(items, doneKeys) {
  const done = new Set(Array.isArray(doneKeys) ? doneKeys : []);
  const seen = new Set();
  return (Array.isArray(items) ? items : []).map((item) => {
    const key = item && item.key;
    if (!key) return { key: '', action: 'commit', reason: 'NO_KEY' };
    if (done.has(key)) return { key, action: 'skip', reason: 'ALREADY_IMPORTED' };
    if (seen.has(key)) return { key, action: 'skip', reason: 'DUPLICATE_IN_BATCH' };
    seen.add(key);
    return { key, action: 'commit', reason: '' };
  });
}

/**
 * 相对资源地址解析：网页里的图片/附件常写相对路径，入库前要落到源页面的绝对地址。
 * base 是来源页 URL，ref 是 <img src> 之类的值；解析失败返回空串（保留原值展示）。
 */
export function resolveAssetUrl(baseUrl, ref) {
  const r = String(ref == null ? '' : ref).trim();
  if (!r) return '';
  if (/^(https?:)?\/\//i.test(r) || /^data:/i.test(r)) return r.replace(/^\/\//, 'https://');
  try {
    return new URL(r, baseUrl).toString();
  } catch (_e) {
    return '';
  }
}

/**
 * 工程元数据校验：料号/图号/版次都是「有就存、没有不拦」，但格式明显不对要提示。
 * 只查两类硬错误：版次不是「字母+数字」形态（A/1/B2/Rev.C 都算合法）记 warning，
 * 不阻断提交——lifecycleStatus 默认 unknown，不能因为网页刚更新就当有效版本。
 */
export function validateClipMeta(meta) {
  const m = meta || {};
  const warnings = [];
  const rev = String(m.revision || '').trim();
  if (rev && !/^[A-Za-z]*\.?\d+$|^[A-Za-z]+\d*$/.test(rev)) {
    warnings.push('REVISION_FORMAT');
  }
  if (!String(m.partNumber || '').trim() && !String(m.drawingNumber || '').trim() && !String(m.docType || '').trim()) {
    warnings.push('META_SPARSE'); // 不拦，但提示「工程元数据偏少，检索维度会受限」
  }
  return { ok: true, warnings };
}
