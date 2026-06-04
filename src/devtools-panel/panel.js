// ============ DevTools Panel 主脚本 ============
import { HTTP_STATUS_CODES } from '../shared/constants.js';
import { createJSONEditor } from '../options/vendor/vanilla-jsoneditor/standalone.js';

// ---- State ----
let allRules = [];
let filteredRules = [];
let currentEditId = null;
let currentDeleteId = null;
let searchQuery = '';
let globalEnabled = true;

// ---- JSON Editor State ----
let jsonEditorInstance = null;

// ---- DOM Elements ----
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

// ---- Init ----
document.addEventListener('DOMContentLoaded', init);

async function init() {
  bindEvents();
  await loadData();
}

// ---- Data Loading ----
async function loadData() {
  try {
    const [rulesRes, configRes] = await Promise.all([
      sendMessage({ type: 'GET_RULES' }),
      sendMessage({ type: 'GET_CONFIG' }),
    ]);
    allRules = rulesRes.rules || [];
    globalEnabled = configRes.config?.enabled !== false;
    $('#globalToggle').checked = globalEnabled;
    applySearch();
    render();
  } catch (err) {
    console.error('loadData error:', err);
    $('#statusText').textContent = '加载失败，请检查扩展服务是否正常';
  }
}

// ---- Event Binding ----
function bindEvents() {
  $('#globalToggle').addEventListener('change', async () => {
    globalEnabled = $('#globalToggle').checked;
    await sendMessage({ type: 'TOGGLE_GLOBAL_ENABLED', enabled: globalEnabled });
    notifyAllTabs({ type: 'TOGGLE_ENABLED', enabled: globalEnabled });
  });

  $('#searchInput').addEventListener('input', debounce(() => {
    searchQuery = $('#searchInput').value.trim().toLowerCase();
    applySearch();
    render();
  }, 200));

  $('#btnAddRule').addEventListener('click', openAddModal);
  $('#btnExport').addEventListener('click', exportData);
  $('#btnImport').addEventListener('click', () => $('#importFileInput').click());
  $('#importFileInput').addEventListener('change', handleImport);

  $('#btnModalClose').addEventListener('click', closeModal);
  $('#btnCancelRule').addEventListener('click', closeModal);
  $('#ruleModal').addEventListener('click', (e) => { if (e.target === $('#ruleModal')) closeModal(); });

  $('#btnDeleteModalClose').addEventListener('click', closeDeleteModal);
  $('#btnCancelDelete').addEventListener('click', closeDeleteModal);
  $('#btnConfirmDelete').addEventListener('click', confirmDelete);
  $('#deleteModal').addEventListener('click', (e) => { if (e.target === $('#deleteModal')) closeDeleteModal(); });

  $('#btnAddHeader')?.addEventListener('click', addHeaderRow);
  $('#headersEditor')?.querySelectorAll('.btn-remove-header').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.closest('#headersEditor')?.children.length > 1) btn.closest('.header-row')?.remove();
    });
  });

  $('#btnSaveRule')?.addEventListener('click', saveRule);

  $('#btnSettings')?.addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });
}

// ---- Filtering ----
function applySearch() {
  if (!searchQuery) {
    filteredRules = [...allRules];
    return;
  }
  filteredRules = allRules.filter(rule =>
    (rule.name || '').toLowerCase().includes(searchQuery) ||
    (rule.urlPattern || rule.url || '').toLowerCase().includes(searchQuery) ||
    (rule.description || '').toLowerCase().includes(searchQuery)
  );
}

// ---- Rendering ----
function render() {
  const count = filteredRules.length;
  const total = allRules.length;
  $('#statusText').textContent = globalEnabled
    ? `${count} 条规则${searchQuery ? `（共 ${total}）` : ''}`
    : `已停用 · ${count} 条规则`;

  if (filteredRules.length === 0) {
    $('#ruleList').innerHTML = '';
    $('#emptyState').style.display = 'flex';
    return;
  }

  $('#emptyState').style.display = 'none';
  $('#ruleList').innerHTML = filteredRules.map(rule => renderRuleCard(rule)).join('');

  $('#ruleList').querySelectorAll('.rule-card').forEach(card => {
    const id = card.dataset.id;
    card.querySelector('.rule-toggle input')?.addEventListener('change', () => toggleRule(id));
    card.querySelector('.btn-edit')?.addEventListener('click', () => openEditModal(id));
    card.querySelector('.btn-delete')?.addEventListener('click', () => openDeleteModal(id));
    card.querySelector('.btn-copy')?.addEventListener('click', () => copyUrl(id));
  });
}

