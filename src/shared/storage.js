// ============ 存储封装 ============
import { DEFAULT_CONFIG } from './constants.js';

// 存储键名
const STORAGE_KEYS = {
  RULES: 'mock_rules',
  CONFIG: 'mock_config',
  LOGS: 'mock_logs',
};

// ---- chrome.storage.local（10MB/条限制，远大于 sync 的 8KB）----

// 获取所有规则
export async function getRules() {
  const result = await chrome.storage.local.get(STORAGE_KEYS.RULES);
  return result[STORAGE_KEYS.RULES] || [];
}

// 保存所有规则
export async function saveRules(rules) {
  await chrome.storage.local.set({ [STORAGE_KEYS.RULES]: rules });
}

// 获取配置
export async function getConfig() {
  const result = await chrome.storage.local.get(STORAGE_KEYS.CONFIG);
  const config = result[STORAGE_KEYS.CONFIG];
  return { ...DEFAULT_CONFIG, ...config };
}

// 保存配置
export async function saveConfig(config) {
  await chrome.storage.local.set({ [STORAGE_KEYS.CONFIG]: config });
}

// 导出所有数据（用于备份）
export async function exportData() {
  const rules = await getRules();
  const config = await getConfig();
  return { rules, config, exportedAt: Date.now() };
}

// 导入数据（用于恢复）
export async function importData(data) {
  if (data.rules) await saveRules(data.rules);
  if (data.config) await saveConfig(data.config);
}

// ---- 日志（storage.local 持久化）----
const MAX_LOGS = 200;

export async function getLogs() {
  const result = await chrome.storage.local.get(STORAGE_KEYS.LOGS);
  return result[STORAGE_KEYS.LOGS] || [];
}

export async function saveLogs(logs) {
  await chrome.storage.local.set({ [STORAGE_KEYS.LOGS]: logs });
}

export async function addLog(entry) {
  const logs = await getLogs();
  logs.unshift(entry);
  if (logs.length > MAX_LOGS) {
    logs.splice(MAX_LOGS);
  }
  await saveLogs(logs);
}

export async function clearLogs() {
  await saveLogs([]);
}

// ---- 通知内容脚本 ----
export async function notifyContentScript(tabId) {
  try {
    await chrome.tabs.sendMessage(tabId, { type: 'REFRESH_RULES' });
  } catch {
    // Tab 可能没有加载内容脚本，忽略
  }
}

export async function broadcastRulesUpdate() {
  try {
    const tabs = await chrome.tabs.query({});
    for (const tab of tabs) {
      if (tab.id && tab.url && !tab.url.startsWith('chrome://')) {
        notifyContentScript(tabId).catch(() => {});
      }
    }
  } catch {
    // 忽略错误
  }
}
