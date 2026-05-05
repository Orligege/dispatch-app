/* ==========================================================
   文案派工區塊（COPY SECTION）
   - 與 BN 派工分開的程式碼，要修改文案派工只動這個檔
   - 共用的 state、api()、refreshDropdowns 等放在 app.js
   ========================================================== */

// ---------- 文案派工專屬狀態 ----------
let copyEditingId = null;
let copyCurrentView = 'table';
let copyCurrentPage = 1;
let copySortKey = 'id';      // 預設用 id 排序，新建的工單（id 最大）會在最前面
let copySortDir = 'desc';
let copyHoursChart = null;
let copyCountChart = null;
let copyCurrentCalendarMonth = new Date();

// ---------- 工具 ----------
function copyIsLaunched(t) { return t.launched === true || t.launched === '✓'; }

// 狀態（從文案圖完成日期推導）：有日期 = 完成，沒日期 = 待派工
function copyComputedStatus(t) {
  return t.imageCompleted ? 'done' : 'pending';
}
function copyStatusLabel(t) {
  return copyComputedStatus(t) === 'done' ? '完成' : '待派工';
}

// ---------- CRUD ----------
async function submitCopyTask() {
  const productName = document.getElementById('f-copy-productName').value.trim();
  if (!productName) {
    const el = document.getElementById('copy-form-msg');
    el.textContent = '請輸入品名';
    el.style.color = 'var(--danger)';
    setTimeout(() => { el.textContent = ''; }, 2500);
    return;
  }

  const data = {
    brand: document.getElementById('f-copy-brand').value.trim(),
    productName,
    writingDate: document.getElementById('f-copy-writingDate').value || '',
    copyConfirmedDate: document.getElementById('f-copy-copyConfirmedDate').value || '',
    imageCompleted: document.getElementById('f-copy-imageCompleted').value || '',
    creator: document.getElementById('f-copy-creator').value,
    priority: document.getElementById('f-copy-priority').value.trim(),
    hours: parseFloat(document.getElementById('f-copy-hours').value) || 0,
  };

  setSyncStatus('syncing');
  try {
    if (copyEditingId !== null) {
      const existing = state.copyTasks.find(t => t.id === copyEditingId) || {};
      const payload = { ...existing, ...data, id: copyEditingId };
      const result = await api('update', { sheet: 'copy_tasks', payload });
      const idx = state.copyTasks.findIndex(t => t.id === copyEditingId);
      if (idx >= 0) state.copyTasks[idx] = result;
      cancelCopyEdit();
    } else {
      const result = await api('create', { sheet: 'copy_tasks', payload: { ...data, launched: false } });
      state.copyTasks.push(result);
      clearCopyForm();
    }
    saveLocal();
    refreshCopyMonthFilter();
    renderCopy();
    setSyncStatus('ok');
  } catch (err) {
    setSyncStatus('error');
    alert('儲存失敗：' + err.message);
  }
}