function renderRuleCard(rule) {
  const statusLabel = HTTP_STATUS_CODES.find(s => s.code === (rule.responseStatus || 200));
  const statusDisplay = statusLabel ? statusLabel.label : rule.responseStatus;
  const methodDisplay = rule.method === '*' ? 'ALL' : (rule.method || 'GET');

  return `
    <div class="rule-card ${rule.enabled ? 'matched' : 'disabled'}" data-id="${rule.id}">
      <div class="rule-card-left">
        <label class="toggle-switch rule-toggle" title="${rule.enabled ? '禁用规则' : '启用规则'}">
          <input type="checkbox" ${rule.enabled ? 'checked' : ''}>
          <span class="toggle-slider"></span>
        </label>
      </div>
      <div class="rule-card-body">
        <div class="rule-card-header">
          <span class="rule-name" title="${escapeHtml(rule.name)}">${escapeHtml(rule.name)}</span>
          <span class="rule-method ${methodDisplay === 'ALL' ? 'all' : ''}">${methodDisplay}</span>
        </div>
        <div class="rule-url" title="${escapeHtml(rule.urlPattern || rule.url)}">${escapeHtml(rule.urlPattern || rule.url)}</div>
        <div class="rule-meta">
          <span class="rule-status">${statusDisplay}</span>
          ${rule.delay ? `<span class="rule-delay">延迟 ${rule.delay}ms</span>` : ''}
        </div>
        ${rule.description ? `<div class="rule-description" title="${escapeHtml(rule.description)}">${escapeHtml(rule.description)}</div>` : ''}
      </div>
      <div class="rule-card-actions">
        <button class="rule-action-btn btn-copy" title="复制 URL">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
            <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/>
          </svg>
        </button>
        <button class="rule-action-btn btn-edit" title="编辑规则">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/>
            <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
          </svg>
        </button>
        <button class="rule-action-btn delete btn-delete" title="删除规则">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="3 6 5 6 21 6"/>
            <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/>
            <path d="M10 11v6M14 11v6"/>
            <path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/>
          </svg>
        </button>
      </div>
    </div>
  `;
}

// ---- Modal Operations ----
function openAddModal() {
  currentEditId = null;
  $('#modalTitle').textContent = '添加规则';
  resetForm();
  renderHeaders({ 'Content-Type': 'application/json' });
  initJsonEditor({});
  $('#ruleModal').style.display = 'flex';
  $('#ruleName')?.focus();
}

function openEditModal(id) {
  const rule = allRules.find(r => r.id === id);
  if (!rule) return;
  currentEditId = id;
  $('#modalTitle').textContent = '编辑规则';

  let bodyJson = {};
  if (rule.responseBody) {
    if (typeof rule.responseBody === 'string') {
      try { bodyJson = JSON.parse(rule.responseBody); } catch {}
    } else {
      bodyJson = rule.responseBody;
    }
  }

  $$('#ruleModal input:not([type="checkbox"])').forEach(el => el.value = '');
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
  destroyJsonEditor();
  $('#ruleModal').style.display = 'none';
  currentEditId = null;
}

function resetForm() {
  $$('#ruleModal input:not([type="checkbox"])').forEach(el => el.value = '');
  if ($('#ruleStatus')) $('#ruleStatus').value = 200;
  if ($('#ruleDelay')) $('#ruleDelay').value = 0;
  if ($('#ruleMethod')) $('#ruleMethod').value = '*';
}

