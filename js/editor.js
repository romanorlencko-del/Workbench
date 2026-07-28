/* editor.js — холст: отрисовка узлов и связей, панорама/зум, перетаскивание,
   создание связей, рамка выделения, быстрое добавление блока с конца связи. */

window.Editor = (function () {

  const NODE_W = 214, HEAD_H = 34, PORT_STEP = 22, PORT_Y0 = 41;
  const COLLIDE_GAP = 10, WIRE_PAD = 14, WIRE_BOW = 26;   // зазор между узлами · отступ провода · вынос дуги обхода

  let $stage, $viewport, $nodes, $edges, $marquee, $quickadd;
  const view = { x: 80, y: 60, k: 1 };
  const selection = new Set();
  let viewMode = 'graph';                 // 'graph' — свободный холст, 'harness' — жгут (только показ)
  let snap = true;
  let collide = false;                    // коллизии: узлы не налезают друг на друга, провода огибают узлы
  let drag = null, link = null, pan = null, band = null, spaceDown = false;
  let hdrag = null;                       // перетаскивание чипа в жгуте (позиции — в Harness)
  let pinch = null;                       // щипок двумя пальцами (тач-зум + двупалый пан)
  const pointers = new Map();             // активные тач-указатели: id → {x,y}
  let onChange = () => {};
  let onSelect = () => {};

  /* ── утилиты ────────────────────────────────────────── */
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const def = t => window.BLOCKS.TYPES[t];

  function toGraph(clientX, clientY) {
    const r = $stage.getBoundingClientRect();
    return { x: (clientX - r.left - view.x) / view.k, y: (clientY - r.top - view.y) / view.k };
  }

  function portPos(node, dir, portId) {
    const x = node.x + (dir === 'out' ? NODE_W : 0);
    // у свёрнутой карточки все порты сходятся в середину шапки
    if (node.collapsed) return { x, y: node.y + HEAD_H / 2 };
    const list = window.BLOCKS.portsOf(node, dir);
    const i = Math.max(0, list.findIndex(p => p.id === portId));
    return { x, y: node.y + PORT_Y0 + i * PORT_STEP };
  }

  function nodeHeight(node) {
    const el = $nodes.querySelector(`[data-id="${node.id}"]`);
    return el ? el.offsetHeight : 96;
  }

  function nodeRect(n) { return { id: n.id, x: n.x, y: n.y, w: NODE_W, h: nodeHeight(n) }; }

  /* ── отрисовка ──────────────────────────────────────── */
  function render() {
    if (viewMode === 'harness') { window.Harness.render(selection); return applyView(); }
    const scroll = $nodes.scrollTop;
    $nodes.innerHTML = window.Graph.state.nodes.map(nodeHTML).join('');
    $nodes.scrollTop = scroll;
    renderEdges();
    applyView();
  }

  function nodeHTML(n) {
    const d = def(n.type);
    const rows = Math.max(window.BLOCKS.portsOf(n, 'in').length, window.BLOCKS.portsOf(n, 'out').length);
    const minH = HEAD_H + rows * PORT_STEP + 14;
    const sum = window.BLOCKS.summary(n);
    /* Тип может сам решить, что показать на карточке: chips() — сводка,
       preview() — строка состава. Иначе чипсы берутся из простых параметров. */
    const chips = d.chips ? (d.chips(n.params) || []).map(t => `<span class="chip">${esc(t)}</span>`).join('')
      : window.BLOCKS.visibleParams(n.type, n.params)
      .filter(f => ['select', 'bool', 'number'].includes(f.type) && n.params[f.key] !== undefined && n.params[f.key] !== '')
      .slice(0, 3)
      .map(f => {
        let v = n.params[f.key];
        if (f.type === 'bool') { if (!v) return ''; v = 'да'; }
        if (f.type === 'select') { const o = (f.options || []).find(o => o[0] === v); v = o ? o[1] : v; }
        return `<span class="chip">${esc(v)}</span>`;
      }).join('');

    const ports = (dir) => window.BLOCKS.portsOf(n, dir).map((p, i) => `
      <button class="port ${p.kind}" data-node="${n.id}" data-port="${p.id}" data-dir="${dir}" data-kind="${p.kind}"
              style="top:${HEAD_H + i * PORT_STEP}px" title="${esc(p.label)}"><i></i><span class="port-label">${esc(p.label)}</span></button>`).join('');

    return `<div class="node ${selection.has(n.id) ? 'sel' : ''} ${n.enabled === false ? 'off' : ''} ${n.type === 'note' ? 'is-note' : ''} ${n.collapsed ? 'collapsed' : ''}"
                 data-id="${n.id}" style="left:${n.x}px;top:${n.y}px;${n.collapsed ? '' : `min-height:${minH}px;`}--c:${d.color}">
      <header class="node-head" title="двойной клик — свернуть или развернуть">
        <span class="node-icon">${esc(d.icon)}</span>
        <span class="node-title">${esc(n.name)}</span>
        <span class="node-kind">${n.collapsed ? '▸' : esc(n.type)}</span>
      </header>
      <div class="node-body">
        <div class="node-summary">${esc(sum)}</div>
        ${chips ? `<div class="node-chips">${chips}</div>` : ''}
        ${d.preview ? `<div class="node-preview">${esc(d.preview(n.params) || '')}</div>` : ''}
        ${n.notes ? `<div class="node-note">${esc(n.notes)}</div>` : ''}
      </div>
      <div class="ports in">${ports('in')}</div>
      <div class="ports out">${ports('out')}</div>
    </div>`;
  }

  function edgePath(a, b, back) {
    const dx = Math.max(46, Math.abs(b.x - a.x) * 0.5);
    if (back || b.x < a.x - 24) {
      const off = 70 + Math.abs(a.x - b.x) * 0.18;
      return `M${a.x},${a.y} C${a.x + off},${a.y + 46} ${b.x - off},${b.y + 46} ${b.x},${b.y}`;
    }
    return `M${a.x},${a.y} C${a.x + dx},${a.y} ${b.x - dx},${b.y} ${b.x},${b.y}`;
  }

  function arrow(b, color) {
    const s = 5;
    return `<polygon class="edge-arrow" points="${b.x - s * 2},${b.y - s} ${b.x},${b.y} ${b.x - s * 2},${b.y + s}" fill="${color}"/>`;
  }

  /* Провод, огибающий чужие узлы: если прямой путь протыкает карточки, уводим
     дугу над/под преградой. Контрольные точки считаем так, чтобы вершина дуги
     реально вышла за узел (кубик в t=0.5 проходит лишь 3/4 пути к контролям). */
  function edgePathAvoid(a, b, obstacles) {
    const bw = window.Collide.detour(a, b, obstacles, WIRE_PAD);
    if (!bw) return edgePath(a, b, false);
    const target = bw.side === 'up' ? bw.y - WIRE_BOW : bw.y + WIRE_BOW;
    const cy = (target - 0.125 * (a.y + b.y)) / 0.75;
    const lo = Math.min(a.x, b.x), hi = Math.max(a.x, b.x);
    const c1 = Math.max(lo, Math.min(bw.x1, hi)), c2 = Math.max(lo, Math.min(bw.x2, hi));
    return `M${a.x},${a.y} C${c1.toFixed(1)},${cy.toFixed(1)} ${c2.toFixed(1)},${cy.toFixed(1)} ${b.x},${b.y}`;
  }

  function renderEdges() {
    const out = [];
    const rects = collide ? window.Graph.state.nodes.map(nodeRect) : null;
    for (const e of window.Graph.state.edges) {
      const A = window.Graph.getNode(e.from.node), B = window.Graph.getNode(e.to.node);
      if (!A || !B) continue;
      const a = portPos(A, 'out', e.from.port), b = portPos(B, 'in', e.to.port);
      const back = window.Graph.isBackEdge(e);
      const color = e.kind === 'data' ? '#2dd4bf' : def(A.type).color;
      const d = (collide && !back)
        ? edgePathAvoid(a, b, rects.filter(r => r.id !== A.id && r.id !== B.id))
        : edgePath(a, b, back);
      const cls = `edge ${e.kind} ${back ? 'back' : ''} ${selection.has(e.id) ? 'sel' : ''}`;
      out.push(`<path class="edge-hit" data-edge="${e.id}" d="${d}"/>
                <path class="${cls}" data-edge="${e.id}" d="${d}" stroke="${color}"/>${arrow(b, color)}`);
    }
    if (link && link.cur) {
      const a = link.dir === 'out' ? link.origin : link.cur;
      const b = link.dir === 'out' ? link.cur : link.origin;
      out.push(`<path class="edge ghost ${link.kind}" d="${edgePath(a, b)}"/>`);
    }
    $edges.innerHTML = out.join('');
  }

  let idleTimer = null;
  function applyView() {
    $viewport.style.transform = `translate(${view.x}px,${view.y}px) scale(${view.k})`;
    const z = document.getElementById('zoom-val');
    if (z) z.textContent = Math.round(view.k * 100) + '%';
    // слой держим только пока двигаемся — иначе Chrome не перерастрирует текст
    $viewport.classList.add('moving');
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => $viewport.classList.remove('moving'), 180);
  }

  /* ── выделение ──────────────────────────────────────── */
  function select(ids, additive) {
    if (!additive) selection.clear();
    (Array.isArray(ids) ? ids : [ids]).filter(Boolean).forEach(id => selection.add(id));
    render(); onSelect([...selection]);
  }
  function clearSelection() { selection.clear(); render(); onSelect([]); }

  function deleteSelection() {
    if (!selection.size) return;                 /* жгут — тот же граф: удаляем и там */
    for (const id of selection) {
      if (window.Graph.state.edges.some(e => e.id === id)) window.Graph.removeEdge(id);
      else window.Graph.removeNode(id);
    }
    selection.clear(); onChange('delete'); render(); onSelect([]);
  }

  function duplicateSelection() {
    const copies = [];
    for (const id of selection) {
      const n = window.Graph.getNode(id);
      if (!n) continue;
      const c = window.Graph.addNode(n.type, n.x + 28, n.y + 28, JSON.parse(JSON.stringify(n.params)));
      c.name = n.name; c.notes = n.notes; copies.push(c.id);
    }
    if (copies.length) { onChange('duplicate'); select(copies); }
  }

  /* ── вид ────────────────────────────────────────────── */
  function zoomAt(clientX, clientY, factor) {
    const r = $stage.getBoundingClientRect();
    const k = Math.min(2.4, Math.max(0.1, view.k * factor));
    const px = clientX - r.left, py = clientY - r.top;
    view.x = px - (px - view.x) * (k / view.k);
    view.y = py - (py - view.y) * (k / view.k);
    view.k = k; applyView();
  }

  function fit() {
    const ns = window.Graph.state.nodes;
    if (!ns.length) { view.x = 80; view.y = 60; view.k = 1; return applyView(); }
    const r = $stage.getBoundingClientRect();
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    if (viewMode === 'harness') {
      const b = window.Harness.bounds();
      x1 = b.x1; y1 = b.y1; x2 = b.x2; y2 = b.y2;
    } else for (const n of ns) {
      x1 = Math.min(x1, n.x); y1 = Math.min(y1, n.y);
      x2 = Math.max(x2, n.x + NODE_W); y2 = Math.max(y2, n.y + nodeHeight(n));
    }
    const pad = 70;
    view.k = Math.min(1.25, Math.max(0.1, Math.min((r.width - pad * 2) / (x2 - x1), (r.height - pad * 2) / (y2 - y1))));
    view.x = (r.width - (x2 - x1) * view.k) / 2 - x1 * view.k;
    view.y = (r.height - (y2 - y1) * view.k) / 2 - y1 * view.k;
    applyView();
  }

  function centerOn(id) {
    const n = window.Graph.getNode(id); if (!n) return;
    const r = $stage.getBoundingClientRect();
    const p = viewMode === 'harness' ? window.Harness.positionOf(id) : null;
    const cx = p ? p.x + p.w / 2 : n.x + NODE_W / 2;
    const cy = p ? p.y + p.h / 2 : n.y + 48;
    view.x = r.width / 2 - cx * view.k;
    view.y = r.height / 2 - cy * view.k;
    applyView();
  }

  /* Подвинуть вид ТОЛЬКО если узел не виден — и на минимум, без прыжка в центр.
     Нужно прогону: центрирование на каждом шаге дёргало всю схему. */
  function revealOn(id, pad) {
    const n = window.Graph.getNode(id);
    const p = viewMode === 'harness' ? window.Harness.positionOf(id) : null;
    if (!p && !n) return;
    const gx = p ? p.x : n.x, gy = p ? p.y : n.y;
    const gw = p ? p.w : NODE_W, gh = p ? p.h : nodeHeight(n);
    const r = $stage.getBoundingClientRect(), m = pad == null ? 60 : pad;
    const x1 = gx * view.k + view.x, x2 = (gx + gw) * view.k + view.x;
    const y1 = gy * view.k + view.y, y2 = (gy + gh) * view.k + view.y;
    let dx = 0, dy = 0;
    if (x1 < m) dx = m - x1; else if (x2 > r.width - m) dx = (r.width - m) - x2;
    if (y1 < m) dy = m - y1; else if (y2 > r.height - m) dy = (r.height - m) - y2;
    if (!dx && !dy) return;                       // уже на виду — вид не трогаем
    view.x += dx; view.y += dy;
    applyView();
  }

  /* Жгутовый вид — только показ: выделение и навигация есть, правки нет.
     Раскладка своя (Harness), координаты холста при этом не трогаются. */
  function setViewMode(mode) {
    const next = mode === 'harness' ? 'harness' : 'graph';
    if (next === viewMode) return;
    viewMode = next;
    $stage.classList.toggle('harness-mode', viewMode === 'harness');
    closeQuickAdd();
    render();
    fit();
  }
  function getViewMode() { return viewMode; }

  /* ── автораскладка ──────────────────────────────────── */
  /* Слоями: колонка = длиннейший путь по потоку, порядок внутри колонки —
     по среднему положению родителей. Пучки от разных родителей разделяются
     увеличенным отступом, иначе 24 эксперта четырёх направлений сольются
     в одну кашу. Заметки не двигаем — их расставляет человек. */
  function autoLayout() {
    if (viewMode === 'harness') return;          // жгут раскладывается сам, координаты холста не трогаем
    const G = window.Graph, st = G.state;
    const movable = st.nodes.filter(n => n.type !== 'note');
    if (!movable.length) return;
    const alive = {}; movable.forEach(n => alive[n.id] = n);

    const flowEdges = st.edges.filter(e => e.kind === 'flow' && !G.isBackEdge(e) && alive[e.from.node] && alive[e.to.node]);
    const dataEdges = st.edges.filter(e => e.kind === 'data' && alive[e.from.node] && alive[e.to.node]);
    const preds = {}; movable.forEach(n => preds[n.id] = []);
    flowEdges.forEach(e => preds[e.to.node].push(e.from.node));

    const hasFlow = n => window.BLOCKS.portsOf(n, 'in').concat(window.BLOCKS.portsOf(n, 'out'))
      .some(p => p.kind === 'flow');

    const col = {};
    const depth = (id, guard) => {
      if (col[id] !== undefined) return col[id];
      if (guard.has(id)) return 0;                 // защита от неожиданного контура
      guard.add(id);
      const c = preds[id].length ? Math.max(...preds[id].map(p => depth(p, guard) + 1)) : 0;
      guard.delete(id);
      return (col[id] = c);
    };
    movable.filter(hasFlow).forEach(n => depth(n.id, new Set()));

    // блоки без портов потока (знания, контекст) — на колонку левее потребителей
    movable.filter(n => !hasFlow(n)).forEach(n => {
      const cs = dataEdges.filter(e => e.from.node === n.id).map(e => col[e.to.node]).filter(v => v !== undefined);
      col[n.id] = cs.length ? Math.max(0, Math.min(...cs) - 1) : 0;
    });

    const GAPX = 96, GAPY = 34, CLUSTER = 52, X0 = 40, Y0 = 40;
    const cols = {};
    movable.forEach(n => (cols[col[n.id]] = cols[col[n.id]] || []).push(n));
    const center = {};

    Object.keys(cols).map(Number).sort((a, b) => a - b).forEach(c => {
      const list = cols[c];
      /* Родитель по потоку важнее: он определяет, к какому пучку блок
         относится. Связи данных идут от общего контекста ко всем подряд и
         порядок не задают — их берём, только если потока нет вовсе. */
      const parentsOf = n => preds[n.id].length ? preds[n.id]
        : dataEdges.filter(e => e.to.node === n.id).map(e => e.from.node);
      const bary = n => {
        const vals = parentsOf(n).map(p => center[p]).filter(v => v !== undefined);
        return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : Infinity;
      };
      list.sort((a, b) => (bary(a) - bary(b)) || a.id.localeCompare(b.id));

      let cursor = Y0, prevKey = null;
      list.forEach(n => {
        const h = nodeHeight(n);
        const key = parentsOf(n)[0] || '';
        if (prevKey !== null && key !== prevKey) cursor += CLUSTER;
        const want = bary(n);
        const y = Math.max(isFinite(want) ? Math.round(want - h / 2) : Y0, cursor);
        n.x = X0 + c * (NODE_W + GAPX);
        n.y = y;
        center[n.id] = y + h / 2;
        cursor = y + h + GAPY;
        prevKey = key;
      });
    });

    /* Заметки раскладка не двигает — они бы уехали от того, что поясняют.
       Но и наезжать на блоки им нельзя: поднимаем их над своей колонкой. */
    render();
    const notes = st.nodes.filter(n => n.type === 'note');
    if (notes.length && movable.length) {
      const top = Math.min(...movable.map(n => n.y));
      notes.forEach(n => {
        const nearest = movable.reduce((a, b) => Math.abs(b.x - n.x) < Math.abs(a.x - n.x) ? b : a);
        n.x = nearest.x;
        n.y = top - nodeHeight(n) - CLUSTER;
      });
      // несколько заметок в одной колонке — разводим по вертикали
      const byCol = {};
      notes.forEach(n => (byCol[n.x] = byCol[n.x] || []).push(n));
      Object.values(byCol).forEach(list => list.forEach((n, i) => {
        if (i) n.y = list[i - 1].y - nodeHeight(n) - GAPY;
      }));
      render();
    }
  }

  /* ── быстрое добавление с конца связи ───────────────── */
  let qaRightPress = false;      // ПКМ пришёлся по открытой всплывашке → contextmenu не открывает её заново

  function openQuickAdd(clientX, clientY, gp, from) {
    const r = $stage.getBoundingClientRect();
    $quickadd.style.left = Math.min(clientX - r.left, r.width - 250) + 'px';
    $quickadd.style.top = Math.min(clientY - r.top, r.height - 300) + 'px';
    $quickadd.hidden = false;
    $quickadd.dataset.gx = gp.x; $quickadd.dataset.gy = gp.y;
    $quickadd.__from = from || null;
    const q = document.getElementById('qa-search');
    q.value = ''; renderQuickList(''); q.focus();
  }

  function quickCandidates(filter) {
    const from = $quickadd.__from;
    return Object.entries(window.BLOCKS.TYPES).filter(([t, d]) => {
      if (filter && !(d.label + ' ' + t).toLowerCase().includes(filter)) return false;
      if (!from) return true;
      const need = from.dir === 'out' ? 'in' : 'out';
      return window.BLOCKS.portsOf(t, need).some(p => p.kind === from.kind);
    });
  }

  function renderQuickList(filter) {
    document.getElementById('qa-list').innerHTML = quickCandidates(filter).map(([t, d]) =>
      `<button class="qa-item" data-type="${t}"><span class="qa-icon" style="--c:${d.color}">${esc(d.icon)}</span>${esc(d.label)}</button>`).join('')
      || '<div class="qa-empty micro">нет подходящих блоков</div>';
  }

  function quickPick(type) {
    const gx = +$quickadd.dataset.gx, gy = +$quickadd.dataset.gy;
    const from = $quickadd.__from;
    const n = window.Graph.addNode(type, snapv(gx - (from && from.dir === 'out' ? 0 : NODE_W)), snapv(gy - PORT_Y0));
    if (from) {
      const need = from.dir === 'out' ? 'in' : 'out';
      const p = window.BLOCKS.portsOf(type, need).find(p => p.kind === from.kind);
      if (p) {
        const a = { node: from.node, port: from.port }, b = { node: n.id, port: p.id };
        window.Graph.addEdge(from.dir === 'out' ? a : b, from.dir === 'out' ? b : a);
      }
    }
    closeQuickAdd(); onChange('add'); select(n.id);
  }

  function closeQuickAdd() { $quickadd.hidden = true; $quickadd.__from = null; }

  const snapv = v => snap ? Math.round(v / 10) * 10 : Math.round(v);

  /* ── события ────────────────────────────────────────── */
  function init(opts) {
    onChange = opts.onChange || onChange;
    onSelect = opts.onSelect || onSelect;
    $stage = document.getElementById('stage');
    $viewport = document.getElementById('viewport');
    $nodes = document.getElementById('nodes');
    $edges = document.getElementById('edges');
    $marquee = document.getElementById('marquee');
    $quickadd = document.getElementById('quickadd');

    $stage.addEventListener('pointerdown', onPointerDown);
    $stage.addEventListener('dblclick', e => {
      const head = e.target.closest('.node-head'); if (!head) return;
      const n = window.Graph.getNode(head.closest('.node').dataset.id); if (!n) return;
      n.collapsed = !n.collapsed;
      onChange('collapse'); render();
    });
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);   // тач: система забрала жест — чистим состояние
    /* Трекпад: двумя пальцами — панорама, щипок (браузер шлёт ctrl+wheel) — зум.
       Мышь: колесо — вертикальная панорама, Ctrl+колесо — зум. */
    $stage.addEventListener('wheel', e => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        const step = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;   // строки → пиксели
        return zoomAt(e.clientX, e.clientY, Math.exp(-step * 0.01));
      }
      const k = e.deltaMode === 1 ? 16 : 1;
      view.x -= (e.shiftKey && !e.deltaX ? e.deltaY : e.deltaX) * k;
      view.y -= (e.shiftKey && !e.deltaX ? 0 : e.deltaY) * k;
      applyView();
    }, { passive: false });
    $stage.addEventListener('contextmenu', e => {
      e.preventDefault();
      if (qaRightPress) { qaRightPress = false; return; }        // повторный ПКМ — закрыть, а не открыть заново
      if (!pan || !pan.moved) openQuickAdd(e.clientX, e.clientY, toGraph(e.clientX, e.clientY), null);
    });

    /* закрывается кликом ГДЕ УГОДНО вне себя — не только по холсту (палитра, топбар, консоль) */
    document.addEventListener('pointerdown', e => {
      if ($quickadd.hidden || $quickadd.contains(e.target)) { qaRightPress = false; return; }
      qaRightPress = (e.button === 2);
      closeQuickAdd();
    }, true);
    window.addEventListener('keydown', e => { if (e.key === 'Escape' && !$quickadd.hidden) closeQuickAdd(); });

    document.getElementById('qa-search').addEventListener('input', e => renderQuickList(e.target.value.toLowerCase()));
    $quickadd.addEventListener('click', e => {
      if (e.target.closest('[data-qa-close]')) return closeQuickAdd();
      const it = e.target.closest('.qa-item'); if (it) quickPick(it.dataset.type);
    });
    document.getElementById('qa-search').addEventListener('keydown', e => {
      if (e.key === 'Enter') { const f = $quickadd.querySelector('.qa-item'); if (f) quickPick(f.dataset.type); }
    });

    /* drop из палитры */
    $stage.addEventListener('dragover', e => e.preventDefault());
    $stage.addEventListener('drop', e => {
      e.preventDefault();
      const type = e.dataTransfer.getData('text/block'); if (!type) return;
      const g = toGraph(e.clientX, e.clientY);
      const n = window.Graph.addNode(type, snapv(g.x - NODE_W / 2), snapv(g.y - 30));
      onChange('add'); select(n.id);
    });

    window.addEventListener('keydown', e => { if (e.code === 'Space' && !isTyping(e)) { spaceDown = true; $stage.classList.add('panning'); } });
    window.addEventListener('keyup', e => { if (e.code === 'Space') { spaceDown = false; $stage.classList.remove('panning'); } });

    applyView();
  }

  const isTyping = e => /^(INPUT|TEXTAREA|SELECT)$/.test((e.target.tagName || ''));

  /* ── тач-жесты: панорама одним пальцем, щипок двумя ──── */
  function startTouchPan(e) {
    pan = { sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y, moved: false, tapClear: true };
    try { $stage.setPointerCapture(e.pointerId); } catch (_) {}
  }
  function startPinch() {
    if (drag && drag.moved) onChange('move');     // не терять начатый перенос узла
    drag = band = link = hdrag = null; pan = null;
    $marquee.hidden = true; $stage.classList.remove('linking');
    $nodes.querySelectorAll('.port.hot').forEach(x => x.classList.remove('hot'));
    const p = [...pointers.values()], r = $stage.getBoundingClientRect();
    pinch = {
      d0: Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y) || 1,
      mx: (p[0].x + p[1].x) / 2, my: (p[0].y + p[1].y) / 2,
      ox: r.left, oy: r.top, vx: view.x, vy: view.y, k0: view.k,
    };
  }

  function onPointerDown(e) {
    if (e.pointerType === 'touch') {
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size >= 2) { startPinch(); return; }   // второй палец — щипок + двупалый пан
    }

    const port = e.target.closest('.port');
    const node = e.target.closest('.node');
    const edge = e.target.closest('[data-edge]');
    const middle = e.button === 1, right = e.button === 2;

    if (right || middle || spaceDown) {
      pan = { sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y, moved: false };
      $stage.setPointerCapture(e.pointerId); return;
    }
    if (e.button !== 0) return;

    if (viewMode === 'harness') {
      const chip = e.target.closest('.hchip');
      if (chip) {
        const id = chip.dataset.id;
        if (!selection.has(id)) select(id, e.shiftKey);
        else if (e.shiftKey) { selection.delete(id); render(); onSelect([...selection]); return; }
        // тянем весь выбор; позиции чипов живут в Harness, координаты холста не трогаем
        const ids = [...selection].filter(i => window.Graph.getNode(i) && window.Harness.positionOf(i));
        const moving = new Set(ids);
        hdrag = {
          ids, start: toGraph(e.clientX, e.clientY),
          origin: ids.map(i => { const p = window.Harness.positionOf(i); return { id: i, x: p.x, y: p.y, w: p.w, h: p.h }; }),
          statics: window.Harness.chipRects().filter(r => !moving.has(r.id)),
          moved: false,
        };
        return;
      }
      if (edge) return select(edge.dataset.edge, e.shiftKey);
      if (e.pointerType === 'touch') return startTouchPan(e);   // по пустому месту — пальцем тянем холст
      return clearSelection();
    }

    if (port) {
      e.stopPropagation();
      const n = window.Graph.getNode(port.dataset.node);
      link = {
        node: n.id, port: port.dataset.port, dir: port.dataset.dir, kind: port.dataset.kind,
        origin: portPos(n, port.dataset.dir, port.dataset.port), cur: null,
      };
      $stage.classList.add('linking');
      return;
    }

    if (node) {
      const id = node.dataset.id;
      if (!selection.has(id)) select(id, e.shiftKey);
      else if (e.shiftKey) { selection.delete(id); render(); onSelect([...selection]); return; }
      const ids = [...selection].filter(i => window.Graph.getNode(i));
      const moving = new Set(ids);
      drag = {
        ids, start: toGraph(e.clientX, e.clientY),
        origin: ids.map(i => { const n = window.Graph.getNode(i); return { id: i, x: n.x, y: n.y, w: NODE_W, h: nodeHeight(n) }; }),
        statics: window.Graph.state.nodes.filter(n => !moving.has(n.id)).map(nodeRect),
        moved: false,
      };
      return;
    }

    if (edge) { select(edge.dataset.edge, e.shiftKey); return; }

    if (e.pointerType === 'touch') return startTouchPan(e);   // одним пальцем — панорама (рамка выделения — мышью)
    band = { sx: e.clientX, sy: e.clientY, additive: e.shiftKey };
    if (!e.shiftKey) clearSelection();
  }

  function onPointerMove(e) {
    if (e.pointerType === 'touch' && pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch) {
      if (pointers.size < 2) return;
      const p = [...pointers.values()];
      const d = Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y) || 1;
      const mx = (p[0].x + p[1].x) / 2, my = (p[0].y + p[1].y) / 2;
      const k = Math.min(2.4, Math.max(0.1, pinch.k0 * (d / pinch.d0)));
      // граф-точка под исходной серединой пальцев остаётся под текущей серединой (зум + пан)
      const gx = (pinch.mx - pinch.ox - pinch.vx) / pinch.k0;
      const gy = (pinch.my - pinch.oy - pinch.vy) / pinch.k0;
      view.k = k;
      view.x = (mx - pinch.ox) - gx * k;
      view.y = (my - pinch.oy) - gy * k;
      applyView();
      return;
    }
    if (pan) {
      view.x = pan.vx + (e.clientX - pan.sx); view.y = pan.vy + (e.clientY - pan.sy);
      if (Math.abs(e.clientX - pan.sx) + Math.abs(e.clientY - pan.sy) > 3) pan.moved = true;
      applyView(); return;
    }
    if (hdrag) {
      const g = toGraph(e.clientX, e.clientY);
      const dx = g.x - hdrag.start.x, dy = g.y - hdrag.start.y;
      if (Math.abs(dx) + Math.abs(dy) > 1) hdrag.moved = true;
      let cx = 0, cy = 0;
      if (collide && hdrag.statics.length) {
        const boxes = hdrag.origin.map(o => ({ x: o.x + dx, y: o.y + dy, w: o.w, h: o.h }));
        const corr = window.Collide.resolveBlock(boxes, hdrag.statics, COLLIDE_GAP);
        cx = corr.x; cy = corr.y;
      }
      for (const o of hdrag.origin) window.Harness.setManual(o.id, o.x + dx + cx, o.y + dy + cy);
      window.Harness.redraw(selection);
      return;
    }
    if (drag) {
      const g = toGraph(e.clientX, e.clientY);
      const dx = g.x - drag.start.x, dy = g.y - drag.start.y;
      if (Math.abs(dx) + Math.abs(dy) > 1) drag.moved = true;
      // коллизии «блок»: группу отжимаем от неподвижных узлов, соседи стоят
      let cx = 0, cy = 0;
      if (collide && drag.statics.length) {
        const boxes = drag.origin.map(o => ({ x: o.x + dx, y: o.y + dy, w: o.w, h: o.h }));
        const corr = window.Collide.resolveBlock(boxes, drag.statics, COLLIDE_GAP);
        cx = corr.x; cy = corr.y;
      }
      for (const o of drag.origin) {
        const n = window.Graph.getNode(o.id); if (!n) continue;
        n.x = snapv(o.x + dx + cx); n.y = snapv(o.y + dy + cy);
        const el = $nodes.querySelector(`[data-id="${o.id}"]`);
        if (el) { el.style.left = n.x + 'px'; el.style.top = n.y + 'px'; }
      }
      renderEdges(); return;
    }
    if (link) {
      link.cur = toGraph(e.clientX, e.clientY);
      const p = document.elementFromPoint(e.clientX, e.clientY);
      const hit = p && p.closest ? p.closest('.port') : null;
      $nodes.querySelectorAll('.port.hot').forEach(x => x.classList.remove('hot'));
      if (hit && hit.dataset.kind === link.kind && hit.dataset.dir !== link.dir) hit.classList.add('hot');
      renderEdges(); return;
    }
    if (band) {
      const x = Math.min(band.sx, e.clientX), y = Math.min(band.sy, e.clientY);
      const w = Math.abs(e.clientX - band.sx), h = Math.abs(e.clientY - band.sy);
      const r = $stage.getBoundingClientRect();
      Object.assign($marquee.style, { left: (x - r.left) + 'px', top: (y - r.top) + 'px', width: w + 'px', height: h + 'px' });
      $marquee.hidden = w < 4 && h < 4;
    }
  }

  function onPointerUp(e) {
    if (e.pointerType === 'touch') pointers.delete(e.pointerId);
    if (pinch && pointers.size < 2) {
      pinch = null;
      if (pointers.size === 1) {          // один палец остался — плавно продолжаем панорамой, без скачка
        const q = [...pointers.values()][0];
        pan = { sx: q.x, sy: q.y, vx: view.x, vy: view.y, moved: true };
      }
      return;
    }
    if (pinch) return;                    // ещё два+ пальца — ждём

    if (pan) { const tap = pan.tapClear && !pan.moved; pan = null; if (tap) clearSelection(); return; }

    if (hdrag) {
      const moved = hdrag.moved; hdrag = null;
      if (moved) window.Harness.render(selection);   // осадить ярлыки зон/шин после переноса
      return;
    }
    if (drag) {
      if (drag.moved) onChange('move');
      drag = null; return;
    }

    if (link) {
      const p = document.elementFromPoint(e.clientX, e.clientY);
      const hit = p && p.closest ? p.closest('.port') : null;
      $stage.classList.remove('linking');
      $nodes.querySelectorAll('.port.hot').forEach(x => x.classList.remove('hot'));
      if (hit && hit.dataset.dir !== link.dir) {
        const a = { node: link.node, port: link.port }, b = { node: hit.dataset.node, port: hit.dataset.port };
        const res = link.dir === 'out' ? window.Graph.addEdge(a, b) : window.Graph.addEdge(b, a);
        if (res.error) window.App.toast(res.error, 'err'); else onChange('connect');
        link = null; render();
      } else if (!hit) {
        const from = { node: link.node, port: link.port, dir: link.dir, kind: link.kind };
        const gp = toGraph(e.clientX, e.clientY);
        link = null; renderEdges();
        openQuickAdd(e.clientX, e.clientY, gp, from);
      } else { link = null; renderEdges(); }
      return;
    }

    if (band) {
      const w = Math.abs(e.clientX - band.sx), h = Math.abs(e.clientY - band.sy);
      if (w > 4 || h > 4) {
        const a = toGraph(Math.min(band.sx, e.clientX), Math.min(band.sy, e.clientY));
        const b = toGraph(Math.max(band.sx, e.clientX), Math.max(band.sy, e.clientY));
        const inside = window.Graph.state.nodes.filter(n =>
          n.x + NODE_W > a.x && n.x < b.x && n.y + nodeHeight(n) > a.y && n.y < b.y).map(n => n.id);
        select(inside, band.additive);
      }
      $marquee.hidden = true; band = null;
    }
  }

  function setSnap(v) { snap = v; }
  function getSnap() { return snap; }
  function setCollide(v) { collide = !!v; if (window.Harness) window.Harness.setCollide(collide); }
  function getCollide() { return collide; }

  return {
    init, render, renderEdges, select, clearSelection, deleteSelection, duplicateSelection,
    autoLayout, fit, centerOn, revealOn, zoomAt, setSnap, getSnap, setCollide, getCollide,
    setViewMode, getViewMode, selection, NODE_W,
  };
})();
