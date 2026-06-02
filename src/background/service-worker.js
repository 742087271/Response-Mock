// ============ 后台 Service Worker ============
// 职责：管理规则、广播更新、显示通知

import { getRules, saveRules, getConfig, saveConfig, addLog, clearLogs, getLogs } from '../shared/storage.js';
import { SAMPLE_RULES, generateId } from '../shared/constants.js';

// ---- 广播规则到所有已打开的 content script ----
async function broadcastRules() {
  const [rules, config] = await Promise.all([getRules(), getConfig()]);
  const payload = { type: 'RULES_BROADCAST', rules, config };

  try {
    const tabs = await chrome.tabs.query({});
    await Promise.all(
      tabs.map(tab => chrome.tabs.sendMessage(tab.id, payload).catch(() => {}))
    );
  } catch (e) {}
}

// ---- 监听来自 popup / options / content-script 的消息 ----
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // PING 单独处理，不经过 handleMessage（避免异步问题）
  if (message.type === 'PING') {
    sendResponse({ pong: true });
    return true;
  }
  handleMessage(message, sender).then(sendResponse);
  return true; // 异步响应
});

async function handleMessage(message, sender) {
  switch (message.type) {
    case 'GET_RULES':
      return { rules: await getRules() };

    case 'SAVE_RULES':
      await saveRules(message.rules);
      broadcastRules(); // 广播到所有页面
      return { success: true };

    case 'ADD_RULE':
      return addRuleResponse(message.rule);

    case 'UPDATE_RULE':
      return updateRuleResponse(message.id, message.updates);

    case 'DELETE_RULE':
      await deleteRuleResponse(message.id);
      return { success: true };

    case 'TOGGLE_RULE':
      return toggleRuleResponse(message.id);

    case 'TOGGLE_GLOBAL_ENABLED':
      await saveConfig({ enabled: message.enabled });
      broadcastRules(); // 广播到所有页面
      return { success: true };

    case 'GET_CONFIG':
      return { config: await getConfig() };

    case 'SAVE_CONFIG':
      await saveConfig(message.config);
      broadcastRules(); // 广播到所有页面
      return { success: true };

    case 'GET_LOGS':
      return { logs: await getLogs() };

    case 'CLEAR_LOGS':
      await clearLogs();
      return { success: true };

    case 'INTERCEPTED_REQUEST': {
      // 内容脚本拦截到请求后，记录日志
      await addLog(message.log);
      return { success: true };
    }

    case 'SHOW_NOTIFICATION':
      showNotification(message.title, message.body);
      return { success: true };

    case 'QUICK_ADD_RULE': {
      // 从请求信息快速创建规则
      const rule = {
        id: generateId(),
        name: message.data.name || `规则: ${message.data.url}`,
        urlPattern: message.data.urlPattern || message.data.url,
        method: message.data.method || '*',
        responseStatus: message.data.status || 200,
        responseBody: message.data.responseBody || '{}',
        responseHeaders: message.data.responseHeaders || { 'Content-Type': 'application/json' },
        enabled: true,
        delay: 0,
        description: '快速添加',
        createdAt: Date.now(),
      };
      await addRuleResponse(rule);
      broadcastRules(); // 广播到所有页面
      return { rule, success: true };
    }

    case 'EXPORT_DATA':
      return exportDataResponse();

    case 'IMPORT_DATA':
      await importDataResponse(message.data);
      broadcastRules(); // 广播到所有页面
      return { success: true };

    case 'REFRESH_RULES':
      // 收到来自 popup/options 的刷新请求，主动推送最新规则到所有页面
      await broadcastRules();
      return { success: true };

    default:
      return { error: 'Unknown message type' };
  }
}

// ---- Rule 操作 ----

async function addRuleResponse(rule) {
  const rules = await getRules();
  rules.push(rule);
  await saveRules(rules);
  broadcastRules(); // 广播到所有页面
  return { rule, success: true };
}

