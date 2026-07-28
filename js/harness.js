/* harness.js — второй вид холста: жгутовая раскладка (вариант 3 «шины по категориям»).
   Считает СВОЮ раскладку в памяти вида и НЕ трогает n.x/n.y свободного холста.
   Модель та же: узел → коннектор с пинами, ребро → провод, kind:'flow' сплошной,
   kind:'data' пунктир, цвет провода = цвет типа-источника. Только показ. */

window.Harness = (function () {

  const CHIP_W = 132, CHIP_MIN_H = 38, PIN_STEP = 11, PIN_PAD = 13;
  const SLOTS_MAX = 1;                 // чипов в ряд внутри одной колонки шины
  const GAP_X = 18, GAP_Y = 9, COL_GAP = 48, LANE = 92;
  const X0 = 70, Y0 = 64, STUB = 16, BACK_GAP = 34;

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

  function chipH(n) {
    const rows = Math.max(ports(n, 'in').length, ports(n, 'out').length);
    return Math.max(CHIP_MIN_H, PIN_PAD * 2 + Math.max(0, rows - 1) * PIN_STEP);
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
    colKeys.forEach(c => cats.forEach((cat, r) => {
      const list = cols[c][r];
      if (list) subs[r] = Math.max(subs[r], Math.ceil(list.length / SLOTS_MAX));
    }));
    const bandH = cats.map((cat, r) => cellH[r] * subs[r] + GAP_Y * (subs[r] - 1) + 22);

    const bandTop = []; let y = Y0;
    cats.forEach((cat, r) => { bandTop[r] = y; y += bandH[r] + LANE; });

    // x: колонки слева направо, порядок внутри — по среднему x родителей
    const parentsOf = n => preds[n.id].length ? preds[n.id]
      : dataEdges.filter(e => e.to.node === n.id).map(e => e.from.node);
    const bary = n => {
      const v = parentsOf(n).map(p => { const q = pos.get(p); return q ? q.x : undefined; }).filter(v => v !== undefined);
      return v.length ? v.reduce((a, b) => a + b, 0) / v.length : Infinity;
    };

    let cx = X0, maxX = X0;
    colKeys.forEach(c => {
      let slots = 1;
      cats.forEach((cat, r) => { const l = cols[c][r]; if (l) slots = Math.max(slots, Math.min(SLOTS_MAX, l.length)); });
      cats.forEach((cat, r) => {
        const list = cols[c][r]; if (!list) return;
        list.sort((a, b) => (bary(a) - bary(b)) || a.id.localeCompare(b.id));
        list.forEach((n, i) => {
          const h = chipH(n);
          const sx = cx + (i % SLOTS_MAX) * (CHIP_W + GAP_X);
          const sy = bandTop[r] + 11 + Math.floor(i / SLOTS_MAX) * (cellH[r] + GAP_Y) + (cellH[r] - h) / 2;
          pos.set(n.id, { x: sx, y: sy, w: CHIP_W, h });
          maxX = Math.max(maxX, sx + CHIP_W);
        });
      });
      cx += slots * (CHIP_W + GAP_X) + COL_GAP;
    });

    const bx1 = X0 - 30, bx2 = maxX + 30;
    cats.forEach((cat, r) => buses.push({
      id: cat.id, label: cat.label, hint: cat.hint, color: BUS_COLOR[cat.id] || '#5d6a80',
      x1: bx1, x2: bx2, y1: bandTop[r], y2: bandTop[r] + bandH[r],
    }));

    backY = bandTop[cats.length - 1] + bandH[cats.length - 1] + BACK_GAP;
    box = { x1: bx1 - 20, y1: Y0 - 46, x2: bx2 + 20, y2: backY + 64 };

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
    return ['server', 'client', 'external'].map(env => {
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
    const out = [];
    for (const env of ['client', 'external']) {
      const list = envRects(env); if (!list.length) continue;
      const z = ZONE[env];
      const p = list.reduce((a, b) => (b.x < a.x || (b.x === a.x && b.y < a.y)) ? b : a);
      out.push(`<div class="hzone-label" style="left:${(p.x - Z_PADX).toFixed(1)}px;top:${(p.y - Z_PADY - 19).toFixed(1)}px;--zc:${z.color}">${esc(z.label)}</div>`);
    }
    return out.join('');
  }

  /* ── отрисовка ──────────────────────────────────────── */
  function busSVG() {
    return buses.map(b => `<g class="hbus">
      <rect x="${b.x1}" y="${b.y1}" width="${b.x2 - b.x1}" height="${b.y2 - b.y1}" rx="14" fill="${b.color}"/>
      <rect class="hbus-edge" x="${b.x1}" y="${b.y1}" width="4" height="${b.y2 - b.y1}" rx="2" fill="${b.color}"/>
    </g>`).join('');
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
      const color = def(A.type).color;
      const cls = `hwire ${e.kind} ${G.isBackEdge(e) ? 'back' : ''} ${sel.has(e.id) ? 'sel' : ''}`;
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
    return `<div class="hchip ${sel.has(n.id) ? 'sel' : ''} ${n.enabled === false ? 'off' : ''} ${n.type === 'note' ? 'is-note' : ''}"
      data-id="${n.id}" style="left:${p.x}px;top:${p.y.toFixed(1)}px;width:${p.w}px;height:${p.h}px;--c:${d.color}"
      title="${esc(n.name)} · ${esc(d.label)}">
      <span class="hchip-icon">${esc(d.icon)}</span>
      <span class="hchip-name">${esc(n.name)}</span>
      <span class="hpins in">${pins('in')}</span>
      <span class="hpins out">${pins('out')}</span>
    </div>`;
  }

  function labelsHTML() {
    return buses.map(b => `<div class="hbus-label" style="left:${b.x1}px;top:${(b.y1 - 26).toFixed(1)}px;--c:${b.color}">
      <b>${esc(b.label)}</b><i>${esc(b.hint || '')}</i></div>`).join('');
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
    $wires.innerHTML = zonesSVG() + busSVG() + wiresSVG(selection);
  }

  function render(sel) {
    if (!els()) return;
    const selection = sel || new Set();
    layout();
    $wires.innerHTML = zonesSVG() + busSVG() + wiresSVG(selection);
    $chips.innerHTML = zoneLabelsHTML() + labelsHTML() + window.Graph.state.nodes.map(n => chipHTML(n, selection)).join('');
  }

  return {
    render, redraw, bounds: () => box, positionOf: id => pos.get(id) || null,
    chipRects, setManual, resetManual,
    setCollide: v => { collide = !!v; }, getCollide: () => collide,
  };
})();
