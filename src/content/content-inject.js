// ============ 内容脚本 - Main World ============
// 职责：拦截 fetch/xhr，规则和状态通过 document CustomEvent 从 bridge 获取
// 注意：这里绝对不能使用 chrome.* API（某些 site MAIN world 没有 chrome.runtime）

(function () {
  'use strict';

  if (window.__RESPONSE_MOCK_INJECTED__) return;
  window.__RESPONSE_MOCK_INJECTED__ = true;

  // ---- 状态 ----
  let currentRules = [];
  let globalEnabled = true;
  let config = { showOverlay: true };

  // ---- 从 bridge 接收规则 ----
  function handleRulesUpdate(event) {
    const detail = event.detail || {};
    currentRules = detail.rules || [];
    globalEnabled = detail.enabled !== false;
    config = detail.config || { showOverlay: true };
  }

  // 监听 bridge 通过 document 派发的规则更新事件（document 是跨 world 可见的）
  document.addEventListener('__RESPONSE_MOCK_RULES_UPDATE__', handleRulesUpdate);

  // ---- 规则匹配 ----

  function patternToRegex(pattern) {
    const escaped = pattern
      .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '.*');
    return new RegExp('^' + escaped);
  }

  function urlMatch(url, pattern) {
    if (!pattern) return false;
    return patternToRegex(pattern).test(url);
  }

  function findMatch(url, method) {
    for (const rule of currentRules) {
      if (!rule.enabled) continue;
      if (rule.method && rule.method !== '*' && rule.method !== method) continue;
      const rulePattern = rule.urlPattern || rule.url || '';
      if (urlMatch(url, rulePattern)) return rule;
    }
    return null;
  }

  // ---- 日志上报 ----
  function logInterception(method, url, rule, type) {
    const entry = {
      id: Date.now() + '_' + Math.random().toString(36).slice(2, 7),
      time: Date.now(),
      method,
      url,
      type,
      matched: !!rule,
      ruleName: rule ? rule.name : null,
      ruleId: rule ? rule.id : null,
      responseStatus: rule ? rule.responseStatus : null,
    };
    // 通过 document 事件让 bridge 接收并上报（跨 world 可见）
    document.dispatchEvent(new CustomEvent('__RESPONSE_MOCK_LOG__', { detail: entry }));

    if (config.showOverlay !== false) {
      showOverlay(method, url, rule);
    }
  }

  // ---- Mock 响应 ----

  function httpStatusText(status) {
    const map = {
      200: 'OK', 201: 'Created', 204: 'No Content',
      400: 'Bad Request', 401: 'Unauthorized', 403: 'Forbidden',
      404: 'Not Found', 500: 'Internal Server Error',
    };
    return map[status] || '';
  }

  async function handleMockedResponse(request, rule) {
    const delay = rule.delay || 0;
    if (delay > 0) await new Promise(r => setTimeout(r, delay));
    const body = rule.responseBody || '{}';
    const headers = new Headers({
      'Content-Type': 'application/json; charset=utf-8',
      ...(rule.responseHeaders || {}),
    });
    logInterception(request.method, request.url, rule, 'fetch');
    return new Response(body, {
      status: rule.responseStatus || 200,
      statusText: httpStatusText(rule.responseStatus || 200),
      headers,
    });
  }

  function handleMockedResponseSync(rule, method, url) {
    return {
      mocked: true,
      status: rule.responseStatus || 200,
      body: rule.responseBody || '{}',
      headers: { 'Content-Type': 'application/json; charset=utf-8', ...(rule.responseHeaders || {}) },
    };
  }

  function dispatchXhrEvent(xhr, type) {
    if (typeof xhr.dispatchEvent === 'function') {
      xhr.dispatchEvent(new Event(type));
      return;
    }
    const handler = xhr[`on${type}`];
    if (typeof handler === 'function') {
      handler.call(xhr, { type, target: xhr });
    }
  }

  // ---- 页面内可视化 ----

  function showOverlay(method, url, rule) {
    if (document.getElementById('__resp-mock-toast__')) return;
    const isMatched = !!rule;
    const toast = document.createElement('div');
    toast.id = '__resp-mock-toast__';
    toast.innerHTML = [
      `<span class="mock-badge ${isMatched ? 'mock-matched' : 'mock-pass'}">${isMatched ? 'MOCKED' : 'PASS'}</span>`,
      `<span class="mock-method">${method}</span>`,
      `<span class="mock-url">${truncateUrl(url)}</span>`,
      isMatched ? `<span class="mock-rule">${escapeHtml(rule.name || '规则')}</span>` : '',
    ].join('');
    const style = document.createElement('style');
    style.textContent = [
      '#__resp-mock-toast__{position:fixed;bottom:16px;right:16px;z-index:2147483647;display:flex;align-items:center;gap:8px;',
      `background:${isMatched?'#1a3a2a':'#2a2a2a'};border:1px solid ${isMatched?'#4ec9b0':'#555'};border-radius:6px;padding:8px 14px;`,
      'font-family:-apple-system,sans-serif;font-size:12px;color:#ccc;box-shadow:0 4px 16px rgba(0,0,0,.4);',
      'pointer-events:none;opacity:0;animation:__mock-in__.3s ease forwards;max-width:480px}',
      '.mock-badge{padding:2px 6px;border-radius:3px;font-size:10px;font-weight:700;flex-shrink:0}',
      '.mock-matched{background:#4ec9b0;color:#0d1117}.mock-pass{background:#444;color:#888}',
      '.mock-method{color:#4ec9b0;font-weight:600;flex-shrink:0}',
      '.mock-url{color:#888;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.mock-rule{color:#f0c040;flex-shrink:0}',
      '@keyframes __mock-in__{from{opacity:0;transform:translateX(20px)}to{opacity:1;transform:translateX(0)}}',
    ].join('');
    document.head.appendChild(style);
    document.body.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transition = 'opacity .3s';
      setTimeout(() => { toast.remove(); style.remove(); }, 300);
    }, 3000);
  }

  function truncateUrl(url) {
    try {
      const u = new URL(url);
      const path = u.pathname + u.search;
      return path.length > 60 ? u.pathname.slice(0, 30) + '...' + u.search.slice(0, 27) : (path || '/');
    } catch { return url.length > 60 ? url.slice(0, 57) + '...' : url; }
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // ---- 注入拦截逻辑 ----

  function injectInterceptor() {
    // ---- Fetch ----
    const OriginalFetch = window.fetch;
    window.fetch = async function (input, init = {}) {
      const req = input instanceof Request ? input : new Request(input, init);
      const url = req.url;
      const method = req.method || 'GET';

      const matched = findMatch(url, method);

      if (matched && globalEnabled) {
        return handleMockedResponse(req, matched);
      }
      return OriginalFetch.apply(this, arguments);
    };

    // ---- XHR ----
    const OrigOpen = XMLHttpRequest.prototype.open;
    const OrigSend = XMLHttpRequest.prototype.send;
    const OrigSetHeader = XMLHttpRequest.prototype.setRequestHeader;

    XMLHttpRequest.prototype.open = function (method, url, ...rest) {
      this.__mock_url = url;
      this.__mock_method = method;
      this.__mock_headers = {};
      return OrigOpen.call(this, method, url, ...rest);
    };

    XMLHttpRequest.prototype.setRequestHeader = function (name, value) {
      if (this.__mock_headers) this.__mock_headers[name] = value;
      return OrigSetHeader.call(this, name, value);
    };

    XMLHttpRequest.prototype.send = function (body) {
      let url = this.__mock_url;
      const method = this.__mock_method || 'GET';

      // 相对路径 → 绝对路径
      if (url && !url.startsWith('http')) {
        url = window.location.origin + (url.startsWith('/') ? url : '/' + url);
      }

      const matched = findMatch(url, method);
      if (matched && globalEnabled) {
        const result = handleMockedResponseSync(matched, method, url);
        this.__mock_completed = true;
        Object.defineProperties(this, {
          readyState: { value: 4, writable: false },
          status: { value: result.status, writable: false },
          statusText: { value: httpStatusText(result.status), writable: false },
          response: { value: result.body, writable: false },
          responseText: { value: result.body, writable: false },
          responseURL: { value: url, writable: false },
          responseType: { value: 'text', writable: false },
          getAllResponseHeaders: {
            value: () => Object.entries(result.headers).map(([k, v]) => `${k}: ${v}`).join('\n'),
            writable: false,
          },
        });
        logInterception(method, url, matched, 'xhr');
        setTimeout(() => {
          dispatchXhrEvent(this, 'readystatechange');
          dispatchXhrEvent(this, 'load');
          dispatchXhrEvent(this, 'loadend');
        }, matched.delay || 0);
        return;
      }
      this.addEventListener('load', function () {
        logInterception(method, url, null, 'xhr');
      });
      return OrigSend.apply(this, arguments);
    };
  }

  // ---- 启动 ----
  // 拦截器立即生效（初始 rules=[]，bridge 会通过事件同步过来）
  injectInterceptor();
})();
