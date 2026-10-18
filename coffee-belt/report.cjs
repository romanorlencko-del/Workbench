// Собирает PDF-отчёт по карте: берёт отрисованные блоки из build/standalone.html
// (карту, календарь, структуру обработки, паспорта и графики всех 12 стран),
// раскладывает их по листам A4 и печатает в build/report-raw.pdf.
// Данные для вложений сохраняет в build/data.json — их добавляет attach.py.
// Нужен Playwright с Chromium; шрифты тянутся с Google Fonts, без сети будут системные.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BUILD = path.join(__dirname, 'build');
const SEASONS = ['2021/22', '2022/23', '2023/24', '2024/25', '2025/26', '2026/27'];
const WORLD_USDA = 189.7, WORLD_ICO = 183.6;

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const num = (v, d = 2) => v.toLocaleString('ru-RU', { maximumFractionDigits: d });
const pct = (a, b) => (b / a - 1) * 100;
const fmtPct = v => (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toLocaleString('ru-RU', { maximumFractionDigits: 1 }) + '%';
// График из страницы → статичный для печати: убираем прозрачные слои наведения
// (без CSS страницы они красятся чёрным) и даём каждому графику свой узор штриховки.
const printChart = (svg, key) => svg
  .replace('id="trend-chart"', 'class="trend-chart"')
  .replace(/<rect class="hit"[^>]*><\/rect>/g, '')
  .replace(/id="hatch"/g, `id="hatch-${key}"`)
  .replace('class="bar fc"', `class="bar fc" style="fill:url(#hatch-${key})"`);
const allowed = url => url.startsWith('file:') || /^https:\/\/fonts\.(googleapis|gstatic)\.com\//.test(url);

async function collect(browser) {
  const p = await browser.newPage({ viewport: { width: 1280, height: 900 }, colorScheme: 'light' });
  await p.route('**/*', r => allowed(r.request().url()) ? r.continue() : r.abort());
  await p.goto('file://' + path.join(BUILD, 'standalone.html'));
  await p.waitForTimeout(600);
  const out = await p.evaluate(() => {
    const html = sel => document.querySelector(sel).outerHTML;
    return {
      css: [...document.querySelectorAll('style')].map(s => s.textContent).join('\n'),
      fonts: [...document.querySelectorAll('link[rel="stylesheet"]')].map(l => l.outerHTML).join('\n'),
      data: window.COFFEE_DATA,
      map: html('#map'), legends: html('.legends'),
      cal: html('#cal').replace(/ sel\b/g, ''), calKey: html('#cal-key'),
      mixLegend: html('#mix-legend'), bars: html('#bars').replace(/ sel\b/g, ''),
      multiples: html('#multiples'),
    };
  });
  await p.evaluate(() => document.getElementById('tm-total').click()); await p.waitForTimeout(100);
  out.totalTitle = await p.locator('#trend-title').innerHTML();
  out.totalChart = await p.locator('#trend-chart').evaluate(n => n.outerHTML);
  out.passports = {};
  for (const r of out.data) {
    await p.evaluate(iso => document.getElementById('sm-' + iso).click(), r.iso);  // без наведения: оно перерисовывает плитки await p.waitForTimeout(80);
    out.passports[r.iso] = {
      body: await p.locator('#passport').innerHTML(),
      trendTitle: await p.locator('#trend-title').innerHTML(),
      // у каждого графика свой узор штриховки — иначе в одном документе id совпадут
      chart: printChart(await p.locator('#trend-chart').evaluate(n => n.outerHTML), r.iso),
    };
  }
  await p.close();
  return out;
}

function reportHtml(c) {
  const R = [...c.data].sort((a, b) => b.vol - a.vol);
  const total = R.reduce((s, r) => s + r.vol, 0);
  const sums = SEASONS.map((_, i) => R.reduce((s, r) => s + r.hist[i], 0));
  const dynRows = R.map(r => `<tr><td>${esc(r.name)}${r.histNote ? '<sup>*</sup>' : ''}</td>${r.hist.map((v, i) =>
    `<td class="num${i === 5 ? ' fc' : ''}">${num(v)}</td>`).join('')}<td class="num">${fmtPct(pct(r.hist[0], r.hist[5]))}</td><td class="num">${fmtPct(pct(r.hist[4], r.hist[5]))}</td></tr>`).join('')
    + `<tr class="sum"><td>Сумма 12 стран</td>${sums.map((v, i) => `<td class="num${i === 5 ? ' fc' : ''}">${num(v, 1)}</td>`).join('')}<td class="num">${fmtPct(pct(sums[0], sums[5]))}</td><td class="num">${fmtPct(pct(sums[4], sums[5]))}</td></tr>`;
  const PROC_NAME = { washed: 'мытая', natural: 'натуральная', honey: 'хани', special: 'вет-халл / муссон' };
  const MON = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
  const keyRows = R.map(r => `<tr><td>${esc(r.name)}</td><td class="num">${num(r.vol)}</td><td class="num">${num(r.vol / WORLD_USDA * 100, 1)}%</td>
    <td class="num">${r.ara}/${r.rob}</td><td>${PROC_NAME[r.main]}</td><td class="num">${r.alt[0]}–${r.alt[1]}</td><td>${r.cal.map((l, i) => l === 3 ? MON[i] : null).filter(Boolean).join(', ')}</td>
    <td class="num">${fmtPct(pct(r.hist[0], r.hist[5]))}</td></tr>`).join('');
  const passportSheets = [];
  for (let i = 0; i < R.length; i += 2) {
    passportSheets.push(`<section class="sheet pp-sheet">${R.slice(i, i + 2).map(r => {
      const pp = c.passports[r.iso];
      return `<article class="panel pp-card">${pp.body.replace(/<p class="pp-hint">[\s\S]*?<\/p>/, '')}
        <div class="pp-sec"><span class="k">Урожай по сезонам, млн мешков</span><div class="trend-title">${pp.trendTitle}</div>${pp.chart}</div></article>`;
    }).join('')}</section>`);
  }
  const methods = [
    ['--p-washed', 'Мытая обработка (Washed / Wet)', 'Мякоть ягоды удаляется в депульпаторе, зерно ферментируется в воде и сушится. Даёт максимальную чистоту чашки, яркую кислотность и цветочные или цитрусовые ноты.', 'washed'],
    ['--p-natural', 'Натуральная сухая (Natural / Dry)', 'Ягода сушится целиком на солнце, на патио или африканских кроватях. Зерно впитывает сахара мякоти: плотное тело, сладость, ноты спелых ягод, тропических фруктов и шоколада.', 'natural'],
    ['--p-honey', 'Хани / Pulped Natural (Honey)', 'Кожица снимается, но часть клейковины (муциляжа) остаётся на зерне при сушке. Сладость натуральной обработки и чистая фруктовая кислинка мытой.', 'honey'],
    ['--p-special', 'Вет-халл (Giling Basah) и Муссонный', 'Индонезийский вет-халл: пергамент снимают при влажности зерна 30–35%, отсюда землистый, пряный вкус и густое тело. Индийский муссонный: зерно выдерживают под влажными ветрами Малабара.', 'special'],
  ].map(([c2, t, d, k]) => `<article class="panel card"><h3><span class="dot" style="background:var(${c2})"></span>${t}</h3><p>${d}</p>
    <div class="where"><b>В выборке (≥ 8% урожая):</b> ${esc(R.filter(r => r.mix[k] >= 8).map(r => `${r.name} ${r.mix[k]}%`).join(', '))}</div></article>`).join('');

  return `<!doctype html><html lang="ru" data-theme="light"><head><meta charset="utf-8">
<title>Кофейный пояс Земли — отчёт</title>${c.fonts}
<style>${c.css}
@page { size: A4 landscape; margin: 9mm 10mm 13mm; }
html, body { background: #fff; }
body { padding: 0 !important; font-size: 12px; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.rep { zoom: .74; }
.sheet { break-after: page; display: grid; gap: 14px; align-content: start; }
.sheet:last-child { break-after: auto; }
.s-cover { zoom: 1.04; }
table.dyn.key { font-size: 12px; }
table.dyn.key th { font-size: 10px; }
.s-cover .stats { gap: 8px 30px; }
.s-cover .stat.now .v { max-width: 52ch; }
.s-cal { zoom: 1; }
.s-cal .two { grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr); }
.s-cal table.cal { min-width: 0; }
table.dyn.key td, table.dyn.key th { padding: 4px 8px; }
.pp-sheet { zoom: 1.22; }
.s-last { zoom: 1.25; }
.panel { break-inside: avoid; }
.cover-head { display: grid; gap: 6px; }
.cover-head h1 { font-size: 34px; }
.two { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 14px; align-items: start; }
table.dyn { border-collapse: collapse; width: 100%; font-size: 13px; font-variant-numeric: tabular-nums; }
.dyn th, .dyn td { padding: 5px 8px; border-bottom: 1px solid var(--line); text-align: left; }
.dyn th { color: var(--muted); font-weight: 500; font-size: 11px; text-transform: uppercase; letter-spacing: .05em; }
.dyn .num { text-align: right; }
.dyn td.fc { background: var(--bg); }
.dyn tr.sum td { font-weight: 700; border-top: 1.5px solid var(--ink); }
.multiples { grid-template-columns: repeat(6, minmax(0, 1fr)); }
.sm.sel { border-color: var(--line); box-shadow: none; }
.pp-sheet { grid-template-columns: 1fr 1fr; }
.pp-card { display: block; columns: 2; column-gap: 18px; }
.pp-card > * { break-inside: avoid; margin-bottom: 11px; }
.pp-card .pp-mark, .pp-card > div:nth-child(2) { column-span: all; }
.pp-card .pp-code { font-size: 38px; }
.trend-chart { width: 100%; height: auto; display: block; }
.trend-chart .grid line { stroke: var(--line); stroke-width: 1; }
.trend-chart .axis text { fill: var(--muted); font-size: 12px; }
.trend-chart .bar { fill: var(--roast-hi); }
.trend-chart .bar.fc { stroke: var(--roast-hi); stroke-width: 1.5; }
.trend-chart .val { fill: var(--ink); font-size: 13px; font-weight: 600; }
.trend-chart .fc-lbl { fill: var(--muted); font-size: 11px; }
.trend-title { font-size: 12px; color: var(--ink-2); margin: 2px 0 4px; }
.trend-title b { font-size: 14px; }
.cards { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.src { margin: 0; padding-left: 18px; columns: 2; column-gap: 28px; font-size: 12.5px; color: var(--ink-2); }
.src li { break-inside: avoid; margin-bottom: 4px; }
.src b { color: var(--ink); font-weight: 600; }
.foot { max-width: none; }
</style></head><body><div class="rep">

<section class="sheet s-cover">
  <header class="cover-head">
    <div class="eyebrow">23.5° с.ш. — 23.5° ю.ш. · сезон 2026/27 · мешок 60 кг</div>
    <h1>Кофейный пояс Земли</h1>
    <p class="lede">Отчёт о выращивании и производстве кофе: 12 крупнейших стран-производителей, сорта, методы обработки зерна, календарь сбора и динамика урожая за шесть сезонов. Данные сверены 18 октября 2026.</p>
  </header>
  <div class="stats">
    <div class="stat"><span class="k">Урожай 12 стран, 2026/27</span><span class="v">${num(total, 1)}<small>млн мешков</small></span></div>
    <div class="stat"><span class="k">Доля мирового урожая</span><span class="v">≈${Math.round(total / WORLD_USDA * 100)}<small>%</small></span></div>
    <div class="stat"><span class="k">Мир, прогноз USDA 2026/27</span><span class="v">${num(WORLD_USDA, 1)}<small>млн</small></span></div>
    <div class="stat"><span class="k">Мир, оценка ICO 2025/26</span><span class="v">${num(WORLD_ICO, 1)}<small>млн</small></span></div>
    <div class="stat now"><span class="k">Главное</span><span class="v">Крупнейшие — Бразилия, Вьетнам, Колумбия. Быстрее всех с 2021/22 растёт Эфиопия: ${fmtPct(pct(c.data.find(r => r.iso === 'ETH').hist[0], c.data.find(r => r.iso === 'ETH').hist[5]))}.</span></div>
  </div>
  <section class="panel"><div class="panel-head"><div><h2>География производства и методы обработки</h2>
    <p class="sub">Цвет страны — урожай 2026/27 · Размер маркера — объём · Цвет маркера — основной метод обработки</p></div></div>
    ${c.map}${c.legends}</section>
</section>

<section class="sheet">
  <section class="panel"><div class="panel-head"><div><h2>Динамика производства по сезонам</h2>
    <p class="sub">Урожай в млн мешков по 60 кг · 2026/27 — прогноз USDA (выделен)</p></div></div>
    <div class="two">
      <div><div class="trend-title">${c.totalTitle}</div>${printChart(c.totalChart, 'total')}</div>
      <table class="dyn"><thead><tr><th>Страна</th>${SEASONS.map(s => `<th class="num">${s}</th>`).join('')}<th class="num">к 21/22</th><th class="num">к 25/26</th></tr></thead><tbody>${dynRows}</tbody></table>
    </div>
    <p class="foot" style="margin-top:8px">* Гватемала: ряд USDA только по арабике; робуста (≈0,13 млн мешков в год) не входит, поэтому на карте 3,26 млн.</p>
  </section>
  <section class="panel"><div class="panel-head"><div><h2>Тренд по странам</h2><p class="sub">Шкала у каждой страны своя, от нуля · подпись — урожай 2026/27 и изменение к 2021/22</p></div></div>${c.multiples}</section>
</section>

<section class="sheet s-cal">
 <div class="two">
  <section class="panel"><div class="panel-head"><div><h2>Календарь сбора урожая по месяцам</h2>
    <p class="sub">От межсезонья и малого сбора (Fly crop / Mitaca) до пика урожая · рамка — октябрь 2026</p></div></div>${c.cal}${c.calKey}</section>
  <section class="panel"><div class="panel-head"><div><h2>Структура методов обработки по странам</h2>
    <p class="sub">Доли мытой, натуральной, хани и специальной обработки, %</p></div></div>
    <div class="legend-row" style="font-size:12.5px;color:var(--ink-2);margin-bottom:12px">${c.mixLegend.replace(/^<div[^>]*>|<\/div>$/g, '')}</div>${c.bars}</section>
 </div>
  <section class="panel"><div class="panel-head"><div><h2>Ключевые цифры по странам</h2><p class="sub">Таблицы с полными данными вложены в этот PDF: CSV и JSON, панель «Вложения»</p></div></div>
    <table class="dyn key"><thead><tr><th>Страна</th><th class="num">Урожай 2026/27, млн мешков</th><th class="num">Доля мира</th>
    <th class="num">Арабика / робуста, %</th><th>Основная обработка</th><th class="num">Высота, м</th><th>Пик сбора</th><th class="num">К 2021/22</th></tr></thead>
    <tbody>${keyRows}</tbody></table></section>
</section>

${passportSheets.join('\n')}

<section class="sheet s-last">
  <div class="cards">${methods}</div>
  <section class="panel"><h2 style="margin-bottom:10px">Источники и методика</h2>
    <ol class="src">
      <li><b>USDA FAS, Coffee: World Markets and Trade</b>, июль 2026 — объёмы 2026/27, ряды 2021/22–2025/26, арабика и робуста по странам.</li>
      <li><b>USDA FAS, Coffee Annual</b> (обзоры атташе, май–июнь 2026) — Эфиопия, Индонезия, Уганда, Индия, Гондурас, Перу, Гватемала, Коста-Рика, Кения, Вьетнам, Бразилия.</li>
      <li><b>ICO, Coffee Market Report</b>, сентябрь 2026 — мировой урожай 2025/26: 183,6 млн мешков.</li>
      <li><b>CONAB</b>, 3-я оценка урожая 2026 (сентябрь 2026) — Бразилия 67,6 млн мешков.</li>
      <li><b>FNC</b>, итоги кофейного года 2025/26 (октябрь 2026) — Колумбия 12,65 млн мешков.</li>
      <li><b>StoneX, Helena Coffee</b> — альтернативные оценки по Гватемале и Вьетнаму.</li>
      <li><b>world-atlas 2.0.2</b> (Natural Earth, 1:110 млн) — контуры стран.</li>
    </ol>
    <p class="foot" style="margin-top:10px">Объёмы — прогноз USDA на 2026/27, в млн мешков по 60 кг. Доли методов обработки, высоты, сорта, профили чашки и сроки сбора — приблизительные отраслевые оценки, не официальная статистика. Цвет страны на карте закрашивает её целиком, хотя кофе растёт только в части регионов. Первоисточники USDA и ICO сверены по отраслевым публикациям; сами PDF-отчёты при подготовке были недоступны.</p>
  </section>
</section>

</div></body></html>`;
}

(async () => {
  fs.mkdirSync(BUILD, { recursive: true });
  const browser = await chromium.launch();
  const c = await collect(browser);
  fs.writeFileSync(path.join(BUILD, 'data.json'), JSON.stringify(c.data, null, 2));
  const html = reportHtml(c);
  fs.writeFileSync(path.join(BUILD, 'report.html'), html);
  const p = await browser.newPage({ colorScheme: 'light' });
  await p.route('**/*', r => allowed(r.request().url()) ? r.continue() : r.abort());
  await p.goto('file://' + path.join(BUILD, 'report.html'));
  await p.evaluate(() => document.fonts.ready);
  await p.pdf({
    path: path.join(BUILD, 'report-raw.pdf'), format: 'A4', landscape: true, printBackground: true,
    displayHeaderFooter: true, headerTemplate: '<span></span>',
    footerTemplate: '<div style="width:100%;font:8px sans-serif;color:#847a72;padding:0 10mm;display:flex;justify-content:space-between">' +
      '<span>Кофейный пояс Земли · данные на 18.10.2026</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>',
    margin: { top: '9mm', right: '10mm', bottom: '13mm', left: '10mm' },
  });
  await browser.close();
})();
