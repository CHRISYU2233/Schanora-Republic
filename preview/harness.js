/**
 * 预览外壳（harness）——不是产品代码，是「把真 bundle 放进一个假 DSH」的评审台。
 *
 * 它做三件事：
 *   1. 提供最小可用的 `window.__ModuleLoader__`，加载真实的 `plugins/schanora/client/client.js`
 *   2. 提供最小 ctx（slots / locale / layout / effect），让插件的 `apply(ctx)` 跑起来
 *   3. 按 DSH 的骨架渲染：左侧图标栏 + 顶部 Session 头 + 主面板
 *
 * 它不实现：真实 Session 身份、Host Remote、真实网关鉴权。
 * 所以它能证明「界面和状态机」，不能证明「M0 联调通过」。
 */

(function () {
  const React = window.React;
  const ReactDOM = window.ReactDOM;
  const h = React.createElement;

  // 两种本地打开方式都要能跑：以仓库根为服务根（/preview/index.html）或以 preview/ 为根。
  const BUNDLE_CANDIDATES = ['../plugins/schanora/client/client.js', '/plugins/schanora/client/client.js'];

  /* ------------------------------------------------------------ 小 store */

  function createStore(initial) {
    let state = initial;
    const subs = new Set();
    return {
      get: () => state,
      set: (patch) => {
        state = { ...state, ...patch };
        subs.forEach((fn) => fn(state));
      },
      subscribe: (fn) => {
        subs.add(fn);
        return () => subs.delete(fn);
      },
    };
  }

  function useStore(store) {
    const [state, setState] = React.useState(store.get());
    React.useEffect(() => {
      setState(store.get());
      return store.subscribe(setState);
    }, [store]);
    return state;
  }

  const ui = createStore({ active: 'schanora', session: 'A', lang: 'zh', dark: false, width: 'wide', reviewOpen: false });

  // 给截图脚本/人工复核用的钩子：切语言、主题、窄窗，不必去点浮层里的按钮
  window.__HARNESS_UI__ = ui;
  window.__SCHANORA_DEV_PREVIEW__ = !new URLSearchParams(window.location.search).has('installed');

  /* -------------------------------------------------------- 加载真 bundle */

  function loadBundle() {
    return new Promise((resolve, reject) => {
      window.__ModuleLoader__ = {
        load(def) {
          try {
            const api = def.factory((name) => {
              if (name === 'react') return React;
              throw new Error(`harness 未提供模块：${name}`);
            });
            resolve(api);
          } catch (error) {
            reject(error);
          }
        },
      };

      const tryNext = (index) => {
        if (index >= BUNDLE_CANDIDATES.length) {
          reject(new Error(`bundle 加载失败，尝试过：${BUNDLE_CANDIDATES.join(' / ')}`));
          return;
        }
        const script = document.createElement('script');
        script.src = BUNDLE_CANDIDATES[index];
        script.onerror = () => tryNext(index + 1);
        document.body.appendChild(script);
      };
      tryNext(0);
    });
  }

  /* ------------------------------------------------------------- ctx 桩 */

  const slotRegistry = new Map(); // slotName -> [{ id, Comp, meta }]
  const dictionaries = {};

  function addRegistration(meta, Comp) {
    if (!meta || !meta.name) throw new Error('slot 注册缺少 name');
    const list = slotRegistry.get(meta.name) || [];
    list.push({ id: meta.id || meta.key, meta, Comp });
    slotRegistry.set(meta.name, list);
    return () => {
      const current = slotRegistry.get(meta.name) || [];
      slotRegistry.set(meta.name, current.filter((x) => x.Comp !== Comp));
    };
  }

  /**
   * 宿主能力桩（可选）：默认不装，插件看到的就是「宿主没给」——
   * 和真 DSH 现状一致。用 ?hostcaps=model,tools,conversation 打开，
   * 用来验证「宿主一旦开放，插件会变成什么样」，不用等 DSH 发版。
   */
  const hostCapsParam = (new URLSearchParams(location.search).get('hostcaps') || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  function stubModel() {
    return {
      // 故意做成异步 + 带编号引用，验证 composeEvidencePrompt → normalizeChatReply 全链路
      async chat(messages) {
        const last = (messages || []).filter((m) => m.role === 'user').pop();
        const body = (last && last.content) || '';
        const firstEv = (body.split('\n').find((line) => /^\[1\]/.test(line)) || '').replace(/^\[1\]\s*/, '').slice(0, 60);
        return {
          content:
            `（宿主模型桩）根据证据 [1]，${firstEv || '证据不足'}\n\n` +
            '这是预览台注入的假模型返回：真 DSH 里替换为 ctx.model.chat 的真实回答。',
        };
      },
    };
  }

  function stubTools() {
    return {
      register(spec) {
        window.__HARNESS_TOOL__ = spec; // 测试脚本可读：确认插件真的把工具交上来了
        return () => {
          window.__HARNESS_TOOL__ = null;
        };
      },
    };
  }

  function stubConversation() {
    return {
      getMessages() {
        return [
          { id: 'h1', role: 'user', content: 'M10 螺栓的拧紧力矩是多少？' },
          { id: 'h2', role: 'assistant', content: '按 GB/T 3098.1，M10 8.8 级为 49 N·m。' },
        ];
      },
    };
  }

  function makeCtx() {
    return {
      ...(hostCapsParam.includes('model') ? { model: stubModel() } : {}),
      ...(hostCapsParam.includes('tools') ? { tools: stubTools() } : {}),
      ...(hostCapsParam.includes('conversation') ? { conversation: stubConversation() } : {}),
      slots: {
        register: addRegistration,
        inject(name, callback) {
          const out = callback();
          if (out && typeof out.next === 'function') {
            // 插件用的是 generator 形式：迭代即执行 yield 里的注册
            let step = out.next();
            while (!step.done) step = out.next();
          }
          return () => {};
        },
      },
      locale: {
        register(ns, dict) {
          dictionaries[ns] = dict;
          return () => delete dictionaries[ns];
        },
        bind(ns) {
          return (key, vars) => {
            const lang = ui.get().lang;
            const dict = dictionaries[ns] || {};
            let value = (dict[lang] && dict[lang][key]) || (dict.zh && dict.zh[key]) || key;
            if (vars) for (const k of Object.keys(vars)) value = value.replace(`{${k}}`, String(vars[k]));
            return value;
          };
        },
      },
      layout: {
        selectPanel(id) {
          if (id !== null && !(slotRegistry.get('main') || []).some((x) => x.id === id)) {
            throw new Error(`未注册的面板：${id}`);
          }
          ui.set({ active: id });
        },
        panelInfo: { getSnapshot: () => ({ activePanelId: ui.get().active }) },
        toggleSidebar() {},
        openRightbar() {},
        closeRightbar() {},
      },
      effect(fn) {
        return fn();
      },
    };
  }

  function readScopeCount(sessionId) {
    try {
      const raw = window.localStorage.getItem('schanora.scope.v1.' + sessionId);
      const list = raw ? JSON.parse(raw) : [];
      return Array.isArray(list) ? list.length : 0;
    } catch (_e) {
      return 0;
    }
  }

  function entries(name) {
    return slotRegistry.get(name) || [];
  }

  /* ------------------------------------------------------------- 外壳 UI */

  const T = {
    zh: {
      review: '本地预览',
      reviewNote: '真实 bundle + 假宿主。数据默认演示态，可在面板右上角「连接设置」切到网关实时。',
      sessionA: '会话 A',
      sessionB: '会话 B',
      conversation: '新会话',
      chatTitle: '问点什么，或者先选一个知识库',
      chatHint: '顶部右侧的「知识库」控件是当前会话的范围：A 和 B 各自独立选库，互不影响。模块 1 才会写入后端，现在只存在本地。',
      scopeLine: '当前会话 {sid} · 已选 {n} 个知识库',
      composer: '给工程助理发消息…',
      lang: '语言',
      theme: '主题',
      light: '浅色',
      dark: '深色',
      width: '窗口',
      wide: '宽',
      narrow: '窄',
      reset: '重置本地状态',
      back: '返回对话',
      panelMissing: '面板没有注册成功',
    },
    en: {
      review: 'Local preview',
      reviewNote: 'Real bundle + stub host. Demo data by default; switch to gateway live in Connection settings.',
      sessionA: 'Session A',
      sessionB: 'Session B',
      conversation: 'New session',
      chatTitle: 'Ask something, or pick a knowledge base first',
      chatHint: 'The knowledge-base control in the header belongs to the current session; A and B keep separate scopes.',
      scopeLine: 'Session {sid} · {n} knowledge base(s) selected',
      composer: 'Message the engineering assistant…',
      lang: 'Language',
      theme: 'Theme',
      light: 'Light',
      dark: 'Dark',
      width: 'Width',
      wide: 'Wide',
      narrow: 'Narrow',
      reset: 'Reset local state',
      back: 'Back to chat',
      panelMissing: 'The panel did not register',
    },
  };

  class Boundary extends React.Component {
    constructor(props) {
      super(props);
      this.state = { error: null };
    }
    static getDerivedStateFromError(error) {
      return { error };
    }
    componentDidCatch(error) {
      console.error('[harness]', error);
    }
    render() {
      if (this.state.error) {
        return h(
          'div',
          { className: 'error-box' },
          h('strong', null, '界面渲染失败（这是真问题，请贴给开发者）'),
          '\n',
          String(this.state.error && this.state.error.stack ? this.state.error.stack : this.state.error),
        );
      }
      return this.props.children;
    }
  }

  function App() {
    const state = useStore(ui);
    const t = (key) => (T[state.lang] && T[state.lang][key]) || key;
    const text = (key, vars) => {
      let value = t(key);
      if (vars) for (const k of Object.keys(vars)) value = value.replace(`{${k}}`, String(vars[k]));
      return value;
    };
    const sessionId = state.session === 'A' ? 'sess-a-7f3c2a11' : 'sess-b-91d40e02';

    React.useEffect(() => {
      document.body.setAttribute('data-ds-dark-theme', String(state.dark));
    }, [state.dark]);

    const panels = entries('sidebar.panellist');
    const utilities = entries('conversation.session.header.utilities');
    const mains = entries('main');
    const activeMain = state.active ? mains.find((x) => x.id === state.active) : null;

    return h(
      'div',
      { className: 'shell' },
      // 评审控件默认收起：它属于预览台，不属于产品界面
      h(
        'button',
        {
          type: 'button',
          className: 'review-toggle' + (state.reviewOpen ? ' on' : ''),
          onClick: () => ui.set({ reviewOpen: !state.reviewOpen }),
          title: t('review'),
        },
        t('review'),
      ),
      h(
        'div',
        { className: 'main' },
        state.reviewOpen
          ? h(
          'div',
          { className: 'review' },
          h('strong', null, t('review')),
          h('span', null, t('reviewNote')),
          h('div', { className: 'sep' }),
          h(
            'button',
            {
              type: 'button',
              className: state.lang === 'zh' ? 'on' : '',
              onClick: () => ui.set({ lang: 'zh' }),
            },
            '中文',
          ),
          h(
            'button',
            {
              type: 'button',
              className: state.lang === 'en' ? 'on' : '',
              onClick: () => ui.set({ lang: 'en' }),
            },
            'EN',
          ),
          h('div', { className: 'sep' }),
          h(
            'button',
            {
              type: 'button',
              className: !state.dark ? 'on' : '',
              onClick: () => ui.set({ dark: false }),
            },
            t('light'),
          ),
          h(
            'button',
            {
              type: 'button',
              className: state.dark ? 'on' : '',
              onClick: () => ui.set({ dark: true }),
            },
            t('dark'),
          ),
          h('div', { className: 'sep' }),
          h(
            'button',
            {
              type: 'button',
              className: state.width === 'wide' ? 'on' : '',
              onClick: () => ui.set({ width: 'wide' }),
            },
            t('wide'),
          ),
          h(
            'button',
            {
              type: 'button',
              className: state.width === 'narrow' ? 'on' : '',
              onClick: () => ui.set({ width: 'narrow' }),
            },
            t('narrow'),
          ),
          h('div', { className: 'sep' }),
          // 会话切换是预览台能力（E2E 走 __HARNESS_UI__.set，与这里同源），不放顶栏占用产品视觉
          h(
            'button',
            {
              type: 'button',
              className: state.session === 'A' ? 'on' : '',
              onClick: () => ui.set({ session: 'A' }),
            },
            t('sessionA'),
          ),
          h(
            'button',
            {
              type: 'button',
              className: state.session === 'B' ? 'on' : '',
              onClick: () => ui.set({ session: 'B' }),
            },
            t('sessionB'),
          ),
          h('div', { className: 'sep' }),
          h(
            'button',
            {
              type: 'button',
              onClick: () => {
                Object.keys(window.localStorage)
                  .filter((k) => k.startsWith('schanora.'))
                  .forEach((k) => window.localStorage.removeItem(k));
                window.location.reload();
              },
            },
            t('reset'),
          ),
        )
          : null,
        h(
          'div',
          { className: 'topbar' },
          h(
            'div',
            { className: 'tabs' },
            h(
              'span',
              { className: 'title' },
              state.active ? '' : t('conversation'),
            ),
          ),
          // 面板显隐是宿主行为：预览台固定展示插件面板，
          // 需要验「无面板态」时用 __HARNESS_UI__.set({ active: null }) 程序化切换，
          // 不在顶栏放一个只有人点、脚本不用的按钮。
          h('div', { className: 'topbar-spacer' }),
          h(
            'div',
            { className: 'utilities' },
            ...utilities.map((entry) =>
              h(
                entry.Comp,
                { key: entry.id, sessionId },
              ),
            ),
          ),
        ),
        h(
          'div',
          { className: 'stage', style: state.width === 'narrow' ? { maxWidth: 760, margin: '0 auto', width: '100%' } : null },
          activeMain
            ? h('div', { className: 'panel-host' }, h(activeMain.Comp, {}))
            : h(
                'div',
                { className: 'fake-chat' },
                h('h1', null, t('chatTitle')),
                h('p', null, t('chatHint')),
                h('p', { className: 'scope-line' }, text('scopeLine', { sid: sessionId, n: readScopeCount(sessionId) })),
                h('div', { className: 'fake-composer' }, t('composer')),
              ),
        ),
      ),
    );
  }

  /* ------------------------------------------------------------- 启动 */

  loadBundle()
    .then((api) => {
      if (!api || typeof api.apply !== 'function') throw new Error('bundle 没有导出 apply');
      api.apply(makeCtx());
      const root = ReactDOM.createRoot(document.getElementById('app'));
      root.render(h(Boundary, null, h(App, null)));
    })
    .catch((error) => {
      document.getElementById('app').innerHTML =
        '<div class="error-box"><strong>启动失败</strong>\n' +
        String(error && error.stack ? error.stack : error) +
        '</div>';
    });
})();
