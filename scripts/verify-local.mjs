/**
 * 本地内核验收（新架构：插件自带后端，无网关、无外网）。
 *
 *   node scripts/seed-local.mjs                 # 先灌演示语料
 *   node scripts/local-server.mjs               # 起内核 + 预览台（4317）
 *   node scripts/verify-local.mjs http://127.0.0.1:4317/preview/
 *
 * 与 verify-plugins.mjs 的分工：那个验的是「演示数据 + 网关契约」的界面状态机，
 * 这个验的是「真文件、真 BM25、真 SSE、真落盘」—— 只断言可观测结果，
 * 环境缺项（没起内核、没语料）明确标 BLOCKED，不伪造通过。
 */
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';

const previewUrl = process.argv[2];
if (!previewUrl) {
  console.error('用法: node scripts/verify-local.mjs <previewUrl> [chromePath]');
  process.exit(1);
}
const baseUrl = previewUrl.replace(/\/+$/, '') + '/';
const origin = new URL(previewUrl).origin;

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
];
const chromePath = process.argv[3] || CHROME_CANDIDATES.find((c) => c && existsSync(c));
if (!chromePath) {
  console.error('找不到 Chrome 或 Edge，请将 CHROME_PATH 设为浏览器的实际可执行文件路径');
  process.exit(1);
}

/* --------------------------------------------------------- 前置：内核可用 */

let kernel = null;
try {
  const res = await fetch(`${origin}/health`);
  const json = await res.json();
  kernel = json.data || json;
} catch (_e) {
  kernel = null;
}
if (!kernel || !String(kernel.version || '').endsWith('-local')) {
  console.error(`[verify-local] ${origin}/health 没有返回本地内核状态，请检查启动日志中的实际端口`);
  process.exit(1);
}
const storeRoot = kernel.storeRoot || '';

/* -------------------------------------------------------------- 浏览器启动 */

const PORT = 9335;
const profileDir = path.resolve('.tmp-verify-local', `run-${Date.now()}`);
const { spawn } = await import('node:child_process');
const { rm, mkdir } = await import('node:fs/promises');
await rm(profileDir, { recursive: true, force: true });
await mkdir(profileDir, { recursive: true });

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

async function findTarget() {
  for (let i = 0; i < 40; i += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const list = await res.json();
      const page = list.find((t) => t.type === 'page');
      if (page) return page;
    } catch (_e) {
      /* 等端口 */
    }
    await sleep(250);
  }
  throw new Error('Chrome 调试端口未就绪');
}

const target = await findTarget();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  ws.addEventListener('open', resolve, { once: true });
  ws.addEventListener('error', reject, { once: true });
});

