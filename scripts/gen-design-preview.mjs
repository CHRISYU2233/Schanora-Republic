/**
 * 生成设计目录页：`design/preview.html` 与 `design/preview-dark.html`。
 *
 * 为什么不手写这份 HTML：
 *   色卡和组件必须用**插件同一份 CSS**，否则目录页会慢慢变成"第二套真相"。
 *   所以这里直接从 ui.js 里把 CSS 模板字符串抠出来内联，改了样式重跑一次即可。
 *
 * 用法：node scripts/gen-design-preview.mjs
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const uiPath = path.join(root, 'plugins/schanora/client/src/ui.js');
const outDir = path.join(root, 'design');

const source = await readFile(uiPath, 'utf8');
const cssStart = source.indexOf('const CSS = `') + 13;
const cssEnd = source.indexOf('`;\n\n  let styleInjected');
const pluginCss = source.slice(cssStart, cssEnd);

/** 品牌字标：目录页也要用同一张图，不能手绘 S 冒充。 */
const wordmarkBuf = await readFile(path.join(root, 'plugins/schanora/client/assets/schanora-wordmark-trim.png'));
const wordmarkUri = `data:image/png;base64,${wordmarkBuf.toString('base64')}`;

/** 从某段选择器块里抽出 `--sch-x: value;` */
function parseTokens(text, selector) {
  const at = text.indexOf(selector);
  if (at < 0) return new Map();
  const open = text.indexOf('{', at);
  const close = text.indexOf('}', open);
  const body = text.slice(open + 1, close);
  const map = new Map();
  for (const m of body.matchAll(/(--sch-[\w-]+)\s*:\s*([^;]+);/g)) map.set(m[1], m[2].trim());
  return map;
}

const light = parseTokens(pluginCss, '.sch-tokens{');
const dark = parseTokens(pluginCss, "body[data-ds-dark-theme]:not([data-ds-dark-theme='false']) .sch-tokens{");

