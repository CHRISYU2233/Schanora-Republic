window.__ModuleLoader__.load({
  id: '@schanora/weknora-workspace',
  factory: (require) => {
    const { createElement: h, useState } = require('react');
    const id = 'schanora-weknora';
    const settingsKey = 'schanora.weknora.url';
    const defaultUrl = 'http://127.0.0.1:8080';
    const buttonStyle = { borderRadius: 6, padding: '8px 12px', fontWeight: 600 };

    function getOrigin(value) {
      try {
        const url = new URL(value);
        return url.protocol === 'http:' && url.hostname === '127.0.0.1' &&
          !url.username && !url.password && url.pathname === '/' && !url.search && !url.hash
          ? url.origin : '';
      } catch {
        return '';
      }
    }

    function Workspace() {
      const [saved, setSaved] = useState(() => getOrigin(localStorage.getItem(settingsKey)) || defaultUrl);
      const [draft, setDraft] = useState(saved);
      const [status, setStatus] = useState('');
      async function save(event) {
        event.preventDefault();
        const origin = getOrigin(draft.trim());
        if (!origin) {
          setStatus('请输入 http://127.0.0.1:端口。');
          return;
        }
        localStorage.setItem(settingsKey, origin);
        setSaved(origin);
        setStatus('正在检查服务…');
        try {
          const response = await fetch(`${origin}/api/v1/auth/config`, { signal: AbortSignal.timeout(3000) });
          const body = await response.json();
          if (!response.ok || body.success !== true || typeof body.registration_mode !== 'string') throw new Error();
          setStatus('WeKnora 服务可用。');
        } catch {
          setStatus('无法连接 WeKnora。请核对启动日志中的地址。');
        }
      }
      return h('main', { style: { padding: 28, maxWidth: 720, margin: '0 auto' } },
        h('h1', { style: { color: '#00744a', letterSpacing: '0.04em' } }, 'SCHANORA'),
        h('p', null, '打开 Schanora 工作区，使用本机 WeKnora 知识库。'),
        h('p', null, h('a', {
          href: saved + '/schanora/workspace.html', target: '_blank', rel: 'noopener noreferrer',
          style: { ...buttonStyle, background: '#00744a', color: '#fff', display: 'inline-block' },
        }, '打开 Schanora 工作区')),
        h('form', { onSubmit: save },
          h('label', null, '本机服务地址 ', h('input', { value: draft, onChange: (event) => setDraft(event.target.value) })),
          h('button', { type: 'submit', style: buttonStyle }, '保存并检查'),
        ),
        h('p', { role: 'status' }, status),
        h('h2', null, '在当前 DSH 会话引用知识库'),
        h('p', null, '启用官方 WeKnora 工具后，可让 DSH 列出知识库，再指定知识库 ID 使用 weknora_search 检索，或用 weknora_ask 获取带出处的回答。'),
      );
    }

    function apply(ctx) {
      ctx.slots.inject('sidebar.panellist', function* () {
        yield ctx.slots.register(
          { name: 'sidebar.panellist', id, order: 30, label: () => 'Schanora' },
          () => h('span', { 'aria-hidden': true, style: { color: '#00744a', fontWeight: 700 } }, 'S'),
        );
      });
      ctx.slots.inject('main', () =>
        ctx.slots.register({ name: 'main', key: id }, Workspace),
      );
    }
    return { inject: ['slots', 'layout'], apply };
  },
});
