// ============ Options Page 主脚本 ============
import { HTTP_STATUS_CODES } from '../shared/constants.js';
import { createJSONEditor } from './vendor/vanilla-jsoneditor/standalone.js';

// ---- State ----
let allRules = [];
let filteredRules = [];
let currentEditId = null;
let currentDeleteId = null;
let logs = [];
let filteredLogs = [];
let globalEnabled = true;

// 分页
const PAGE_SIZE = 20;
let currentPage = 1;

// ---- Storage Keys ----
const STORAGE_KEYS = {
  RULES: 'mock_rules',
  CONFIG: 'mock_config',
};

// ---- Direct Storage Access（绕过 service worker，直接读写 chrome.storage.local，10MB/条限制）----
async function loadAllData() {
  const [rulesResult, configResult] = await Promise.all([
    chrome.storage.local.get(STORAGE_KEYS.RULES),
    chrome.storage.local.get(STORAGE_KEYS.CONFIG),
  ]);
  return {
    rules: rulesResult[STORAGE_KEYS.RULES] || [],
    config: configResult[STORAGE_KEYS.CONFIG] || { enabled: true, showOverlay: true, notifications: true },
  };
}

async function saveAllRules(rules) {
  await chrome.storage.local.set({ [STORAGE_KEYS.RULES]: rules });
}

async function saveConfigUpdates(updates) {
  const result = await chrome.storage.local.get(STORAGE_KEYS.CONFIG);
  const config = result[STORAGE_KEYS.CONFIG] || {};
  await chrome.storage.local.set({ [STORAGE_KEYS.CONFIG]: { ...config, ...updates } });
}

// ---- DOM ----
const $ = sel => document.querySelector(sel);
const $$ = sel => document.querySelectorAll(sel);

// ---- Init ----
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

async function init() {
  await loadData();
  bindEvents();
  renderRules();
  renderStats();
  loadLogs();
}

// ---- Data Loading ----
async function loadData() {
  const data = await loadAllData();
  allRules = data.rules;
  globalEnabled = data.config?.enabled !== false;
  $('#globalToggle').checked = globalEnabled;
  $('#settingShowOverlay').checked = data.config.showOverlay !== false;
  $('#settingNotifications').checked = data.config.notifications !== false;
}

// ---- Event Binding ----
function bindEvents() {
  // 全局开关
  $('#globalToggle').addEventListener('change', async () => {
    globalEnabled = $('#globalToggle').checked;
    await saveConfigUpdates({ enabled: globalEnabled });
    await refreshRulesInTabs();
  });

  // Tab 切换
  $$('.nav-item').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  // Rules Tab
  $('#btnAddRule').addEventListener('click', openAddModal);
  $('#searchInput').addEventListener('input', debounce(applyRulesFilter, 200));
  $('#filterMethod').addEventListener('change', applyRulesFilter);
  $('#filterStatus').addEventListener('change', applyRulesFilter);
  $('#filterEnabled').addEventListener('change', applyRulesFilter);
  $('#btnClearFilters').addEventListener('click', clearFilters);
  $('#btnBulkEnable').addEventListener('click', () => bulkToggle(true));
  $('#btnBulkDisable').addEventListener('click', () => bulkToggle(false));

  // Pagination
  $('#btnPrevPage').addEventListener('click', () => changePage(currentPage - 1));
  $('#btnNextPage').addEventListener('click', () => changePage(currentPage + 1));

  // Logs Tab
  $('#btnClearLogs').addEventListener('click', clearLogs);
  $('#btnRefreshLogs').addEventListener('click', loadLogs);
  $('#logSearchInput').addEventListener('input', applyLogFilter);
  $('#logFilterType').addEventListener('change', applyLogFilter);
  $('#logFilterMatched').addEventListener('change', applyLogFilter);

  // Settings Tab
  $('#settingShowOverlay').addEventListener('change', saveSettings);
  $('#settingNotifications').addEventListener('change', saveSettings);
  $('#btnExportSettings').addEventListener('click', exportData);
  $('#btnImportSettings').addEventListener('click', () => $('#importFileSettings').click());
  $('#importFileSettings').addEventListener('change', handleImport);
  $('#btnResetRules').addEventListener('click', () => {
    $('#resetModal').style.display = 'flex';
  });
  $('#btnResetModalClose').addEventListener('click', () => $('#resetModal').style.display = 'none');
  $('#btnCancelReset').addEventListener('click', () => $('#resetModal').style.display = 'none');
  $('#btnConfirmReset').addEventListener('click', resetRules);

  // Rule Modal
  $('#btnModalClose').addEventListener('click', closeModal);
  $('#btnCancelRule').addEventListener('click', closeModal);
  $('#ruleModal').addEventListener('click', e => { if (e.target === $('#ruleModal')) closeModal(); });
  $('#btnSaveRule').addEventListener('click', saveRule);
  $('#btnAddHeader').addEventListener('click', addHeaderRow);

  // Delete Modal
  $('#btnDeleteModalClose').addEventListener('click', () => $('#deleteModal').style.display = 'none');
  $('#btnCancelDelete').addEventListener('click', () => $('#deleteModal').style.display = 'none');
  $('#btnConfirmDelete').addEventListener('click', confirmDelete);
  $('#deleteModal').addEventListener('click', e => { if (e.target === $('#deleteModal')) $('#deleteModal').style.display = 'none'; });
}