/** 取一个 token 的"可直接写在色卡上"的值：优先 hex，其次 rgba，最后原始的 var() 兜底值 */
function swatchValue(darkMode, key) {
  const raw = (darkMode && dark.get(key)) || light.get(key) || '';
  if (/^#[0-9a-fA-F]{3,8}$/.test(raw)) return raw.toUpperCase();
  const hex = raw.match(/#[0-9a-fA-F]{3,8}\b/);
  if (hex) return hex[0].toUpperCase();
  const rgba = raw.match(/rgba?\([^)]*\)/);
  if (rgba) return rgba[0].replace(/\s+/g, '');
  return raw.replace(/\s+/g, ' ');
}

const GROUPS = [
  { title: '面 Surface', hint: '由底到顶：canvas → surface-1 → surface-2', keys: ['--sch-bg', '--sch-layer', '--sch-layer-2', '--sch-plate'] },
  { title: '文字 Ink', hint: '三级足够，别再拆第四级', keys: ['--sch-text', '--sch-text-2', '--sch-text-3'] },
  { title: '品牌 Brand', hint: '只出现在可点/已选中的地方', keys: ['--sch-green', '--sch-green-2', '--sch-brand-green', '--sch-green-tint', '--sch-on-green'] },
  { title: '语义 Semantic', hint: '状态点、提示条、失败原因', keys: ['--sch-ok', '--sch-warn', '--sch-warn-bg', '--sch-err', '--sch-err-bg'] },
  { title: '结构 Structure', hint: '描边、遮罩、焦点环、微交互高光、阴影', keys: ['--sch-border', '--sch-border-soft', '--sch-hover', '--sch-scrim', '--sch-focus-ring', '--sch-gloss', '--sch-shadow-1', '--sch-shadow-2', '--sch-shadow-3'] },
];

const TYPE = [
  { name: 'display', size: '21px', weight: 700, lh: 1.35, ls: '-0.022em', text: '知识库', use: '页面标题' },
  { name: 'title', size: '14px', weight: 700, lh: 1.35, ls: '-0.01em', text: '供应商试验报告 2026Q3', use: '卡片标题' },
  { name: 'subhead', size: '13px', weight: 700, lh: 1.4, ls: '-0.005em', text: '分块列表', use: '区块标题' },
  { name: 'body', size: '12px', weight: 400, lh: 1.6, ls: '0', text: '根据 GB/T 3452.1 第 2 块的原文，能确认的是：密封件安装前需检查沟槽清洁度。', use: '正文' },
  { name: 'control', size: '11px', weight: 600, lh: 1.4, ls: '0', text: '重新上传 · 下一页 · 详情', use: '按钮与表格头' },
  { name: 'eyebrow', size: '10px', weight: 700, lh: 1.3, ls: '0.11em', text: '工作区 / 规划中', use: '分组标签' },
  { name: 'badge', size: '10.5px', weight: 600, lh: 1, ls: '0.02em', text: '演示数据', use: '状态徽标' },
];

const RADII = [
  { v: '4px', use: '徽标 / 序号块 / 内联代码' },
  { v: '6px', use: '会话项 / 引用块' },
  { v: '8px', use: '卡片 / 输入框 / 表格' },
  { v: '12px', use: '气泡 / 弹层 / 抽屉' },
  { v: '999px', use: '按钮 / 分段导航 / chip' },
  { v: '50%', use: '图标按钮 / 状态点' },
];

const SPACING = [2, 4, 6, 8, 10, 12, 16, 20];

const swatch = (darkMode, key) => {
  const value = swatchValue(darkMode, key);
  const isShadow = key.includes('shadow');
  return `<figure class="card sw">
    <div class="chip" style="background:${isShadow ? 'var(--sch-surface-demo, var(--sch-layer))' : `var(${key})`};${isShadow ? `box-shadow:var(${key})` : ''}"></div>
    <figcaption><code>${key.replace('--sch-', '')}</code><span>${value}</span></figcaption>
  </figure>`;
};

function page(darkMode) {
  const body = `
<header class="top">
  <div class="brandbar"><img class="wordmark" src="${wordmarkUri}" alt="SCHANORA"></div>
  <div class="intro">
    <p class="eyebrow">DESIGN.md · preview ${darkMode ? 'dark' : 'light'}</p>
    <h1>设计目录</h1>
    <p class="lead">这一页不是产品界面，是 token 与组件态的验收台。样式直接取自
      <code>plugins/schanora/client/src/ui.js</code>，改了那边重跑 <code>npm run design</code> 即可。</p>
    <p class="note">另一主题：<a href="${darkMode ? 'preview.html' : 'preview-dark.html'}">${darkMode ? 'preview.html（浅色）' : 'preview-dark.html（深色）'}</a></p>
  </div>
</header>

<section>
  <h2>1 · 色板与角色</h2>
  <p class="hint">色卡底色直接引用 <code>var(--sch-*)</code>，所以深浅两页看到的就是各自主题下的真实取值。</p>
  ${GROUPS.map(
    (g) => `<h3>${g.title}<span class="hint">${g.hint}</span></h3>
  <div class="grid">${g.keys.map((k) => swatch(darkMode, k)).join('')}</div>`,
  ).join('')}
</section>

<section>
  <h2>2 · 字阶（9 档）</h2>
  <table class="type">
    <thead><tr><th>档位</th><th>样例</th><th>字号 / 字重 / 行高 / 字距</th><th>用在哪</th></tr></thead>
    <tbody>
      ${TYPE.map(
        (t) => `<tr>
        <td><code>${t.name}</code></td>
        <td><span style="font-size:${t.size};font-weight:${t.weight};line-height:${t.lh};letter-spacing:${t.ls}">${t.text}</span></td>
        <td class="mono">${t.size} · ${t.weight} · ${t.lh} · ${t.ls}</td>
        <td class="dim">${t.use}</td>
      </tr>`,
      ).join('')}
    </tbody>
  </table>
</section>

<section>
  <h2>3 · 形状</h2>
  <div class="grid radii">
    ${RADII.map(
      (r) => `<figure class="card sw">
      <div class="shape" style="border-radius:${r.v}"></div>
      <figcaption><code>${r.v}</code><span>${r.use}</span></figcaption>
    </figure>`,
    ).join('')}
  </div>
</section>

<section>
  <h2>4 · 间距</h2>
  <div class="scale">
    ${SPACING.map((n) => `<div class="scale-row"><code>${n}px</code><i style="width:${n * 6}px"></i></div>`).join('')}
  </div>
</section>

<section>
  <h2>5 · 组件与状态</h2>

  <h3>按钮<span class="hint">胶囊只给可点的东西；主按钮只有绿底一种</span></h3>
  <div class="row">
    <button class="sch-btn primary">新建知识库</button>
    <button class="sch-btn">重新上传</button>
    <button class="sch-btn sm">详情</button>
    <button class="sch-btn icon" aria-label="刷新">⟳</button>
    <button class="sch-btn" disabled>禁用态</button>
  </div>

  <h3>徽标<span class="hint">4px 圆角，不是胶囊，没有 hover</span></h3>
  <div class="row">
    <span class="sch-badge live">网关实时</span>
    <span class="sch-badge plain">演示数据</span>
    <span class="sch-badge warn">1 个文档处理失败</span>
    <span class="sch-badge err">502</span>
  </div>

  <h3>范围 chip</h3>
  <div class="row">
    <button class="sch-scopechip on">全部知识库</button>
    <button class="sch-scopechip">工程标准库</button>
    <button class="sch-scopechip">项目 P-2026 资料库</button>
  </div>

  <h3>输入<span class="hint">inset 描边环，聚焦不跳</span></h3>
  <div class="stack">
    <input class="sch-input" placeholder="搜索知识库…" />
    <textarea class="sch-ta" rows="2" placeholder="输入问题，Enter 发送，Shift+Enter 换行"></textarea>
  </div>

  <h3>知识库卡片</h3>
  <div class="cardwrap">
    <button class="sch-kbcard">
      <span class="sch-kbcard-top">
        <span class="sch-kbcard-tile">知</span>
        <span class="sch-kbcard-head">
          <span class="sch-kbcard-name">工程标准库</span>
          <span class="sch-kbcard-kind">文档库</span>
        </span>
      </span>
      <span class="sch-kbcard-desc">企业标准、国标与供应商规范（GB/T、Q/SC 系列）</span>
      <span class="sch-kbcard-foot">
        <span class="sch-kbcard-stat">3 文档 · 128 分块</span>
        <span class="sch-kbcard-time sch-mono">11-13 12:44</span>
      </span>
    </button>
  </div>

  <h3>表格行<span class="hint">主列两行，数字列右对齐、等宽；行内操作与表头同向</span></h3>
  <div class="tablewrap">
    <div class="sch-table">
      <div class="sch-dtr head">
        <div>文档</div><div>处理状态</div><div class="col-size">大小</div><div class="col-time">接收时间</div><div>操作</div>
      </div>
      <div class="sch-dtr body">
        <div><div class="sch-kb-name">供应商试验报告 2026Q3</div><div class="sch-kb-desc">供应商试验报告_2026Q3.pdf</div></div>
        <div class="sch-status"><span class="sch-dot ok"></span><span>已完成</span></div>
        <div class="col-size sch-mono">5.2 MB</div>
        <div class="col-time sch-mono">11-13 12:44</div>
        <div style="display:flex;justify-content:flex-end"><button class="sch-btn sm">详情</button></div>
      </div>
      <div class="sch-dtr body">
        <div><div class="sch-kb-name">装配工艺卡 P-2026-018</div><div class="sch-kb-desc">装配工艺卡P-2026-018.docx</div></div>
        <div class="sch-status"><span class="sch-dot err"></span><span>处理失败</span></div>
        <div class="col-size sch-mono">860 KB</div>
        <div class="col-time sch-mono">11-13 13:36</div>
        <div style="display:flex;justify-content:flex-end"><button class="sch-btn sm">详情</button></div>
      </div>
    </div>
  </div>

  <h3>气泡与引用</h3>
  <div class="chatdemo">
    <div class="sch-msg user"><div class="sch-msg-who">你</div>
      <div class="sch-bubble">密封件安装前要检查什么？</div></div>
    <div class="sch-msg assistant"><div class="sch-msg-who">SCHANORA</div>
      <div class="sch-bubble">
        <p>根据 GB/T 3452.1 第 2 块的原文，需要确认沟槽清洁度、无毛刺，并核对 O 形圈的硬度与压缩量。</p>
        <div class="sch-refs-head">2 处引用</div>
        <button class="sch-ref-btn"><span class="sch-ref-idx">1</span>GB/T 3452.1 液压气动用 O 形橡胶密封圈<span class="dim">第 2 块</span></button>
        <button class="sch-ref-btn"><span class="sch-ref-idx">2</span>项目周报 2026W45<span class="dim">第 3 块</span></button>
      </div></div>
  </div>

  <h3>提示条 / 空状态 / 骨架</h3>
  <div class="stack">
    <div class="sch-toast"><span class="sch-dot ok"></span>已创建「密封件标准库」</div>
    <div class="sch-toast err"><span class="sch-dot err"></span>1 个文档处理失败</div>
    <div class="sch-empty"><div class="sch-empty-title">还没有文档</div><div class="sch-empty-desc">把文件拖到上方区域，或点「选择文件」。</div></div>
    <div><div class="sch-skel" style="height:12px;width:60%"></div><div class="sch-skel" style="height:12px;width:80%;margin-top:8px"></div></div>
  </div>

  <h3>顶栏与分段导航<span class="hint">52px，横向排列；模块多了就横向滚动，不再长出第二条侧栏</span></h3>
  <div class="topdemo">
    <span class="sch-top-brand"><img class="sch-top-glyph" src="${wordmarkUri}" alt="SCHANORA"></span>
    <div class="sch-tabs">
      <button class="sch-tab on">知识库</button>
      <button class="sch-tab">文档</button>
      <button class="sch-tab">检索</button>
      <button class="sch-tab">工程问答</button>
      <span class="sch-tabsep"></span>
      <button class="sch-tab">Wiki</button>
    </div>
  </div>
</section>

<section>
  <h2>6 · Do / Don't</h2>
  <div class="grid two">
    <div class="do"><h3>Do</h3><ul>
      <li>改色先改 <code>.sch-tokens</code>，再同步 DESIGN.md</li>
      <li>层级用 <code>canvas → surface-1 → surface-2</code></li>
      <li>标题 700、正文 400，强调用 600</li>
      <li>绿色只给可点/已选中</li>
    </ul></div>
    <div class="dont"><h3>Don't</h3><ul>
      <li>不要给卡片加 1px 灰描边</li>
      <li>不要把徽标做成胶囊</li>
      <li>不要用实线 border 做输入框</li>
      <li>不要新增 500/650 字重、3/10px 圆角</li>
    </ul></div>
  </div>
</section>
`;

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Schanora 设计目录 · ${darkMode ? 'dark' : 'light'}</title>
<style>
${pluginCss}
/* ---- 以下只是目录页自己的排版，不属于设计系统 ---- */
html,body{margin:0}
.sch-tokens{min-height:100vh;padding:0 0 64px;background:var(--sch-bg);color:var(--sch-text);
  font-family:var(--ds-font-family-body,-apple-system,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif)}
.top{display:flex;align-items:stretch;gap:0;border-bottom:1px solid var(--sch-border-soft)}
.brandbar{width:200px;flex:none;display:flex;align-items:center;padding:0 20px;background:var(--sch-brand-green)}
.wordmark{display:block;height:22px;width:auto}
.intro{padding:20px 24px}
.intro h1{margin:2px 0 6px;font-size:21px;font-weight:700;letter-spacing:-.022em}
.lead{margin:0;font-size:12px;color:var(--sch-text-2);max-width:70ch;line-height:1.6}
.note{margin:8px 0 0;font-size:11px;color:var(--sch-text-3)}
.note a{color:var(--sch-green-2);font-weight:600;text-decoration:none}
.note a:hover{text-decoration:underline;text-underline-offset:3px}
section{padding:24px;border-bottom:1px solid var(--sch-border-soft)}
section:last-child{border-bottom:0}
h2{margin:0 0 4px;font-size:14px;font-weight:700}
h3{margin:20px 0 8px;font-size:13px;font-weight:700;display:flex;align-items:baseline;gap:10px;flex-wrap:wrap}
.hint{font-size:11px;font-weight:400;color:var(--sch-text-3)}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(168px,1fr));gap:10px;margin-top:8px}
.grid.two{grid-template-columns:repeat(auto-fit,minmax(320px,1fr));align-items:start}
.tablewrap{margin-top:8px}
.topdemo{display:grid;grid-template-columns:minmax(0,1fr) auto minmax(0,1fr);align-items:center;gap:12px;
  height:52px;padding:0 14px 0 12px;margin-top:8px;
  border-bottom:1px solid var(--sch-border-soft);background:var(--sch-bg)}
