// TaskMPro - Enhanced Task Manager
// Added Features: Filters, Search, Inline Edit, Drag & Drop Reorder, Dark Mode, Export/Import, Due Dates, Sorting, Stats & Streak, PWA registration
// Timezone Update: All date logic (due dates, streaks, overdue) normalized to America/Los_Angeles (LA) to avoid off-by-one issues from UTC parsing.

(function() {
  // Storage key bumped to v3 for LA date key migration
  const TASKS_KEY_V2 = 'taskmpro.tasks.v2';
  const TASKS_KEY = 'taskmpro.tasks.v3';
  const PREF_KEY = 'taskmpro.prefs.v1';
  const form = document.getElementById('task-form');
  const input = document.getElementById('task-input');
  const dueInput = document.getElementById('due-input');
  const list = document.getElementById('task-list');
  const formMessage = document.getElementById('form-message');
  const emptyState = document.getElementById('empty-state');
  const taskCount = document.getElementById('task-count');
  const clearCompletedBtn = document.getElementById('clear-completed');
  const filterButtons = Array.from(document.querySelectorAll('.filter-btn'));
  const searchInput = document.getElementById('search');
  const sortSelect = document.getElementById('sort');
  const statsEl = document.getElementById('stats');
  const streakEl = document.getElementById('streak');
  const themeToggle = document.getElementById('theme-toggle');
  const exportBtn = document.getElementById('export-btn');
  const importBtn = document.getElementById('import-btn');
  const importFile = document.getElementById('import-file');
  const metaThemeColor = document.getElementById('meta-theme-color');

  /**
   * Task shape (v3)
   * due: LA date key string 'YYYY-MM-DD' or null
   * @typedef {{id:string,text:string,completed:boolean,created:number,completedAt:number|null,due:string|null,order:number}} Task
   */
  /** @type {Task[]} */
  let tasks = [];
  let filter = 'all'; // all | active | completed
  let search = '';
  let prefs = { theme: 'light', sort: 'created' }; // manual|due|created|completed
  let dragSrcId = null;

  // --- Timezone Helpers (Los Angeles) ---
  const LA_TZ = 'America/Los_Angeles';
  const dateKeyFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: LA_TZ, year: 'numeric', month: '2-digit', day: '2-digit' }); // en-CA => YYYY-MM-DD
  const humanFormatter = new Intl.DateTimeFormat(undefined, { timeZone: LA_TZ, month: 'short', day: 'numeric' });

  function laDateKeyFromTimestamp(ts) {
    return dateKeyFormatter.format(new Date(ts)); // YYYY-MM-DD in LA
  }
  function getTodayLAKey() { return laDateKeyFromTimestamp(Date.now()); }
  function isValidDateKey(key) { return /^\d{4}-\d{2}-\d{2}$/.test(key); }
  function prevDayKey(key) { // key => previous day in LA
    const [y,m,d] = key.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m-1, d)); // create at UTC midnight of that date
    dt.setUTCDate(dt.getUTCDate() - 1);
    return laDateKeyFromTimestamp(dt.getTime());
  }
  function formatDueKey(key) { if(!key) return ''; const [y,m,d] = key.split('-').map(Number); const dt = new Date(Date.UTC(y, m-1, d, 12)); return humanFormatter.format(dt); }

  function load() {
    try {
      // Attempt v3 first
      const rawV3 = localStorage.getItem(TASKS_KEY);
      if (rawV3) {
        const parsed = JSON.parse(rawV3);
        if (Array.isArray(parsed)) tasks = parsed.map(migrateTaskV3);
      } else {
        // Fallback: migrate from v2 if present
        const rawV2 = localStorage.getItem(TASKS_KEY_V2);
        if (rawV2) {
          const parsed2 = JSON.parse(rawV2);
          if (Array.isArray(parsed2)) {
            tasks = parsed2.map(migrateTaskV2ToV3);
            // Save immediately under new key
            save();
          }
        }
      }
      const rawPrefs = localStorage.getItem(PREF_KEY);
      if (rawPrefs) {
        const p = JSON.parse(rawPrefs);
        prefs = { ...prefs, ...p };
      }
    } catch (e) { console.warn('Load error', e); }
    applyTheme(prefs.theme || autoPreferredTheme());
    if (sortSelect) sortSelect.value = prefs.sort || 'created';
  }

  function migrateTaskV3(t) {
    // Already v3 shape: ensure due is string or null
    let due = null;
    if (typeof t.due === 'string' && isValidDateKey(t.due)) due = t.due; // keep
    else if (typeof t.due === 'number') due = laDateKeyFromTimestamp(t.due);
    return {
      id: t.id || crypto.randomUUID(),
      text: t.text || '',
      completed: !!t.completed,
      created: t.created || Date.now(),
      completedAt: 'completedAt' in t ? t.completedAt : (t.completed ? Date.now() : null),
      due,
      order: typeof t.order === 'number' ? t.order : tasks.length
    };
  }
  function migrateTaskV2ToV3(t) { return migrateTaskV3(t); }

  function save() {
    try { localStorage.setItem(TASKS_KEY, JSON.stringify(tasks)); } catch(e) {}
    try { localStorage.setItem(PREF_KEY, JSON.stringify(prefs)); } catch(e) {}
  }

  function addTask(text, dueStr) {
    const trimmed = text.trim();
    if (!trimmed) { formMessage.textContent = 'Please enter a task.'; input.focus(); return; }
    if (trimmed.length > 120) { formMessage.textContent = 'Task is too long (max 120 chars).'; return; }
    let dueKey = null;
    if (dueStr && isValidDateKey(dueStr)) dueKey = dueStr; // assume date input value corresponds to LA date picked
    tasks.push({
      id: crypto.randomUUID(),
      text: trimmed,
      completed: false,
      created: Date.now(),
      completedAt: null,
      due: dueKey,
      order: tasks.length ? Math.max(...tasks.map(t=>t.order))+1 : 0
    });
    save();
    formMessage.textContent='';
    render();
  }

  function toggleTask(id) {
    const t = tasks.find(t=>t.id===id); if(!t) return; t.completed = !t.completed; t.completedAt = t.completed ? Date.now() : null; save(); render(); }
  function deleteTask(id) { tasks = tasks.filter(t=>t.id!==id); save(); render(); }
  function clearCompleted() { if(!tasks.some(t=>t.completed)) return; tasks = tasks.filter(t=>!t.completed); save(); render(); }
  function updateTaskText(id, newText) { const t = tasks.find(t=>t.id===id); if(!t) return; const trimmed = newText.trim(); if(!trimmed) { deleteTask(id); return; } t.text = trimmed.slice(0,120); save(); renderPreserveFocus(id); }
  function updateTaskDue(id, dueStr) { const t = tasks.find(t=>t.id===id); if(!t) return; t.due = (dueStr && isValidDateKey(dueStr)) ? dueStr : null; save(); render(); }

  function renderPreserveFocus(id) { const active = document.activeElement?.closest('.task-item')?.dataset.id; render(); if(active===id) { const li = list.querySelector(`li[data-id="${id}"] .task-text`); if(li) li.focus(); } }

  function autoPreferredTheme() { return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark':'light'; }
  function applyTheme(theme) { document.documentElement.setAttribute('data-theme', theme); prefs.theme = theme; save(); if(metaThemeColor) metaThemeColor.setAttribute('content', theme==='dark'? '#0f172a':'#2563eb'); themeToggle.textContent = theme==='dark' ? '☀️' : '🌙'; }

  function cycleTheme() { applyTheme(prefs.theme === 'dark' ? 'light':'dark'); }

  function setFilter(f) { filter = f; filterButtons.forEach(b=>b.classList.toggle('active', b.dataset.filter===filter)); render(); }
  function setSearch(q) { search = q.toLowerCase(); render(); }
  function setSort(s) { prefs.sort = s; save(); render(); }

  function sortTasks(arr) {
    switch(prefs.sort) {
      case 'due': return arr.slice().sort((a,b)=> (a.due??'9999-99-99').localeCompare(b.due??'9999-99-99') || a.order - b.order);
      case 'created': return arr.slice().sort((a,b)=> b.created - a.created);
      case 'completed': return arr.slice().sort((a,b)=> Number(a.completed)-Number(b.completed) || a.order-b.order);
      case 'manual': default: return arr.slice().sort((a,b)=> a.order - b.order);
    }
  }

  function filteredTasks() {
    return sortTasks(tasks.filter(t => {
      if(filter==='active' && t.completed) return false;
      if(filter==='completed' && !t.completed) return false;
      if(search && !t.text.toLowerCase().includes(search)) return false;
      return true;
    }));
  }

  // replaced by formatDueKey()

  function render() {
    list.innerHTML='';
    const visible = filteredTasks();
    if(!visible.length) emptyState.classList.remove('hidden'); else emptyState.classList.add('hidden');
    const frag = document.createDocumentFragment();
    visible.forEach(task => frag.appendChild(renderTask(task)));
    list.appendChild(frag);
    updateCount();
    updateStats();
  }

  function renderTask(task) {
    const li = document.createElement('li');
    li.className = 'task-item' + (task.completed ? ' completed':'');
    li.dataset.id = task.id;
    li.draggable = true;

    const dragHandle = document.createElement('button');
    dragHandle.type='button';
    dragHandle.className='drag-handle';
    dragHandle.setAttribute('aria-label','Drag to reorder');
    dragHandle.textContent='⋮⋮';

    const checkbox = document.createElement('input');
    checkbox.type='checkbox';
    checkbox.className='task-checkbox';
    checkbox.checked = task.completed;
    checkbox.setAttribute('aria-label', 'Mark task as ' + (task.completed ? 'incomplete':'complete'));
    checkbox.addEventListener('change', () => toggleTask(task.id));

    const textSpan = document.createElement('span');
    textSpan.className='task-text';
    textSpan.tabIndex=0;
    textSpan.textContent = task.text;
    textSpan.addEventListener('dblclick', ()=> startEdit(task.id, textSpan));
    textSpan.addEventListener('keydown', e => { if(e.key==='Enter') startEdit(task.id, textSpan); });

    const meta = document.createElement('span');
    meta.className='task-meta';
    meta.style.fontSize='.65rem';
    meta.style.opacity='.65';
    meta.textContent = task.due ? ('Due ' + formatDueKey(task.due)) : '';
    if(task.due) {
      const todayKey = getTodayLAKey();
      if(!task.completed && task.due < todayKey) meta.style.color = '#dc2626';
    }

    const delBtn = document.createElement('button');
    delBtn.className='delete-btn';
    delBtn.type='button';
    delBtn.textContent='Delete';
    delBtn.addEventListener('click', ()=> deleteTask(task.id));

    li.appendChild(dragHandle);
    li.appendChild(checkbox);
    const textWrap = document.createElement('div');
    textWrap.style.display='flex';
    textWrap.style.flexDirection='column';
    textWrap.style.flex='1';
    textWrap.appendChild(textSpan);
    if(task.due) textWrap.appendChild(meta);
    li.appendChild(textWrap);
    li.appendChild(delBtn);

    // Drag events
    li.addEventListener('dragstart', e => { dragSrcId = task.id; li.classList.add('dragging'); e.dataTransfer.effectAllowed='move'; });
    li.addEventListener('dragend', ()=> { dragSrcId=null; li.classList.remove('dragging'); save(); render(); });
    li.addEventListener('dragover', e => { e.preventDefault(); li.classList.add('drag-over'); e.dataTransfer.dropEffect='move'; });
    li.addEventListener('dragleave', ()=> li.classList.remove('drag-over'));
    li.addEventListener('drop', e => { e.preventDefault(); li.classList.remove('drag-over'); if(!dragSrcId || dragSrcId===task.id) return; reorder(dragSrcId, task.id); });

    return li;
  }

  function startEdit(id, textSpan) {
    const task = tasks.find(t=>t.id===id); if(!task) return;
    const inputEl = document.createElement('input');
    inputEl.type='text';
    inputEl.value = task.text;
    inputEl.className='edit-input';
    inputEl.maxLength=120;
    textSpan.replaceWith(inputEl);
    inputEl.focus();
    inputEl.select();
    const saveEdit = () => { updateTaskText(id, inputEl.value); };
    const cancelEdit = () => { render(); };
    inputEl.addEventListener('keydown', e=> { if(e.key==='Enter') saveEdit(); else if(e.key==='Escape') cancelEdit(); });
    inputEl.addEventListener('blur', saveEdit);
  }

  function reorder(srcId, targetId) {
    if(prefs.sort !== 'manual') { prefs.sort='manual'; if(sortSelect) sortSelect.value='manual'; }
    const arr = sortTasks(tasks); // current view order
    const srcIndex = arr.findIndex(t=>t.id===srcId);
    const targetIndex = arr.findIndex(t=>t.id===targetId);
    if(srcIndex<0||targetIndex<0) return;
    const [moved] = arr.splice(srcIndex,1);
    arr.splice(targetIndex,0,moved);
    // Reassign order sequentially
    arr.forEach((t,i)=> t.order = i);
    tasks = arr;
    save();
  }

  function updateCount() {
    const count = tasks.length; const completed = tasks.filter(t=>t.completed).length;
    taskCount.textContent = `${count} task${count!==1?'s':''} (${completed} completed)`;
  }

  function updateStats() {
    if(!statsEl) return;
    const total = tasks.length; const completed = tasks.filter(t=>t.completed).length; const active = total - completed;
    const pct = total? Math.round((completed/total)*100) : 0;
    const streak = computeStreak();
    streakEl.textContent = streak ? `Streak: ${streak} day${streak!==1?'s':''}` : '';
  const todayKey = getTodayLAKey();
  const overdue = tasks.filter(t=>!t.completed && t.due && t.due < todayKey).length;
    statsEl.innerHTML = `
      <span>Total: ${total}</span>
      <span>Active: ${active}</span>
      <span>Completed: ${completed}</span>
      <span>${pct}% done</span>
      <span>Overdue: ${overdue}</span>
    `;
  }

  function computeStreak() {
    // Build set of LA date keys for completed tasks
    const days = new Set(tasks.filter(t=>t.completedAt).map(t=> laDateKeyFromTimestamp(t.completedAt)));
    if(!days.size) return 0;
    let todayKey = getTodayLAKey();
    let cursorKey = days.has(todayKey) ? todayKey : prevDayKey(todayKey);
    if(!days.has(cursorKey)) return 0;
    let streak = 0;
    while(days.has(cursorKey)) { streak++; cursorKey = prevDayKey(cursorKey); }
    return streak;
  }

  // Export / Import
  function exportTasks() {
    const blob = new Blob([JSON.stringify({ version:2, tasks }, null, 2)], {type:'application/json'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href=url; a.download='tasks.json'; a.click(); URL.revokeObjectURL(url);
  }
  function importTasksFile(file) {
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const data = JSON.parse(e.target.result);
        if(!data || !Array.isArray(data.tasks)) throw new Error('Invalid file');
        const existingIds = new Set(tasks.map(t=>t.id));
        const imported = data.tasks.map(migrateTask).filter(t=> !existingIds.has(t.id));
        tasks = tasks.concat(imported);
        save();
        render();
      } catch(err) { alert('Import failed: '+err.message); }
    };
    reader.readAsText(file);
  }

  // Event bindings
  form.addEventListener('submit', e => { e.preventDefault(); addTask(input.value, dueInput.value); form.reset(); input.focus(); });
  input.addEventListener('input', () => { if(formMessage.textContent) formMessage.textContent=''; });
  clearCompletedBtn.addEventListener('click', clearCompleted);
  filterButtons.forEach(btn => btn.addEventListener('click', () => setFilter(btn.dataset.filter)));
  searchInput.addEventListener('input', e=> setSearch(e.target.value));
  sortSelect.addEventListener('change', e=> setSort(e.target.value));
  themeToggle.addEventListener('click', cycleTheme);
  exportBtn.addEventListener('click', exportTasks);
  importBtn.addEventListener('click', ()=> importFile.click());
  importFile.addEventListener('change', e=> { const file = e.target.files?.[0]; if(file) importTasksFile(file); e.target.value=''; });

  list.addEventListener('keydown', e => { if(e.key==='Delete') { const li = e.target.closest('.task-item'); if(li) deleteTask(li.dataset.id); } });

  // Click outside to finalize edit (handled by blur) already.

  function registerSW() {
    if('serviceWorker' in navigator) {
      navigator.serviceWorker.register('sw.js').catch(()=>{});
    }
  }

  // Initial load
  load();
  render();
  registerSW();
})();
