/**
 * src/lib/clip.js 的单元测试（node --test）。
 * 覆盖：URL 规范化（跟踪参数/业务参数/非法输入）、内容哈希确定性、去重键、
 * 状态机合法/非法迁移、版本裁决（复用/新版本/新建）、批量幂等计划、相对资源解析、元数据校验。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeUrl,
  contentHash,
  dedupeKey,
  sourceKey,
  nextClipState,
  resolveVersion,
  planBatch,
  resolveAssetUrl,
  validateClipMeta,
} from '../plugins/schanora/client/src/lib/clip.js';

/* ---------------------------------------------------------------- URL 规范化 */

test('normalizeUrl 去掉跟踪参数', () => {
  const r = normalizeUrl('https://Supplier.com/Spec.html?part=A123&utm_source=x&utm_medium=y&gclid=zz#sec2');
  assert.equal(r.ok, true);
  assert.equal(r.url, 'https://supplier.com/Spec.html?part=A123');
});

test('normalizeUrl 保留影响料号/版本的业务参数并排序', () => {
  const r = normalizeUrl('https://a.example.com/doc?rev=B2&part=A123&lang=zh');
  assert.equal(r.ok, true);
  assert.equal(r.url, 'https://a.example.com/doc?lang=zh&part=A123&rev=B2');
});

test('normalizeUrl 拒绝空值/非法串/非 http 协议', () => {
  assert.equal(normalizeUrl('').ok, false);
  assert.equal(normalizeUrl(null).ok, false);
  assert.equal(normalizeUrl('not a url').reason, 'INVALID_URL');
  assert.equal(normalizeUrl('ftp://example.com/x').reason, 'UNSUPPORTED_SCHEME');
});

test('normalizeUrl 大小写：协议与主机小写，路径保留', () => {
  const r = normalizeUrl('HTTPS://SUPPLIER.example.com/Docs/Page.HTML');
  assert.equal(r.ok, true);
  assert.equal(r.url, 'https://supplier.example.com/Docs/Page.HTML');
});

/* --------------------------------------------------------------- 内容哈希 */

test('contentHash 确定且区分内容', () => {
  const a = contentHash('装配力矩 49 N·m');
  assert.equal(a, contentHash('装配力矩 49 N·m'));
  assert.notEqual(a, contentHash('装配力矩 59 N·m'));
  assert.match(a, /^[0-9a-f]{32}$/);
  assert.equal(contentHash(''), contentHash('')); // 空串也确定性
  assert.notEqual(contentHash(''), a);
});

/* ---------------------------------------------------------------- 去重键 */

test('dedupeKey 空库返回空串；其余三段拼接', () => {
  assert.equal(dedupeKey('', 'https://a', 'h'), '');
  assert.equal(dedupeKey('kb-1', 'https://a', 'h1'), 'kb-1::https://a::h1');
  assert.equal(dedupeKey('kb-1', '', 'h2'), 'kb-1::note::h2');
});

test('sourceKey：URL 身份不含内容 hash（内容变化=同来源新版本）', () => {
  assert.equal(sourceKey('', 'https://a', 't'), '');
  const a = sourceKey('kb-1', 'https://a/doc?part=A1', '标题一');
  const b = sourceKey('kb-1', 'https://a/doc?part=A1', '标题改了');
  assert.equal(a, b); // 标题变化不影响 URL 来源身份
  assert.equal(a, 'kb-1::https://a/doc?part=A1');
});

test('sourceKey：无 URL 的笔记用归一化标题作身份', () => {
  assert.equal(sourceKey('kb-1', '', '  现场  速记 '), 'kb-1::note::现场 速记');
  assert.notEqual(sourceKey('kb-1', '', '笔记甲'), sourceKey('kb-1', '', '笔记乙'));
});

/* --------------------------------------------------------------- 状态机 */

test('状态机：合法正向迁移全链路', () => {
  const chain = ['draft', 'capturing', 'previewReady', 'committing', 'queued', 'processing', 'ready'];
  let cur = 'draft';
  for (let i = 1; i < chain.length; i += 1) {
    cur = nextClipState(cur, 'advance');
    assert.equal(cur, chain[i]);
  }
  assert.equal(nextClipState('ready', 'advance'), null); // 终态
});

