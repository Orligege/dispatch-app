/* ==========================================================
   BN 派工管理系統 - 主程式（Google Sheets 雲端版）
   ========================================================== */

// ⭐ 你的 Google Apps Script 部署網址
// 如果之後重新部署需要換 URL，把這行改掉就好
const API_URL = 'https://script.google.com/macros/s/AKfycbyd-4qkCT8uiuOHI9ogAxHEJiwC7HE_hB7qv7HSN_Aw-EgHERLXENstweniDHE368c-/exec';

// ⭐ API Token（要跟 Apps Script 那邊設定的一致）
const API_TOKEN = 'jXJep5hy82PpeUTjtZoqE1jrvBzyMfhXXfRL9niKjmIZiaTF15L0JeycFRxH7C_E';

const STORAGE_KEY = 'bn_dispatch_cloud_v1';
const PAGE_SIZE = 50;
const TRASH_RETENTION_DAYS = 30;

// ---------- 區塊設定（未來新增區塊時，在這裡加） ----------
const SECTIONS = {
  bn:   { name: 'BN 派工' },
  copy: { name: '文案派工' },
};
let activeSection = localStorage.getItem('bn_active_section') || 'bn';

// ---------- State ----------
let state = {
  // BN 派工
  tasks: [],
  trash: [],          // 本地獨有：每人各自的「最近刪除」
  importHistory: [],  // 本地獨有：每人各自的匯入紀錄
  // 文案派工
  copyTasks: [],
  copyTrash: [],
  copyImportHistory: [],
  // 共用
  dispatchers: [],
  creators: [],
};
let editingId = null;
let currentView = 'table';
let currentPage = 1;
let sortKey = 'dispatchDate';
let sortDir = 'desc';
let peopleManagerType = 'creator';
let hoursChart = null;
let countChart = null;
let currentCalendarMonth = new Date(); // 日曆目前顯示的月份

// ---------- API 呼叫 ----------
async function api(action, params = {}) {
  const formData = new URLSearchParams();
  formData.append('action', action);
  formData.append('token', API_TOKEN);   // ⭐ 每次呼叫都帶 token
  for (const [k, v] of Object.entries(params)) {
    formData.append(k, typeof v === 'string' ? v : JSON.stringify(v));
  }
  const res = await fetch(API_URL, { method: 'POST', body: formData });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  if (!json.ok) throw new Error(json.error || '未知錯誤');
  return json.data;
}

// ---------- 連線狀態指示燈 ----------
function setSyncStatus(s) {
  document.querySelectorAll('.sync-status').forEach(el => {
    el.classList.remove('syncing', 'ok', 'error');
    el.classList.add(s);
    el.title = ({
      syncing: '同步中...',
      ok: '已連線雲端',
      error: '連線失敗（離線模式）',
    })[s] || '';
  });
}

// ---------- 持久化（本地快取） ----------
function loadLocal() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const cached = JSON.parse(raw);
      state.tasks = cached.tasks || [];
      state.dispatchers = cached.dispatchers || [];
      state.creators = cached.creators || [];
      state.trash = cached.trash || [];
      state.importHistory = cached.importHistory || [];
      state.copyTasks = cached.copyTasks || [];
      state.copyTrash = cached.copyTrash || [];
      state.copyImportHistory = cached.copyImportHistory || [];
      cleanOldTrash();
      return true;
    }
  } catch (e) { console.warn('local load failed', e); }
  return false;
}

function saveLocal() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      tasks: state.tasks,
      dispatchers: state.dispatchers,
      creators: state.creators,
      trash: state.trash,
      importHistory: state.importHistory,
      copyTasks: state.copyTasks,
      copyTrash: state.copyTrash,
      copyImportHistory: state.copyImportHistory,
    }));
  } catch (e) { console.warn('local save failed', e); }
}

async function loadFromCloud() {
  setSyncStatus('syncing');
  try {
    // 同時抓 BN 和文案派工
    const [bnData, copyData] = await Promise.all([
      api('getAll', { sheet: 'tasks' }),
      api('getAll', { sheet: 'copy_tasks' }),
    ]);
    state.tasks = bnData.tasks || [];
    state.dispatchers = bnData.dispatchers || [];
    state.creators = bnData.creators || [];
    state.copyTasks = copyData.tasks || [];
    saveLocal();
    setSyncStatus('ok');
    return true;
  } catch (err) {
    console.error('Cloud load failed', err);
    setSyncStatus('error');
    return false;
  }
}

function cleanOldTrash() {
  const cutoff = Date.now() - TRASH_RETENTION_DAYS * 86400000;
  state.trash = state.trash.filter(item =>
    new Date(item.deletedAt).getTime() > cutoff
  );
  state.copyTrash = state.copyTrash.filter(item =>
    new Date(item.deletedAt).getTime() > cutoff
  );
}

// ---------- 主題 ----------
function toggleTheme() {
  const cur = document.body.getAttribute('data-theme');
  const next = cur === 'dark' ? '' : 'dark';
  document.body.setAttribute('data-theme', next);
  document.getElementById('theme-toggle').textContent = next === 'dark' ? '☀️' : '🌙';
  localStorage.setItem('bn_theme', next);
  renderCharts();
}
function loadTheme() {
  const t = localStorage.getItem('bn_theme') || '';
  document.body.setAttribute('data-theme', t);
  document.getElementById('theme-toggle').textContent = t === 'dark' ? '☀️' : '🌙';
}

