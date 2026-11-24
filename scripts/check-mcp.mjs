import { parseArgs } from 'node:util';

const { values } = parseArgs({ options: { url: { type: 'string' }, help: { type: 'boolean' } } });
if (values.help || !values.url) {
  console.log('Set SCHANORA_MCP_TOKEN in your environment, then run node scripts/check-mcp.mjs --url <MCP endpoint URL>');
  process.exit(values.help ? 0 : 2);
}
const url = new URL(values.url);
if (url.username || url.password || url.search || url.hash
  || !/^\/mcp\/[a-z\d_-]+$/i.test(url.pathname)
  || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)))) {
  throw new Error('Use an MCP endpoint with HTTPS, or HTTP on loopback.');
}
const token = process.env.SCHANORA_MCP_TOKEN?.trim();
if (!token) throw new Error('Missing SCHANORA_MCP_TOKEN.');

const headers = {
  Authorization: 'Bearer ' + token,
  'Content-Type': 'application/json',
  Accept: 'application/json, text/event-stream',
};
let sequence = 0;
async function call(method, params, notification = false) {
  const id = ++sequence;
  const response = await fetch(url, {
    method: 'POST', headers, redirect: 'error', signal: AbortSignal.timeout(30_000),
    body: JSON.stringify({ jsonrpc: '2.0', ...(notification ? {} : { id }), method, params }),
  });
  if (!response.ok) throw new Error(method + ' HTTP ' + response.status);
  if (notification) return;
  const session = response.headers.get('Mcp-Session-Id');
  if (session) headers['Mcp-Session-Id'] = session;
  const body = await response.text();
  const payload = response.headers.get('content-type')?.includes('text/event-stream')
    ? body.split(/\r?\n\r?\n/).map((event) => event.split(/\r?\n/)
      .filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trim()).join('\n'))
      .filter(Boolean).map(JSON.parse).find((item) => item.id === id)
    : JSON.parse(body);
  if (!payload || payload.id !== id || payload.error) throw new Error(method + ' returned a JSON-RPC error.');
  return payload.result;
}
const info = await call('initialize', {
  protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'schanora-check', version: '1.0.0' },
});
headers['MCP-Protocol-Version'] = info.protocolVersion;
await call('notifications/initialized', {}, true);
const names = [];
let cursor;
do {
  const page = await call('tools/list', cursor ? { cursor } : {});
  names.push(...page.tools.map((tool) => tool.name));
  cursor = page.nextCursor;
} while (cursor);
console.log(JSON.stringify({ protocol: info.protocolVersion, tools: names }, null, 2));
if (!names.includes('list_knowledge_bases')) throw new Error('Enable list_knowledge_bases on this MCP endpoint.');
const result = await call('tools/call', { name: 'list_knowledge_bases', arguments: {} });
if (result.isError) throw new Error('list_knowledge_bases could not be called.');
console.log('MCP list_knowledge_bases is callable.');
