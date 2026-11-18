/**
 * 用 Chrome DevTools Protocol 驱动无头浏览器，把插件的各个交互态截图下来。
 *
 * 为什么需要它：这个界面有 7 个必须验证的状态（浅/深、诊断抽屉、范围弹层、
 * 上游降级、连接失败、英文、窄窗）。光看一张首屏截图证明不了它们没坏。
 *
 * 用法：
 *   node scripts/shoot.mjs [chromePath] <baseUrl> <outDir>
 * chromePath 可省略（自动探测，或读 CHROME_PATH）。
 * 依赖：Node 22 内置的全局 WebSocket，无需安装任何包。
 */
import { writeFile, mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const argv = process.argv.slice(2);
const isUrl = (v) => typeof v === 'string' && /^https?:\/\//i.test(v);
// 允许省略 Chrome 路径（macOS / Linux / 非默认安装）：第一个参数是 URL 时自动探测浏览器
const chromeArg = isUrl(argv[0]) ? '' : argv[0];
const rawBaseUrl = isUrl(argv[0]) ? argv[0] : argv[1];
const rawOutDir = isUrl(argv[0]) ? argv[1] : argv[2];

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
];
const chromePath = chromeArg || CHROME_CANDIDATES.find((candidate) => candidate && existsSync(candidate));
if (!chromePath || !rawBaseUrl || !rawOutDir) {
  console.error('用法: node scripts/shoot.mjs [chromePath] <baseUrl> <outDir>');
  console.error('  chromePath 可省略，或用环境变量 CHROME_PATH 指定');
  process.exit(1);
}

// Chrome 的 --user-data-dir 必须是绝对路径，否则会被当成默认目录、调试端口直接不开
const baseUrl = rawBaseUrl;
const outDir = path.resolve(rawOutDir);

await mkdir(outDir, { recursive: true });

const PORT = 9333;
const { spawn } = await import('node:child_process');
const profileDir = path.join(outDir, '.chrome-profile');
// 每次跑都用干净的 localStorage，否则上一轮留下的「连接失败」场景会污染下一轮
await rm(profileDir, { recursive: true, force: true });

const chrome = spawn(
  chromePath,
  [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--hide-scrollbars',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profileDir.replace(/\\/g, '/')}`,
    '--window-size=1280,900',
    'about:blank',
  ],
  { stdio: 'ignore' },
);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function pageTarget() {
  for (let i = 0; i < 40; i += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const list = await res.json();
      const page = list.find((t) => t.type === 'page');
      if (page) return page;
    } catch (_e) {
      /* 还没起来 */
    }
    await sleep(250);
  }
  throw new Error('Chrome 调试端口未就绪');
}

const target = await pageTarget();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  ws.addEventListener('open', resolve, { once: true });
  ws.addEventListener('error', reject, { once: true });
});

let seq = 0;
const pending = new Map();
const consoleErrors = [];

ws.addEventListener('message', (event) => {
  const msg = JSON.parse(event.data);
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
    return;
  }
  if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
    consoleErrors.push(msg.params.args.map((a) => a.value ?? a.description ?? '').join(' '));
  }
  if (msg.method === 'Runtime.exceptionThrown') {
    consoleErrors.push(msg.params.exceptionDetails.text + ' ' + (msg.params.exceptionDetails.exception?.description || ''));
  }
});

function send(method, params) {
  seq += 1;
  const id = seq;
  return new Promise((resolve, reject) => {
    pending.set(id, (msg) => (msg.error ? reject(new Error(`${method}: ${msg.error.message}`)) : resolve(msg.result)));
    ws.send(JSON.stringify({ id, method, params: params || {} }));
  });
}

async function evaluate(expression) {
  const res = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (res.exceptionDetails) {
    throw new Error(res.exceptionDetails.exception?.description || res.exceptionDetails.text);
  }
  return res.result?.value;
}

async function shot(name) {
  const { data } = await send('Page.captureScreenshot', { format: 'png' });
  const file = path.join(outDir, `${name}.png`);
  await writeFile(file, Buffer.from(data, 'base64'));
  console.log(`  ✓ ${name}.png`);
}