// ---------- 工具 ----------
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function showMsg(text, isError = true) {
  const el = document.getElementById('form-msg');
  el.textContent = text;
  el.style.color = isError ? 'var(--danger)' : 'var(--done)';
  setTimeout(() => { if (el.textContent === text) el.textContent = ''; }, 2500);
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function formatDateShort(s) {
  if (!s) return '';
  const d = new Date(s);
  if (isNaN(d)) return s;
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

// 表格用的日期格式：永遠只顯示 MM-DD
function formatTableDate(s) {
  if (!s) return '';
  const parts = s.split('-');
  if (parts.length === 3) return `${parts[1]}-${parts[2]}`;
  return s;
}

function isOverdue(t) {
  if (t.status === 'done') return false;
  if (!t.dueDate) return false;
  return t.dueDate < todayStr();
}

// 計算兩日期間的工作天數（不含週末，不含起算日）
function workingDaysBetween(startStr, endStr) {
  if (!startStr || !endStr) return Infinity;
  const start = new Date(startStr);
  const end = new Date(endStr);
  if (isNaN(start) || isNaN(end)) return Infinity;
  if (end < start) return 0;
  let count = 0;
  const cur = new Date(start);
  cur.setDate(cur.getDate() + 1);
  while (cur <= end) {
    const day = cur.getDay();
    if (day !== 0 && day !== 6) count++;
    cur.setDate(cur.getDate() + 1);
  }
  return count;
}

function isUrgent(t) {
  if (!t.dispatchDate || !t.dueDate) return false;
  return workingDaysBetween(t.dispatchDate, t.dueDate) <= 3;
}

function statusLabel(s) {
  return { pending: '待派工', done: '完成' }[s] || s;
}

function getMonthOf(dateStr) {
  if (!dateStr || dateStr.length < 7) return '';
  return dateStr.slice(0, 7);
}

function formatMonth(m) {
  if (!m) return '';
  const [y, mo] = m.split('-');
  return `${y}年${parseInt(mo)}月`;
}

// 製作人配色 index（同名永遠同色）
function getCreatorColorIndex(name) {
  if (!name) return -1;
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return Math.abs(hash) % 6;
}

// ---------- 下拉選單刷新 ----------
function refreshDropdowns() {
  const dispOpts = '<option value="">未指定</option>' +
    state.dispatchers.map(a => `<option value="${escapeHtml(a)}">${escapeHtml(a)}</option>`).join('');
  const creOpts = '<option value="">未指派</option>' +
    state.creators.map(a => `<option value="${escapeHtml(a)}">${escapeHtml(a)}</option>`).join('');

  // BN 表單
  const dispSel = document.getElementById('f-dispatcher');
  const creSel = document.getElementById('f-creator');
  const filterCre = document.getElementById('filter-creator');
  if (dispSel && creSel && filterCre) {
    const cur = { d: dispSel.value, c: creSel.value, fc: filterCre.value };
    dispSel.innerHTML = dispOpts;
    creSel.innerHTML = creOpts;
    filterCre.innerHTML = '<option value="">全部製作人</option>' +
      state.creators.map(a => `<option value="${escapeHtml(a)}">${escapeHtml(a)}</option>`).join('') +
      '<option value="__none__">未指派</option>';
    dispSel.value = cur.d;
    creSel.value = cur.c;
    filterCre.value = cur.fc;
  }

  // 文案派工表單
  const copyCreSel = document.getElementById('f-copy-creator');
  const copyFilterCre = document.getElementById('copy-filter-creator');
  if (copyCreSel && copyFilterCre) {
    const cur = { c: copyCreSel.value, fc: copyFilterCre.value };
    copyCreSel.innerHTML = creOpts;
    copyFilterCre.innerHTML = '<option value="">全部製作人</option>' +
      state.creators.map(a => `<option value="${escapeHtml(a)}">${escapeHtml(a)}</option>`).join('') +
      '<option value="__none__">未指派</option>';
    copyCreSel.value = cur.c;
    copyFilterCre.value = cur.fc;
  }
}

function refreshMonthFilter() {
  const sel = document.getElementById('filter-month');
  const cur = sel.value;
  const months = new Set();
  state.tasks.forEach(t => {
    const m = getMonthOf(t.dispatchDate);
    if (m) months.add(m);
  });
  const sorted = Array.from(months).sort().reverse();
  sel.innerHTML = '<option value="">全部月份</option>' +
    sorted.map(m => `<option value="${m}">${formatMonth(m)}</option>`).join('');
  if (sorted.includes(cur)) sel.value = cur;
}

// ---------- CRUD（雲端同步） ----------
async function submitTask() {
  const bnCategory = document.getElementById('f-bnCategory').value.trim();
  if (!bnCategory) { showMsg('請輸入 BN 類別 / 名稱'); return; }

  const data = {
    dispatchDate: document.getElementById('f-dispatchDate').value || '',
    majorCategory: document.getElementById('f-majorCategory').value,
    bnCategory,
    bnSize: document.getElementById('f-bnSize').value.trim(),
    bnContent: document.getElementById('f-bnContent').value.trim(),
    dispatcher: document.getElementById('f-dispatcher').value,
    creator: document.getElementById('f-creator').value,
    dueDate: document.getElementById('f-dueDate').value || '',
    completedDate: document.getElementById('f-completedDate').value || '',
    hours: parseFloat(document.getElementById('f-hours').value) || 0,
    status: document.getElementById('f-status').value,
  };

  if (data.status === 'done' && !data.completedDate) data.completedDate = todayStr();
  if (data.completedDate && data.status !== 'done') data.status = 'done';

  setSyncStatus('syncing');
  try {
    if (editingId !== null) {
      const existing = state.tasks.find(t => t.id === editingId) || {};
      const payload = { ...existing, ...data, id: editingId };
      const result = await api('update', { payload });
      const idx = state.tasks.findIndex(t => t.id === editingId);
      if (idx >= 0) state.tasks[idx] = result;
      cancelEdit();
    } else {
      const result = await api('create', { payload: { filePath: '', ...data } });
      state.tasks.push(result);
      clearForm();
    }
    saveLocal();
    refreshMonthFilter();
    render();
    setSyncStatus('ok');
  } catch (err) {
    setSyncStatus('error');
    alert('儲存失敗：' + err.message);
  }
}

function editTask(id) {
  const t = state.tasks.find(x => x.id === id);
  if (!t) return;
  document.getElementById('f-dispatchDate').value = t.dispatchDate || '';
  document.getElementById('f-dueDate').value = t.dueDate || '';
  document.getElementById('f-completedDate').value = t.completedDate || '';
  document.getElementById('f-hours').value = t.hours || '';
  document.getElementById('f-majorCategory').value = t.majorCategory || '';
  document.getElementById('f-bnCategory').value = t.bnCategory || '';
  document.getElementById('f-dispatcher').value = t.dispatcher || '';
  document.getElementById('f-creator').value = t.creator || '';
  document.getElementById('f-status').value = t.status || 'pending';
  document.getElementById('f-bnSize').value = t.bnSize || '';
  document.getElementById('f-bnContent').value = t.bnContent || '';

  editingId = id;
  document.getElementById('form-title').textContent = `編輯工單 #${id}`;
  document.getElementById('submit-btn').textContent = '更新工單';
  document.getElementById('cancel-btn').style.display = 'inline-block';
  document.getElementById('f-bnCategory').focus();
  document.querySelector('.form-card').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function cancelEdit() {
  editingId = null;
  document.getElementById('form-title').textContent = '新增工單';
  document.getElementById('submit-btn').textContent = '新增工單';
  document.getElementById('cancel-btn').style.display = 'none';
  clearForm();
}

function clearForm() {
  ['f-dispatchDate', 'f-dueDate', 'f-completedDate', 'f-hours',
   'f-bnCategory', 'f-bnSize', 'f-bnContent'].forEach(id => {
    document.getElementById(id).value = '';
  });
  document.getElementById('f-majorCategory').value = '';
  document.getElementById('f-dispatcher').value = '';
  document.getElementById('f-creator').value = '';
  document.getElementById('f-status').value = 'pending';
  document.getElementById('f-dispatchDate').value = todayStr();
}

async function deleteTask(id) {
  const t = state.tasks.find(x => x.id === id);
  if (!t) return;
  if (!confirm(`刪除「${t.bnCategory || '未命名'}」？\n\n（${TRASH_RETENTION_DAYS} 天內可從「最近刪除」復原，但僅限本人）`)) return;

  setSyncStatus('syncing');
  try {
    await api('delete', { id: String(id) });
    state.trash.push({ task: { ...t }, deletedAt: new Date().toISOString() });
    state.tasks = state.tasks.filter(x => x.id !== id);
    if (editingId === id) cancelEdit();
    saveLocal();
    refreshMonthFilter();
    render();
    setSyncStatus('ok');
  } catch (err) {
    setSyncStatus('error');
    alert('刪除失敗：' + err.message);
  }
}

async function moveTask(id, dir) {
  const t = state.tasks.find(x => x.id === id);
  if (!t) return;
  const order = ['pending', 'done'];
  const i = order.indexOf(t.status);
  const ni = i + dir;
  if (ni < 0 || ni >= order.length) return;
  const newStatus = order[ni];
  const newCompletedDate = (newStatus === 'done' && !t.completedDate) ? todayStr() : t.completedDate;

  setSyncStatus('syncing');
  try {
    const payload = { ...t, status: newStatus, completedDate: newCompletedDate };
    const result = await api('update', { payload });
    const idx = state.tasks.findIndex(x => x.id === id);
    if (idx >= 0) state.tasks[idx] = result;
    saveLocal();
    render();
    setSyncStatus('ok');
  } catch (err) {
    setSyncStatus('error');
    alert('狀態更新失敗：' + err.message);
  }
}

// 表格內快速更改製作人
async function updateCreator(id, newCreator) {
  const t = state.tasks.find(x => x.id === id);
  if (!t || t.creator === newCreator) return;
  setSyncStatus('syncing');
  try {
    const payload = { ...t, creator: newCreator };
    const result = await api('update', { payload });
    const idx = state.tasks.findIndex(x => x.id === id);
    if (idx >= 0) state.tasks[idx] = result;
    saveLocal();
    render();
    setSyncStatus('ok');
  } catch (err) {
    setSyncStatus('error');
    alert('製作人更新失敗：' + err.message);
  }
}

// 詳細檢視 modal 內更改檔案路徑
async function updateFilePath(id, newPath) {
  const t = state.tasks.find(x => x.id === id);
  if (!t) return;
  const trimmed = (newPath || '').trim();
  if (t.filePath === trimmed) return;
  setSyncStatus('syncing');
  try {
    const payload = { ...t, filePath: trimmed };
    const result = await api('update', { payload });
    const idx = state.tasks.findIndex(x => x.id === id);
    if (idx >= 0) state.tasks[idx] = result;
    saveLocal();
    setSyncStatus('ok');
  } catch (err) {
    setSyncStatus('error');
    alert('路徑更新失敗：' + err.message);
  }
}

// ---------- 最近刪除（本地獨有） ----------
function openTrash() {
  cleanOldTrash();
  saveLocal();
  document.getElementById('trash-modal').classList.add('open');
  renderTrashList();
}
function closeTrash() {
  document.getElementById('trash-modal').classList.remove('open');
}

async function restoreFromTrash(idx) {
  const item = state.trash[idx];
  if (!item) return;
  setSyncStatus('syncing');
  try {
    // 把工單重新建立到雲端（會拿到新 id）
    const { id, ...taskWithoutId } = item.task;
    const result = await api('create', { payload: taskWithoutId });
    state.tasks.push(result);
    state.trash.splice(idx, 1);
    saveLocal();
    refreshMonthFilter();
    render();
    renderTrashList();
    setSyncStatus('ok');
  } catch (err) {
    setSyncStatus('error');
    alert('復原失敗：' + err.message);
  }
}

function permanentDelete(idx) {
  const item = state.trash[idx];
  if (!item) return;
  if (!confirm(`永久刪除「${item.task.bnCategory || '未命名'}」？\n此動作無法復原。`)) return;
  state.trash.splice(idx, 1);
  saveLocal();
  renderTrashList();
  updateTrashButton();
}

async function restoreAllTrash() {
  if (!state.trash.length) return;
  if (!confirm(`復原 ${state.trash.length} 筆工單？`)) return;
  setSyncStatus('syncing');
  try {
    const tasksToRestore = state.trash.map(item => {
      const { id, ...rest } = item.task;
      return rest;
    });
    const result = await api('bulkImport', { payload: tasksToRestore });
    if (result.tasks) state.tasks.push(...result.tasks);
    state.trash = [];
    saveLocal();
    refreshMonthFilter();
    render();
    closeTrash();
    setSyncStatus('ok');
  } catch (err) {
    setSyncStatus('error');
    alert('批次復原失敗：' + err.message);
  }
}

function emptyTrash() {
  if (!state.trash.length) return;
  if (!confirm(`永久刪除 ${state.trash.length} 筆工單？\n此動作無法復原。`)) return;
  state.trash = [];
  saveLocal();
  renderTrashList();
  updateTrashButton();
}

function renderTrashList() {
  const ul = document.getElementById('trash-list');
  if (!state.trash.length) {
    ul.innerHTML = '<li class="trash-empty">垃圾桶是空的</li>';
    updateTrashButton();
    return;
  }
  const indexed = state.trash.map((item, idx) => ({ item, idx }))
    .sort((a, b) => new Date(b.item.deletedAt) - new Date(a.item.deletedAt));
  const now = Date.now();
  ul.innerHTML = indexed.map(({ item, idx }) => {
    const t = item.task;
    const deletedMs = new Date(item.deletedAt).getTime();
    const daysAgo = Math.floor((now - deletedMs) / 86400000);
    const daysLeft = TRASH_RETENTION_DAYS - daysAgo;
    const ago = daysAgo === 0 ? '今天' : `${daysAgo} 天前`;
    return `
      <li class="trash-item">
        <div class="info">
          <div class="title">${escapeHtml(t.bnCategory || '（未命名）')}</div>
          <div class="meta">
            ${t.majorCategory ? `<span class="cat-badge ${t.majorCategory}">${escapeHtml(t.majorCategory)}</span> · ` : ''}
            派工 ${escapeHtml(t.dispatchDate || '—')} · 製作人 ${escapeHtml(t.creator) || '未指派'}<br>
            ${ago}刪除　<span class="expire">${daysLeft} 天後永久刪除</span>
          </div>
        </div>
        <div class="actions">
          <button class="icon-btn" onclick="restoreFromTrash(${idx})">復原</button>
          <button class="icon-btn del" onclick="permanentDelete(${idx})">永久刪除</button>
        </div>
      </li>
    `;
  }).join('');
  updateTrashButton();
}

function updateTrashButton() {
  const btn = document.getElementById('trash-btn');
  if (btn) {
    const n = state.trash.length;
    btn.textContent = n > 0 ? `🗑 最近刪除 (${n})` : '🗑 最近刪除';
    btn.classList.toggle('has-items', n > 0);
  }
  const copyBtn = document.getElementById('copy-trash-btn');
  if (copyBtn) {
    const n = state.copyTrash.length;
    copyBtn.textContent = n > 0 ? `🗑 最近刪除 (${n})` : '🗑 最近刪除';
    copyBtn.classList.toggle('has-items', n > 0);
  }
}

// ---------- 人員管理 ----------
function openPeopleManager(type) {
  peopleManagerType = type;
  document.getElementById('people-title').textContent =
    type === 'dispatcher' ? '管理派工者' : '管理製作人';
  document.getElementById('people-modal').classList.add('open');
  document.getElementById('new-person').focus();
  renderPeopleList();
}
function closePeopleManager() {
  document.getElementById('people-modal').classList.remove('open');
}
async function addPerson() {
  const input = document.getElementById('new-person');
  const name = input.value.trim();
  if (!name) return;
  const list = peopleManagerType === 'dispatcher' ? state.dispatchers : state.creators;
  if (list.includes(name)) { alert('已存在相同名稱'); return; }
  setSyncStatus('syncing');
  try {
    await api('addPerson', { type: peopleManagerType, name });
    list.push(name);
    input.value = '';
    saveLocal();
    refreshDropdowns();
    renderPeopleList();
    render();
    renderCopy();
    setSyncStatus('ok');
  } catch (err) {
    setSyncStatus('error');
    alert('新增人員失敗：' + err.message);
  }
}
async function removePerson(name) {
  if (!confirm(`移除「${name}」？\n（已分派的舊工單名字會保留為純文字，新工單下拉中不再出現）`)) return;
  setSyncStatus('syncing');
  try {
    await api('removePerson', { type: peopleManagerType, name });
    if (peopleManagerType === 'dispatcher') {
      state.dispatchers = state.dispatchers.filter(a => a !== name);
    } else {
      state.creators = state.creators.filter(a => a !== name);
    }
    saveLocal();
    refreshDropdowns();
    renderPeopleList();
    render();
    renderCopy();
    setSyncStatus('ok');
  } catch (err) {
    setSyncStatus('error');
    alert('移除人員失敗：' + err.message);
  }
}
function renderPeopleList() {
  const list = peopleManagerType === 'dispatcher' ? state.dispatchers : state.creators;
  const ul = document.getElementById('people-list');
  if (!list.length) {
    ul.innerHTML = '<li style="justify-content:center;color:var(--text-faint)">尚無資料</li>';
    return;
  }
  ul.innerHTML = list.map(a => `
    <li>
      <span>${escapeHtml(a)}</span>
      <button class="icon-btn del" onclick="removePerson('${escapeHtml(a).replace(/'/g, "\\'")}')">移除</button>
    </li>
  `).join('');
}

// ---------- 詳細檢視（先檢視，按編輯才進入編輯模式） ----------
function showDetail(id) {
  const t = state.tasks.find(x => x.id === id);
  if (!t) return;
  document.getElementById('detail-title').textContent = `工單 #${id} ・ ${t.bnCategory || ''}`;
  renderDetailView(id);
  document.getElementById('detail-modal').classList.add('open');
}

// 檢視模式：除了檔案路徑可直接編輯外，其他都是純顯示
function renderDetailView(id) {
  const t = state.tasks.find(x => x.id === id);
  if (!t) return;
  document.getElementById('detail-body').innerHTML = `
    <dl class="detail-grid">
      <dt>派工日期</dt><dd>${escapeHtml(t.dispatchDate || '—')}</dd>
      <dt>需完成日</dt><dd>${escapeHtml(t.dueDate || '—')}</dd>
      <dt>完成日</dt><dd>${escapeHtml(t.completedDate || '—')}</dd>
      <dt>狀態</dt><dd><span class="status-pill ${t.status}">${statusLabel(t.status)}</span></dd>
      <dt>大分類</dt><dd>${t.majorCategory ? `<span class="cat-badge ${t.majorCategory}">${escapeHtml(t.majorCategory)}</span>` : '<span class="unassigned">未分類</span>'}</dd>
      <dt>BN 類別</dt><dd>${escapeHtml(t.bnCategory)}</dd>
      <dt>BN 尺寸</dt><dd>${escapeHtml(t.bnSize) || '—'}</dd>
      <dt>BN 內容</dt><dd>${escapeHtml(t.bnContent) || '—'}</dd>
      <dt>檔案路徑</dt><dd>
        <textarea class="modal-path-input" rows="2"
                  placeholder="點此輸入檔案路徑（可換行）..."
                  onblur="updateField(${id}, 'filePath', this.value)">${escapeHtml(t.filePath)}</textarea>
      </dd>
      <dt>派工者</dt><dd>${escapeHtml(t.dispatcher) || '<span class="unassigned">未指定</span>'}</dd>
      <dt>製作人</dt><dd>${escapeHtml(t.creator) || '<span class="unassigned">未指派</span>'}</dd>
      <dt>作業時間</dt><dd>${(Math.round((t.hours || 0) * 10) / 10)} 小時</dd>
    </dl>
    <div style="display:flex; gap:8px; margin-top:20px; justify-content:flex-end">
      <button class="btn btn-ghost danger" onclick="closeDetail(); deleteTask(${id})">刪除</button>
      <button class="btn btn-primary" onclick="renderDetailEdit(${id})">編輯</button>
    </div>
  `;
}

// 編輯模式：所有欄位變成可編輯，按儲存才寫回雲端
function renderDetailEdit(id) {
  const t = state.tasks.find(x => x.id === id);
  if (!t) return;

  const dispatcherOptions = '<option value="">未指定</option>' +
    state.dispatchers.map(a =>
      `<option value="${escapeHtml(a)}" ${a === t.dispatcher ? 'selected' : ''}>${escapeHtml(a)}</option>`
    ).join('');
  const creatorOptions = '<option value="">未指派</option>' +
    state.creators.map(a =>
      `<option value="${escapeHtml(a)}" ${a === t.creator ? 'selected' : ''}>${escapeHtml(a)}</option>`
    ).join('');
  const majorOptions = ['', '電商', '通路', '行銷'].map(opt =>
    `<option value="${opt}" ${opt === (t.majorCategory || '') ? 'selected' : ''}>${opt || '未分類'}</option>`
  ).join('');
  const statusOptions = `
    <option value="pending" ${t.status === 'pending' ? 'selected' : ''}>待派工</option>
    <option value="done" ${t.status === 'done' ? 'selected' : ''}>完成</option>
  `;

  document.getElementById('detail-body').innerHTML = `
    <div class="detail-edit-grid">
      <label class="detail-edit-field detail-edit-field-full">
        <span>BN 類別 / 名稱</span>
        <input type="text" id="edit-bnCategory" value="${escapeHtml(t.bnCategory)}" />
      </label>
      <label class="detail-edit-field">
        <span>派工日期</span>
        <input type="date" id="edit-dispatchDate" value="${escapeHtml(t.dispatchDate)}" />
      </label>
      <label class="detail-edit-field">
        <span>需完成日</span>
        <input type="date" id="edit-dueDate" value="${escapeHtml(t.dueDate)}" />
      </label>
      <label class="detail-edit-field">
        <span>完成日</span>
        <input type="date" id="edit-completedDate" value="${escapeHtml(t.completedDate)}" />
      </label>
      <label class="detail-edit-field">
        <span>狀態</span>
        <select id="edit-status">${statusOptions}</select>
      </label>
      <label class="detail-edit-field">
        <span>大分類</span>
        <select id="edit-majorCategory">${majorOptions}</select>
      </label>
      <label class="detail-edit-field">
        <span>作業時間（小時）</span>
        <input type="number" id="edit-hours" step="0.5" min="0" value="${t.hours || ''}" />
      </label>
      <label class="detail-edit-field">
        <span>派工者</span>
        <select id="edit-dispatcher">${dispatcherOptions}</select>
      </label>
      <label class="detail-edit-field">
        <span>製作人</span>
        <select id="edit-creator">${creatorOptions}</select>
      </label>
      <label class="detail-edit-field detail-edit-field-full">
        <span>BN 尺寸</span>
        <textarea id="edit-bnSize" rows="3">${escapeHtml(t.bnSize)}</textarea>
      </label>
      <label class="detail-edit-field detail-edit-field-full">
        <span>BN 內容</span>
        <textarea id="edit-bnContent" rows="3">${escapeHtml(t.bnContent)}</textarea>
      </label>
      <label class="detail-edit-field detail-edit-field-full">
        <span>檔案路徑</span>
        <textarea id="edit-filePath" rows="2" placeholder="點此輸入檔案路徑（可換行）...">${escapeHtml(t.filePath)}</textarea>
      </label>
    </div>
    <div style="display:flex; gap:8px; margin-top:20px; justify-content:flex-end">
      <button class="btn btn-ghost" onclick="renderDetailView(${id})">取消</button>
      <button class="btn btn-primary" onclick="saveDetailEdit(${id})">儲存</button>
    </div>
  `;
}

async function saveDetailEdit(id) {
  const t = state.tasks.find(x => x.id === id);
  if (!t) return;

  const data = {
    bnCategory: document.getElementById('edit-bnCategory').value.trim(),
    dispatchDate: document.getElementById('edit-dispatchDate').value || '',
    dueDate: document.getElementById('edit-dueDate').value || '',
    completedDate: document.getElementById('edit-completedDate').value || '',
    status: document.getElementById('edit-status').value,
    majorCategory: document.getElementById('edit-majorCategory').value,
    hours: parseFloat(document.getElementById('edit-hours').value) || 0,
    dispatcher: document.getElementById('edit-dispatcher').value,
    creator: document.getElementById('edit-creator').value,
    bnSize: document.getElementById('edit-bnSize').value.trim(),
    bnContent: document.getElementById('edit-bnContent').value.trim(),
    filePath: document.getElementById('edit-filePath').value.trim(),
  };

  // 自動規則：完成日填了就自動轉「完成」狀態；狀態改完成且沒填完成日就填今天
  if (data.status === 'done' && !data.completedDate) data.completedDate = todayStr();
  if (data.completedDate && data.status !== 'done') data.status = 'done';

  setSyncStatus('syncing');
  try {
    const payload = { ...t, ...data };
    const result = await api('update', { sheet: 'tasks', payload });
    const idx = state.tasks.findIndex(x => x.id === id);
    if (idx >= 0) state.tasks[idx] = result;
    saveLocal();
    refreshMonthFilter();
    render();
    setSyncStatus('ok');
    renderDetailView(id);  // 存完回到檢視模式
  } catch (err) {
    setSyncStatus('error');
    alert('儲存失敗：' + err.message);
  }
}

// 給檢視模式下的「檔案路徑」即時編輯用
async function updateField(id, key, rawValue) {
  const t = state.tasks.find(x => x.id === id);
  if (!t) return;
  let value = rawValue;
  if (key === 'hours') value = parseFloat(rawValue) || 0;
  if (String(t[key] || '') === String(value || '')) return;

  setSyncStatus('syncing');
  try {
    const payload = { ...t, [key]: value };
    const result = await api('update', { sheet: 'tasks', payload });
    const idx = state.tasks.findIndex(x => x.id === id);
    if (idx >= 0) state.tasks[idx] = result;
    saveLocal();
    render();
    setSyncStatus('ok');
  } catch (err) {
    setSyncStatus('error');
    alert('更新失敗：' + err.message);
  }
}

function closeDetail() {
  document.getElementById('detail-modal').classList.remove('open');
}

// ---------- Excel I/O ----------
// 統一入口：依當前分頁自動派工到對應 model
function exportExcelSmart() {
  if (activeSection === 'copy') exportCopyExcel();
  else exportExcel();
}
function importExcelSmart(event) {
  if (activeSection === 'copy') importCopyExcel(event);
  else importExcel(event);
}
function downloadTemplateSmart() {
  if (activeSection === 'copy') downloadCopyTemplate();
  else downloadTemplate();
}
function openImportHistorySmart() {
  if (activeSection === 'copy') openCopyImportHistory();
  else openImportHistory();
}

// ---------- 匯入分析（共用）----------
// 計算「YYYY-MM」格式的月份（從日期欄位）
function monthOf(dateStr) {
  if (!dateStr) return '';
  const m = String(dateStr).match(/^(\d{4})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}` : '';
}

// 比對月份範圍（含頭含尾）
function inMonthRange(monthStr, fromMonth, toMonth) {
  if (!monthStr) return false;
  return monthStr >= fromMonth && monthStr <= toMonth;
}

// 把 task 列表轉成「重複偵測 key」的 Set，用於匯入時比對
function buildDupKeySet(tasks, dupKeyFn) {
  const set = new Set();
  for (const t of tasks) {
    const k = dupKeyFn(t);
    if (k) set.add(k);
  }
  return set;
}

// 分析匯入資料：分類為 valid / duplicates / errors
// candidates: 已解析的 task 物件陣列
// existingKeys: Set，已存在的 dup key
// dupKeyFn: (task) => string，產生 dup key 的函式
// validateFn: (task, idx) => null | string（傳回錯誤訊息）
function analyzeImport(candidates, existingKeys, dupKeyFn, validateFn) {
  const valid = [];      // 完全沒問題、不重複
  const duplicates = []; // 跟雲端重複
  const errors = [];     // 必填漏掉等錯誤 [{rowNum, reason}]
  const seenInFile = new Set(); // 同檔案內也算重複

  candidates.forEach((task, idx) => {
    const rowNum = idx + 2; // Excel 第 1 列是表頭，所以資料從第 2 列開始
    const err = validateFn(task, idx);
    if (err) {
      errors.push({ rowNum, reason: err });
      return;
    }
    const key = dupKeyFn(task);
    if (key && (existingKeys.has(key) || seenInFile.has(key))) {
      duplicates.push({ rowNum, task });
    } else {
      valid.push(task);
      if (key) seenInFile.add(key);
    }
  });

  return { valid, duplicates, errors };
}

// 開啟匯入預覽 modal
// analysis: analyzeImport 回傳值
// fileInfo: { filename, fileSize, fileBase64, rowCount, originalRows }
// onConfirm: (action: 'skip' | 'all') => Promise<void>
let pendingImportConfirm = null;
function showImportPreview(analysis, fileInfo, onConfirm) {
  document.getElementById('import-preview-filename').textContent = `檔案：${fileInfo.filename}（${fileInfo.rowCount} 列）`;
  document.getElementById('import-stat-new').textContent = analysis.valid.length;
  document.getElementById('import-stat-dup').textContent = analysis.duplicates.length;
  document.getElementById('import-stat-err').textContent = analysis.errors.length;

  // 錯誤明細
  const errSection = document.getElementById('import-error-list');
  const errUl = document.getElementById('import-error-ul');
  if (analysis.errors.length) {
    errUl.innerHTML = analysis.errors.slice(0, 10).map(e =>
      `<li>第 ${e.rowNum} 列：${escapeHtml(e.reason)}</li>`
    ).join('') + (analysis.errors.length > 10 ? `<li>...還有 ${analysis.errors.length - 10} 筆</li>` : '');
    errSection.style.display = '';
  } else {
    errSection.style.display = 'none';
  }

  // 重複處理選項
  const dupSection = document.getElementById('import-dup-section');
  if (analysis.duplicates.length) {
    dupSection.style.display = '';
    document.querySelector('input[name=import-dup-action][value=skip]').checked = true;
  } else {
    dupSection.style.display = 'none';
  }

  // 確認按鈕的可用狀態
  const confirmBtn = document.getElementById('import-confirm-btn');
  const totalToImport = analysis.valid.length + analysis.duplicates.length;
  if (totalToImport === 0) {
    confirmBtn.disabled = true;
    confirmBtn.textContent = '沒有可匯入的資料';
  } else {
    confirmBtn.disabled = false;
    confirmBtn.textContent = '確認匯入';
  }

  pendingImportConfirm = { analysis, fileInfo, onConfirm };
  document.getElementById('import-preview-modal').classList.add('open');
}

function closeImportPreview() {
  document.getElementById('import-preview-modal').classList.remove('open');
  pendingImportConfirm = null;
}

async function confirmImport() {
  if (!pendingImportConfirm) return;
  const { analysis, onConfirm } = pendingImportConfirm;
  const action = analysis.duplicates.length
    ? document.querySelector('input[name=import-dup-action]:checked').value
    : 'skip';
  closeImportPreview();
  await onConfirm(action);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const EXCEL_HEADERS = ['派工日期', '大分類', 'BN類別', 'BN尺寸', 'BN內容', '檔案路徑', '派工者', '製作人', '需完成日', '完成日', '作業時間', '狀態'];

function tasksToRows(tasks) {
  return tasks.map(t => ({
    '派工日期': t.dispatchDate || '',
    '大分類': t.majorCategory || '',
    'BN類別': t.bnCategory || '',
    'BN尺寸': t.bnSize || '',
    'BN內容': t.bnContent || '',
    '檔案路徑': t.filePath || '',
    '派工者': t.dispatcher || '',
    '製作人': t.creator || '',
    '需完成日': t.dueDate || '',
    '完成日': t.completedDate || '',
    '作業時間': t.hours || 0,
    '狀態': statusLabel(t.status),
  }));
}

function downloadTemplate() {
  const wb = XLSX.utils.book_new();
  const sample = [{
    '派工日期': '2026-01-29',
    '大分類': '電商',
    'BN類別': 'PC 穿戴館 BN',
    'BN尺寸': '1644 x 604 (<395KB)\n462 x 462 (<225KB)',
    'BN內容': '活動說明...',
    '檔案路徑': 'Z:\\200-BN\\03-平台\\pchome\\品牌\\myFirst\\2026\\2026 3',
    '派工者': 'Amy',
    '製作人': '瞳',
    '需完成日': '2026-02-13',
    '完成日': '',
    '作業時間': 1,
    '狀態': '待派工',
  }];
  const ws = XLSX.utils.json_to_sheet(sample, { header: EXCEL_HEADERS });
  ws['!cols'] = [
    { wch: 12 }, { wch: 8 }, { wch: 16 }, { wch: 28 }, { wch: 40 }, { wch: 35 },
    { wch: 10 }, { wch: 10 }, { wch: 12 }, { wch: 12 }, { wch: 10 }, { wch: 10 }
  ];
  XLSX.utils.book_append_sheet(wb, ws, '派工單');
  XLSX.writeFile(wb, 'BN派工_範本.xlsx');
}

function exportExcel() {
  const all = state.tasks.length;
  const filtered = getVisibleTasks().length;
  document.getElementById('export-modal-title').textContent = '匯出 Excel - BN派工';
  document.getElementById('export-count-all').textContent = `${all} 筆`;
  document.getElementById('export-count-filtered').textContent = `${filtered} 筆`;

  // 派工月份下拉
  const dispatchMonths = new Set();
  state.tasks.forEach(t => {
    const m = getMonthOf(t.dispatchDate);
    if (m) dispatchMonths.add(m);
  });
  const sortedMonths = [...dispatchMonths].sort().reverse();
  const monthSelect = document.getElementById('export-month-pick');
  if (sortedMonths.length === 0) {
    monthSelect.innerHTML = '<option value="">無資料</option>';
  } else {
    monthSelect.innerHTML = sortedMonths.map(m => {
      const cnt = state.tasks.filter(t => getMonthOf(t.dispatchDate) === m).length;
      return `<option value="${m}">${formatMonth(m)}（${cnt} 筆）</option>`;
    }).join('');
  }

  // 完成日月份下拉（給「自訂時間區間」用）
  const completedMonths = new Set();
  state.tasks.forEach(t => {
    const m = monthOf(t.completedDate);
    if (m) completedMonths.add(m);
  });
  const completedSorted = [...completedMonths].sort();
  const fromSel = document.getElementById('export-date-from');
  const toSel = document.getElementById('export-date-to');
  if (completedSorted.length === 0) {
    fromSel.innerHTML = '<option value="">無完成日資料</option>';
    toSel.innerHTML = '<option value="">無完成日資料</option>';
  } else {
    const opts = completedSorted.map(m => `<option value="${m}">${formatMonth(m)}</option>`).join('');
    fromSel.innerHTML = opts;
    toSel.innerHTML = opts;
    toSel.value = completedSorted[completedSorted.length - 1];
  }

  // 大分類疊加篩選（BN 顯示，每次開啟先清空）
  document.getElementById('export-major-section').style.display = '';
  document.querySelectorAll('.export-major-cb').forEach(cb => cb.checked = false);

  document.querySelector('input[name=export-range][value=all]').checked = true;
  document.getElementById('export-modal').classList.add('open');
}
function closeExportModal() {
  document.getElementById('export-modal').classList.remove('open');
}
function doExportSelected() {
  const range = document.querySelector('input[name=export-range]:checked').value;

  // 判斷目前是 BN 還是文案 model
  const isCopy = activeSection === 'copy';
  const sourceTasks = isCopy ? state.copyTasks : state.tasks;
  const visibleTasks = isCopy ? getVisibleCopyTasks() : getVisibleTasks();
  const completedField = isCopy ? 'imageCompleted' : 'completedDate';
  const dispatchField = 'dispatchDate';
  const filePrefix = isCopy ? '文案派工' : 'BN派工';

  // === Step 1：依範圍取得基底資料集 ===
  let tasks, suffix;
  if (range === 'all') {
    tasks = sourceTasks;
    suffix = todayStr();
  } else if (range === 'filtered') {
    tasks = visibleTasks;
    suffix = todayStr() + '_篩選';
  } else if (range === 'month') {
    const month = document.getElementById('export-month-pick').value;
    if (!month) { alert('請先選擇月份'); return; }
    tasks = sourceTasks.filter(t => monthOf(t[dispatchField]) === month);
    suffix = month;
  } else if (range === 'dateRange') {
    const from = document.getElementById('export-date-from').value;
    const to = document.getElementById('export-date-to').value;
    if (!from || !to) { alert('請先選擇起訖月份'); return; }
    if (from > to) { alert('起始月份不能晚於結束月份'); return; }
    tasks = sourceTasks.filter(t => inMonthRange(monthOf(t[completedField]), from, to));
    suffix = (from === to) ? `${from}_完成` : `${from}_to_${to}_完成`;
  }

  // === Step 2：再疊加大分類篩選（BN 才有；勾了才篩，沒勾全部留下）===
  if (!isCopy) {
    const pickedMajors = [...document.querySelectorAll('.export-major-cb:checked')].map(cb => cb.value);
    if (pickedMajors.length > 0 && pickedMajors.length < 3) {
      tasks = tasks.filter(t => pickedMajors.includes(t.majorCategory));
      suffix += '_' + pickedMajors.join('-');
    }
  }

  if (!tasks || !tasks.length) { alert('套用篩選後沒有符合的資料'); return; }

  // 依 model 呼叫對應的下載函式
  if (isCopy) {
    doExportCopy(tasks, `${filePrefix}_${suffix}.xlsx`);
  } else {
    doExport(tasks, `${filePrefix}_${suffix}.xlsx`);
  }
  closeExportModal();
}
function doExport(tasks, filename) {
  const rows = tasksToRows(tasks);
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(rows, { header: EXCEL_HEADERS });
  ws['!cols'] = [
    { wch: 12 }, { wch: 8 }, { wch: 16 }, { wch: 28 }, { wch: 40 }, { wch: 35 },
    { wch: 10 }, { wch: 10 }, { wch: 12 }, { wch: 12 }, { wch: 10 }, { wch: 10 }
  ];
  XLSX.utils.book_append_sheet(wb, ws, '派工單');
  XLSX.writeFile(wb, filename);
}

function parseExcelDate(v) {
  if (!v && v !== 0) return '';
  if (typeof v === 'string') {
    const m = v.match(/(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
    if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
    const m2 = v.match(/^(\d{1,2})[/.](\d{1,2})$/);
    if (m2) {
      const yr = new Date().getFullYear();
      return `${yr}-${m2[1].padStart(2, '0')}-${m2[2].padStart(2, '0')}`;
    }
    return v;
  }
  if (typeof v === 'number') {
    const d = XLSX.SSF.parse_date_code(v);
    if (d) return `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`;
  }
  return '';
}

function statusFromText(text) {
  const t = String(text || '').trim();
  if (t.includes('完成') || t.toLowerCase() === 'done' || t === '✓' || t === '✅') return 'done';
  return 'pending';
}

// BN 重複偵測 key：大分類+BN類別+BN尺寸+BN內容
function bnDupKey(t) {
  const norm = s => String(s || '').trim();
  return [norm(t.majorCategory), norm(t.bnCategory), norm(t.bnSize), norm(t.bnContent)].join('|');
}

async function importExcel(event) {
  const file = event.target.files[0];
  event.target.value = ''; // 立刻清空，避免下次選同名檔案不觸發
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async e => {
    try {
      const arrayBuffer = e.target.result;
      const wb = XLSX.read(arrayBuffer, { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
      if (!rows.length) { alert('Excel 沒有資料'); return; }

      const headers = Object.keys(rows[0]);
      const need = ['BN類別', 'BN 類別', 'BN類別/名稱'];
      const hasCategory = headers.some(h => need.some(n => h.replace(/\s+/g, '').includes(n.replace(/\s+/g, ''))));
      if (!hasCategory) {
        if (!confirm('找不到「BN類別」欄位，是否仍要嘗試匯入？')) return;
      }

      const newDispatchers = new Set();
      const newCreators = new Set();
      const candidates = rows.map(row => {
        const get = (...keys) => {
          for (const k of keys) if (row[k] !== undefined && row[k] !== '') return row[k];
          return '';
        };
        const dispatcher = String(get('派工者', 'Dispatcher')).trim();
        const creator = String(get('製作人', 'Creator')).trim();
        if (dispatcher && !state.dispatchers.includes(dispatcher)) newDispatchers.add(dispatcher);
        if (creator && !state.creators.includes(creator)) newCreators.add(creator);

        const completedDate = parseExcelDate(get('完成日', 'CompletedDate'));
        let status = statusFromText(get('狀態', 'Status'));
        if (completedDate && status !== 'done') status = 'done';

        const rawMajor = String(get('大分類', '分類', 'MajorCategory')).trim();
        let majorCategory = '';
        if (rawMajor.includes('電商') || /ecommerce|e-commerce/i.test(rawMajor)) majorCategory = '電商';
        else if (rawMajor.includes('通路') || /channel/i.test(rawMajor)) majorCategory = '通路';
        else if (rawMajor.includes('行銷') || /marketing/i.test(rawMajor)) majorCategory = '行銷';

        return {
          dispatchDate: parseExcelDate(get('派工日期', 'DispatchDate')),
          majorCategory,
          bnCategory: String(get('BN類別', 'BN 類別', 'BN類別/名稱')).trim(),
          bnSize: String(get('BN尺寸', 'BN 尺寸', 'Size')).trim(),
          bnContent: String(get('BN內容', 'BN 內容', 'Content')).trim(),
          filePath: String(get('檔案路徑', '路徑', 'FilePath', 'Path')).trim(),
          dispatcher,
          creator,
          dueDate: parseExcelDate(get('需完成日', 'DueDate')),
          completedDate,
          hours: parseFloat(get('作業時間', '時數', 'Hours')) || 0,
          status,
        };
      });

      // 分析重複/錯誤
      const existingKeys = buildDupKeySet(state.tasks, bnDupKey);
      const validate = (t) => {
        if (!t.bnContent && !t.bnCategory) return '缺少 BN 內容與 BN 類別';
        return null;
      };
      const analysis = analyzeImport(candidates, existingKeys, bnDupKey, validate);

      const fileBase64 = arrayBufferToBase64(arrayBuffer);
      const fileInfo = {
        filename: file.name,
        fileSize: file.size,
        fileBase64,
        rowCount: rows.length,
      };

      // 開預覽 modal
      showImportPreview(analysis, fileInfo, async (action) => {
        const tasksToImport = (action === 'all')
          ? [...analysis.valid, ...analysis.duplicates.map(d => d.task)]
          : analysis.valid;

        if (!tasksToImport.length) { alert('沒有可匯入的資料'); return; }

        try {
          setSyncStatus('syncing');
          // 先把新人員加到雲端
          for (const n of newDispatchers) {
            await api('addPerson', { type: 'dispatcher', name: n });
            state.dispatchers.push(n);
          }
          for (const n of newCreators) {
            await api('addPerson', { type: 'creator', name: n });
            state.creators.push(n);
          }
          // 批次匯入工單
          const result = await api('bulkImport', { payload: tasksToImport });
          if (result.tasks) state.tasks.push(...result.tasks);

          // 紀錄這次匯入
          state.importHistory.unshift({
            filename: file.name,
            importedAt: new Date().toISOString(),
            rowCount: tasksToImport.length,
            fileSize: file.size,
            fileBase64,
          });
          if (state.importHistory.length > 10) state.importHistory = state.importHistory.slice(0, 10);

          saveLocal();
          refreshDropdowns();
          refreshMonthFilter();
          render();
          setSyncStatus('ok');

          const skipped = analysis.duplicates.length + analysis.errors.length - (action === 'all' ? analysis.duplicates.length : 0);
          alert(`匯入完成！\n✅ 新增 ${tasksToImport.length} 筆\n${skipped > 0 ? `⏭️ 略過 ${skipped} 筆` : ''}`);
        } catch (err) {
          console.error(err);
          setSyncStatus('error');
          alert('匯入失敗：' + err.message);
        }
      });
    } catch (err) {
      console.error(err);
      alert('解析 Excel 失敗：' + err.message);
    }
  };
  reader.readAsArrayBuffer(file);
}

function arrayBufferToBase64(buffer) {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}
function base64ToBlob(base64, mimeType) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mimeType });
}

// ---------- 匯入紀錄 ----------
function openImportHistory() {
  document.getElementById('import-history-modal').classList.add('open');
  renderImportHistory();
}
function closeImportHistory() {
  document.getElementById('import-history-modal').classList.remove('open');
}
function renderImportHistory() {
  const ul = document.getElementById('import-history-list');
  if (!state.importHistory.length) {
    ul.innerHTML = '<li class="trash-empty">尚無匯入紀錄</li>';
    return;
  }
  ul.innerHTML = state.importHistory.map((rec, idx) => {
    const date = new Date(rec.importedAt);
    const dateStr = `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')} ${String(date.getHours()).padStart(2,'0')}:${String(date.getMinutes()).padStart(2,'0')}`;
    const sizeKB = (rec.fileSize / 1024).toFixed(1);
    return `
      <li class="trash-item">
        <div class="info">
          <div class="title">${escapeHtml(rec.filename)}</div>
          <div class="meta">匯入時間：${dateStr}<br>筆數：${rec.rowCount} 筆 · 大小：${sizeKB} KB</div>
        </div>
        <div class="actions">
          <button class="icon-btn" onclick="downloadImportedFile(${idx})">下載</button>
          <button class="icon-btn del" onclick="deleteImportRecord(${idx})">刪除紀錄</button>
        </div>
      </li>
    `;
  }).join('');
}
function downloadImportedFile(idx) {
  const rec = state.importHistory[idx];
  if (!rec) return;
  const blob = base64ToBlob(rec.fileBase64, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = rec.filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
function deleteImportRecord(idx) {
  const rec = state.importHistory[idx];
  if (!rec) return;
  if (!confirm(`刪除「${rec.filename}」的匯入紀錄？`)) return;
  state.importHistory.splice(idx, 1);
  saveLocal();
  renderImportHistory();
}
function clearImportHistory() {
  if (!state.importHistory.length) return;
  if (!confirm(`清空所有匯入紀錄？`)) return;
  state.importHistory = [];
  saveLocal();
  renderImportHistory();
}

// ---------- 重新載入 ----------
async function refreshFromCloud() {
  await loadFromCloud();
  refreshDropdowns();
  refreshMonthFilter();
  refreshCopyMonthFilter();
  render();
  renderCopy();
}

// ---------- 檢視切換 / 排序 / 篩選 ----------
function setView(v) {
  currentView = v;
  document.querySelectorAll('#section-bn .view-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.view === v);
  });
  document.getElementById('view-table').style.display = v === 'table' ? '' : 'none';
  document.getElementById('pagination').style.display = v === 'table' ? '' : 'none';
  document.getElementById('view-calendar').style.display = v === 'calendar' ? '' : 'none';
  render();
}
function sortBy(key) {
  if (sortKey === key) sortDir = sortDir === 'asc' ? 'desc' : 'asc';
  else { sortKey = key; sortDir = 'asc'; }
  render();
}
function onFilterChange() { currentPage = 1; render(); }

function getVisibleTasks() {
  const search = document.getElementById('search').value.trim().toLowerCase();
  const fs = document.getElementById('filter-status').value;
  const fc = document.getElementById('filter-creator').value;
  const fm = document.getElementById('filter-major').value;
  const fmonth = document.getElementById('filter-month').value;
  const fu = document.getElementById('filter-urgent').value;

  return state.tasks.filter(t => {
    if (search) {
      const blob = [t.majorCategory, t.bnCategory, t.bnSize, t.bnContent, t.filePath, t.dispatcher, t.creator]
        .join(' ').toLowerCase();
      if (!blob.includes(search)) return false;
    }
    if (fs && t.status !== fs) return false;
    if (fc === '__none__' && t.creator) return false;
    if (fc && fc !== '__none__' && t.creator !== fc) return false;
    if (fm === '__none__' && t.majorCategory) return false;
    if (fm && fm !== '__none__' && t.majorCategory !== fm) return false;
    if (fmonth && getMonthOf(t.dispatchDate) !== fmonth) return false;
    if (fu === 'urgent' && !isUrgent(t)) return false;
    return true;
  });
}

// ---------- 渲染 ----------
function render() {
  const visible = getVisibleTasks();
  const sorted = [...visible].sort((a, b) => {
    const av = a[sortKey] ?? '';
    const bv = b[sortKey] ?? '';
    if (av < bv) return sortDir === 'asc' ? -1 : 1;
    if (av > bv) return sortDir === 'asc' ? 1 : -1;
    return 0;
  });

  const counts = { pending: 0, done: 0 };
  let overdueCount = 0;
  visible.forEach(t => {
    counts[t.status] = (counts[t.status] || 0) + 1;
    if (isOverdue(t)) overdueCount++;
  });
  document.getElementById('m-total').textContent = visible.length;
  document.getElementById('m-pending').textContent = counts.pending;
  document.getElementById('m-done').textContent = counts.done;
  document.getElementById('m-overdue').textContent = overdueCount;

  const fmonth = document.getElementById('filter-month').value;
  const monthText = fmonth ? `（${formatMonth(fmonth)}）` : '（全部）';
  document.getElementById('hours-month-label').textContent = monthText;
  document.getElementById('count-month-label').textContent = monthText;

  if (currentView === 'table') renderTablePaged(sorted);
  else renderCalendar(visible);
  renderCharts(visible);
  updateTrashButton();
}

function renderTablePaged(rows) {
  const total = rows.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  if (currentPage > totalPages) currentPage = totalPages;
  const start = (currentPage - 1) * PAGE_SIZE;
  const end = Math.min(start + PAGE_SIZE, total);
  const pageRows = rows.slice(start, end);
  renderTable(pageRows);
  renderPagination(total, start, end, totalPages);
}

function renderTable(rows) {
  const tbody = document.getElementById('table-body');
  const empty = document.getElementById('table-empty');
  if (!rows.length) {
    tbody.innerHTML = '';
    empty.style.display = '';
    return;
  }
  empty.style.display = 'none';
  tbody.innerHTML = rows.map(t => {
    const overdue = isOverdue(t);
    const urgent = isUrgent(t);
    const dueClass = overdue ? 'cell-date overdue' : 'cell-date';
    const dueText = formatTableDate(t.dueDate);
    const dueDisplay = !t.dueDate
      ? ''
      : urgent
        ? `<span class="due-pill urgent">${escapeHtml(dueText)}${overdue ? ' ⚠' : ''}</span>`
        : `${escapeHtml(dueText)}${overdue ? ' ⚠' : ''}`;
    const catBadge = t.majorCategory
      ? `<span class="cat-badge ${t.majorCategory}">${escapeHtml(t.majorCategory)}</span>`
      : `<span class="cat-badge uncategorized">未分類</span>`;
    const creatorOptions = '<option value="">未指派</option>' +
      state.creators.map(a =>
        `<option value="${escapeHtml(a)}" ${a === t.creator ? 'selected' : ''}>${escapeHtml(a)}</option>`
      ).join('');
    const creatorIdx = getCreatorColorIndex(t.creator);
    const creatorSelectClass = !t.creator
      ? 'cell-select unassigned-select'
      : `cell-select creator-pill creator-color-${creatorIdx}`;
    return `
      <tr class="${overdue ? 'row-overdue' : ''}" onclick="if(!event.target.closest('button') && !event.target.closest('select')) showDetail(${t.id})">
        <td class="cell-date">${escapeHtml(formatTableDate(t.dispatchDate))}</td>
        <td>${catBadge}</td>
        <td><b>${escapeHtml(t.bnCategory)}</b></td>
        <td><div class="cell-multiline">${escapeHtml(t.bnSize)}</div></td>
        <td><div class="cell-multiline">${escapeHtml(t.bnContent)}</div></td>
        <td>
          <select class="${creatorSelectClass}" onclick="event.stopPropagation()" onchange="updateCreator(${t.id}, this.value)">
            ${creatorOptions}
          </select>
        </td>
        <td><span class="status-pill ${t.status}">${statusLabel(t.status)}</span></td>
        <td>${escapeHtml(t.dispatcher) || '<span class="unassigned">—</span>'}</td>
        <td class="${dueClass}">${dueDisplay}</td>
        <td class="cell-date">${escapeHtml(formatTableDate(t.completedDate))}</td>
        <td class="cell-num">${Math.round((t.hours || 0) * 10) / 10}</td>
        <td class="cell-actions">
          <button class="icon-btn del" onclick="event.stopPropagation(); deleteTask(${t.id})">刪</button>
        </td>
      </tr>
    `;
  }).join('');
}

function renderPagination(total, start, end, totalPages) {
  const container = document.getElementById('pagination');
  if (total === 0) { container.innerHTML = ''; return; }
  let html = `<span class="page-info">顯示 ${start + 1}–${end} / 共 ${total} 筆</span>`;
  if (totalPages <= 1) { container.innerHTML = html; return; }
  html += `<button class="page-btn" ${currentPage === 1 ? 'disabled' : ''} onclick="goToPage(${currentPage - 1})">‹</button>`;
  const pages = pageNumbers(currentPage, totalPages);
  pages.forEach(p => {
    if (p === '...') html += `<span class="ellipsis">…</span>`;
    else html += `<button class="page-btn ${p === currentPage ? 'active' : ''}" onclick="goToPage(${p})">${p}</button>`;
  });
  html += `<button class="page-btn" ${currentPage === totalPages ? 'disabled' : ''} onclick="goToPage(${currentPage + 1})">›</button>`;
  container.innerHTML = html;
}
function pageNumbers(current, total) {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const pages = [1];
  if (current > 3) pages.push('...');
  for (let i = Math.max(2, current - 1); i <= Math.min(total - 1, current + 1); i++) pages.push(i);
  if (current < total - 2) pages.push('...');
  pages.push(total);
  return pages;
}
function goToPage(n) {
  currentPage = n;
  render();
  document.querySelector('.table-wrap')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ---------- 日曆檢視 ----------
function formatLocalDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function changeCalendarMonth(delta) {
  currentCalendarMonth = new Date(
    currentCalendarMonth.getFullYear(),
    currentCalendarMonth.getMonth() + delta,
    1
  );
  render();
}

function goToCurrentMonth() {
  currentCalendarMonth = new Date();
  render();
}

function renderCalendar(visible) {
  const year = currentCalendarMonth.getFullYear();
  const month = currentCalendarMonth.getMonth(); // 0-11

  // 標題
  document.getElementById('calendar-title').textContent = `${year}年${month + 1}月`;

  // 依 dueDate 把工單分組
  const tasksByDate = {};
  visible.forEach(t => {
    if (!t.dueDate) return;
    if (!tasksByDate[t.dueDate]) tasksByDate[t.dueDate] = [];
    tasksByDate[t.dueDate].push(t);
  });

  // 計算日曆格子
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const startWeekday = firstDay.getDay(); // 0=星期日
  const daysInMonth = lastDay.getDate();

  const cells = [];
  // 上個月的尾巴（灰色顯示）
  for (let i = startWeekday - 1; i >= 0; i--) {
    const d = new Date(year, month, -i);
    cells.push({ date: d, otherMonth: true });
  }
  // 本月
  for (let i = 1; i <= daysInMonth; i++) {
    cells.push({ date: new Date(year, month, i), otherMonth: false });
  }
  // 下個月的開頭，補滿到 7 的倍數
  while (cells.length % 7 !== 0) {
    const last = cells[cells.length - 1].date;
    const nd = new Date(last);
    nd.setDate(nd.getDate() + 1);
    cells.push({ date: nd, otherMonth: true });
  }

  const today = todayStr();
  const dayNamesHtml = ['日', '一', '二', '三', '四', '五', '六']
    .map(n => `<div class="calendar-day-name">${n}</div>`).join('');

  const cellsHtml = cells.map(cell => {
    const dateStr = formatLocalDate(cell.date);
    const isToday = dateStr === today;
    const dayTasks = tasksByDate[dateStr] || [];
    const cellClasses = ['calendar-cell'];
    if (cell.otherMonth) cellClasses.push('other-month');
    if (isToday) cellClasses.push('today');

    const tasksToShow = dayTasks.slice(0, 3);
    const moreCount = dayTasks.length - tasksToShow.length;

    const tasksHtml = tasksToShow.map(t => {
      const classes = ['cal-task', t.status];
      if (isUrgent(t)) classes.push('urgent');
      const titleAttr = `${t.bnCategory}　${t.creator || '未指派'}　時數 ${t.hours || 0}h`;
      return `<div class="${classes.join(' ')}" onclick="showDetail(${t.id})" title="${escapeHtml(titleAttr)}">
        ${escapeHtml(t.bnCategory || '（未命名）')}
      </div>`;
    }).join('');

    const moreHtml = moreCount > 0
      ? `<div class="cal-more" title="共 ${dayTasks.length} 筆">+${moreCount} 筆</div>`
      : '';

    return `
      <div class="${cellClasses.join(' ')}">
        <div class="calendar-day-num">${cell.date.getDate()}</div>
        <div class="calendar-tasks">${tasksHtml}${moreHtml}</div>
      </div>
    `;
  }).join('');

  document.getElementById('calendar-grid').innerHTML = dayNamesHtml + cellsHtml;
}

function renderCharts(visible) {
  const hoursMap = {};
  const countMap = {};
  state.creators.forEach(a => { hoursMap[a] = 0; countMap[a] = 0; });
  visible.forEach(t => {
    if (t.creator && hoursMap[t.creator] !== undefined) {
      hoursMap[t.creator] += (t.hours || 0);
      if (t.status === 'done') countMap[t.creator] += 1;
    }
  });
  const isDark = document.body.getAttribute('data-theme') === 'dark';
  const textColor = isDark ? '#a8a59f' : '#6b6b66';
  const gridColor = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)';

  if (hoursChart) hoursChart.destroy();
  if (countChart) countChart.destroy();

  hoursChart = new Chart(document.getElementById('hours-chart'), {
    type: 'bar',
    data: {
      labels: state.creators,
      datasets: [{ label: '工時', data: state.creators.map(a => Math.round(hoursMap[a] * 10) / 10), backgroundColor: '#7c3aed', borderRadius: 5 }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        y: { beginAtZero: true, ticks: { font: { size: 11 }, color: textColor }, grid: { color: gridColor } },
        x: { ticks: { font: { size: 11 }, color: textColor }, grid: { display: false } },
      },
    },
  });

  countChart = new Chart(document.getElementById('count-chart'), {
    type: 'bar',
    data: {
      labels: state.creators,
      datasets: [{ label: '完成件數', data: state.creators.map(a => countMap[a]), backgroundColor: '#0d9488', borderRadius: 5 }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        y: { beginAtZero: true, ticks: { font: { size: 11 }, color: textColor, stepSize: 1, precision: 0 }, grid: { color: gridColor } },
        x: { ticks: { font: { size: 11 }, color: textColor }, grid: { display: false } },
      },
    },
  });
}

// ---------- 漢堡選單 / 區塊切換 ----------
function toggleSidebar() {
  const isOpen = document.getElementById('sidebar').classList.contains('open');
  if (isOpen) closeSidebar();
  else openSidebar();
}
function openSidebar() {
  document.getElementById('sidebar').classList.add('open');
  document.getElementById('sidebar-overlay').classList.add('open');
}
function closeSidebar() {
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('sidebar-overlay').classList.remove('open');
}
function toggleExcelMenu() {
  const submenu = document.getElementById('excel-submenu');
  const toggle = document.getElementById('excel-toggle');
  const isOpen = submenu.classList.toggle('open');
  toggle.classList.toggle('expanded', isOpen);
}
function switchSection(id) {
  if (!SECTIONS[id]) return;
  activeSection = id;
  localStorage.setItem('bn_active_section', id);
  // 更新左邊選單的 active 樣式
  document.querySelectorAll('.sidebar-item').forEach(item => {
    item.classList.toggle('active', item.dataset.section === id);
  });
  // 切換區塊顯示
  document.querySelectorAll('.page-section').forEach(s => {
    s.style.display = 'none';
  });
  const target = document.getElementById('section-' + id);
  if (target) target.style.display = '';
  closeSidebar();
}

// ---------- 啟動 ----------
async function init() {
  loadTheme();
  // 還原上次選的區塊
  switchSection(activeSection);
  // 1. 先用本地快取立即顯示（如果有的話）
  loadLocal();
  refreshDropdowns();
  refreshMonthFilter();
  refreshCopyMonthFilter();
  document.getElementById('f-dispatchDate').value = todayStr();
  render();
  renderCopy();

  // 2. 然後從雲端拉最新資料覆蓋
  const ok = await loadFromCloud();
  refreshDropdowns();
  refreshMonthFilter();
  refreshCopyMonthFilter();
  render();
  renderCopy();

  if (!ok) {
    console.warn('Cloud connection failed - using local cache only');
  }
}

document.addEventListener('DOMContentLoaded', init);
