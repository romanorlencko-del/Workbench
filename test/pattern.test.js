/* Узоры: учёт повторяющихся кусков схемы — без браузера. */
const { loadEngine, suite, node } = require('./harness');
const { Graph: G, BLOCKS: B } = loadEngine();
const { ok, report } = suite();

const run = (nodes, stage) => {
  G.fromJSON({ version: 1, name: 't', meta: { stage: stage || 'wiring' }, nodes, edges: [], seq: 99 });
  return G.validate();
};
const has = (i, lvl, re) => i.some(x => x.level === lvl && re.test(x.text));
const dump = i => i.map(x => `${x.level}: ${x.text}`).join('\n       ');

const PAT = (varies) => node('pat', 'pattern', { name: 'приём', purpose: 'принять и проверить', varies: varies || [] });
// два повтора одной роли: одинаковые, кроме source
const inp = (id, cas, over) => node(id, 'input', Object.assign(
  { kind: 'api', source: 'https://a/' + cas, interval_s: 60.000,
    pattern: 'приём', pattern_role: 'вход', pattern_case: cas }, over || {}));

console.log('\n— поле узора там же, где единица развёртывания');
{
  const withDeploy = Object.keys(B.TYPES).filter(t => (B.TYPES[t].params || []).some(p => p.key === 'unit'));
  const withPat = Object.keys(B.TYPES).filter(t => (B.TYPES[t].params || []).some(p => p.key === 'pattern'));
  ok('наборы совпадают (' + withPat.length + ' блоков)',
     withDeploy.length === withPat.length && withDeploy.every(t => withPat.includes(t)),
     'unit: ' + withDeploy.join(',') + '\n       pattern: ' + withPat.join(','));
  ok('ключи не задвоились', Object.keys(B.TYPES).every(t => {
    const k = (B.TYPES[t].params || []).map(p => p.key); return new Set(k).size === k.length; }));
  const f = (B.TYPES.input.params || []).find(p => p.key === 'pattern_role');
  ok('роль скрыта, пока узор не назван', !f.when({}) && !!f.when({ pattern: 'приём' }));
  ok('роль обязательна, когда узор назван', f.required === true);
}

console.log('\n— объявление узора');
{
  const i = run([PAT(), node('p2', 'pattern', { name: 'приём' })]);
  ok('дубль имени — ошибка', has(i, 'err', /объявлен дважды/), dump(i));
}
{
  const i = run([PAT()]);
  ok('на узор никто не ссылается — подсказка', has(i, 'info', /не ссылается ни один блок/), dump(i));
}
{
  const i = run([PAT(['source']), inp('a', 'заказы')]);
  ok('повтор всего один — подсказка', has(i, 'info', /повтор всего один/), dump(i));
}
{
  const i = run([inp('a', 'заказы'), inp('b', 'платежи')]);
  ok('узор не объявлен вовсе — про «нет в плане» молчим',
     !has(i, 'warn', /узора «приём» нет в плане/), dump(i));
}
{
  const i = run([PAT(), node('x', 'input', { kind: 'api', source: 's', pattern: 'другой', pattern_role: 'r', pattern_case: 'c' })]);
  ok('ссылка на несуществующий узор — предупреждение', has(i, 'warn', /узора «другой» нет в плане/), dump(i));
}
{
  const i = run([PAT(['source']), inp('a', 'заказы'), inp('b', 'заказы')]);
  ok('роль повтора занята дважды — ошибка', has(i, 'err', /уже занята блоком/), dump(i));
}

console.log('\n— расхождение повторов');
{
  const i = run([PAT(['source']), inp('a', 'заказы'), inp('b', 'платежи')]);
  ok('отличается только объявленное — тихо', !has(i, 'warn', /повторы разошлись/), dump(i));
}
{
  const i = run([PAT(['source']), inp('a', 'заказы'), inp('b', 'платежи', { interval_s: 300.000 })]);
  ok('незаявленное отличие — предупреждение', has(i, 'warn', /повторы разошлись/), dump(i));
  ok('в тексте видно поле и оба значения',
     i.some(x => /Интервал/.test(x.text) && /60/.test(x.text) && /300/.test(x.text)), dump(i));
}
{
  const i = run([PAT(['source', 'interval_s']), inp('a', 'заказы'), inp('b', 'платежи', { interval_s: 300.000 })]);
  ok('внесли поле в «что отличается» — замолчало', !has(i, 'warn', /повторы разошлись/), dump(i));
}
{
  const i = run([PAT(['source']), inp('a', 'заказы'), inp('b', 'платежи'),
                 node('c', 'sink', { channel: 'api', target: 't', pattern: 'приём', pattern_role: 'выход', pattern_case: 'заказы' })]);
  ok('роль есть не во всех повторах — предупреждение', has(i, 'warn', /роли «выход» нет в «платежи»/), dump(i));
}
{
  const i = run([PAT(['source']), inp('a', 'заказы'),
                 node('b', 'process', { op: 'map', rule: 'r', pattern: 'приём', pattern_role: 'вход', pattern_case: 'платежи' })]);
  ok('одна роль разными блоками — ошибка', has(i, 'err', /сделаны разными блоками/), dump(i));
}

console.log('\n— старые планы не шумят');
{
  const i = run([node('a', 'input', { kind: 'api', source: 's' }, { notes: 'z' })]);
  ok('блок без узора — ни одной придирки', !has(i, 'warn', /узор/i) && !has(i, 'err', /узор/i), dump(i));
}
{
  const i = run([node('p', 'pattern', { name: 'приём' }, { notes: '' })]);
  ok('описатель не требует комментария', !has(i, 'info', /нет комментария/), dump(i));
}

report();
