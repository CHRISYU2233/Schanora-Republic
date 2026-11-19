import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { access, copyFile, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const { values } = parseArgs({
  options: {
    runtime: { type: 'string' },
    root: { type: 'string' },
    port: { type: 'string' },
    demo: { type: 'boolean' },
    prepare: { type: 'boolean' },
  },
});
const version = '0.9.0';
if (values.demo && values.root) throw new Error('--demo 与 --root 不能一起使用');
const bundledRuntime = fileURLToPath(new URL('../runtime/weknora-0.9.0', import.meta.url));
const runtime = path.resolve(values.runtime || process.env.SCHANORA_WEKNORA_DIR || bundledRuntime);
const binary = path.join(runtime, process.platform === 'win32' ? 'WeKnora-lite.exe' : 'WeKnora-lite');
const web = path.join(runtime, 'web');
for (const file of [binary, path.join(web, 'index.html'), path.join(runtime, 'config/config.yaml'), path.join(runtime, 'migrations/sqlite')]) {
  await access(file).catch(() => {
    throw new Error(`缺少 ${file}。请按 README 准备 WeKnora ${version} Lite。`);
  });
}
const workbench = path.join(web, 'schanora');
await mkdir(workbench, { recursive: true });
for (const [name, source] of Object.entries({
  'workspace.html': 'web/weknora.html',
  'workspace.css': 'web/workspace.css',
  'workspace.js': 'web/workspace.js',
  'start.js': 'web/weknora-start.js',
  'weknora-api.js': 'web/weknora-api.js',
  'react.production.min.js': 'preview/vendor/react.production.min.js',
  'react-dom.production.min.js': 'preview/vendor/react-dom.production.min.js',
  'client.js': 'plugins/schanora/client/client.js',
})) {
  await copyFile(new URL(`../${source}`, import.meta.url), path.join(workbench, name));
}
const nativeIndex = path.join(web, 'index.html');
const indexHtml = await readFile(nativeIndex, 'utf8');
const redirect = '<script src="/schanora/start.js"></script>';
if (!indexHtml.includes(redirect)) {
  if (!indexHtml.includes('<head>')) throw new Error('WeKnora 前端缺少预期的 head 标签');
  await writeFile(nativeIndex, indexHtml.replace('<head>', '<head>\n    ' + redirect));
}
if (values.prepare) {
  console.log('[Schanora] 已部署工作区静态文件。');
  process.exit(0);
}

const port = Number(values.port ?? process.env.SCHANORA_WEKNORA_PORT ?? 8080);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('端口须为 1–65535 的整数');
const origin = `http://127.0.0.1:${port}`;
const portProbe = createServer();
portProbe.listen(port, '127.0.0.1');
try {
  await once(portProbe, 'listening');
} catch (error) {
  if (error.code !== 'EADDRINUSE') throw error;
  throw new Error(`端口 ${port} 已被占用。请关闭已有实例或指定其他端口。`, { cause: error });
}
await new Promise((resolve) => portProbe.close(resolve));

const root = values.demo
  ? await mkdtemp(path.join(os.tmpdir(), 'schanora-weknora-'))
  : path.resolve(values.root || process.env.SCHANORA_WEKNORA_ROOT || path.join(os.homedir(), 'Schanora', 'weknora-0.9.0'));
await mkdir(root, { recursive: true });

const keyFile = path.join(root, '.weknora-secrets.json');
const keyLengths = { JWT_SECRET: 64, SYSTEM_SIGNING_KEY: 64, SYSTEM_AES_KEY: 32 };
const generated = Object.fromEntries(
  Object.entries(keyLengths).map(([key, length]) => [key, randomBytes(length / 2).toString('hex')]),
);
try {
  await writeFile(keyFile, JSON.stringify(generated), { flag: 'wx', mode: 0o600 });
} catch (error) {
  if (error.code !== 'EEXIST') throw error;
}
const keys = JSON.parse(await readFile(keyFile, 'utf8'));
for (const [key, length] of Object.entries(keyLengths)) {
  if (typeof keys[key] !== 'string' || keys[key].length !== length || !/^[0-9a-f]+$/.test(keys[key])) {
    throw new Error(`数据目录的启动密钥文件无效：${keyFile}`);
  }
}

const child = spawn(binary, [], {
  cwd: runtime,
  stdio: 'inherit',
  env: {
    ...process.env,
    JWT_SECRET: process.env.JWT_SECRET || keys.JWT_SECRET,
    SYSTEM_SIGNING_KEY: process.env.SYSTEM_SIGNING_KEY || keys.SYSTEM_SIGNING_KEY,
    SYSTEM_AES_KEY: process.env.SYSTEM_AES_KEY || keys.SYSTEM_AES_KEY,
    SERVER_HOST: '127.0.0.1',
    SERVER_PORT: String(port),
    WEKNORA_WEB_DIR: web,
    DB_DRIVER: 'sqlite',
    DB_PATH: path.join(root, 'weknora.db'),
    RETRIEVE_DRIVER: 'sqlite',
    STORAGE_TYPE: 'local',
    LOCAL_STORAGE_BASE_DIR: path.join(root, 'files'),
    STREAM_MANAGER_TYPE: 'memory',
    WEKNORA_SANDBOX_MODE: 'disabled',
  },
});
const exited = once(child, 'exit');
const stop = () => {
  // Windows consoles deliver Ctrl+C to the native child as well.
  if (process.platform !== 'win32') child.kill('SIGTERM');
};
process.on('SIGINT', stop);
process.on('SIGTERM', () => child.kill('SIGTERM'));

const startup = new AbortController();
const ready = async () => {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const signal = AbortSignal.any([startup.signal, AbortSignal.timeout(1000)]);
    const response = await fetch(`${origin}/health`, { signal }).catch(() => null);
    if (response?.ok && (await response.json().catch(() => null))?.status === 'ok') return;
    await sleep(500, undefined, { signal: startup.signal });
  }
  throw new Error('WeKnora 启动超时。请查看上方日志。');
};
try {
  await Promise.race([ready(), exited.then(() => { throw new Error('WeKnora 在就绪前退出。'); })]);
  console.log(`[Schanora] Schanora 工作区 ${origin}/schanora/workspace.html`);
  console.log(`[Schanora] WeKnora 管理 ${origin}/platform/knowledge-bases`);
  console.log(`[Schanora] 资料目录 ${root}`);
  const [code] = await exited;
  process.exitCode = code ?? 0;
} catch (error) {
  startup.abort();
  child.kill();
  throw error;
}
