/**
 * 把品牌图内联成 `src/assets.js`（base64 data URI）。
 *
 * 为什么内联：DSH 加载客户端插件只取一个 `client.js`，运行时没有稳定的
 * 「插件自己的资源目录」可用来拼图片 URL；把两张小图内联进 bundle 最稳，
 * 预览和宿主看到的也是同一份字节。
 *
 * 素材来源：
 *   symbol   交接包 brand/schanora-symbol.png 的等比缩小版（96×96）
 *   wordmark assets/schanora-wordmark-src.png（2026-11-17 换版：透明底 + 品牌绿字，
 *            用户提供），由 trim-wordmark.mjs 紧裁切并缩到 96px 高
 *
 * 用法：node scripts/gen-assets.mjs（换 logo 时先跑 trim-wordmark.mjs 再跑本脚本）
 */
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkgDir = path.join(root, 'plugins/schanora/client');

const files = {
  symbol: 'assets/schanora-symbol-96.png',
  // 紧裁切版（scripts/trim-wordmark.mjs 生成）：四周留白去掉，同样高度下字形更大
  wordmark: 'assets/schanora-wordmark-trim.png',
};

/** 读 PNG 头里的宽高与色型，用来在构建时断言「没换错图」。 */
function pngInfo(buf) {
  const sig = buf.subarray(0, 8).toString('hex');
  if (sig !== '89504e470d0a1a0a') throw new Error('不是 PNG');
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20), colorType: buf[25] };
}

const out = {};
const report = [];

for (const [key, rel] of Object.entries(files)) {
  const abs = path.join(pkgDir, rel);
  const buf = await readFile(abs);
  const info = pngInfo(buf);
  out[key] = `data:image/png;base64,${buf.toString('base64')}`;
  report.push(`${key}: ${rel} ${info.width}×${info.height} ${(buf.length / 1024).toFixed(1)}KB`);
}

const header = `/* 由 scripts/gen-assets.mjs 生成，请勿手改。
 * 源图：assets/schanora-symbol-96.png、assets/schanora-wordmark-trim.png（2026-11-17 换版，
 * 透明底绿字，来自 assets/schanora-wordmark-src.png）。
 * 换 logo 时替换 assets/ 下的 PNG，重跑 trim-wordmark.mjs 再重跑本脚本。
 */
`;

const body = `${header}const ASSETS = ${JSON.stringify(out, null, 2)};\n`;

await writeFile(path.join(pkgDir, 'src/assets.js'), body, 'utf8');

console.log('[gen-assets] 已生成 src/assets.js');
for (const line of report) console.log('  · ' + line);
console.log(`  · 合计 ${(Buffer.byteLength(body) / 1024).toFixed(1)}KB（base64）`);