.topdemo .sch-tabs{justify-self:center}
.topdemo::after{content:'工具区';justify-self:end;font-size:11px;color:var(--sch-text-3)}
.cardwrap{max-width:360px;margin-top:8px}
.tablewrap .sch-dtr{grid-template-columns:minmax(0,1fr) 120px 90px 130px 88px}
.card{margin:0;border-radius:8px;background:var(--sch-layer);padding:10px}
.sw .chip{height:44px;border-radius:6px;box-shadow:inset 0 0 0 1px var(--sch-border)}
.sw figcaption{display:flex;flex-direction:column;gap:2px;margin-top:8px}
.sw code{font-size:11px;font-weight:600;font-family:var(--sch-mono)}
.sw span{font-size:10.5px;color:var(--sch-text-3);font-family:var(--sch-mono)}
.shape{height:44px;background:var(--sch-green-tint);box-shadow:inset 0 0 0 1px var(--sch-border-soft)}
.row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.stack{display:flex;flex-direction:column;gap:10px;max-width:720px}
.stack.narrow{max-width:220px;gap:4px}
.stack .sch-input,.stack .sch-ta{width:100%}
table.type{width:100%;border-collapse:collapse;margin-top:8px;table-layout:fixed}
table.type th:nth-child(1),table.type td:nth-child(1){width:92px}
table.type th:nth-child(3),table.type td:nth-child(3){width:210px}
table.type th:nth-child(4),table.type td:nth-child(4){width:130px}
table.type td{overflow-wrap:anywhere}
table.type th{text-align:left;font-size:11px;font-weight:600;color:var(--sch-text-3);padding:6px 10px;border-bottom:1px solid var(--sch-border-soft)}
table.type td{padding:9px 10px;border-bottom:1px solid var(--sch-border-soft);vertical-align:middle}
table.type code{font-size:11px;font-family:var(--sch-mono);color:var(--sch-text-2)}
.mono{font-family:var(--sch-mono);font-size:11px;color:var(--sch-text-2)}
.dim{font-size:11px;color:var(--sch-text-2)}
.scale{display:flex;flex-direction:column;gap:6px;margin-top:8px}
.scale-row{display:flex;align-items:center;gap:10px}
.scale-row code{font-size:11px;font-family:var(--sch-mono);color:var(--sch-text-3);width:40px}
.scale-row i{display:block;height:10px;border-radius:4px;background:var(--sch-green-tint);box-shadow:inset 0 0 0 1px var(--sch-border-soft)}
.chatdemo{max-width:720px;background:var(--sch-bg)}
.chatdemo .sch-msg{margin:10px 0}
.chatdemo .sch-bubble p{margin:0 0 8px;line-height:1.65}
.do,.dont{border-radius:8px;background:var(--sch-layer);padding:12px 14px}
.do h3,.dont h3{margin:0 0 6px}
.do ul,.dont ul{margin:0;padding-left:18px;font-size:12px;line-height:1.75;color:var(--sch-text-2)}
.do{border-left:3px solid var(--sch-ok)}
.dont{border-left:3px solid var(--sch-err)}
</style>
</head>
<body${darkMode ? ' data-ds-dark-theme="true"' : ''}>
<div class="sch-tokens">
${body}
</div>
</body>
</html>`;
}

await mkdir(outDir, { recursive: true });
await writeFile(path.join(outDir, 'preview.html'), page(false), 'utf8');
await writeFile(path.join(outDir, 'preview-dark.html'), page(true), 'utf8');

const bytes = (await readFile(path.join(outDir, 'preview.html'))).length;
console.log(`[design] design/preview.html + preview-dark.html · ${Math.round(bytes / 1024)}KB · 取自 ${light.size} 个浅色 token / ${dark.size} 个深色覆盖`);