function editCopyTask(id) {
  const t = state.copyTasks.find(x => x.id === id);
  if (!t) return;
  document.getElementById('f-copy-brand').value = t.brand || '';
  document.getElementById('f-copy-productName').value = t.productName || '';
  document.getElementById('f-copy-writingDate').value = t.writingDate || '';
  document.getElementById('f-copy-copyConfirmedDate').value = t.copyConfirmedDate || '';
  document.getElementById('f-copy-imageCompleted').value = t.imageCompleted || '';
  document.getElementById('f-copy-creator').value = t.creator || '';
  document.getElementById('f-copy-priority').value = t.priority || '';
  document.getElementById('f-copy-hours').value = t.hours || '';

  copyEditingId = id;
  document.getElementById('copy-form-title').textContent = `編輯工單 #${id}`;
  document.getElementById('copy-submit-btn').textContent = '更新工單';
  document.getElementById('copy-cancel-btn').style.display = 'inline-block';
  document.getElementById('f-copy-productName').focus();
  document.querySelector('#section-copy .form-card').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function cancelCopyEdit() {
  copyEditingId = null;
  document.getElementById('copy-form-title').textContent = '新增工單';
  document.getElementById('copy-submit-btn').textContent = '新增工單';
  document.getElementById('copy-cancel-btn').style.display = 'none';
  clearCopyForm();
}

function clearCopyForm() {
  ['f-copy-brand', 'f-copy-productName',
   'f-copy-writingDate', 'f-copy-copyConfirmedDate', 'f-copy-imageCompleted',
   'f-copy-priority', 'f-copy-hours'].forEach(id => {
    document.getElementById(id).value = '';
  });
  document.getElementById('f-copy-creator').value = '';
}

async function deleteCopyTask(id) {
  const t = state.copyTasks.find(x => x.id === id);
  if (!t) return;
  if (!confirm(`刪除「${t.productName || '未命名'}」？\n\n（${TRASH_RETENTION_DAYS} 天內可從「最近刪除」復原，但僅限本人）`)) return;

  setSyncStatus('syncing');
  try {
    await api('delete', { sheet: 'copy_tasks', id: String(id) });
    state.copyTrash.push({ task: { ...t }, deletedAt: new Date().toISOString() });
    state.copyTasks = state.copyTasks.filter(x => x.id !== id);
    if (copyEditingId === id) cancelCopyEdit();
    saveLocal();
    refreshCopyMonthFilter();
    renderCopy();
    setSyncStatus('ok');
  } catch (err) {
    setSyncStatus('error');
    alert('刪除失敗：' + err.message);
  }
}

async function updateCopyCreator(id, newCreator) {
  const t = state.copyTasks.find(x => x.id === id);
  if (!t || t.creator === newCreator) return;
  setSyncStatus('syncing');
  try {
    const payload = { ...t, creator: newCreator };
    const result = await api('update', { sheet: 'copy_tasks', payload });
    const idx = state.copyTasks.findIndex(x => x.id === id);
    if (idx >= 0) state.copyTasks[idx] = result;
    saveLocal();
    renderCopy();
    setSyncStatus('ok');
  } catch (err) {
    setSyncStatus('error');
    alert('製作人更新失敗：' + err.message);
  }
}

async function toggleCopyLaunched(id) {
  const t = state.copyTasks.find(x => x.id === id);
  if (!t) return;
  setSyncStatus('syncing');
  try {
    const payload = { ...t, launched: !copyIsLaunched(t) };
    const result = await api('update', { sheet: 'copy_tasks', payload });
    const idx = state.copyTasks.findIndex(x => x.id === id);
    if (idx >= 0) state.copyTasks[idx] = result;
    saveLocal();
    renderCopy();
    setSyncStatus('ok');
  } catch (err) {
    setSyncStatus('error');
    alert('上架狀態更新失敗：' + err.message);
  }
}

// 通用更新單一欄位（給內部即時更新用，例如 toggleLaunched / updateCreator）
// 目前 Modal 內已改為「按儲存才存」，這個函式保留供其他地方使用

// ---------- 篩選 ----------
function getVisibleCopyTasks() {
  const search = document.getElementById('copy-search').value.trim().toLowerCase();
  const fs = document.getElementById('copy-filter-status').value;
  const fc = document.getElementById('copy-filter-creator').value;
  const fmonth = document.getElementById('copy-filter-month').value;

  return state.copyTasks.filter(t => {
    if (search) {
      const blob = [t.brand, t.productName, t.creator, t.priority]
        .join(' ').toLowerCase();
      if (!blob.includes(search)) return false;
    }
    // 狀態篩選：pending = 待派工、done = 完成、launched = 已上架（獨立於 done）
    if (fs === 'pending' && copyComputedStatus(t) !== 'pending') return false;
    if (fs === 'done' && copyComputedStatus(t) !== 'done') return false;
    if (fs === 'launched' && !copyIsLaunched(t)) return false;
    if (fc === '__none__' && t.creator) return false;
    if (fc && fc !== '__none__' && t.creator !== fc) return false;
    if (fmonth && getMonthOf(t.writingDate) !== fmonth) return false;
    return true;
  });
}

function refreshCopyMonthFilter() {
  const sel = document.getElementById('copy-filter-month');
  if (!sel) return;
  const cur = sel.value;
  const months = new Set();
  state.copyTasks.forEach(t => {
    const m = getMonthOf(t.writingDate);
    if (m) months.add(m);
  });
  const sorted = Array.from(months).sort().reverse();
  sel.innerHTML = '<option value="">全部月份</option>' +
    sorted.map(m => `<option value="${m}">${formatMonth(m)}</option>`).join('');
  if (sorted.includes(cur)) sel.value = cur;
}

function setCopyView(v) {
  copyCurrentView = v;
  document.querySelectorAll('#section-copy .view-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.view === v);
  });
  document.getElementById('copy-view-table').style.display = v === 'table' ? '' : 'none';
  document.getElementById('copy-pagination').style.display = v === 'table' ? '' : 'none';
  document.getElementById('copy-view-calendar').style.display = v === 'calendar' ? '' : 'none';
  renderCopy();
}