test('状态机：取消与重试的边界', () => {
  assert.equal(nextClipState('draft', 'cancel'), 'cancelled');
  assert.equal(nextClipState('processing', 'cancel'), 'cancelled');
  assert.equal(nextClipState('ready', 'cancel'), null); // 终态不可取消
  assert.equal(nextClipState('cancelled', 'cancel'), null);
  assert.equal(nextClipState('failed', 'retry'), 'previewReady');
  assert.equal(nextClipState('ready', 'retry'), null);
  assert.equal(nextClipState('nonsense', 'advance'), null);
});

/* --------------------------------------------------------------- 版本裁决 */

test('resolveVersion：无记录 → 新建', () => {
  const r = resolveVersion(null, 'h1');
  assert.equal(r.action, 'create');
  const r2 = resolveVersion({ versions: [] }, 'h1');
  assert.equal(r2.action, 'create');
});

test('resolveVersion：同键同 hash → 复用现有版本，不新建副本（T05）', () => {
  const existing = { versions: [{ versionId: 'v3', hash: 'h1', active: true }, { versionId: 'v2', hash: 'h0', active: false }] };
  const r = resolveVersion(existing, 'h1');
  assert.equal(r.action, 'reuse');
  assert.equal(r.versionId, 'v3');
});

test('resolveVersion：同键新 hash → 形成新版本并指向前一版（T06）', () => {
  const existing = { versions: [{ versionId: 'v3', hash: 'h1', active: true }] };
  const r = resolveVersion(existing, 'h9');
  assert.equal(r.action, 'new_version');
  assert.equal(r.previousVersionId, 'v3');
  assert.equal(r.versionId, null); // 新版本 id 由服务端生成
});

/* ------------------------------------------------------------ 批量幂等（P4/T11） */

test('planBatch：成功项跳过、批内重复跳过、其余提交', () => {
  const items = [
    { key: 'k1' },
    { key: 'k2' },
    { key: 'k1' }, // 批内重复
    { key: 'k3' },
  ];
  const plan = planBatch(items, ['k2']); // k2 上次已成功
  assert.deepEqual(
    plan.map((p) => [p.key, p.action, p.reason]),
    [
      ['k1', 'commit', ''],
      ['k2', 'skip', 'ALREADY_IMPORTED'],
      ['k1', 'skip', 'DUPLICATE_IN_BATCH'],
      ['k3', 'commit', ''],
    ],
  );
});

test('planBatch：失败项不在 doneKeys 里，续跑时会重试', () => {
  const plan = planBatch([{ key: 'k9' }], []);
  assert.equal(plan[0].action, 'commit');
});

test('planBatch：无 key 的项仍提交但标记 NO_KEY', () => {
  const plan = planBatch([{ title: 'x' }], []);
  assert.equal(plan[0].action, 'commit');
  assert.equal(plan[0].reason, 'NO_KEY');
});

/* --------------------------------------------------------- 相对资源解析（T07 相关） */

test('resolveAssetUrl：相对路径落到源页面绝对地址', () => {
  assert.equal(resolveAssetUrl('https://s.example.com/docs/page.html', 'img/pic.png'), 'https://s.example.com/docs/img/pic.png');
  assert.equal(resolveAssetUrl('https://s.example.com/docs/', '/assets/a.pdf'), 'https://s.example.com/assets/a.pdf');
  assert.equal(resolveAssetUrl('https://s.example.com/', '//cdn.example.net/x.png'), 'https://cdn.example.net/x.png');
  assert.equal(resolveAssetUrl('https://s.example.com/', 'data:image/png;base64,AAA'), 'data:image/png;base64,AAA');
  assert.equal(resolveAssetUrl('https://s.example.com/', ''), '');
});

/* ------------------------------------------------------------- 元数据校验 */

test('validateClipMeta：合法版次不告警；怪版次/元数据稀疏给 warning 不拦截', () => {
  assert.deepEqual(validateClipMeta({ revision: 'B2', partNumber: 'A123' }).warnings, []);
  assert.deepEqual(validateClipMeta({ revision: 'A' }).warnings, ['META_SPARSE']);
  assert.ok(validateClipMeta({ revision: '第二版' }).warnings.includes('REVISION_FORMAT'));
  assert.equal(validateClipMeta({ revision: '第二版' }).ok, true);
});
