import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';

const window = {};
const origin = 'http://127.0.0.1:8080';
const source = await readFile(new URL('../web/weknora-api.js', import.meta.url), 'utf8');
runInNewContext(source, { window, location: { origin }, URL, Object, Array });
const { route, reply } = window.__SCHANORA_WEKNORA__;
const plain = (value) => JSON.parse(JSON.stringify(value));

test('selected agents run through the native agent API with the requested library scope', () => {
  const path = '/api/v1/sessions/test-session/messages';
  const body = { query: 'Find the tolerance', knowledgeBaseIds: ['engineering'] };
  assert.deepEqual(plain(route(path, 'POST', { ...body, agentId: 'agent-1' })), {
    path: '/api/v1/agent-chat/test-session',
    body: { query: body.query, knowledge_base_ids: ['engineering'], channel: 'web', agent_id: 'agent-1', agent_enabled: true },
  });
  assert.deepEqual(plain(route(path, 'POST', body)), {
    path: '/api/v1/knowledge-chat/test-session',
    body: { query: body.query, knowledge_base_ids: ['engineering'], channel: 'api' },
  });
  assert.deepEqual(plain(route('/api/v1/sessions/test-session/stop', 'POST', { messageId: 'turn-1' })), {
    path: '/api/v1/sessions/test-session/stop',
    body: { message_id: 'turn-1' },
  });
  assert.equal(route('/api/v1/chunks/by-id/chunk-1', 'GET').path, '/api/v1/chunks/by-id/chunk-1');
  assert.equal(route('/api/v1/chunks/by-id/chunk-1', 'DELETE'), null);
});

test('the picker lists available smart-reasoning agents and omits disabled agents and configuration', () => {
  const path = '/api/v1/agents';
  assert.equal(route(path, 'GET').path, path);
  const agent = (id, mode) => ({ id, name: id, config: { agent_mode: mode, system_prompt: 'private config' } });
  const result = reply(path, {
    success: true,
    data: [
      agent('builtin-smart-reasoning', 'smart-reasoning'),
      agent('custom', 'smart-reasoning'),
      agent('disabled', 'smart-reasoning'),
      agent('builtin-quick-answer', 'quick-answer'),
    ],
    disabled_own_agent_ids: ['disabled'],
  });
  assert.deepEqual(plain(result.data), [
    { id: 'builtin-smart-reasoning', name: 'builtin-smart-reasoning' },
    { id: 'custom', name: 'custom' },
  ]);
  assert.equal(reply(path, { success: false, error: { message: 'denied' } }).message, 'denied');
});

test('model credential changes and diagnostics use the native WeKnora endpoints', () => {
  const credentials = '/api/v1/models/model-1/credentials';
  assert.equal(route(credentials, 'GET'), null);
  assert.deepEqual(plain(route(credentials, 'PUT', { apiKey: 'test-value' })), {
    path: credentials,
    body: { api_key: 'test-value' },
  });
  const debug = '/api/v1/models/model-1/debug';
  const form = new FormData();
  form.set('input', 'Model connection sample');
  assert.equal(route(debug, 'POST', form).body, form);
  assert.equal(route(debug, 'GET'), null);
});
