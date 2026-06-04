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

// JSON Field Search state
let jsonSearchResults = [];
let jsonSearchResultIndex = -1;
let jsonSearchDropdownActiveIndex = -1;
let _searchPinned = false;
let _scrollThreshold = null;
let _searchScrollHandler = null;

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

  // JSON Field Search
  $('#jsonFieldSearch')?.addEventListener('input', debounce(handleJsonSearchInput, 150));
  $('#jsonFieldSearch')?.addEventListener('keydown', handleJsonSearchKeydown);
  $('#jsonFieldSearch')?.addEventListener('focus', handleJsonSearchFocus);
  $('#jsonFieldSearch')?.addEventListener('blur', handleJsonSearchBlur);
  $('#jsonSearchClear')?.addEventListener('click', clearJsonSearch);
  $('#jsonSearchPrev')?.addEventListener('click', () => navigateJsonSearch(-1));
  $('#jsonSearchNext')?.addEventListener('click', () => navigateJsonSearch(1));

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
  clearJsonSearch();
  _searchPinned = false;
  _scrollThreshold = null;
  $('#ruleModal').style.display = 'flex';
  setupSearchScroll();
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
  clearJsonSearch();
  _searchPinned = false;
  _scrollThreshold = null;
  $('#ruleModal').style.display = 'flex';
  setupSearchScroll();
}

