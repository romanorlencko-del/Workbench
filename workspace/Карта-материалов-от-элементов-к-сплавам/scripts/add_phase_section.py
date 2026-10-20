import sys
p = sys.argv[1]
t = open(p).read()
def rep(old, new):
    global t
    assert t.count(old) == 1, old[:60]
    t = t.replace(old, new)

# CSS
rep("[data-dash-source-state=empty]{color:transparent}",
    ".lx-phase{min-height:300px}\n#dash-root .lx-phase a{color:inherit}\n[data-dash-source-state=empty]{color:transparent}")

# new card before the table
rep('  <section class="lx-card" id="table">',
'''  <section class="lx-card" id="phases">
    <h2>Агрегатные состояния при нагреве (1 атм)</h2>
    <p class="lx-note">От 25 °C вправо: твёрдое → интервал плавления (солидус–ликвидус) → жидкое → кипение; × — разложение или сублимация без жидкой фазы. Отсортировано по началу перехода. Наведите на строку — путь при нагреве и источник.</p>
    <div class="lx-legend lx-legph"></div>
    <div class="lx-box lx-phase dash-skeleton" data-source="states materials"></div>
  </section>

  <section class="lx-card" id="table">''')

# table columns
rep('''          <th data-field="source" class="lx-narrow">Источник</th>''',
'''          <th data-field="source" class="lx-narrow">Источник</th>
          <th data-source="states" data-field="state_25C" class="lx-narrow">При 25 °C</th>
          <th data-source="states" data-field="heating_path">Нагрев (1 атм)</th>''')

# table: values from states for its columns
rep("    const fields = [...root.querySelectorAll('.lx-table th')].map((t) => [t.dataset.field, t.classList.contains('lx-narrow')]);",
"""    const fields = [...root.querySelectorAll('.lx-table th')].map((t) => [t.dataset.field, t.classList.contains('lx-narrow')]);
    const S = dash.data('states'), st = new Map(S.status === 'ok' ? S.data.map((s) => [s.id, s]) : []);
    const STF = ['state_25C', 'heating_path'];
    const val = (r, f) => (STF.includes(f) ? (st.get(r.id) || {})[f] : r[f]);""")
rep("    if (query) rows = rows.filter((r) => fields.some(([f]) => String(r[f] ?? '').toLowerCase().includes(query)));",
    "    if (query) rows = rows.filter((r) => fields.some(([f]) => String(val(r, f) ?? '').toLowerCase().includes(query)));")
rep("      return String(a[sortKey] ?? '').localeCompare(String(b[sortKey] ?? ''), 'ru') * sortDir;",
    "      return String(val(a, sortKey) ?? '').localeCompare(String(val(b, sortKey) ?? ''), 'ru') * sortDir;")
rep("td.textContent = f === 'elements' ? String(r[f]).split(';').join(', ') : (r[f] ?? '—');",
    "td.textContent = f === 'elements' ? String(r[f]).split(';').join(', ') : (val(r, f) ?? '—');")