async function clickByText(selector, text) {
  let ok = false;
  for (let i = 0; i < 20 && !ok; i += 1) {
    ok = await evaluate(`(() => {
      const el = [...document.querySelectorAll(${JSON.stringify(selector)})].find((n) => (n.textContent || '').trim() === ${JSON.stringify(text)});
      if (!el) return false;
      el.click();
      return true;
    })()`);
    if (!ok) await sleep(250);
  }
  if (!ok) throw new Error(`找不到按钮：「${text}」(${selector})`);
  await sleep(450);
}

/** 低频模块（Wiki / 插件中心）收在 ⋯ 菜单里：先开菜单再点项。 */
async function openMoreItem(text) {
  await evaluate(`(() => {
    const btns = [...document.querySelectorAll('.sch-main-actions .sch-btn.icon')];
    const b = btns[btns.length - 1];
    if (b) b.click();
    return Boolean(b);
  })()`);
  await sleep(300);
  await clickByText('.sch-popmenu button', text);
}

/** 确保范围 chip 处于选中态（已选中就不再点，否则会点成取消）。 */
async function ensureScope(name) {
  const on = await evaluate(`(() => {
    const el = [...document.querySelectorAll('.sch-scoperow .sch-scopechip')].find((n) => (n.textContent || '').trim() === ${JSON.stringify(name)});
    return Boolean(el && el.classList.contains('on'));
  })()`);
  if (!on) await clickContains('.sch-scoperow .sch-scopechip', name);
  await sleep(250);
}

/** 行/卡片里既有标题也有说明，按包含匹配更稳。 */
async function clickContains(selector, text) {
  let ok = false;
  for (let i = 0; i < 20 && !ok; i += 1) {
    ok = await evaluate(`(() => {
      const el = [...document.querySelectorAll(${JSON.stringify(selector)})].find((n) => (n.textContent || '').includes(${JSON.stringify(text)}));
      if (!el) return false;
      el.click();
      return true;
    })()`);
    if (!ok) await sleep(250);
  }
  if (!ok) throw new Error(`找不到包含「${text}」的元素 (${selector})`);
  await sleep(500);
}

await send('Page.enable');
await send('Runtime.enable');

async function load(query) {
  await send('Page.navigate', { url: `${baseUrl}${query}` });
  await sleep(1600);
}

console.log(`[shoot] 打开 ${baseUrl}`);
await load('?v=m24-1');
await shot('01-home-light');

// 顶栏方案没有折叠态；这里直接进模块抽屉，验证注册表
// 模块抽屉：注册表里到底有几个模块
await evaluate(`document.querySelectorAll('.sch-main-actions .sch-btn.icon')[1].click()`);
await sleep(300);
await clickByText('.sch-popmenu button', '模块');
await shot('01d-modules-drawer');
await evaluate(`document.querySelector('.sch-drawer .sch-btn.icon').click()`);
await sleep(350);

// 未接入模块：只列所需接口（M6 Wiki 仍是 planned，收在 ⋯ 菜单）
await openMoreItem('Wiki');
await sleep(600);
await shot('01e-planned-module');
await clickByText('.sch-tab', '知识库');
await sleep(500);

// 模块 1：建库表单（模型目录动态拉取）
await clickByText('.sch-kbhead .sch-btn.primary', '新建知识库');
await sleep(700);
await shot('01b-kb-create');
await evaluate(`(() => {
  const input = document.querySelector('.sch-pop .sch-input');
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(input, '密封件标准库');
  input.dispatchEvent(new Event('input', { bubbles: true }));
})()`);
await clickByText('.sch-pop .sch-btn.primary', '创建');
await sleep(1600);
await shot('01c-kb-created');

// 模块 2：进入知识库 → 文档列表（列表刷新时节点会重建，点空了就再点一次）
for (let i = 0; i < 12; i += 1) {
  const ready = await evaluate(`document.querySelectorAll('.sch-dtr.body').length > 0`);
  if (ready) break;
  await evaluate(`(() => {
    const el = [...document.querySelectorAll('.sch-kbcard')].find((n) => n.textContent.includes('工程标准库'));
    if (el) el.click();
  })()`);
  await sleep(400);
}
await sleep(700);
await shot('02-docs-list');

