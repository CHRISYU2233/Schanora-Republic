import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMarkers, verifyCitations, normalizeCitations } from '../plugins/schanora/client/src/lib/cite.js';

const ref = (over = {}) => ({ id: 'r1', title: '给水泵检修规程', knowledgeId: 'kb-doc-1', chunkIndex: 2, content: '…', ...over });

test('角标去重、保序', () => {
  assert.deepEqual(parseMarkers('结论 [2]，补充 [1]，重复 [2]，长序号 [12]'), [2, 1, 12]);
});

test('全部角标都能落回引用列表', () => {
  const result = verifyCitations({ answer: '扬程不低于 105% [1]，另见 [2]。', refs: [ref(), ref({ id: 'r2', chunkIndex: 4 })] });
  assert.equal(result.total, 2);
  assert.equal(result.verified, 2);
  assert.equal(result.unverified, 0);
  assert.equal(result.ok, true);
});

test('越界角标判为 orphan，不静默通过', () => {
  const result = verifyCitations({ answer: '见 [3]。', refs: [ref()] });
  assert.equal(result.ok, false);
  assert.deepEqual(result.orphans, [3]);
  assert.equal(result.citations[0].status, 'orphan');
});

test('引用本身缺分块号时判为 unverifiable', () => {
  const result = verifyCitations({ answer: '见 [1]。', refs: [ref({ chunkIndex: null })] });
  assert.equal(result.ok, false);
  assert.equal(result.unverified, 1);
  assert.equal(result.citations[0].status, 'unverifiable');
});

test('没有角标不算通过：空答案不能自称有引用', () => {
  const result = verifyCitations({ answer: '没有标注的答案。', refs: [ref()] });
  assert.equal(result.total, 0);
  assert.equal(result.ok, false);
});

test('refs 为空时任何角标都是 orphan', () => {
  const result = verifyCitations({ answer: '见 [1]。', refs: [] });
  assert.deepEqual(result.orphans, [1]);
  assert.equal(result.verified, 0);
});

/* ------------------------------------------- 内联 <kb/> 标签 → [n] 角标适配 */

test('真实网关格式：自闭合 <kb/> 按 chunk_id 换成对应角标', () => {
  const answer = '报销需出差申请单、交通票据 [1]。\n\n<kb doc=".tmp_test_doc.md" chunk_id="fc791c69-92ec-47e7-b7fc-2c1ff841a837" kb_id="9d56b682" />\n\n住宿一线城市 500 元以内 [2]。';
  const refs = [{ id: 'fc791c69-92ec-47e7-b7fc-2c1ff841a837' }, { id: 'other-chunk' }];
  const out = normalizeCitations(answer, refs);
  assert.equal(out.includes('<kb'), false);
  assert.ok(out.includes('[1]'));
  // 已有 [1] 保留，标签替换后不应重复编号成 [3]
  assert.equal(parseMarkers(out).join(','), '1,2');
});

test('同一 chunk 出现多次用同一序号', () => {
  const refs = [{ id: 'c1' }];
  const out = normalizeCitations('<kb chunk_id="c1" /><kb chunk_id="c1" />', refs);
  assert.deepEqual(parseMarkers(out), [1]);
});

test('对不上引用的标签直接删掉，不编假出处', () => {
  const out = normalizeCitations('正文<kb chunk_id="ghost" />结尾', [{ id: 'c1' }]);
  assert.equal(out, '正文结尾');
});

test('单引号属性也认（上游两种写法都出现过）', () => {
  const out = normalizeCitations("<kb doc='a.md' chunk_id='c9' />", [{ id: 'c9' }]);
  assert.equal(out, '[1]');
});

test('没有标签的答案原样返回，不破坏已有角标', () => {
  const answer = '结论 [1]，依据 [2]。';
  assert.equal(normalizeCitations(answer, [{ id: 'a' }, { id: 'b' }]), answer);
});

test('refs 为空时标签被清理，不留下裸标签', () => {
  const out = normalizeCitations('文本<kb doc="x" chunk_id="c1" />', []);
  assert.equal(out, '文本');
});

test('空内容与 null 不抛', () => {
  assert.equal(normalizeCitations(null, []), '');
  assert.equal(normalizeCitations('', [{ id: 'c' }]), '');
});
