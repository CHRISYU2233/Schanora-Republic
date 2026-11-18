/**
 * 产出可以直接推到 GitHub 的目录：`dist/Schanora-frontend/`。
 *
 * 只拷交付需要的东西：插件包（含构建产物与内联素材）、预览台、脚本、证据与截图。
 * 不拷：.workbuddy、dist 自身、Chrome 临时 profile、临时截图缓存。
 *
 * 用法：node scripts/pack.mjs
 * 之后压缩：见 README / 用系统 zip 即可。
 */
import { cp, mkdir, rm, readdir, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'dist/Schanora-frontend');

const COPY = [
  'README.md',
  '.gitignore',
  'LICENSE',
  'DESIGN.md',
  'design',
  'package.json',
  'plugins',
  'preview',
  'web',
  'scripts',
  'test',
  'brand',
  'docs/api.md',
  'docs/evidence/M2M3-B.md',
  'docs/evidence/M4M5-B.md',
  'docs/evidence/M6-B.md',
  'docs/evidence/M7-B.md',
  'docs/evidence/M0-B.md',
  'docs/evidence/PLUGINS-REPORT.md',
  'docs/evidence/ACCEPTANCE-PLUGINS.csv',
  'docs/evidence/LIVE-INTEGRATION.md',
  'docs/evidence/DSH-INTEGRATION.md',
  'docs/evidence/MODEL-CONFIG.md',
  'docs/evidence/LOCAL-KERNEL.md',
  'docs/evidence/LIBRARY-MIGRATION.md',
  'docs/evidence/shots-M2M3',
  'docs/evidence/shots-M4M5',
  'docs/evidence/shots-M0',
  'docs/evidence/shots-host',
  'docs/evidence/shots-local',
  'docs/evidence/design',
  'docs/handoff',
  'docs/review',
];

// Chrome 调试 profile、node_modules、系统垃圾一律不进包
const SKIP = new Set(['.chrome-profile', '.tmp-verify-profile', '.tmp-live', '.tmp-live-profile', 'node_modules', '.DS_Store', 'Thumbs.db', 'dist']);

async function copyDir(src, dest) {
  await mkdir(dest, { recursive: true });
  for (const entry of await readdir(src, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) await copyDir(s, d);
    else await cp(s, d, { force: true });
  }
}

// 旧产物先进回收站；回收站不可用时（safe-delete 被中断/系统拦截）降级为原地覆盖，
// 全部文件用 force 覆写，不因目录被占用而整个失败。
try {
  await rm(out, { recursive: true, force: true });
} catch (e) {
  console.warn(`[pack] 旧产物未能删除，改为原地覆盖：${e.message.split('\n')[0]}`);
}
await mkdir(out, { recursive: true });

for (const rel of COPY) {
  const src = path.join(root, rel);
  const dest = path.join(out, rel);
  const info = await stat(src).catch(() => null);
  if (!info) {
    console.warn(`[pack] 跳过（不存在）：${rel}`);
    continue;
  }
  if (info.isDirectory()) await copyDir(src, dest);
  else {
    await mkdir(path.dirname(dest), { recursive: true });
    await cp(src, dest, { force: true });
  }
}

// 联调原始断言（live-<时间戳>.json）：文件名带时间戳，按前缀收集，供 A 侧复核
const evDir = path.join(root, 'docs/evidence');
const evOut = path.join(out, 'docs/evidence');
await mkdir(evOut, { recursive: true });
for (const f of await readdir(evDir)) {
  if (!/^live-.*\.json$/.test(f)) continue;
  await cp(path.join(evDir, f), path.join(evOut, f));
}

// 统计
let files = 0;
let bytes = 0;
async function walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) await walk(p);
    else {
      files += 1;
      bytes += (await stat(p)).size;
    }
  }
}
await walk(out);

console.log(`[pack] 已生成 ${path.relative(root, out)}`);
console.log(`  · ${files} 个文件 · ${(bytes / 1024 / 1024).toFixed(2)}MB`);
console.log('  · 压缩：powershell Compress-Archive -Path dist/Schanora-frontend -DestinationPath dist/Schanora-frontend.zip');
