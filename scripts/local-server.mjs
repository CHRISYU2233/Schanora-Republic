/**
 * 独立跑本地内核（不装 DSH 也能用）。
 *
 *   node scripts/local-server.mjs                     # 端口 4317，同时把预览台也serve在同一端口
 *   node scripts/local-server.mjs --port 4400         # 换端口
 *   node scripts/local-server.mjs --root "D:/资料/Schanora"   # 换数据目录
 *   node scripts/local-server.mjs --no-static         # 只提供 API
 *
 * 预览台与 API 同源有个实际好处：没有跨端口 CORS，也不需要前端去猜端口 ——
 * 打开 http://127.0.0.1:4317/preview/ 时 baseUrl 直接用空串（相对路径）。
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from '../plugins/schanora/client/src/server/http.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function arg(name, fallback = '') {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : fallback;
}

const port = Number(arg('port', process.env.SCHANORA_PORT || 4317));
if (!Number.isInteger(port) || port < 0 || port > 65531) {
  throw new Error('端口必须为 0 到 65531 的整数。0 表示自动分配。');
}
const dataRoot = arg('root', process.env.SCHANORA_ROOT || '');
const serveStatic = !process.argv.includes('--no-static');
const web = process.argv.includes('--web');

const started = await startServer({
  port,
  root: dataRoot || undefined,
  staticRoot: serveStatic ? root : '',
  runtime: web ? 'web' : 'preview',
});

console.log('[schanora] 本地内核已启动');
console.log(`  接口    ${started.baseUrl}/api/v1/...`);
console.log(`  健康    ${started.baseUrl}/health`);
if (serveStatic) console.log(`  浏览器  ${started.baseUrl}${web ? '/' : '/preview/'}`);
console.log(`  数据    ${started.root}`);

const shutdown = async () => {
  console.log('\n[schanora] 正在关闭…');
  await started.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
