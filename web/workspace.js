(function () {
  'use strict';
  const app = document.getElementById('app');
  const connection = document.getElementById('connection');
  const backup = document.getElementById('backup');
  const weknora = window.__SCHANORA_WEKNORA__;
  window.__SCHANORA_BROWSER__ = true;

  function mountBundle() {
    return new Promise((resolve, reject) => {
      window.__ModuleLoader__ = {
        load(definition) {
          try {
            resolve(definition.factory((name) => {
              if (name === 'react') return window.React;
              throw new Error(`浏览器工作区不提供依赖 ${name}`);
            }));
          } catch (error) {
            reject(error);
          }
        },
      };
      const script = document.createElement('script');
      script.src = weknora ? '/schanora/client.js' : '/plugins/schanora/client/client.js';
      script.onerror = () => reject(new Error('工作区界面加载失败，请刷新页面。'));
      document.head.appendChild(script);
    });
  }

  function createContext() {
    const components = new Map();
    const dictionaries = new Map();
    return {
      components,
      slots: {
        register(meta, component) {
          if (meta.name === 'main') components.set(meta.key, component);
          return () => {
            if (meta.name === 'main') components.delete(meta.key);
          };
        },
        inject(name, callback) {
          if (name !== 'main') return;
          const iterator = callback();
          if (iterator?.[Symbol.iterator]) {
            for (const _ of iterator) {
              // Allow the workbench's main slot to register.
            }
          }
        },
      },
      locale: {
        register(namespace, dictionary) {
          dictionaries.set(namespace, dictionary);
          return () => dictionaries.delete(namespace);
        },
        bind(namespace) {
          return (key, values) => {
            const dictionary = dictionaries.get(namespace);
            const message = dictionary?.zh?.[key] || dictionary?.en?.[key] || key;
            return message.replace(/\{([^}]+)\}/g, (match, name) => values?.[name] ?? match);
          };
        },
      },
      layout: {
        selectPanel() {},
        panelInfo: { getSnapshot: () => ({ activePanelId: 'schanora' }) },
      },
      effect(callback) { return callback(); },
    };
  }

  backup?.addEventListener('click', async () => {
    backup.disabled = true;
    connection.textContent = '正在生成备份';
    try {
      const response = await fetch('/api/v1/local/backup');
      if (!response.ok) {
        const error = await response.json().catch(() => null);
        throw new Error(error?.message || `备份失败（HTTP ${response.status}）`);
      }
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement('a');
      link.href = url;
      link.download = `schanora-backup-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      connection.textContent = '备份已下载';
    } catch (error) {
      connection.textContent = error.message;
    } finally {
      backup.disabled = false;
    }
  });

  function showLogin() {
    const form = document.getElementById('schanora-login').content.firstElementChild.cloneNode(true);
    const username = form.elements.namedItem('username');
    const password = form.elements.namedItem('password');
    const submit = form.querySelector('[type=submit]');
    const toggle = form.querySelector('.login-switch');
    const feedback = form.querySelector('.login-error');
    let register = false;
    toggle.addEventListener('click', () => {
      register = !register;
      username.disabled = !register;
      username.required = register;
      username.parentElement.hidden = !register;
      password.autocomplete = register ? 'new-password' : 'current-password';
      submit.textContent = register ? '注册并登录' : '登录';
      toggle.textContent = register ? '返回登录' : '创建账号';
      form.querySelector('h1').textContent = register ? '创建 Schanora 账号' : '登录 Schanora';
      feedback.hidden = true;
    });
    const auth = async (action, body) => {
      const response = await fetch('/api/v1/auth/' + action, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok || !result?.success) {
        const hint = response.status === 403 ? '此工作区限制注册或登录。' : '';
        throw new Error(hint || (action === 'login' ? '登录失败，请检查邮箱和密码。'
          : '注册失败，请检查用户名、邮箱、密码要求和公开注册设置。'));
      }
      return result;
    };
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      submit.disabled = toggle.disabled = true;
      feedback.hidden = true;
      try {
        const values = Object.fromEntries(new FormData(form));
        const credentials = { email: values.email.trim(), password: values.password };
        if (register) await auth('register', { ...credentials, username: values.username.trim() });
        const session = await auth('login', credentials);
        if (!session.token) throw new Error('登录服务没有返回会话，请重新登录。');
        for (const [name, value] of Object.entries({
          token: session.token, refresh_token: session.refresh_token,
          user: session.user && JSON.stringify(session.user),
          tenant: session.active_tenant && JSON.stringify(session.active_tenant),
          memberships: session.memberships && JSON.stringify(session.memberships),
          selected_tenant_id: session.active_tenant?.id,
          selected_tenant_name: session.active_tenant?.name,
        })) {
          if (value) localStorage.setItem('weknora_' + name, value);
          else localStorage.removeItem('weknora_' + name);
        }
        location.reload();
      } catch (error) {
        feedback.textContent = error.message;
        feedback.hidden = false;
      } finally {
        submit.disabled = toggle.disabled = false;
      }
    });
    connection.textContent = '请登录知识库';
    app.replaceChildren(form);
  }

  async function start() {
    const health = await fetch('/health').then((response) => {
      if (!response.ok) throw new Error('本地内核没有响应，请检查启动窗口。');
      return response.json();
    });
    if (weknora) {
      if (health.status !== 'ok') throw new Error('知识库服务尚未就绪。');
      const me = await fetch('/api/v1/auth/me', { headers: weknora.headers({}) });
      if (me.status === 401) {
        showLogin();
        return;
      }
      if (!me.ok) throw new Error(`登录检查失败（HTTP ${me.status}）`);
      document.querySelectorAll('[data-account-link]').forEach((link) => { link.hidden = false; });
    } else if (health.data?.runtime !== 'web') {
      throw new Error('请打开浏览器版启动命令给出的地址。');
    }
    const api = await mountBundle();
    const context = createContext();
    api.apply(context);
    const Main = context.components.get('schanora');
    if (!Main) throw new Error('工作区启动失败，未找到主面板。');
    const reactRoot = window.ReactDOM.createRoot(app);
    reactRoot.render(window.React.createElement(Main));
    connection.textContent = '知识库已连接';
    if (backup) backup.disabled = false;
  }

  start().catch((error) => {
    connection.textContent = '连接失败';
    const message = document.createElement('p');
    message.className = 'workspace-message';
    message.setAttribute('role', 'alert');
    message.textContent = error.message;
    app.replaceChildren(message);
  });
})();
