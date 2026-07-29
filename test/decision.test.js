/* Решения (почему именно так) — без браузера. */
const { loadEngine, suite, node } = require('./harness');
const { Graph: G, BLOCKS: B } = loadEngine();
const { ok, report } = suite();

const run = (nodes, stage) => {
  G.fromJSON({ version: 1, name: 't', meta: { stage: stage || 'wiring' }, nodes, edges: [], seq: 99 });
  return G.validate();
};
const has = (i, lvl, re) => i.some(x => x.level === lvl && re.test(x.text));
const dump = i => i.map(x => `${x.level}: ${x.text}`).join('\n       ');

const FULL = over => node('d1', 'decision', Object.assign({
  title: 'шина вместо прямого вызова', status: 'accepted', date: '2026-07-29',
  affects: ['orders-api'], context: 'пики валили биллинг',
  rejected: 'прямой вызов с повторами — падение биллинга всё равно валит приём',
  costs: 'согласованность стала отложенной', revisit: 'если поток упадёт ниже 5/с',
}, over || {}));
const UNIT = node('u1', 'unit', { name: 'orders-api' });

console.log('\n— описатель и его поля');
{
  const d = B.TYPES.decision;
  ok('портов нет', !d.inputs.length && !d.outputs.length);
  const f = (d.params || []).find(p => p.key === 'superseded_by');
  ok('«чем заменено» видно только у заменённых',
     !f.when({ status: 'accepted' }) && !!f.when({ status: 'superseded' }));
  const i = run([node('d', 'decision', { title: 'x', status: 'accepted', affects: [] }, { notes: '' })]);
  ok('описатель не требует комментария', !has(i, 'info', /нет комментария/), dump(i));
}

console.log('\n— привязка');
{
  const i = run([FULL(), UNIT]);
  ok('привязка к контуру — тихо', !has(i, 'warn', /непонятно, к чему относится/), dump(i));
}
{
  const i = run([FULL({ affects: ['нет-такого'] }), UNIT]);
  ok('привязка в никуда — предупреждение', has(i, 'warn', /непонятно, к чему относится/), dump(i));
}
{
  const i = run([FULL({ affects: [] })]);
  ok('без привязки — подсказка, что в задания не попадёт',
     has(i, 'info', /в задания исполнителям оно не попадёт/), dump(i));
}
{
  const i = run([FULL({ affects: ['приём'] }), node('p', 'pattern', { name: 'приём' }),
                 node('a', 'input', { kind: 'api', source: 's', pattern: 'приём', pattern_role: 'r', pattern_case: 'c' })]);
  ok('привязка к узору — тихо', !has(i, 'warn', /непонятно, к чему/), dump(i));
}
{
  const i = run([FULL({ affects: ['order'] }),
                 node('e', 'entity', { key: 'order', vars: ['ctx.order'], fields: [{ name: 'id', kind: 'string' }] })]);
  ok('привязка к сущности — тихо', !has(i, 'warn', /непонятно, к чему/), dump(i));
}
{
  const i = run([FULL({ affects: ['a'] }), node('a', 'input', { kind: 'api', source: 's' })]);
  ok('привязка к id блока — тихо', !has(i, 'warn', /непонятно, к чему/), dump(i));
}

console.log('\n— полнота записи');
{
  const i = run([FULL(), UNIT]);
  ok('всё заполнено — тихо', !has(i, 'info', /не записано —/), dump(i));
}
{
  const i = run([FULL({ rejected: '', revisit: '' }), UNIT]);
  ok('пробелы — ОДНО замечание, а не три',
     i.filter(x => /не записано —/.test(x.text)).length === 1, dump(i));
  ok('в нём перечислено, чего не хватает',
     i.some(x => /что отвергли/.test(x.text) && /что заставит пересмотреть/.test(x.text) &&
                 !/чем платим/.test(x.text)), dump(i));
}
{
  const i = run([FULL({ status: 'dropped', rejected: '', costs: '', revisit: '' }), UNIT]);
  ok('с отменённого полноту не спрашиваем', !has(i, 'info', /не записано —/), dump(i));
}

console.log('\n— замена и дубли');
{
  const i = run([FULL({ status: 'superseded', superseded_by: 'прямой вызов' }), UNIT]);
  ok('заменено несуществующим — предупреждение', has(i, 'warn', /такого решения в плане нет/), dump(i));
}
{
  const i = run([FULL({ status: 'superseded', superseded_by: 'прямой вызов' }), UNIT,
                 node('d2', 'decision', { title: 'прямой вызов', status: 'accepted', affects: ['orders-api'],
                   rejected: 'x', costs: 'y', revisit: 'z' })]);
  ok('заменено существующим — тихо', !has(i, 'warn', /такого решения в плане нет/), dump(i));
}
{
  const i = run([FULL(), node('d2', 'decision', { title: 'шина вместо прямого вызова', affects: ['orders-api'] }), UNIT]);
  ok('дубль заголовка — ошибка', has(i, 'err', /записано дважды/), dump(i));
}

console.log('\n— старые планы не шумят');
{
  const i = run([node('a', 'input', { kind: 'api', source: 's' }, { notes: 'z' }), UNIT]);
  ok('нет решений — ни одной придирки', !has(i, 'info', /решение/i) && !has(i, 'warn', /решени/i), dump(i));
}

report();
