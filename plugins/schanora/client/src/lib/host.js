/**
 * 宿主能力桥 —— DSH 深度对接的「门」。
 *
 * 背景：Schanora 现在只能拿到宿主的 slots / locale / layout / effect 四项能力，
 * 所以问答只能走网关自建会话，答案与 DSH 主对话是两套。理想形态是宿主开放
 * 模型与工具能力，插件复用宿主模型、或把「检索知识库」注册成 DSH 工具。
 *
 * 本模块解决的是「接口什么时候开、插件什么时候能接」这个时序问题：
 *   · 用鸭子类型探测，不假设唯一签名 —— 宿主给 ctx.model.chat / ctx.llm.chat /
 *     ctx.ai.chat 任一形状都能用；工具注册同理（register / define）；
 *   · 探测全程 try/catch：cordis 的 ctx 是 Proxy，读取未声明 inject 的服务在
 *     某些版本会抛错，这里一律吞掉并当成「没有」，绝不让能力探测拖垮面板；
 *   · 拿不到就是 null，调用方退回现状（网关 SSE），不降级成假数据。
 *
 * 所有形状归一与失败判定都写成纯函数，单测在 test/host.test.mjs。
 */

/** 探测的属性名候选：按优先级排，先命中先用。 */
const MODEL_KEYS = ['model', 'llm', 'ai'];
const TOOL_KEYS = ['tools', 'tool'];
const CONV_KEYS = ['conversation', 'chat'];

/** 安全读属性：Proxy 上读取未 inject 的服务可能抛异常，一律视为不存在。 */
export function safeRead(obj, key) {
  if (!obj) return undefined;
  try {
    return obj[key];
  } catch (_e) {
    return undefined;
  }
}

/** 在对象上找第一个可调用的方法，返回绑定后的函数（保留 this）。 */
function pickFn(obj, names) {
  if (!obj) return null;
  for (const name of names) {
    const fn = safeRead(obj, name);
    if (typeof fn === 'function') return { name, call: (...args) => fn.apply(obj, args) };
  }
  return null;
}

/** 模型能力：{ via, chat(messages, opts) } 或 null。 */
export function detectModel(ctx) {
  for (const key of MODEL_KEYS) {
    const box = safeRead(ctx, key);
    if (!box) continue;
    const fn = pickFn(box, ['chat', 'complete', 'generate', 'completeChat']);
    if (fn) {
      return {
        via: `ctx.${key}.${fn.name}`,
        chat: (messages, opts) => fn.call(messages, opts),
      };
    }
  }
  return null;
}

/** 工具注册能力：{ via, register(spec) } 或 null。 */
export function detectTools(ctx) {
  for (const key of TOOL_KEYS) {
    const box = safeRead(ctx, key);
    if (!box) continue;
    const fn = pickFn(box, ['register', 'define', 'add']);
    if (fn) {
      return { via: `ctx.${key}.${fn.name}`, register: (spec) => fn.call(spec) };
    }
  }
  return null;
}

/** 对话读取能力：{ via, getMessages() } 或 null。 */
export function detectConversation(ctx) {
  for (const key of CONV_KEYS) {
    const box = safeRead(ctx, key);
    if (!box) continue;
    const fn = pickFn(box, ['getMessages', 'messages', 'list', 'history']);
    if (fn) {
      return { via: `ctx.${key}.${fn.name}`, getMessages: () => fn.call() };
    }
  }
  return null;
}

/**
 * 一次性探测三项能力。`probed` 记录试过哪些属性，用于设置页的只读诊断
 * ——用户装到 DSH 里点开设置就能看出「宿主给没给」，不必靠猜。
 */
export function detectHostCaps(ctx) {
  return {
    model: detectModel(ctx),
    tools: detectTools(ctx),
    conversation: detectConversation(ctx),
    probed: [...MODEL_KEYS, ...TOOL_KEYS, ...CONV_KEYS],
    at: new Date().toISOString(),
  };
}

/** 能力摘要：给界面用，不暴露函数细节。 */
export function describeCaps(caps) {
  const c = caps || {};
  return [
    { key: 'model', label: '宿主模型', ok: Boolean(c.model), via: (c.model && c.model.via) || '' },
    { key: 'tools', label: '工具注册', ok: Boolean(c.tools), via: (c.tools && c.tools.via) || '' },
    { key: 'conversation', label: '对话读取', ok: Boolean(c.conversation), via: (c.conversation && c.conversation.via) || '' },
  ];
}