// 模块 3：失败文档的详情 / 轨迹 / 分块
await clickContains('.sch-dtr.body', '供应商试验报告');
await sleep(700);
await shot('03-doc-props');
await clickByText('.sch-tabbtn', '处理轨迹');
await sleep(700);
await shot('04-doc-trace');
await clickByText('.sch-tabbtn', '分块');
await sleep(700);
await shot('05-doc-chunks');
await evaluate(`(() => { const b=[...document.querySelectorAll('.sch-drawer-head .sch-btn.icon.sm')]; b[b.length-1].click(); })()`);
await sleep(400);

// 深色 / 英文 / 窄窗
await evaluate("window.__HARNESS_UI__.set({ dark: true })");
await shot('06-docs-dark');
await evaluate("window.__HARNESS_UI__.set({ dark: false })");
await evaluate("window.__HARNESS_UI__.set({ lang: 'en' })");
await shot('07-docs-en');
await evaluate("window.__HARNESS_UI__.set({ lang: 'zh' })");
await send('Emulation.setDeviceMetricsOverride', { width: 860, height: 820, deviceScaleFactor: 1, mobile: false });
await sleep(700);
await shot('08-docs-narrow');
await send('Emulation.clearDeviceMetricsOverride');
await sleep(400);

// 模块 2：拖放同名同大小文件 → 重复提示 → 仍然上传 → 队列
await evaluate(`(() => {
  const bytes = new Uint8Array(2 * 1024 * 1024 + 460 * 1024);
  const file = new File([bytes], 'GBT_3452.1-2005.pdf', { type: 'application/pdf' });
  const dt = new DataTransfer();
  dt.items.add(file);
  const zone = document.querySelector('.sch-drop');
  zone.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
  return file.size;
})()`);
await sleep(500);
await shot('09-upload-duplicate');
await clickByText('.sch-dup .sch-btn.primary', '仍然上传');
await sleep(1100);
await shot('10-upload-queue');
await sleep(4200);
await shot('11-after-upload');

// 模块 4：检索（未选库被拒 → 选库 → 结果 → 展开原文）
await clickByText('.sch-tab', '检索');
await sleep(700);
await shot('16-search-idle');
await evaluate(`(() => {
  const input = document.querySelector('.sch-search-input');
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(input, '螺栓拧紧力矩 M10');
  input.dispatchEvent(new Event('input', { bubbles: true }));
})()`);
await sleep(250);
// P3（T01）：未选知识库 → 拒绝查询并提示，不查全库
await clickByText('.sch-searchbox .sch-btn.primary', '检索');
await sleep(600);
await shot('16b-search-needscope');
await ensureScope('工程标准库');
await clickByText('.sch-searchbox .sch-btn.primary', '检索');
await sleep(1100);
await shot('17-search-results');
await evaluate(`(() => {
  const btn = [...document.querySelectorAll('.sch-hit .sch-linkbtn')][0];
  if (btn) btn.click();
})()`);
await sleep(500);
await shot('18-search-expanded');

