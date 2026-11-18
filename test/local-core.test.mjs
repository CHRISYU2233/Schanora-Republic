/**
 * 本地内核的回归测试。
 *
 * 分两层：纯函数（分块/分词/BM25/multipart）与一条真实链路（起服务 → 建库 → 上传 → 检索 →
 * 问答 SSE → 采集落库）。第二层用真实 HTTP，不 mock —— 这一层的价值就是证明「不装网关也能跑」。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chunkText, tokenize, extractText } from '../plugins/schanora/client/src/server/text.js';
import { buildIndex, bm25, composeExtractive } from '../plugins/schanora/client/src/server/search.js';
import { parseMultipart } from '../plugins/schanora/client/src/server/http.js';
import { startServer } from '../plugins/schanora/client/src/server/http.js';

/* ------------------------------------------------------------------ 纯函数 */

test('chunkText：标题切段、超长段落硬切、结果确定性', () => {
  const md = ['# 螺栓', '', 'M10 螺栓的拧紧力矩按 GB/T 3098.1 执行。', '', '## 安装', '', '预紧力分三级加载。'].join('\n');
  const a = chunkText(md, { maxChars: 40 });
  const b = chunkText(md, { maxChars: 40 });
  assert.ok(a.length >= 2, '应当切成多块');
  assert.deepEqual(
    a.map((c) => c.content),
    b.map((c) => c.content),
    '同样的输入必须得到同样的分块（引用编号与 startAt 才能稳定）',
  );
  assert.equal(a[0].index, 0);
  assert.ok(a.every((c) => c.content.length > 0));
});

test('chunkText：700 字上限与切点尽量落在句末', () => {
  const long = '这是一个比较长的句子。'.repeat(120);
  const chunks = chunkText(long, { maxChars: 200 });
  assert.ok(chunks.length > 1);
  assert.ok(chunks[0].content.length <= 220, `首块不应超过上限太多，实际 ${chunks[0].content.length}`);
});

test('tokenize：中文取 2-gram，英文取整词，停用词剔除', () => {
  const toks = tokenize('M10 螺栓 the 拧紧力矩 GB/T 3098.1');
  assert.ok(toks.includes('螺栓'));
  assert.ok(toks.includes('拧紧'));
  assert.ok(toks.includes('m10'));
  assert.ok(!toks.includes('the'), '停用词不应进索引');
});

test('bm25：问什么就命中哪一块', () => {
  const chunks = [
    { content: '变速箱油更换周期为 6 万公里', heading: '保养', chunkIndex: 0 },
    { content: 'M10 螺栓拧紧力矩 45 N·m，按 GB/T 3098.1', heading: '紧固', chunkIndex: 1 },
    { content: '电池包防护等级 IP67', heading: '电气', chunkIndex: 2 },
  ];
  const index = buildIndex(chunks);
  const hits = bm25(index, '螺栓 拧紧力矩', 3);
  assert.ok(hits.length >= 1);
  assert.equal(index.chunks[hits[0].pos].chunkIndex, 1, '应当命中紧固那一块');
});

test('composeExtractive：没有资料时明确说没有，不编', () => {
  const text = composeExtractive('空样例', []);
  assert.match(text, /没有检索到/);
});

