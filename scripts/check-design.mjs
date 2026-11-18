/**
 * 设计规范自检：让 DESIGN.md 里写的规则变成会失败的门槛，而不是靠肉眼比对截图。
 *
 * 检查项：
 *   1. 裸色值 —— 除 token 定义行外，CSS 里不许出现 #hex / rgb() / rgba()
 *   2. 字重 —— 只允许 400 / 600 / 700（Spotify 的二值制 + 次级强调）
 *   3. 圆角 —— 只允许 4 / 6 / 8 / 12 / 999px（50% 圆用于图标按钮）
 *   4. 死 token —— 定义了却从没被 var() 用到的 --sch-* 变量
 *   5. 文档漂移 —— DESIGN.md 里出现的色值必须能在 CSS token 里找到
 *
 * 例外写法（都是有意的，不是漏网）：
 *   · token 定义行本身：`--sch-xxx: ...`
 *   · 行内注释 `design-ok: 理由`（例如 mask 语法必须用 #000）
 *
 * 用法：node scripts/check-design.mjs
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const uiPath = path.join(root, 'plugins/schanora/client/src/ui.js');
const docPath = path.join(root, 'DESIGN.md');

const WEIGHTS = new Set(['400', '600', '700']);
const RADII = new Set(['4', '6', '8', '12', '999']);
/** 9 档：micro / eyebrow / control / body / subhead / title / section / brand / display */
const SIZES = new Set(['10', '10.5', '11', '12', '13', '14', '16', '18', '21']);
/** 这些 token 只在深色覆盖里改值，不单独使用也算正常 */
const TOKEN_UNUSED_OK = new Set(['--sch-radius-sm']);

const failures = [];
const check = (name, ok, detail) => {
  if (!ok) failures.push(`${name}${detail ? ' — ' + detail : ''}`);
  console.log(`${ok ? '  ✓' : '  ✗'} ${name}${detail && !ok ? ' — ' + detail : ''}`);
};
const warn = (name, detail) => console.log(`  · ${name}${detail ? ' — ' + detail : ''}`);

const source = await readFile(uiPath, 'utf8');
const cssStart = source.indexOf('const CSS = `');
const cssEnd = source.indexOf('`;\n\n  let styleInjected');
if (cssStart < 0 || cssEnd < 0) {
  console.error('[design] 找不到 ui.js 里的 CSS 模板字符串');
  process.exit(1);
}
const css = source.slice(cssStart + 13, cssEnd);
const firstLine = source.slice(0, cssStart + 13).split('\n').length;
const lines = css.split('\n').map((text, i) => ({ no: firstLine + i, text }));

console.log('[design] 规则源:', path.relative(root, uiPath));

// --- 1. 裸色值 ---------------------------------------------------------------
const isTokenDef = (t) => /^\s*--sch-[\w-]+\s*:/.test(t);
const isExempt = (t) => t.includes('design-ok') || /mask(-image)?\s*:/.test(t);
const rawColor = [];
const tokens = new Map();
for (const { no, text } of lines) {
  if (isTokenDef(text)) {
    const m = text.match(/^\s*(--sch-[\w-]+)\s*:\s*(.+?);/);
    if (m) tokens.set(m[1], m[2].trim());
    continue;
  }
  if (isExempt(text) || text.trim().startsWith('/*')) continue;
  const hex = text.match(/#[0-9a-fA-F]{3,8}\b/g);
  const rgb = text.match(/\brgba?\([^)]*\)/g);
  if (hex || rgb) rawColor.push(`${no}: ${[...(hex || []), ...(rgb || [])].join(' ')}`);
}
check('没有裸色值（一律走 token）', rawColor.length === 0, rawColor.slice(0, 4).join(' | '));

// --- 2. 字重 -----------------------------------------------------------------
const badWeights = [];
for (const { no, text } of lines) {
  for (const m of text.matchAll(/font-weight:\s*(\d+)/g)) {
    if (!WEIGHTS.has(m[1])) badWeights.push(`${no}: ${m[1]}`);
  }
}
check('字重只有 400 / 600 / 700', badWeights.length === 0, badWeights.join(', '));

// --- 3. 圆角 -----------------------------------------------------------------
const badRadii = [];
for (const { no, text } of lines) {
  for (const m of text.matchAll(/border-radius:\s*([\d.]+)px/g)) {
    if (!RADII.has(m[1])) badRadii.push(`${no}: ${m[1]}px`);
  }
}
check('圆角落在 4 / 6 / 8 / 12 / 999px', badRadii.length === 0, badRadii.join(', '));

// --- 3b. 字号 ----------------------------------------------------------------
const badSizes = [];
for (const { no, text } of lines) {
  for (const m of text.matchAll(/font-size:\s*([\d.]+)px/g)) {
    if (!SIZES.has(m[1])) badSizes.push(`${no}: ${m[1]}px`);
  }
}
check('字号落在 9 档字阶内', badSizes.length === 0, badSizes.join(', '));

// --- 4. 死 token -------------------------------------------------------------
const unused = [...tokens.keys()].filter(
  (name) => !TOKEN_UNUSED_OK.has(name) && !new RegExp(`var\\(${name}[,)]`).test(css),
);
check('没有定义未用的 token', unused.length === 0, unused.join(', '));

// --- 5. DESIGN.md 与代码不漂移 ------------------------------------------------
let designDoc = '';
try {
  designDoc = await readFile(docPath, 'utf8');
} catch {
  check('DESIGN.md 存在', false, '根目录缺 DESIGN.md');
}
if (designDoc) {
  check('DESIGN.md 存在', true);
  const front = designDoc.split('---')[1] || '';
  const docColors = [...front.matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map((m) => m[0].toUpperCase());
  const cssColors = new Set(
    [...css.matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map((m) => m[0].toUpperCase()),
  );
  const drift = [...new Set(docColors)].filter((c) => !cssColors.has(c));
  check('DESIGN.md 的色值都能在代码里找到', drift.length === 0, drift.join(', '));

  const docTokens = [...front.matchAll(/--sch-[\w-]+|\b(colors|typography|rounded|spacing)\b/g)];
  check('DESIGN.md 带 YAML front matter', front.includes('colors:') && front.includes('typography:'),
    docTokens.length ? '' : '没有 colors/typography 段');
}

console.log('');
if (failures.length) {
  console.error(`[design] 失败 ${failures.length} 项 —— 改样式前先看 DESIGN.md`);
  process.exit(1);
}
console.log(`[design] 通过 · ${tokens.size} 个 token · 0 处裸色值 · 字重与圆角全在规范内`);
