import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { installSchanoraPrompts } from '../scripts/schanora-prompts.mjs';

test('branding replaces stock identity and keeps template fields on repeated starts', async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'schanora-prompt-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const names = ['system_prompt.yaml', 'fallback.yaml', 'intent_prompts.yaml', 'agent_system_prompt.yaml'];
  const stock = '    content: |\n      You are WeKnora, an assistant developed by Tencent. Keep this rule.\n      {{query}}\n';
  await Promise.all(names.map((name) => writeFile(path.join(dir, name), stock)));
  await installSchanoraPrompts(dir);
  await installSchanoraPrompts(dir);
  for (const name of names) {
    const result = await readFile(path.join(dir, name), 'utf8');
    assert.equal(result.match(/You are Schanora/g).length, 1);
    assert.match(result, /Schaeffler engineering teams/);
    assert.match(result, /Keep this rule\.\n      \{\{query\}\}/);
    assert.doesNotMatch(result, /You are WeKnora/);
  }
});
