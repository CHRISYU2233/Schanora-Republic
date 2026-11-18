/**
 * Host 半侧：插件加载时把本地内核拉起来，卸载时关掉。
 *
 * 这一层是「不用网关」的关键 —— 它跑在 DSH 的 Node 进程里，所以能读磁盘、能起 HTTP、
 * 能调本机模型；浏览器里的 client.js 只有渲染能力，本身碰不到文件系统。
 *
 * 三条纪律：
 *   1. **不阻塞插件加载**：起服务是异步的，失败也不能让插件挂掉（界面会显示「本地内核未启动」
 *      并给出启动命令，而不是白屏）；
 *   2. **不抢端口**：已经有一个签名一致的内核在跑就复用（插件重载、用户手动开 dev 服务都会遇到）；
 *   3. **不动别人的数据**：根目录只由 SCHANORA_ROOT / OneDrive / 家目录决定，不写仓库目录。
 */
import { ensureLocalKernel } from './src/server/index.js';

export const name = '@schanora/client';

/** 最近一次启动结果，供诊断读取（不参与渲染，只做事实记录）。 */
const state = { phase: 'idle', baseUrl: '', root: '', error: '', note: '' };

export function getKernelState() {
  return { ...state };
}

export function apply(ctx, config = {}) {
  let handle = null;
  let disposed = false;

  state.phase = 'starting';
  ensureLocalKernel({
    root: config.root || process.env.SCHANORA_ROOT || undefined,
    port: Number(config.port) || Number(process.env.SCHANORA_PORT) || 4317,
  })
    .then((kernel) => {
      handle = kernel;
      state.phase = 'ready';
      state.baseUrl = kernel.baseUrl;
      state.root = kernel.root || '';
      state.error = '';
      state.note = kernel.reused ? 'reused' : 'started';
      if (disposed) kernel.close();
    })
    .catch((error) => {
      state.phase = 'failed';
      state.error = error && error.message ? error.message : String(error);
    });

  // Cordis 的 effect：dispose 时执行返回的函数；没有 ctx.effect 就靠进程退出回收
  if (typeof ctx?.effect === 'function') {
    ctx.effect(() => () => {
      disposed = true;
      if (handle) handle.close();
    });
  }

  return () => {
    disposed = true;
    if (handle) handle.close();
  };
}