function closeModal() {
  _searchPinned = false;
  _scrollThreshold = null;
  const wrap = $('#jsonSearchWrap');
  if (wrap) {
    const bar = wrap.querySelector('.json-search-bar');
    if (bar) { bar.style.position = ''; bar.style.top = ''; bar.style.left = ''; bar.style.width = ''; }
    wrap.classList.remove('is-pinned');
    const ph = wrap.querySelector('.json-search-placeholder');
    if (ph) ph.remove();
  }
  const modalBody = $('#ruleModal')?.querySelector('.modal-body');
  if (modalBody && _searchScrollHandler) {
    modalBody.removeEventListener('scroll', _searchScrollHandler);
    _searchScrollHandler = null;
  }
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
        mainMenuBar: true,
        navigationBar: true,
        statusBar: false,
        indentation: 2,
        tabSize: 2,
        askToFormat: false,
        onRenderMenu: (renderMenuProps, defaultMenuItems) => {
          try {
            return defaultMenuItems.filter(item =>
              item.title === 'Search' ||
              item.title === 'Format' ||
              item.title === 'Sort' ||
              item.title === 'Transform'
            );
          } catch {
            return defaultMenuItems;
          }
        },
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

// ---- JSON Field Search (auto-pins below modal-header after scroll) ----
function syncSearchPin() {
  const wrap = $('#jsonSearchWrap');
  const bar = wrap?.querySelector('.json-search-bar');
  const modalBody = $('#ruleModal')?.querySelector('.modal-body');
  const modal = $('#ruleModal')?.querySelector('.modal');
  if (!wrap || !bar || !modalBody || !modal) return;

  const st = modalBody.scrollTop;
  const headerH = (modal.querySelector('.modal-header')?.offsetHeight ?? 0);
  const stickY = modal.getBoundingClientRect().top + headerH;
  const wrapTop = wrap.getBoundingClientRect().top;

  if (!_searchPinned && st > 0 && wrapTop <= stickY) {
    _searchPinned = true;
    _scrollThreshold = st;
    const bodyRect = modalBody.getBoundingClientRect();
    wrap.classList.add('is-pinned');
    if (!wrap.querySelector('.json-search-placeholder')) {
      const ph = document.createElement('div');
      ph.className = 'json-search-placeholder';
      wrap.insertBefore(ph, wrap.firstChild);
    }
    wrap.querySelector('.json-search-placeholder').style.height = wrap.offsetHeight + 'px';
    bar.style.position = 'fixed';
    bar.style.top = stickY + 'px';
    bar.style.left = bodyRect.left + 'px';
    bar.style.width = bodyRect.width + 'px';
  } else if (_searchPinned && st <= _scrollThreshold) {
    _searchPinned = false;
    _scrollThreshold = null;
    wrap.classList.remove('is-pinned');
    bar.style.position = '';
    bar.style.top = '';
    bar.style.left = '';
    bar.style.width = '';
    const ph = wrap.querySelector('.json-search-placeholder');
    if (ph) ph.remove();
  }
}

function setupSearchScroll() {
  const modalBody = $('#ruleModal')?.querySelector('.modal-body');
  if (!modalBody) return;
  if (_searchScrollHandler) modalBody.removeEventListener('scroll', _searchScrollHandler);
  _searchScrollHandler = () => syncSearchPin();
  modalBody.addEventListener('scroll', _searchScrollHandler, { passive: true });
}

function handleJsonSearchInput() {
  const query = ($('#jsonFieldSearch')?.value || '').trim();
  const dropdown = $('#jsonSearchDropdown');
  const countEl = $('#jsonSearchCount');
  const prevBtn = $('#jsonSearchPrev');
  const nextBtn = $('#jsonSearchNext');
  const clearBtn = $('#jsonSearchClear');

  if (clearBtn) clearBtn.style.display = query ? 'flex' : 'none';

  if (!query) {
    jsonSearchResults = [];
    jsonSearchResultIndex = -1;
    hideDropdown();
    updateSearchNavButtons();
    return;
  }

  let json;
  try {
    const content = jsonEditorInstance?.get?.();
    json = content?.json || null;
  } catch {
    json = null;
  }

  if (!json) {
    jsonSearchResults = [];
    jsonSearchResultIndex = -1;
    renderDropdown(query, []);
    updateSearchNavButtons();
    return;
  }

  const results = searchJsonFields(json, query);
  jsonSearchResults = results;
  jsonSearchResultIndex = results.length > 0 ? 0 : -1;
  jsonSearchDropdownActiveIndex = -1;

  renderDropdown(query, results);
  showDropdown();
  updateSearchNavButtons();

  if (results.length > 0) {
    scrollToJsonPath(results[0].path);
  }
}

function handleJsonSearchFocus() {
  const query = ($('#jsonFieldSearch')?.value || '').trim();
  if (query && jsonSearchResults.length > 0) {
    showDropdown();
  }
}

function handleJsonSearchBlur() {
  setTimeout(() => hideDropdown(), 200);
}

function handleJsonSearchKeydown(event) {
  const dropdown = $('#jsonSearchDropdown');
  const isOpen = dropdown && dropdown.classList.contains('visible');

  if (event.key === 'ArrowDown') {
    event.preventDefault();
    if (isOpen) {
      jsonSearchDropdownActiveIndex = Math.min(jsonSearchDropdownActiveIndex + 1, jsonSearchResults.length - 1);
      renderDropdownItems();
      scrollDropdownToActive();
    } else if (jsonSearchResults.length > 0) {
      showDropdown();
      jsonSearchDropdownActiveIndex = 0;
      renderDropdownItems();
    }
    return;
  }

  if (event.key === 'ArrowUp') {
    event.preventDefault();
    if (isOpen) {
      jsonSearchDropdownActiveIndex = Math.max(jsonSearchDropdownActiveIndex - 1, 0);
      renderDropdownItems();
      scrollDropdownToActive();
    }
    return;
  }

  if (event.key === 'Escape') {
    hideDropdown();
    $('#jsonFieldSearch')?.blur();
    return;
  }

  if (event.key === 'Enter') {
    event.preventDefault();
    if (isOpen && jsonSearchDropdownActiveIndex >= 0 && jsonSearchDropdownActiveIndex < jsonSearchResults.length) {
      selectSearchResult(jsonSearchDropdownActiveIndex);
    } else {
      navigateJsonSearch(event.shiftKey ? -1 : 1);
    }
    return;
  }
}

function navigateJsonSearch(direction) {
  if (jsonSearchResults.length === 0) return;
  jsonSearchResultIndex = (jsonSearchResultIndex + direction + jsonSearchResults.length) % jsonSearchResults.length;
  const result = jsonSearchResults[jsonSearchResultIndex];
  scrollToJsonPath(result.path);
  updateSearchNavButtons();
  const countEl = $('#jsonSearchCount');
  if (countEl) countEl.textContent = `${jsonSearchResultIndex + 1}/${jsonSearchResults.length}`;
}

function selectSearchResult(index) {
  if (index < 0 || index >= jsonSearchResults.length) return;
  jsonSearchResultIndex = index;
  const result = jsonSearchResults[index];
  scrollToJsonPath(result.path);
  hideDropdown();
  updateSearchNavButtons();
  const countEl = $('#jsonSearchCount');
  if (countEl) countEl.textContent = `${jsonSearchResultIndex + 1}/${jsonSearchResults.length}`;
}

function clearJsonSearch() {
  const input = $('#jsonFieldSearch');
  if (input) input.value = '';
  const countEl = $('#jsonSearchCount');
  if (countEl) countEl.textContent = '';
  const clearBtn = $('#jsonSearchClear');
  if (clearBtn) clearBtn.style.display = 'none';
  jsonSearchResults = [];
  jsonSearchResultIndex = -1;
  jsonSearchDropdownActiveIndex = -1;
  hideDropdown();
  updateSearchNavButtons();
}

function showDropdown() {
  const dropdown = $('#jsonSearchDropdown');
  if (dropdown) dropdown.classList.add('visible');
}

function hideDropdown() {
  const dropdown = $('#jsonSearchDropdown');
  if (dropdown) dropdown.classList.remove('visible');
  jsonSearchDropdownActiveIndex = -1;
}

function renderDropdown(query, results) {
  const dropdown = $('#jsonSearchDropdown');
  if (!dropdown) return;

  if (!query) {
    dropdown.innerHTML = '';
    dropdown.classList.remove('visible');
    return;
  }

  if (results.length === 0) {
    dropdown.innerHTML = `<div class="json-search-empty">无匹配字段</div>`;
    dropdown.classList.add('visible');
    return;
  }

  dropdown.innerHTML = results.slice(0, 50).map((r, i) => {
    const pathStr = r.path.map((p, idx) => {
      if (typeof p === 'number') return `[${p}]`;
      if (idx === 0) return p;
      return `.${p}`;
    }).join('');

    const valuePreview = formatValuePreview(r.value);
    const typeTag = getValueTypeTag(r.value);

    return `
      <div class="json-search-item ${i === jsonSearchDropdownActiveIndex ? 'active' : ''}" data-index="${i}">
        <span class="json-search-item-path">${escapeHtml(pathStr)}</span>
        ${typeTag ? `<span class="json-search-item-type">${typeTag}</span>` : ''}
        ${valuePreview ? `<span class="json-search-item-value">${escapeHtml(valuePreview)}</span>` : ''}
      </div>
    `;
  }).join('');

  dropdown.querySelectorAll('.json-search-item').forEach(item => {
    item.addEventListener('mouseenter', () => {
      jsonSearchDropdownActiveIndex = parseInt(item.dataset.index);
      renderDropdownItems();
    });
    item.addEventListener('mousedown', (e) => {
      e.preventDefault();
      selectSearchResult(parseInt(item.dataset.index));
    });
  });

  dropdown.classList.add('visible');
}

function renderDropdownItems() {
  const dropdown = $('#jsonSearchDropdown');
  if (!dropdown) return;
  dropdown.querySelectorAll('.json-search-item').forEach((item, i) => {
    item.classList.toggle('active', i === jsonSearchDropdownActiveIndex);
  });
}

function scrollDropdownToActive() {
  const dropdown = $('#jsonSearchDropdown');
  if (!dropdown) return;
  const active = dropdown.querySelector('.json-search-item.active');
  if (active) active.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

function updateSearchNavButtons() {
  const prevBtn = $('#jsonSearchPrev');
  const nextBtn = $('#jsonSearchNext');
  const hasResults = jsonSearchResults.length > 0;
  if (prevBtn) prevBtn.disabled = !hasResults;
  if (nextBtn) nextBtn.disabled = !hasResults;
}

function searchJsonFields(obj, query, path = []) {
  const results = [];
  const lowerQuery = query.toLowerCase();

  if (Array.isArray(obj)) {
    obj.forEach((item, index) => {
      const itemPath = [...path, index];
      const itemResults = searchJsonFields(item, query, itemPath);
      results.push(...itemResults);
    });
  } else if (obj && typeof obj === 'object') {
    for (const [key, value] of Object.entries(obj)) {
      const keyPath = [...path, key];

      if (key.toLowerCase().includes(lowerQuery)) {
        results.push({ path: keyPath, matchType: 'key', key, value });
      }

      const valueResults = searchJsonFields(value, query, keyPath);
      results.push(...valueResults);
    }
  } else {
    const strValue = String(obj);
    if (strValue.toLowerCase().includes(lowerQuery)) {
      results.push({ path, matchType: 'value', key: path[path.length - 1], value: obj });
    }
  }

  return results;
}

function scrollToJsonPath(path) {
  if (!jsonEditorInstance) return;
  try {
    const parsedPath = path.map(p => typeof p === 'string' ? p : String(p));
    if (jsonEditorInstance.expand) {
      jsonEditorInstance.expand(parsedPath, () => true);
    }
    try {
      jsonEditorInstance.select?.({ type: 'value', path: parsedPath });
    } catch {}
    try {
      const el = jsonEditorInstance.findElement?.(parsedPath);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } catch {}
  } catch {}
}

function formatValuePreview(value) {
  if (value === null) return 'null';
  if (value === undefined) return '';
  if (typeof value === 'boolean') return String(value);
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string') {
    if (value.length > 30) return `"${value.slice(0, 30)}…"`;
    return `"${value}"`;
  }
  if (Array.isArray(value)) return `Array[${value.length}]`;
  if (typeof value === 'object') return `Object{${Object.keys(value).length}}`;
  return '';
}

function getValueTypeTag(value) {
  if (value === null) return 'null';
  if (typeof value === 'string') return 'string';
  if (typeof value === 'number') return 'number';
  if (typeof value === 'boolean') return 'boolean';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'object') return 'object';
  return '';
}

function debounce(fn, delay) {
  let timer;
  return function (...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), delay);
  };
}