# phase chart
rep("  // ---------- KPIs ----------",
r"""  // ---------- phases ----------
  const PH = [{ n: 'Твёрдое', c: dash.colors[0] }, { n: 'Плавление', c: dash.colors[1] }, { n: 'Жидкое', c: dash.colors[2] }];
  root.querySelector('.lx-legph').replaceChildren(...PH.map((s) => { const e = document.createElement('span'); const w = document.createElement('i'); w.className = 'lx-sw'; w.style.background = s.c; e.append(w, s.n); return e; }),
    ...[['●', 'Кипение'], ['×', 'Разложение / сублимация']].map(([g, n]) => { const e = document.createElement('span'); e.textContent = g + ' ' + n; return e; }));
  const tC = (v) => nf.format(v) + ' °C';
  function drawPhases() {
    const box = root.querySelector('.lx-phase');
    const S = dash.data('states'), M = dash.data('materials');
    if (S.status === 'error' || M.status === 'error') return fail(box);
    if (S.status !== 'ok' || M.status !== 'ok') return;
    box.classList.remove('dash-skeleton');
    const st = new Map(S.data.map((s) => [s.id, s]));
    const data = filtered(M.data).filter((m) => st.has(m.id)).map((m) => {
      const s = st.get(m.id), ml = num(s.melt_low_C), mh = num(s.melt_high_C) ?? ml, b = num(s.boil_C), dc = num(s.decomp_C);
      const first = d3.min([ml, dc, b].filter((v) => v !== null));
      return { m, s, ml, mh, b, dc, first };
    }).filter((d) => d.first !== undefined).sort((a, b) => a.first - b.first);
    box.querySelectorAll('svg,.lx-empty').forEach((e) => e.remove());
    if (!data.length) { const p = document.createElement('div'); p.className = 'lx-fail lx-empty'; p.textContent = 'Нет данных для выбранного фильтра'; box.append(p); return; }
    const w = Math.max(260, box.clientWidth), rh = 36, top = 22, h = top + data.length * rh + 4;
    box.style.minHeight = h + 'px';
    const max = d3.max(data, (d) => d3.max([d.ml, d.mh, d.b, d.dc].filter((v) => v !== null)));
    const x = d3.scaleLinear([0, Math.max(500, max * 1.04)], [8, w - 14]);
    const svg = d3.select(box).append('svg').attr('width', '100%').attr('viewBox', `0 0 ${w} ${h}`).style('display', 'block');
    const tk = x.ticks(Math.max(3, Math.floor(w / 90)));
    svg.append('g').selectAll('line').data(tk).join('line').attr('x1', (d) => x(d)).attr('x2', (d) => x(d)).attr('y1', top - 4).attr('y2', h).style('stroke', 'var(--cds-chart-grid)');
    svg.append('g').selectAll('text').data(tk).join('text').attr('x', (d) => x(d)).attr('y', 10).attr('text-anchor', 'middle').text((d) => tC(d)).style('font-size', '10px').style('fill', 'var(--color-fg-muted)');
    const g = svg.append('g').selectAll('g').data(data).join('g').attr('transform', (d, i) => `translate(0,${top + i * rh})`);
    g.append('text').attr('x', 8).attr('y', 11).text((d) => d.m.name).style('font-size', '11px').style('fill', 'var(--color-fg)');
    const y = 22, bh = 8;
    const seg = (sel, a, b, c) => sel.append('rect').attr('x', x(a)).attr('y', y - bh / 2).attr('height', bh).attr('width', Math.max(2, x(b) - x(a))).attr('rx', 3).style('fill', c);
    g.each(function (d) {
      const gg = d3.select(this);
      seg(gg, 25, d.first, PH[0].c);
      if (d.ml !== null && d.ml <= d.first + 0.5) {
        seg(gg, d.ml, Math.max(d.mh, d.ml + 1), PH[1].c);
        if (d.b !== null && d.b > d.mh) seg(gg, d.mh, d.b, PH[2].c).attr('opacity', 0.55);
      }
      if (d.b !== null) gg.append('circle').attr('cx', x(d.b)).attr('cy', y).attr('r', 4.5).style('fill', 'var(--color-panel)').style('stroke', PH[2].c).attr('stroke-width', 2);
      if (d.dc !== null) gg.append('text').attr('x', x(d.dc)).attr('y', y).attr('dy', '0.35em').attr('text-anchor', 'middle').text('×').style('font-size', '15px').style('font-weight', 600).style('fill', 'var(--color-fg)');
    });
    const lines = (d) => {
      const out = ['При 25 °C: ' + (d.s.state_25C ?? '—')];
      if (d.ml !== null) out.push('Плавление: ' + (d.mh !== null && d.mh !== d.ml ? nf.format(d.ml) + '–' + tC(d.mh) : tC(d.ml)));
      if (d.b !== null) out.push('Кипение: ' + tC(d.b));
      if (d.dc !== null) out.push('Разложение / сублимация: ' + tC(d.dc));
      out.push(String(d.s.heating_path ?? ''));
      if (d.s.note) out.push(String(d.s.note));
      if (d.s.source) out.push('Источник: ' + String(d.s.source));
      return out;
    };
    g.append('rect').attr('width', w).attr('height', rh).style('fill', 'transparent')
      .on('pointermove', (ev, d) => showTip(box, ev, d.m.name, lines(d))).on('pointerleave', () => hideTip(box))
      .on('click', (ev, d) => showTip(box, ev, d.m.name, lines(d)));
  }

  // ---------- KPIs ----------""")

rep("    drawKpis(); drawGraph(); drawBars(); drawLadders(); drawTable();",
    "    drawKpis(); drawGraph(); drawBars(); drawLadders(); drawPhases(); drawTable();")
open(p, 'w').write(t)
print('ok', len(t))
