/**
 * 现场联调（B 前端 ↔ A 真网关）自动核对脚本。
 *
 * 与 verify-plugins.mjs 的区别：那个跑「演示数据」验状态机，这个切「网关实时」验真链路。
 * 每一步都做双证据：
 *   ① 浏览器界面断言（DOM 上真的出现了数据）
 *   ② Node 直连网关核对（网关里真的存了这条数据）
 * 任何一步只有界面有、网关没有，都不算通过。
 *
 * 用法：node scripts/verify-live.mjs <previewBase> <gatewayBase> [chromePath]
 *   例：node scripts/verify-live.mjs http://127.0.0.1:8124/preview/ http://172.20.10.3:8000
 *
 * 前置：仓库根起静态服务（python -m http.server 8124 --bind 127.0.0.1），
 *       且与 A 同网络、/health 可达。缺前置会直接以 BLOCKED 退出，不伪造结果。
 */
import { existsSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';

const previewBase = (process.argv[2] || 'http://127.0.0.1:8124/preview/').replace(/\/+$/, '');
const gateway = (process.argv[3] || process.env.GATEWAY_BASE || 'http://172.20.10.3:8000').replace(/\/+$/, '');

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
];
const chromePath = process.argv[4] || CHROME_CANDIDATES.find((c) => c && existsSync(c));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
let KB_NAME = `联调-${stamp}`;
let DOC_NAME = `联调文档-${stamp}.md`;
// 复验用：LIVE_KB_ID / LIVE_DOC_ID 指向上一轮建的库与文档，跳过 L2/L3，
// 避免每跑一次就在 A 的后台多留一个测试库。
const REUSE_KB = process.env.LIVE_KB_ID || '';
const REUSE_DOC = process.env.LIVE_DOC_ID || '';

const results = [];
function record(id, name, ok, detail, state) {
  const s = state || (ok ? 'pass' : 'fail');
  results.push({ id, name, ok, state: s, detail });
  const mark = s === 'pass' ? '✓' : s === 'blocked' ? '⊘' : s === 'skip' ? '·' : '✗';
  console.log(`  ${mark} ${id} ${name}${detail ? ` — ${detail}` : ''}`);
  return ok;
}

/* ------------------------------------------------------------ 网关直连核对 */

async function gw(pathname, init) {
  const res = await fetch(gateway + pathname, {
    ...init,
    headers: { Accept: 'application/json', ...(init && init.body ? { 'Content-Type': 'application/json' } : {}), ...(init && init.headers) },
  });
  let json = null;
  try {
    json = await res.json();
  } catch (_e) {
    json = null;
  }
  return { status: res.status, json };
}
const gwData = (r) => (r.json && r.json.data !== undefined ? r.json.data : r.json);

/* ---------------------------------------------------------------- 前置检查 */

console.log(`[live] 网关 ${gateway}`);
let health;
try {
  health = await gw('/health');
} catch (error) {
  console.error(`✗ 网关不可达：${error.message}`);
  console.error('  先按联调手册第七节排障（同网络 / IP / 防火墙），本次不跑界面，避免伪造结果。');
  process.exit(2);
}
if (health.status !== 200 || !health.json || health.json.status !== 'ok') {
  console.error(`✗ /health 返回 ${health.status} ${JSON.stringify(health.json)}`);
  console.error('  degraded 说明 A 的 WeKnora 没起或 API Key 失效，找 A 处理。');
  process.exit(2);
}
console.log(`  ✓ /health ${health.json.status} · gateway ${health.json.version}`);

const caps = await gw('/capabilities');
const features = (gwData(caps) || {}).features || {};
console.log(`  ✓ /capabilities contract=${(gwData(caps) || {}).contractVersion} features=${JSON.stringify(features)}`);
record('L0', '网关可用且五个能力齐全', Object.values(features).every(Boolean), JSON.stringify(features));

if (!chromePath) {
  console.error('✗ 找不到 Chrome，请设置 CHROME_PATH');
  process.exit(2);
}

/* ------------------------------------------------------------- 测试素材 */

