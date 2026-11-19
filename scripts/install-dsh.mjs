/**
 * 把 Schanora 工作台和 WeKnora 会话工具接到某个 DSH profile 上。
 * 使用 --legacy 可以为原 Node.js 资料库恢复旧插件入口。
 *
 * DSH 加载一个插件的必要条件有两条，缺一条都不会出现界面：
 *   1) profile 的 dependencies 里有 @schanora/client，且指向本仓库的 plugins/schanora/client
 *   2) profile 的 dsh.profile.bundles 里列出了 "@schanora/client"
 *      （bundles 决定「启动时读哪个包的 cordis.patch.yml」，patch 再 insert 出 loader 条目）
 *
 * 默认只演练（打印将要做的修改）；加 --apply 才真正写入，写入前自动备份 package.json。
 * 用 Node 而不是 ps1：Windows 默认执行策略会拦住 .ps1，而 Node 一定有（DSH 本身就跑在 Node 上）。
 *
 * 用法：
 *   node scripts/install-dsh.mjs                  # 演练
 *   node scripts/install-dsh.mjs --apply          # 写入
 *   node scripts/install-dsh.mjs --profile work --apply
 */
import { readFile, writeFile, copyFile, access } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const apply = args.includes('--apply');
const weknora = !args.includes('--legacy');
if (!weknora && args.includes('--weknora')) throw new Error('--weknora 与 --legacy 不能一起使用');
const profileIndex = args.indexOf('--profile');
const profile = profileIndex >= 0 ? args[profileIndex + 1] : 'desktop';

const legacyPackage = '@schanora/client';
const workbenchPackage = '@schanora/weknora-workspace';
const officialTools = '@wxg-prc-cpg/dsh-weknora';
const officialToolsVersion = '0.1.0';
const PKG_NAME = weknora ? workbenchPackage : legacyPackage;
const pluginDir = path.join(root, 'plugins/schanora', weknora ? 'weknora-workspace' : 'client');
const dshHome = process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
const profileDir = path.join(dshHome, 'profiles', profile);
const pkgPath = path.join(profileDir, 'package.json');

const fail = (msg) => {
  console.error(`✗ ${msg}`);
  process.exit(1);
};

console.log(`插件目录 : ${pluginDir}`);
console.log(`profile  : ${profileDir}\n`);

try {
  await access(pluginDir);
} catch {
  fail(`找不到插件目录：${pluginDir}`);
}

// --- 预检：manifest 与产物 ---------------------------------------------------
let manifest;
try {
  manifest = JSON.parse(await readFile(path.join(pluginDir, 'package.json'), 'utf8'));
} catch {
  fail('读不到插件 package.json');
}
if (manifest.name !== PKG_NAME) fail(`插件包名应为 ${PKG_NAME}，实际是 ${manifest.name}`);
if (!manifest.dsh?.bundle?.patch) fail('package.json 缺少 dsh.bundle.patch');
if (!manifest.dsh?.client?.platform) fail('package.json 缺少 dsh.client.platform');

for (const file of ['client.js', manifest.dsh.bundle.patch, 'index.js']) {
  try {
    await access(path.join(pluginDir, file));
  } catch {
    fail(`缺少 ${file}${file === 'client.js' ? '（先跑 node scripts/build-client.mjs）' : ''}`);
  }
}

const clientSource = await readFile(path.join(pluginDir, 'client.js'), 'utf8');
if (!clientSource.includes('__ModuleLoader__.load')) fail('client.js 不是 DSH 的 loader 形式');
if (clientSource.charCodeAt(0) === 0xfeff) fail('client.js 带 BOM');

console.log(`✓ 预检通过：${manifest.name}@${manifest.version}`);

// --- profile -----------------------------------------------------------------
let pkgRaw;
try {
  pkgRaw = await readFile(pkgPath, 'utf8');
} catch {
  fail(`找不到 profile 的 package.json：${pkgPath}\n  用 --profile <名字> 指定，或先确认 DSH 装过。`);
}

const pkg = JSON.parse(pkgRaw);
pkg.dependencies = pkg.dependencies || {};
pkg.dsh = pkg.dsh || {};
pkg.dsh.profile = pkg.dsh.profile || {};
pkg.dsh.profile.bundles = pkg.dsh.profile.bundles || [];

// pnpm 的 link: 会把目录原样软链进 node_modules，不复制、不打包 —— 改完源码重跑 build 就生效。
const spec = `link:${pluginDir.replace(/\\/g, '/')}`;
const current = pkg.dependencies[PKG_NAME];
const inBundles = pkg.dsh.profile.bundles.includes(PKG_NAME);

console.log(`依赖项   : ${PKG_NAME}`);
console.log(`当前值   : ${current || '(未安装)'}`);
console.log(`目标值   : ${spec}`);
console.log(`bundles  : ${inBundles ? '已包含' : '缺少 → 将追加'}\n`);

const depOk = current === spec;
const bundlesOk = inBundles;
const bundles = pkg.dsh.profile.bundles;
const otherWorkspace = weknora ? legacyPackage : workbenchPackage;
const toolsOk = !weknora || (
  pkg.dependencies[officialTools] === officialToolsVersion &&
  bundles.includes(officialTools)
);
if (weknora) console.log(`官方会话工具 : ${officialTools}@${officialToolsVersion}\n`);

if (depOk && bundlesOk && toolsOk && !bundles.includes(otherWorkspace)) {
  console.log('profile 配置已一致，无需修改 package.json。');
} else if (!apply) {
  console.log('（演练模式，未写入。确认后加 --apply 执行）');
} else {
  const backup = `${pkgPath}.bak-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  await copyFile(pkgPath, backup);
  console.log(`已备份：${backup}`);

  pkg.dependencies[PKG_NAME] = spec;
  pkg.dsh.profile.bundles = bundles.filter((name) => name !== otherWorkspace);
  if (!bundlesOk) pkg.dsh.profile.bundles.push(PKG_NAME);
  if (weknora) {
    pkg.dependencies[officialTools] = officialToolsVersion;
    if (!pkg.dsh.profile.bundles.includes(officialTools)) pkg.dsh.profile.bundles.push(officialTools);
  }
  await writeFile(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
  console.log('已写入 package.json。');
}

console.log(`
接下来（顺序不能省）：
  1) cd "${profileDir}"
  2) corepack pnpm install
  3) 完全退出并重启 DeepSeek Harness
  4) ${weknora ? '打开 Schanora 侧栏面板。配置 WEKNORA_BASE_URL 与 WEKNORA_API_KEY 后，会话可用官方工具。' : '打开左侧栏的知识库面板。'}

回退：用上面的 .bak 覆盖 package.json，再 pnpm install 一次，重启宿主。
`);
