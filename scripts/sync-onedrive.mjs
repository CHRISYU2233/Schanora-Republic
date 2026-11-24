import { createHash } from 'node:crypto';
import { mkdir, open, readFile, readdir, realpath, rename, stat, unlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';

const { values } = parseArgs({ options: {
  folder: { type: 'string' }, kb: { type: 'string' }, base: { type: 'string', default: 'http://127.0.0.1:8080' },
  state: { type: 'string' }, apply: { type: 'boolean' }, status: { type: 'boolean' },
  'max-mib': { type: 'string', default: '50' }, help: { type: 'boolean' },
} });
if (values.help || !values.folder || !values.kb) {
  console.log('node scripts/sync-onedrive.mjs --folder <local synced folder> --kb <knowledge base ID> [--apply | --status] [--base http://127.0.0.1:8080] [--state <local JSON file>]');
  process.exit(values.help ? 0 : 2);
}
if (values.apply && values.status) throw new Error('Choose one of --apply or --status.');

const origin = new URL(values.base);
if (!['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname) || origin.protocol !== 'http:'
  || origin.pathname !== '/' || origin.search || origin.hash || origin.username || origin.password) {
  throw new Error('--base must be the local Schanora origin, for example http://127.0.0.1:8080.');
}
const root = await realpath(values.folder);
const maxBytes = Number(values['max-mib']) * 1024 * 1024;
if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new Error('--max-mib must be a positive number of MiB.');
const sha256 = (data) => createHash('sha256').update(data).digest('hex');
const scope = { root, origin: origin.origin, kb: values.kb };
const stateFile = path.resolve(values.state || path.join(os.homedir(), 'Schanora', 'onedrive-sync',
  sha256(JSON.stringify(scope)) + '.json'));
const relativeState = path.relative(root, stateFile);
if (!relativeState || (!relativeState.startsWith('..' + path.sep) && !path.isAbsolute(relativeState))) {
  throw new Error('Keep the state file outside the source folder.');
}
const allowedExtensions = new Set(['.pdf', '.doc', '.docx', '.ppt', '.pptx', '.xls', '.xlsx', '.csv',
  '.tsv', '.txt', '.md', '.markdown', '.html', '.json']);
const kbPath = '/api/v1/knowledge-bases/' + encodeURIComponent(values.kb);
const key = process.env.WEKNORA_API_KEY?.trim();
if ((values.apply || values.status) && !key) throw new Error('Provide a scoped ingest/retrieve key through WEKNORA_API_KEY.');

async function api(endpoint, body) {
  const response = await fetch(new URL(endpoint, origin), {
    method: body ? 'POST' : 'GET', body, headers: { 'X-API-Key': key },
    redirect: 'error', signal: AbortSignal.timeout(body ? 180_000 : 30_000),
  });
  const json = await response.json().catch(() => null);
  if (response.status === 409 && json?.code === 'duplicate_file' && json.data?.id) return json.data;
  if (!response.ok || json?.success !== true) throw new Error(`WeKnora HTTP ${response.status}${json?.code ? ' ' + json.code : ''}`);
  return json.data;
}

async function loadState() {
  try {
    const data = JSON.parse(await readFile(stateFile, 'utf8'));
    if (data.version !== 1 || JSON.stringify(data.scope) !== JSON.stringify(scope) || !Array.isArray(data.records)) {
      throw new Error('State file belongs to another folder, service or knowledge base.');
    }
    return new Map(data.records.map((row) => [row.path, row]));
  } catch (error) {
    if (error.code === 'ENOENT') return new Map();
    throw error;
  }
}

async function saveState(records) {
  const temp = stateFile + '.tmp';
  await writeFile(temp, JSON.stringify({ version: 1, scope, records: [...records.values()] }, null, 2) + '\n', { mode: 0o600 });
  await rename(temp, stateFile);
}

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || entry.name.startsWith('~$') || entry.isSymbolicLink()) continue;
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(absolute);
    if (entry.isFile() && allowedExtensions.has(path.extname(entry.name).toLowerCase())) yield absolute;
  }
}

async function upload(absolute, name, data, hash) {
  const body = new FormData();
  body.set('file', new Blob([data]), path.basename(absolute));
  body.set('fileName', name);
  body.set('metadata', JSON.stringify({ schanora_source: 'onedrive-sync', schanora_path: name, schanora_sha256: hash }));
  const document = await api(kbPath + '/knowledge/file', body);
  if (!document?.id) throw new Error('The upload response did not contain a document ID.');
  return document.id;
}

function report(status, sourcePath, details = {}) {
  console.log(JSON.stringify({ status, path: sourcePath, ...details }));
}

async function run() {
  const records = await loadState();
  if (values.status) {
    for (const row of records.values()) {
      try {
        const doc = await api('/api/v1/knowledge/' + encodeURIComponent(row.documentId));
        report(doc.parse_status || 'unknown', row.path, { documentId: row.documentId });
        if (doc.parse_status !== 'completed') process.exitCode = 1;
      } catch (error) {
        if (!(error instanceof Error)) throw error;
        report('failed', row.path, { message: error.message });
        process.exitCode = 1;
      }
    }
    console.log(JSON.stringify({ recorded: records.size }));
    return;
  }
  if (values.apply) await api(kbPath);
  const seen = new Set();
  const summary = { unchanged: 0, candidates: 0, submitted: 0, missing: 0, failed: 0 };
  for await (const absolute of walk(root)) {
    const name = path.relative(root, absolute).split(path.sep).join('/');
    seen.add(name);
    const previous = records.get(name);
    try {
      const before = await stat(absolute);
      if (!before.size || before.size > maxBytes) throw new Error('File is empty or exceeds the size limit.');
      const data = await readFile(absolute);
      const after = await stat(absolute);
      if (after.size !== data.length || after.mtimeMs !== before.mtimeMs) throw new Error('Source changed while reading. Retry after OneDrive finishes syncing.');
      const hash = sha256(data);
      if (hash === previous?.sha256) {
        summary.unchanged++;
        continue;
      }
      summary.candidates++;
      if (!values.apply) {
        report(previous ? 'changed' : 'new', name);
        continue;
      }
      const documentId = await upload(absolute, name, data, hash);
      const previousIds = new Set(previous?.previousIds);
      if (previous?.documentId && previous.documentId !== documentId) previousIds.add(previous.documentId);
      previousIds.delete(documentId);
      records.set(name, { path: name, sha256: hash, documentId, previousIds: [...previousIds] });
      await saveState(records);
      summary.submitted++;
      report('submitted', name, { documentId, previousIds: [...previousIds] });
    } catch (error) {
      report('failed', name, { message: error.message });
      summary.failed++;
    }
  }
  for (const row of records.values()) {
    if (seen.has(row.path)) continue;
    report('source-missing', row.path, { documentId: row.documentId });
    summary.missing++;
  }
  console.log(JSON.stringify(summary));
  if (summary.failed) process.exitCode = 1;
}

if (values.apply) {
  await mkdir(path.dirname(stateFile), { recursive: true });
  const lock = stateFile + '.lock';
  const held = await open(lock, 'wx').catch((error) => {
    if (error.code === 'EEXIST') throw new Error(`Another import holds ${lock}. Clear it only after verifying that the importer has stopped.`);
    throw error;
  });
  try { await run(); }
  finally {
    await held.close();
    await unlink(lock);
  }
} else await run();