function sortCopyBy(key) {
  if (copySortKey === key) copySortDir = copySortDir === 'asc' ? 'desc' : 'asc';
  else { copySortKey = key; copySortDir = 'asc'; }
  renderCopy();
}

function onCopyFilterChange() { copyCurrentPage = 1; renderCopy(); }

// ---------- 渲染 ----------
function renderCopy() {
  const visible = getVisibleCopyTasks();
  const sorted = [...visible].sort((a, b) => {
    const av = a[copySortKey] ?? '';
    const bv = b[copySortKey] ?? '';
    if (av < bv) return copySortDir === 'asc' ? -1 : 1;
    if (av > bv) return copySortDir === 'asc' ? 1 : -1;
    return 0;
  });

  let pendingCount = 0, doneCount = 0, launchedCount = 0;
  visible.forEach(t => {
    if (copyComputedStatus(t) === 'pending') pendingCount++;
    else doneCount++;
    if (copyIsLaunched(t)) launchedCount++;
  });
  document.getElementById('copy-m-total').textContent = visible.length;
  document.getElementById('copy-m-pending').textContent = pendingCount;
  document.getElementById('copy-m-done').textContent = doneCount;
  document.getElementById('copy-m-launched').textContent = launchedCount;

  const fmonth = document.getElementById('copy-filter-month').value;
  const monthText = fmonth ? `（${formatMonth(fmonth)}）` : '（全部）';
  document.getElementById('copy-hours-month-label').textContent = monthText;
  document.getElementById('copy-count-month-label').textContent = monthText;

  if (copyCurrentView === 'table') renderCopyTablePaged(sorted);
  else renderCopyCalendar(visible);
  renderCopyCharts(visible);
  updateTrashButton();
}

function renderCopyTablePaged(rows) {
  const total = rows.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  if (copyCurrentPage > totalPages) copyCurrentPage = totalPages;
  const start = (copyCurrentPage - 1) * PAGE_SIZE;
  const end = Math.min(start + PAGE_SIZE, total);
  renderCopyTable(rows.slice(start, end));
  renderCopyPagination(total, start, end, totalPages);
}

function renderCopyTable(rows) {
  const tbody = document.getElementById('copy-table-body');
  const empty = document.getElementById('copy-table-empty');
  if (!rows.length) {
    tbody.innerHTML = '';
    empty.style.display = '';
    return;
  }
  empty.style.display = 'none';
  tbody.innerHTML = rows.map(t => {
    const launched = copyIsLaunched(t);

    const creatorOptions = '<option value="">未指派</option>' +
      state.creators.map(a =>
        `<option value="${escapeHtml(a)}" ${a === t.creator ? 'selected' : ''}>${escapeHtml(a)}</option>`
      ).join('');
    const creatorIdx = getCreatorColorIndex(t.creator);
    const creatorSelectClass = !t.creator
      ? 'cell-select unassigned-select'
      : `cell-select creator-pill creator-color-${creatorIdx}`;

    return `
      <tr onclick="if(!event.target.closest('button') && !event.target.closest('select') && !event.target.closest('input')) showCopyDetail(${t.id})">
        <td>${escapeHtml(t.brand) || '<span class="unassigned">—</span>'}</td>
        <td><b>${escapeHtml(t.productName)}</b></td>
        <td class="cell-date">${escapeHtml(formatTableDate(t.writingDate))}</td>
        <td class="cell-date">${escapeHtml(formatTableDate(t.copyConfirmedDate))}</td>
        <td class="cell-date">${escapeHtml(formatTableDate(t.imageCompleted))}</td>
        <td><span class="status-pill ${copyComputedStatus(t)}">${copyStatusLabel(t)}</span></td>
        <td style="text-align:center">
          <input type="checkbox" class="launched-check" ${launched ? 'checked' : ''} onclick="event.stopPropagation(); toggleCopyLaunched(${t.id})" />
        </td>
        <td>
          <select class="${creatorSelectClass}" onclick="event.stopPropagation()" onchange="updateCopyCreator(${t.id}, this.value)">
            ${creatorOptions}
          </select>
        </td>
        <td>${escapeHtml(t.priority) || '<span class="unassigned">—</span>'}</td>
        <td class="cell-num">${Math.round((t.hours || 0) * 10) / 10}</td>
        <td class="cell-actions">
          <button class="icon-btn del" onclick="event.stopPropagation(); deleteCopyTask(${t.id})">刪</button>
        </td>
      </tr>
    `;
  }).join('');
}

