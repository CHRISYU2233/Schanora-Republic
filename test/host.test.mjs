import test from 'node:test';
import assert from 'node:assert/strict';
import {
  safeRead,
  detectModel,
  detectTools,
  detectConversation,
  detectHostCaps,
  describeCaps,
  normalizeChatReply,
  normalizeHostMessages,
  composeEvidencePrompt,
  buildRetrievalToolSpec,
  toToolResult,
} from '../plugins/schanora/client/src/lib/host.js';

/* ------------------------------------------------------------ 探测 */

test('safeRead 吞掉 Proxy 上的读取异常', () => {
  const ctx = new Proxy(
    {},
    {
      get() {
        throw new Error('property is not accessible');
      },
    },
  );
  assert.equal(safeRead(ctx, 'model'), undefined);
  assert.equal(safeRead(null, 'model'), undefined);
});

test('detectModel 认 ctx.model.chat，且保留 this', () => {
  const box = {
    n: 1,
    chat(messages) {
      return { content: `n=${this.n} len=${messages.length}` };
    },
  };
  const cap = detectModel({ model: box });
  assert.equal(cap.via, 'ctx.model.chat');
  assert.equal(cap.chat([1, 2]).content, 'n=1 len=2');
});

test('detectModel 退化到 ctx.llm.complete，全部缺失返回 null', () => {
  assert.equal(detectModel({ llm: { complete: () => 'ok' } }).via, 'ctx.llm.complete');
  assert.equal(detectModel({}), null);
  assert.equal(detectModel(null), null);
  // 有服务但没有 chat 方法：不算具备能力，不能拿空壳当能力
  assert.equal(detectModel({ model: { name: 'x' } }), null);
});

test('detectTools / detectConversation 各自认多种方法名', () => {
  assert.equal(detectTools({ tools: { register() {} } }).via, 'ctx.tools.register');
  assert.equal(detectTools({ tool: { define() {} } }).via, 'ctx.tool.define');
  assert.equal(detectTools({}), null);
  assert.equal(detectConversation({ conversation: { getMessages: () => [] } }).via, 'ctx.conversation.getMessages');
  assert.equal(detectConversation({ chat: { history: () => [] } }).via, 'ctx.chat.history');
  assert.equal(detectConversation({}), null);
});

test('detectHostCaps 汇总三项并给出探测清单', () => {
  const caps = detectHostCaps({ model: { chat() {} }, tools: { register() {} } });
  assert.equal(caps.model.via, 'ctx.model.chat');
  assert.equal(caps.tools.via, 'ctx.tools.register');
  assert.equal(caps.conversation, null);
  assert.ok(caps.probed.includes('model'));
  assert.deepEqual(
    describeCaps(caps).map((c) => `${c.key}:${c.ok}`),
    ['model:true', 'tools:true', 'conversation:false'],
  );
});

/* ------------------------------------------------------------ 返回值归一 */

test('normalizeChatReply 认五种常见形状', () => {
  assert.equal(normalizeChatReply('  hi  '), 'hi');
  assert.equal(normalizeChatReply({ content: ' a ' }), 'a');
  assert.equal(normalizeChatReply({ text: 'b' }), 'b');
  assert.equal(normalizeChatReply({ message: { content: 'c' } }), 'c');
  assert.equal(normalizeChatReply({ choices: [{ message: { content: 'd' } }] }), 'd');
});

test('normalizeChatReply 认不出就抛错，不编内容', () => {
  assert.throws(() => normalizeChatReply(null), /没有返回可读内容/);
  assert.throws(() => normalizeChatReply({ foo: 1 }), /无法识别/);
});

/* ------------------------------------------------------------ 消息归一 */

test('normalizeHostMessages 过滤空正文、补 role、按 4000 字截断', () => {
  const out = normalizeHostMessages({
    messages: [
      { id: 'a', role: 'assistant', content: ' 你好 ' },
      { role: 'weird', content: 'x' },
      { role: 'user', content: '   ' },
      { content: 'y'.repeat(5000) },
    ],
  });
  assert.equal(out.length, 3);
  assert.deepEqual(out[0], { id: 'a', role: 'assistant', content: '你好' });
  assert.equal(out[1].role, 'user'); // 未知 role 按 user
  assert.equal(out[2].content.length, 4000);
  assert.deepEqual(normalizeHostMessages(null), []);
});

/* ------------------------------------------------------------ 提示词 */

test('composeEvidencePrompt 带编号与出处，并按预算截断', () => {
  const messages = composeEvidencePrompt({
    question: '拧紧力矩是多少',
    evidences: [
      { docTitle: 'GB/T 3098.1', content: 'M10 为 49 N·m' },
      { docTitle: '工艺卡', content: '按对角线顺序分两次拧紧' },
    ],
    maxChars: 200,
  });
  assert.equal(messages[0].role, 'system');
  assert.match(messages[1].content, /\[1\] GB\/T 3098\.1：M10 为 49 N·m/);
  assert.match(messages[1].content, /\[2\] 工艺卡：按对角线顺序/);
  assert.match(messages[1].content, /问题：拧紧力矩是多少/);
});

test('composeEvidencePrompt 无证据时明说，不假装有据', () => {
  const messages = composeEvidencePrompt({ question: 'q', evidences: [] });
  assert.match(messages[1].content, /没有检索到相关证据/);
});

test('composeEvidencePrompt 问题为空抛错', () => {
  assert.throws(() => composeEvidencePrompt({ question: '  ', evidences: [] }), /问题为空/);
});

/* ------------------------------------------------------------ 工具 */

test('buildRetrievalToolSpec 要求 handler，并给出参数 schema', () => {
  assert.throws(() => buildRetrievalToolSpec({}), /handler/);
  const spec = buildRetrievalToolSpec({ handler: () => ({}) });
  assert.equal(spec.name, 'schanora_search');
  assert.deepEqual(spec.parameters.required, ['query']);
  assert.ok(spec.parameters.properties.kbIds);
});

test('toToolResult 丢掉空项，count 报真实可用条数，正文夹住长度', () => {
  const res = toToolResult([
    { score: 0.87654, docTitle: 'GB/T 3098.1', chunkIndex: 3, content: 'x'.repeat(2000) },
    null,
    { content: '   ' },
  ]);
  assert.equal(res.count, 1);
  assert.equal(res.items[0].index, 1);
  assert.equal(res.items[0].score, 0.877);
  assert.equal(res.items[0].chunkIndex, 3);
  assert.equal(res.items[0].content.length, 800);
});
