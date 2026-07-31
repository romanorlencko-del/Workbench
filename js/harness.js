/* harness.js — второй вид холста: жгутовая раскладка (вариант 3 «шины по категориям»).
   Считает СВОЮ раскладку в памяти вида и НЕ трогает n.x/n.y свободного холста.
   Модель та же: узел → коннектор с пинами, ребро → провод, kind:'flow' сплошной,
   kind:'data' пунктир, цвет провода = цвет типа-источника. Только показ. */

window.Harness = (function () {

  const CHIP_W = 132, CHIP_MIN_H = 38, PIN_STEP = 11, PIN_PAD = 13;
  /* Сколько чипов кладём в ряд внутри ячейки «колонка × шина». Пока их немного —
     столбик, читается как порядок. Но пачка сиблингов (два десятка экспертов в
     одной колонке) в столбик растягивает ПОЛОСУ ЦЕЛИКОМ — и остальные колонки
     той же шины оказываются в поле пустоты. Такую пачку кладём решёткой. */
  const SLOT_CAP = 4, SLOT_ROWS = 4;
  const slotsFor = k => Math.min(SLOT_CAP, Math.max(1, Math.ceil(k / SLOT_ROWS)));
  const GAP_X = 18, GAP_Y = 9, COL_GAP = 48, LANE = 92;
  const X0 = 70, Y0 = 64, STUB = 16, BACK_GAP = 34;

  /* Подробная карточка — грамматика архитектурного плаката: ИМЯ · КЛАСС · ТАКТ ·
     ФАКТЫ. Такт (тайминги, повторы, режим) вынесен отдельной строкой и своим
     цветом: схема должна отвечать не только «кто с кем», но и «как часто».
     Плотный чип остаётся для обзора большой схемы — переключателем. */
  const CARD_W = 252, CARD_PAD = 10, ROW_NAME = 18, ROW_SUB = 15, ROW_FACT = 14;
  const FACT_LINES = 2, HEAD_H = 32;
  let detail = true;
  const chipW = () => detail ? CARD_W : CHIP_W;

  /* Цвет шины — по категории, независимо от цветов отдельных блоков. */
  const BUS_COLOR = { flow: '#f5a524', work: '#a78bfa', data: '#2dd4bf', io: '#4ade80' };

  let $wires = null, $chips = null;
  let collide = false;                  // коллизии в жгуте: блок при перетаскивании чипов + объезд проводов
  const pos = new Map();               // id → {x,y,w,h} в графовых координатах
  const manual = new Map();            // id → {x,y} — ручные позиции чипов (перетаскивание), поверх раскладки
  let buses = [];                      // [{id,label,color,x1,x2,y1,y2}]
  let backY = 0;
  let box = { x1: 0, y1: 0, x2: 1, y2: 1 };

  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const def = t => window.BLOCKS.TYPES[t] || { color: '#5d6a80', icon: '·', label: t };
  const ports = (n, dir) => window.BLOCKS.portsOf(n, dir);

  /* ── содержимое карточки ────────────────────────────────
     Порядок строк один на все типы: сколько бы ни было параметров, глаз ищет
     их всегда в одном месте. Пустые строки просто не рисуются. */

  /* Такт — как часто и в каком режиме работает узел. Ключи перечислены явно:
     из 146 параметров модели про режим работы говорят вот эти, остальное —
     содержание шага, ему место в фактах. */
  const TACT = [
    ['schedule',       v => 'по расписанию: ' + v],
    ['interval_s',     v => 'каждые ' + v + ' с'],
    ['interval_min',   v => 'каждые ' + v + ' мин'],
    ['trigger',        v => 'запуск: ' + v],
    ['mode',           v => v],
    ['runtime',        v => v],
    ['model_ref',      v => 'модель: ' + v],
    ['timeout_s',      v => '⏱ ' + v + ' с'],
    ['max_iterations', v => '↺ до ' + v],
    ['rate_limit',     v => '≤ ' + v + '/с'],
    ['batch',          v => 'пачка ' + v],
    ['limit',          v => 'до ' + v],
    ['cache_ttl_s',    v => 'кеш ' + v + ' с'],
    ['retry',          v => 'повторов ' + v],
    ['on_error',       v => 'при сбое: ' + v],
  ];
  const TACT_MAX = 3;

  /* Значение select'а хранится кодом (fail, git, browser) — показываем подпись
     из схемы типа, иначе на карточке проступает служебный словарь. */
  function optLabel(type, key, v) {
    const f = ((window.BLOCKS.TYPES[type] || {}).params || []).find(p => p.key === key);
    if (!f || !f.options) return v;
    const hit = f.options.find(o => (Array.isArray(o) ? o[0] : o) === v);
    return hit ? (Array.isArray(hit) ? hit[1] : hit) : v;
  }

  function tactOf(n) {
    const p = n.params || {}, out = [];
    for (const [k, fmt] of TACT) {
      if (out.length >= TACT_MAX) break;
      const v = p[k];
      if (v === undefined || v === '' || v === null) continue;
      out.push(fmt(optLabel(n.type, k, v)));
    }
    return out.join(' · ');
  }

  /* Факты — одна строка сводки типа, той же, что в плане в консоли. Длинные
     инструкции обрезаем: карточка — указатель, а не место для чтения ТЗ. */
  const FACT_CHARS = 88;
  function factsOf(n) {
    let s = '';
    try { s = window.BLOCKS.summary(n) || ''; } catch (e) {}
    s = String(s).replace(/\s+/g, ' ').trim();
    return s.length > FACT_CHARS ? s.slice(0, FACT_CHARS - 1).trimEnd() + '…' : s;
  }

  /* Сводка часто пересказывает то же, что уже стоит в такте или в имени
     («запуск вручную» под «запуск: вручную»). Повтор занимает строку и ничего
     не добавляет — убираем. */
  const bare = s => String(s).toLowerCase().replace(/[^a-zа-яё0-9]+/gi, '');
  function cardText(n) {
    const tact = tactOf(n), t = bare(tact);
    let facts = factsOf(n);
    /* Сводка нарезана теми же точками-разделителями — выкидываем куски, уже
       сказанные в такте, а не только полное совпадение целиком. */
    if (facts) facts = facts.split(' · ').filter(p => !bare(p) || !t.includes(bare(p))).join(' · ');
    if (facts && bare(n.name).includes(bare(facts))) facts = '';
    return {
      cls: def(n.type).label,
      env: envOf(n),
      tact,
      facts,
      lines: facts ? Math.min(FACT_LINES, Math.ceil(facts.length / 34)) : 0,
    };
  }

  function chipH(n) {
    const rows = Math.max(ports(n, 'in').length, ports(n, 'out').length);
    const pins = PIN_PAD * 2 + Math.max(0, rows - 1) * PIN_STEP;
    if (!detail) return Math.max(CHIP_MIN_H, pins);
    const c = cardText(n);
    return Math.max(pins, CARD_PAD * 2 + ROW_NAME + ROW_SUB +
      (c.tact ? ROW_SUB : 0) + (c.lines ? 7 + ROW_FACT * c.lines : 0));
  }

  /* Пин коннектора: группа пинов центрируется по высоте чипа. */
  function pinPos(node, dir, portId) {
    const p = pos.get(node.id);
    if (!p) return null;
    const list = ports(node, dir);
    const i = Math.max(0, list.findIndex(q => q.id === portId));
    const span = Math.max(0, list.length - 1) * PIN_STEP;
    return { x: dir === 'out' ? p.x + p.w : p.x, y: p.y + p.h / 2 - span / 2 + i * PIN_STEP };
  }

  /* ── раскладка ──────────────────────────────────────── */
  /* Колонка = глубина по потоку (как в автораскладке холста), ряд = категория.
     Внутри пары «колонка × шина» чипы кладутся слотами и переносятся на
     подряд, чтобы 24 эксперта одной колонки не растянули схему на экран. */
  function layout() {
    const G = window.Graph, B = window.BLOCKS, st = G.state;
    pos.clear(); buses = [];
    const nodes = st.nodes;
    if (!nodes.length) { box = { x1: 0, y1: 0, x2: 1, y2: 1 }; return; }

    const alive = {}; nodes.forEach(n => alive[n.id] = n);
    const flowEdges = st.edges.filter(e => e.kind === 'flow' && !G.isBackEdge(e) && alive[e.from.node] && alive[e.to.node]);
    const dataEdges = st.edges.filter(e => e.kind === 'data' && alive[e.from.node] && alive[e.to.node]);
    const preds = {}; nodes.forEach(n => preds[n.id] = []);
    flowEdges.forEach(e => preds[e.to.node].push(e.from.node));

    const hasFlow = n => ports(n, 'in').concat(ports(n, 'out')).some(p => p.kind === 'flow');

    const col = {};
    const depth = (id, guard) => {
      if (col[id] !== undefined) return col[id];
      if (guard.has(id)) return 0;
      guard.add(id);
      const c = preds[id].length ? Math.max(...preds[id].map(p => depth(p, guard) + 1)) : 0;
      guard.delete(id);
      return (col[id] = c);
    };
    nodes.filter(hasFlow).forEach(n => depth(n.id, new Set()));
    nodes.filter(n => !hasFlow(n)).forEach(n => {
      const cs = dataEdges.filter(e => e.from.node === n.id).map(e => col[e.to.node]).filter(v => v !== undefined);
      col[n.id] = cs.length ? Math.max(0, Math.min(...cs) - 1) : 0;
    });

    const cats = B.CATEGORIES;
    const rowOf = t => Math.max(0, cats.findIndex(c => c.id === (def(t).category)));

    // группировка: колонка → ряд → список узлов
    const cols = {};
    nodes.forEach(n => {
      const c = col[n.id] || 0, r = rowOf(n.type);
      const g = (cols[c] = cols[c] || {});
      (g[r] = g[r] || []).push(n);
    });
    const colKeys = Object.keys(cols).map(Number).sort((a, b) => a - b);

    // высота полосы каждой шины: самый высокий чип × максимум подрядов
    const cellH = cats.map(() => CHIP_MIN_H), subs = cats.map(() => 1);
    nodes.forEach(n => { const r = rowOf(n.type); cellH[r] = Math.max(cellH[r], chipH(n)); });
    const sl = {};                       // колонка → шина → чипов в ряд
    colKeys.forEach(c => {
      sl[c] = {};
      cats.forEach((cat, r) => {
        const list = cols[c][r]; if (!list) return;
        const s = slotsFor(list.length);
        sl[c][r] = s;
        subs[r] = Math.max(subs[r], Math.ceil(list.length / s));
      });
    });
    /* HEAD_H — место под заголовок зоны ВНУТРИ полосы: подпись, висящая снаружи,
       на большой схеме теряется между рядами. */
    const bandH = cats.map((cat, r) => cellH[r] * subs[r] + GAP_Y * (subs[r] - 1) + 22 + HEAD_H);

    const bandTop = []; let y = Y0;
    cats.forEach((cat, r) => { bandTop[r] = y; y += bandH[r] + LANE; });

    // x: колонки слева направо, порядок внутри — по среднему x родителей
    const parentsOf = n => preds[n.id].length ? preds[n.id]
      : dataEdges.filter(e => e.to.node === n.id).map(e => e.from.node);
    const bary = n => {
      const v = parentsOf(n).map(p => { const q = pos.get(p); return q ? q.x : undefined; }).filter(v => v !== undefined);
      return v.length ? v.reduce((a, b) => a + b, 0) / v.length : Infinity;
    };

    const W = chipW();
    let cx = X0, maxX = X0;
    colKeys.forEach(c => {
      let slots = 1;
      cats.forEach((cat, r) => { if (sl[c][r]) slots = Math.max(slots, sl[c][r]); });
      cats.forEach((cat, r) => {
        const list = cols[c][r]; if (!list) return;
        const s = sl[c][r] || 1;
        list.sort((a, b) => (bary(a) - bary(b)) || a.id.localeCompare(b.id));
        list.forEach((n, i) => {
          const h = chipH(n);
          const sx = cx + (i % s) * (W + GAP_X);
          const sy = bandTop[r] + 11 + HEAD_H + Math.floor(i / s) * (cellH[r] + GAP_Y) + (cellH[r] - h) / 2;
          pos.set(n.id, { x: sx, y: sy, w: W, h });
          maxX = Math.max(maxX, sx + W);
        });
      });
      cx += slots * (W + GAP_X) + COL_GAP;
    });

    const bx1 = X0 - 30, bx2 = maxX + 30;
    cats.forEach((cat, r) => buses.push({
      id: cat.id, label: cat.label, hint: cat.hint, color: BUS_COLOR[cat.id] || '#5d6a80',
      count: nodes.filter(n => rowOf(n.type) === r).length,
      x1: bx1, x2: bx2, y1: bandTop[r], y2: bandTop[r] + bandH[r],
    }));

    backY = bandTop[cats.length - 1] + bandH[cats.length - 1] + BACK_GAP;
    box = { x1: bx1 - 20, y1: Y0 - 20, x2: bx2 + 20, y2: backY + 96 };   // снизу — место под легенду

    // ручные позиции чипов (перетаскивание) кладём поверх авто-раскладки;
    // следы удалённых узлов подчищаем, границы вида тянем под утащенные чипы
    [...manual.keys()].forEach(id => { if (!alive[id]) manual.delete(id); });
    manual.forEach((m, id) => { const p = pos.get(id); if (p) { p.x = m.x; p.y = m.y; } });
    pos.forEach(p => {
      box.x1 = Math.min(box.x1, p.x - 20); box.y1 = Math.min(box.y1, p.y - 20);
      box.x2 = Math.max(box.x2, p.x + p.w + 20); box.y2 = Math.max(box.y2, p.y + p.h + 20);
    });
  }

  /* ── трассировка провода ────────────────────────────── */
  /* Ортогональ со скруглением: прямой ход — через общий вертикальный канал
     между чипами, обратный — по нижней возвратной дорожке. */
  function rounded(p) {
    if (p.length < 2) return '';
    let d = 'M' + p[0][0].toFixed(1) + ' ' + p[0][1].toFixed(1);
    for (let i = 1; i < p.length - 1; i++) {
      const a = p[i - 1], b = p[i], c = p[i + 1];
      const l1 = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, l2 = Math.hypot(c[0] - b[0], c[1] - b[1]) || 1;
      const r = Math.min(12, l1 / 2, l2 / 2);
      const u1 = [(b[0] - a[0]) / l1, (b[1] - a[1]) / l1], u2 = [(c[0] - b[0]) / l2, (c[1] - b[1]) / l2];
      d += ' L' + (b[0] - u1[0] * r).toFixed(1) + ' ' + (b[1] - u1[1] * r).toFixed(1);
      d += ' Q' + b[0].toFixed(1) + ' ' + b[1].toFixed(1) + ' ' + (b[0] + u2[0] * r).toFixed(1) + ' ' + (b[1] + u2[1] * r).toFixed(1);
    }
    const z = p[p.length - 1];
    return d + ' L' + z[0].toFixed(1) + ' ' + z[1].toFixed(1);
  }

  /* Вертикальный отрезок x на [y0,y1] задевает прямоугольник r (с отступом pad). */
  function vsegHit(x, y0, y1, r, pad) {
    const p = pad || 0;
    return x >= r.x - p && x <= r.x + r.w + p &&
      Math.max(y0, y1) >= r.y - p && Math.min(y0, y1) <= r.y + r.h + p;
  }
  /* Ищем вертикальный канал возле желаемого mx, не протыкающий чужие чипы. */
  function clearChannel(desired, lo, hi, y0, y1, obstacles) {
    const bad = x => obstacles.some(r => vsegHit(x, y0, y1, r, 8));
    if (!bad(desired)) return desired;
    for (let off = 12; off <= hi - lo; off += 12) {
      for (const s of [1, -1]) {
        const x = Math.min(hi, Math.max(lo, desired + s * off));
        if (!bad(x)) return x;
      }
    }
    return desired;
  }

  function route(a, b, slot, obstacles) {
    const ax = a.x + STUB, bx = b.x - STUB;
    if (bx - ax > 10) {
      if (Math.abs(a.y - b.y) < 0.6 && !(obstacles && obstacles.length)) return [[a.x, a.y], [b.x, b.y]];
      let mx = Math.min(bx, Math.max(ax, ax + (bx - ax) / 2 + slot));
      if (obstacles && obstacles.length) mx = clearChannel(mx, ax, bx, a.y, b.y, obstacles);
      if (Math.abs(a.y - b.y) < 0.6 && Math.abs(mx - (ax + (bx - ax) / 2 + slot)) < 0.6) return [[a.x, a.y], [b.x, b.y]];
      return [[a.x, a.y], [mx, a.y], [mx, b.y], [b.x, b.y]];
    }
    const lane = backY + (Math.abs(slot) % 5) * 9;
    return [[a.x, a.y], [ax, a.y], [ax, lane], [bx, lane], [bx, b.y], [b.x, b.y]];
  }

  /* ── контуры: среда исполнения ──────────────────────── */
  /* Среду узла выводим из фактов модели (тип + параметры), а не из его id —
     поэтому контуры считаются для ЛЮБОГО графа, а не только для текущего плана.
     Закрытый контур = клиент (машина пользователя) + сервер (наш Linux);
     открытый = эгресс наружу. */
  function envOf(n) {
    const t = n.type, p = n.params || {};
    // наружу — выход за наш периметр
    if (t === 'paywall') return 'external';
    if (t === 'output' && (p.target === 'webhook' || p.target === 'telegram')) return 'external';
    if (t === 'source' && p.mode === 'git') return 'external';
    if (t === 'kb' && (p.kind === 'url' || p.kind === 'api')) return 'external';
    if (t === 'agent' && p.provider && p.provider !== 'project') return 'external';
    if (t === 'start' && p.trigger === 'webhook') return 'external';
    // клиент — доступ к файлам и экраны у пользователя
    if (t === 'source' && (p.mode === 'local_agent' || p.mode === 'browser')) return 'client';
    if (t === 'codegraph' && p.where === 'client') return 'client';
    if (t === 'choice' || t === 'progress') return 'client';
    // заметки вне контура
    if (t === 'note') return null;
    // остальное — наш сервер
    return 'server';
  }

  const ZONE = {
    client:   { label: 'Клиент',  color: '#38bdf8', op: 0.16 },
    external: { label: 'Внешнее', color: '#fb923c', op: 0.17 },
    server:   { label: 'Сервер',  color: '#64748b', op: 0.07 },
  };
  const Z_PADX = 22, Z_PADY = 12, Z_R = 15;
  const ENVS = ['client', 'server', 'external'];

  /* Какие среды подсвечены. Среда разбросана по всей схеме и в структуру
     раскладки не ложится — значит, её надо уметь ВЫЗЫВАТЬ, а не искать глазами.
     По умолчанию горят клиент и внешнее: серверных узлов в любом плане
     большинство, их подсветка — сплошной налёт, а не сигнал. */
  let envShow = { client: true, server: false, external: true };

  /* Прямоугольники чипов одной среды из текущей раскладки. */
  function envRects(env) {
    const out = [];
    window.Graph.state.nodes.forEach(n => {
      if (envOf(n) !== env) return;
      const p = pos.get(n.id); if (p) out.push(p);
    });
    return out;
  }

  /* Заливка зоны: по прямоугольнику на чип, общая opacity на группе — стыки
     соседних чипов не темнеют. Сервер (обычно фон) — самый бледный. */
  function zonesSVG() {
    return ENVS.filter(e => envShow[e]).map(env => {
      const list = envRects(env); if (!list.length) return '';
      const z = ZONE[env];
      const rects = list.map(p =>
        `<rect x="${(p.x - Z_PADX).toFixed(1)}" y="${(p.y - Z_PADY).toFixed(1)}" width="${(p.w + Z_PADX * 2).toFixed(1)}" height="${(p.h + Z_PADY * 2).toFixed(1)}" rx="${Z_R}"/>`).join('');
      return `<g class="hzone" fill="${z.color}" opacity="${z.op}">${rects}</g>`;
    }).join('');
  }

  /* Один ярлык на среду — у её левого-верхнего чипа; разброс клиентских экранов
     и точек эгресса читается заливкой, без повторов подписи. Сервер — тихий
     фон вовсе без ярлыка. */
  function zoneLabelsHTML() {
    if (detail) return '';        // в подробном режиме среда подписана на самой карточке
    const out = [];
    for (const env of ENVS) {
      if (!envShow[env]) continue;
      const list = envRects(env); if (!list.length) continue;
      const z = ZONE[env];
      const p = list.reduce((a, b) => (b.x < a.x || (b.x === a.x && b.y < a.y)) ? b : a);
      out.push(`<div class="hzone-label" style="left:${(p.x - Z_PADX).toFixed(1)}px;top:${(p.y - Z_PADY - 19).toFixed(1)}px;--zc:${z.color}">${esc(z.label)}</div>`);
    }
    return out.join('');
  }

  /* ── контуры сервисов (единицы развёртывания) ─────────
     Другое сечение того же графа, чем среды: среда — ГДЕ выполняется узел
     (клиент/сервер/внешнее), сервис — В КАКОМ контуре развёртывания он живёт
     (поле unit). Показываем ОБВОДКОЙ, а не заливкой: заливка занята средами, и
     обводка поверх неё читается отдельным словарём. Члены сервиса разбросаны по
     шинам категорий — поэтому, как и у сред, рисуем рамку НА КАЖДЫЙ чип, а не
     габаритную (та по разбросанным членам накрыла бы пол-схемы). */
  const unitOf = n => { const u = ((n || {}).params || {}).unit; return (typeof u === 'string' && u.trim()) ? u.trim() : null; };
  const UNIT_PALETTE = ['#2dd4bf', '#818cf8', '#f472b6', '#f5a524', '#38bdf8', '#a3e635', '#fb923c', '#c084fc'];
  let unitShow = false;
  /* Цвет сервису — по стабильному порядку имён, чтобы не мигал между рендерами. */
  function unitColorMap() {
    const names = [...new Set(window.Graph.state.nodes.map(unitOf).filter(Boolean))].sort();
    const m = new Map();
    names.forEach((u, i) => m.set(u, UNIT_PALETTE[i % UNIT_PALETTE.length]));
    return m;
  }
  const U_PAD = 15, U_R = 13;
  function unitContoursSVG() {
    if (!unitShow) return '';
    const cm = unitColorMap();
    const groups = new Map();
    window.Graph.state.nodes.forEach(n => {
      const u = unitOf(n); if (!u) return;
      const p = pos.get(n.id); if (!p) return;
      if (!groups.has(u)) groups.set(u, []);
      groups.get(u).push(p);
    });
    let out = '';
    for (const [u, list] of groups) {
      const c = cm.get(u);
      const rects = list.map(p =>
        `<rect x="${(p.x - U_PAD).toFixed(1)}" y="${(p.y - U_PAD).toFixed(1)}" width="${(p.w + U_PAD * 2).toFixed(1)}" height="${(p.h + U_PAD * 2).toFixed(1)}" rx="${U_R}"/>`).join('');
      out += `<g class="hunit" stroke="${c}" fill="${c}">${rects}</g>`;
    }
    return out;
  }
  /* Ярлык сервиса — у его левого-верхнего члена, всегда (в отличие от среды: имя
     сервиса на карточке не пишется, узнать цвет иначе неоткуда). */
  function unitLabelsHTML() {
    if (!unitShow) return '';
    const cm = unitColorMap();
    const first = new Map();     // сервис → самый левый-верхний член
    window.Graph.state.nodes.forEach(n => {
      const u = unitOf(n); if (!u) return;
      const p = pos.get(n.id); if (!p) return;
      const cur = first.get(u);
      if (!cur || p.x < cur.x || (p.x === cur.x && p.y < cur.y)) first.set(u, p);
    });
    const out = [];
    for (const [u, p] of first)
      out.push(`<div class="hunit-label" style="left:${(p.x - U_PAD).toFixed(1)}px;top:${(p.y - U_PAD - 19).toFixed(1)}px;--uc:${cm.get(u)}">${esc(u)}</div>`);
    return out.join('');
  }
  function unitNames() {
    const cm = unitColorMap(), cnt = new Map();
    window.Graph.state.nodes.forEach(n => { const u = unitOf(n); if (u) cnt.set(u, (cnt.get(u) || 0) + 1); });
    return [...cm.keys()].map(u => ({ name: u, color: cm.get(u), count: cnt.get(u) || 0 }));
  }

  /* ── отрисовка ──────────────────────────────────────── */
  /* Зона = полоса шины. Три слоя, как на архитектурных плакатах: утопленная
     поверхность (темнее фона) + едва заметный тон категории + одна рамка.
     Глубина берётся слоями, а не тенями — тень на схеме с сотней узлов мылит. */
  function busSVG() {
    return buses.map(b => {
      const w = (b.x2 - b.x1).toFixed(1), h = (b.y2 - b.y1).toFixed(1);
      return `<g class="hbus">
        <rect class="hbus-surf" x="${b.x1}" y="${b.y1}" width="${w}" height="${h}" rx="16"/>
        <rect class="hbus-tint" x="${b.x1}" y="${b.y1}" width="${w}" height="${h}" rx="16" fill="${b.color}"/>
        <rect class="hbus-bd" x="${b.x1 + 0.5}" y="${b.y1 + 0.5}" width="${w - 1}" height="${h - 1}" rx="15.5"/>
        <rect class="hbus-edge" x="${b.x1}" y="${b.y1}" width="3" height="${h}" rx="1.5" fill="${b.color}"/>
      </g>`;
    }).join('');
  }

  function wiresSVG(sel) {
    const G = window.Graph, out = [];
    const rects = collide ? chipRects() : null;
    G.state.edges.forEach((e, i) => {
      const A = G.getNode(e.from.node), B = G.getNode(e.to.node);
      if (!A || !B) return;
      const a = pinPos(A, 'out', e.from.port), b = pinPos(B, 'in', e.to.port);
      if (!a || !b) return;
      const slot = ((i * 7) % 5 - 2) * 8;
      const obst = rects ? rects.filter(r => r.id !== A.id && r.id !== B.id) : null;
      const d = rounded(route(a, b, slot, obst));
      const isErr = e.from.port === 'err';          // аварийный маршрут — красный и в жгуте тоже
      const color = isErr ? '#f87171' : def(A.type).color;
      const cls = `hwire ${e.kind} ${isErr ? 'err' : ''} ${G.isBackEdge(e) ? 'back' : ''} ${sel.has(e.id) ? 'sel' : ''}`;
      out.push(`<path class="hwire-hit" data-edge="${e.id}" d="${d}"/>
        <path class="${cls}" data-edge="${e.id}" d="${d}" stroke="${color}"/>
        <circle class="hwire-cap" cx="${b.x.toFixed(1)}" cy="${b.y.toFixed(1)}" r="2.6" fill="${color}"/>`);
    });
    return out.join('');
  }

  function chipHTML(n, sel) {
    const p = pos.get(n.id); if (!p) return '';
    const d = def(n.type);
    const pins = dir => ports(n, dir).map((q, i, arr) => {
      const top = p.h / 2 - Math.max(0, arr.length - 1) * PIN_STEP / 2 + i * PIN_STEP;
      return `<i class="hpin ${q.kind}" style="top:${top.toFixed(1)}px" title="${esc(q.label)}"></i>`;
    }).join('');
    const bs = window.Build ? window.Build.get(n.id).status : 'todo';
    const drift = window.Build ? window.Build.drift(n.id) : null;
    const head = `<span class="hchip-icon">${esc(d.icon)}</span>
      <span class="hchip-name">${esc(n.name)}</span>
      <span class="hchip-drift" title="план изменился после отметки">⟳</span>`;
    let body = head;
    if (detail) {
      const c = cardText(n);
      /* Метка среды подчиняется тому же тумблеру, что и заливка: подсветка
         среды — одно понятие, а не два раздельных. */
      const env = (c.env && envShow[c.env])
        ? `<span class="hc-env ${c.env}">${esc(ZONE[c.env].label)}</span>` : '';
      body = `<div class="hc-head">${head}</div>
        <div class="hc-class">${esc(c.cls)}${env}</div>
        ${c.tact ? `<div class="hc-tact">${esc(c.tact)}</div>` : ''}
        ${c.lines ? `<div class="hc-facts" style="-webkit-line-clamp:${c.lines}">${esc(c.facts)}</div>` : ''}`;
    }
    return `<div class="hchip ${detail ? 'card' : ''} bstat-${bs} ${drift && drift.stale ? 'bdrift' : ''} ${sel.has(n.id) ? 'sel' : ''} ${n.enabled === false ? 'off' : ''} ${n.type === 'note' ? 'is-note' : ''}"
      data-id="${n.id}" style="left:${p.x}px;top:${p.y.toFixed(1)}px;width:${p.w}px;height:${p.h}px;--c:${d.color}"
      title="${esc(n.name)} · ${esc(d.label)}">
      ${body}
      <span class="hpins in">${pins('in')}</span>
      <span class="hpins out">${pins('out')}</span>
    </div>`;
  }

  /* Заголовок зоны — внутри полосы, слева сверху: имя, назначение, счётчик. */
  function labelsHTML() {
    return buses.map(b => `<div class="hbus-label" style="left:${b.x1}px;top:${(b.y1 + 9).toFixed(1)}px;--c:${b.color}">
      <b>${esc(b.label)}</b><span class="hbus-n">${b.count}</span><i>${esc(b.hint || '')}</i></div>`).join('');
  }

  /* Легенда: цвет и штрих провода — это словарь, и его надо где-то объявить.
     Стоит под последней шиной, в потоке чтения после самой схемы. Среды
     перечисляем только подсвеченные — легенда описывает то, что видно. */
  const ENV_HINT = { client: 'машина пользователя', server: 'наш сервер', external: 'выход за периметр' };
  function legendHTML() {
    if (!buses.length) return '';        // пустой проект: словарь без схемы описывать нечего
    const line = (cls, txt) => `<span class="hleg-i"><svg width="26" height="8" viewBox="0 0 26 8">
      <path class="hleg-w ${cls}" d="M1 4H25"/></svg>${esc(txt)}</span>`;
    const env = ENVS.filter(e => envShow[e] && envRects(e).length).map(e =>
      `<span class="hleg-i"><i class="hc-env ${e}">${esc(ZONE[e].label)}</i>${esc(ENV_HINT[e])}</span>`).join('');
    return `<div class="hlegend" style="left:${(box.x1 + 50).toFixed(1)}px;top:${(backY + 26).toFixed(1)}px">
      <b>Легенда</b>
      ${line('flow', 'порядок выполнения')}
      ${line('data', 'знания и данные')}
      ${line('back', 'возврат цикла')}
      <span class="hleg-i"><i class="hleg-c"></i>цвет провода — тип блока-источника</span>
      ${env}
    </div>`;
  }

  function els() {
    if (!$wires) {
      $wires = document.getElementById('harness-wires');
      $chips = document.getElementById('harness-chips');
    }
    return !!$wires;
  }

  function chipRects() {
    const out = [];
    pos.forEach((p, id) => out.push({ id, x: p.x, y: p.y, w: p.w, h: p.h }));
    return out;
  }
  function setManual(id, x, y) {
    manual.set(id, { x, y });
    const p = pos.get(id); if (p) { p.x = x; p.y = y; }
  }
  function resetManual() { manual.clear(); }

  /* Лёгкое обновление при перетаскивании чипа: двигаем DOM и перерисовываем
     провода/зоны без пересборки самих чипов (ярлыки зон осядут на pointerup). */
  function redraw(sel) {
    if (!els()) return;
    const selection = sel || new Set();
    window.Graph.state.nodes.forEach(n => {
      const p = pos.get(n.id); if (!p) return;
      const el = $chips.querySelector(`.hchip[data-id="${n.id}"]`);
      if (el) { el.style.left = p.x + 'px'; el.style.top = p.y.toFixed(1) + 'px'; }
    });
    $wires.innerHTML = zonesSVG() + busSVG() + unitContoursSVG() + wiresSVG(selection);
  }

  function render(sel) {
    if (!els()) return;
    const selection = sel || new Set();
    layout();
    $wires.innerHTML = zonesSVG() + busSVG() + unitContoursSVG() + wiresSVG(selection);
    $chips.innerHTML = zoneLabelsHTML() + unitLabelsHTML() + labelsHTML() + legendHTML() +
      window.Graph.state.nodes.map(n => chipHTML(n, selection)).join('');
  }

  return {
    render, redraw, bounds: () => box, positionOf: id => pos.get(id) || null,
    chipRects, setManual, resetManual,
    setCollide: v => { collide = !!v; }, getCollide: () => collide,
    /* Плотность: подробные карточки против обзорных чипов. Ручные позиции
       сбрасываем — они снимались под другую ширину и после смены разъедутся. */
    setDetail: v => { const on = !!v; if (on !== detail) { detail = on; manual.clear(); } },
    getDetail: () => detail,
    /* Подсветка сред: тумблеры живут в интерфейсе, раскладку не трогают —
       переключение только перекрашивает, поэтому позиции чипов остаются на месте. */
    ENVS, envLabel: e => (ZONE[e] || {}).label || e, envColor: e => (ZONE[e] || {}).color || '#5d6a80',
    setEnvShow: (e, on) => { if (ZONE[e]) envShow[e] = !!on; },
    getEnvShow: () => Object.assign({}, envShow),
    /* Контуры сервисов — второе сечение (единицы развёртывания), обводкой. */
    setUnitShow: v => { unitShow = !!v; },
    getUnitShow: () => unitShow,
    unitNames,
    envCounts() {
      const out = { client: 0, server: 0, external: 0 };
      window.Graph.state.nodes.forEach(n => { const e = envOf(n); if (e && out[e] !== undefined) out[e]++; });
      return out;
    },
  };
})();
