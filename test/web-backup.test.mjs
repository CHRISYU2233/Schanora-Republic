import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { startServer } from '../plugins/schanora/client/src/server/http.js';
import { restoreBackup, validateBackup } from '../plugins/schanora/client/src/server/backup.js';

const staticRoot = fileURLToPath(new URL('..', import.meta.url));

test('浏览器入口在同一服务启动，备份可恢复并重建检索', async (t) => {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'schanora-web-backup-'));
  assert.equal(path.dirname(parent), path.resolve(os.tmpdir()));
  t.after(() => fs.rm(parent, { recursive: true, force: true }));
  const root = path.join(parent, '原知识库');
  const server = await startServer({ root, port: 0, runtime: 'web', staticRoot });
  t.after(() => server.close());
  const base = server.baseUrl;
  const page = await fetch(base);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /下载数据备份/);
  assert.equal((await fetch(base + '/preview/')).status, 404);
  assert.equal((await fetch(base + '/.git/config')).status, 404);
  const health = await fetch(base + '/health').then((r) => r.json());
  assert.equal(health.data.runtime, 'web');
  const sameOrigin = await fetch(base + '/health', { headers: { Origin: base } });
  assert.equal(sameOrigin.status, 200);

  const created = await fetch(base + '/api/v1/knowledge-bases', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: '迁移验收' }),
  }).then((r) => r.json());
  const id = created.data.id;
  const form = new FormData();
  form.append('file', new Blob(['# 角接触轴承\n维护编号 SCHANORA2026']), 'bearing.md');
  const uploaded = await fetch(base + `/api/v1/knowledge-bases/${id}/documents`, { method: 'POST', body: form });
  assert.equal(uploaded.status, 200);
  const exported = await fetch(base + '/api/v1/local/backup');
  assert.equal(exported.status, 200);
  assert.match(exported.headers.get('content-disposition'), /attachment/);
  const backup = await exported.json();
  validateBackup(backup);
  assert.ok(backup.files.some((file) => file.path.endsWith('.md')));
  const changed = structuredClone(backup);
  changed.files[0].content += '损坏';
  assert.throws(() => validateBackup(changed), /校验失败/);
  const target = path.join(parent, '恢复后的库');
  await restoreBackup(backup, target);
  await assert.rejects(restoreBackup(backup, target), { code: 'EEXIST' });
  const restored = await startServer({ root: target, port: 0, runtime: 'web', staticRoot });
  t.after(() => restored.close());
  const search = await fetch(restored.baseUrl + '/api/v1/search', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: 'SCHANORA2026', kbIds: [id], matchCount: 5 }),
  }).then((r) => r.json());
  assert.ok(search.data.items.some((hit) => hit.content.includes('SCHANORA2026')));
});
