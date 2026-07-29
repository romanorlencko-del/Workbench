/* Форма связей между повторами узора — без браузера. */
const { loadEngine, suite, node } = require('./harness');
const { Graph: G, BLOCKS: B } = loadEngine();
const { ok, report } = suite();

const run = (nodes, edges) => {
  G.fromJSON({ version: 1, name: 't', meta: { stage: 'wiring' }, nodes, edges: edges || [], seq: 99 });
  return G.validate();
};
const has = (i, lvl, re) => i.some(x => x.level === lvl && re.test(x.text));
const dump = i => i.map(x => `${x.level}: ${x.text}`).join('\n       ');

const PAT = () => node('pat', 'pattern', { name: 'приём', purpose: 'принять и проверить',
  varies: ['source', 'topic'] });
/* повтор = вход → проверка → СВОЯ шина; у каждого повтора шина отдельная */
const trio = cas => [
  node('in_' + cas, 'input', { kind: 'api', source: 'https://a/' + cas,
    pattern: 'приём', pattern_role: 'вход', pattern_case: cas }),
  node('ch_' + cas, 'process', { op: 'map', rule: 'r',
    pattern: 'приём', pattern_role: 'проверка', pattern_case: cas }),
  node('b_' + cas, 'broker', { topic: 't.' + cas }),
];
const wire = cas => [
  { id: 'w1' + cas, kind: 'flow', from: { node: 'in_' + cas, port: 'out' }, to: { node: 'ch_' + cas, port: 'in' } },
  { id: 'w2' + cas, kind: 'flow', from: { node: 'ch_' + cas, port: 'out' }, to: { node: 'b_' + cas, port: 'in' } },
];
const base = () => ({
  nodes: [PAT()].concat(trio('заказы'), trio('платежи')),
  edges: wire('заказы').concat(wire('платежи')),
});

console.log('\n— форма одинаковая');
{
  const b = base();
  const i = run(b.nodes, b.edges);
  ok('разные соседи того же типа — тихо (сравниваем по типу, а не по id)',
     !has(i, 'warn', /собраны по-разному/), dump(i));
}

console.log('\n— форма разошлась');
{
  const b = base();
  b.edges.push({ id: 'extra', kind: 'flow', from: { node: 'in_платежи', port: 'out' }, to: { node: 'b_платежи', port: 'in' } });
  const i = run(b.nodes, b.edges);
  ok('лишний шаг мимо проверки — поймано', has(i, 'warn', /лишняя связь/), dump(i));
  ok('в тексте названы роль и сосед',
     i.some(x => /«вход» → Брокер/.test(x.text)), dump(i));
}
{
  const b = base();
  b.edges = b.edges.filter(e => e.id !== 'w1платежи');
  const i = run(b.nodes, b.edges);
  ok('пропущенный шаг — поймано', has(i, 'warn', /есть связь .*, а в .* её нет/), dump(i));
}
{
  // ошибка уведена в изолятор только у одного повтора
  const b = base();
  b.nodes.push(node('dlq', 'dlq', { name: 'd' }));
  b.nodes.find(n => n.id === 'in_заказы').params.on_error = 'route';
  b.edges.push({ id: 'err1', kind: 'flow', from: { node: 'in_заказы', port: 'err' }, to: { node: 'dlq', port: 'in' } });
  const i = run(b.nodes, b.edges);
  ok('провод ошибки есть только у одного — поймано',
     i.some(x => /по «err»/.test(x.text) && /собраны по-разному/.test(x.text)), dump(i));
}

console.log('\n— выключатель');
{
  const b = base();
  b.nodes[0].params.shape_varies = true;
  b.edges.push({ id: 'extra', kind: 'flow', from: { node: 'in_платежи', port: 'out' }, to: { node: 'b_платежи', port: 'in' } });
  const i = run(b.nodes, b.edges);
  ok('«связи у повторов разные» гасит форму', !has(i, 'warn', /собраны по-разному/), dump(i));
  b.nodes.find(n => n.id === 'ch_платежи').params.rule = 'другое';
  const j = run(b.nodes, b.edges);
  ok('…а сверка параметров при этом жива', has(j, 'warn', /повторы разошлись/), dump(j));
}

console.log('\n— не шумит на пустом');
{
  const b = base();
  const i = run(b.nodes.filter(n => !n.id.startsWith('b_')),
                b.edges.filter(e => e.id.startsWith('w1')));
  ok('повторы без внешних соседей — тихо', !has(i, 'warn', /собраны по-разному/), dump(i));
}
{
  const i = run([node('a', 'input', { kind: 'api', source: 's' }, { notes: 'z' })]);
  ok('плана без узоров не касается', !has(i, 'warn', /собраны по-разному/), dump(i));
}

report();
