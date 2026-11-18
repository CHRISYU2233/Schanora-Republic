/**
 * 本地内核的公开入口。宿主插件（index.js）与独立进程（scripts/local-server.mjs）都从这里拿。
 */
export { createServer, startServer, parseMultipart } from './http.js';
export { createStore } from './store.js';
export { createSearcher, probeOllama, composeExtractive } from './search.js';
export { layout, defaultRoot, resolveRoot } from './paths.js';

import { startServer } from './http.js';
import { resolveRoot } from './paths.js';

const DEFAULT_PORTS = [4317, 4318, 4319, 4320, 4321];
const SIGNATURE = /^0\.\d+\.\d+-local$/;

/**
 * 探一个已经在跑的本地内核。
 *
 * 为什么要探：DSH 里插件被重载、或用户同时开了 `npm run local`，都会出现「端口已被自己占着」。
 * 这时再起一个新实例不是修复，而是让两份内核抢同一批文件（写入虽然原子，但缓存会不一致）。
 * 所以先看 4317..4321 上有没有签名一致的实例，有就直接复用。
 */
export async function probeExisting(ports = DEFAULT_PORTS, root = resolveRoot()) {
  for (const port of ports) {
    const baseUrl = `http://127.0.0.1:${port}`;
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 600);
      const res = await fetch(`${baseUrl}/health`, { signal: ctrl.signal });
      clearTimeout(timer);
      if (!res.ok) continue;
      const body = await res.json();
      const data = body?.data || body;
      const version = String(data?.version || '');
      if (SIGNATURE.test(version) && data.runtime === 'plugin' && data.storeRoot === root) {
        return { baseUrl, port, version, root, reused: true };
      }
    } catch (_e) {
      /* 这个端口上没有服务，继续 */
    }
  }
  return null;
}

/**
 * 保证本机有一个可用的内核：能复用就复用，否则起一个。
 * @returns {{baseUrl: string, port: number, reused: boolean, close: () => Promise<void>}}
 */
export async function ensureLocalKernel(options = {}) {
  const root = resolveRoot(options.root);
  const existing = options.reuse === false ? null : await probeExisting(options.ports, root);
  if (existing) return { ...existing, close: async () => {} };
  const started = await startServer({ ...options, root, runtime: 'plugin' });
  return { ...started, reused: false };
}
