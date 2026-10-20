"""Добавить на страницу дашборда раздел «Сферы применения» (датасет apps).

Запуск из папки проекта: python3 scripts/add_apps_section.py dashboard/index.html
Правка разовая: второй запуск упадёт на проверке, что исходный фрагмент найден один раз.
"""
import sys

p = sys.argv[1]
t = open(p).read()


def rep(old, new):
    global t
    assert t.count(old) == 1, old[:70]
    t = t.replace(old, new)


# CSS
rep(".lx-phase{min-height:300px}",
    ".lx-phase{min-height:300px}\n.lx-apps{min-height:300px;overflow-x:auto}\n.lx-picked+.lx-picked{margin-left:var(--cds-gap-xs)}")

# новая карточка перед таблицей
rep('  <section class="lx-card" id="table">',
'''  <section class="lx-card" id="apps">
    <h2>Сферы применения: семейство × отрасль</h2>
    <p class="lx-note">Точка — семейство применяется в отрасли; крупнее — главная отрасль семейства. Цвет — уровень. Нажмите на отрасль, чтобы отфильтровать всю страницу; наведите на точку — техническое название и примеры.</p>
    <div class="lx-tools"><button class="lx-picked lx-picked-ind" hidden></button></div>
    <div class="lx-box lx-apps dash-skeleton" data-source="apps materials"></div>
  </section>

  <section class="lx-card" id="table">''')

# чип отрасли и в таблице
rep('''      <select class="lx-lvl" aria-label="Уровень"></select>
    </div>''',
'''      <select class="lx-lvl" aria-label="Уровень"></select>
      <button class="lx-picked lx-picked-ind" hidden></button>
    </div>''')

# колонки таблицы
rep('''        <thead><tr>
          <th data-field="name">Семейство</th>''',
'''        <thead><tr>
          <th data-field="name">Семейство</th>
          <th data-source="apps" data-field="tech_name">Техническое название</th>''')
rep('''          <th data-source="states" data-field="heating_path">Нагрев (1 атм)</th>''',
'''          <th data-source="states" data-field="heating_path">Нагрев (1 атм)</th>
          <th data-source="apps" data-field="applications">Применение</th>
          <th data-source="apps" data-field="designations" class="lx-narrow">Марки и стандарты</th>''')

# фильтр по отрасли во всех карточках
rep('''  const filtered = (rows) => {
    const p = dash.params();
    return rows.filter((m) => (!p.el || String(m.elements).split(';').includes(p.el)) && (!p.lvl || String(m.level) === String(p.lvl)));
  };''',
'''  const indsOf = (a) => (a && a.industries ? String(a.industries).split(';').map((s) => s.trim()).filter(Boolean) : []);
  const filtered = (rows) => {
    const p = dash.params(), A = dash.data('apps');
    const ind = p.ind && A.status === 'ok' ? new Set(A.data.filter((a) => indsOf(a).includes(p.ind)).map((a) => a.id)) : null;
    return rows.filter((m) => (!p.el || String(m.elements).split(';').includes(p.el)) && (!p.lvl || String(m.level) === String(p.lvl)) && (!ind || ind.has(m.id)));
  };
  const pickedInd = root.querySelectorAll('.lx-picked-ind');
  pickedInd.forEach((b) => b.addEventListener('click', () => dash.setParams({ ind: null })));
  const pickInd = (name) => dash.setParams({ ind: dash.params().ind === name ? null : name });''')

# таблица: значения из states и apps
rep('''    const S = dash.data('states'), st = new Map(S.status === 'ok' ? S.data.map((s) => [s.id, s]) : []);
    const STF = ['state_25C', 'heating_path'];
    const val = (r, f) => (STF.includes(f) ? (st.get(r.id) || {})[f] : r[f]);''',
'''    const byId = (id) => { const D = dash.data(id); return new Map(D.status === 'ok' ? D.data.map((s) => [s.id, s]) : []); };
    const ext = { states: byId('states'), apps: byId('apps') };
    const src = Object.fromEntries([...root.querySelectorAll('.lx-table th[data-source]')].map((t) => [t.dataset.field, t.dataset.source]));
    const val = (r, f) => (src[f] ? (ext[src[f]].get(r.id) || {})[f] : r[f]);''')