const docDir = path.resolve('.tmp-live');
mkdirSync(docDir, { recursive: true });
const docPath = path.join(docDir, DOC_NAME);
// 造一份能被切成多块的文档：正文约 1.1 万字，按默认 chunkSize 会切成 20 块以上，
// 这样第 5 步「分块翻页」才有真实第二页可翻（单块文档翻不动，断言会假通过）。
const sections = Array.from({ length: 20 }, (_, i) => {
  const no = i + 1;
  return [
    `## 第 ${no} 节 联调条目 ${stamp}-${no}`,
    '',
    `本节用于验证检索与分块链路，关键标识 LIVEKEY${stamp}${String(no).padStart(2, '0')}。`,
    `装配要求：扭矩 ${18 + no} N·m，涂胶量 ${no} ml，固化 ${20 + no} 分钟。`,
    `检验方法：按 GB/T ${9000 + no} 抽检，记录批次号与设备编号，异常时隔离该批次。`,
    `常见失效：密封面划伤、螺纹滑牙、涂层气泡；处置方式是退料并登记不合格项。`,
    `本节重复填充文本以保证字符数超过一个分块阈值，便于分页断言。`.repeat(3),
    '',
  ].join('\n');
}).join('\n');
writeFileSync(docPath, `# 联调验证文档 ${stamp}\n\n${sections}`, 'utf8');
console.log(`  · 测试文档 ${DOC_NAME} (${(await import('node:fs')).statSync(docPath).size} bytes)`);

/* --------------------------------------------------------------- 浏览器 */

const PORT = 9336;
const profileDir = path.resolve('.tmp-live-profile');
rmSync(profileDir, { recursive: true, force: true });
mkdirSync(profileDir, { recursive: true });

const { spawn } = await import('node:child_process');
const chrome = spawn(
  chromePath,
  [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--hide-scrollbars',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profileDir.replace(/\\/g, '/')}`,
    '--window-size=1400,960',
    'about:blank',
  ],
  { stdio: 'ignore' },
);

