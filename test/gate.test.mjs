import test from 'node:test';
import assert from 'node:assert/strict';
import { MIN_COVERAGE, annotateHits, coverageOf, hasProvenance, queryTerms } from '../plugins/schanora/client/src/lib/gate.js';

const hit = (over = {}) => ({
  id: 'hit-1',
  knowledgeId: 'kb-doc-1',
  chunkIndex: 2,
  content: '给水泵的扬程应不低于设计值的 105%。',
  score: 0.72,
  ...over,
});

test('分词丢掉疑问词与虚词，保留实义词', () => {
  const terms = queryTerms('给水泵的扬程是多少？');
  assert.ok(terms.includes('给水'));
  assert.ok(terms.includes('扬程'));
  assert.ok(!terms.includes('多少'));
  assert.ok(!terms.includes('的'));
});

test('覆盖率是命中词项的比例，与分数量纲无关', () => {
  const terms = queryTerms('给水泵扬程');
  assert.equal(coverageOf(terms, '给水泵扬程 105%'), 1);
  assert.equal(coverageOf(terms, '给水泵'), 0.5);
  assert.equal(coverageOf([], '任何内容'), 1);
});

test('缺文档 id 或分块号的片段不算证据', () => {
  assert.equal(hasProvenance(hit()), true);
  assert.equal(hasProvenance(hit({ knowledgeId: '' })), false);
  assert.equal(hasProvenance(hit({ chunkIndex: -1 })), false);
  assert.equal(hasProvenance(hit({ content: '' })), false);
});

test('标注覆盖率但不丢结果：低于门槛只打标', () => {
  const hits = [hit(), hit({ id: 'hit-2', content: '泵房巡检记录。', chunkIndex: 3 })];
  const { hits: rows, diagnostics } = annotateHits('给水泵扬程', hits);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].meetsGate, true);
  assert.equal(rows[1].meetsGate, false);
  assert.equal(diagnostics.total, 2);
  assert.equal(diagnostics.kept, 1);
  assert.equal(diagnostics.lowCoverage, 1);
  assert.equal(diagnostics.minCoverage, MIN_COVERAGE);
});

test('缺出处单独计数，且不会被当成达标', () => {
  const { hits: rows, diagnostics } = annotateHits('给水泵扬程', [hit({ chunkIndex: null })]);
  assert.equal(rows[0].meetsGate, false);
  assert.equal(rows[0].hasProvenance, false);
  assert.equal(diagnostics.missingProvenance, 1);
  assert.equal(diagnostics.kept, 0);
});

test('门槛可覆盖，用于不同部署的松紧', () => {
  const { hits: rows } = annotateHits('给水泵扬程', [hit({ content: '给水泵' })], { minCoverage: 0.4 });
  assert.equal(rows[0].coverage, 0.5);
  assert.equal(rows[0].meetsGate, true);
});
