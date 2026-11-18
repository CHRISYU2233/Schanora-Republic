(function () {
  'use strict';
  const app = document.getElementById('app');
  const connection = document.getElementById('connection');
  const backup = document.getElementById('backup');
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
      script.src = '/plugins/schanora/client/client.js';
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

  backup.addEventListener('click', async () => {
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

  async function start() {
    const health = await fetch('/health').then((response) => {
      if (!response.ok) throw new Error('本地内核没有响应，请检查启动窗口。');
      return response.json();
    });
    if (health.data?.runtime !== 'web') throw new Error('请打开浏览器版启动命令给出的地址。');
    const api = await mountBundle();
    const context = createContext();
    api.apply(context);
    const Main = context.components.get('schanora');
    if (!Main) throw new Error('工作区启动失败，未找到主面板。');
    const reactRoot = window.ReactDOM.createRoot(app);
    reactRoot.render(window.React.createElement(Main));
    connection.textContent = '本地内核已连接';
    backup.disabled = false;
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