// ---- Headers Editor ----
function renderHeaders(headers = {}) {
  const editor = $('#headersEditor');
  if (!editor) return;
  editor.innerHTML = '';
  const entries = Object.entries(headers);
  if (entries.length === 0) entries.push(['Content-Type', 'application/json']);
  entries.forEach(([key, val]) => {
    const row = document.createElement('div');
    row.className = 'header-row';
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
  if (!editor) return;
  const row = document.createElement('div');
  row.className = 'header-row';
  row.innerHTML = `
    <input type="text" class="header-key" placeholder="Header Name" value="">
    <input type="text" class="header-val" placeholder="Header Value" value="">
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
    const key = row.querySelector('.header-key')?.value.trim();
    const val = row.querySelector('.header-val')?.value.trim();
    if (key) headers[key] = val;
  });
  return headers;
}

// ---- Save Rule ----
async function saveRule() {
  const name = $('#ruleName')?.value.trim();
  const url = $('#ruleUrl')?.value.trim();

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
    method: $('#ruleMethod')?.value || '*',
    responseStatus: parseInt($('#ruleStatus')?.value) || 200,
    responseBody,
    responseHeaders: collectHeaders(),
    delay: parseInt($('#ruleDelay')?.value) || 0,
    description: $('#ruleDescription')?.value.trim() || '',
  };

  if (currentEditId) {
    await sendMessage({ type: 'UPDATE_RULE', id: currentEditId, updates: ruleData });
    const idx = allRules.findIndex(r => r.id === currentEditId);
    if (idx !== -1) allRules[idx] = { ...allRules[idx], ...ruleData };
  } else {
    const newRule = {
      ...ruleData,
      id: `rule_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      enabled: true,
      createdAt: Date.now(),
    };
    await sendMessage({ type: 'ADD_RULE', rule: newRule });
    allRules.push(newRule);
  }

  applySearch();
  render();
  closeModal();
  notifyAllTabs({ type: 'REFRESH_RULES' });
}

// ---- Delete ----
function openDeleteModal(id) {
  const rule = allRules.find(r => r.id === id);
  if (!rule) return;
  currentDeleteId = id;
  if ($('#deleteRuleName')) $('#deleteRuleName').textContent = rule.name;
  $('#deleteModal').style.display = 'flex';
}

function closeDeleteModal() {
  $('#deleteModal').style.display = 'none';
  currentDeleteId = null;
}

async function confirmDelete() {
  if (!currentDeleteId) return;
  await sendMessage({ type: 'DELETE_RULE', id: currentDeleteId });
  allRules = allRules.filter(r => r.id !== currentDeleteId);
  applySearch();
  render();
  closeDeleteModal();
  notifyAllTabs({ type: 'REFRESH_RULES' });
}

// ---- Toggle Rule ----
async function toggleRule(id) {
  await sendMessage({ type: 'TOGGLE_RULE', id });
  const rule = allRules.find(r => r.id === id);
  if (rule) rule.enabled = !rule.enabled;
  applySearch();
  render();
  notifyAllTabs({ type: 'REFRESH_RULES' });
}

// ---- JSON Editor ----
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

// ---- Copy URL ----
function copyUrl(id) {
  const rule = allRules.find(r => r.id === id);
  if (!rule) return;
  navigator.clipboard.writeText(rule.urlPattern || rule.url || '').catch(() => {});
}

// ---- Import / Export ----
async function exportData() {
  const res = await sendMessage({ type: 'EXPORT_DATA' });
  const blob = new Blob([JSON.stringify(res.data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `response-mock-rules-${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

async function handleImport() {
  const file = $('#importFileInput').files[0];
  if (!file) return;
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    await sendMessage({ type: 'IMPORT_DATA', data });
    await loadData();
    notifyAllTabs({ type: 'REFRESH_RULES' });
  } catch {
    alert('导入失败：文件格式错误');
  }
  $('#importFileInput').value = '';
}

// ---- Helpers ----
function sendMessage(msg) {
  return new Promise(resolve => {
    const timer = setTimeout(() => resolve({}), 5000);
    try {
      chrome.runtime.sendMessage(msg, res => {
        clearTimeout(timer);
        resolve(res || {});
      });
    } catch {
      clearTimeout(timer);
      resolve({});
    }
  });
}

function notifyAllTabs(msg) {
  chrome.tabs.query({}).then(tabs => {
    tabs.forEach(tab => {
      if (tab.id && tab.url && !tab.url.startsWith('chrome://')) {
        chrome.tabs.sendMessage(tab.id, msg).catch(() => {});
      }
    });
  });
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function debounce(fn, delay) {
  let timer;
  return function (...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), delay);
  };
}
