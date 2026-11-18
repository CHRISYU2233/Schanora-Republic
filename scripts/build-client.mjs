/**
 * 把 src/ui.js 包成 DSH 客户端 bundle（client.js）。
 *
 * 为什么不用打包器：DSH 客户端 bundle 就是一个 `window.__ModuleLoader__.load({id, factory})`
 * 调用，factory 里 `require('react')` 拿宿主 React。我们不需要 JSX、不需要拆包，
 * 一个 node 脚本把源码内联进去就够了 —— 少一层构建，就少一处和宿主版本对不上的地方。
 *
 * 额外做两件事（因为上一版就栽在这两处）：
 *   1. 输出必须是 UTF-8 无 BOM，且不含常见乱码序列；
 *   2. 输出前做一次语法检查（new Function），语法错不落盘。
 *
 * 用法：node scripts/build-client.mjs
 */
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkgDir = path.join(root, 'plugins/schanora/client');
const srcPath = path.join(pkgDir, 'src/ui.js');
const assetsPath = path.join(pkgDir, 'src/assets.js');
const outPath = path.join(pkgDir, 'client.js');

/** 典型 UTF-8 被按 GBK 解读后再存回来的痕迹。出现即说明编码链路坏了。 */
const MOJIBAKE = ['婕旂', '锛', '銆', '鈥', '鏁版', '鐭ヨ瘑', '\uFFFD'];

const source = await readFile(srcPath, 'utf8');
// 品牌图以 base64 内联：DSH 只加载一个 client.js，运行时没有可靠的插件资源目录。
const assets = await readFile(assetsPath, 'utf8');
if (!/["']?symbol["']?\s*:\s*"data:image\/png;base64,/.test(assets)) {
  console.error('[build-client] src/assets.js 里没有 symbol 图，先跑 node scripts/gen-assets.mjs');
  process.exit(1);
}

/**
 * src/lib/*.js 是可单测的 ESM（node --test 直接 import），但 DSH 的 bundle 是
 * 一个函数体，不能出现 import/export。这里去掉 `export` 前缀后原地内联，
 * 让 ui.js 像调用本地函数一样调用它们 —— 一份源码，两种消费方式。
 */
const libDir = path.join(pkgDir, 'src/lib');
const libFiles = (await readdir(libDir)).filter((name) => name.endsWith('.js')).sort();
const libSource = (
  await Promise.all(
    libFiles.map(async (name) => {
      const text = await readFile(path.join(libDir, name), 'utf8');
      const stripped = text.replace(/^export\s+(?=(?:async\s+)?function|const|let|class)/gm, '');
      if (/^\s*(?:import|export)\s/m.test(stripped)) {
        console.error(`[build-client] src/lib/${name} 里仍有 import/export，bundle 无法内联`);
        process.exit(1);
      }
      return `/* ---- src/lib/${name}（移植模块）---- */\n${stripped}`;
    }),
  )
).join('\n');

const bundle = `/* 由 scripts/build-client.mjs 生成，请勿直接编辑；改 src/ui.js 后重新运行。 */
window.__ModuleLoader__.load({
  id: '@schanora/client',
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    const React = require('react');
    let _api = null;

${assets}

${libSource}

${source}

    _api = createSchanoraClient(React);
    exports.NS = _api.NS;
    exports.PANEL_ID = _api.PANEL_ID;
    exports.DICT = _api.DICT;
    exports.inject = _api.inject;
    exports.apply = _api.apply;
    return module.exports;
  },
});
`.replace(/\r\n/g, '\n');

// 语法检查：bundle 里用了 return，不能直接 new Function，包一层函数体再编译。
try {
  // eslint-disable-next-line no-new-func
  new Function(bundle);
} catch (error) {
  console.error('[build-client] 语法检查失败：', error.message);
  process.exit(1);
}

for (const bad of MOJIBAKE) {
  if (bundle.includes(bad)) {
    console.error(`[build-client] 检测到乱码片段 "${bad}"，拒绝写入。检查源文件编码。`);
    process.exit(1);
  }
}

if (bundle.includes('\uFEFF')) {
  console.error('[build-client] 检测到 BOM，拒绝写入（DSH 页面会把它当成正文首字符）。');
  process.exit(1);
}

await writeFile(outPath, bundle, { encoding: 'utf8' });

const bytes = Buffer.byteLength(bundle, 'utf8');
console.log(`[build-client] 已生成 ${path.relative(root, outPath)} · ${bytes} bytes · ${bundle.split('\n').length} 行`);