let seq = 0;
const pending = new Map();
const pageErrors = [];
ws.addEventListener('message', (event) => {
  const msg = JSON.parse(event.data);
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
    return;
  }
  if (msg.method === 'Runtime.exceptionThrown') {
    const d = msg.params.exceptionDetails;
    pageErrors.push((d.exception && d.exception.description) || d.text);
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
async function ev(expression) {
  const res = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (res.exceptionDetails) throw new Error(res.exceptionDetails.exception?.description || res.exceptionDetails.text);
  return res.result?.value;
}

await send('Page.enable');
await send('Runtime.enable');

const results = [];
function record(id, name, state, detail) {
  results.push({ id, name, state, detail });
  const mark = state === 'pass' ? '✓' : state === 'blocked' ? '⊘' : '✗';
  console.log(`  ${mark} ${id} ${name}${detail ? ` — ${detail}` : ''}`);
}

async function goto(query = '') {
  const target = new URL(query || '', baseUrl);
  target.searchParams.set('installed', '1');
  await send('Page.navigate', { url: target.href });
  await sleep(1900);
}

async function clickText(selector, text) {
  for (let i = 0; i < 20; i += 1) {
    const ok = await ev(`(() => {
      const el = [...document.querySelectorAll(${JSON.stringify(selector)})].find((n) => (n.textContent || '').trim() === ${JSON.stringify(text)});
      if (!el) return false;
      el.click();
      return true;
    })()`);
    if (ok) {
      await sleep(380);
      return true;
    }
    await sleep(200);
  }
  return false;
}

async function clickContains(selector, text) {
  for (let i = 0; i < 20; i += 1) {
    const ok = await ev(`(() => {
      const el = [...document.querySelectorAll(${JSON.stringify(selector)})].find((n) => (n.textContent || '').includes(${JSON.stringify(text)}));
      if (!el) return false;
      el.click();
      return true;
    })()`);
    if (ok) {
      await sleep(380);
      return true;
    }
    await sleep(200);
  }
  return false;
}

const setInput = (selector, index, value, tag) => ev(`(() => {
  const list = [...document.querySelectorAll(${JSON.stringify(selector)})];
  const el = list[${index}];
  if (!el) return false;
  const proto = (${JSON.stringify(tag || 'input')} === 'textarea' ? window.HTMLTextAreaElement : window.HTMLInputElement).prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
  setter.call(el, ${JSON.stringify(value)});
  el.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
})()`);

async function tab(name) {
  for (let i = 0; i < 24; i += 1) {
    const ok = await ev(`(() => {
      const el = [...document.querySelectorAll('.sch-tab')].find((b) => (b.textContent || '').trim() === ${JSON.stringify(name)});
      if (!el) return false;
      el.click();
      return true;
    })()`);
    if (ok) {
      await sleep(700);
      return true;
    }
    await sleep(250);
  }
  return false;
}

async function ensureScope(name) {
  const on = await ev(`(() => {
    const el = [...document.querySelectorAll('.sch-scoperow .sch-scopechip')].find((n) => (n.textContent || '').trim() === ${JSON.stringify(name)});
    return Boolean(el && el.classList.contains('on'));
  })()`);
  if (!on) await clickContains('.sch-scoperow .sch-scopechip', name);
  await sleep(300);
}

/** 在采集卡的目标知识库下拉里选中某个库。 */
async function pickKb(name, scope = '.sch-clip-card select') {
  return ev(`(() => {
    const sel = [...document.querySelectorAll(${JSON.stringify(scope)})].find((s) => [...s.options].some((o) => (o.text || '').trim() === ${JSON.stringify(name)}));
    if (!sel) return false;
    const opt = [...sel.options].find((o) => (o.text || '').trim() === ${JSON.stringify(name)});
    const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
    setter.call(sel, opt.value);
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
}

/* ------------------------------------------------------------------ 用例 */

console.log('[verify-local] 打开预览（本地内核模式）');
await goto('?v=local-1');

// 核对界面连接的实例，再允许后续验收写库。
const settingsOpened = await ev(`(() => {
  const button = [...document.querySelectorAll('button')]
    .find((b) => b.getAttribute('aria-label') === '设置' || b.textContent.trim() === '设置');
  if (!button) return false;
  button.click();
  return true;
})()`);
let connectedRoot = '';
for (let i = 0; settingsOpened && !connectedRoot && i < 25; i += 1) {
  await sleep(200);
  connectedRoot = await ev(`document.querySelector('#sch-root')?.value || ''`);
}
if (!storeRoot || connectedRoot !== storeRoot) {
  console.error('[verify-local] 预览连接的内核与验收目标不一致，停止写入。', { settingsOpened, connectedRoot, storeRoot });
  ws.close();
  chrome.kill();
  process.exit(1);
}
await goto('?v=local-verified');


// L1：面板起来了，且明确自称「本地内核」，不是「网关」
const l1 = await ev(`(() => {
  const body = document.body.textContent || '';
  const panel = Boolean(document.querySelector('.sch-root'));
  const dot = (document.querySelector('.sch-status') || {}).textContent || '';
  return { panel, dot, local: body.includes('本地内核'), gatewayDown: body.includes('本地内核没有响应') };
})()`);
if (!l1.panel) record('L1', '插件面板挂载', 'fail', '找不到 .sch-root');
else if (l1.gatewayDown) record('L1', '面板连上本地内核', 'fail', l1.dot || '显示「本地内核没有响应」');
else record('L1', '面板连上本地内核', l1.local ? 'pass' : 'fail', `状态=${(l1.dot || '').trim()} 自称本地=${l1.local}`);

// L2：知识库来自磁盘（seed 的「工程标准库」）
const l2 = await ev(`(() => {
  const cards = [...document.querySelectorAll('.sch-kbcard')].map((n) => (n.textContent || '').trim());
  return { count: cards.length, hasStd: cards.some((c) => c.includes('工程标准库')), first: cards[0] || '' };
})()`);
record('L2', '知识库列表读自磁盘', l2.hasStd ? 'pass' : l2.count > 0 ? 'fail' : 'blocked',
  l2.hasStd ? `共 ${l2.count} 个库` : `未找到演示库（请用 --demo 启动浏览器版）· 现有 ${l2.count} 个`);

// L3：范围必选 —— 未选库不发请求
await tab('检索');
const l3a = await ev(`Boolean(document.querySelector('.sch-search-input'))`);
if (!l3a) record('L3', '未选库检索被拒绝', 'blocked', '找不到检索输入框');
else {
  await setInput('.sch-search-input', 0, '螺栓拧紧力矩 M10');
  await clickText('.sch-searchbox .sch-btn.primary', '检索');
  await sleep(600);
  const l3 = await ev(`(() => ({
    alert: [...document.querySelectorAll('.sch-alert')].map((n) => n.textContent).join(' '),
    hits: document.querySelectorAll('.sch-hit').length,
  }))()`);
  record('L3', '未选库检索被拒绝', l3.alert.includes('先选知识库') && l3.hits === 0 ? 'pass' : 'fail',
    `alert=${(l3.alert || '').slice(0, 20)} hits=${l3.hits}`);

  // L4：选库后真检索（BM25 命中来自本地文件）
  await ensureScope('工程标准库');
  await clickText('.sch-searchbox .sch-btn.primary', '检索');
  await sleep(1200);
  const l4 = await ev(`(() => {
    const hits = [...document.querySelectorAll('.sch-hit')].map((n) => (n.textContent || '').trim());
    return { count: hits.length, sample: (hits[0] || '').slice(0, 40) };
  })()`);
  record('L4', '选库后 BM25 命中本地文件', l4.count > 0 ? 'pass' : 'fail', `hits=${l4.count} · ${l4.sample}`);
}

// L5：文档详情的分块分页（长文档 11 块，一页 10 块）
await tab('知识库');
await sleep(700);
const opened = await clickContains('.sch-kbcard', '工程标准库');
await sleep(1200);
const rowOk = await clickContains('.sch-dtr.body', '密封件选用指南');
await sleep(1100);
if (!opened || !rowOk) record('L5', '长文档分块翻页', 'blocked', '未能打开文档详情');
else {
  await clickText('.sch-tabbtn', '分块');
  await sleep(1000);
  const p1 = await ev(`(() => {
    const rows = [...document.querySelectorAll('.sch-chunk-text')].map((n) => (n.textContent || '').trim().slice(0, 24));
    return { first: rows[0] || '', count: rows.length, pager: (document.querySelector('.sch-pager') || {}).textContent || '' };
  })()`);
  const nextOk = await ev(`(() => {
    const b = [...document.querySelectorAll('.sch-pager .sch-btn')].find((x) => (x.textContent || '').trim() === '下一页');
    if (!b || b.disabled) return false;
    b.click();
    return true;
  })()`);
  await sleep(900);
  const p2 = await ev(`(() => {
    const rows = [...document.querySelectorAll('.sch-chunk-text')].map((n) => (n.textContent || '').trim().slice(0, 24));
    return { first: rows[0] || '', pager: (document.querySelector('.sch-pager') || {}).textContent || '' };
  })()`);
  record('L5', '长文档分块翻页', nextOk && p1.first && p1.first !== p2.first ? 'pass' : 'fail',
    `${p1.count} 行/页 ${p1.pager.replace(/\s+/g, ' ')} → ${p2.pager.replace(/\s+/g, ' ')}`);
  await clickText('[aria-label="关闭"]', '关闭');
  await sleep(400);
}

// L6：采集正文 → 提交入库 → 真落盘（documentId 与磁盘文件双向对上）
await goto('?v=local-2');
await tab('知识库');
await sleep(700);
await clickContains('.sch-kbcard', '工程标准库');
await sleep(1000);
// 上一轮验收留下的同名文档先删掉，保证这一轮是「新建」而不是覆盖
const kbList = await fetch(`${origin}/api/v1/knowledge-bases`).then((r) => r.json());
const seedKb = (kbList.data.items || []).find((k) => k.name === '工程标准库');
if (seedKb) {
  const old = await fetch(`${origin}/api/v1/knowledge-bases/${seedKb.id}/documents`).then((r) => r.json());
  for (const d of old.data.items || []) {
    if (d.title === '本地验收条目') await fetch(`${origin}/api/v1/documents/${d.id}`, { method: 'DELETE' });
  }
}
const before = await fetch(`${origin}/api/v1/knowledge-bases`, {})
  .then((r) => r.json())
  .then(async (j) => {
    const kb = (j.data.items || []).find((k) => k.name === '工程标准库');
    const docs = await fetch(`${origin}/api/v1/knowledge-bases/${kb.id}/documents`).then((r) => r.json());
    return { kbId: kb ? kb.id : '', count: (docs.data.items || []).length };
  });
// 采集入口在「导入资料」菜单里
const openedClip = await ev(`(() => {
  const btn = [...document.querySelectorAll('.sch-kbsub .sch-tabbtn')].find((b) => (b.textContent || '').trim() === '导入资料');
  if (!btn) return false;
  btn.click();
  return true;
})()`);
await sleep(400);
await clickText('.sch-popmenu button', '网页与笔记');
await sleep(900);
// 采集卡默认是「网页 URL」，粘贴正文得先切到 Markdown 笔记
await clickContains('.sch-clip-modes .sch-scopechip', 'Markdown 笔记');
await sleep(400);
const kbPicked = await pickKb('工程标准库');
const taOk = await setInput('.sch-clip-ta', 0, 'SC-1024 数据表：额定压力 25 MPa，工作温度 -20~80 ℃，接口 G1/2。', 'textarea');
if (!openedClip || !taOk) record('L6', '采集正文提交入库（真落盘）', 'blocked', '采集面板未就绪');
else {
  await setInput('.sch-clip-card input.sch-input', 0, '本地验收条目');
  await sleep(300);
  await clickText('.sch-clip-card .sch-btn.primary', '提交入库');
  await sleep(3200);
  const after = await fetch(`${origin}/api/v1/knowledge-bases/${before.kbId}/documents`).then((r) => r.json());
  const docs = after.data.items || [];
  const created = docs.find((d) => d.title === '本地验收条目' || (d.fileName || '').includes('本地验收'));
  const body = await ev(`(() => {
    const dd = [...document.querySelectorAll('.sch-kv dd')].map((n) => n.textContent.trim());
    const alert = [...document.querySelectorAll('.sch-alert')].map((n) => n.textContent.trim()).join(' | ');
    const notice = [...document.querySelectorAll('.sch-notice')].map((n) => n.textContent.trim()).join(' | ');
    const card = ((document.querySelector('.sch-clip-card') || {}).textContent || '').replace(/\\s+/g, ' ').slice(0, 120);
    return { id: dd.find((x) => x.startsWith('doc-')) || '', version: dd.find((x) => /^v\\d+$/.test(x)) || '', alert, notice, card };
  })()`);
  // 磁盘布局：kbs/<kbId>/docs/<标题>-<后缀>.md + .json；同名重提交是覆盖同一篇（版本 +1），不新建文件
  const docsDir = path.join(storeRoot, 'kbs', before.kbId, 'docs');
  const diskFiles = existsSync(docsDir) ? readdirSync(docsDir) : [];
  const diskOk = created ? diskFiles.some((f) => f.startsWith(`${created.title}-`) && f.endsWith('.md')) : false;
  record('L6', '采集正文提交入库（真落盘）',
    created && diskOk && docs.length > before.count ? 'pass' : 'fail',
    `文档 ${created ? created.id : '未出现在列表'}（${created ? created.fileName : ''}） · 磁盘 ${diskOk ? '有' : '无'} · ${before.count}→${docs.length} · 选库=${kbPicked}${body.alert ? ` · 报错=${body.alert.slice(0, 40)}` : ''}${body.notice ? ` · 提示=${body.notice.slice(0, 40)}` : ''} · 卡=${body.card.slice(0, 60)}`);
}

// L7：正式插件的设置只显示本地目录
const openedSet = await ev(`(() => {
  const btn = [...document.querySelectorAll('button')].find((b) => (b.getAttribute('aria-label') || '') === '设置' || (b.textContent || '').trim() === '设置');
  if (!btn) return false;
  btn.click();
  return true;
})()`);
await sleep(700);
if (!openedSet) record('L7', '设置抽屉：本地数据目录', 'blocked', '找不到设置入口');
else {
  const l7 = await ev(`(() => {
    const segs = [...document.querySelectorAll('.sch-drawer-set .sch-seg')].map((s) => [...s.querySelectorAll('button')].map((b) => (b.textContent || '').trim()).join('/'));
    const modeSeg = segs.find((s) => s.includes('本地内核')) || '';
    const root = (document.querySelector('#sch-root') || {}).value || '';
    const reveal = [...document.querySelectorAll('.sch-drawer-set button')].some((b) => (b.textContent || '').trim() === '打开文件夹');
    return { modeSeg, root, reveal };
  })()`);
  const localOnly = !l7.modeSeg;
  const rootOk = storeRoot ? l7.root === storeRoot : Boolean(l7.root);
  record('L7', '设置抽屉：本地数据目录',
    localOnly && rootOk && l7.reveal ? 'pass' : 'fail',
    `正式档无模式切换=${localOnly} 目录=${l7.root || '空'} 打开=${l7.reveal}`);
  await ev(`(() => {
    document.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    return true;
  })()`);
  await sleep(400);
}

// L8：问答 SSE 出引用，落库可查（不是内存态）
const QUESTION = 'O 形圈的压缩率一般取多少？';
await goto('?v=local-3');
await tab('问答');
await sleep(600);
const qaOk = await ev(`Boolean(document.querySelector('.sch-ta'))`);
if (!qaOk) record('L8', '问答出引用并落库', 'blocked', '找不到问答输入框');
else {
  const beforeCount = await ev(`document.querySelectorAll('.sch-msg.assistant').length`);
  await ensureScope('工程标准库');
  // 普通提问是「只检索证据」模式；要走内核 SSE（真生成 + 落库）必须开深度研究
  await clickText('.sch-scoperow .sch-scopechip', '深度研究');
  await setInput('.sch-ta', 0, QUESTION, 'textarea');
  await clickText('.sch-composer .sch-btn.primary', '发送');
  await sleep(2600);
  const ask = await ev(`(() => ({
    count: document.querySelectorAll('.sch-msg.assistant').length,
    rich: document.querySelectorAll('.sch-msg.assistant .sch-rich').length,
    last: [...document.querySelectorAll('.sch-msg.assistant .sch-rich')].map((n) => n.textContent).pop() || '',
  }))()`);
  const sess = await fetch(`${origin}/api/v1/sessions`).then((r) => r.json());
  // 会话可能不止一个（历史验收留下的），逐个数，找到含本次提问的那条
  let stored = [];
  for (const s of (sess.data.items || []).slice(0, 6)) {
    const msgs = await fetch(`${origin}/api/v1/sessions/${s.id}/messages?limit=20`).then((r) => r.json());
    const items = (msgs.data.items || []).filter((m) => m.content);
    if (items.some((m) => m.role === 'user' && (m.content || '').includes('压缩率'))) {
      stored = items;
      break;
    }
  }
  const askedStored = stored.some((m) => m.role === 'user' && (m.content || '').includes('压缩率'));
  const answeredStored = stored.some((m) => m.role === 'assistant' && (m.content || '').length > 20);
  record('L8', '问答出引用并落库',
    ask.count > beforeCount && ask.rich > 0 && askedStored && answeredStored ? 'pass' : 'fail',
    `助手 ${beforeCount}→${ask.count} 条 · 引用块 ${ask.rich} · 落库 ${stored.length} 条（问 ${askedStored} 答 ${answeredStored}）· ${ask.last.slice(0, 16)}…`);
}

/* ------------------------------------------------------------------ 收尾 */

const failed = results.filter((r) => r.state === 'fail');
const blocked = results.filter((r) => r.state === 'blocked');
console.log(`\n[verify-local] 通过 ${results.filter((r) => r.state === 'pass').length}/${results.length} · 失败 ${failed.length} · 缺项 ${blocked.length}`);
if (pageErrors.length) console.log(`[verify-local] 页面异常 ${pageErrors.length} 条：${pageErrors[0].slice(0, 120)}`);

ws.close();
chrome.kill();
await sleep(300);
await rm(profileDir, { recursive: true, force: true }).catch(() => {});

process.exit(failed.length || blocked.length ? 1 : 0);