async function findTarget() {
  for (let i = 0; i < 40; i += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
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
const consoleErrors = [];
const netFailures = [];
ws.addEventListener('message', (event) => {
  const msg = JSON.parse(event.data);
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
    return;
  }
  if (msg.method === 'Runtime.exceptionThrown') {
    consoleErrors.push(msg.params.exceptionDetails.text + ' ' + (msg.params.exceptionDetails.exception?.description || ''));
  }
  if (msg.method === 'Network.loadingFailed') {
    netFailures.push(msg.params.errorText || 'loadingFailed');
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
async function waitFor(label, expression, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    try {
      last = await ev(expression);
      if (last) return last;
    } catch (_e) {
      /* 面板重挂载期间 evaluate 可能失败，继续等 */
    }
    await sleep(400);
  }
  console.log(`    (等待超时 ${timeoutMs}ms: ${label}，最后值=${JSON.stringify(last)})`);
  return null;
}

await send('Page.enable');
await send('Runtime.enable');
await send('Network.enable');
await send('DOM.enable');

async function goto(url) {
  await send('Page.navigate', { url });
  await sleep(2200);
}
async function tab(text) {
  const ok = await waitFor(`页签 ${text}`, `(() => {
    const el = [...document.querySelectorAll('.sch-tab')].find((b) => (b.textContent || '').trim().includes(${JSON.stringify(text)}));
    if (!el) return false;
    el.click();
    return true;
  })()`, 12000);
  if (!ok) throw new Error(`找不到页签：${text}`);
  await sleep(700);
}
async function clickText(selector, text, timeoutMs = 9000) {
  return waitFor(`点击 ${text}`, `(() => {
    const el = [...document.querySelectorAll(${JSON.stringify(selector)})].find((n) => (n.textContent || '').trim() === ${JSON.stringify(text)});
    if (!el) return false;
    el.click();
    return true;
  })()`, timeoutMs || 9000);
}
async function clickContains(selector, text, timeoutMs = 9000) {
  return waitFor(`点击含 ${text}`, `(() => {
    const el = [...document.querySelectorAll(${JSON.stringify(selector)})].find((n) => (n.textContent || '').includes(${JSON.stringify(text)}));
    if (!el) return false;
    el.click();
    return true;
  })()`, timeoutMs || 9000);
}
const setInput = (selector, index, value, tag) => ev(`(() => {
  const el = [...document.querySelectorAll(${JSON.stringify(selector)})][${index}];
  if (!el) return false;
  const proto = (${JSON.stringify(tag || 'input')} === 'textarea' ? window.HTMLTextAreaElement : window.HTMLInputElement).prototype;
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(value)});
  el.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
})()`);

/** 把知识库范围 chip 点到「已选中」状态（已经是选中态就不要点，点了会取消）。 */
async function ensureScope(name) {
  const on = await ev(`(() => {
    const el = [...document.querySelectorAll('.sch-scoperow .sch-scopechip')].find((n) => (n.textContent || '').trim() === ${JSON.stringify(name)});
    return Boolean(el && el.classList.contains('on'));
  })()`);
  if (on) return true;
  const clicked = await clickContains('.sch-scoperow .sch-scopechip', name, 12000);
  await sleep(300);
  return clicked;
}

/* ============================================================ L1 切真网关 */

console.log('[live] L1 切换数据源 → 网关实时');
await goto(`${previewBase}/?v=live-${stamp}`);
const mounted = await waitFor('面板挂载', `Boolean(document.querySelector('.sch-tab'))`, 20000);
if (!mounted) {
  record('L1', '面板挂载', false, '面板未渲染，检查 preview 服务与 bundle');
  throw new Error('面板未挂载');
}

await ev(`(() => {
  const b = [...document.querySelectorAll('.sch-main-actions .sch-btn')].find((x) => (x.getAttribute('aria-label') || '') === '设置');
  if (!b) return false;
  b.click();
  return true;
})()`);
await sleep(500);
await clickText('.sch-drawer-set .sch-seg button', '网关实时');
await sleep(300);
await setInput('#sch-base', 0, gateway);
await sleep(200);
// 「测试连接」本身就是在打 /health：界面内也能证明链路通
await clickText('.sch-drawer-set .sch-btn', '测试连接');
const tested = await waitFor('连接测试', `(() => {
  const box = document.querySelector('.sch-drawer-set');
  return box && (box.textContent || '').includes('连接成功');
})()`, 20000);
record('L1a', '界面内「测试连接」通过（打的是真 /health）', Boolean(tested), tested ? '连接成功 ok' : '未见成功提示');

await clickText('.sch-drawer-set .sch-btn', '保存');
await sleep(500);
const savedSettings = await ev(`JSON.parse(localStorage.getItem('schanora.settings.v1') || '{}')`);
const modeOk = savedSettings.mode === 'http' && (savedSettings.baseUrl || '').replace(/\/+$/, '') === gateway;

// 刷新后读网关真实知识库：出现网关独有的库名 = 数据真的来自 A
await goto(`${previewBase}/?v=live-${stamp}-b`);
await tab('知识库');
await sleep(1500);
const kbNames = await ev(`[...document.querySelectorAll('.sch-kbcard-name')].map((n) => (n.textContent || '').trim())`);
const mockOnly = ['工程标准库', '产品资料库', '现场故障库'].filter((n) => kbNames.includes(n));
const liveList = gwData(await gw('/api/v1/knowledge-bases')) || [];
const liveNames = (Array.isArray(liveList) ? liveList : []).map((k) => k.name);
const overlap = kbNames.filter((n) => liveNames.includes(n));
record(
  'L1b',
  '切到网关实时：列表是 A 的真数据（无演示库残留）',
  modeOk && overlap.length > 0 && mockOnly.length === 0,
  `mode=${savedSettings.mode} 界面库=${kbNames.length} 网关库=${liveNames.length} 重合=${overlap.length} 演示残留=${mockOnly.length}`,
);

/* ================================================================ L2 建库 */

console.log('[live] L2 建库（模型选 bge-m3）');
let kbId = REUSE_KB;
if (REUSE_KB) {
  const all = gwData(await gw('/api/v1/knowledge-bases')) || [];
  const found = (Array.isArray(all) ? all : []).find((k) => k.id === REUSE_KB);
  if (!found) throw new Error(`LIVE_KB_ID=${REUSE_KB} 在网关里不存在`);
  KB_NAME = found.name;
  record('L2', '建库（复验：复用上一轮的库，不重复建）', true, `kbId=${REUSE_KB.slice(0, 8)} name=${KB_NAME}`, 'skip');
} else {
await clickText('.sch-kbhead .sch-btn.primary', '新建知识库', 12000);
await sleep(500);
await setInput('.sch-pop .sch-input', 0, KB_NAME);
await sleep(200);
const modelOptions = await ev(`(() => {
  const sel = document.querySelector('.sch-pop select');
  return sel ? [...sel.options].map((o) => ({ v: o.value, t: (o.text || '').trim() })) : null;
})()`);
const bge = (modelOptions || []).find((o) => o.t.includes('bge-m3'));
if (bge) {
  await ev(`(() => {
    const sel = document.querySelector('.sch-pop select');
    Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set.call(sel, ${JSON.stringify(bge.v)});
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
  await sleep(200);
}
await ev(`(() => {
  const btn = [...document.querySelectorAll('.sch-pop .sch-btn.primary')].find((b) => (b.textContent || '').trim() === '创建');
  if (!btn) return false;
  btn.click();
  return true;
})()`);
const created = await waitFor('建库完成', `(() => {
  const n = [...document.querySelectorAll('.sch-kbcard-name')].find((x) => (x.textContent || '').trim() === ${JSON.stringify(KB_NAME)});
  return Boolean(n);
})()`, 40000);
const afterCreate = gwData(await gw('/api/v1/knowledge-bases')) || [];
const createdKb = (Array.isArray(afterCreate) ? afterCreate : []).find((k) => k.name === KB_NAME);
record(
  'L2',
  '建库：界面出现新库且网关里真有这条',
  Boolean(created && createdKb && bge),
  `界面=${created ? '有' : '无'} 网关=${createdKb ? createdKb.id.slice(0, 8) : '无'} 模型=${bge ? 'bge-m3' : '未找到'}`,
);
if (!createdKb) {
  console.error('  ✗ 网关侧没有新建的库，后续步骤无法继续');
  throw new Error('建库未落到网关');
}
kbId = createdKb.id;
}

/* ================================================================ L3 上传 */

console.log('[live] L3 上传文档');
let docId = REUSE_DOC;
let parseStatusSeed = '';
if (REUSE_DOC) {
  const got = gwData(await gw(`/api/v1/documents/${REUSE_DOC}`));
  if (!got) throw new Error(`LIVE_DOC_ID=${REUSE_DOC} 在网关里不存在`);
  DOC_NAME = String(got.title || got.fileName || DOC_NAME);
  record('L3', '上传（复验：复用上一轮的文档，不重复上传）', true, `docId=${REUSE_DOC.slice(0, 8)} ${got.parseStatus}`, 'skip');
  // 复验没有走上传，但要停在同一个位置：知识库 → 文档列表
  await clickContains('.sch-kbcard', KB_NAME);
  await sleep(1500);
  parseStatusSeed = String(got.parseStatus || 'completed');
} else {
await clickContains('.sch-kbcard', KB_NAME);
await sleep(1500);
const fileNode = await (async () => {
  const { root } = await send('DOM.getDocument', { depth: -1 });
  const q = await send('DOM.querySelector', { nodeId: root.nodeId, selector: 'input[type=file]' });
  return q.nodeId;
})();
if (!fileNode) {
  record('L3', '上传文档', false, '找不到文件输入框（未进入文档页？）');
  throw new Error('无文件输入框');
}
await send('DOM.setFileInputFiles', { nodeId: fileNode, files: [docPath] });
const uploaded = await waitFor('文档行出现', `(() => {
  const row = [...document.querySelectorAll('.sch-dtr.body')].find((n) => (n.textContent || '').includes(${JSON.stringify(DOC_NAME)}));
  return row ? (row.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 80) : null;
})()`, 90000);
const docsAfter = gwData(await gw(`/api/v1/knowledge-bases/${kbId}/documents`)) || [];
const docRow = (Array.isArray(docsAfter) ? docsAfter : []).find((d) => d.title === DOC_NAME || d.fileName === DOC_NAME);
record(
  'L3',
  '上传：列表出现新文档且网关真收到文件',
  Boolean(uploaded && docRow),
  `界面行=${uploaded ? '有' : '无'} 网关=${docRow ? `${docRow.id.slice(0, 8)} ${docRow.parseStatus}` : '无'}`,
);
if (!docRow) throw new Error('上传未落到网关');
docId = docRow.id;
}

/* ================================================================ L4 状态 */

console.log('[live] L4 处理状态 → completed');
const t0 = Date.now();
let parseStatus = parseStatusSeed || (typeof docRow !== 'undefined' && docRow ? docRow.parseStatus : '') || 'pending';
let uiStatus = '';
const deadline = Date.now() + 200000;
while (Date.now() < deadline) {
  const d = gwData(await gw(`/api/v1/documents/${docId}`));
  parseStatus = (d && (d.parseStatus || d.status)) || parseStatus;
  if (parseStatus === 'completed' || parseStatus === 'failed') break;
  await sleep(4000);
}
// 界面侧：文档行状态徽标跟着轮询（界面 3s 一轮）
uiStatus = await waitFor('界面状态更新', `(() => {
  const row = [...document.querySelectorAll('.sch-dtr.body')].find((n) => (n.textContent || '').includes(${JSON.stringify(DOC_NAME)}));
  if (!row) return null;
  const txt = (row.textContent || '').replace(/\\s+/g, ' ');
  return txt.includes('已完成') ? '已完成' : txt.includes('失败') ? '失败' : null;
})()`, 60000);
record(
  'L4',
  '处理状态：网关轮询到 completed 且界面同步',
  parseStatus === 'completed' && Boolean(uiStatus),
  `网关=${parseStatus} 界面=${uiStatus || '未同步'} 用时=${Math.round((Date.now() - t0) / 1000)}s`,
);

/* ================================================================ L5 分块 */

console.log('[live] L5 分块列表与翻页');
const chunkP1 = gwData(await gw(`/api/v1/documents/${docId}/chunks?page=1&page_size=10`)) || {};
const gwTotal = Number(chunkP1.total || 0);
await clickContains('.sch-dtr.body', DOC_NAME);
await sleep(1600);
await clickText('.sch-tabbtn', '分块', 12000);
await sleep(1200);
const p1 = await ev(`(() => {
  const rows = [...document.querySelectorAll('.sch-chunk-text')].map((n) => (n.textContent || '').trim().slice(0, 30));
  const pager = (document.querySelector('.sch-pager') || {}).textContent || '';
  return { first: rows[0] || '', count: rows.length, pager: pager.replace(/\\s+/g, ' ') };
})()`);
const turned = await ev(`(() => {
  const b = [...document.querySelectorAll('.sch-pager .sch-btn')].find((x) => (x.textContent || '').trim() === '下一页');
  if (!b || b.disabled) return false;
  b.click();
  return true;
})()`);
await sleep(1400);
const p2 = await ev(`(() => {
  const rows = [...document.querySelectorAll('.sch-chunk-text')].map((n) => (n.textContent || '').trim().slice(0, 30));
  const pager = (document.querySelector('.sch-pager') || {}).textContent || '';
  return { first: rows[0] || '', pager: pager.replace(/\\s+/g, ' ') };
})()`);
record(
  'L5',
  '分块：总数来自网关（非「可能还有更多」）且下一页真的换内容',
  gwTotal >= 10 && Boolean(turned) && p1.first !== p2.first && !p1.pager.includes('可能还有更多'),
  `网关 total=${gwTotal} · ${p1.pager} → ${p2.pager}`,
);

// 关掉抽屉回列表
await ev(`(() => {
  const b = [...document.querySelectorAll('.sch-drawer .sch-btn.icon')].pop();
  if (b) b.click();
  return true;
})()`);
await sleep(700);

/* ================================================================ L6 检索 */

console.log('[live] L6 检索');
await tab('检索');
await sleep(1200);
const scoped = await ensureScope(KB_NAME);
await setInput('.sch-search-input', 0, `LIVEKEY${stamp}05`);
await sleep(200);
await clickText('.sch-searchbox .sch-btn.primary', '检索', 12000);
const hits = await waitFor('检索命中', `(() => {
  const n = document.querySelectorAll('.sch-hit').length;
  return n > 0 ? n : null;
})()`, 45000);
const hitTexts = (await ev(`[...document.querySelectorAll('.sch-hit')].map((n) => (n.textContent || '').replace(/\\s+/g, ' '))`)) || [];
const realSnippet = hitTexts.find((txt) => txt.includes(DOC_NAME) && txt.length > 80) || '';
const keywordInHits = hitTexts.some((txt) => txt.includes(`LIVEKEY${stamp}05`));
const searchGw = gwData(await gw('/api/v1/search', {
  method: 'POST',
  body: JSON.stringify({ query: `LIVEKEY${stamp}05`, knowledgeBaseIds: [kbId], matchCount: 10 }),
}));
const searchGwCount = ((searchGw && searchGw.items) || []).length;
// 通过口径：界面命中里出现「本次上传的文档名 + 成段正文」，且网关同一查询也有命中。
// 关键词命中率受向量排序影响，只作信息记录，不作硬门槛（否则是在验上游排序，不是验链路）。
record(
  'L6',
  '检索：返回真实内容片段（界面与网关一致）',
  Boolean(hits) && searchGwCount > 0 && Boolean(realSnippet),
  `界面命中=${hits || 0} 网关命中=${searchGwCount} 含本次文档=${realSnippet ? '是' : '否'} 含关键词=${keywordInHits ? '是' : '否'} 片段="${(realSnippet || hitTexts[0] || '').slice(0, 46)}…"`,
);

/* ================================================================ L7 问答 */

// P3 把问答分成两条路：普通问题只检索证据（不在本面板合成答案），显式「深度研究」
// 才调 WeKnora 的 SSE 合成问答。两段必须分开验——否则会把「证据模式没有角标」
// 误判成接口缺陷，或者反过来用证据模式冒充问答通过。

/** 在网关侧按提问原文定位会话，取它之后的那条助手消息（真落库才拿得到）。 */
async function sessionAnswerFor(query) {
  const list = gwData(await gw('/api/v1/sessions')) || [];
  const arr = (Array.isArray(list) ? list : []).slice();
  arr.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
  for (const s of arr.slice(0, 6)) {
    const raw = gwData(await gw(`/api/v1/sessions/${s.id}/messages?limit=20`)) || [];
    const items = Array.isArray(raw) ? raw : raw.items || [];
    const at = items.findIndex(
      (m) => String(m.role || '').toLowerCase() === 'user' && String(m.content || '').includes(query),
    );
    if (at < 0) continue;
    const bot = items
      .slice(at + 1)
      .find((m) => String(m.role || '').toLowerCase() !== 'user' && String(m.content || '').trim());
    return { sessionId: s.id, answer: bot ? String(bot.content) : '', refs: (bot && bot.knowledgeReferences) || [] };
  }
  return null;
}

console.log('[live] L7a 普通提问 → 证据模式');
await tab('工程问答');
await sleep(1200);
await ensureScope(KB_NAME);
const q1 = `LIVEKEY${stamp}05 这一节的装配扭矩是多少？`;
await setInput('.sch-ta', 0, q1, 'textarea');
await sleep(200);
await clickText('.sch-composer .sch-btn.primary', '发送', 12000);
const evidence = await waitFor(
  '证据气泡',
  `(() => {
    const msgs = [...document.querySelectorAll('.sch-msg.assistant')];
    const last = msgs[msgs.length - 1];
    if (!last) return null;
    const txt = (last.textContent || '').replace(/\\s+/g, ' ').trim();
    if (!txt.includes('证据已就绪')) return null;
    return { len: txt.length, head: txt.slice(0, 100) };
  })()`,
  90000,
);
record(
  'L7a',
  '普通提问只出证据、不在本面板合成答案（P3 分流生效）',
  Boolean(evidence),
  evidence ? `${evidence.len} 字符 · ${evidence.head.slice(0, 56)}…` : '未出现证据气泡',
);

console.log('[live] L7b 深度研究 → WeKnora 合成问答（SSE）');
const deepOn = await ev(`(() => {
  const chip = [...document.querySelectorAll('.sch-composer .sch-scopechip')].find((n) => (n.textContent || '').trim() === '深度研究');
  if (!chip) return false;
  if (chip.getAttribute('aria-pressed') !== 'true') chip.click();
  return chip.getAttribute('aria-pressed') === 'true' || true;
})()`);
await sleep(400);
const q2 = `${q1} 请给出结论与依据。`;
await setInput('.sch-ta', 0, q2, 'textarea');
await sleep(250);
await clickText('.sch-composer .sch-btn.primary', '发送', 12000);
const answer = await waitFor(
  '合成答案结束',
  `(() => {
    const msgs = [...document.querySelectorAll('.sch-msg.assistant')];
    const last = msgs[msgs.length - 1];
    if (!last) return null;
    const txt = (last.textContent || '').trim();
    if (document.querySelector('.sch-typing, .sch-cursor') || txt.length < 20) return null;
    const note = (last.querySelector('.sch-msg-note') || {}).textContent || '';
    if (!note.includes('WeKnora 合成')) return null;
    return { len: txt.length, text: txt.slice(0, 500), cites: (txt.match(/\\[\\d+\\]/g) || []).length };
  })()`,
  240000,
);
const alerts = await ev(`[...document.querySelectorAll('.sch-alert.err')].map((n) => (n.textContent || '').replace(/\\s+/g, ' ')).join(' | ')`);
const incomplete = await ev(`(document.body.textContent || '').includes('答案提前结束')`);
// 超时失败时把每条助手消息的实况记下来，避免只会说「没等到」而查不出是没渲染、还是被别的消息顶上来了。
const msgDump = await ev(`[...document.querySelectorAll('.sch-msg.assistant')].map((m) => {
  const note = (m.querySelector('.sch-msg-note') || {}).textContent || '';
  return (m.textContent || '').trim().length + '字/' + note.trim().slice(0, 12) + '/' + m.querySelectorAll('.sch-refs .sch-ref').length + 'refs';
}).join(' | ')`);
const stored = await sessionAnswerFor(q2);
// 上游把模型错误当答案正文返回时（实测 test1 / AX-200 的 model_not_found），内容非空但根本不是答案；
// 不识别就会让 L7b 假通过 —— 2026-11-16 16:0x 补。
const ERR_ANSWER_RE =
  /create chat completion stream|API request failed with status \d{3}|model_not_found|does not exist or you do not have access/i;
const errAnswer = [answer ? answer.text : '', stored ? stored.answer : ''].find((t) => ERR_ANSWER_RE.test(t || '')) || '';
record(
  'L7b',
  '深度研究：答案流式收束（complete）且网关存下这条回答',
  Boolean(answer) && Boolean(stored && stored.answer.length > 10) && !incomplete && !errAnswer,
  `界面字符=${answer ? answer.len : 0} 网关字符=${stored ? stored.answer.length : 0} 提前结束=${incomplete ? '是' : '否'} 告警=${alerts ? alerts.slice(0, 50) : '无'} 错误答案=${errAnswer ? errAnswer.slice(0, 60) : '无'} 面板=${msgDump || '无助手消息'}`,
);
// 引用呈现的口径（2026-11-16 与 A 对齐，见 docs/handoff/B-REPLY-2026-11-16.md §2）：
//   硬性 L7c：引用列表渲染出来 + 页面无裸 <kb …/> 标签 —— 「出处可见且干净」由两端代码保证，不依赖模型
//   信息 L7e：答案里有 [n] 角标 —— 取决于模型是否遵循指令，是增强项而非验收闸；
//             上游（prompt 或换模型）一旦给出标记，前端转换已就绪，此项自动转 pass
const leakTag = await ev(`(document.body.textContent || '').includes('<kb')`);
// 只看「最后一条助手消息」自己的引用列表：整页 .sch-ref 会把上一条证据气泡的命中
// 一起数进来，导致答案一条引用都没有时也判 pass（假阳性）。
const lastRefs = await ev(`(() => {
  const msgs = [...document.querySelectorAll('.sch-msg.assistant')];
  const last = msgs[msgs.length - 1];
  if (!last) return { n: 0, items: [] };
  const items = [...last.querySelectorAll('.sch-refs .sch-ref')].map((r) => {
    const pick = (sel) => ((r.querySelector(sel) || {}).textContent || '').replace(/\\s+/g, ' ').trim();
    return { idx: pick('.sch-ref-idx'), title: pick('.sch-ref-title'), meta: pick('.sch-ref-meta') };
  });
  return { n: items.length, items };
})()`);
record(
  'L7c',
  '引用列表展示且无裸 <kb/> 泄漏（硬性，只看最后一条答案）',
  !leakTag && Boolean(answer) && Boolean(lastRefs) && lastRefs.n > 0,
  leakTag
    ? '页面出现裸 <kb 标签，转换未生效'
    : !answer
      ? '本轮没有合成答案，引用列表无从判定'
      : lastRefs && lastRefs.n
        ? `引用 ${lastRefs.n} 条：${lastRefs.items.map((x) => `${x.idx}${x.title.slice(0, 18)}`).join(' / ').slice(0, 90)}`
        : '最后一条答案没有引用列表',
  leakTag || !answer || !(lastRefs && lastRefs.n > 0) ? 'fail' : 'pass',
);
// A-1 的直接判据：引用列表必须按本轮召回回填，而不是固定文档第 0 块。
// 两端要分开看，混在一起会得出错误结论：
//   · SSE `references` 事件 = 实时渲染用的（界面上那几条）；
//   · GET /messages 的 knowledgeReferences = 刷新后回读用的。
// 只有落库那份也指向真实召回块，刷新后才不会退化成第 0 块。
const refIdxs = ((stored && stored.refs) || []).map((r) => Number(r.chunkIndex));
const refScores = ((stored && stored.refs) || []).map((r) => Number(r.score) || 0);
const allFirstBlock = refIdxs.length > 0 && refIdxs.every((i) => i === 0);
const uiRefCount = lastRefs ? lastRefs.n : 0;
// 条数必须与 SSE 那份一致：只对 chunkIndex 会让「落了 1 条真实块」也算过，刷新后仍会少几条。
const sameCount = uiRefCount === 0 || uiRefCount === refIdxs.length;
// 落库顺序应为 score 降序（引用列表按相关度排），乱序说明回填时没保序。
const descOrder = refScores.every((s, i) => i === 0 || refScores[i - 1] >= s - 1e-9);
const l7fOk = refIdxs.length > 0 && !(allFirstBlock && gwTotal > 1) && sameCount && descOrder;
record(
  'L7f',
  '引用列表落库后仍指向真实召回块且与 SSE 同源（A-1 持久化判据）',
  l7fOk,
  `界面(SSE)=${uiRefCount} 条 / 落库=${refIdxs.length} 条 chunkIndex=[${refIdxs.join(',')}] 文档共 ${gwTotal} 块${
    allFirstBlock && gwTotal > 1 ? ' · 落库全部指向第 0 块：刷新后引用列表会退化' : ''
  }${sameCount ? '' : ' · 条数与 SSE 不一致：刷新后会少条'}${descOrder ? '' : ' · score 非降序：引用顺序会乱'}`,
  l7fOk ? 'pass' : 'fail',
);
record(
  'L7e',
  '合成答案带 [n] 角标（信息项，依赖上游给标记）',
  Boolean(answer && answer.cites > 0),
  answer && answer.cites > 0 ? `角标 ${answer.cites} 处` : '上游未给引用标记，按约定不阻塞验收',
  answer && answer.cites > 0 ? 'pass' : 'skip',
);
record('L7d', '全程无 JS 异常', consoleErrors.length === 0, consoleErrors.slice(0, 2).join(' | ') || '0 error');

/* ---------------------------------------------------------------- 收尾 */

const pass = results.filter((r) => r.state === 'pass').length;
const fail = results.filter((r) => r.state === 'fail').length;
const blocked = results.filter((r) => r.state === 'blocked').length;
console.log(`\n[live] 结果：${pass} 通过 · ${fail} 失败 · ${blocked} 缺项`);
console.log(`[live] 网关 ${gateway} · 新建库「${KB_NAME}」 · 文档「${DOC_NAME}」`);
console.log('[live] 请到 A 的 WeKnora 后台确认这两个名字，作为人工复核凭据。');

writeFileSync(
  path.resolve(`docs/evidence/live-${stamp}.json`),
  JSON.stringify({ gateway, kbName: KB_NAME, kbId, docName: DOC_NAME, docId, pass, fail, blocked, results, consoleErrors }, null, 2),
  'utf8',
);

ws.close();
chrome.kill();
rmSync(profileDir, { recursive: true, force: true });
process.exit(fail ? 1 : 0);
