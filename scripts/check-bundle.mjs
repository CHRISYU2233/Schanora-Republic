/**
 * 无浏览器的 bundle 自检：不启动 Chrome 也能发现「注册漏了 / 字典缺 en / 编码坏了」。
 *
 * 检查项：
 *   1. bundle 以 loader 形式注册，id 正确
 *   2. factory 返回 inject + apply
 *   3. apply 在槽位里注册了 侧栏入口 / 主面板 / Session 头部控件
 *   4. zh 与 en 的 key 完全一致（DSH 要求两种基础语言齐全）
 *   5. 文件无 BOM、无乱码
 *
 * 用法：node scripts/check-bundle.mjs
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bundlePath = path.join(root, 'plugins/schanora/client/client.js');
const source = await readFile(bundlePath, 'utf8');

const failures = [];
const check = (name, ok, detail) => {
  if (!ok) failures.push(`${name}${detail ? ' — ' + detail : ''}`);
  console.log(`${ok ? '  ✓' : '  ✗'} ${name}${detail && !ok ? ' — ' + detail : ''}`);
};

console.log('[check] bundle:', path.relative(root, bundlePath));

check('无 BOM', source.charCodeAt(0) !== 0xfeff);
check('无乱码', !/婕旂|锛|銆|鈥|鏁版/.test(source));
check('文件以 UTF-8 可解码', !source.includes('\uFFFD'));

// --- 在 vm 里跑 bundle，用桩捕获注册 ---------------------------------------
let captured = null;
const registrations = [];
const noop = () => {};
const fakeStorage = new Map();

const reactStub = {
  createElement: (type, props, ...children) => ({ type, props, children }),
  useState: (init) => [typeof init === 'function' ? init() : init, noop],
  useEffect: noop,
  useMemo: (fn) => fn(),
  useRef: () => ({ current: null }),
  useCallback: (fn) => fn,
};

const sandbox = {
  console,
  setTimeout,
  clearTimeout,
  fetch: async () => {
    throw new Error('check-bundle 不发起网络请求');
  },
  AbortController,
  JSON,
  Math,
  Date,
};
sandbox.window = {
  __ModuleLoader__: {
    load(def) {
      captured = def;
    },
  },
  localStorage: {
    getItem: (k) => (fakeStorage.has(k) ? fakeStorage.get(k) : null),
    setItem: (k, v) => fakeStorage.set(k, String(v)),
    removeItem: (k) => fakeStorage.delete(k),
  },
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(source, sandbox, { filename: 'client.js' });

check('注册了 module', Boolean(captured && captured.id));
check('module id 正确', captured?.id === '@schanora/client', captured?.id);

const api = captured.factory((name) => {
  if (name === 'react') return reactStub;
  throw new Error(`未提供的模块：${name}`);
});

check('导出 inject', Array.isArray(api.inject) && api.inject.length > 0, JSON.stringify(api.inject));
check('导出 apply', typeof api.apply === 'function');

const ctx = {
  slots: {
    register(meta) {
      registrations.push(meta);
      return noop;
    },
    inject(name, callback) {
      const out = callback();
      if (out && typeof out.next === 'function') {
        let step = out.next();
        while (!step.done) step = out.next();
      }
      return noop;
    },
  },
  locale: {
    register() {
      return noop;
    },
    bind: () => (key) => key,
  },
  layout: { selectPanel: noop },
  effect: (fn) => fn(),
};

api.apply(ctx);

const slotNames = registrations.map((r) => r.name);
check('注册侧栏入口 sidebar.panellist', slotNames.includes('sidebar.panellist'));
check('注册主面板 main', slotNames.includes('main'));
check('注册 Session 头部控件', slotNames.includes('conversation.session.header.utilities'));

const main = registrations.find((r) => r.name === 'main');
const panel = registrations.find((r) => r.name === 'sidebar.panellist');
check('主面板 key 与侧栏 id 一致', main?.key === panel?.id, `${main?.key} vs ${panel?.id}`);

// --- 字典齐备 -------------------------------------------------------------
const dict = api.DICT || {};
const zhKeys = Object.keys(dict.zh || {}).sort();
const enKeys = Object.keys(dict.en || {}).sort();
check('zh 字典存在', zhKeys.length > 0, `${zhKeys.length} keys`);
check('en 字典存在', enKeys.length > 0, `${enKeys.length} keys`);
const missingEn = zhKeys.filter((k) => !enKeys.includes(k));
const extraEn = enKeys.filter((k) => !zhKeys.includes(k));
check('zh/en key 一致', missingEn.length === 0 && extraEn.length === 0,
  missingEn.length || extraEn.length ? `缺 ${missingEn.join(',')} 多 ${extraEn.join(',')}` : '');

// --- 占位符一致性（{n} 之类不能只在一侧出现）-------------------------------
const placeholderMismatch = zhKeys.filter((k) => {
  if (!dict.en[k]) return false;
  const a = (dict.zh[k].match(/\{[a-zA-Z]+\}/g) || []).sort().join();
  const b = (dict.en[k].match(/\{[a-zA-Z]+\}/g) || []).sort().join();
  return a !== b;
});
check('占位符两侧一致', placeholderMismatch.length === 0, placeholderMismatch.join(','));

console.log('');
if (failures.length) {
  console.error(`[check] 失败 ${failures.length} 项`);
  process.exit(1);
}
console.log(`[check] 全部通过 · ${registrations.length} 个槽位注册 · ${zhKeys.length} 条字典`);
