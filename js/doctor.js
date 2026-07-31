/* Доктор — единая точка сбора того, что ломается.
 *
 * Зачем отдельно от «Проверки»: та проверяет ЗАМЫСЕЛ (структуру графа), а
 * доктор — ИНСТРУМЕНТ И ОКРУЖЕНИЕ. Почти все реальные поломки были не в плане:
 * страница открыта файлом, движок не запущен, две вкладки дерутся за один
 * проект, папка сборок не назначена. Раньше конструктор об этом молчал —
 * ошибки гасились в catch, «чтобы не шуметь», и человек оставался без улик.
 *
 * Журнал живёт в localStorage кольцевым буфером: падение страницы не должно
 * уносить с собой то, ради чего доктор и заводился.
 */
(() => {
  const LS = 'tester.doctor';          // журнал происшествий
  const LS_TABS = 'tester.tabs';       // отметки живых вкладок — ловим гонку за диск
  const CAP = 200;                     // больше не храним: это журнал, а не архив
  const TAB_TTL = 12000;               // вкладка молчит дольше — считаем закрытой
  const TAB_ID = Math.random().toString(36).slice(2, 8);

  let ctx = () => ({});                // приложение отдаёт сюда своё состояние
  const listeners = [];

  function load() { try { return JSON.parse(localStorage.getItem(LS) || '[]') || []; } catch (e) { return []; } }
  function save(list) { try { localStorage.setItem(LS, JSON.stringify(list.slice(-CAP))); } catch (e) {} }
  function fire() { listeners.forEach(f => { try { f(); } catch (e) {} }); }

  /* kind: error | net | warn | info */
  function log(kind, where, msg, detail) {
    const list = load();
    const rec = { ts: Date.now(), kind: kind || 'error', where: String(where || '—'),
                  msg: String(msg == null ? '' : msg).slice(0, 500) };
    if (detail !== undefined && detail !== null && detail !== '') rec.detail = String(detail).slice(0, 800);
    /* Повтор подряд не размножаем: опрос моста идёт раз в 1.5 с, и упавший
       движок иначе забил бы весь буфер одной и той же строкой за минуту. */
    const last = list[list.length - 1];
    if (last && last.kind === rec.kind && last.where === rec.where && last.msg === rec.msg) {
      last.ts = rec.ts; last.n = (last.n || 1) + 1;
      save(list); fire(); return last;
    }
    list.push(rec); save(list); fire();
    return rec;
  }

  function clear() { try { localStorage.removeItem(LS); } catch (e) {} fire(); }
  function count() { return load().filter(r => r.kind === 'error' || r.kind === 'net').length; }

  /* ── отметки вкладок: та самая гонка, что съедала настройки моделей ──── */
  function beat() {
    try {
      const all = JSON.parse(localStorage.getItem(LS_TABS) || '{}') || {}, now = Date.now();
      Object.keys(all).forEach(k => { if (now - ((all[k] || {}).ts || 0) > TAB_TTL) delete all[k]; });
      all[TAB_ID] = { ts: now, project: ctx().projectId || null };
      localStorage.setItem(LS_TABS, JSON.stringify(all));
    } catch (e) {}
  }
  function otherTabs() {
    try {
      const all = JSON.parse(localStorage.getItem(LS_TABS) || '{}') || {}, now = Date.now();
      return Object.keys(all).filter(k => k !== TAB_ID && now - ((all[k] || {}).ts || 0) <= TAB_TTL)
                             .map(k => all[k]);
    } catch (e) { return []; }
  }

  /* ── проверки окружения ──────────────────────────────────────────────── */
  async function checks() {
    const c = ctx() || {}, out = [];
    const add = (level, title, hint) => out.push({ level, title, hint: hint || '' });

    if (location.protocol === 'file:') {
      add('crit', 'Страница открыта файлом (file://)',
          'Диск, мост и папка сборок так не работают, а localStorage у file:// свой — ' +
          'проекты будут другие. Открой http://localhost:8791');
      return out;                       // остальное при таком раскладе проверять нечем
    }

    let eng = null;
    try {
      const r = await fetch('api/doctor', { cache: 'no-store' });
      if (r.ok) eng = await r.json();
    } catch (e) { /* молчим: ниже это и есть диагноз */ }

    if (!eng) {
      add('crit', 'Движок не отвечает',
          'Запусти его: py serve.py. Без него нет ни сохранения на диск, ни моста, ни папки сборок');
    } else {
      const pr = eng.projects || {};
      add(pr.writable ? 'ok' : 'crit',
          pr.writable ? `Планы пишутся на диск · ${pr.count} шт.` : 'Папка планов недоступна для записи', pr.dir);
      const px = eng.proxy || {};
      add(px.alive ? 'ok' : 'warn',
          px.alive ? `Прокси движка жив · порт ${px.port}` : 'Прокси движка молчит',
          px.alive ? '' : 'Без него не работают чат с ИИ и мост');
      if ((eng.errors || []).length)
        add('warn', `Движок записал ошибок: ${eng.errors.length}`, eng.errors[eng.errors.length - 1]);
    }

    if (c.bridgeOn) {
      const br = (eng || {}).bridge || {};
      if (!eng) add('warn', 'Сопряжение включено, но движок молчит', 'Мост идёт через движок');
      else if (!br.project) add('warn', 'Мост ещё не знает проекта', 'Подожди опрос (1.5 с) или переоткрой проект');
      else if (c.projectId && br.project !== c.projectId)
        add('warn', 'Мост держит другой проект',
            `на мосту ${br.project}, а открыт ${c.projectId} — операции из приложения будут отбиты`);
      else add('ok', 'Мост на связи', br.pending ? `в очереди операций: ${br.pending}` : '');
    }

    const others = otherTabs();
    const same = others.filter(t => t.project && c.projectId && t.project === c.projectId);
    if (same.length)
      add('crit', `Этот проект открыт ещё в ${same.length} вкладке(ах)`,
          'Вкладки перебивают правки друг друга через диск — так пропадают настройки моделей. Закрой лишнюю');
    else if (others.length) add('ok', `Других вкладок: ${others.length}`, 'на других проектах — не мешают');

    if (!c.workdir)
      add('warn', 'Папка сборок не назначена',
          '✦ ИИ → «Папка сборок»: без неё исполнитель не знает, куда писать код');
    else if (eng) {
      let okDir = false;
      try { okDir = (await fetch('api/fs?path=' + encodeURIComponent(c.workdir))).ok; } catch (e) {}
      add(okDir ? 'ok' : 'crit', okDir ? 'Папка проекта на месте' : 'Папка проекта не найдена на диске', c.workdir);
    }

    (c.models || []).forEach(m => {
      if (!m.base_url) return add('warn', `Модель «${m.ref}»: не задан base_url`, 'вызовы не пойдут');
      if (!m.api_key_env) return add('warn', `Модель «${m.ref}»: не задано имя env-переменной ключа`, '');
      add(m.hasKey ? 'ok' : 'warn',
          `Модель «${m.ref}»: ${m.hasKey ? 'ключ на месте' : 'ключ не вставлен'}`,
          m.hasKey ? '' : `нет значения для ${m.api_key_env} — ✦ ИИ → поле «Ключ API»`);
    });

    return out;
  }

  /* Готовый текст — чтобы отдать его человеку или ИИ целиком, не пересказывая. */
  async function report() {
    const c = ctx() || {}, list = load();
    const when = ts => new Date(ts).toISOString().slice(11, 19);
    const marks = { ok: '·', warn: '!', crit: 'X' };
    let res;
    try { res = await checks(); } catch (e) { res = [{ level: 'crit', title: 'проверки упали: ' + e.message, hint: '' }]; }
    return [
      '# ДОКТОР · ' + new Date().toISOString().slice(0, 19).replace('T', ' '),
      `origin: ${location.origin || location.protocol} · проект: ${c.projectName || '—'} (${c.projectId || '—'})`,
      '',
      '## ОКРУЖЕНИЕ',
      ...res.map(r => `${marks[r.level] || '·'} ${r.title}${r.hint ? ' — ' + r.hint : ''}`),
      '',
      `## ЖУРНАЛ (${list.length})`,
      ...(list.length ? list.slice(-40).map(r =>
            `${when(r.ts)} [${r.kind}] ${r.where}: ${r.msg}${r.n ? ` (×${r.n})` : ''}${r.detail ? ' | ' + r.detail : ''}`)
          : ['пусто']),
    ].join('\n');
  }

  /* Необработанное ловим сразу: до доктора это уходило только в консоль браузера,
     которую никто не открывает. */
  window.addEventListener('error', e => {
    if (e && e.message) log('error', 'браузер', e.message,
      (e.filename || '').split('/').pop() + (e.lineno ? ':' + e.lineno : ''));
  });
  window.addEventListener('unhandledrejection', e => {
    const r = e && e.reason;
    log('error', 'обещание', (r && (r.message || r)) || 'отклонено без причины', r && r.stack ? String(r.stack).slice(0, 300) : '');
  });

  beat();
  setInterval(beat, 4000);

  window.Doctor = {
    log, clear, count, checks, report, entries: load, otherTabs, tabId: TAB_ID,
    context(fn) { ctx = fn || ctx; },
    onChange(fn) { if (typeof fn === 'function') listeners.push(fn); },
  };
})();
