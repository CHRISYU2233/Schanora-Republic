/**
 * 验收点自动核对（P1 / P2 / P3 / P4）——用真实浏览器跑界面，断言 DOM 与
 * localStorage 里的实际状态，而不是"看起来对"。
 *
 * 覆盖：T01–T11 中可在本机演示环境验证的部分（T12 需要真实安装/卸载 DSH，
 * 属环境缺项，脚本明确标 BLOCKED，不伪造通过）。
 *
 * 用法：node scripts/verify-plugins.mjs <baseUrl> [chromePath]
 * 依赖：Node 22 内置 WebSocket，无需安装依赖；需要 preview 静态服务在跑。
 */
import { existsSync } from 'node:fs';
import path from 'node:path';

const baseUrl = process.argv[2];
if (!baseUrl) {
  console.error('用法: node scripts/verify-plugins.mjs <baseUrl> [chromePath]');
  process.exit(1);
}

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
];
const chromePath = process.argv[3] || CHROME_CANDIDATES.find((c) => c && existsSync(c));
if (!chromePath) {
  console.error('找不到 Chrome，请设置 CHROME_PATH');
  process.exit(1);
}

const PORT = 9334;
// 每次运行用独立子目录：启动清理只作用于本次路径，不受历史残留影响
const profileDir = path.resolve('.tmp-verify-profile', `run-${Date.now()}`);
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
const errors = [];
ws.addEventListener('message', (event) => {
  const msg = JSON.parse(event.data);
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
    return;
  }
  if (msg.method === 'Runtime.exceptionThrown') {
    errors.push(msg.params.exceptionDetails.text + ' ' + (msg.params.exceptionDetails.exception?.description || ''));
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
function record(id, name, ok, detail, status) {
  const state = status || (ok ? 'pass' : 'fail');
  results.push({ id, name, ok, state, detail });
  const mark = state === 'pass' ? '✓' : state === 'blocked' ? '⊘' : '✗';
  console.log(`  ${mark} ${id} ${name}${detail ? ` — ${detail}` : ''}`);
}

async function goto(query) {
  await send('Page.navigate', { url: `${baseUrl}${query}` });
  await sleep(1700);
}
const MAIN_TABS = { '检索': '检索', '工程问答': '问答', '知识库': '知识库' };
const IMPORT_MENU = { '采集': '网页与笔记', '浏览器': '浏览器采集', '批量导入': '批量导入' };

// 库内工作区就位：顶栏点「知识库」→ 打开工程标准库。已在工作区则跳过。
async function ensureWorkspace() {
  for (let i = 0; i < 20; i += 1) {
    const inWs = await ev(`Boolean(document.querySelector('.sch-kbsub'))`);
    if (inWs) return true;
    await clickText('.sch-tab', '知识库');
    await sleep(400);
    const ok = await clickContains('.sch-kbcard', '工程标准库');
    if (ok) {
      await sleep(900);
      return true;
    }
    await sleep(300);
  }
  return false;
}

async function openImport(name) {
  await ensureWorkspace();
  for (let i = 0; i < 20; i += 1) {
    const ok = await ev(`(() => {
      const btn = [...document.querySelectorAll('.sch-kbsub .sch-tabbtn')].find((b) => (b.textContent || '').trim() === '导入资料');
      if (!btn) return false;
      btn.click();
      return true;
    })()`);
    if (ok) break;
    await sleep(250);
  }
  await sleep(250);
  const label = IMPORT_MENU[name];
  for (let i = 0; i < 20; i += 1) {
    const ok = await clickText('.sch-popmenu button', label);
    if (ok) {
      await sleep(650);
      return true;
    }
    await sleep(250);
  }
  return false;
}

async function tab(text) {
  // 主入口：顶栏三页签；子视图：进工作区 → 导入资料菜单
  const main = MAIN_TABS[text];
  if (main) {
    for (let i = 0; i < 24; i += 1) {
      const ok = await clickText('.sch-tab', main);
      if (ok) {
        await sleep(650);
        return true;
      }
      await sleep(250);
    }
    return false;
  }
  if (IMPORT_MENU[text]) return openImport(text);
  // 与 clickText 同款重试：面板挂载时序不保证 1700ms 内完成
  for (let i = 0; i < 24; i += 1) {
    const ok = await ev(`(() => {
      const el = [...document.querySelectorAll('.sch-tab')].find((b) => (b.textContent || '').trim().includes(${JSON.stringify(text)}));
      if (!el) return false;
      el.click();
      return true;
    })()`);
    if (ok) {
      await sleep(650);
      return true;
    }
    await sleep(250);
  }
  throw new Error(`找不到页签：「${text}」`);
}
async function clickText(selector, text) {
  for (let i = 0; i < 24; i += 1) {
    const ok = await ev(`(() => {
      const el = [...document.querySelectorAll(${JSON.stringify(selector)})].find((n) => (n.textContent || '').trim() === ${JSON.stringify(text)});
      if (!el) return false;
      el.click();
      return true;
    })()`);
    if (ok) {
      await sleep(350);
      return true;
    }
    await sleep(200);
  }
  return false;
}
async function clickContains(selector, text) {
  for (let i = 0; i < 24; i += 1) {
    const ok = await ev(`(() => {
      const el = [...document.querySelectorAll(${JSON.stringify(selector)})].find((n) => (n.textContent || '').includes(${JSON.stringify(text)}));
      if (!el) return false;
      el.click();
      return true;
    })()`);
    if (ok) {
      await sleep(350);
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
  const proto = (${JSON.stringify(tag === 'textarea' ? 'HTMLTextAreaElement' : 'HTMLInputElement')} === 'HTMLTextAreaElement'
    ? window.HTMLTextAreaElement
    : window.HTMLInputElement).prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
  setter.call(el, ${JSON.stringify(value)});
  el.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
})()`);

/** 确保某个范围 chip 处于选中态（已选中就不再点，避免点成取消）。 */
async function ensureScope(name) {
  const on = await ev(`(() => {
    const el = [...document.querySelectorAll('.sch-scoperow .sch-scopechip')].find((n) => (n.textContent || '').trim() === ${JSON.stringify(name)});
    return Boolean(el && el.classList.contains('on'));
  })()`);
  if (!on) await clickContains('.sch-scoperow .sch-scopechip', name);
  await sleep(250);
}

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

console.log('[verify] 打开预览');
await goto('?v=verify-1');
// 这套断言跑的是「演示数据」档（固定夹具 + 本地哈希版本链）；默认档已改成本地内核，
// 这里先把档位钉到 mock，再重载，免得断言打到真文件上。
await ev(`window.localStorage.setItem('schanora.settings.v1', JSON.stringify({ ...(JSON.parse(window.localStorage.getItem('schanora.settings.v1') || '{}')), mode: 'mock', scenario: 'ok' }))`);
await goto('?v=verify-2');

/* ---------------------------------------------------------------- T01 范围必选 */
await tab('检索');
await setInput('.sch-search-input', 0, '螺栓拧紧力矩 M10');
await clickText('.sch-searchbox .sch-btn.primary', '检索');
await sleep(500);
const t01 = await ev(`(() => {
  const alert = [...document.querySelectorAll('.sch-alert')].map((n) => n.textContent).join(' ');
  const hits = document.querySelectorAll('.sch-hit').length;
  return { alert, hits };
})()`);
record('T01', '未选库检索被拒绝，不返回全库结果', t01.alert.includes('先选知识库') && t01.hits === 0,
  `alert=${t01.alert.slice(0, 24)}… hits=${t01.hits}`);
await clickContains('.sch-scoperow .sch-scopechip', '工程标准库');
await sleep(250);
await clickText('.sch-searchbox .sch-btn.primary', '检索');
await sleep(1000);
const t01b = await ev(`document.querySelectorAll('.sch-hit').length`);
record('T01b', '选库后正常检索出命中', t01b > 0, `hits=${t01b}`);

/* ------------------------------------------------- T02 范围快照 + 会话隔离 */
await tab('工程问答');
await ensureScope('工程标准库');
await setInput('.sch-ta', 0, 'O 形圈安装要求', 'textarea');
await clickText('.sch-composer .sch-btn.primary', '发送');
await sleep(1400);
const t02 = await ev(`(() => {
  const notes = [...document.querySelectorAll('.sch-msg.assistant .sch-msg-note')].map((n) => n.textContent);
  const locked = notes.find((x) => x.includes('检索范围')) || '';
  return { locked, evidence: document.querySelectorAll('.sch-msg.assistant .sch-rich').length };
})()`);
record('T02', '答案回显发送时锁定的范围', t02.locked.includes('工程标准库'), t02.locked.slice(0, 40));
// 切换会话 B：范围与任务都不串
await ev(`window.__HARNESS_UI__.set({ session: 'B' })`);
await sleep(900);
const t02b = await ev(`(() => ({
  scopeOn: [...document.querySelectorAll('.sch-scopechip.on')].map((n) => n.textContent.trim()),
  scopeNote: (document.querySelector('.sch-scoperow .sch-note') || {}).textContent || '',
}))()`);
record('T02b', '切到会话 B：范围为空（不继承会话 A 的选库）', t02b.scopeOn.length === 0, JSON.stringify(t02b.scopeOn));
await ev(`window.__HARNESS_UI__.set({ session: 'A' })`);
await sleep(700);

/* ------------------------------------------------------------ T03 分块分页 */
await tab('知识库');
await sleep(600);
await clickContains('.sch-kbcard', '工程标准库');
await sleep(1200);
const rowOk = await clickContains('.sch-dtr.body', '3452');
await sleep(1000);
if (!rowOk) record('T03a', '分块翻页：下一页内容与第一页不同且页码前进', false, '未能打开文档详情');
else {
await clickText('.sch-tabbtn', '分块');
await sleep(900);
const t03p1 = await ev(`(() => {
  const rows = [...document.querySelectorAll('.sch-chunk-text')].map((n) => (n.textContent || '').trim().slice(0, 24));
  const pager = (document.querySelector('.sch-pager') || {}).textContent || '';
  return { first: rows[0] || '', pager };
})()`);
const nextOk = await ev(`(() => {
  const b = [...document.querySelectorAll('.sch-pager .sch-btn')].find((x) => (x.textContent || '').trim() === '下一页');
  if (!b || b.disabled) return false;
  b.click();
  return true;
})()`);
await sleep(900);
const t03p2 = await ev(`(() => {
  const rows = [...document.querySelectorAll('.sch-chunk-text')].map((n) => (n.textContent || '').trim().slice(0, 24));
  return { first: rows[0] || '', pager: (document.querySelector('.sch-pager') || {}).textContent || '' };
})()`);
record('T03a', '分块翻页：下一页内容与第一页不同且页码前进', nextOk && t03p1.first !== t03p2.first,
  `${t03p1.pager.replace(/\s+/g, ' ')} → ${t03p2.pager.replace(/\s+/g, ' ')}`);
}
/* ------------------------------------------- T13 标签（资料库迁移：分类） */
// 关掉文档详情抽屉，回到文档列表
await clickText('[aria-label="关闭"]', '关闭');
await sleep(400);
await clickText('.sch-dtr.body button', '标签');
await sleep(300);
await setInput('.sch-tag-edit .sch-input', 0, '标准, 装配图纸', 'input');
await ev(`(() => {
  const inp = document.querySelector('.sch-tag-edit .sch-input');
  const ev2 = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true });
  inp.dispatchEvent(ev2);
  return true;
})()`);
await sleep(400);
const t13a = await ev(`(() => {
  const chips = [...document.querySelectorAll('.sch-dtr.body .sch-doctag')].map((n) => n.textContent);
  const stored = JSON.parse(window.localStorage.getItem('schanora.doctags.v1') || '{}');
  const docIds = Object.keys(stored);
  return { chips, docIds, first: docIds[0] || '', tags: docIds.length ? stored[docIds[0]] : [] };
})()`);
record('T13a', '文档打标签：行内编辑保存、持久化到本机', t13a.chips.includes('标准') && t13a.chips.includes('装配图纸') && t13a.tags.includes('标准'),
  `chips=${t13a.chips.join('/')} stored=${t13a.first.slice(0, 12)}…`);
await clickContains('.sch-docbar .sch-scopechip', '标准');
await sleep(350);
const t13b = await ev(`(() => ({
  rows: document.querySelectorAll('.sch-dtr.body').length,
  tagged: [...document.querySelectorAll('.sch-dtr.body .sch-doctag')].some((n) => (n.textContent || '') === '标准'),
}))()`);
record('T13b', '标签筛选：只显示带该标签的文档', t13b.rows === 1 && t13b.tagged, `rows=${t13b.rows}`);
await clickText('.sch-docbar .sch-scopechip', '全部文档');
await sleep(300);

await evaluateBack();
async function evaluateBack() {
  await tab('采集');
  await sleep(500);
}

/* ------------------------------------------------------------- T04–T07 采集 */
await tab('采集');
await pickKb('工程标准库');
await setInput('.sch-clip-card input.sch-input', 0, 'https://supplier.example.com/ds?part=SC-1024&utm_source=mail');
await setInput('.sch-clip-card input.sch-input', 1, 'SC-1024 数据表');
await sleep(300);
const t07 = await ev(`(() => {
  const key = [...document.querySelectorAll('.sch-kv dd')].map((n) => n.textContent).find((x) => x.includes('::')) || '';
  return { key };
})()`);
record('T07', 'URL 去跟踪参数、保留业务参数（part）', t07.key.includes('part=SC-1024') && !t07.key.includes('utm_source'),
  t07.key.slice(0, 64));
await clickText('.sch-clip-card .sch-btn.primary', '提交入库');
await sleep(3200);
const t04 = await ev(`(() => {
  const dd = [...document.querySelectorAll('.sch-kv dd')].map((n) => n.textContent.trim());
  const badge = (document.querySelector('.sch-badge.live') || {}).textContent || '';
  return { dd, badge, doc: dd.find((x) => x.startsWith('doc-clip')) || '', version: dd.find((x) => /^v\\d+$/.test(x)) || '' };
})()`);
record('T04', 'URL 采集入库拿到真实 documentId 与版本', Boolean(t04.doc) && Boolean(t04.version), `${t04.doc} ${t04.version}`);

const docBefore = await ev(`(() => {
  const store = JSON.parse(window.localStorage.getItem('schanora.mockclips.v1') || '{}');
  const recs = Object.values(store.records || {});
  return { count: recs.length, versions: recs.reduce((n, r) => n + r.versions.length, 0) };
})()`);
await clickText('.sch-clip-card .sch-btn', '再采一条');
await sleep(400);
await pickKb('工程标准库');
await setInput('.sch-clip-card input.sch-input', 0, 'https://supplier.example.com/ds?part=SC-1024&utm_source=mail');
await setInput('.sch-clip-card input.sch-input', 1, 'SC-1024 数据表');
await clickText('.sch-clip-card .sch-btn.primary', '提交入库');
await sleep(1200);
const t05 = await ev(`(() => {
  const text = document.body.textContent;
  const store = JSON.parse(window.localStorage.getItem('schanora.mockclips.v1') || '{}');
  const recs = Object.values(store.records || {});
  const doc = ([...document.querySelectorAll('.sch-kv dd')].map((n) => n.textContent.trim()).find((x) => x.startsWith('doc-clip')) || '');
  return { reuse: text.includes('未新建副本'), count: recs.length, versions: recs.reduce((n, r) => n + r.versions.length, 0), doc };
})()`);
record('T05', '同内容重复提交不新建有效版本', t05.reuse && t05.count === docBefore.count && t05.versions === docBefore.versions,
  `记录 ${docBefore.count}→${t05.count}，版本 ${docBefore.versions}→${t05.versions}，同文档=${t05.doc === t04.doc}`);

await clickText('.sch-clip-card .sch-btn', '再采一条');
await sleep(400);
await pickKb('工程标准库');
await setInput('.sch-clip-card input.sch-input', 0, 'https://supplier.example.com/ds?part=SC-1024&utm_source=mail');
await setInput('.sch-clip-card input.sch-input', 1, 'SC-1024 数据表 Rev.C');
await clickText('.sch-clip-card .sch-btn.primary', '提交入库');
await sleep(3200);
const t06 = await ev(`(() => {
  const dd = [...document.querySelectorAll('.sch-kv dd')].map((n) => n.textContent.trim());
  const doc = dd.find((x) => x.startsWith('doc-clip')) || '';
  const v2 = dd.includes('v2') || dd.some((x) => x === 'v2');
  return { doc, v2, prev: dd.includes('v1'), text: document.body.textContent.includes('新版本') };
})()`);
record('T06', '内容变化形成同文档的新版本（v1→v2）', t06.doc === t04.doc && t06.v2 && t06.text,
  `${t06.doc} v2=${t06.v2} 上一版=${t06.prev}`);

/* ---------------------------------------------------------- T08–T10 浏览器 */
await tab('浏览器');
await ev(`(() => {
  const el = document.querySelector('.sch-clip-card input.sch-input');
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(el, 'https://sup.example.com/spec-table');
  el.dispatchEvent(new Event('input', { bubbles: true }));
})()`);
await ev(`([...document.querySelectorAll('.sch-btn.primary')].find((b) => (b.textContent || '').trim() === '开始') || {}).click()`);
await sleep(2600);
const t08 = await ev(`(() => ({
  done: document.body.textContent.includes('已完成'),
  table: (document.querySelector('.sch-brow-result pre') || {}).textContent || '',
}))()`);
record('T08', '动态表格任务真实读取并给出结果', t08.done && t08.table.includes('SC-1024'), `fragment=${(t08.table || '').slice(0, 20)}…`);
await clickText('.sch-brow-acts .sch-btn.primary', '送入采集面板');
await sleep(700);
const t08b = await ev(`(() => ({
  onClip: Boolean(document.querySelector('.sch-clip-ta')),
  ta: (document.querySelector('.sch-clip-ta') || {}).value || '',
}))()`);
record('T08b', '采集结果交接采集面板并预填正文', t08b.onClip && t08b.ta.includes('SC-1024'), `预填 ${t08b.ta.length} 字符`);

await tab('浏览器');
await ev(`(() => {
  const el = document.querySelector('.sch-clip-card input.sch-input');
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(el, 'https://sup.example.com/report.pdf');
  el.dispatchEvent(new Event('input', { bubbles: true }));
})()`);
await ev(`(() => {
  const sel = document.querySelector('.sch-clip-card select');
  const opt = [...sel.options].find((o) => (o.text || '').includes('下载文件'));
  const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
  setter.call(sel, opt.value);
  sel.dispatchEvent(new Event('change', { bubbles: true }));
})()`);
await sleep(200);
await ev(`([...document.querySelectorAll('.sch-btn.primary')].find((b) => (b.textContent || '').trim() === '开始') || {}).click()`);
await sleep(2800);
const t09 = await ev(`(() => {
  const result = [...document.querySelectorAll('.sch-brow-result')].map((n) => n.textContent).join(' ');
  return { text: result };
})()`);
record('T09a', '下载任务校验文件名/大小/哈希后才算完成', t09.text.includes('文件完整') && t09.text.includes('sha256'), t09.text.slice(0, 40));
// 登录协助
await ev(`(() => {
  const el = document.querySelector('.sch-clip-card input.sch-input');
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(el, 'https://login.supplier.example.com/portal');
  el.dispatchEvent(new Event('input', { bubbles: true }));
})()`);
await ev(`([...document.querySelectorAll('.sch-btn.primary')].find((b) => (b.textContent || '').trim() === '开始') || {}).click()`);
await sleep(1600);
const t09b = await ev(`document.body.textContent.includes('请在浏览器完成登录')`);
record('T09b', '需登录页面进入等待登录态并交还用户', t09b === true);
await clickText('.sch-brow-acts .sch-btn.primary', '已完成登录');
await sleep(2400);
const t09c = await ev(`(() => {
  const rows = [...document.querySelectorAll('.sch-brow-task')];
  const last = rows[rows.length - 1];
  return last ? last.textContent.includes('已完成') : false;
})()`);
record('T09c', '登录完成后任务继续并完成', t09c === true);

// 取消 → 迟到结果丢弃
await ev(`(() => {
  const el = document.querySelector('.sch-clip-card input.sch-input');
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(el, 'https://sup.example.com/cancel-me');
  el.dispatchEvent(new Event('input', { bubbles: true }));
})()`);
await ev(`([...document.querySelectorAll('.sch-btn.primary')].find((b) => (b.textContent || '').trim() === '开始') || {}).click()`);
await sleep(300);
await ev(`([...document.querySelectorAll('.sch-brow-acts .sch-btn')].find((b) => (b.textContent || '').trim() === '取消') || {}).click()`);
await sleep(1700);
const t10 = await ev(`(() => ({
  discarded: document.body.textContent.includes('迟到结果已丢弃'),
  note: document.body.textContent.includes('本结果已丢弃'),
}))()`);
record('T10a', '取消后迟到结果标记丢弃、不入库', t10.discarded && t10.note);

// 会话隔离：A 有任务，切 B 后任务列表为空
await ev(`window.__HARNESS_UI__.set({ session: 'B' })`);
await sleep(900);
const t10b = await ev(`(() => ({
  tasks: document.querySelectorAll('.sch-brow-task').length,
  sid: (document.body.textContent.match(/sess-[ab]-[0-9a-f]+/) || [''])[0],
}))()`);
record('T10b', '切会话 B：浏览器任务列表为空（按会话隔离）', t10b.tasks === 0, `sid=${t10b.sid}`);
await ev(`window.__HARNESS_UI__.set({ session: 'A' })`);
await sleep(700);

/* ------------------------------------------------------------- T11 批量续跑 */
await tab('批量导入');
await pickKb('工程标准库');
await clickContains('.sch-clip-card .sch-btn', '载入演示批次');
await sleep(400);
await clickText('.sch-clip-card .sch-btn.primary', '开始导入');
await sleep(10000);
const t11 = await ev(`(() => {
  const rows = [...document.querySelectorAll('.sch-batch-row')];
  const badges = rows.map((r) => ((r.querySelector('.sch-badge') || {}).textContent || '').trim());
  return { rows: rows.length, done: badges.filter((b) => b === '已入库').length, failed: badges.filter((b) => b === '失败').length };
})()`);
record('T11a', '批量导入：成功项入库、故意失败项单独失败', t11.rows === 3 && t11.done === 2 && t11.failed === 1,
  `done=${t11.done} failed=${t11.failed}`);
await clickText('.sch-clip-card .sch-btn', '重试失败项');
await sleep(5000);
const t11b = await ev(`(() => {
  const rows = [...document.querySelectorAll('.sch-batch-row')];
  const badges = rows.map((r) => ((r.querySelector('.sch-badge') || {}).textContent || '').trim());
  return { done: badges.filter((b) => b === '已入库').length, failed: badges.filter((b) => b === '失败').length };
})()`);
record('T11b', '失败项重试成功', t11b.done === 3 && t11b.failed === 0, `done=${t11b.done}`);
await clickContains('.sch-clip-card .sch-btn', '载入演示批次');
await sleep(400);
await clickText('.sch-clip-card .sch-btn.primary', '开始导入');
await sleep(4500);
const t11c = await ev(`(() => {
  const rows = [...document.querySelectorAll('.sch-batch-row')];
  const badges = rows.map((r) => ((r.querySelector('.sch-badge') || {}).textContent || '').trim());
  return { skipped: badges.filter((b) => b.includes('跳过')).length, total: rows.length };
})()`);
record('T11c', '续跑同一批次：成功项全部跳过，不重复入库', t11c.skipped >= 3, `skipped=${t11c.skipped}/${t11c.total}`);

/* ------------------------------------------------------------------ 汇总 */
record('T12', '安装/升级/卸载（真实 DSH 环境）', false, '本机无 DSH 运行时与真实 WeKnora/OneDrive，需 A 侧环境后验收', 'blocked');
record('T03', '文档分页与深度问答（真实后端）', false, '深度问答已实现 UI/契约，真实分页与引用需接真网关复验', 'blocked');

console.log('\n[verify] 结果：');
const pass = results.filter((r) => r.state === 'pass').length;
const fail = results.filter((r) => r.state === 'fail').length;
const blocked = results.filter((r) => r.state === 'blocked').length;
console.log(`  通过 ${pass} · 失败 ${fail} · 环境缺项 ${blocked}（共 ${results.length}）`);
if (errors.length) {
  console.log('\n[verify] 页面异常：');
  errors.forEach((e) => console.log('  ! ' + e));
}
ws.close();
chrome.kill();
process.exit(0);
