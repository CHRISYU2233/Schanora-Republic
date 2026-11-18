/**
 * 把字标 PNG 裁到字形真实边界（去掉四周大片留白），输出 assets/schanora-wordmark-trim.png。
 *
 * 为什么需要：字标原图四周留白很大。直接按高度缩放到侧栏品牌带上，字形只占约 60%，
 * 看起来「logo 很小」。裁切后同样的高度里字形能占满。
 *
 * 2026-11-17 换版：源图改为 assets/schanora-wordmark-src.png（2172×724，透明底 +
 * 品牌绿字，用户提供）。做法改为两步：
 *   1. Chrome headless 里用 canvas 扫像素，取与左上角底色差异超过阈值的包围盒；
 *   2. 把包围盒区域等比缩到目标高度（TARGET_H，默认 96px）再导出 —— 渲染端最大
 *      用到 30px CSS 高（2x 屏 60px），96px 有充足余量，同时避免 456KB 原图直接
 *      内联把 bundle 撑爆。不引第三方图像库。
 *
 * 用法：node scripts/trim-wordmark.mjs
 */
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkgDir = path.join(root, 'plugins/schanora/client');
const src = path.join(pkgDir, 'assets/schanora-wordmark-src.png');
const dst = path.join(pkgDir, 'assets/schanora-wordmark-trim.png');
const tmpDir = path.join(root, '.tmp-trim');
const TARGET_H = 96;

const chrome = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';

const buf = await readFile(src);
const dataUri = `data:image/png;base64,${buf.toString('base64')}`;

const html = `<!doctype html><meta charset="utf-8"><body><pre id="out">pending</pre>
<script>
const img = new Image();
img.onload = () => {
  const c = document.createElement('canvas');
  c.width = img.naturalWidth; c.height = img.naturalHeight;
  const g = c.getContext('2d');
  g.drawImage(img, 0, 0);
  const { data, width, height } = g.getImageData(0, 0, c.width, c.height);
  const bg = [data[0], data[1], data[2], data[3]];
  let x0 = width, y0 = height, x1 = -1, y1 = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const d = Math.abs(data[i] - bg[0]) + Math.abs(data[i + 1] - bg[1]) + Math.abs(data[i + 2] - bg[2]);
      if (d > 90) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    }
  }
  const pad = 6;
  x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad);
  x1 = Math.min(width - 1, x1 + pad); y1 = Math.min(height - 1, y1 + pad);
  const w = x1 - x0 + 1, h = y1 - y0 + 1;
  // 裁切后等比缩到 TARGET_H：渲染端最大 30px CSS 高，96px 对 2x 屏仍有余量
  const outH = ${TARGET_H};
  const outW = Math.round(w * (outH / h));
  const out = document.createElement('canvas');
  out.width = outW; out.height = outH;
  const og = out.getContext('2d');
  og.imageSmoothingEnabled = true;
  og.imageSmoothingQuality = 'high';
  og.drawImage(c, x0, y0, w, h, 0, 0, outW, outH);
  document.getElementById('out').textContent = JSON.stringify({
    src: [width, height], box: [x0, y0, w, h], out: [outW, outH], png: out.toDataURL('image/png'),
  });
};
img.src = '${dataUri}';
</script></body>`;

await mkdir(tmpDir, { recursive: true });
const htmlPath = path.join(tmpDir, 'trim.html');
await writeFile(htmlPath, html, 'utf8');

const dom = await new Promise((resolve, reject) => {
  execFile(
    chrome,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-sandbox',
      '--allow-file-access-from-files',
      '--virtual-time-budget=4000',
      '--dump-dom',
      `file:///${htmlPath.replace(/\\/g, '/')}`,
    ],
    { maxBuffer: 64 * 1024 * 1024 },
    (err, stdout) => (err ? reject(err) : resolve(stdout)),
  );
});

const m = dom.match(/\{"src":\[[\s\S]*?\}<\/pre>/);
if (!m) throw new Error('没拿到裁切结果，检查 Chrome 是否可执行：' + chrome);
const payload = JSON.parse(m[0].replace(/<\/pre>$/, ''));
const png = Buffer.from(payload.png.split(',')[1], 'base64');
await writeFile(dst, png);
await rm(tmpDir, { recursive: true, force: true });

console.log('[trim-wordmark] 源图', payload.src.join('×'), '→ 包围盒', payload.box.join('，'),
  '→ 缩放输出', payload.out.join('×'));
console.log('[trim-wordmark] 已写出 assets/schanora-wordmark-trim.png ·', (png.length / 1024).toFixed(1) + 'KB');
