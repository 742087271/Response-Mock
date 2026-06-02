// ============ 内容脚本 - Extension World Bridge ============
// 职责：运行在 extension world（有 chrome.runtime），负责：
//   1. 从 chrome.storage.local 获取规则和配置（绕过 service worker 中转）
//   2. 通过 document CustomEvent 把规则发给 main world（content-inject.js）
//   3. 直接写 chrome.storage.local 记录日志（不依赖跨 world 事件）
// 注意：这里使用 chrome.* API，但绝对不能覆盖 window.fetch / XMLHttpRequest

(function () {
  'use strict';

  if (window.__RESPONSE_MOCK_BRIDGE__) return;
  window.__RESPONSE_MOCK_BRIDGE__ = true;

  // ---- 状态 ----
  let currentRules = [];
  let globalEnabled = true;
  let config = { showOverlay: true };

  // ---- 直接从 chrome.storage.local 读取（不经过 service worker）----
  async function loadRules() {
    try {
      const [rulesResult, configResult] = await Promise.all([
        chrome.storage.local.get('mock_rules'),
        chrome.storage.local.get('mock_config'),
      ]);
      currentRules = rulesResult.mock_rules || [];
      config = configResult.mock_config || { showOverlay: true, notifications: true, enabled: true };
      globalEnabled = config.enabled !== false;

      // 挂到 window，方便在页面 Console 里调试
      window.__currentMockRules__ = currentRules;
      window.__RESPONSE_MOCK_ENABLED__ = globalEnabled;

      pushRulesToMainWorld();
    } catch (e) {
      console.warn('[Response Mock] Bridge failed to load rules:', e);
    }
  }

  // 通过 document 事件把规则发给 main world（document 是跨 world 可见的）
  function pushRulesToMainWorld() {
    document.dispatchEvent(new CustomEvent('__RESPONSE_MOCK_RULES_UPDATE__', {
      detail: {
        rules: currentRules,
        enabled: globalEnabled,
        config: config,
      },
    }));
  }

  // ---- 直接写 storage.local 记录日志（最可靠的方案）----
  async function writeLog(entry) {
    try {
      const result = await chrome.storage.local.get('mock_logs');
      const logs = result.mock_logs || [];
      logs.unshift(entry);
      if (logs.length > 200) logs.splice(200);
      await chrome.storage.local.set({ mock_logs: logs });
    } catch (e) {
      console.warn('[Response Mock] Failed to write log:', e);
    }
  }

  // ---- 监听来自 main world 的日志事件 ----
  document.addEventListener('__RESPONSE_MOCK_LOG__', async (e) => {
    await writeLog(e.detail);
  });

  // ---- 监听来自 background 的消息 ----
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'RULES_BROADCAST') {
      // 收到 service worker 的广播，直接用推送过来的数据
      currentRules = message.rules || [];
      globalEnabled = message.config?.enabled !== false;
      config = message.config || config;
      window.__currentMockRules__ = currentRules;
      window.__RESPONSE_MOCK_ENABLED__ = globalEnabled;
      pushRulesToMainWorld();
      sendResponse({ success: true });
      return true;
    }
    if (message.type === 'REFRESH_RULES' || message.type === 'UPDATE_RULES') {
      loadRules().then(() => sendResponse({ success: true }));
      return true;
    }
    if (message.type === 'TOGGLE_ENABLED') {
      globalEnabled = message.enabled;
      window.__RESPONSE_MOCK_ENABLED__ = globalEnabled;
      pushRulesToMainWorld();
      sendResponse({ success: true });
      return true;
    }
  });

  // ---- 启动 ----
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      loadRules();
    });
  } else {
    loadRules();
  }
})();
