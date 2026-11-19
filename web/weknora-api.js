(function () {
  'use strict';

  function camel(value) {
    if (Array.isArray(value)) return value.map(camel);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [
      key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase()), camel(item),
    ]));
  }

  function route(input, method, body) {
    const url = new URL(input, location.origin);
    const pathname = url.pathname;
    const query = url.search;
    let match;

    if (pathname === '/health') return { path: '/api/v1/system/info' };
    if (pathname === '/capabilities') return { path: '/api/v1/system/capabilities' };
    if (pathname === '/api/v1/search') {
      return {
        path: '/api/v1/knowledge-search',
        body: { query: body.query, knowledge_base_ids: body.knowledgeBaseIds, match_count: body.matchCount },
      };
    }
    if (pathname === '/api/v1/knowledge-bases' && method === 'POST') {
      const { embeddingModelId, ...fields } = body;
      return { path: pathname, body: { ...fields, embedding_model_id: embeddingModelId } };
    }
    if ((match = pathname.match(/^\/api\/v1\/knowledge-bases\/([^/]+)\/documents$/))) {
      const documents = `/api/v1/knowledge-bases/${match[1]}/knowledge`;
      return { path: method === 'POST' ? documents + '/file' : documents + '?page_size=100&page=' + (url.searchParams.get('page') || '1') };
    }
    if ((match = pathname.match(/^\/api\/v1\/documents\/([^/]+)(\/chunks|\/spans)?$/))) {
      return { path: match[2] === '/chunks' ? `/api/v1/chunks/${match[1]}${query}` : `/api/v1/knowledge/${match[1]}${match[2] || ''}` };
    }
    if ((match = pathname.match(/^\/api\/v1\/sessions\/([^/]+)\/messages$/))) {
      return method === 'POST'
        ? { path: `/api/v1/knowledge-chat/${match[1]}`, body: { query: body.query, knowledge_base_ids: body.knowledgeBaseIds, channel: 'api' } }
        : { path: `/api/v1/messages/${match[1]}/load${query}` };
    }
    if ((match = pathname.match(/^\/api\/v1\/knowledge-bases\/([^/]+)\/wiki\/(tree|pages\/.+)$/))) {
      const pages = `/api/v1/knowledgebase/${match[1]}/wiki/pages`;
      const slug = match[2] === 'tree' ? '' : decodeURIComponent(match[2].slice(6));
      if (slug.split('/').some((part) => part === '.' || part === '..')) return null;
      return { path: slug ? pages + '/' + slug.split('/').map(encodeURIComponent).join('/') : pages + '?page_size=100&page=' + (url.searchParams.get('page') || '1') };
    }
    if (['/api/v1/models', '/api/v1/sessions', '/api/v1/knowledge-bases'].includes(pathname)) {
      return { path: pathname + query, body };
    }
    return null;
  }

  function reply(path, payload) {
    if (!payload || payload.error || payload.success === false || (payload.code !== undefined && payload.code !== 0)) {
      const message = payload?.error?.message || payload?.message || payload?.msg || payload?.error || 'WeKnora 请求失败';
      return { code: payload?.error?.code || 'WEKNORA_ERROR', message, requestId: payload?.request_id };
    }
    let data = camel(Object.hasOwn(payload, 'data') ? payload.data : payload);
    if (path === '/health') data = { status: 'ok', version: data.version, mode: 'WeKnora', runtime: 'weknora' };
    if (path === '/api/v1/models?type=Embedding') {
      data = (Array.isArray(data) ? data : data?.items || []).filter((model) => model.type === 'Embedding');
    }
    if (path === '/api/v1/search') data = { items: data, meta: camel(payload.meta) };
    if (Array.isArray(data) && Number.isFinite(payload.total)) data = { items: data, total: payload.total };
    if (path.split('?')[0].endsWith('/wiki/tree')) data = { items: (data?.pages || []).map(wikiPage), total: data?.total };
    if (path.includes('/wiki/pages/')) data = wikiPage(data);
    return { code: 0, data, requestId: payload.request_id };
  }

  function wikiPage(page) {
    const sources = (page.sourceRefs || []).map((ref) => {
      const [knowledgeId, ...title] = ref.split('|');
      return { knowledgeId, title: title.join('|') };
    });
    return { ...page, type: page.pageType, sources };
  }

  function headers(input) {
    const token = localStorage.getItem('weknora_token');
    return token ? { ...input, Authorization: 'Bearer ' + token } : input;
  }

  window.__SCHANORA_WEKNORA__ = { route, reply, headers, camel };
})();