async function updateRuleResponse(id, updates) {
  const rules = await getRules();
  const index = rules.findIndex((r) => r.id === id);
  if (index === -1) return { error: 'Rule not found' };
  rules[index] = { ...rules[index], ...updates };
  await saveRules(rules);
  broadcastRules(); // 广播到所有页面
  return { rule: rules[index], success: true };
}

async function deleteRuleResponse(id) {
  const rules = await getRules();
  await saveRules(rules.filter((r) => r.id !== id));
  broadcastRules(); // 广播到所有页面
}

async function toggleRuleResponse(id) {
  const rules = await getRules();
  const rule = rules.find((r) => r.id === id);
  if (!rule) return { error: 'Rule not found' };
  rule.enabled = !rule.enabled;
  await saveRules(rules);
  broadcastRules(); // 广播到所有页面
  return { enabled: rule.enabled, success: true };
}

async function exportDataResponse() {
  const rules = await getRules();
  const config = await getConfig();
  return { data: { rules, config, exportedAt: Date.now() }, success: true };
}

async function importDataResponse(data) {
  // 兼容两种格式：
  // 1. 直接传入 { rules, config } （标准格式）
  // 2. 从导出的 JSON 导入 { data: { rules, config }, success } （导出的文件格式）
  const actualData = data.data && (data.data.rules || data.data.config) ? data.data : data;
  if (actualData.rules) await saveRules(actualData.rules);
  if (actualData.config) await saveConfig(actualData.config);
}

// ---- 通知 ----

function showNotification(title, body) {
  if (!Notification.permission || Notification.permission === 'granted') {
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'assets/icon128.png',
      title,
      message: body,
      priority: 1,
    });
  }
}

// ---- 安装 & 更新处理 ----

// ---- 初始化：确保示例规则存在（只在 storage 为空时写入一次）----

async function ensureSampleRules() {
  const existingRules = await getRules();
  if (!existingRules || existingRules.length === 0) {
    await saveRules(SAMPLE_RULES);
    console.log('[Response Mock] Sample rules initialized.');
  }
}

chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === 'install') {
    console.log('[Response Mock] Extension installed.');
  } else if (details.reason === 'update') {
    console.log('[Response Mock] Extension updated.');
  }
  // 无论是安装还是更新，都确保有示例规则（防止 storage 被清空）
  await ensureSampleRules();
});

// ---- 启动时加载配置 ----

chrome.runtime.onStartup.addListener(async () => {
  console.log('[Response Mock] Browser started.');
  await ensureSampleRules();
});

// ---- Keep-alive: 防止 Service Worker 被 Chrome 回收 ----

// 用 chrome.alarms 定期触发，保持 Service Worker 存活
chrome.alarms.create('keepAlive', { periodInMinutes: 0.4 }); // ~24秒触发一次

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'keepAlive') {
    console.log('[Response Mock] keep-alive ping');
  }
});

// ---- 迁移旧数据：sync → local ----
async function migrateFromSyncToLocal() {
  try {
    const [syncRules, localRules, syncConfig, localConfig] = await Promise.all([
      chrome.storage.sync.get('mock_rules'),
      chrome.storage.local.get('mock_rules'),
      chrome.storage.sync.get('mock_config'),
      chrome.storage.local.get('mock_config'),
    ]);
    // 如果 local 为空但 sync 有数据，迁移过来
    if ((!localRules.mock_rules || localRules.mock_rules.length === 0) && syncRules.mock_rules?.length > 0) {
      await chrome.storage.local.set({ mock_rules: syncRules.mock_rules });
      console.log('[Response Mock] Migrated rules from sync to local:', syncRules.mock_rules.length);
    }
    if (!localConfig.mock_config && syncConfig.mock_config) {
      await chrome.storage.local.set({ mock_config: syncConfig.mock_config });
      console.log('[Response Mock] Migrated config from sync to local');
    }
  } catch (e) {
    console.warn('[Response Mock] Migration failed:', e);
  }
}

ensureSampleRules(); // 确保 storage 有示例规则

migrateFromSyncToLocal(); // 异步迁移，不阻塞

console.log('[Response Mock] Service worker started.');