test('parseMultipart：文件字节完整，不残留尾部 CRLF', () => {
  const boundary = 'test-boundary-123';
  const content = Buffer.from('# 标题\n\n正文内容\n第二行\n', 'utf8');
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\n`),
    Buffer.from('Content-Disposition: form-data; name="file"; filename="a.md"\r\n'),
    Buffer.from('Content-Type: text/markdown\r\n\r\n'),
    content,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  const parts = parseMultipart(body, `multipart/form-data; boundary=${boundary}`);
  assert.ok(parts && parts.length === 1);
  assert.equal(parts[0].fileName, 'a.md');
  assert.equal(parts[0].body.toString('utf8'), content.toString('utf8'));
});

test('extractText：不支持的类型如实报错', () => {
  assert.throws(() => extractText(Buffer.from('x'), 'a.exe'), /不支持/);
});

/* -------------------------------------------------------------- 真实链路 */

async function call(baseUrl, method, pathName, body) {
  const res = await fetch(`${baseUrl}${pathName}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json();
  return { status: res.status, json };
}

test('本地链路：建库 → 上传 → 检索 → 问答 SSE → 采集落库', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'schanora-local-'));
  const started = await startServer({ port: 0, root });
  t.after(async () => {
    await started.close();
    await fs.rm(root, { recursive: true, force: true }).catch(() => {});
  });
  const base = started.baseUrl;

  // 1. 健康
  const health = await call(base, 'GET', '/health');
  assert.equal(health.json.data.status, 'ok');
  assert.match(health.json.data.version, /-local$/);

  // 2. 建库
  const kb = await call(base, 'POST', '/api/v1/knowledge-bases', { name: '工程标准库' });
  assert.equal(kb.status, 200);
  const kbId = kb.json.data.id;
  assert.ok(kbId);
  // 同名再建要被拦住，不能静默产生两个同名库
  const dup = await call(base, 'POST', '/api/v1/knowledge-bases', { name: '工程标准库' });
  assert.equal(dup.status, 409);

  // 3. 上传（真 multipart）
  const fd = new FormData();
  const md = ['# GB/T 3098.1 紧固件', '', 'M10 螺栓的性能等级为 8.8，拧紧力矩 45 N·m。', '', '安装前应清除螺纹油污。'].join('\n');
  fd.append('file', new Blob([md], { type: 'text/markdown' }), 'GB-T-3098-1.md');
  const upRes = await fetch(`${base}/api/v1/knowledge-bases/${kbId}/documents`, { method: 'POST', body: fd });
  const up = await upRes.json();
  assert.equal(upRes.status, 200, JSON.stringify(up));
  assert.equal(up.data.parseStatus, 'completed');
  assert.ok(up.data.chunkCount >= 1);

  // 4. 列表与详情
  const docs = await call(base, 'GET', `/api/v1/knowledge-bases/${kbId}/documents`);
  assert.equal(docs.json.data.items.length, 1);
  assert.equal(docs.json.data.items[0].title, 'GB-T-3098-1');
  const detail = await call(base, 'GET', `/api/v1/documents/${up.data.id}`);
  assert.match(detail.json.data.fileName, /GB-T-3098-1/);

  // 5. 检索
  const search = await call(base, 'POST', '/api/v1/search', { query: '螺栓 拧紧力矩', matchCount: 3 });
  assert.ok(search.json.data.items.length >= 1, '应当检索到刚上传的文档');
  const top = search.json.data.items[0];
  assert.equal(top.knowledgeId, up.data.id);
  assert.match(top.content, /45 N·m/);
  assert.equal(search.json.data.meta.mode, 'bm25', '没配 embedding 时应如实报告 bm25');

  // 6. 问答 SSE（无模型 → 抽取式，但事件序列必须完整）
  const askRes = await fetch(`${base}/api/v1/sessions/sess-test/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify({ query: 'M10 螺栓拧紧力矩是多少', knowledgeBaseIds: [kbId] }),
  });
  assert.equal(askRes.status, 200);
  const raw = await askRes.text();
  const events = raw
    .split('\n')
    .filter((l) => l.startsWith('data:'))
    .map((l) => JSON.parse(l.slice(5).trim()));
  const types = events.map((e) => e.responseType);
  assert.ok(types.includes('references'), '要先推引用');
  assert.ok(types.includes('answer'), '要有答案分片');
  assert.equal(types[types.length - 1], 'complete', '最后必须是 complete，否则前端会判未完成');
  const answer = events.filter((e) => e.responseType === 'answer').map((e) => e.content).join('');
  assert.match(answer, /45 N·m|45 N·m/);

  // 7. 落库：换一个请求读消息，确认一问一答存下来了
  const msgs = await call(base, 'GET', '/api/v1/sessions/sess-test/messages?limit=10');
  assert.equal(msgs.json.data.items.length, 2);
  assert.equal(msgs.json.data.items[0].role, 'user');
  assert.equal(msgs.json.data.items[1].role, 'assistant');
  assert.ok(msgs.json.data.items[1].knowledgeReferences.length >= 1, '引用要跟着答案一起落库');

  // 8. 采集 → 提交 → 库里多一篇，且幂等
  const clip = await call(base, 'POST', '/api/v1/clips', {
    title: '现场记录',
    content: '# 现场记录\n\n扭矩扳手已校准。',
  });
  const clipId = clip.json.data.id;
  const commit = await call(base, 'POST', `/api/v1/clips/${clipId}/commit`, {
    targetKbId: kbId,
    expectedRevision: 1,
    idempotencyKey: 'k-1',
  });
  assert.equal(commit.json.data.status, 'committed');
  const again = await call(base, 'POST', `/api/v1/clips/${clipId}/commit`, {
    targetKbId: kbId,
    expectedRevision: 1,
    idempotencyKey: 'k-1',
  });
  assert.equal(again.json.data.documentId, commit.json.data.documentId, '同一幂等键不能建第二篇');
  const docs2 = await call(base, 'GET', `/api/v1/knowledge-bases/${kbId}/documents`);
  assert.equal(docs2.json.data.items.length, 2, '上传 1 篇 + 采集 1 篇');

  // 9. Wiki：索引页 + 文档页都在
  const wiki = await call(base, 'GET', `/api/v1/knowledge-bases/${kbId}/wiki/tree`);
  const slugs = wiki.json.data.items.map((p) => p.slug);
  assert.ok(slugs.includes('index'));
  assert.ok(slugs.some((s) => s.startsWith('doc-')));

  // 10. 磁盘上真的是「一篇 md + 一个 json」
  const files = await fs.readdir(path.join(root, 'kbs', kbId, 'docs'));
  assert.equal(files.filter((f) => f.endsWith('.md')).length, 2);
  assert.equal(files.filter((f) => f.endsWith('.json')).length, 2);
});
