(function () {
  'use strict';
  const app = document.getElementById('app');
  const connection = document.getElementById('connection');
  const backup = document.getElementById('backup');
  const weknora = window.__SCHANORA_WEKNORA__;
  const rememberedEmail = 'schanora.account.email';
  const sessionFields = ['token', 'refresh_token', 'user', 'tenant', 'memberships', 'selected_tenant_id', 'selected_tenant_name'];
  const workDomain = /@(?:mail\.schaeffler\.com|schaeffler\.com|vitesco\.com)$/i;
  const themeKey = 'schanora.workspace.theme';
  const darkPreference = matchMedia('(prefers-color-scheme: dark)');
  const theme = () => localStorage.getItem(themeKey) || 'system';
  const applyTheme = () => {
    const dark = theme() === 'dark' || (theme() === 'system' && darkPreference.matches);
    document.documentElement.dataset.schanoraTheme = dark ? 'dark' : 'light';
    document.body.dataset.dsDarkTheme = String(dark);
  };
  if (weknora) {
    applyTheme();
    darkPreference.addEventListener('change', applyTheme);
  }
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
    const email = form.elements.namedItem('email');
    const ticket = form.elements.namedItem('ticket');
    const password = form.elements.namedItem('password');
    const submit = form.querySelector('[type=submit]');
    const toggle = form.querySelector('.login-switch');
    const other = form.querySelector('.login-other');
    const hint = form.querySelector('.login-hint');
    const feedback = form.querySelector('.login-error');
    let register = false;
    const renderEmail = () => {
      const saved = localStorage.getItem(rememberedEmail) || '';
      email.readOnly = !register && !!saved;
      email.value = register ? '' : saved;
      other.hidden = !email.readOnly;
      (email.readOnly ? password : email).focus();
    };
    other.addEventListener('click', () => {
      localStorage.removeItem(rememberedEmail);
      renderEmail();
    });
    toggle.addEventListener('click', () => {
      register = !register;
      ticket.disabled = !register;
      ticket.required = register;
      ticket.parentElement.hidden = !register;
      hint.hidden = !register;
      ticket.value = '';
      password.value = '';
      password.autocomplete = register ? 'new-password' : 'current-password';
      submit.textContent = register ? '注册并登录' : '登录';
      toggle.textContent = register ? '返回登录' : '创建账号';
      form.querySelector('h1').textContent = register ? '创建 Schanora 账号' : '登录 Schanora';
      feedback.hidden = true;
      renderEmail();
    });
    const auth = async (action, body) => {
      const response = await fetch('/api/v1/auth/' + action, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok || !result?.success) {
        const message = result?.error?.message || result?.message || '';
        if (/Schaeffler or Vitesco work email/i.test(message)) throw new Error('请填写舍弗勒或纬湃的工作邮箱。');
        if (/Schanora registration ticket/i.test(message)) throw new Error('注册码无效或已过期。请核对邮箱，或向管理员申请新码。');
        const note = response.status === 403 ? '此工作区限制注册或登录。' : '';
        throw new Error(note || (action === 'login' ? '登录失败，请检查工作邮箱和密码。'
          : '注册失败，请检查邮箱、密码要求和注册设置。'));
      }
      return result;
    };
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      submit.disabled = toggle.disabled = other.disabled = true;
      feedback.hidden = true;
      try {
        const values = Object.fromEntries(new FormData(form));
        const credentials = { email: values.email.trim(), password: values.password };
        if (register) {
          if (!workDomain.test(credentials.email)) {
            throw new Error('请使用 @mail.schaeffler.com、@schaeffler.com 或 @vitesco.com 工作邮箱。');
          }
          await auth('register', { ...credentials, ticket: values.ticket.trim() });
        }
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
        localStorage.setItem(rememberedEmail, session.user?.email || credentials.email);
        location.reload();
      } catch (error) {
        feedback.textContent = error.message;
        feedback.hidden = false;
      } finally {
        submit.disabled = toggle.disabled = other.disabled = false;
      }
    });
    connection.textContent = '请登录知识库';
    app.replaceChildren(form);
    renderEmail();
  }

  async function avatarFromFile(file) {
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024) {
      throw new Error('请使用小于 5 MB 的 PNG、JPEG 或 WebP 图片。');
    }
    const url = URL.createObjectURL(file);
    try {
      const image = new Image();
      image.src = url;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 128;
      const size = Math.min(image.naturalWidth, image.naturalHeight);
      canvas.getContext('2d').drawImage(image, (image.naturalWidth - size) / 2, (image.naturalHeight - size) / 2,
        size, size, 0, 0, 128, 128);
      return canvas.toDataURL('image/webp', 0.85);
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  function showAccount(user) {
    if (!user?.id || !user.email) return;
    const menu = document.getElementById('workspace-account');
    const avatar = menu.querySelector('.account-avatar');
    const upload = menu.querySelector('input[type=file]');
    const uploadButton = menu.querySelector('[data-upload-avatar]');
    const reset = menu.querySelector('[data-reset-avatar]');
    const feedback = menu.querySelector('.account-feedback');
    const key = 'schanora.account.avatar.' + user.id;
    const label = user.username || user.email.split('@')[0];
    menu.querySelector('.account-name').textContent = label;
    menu.querySelector('.account-trigger-name').textContent = label;
    menu.querySelector('.account-email').textContent = user.email;
    localStorage.setItem(rememberedEmail, user.email);
    const render = () => {
      const custom = localStorage.getItem(key);
      reset.hidden = !custom;
      if (custom && /^data:image\/(?:webp|png);base64,/.test(custom)) {
        const image = new Image();
        image.src = custom;
        image.alt = '';
        avatar.replaceChildren(image);
      } else {
        avatar.textContent = Array.from(label)[0]?.toLocaleUpperCase() || '?';
      }
    };
    uploadButton.addEventListener('click', () => upload.click());
    upload.addEventListener('change', async () => {
      const file = upload.files[0];
      upload.value = '';
      if (!file) return;
      feedback.hidden = true;
      uploadButton.disabled = true;
      try {
        localStorage.setItem(key, await avatarFromFile(file));
        render();
      } catch (error) {
        feedback.textContent = error.message;
        feedback.hidden = false;
      } finally {
        uploadButton.disabled = false;
      }
    });
    reset.addEventListener('click', () => { localStorage.removeItem(key); render(); });
    const themes = menu.querySelector('.account-theme select');
    themes.value = theme();
    themes.addEventListener('change', () => {
      localStorage.setItem(themeKey, themes.value);
      applyTheme();
    });
    document.addEventListener('pointerdown', (event) => {
      if (!menu.contains(event.target)) menu.open = false;
    });
    menu.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        menu.open = false;
        menu.querySelector('summary').focus();
      }
    });
    menu.querySelector('[data-sign-out]').addEventListener('click', async (event) => {
      event.currentTarget.disabled = true;
      try {
        await fetch('/api/v1/auth/logout', { method: 'POST', headers: weknora.headers({}), signal: AbortSignal.timeout(5000) });
      } finally {
        for (const name of sessionFields) localStorage.removeItem('weknora_' + name);
        location.reload();
      }
    });
    render();
    const home = menu.parentNode;
    const settings = menu.querySelector('[data-open-settings]');
    window.__SCHANORA_MOUNT_ACCOUNT__ = (host, openSettings) => {
      host.appendChild(menu);
      menu.hidden = false;
      const showSettings = () => { menu.open = false; openSettings(); };
      settings.addEventListener('click', showSettings);
      return () => {
        settings.removeEventListener('click', showSettings);
        menu.hidden = true;
        home.appendChild(menu);
      };
    };
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
      showAccount((await me.json()).data?.user);
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
