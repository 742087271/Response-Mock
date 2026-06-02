// ============ Popup 主脚本 ============
import { HTTP_STATUS_CODES } from '../shared/constants.js';

// ---- State ----
let allRules = [];
let filteredRules = [];
let currentEditId = null;
let currentDeleteId = null;
let searchQuery = '';
let globalEnabled = true;

// ---- DOM Elements ----
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const globalToggle = $('#globalToggle');
const searchInput = $('#searchInput');
const ruleList = $('#ruleList');
const emptyState = $('#emptyState');
const statusText = $('#statusText');
const ruleModal = $('#ruleModal');
const deleteModal = $('#deleteModal');
const importFileInput = $('#importFileInput');

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
    globalToggle.checked = globalEnabled;
    applySearch();
    render();
  } catch (err) {
    console.error('loadData error:', err);
    statusText.textContent = '加载失败，请检查扩展服务是否正常';
  }
}

// ---- Event Binding ----
function bindEvents() {
  // 全局开关
  globalToggle.addEventListener('change', async () => {
    globalEnabled = globalToggle.checked;
    await sendMessage({ type: 'TOGGLE_GLOBAL_ENABLED', enabled: globalEnabled });
    // 通知内容脚本
    notifyAllTabs({ type: 'TOGGLE_ENABLED', enabled: globalEnabled });
  });

  // 搜索
  searchInput.addEventListener('input', debounce(() => {
    searchQuery = searchInput.value.trim().toLowerCase();
    applySearch();
    render();
  }, 200));

  // 添加规则
  $('#btnAddRule').addEventListener('click', openAddModal);

  // 设置按钮 → 打开选项页
  $('#btnSettings').addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });

  // 导出
  $('#btnExport').addEventListener('click', exportData);

  // 导入
  $('#btnImport').addEventListener('click', () => importFileInput.click());
  importFileInput.addEventListener('change', handleImport);

  // Modal 事件
  $('#btnModalClose').addEventListener('click', closeModal);
  $('#btnCancelRule').addEventListener('click', closeModal);
  ruleModal.addEventListener('click', (e) => {
    if (e.target === ruleModal) closeModal();
  });

  // 删除确认 Modal
  $('#btnDeleteModalClose').addEventListener('click', closeDeleteModal);
  $('#btnCancelDelete').addEventListener('click', closeDeleteModal);
  $('#btnConfirmDelete').addEventListener('click', confirmDelete);
  deleteModal.addEventListener('click', (e) => {
    if (e.target === deleteModal) closeDeleteModal();
  });

  // JSON 操作
  $('#btnFormatJson').addEventListener('click', () => formatJson('format'));
  $('#btnMinifyJson').addEventListener('click', () => formatJson('minify'));
  $('#btnPasteResponse').addEventListener('click', pasteResponse);

  // 保存规则
  $('#btnSaveRule').addEventListener('click', saveRule);

  // 实时 JSON 校验
  $('#ruleBody').addEventListener('input', validateJson);
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
  statusText.textContent = globalEnabled
    ? `${count} 条规则${searchQuery ? `（共 ${total}）` : ''}`
    : `已停用 · ${count} 条规则`;

  if (filteredRules.length === 0) {
    ruleList.innerHTML = '';
    emptyState.style.display = 'flex';
    return;
  }

  emptyState.style.display = 'none';
  ruleList.innerHTML = filteredRules.map(rule => renderRuleCard(rule)).join('');

  // 绑定卡片事件
  ruleList.querySelectorAll('.rule-card').forEach(card => {
    const id = card.dataset.id;

    // 启用/禁用 toggle
    const toggle = card.querySelector('.rule-toggle input');
    if (toggle) {
      toggle.addEventListener('change', () => toggleRule(id));
    }

    // 编辑
    const editBtn = card.querySelector('.btn-edit');
    if (editBtn) editBtn.addEventListener('click', () => openEditModal(id));

    // 删除
    const deleteBtn = card.querySelector('.btn-delete');
    if (deleteBtn) deleteBtn.addEventListener('click', () => openDeleteModal(id));

    // 复制 URL
    const copyBtn = card.querySelector('.btn-copy');
    if (copyBtn) copyBtn.addEventListener('click', () => copyUrl(id));
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
  ruleModal.style.display = 'flex';
  $('#ruleName').focus();
}

function openEditModal(id) {
  const rule = allRules.find(r => r.id === id);
  if (!rule) return;
  currentEditId = id;
  $('#modalTitle').textContent = '编辑规则';

  $('#ruleName').value = rule.name || '';
  $('#ruleMethod').value = rule.method || '*';
  $('#ruleStatus').value = rule.responseStatus || 200;
  $('#ruleUrl').value = rule.urlPattern || rule.url || '';
  $('#ruleDelay').value = rule.delay || 0;
  $('#ruleBody').value = typeof rule.responseBody === 'string'
    ? tryPrettyJson(rule.responseBody)
    : JSON.stringify(rule.responseBody, null, 2);
  $('#ruleDescription').value = rule.description || '';

  validateJson();
  ruleModal.style.display = 'flex';
}

function closeModal() {
  ruleModal.style.display = 'none';
  currentEditId = null;
  resetForm();
}

function resetForm() {
  $$('#ruleModal input, #ruleModal textarea').forEach(el => {
    if (el.type === 'checkbox') return;
    el.value = '';
  });
  $('#ruleStatus').value = 200;
  $('#ruleDelay').value = 0;
  $('#ruleMethod').value = 'GET';
  $('#jsonError').style.display = 'none';
}

async function saveRule() {
  const name = $('#ruleName').value.trim();
  const url = $('#ruleUrl').value.trim();
  const body = $('#ruleBody').value;

  if (!name) { alert('请输入规则名称'); return; }
  if (!url) { alert('请输入 URL 匹配规则'); return; }
  if (!isValidJson(body)) {
    showJsonError('JSON 格式不正确，请检查');
    return;
  }

  const ruleData = {
    name,
    urlPattern: url,
    method: $('#ruleMethod').value,
    responseStatus: parseInt($('#ruleStatus').value) || 200,
    responseBody: tryMinifyJson(body),
    responseHeaders: { 'Content-Type': 'application/json' },
    delay: parseInt($('#ruleDelay').value) || 0,
    description: $('#ruleDescription').value.trim(),
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
  $('#deleteRuleName').textContent = rule.name;
  deleteModal.style.display = 'flex';
}

function closeDeleteModal() {
  deleteModal.style.display = 'none';
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

// ---- JSON Utils ----
function validateJson() {
  const body = $('#ruleBody').value;
  const errorEl = $('#jsonError');
  if (!body.trim()) {
    errorEl.style.display = 'none';
    return true;
  }
  if (isValidJson(body)) {
    errorEl.style.display = 'none';
    return true;
  }
  showJsonError('JSON 格式不正确');
  return false;
}

function showJsonError(msg) {
  const errorEl = $('#jsonError');
  errorEl.textContent = msg;
  errorEl.style.display = 'block';
}

function formatJsonBody() {
  const textarea = $('#ruleBody');
  try {
    textarea.value = JSON.stringify(JSON.parse(textarea.value), null, 2);
    $('#jsonError').style.display = 'none';
  } catch {
    showJsonError('无法格式化：JSON 格式不正确');
  }
}

function minifyJsonBody() {
  const textarea = $('#ruleBody');
  try {
    textarea.value = JSON.stringify(JSON.parse(textarea.value));
  } catch {
    showJsonError('无法压缩：JSON 格式不正确');
  }
}

function formatJson(action) {
  if (action === 'format') formatJsonBody();
  else minifyJsonBody();
}

function tryPrettyJson(str) {
  try { return JSON.stringify(JSON.parse(str), null, 2); }
  catch { return str; }
}

function tryMinifyJson(str) {
  try { return JSON.stringify(JSON.parse(str)); }
  catch { return str; }
}

function isValidJson(str) {
  if (!str || !str.trim()) return true; // 空值允许
  try { JSON.parse(str); return true; }
  catch { return false; }
}

// ---- Paste Response from Clipboard ----
async function pasteResponse() {
  try {
    const text = await navigator.clipboard.readText();
    if (!text) { alert('剪贴板为空'); return; }
    // 尝试格式化 JSON
    let formatted;
    try {
      formatted = JSON.stringify(JSON.parse(text), null, 2);
    } catch {
      formatted = text; // 不是 JSON，直接填入
    }
    $('#ruleBody').value = formatted;
    validateJson();
  } catch (e) {
    alert('粘贴失败，请检查浏览器权限设置');
  }
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
  const file = importFileInput.files[0];
  if (!file) return;
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    await sendMessage({ type: 'IMPORT_DATA', data });
    await loadData();
    notifyAllTabs({ type: 'REFRESH_RULES' });
  } catch (e) {
    alert('导入失败：文件格式错误');
  }
  importFileInput.value = '';
}

// ---- Helpers ----
function sendMessage(msg) {
  return new Promise(resolve => {
    const timer = setTimeout(() => {
      resolve({}); // 超时返回空对象
    }, 5000);
    chrome.runtime.sendMessage(msg, res => {
      clearTimeout(timer);
      resolve(res || {});
    });
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