/**
 * 归一化模型返回：宿主可能返回字符串、{content}、{text}、{message:{content}}，
 * 或者 OpenAI 形状 {choices:[{message:{content}}]}。认不出就抛错，不编内容。
 */
export function normalizeChatReply(raw) {
  if (typeof raw === 'string') return raw.trim();
  if (!raw || typeof raw !== 'object') throw new Error('宿主模型没有返回可读内容');
  const direct = raw.content ?? raw.text ?? raw.answer;
  if (typeof direct === 'string') return direct.trim();
  if (raw.message && typeof raw.message.content === 'string') return raw.message.content.trim();
  const choice = Array.isArray(raw.choices) ? raw.choices[0] : null;
  if (choice && choice.message && typeof choice.message.content === 'string') return choice.message.content.trim();
  if (typeof raw.delta === 'string') return raw.delta.trim();
  throw new Error('宿主模型返回的结构无法识别（期望字符串 / content / choices[0].message.content）');
}

/**
 * 归一化宿主消息：{id, role, content} 数组。
 * 只保留有正文的项，正文截断到 4000 字（和选区引用同一上限），role 缺失按 user 处理。
 */
export function normalizeHostMessages(raw) {
  const list = Array.isArray(raw) ? raw : raw && Array.isArray(raw.messages) ? raw.messages : [];
  const out = [];
  for (const item of list) {
    if (!item) continue;
    const content = String(item.content ?? item.text ?? '').trim();
    if (!content) continue;
    const role = ['user', 'assistant', 'system'].includes(item.role) ? item.role : 'user';
    out.push({
      id: String(item.id ?? item.messageId ?? `m${out.length}`),
      role,
      content: content.slice(0, 4000),
    });
  }
  return out;
}

/**
 * 把检索证据拼成交给宿主模型的 messages。
 * 为什么要显式编号：答案里出现 [1][2] 才能对回原文，纯文本拼接就丢了出处。
 */
export function composeEvidencePrompt({ question, evidences, maxChars = 6000 }) {
  const q = String(question ?? '').trim();
  if (!q) throw new Error('问题为空');
  const list = (evidences || []).filter((e) => e && String(e.content ?? '').trim());
  let budget = Math.max(0, maxChars - q.length);
  const blocks = [];
  list.forEach((e, i) => {
    const text = String(e.content).trim();
    if (budget <= 0) return;
    const clipped = text.slice(0, Math.min(text.length, budget));
    budget -= clipped.length;
    const where = e.docTitle || e.title || '';
    blocks.push(`[${i + 1}] ${where ? `${where}：` : ''}${clipped}`);
  });
  const evidenceText = blocks.length ? blocks.join('\n\n') : '（没有检索到相关证据）';
  return [
    {
      role: 'system',
      content:
        '你是工程知识助理。只根据给出的证据回答问题，不要编造。' +
        '引用证据时用方括号编号标注，例如 [1]。证据不足时明确说明缺什么。',
    },
    { role: 'user', content: `证据：\n${evidenceText}\n\n问题：${q}` },
  ];
}

/** 「检索知识库」工具描述：给宿主注册用（JSON Schema 参数）。 */
export function buildRetrievalToolSpec({ name = 'schanora_search', handler } = {}) {
  if (typeof handler !== 'function') throw new Error('工具缺少 handler');
  return {
    name,
    description: '在 Schanora 工程知识库中检索文档片段，返回可引用的原文与出处。回答工程标准、工艺、供应商资料类问题时使用。',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '检索问题或关键词' },
        kbIds: { type: 'array', items: { type: 'string' }, description: '限定知识库 id；省略则用当前会话已选库' },
        topK: { type: 'number', description: '返回条数，默认 6' },
      },
      required: ['query'],
    },
    handler,
  };
}

/** 工具结果归一：把网关 /search 结果压成宿主可读的精简结构（带出处）。
 *  空项直接丢掉：count 报「宿主真正能用的条数」，不让 null 混进去把编号带偏。 */
export function toToolResult(hits) {
  const list = (Array.isArray(hits) ? hits : []).filter((h) => h && String(h.content ?? '').trim());
  const items = list.slice(0, 20).map((h, i) => ({
    index: i + 1,
    score: typeof h.score === 'number' ? Math.round(h.score * 1000) / 1000 : null,
    docTitle: h.docTitle || h.title || '',
    chunkIndex: h.chunkIndex ?? h.index ?? null,
    content: String(h.content ?? '').slice(0, 800),
  }));
  return { count: items.length, items };
}
