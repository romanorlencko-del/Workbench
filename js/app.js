/* app.js — сборка: палитра, тулбар, история, автосохранение, консоль (план/проверка/JSON). */

window.App = (function () {

  const LS_KEY = 'tester.pipeline';
  const LS_SECRETS = 'tester.secrets';   // значения ключей API — локально в браузере, ОТДЕЛЬНО от плана (не в экспорт/бриф)
  const LS_CHAT = 'tester.chat';         // история чата с ИИ (локально)
  const LS_PROXY = 'tester.proxy';       // настройки прокси движка (локально, не в плане)
  const LS_PROJECTS = 'tester.projects'; // реестр проектов: [{id,name,updatedAt}]
  const LS_PROJECT = 'tester.project.';  // + id → JSON плана проекта
  const LS_CURRENT = 'tester.current';   // id текущего проекта
  const LS_MODELS = 'tester.models';     // ПОДКЛЮЧЕНИЕ ПО УМОЛЧАНИЮ (общее для всех проектов, не в плане)
  let chatHistory = [], chatModelRef = 'primary', chatBusy = false;
  let history = [], hp = -1, saveTimer = null, playTimer = null, projectId = null;
  const diskMtime = {};              // id → mtime последней виденной версии на диске (для newer-wins)
  const deleted = new Set();         // удалённые в этой сессии id — чтобы запоздавший PUT их не воскресил
  // экранируем и одинарную кавычку тоже: на будущее, если атрибут соберут в '…'
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /* ── история ────────────────────────────────────────── */
  function snapshot() { return JSON.stringify(window.Graph.toJSON()); }

  function commit() {
    const s = snapshot();
    if (history[hp] === s) return;
    history = history.slice(0, hp + 1);
    history.push(s);
    if (history.length > 60) history.shift();
    hp = history.length - 1;
    autosave();
  }

  function restore(i) {
    if (i < 0 || i >= history.length) return;
    hp = i;
    window.Graph.fromJSON(JSON.parse(history[hp]));
    document.getElementById('pipeline-name').value = window.Graph.state.name;
    window.Editor.clearSelection();
    refresh();
    autosave();
  }

  const undo = () => restore(hp - 1);
  const redo = () => restore(hp + 1);

  function autosave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, 300);
  }

  /* ── проекты: несколько планов в localStorage, быстрое переключение ── */
  function saveNow() {
    if (!projectId) return;
    try {
      const snap = snapshot();
      localStorage.setItem(LS_PROJECT + projectId, snap);
      localStorage.setItem(LS_CURRENT, projectId);
      touchRegistry(projectId, window.Graph.state.name || 'Без имени');
      diskPut(projectId, snap);          // зеркалим на диск: правки переживут даже очистку localStorage
    } catch (e) {}
  }

  /* ── зеркало планов на диск через движок (serve.py, /api) ────────────
     Браузерные правки не теряются после перезагрузки: localStorage остаётся
     живым хранилищем, а файл projects/<id>.json — надёжной копией и подхватом.
     Открыто по file:// или движок выключен — молча пропускаем.
     Ключи API сюда НЕ уходят: их нет в плане (в meta.models лишь имя env-переменной). */
  const DISK_ON = location.protocol === 'http:' || location.protocol === 'https:';
  function diskPut(id, planStr) {
    if (!DISK_ON || !id || deleted.has(id)) return;
    try {
      fetch('api/project/' + encodeURIComponent(id),
            { method: 'PUT',
              headers: { 'Content-Type': 'application/json', 'X-Prev-Mtime': String(diskMtime[id] || 0) },
              body: planStr })
        .then(r => {
          if (r.status === 409) return r.json().then(d => reconcileDisk(id, d)).catch(() => {});
          if (r.ok) return r.json().then(d => { if (d && d.mtime) diskMtime[id] = d.mtime; }).catch(() => {});
        })
        .catch(() => {});                // движок выключен / оффлайн — не шумим
    } catch (e) {}
  }
  /* На диске более свежая версия (правили в другой вкладке или файл руками).
     По правилу «свежее побеждает» принимаем её, чтобы не потерять уже сохранённое. */
  function reconcileDisk(id, d) {
    if (!d || !d.plan || !Array.isArray(d.plan.nodes)) return;
    if (d.mtime) diskMtime[id] = d.mtime;
    try { localStorage.setItem(LS_PROJECT + id, JSON.stringify(d.plan)); } catch (e) {}
    const reg = loadRegistry(), p = reg.find(x => x.id === id);
    if (p) { p.name = d.plan.name || p.name; p.updatedAt = (d.mtime || 0) * 1000; saveRegistry(reg); }
    if (id === projectId) {
      loadProjectState(id);
      toast('Взял более свежую версию проекта с диска (правки из другой вкладки).', 'warn');
    }
  }
  function diskDelete(id) {
    if (!DISK_ON || !id) return;
    try { fetch('api/project/' + encodeURIComponent(id), { method: 'DELETE' }).catch(() => {}); } catch (e) {}
  }
  /* Загрузка: подтянуть планы с диска. Проекта нет в браузере → восстановить;
     на диске заметно свежее (правили файл руками) → принять. Иначе не трогаем —
     обычный reload остаётся мгновенным и ничего не ломает. */
  async function hydrateFromDisk() {
    if (!DISK_ON) return;
    let disk;
    try {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 1500);      // не вешаем UI, если движок тупит
      const r = await fetch('api/state', { signal: ctl.signal });
      clearTimeout(t);
      if (!r.ok) return;
      disk = (await r.json()).projects || [];
    } catch (e) { return; }
    if (!disk.length) return;
    const reg = loadRegistry();
    const byId = new Map(reg.map(p => [p.id, p]));
    let changed = false;
    disk.forEach(f => {
      if (!f || !f.id || !f.plan || !Array.isArray(f.plan.nodes)) return;
      if (deleted.has(f.id)) return;                    // удалённый в этой сессии — не воскрешаем
      const local = byId.get(f.id);
      const diskMs = (f.mtime || 0) * 1000;
      diskMtime[f.id] = f.mtime || 0;                   // помним mtime диска — его шлём в X-Prev-Mtime
      try {
        if (!local) {                                     // нет в браузере — восстановить с диска
          localStorage.setItem(LS_PROJECT + f.id, JSON.stringify(f.plan));
          const e = { id: f.id, name: f.plan.name || 'Без имени', updatedAt: diskMs };
          reg.push(e); byId.set(f.id, e); changed = true;
        } else if (diskMs > (local.updatedAt || 0) + 2000) {   // на диске свежее — принять
          localStorage.setItem(LS_PROJECT + f.id, JSON.stringify(f.plan));
          local.name = f.plan.name || local.name; local.updatedAt = diskMs; changed = true;
        }
      } catch (e) {}
    });
    if (changed) saveRegistry(reg);
  }
  function loadRegistry() { try { return JSON.parse(localStorage.getItem(LS_PROJECTS) || '[]') || []; } catch (e) { return []; } }
  function saveRegistry(list) { try { localStorage.setItem(LS_PROJECTS, JSON.stringify(list)); } catch (e) {} }
  function newId() { return 'p_' + Date.now().toString(36) + Math.floor(Math.random() * 46656).toString(36); }
  function touchRegistry(id, name) {
    const list = loadRegistry();
    const e = list.find(p => p.id === id);
    if (e) { e.name = name; e.updatedAt = Date.now(); } else list.push({ id, name, updatedAt: Date.now() });
    saveRegistry(list);
    renderProjectSelect();
  }
  function renderProjectSelect(force) {
    const nameEl = document.getElementById('projdrop-name');
    const listEl = document.getElementById('projdrop-list');
    if (!nameEl || !listEl) return;
    if (!force && listEl.querySelector('.projrow-edit')) return;   // фоновые перерисовки не сносят активное поле ввода
    const items = loadRegistry().slice().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    const cur = items.find(p => p.id === projectId);
    nameEl.textContent = (cur && cur.name) || window.Graph.state.name || 'Проект';
    listEl.innerHTML = items.map(p => `
      <div class="projrow ${p.id === projectId ? 'on' : ''}" data-id="${p.id}">
        <button class="projrow-pick" data-act="proj-pick" data-id="${p.id}" title="Открыть проект">${esc(p.name || 'Без имени')}</button>
        <button class="tb icon projrow-ren" data-act="proj-rename" data-id="${p.id}" title="Переименовать">✎</button>
      </div>`).join('') || '<div class="projrow-empty micro">нет проектов</div>';
  }

  function toggleProjList(force) {
    const l = document.getElementById('projdrop-list'); if (!l) return;
    l.hidden = (force === undefined) ? !l.hidden : !force;
  }

  /* Инлайн-переименование прямо в списке: строка → поле ввода, Enter/blur — сохранить. */
  function startRename(id) {
    const row = document.querySelector(`#projdrop-list .projrow[data-id="${id}"]`); if (!row) return;
    const p = loadRegistry().find(x => x.id === id); if (!p) return;
    row.innerHTML = `<input class="projrow-edit" value="${esc(p.name || '')}" spellcheck="false">`;
    const inp = row.querySelector('input'); inp.focus(); inp.select();
    let done = false;
    const finish = save => {
      if (done) return; done = true;
      if (save) commitRename(id, inp.value.trim() || 'Без имени'); else renderProjectSelect(true);
    };
    inp.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); finish(true); }
      else if (e.key === 'Escape') finish(false);
    });
    inp.addEventListener('blur', () => finish(true));
  }

  function commitRename(id, name) {
    const reg = loadRegistry(); const p = reg.find(x => x.id === id);
    if (p) { p.name = name; p.updatedAt = Date.now(); saveRegistry(reg); }
    if (id === projectId) {
      window.Graph.state.name = name;
      document.getElementById('pipeline-name').value = name;
      saveNow();                                   // план текущего — с новым именем
    } else {
      try { const raw = localStorage.getItem(LS_PROJECT + id); if (raw) { const d = JSON.parse(raw); d.name = name; const s = JSON.stringify(d); localStorage.setItem(LS_PROJECT + id, s); diskPut(id, s); } } catch (e) {}
    }
    renderProjectSelect(true);
  }

  /* ── консоль: высота чата (тянуть разделитель / верхнюю кромку) + сворачивание ── */
  function loadLayout() { try { return JSON.parse(localStorage.getItem('tester.layout') || '{}') || {}; } catch (e) { return {}; } }
  function saveLayout(o) { try { localStorage.setItem('tester.layout', JSON.stringify(o)); } catch (e) {} }
  function setupConsoleResize() {
    const hdrag = document.getElementById('console-hdrag');
    const con   = document.getElementById('console');
    const app   = document.getElementById('app');
    const st = loadLayout();
    if (st.consoleH) app.style.setProperty('--console-h', st.consoleH + 'px');
    if (!hdrag || !con) return;

    /* верхняя кромка консоли: высота очереди */
    let hy = 0, hh = 0;
    hdrag.addEventListener('pointerdown', e => { hy = e.clientY; hh = con.getBoundingClientRect().height; try { hdrag.setPointerCapture(e.pointerId); } catch (_) {} e.preventDefault(); });
    hdrag.addEventListener('pointermove', e => {
      if (!hy) return;
      const h = Math.max(150, Math.min(window.innerHeight * 0.85, hh + (hy - e.clientY)));
      app.style.setProperty('--console-h', h + 'px');
    });
    hdrag.addEventListener('pointerup', e => { if (!hy) return; hy = 0; try { hdrag.releasePointerCapture(e.pointerId); } catch (_) {} const s = loadLayout(); s.consoleH = parseInt(getComputedStyle(app).getPropertyValue('--console-h'), 10) || undefined; saveLayout(s); });
    hdrag.addEventListener('pointercancel', e => { hy = 0; try { hdrag.releasePointerCapture(e.pointerId); } catch (_) {} });   // ОС забрала указатель — не залипаем
    hdrag.addEventListener('dblclick', () => { app.style.removeProperty('--console-h'); const s = loadLayout(); delete s.consoleH; saveLayout(s); });
  }

  /* ── чат: плавающее окно справа внизу (открыть/свернуть/размер) ── */
  function applyChatState() {
    const dock = document.getElementById('chat'), launcher = document.getElementById('chat-launcher');
    if (!dock || !launcher) return;
    const st = loadLayout(), open = st.chatOpen !== false;   /* по умолчанию открыт */
    dock.hidden = !open;
    launcher.hidden = open;
    dock.classList.toggle('min', !!st.chatMin);
    const mb = document.getElementById('chat-min');
    if (mb) { mb.textContent = st.chatMin ? '▫' : '─'; mb.title = st.chatMin ? 'Развернуть' : 'Свернуть в заголовок'; }
    if (st.chatW) dock.style.setProperty('--chat-w', Math.max(340, st.chatW) + 'px');
    if (st.chatH) dock.style.setProperty('--chat-h', st.chatH + 'px');
  }
  function openChat(on) {
    const s = loadLayout(); s.chatOpen = !!on; if (on) s.chatMin = false; saveLayout(s); applyChatState();
    if (on) { const ta = document.getElementById('chat-text'); if (ta) ta.focus(); const log = document.getElementById('chat-log'); if (log) log.scrollTop = log.scrollHeight; }
  }
  function toggleChatMin() { const s = loadLayout(); s.chatMin = !s.chatMin; saveLayout(s); applyChatState(); }
  function setupChatDock() {
    const dock = document.getElementById('chat'); if (!dock) return;
    applyChatState();
    /* тянем за левый край (ширина), верхний (высота), угол (оба) — окно прижато вправо-вниз */
    const grab = (el, axis) => {
      if (!el) return;
      let box = null;
      el.addEventListener('pointerdown', e => { box = dock.getBoundingClientRect(); try { el.setPointerCapture(e.pointerId); } catch (_) {} e.preventDefault(); });
      el.addEventListener('pointermove', e => {
        if (!box) return;
        if (axis !== 'h') dock.style.setProperty('--chat-w', Math.max(340, Math.min(window.innerWidth - 40, box.right - e.clientX)) + 'px');
        if (axis !== 'w') dock.style.setProperty('--chat-h', Math.max(220, Math.min(window.innerHeight - 78, box.bottom - e.clientY)) + 'px');
      });
      el.addEventListener('pointerup', e => {
        if (!box) return; box = null; try { el.releasePointerCapture(e.pointerId); } catch (_) {}
        const s = loadLayout();
        s.chatW = parseInt(dock.style.getPropertyValue('--chat-w'), 10) || s.chatW;
        s.chatH = parseInt(dock.style.getPropertyValue('--chat-h'), 10) || s.chatH;
        saveLayout(s);
      });
      el.addEventListener('pointercancel', e => { box = null; try { el.releasePointerCapture(e.pointerId); } catch (_) {} });   // ОС забрала указатель — не залипаем
    };
    grab(document.getElementById('cd-w'), 'w');
    grab(document.getElementById('cd-h'), 'h');
    grab(document.getElementById('cd-c'), 'both');
  }
  function loadProjectState(id) {
    stopPlay();                                  // прогон прежнего проекта не должен тикать по новому
    window.Graph.fromJSON(JSON.parse(localStorage.getItem(LS_PROJECT + id)));
    if (window.Harness) window.Harness.resetManual();
    projectId = id;
    localStorage.setItem(LS_CURRENT, id);
    document.getElementById('pipeline-name').value = window.Graph.state.name;
    history = []; hp = -1;
    window.Editor.clearSelection(); commit(); refresh(); window.Editor.fit();
    renderProjectSelect(); adoptProjectChat();
  }
  /* У каждого проекта свой чат: своя история и своя память о плане. */
  function adoptProjectChat() { chatHistory = loadChat(); renderChatModel(); renderChat(); }
  function switchProject(id) {
    if (!id || id === projectId) return;
    saveNow();
    try { loadProjectState(id); } catch (e) { toast('Проект не открылся: ' + e.message, 'err'); }
  }
  function createProject(data, name) {
    stopPlay();                                  // прогон прежнего проекта не должен тикать по новому
    saveNow();                                   // сохранить текущий, потом уйти на новый
    const carry = JSON.parse(JSON.stringify(((window.Graph.state.meta || {}).models) || {}));  // подключение проекта, из которого уходим
    const id = newId();
    if (data) window.Graph.fromJSON(data); else window.Graph.clear();
    if (name) window.Graph.state.name = name;
    if (window.Harness) window.Harness.resetManual();
    projectId = id;
    localStorage.setItem(LS_CURRENT, id);
    seedModelsFromGlobal(!!data, carry);         // подключение: дефолт, иначе — из покинутого проекта
    document.getElementById('pipeline-name').value = window.Graph.state.name;
    history = []; hp = -1;
    window.Editor.clearSelection(); commit(); refresh(); window.Editor.fit();
    touchRegistry(id, window.Graph.state.name || 'Без имени');
    adoptProjectChat();
    return id;
  }
  function duplicateProject() {
    createProject(JSON.parse(snapshot()), (window.Graph.state.name || 'Проект') + ' (копия)');
    toast('Проект дублирован', 'ok');
  }
  function deleteProject() {
    const list = loadRegistry();
    if (list.length <= 1) return toast('Это единственный проект — сначала создай другой', 'warn');
    if (!confirm(`Удалить проект «${window.Graph.state.name}»? Необратимо.`)) return;
    const gone = projectId;
    projectId = null;                            // чтобы автосейв не воскресил удаляемый
    clearTimeout(saveTimer);                     // отменяем отложенный автосейв удаляемого проекта
    deleted.add(gone);                           // и запрещаем любой запоздавший PUT по этому id
    try { localStorage.removeItem(LS_PROJECT + gone); localStorage.removeItem(LS_CHAT + '.' + gone); localStorage.removeItem('tester.alias.' + gone); } catch (e) {}
    diskDelete(gone);                            // и с диска, чтобы удалённый проект не воскрес при загрузке
    const rest = list.filter(p => p.id !== gone);
    saveRegistry(rest);
    const next = rest.slice().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))[0];
    loadProjectState(next.id);
    toast('Проект удалён', 'ok');
  }

  /* ── общий рефреш ───────────────────────────────────── */
  function refresh() {
    window.Editor.render();
    window.Inspector.show([...window.Editor.selection]);
    renderConsole();
  }

  function onGraphChange() { commit(); refresh(); }

  /* ── палитра ────────────────────────────────────────── */
  function renderPalette(filter) {
    const f = (filter || '').toLowerCase();
    const html = window.BLOCKS.CATEGORIES.map(cat => {
      const items = Object.entries(window.BLOCKS.TYPES)
        .filter(([t, d]) => d.category === cat.id && (!f || (d.label + ' ' + t + ' ' + d.desc).toLowerCase().includes(f)));
      if (!items.length) return '';
      return `<section class="pal-group">
        <div class="pal-head"><span class="micro">${esc(cat.label)}</span><span class="pal-hint">${esc(cat.hint)}</span></div>
        ${items.map(([t, d]) => `
          <button class="pal-item" draggable="true" data-type="${t}" style="--c:${d.color}" title="${esc(d.desc)}">
            <span class="pal-icon">${esc(d.icon)}</span>
            <span class="pal-txt"><b>${esc(d.label)}</b><i>${esc(d.desc)}</i></span>
          </button>`).join('')}
      </section>`;
    }).join('');
    document.getElementById('palette-list').innerHTML = html || '<div class="qa-empty micro">ничего не найдено</div>';
  }

  /* ── консоль ────────────────────────────────────────── */
  function renderConsole() {
    const { steps, orphans } = window.Graph.plan();
    document.getElementById('tab-plan').innerHTML = steps.length ? `
      <ol class="plan">${steps.map((s, i) => {
        const n = window.Graph.getNode(s.id); if (!n) return '';
        const d = window.BLOCKS.TYPES[n.type];
        return `<li class="plan-row ${s.repeat ? 'repeat' : ''}" data-node="${n.id}" style="--d:${s.depth};--c:${d.color}">
          <span class="plan-no">${String(i + 1).padStart(2, '0')}</span>
          <span class="plan-icon">${esc(d.icon)}</span>
          <span class="plan-name">${esc(n.name)}</span>
          <span class="plan-sum">${esc(window.BLOCKS.summary(n))}</span>
          ${s.tag ? `<span class="plan-tag">${esc(s.tag)}</span>` : ''}
          ${s.repeat ? '<span class="plan-tag warn">возврат</span>' : ''}
        </li>`;
      }).join('')}</ol>
      ${orphans.length ? `<div class="plan-orphans micro">вне плана: ${orphans.map(o => esc(o.name)).join(', ')}</div>` : ''}`
      : '<div class="empty">Плана пока нет — добавь блок «Старт» и свяжи блоки.</div>';

    const issues = window.Graph.validate();
    const errs = issues.filter(i => i.level === 'err').length;
    const warns = issues.filter(i => i.level === 'warn').length;
    const todos = issues.filter(i => i.level === 'todo').length;
    const pill = document.getElementById('check-count');
    pill.textContent = errs ? errs : (warns ? warns : '');
    pill.className = 'pill ' + (errs ? 'err' : warns ? 'warn' : '');

    const blocking = issues.filter(i => i.level !== 'todo');
    document.getElementById('tab-check').innerHTML =
      (blocking.length ? `<ul class="checks">${blocking.map(i =>
        `<li class="check ${i.level}" ${i.node ? `data-node="${i.node}"` : ''}>
           <span class="check-dot"></span>${esc(i.text)}</li>`).join('')}</ul>`
        : '<div class="empty ok">Структура в порядке — план связный.</div>') +
      (todos ? `<div class="sep"><span class="micro">останется на бэкенд · ${todos}</span></div>
        <ul class="checks">${issues.filter(i => i.level === 'todo').map(i =>
          `<li class="check todo" ${i.node ? `data-node="${i.node}"` : ''}>
             <span class="check-dot"></span>${esc(i.text)}</li>`).join('')}</ul>` : '');

    document.getElementById('tab-json').innerHTML =
      `<pre class="json">${esc(JSON.stringify(window.Graph.toJSON(), null, 2))}</pre>`;
  }

  /* ── прогон плана (подсветка порядка) ───────────────── */
  function play() {
    if (playTimer) return stopPlay();
    const { steps } = window.Graph.plan();
    if (!steps.length) return toast('Плана нет — нечего прогонять', 'warn');
    switchTab('plan');
    document.querySelector('[data-act="run"]').textContent = '■ Стоп';
    let i = 0;
    const tick = () => {
      document.querySelectorAll('.node.running,.hchip.running,.plan-row.running').forEach(e => e.classList.remove('running'));
      if (i >= steps.length) return stopPlay();
      const id = steps[i].id;
      // в жгуте узлы холста ещё в DOM (скрыты) — подсвечиваем видимый элемент текущего вида
      const harness = window.Editor.getViewMode() === 'harness';
      document.querySelector(harness ? `.hchip[data-id="${id}"]` : `.node[data-id="${id}"]`)?.classList.add('running');
      // жгут крупнее экрана — подтягиваем вид, ТОЛЬКО если чип ушёл за край (иначе схема дёргается)
      if (harness) window.Editor.revealOn(id);
      const row = document.querySelector(`.plan-row[data-node="${id}"]`);
      if (row) { row.classList.add('running'); row.scrollIntoView({ block: 'nearest' }); }
      i++;
      playTimer = setTimeout(tick, 420);
    };
    tick();
  }

  function stopPlay() {
    clearTimeout(playTimer); playTimer = null;
    document.querySelectorAll('.running').forEach(e => e.classList.remove('running'));
    document.querySelector('[data-act="run"]').textContent = '▶ Прогон';
  }

  /* ── файлы ──────────────────────────────────────────── */
  function exportJSON() {
    const blob = new Blob([JSON.stringify(window.Graph.toJSON(), null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = (window.Graph.state.name || 'pipeline').replace(/[^\wа-яё\- ]+/gi, '_') + '.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    toast('Экспортировано', 'ok');
  }

  function importJSON(file) {
    const r = new FileReader();
    r.onload = () => {
      try {
        const data = JSON.parse(r.result);
        createProject(data, data.name);
        toast('Импортировано как новый проект: ' + window.Graph.state.name, 'ok');
      } catch (e) { toast('Не удалось прочитать файл: ' + e.message, 'err'); }
    };
    r.readAsText(file);
  }

  /* ── тосты ──────────────────────────────────────────── */
  function toast(text, level) {
    const t = document.createElement('div');
    t.className = 'toast ' + (level || '');
    t.textContent = text;
    document.body.appendChild(t);
    setTimeout(() => t.classList.add('in'));
    setTimeout(() => { t.classList.remove('in'); setTimeout(() => t.remove(), 250); }, 2600);
  }

  /* ── выезжающие панели (узкий экран) ────────────────── */
  const mqNarrow = window.matchMedia('(max-width:900px)');
  const appEl = () => document.getElementById('app');
  function syncScrim() { document.getElementById('drawer-scrim').hidden = !appEl().classList.contains('pal-open'); }
  function closePalette() { appEl().classList.remove('pal-open'); syncScrim(); }
  function togglePalette() { appEl().classList.toggle('pal-open'); syncScrim(); }

  /* компактное сворачивание палитры влево (широкий экран) */
  function applyPalMin(on) {
    appEl().classList.toggle('pal-min', !!on);
    const b = document.getElementById('palette-min');
    if (b) { b.textContent = on ? '»' : '«'; b.title = on ? 'Развернуть блоки' : 'Свернуть блоки влево'; }
  }
  function togglePalMin() { const s = loadLayout(); s.palMin = !s.palMin; saveLayout(s); applyPalMin(s.palMin); }
  /* компактное сворачивание инспектора вправо (широкий экран) */
  function applyInspMin(on) {
    appEl().classList.toggle('insp-min', !!on);
    const b = document.getElementById('inspector-min');
    if (b) { b.textContent = on ? '«' : '»'; b.title = on ? 'Развернуть параметры' : 'Свернуть параметры вправо'; }
  }
  function toggleInspMin() { const s = loadLayout(); s.inspMin = !s.inspMin; saveLayout(s); applyInspMin(s.inspMin); }
  function openInspector() { appEl().classList.add('insp-open'); }
  function closeInspector() { appEl().classList.remove('insp-open'); }
  function toggleInspector() { appEl().classList.toggle('insp-open'); }
  function resetDrawers() { appEl().classList.remove('pal-open', 'insp-open'); syncScrim(); }

  /* инспектор ведёт себя как нижний лист: сам выезжает при выборе узла и
     прячется, когда выделение снято — но только на узком экране. */
  function onSelectIds(ids) {
    window.Inspector.show(ids);
    if (!mqNarrow.matches) return;
    if (ids && ids.length) openInspector(); else closeInspector();
  }

  /* ── вид холста: свободный / жгут ───────────────────── */
  function setView(mode) {
    window.Editor.setViewMode(mode);
    const m = window.Editor.getViewMode();
    document.querySelectorAll('.vsw').forEach(b => b.classList.toggle('on', b.dataset.act === 'view-' + m));
  }

  function switchTab(tab) {
    document.querySelectorAll('.ctab').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    document.querySelectorAll('.ctab-panel').forEach(p => p.classList.toggle('active', p.id === 'tab-' + tab));
    document.getElementById('app').classList.remove('console-collapsed');
  }

  /* ── панель «ИИ-бриф»: инструкция, подключения API, копирование брифа ── */
  const PROVIDERS = [['project','модель проекта'],['openai-compatible','OpenAI-совместимый'],
    ['anthropic','Anthropic'],['ollama','Ollama'],['custom','свой HTTP']];

  /* Ключи API живут ОТДЕЛЬНО от плана — в localStorage браузера, по имени
     env-переменной. В toJSON/экспорт/бриф/автосейв плана они не попадают. */
  function loadSecrets() {
    try { return JSON.parse(localStorage.getItem(LS_SECRETS) || '{}') || {}; } catch (e) { return {}; }
  }
  function saveSecrets(obj) {
    try { localStorage.setItem(LS_SECRETS, JSON.stringify(obj)); } catch (e) {}
  }
  function loadProxy() { try { return JSON.parse(localStorage.getItem(LS_PROXY) || '{}') || {}; } catch (e) { return {}; } }
  function saveProxy(obj) { try { localStorage.setItem(LS_PROXY, JSON.stringify(obj)); } catch (e) {} }

  /* ── мост «приложение → конструктор» (Cursor/Claude/Antigravity через MCP) ──
     Приложение кладёт операции правки на движок (/bridge/ops), браузер их
     опрашивает (/bridge/pull) и применяет ТЕМ ЖЕ кодом, что и правки из чата
     (applyOpsFromChat). Текущий план шлём обратно (/bridge/plan), чтобы
     приложение видело актуальную карту. URL движка берём из настроек прокси. */
  let bridgeTimer = null, bridgeLastRev = -1, bridgeBusy = false;
  function bridgeBase() { const p = loadProxy(); return p && p.url ? String(p.url).trim().replace(/\/+$/, '') : ''; }
  function bridgePushPlan(force) {
    const base = bridgeBase(); if (!base) return;
    const rev = (window.Graph.state.meta && Number(window.Graph.state.meta.rev)) || 0;
    if (!force && rev === bridgeLastRev) return;
    bridgeLastRev = rev;
    fetch(base + '/bridge/plan', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(window.Graph.toJSON()) }).catch(() => {});
  }
  async function bridgePoll() {
    if (bridgeBusy) return;
    const base = bridgeBase(); if (!base) return;
    bridgeBusy = true;
    try {
      const r = await fetch(base + '/bridge/pull', { method: 'GET' });
      if (r.ok) {
        const data = await r.json();
        const items = (data && data.ops) || [];
        let applied = 0;
        items.forEach(it => { const ops = extractOps(JSON.stringify(it)); if (ops) { applyOpsFromChat(ops, { silent: true }); applied++; } });
        bridgePushPlan(!!applied);   // после правок — точно перешлём план; иначе только если сменился rev
      }
    } catch (e) { /* движок не поднят — тихо ждём */ }
    finally { bridgeBusy = false; }
  }
  function applyBridgeState() {
    const on = !!loadProxy().bridge;
    if (bridgeTimer) { clearInterval(bridgeTimer); bridgeTimer = null; }
    const st = document.getElementById('bridge-state');
    if (st) { st.textContent = on ? 'включено' : 'выключено'; st.classList.toggle('on', on); }
    if (on) { bridgeLastRev = -1; bridgePushPlan(true); bridgeTimer = setInterval(bridgePoll, 1500); }
  }

  /* ── MCP: файлы и кнопки подключения в дашборде ── */
  let mcpApp = 'claude';
  const MCP_DEST = {
    cursor: 'Cursor: положи конфиг в <проект>\\.cursor\\mcp.json (или глобально %USERPROFILE%\\.cursor\\mcp.json), затем включи сервер «tester» в Settings → MCP.',
    claude: 'Claude Desktop: %APPDATA%\\Claude\\claude_desktop_config.json (создай файл, если нет) → вставь и перезапусти приложение.',
    antigravity: 'Antigravity: добавь в его MCP-конфиг (Settings → MCP), если приложение поддерживает MCP. Формат тот же.'
  };
  function mcpPathVal() { const el = document.getElementById('mcp-path'); return (el && el.value.trim()) || loadProxy().mcpPath || 'mcp_server.py'; }
  function mcpConfigText() {
    return JSON.stringify({ mcpServers: { tester: {
      command: 'py', args: ['-3.12', mcpPathVal()],
      env: { TESTER_ENGINE_URL: (loadProxy().url || 'http://127.0.0.1:8792') }
    } } }, null, 2);
  }
  function updateMcpView() {
    const dest = document.getElementById('mcp-dest'); if (dest) dest.textContent = MCP_DEST[mcpApp] || '';
    const pre = document.getElementById('mcp-cfg-view'); if (pre) pre.textContent = mcpConfigText();
    document.querySelectorAll('[data-act="mcp-app"]').forEach(b => b.classList.toggle('on', b.dataset.app === mcpApp));
  }
  function fallbackCopyText(t) { try { const ta = document.createElement('textarea'); ta.value = t; ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.focus(); ta.select(); document.execCommand('copy'); ta.remove(); } catch (e) {} }
  function copyText(t, okMsg) {
    const done = () => toast(okMsg || 'Скопировано', 'ok');
    try { if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(t).then(done, () => { fallbackCopyText(t); done(); }); return; } } catch (e) {}
    fallbackCopyText(t); done();
  }
  function downloadTextFile(name, text) {
    try { const b = new Blob([text], { type: 'text/plain;charset=utf-8' }); const u = URL.createObjectURL(b); const a = document.createElement('a'); a.href = u; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(u), 1000); }
    catch (e) { toast('Не удалось скачать', 'err'); }
  }
  async function fetchServerFile() { const r = await fetch('mcp_server.py?t=' + Date.now()); if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); }
  async function viewMcpServer() {
    const pre = document.getElementById('mcp-server-view'); if (!pre) return;
    if (!pre.hidden) { pre.hidden = true; return; }
    try { pre.textContent = await fetchServerFile(); pre.hidden = false; } catch (e) { toast('Не прочитать mcp_server.py с движка (' + e.message + ')', 'err'); }
  }
  async function downloadMcpServer() {
    try { downloadTextFile('mcp_server.py', await fetchServerFile()); } catch (e) { toast('Не прочитать mcp_server.py (' + e.message + ')', 'err'); }
  }

  /* Подключение по умолчанию: общее для всех проектов; значения плана его перекрывают.
     Так новый проект сразу видит модель, а «свою» можно задать внутри проекта. */
  function loadGlobalModels() { try { return JSON.parse(localStorage.getItem(LS_MODELS) || '{}') || {}; } catch (e) { return {}; } }
  function saveGlobalModels(o) { try { localStorage.setItem(LS_MODELS, JSON.stringify(o)); } catch (e) {} }
  function resolveModel(ref) {
    const g = loadGlobalModels()[ref] || {};
    const p = (((window.Graph.state.meta || {}).models) || {})[ref] || {};
    const out = Object.assign({}, g);
    Object.keys(p).forEach(k => { const v = p[k]; if (v !== '' && v != null) out[k] = v; });
    return out;
  }
  function nonEmpty(o) { const r = {}; Object.keys(o || {}).forEach(k => { if (o[k] !== '' && o[k] != null) r[k] = o[k]; }); return r; }
  /* Новый проект наследует подключение по умолчанию (пишем в сам план — движку нужно явно).
     Пустой проект: моё сохранённое подключение важнее заводского шаблона.
     Импорт/дубль: у плана своё подключение — его и уважаем, глобальным лишь добираем пустоты. */
  function seedModelsFromGlobal(preferPlan, carry) {
    const gl = loadGlobalModels(), src = {};
    ['primary', 'heavy'].forEach(ref => {
      const s = Object.assign({}, nonEmpty((carry || {})[ref]), nonEmpty(gl[ref]));  // дефолт важнее унаследованного
      if (Object.keys(s).length) src[ref] = s;
    });
    if (!src.primary && !src.heavy) return;
    const meta = window.Graph.state.meta = window.Graph.state.meta || {};
    const models = meta.models = meta.models || {};
    ['primary', 'heavy'].forEach(ref => {
      if (!src[ref]) return;
      const cur = nonEmpty(models[ref]);
      models[ref] = preferPlan ? Object.assign({}, src[ref], cur) : Object.assign({}, cur, src[ref]);
    });
  }
  /* Первый запуск после обновления: дефолта ещё нет — возьмём его с текущего проекта,
     иначе «перенос в новый проект» молча не работает, пока не нажмёшь «Сохранить». */
  function adoptGlobalIfEmpty() {
    const gl = loadGlobalModels();
    if (gl.primary || gl.heavy) return;
    const m = ((window.Graph.state.meta || {}).models) || {};
    const p = nonEmpty(m.primary), h = nonEmpty(m.heavy);
    if (p.base_url || h.base_url) saveGlobalModels({ primary: p, heavy: h });
  }
  /* Явная кнопка: разослать текущее подключение по всем проектам (и в дефолт). */
  function applyModelsToAllProjects() {
    const models = ((window.Graph.state.meta || {}).models) || {};
    const src = { primary: nonEmpty(models.primary), heavy: nonEmpty(models.heavy) };
    if (!src.primary.base_url && !src.heavy.base_url) return toast('Сначала задай Base URL и сохрани', 'warn');
    let n = 0;
    loadRegistry().forEach(p => {
      if (p.id === projectId) return;
      try {
        const raw = localStorage.getItem(LS_PROJECT + p.id); if (!raw) return;
        const d = JSON.parse(raw);
        d.meta = d.meta || {}; d.meta.models = d.meta.models || {};
        ['primary', 'heavy'].forEach(ref => {
          if (Object.keys(src[ref]).length) d.meta.models[ref] = Object.assign({}, d.meta.models[ref], src[ref]);
        });
        const s = JSON.stringify(d); localStorage.setItem(LS_PROJECT + p.id, s); diskPut(p.id, s); n++;
      } catch (e) {}
    });
    saveGlobalModels(src);
    toast(`Подключение разослано: ${n} проект(ов) + дефолт для новых`, 'ok');
  }

  function renderGuideModels() {
    const secrets = loadSecrets();
    const fld = (ref, key, label, val, type, wide) =>
      `<div class="gfld${wide ? ' wide' : ''}"><label>${esc(label)}</label>
         <input data-ref="${ref}" data-key="${key}" type="${type || 'text'}" value="${esc(val == null ? '' : val)}"></div>`;
    const modelsHTML = ['primary', 'heavy'].map(ref => {
      const m = resolveModel(ref);
      const sel = `<div class="gfld"><label>Провайдер</label><select data-ref="${ref}" data-key="provider">
        ${PROVIDERS.map(([v, l]) => `<option value="${v}" ${m.provider === v ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></div>`;
      const secretVal = m.api_key_env ? (secrets[m.api_key_env] || '') : '';
      const secretField = `<div class="gfld wide"><label>Ключ API — значение (локально в браузере, не в плане/экспорте/брифе)</label>
        <div class="gsecret">
          <input data-ref="${ref}" data-key="__secret" type="password" value="${esc(secretVal)}" placeholder="вставь ключ…" autocomplete="off" spellcheck="false">
          <button class="tb" type="button" data-act="toggle-secret">показать</button>
        </div></div>`;
      return `<div class="gmodel"><div class="gmodel-h">${esc(m.label || ref)} · <span class="micro dim">${ref}</span></div>
        <div class="gmodel-grid">
          ${sel}
          <div class="gfld"><label>Модель</label>
            <div class="gmodelpick">
              <input data-ref="${ref}" data-key="model" type="text" value="${esc(m.model || '')}" placeholder="id модели">
              <button class="tb" type="button" data-act="load-models" data-ref="${ref}" title="Загрузить список моделей провайдера">↻ модели</button>
            </div>
            <select class="gmodels-list" data-ref="${ref}" hidden></select>
          </div>
          ${fld(ref, 'base_url', 'Base URL (локальный или облачный)', m.base_url, 'text', true)}
          ${fld(ref, 'api_key_env', 'Имя env-переменной ключа (ссылка для движка)', m.api_key_env, 'text', true)}
          ${secretField}
          ${fld(ref, 'context_tokens', 'Контекст, токенов', m.context_tokens, 'number')}
          ${fld(ref, 'max_output_tokens', 'Ответ, токенов', m.max_output_tokens, 'number')}
        </div></div>`;
    }).join('');
    const px = loadProxy();
    const proxyBlock = `<div class="gmodel"><div class="gmodel-h">Прокси движка · обход CORS облачных API</div>
      <label class="gproxy-on"><input type="checkbox" id="proxy-on" ${px.on ? 'checked' : ''}> ходить в API через прокси движка</label>
      <div class="gfld wide"><label>URL прокси движка</label>
        <input id="proxy-url" type="text" value="${esc(px.url || 'http://localhost:8792')}" placeholder="http://localhost:8792"></div>
      <div class="micro dim">Запусти прокси: <code>py chat_proxy.py</code> (или в WSL рядом с движком). Ключ идёт браузер→localhost→провайдер.</div></div>`;
    const bridgeBlock = `<div class="gmodel"><div class="gmodel-h">Сопряжение с приложениями (MCP) · Cursor / Claude Desktop / Antigravity</div>
      <label class="gproxy-on"><input type="checkbox" id="bridge-on" ${px.bridge ? 'checked' : ''}> принимать команды из приложений и строить план вживую</label>
      <div class="micro dim">Приложение шлёт правки на движок, конструктор применяет их сам. Статус: <b id="bridge-state" class="${px.bridge ? 'on' : ''}">${px.bridge ? 'включено' : 'выключено'}</b>. Нужен запущенный движок (<code>py serve.py</code>).</div>
      <div class="mcp-files">
        <div class="mcp-file"><span class="mcp-file-ico">🐍</span>
          <div class="mcp-file-body"><b>mcp_server.py</b><i>сам MCP-сервер — его запускает приложение</i></div>
          <button class="tb" data-act="mcp-view">показать</button><button class="tb" data-act="mcp-dl-server">скачать</button></div>
        <div class="mcp-file"><span class="mcp-file-ico">🧩</span>
          <div class="mcp-file-body"><b>mcp.json</b><i>конфиг подключения для приложения</i></div>
          <button class="tb" data-act="mcp-copy">копировать</button><button class="tb" data-act="mcp-dl-cfg">скачать</button></div>
      </div>
      <div class="gfld wide"><label>Путь к mcp_server.py на диске</label>
        <input id="mcp-path" type="text" value="${esc(px.mcpPath || 'C:\\\\Users\\\\user\\\\Desktop\\\\Tester\\\\mcp_server.py')}" placeholder="C:\\...\\mcp_server.py"></div>
      <div class="mcp-apps">Подключить к:
        <button class="tb" data-act="mcp-app" data-app="cursor">Cursor</button>
        <button class="tb" data-act="mcp-app" data-app="claude">Claude Desktop</button>
        <button class="tb" data-act="mcp-app" data-app="antigravity">Antigravity</button></div>
      <div class="micro dim" id="mcp-dest"></div>
      <pre class="mcp-cfg" id="mcp-cfg-view"></pre>
      <pre class="mcp-cfg" id="mcp-server-view" hidden></pre>
    </div>`;
    document.getElementById('guide-models').innerHTML = modelsHTML + proxyBlock + bridgeBlock;
    updateMcpView();
    const mp = document.getElementById('mcp-path');
    if (mp) mp.addEventListener('input', () => { const p = loadProxy(); p.mcpPath = mp.value; saveProxy(p); updateMcpView(); });
  }

  /* Список моделей провайдера (GET /models). Читает ЖИВЫЕ поля панели —
     base_url и ключ, — поэтому предварительно сохранять не обязательно. */
  async function loadModels(ref) {
    const q = k => document.querySelector(`#guide-models [data-ref="${ref}"][data-key="${k}"]`);
    const btn = document.querySelector(`[data-act="load-models"][data-ref="${ref}"]`);
    const sel = document.querySelector(`select.gmodels-list[data-ref="${ref}"]`);
    const m = ((window.Graph.state.meta || {}).models || {})[ref] || {};
    const baseInp = q('base_url'), secInp = q('__secret'), envInp = q('api_key_env');
    const base = String((baseInp && baseInp.value) || m.base_url || '').trim().replace(/\/+$/, '');
    if (!base) return toast('Сначала укажи Base URL', 'warn');
    const envName = (envInp && envInp.value.trim()) || m.api_key_env || '';
    const key = (secInp && secInp.value) ? secInp.value : (envName ? (loadSecrets()[envName] || '') : '');
    const proxy = loadProxy();
    const upstream = base + '/models';
    const headers = {};
    let url;
    if (proxy.on && proxy.url) {
      url = String(proxy.url).trim().replace(/\/+$/, '') + '/v1/models';
      headers['X-Upstream-Url'] = upstream;
      if (key) headers.Authorization = 'Bearer ' + key; else if (envName) headers['X-Api-Key-Env'] = envName;
    } else {
      url = upstream;
      if (key) headers.Authorization = 'Bearer ' + key;
    }
    const label = btn ? btn.textContent : '';
    if (btn) { btn.textContent = '…'; btn.disabled = true; }
    try {
      const res = await fetch(url, { headers });
      if (!res.ok) { let t = ''; try { t = await res.text(); } catch (_) {} throw new Error(`${res.status} ${res.statusText}${t ? ': ' + t.slice(0, 160) : ''}`); }
      const data = await res.json();
      const list = (data && data.data) || (Array.isArray(data) ? data : (data && data.models)) || [];
      const ids = list.map(x => typeof x === 'string' ? x : (x && (x.id || x.name))).filter(Boolean);
      if (!ids.length) throw new Error('провайдер вернул пустой список');
      const cur = q('model') ? q('model').value : m.model;
      sel.innerHTML = '<option value="">— выбери модель —</option>' +
        ids.map(id => `<option value="${esc(id)}" ${id === cur ? 'selected' : ''}>${esc(id)}</option>`).join('');
      sel.hidden = false;
      toast(`Загружено моделей: ${ids.length} — выбери в списке и нажми «Сохранить»`, 'ok');
    } catch (e) {
      const viaProxy = proxy.on && proxy.url;
      toast('Не удалось загрузить модели: ' + e.message + (viaProxy ? '' : ' — если CORS, включи прокси движка'), 'err');
    } finally {
      if (btn) { btn.textContent = label; btn.disabled = false; }
    }
  }

  function openGuide() { renderGuideModels(); document.getElementById('guide').hidden = false; }
  function closeGuide() { document.getElementById('guide').hidden = true; }

  function saveGuideModels() {
    const meta = window.Graph.state.meta = window.Graph.state.meta || {};
    const models = meta.models = meta.models || {};
    // 1) поля модели → в план (секрет пропускаем)
    document.querySelectorAll('#guide-models [data-ref]').forEach(el => {
      if (el.dataset.key === '__secret') return;
      const m = models[el.dataset.ref] = models[el.dataset.ref] || {};
      let v = el.value;
      if (typeof v === 'string') v = v.trim();
      if (el.type === 'number') v = v === '' ? undefined : Number(v);
      // пустое поле НЕ пишем в план: пустая строка перебивала бы дефолт и ломала подключение
      if (v === '' || v === undefined) delete m[el.dataset.key];
      else m[el.dataset.key] = v;
    });
    // 2) значения ключей → в локальное хранилище, по имени env-переменной (не в план)
    const secrets = loadSecrets();
    let stray = false;
    document.querySelectorAll('#guide-models [data-key="__secret"]').forEach(el => {
      const env = (models[el.dataset.ref] || {}).api_key_env;
      if (!env) { if (el.value) stray = true; return; }   // некуда класть без имени переменной
      if (el.value) secrets[env] = el.value; else delete secrets[env];
    });
    saveSecrets(secrets);
    // 3) то же — в подключение ПО УМОЛЧАНИЮ: новые проекты подхватят его сами
    const gl = loadGlobalModels();
    ['primary', 'heavy'].forEach(ref => { if (models[ref]) gl[ref] = Object.assign({}, gl[ref], models[ref]); });
    saveGlobalModels(gl);
    const pon = document.getElementById('proxy-on'), pur = document.getElementById('proxy-url'), bon = document.getElementById('bridge-on'), mpath = document.getElementById('mcp-path');
    if (pon && pur) saveProxy({ on: pon.checked, url: pur.value.trim(), bridge: bon ? bon.checked : !!loadProxy().bridge, mcpPath: mpath ? mpath.value.trim() : loadProxy().mcpPath });
    applyBridgeState();
    commit(); refresh(); renderChatModel();
    toast(stray ? 'Сохранено. Ключ без имени env-переменной не записан — задай имя'
                : 'Подключение сохранено — и в этот проект, и по умолчанию для новых', stray ? 'warn' : 'ok');
  }

  /* Сжатый бриф: ёмкие правила + текущий план минифицированным JSON. */
  function buildBrief() {
    const rules = [
      'Ты дорабатываешь ПЛАН ПРОЕКТА в конструкторе Workbench. План = граф: узел=шаг (params — ТЗ шага), ребро=связь.',
      'ПОРТЫ: kind flow (порядок выполнения) либо data (знания/контекст). Ребро соединяет ТОЛЬКО одинаковые kind; from=выход, to=вход. Входы с multi берут несколько рёбер. У choice/direction по порту на пункт; у agent порт graph при graph_in:true.',
      'СХЕМА: узел {id,type,name,x,y,enabled,notes,params}; ребро {id,from:{node,port},to:{node,port},kind:"flow"|"data"}.',
      'ПРАВКА: меняй минимум, верни ВЕСЬ план ОДНИМ минифицированным JSON (без красивого форматирования, без прозы). id держи стабильными; новый узел id="<type>_<n>"; подними meta.rev +1. x/y любые — человек нажмёт авто-раскладку.',
      'ТИПЫ: start,source,condition,loop,queue,merge,choice,direction (поток); task,agent,expert,expert_group,script (работа); kb,codegraph,context,transform (данные); output,store,paywall,progress,note (выход). Точные порты/params — в текущем плане ниже и в файле AI_GUIDE.md.',
      'МОДЕЛИ ИИ в meta.models.primary/heavy: base_url+model+api_key_env (имя env-переменной, НЕ сам ключ); локальный (Ollama/LM Studio/vLLM) или облачный. agent/expert берут их через model_ref.',
      'КАРКАС СБОРКИ: порядок flow-связей = порядок сборки; каждый узел — маленький проверяемый шаг, не забегай вперёд; data-рёбра говорят, что питает шаг.',
      'Числа настроек — 3 знака после точки.',
    ].join('\n');
    return '# WORKBENCH — БРИФ ДЛЯ ИИ\n' + rules +
      '\n\n## ТЕКУЩИЙ ПЛАН (минифицированный JSON — верни план в этом же виде)\n' +
      JSON.stringify(window.Graph.toJSON());
  }

  function copyBrief() {
    const brief = buildBrief();
    const done = () => toast('Бриф скопирован — вставь в ИИ (Hermes / локальный / облачный)', 'ok');
    if (navigator.clipboard && navigator.clipboard.writeText)
      navigator.clipboard.writeText(brief).then(done).catch(() => fallbackCopy(brief, done));
    else fallbackCopy(brief, done);
  }

  function fallbackCopy(text, done) {
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); done(); } catch (e) { toast('Не удалось скопировать — выдели вручную', 'err'); }
    ta.remove();
  }

  /* ── проект как КОМПАКТНАЯ память чата ────────────────────────
     В модель уходит КАРТА плана (id · тип · имя · связи), а не тексты
     блоков: 83 узла ≈ 3 КБ. Детали блока подгружаются по требованию —
     сам ИИ просит строкой «@детали:» / «@ветка:», либо мы подкладываем
     их сразу, если человек назвал блок в сообщении. */
  const CTX_MAX_DETAIL = 8;      // блоков за один подхват
  const CTX_MAX_HOPS   = 3;      // сколько раз подряд ИИ может просить контекст

  function nodeById(id) { return window.Graph.state.nodes.find(n => n.id === id) || null; }

  function planDigest() {
    const st = window.Graph.state;
    const flowOut = {}, dataPairs = [];
    st.edges.forEach(e => {
      if (e.kind === 'data') { if (dataPairs.length < 90) dataPairs.push(`${e.from.node}→${e.to.node}`); return; }
      (flowOut[e.from.node] = flowOut[e.from.node] || []).push(e.to.node + (e.from.port && e.from.port !== 'out' ? `(${e.from.port})` : ''));
    });
    let steps = [];
    try { steps = window.Graph.plan().steps || []; } catch (e) {}
    const seen = new Set(), lines = [];
    const line = (n, depth, tag) => `${'·'.repeat(Math.max(0, depth || 0))}${n.id} ${n.type} "${n.name}"` +
      (n.enabled === false ? ' [выкл]' : '') + (tag ? ` [${tag}]` : '') +
      (n.params && Object.keys(n.params).length ? ` +${Object.keys(n.params).length}п` : '') +
      ((flowOut[n.id] || []).length ? ` → ${flowOut[n.id].join(',')}` : '');
    steps.forEach(s => {
      const n = nodeById(s.id); if (!n) return;
      if (s.repeat) { lines.push(`${'·'.repeat(s.depth)}${n.id} ↺ виток цикла`); return; }
      seen.add(n.id); lines.push(line(n, s.depth, s.tag));
    });
    const rest = st.nodes.filter(n => !seen.has(n.id));
    const meta = st.meta || {};
    const out = [
      `план "${st.name}" · rev ${meta.rev || 0} · узлов ${st.nodes.length} · связей ${st.edges.length}` + (meta.stage ? ` · стадия ${meta.stage}` : ''),
      '', 'ПОТОК (отступ = вложенность; «+Nп» = столько параметров у блока скрыто):', ...lines,
    ];
    if (rest.length) out.push('', 'ВНЕ ПОТОКА (знания, контекст, заметки):', ...rest.map(n => line(n, 0, '')));
    if (dataPairs.length) out.push('', 'СВЯЗИ ДАННЫХ: ' + dataPairs.join(' '));
    return out.join('\n');
  }

  function nodeDetail(id) {
    const n = nodeById(id); if (!n) return `${id}: такого блока нет`;
    const ins = [], outs = [];
    window.Graph.state.edges.forEach(e => {
      const d = e.kind === 'data' ? ' (данные)' : '';
      if (e.to.node === id) ins.push(`${e.from.node}.${e.from.port} → ${e.to.port}${d}`);
      if (e.from.node === id) outs.push(`${e.from.port} → ${e.to.node}.${e.to.port}${d}`);
    });
    return `### ${n.id} · ${n.type} · "${n.name}"${n.enabled === false ? ' [выключен]' : ''}\n` +
      `входы: ${ins.join('; ') || '—'}\nвыходы: ${outs.join('; ') || '—'}\n` +
      `заметки: ${n.notes || '—'}\nparams: ${JSON.stringify(n.params || {})}`;
  }

  /* Ветка = блоки вниз по потоку от указанного, в порядке выполнения. */
  function branchIds(rootId) {
    const out = [], seen = new Set();
    const next = id => window.Graph.state.edges.filter(e => e.kind !== 'data' && e.from.node === id).map(e => e.to.node);
    (function walk(id) { if (seen.has(id)) return; seen.add(id); out.push(id); next(id).forEach(walk); })(rootId);
    return out;
  }

  /* ИИ просит контекст: «@детали: id1,id2», «@блок: input,process», «@ветка: id с 9».
     Разбор НАРОЧНО терпимый: модель пишет вводную фразу, несколько строк подряд,
     маркеры списка, кавычки, кодовый блок — всё это нормальный ответ, и раньше он
     не распознавался, а модель оставалась ждать контекст, которого не будет. */
  function parseCtxRequest(text) {
    const raw = String(text || '');
    if (extractPlan(raw) || extractOps(raw)) return null;      // это уже правки, а не запрос
    /* ключевое слово ловим целиком: \w кириллицу не берёт, и «@ветка» разбиралось
       как «@ветк» + блок с именем «а:» */
    const rx = /^@\s*([a-zа-яё]+)\s*:?\s*(.*)$/i;
    const ids = [], types = [];
    let branch = null;
    raw.split(/[\n\r]+/).forEach(line => {
      const l = line.trim().replace(/^[`>*\-–—•\s]+/, '').replace(/[`*]+$/, '');
      const m = l.match(rx); if (!m) return;
      const what = m[1].toLowerCase();
      const arg = (m[2] || '').replace(/[«»"'`.]/g, '').trim();
      const words = arg.split(/[\s,;]+/).filter(Boolean);
      if (/^(ветк|branch)/.test(what)) {
        if (!branch && words.length) {
          const num = words.slice(1).find(w => /^\d+$/.test(w));   // «с 9» — только отдельным числом
          branch = { root: words[0], from: Math.max(1, parseInt(num || '1', 10)) };
        }
      } else if (/^(блок|схем|block|schema)/.test(what)) {
        words.forEach(t => { if (!types.includes(t)) types.push(t); });
      } else if (/^(детал|detail)/.test(what)) {
        words.forEach(i => { if (!ids.includes(i)) ids.push(i); });
      }
    });
    if (!ids.length && !types.length && !branch) return null;

    const parts = [], labels = [];
    if (types.length) {
      const known = types.filter(t => window.BLOCKS.TYPES[t]).slice(0, 8);
      const bad = types.filter(t => !window.BLOCKS.TYPES[t]);
      if (known.length) { parts.push(known.map(typeSchema).join('\n\n')); labels.push('схемы ' + known.join(',')); }
      if (bad.length) { parts.push(`Таких типов нет: ${bad.join(', ')} — сверься с каталогом типов.`); labels.push('нет типов ' + bad.join(',')); }
    }
    if (ids.length) {
      const known = ids.filter(nodeById).slice(0, CTX_MAX_DETAIL);
      const bad = ids.filter(i => !nodeById(i));
      if (known.length) { parts.push(known.map(nodeDetail).join('\n\n')); labels.push('детали ' + known.join(',')); }
      if (bad.length) { parts.push(`Таких блоков нет: ${bad.join(', ')} — сверься с картой плана.`); labels.push('нет блоков ' + bad.join(',')); }
    }
    if (branch) {
      const root = branch.root, from = branch.from;
      if (!nodeById(root)) { parts.push(`Блока ${root} нет — сверься с картой плана.`); labels.push('нет блока ' + root); }
      else {
        const all = branchIds(root), slice = all.slice(from - 1, from - 1 + CTX_MAX_DETAIL);
        if (!slice.length) { parts.push(`В ветке ${root} всего ${all.length} блоков — дальше пусто.`); labels.push(`ветка ${root}: конец`); }
        else {
          const last = from - 1 + slice.length;
          parts.push(slice.map(nodeDetail).join('\n\n') + (last < all.length
            ? `\n\nПоказаны ${from}–${last} из ${all.length}. Следующая порция: @ветка: ${root} с ${last + 1}`
            : `\n\nКонец ветки (всего ${all.length}).`));
          labels.push(`ветка ${root} ${from}–${last}/${all.length}`);
        }
      }
    }
    return parts.length ? { label: labels.join(' · '), data: parts.join('\n\n') } : null;
  }

  /* Человек сам назвал блоки — подложим их детали сразу, без лишнего круга. */
  function idsInText(text) {
    const ids = [], low = String(text).toLowerCase();
    window.Graph.state.nodes.forEach(n => {
      if (ids.length >= CTX_MAX_DETAIL) return;
      const rx = new RegExp('(^|[^\\w-])' + n.id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '($|[^\\w-])');
      if (rx.test(text) || (n.name && n.name.length > 4 && low.includes(n.name.toLowerCase()))) ids.push(n.id);
    });
    return ids;
  }

  /* Каталог типов: ярлык + НАЗНАЧЕНИЕ + пометка про порты. Без назначения ИИ
     выбирает блок по созвучию имени (брал «Источник проекта» под сбор новостей),
     без пометки портов — вешает связь на «конец ветки». */
  function typeCatalog() {
    const B = window.BLOCKS;
    return Object.keys(B.TYPES).map(k => {
      const T = B.TYPES[k];
      const i = B.portsOf(k, 'in') || [], o = B.portsOf(k, 'out') || [];
      const fi = i.some(p => p.kind === 'flow'), fo = o.some(p => p.kind === 'flow');
      const mark = (!i.length && !o.length) ? ' [без портов]'
        : (!fi && !fo) ? ' [только данные, вне потока]'
        : !fi ? ' [нет входа — точка входа]'
        : !fo ? ' [нет выхода — конец ветки]' : '';
      return `${k} = ${T.label}${mark} — ${T.desc || ''}`;
    }).join('\n');
  }

  /* Полная схема одного типа — по запросу ИИ (@блок: source). Показываем и
     заводские значения: это примеры из проекта анализа кода, их надо переписать. */
  function typeSchema(t) {
    const B = window.BLOCKS, T = B.TYPES[t];
    if (!T) return `${t}: такого типа нет`;
    const port = (dir) => (B.portsOf(t, dir) || []).map(p => `${p.id}:${p.kind}`).join(', ') || '—';
    const def = B.defaults(t);
    const vis = new Set((B.visibleParams(t, def) || []).map(f => f.key));
    const params = (T.params || []).map(f => {
      const opts = f.options ? `[${f.options.map(x => Array.isArray(x) ? x[0] : x).join('|')}]` : '';
      const d = def[f.key];
      const dv = d === undefined ? '' : ` = ${typeof d === 'object' ? JSON.stringify(d) : d}`;
      return `  ${f.key}: ${f.type || 'text'}${opts}${f.required ? ' ОБЯЗАТЕЛЬНО' : ''}${dv}` +
        (vis.has(f.key) ? '' : '   (появляется при других значениях соседних полей)');
    }).join('\n');
    return `### ${t} · ${T.label} · категория ${T.category}\nназначение: ${T.desc || '—'}\n` +
      `входы: ${port('in')}\nвыходы: ${port('out')}\nпараметры (значения ниже — ЗАВОДСКИЕ ПРИМЕРЫ, перепиши под задачу):\n${params}`;
  }

  function buildChatSystem() {
    return [
      '# WORKBENCH — ты дорабатываешь ПЛАН ПРОЕКТА (граф: узел = шаг, ребро = связь).',
      'Ниже КАРТА плана — компактно: id, тип, имя, связи. Заметки и параметры блоков в ней НЕ показаны.',
      '',
      '## КАК ПОЛУЧИТЬ ДЕТАЛИ',
      'Нужны подробности — напиши строку-запрос. Можно несколько строк подряд и с вводной фразой, можно перечислить через запятую:',
      `@детали: id1,id2      — до ${CTX_MAX_DETAIL} блоков: заметки, params, порты`,
      `@ветка: id с 1        — блоки ветки по очереди, порциями по ${CTX_MAX_DETAIL} (дальше «с ${CTX_MAX_DETAIL + 1}»)`,
      '@блок: source,kb      — полная схема ТИПА: назначение, порты, все параметры с допустимыми значениями',
      'Система пришлёт запрошенное следующим сообщением — тогда и отвечай по существу. Содержимое блока и набор его параметров не выдумывай, запроси.',
      '',
      '## КАК МЕНЯТЬ ПЛАН',
      'Изменения возвращай ТОЛЬКО таким JSON, без прозы вокруг (любой список можно опустить):',
      '{"add":[{"id":"a1","type":"agent","name":"Сбор данных","notes":"…","params":{}}],',
      ' "edges":[["a1","a2"],["a2","out1"]],',
      ' "patch":[{"id":"agent_3","name":"…","notes":"…","params":{},"enabled":true}],',
      ' "del":["task_7"]}',
      '· add — НОВЫЕ блоки: "type" обязателен, "id" — временное имя только для ссылок в edges ВНУТРИ ЭТОГО ЖЕ ответа. Конструктор выдаст блоку свой id и пришлёт соответствие следующим сообщением — дальше правь ТОЛЬКО по настоящим id из карты плана.',
      '· patch — правка СУЩЕСТВУЮЩИХ: id строго из карты, поля только меняемые, params сливаются по ключам.',
      '· edges — связи: ["откуда","куда"], порты подставятся сами; можно явно "узел:порт".',
      '· КАЖДЫЙ новый блок подключай В ТОМ ЖЕ ответе: рядом с add обязательно шли edges от существующего блока к новому (id существующего — из карты плана, ЕГО не выдумывай). Блок без связей выпадает из плана и висит в стороне.',
      '· "layout":true — разложить схему по слоям (просят «разложи блоки», «наезжают друг на друга», «некрасиво лежат» — это оно).',
      'Весь план целиком возвращать НЕ надо. Координаты блоков не твоя забота — их считает конструктор.',
      '',
      '## ДВА ПРАВИЛА, БЕЗ КОТОРЫХ ПОЛУЧАЕТСЯ ЧУЖАЯ КАРТОЧКА',
      '1) ТИП выбирай по НАЗНАЧЕНИЮ из каталога ниже, а не по созвучию имени. Для любой предметной области (агрегаторы данных, анализ трафика, маркетинг, чат-боты) костяк — ТРИ УНИВЕРСАЛЬНЫХ блока: input (вход данных: API, вебхук, поток, лента, файл, база), process (обработка без модели: фильтр, дедуп, группировка, разметка), sink (отдача наружу: API, вебхук, база, сообщение, очередь). Дальше по вкусу: start, agent, task, script, transform, queue, loop, condition, choice, merge, kb, context, store, output, progress, note. А source, codegraph, direction, paywall, expert, expert_group заточены под разбор кодовых проектов — бери их, только если задача правда про это.',
      '2) PARAMS у нового блока обязательно задавай сам. По умолчанию туда подставляются ЗАВОДСКИЕ ПРИМЕРЫ из проекта анализа кода (пути work\\project, списки .env/*.pem, история git) — если их не переписать, у пользователя останется карточка не про его задачу. Не знаешь ключей и допустимых значений типа — сперва спроси «@блок: <type>».',
      'Порты: kind flow (порядок выполнения) и data (знания) — соединяются только одинаковые. Числа настроек — 3 знака после точки.',
      '',
      '## ТИПЫ БЛОКОВ (type = что делает; пометка = чего у блока нет)',
      typeCatalog(),
      '',
      '## КАРТА ПЛАНА',
      window.Graph.state.nodes.length ? planDigest()
        : 'План ПУСТОЙ — блоков нет. Собери его с нуля: начни с блока start, дальше шаги через add + edges.',
    ].join('\n');
  }

  /* ── чат с подключённым ИИ (живой вызов + откат) ─────── */
  function chatKey() { return LS_CHAT + (projectId ? '.' + projectId : ''); }
  function loadChat() {
    try {
      const raw = localStorage.getItem(chatKey());
      if (raw != null) return JSON.parse(raw) || [];
      const old = localStorage.getItem(LS_CHAT);      // разовая миграция общей истории в текущий проект
      if (old && projectId) { localStorage.setItem(chatKey(), old); localStorage.removeItem(LS_CHAT); return JSON.parse(old) || []; }
      return [];
    } catch (e) { return []; }
  }
  function saveChat() { try { localStorage.setItem(chatKey(), JSON.stringify(chatHistory.slice(-60))); } catch (e) {} }

  function renderChatModel() {
    const sel = document.getElementById('chat-model'); if (!sel) return;
    const models = (window.Graph.state.meta && window.Graph.state.meta.models) || {};
    sel.innerHTML = ['primary', 'heavy'].map(ref => {
      const m = models[ref] || {};
      return `<option value="${ref}" ${ref === chatModelRef ? 'selected' : ''}>${esc(m.label || ref)}${m.model ? ' · ' + esc(m.model) : ''}</option>`;
    }).join('');
  }

  /* Достать план из ответа ИИ: сперва из ```json```-блока, иначе первый {…} с nodes+edges. */
  function extractPlan(text) {
    const tries = [];
    const fence = String(text).match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fence) tries.push(fence[1]);
    const br = String(text).indexOf('{');
    if (br >= 0) tries.push(String(text).slice(br));
    tries.push(String(text));
    for (const t of tries) {
      try { const o = JSON.parse(t.trim()); if (o && Array.isArray(o.nodes) && Array.isArray(o.edges)) return o; } catch (e) {}
    }
    return null;
  }

  /* Правки плана из чата — четыре списка, все необязательные:
     {"add":[{id,type,name,notes,params}], "edges":[["a","b"]],
      "patch":[{id,name?,notes?,params?,enabled?}], "del":["id"]}
     Запись patch с НЕизвестным id, но с "type" — это тоже создание блока. */
  function extractOps(text) {
    const tries = [];
    const fence = String(text).match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fence) tries.push(fence[1]);
    const br = String(text).indexOf('{');
    if (br >= 0) tries.push(String(text).slice(br));
    tries.push(String(text));
    for (const t of tries) {
      try {
        const o = JSON.parse(t.trim());
        if (!o || typeof o !== 'object' || Array.isArray(o)) continue;
        const ops = {
          patch: Array.isArray(o.patch) ? o.patch.filter(p => p && p.id) : [],
          add:   Array.isArray(o.add)   ? o.add.filter(p => p && p.type) : [],
          edges: Array.isArray(o.edges) ? o.edges : [],
          del:   Array.isArray(o.del)   ? o.del.filter(x => typeof x === 'string') : [],
          layout: o.layout === true || o.layout === 'auto',
        };
        if (ops.patch.length || ops.add.length || ops.edges.length || ops.del.length || ops.layout) return ops;
      } catch (e) {}
    }
    return null;
  }
  /* Псевдонимы: ИИ придумывает блокам временные имена (a1, dedup, publish), а
     конструктор выдаёт свои id. Запоминаем соответствие, иначе следующая правка
     «по старому имени» не находит блок и всё отваливается. */
  function aliasKey() { return 'tester.alias.' + (projectId || ''); }
  function loadAliases() { try { return JSON.parse(localStorage.getItem(aliasKey()) || '{}') || {}; } catch (e) { return {}; } }
  function saveAliases(a) { try { localStorage.setItem(aliasKey(), JSON.stringify(a)); } catch (e) {} }
  /* Ищем блок: точный id → запомненный псевдоним → имя блока (регистр, знаки и
     двойные пробелы не важны) → единственное совпадение по началу имени.
     ИИ зовёт блоки как ему удобнее, и из-за буквоедства связи молча терялись. */
  const normName = s => String(s || '').toLowerCase()
    .replace(/[«»"'`.,:;!?()\[\]{}—–_-]/g, ' ').replace(/\s+/g, ' ').trim();
  function resolveNodeId(id, strict) {
    if (!id) return null;
    if (nodeById(id)) return id;
    const a = loadAliases()[id];
    if (a && nodeById(a)) return a;
    const q = normName(id);
    if (!q) return null;
    const nodes = window.Graph.state.nodes;
    const exact = nodes.find(n => normName(n.name) === q);
    if (exact) return exact.id;
    // тихое применение (мост из приложений, без диалога) — только точное совпадение:
    // нечёткий префикс мог молча изменить/удалить НЕ тот блок
    if (strict) return null;
    const starts = nodes.filter(n => normName(n.name).startsWith(q) || q.startsWith(normName(n.name)));
    return starts.length === 1 ? starts[0].id : null;
  }

  function splitOps(ops, strict) {
    const create = ops.add.slice(), update = [], unknown = [];
    ops.patch.forEach(p => {
      const real = resolveNodeId(p.id, strict);
      if (real) update.push(Object.assign({}, p, { id: real }));
      else if (p.type) create.push(p);
      else unknown.push(p.id);
    });
    return { create, update, unknown };
  }
  function opsSummary(ops) {
    const s = splitOps(ops), parts = [];
    if (s.create.length) parts.push(`создать ${s.create.length}`);
    if (s.update.length) parts.push(`изменить ${s.update.length}`);
    if (ops.edges.length) parts.push(`связать ${ops.edges.length}`);
    if (ops.del.length) parts.push(`удалить ${ops.del.length}`);
    if (ops.layout) parts.push('разложить схему');
    if (s.unknown.length) parts.push(`не найдено ${s.unknown.length}`);
    return parts.join(' · ');
  }

  function renderChat() {
    const log = document.getElementById('chat-log'); if (!log) return;
    if (!chatHistory.length) {
      log.innerHTML = '<div class="chat-empty">Чат помнит ЭТОТ проект: видит карту плана, а детали блока подтянет по просьбе.<br>' +
        '«разбери блок agent_3», «пройди по очереди ветку от loop_1»<br>' +
        '<span class="dim">Правки вернутся кнопкой «Применить». Подключение — в ✦ ИИ.</span></div>';
      return;
    }
    log.innerHTML = chatHistory.map((m, i) => {
      if (m.role === 'error') return `<div class="chat-msg err">⚠ ${esc(m.content)}` +
        (i === chatHistory.length - 1 ? '<div class="chat-apply"><button class="tb" data-act="chat-retry">↻ повторить</button></div>' : '') + '</div>';
      if (m.role === 'ctx') return `<div class="chat-ctx${m.warn ? ' warn' : ''}" title="${esc(String(m.content).slice(0, 600))}">↳ ${esc(m.label)}</div>`;
      if (m.role === 'summary') return `<div class="chat-summary" title="Сводка сжатого разговора — ИИ её помнит"><b>🗜 сводка разговора</b>${esc(m.content)}</div>`;
      if (m.role === 'user') return `<div class="chat-msg user">${esc(m.content)}</div>`;
      const plan = extractPlan(m.content), ops = plan ? null : extractOps(m.content);
      let apply = '';
      if (plan) apply = `<div class="chat-apply"><button class="tb primary" data-act="chat-apply" data-i="${i}">Применить план</button><span class="dim">${plan.nodes.length} узлов · ${plan.edges.length} связей</span></div>`;
      else if (ops) apply = `<div class="chat-apply"><button class="tb primary" data-act="chat-patch" data-i="${i}">Применить к плану</button><span class="dim">${esc(opsSummary(ops))}</span></div>`;
      return `<div class="chat-msg ai">${esc(m.content)}${apply}</div>`;
    }).join('');
    log.scrollTop = log.scrollHeight;
  }

  async function callAI(ref, apiMessages) {
    const m = resolveModel(ref);
    const base = String(m.base_url || '').trim().replace(/\/+$/, '');
    if (!base) throw new Error(`Не задан Base URL для модели «${ref}» в проекте «${window.Graph.state.name}». Открой ✦ ИИ → «Подключение ИИ», заполни и нажми «Сохранить подключения». Кнопка «Применить ко всем проектам» рядом — разошлёт его по остальным проектам.`);
    const key = m.api_key_env ? (loadSecrets()[m.api_key_env] || '') : '';
    const upstream = base + '/chat/completions';
    const body = { model: m.model || '', messages: apiMessages, temperature: 0.300, stream: false };
    if (m.max_output_tokens) body.max_tokens = Number(m.max_output_tokens);

    // облачные API рубят браузер по CORS — при включённом прокси движка идём через него
    const proxy = loadProxy();
    const headers = { 'Content-Type': 'application/json' };
    let url, viaProxy = false;
    if (proxy.on && proxy.url) {
      viaProxy = true;
      url = String(proxy.url).trim().replace(/\/+$/, '') + '/v1/chat/completions';
      headers['X-Upstream-Url'] = upstream;
      if (key) headers.Authorization = 'Bearer ' + key;
      else if (m.api_key_env) headers['X-Api-Key-Env'] = m.api_key_env;   // ключа нет в браузере — прокси возьмёт из своего окружения
    } else {
      url = upstream;
      if (key) headers.Authorization = 'Bearer ' + key;
    }
    /* 5xx/429 — это сбой на стороне провайдера, обычно разовый: тихо повторяем. */
    let res;
    for (let attempt = 0; ; attempt++) {
      try {
        res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
      } catch (e) {
        throw new Error(viaProxy
          ? `Не удалось связаться с прокси движка ${url} — запущен ли он? (py chat_proxy.py) [${e.message}]`
          : `Не удалось связаться с ${url}. Частая причина — CORS: облачные API не пускают браузер напрямую — включи «прокси движка» в ✦ ИИ. Локальный сервер должен разрешать CORS. [${e.message}]`);
      }
      if (res.ok || attempt >= 2 || !(res.status >= 500 || res.status === 429)) break;
      await new Promise(r => setTimeout(r, 700 * (attempt + 1)));
    }
    if (!res.ok) {
      let t = ''; try { t = await res.text(); } catch (_) {}
      const upstream = res.status >= 500 || res.status === 429;
      throw new Error(`Endpoint вернул ${res.status} ${res.statusText}${t ? ': ' + t.slice(0, 260) : ''}` +
        (upstream ? '\nЭто сбой на стороне провайдера, не конструктора (повторил 3 раза). Нажми «↻ повторить», выбери другую модель или попробуй позже.' : ''));
    }
    const data = await res.json();
    const content = data && data.choices && data.choices[0] && (data.choices[0].message || {}).content;
    if (content == null) throw new Error('Пустой ответ модели: ' + JSON.stringify(data).slice(0, 200));
    return content;
  }

  /* В API уходит свежий хвост истории, а тяжёлые вставки контекста — только
     последние: иначе запрос пухнет от старых деталей и провайдер начинает падать. */
  function apiMessages() {
    const hist = chatHistory.filter(x => x.role === 'user' || x.role === 'assistant' || x.role === 'ctx').slice(-24);
    const out = [];
    let ctxLeft = 3;
    for (let i = hist.length - 1; i >= 0; i--) {
      const x = hist[i];
      if (x.role === 'ctx' && ctxLeft-- <= 0) continue;
      out.unshift(x.role === 'ctx' ? { role: 'user', content: `[${x.label}]\n${x.content}` } : { role: x.role, content: x.content });
    }
    /* сводка от «сжать» — всегда первой, чтобы ИИ помнил суть свёрнутого разговора */
    const summary = chatHistory.find(x => x.role === 'summary');
    if (summary) out.unshift({ role: 'user', content: `[сводка прошлого разговора]\n${summary.content}` });
    return out;
  }

  /* Ход чата привязан к ПРОЕКТУ, в котором его начали. Пока ждём ответ, человек
     может уйти в другой проект — тогда класть сообщение в текущую историю нельзя:
     кнопка «Применить» окажется в чужом плане и карточки уедут не туда.
     Ответ дописываем прямо в хранилище того проекта, где спрашивали. */
  function pushToChat(owner, msg) {
    if (owner === projectId) { chatHistory.push(msg); return true; }
    try {
      const key = LS_CHAT + '.' + owner;
      const arr = JSON.parse(localStorage.getItem(key) || '[]') || [];
      arr.push(msg);
      localStorage.setItem(key, JSON.stringify(arr.slice(-60)));
    } catch (e) {}
    return false;
  }
  function projectNameOf(id) {
    const p = loadRegistry().find(x => x.id === id);
    return p ? p.name : 'другой проект';
  }

  async function runChatTurn() {
    if (chatBusy) return;
    const owner = projectId;                       // чей это ход
    chatBusy = true;
    const send = document.getElementById('chat-send'); if (send) send.disabled = true;
    const showTyping = (txt) => {
      if (projectId !== owner) return;             // окно уже показывает чужой чат
      const log = document.getElementById('chat-log'); if (!log) return;
      const t = document.createElement('div'); t.className = 'chat-typing'; t.textContent = txt;
      log.appendChild(t); log.scrollTop = log.scrollHeight;
    };
    let strayed = false;
    showTyping('…думает');
    try {
      for (let hop = 0; ; hop++) {
        const messages = [{ role: 'system', content: buildChatSystem() }].concat(apiMessages());
        const reply = await callAI(chatModelRef, messages);
        if (projectId !== owner) {                 // проект сменили, пока ждали ответ
          pushToChat(owner, { role: 'assistant', content: reply });
          strayed = true; break;
        }
        const req = hop < CTX_MAX_HOPS ? parseCtxRequest(reply) : null;
        if (!req) { chatHistory.push({ role: 'assistant', content: reply }); break; }
        chatHistory.push({ role: 'ctx', label: 'из плана: ' + req.label, content: req.data });
        renderChat(); saveChat(); showTyping('…читает план: ' + req.label);
      }
    } catch (e) {
      if (!pushToChat(owner, { role: 'error', content: e.message })) strayed = true;
    } finally {
      chatBusy = false;
      if (send) send.disabled = false;
      renderChat(); saveChat();
      if (strayed) toast(`Ответ относится к проекту «${projectNameOf(owner)}» — сохранён в его чате`, 'warn');
    }
  }

  async function sendChat() {
    if (chatBusy) return;
    const ta = document.getElementById('chat-text');
    const text = (ta.value || '').trim(); if (!text) return;
    ta.value = '';
    chatHistory.push({ role: 'user', content: text });
    const auto = idsInText(text);      // назвал блоки — сразу подложим их детали
    if (auto.length) chatHistory.push({ role: 'ctx', label: 'из плана: детали ' + auto.join(','), content: auto.map(nodeDetail).join('\n\n') });
    renderChat(); saveChat();
    await runChatTurn();
  }

  /* Сбой провайдера — обычное дело: снимаем хвостовую ошибку и спрашиваем заново. */
  function retryChat() {
    if (chatBusy) return;
    while (chatHistory.length && chatHistory[chatHistory.length - 1].role === 'error') chatHistory.pop();
    if (!chatHistory.some(x => x.role === 'user')) return renderChat();
    renderChat(); saveChat(); runChatTurn();
  }

  /* Очистка контекста: стираем ВЕСЬ разговор. Проект при этом не теряется —
     карта плана и типы блоков заново кладутся в системный промпт каждый ход (buildChatSystem). */
  function clearChat() {
    if (chatBusy) return;
    chatHistory = []; saveChat(); renderChat();
    toast('История чата очищена — проект ИИ по-прежнему видит', 'ok');
  }

  /* Сжать разговор в короткую сводку: контекст экономится, суть остаётся.
     Карту плана в сводку НЕ тащим — она и так в системном промпте каждый ход. */
  async function compactChat() {
    if (chatBusy) return;
    const convo = chatHistory.filter(x => x.role === 'user' || x.role === 'assistant');
    if (convo.length < 2) { toast('Сжимать пока нечего — разговора почти нет', 'info'); return; }
    const owner = projectId;             // сжимаем разговор ИМЕННО этого проекта
    let strayed = false;
    chatBusy = true;
    const send = document.getElementById('chat-send'); if (send) send.disabled = true;
    const log = document.getElementById('chat-log');
    if (log) { const t = document.createElement('div'); t.className = 'chat-typing'; t.textContent = '…сжимаю разговор'; log.appendChild(t); log.scrollTop = log.scrollHeight; }
    try {
      const brief = [
        'Сожми НАШ РАЗГОВОР в короткую сводку для продолжения работы — максимум 8 пунктов:',
        '— что пользователь хочет от плана;',
        '— какие решения уже приняты;',
        '— открытые вопросы и что делать дальше.',
        'Верни только саму сводку, без вступления и прозы вокруг, без JSON.',
        'Карту и содержимое плана пересказывать НЕ надо — они и так видны.'
      ].join('\n');
      const messages = [{ role: 'system', content: buildChatSystem() }]
        .concat(apiMessages())
        .concat([{ role: 'user', content: brief }]);
      const summary = (await callAI(chatModelRef, messages) || '').trim();
      if (!summary) throw new Error('модель вернула пустую сводку');
      if (owner !== projectId) {          // ушли в другой проект — сводка принадлежит прежнему
        try { localStorage.setItem(LS_CHAT + '.' + owner, JSON.stringify([{ role: 'summary', content: summary }])); } catch (e) {}
        strayed = true;
      } else {
        chatHistory = [{ role: 'summary', content: summary }];
        toast('Разговор сжат в сводку', 'ok');
      }
    } catch (e) {
      if (!pushToChat(owner, { role: 'error', content: 'Сжать не удалось: ' + e.message })) strayed = true;
    } finally {
      chatBusy = false;
      if (send) send.disabled = false;
      renderChat(); saveChat();
      if (strayed) toast(`Сводка относится к проекту «${projectNameOf(owner)}» — сохранена в его чате`, 'warn');
    }
  }

  function fieldsInto(n, p) {
    if (p.name != null) n.name = String(p.name);
    if (p.notes != null) n.notes = String(p.notes);
    if (p.enabled != null) n.enabled = !!p.enabled;
    if (p.params && typeof p.params === 'object') n.params = Object.assign({}, n.params, p.params);
  }
  function defaultPort(node, dir, kind) {
    const list = window.BLOCKS.portsOf(node, dir) || [];
    return (kind && list.find(p => p.kind === kind)) || list.find(p => p.kind === 'flow') || list[0] || null;
  }
  function parseEndpoint(v) {
    if (!v) return null;
    if (typeof v === 'string') { const i = v.indexOf(':'); return i < 0 ? { node: v } : { node: v.slice(0, i), port: v.slice(i + 1) }; }
    if (typeof v === 'object') return { node: v.node || v.id, port: v.port };
    return null;
  }

  function applyOpsFromChat(ops, opts) {
    const silent = !!(opts && opts.silent);   // мост из приложений применяет без диалога
    const { create, update, unknown } = splitOps(ops, silent);
    if (!create.length && !update.length && !ops.edges.length && !ops.del.length && !ops.layout) {
      if (silent) return;
      // молча отказать мало: скажем и человеку, и модели, каких именно блоков нет
      if (unknown.length) {
        chatHistory.push({ role: 'ctx', warn: true, label: `не нашёл блоки: ${unknown.slice(0, 6).join(', ')}`,
          content: `В плане нет блоков с такими id: ${unknown.join(', ')}.\n` +
            'Id бери из карты плана — он стоит первым в каждой строке. Временные имена из твоего «add» живут только внутри одного ответа. Если это НОВЫЕ блоки — добавь им "type".' });
        renderChat(); saveChat();
      }
      return toast('В ответе нет понятных правок' + (unknown.length ? ` · не найдено ${unknown.length}` : ''), 'warn');
    }
    if (!silent && !confirm(`Применить к плану?\n${opsSummary(ops)}`)) return;

    const alias = {}, warn = [], bare = [], madeIds = [];
    /* новые блоки: id придумывает конструктор, поэтому держим карту «имя от ИИ → реальный id» */
    let k = 0;
    create.forEach(c => {
      if (!window.BLOCKS.TYPES[c.type]) { warn.push(`тип «${c.type}» не существует`); return; }
      const n = window.Graph.addNode(c.type, 140 + (k % 5) * 260, 140 + Math.floor(k / 5) * 170, c.params || {});
      k++; fieldsInto(n, c); madeIds.push(n.id);
      if (c.id) alias[c.id] = n.id;
      // параметров не прислали — в карточке остались заводские примеры из проекта анализа кода
      if (!c.params || !Object.keys(c.params).length) bare.push(`${n.name} (${c.type})`);
    });
    if (bare.length) warn.push(`заводские параметры остались нетронутыми: ${bare.join(', ')} — задай params под задачу (схему типа спроси через «@блок: <type>»)`);
    update.forEach(p => fieldsInto(nodeById(p.id), p));
    unknown.forEach(id => warn.push(`блок «${id}» не найден (для нового нужен "type")`));

    const rid = id => alias[id] || resolveNodeId(id, silent);
    let nEdges = 0;
    ops.edges.forEach(e => {
      const a = parseEndpoint(Array.isArray(e) ? e[0] : e && e.from);
      const b = parseEndpoint(Array.isArray(e) ? e[1] : e && e.to);
      if (!a || !b) return void warn.push('связь без концов');
      const an = rid(a.node), bn = rid(b.node);
      if (!an || !bn) return void warn.push(`связь ${a.node}→${b.node}: блок не найден`);
      const fromNode = nodeById(an), toNode = nodeById(bn);
      let ap = a.port && window.BLOCKS.findPort(fromNode, 'out', a.port) ? a.port : (defaultPort(fromNode, 'out') || {}).id;
      const kind = ap ? (window.BLOCKS.findPort(fromNode, 'out', ap) || {}).kind : 'flow';
      let bp = b.port && window.BLOCKS.findPort(toNode, 'in', b.port) ? b.port : (defaultPort(toNode, 'in', kind) || {}).id;
      if (!ap || !bp) return void warn.push(`связь ${an}→${bn}: нет подходящих портов`);
      const r = window.Graph.addEdge({ node: an, port: ap }, { node: bn, port: bp });
      if (r.error) warn.push(`связь ${an}→${bn}: ${r.error}`); else nEdges++;
    });

    let nDel = 0;
    ops.del.forEach(id => { const r = rid(id); if (r) { window.Graph.removeNode(r); nDel++; } });

    /* Созданный блок без единой связи выпадает из плана: раскладка сваливает такие
       в левый край стопкой. Почти всегда это забытые edges — говорим прямо. */
    const lonely = madeIds.filter(id => nodeById(id) &&
      !window.Graph.state.edges.some(e => e.from.node === id || e.to.node === id))
      .map(id => `«${nodeById(id).name}» (${id})`);
    if (lonely.length) warn.push(`созданы без связей: ${lonely.join(', ')} — пришли edges от существующих блоков к ним (id существующих бери из карты плана)`);

    const meta = window.Graph.state.meta = window.Graph.state.meta || {};
    meta.rev = (Number(meta.rev) || 0) + 1;
    window.Graph.pruneEdges();
    if (create.length || ops.layout) window.Editor.autoLayout();   // новым блокам нужны координаты
    commit(); refresh(); window.Editor.render();
    if (create.length || ops.layout) window.Editor.fit();
    const done = [];
    if (k) done.push(`создано ${k}`);
    if (update.length) done.push(`изменено ${update.length}`);
    if (nEdges) done.push(`связей ${nEdges}`);
    if (nDel) done.push(`удалено ${nDel}`);
    if (ops.layout) done.push('схема разложена');
    toast(`План обновлён: ${done.join(', ') || '—'} · rev ${meta.rev}` + (warn.length ? ` · пропущено ${warn.length}` : ''), warn.length ? 'warn' : 'ok');
    let told = false;
    /* Сообщаем модели настоящие id созданных блоков и запоминаем соответствие:
       иначе следующая правка придёт по её временным именам и не найдёт ничего. */
    if (!silent && Object.keys(alias).length) {
      const store = loadAliases(); Object.assign(store, alias); saveAliases(store);
      chatHistory.push({ role: 'ctx', label: `созданы блоки: ${Object.keys(alias).length}`,
        content: 'Настоящие id созданных блоков — дальше в patch/edges/del используй ИХ:\n' +
          Object.keys(alias).map(t => `${t} → ${alias[t]}`).join('\n') });
      told = true;
    }
    // отчёт о пропусках уходит и человеку (жёлтая строка), и модели — следующим сообщением исправится
    if (!silent && warn.length) {
      chatHistory.push({ role: 'ctx', warn: true, label: `не применилось: ${warn.length} — можно исправить и прислать снова`,
                         content: 'При применении пропущено:\n· ' + warn.slice(0, 10).join('\n· ') });
      told = true;
    }
    if (told) { renderChat(); saveChat(); }
  }

  function applyPlanFromChat(obj) {
    if (!confirm('Применить план из чата? Текущий холст будет заменён (сделай экспорт, если нужен).')) return;
    try {
      window.Graph.fromJSON(obj);
      if (window.Harness) window.Harness.resetManual();
      document.getElementById('pipeline-name').value = window.Graph.state.name;
      window.Editor.clearSelection(); commit(); refresh(); window.Editor.fit();
      toast('План из чата применён', 'ok');
    } catch (e) { toast('Не удалось применить план: ' + e.message, 'err'); }
  }

  /* ── старт ──────────────────────────────────────────── */
  async function init() {
    window.Editor.init({ onChange: onGraphChange, onSelect: onSelectIds });
    window.Inspector.init({ onChange: (reason, live) => {
      if (live) {
        // живой ввод: обновляем вид и мягко автосейвим, но НЕ трогаем связи и НЕ пишем в историю —
        // иначе правка порт-задающего поля посимвольно роняла связи, а undo-история вымывалась
        window.Editor.render(); renderConsole(); autosave();
        return;
      }
      window.Graph.pruneEdges();          // завершённая правка: порт мог исчезнуть (select/bool, blur)
      commit(); window.Editor.render(); renderConsole();
    } });

    await hydrateFromDisk();              // подтянуть/восстановить планы с диска ДО выбора текущего проекта

    /* На холсте — автосохранение из localStorage; файл pipeline.js его не
       перетирает, иначе ручные правки пропадали бы при каждой перезагрузке.
       Поэтому сравниваем meta.rev и говорим, что план на диске новее. */
    /* Проекты: реестр в localStorage. Первый запуск — миграция старого
       одиночного плана (tester.pipeline) в проект №1, чтобы не потерять работу. */
    let registry = loadRegistry();
    if (!registry.length) {
      let data = null;
      try { const saved = localStorage.getItem(LS_KEY); if (saved) data = JSON.parse(saved); } catch (e) {}
      if (!data) data = JSON.parse(JSON.stringify(window.PIPELINE));
      const id = newId();
      try { localStorage.setItem(LS_PROJECT + id, JSON.stringify(data)); } catch (e) {}
      projectId = id;
      touchRegistry(id, data.name || 'Проект');
      localStorage.setItem(LS_CURRENT, id);
      registry = loadRegistry();
    }
    const curId = localStorage.getItem(LS_CURRENT);
    projectId = registry.find(p => p.id === curId) ? curId
              : registry.slice().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))[0].id;
    try { window.Graph.fromJSON(JSON.parse(localStorage.getItem(LS_PROJECT + projectId))); }
    catch (e) { window.Graph.fromJSON(window.PIPELINE); }
    document.getElementById('pipeline-name').value = window.Graph.state.name;

    renderPalette('');
    commit();
    refresh();
    window.Editor.fit();
    renderProjectSelect();
    document.addEventListener('click', e => {
      const dd = document.getElementById('projdrop'), l = document.getElementById('projdrop-list');
      if (l && !l.hidden && dd && !dd.contains(e.target)) l.hidden = true;
    });

    /* палитра */
    const $pal = document.getElementById('palette-list');
    $pal.addEventListener('click', e => {
      const it = e.target.closest('.pal-item'); if (!it) return;
      const r = document.getElementById('stage').getBoundingClientRect();
      const g = { x: (r.width / 2 - 100) / 1, y: (r.height / 2 - 60) };
      const n = window.Graph.addNode(it.dataset.type, Math.round(g.x), Math.round(g.y));
      onGraphChange(); window.Editor.select(n.id); window.Editor.centerOn(n.id);
      closePalette();                     // на узком экране палитра — модальная, уводим к новому узлу
    });
    $pal.addEventListener('dragstart', e => {
      const it = e.target.closest('.pal-item'); if (!it) return;
      e.dataTransfer.setData('text/block', it.dataset.type);
      e.dataTransfer.effectAllowed = 'copy';
    });
    document.getElementById('palette-search').addEventListener('input', e => renderPalette(e.target.value));
    const loadPreset = src => {
      createProject(JSON.parse(JSON.stringify(src)), src.name);
      toast('Загружено как новый проект: ' + window.Graph.state.name, 'ok');
    };
    document.querySelector('[data-act="load-pipeline"]').addEventListener('click', () => loadPreset(window.PIPELINE));
    document.querySelector('[data-act="demo"]').addEventListener('click', () => loadPreset(window.EXAMPLE));

    /* тулбар */
    document.querySelector('.toolbar').addEventListener('click', e => {
      const b = e.target.closest('[data-act]'); if (!b) return;
      const act = b.dataset.act;
      if (act === 'new') { createProject(null); toast('Новый проект создан', 'ok'); }
      if (act === 'import') document.getElementById('file-input').click();
      if (act === 'export') exportJSON();
      if (act === 'undo') undo();
      if (act === 'redo') redo();
      if (act === 'view-graph' || act === 'view-harness') return setView(act === 'view-harness' ? 'harness' : 'graph');
      if (act === 'layout') {
        if (window.Editor.getViewMode() === 'harness') return toast('Жгут раскладывается сам — переключись на холст', 'warn');
        window.Editor.autoLayout(); onGraphChange(); window.Editor.fit(); toast('Схема разложена по слоям', 'ok');
      }
      if (act === 'fit') window.Editor.fit();
      if (act === 'grid') { window.Editor.setSnap(!window.Editor.getSnap()); b.classList.toggle('on', window.Editor.getSnap()); }
      if (act === 'collide') { window.Editor.setCollide(!window.Editor.getCollide()); b.classList.toggle('on', window.Editor.getCollide()); window.Editor.render(); }
      if (act === 'check') { switchTab('check'); renderConsole(); }
      if (act === 'run') play();
      if (act === 'guide') openGuide();
    });
    document.querySelector('[data-act="grid"]').classList.toggle('on', window.Editor.getSnap());
    document.querySelector('[data-act="collide"]').classList.toggle('on', window.Editor.getCollide());

    document.getElementById('file-input').addEventListener('change', e => {
      if (e.target.files[0]) importJSON(e.target.files[0]);
      e.target.value = '';
    });

    document.getElementById('pipeline-name').addEventListener('input', e => {
      window.Graph.state.name = e.target.value;
      const nm = document.getElementById('projdrop-name');
      if (nm) nm.textContent = e.target.value || 'Без имени';
      autosave();
    });

    /* холст-хад */
    document.querySelector('.stage-hud').addEventListener('click', e => {
      const b = e.target.closest('[data-act]'); if (!b) return;
      const r = document.getElementById('stage').getBoundingClientRect();
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      if (b.dataset.act === 'zoom-in') window.Editor.zoomAt(cx, cy, 1.2);
      if (b.dataset.act === 'zoom-out') window.Editor.zoomAt(cx, cy, 1 / 1.2);
      if (b.dataset.act === 'zoom-reset') window.Editor.fit();
    });

    /* консоль */
    document.querySelector('.console-tabs').addEventListener('click', e => {
      const t = e.target.closest('.ctab');
      if (t) return switchTab(t.dataset.tab);
      if (e.target.closest('#console-toggle')) {
        const app = document.getElementById('app');
        const collapsed = app.classList.toggle('console-collapsed');
        document.getElementById('console-toggle').textContent = collapsed ? '▴' : '▾';
        /* инлайновая высота перебивает класс сворачивания — снимаем/возвращаем */
        if (collapsed) app.style.removeProperty('--console-h');
        else { const s = loadLayout(); if (s.consoleH) app.style.setProperty('--console-h', s.consoleH + 'px'); }
      }
    });
    document.querySelector('.console-body').addEventListener('click', e => {
      const row = e.target.closest('[data-node]'); if (!row) return;
      window.Editor.select(row.dataset.node); window.Editor.centerOn(row.dataset.node);
    });

    /* чат с ИИ */
    chatHistory = loadChat(); renderChatModel(); renderChat();
    document.getElementById('chat-form').addEventListener('submit', e => { e.preventDefault(); sendChat(); });
    document.getElementById('chat-text').addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat(); }
    });
    document.getElementById('chat-model').addEventListener('change', e => { chatModelRef = e.target.value; });

    /* выбор модели из загруженного списка → в поле «Модель» */
    document.getElementById('guide-models').addEventListener('change', e => {
      const sel = e.target.closest('.gmodels-list'); if (!sel) return;
      const inp = document.querySelector(`#guide-models input[data-ref="${sel.dataset.ref}"][data-key="model"]`);
      if (inp && sel.value) inp.value = sel.value;
    });

    setupConsoleResize();
    setupChatDock();
    applyPalMin(loadLayout().palMin);
    applyInspMin(loadLayout().inspMin);
    applyBridgeState();   // возобновить сопряжение с приложениями, если было включено
    adoptGlobalIfEmpty();       // дефолт подключения ещё не заведён — возьмём с текущего проекта

    /* выезжающие панели: открывашки в топбаре, крестики, тап по затемнению */
    document.getElementById('app').addEventListener('click', e => {
      const b = e.target.closest('[data-act]'); if (!b) return;
      const a = b.dataset.act;
      if (a === 'toggle-palette') togglePalette();
      else if (a === 'palette-min') togglePalMin();
      else if (a === 'inspector-min') toggleInspMin();
      else if (a === 'mcp-app') { mcpApp = b.dataset.app; updateMcpView(); }
      else if (a === 'mcp-copy') copyText(mcpConfigText(), 'Конфиг MCP скопирован — вставь в конфиг приложения');
      else if (a === 'mcp-dl-cfg') downloadTextFile('mcp.json', mcpConfigText());
      else if (a === 'mcp-view') viewMcpServer();
      else if (a === 'mcp-dl-server') downloadMcpServer();
      else if (a === 'toggle-inspector') toggleInspector();
      else if (a === 'close-inspector') closeInspector();
      else if (a === 'close-drawers') closePalette();
      else if (a === 'close-guide') closeGuide();
      else if (a === 'guide-save-models') saveGuideModels();
      else if (a === 'guide-apply-all') applyModelsToAllProjects();
      else if (a === 'guide-copy-brief') copyBrief();
      else if (a === 'toggle-secret') {
        const inp = b.closest('.gsecret').querySelector('input');
        const show = inp.type === 'password';
        inp.type = show ? 'text' : 'password';
        b.textContent = show ? 'скрыть' : 'показать';
      }
      else if (a === 'chat-clear') clearChat();
      else if (a === 'chat-compact') compactChat();
      else if (a === 'chat-retry') retryChat();
      else if (a === 'chat-apply') { const m = chatHistory[+b.dataset.i]; const p = m && extractPlan(m.content); if (p) applyPlanFromChat(p); }
      else if (a === 'chat-patch') { const m = chatHistory[+b.dataset.i]; const o = m && extractOps(m.content); if (o) applyOpsFromChat(o); }
      else if (a === 'load-models') loadModels(b.dataset.ref);
      else if (a === 'project-dup') duplicateProject();
      else if (a === 'project-del') deleteProject();
      else if (a === 'proj-toggle') toggleProjList();
      else if (a === 'proj-pick') { switchProject(b.dataset.id); toggleProjList(false); }
      else if (a === 'proj-rename') startRename(b.dataset.id);
      else if (a === 'chat-open') openChat(true);
      else if (a === 'chat-close') openChat(false);
      else if (a === 'chat-min') toggleChatMin();
    });
    /* вернулись на широкий экран — сбрасываем выехавшие шторки */
    mqNarrow.addEventListener('change', e => { if (!e.matches) resetDrawers(); });

    /* клавиатура */
    window.addEventListener('keydown', e => {
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);
      const ctrl = e.ctrlKey || e.metaKey;
      if (ctrl && e.key.toLowerCase() === 's') { e.preventDefault(); return exportJSON(); }
      if (ctrl && e.key.toLowerCase() === 'z') { e.preventDefault(); return e.shiftKey ? redo() : undo(); }
      if (ctrl && e.key.toLowerCase() === 'y') { e.preventDefault(); return redo(); }
      if (typing) return;
      if (ctrl && e.key.toLowerCase() === 'd') { e.preventDefault(); return window.Editor.duplicateSelection(); }
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); return window.Editor.deleteSelection(); }
      if (e.key === 'f' || e.key === 'F' || e.key === 'а' || e.key === 'А') return window.Editor.fit();
      if (e.key === 'l' || e.key === 'L' || e.key === 'д' || e.key === 'Д') {
        if (window.Editor.getViewMode() === 'harness') return toast('Жгут раскладывается сам — переключись на холст', 'warn');
        window.Editor.autoLayout(); onGraphChange(); window.Editor.fit(); return toast('Схема разложена по слоям', 'ok');
      }
      if (e.key === 'h' || e.key === 'H' || e.key === 'р' || e.key === 'Р') {
        return setView(window.Editor.getViewMode() === 'harness' ? 'graph' : 'harness');
      }
      if (e.key === 'Escape') { closeGuide(); window.Editor.clearSelection(); stopPlay(); }
    });

    window.addEventListener('beforeunload', saveNow);
  }

  return { init, toast, commit, refresh, exportJSON };
})();

/* скрипты грузятся динамически, DOMContentLoaded мог уже пройти */
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', window.App.init);
else window.App.init();