// 模块 5：问答（历史 → 选范围 → 证据模式 → 深度研究流式 → 引用 → 停止）
await clickByText('.sch-tab', '工程问答');
await sleep(900);
await shot('19-chat-history');
// P3：先选知识库（未选库发送会被拒绝并提示）
await ensureScope('工程标准库');
// 默认证据检索模式：不生成答案，列证据交给 DSH 主对话
await evaluate(`(() => {
  const ta = document.querySelector('.sch-ta');
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
  setter.call(ta, 'O 形圈安装有什么要求？');
  ta.dispatchEvent(new Event('input', { bubbles: true }));
})()`);
await sleep(200);
await clickByText('.sch-composer .sch-btn.primary', '发送');
await sleep(1400);
// 滚到本轮提问处：范围锁定行与证据开头同框
await evaluate(`(() => {
  const el = document.querySelector('.sch-thread');
  const last = [...document.querySelectorAll('.sch-msg.user')].pop();
  if (!el || !last) return;
  el.scrollTop = Math.max(0, last.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop - 6);
})()`);
await sleep(300);
await shot('20b-chat-evidence');
// 开启深度研究：WeKnora 合成问答（SSE 流式）
await clickByText('.sch-scoperow .sch-scopechip', '深度研究');
await sleep(250);
await evaluate(`(() => {
  const ta = document.querySelector('.sch-ta');
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
  setter.call(ta, 'O 形圈安装有什么要求？');
  ta.dispatchEvent(new Event('input', { bubbles: true }));
})()`);
await sleep(200);
await clickByText('.sch-composer .sch-btn.primary', '发送');
await sleep(700);
await shot('20-chat-streaming');
await sleep(5200);
// 滚到这一轮的起点，让「提问 + 回答开头」同框（默认贴底只看得见结尾）
await evaluate(`(() => {
  const el = document.querySelector('.sch-thread');
  const last = [...document.querySelectorAll('.sch-msg.user')].pop();
  if (!el || !last) return;
  el.scrollTop = last.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop - 6;
})()`);
await sleep(300);
await shot('21-chat-answer');
await evaluate(`(() => { const el = document.querySelector('.sch-thread'); if (el) el.scrollTop = el.scrollHeight; })()`);
await sleep(300);
await evaluate(`(() => {
  const btn = document.querySelector('.sch-ref .sch-ref-btn');
  if (btn) btn.click();
})()`);
await sleep(500);
await shot('22-chat-reference');

// 停止：再问一次，半途按停止
await evaluate(`(() => {
  const ta = document.querySelector('.sch-ta');
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
  setter.call(ta, '试验条件是什么？');
  ta.dispatchEvent(new Event('input', { bubbles: true }));
})()`);
await sleep(200);
await clickByText('.sch-composer .sch-btn.primary', '发送');
// 先让它吐一会儿再停，否则截到的是「一个字都没出」的空态
await sleep(1400);
// 停止按钮出现的时机取决于流多长，这里轮询而不是死等
let stopClicked = false;
for (let i = 0; i < 20; i += 1) {
  const hit = await evaluate(`(() => {
    const b = [...document.querySelectorAll('.sch-composer button')].find((x) => x.textContent.trim() === '停止');
    if (!b) return false;
    b.click();
    return true;
  })()`);
  if (hit) { stopClicked = true; break; }
  await sleep(150);
}
if (!stopClicked) console.log('[shoot] 注意：没等到「停止」按钮（流可能已经结束）');
await sleep(500);
await shot('23-chat-stopped');
await evaluate("window.__HARNESS_UI__.set({ dark: true })");
await sleep(500);
await shot('24-chat-dark');
await evaluate("window.__HARNESS_UI__.set({ dark: false })");
await sleep(300);

// 连接失败（演示场景）
await clickByText('.sch-tab', '知识库');
await sleep(500);
await evaluate("(()=>{const b=[...document.querySelectorAll('.sch-main-actions .sch-btn')].find(n=>n.textContent.includes('设置')); b&&b.click(); return !!b})()");
await sleep(350);
await clickByText('.sch-seg button', '连接失败');
await clickByText('.sch-pop-actions button', '保存');
await sleep(900);
await shot('12-error');