# матрица
rep("  // ---------- KPIs ----------",
r"""  // ---------- applications matrix ----------
  function drawApps() {
    const box = root.querySelector('.lx-apps');
    const A = dash.data('apps'), M = dash.data('materials');
    if (A.status === 'error' || M.status === 'error') return fail(box);
    if (A.status !== 'ok' || M.status !== 'ok') return;
    box.classList.remove('dash-skeleton');
    const ap = new Map(A.data.map((a) => [a.id, a]));
    const p = dash.params();
    const rows = filtered(M.data).filter((m) => ap.has(m.id));
    const count = new Map();
    A.data.forEach((a) => indsOf(a).forEach((s) => count.set(s, (count.get(s) || 0) + 1)));
    const cols = [...count.keys()].sort((a, b) => count.get(b) - count.get(a) || a.localeCompare(b, 'ru'));
    box.querySelectorAll('svg,.lx-empty').forEach((e) => e.remove());
    if (!rows.length || !cols.length) { const q = document.createElement('div'); q.className = 'lx-fail lx-empty'; q.textContent = 'Нет данных для выбранного фильтра'; box.append(q); return; }
    const svg = d3.select(box).append('svg').style('display', 'block');
    const lab = svg.append('g').selectAll('text').data(rows).join('text').text((m) => m.name).style('font-size', '11px').style('fill', 'var(--color-fg)');
    let lw = 0; lab.each(function () { lw = Math.max(lw, this.getComputedTextLength()); });
    const head = svg.append('g').selectAll('text').data(cols).join('text').text((c) => c + ' · ' + count.get(c)).style('font-size', '10px');
    let hw = 0; head.each(function () { hw = Math.max(hw, this.getComputedTextLength()); });
    const left = lw + 12, rh = 20, avail = Math.max(260, box.clientWidth);
    const cw = Math.max(18, Math.min(34, (avail - left - 8) / cols.length));
    const top = Math.ceil(hw * Math.SQRT1_2) + 14, w = Math.max(avail, left + cols.length * cw + 8 + hw * Math.SQRT1_2), h = top + rows.length * rh + 4;
    svg.attr('width', w).attr('height', h).attr('viewBox', `0 0 ${w} ${h}`);
    box.style.minHeight = h + 'px';
    const cx = (i) => left + i * cw + cw / 2, cy = (i) => top + i * rh + rh / 2;
    const band = svg.insert('g', ':first-child');
    if (p.ind && cols.includes(p.ind)) band.append('rect').attr('x', left + cols.indexOf(p.ind) * cw).attr('y', top - 4).attr('width', cw).attr('height', h - top).attr('rx', 4).style('fill', 'var(--cds-chart-grid)');
    band.selectAll('line').data(rows).join('line').attr('x1', left).attr('x2', left + cols.length * cw).attr('y1', (m, i) => cy(i)).attr('y2', (m, i) => cy(i)).style('stroke', 'var(--cds-chart-grid)').attr('stroke-width', 0.5);
    lab.attr('x', 0).attr('y', (m, i) => cy(i)).attr('dy', '0.35em');
    head.attr('transform', (c, i) => `translate(${cx(i)},${top - 8}) rotate(-45)`).style('cursor', 'pointer')
      .style('fill', (c) => (c === p.ind ? 'var(--color-fg)' : 'var(--color-fg-muted)')).style('font-weight', (c) => (c === p.ind ? 600 : 400))
      .on('click', (ev, c) => pickInd(c));
    const cells = [];
    rows.forEach((m, i) => indsOf(ap.get(m.id)).forEach((s, rank) => { const j = cols.indexOf(s); if (j >= 0) cells.push({ m, a: ap.get(m.id), s, rank, i, j }); }));
    svg.append('g').selectAll('circle').data(cells).join('circle').attr('cx', (d) => cx(d.j)).attr('cy', (d) => cy(d.i))
      .attr('r', (d) => (d.rank === 0 ? 6 : d.rank === 1 ? 5 : 3.5)).style('fill', (d) => dash.colors[Number(d.m.level) - 1])
      .attr('opacity', (d) => (!p.ind || d.s === p.ind ? 1 : 0.35)).style('cursor', 'pointer')
      .on('pointermove', (ev, d) => showTip(box, ev, d.m.name, [d.s + (d.rank === 0 ? ' — главная отрасль' : ''), String(d.a.tech_name || ''), 'Применение: ' + String(d.a.applications || '—')]))
      .on('pointerleave', () => hideTip(box))
      .on('click', (ev, d) => pickInd(d.s));
  }

  // ---------- KPIs ----------""")

rep("    picked.hidden = !p.el; picked.textContent = p.el ? 'Элемент: ' + p.el + ' ×' : '';",
    "    picked.hidden = !p.el; picked.textContent = p.el ? 'Элемент: ' + p.el + ' ×' : '';\n"
    "    pickedInd.forEach((b) => { b.hidden = !p.ind; b.textContent = p.ind ? 'Отрасль: ' + p.ind + ' ×' : ''; });")
rep("    drawKpis(); drawGraph(); drawBars(); drawLadders(); drawPhases(); drawTable();",
    "    drawKpis(); drawGraph(); drawBars(); drawLadders(); drawPhases(); drawApps(); drawTable();")

open(p, 'w').write(t)
print('ok', len(t))