// ---- Tab Switching ----
function switchTab(tabId) {
  $$('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.tab === tabId));
  $$('.tab-panel').forEach(p => p.style.display = p.id === `tab-${tabId}` ? 'block' : 'none');
  if (tabId === 'logs') loadLogs();
}

// ---- Rules Filtering ----
function applyRulesFilter() {
  const query = ($('#searchInput').value || '').toLowerCase();
  const method = $('#filterMethod').value;
  const status = $('#filterStatus').value;
  const enabled = $('#filterEnabled').value;

  filteredRules = allRules.filter(rule => {
    if (query && !(rule.name || '').toLowerCase().includes(query)
      && !(rule.urlPattern || rule.url || '').toLowerCase().includes(query)
      && !(rule.description || '').toLowerCase().includes(query)) return false;
    if (method && rule.method !== method) return false;
    if (enabled === 'enabled' && !rule.enabled) return false;
    if (enabled === 'disabled' && rule.enabled) return false;
    if (status) {
      const code = rule.responseStatus || 200;
      if (status === '2xx' && (code < 200 || code >= 300)) return false;
      if (status === '4xx' && (code < 400 || code >= 500)) return false;
      if (status === '5xx' && (code < 500 || code >= 600)) return false;
    }
    return true;
  });

  currentPage = 1;
  renderRulesTable();
  renderPagination();
}

function clearFilters() {
  $('#searchInput').value = '';
  $('#filterMethod').value = '';
  $('#filterStatus').value = '';
  $('#filterEnabled').value = '';
  applyRulesFilter();
}

// ---- Rules Rendering ----
function renderRules() {
  applyRulesFilter();
  renderStats();
}

function renderStats() {
  const total = allRules.length;
  const enabled = allRules.filter(r => r.enabled).length;
  const disabled = total - enabled;
  const intercepted = logs.filter(l => l.matched).length;

  const elTotal = $('#statTotal');
  const elEnabled = $('#statEnabled');
  const elDisabled = $('#statDisabled');
  const elIntercepted = $('#statIntercepted');
  if (elTotal) elTotal.textContent = total;
  if (elEnabled) elEnabled.textContent = enabled;
  if (elDisabled) elDisabled.textContent = disabled;
  if (elIntercepted) elIntercepted.textContent = intercepted;
}

function renderRulesTable() {
  const tbody = $('#rulesTableBody');
  const emptyState = $('#emptyState');

  if (!tbody || !emptyState) return;

  if (filteredRules.length === 0) {
    tbody.innerHTML = '';
    emptyState.style.display = 'flex';
    return;
  }

  emptyState.style.display = 'none';
  const start = (currentPage - 1) * PAGE_SIZE;
  const pageRules = filteredRules.slice(start, start + PAGE_SIZE);

  tbody.innerHTML = pageRules.map(rule => `
    <tr class="${rule.enabled ? '' : 'disabled'}" data-id="${rule.id}">
      <td>
        <label class="toggle-switch" style="width:32px;height:18px;">
          <input type="checkbox" ${rule.enabled ? 'checked' : ''}>
          <span class="toggle-slider"></span>
        </label>
      </td>
      <td>
        <span class="table-name" title="${escapeHtml(rule.name)}">${escapeHtml(rule.name)}</span>
        ${rule.description ? `<br><span style="font-size:10px;color:var(--text-muted)">${escapeHtml(rule.description)}</span>` : ''}
      </td>
      <td>
        <span class="method-badge ${rule.method === '*' ? 'all' : ''}">${rule.method === '*' ? 'ALL' : rule.method || 'GET'}</span>
      </td>
      <td>
        <span class="table-url" title="${escapeHtml(rule.urlPattern || rule.url)}">${escapeHtml(truncate(rule.urlPattern || rule.url, 50))}</span>
      </td>
      <td><span class="status-badge">${rule.responseStatus || 200}</span></td>
      <td>${rule.delay ? `<span class="delay-badge">${rule.delay}ms</span>` : '—'}</td>
      <td>
        <div class="table-actions">
          <button class="table-action-btn btn-clone" title="复制规则">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
              <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/>
            </svg>
          </button>
          <button class="table-action-btn btn-edit" title="编辑">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/>
              <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
            </svg>
          </button>
          <button class="table-action-btn delete btn-delete" title="删除">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="3 6 5 6 21 6"/>
              <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/>
              <path d="M10 11v6M14 11v6"/>
              <path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/>
            </svg>
          </button>
        </div>
      </td>
    </tr>
  `).join('');

  tbody.querySelectorAll('tr').forEach(row => {
    const id = row.dataset.id;
    row.querySelector('.toggle-switch input')?.addEventListener('change', () => toggleRule(id));
    row.querySelector('.btn-clone')?.addEventListener('click', () => cloneRule(id));
    row.querySelector('.btn-edit')?.addEventListener('click', () => openEditModal(id));
    row.querySelector('.btn-delete')?.addEventListener('click', () => openDeleteModal(id));
  });
}

function renderPagination() {
  const totalPages = Math.max(1, Math.ceil(filteredRules.length / PAGE_SIZE));
  const start = (currentPage - 1) * PAGE_SIZE + 1;
  const end = Math.min(currentPage * PAGE_SIZE, filteredRules.length);

  const paginationInfo = $('#paginationInfo');
  const paginationPages = $('#paginationPages');
  if (paginationInfo) {
    paginationInfo.textContent = filteredRules.length === 0
      ? '无数据'
      : `显示 ${start}–${end}，共 ${filteredRules.length} 条`;
  }
  if (paginationPages) {
    paginationPages.textContent = `${currentPage} / ${totalPages}`;
  }
  const prevBtn = $('#btnPrevPage');
  const nextBtn = $('#btnNextPage');
  const pagination = $('#pagination');
  if (prevBtn) prevBtn.disabled = currentPage <= 1;
  if (nextBtn) nextBtn.disabled = currentPage >= totalPages;
  if (pagination) pagination.style.display = filteredRules.length === 0 ? 'none' : 'flex';
}

function changePage(page) {
  const totalPages = Math.max(1, Math.ceil(filteredRules.length / PAGE_SIZE));
  currentPage = Math.max(1, Math.min(page, totalPages));
  renderRulesTable();
  renderPagination();
}

// ---- Modal Operations ----
function openAddModal() {
  currentEditId = null;
  $('#modalTitle').textContent = '添加规则';
  resetForm();
  ruleModalSetup();
  initJsonEditor({});
  $('#ruleModal').style.display = 'flex';
}

function openEditModal(id) {
  const rule = allRules.find(r => r.id === id);
  if (!rule) return;

  let bodyJson = {};
  if (rule.responseBody) {
    if (typeof rule.responseBody === 'string') {
      try { bodyJson = JSON.parse(rule.responseBody); } catch {}
    } else {
      bodyJson = rule.responseBody;
    }
  }

  currentEditId = id;
  $('#modalTitle').textContent = '编辑规则';

  $$('#ruleModal input:not([type=checkbox])').forEach(el => el.value = '');
  $('#ruleName').value = rule.name || '';
  $('#ruleMethod').value = rule.method || '*';
  $('#ruleStatus').value = rule.responseStatus || 200;
  $('#ruleUrl').value = rule.urlPattern || rule.url || '';
  $('#ruleDelay').value = rule.delay || 0;
  $('#ruleDescription').value = rule.description || '';

  renderHeaders(rule.responseHeaders || { 'Content-Type': 'application/json' });
  initJsonEditor(bodyJson);
  $('#ruleModal').style.display = 'flex';
}

function closeModal() {
  $('#ruleModal').style.display = 'none';
  currentEditId = null;
  destroyJsonEditor();
}

function resetForm() {
  $$('#ruleModal input:not([type=checkbox])').forEach(el => el.value = '');
  $('#ruleMethod').value = '*';
  $('#ruleStatus').value = 200;
  $('#ruleDelay').value = 0;
  renderHeaders({ 'Content-Type': 'application/json' });
}

// ---- Headers Editor ----
function renderHeaders(headers = {}) {
  const editor = $('#headersEditor');
  editor.innerHTML = '';
  const entries = Object.entries(headers);
  if (entries.length === 0) entries.push(['Content-Type', 'application/json']);
  entries.forEach(([key, val], i) => {
    const row = document.createElement('div');
    row.className = 'header-row';
    row.dataset.index = i;
    row.innerHTML = `
      <input type="text" class="header-key" placeholder="Header Name" value="${escapeHtml(key)}">
      <input type="text" class="header-val" placeholder="Header Value" value="${escapeHtml(val)}">
      <button class="btn-icon btn-remove-header" title="删除">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>
    `;
    row.querySelector('.btn-remove-header').addEventListener('click', () => {
      if (editor.children.length > 1) row.remove();
    });
    editor.appendChild(row);
  });
}

function addHeaderRow() {
  const editor = $('#headersEditor');
  const i = editor.children.length;
  const row = document.createElement('div');
  row.className = 'header-row';
  row.dataset.index = i;
  row.innerHTML = `
    <input type="text" class="header-key" placeholder="Header Name">
    <input type="text" class="header-val" placeholder="Header Value">
    <button class="btn-icon btn-remove-header" title="删除">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
      </svg>
    </button>
  `;
  row.querySelector('.btn-remove-header').addEventListener('click', () => {
    if (editor.children.length > 1) row.remove();
  });
  editor.appendChild(row);
}

function collectHeaders() {
  const headers = {};
  $$('.header-row').forEach(row => {
    const key = row.querySelector('.header-key').value.trim();
    const val = row.querySelector('.header-val').value.trim();
    if (key) headers[key] = val;
  });
  return headers;
}

// ---- Save Rule ----
async function saveRule() {
  const name = $('#ruleName').value.trim();
  const url = $('#ruleUrl').value.trim();

  if (!name) { alert('请输入规则名称'); return; }
  if (!url) { alert('请输入 URL 匹配规则'); return; }

  let responseBody = {};
  if (jsonEditorInstance) {
    try {
      const content = jsonEditorInstance.get?.();
      if (content?.json) responseBody = content.json;
      else if (content?.text) {
        try { responseBody = JSON.parse(content.text); }
        catch { responseBody = {}; }
      }
    } catch {}
  }

  const ruleData = {
    name,
    urlPattern: url,
    method: $('#ruleMethod').value,
    responseStatus: parseInt($('#ruleStatus').value) || 200,
    responseBody,
    responseHeaders: collectHeaders(),
    delay: parseInt($('#ruleDelay').value) || 0,
    description: $('#ruleDescription').value.trim(),
  };

  if (currentEditId) {
    const idx = allRules.findIndex(r => r.id === currentEditId);
    if (idx !== -1) {
      allRules[idx] = { ...allRules[idx], ...ruleData };
      await saveAllRules(allRules);
    }
  } else {
    const newRule = {
      ...ruleData,
      id: `rule_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      enabled: true,
      createdAt: Date.now(),
    };
    allRules.push(newRule);
    await saveAllRules(allRules);
  }

  applyRulesFilter();
  renderStats();
  closeModal();
  await refreshRulesInTabs();
}

// ---- Delete ----
function openDeleteModal(id) {
  const rule = allRules.find(r => r.id === id);
  if (!rule) return;
  currentDeleteId = id;
  const deleteRuleNameEl = $('#deleteRuleName');
  const deleteModalEl = $('#deleteModal');
  if (deleteRuleNameEl) deleteRuleNameEl.textContent = rule.name;
  if (deleteModalEl) deleteModalEl.style.display = 'flex';
}

async function confirmDelete() {
  if (!currentDeleteId) return;
  allRules = allRules.filter(r => r.id !== currentDeleteId);
  await saveAllRules(allRules);
  applyRulesFilter();
  renderStats();
  $('#deleteModal').style.display = 'none';
  currentDeleteId = null;
  await refreshRulesInTabs();
}

// ---- Toggle & Clone ----
async function toggleRule(id) {
  const rule = allRules.find(r => r.id === id);
  if (rule) rule.enabled = !rule.enabled;
  await saveAllRules(allRules);
  applyRulesFilter();
  renderStats();
  await refreshRulesInTabs();
}

async function cloneRule(id) {
  const rule = allRules.find(r => r.id === id);
  if (!rule) return;
  const clone = {
    ...JSON.parse(JSON.stringify(rule)),
    id: `rule_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    name: `${rule.name} (副本)`,
    createdAt: Date.now(),
  };
  allRules.push(clone);
  await saveAllRules(allRules);
  applyRulesFilter();
  renderStats();
  await refreshRulesInTabs();
}

async function bulkToggle(enable) {
  const ids = filteredRules.map(r => r.id);
  allRules.forEach(r => { if (ids.includes(r.id)) r.enabled = enable; });
  await saveAllRules(allRules);
  applyRulesFilter();
  renderStats();
  await refreshRulesInTabs();
}

// ---- Logs ----
async function loadLogs() {
  const result = await chrome.storage.local.get('mock_logs');
  logs = result.mock_logs || [];
  filteredLogs = logs;
  applyLogFilter();
}

function applyLogFilter() {
  const query = ($('#logSearchInput').value || '').toLowerCase();
  const type = $('#logFilterType').value;
  const matched = $('#logFilterMatched').value;

  filteredLogs = logs.filter(log => {
    const searchTarget = `${log.url || ''} ${log.ruleName || ''} ${log.method || ''}`.toLowerCase();
    if (query && !searchTarget.includes(query)) return false;
    if (type && log.type !== type) return false;
    if (matched === 'matched' && !log.matched) return false;
    if (matched === 'pass' && log.matched) return false;
    return true;
  });

  renderLogList();
  renderLogStats();
}

function renderLogStats() {
  const elTotal = $('#logTotalCount');
  const elMatched = $('#logMatchedCount');
  const elPass = $('#logPassCount');
  if (!elTotal || !elMatched || !elPass) return;
  elTotal.textContent = logs.length;
  elMatched.textContent = logs.filter(l => l.matched).length;
  elPass.textContent = logs.filter(l => !l.matched).length;
}

function renderLogList() {
  const container = $('#logList');
  const emptyState = $('#logEmptyState');

  if (!container || !emptyState) return;

  if (filteredLogs.length === 0) {
    container.innerHTML = '';
    emptyState.style.display = 'flex';
    return;
  }

  emptyState.style.display = 'none';
  container.innerHTML = filteredLogs.map(log => `
    <div class="log-entry ${log.matched ? 'matched' : 'pass'}">
      <span class="log-time">${formatTime(log.time)}</span>
      <span class="log-type">
        <span class="log-type-badge">${(log.type || 'xhr').toUpperCase()}</span>
      </span>
      <span class="log-method">${log.method}</span>
      <span class="log-url" title="${escapeHtml(log.url)}">${escapeHtml(truncate(log.url, 70))}</span>
      ${log.ruleName ? `<span class="log-rule" title="${escapeHtml(log.ruleName)}">${escapeHtml(truncate(log.ruleName, 15))}</span>` : ''}
      <span class="log-badge ${log.matched ? 'matched' : 'pass'}">${log.matched ? '已拦截' : '已通过'}</span>
    </div>
  `).join('');
}

async function clearLogs() {
  logs = [];
  filteredLogs = [];
  renderLogList();
  renderLogStats();
  await chrome.storage.local.set({ mock_logs: [] });
}

// ---- Settings ----
async function saveSettings() {
  await saveConfigUpdates({
    showOverlay: $('#settingShowOverlay').checked,
    notifications: $('#settingNotifications').checked,
    enabled: globalEnabled,
  });
  await refreshRulesInTabs();
}

async function resetRules() {
  await saveAllRules([]);
  allRules = [];
  await loadData();
  applyRulesFilter();
  renderStats();
  $('#resetModal').style.display = 'none';
  await refreshRulesInTabs();
}

// ---- Import/Export ----
async function exportData() {
  const res = await sendMessage({ type: 'EXPORT_DATA' });
  const blob = new Blob([JSON.stringify(res.data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `response-mock-backup-${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

async function handleImport() {
  const file = $('#importFileSettings').files[0];
  if (!file) return;
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    await sendMessage({ type: 'IMPORT_DATA', data });
    await loadData();
    applyRulesFilter();
    renderStats();
    await refreshRulesInTabs();
    alert('导入成功！');
  } catch (e) {
    alert('导入失败：文件格式错误');
  }
  $('#importFileSettings').value = '';
}

// ============ JSON Editor ============

let jsonEditorInstance = null;

function initJsonEditor(initialJson = {}) {
  const container = $('#jsonEditorPanel');
  if (!container) return;

  if (jsonEditorInstance) {
    try { jsonEditorInstance.destroy?.(); } catch {}
    jsonEditorInstance = null;
  }

  try {
    jsonEditorInstance = createJSONEditor({
      target: container,
      props: {
        content: { json: initialJson },
        mode: 'tree',
        mainMenuBar: false,
        navigationBar: false,
        statusBar: false,
        indentation: 2,
        tabSize: 2,
        askToFormat: false,
      },
    });
  } catch (e) {
    console.warn('JSON editor init failed:', e);
  }
}

function destroyJsonEditor() {
  if (jsonEditorInstance) {
    try { jsonEditorInstance.destroy?.(); } catch {}
    jsonEditorInstance = null;
  }
  const container = $('#jsonEditorPanel');
  if (container) container.innerHTML = '';
}

// ============ JSON Editor ============

function ruleModalSetup() {
  if ($('#headersEditor').children.length === 0) {
    renderHeaders({ 'Content-Type': 'application/json' });
  }
}

// ---- Helpers ----
function sendMessage(msg) {
  return new Promise(resolve => {
    chrome.runtime.sendMessage(msg, res => resolve(res || {}));
  });
}

async function refreshRulesInTabs() {
  try {
    await chrome.runtime.sendMessage({ type: 'REFRESH_RULES' });
  } catch (e) {
    await notifyAllTabs({ type: 'REFRESH_RULES' });
  }
}

async function notifyAllTabs(msg) {
  const tabs = await chrome.tabs.query({});
  await Promise.all(
    tabs.map(tab => {
      if (tab.id && tab.url && !tab.url.startsWith('chrome://')) {
        return chrome.tabs.sendMessage(tab.id, msg).catch(() => {});
      }
      return Promise.resolve();
    })
  );
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function truncate(str, len) {
  if (!str) return '';
  return str.length > len ? str.slice(0, len) + '…' : str;
}

function formatTime(ts) {
  const d = new Date(ts);
  const pad = n => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function debounce(fn, delay) {
  let timer;
  return function (...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), delay);
  };
}
