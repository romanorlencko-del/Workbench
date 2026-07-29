/* build.js — состояние СТРОЙКИ: что из плана уже построено в реальном коде.

   Живёт ОТДЕЛЬНО от плана, и это намеренно: план — переносимый замысел (его
   экспортируют, дублируют, правит ИИ через мост), а стройка привязана к
   конкретному чекауту репозитория. Смешаешь — потом не отдать план чисто и не
   восстановить стройку.

   Хранение зеркалит планы: localStorage tester.build.<id> — живое хранилище,
   projects/<id>.build.json — копия на диске и подхват при загрузке (кто свежее,
   тот и прав). В сам план не попадает ни байта: правки стройки не идут ни в
   историю Ctrl+Z, ни в экспорт, ни в бриф для ИИ. */

window.Build = (function () {

  const LS = 'tester.build.';          // + id проекта → JSON состояния стройки
  const V = 1;                         // версия формата файла
  const DISK_ON = location.protocol === 'http:' || location.protocol === 'https:';
  const SAVE_MS = 300;
  const FRESH_MS = 2000;               // допуск при сравнении с диском, как у планов

  /* Хранимые состояния. «Протух» сюда не входит: он НЕ хранится, а считается из
     расхождения спеки узла со слепком на момент отметки — см. блок про дрейф. */
  const STATUSES = [
    ['todo',   'не начат'],
    ['wip',    'в работе'],
    ['done',   'готов'],
    ['failed', 'провален'],
  ];
  /* Запись узла. target/checks/owner — «где это в коде и чем доказать, что готово»;
     журнал короткий и обрезается: он для следа работы, не для аудита.
     spec_rev/deps/spec_at — слепок плана, по которому узел строили. */
  /* checks_ok — результат последнего прогона проверок: true / false / null,
     если не гоняли. Без него «готово» остаётся утверждением исполнителя, а не
     фактом: команда записана, но никто не знает, зелёная ли она. */
  const DEFAULT = { status: 'todo', target: [], checks: '', checks_ok: null, checks_at: 0, checks_out: '',
                    owner: '', log: [], updatedAt: 0,
                    spec_rev: '', deps: {}, spec_at: 0 };
  const LOG_MAX = 20;

  let pid = null, state = blank(null), timer = null, notify = () => {};

  function blank(id) { return { v: V, projectId: id, updatedAt: 0, root: '', nodes: {} }; }

  /* Из чего угодно — в честную форму: чужой/старый/битый файл не должен ронять UI. */
  function normalize(raw, id) {
    if (!raw || typeof raw !== 'object' || !raw.nodes || typeof raw.nodes !== 'object' || Array.isArray(raw.nodes)) return blank(id);
    const nodes = {};
    Object.keys(raw.nodes).forEach(k => {
      const r = raw.nodes[k];
      if (!r || typeof r !== 'object') return;
      nodes[k] = Object.assign({}, DEFAULT, r, {
        status: statusOk(r.status) ? r.status : DEFAULT.status,
        target: (Array.isArray(r.target) ? r.target : []).map(String).filter(Boolean),
        checks: String(r.checks || ''),
        checks_ok: r.checks_ok === true ? true : r.checks_ok === false ? false : null,
        checks_at: Number(r.checks_at) || 0,
        checks_out: String(r.checks_out || '').slice(0, 2000),   // хвост вывода, не весь лог
        owner: String(r.owner || ''),
        log: (Array.isArray(r.log) ? r.log : []).filter(e => e && e.text).slice(0, LOG_MAX)
             .map(e => ({ ts: +e.ts || 0, text: String(e.text) })),
        spec_rev: String(r.spec_rev || ''),
        spec_at: +r.spec_at || 0,
        deps: (r.deps && typeof r.deps === 'object' && !Array.isArray(r.deps)) ? Object.assign({}, r.deps) : {},
      });
    });
    return { v: V, projectId: id, updatedAt: +raw.updatedAt || 0, root: String(raw.root || ''), nodes };
  }

  const statusOk = s => STATUSES.some(([v]) => v === s);
  const label = s => (STATUSES.find(([v]) => v === s) || [, s])[1];

  function readLS(id) {
    try { return normalize(JSON.parse(localStorage.getItem(LS + id) || 'null'), id); }
    catch (e) { return blank(id); }
  }
  function writeLS(id, st) {
    try { localStorage.setItem(LS + id, JSON.stringify(st)); } catch (e) {}
  }

  /* Зеркало на диск через движок (serve.py, /api/build). Открыто по file:// или
     движок выключен — молча пропускаем, как и планы. */
  const diskMtime = {};              // id → mtime последней виденной версии на диске
  function diskPut(id, st) {
    if (!DISK_ON || !id) return;
    try {
      fetch('api/build/' + encodeURIComponent(id),
            { method: 'PUT',
              headers: { 'Content-Type': 'application/json', 'X-Prev-Mtime': String(diskMtime[id] || 0) },
              body: JSON.stringify(st) })
        .then(r => {
          if (r.status === 409) return r.json().then(d => reconcileDisk(id, d)).catch(() => {});
          if (r.ok) return r.json().then(d => { if (d && d.mtime) diskMtime[id] = d.mtime; }).catch(() => {});
        })
        .catch(() => {});
    } catch (e) {}
  }
  /* Движок отбил запись: стройку успела подвинуть другая вкладка (или отчёт из
     приложения через мост). Свежее побеждает — принимаем диск, иначе чужой
     закрытый узел потеряется. */
  function reconcileDisk(id, d) {
    if (!d || !d.data) return;
    if (d.mtime) diskMtime[id] = d.mtime;
    const disk = normalize(d.data, id);
    writeLS(id, disk);
    if (id === pid) { state = disk; invalidate(); notify(); }
  }

  function flush() {
    clearTimeout(timer); timer = null;
    writeLS(pid, state); diskPut(pid, state);
  }
  function save() {
    if (!pid) return;
    clearTimeout(timer);
    timer = setTimeout(flush, SAVE_MS);
  }

  /* ── дрейф: план ушёл вперёд стройки ─────────────────────
     Ради этого всё и затевалось. Отмечая состояние, узел запоминает СЛЕПОК своей
     спеки (`spec_rev`) и слепки выходных контрактов соседей сверху (`deps`).
     План правят — слепок расходится с нынешним, и узел «протух». Само «протух»
     не хранится: хранимый флаг рано или поздно разъедется с реальностью.

     Протухание расходится вниз ровно настолько, насколько меняются ОБЪЯВЛЕННЫЕ
     контракты: переписал формулировку промпта — протух только сам узел; сменил
     переменную вывода, формат или состав веток — протухли и те, кто с него
     читает. Дальше по цепочке не идём НАМЕРЕННО: пока контракт узла тот же,
     у следующих за ним допущения в силе. Иначе любая правка красила бы весь
     хвост, а это шум, а не сигнал. */

  const CONTRACT_KEYS = ['output_var', 'format', 'fields', 'schema'];

  /* Стабильная строка из любой структуры: порядок ключей не должен решать. */
  function stable(v) {
    if (Array.isArray(v)) return '[' + v.map(stable).join(',') + ']';
    if (v && typeof v === 'object')
      return '{' + Object.keys(v).sort().map(k => k + ':' + stable(v[k])).join(',') + '}';
    return String(v);
  }
  /* FNV-1a: коротко и одинаково между перезагрузками. Ловим изменение, не подделку. */
  function hash(s) {
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return (h >>> 0).toString(36);
  }

  /* Спека узла — всё, из чего исполнитель понимает, ЧТО строить. Координаты и
     свёрнутость сюда не входят: подвинул блок — работа не протухла. Входящие
     связи входят: перецепил вход — задача другая. */
  function specOf(node, inc) {
    return hash(stable({
      type: node.type, name: node.name, notes: node.notes || '',
      enabled: node.enabled !== false, params: node.params,
      in: inc.map(e => e.to.port + '<-' + e.from.node + ':' + e.from.port).sort(),
    }));
  }

  /* Выходной контракт — то, на что опираются НИЖЕ по течению: имя переменной,
     формат, состав полей, набор и подписи выходных портов. Настройки «для себя»
     (промпт, температура, лимиты) сюда не входят. */
  function contractOf(node) {
    const p = {};
    CONTRACT_KEYS.forEach(k => { if (node.params[k] !== undefined) p[k] = node.params[k]; });
    /* у списочных блоков (группа экспертов) вывод объявляют сами строки */
    ((window.BLOCKS.TYPES[node.type] || {}).params || []).forEach(f => {
      if (f.type !== 'list') return;
      p[f.key] = (node.params[f.key] || []).map(it => it.output_var || '');
    });
    return hash(stable({
      type: node.type, p,
      out: window.BLOCKS.portsOf(node, 'out').map(q => q.id + ':' + q.kind + ':' + q.label),
    }));
  }

  const NO_DRIFT = { stale: false, self: false, deps: [], at: 0 };
  let cache = null;
  function invalidate() { cache = null; }

  /* Один проход по графу вместо пересчёта на каждый узел: холст перерисовывается
     часто, а пересчёт линеен по узлам и рёбрам. */
  function driftAll() {
    if (cache) return cache;
    cache = {};
    if (!window.Graph || !window.BLOCKS) return cache;
    const g = window.Graph.state;
    const inc = {};
    g.edges.forEach(e => { (inc[e.to.node] = inc[e.to.node] || []).push(e); });
    const contract = {};
    g.nodes.forEach(n => { contract[n.id] = contractOf(n); });

    g.nodes.forEach(n => {
      const rec = state.nodes[n.id];
      if (!rec || !rec.spec_rev) { cache[n.id] = NO_DRIFT; return; }
      const self = specOf(n, inc[n.id] || []) !== rec.spec_rev;
      const deps = [];
      /* Отвалившийся сосед отдельной веткой не нужен: связи входят в спеку,
         так что отключение уже поймано как правка самого узла. */
      (inc[n.id] || []).forEach(e => {
        const was = (rec.deps || {})[e.from.node];
        if (was !== undefined && was !== contract[e.from.node] && deps.indexOf(e.from.node) < 0)
          deps.push(e.from.node);
      });
      cache[n.id] = { stale: self || !!deps.length, self, deps, at: rec.spec_at };
    });
    return cache;
  }

  function drift(nodeId) { return driftAll()[nodeId] || NO_DRIFT; }

  /* Слепок «строили вот по этому» — снимается в момент отметки состояния. */
  function stampOf(nodeId) {
    const n = window.Graph && window.Graph.getNode(nodeId);
    if (!n) return { spec_rev: '', deps: {}, spec_at: 0 };
    const inc = window.Graph.state.edges.filter(e => e.to.node === nodeId);
    const deps = {};
    inc.forEach(e => {
      const u = window.Graph.getNode(e.from.node);
      if (u) deps[u.id] = contractOf(u);
    });
    return { spec_rev: specOf(n, inc), deps, spec_at: Date.now() };
  }

  /* ── публичное ───────────────────────────────────────── */

  /* Открыть стройку проекта. Вызывается при загрузке и при каждом переключении.
     Уходя, дописываем только незавершённое (таймер ещё тикает) — иначе заход в
     проект заводил бы ему пустой файл стройки на ровном месте. */
  function adopt(id) {
    if (pid && pid !== id && timer) flush();
    pid = id || null;
    state = pid ? readLS(pid) : blank(null);
    invalidate();
    return state;
  }

  function get(nodeId) { return Object.assign({}, DEFAULT, state.nodes[nodeId] || {}); }

  /* Правка записи узла — новыми объектами, без мутации прежнего состояния.
     Смена состояния сама пишется в журнал: след работы не должен зависеть от
     того, вспомнил ли человек (или агент) оставить запись руками. */
  function set(nodeId, patch) {
    if (!pid || !nodeId) return null;
    const prev = get(nodeId), now = Date.now();
    /* Поменяли саму команду проверки — прошлый результат больше ни о чём не
       говорит: он про другую команду. Сбрасываем, если в этой же правке не
       пришёл новый результат. */
    if (patch.checks !== undefined && patch.checks !== prev.checks && patch.checks_ok === undefined)
      patch = Object.assign({}, patch, { checks_ok: null, checks_at: 0, checks_out: '' });
    const rec = Object.assign({}, prev, patch, { updatedAt: now });
    /* В журнал — только настоящую смену: повтор того же состояния journal засоряет.
       Свой текст записи (задание, отчёт) отменяет автоматический: две строки об
       одном событии — это уже не след работы, а шум. */
    if (patch.status && patch.status !== prev.status && !patch.log)
      rec.log = [{ ts: now, text: 'состояние → ' + label(patch.status) }].concat(prev.log).slice(0, LOG_MAX);
    /* А слепок снимаем на ЛЮБУЮ отметку состояния, даже повторную: отметил —
       значит смотрел на план именно сейчас. Правки путей, проверок и исполнителя
       его НЕ трогают: они не про то, ЧТО строить, и протухший узел от них свежим
       не становится. Явно присланная печать (отчёт извне) сильнее: строили по
       ней, а не по тому, что в плане сейчас. */
    if (patch.status && !patch.spec_rev)
      Object.assign(rec, patch.status === 'todo' ? { spec_rev: '', deps: {}, spec_at: 0 } : stampOf(nodeId));
    state = Object.assign({}, state, {
      updatedAt: now,
      nodes: Object.assign({}, state.nodes, { [nodeId]: rec }),
    });
    save(); invalidate(); notify();
    return rec;
  }

  /* Ручная запись в журнал узла. */
  function note(nodeId, text) {
    const t = String(text == null ? '' : text).trim();
    if (!t) return null;
    return set(nodeId, { log: [{ ts: Date.now(), text: t }].concat(get(nodeId).log).slice(0, LOG_MAX) });
  }

  /* «Принял правки»: код перечитали, нынешнему плану он соответствует —
     переснимаем слепок, состояние не трогаем. Отдельная кнопка нужна, чтобы
     согласие было явным действием, а не побочным эффектом клика по статусу. */
  function accept(nodeId) {
    const cur = get(nodeId);
    if (!cur.spec_rev) return null;
    return set(nodeId, Object.assign(stampOf(nodeId), {
      log: [{ ts: Date.now(), text: 'принял правки плана' }].concat(cur.log).slice(0, LOG_MAX),
    }));
  }

  /* ── задание наружу и отчёт обратно ──────────────────────
     Конструктор ведёт стройку, но кода не пишет: работу забирает приложение
     (Cursor/Claude/Antigravity) и возвращает отчёт. Здесь только две отметки —
     сама выдача задания и приём отчёта; текст задания собирает app.js. */

  /* Выдал задание — работу отдали наружу. Снимаем слепок ИМЕННО СЕЙЧАС: исполнитель
     строит по плану на этот момент, и если план потом поправят, узел протухнет
     ещё до отчёта. Не начатый переводим в работу, начатому состояние не трогаем. */
  function issue(nodeId) {
    const cur = get(nodeId);
    return set(nodeId, {
      status: cur.status === 'todo' ? 'wip' : cur.status,
      log: [{ ts: Date.now(), text: 'выдал задание' + (cur.status === 'todo' ? '' : ' заново') }]
             .concat(cur.log).slice(0, LOG_MAX),
    });
  }

  /* Отчёт исполнителя. Пути дописываем, а не заменяем: человек мог задать их
     раньше и точнее. Печать плана из отчёта уважаем — строили по НЕЙ: не совпала
     с нынешней, значит узел обязан протухнуть, а не притвориться готовым. */
  function report(nodeId, r) {
    if (!pid || !nodeId || !r) return null;
    const cur = get(nodeId), now = Date.now();
    const patch = {};
    if (statusOk(r.status)) patch.status = r.status;
    const files = (Array.isArray(r.files) ? r.files : []).map(s => String(s).trim()).filter(Boolean);
    const add = files.filter(f => cur.target.indexOf(f) < 0);
    if (add.length) patch.target = cur.target.concat(add);
    if (r.checks) patch.checks = String(r.checks);
    /* Результат прогона — отдельно от статуса: исполнитель волен сказать
       «готово», но зелёными проверки от этого не станут. Пишем только когда о
       нём сообщили, иначе молчание затирало бы прошлый честный прогон. */
    if (r.checks_ok !== undefined) {
      patch.checks_ok = r.checks_ok === true ? true : r.checks_ok === false ? false : null;
      patch.checks_at = now;
      patch.checks_out = String(r.checks_out === undefined ? '' : r.checks_out).slice(0, 2000);
    }
    if (r.owner) patch.owner = String(r.owner);
    const who = String(r.owner || cur.owner || '').trim();
    const verdict = patch.checks_ok === true ? ' · проверки зелёные'
                  : patch.checks_ok === false ? ' · ПРОВЕРКИ КРАСНЫЕ' : '';
    const what = (String(r.note || '').trim() || 'отчёт: ' + label(patch.status || cur.status)) + verdict;
    const old = patch.status && patch.status !== 'todo' && r.spec_rev && String(r.spec_rev) !== stampOf(nodeId).spec_rev;
    /* Про чужую редакцию говорим В ЖУРНАЛЕ: баннер дрейфа умеет отличать правку
       блока от правки входа, а «строили по другому заданию» — третья причина,
       и выдавать её за первую было бы враньём. */
    patch.log = [{ ts: now, text: (who ? who + ' · ' : '') + what + (old ? ' [строил по другой редакции плана]' : '') }]
                  .concat(cur.log).slice(0, LOG_MAX);
    if (old) Object.assign(patch, { spec_rev: String(r.spec_rev), deps: {}, spec_at: now });
    return set(nodeId, patch);
  }

  function clear(nodeId) {
    if (!pid || !state.nodes[nodeId]) return;
    const nodes = Object.assign({}, state.nodes);
    delete nodes[nodeId];
    state = Object.assign({}, state, { updatedAt: Date.now(), nodes });
    save(); invalidate(); notify();
  }

  /* Подхват с диска (зовётся из hydrateFromDisk до выбора проекта, для любого id):
     в браузере пусто — восстановить; на диске заметно свежее — принять. */
  function hydrate(id, raw, mtimeMs) {
    if (!id) return false;
    // mtime запоминаем ДО решения принимать или нет: мы его на диске видели,
    // и именно он поедет в X-Prev-Mtime при следующей записи
    if (mtimeMs) diskMtime[id] = mtimeMs / 1000;   // движок считает в секундах
    const disk = normalize(raw, id);
    if (!Object.keys(disk.nodes).length && !disk.root) return false;
    const local = localStorage.getItem(LS + id) ? readLS(id) : null;
    if (local && !((mtimeMs || 0) > (local.updatedAt || 0) + FRESH_MS)) return false;
    writeLS(id, disk);
    if (id === pid) { state = disk; invalidate(); }
    return true;
  }

  /* Проект удалили — стройка уходит с ним (файл на диске сносит движок).
     Забываем и в памяти: иначе переход на следующий проект сбросит остатки
     удалённого обратно на диск и стройка воскреснет. */
  function drop(id) {
    if (id === pid) { clearTimeout(timer); pid = null; state = blank(null); invalidate(); }
    try { localStorage.removeItem(LS + id); } catch (e) {}
  }

  /* Сводка для счётчика. Узлы, которых уже нет в плане, не считаем.
     `ready` — готовые И не протухшие: узел, построенный по старой спеке, работой
     не закрыт, и число обязано это показывать, даже если руками отмечено «готов». */
  function counts(nodeIds) {
    const ids = nodeIds || Object.keys(state.nodes);
    const d = driftAll();
    const by = { todo: 0, wip: 0, done: 0, failed: 0, stale: 0, ready: 0 };
    ids.forEach(id => {
      const st = get(id).status;
      by[st]++;
      const rotten = st !== 'todo' && (d[id] || NO_DRIFT).stale;
      if (rotten) by.stale++;
      if (st === 'done' && !rotten) by.ready++;
    });
    return Object.assign(by, { total: ids.length });
  }

  /* Кому сообщать, что стройка изменилась (перерисовать холст, счётчик). */
  function onChange(fn) { notify = typeof fn === 'function' ? fn : () => {}; }

  return {
    adopt, get, set, note, accept, clear, hydrate, drop, counts, label, onChange,
    drift, invalidate, issue, report,
    stamp: stampOf,          // печать плана «строим вот по этому» — уходит в задание
    STATUSES,
    get projectId() { return pid; },
    toJSON() { return JSON.parse(JSON.stringify(state)); },
  };
})();