function renderCopyPagination(total, start, end, totalPages) {
  const container = document.getElementById('copy-pagination');
  if (total === 0) { container.innerHTML = ''; return; }
  let html = `<span class="page-info">顯示 ${start + 1}–${end} / 共 ${total} 筆</span>`;
  if (totalPages <= 1) { container.innerHTML = html; return; }
  html += `<button class="page-btn" ${copyCurrentPage === 1 ? 'disabled' : ''} onclick="goToCopyPage(${copyCurrentPage - 1})">‹</button>`;
  const pages = pageNumbers(copyCurrentPage, totalPages);
  pages.forEach(p => {
    if (p === '...') html += `<span class="ellipsis">…</span>`;
    else html += `<button class="page-btn ${p === copyCurrentPage ? 'active' : ''}" onclick="goToCopyPage(${p})">${p}</button>`;
  });
  html += `<button class="page-btn" ${copyCurrentPage === totalPages ? 'disabled' : ''} onclick="goToCopyPage(${copyCurrentPage + 1})">›</button>`;
  container.innerHTML = html;
}

function goToCopyPage(n) {
  copyCurrentPage = n;
  renderCopy();
  document.querySelector('#section-copy .table-wrap')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ---------- 日曆 ----------
function changeCopyCalendarMonth(delta) {
  copyCurrentCalendarMonth = new Date(
    copyCurrentCalendarMonth.getFullYear(),
    copyCurrentCalendarMonth.getMonth() + delta,
    1
  );
  renderCopy();
}

function goToCopyCurrentMonth() {
  copyCurrentCalendarMonth = new Date();
  renderCopy();
}

function renderCopyCalendar(visible) {
  const year = copyCurrentCalendarMonth.getFullYear();
  const month = copyCurrentCalendarMonth.getMonth();
  document.getElementById('copy-calendar-title').textContent = `${year}年${month + 1}月`;

  const tasksByDate = {};
  visible.forEach(t => {
    if (!t.writingDate) return;
    if (!tasksByDate[t.writingDate]) tasksByDate[t.writingDate] = [];
    tasksByDate[t.writingDate].push(t);
  });

  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const startWeekday = firstDay.getDay();
  const daysInMonth = lastDay.getDate();

  const cells = [];
  for (let i = startWeekday - 1; i >= 0; i--) {
    cells.push({ date: new Date(year, month, -i), otherMonth: true });
  }
  for (let i = 1; i <= daysInMonth; i++) {
    cells.push({ date: new Date(year, month, i), otherMonth: false });
  }
  while (cells.length % 7 !== 0) {
    const last = cells[cells.length - 1].date;
    const nd = new Date(last);
    nd.setDate(nd.getDate() + 1);
    cells.push({ date: nd, otherMonth: true });
  }

  const today = todayStr();
  const dayNamesHtml = ['日','一','二','三','四','五','六']
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
      const classes = ['cal-task', copyIsLaunched(t) ? 'done' : 'pending'];
      const titleAttr = `${t.brand || ''} ${t.productName} - ${t.creator || '未指派'}`;
      return `<div class="${classes.join(' ')}" onclick="showCopyDetail(${t.id})" title="${escapeHtml(titleAttr)}">
        ${escapeHtml(t.productName || '（未命名）')}
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

  document.getElementById('copy-calendar-grid').innerHTML = dayNamesHtml + cellsHtml;
}

// ---------- 圖表 ----------
function renderCopyCharts(visible) {
  const hoursMap = {};
  const countMap = {};
  state.creators.forEach(a => { hoursMap[a] = 0; countMap[a] = 0; });
  visible.forEach(t => {
    if (t.creator && hoursMap[t.creator] !== undefined) {
      hoursMap[t.creator] += (t.hours || 0);
      // 製作件數：以「文案圖完成日期」有填為準
      if (t.imageCompleted) countMap[t.creator] += 1;
    }
  });
  const isDark = document.body.getAttribute('data-theme') === 'dark';
  const textColor = isDark ? '#a8a59f' : '#6b6b66';
  const gridColor = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)';

  if (copyHoursChart) copyHoursChart.destroy();
  if (copyCountChart) copyCountChart.destroy();

  copyHoursChart = new Chart(document.getElementById('copy-hours-chart'), {
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

  copyCountChart = new Chart(document.getElementById('copy-count-chart'), {
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

// ---------- 詳細檢視（先檢視，按編輯才進入編輯模式） ----------
function showCopyDetail(id) {
  const t = state.copyTasks.find(x => x.id === id);
  if (!t) return;
  document.getElementById('detail-title').textContent = `工單 #${id} ・ ${t.productName || ''}`;
  renderCopyDetailView(id);
  document.getElementById('detail-modal').classList.add('open');
}

// 檢視模式：純顯示
function renderCopyDetailView(id) {
  const t = state.copyTasks.find(x => x.id === id);
  if (!t) return;
  const launchedHtml = copyIsLaunched(t)
    ? '<span class="status-pill done">✓ 已上架</span>'
    : '<span class="status-pill pending">未上架</span>';
  const statusHtml = `<span class="status-pill ${copyComputedStatus(t)}">${copyStatusLabel(t)}</span>`;
  document.getElementById('detail-body').innerHTML = `
    <dl class="detail-grid">
      <dt>品牌</dt><dd>${escapeHtml(t.brand) || '—'}</dd>
      <dt>品名</dt><dd>${escapeHtml(t.productName)}</dd>
      <dt>狀態</dt><dd>${statusHtml}</dd>
      <dt>撰寫完成日期</dt><dd>${escapeHtml(t.writingDate || '—')}</dd>
      <dt>文案確認日期</dt><dd>${escapeHtml(t.copyConfirmedDate || '—')}</dd>
      <dt>文案圖完成日期</dt><dd>${escapeHtml(t.imageCompleted || '—')}</dd>
      <dt>大平台上架</dt><dd>${launchedHtml}</dd>
      <dt>製作人</dt><dd>${escapeHtml(t.creator) || '<span class="unassigned">未指派</span>'}</dd>
      <dt>文圖優先順序</dt><dd>${escapeHtml(t.priority) || '—'}</dd>
      <dt>作業時間</dt><dd>${(Math.round((t.hours || 0) * 10) / 10)} 小時</dd>
    </dl>
    <div style="display:flex; gap:8px; margin-top:20px; justify-content:flex-end">
      <button class="btn btn-ghost danger" onclick="closeDetail(); deleteCopyTask(${id})">刪除</button>
      <button class="btn btn-primary" onclick="renderCopyDetailEdit(${id})">編輯</button>
    </div>
  `;
}

// 編輯模式：所有欄位變成可編輯，按儲存才寫回雲端
function renderCopyDetailEdit(id) {
  const t = state.copyTasks.find(x => x.id === id);
  if (!t) return;

  const creatorOptions = '<option value="">未指派</option>' +
    state.creators.map(a =>
      `<option value="${escapeHtml(a)}" ${a === t.creator ? 'selected' : ''}>${escapeHtml(a)}</option>`
    ).join('');

  document.getElementById('detail-body').innerHTML = `
    <div class="detail-edit-grid">
      <label class="detail-edit-field">
        <span>品牌</span>
        <input type="text" id="edit-copy-brand" value="${escapeHtml(t.brand)}" />
      </label>
      <label class="detail-edit-field">
        <span>品名</span>
        <input type="text" id="edit-copy-productName" value="${escapeHtml(t.productName)}" />
      </label>
      <label class="detail-edit-field">
        <span>撰寫完成日期</span>
        <input type="date" id="edit-copy-writingDate" value="${escapeHtml(t.writingDate)}" />
      </label>
      <label class="detail-edit-field">
        <span>文案確認日期</span>
        <input type="date" id="edit-copy-copyConfirmedDate" value="${escapeHtml(t.copyConfirmedDate)}" />
      </label>
      <label class="detail-edit-field">
        <span>文案圖完成日期</span>
        <input type="date" id="edit-copy-imageCompleted" value="${escapeHtml(t.imageCompleted)}" />
      </label>
      <label class="detail-edit-field">
        <span>製作人</span>
        <select id="edit-copy-creator">${creatorOptions}</select>
      </label>
      <label class="detail-edit-field">
        <span>文圖優先順序</span>
        <input type="text" id="edit-copy-priority" value="${escapeHtml(t.priority)}" />
      </label>
      <label class="detail-edit-field">
        <span>作業時間（小時）</span>
        <input type="number" id="edit-copy-hours" step="0.5" min="0" value="${t.hours || ''}" />
      </label>
      <label class="detail-edit-field detail-edit-field-full detail-checkbox">
        <input type="checkbox" id="edit-copy-launched" ${copyIsLaunched(t) ? 'checked' : ''} />
        <span>大平台上架</span>
      </label>
    </div>
    <div style="display:flex; gap:8px; margin-top:20px; justify-content:flex-end">
      <button class="btn btn-ghost" onclick="renderCopyDetailView(${id})">取消</button>
      <button class="btn btn-primary" onclick="saveCopyDetailEdit(${id})">儲存</button>
    </div>
  `;
}

async function saveCopyDetailEdit(id) {
  const t = state.copyTasks.find(x => x.id === id);
  if (!t) return;

  const data = {
    brand: document.getElementById('edit-copy-brand').value.trim(),
    productName: document.getElementById('edit-copy-productName').value.trim(),
    writingDate: document.getElementById('edit-copy-writingDate').value || '',
    copyConfirmedDate: document.getElementById('edit-copy-copyConfirmedDate').value || '',
    imageCompleted: document.getElementById('edit-copy-imageCompleted').value || '',
    creator: document.getElementById('edit-copy-creator').value,
    priority: document.getElementById('edit-copy-priority').value.trim(),
    hours: parseFloat(document.getElementById('edit-copy-hours').value) || 0,
    launched: document.getElementById('edit-copy-launched').checked,
  };

  setSyncStatus('syncing');
  try {
    const payload = { ...t, ...data };
    const result = await api('update', { sheet: 'copy_tasks', payload });
    const idx = state.copyTasks.findIndex(x => x.id === id);
    if (idx >= 0) state.copyTasks[idx] = result;
    saveLocal();
    refreshCopyMonthFilter();
    renderCopy();
    setSyncStatus('ok');
    renderCopyDetailView(id);  // 存完回到檢視模式
  } catch (err) {
    setSyncStatus('error');
    alert('儲存失敗：' + err.message);
  }
}

// ---------- 最近刪除 ----------
function openCopyTrash() {
  cleanOldTrash();
  saveLocal();
  document.querySelector('#trash-modal .modal-head h2').textContent = '最近刪除（文案派工）';
  document.getElementById('trash-modal').classList.add('open');
  document.getElementById('trash-modal').dataset.section = 'copy';
  renderCopyTrashList();
}

function renderCopyTrashList() {
  const ul = document.getElementById('trash-list');
  if (!state.copyTrash.length) {
    ul.innerHTML = '<li class="trash-empty">垃圾桶是空的</li>';
    updateTrashButton();
    return;
  }
  const indexed = state.copyTrash.map((item, idx) => ({ item, idx }))
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
          <div class="title">${escapeHtml(t.productName || '（未命名）')}</div>
          <div class="meta">
            ${t.brand ? `${escapeHtml(t.brand)} · ` : ''}
            撰寫 ${escapeHtml(t.writingDate || '—')} · 製作人 ${escapeHtml(t.creator) || '未指派'}<br>
            ${ago}刪除　<span class="expire">${daysLeft} 天後永久刪除</span>
          </div>
        </div>
        <div class="actions">
          <button class="icon-btn" onclick="restoreFromCopyTrash(${idx})">復原</button>
          <button class="icon-btn del" onclick="permanentDeleteCopy(${idx})">永久刪除</button>
        </div>
      </li>
    `;
  }).join('');
  updateTrashButton();
}

async function restoreFromCopyTrash(idx) {
  const item = state.copyTrash[idx];
  if (!item) return;
  setSyncStatus('syncing');
  try {
    const { id, ...taskWithoutId } = item.task;
    const result = await api('create', { sheet: 'copy_tasks', payload: taskWithoutId });
    state.copyTasks.push(result);
    state.copyTrash.splice(idx, 1);
    saveLocal();
    refreshCopyMonthFilter();
    renderCopy();
    renderCopyTrashList();
    setSyncStatus('ok');
  } catch (err) {
    setSyncStatus('error');
    alert('復原失敗：' + err.message);
  }
}

function permanentDeleteCopy(idx) {
  const item = state.copyTrash[idx];
  if (!item) return;
  if (!confirm(`永久刪除「${item.task.productName || '未命名'}」？\n此動作無法復原。`)) return;
  state.copyTrash.splice(idx, 1);
  saveLocal();
  renderCopyTrashList();
  updateTrashButton();
}

// ---------- Excel 匯入匯出 ----------
const COPY_EXCEL_HEADERS = ['品牌', '品名', '撰寫完成日期', '文案確認日期', '文案圖完成日期', '製作人', '文圖優先順序', '大平台上架', '作業時間'];

function copyTasksToRows(tasks) {
  return tasks.map(t => ({
    '品牌': t.brand || '',
    '品名': t.productName || '',
    '撰寫完成日期': t.writingDate || '',
    '文案確認日期': t.copyConfirmedDate || '',
    '文案圖完成日期': t.imageCompleted || '',
    '製作人': t.creator || '',
    '文圖優先順序': t.priority || '',
    '大平台上架': copyIsLaunched(t) ? '✓' : '',
    '作業時間': t.hours || 0,
  }));
}

function downloadCopyTemplate() {
  const wb = XLSX.utils.book_new();
  const sample = [{
    '品牌': 'myFirst',
    '品名': '藍牙耳機 X1',
    '撰寫完成日期': '2026-05-02',
    '文案確認日期': '',
    '文案圖完成日期': '',
    '製作人': '瞳',
    '文圖優先順序': '高',
    '大平台上架': '',
    '作業時間': 1.5,
  }];
  const ws = XLSX.utils.json_to_sheet(sample, { header: COPY_EXCEL_HEADERS });
  ws['!cols'] = COPY_EXCEL_HEADERS.map(() => ({ wch: 14 }));
  XLSX.utils.book_append_sheet(wb, ws, '文案派工');
  XLSX.writeFile(wb, '文案派工_範本.xlsx');
}

// 文案匯出：開啟共用 modal（不顯示大分類選項）
function exportCopyExcel() {
  const all = state.copyTasks.length;
  const filtered = (typeof getVisibleCopyTasks === 'function' ? getVisibleCopyTasks() : state.copyTasks).length;
  document.getElementById('export-modal-title').textContent = '匯出 Excel - 文案派工';
  document.getElementById('export-count-all').textContent = `${all} 筆`;
  document.getElementById('export-count-filtered').textContent = `${filtered} 筆`;

  // 派工月份下拉
  const dispatchMonths = new Set();
  state.copyTasks.forEach(t => {
    const m = monthOf(t.dispatchDate);
    if (m) dispatchMonths.add(m);
  });
  const sortedMonths = [...dispatchMonths].sort().reverse();
  const monthSelect = document.getElementById('export-month-pick');
  if (sortedMonths.length === 0) {
    monthSelect.innerHTML = '<option value="">無資料</option>';
  } else {
    monthSelect.innerHTML = sortedMonths.map(m => {
      const cnt = state.copyTasks.filter(t => monthOf(t.dispatchDate) === m).length;
      return `<option value="${m}">${m}（${cnt} 筆）</option>`;
    }).join('');
  }

  // 完成日（imageCompleted）月份下拉
  const completedMonths = new Set();
  state.copyTasks.forEach(t => {
    const m = monthOf(t.imageCompleted);
    if (m) completedMonths.add(m);
  });
  const completedSorted = [...completedMonths].sort();
  const fromSel = document.getElementById('export-date-from');
  const toSel = document.getElementById('export-date-to');
  if (completedSorted.length === 0) {
    fromSel.innerHTML = '<option value="">無完成日資料</option>';
    toSel.innerHTML = '<option value="">無完成日資料</option>';
  } else {
    const opts = completedSorted.map(m => `<option value="${m}">${m}</option>`).join('');
    fromSel.innerHTML = opts;
    toSel.innerHTML = opts;
    toSel.value = completedSorted[completedSorted.length - 1];
  }

  // 文案沒有大分類，隱藏該區塊
  document.getElementById('export-major-section').style.display = 'none';

  document.querySelector('input[name=export-range][value=all]').checked = true;
  document.getElementById('export-modal').classList.add('open');
}

// 文案實際下載
function doExportCopy(tasks, filename) {
  const rows = copyTasksToRows(tasks);
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(rows, { header: COPY_EXCEL_HEADERS });
  ws['!cols'] = COPY_EXCEL_HEADERS.map(() => ({ wch: 14 }));
  XLSX.utils.book_append_sheet(wb, ws, '文案派工');
  XLSX.writeFile(wb, filename);
}

// 文案重複偵測 key：品牌+品名
function copyDupKey(t) {
  const norm = s => String(s || '').trim();
  return [norm(t.brand), norm(t.productName)].join('|');
}

async function importCopyExcel(event) {
  const file = event.target.files[0];
  event.target.value = '';
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async e => {
    try {
      const arrayBuffer = e.target.result;
      const wb = XLSX.read(arrayBuffer, { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
      if (!rows.length) { alert('Excel 沒有資料'); return; }

      const newCreators = new Set();
      const candidates = rows.map(row => {
        const get = (...keys) => {
          for (const k of keys) if (row[k] !== undefined && row[k] !== '') return row[k];
          return '';
        };
        const creator = String(get('製作人', 'Creator')).trim();
        if (creator && !state.creators.includes(creator)) newCreators.add(creator);
        const launchedRaw = String(get('大平台上架', 'Launched')).trim();
        const launched = launchedRaw === '✓' || launchedRaw === 'Y' || launchedRaw === '是' || launchedRaw === 'true';
        return {
          brand: String(get('品牌', 'Brand')).trim(),
          productName: String(get('品名', 'ProductName', '商品名稱')).trim(),
          writingDate: parseExcelDate(get('撰寫完成日期', 'WritingDate')),
          copyConfirmedDate: parseExcelDate(get('文案確認日期', '文案確認', 'CopyConfirmed')),
          imageCompleted: parseExcelDate(get('文案圖完成日期', '文案圖完成', 'ImageCompleted')),
          creator,
          priority: String(get('文圖優先順序', '優先順序', 'Priority')).trim(),
          launched,
          hours: parseFloat(get('作業時間', '時數', 'Hours')) || 0,
        };
      });

      // 分析重複/錯誤
      const existingKeys = buildDupKeySet(state.copyTasks, copyDupKey);
      const validate = (t) => {
        if (!t.brand && !t.productName) return '缺少品牌與品名';
        if (!t.productName) return '缺少品名';
        return null;
      };
      const analysis = analyzeImport(candidates, existingKeys, copyDupKey, validate);

      const fileBase64 = arrayBufferToBase64(arrayBuffer);
      const fileInfo = {
        filename: file.name,
        fileSize: file.size,
        fileBase64,
        rowCount: rows.length,
      };

      showImportPreview(analysis, fileInfo, async (action) => {
        const tasksToImport = (action === 'all')
          ? [...analysis.valid, ...analysis.duplicates.map(d => d.task)]
          : analysis.valid;

        if (!tasksToImport.length) { alert('沒有可匯入的資料'); return; }

        try {
          setSyncStatus('syncing');
          for (const n of newCreators) {
            await api('addPerson', { type: 'creator', name: n });
            state.creators.push(n);
          }
          const result = await api('bulkImport', { sheet: 'copy_tasks', payload: tasksToImport });
          if (result.tasks) state.copyTasks.push(...result.tasks);

          state.copyImportHistory.unshift({
            filename: file.name,
            importedAt: new Date().toISOString(),
            rowCount: tasksToImport.length,
            fileSize: file.size,
            fileBase64,
          });
          if (state.copyImportHistory.length > 10) state.copyImportHistory = state.copyImportHistory.slice(0, 10);

          saveLocal();
          refreshDropdowns();
          if (typeof refreshCopyMonthFilter === 'function') refreshCopyMonthFilter();
          renderCopy();
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

// ---------- 匯入紀錄 ----------
function openCopyImportHistory() {
  document.querySelector('#import-history-modal .modal-head h2').textContent = '匯入紀錄（文案派工）';
  document.getElementById('import-history-modal').classList.add('open');
  document.getElementById('import-history-modal').dataset.section = 'copy';
  renderCopyImportHistory();
}

function renderCopyImportHistory() {
  const ul = document.getElementById('import-history-list');
  if (!state.copyImportHistory.length) {
    ul.innerHTML = '<li class="trash-empty">尚無匯入紀錄</li>';
    return;
  }
  ul.innerHTML = state.copyImportHistory.map((rec, idx) => {
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
          <button class="icon-btn" onclick="downloadCopyImportedFile(${idx})">下載</button>
          <button class="icon-btn del" onclick="deleteCopyImportRecord(${idx})">刪除紀錄</button>
        </div>
      </li>
    `;
  }).join('');
}

function downloadCopyImportedFile(idx) {
  const rec = state.copyImportHistory[idx];
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

function deleteCopyImportRecord(idx) {
  const rec = state.copyImportHistory[idx];
  if (!rec) return;
  if (!confirm(`刪除「${rec.filename}」的匯入紀錄？`)) return;
  state.copyImportHistory.splice(idx, 1);
  saveLocal();
  renderCopyImportHistory();
}
