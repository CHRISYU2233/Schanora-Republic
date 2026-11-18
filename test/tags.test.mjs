import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeTag,
  parseTagInput,
  normalizeTagMap,
  allTags,
  filterDocsByTag,
  mergeTagMaps,
  serializeTags,
  parseImportedTags,
  pushRecent,
} from '../plugins/schanora/client/src/lib/tags.js';

test('normalizeTag：去 #、压空白、限长', () => {
  assert.equal(normalizeTag('  #标准 '), '标准');
  assert.equal(normalizeTag('GB/T   5782'), 'GB/T 5782');
  assert.equal(normalizeTag('x'.repeat(40)).length, 24);
  assert.equal(normalizeTag(null), '');
  assert.equal(normalizeTag('###'), '');
});

test('parseTagInput：中英分隔符、去重保序、标签内空格保留、上限 12', () => {
  assert.deepEqual(parseTagInput('标准, 国标；GB/T 5782 作业'), ['标准', '国标', 'GB/T 5782 作业']);
  assert.deepEqual(parseTagInput('装配、装配, 装配'), ['装配']);
  assert.deepEqual(parseTagInput('  '), []);
  const many = parseTagInput(Array.from({ length: 30 }, (_, i) => `t${i}`).join(','));
  assert.equal(many.length, 12);
  assert.equal(many[0], 't0');
});

test('normalizeTagMap：丢无效项、文档内去重', () => {
  const out = normalizeTagMap({ '': ['x'], d1: 'notarray', d2: ['a', 'a', ''], d3: [] });
  assert.deepEqual(out, { d2: ['a'] });
});

test('allTags：计数降序、同数按字典序', () => {
  const map = { a: ['x', 'y'], b: ['x'], c: ['y', 'z'], d: [] };
  assert.deepEqual(allTags(map), [
    { tag: 'x', n: 2 },
    { tag: 'y', n: 2 },
    { tag: 'z', n: 1 },
  ]);
});

test('filterDocsByTag：OR 命中保留、空标签返回原表', () => {
  const docs = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  const map = { a: ['x'], b: ['x', 'y'] };
  assert.deepEqual(filterDocsByTag(docs, 'x', map), [{ id: 'a' }, { id: 'b' }]);
  assert.deepEqual(filterDocsByTag(docs, 'z', map), []);
  assert.equal(filterDocsByTag(docs, '', map).length, 3);
});

test('mergeTagMaps：并集保序、上限 12、输入先规范化', () => {
  const base = { a: ['x', 'y'] };
  const incoming = { a: ['y', 'z'], b: ['#新'], c: 'bad' };
  assert.deepEqual(mergeTagMaps(base, incoming), { a: ['x', 'y', 'z'], b: ['新'] });
  const big = mergeTagMaps({ a: Array.from({ length: 11 }, (_, i) => `t${i}`) }, { a: ['new1', 'new2'] });
  assert.equal(big.a.length, 12);
  assert.equal(big.a[11], 'new1');
});

test('serializeTags/parseImportedTags：信封往返', () => {
  const json = serializeTags({ a: ['x'], b: ['##bad', 'y', 'y'] });
  const { tags } = parseImportedTags(json);
  assert.deepEqual(tags, { a: ['x'], b: ['bad', 'y'] });
});

test('parseImportedTags：拒非法输入', () => {
  assert.throws(() => parseImportedTags('not json'), /JSON/);
  assert.throws(() => parseImportedTags('[]'), /结构/);
  assert.throws(() => parseImportedTags('{"kind":"other","version":1}'), /kind/);
  assert.throws(() => parseImportedTags('{"kind":"schanora.doctags","version":2}'), /版本/);
});

test('pushRecent：去重、倒序、封顶', () => {
  const list = [
    { id: 'a', at: 1 },
    { id: 'b', at: 2 },
  ];
  const out = pushRecent(list, { id: 'a', at: 3 }, 2);
  assert.deepEqual(out, [{ id: 'a', at: 3 }, { id: 'b', at: 2 }]);
  const capped = pushRecent(Array.from({ length: 12 }, (_, i) => ({ id: `d${i}` })), { id: 'new' }, 10);
  assert.equal(capped.length, 10);
  assert.equal(capped[0].id, 'new');
});