// 真 HTTP 通路（可选）：接 scripts/fake-gateway.mjs 或真网关
if (process.env.SHOOT_HTTP === '1') {
  const base = process.env.SHOOT_BASE || 'http://127.0.0.1:8000';
  await evaluate("(()=>{const b=[...document.querySelectorAll('.sch-main-actions .sch-btn')].find(n=>n.textContent.includes('设置')); b&&b.click(); return !!b})()");
  await sleep(350);
  await clickByText('.sch-seg button', '正常');
  await clickByText('.sch-seg button', '网关实时');
  await sleep(200);
  await evaluate(`(() => {
    const input = document.querySelector('#sch-base');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(input, ${JSON.stringify(base)});
    input.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await clickByText('.sch-pop-actions button', '保存');
  await sleep(1600);
  await shot('13-http-home');

  await clickContains('.sch-kbcard', '工程标准库');
  await sleep(1200);
  await shot('14-http-docs');

  await clickContains('.sch-dtr.body', '供应商试验报告');
  await sleep(900);
  await clickByText('.sch-tabbtn', '处理轨迹');
  await sleep(900);
  await shot('15-http-trace');
  await evaluate(`(() => { const b=[...document.querySelectorAll('.sch-drawer-head .sch-btn.icon.sm')]; b[b.length-1].click(); })()`);
  await sleep(400);

  // 模块 4 / 5 走真 HTTP（真 fetch + 真 SSE 解析，不是 Mock 分支）
  await clickByText('.sch-tab', '检索');
  await sleep(500);
  await evaluate(`(() => {
    const input = document.querySelector('.sch-search-input');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(input, 'O 形圈安装');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await sleep(200);
  await clickByText('.sch-searchbox .sch-btn.primary', '检索');
  await sleep(1500);
  await shot('25-http-search');

  await clickByText('.sch-tab', '工程问答');
  await sleep(1200);
  await evaluate(`(() => {
    const ta = document.querySelector('.sch-ta');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
    setter.call(ta, 'O 形圈安装有什么要求？');
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await sleep(200);
  await clickByText('.sch-composer .sch-btn.primary', '发送');
  await sleep(600);
  await shot('26-http-chat-stream');
  await sleep(3200);
  await shot('27-http-chat-answer');

  console.log(`[shoot] HTTP 通路已截图，网关：${base}`);
}

// 设置抽屉与插件中心（v7 新增的两个界面）——先把演示场景调回「正常」，别让错误条抢镜
await evaluate("(()=>{const b=[...document.querySelectorAll('.sch-main-actions .sch-btn')].find(n=>n.textContent.includes('设置')); b&&b.click(); return !!b})()");
await sleep(500);
await clickByText('.sch-seg button', '正常');
await clickByText('.sch-pop-actions button', '保存');
await sleep(900);
await clickByText('.sch-tab', '工程问答');
await sleep(600);
await shot('28-chat-composer');
await evaluate("(()=>{const b=[...document.querySelectorAll('.sch-main-actions .sch-btn')].find(n=>n.textContent.includes('设置')); b&&b.click(); return !!b})()");
await sleep(600);
await shot('29-settings');
await evaluate(`(()=>{const b=document.querySelector('.sch-drawer .sch-drawer-head .sch-btn.icon'); b&&b.click(); return !!b})()`);
await sleep(400);
await openMoreItem('插件');
await sleep(700);
await shot('30-plugins');
await evaluate("window.__HARNESS_UI__.set({ dark: true })");
await sleep(600);
await shot('31-plugins-dark');
await evaluate("window.__HARNESS_UI__.set({ dark: false })");
await sleep(300);

// ---- P1 采集：表单 → 入库就绪 → 重复提交复用 → 内容变化新版本 ----
await clickByText('.sch-tab', '采集');
await sleep(700);
await shot('32-clip-form');
await evaluate(`(() => {
  const sel = [...document.querySelectorAll('.sch-clip-card select')].find((s) => [...s.options].some((o) => (o.text || '').trim() === '工程标准库'));
  const setSel = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
  setSel.call(sel, 'kb-std-001');
  sel.dispatchEvent(new Event('change', { bubbles: true }));
})()`);
await sleep(250);
const fillClip = async (url, title) => {
  await evaluate(`(() => {
    const setIn = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    const inputs = [...document.querySelectorAll('.sch-clip-card input.sch-input')];
    setIn.call(inputs[0], ${JSON.stringify(url)});
    inputs[0].dispatchEvent(new Event('input', { bubbles: true }));
    setIn.call(inputs[1], ${JSON.stringify(title)});
    inputs[1].dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await sleep(350);
};
await fillClip('https://supplier.example.com/datasheet?part=SC-1024&utm_source=mail', 'SC-1024 连接器数据表');
await shot('33-clip-prefilled');
await clickByText('.sch-clip-card .sch-btn.primary', '提交入库');
await sleep(3200);
await shot('34-clip-done');
await clickByText('.sch-clip-card .sch-btn', '再采一条');
await sleep(450);
await fillClip('https://supplier.example.com/datasheet?part=SC-1024&utm_source=mail', 'SC-1024 连接器数据表');
await clickByText('.sch-clip-card .sch-btn.primary', '提交入库');
await sleep(1400);
await shot('35-clip-reuse');
await clickByText('.sch-clip-card .sch-btn', '再采一条');
await sleep(450);
await fillClip('https://supplier.example.com/datasheet?part=SC-1024&utm_source=mail', 'SC-1024 连接器数据表（Rev.C 更新）');
await clickByText('.sch-clip-card .sch-btn.primary', '提交入库');
await sleep(3200);
await shot('36-clip-newversion');

// ---- P2 浏览器协同：连接 → 表格任务 → 交接采集 → 登录协助 → 取消丢弃 ----
await clickByText('.sch-tab', '浏览器');
await sleep(700);
await shot('37-browser-conn');
const browRun = async (url) => {
  await evaluate(`(() => {
    const setIn = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    const input = document.querySelector('.sch-clip-card input.sch-input');
    setIn.call(input, ${JSON.stringify(url)});
    input.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await sleep(250);
  await evaluate(`([...document.querySelectorAll('.sch-btn.primary')].find((b) => (b.textContent || '').trim() === '开始') || {}).click()`);
  await sleep(400);
};
await browRun('https://sup.example.com/spec-table');
await sleep(2500);
await shot('38-browser-done');
await clickByText('.sch-brow-acts .sch-btn.primary', '送入采集面板');
await sleep(800);
await shot('39-clip-handoff');
await clickByText('.sch-tab', '浏览器');
await sleep(500);
await browRun('https://login.supplier.example.com/portal');
await sleep(1600);
await shot('40-browser-login');
await clickByText('.sch-brow-acts .sch-btn.primary', '已完成登录');
await sleep(2600);
await shot('41-browser-logindone');
await browRun('https://sup.example.com/another-table');
await sleep(300);
await evaluate(`([...document.querySelectorAll('.sch-brow-acts .sch-btn')].find((b) => (b.textContent || '').trim() === '取消') || {}).click()`);
await sleep(1900);
await shot('42-browser-discarded');

// ---- P4 批量导入：演示批次 → 报告（1 失败）→ 重试 → 续跑全跳过 ----
await clickByText('.sch-tab', '批量导入');
await sleep(700);
await shot('43-batch-empty');
await evaluate(`(() => {
  const sel = [...document.querySelectorAll('.sch-clip-card select')].find((s) => [...s.options].some((o) => (o.text || '').trim() === '工程标准库'));
  const setSel = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
  setSel.call(sel, 'kb-std-001');
  sel.dispatchEvent(new Event('change', { bubbles: true }));
})()`);
await sleep(250);
await clickByText('.sch-clip-card .sch-btn', '载入演示批次（3 份，其中 1 份会失败一次）');
await sleep(500);
await shot('44-batch-list');
await clickByText('.sch-clip-card .sch-btn.primary', '开始导入');
await sleep(10000);
// 报告在清单下方：滚到底再截，避免只看到前两项
await evaluate(`(() => { const el = document.querySelector('.sch-content'); if (el) el.scrollTop = el.scrollHeight; })()`);
await sleep(400);
await shot('45-batch-report');
await clickByText('.sch-clip-card .sch-btn', '重试失败项');
await sleep(5000);
await evaluate(`(() => { const el = document.querySelector('.sch-content'); if (el) el.scrollTop = el.scrollHeight; })()`);
await sleep(400);
await shot('46-batch-retry');
// 续跑：同一批次再来一遍，已成功项全部跳过（幂等）
await clickByText('.sch-clip-card .sch-btn', '载入演示批次（3 份，其中 1 份会失败一次）');
await sleep(400);
await clickByText('.sch-clip-card .sch-btn.primary', '开始导入');
await sleep(4000);
await evaluate(`(() => { const el = document.querySelector('.sch-content'); if (el) el.scrollTop = el.scrollHeight; })()`);
await sleep(400);
await shot('47-batch-rerun-skip');

if (consoleErrors.length) {
  console.log('\n[shoot] 控制台错误：');
  for (const line of consoleErrors) console.log('  ! ' + line);
} else {
  console.log('\n[shoot] 控制台无错误');
}

ws.close();
chrome.kill();
process.exit(consoleErrors.length ? 2 : 0);
