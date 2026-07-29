/* Перемножение узора и окружений — без браузера. */
const { loadEngine, suite, node } = require('./harness');
const { Graph: G, BLOCKS: B } = loadEngine();
const { ok, report } = suite();

const run = nodes => {
  G.fromJSON({ version: 1, name: 't', meta: { stage: 'wiring' }, nodes, edges: [], seq: 99 });
  return G.validate();
};
const has = (i, lvl, re) => i.some(x => x.level === lvl && re.test(x.text));
const dump = i => i.map(x => `${x.level}: ${x.text}`).join('\n       ');

const ENVS = () => [ node('e_prod', 'env', { name: 'prod', base: true }),
                     node('e_dev', 'env', { name: 'dev' }) ];
const PAT = over => node('pat', 'pattern', Object.assign(
  { name: 'приём', varies: ['source'] }, over || {}));
const inp = (cas, over) => node('in_' + cas, 'input', Object.assign(
  { kind: 'api', source: 'https://a/' + cas, interval_s: 60.000,
    pattern: 'приём', pattern_role: 'вход', pattern_case: cas }, over || {}));
const two = (a, b) => ENVS().concat([inp('заказы', a), inp('платежи', b)]);

console.log('\n— построчная сверка отличий у повторов');
{
  // адрес объявлен отличающимся между повторами → его dev-переопределение
  // законно разное, но ОБЯЗАНО быть у обоих
  const i = run([PAT()].concat(two(
    { env_over: [{ env: 'dev', key: 'source', value: 'http://localhost/mock/orders' }] },
    { env_over: [{ env: 'dev', key: 'source', value: 'http://localhost/mock/pay' }] })));
  ok('разные значения у отличающегося ключа — тихо', !has(i, 'warn', /повторы разошлись/), dump(i));
  ok('и env_over больше НЕ надо вносить в «что отличается»',
     !((PAT().params.varies || []).includes('env_over')));
}
{
  const i = run([PAT()].concat(two(
    { env_over: [{ env: 'dev', key: 'source', value: 'http://localhost/mock/orders' }] },
    { env_over: [] })));
  ok('у одного повтора отличие забыли — поймано',
     has(i, 'warn', /есть не у всех \(нет в «платежи»\)/), dump(i));
}
{
  const i = run([PAT()].concat(two(
    { env_over: [{ env: 'dev', key: 'interval_s', value: '600.000' }] },
    { env_over: [{ env: 'dev', key: 'interval_s', value: '900.000' }] })));
  ok('общий ключ, а значения разные — поймано',
     has(i, 'warn', /отличие «Интервал, с» для «dev» разное/), dump(i));
}
{
  const i = run([PAT()].concat(two(
    { env_over: [{ env: 'dev', key: 'interval_s', value: '600.000' }] },
    { env_over: [{ env: 'dev', key: 'interval_s', value: '600.000' }] })));
  ok('общий ключ, значения совпали — тихо', !has(i, 'warn', /повторы разошлись/), dump(i));
}
{
  const i = run([PAT({ varies: ['source', 'env_over'] })].concat(two(
    { env_over: [{ env: 'dev', key: 'interval_s', value: '600.000' }] },
    { env_over: [] })));
  ok('старый выход — env_over в «что отличается» — по-прежнему всё гасит',
     !has(i, 'warn', /повторы разошлись/), dump(i));
}

console.log('\n— одна строка на все повторы, объявленная у узора');
{
  const i = run([PAT({ env_over: [{ env: 'dev', role: 'вход', key: 'interval_s', value: '600.000' }] })]
    .concat(two({}, {})));
  ok('объявили один раз — у повторов ничего не требуется', !has(i, 'warn', /повторы разошлись/), dump(i));
  ok('и ни одной ошибки на самой строке', !has(i, 'err', /./), dump(i));
}
{
  const i = run([PAT({ env_over: [{ env: 'dev', role: 'выход', key: 'interval_s', value: '600.000' }] })]
    .concat(two({}, {})));
  ok('роли нет в узоре — ошибка', has(i, 'err', /блоков с такой ролью в узоре нет/), dump(i));
}
{
  const i = run([PAT({ env_over: [{ env: 'dev', role: 'вход', key: 'replicas', value: '1' }] })]
    .concat(two({}, {})));
  ok('параметра нет у блоков этой роли — ошибка', has(i, 'err', /у роли «вход» \(input\) такого параметра нет/), dump(i));
}
{
  const i = run([PAT({ env_over: [{ env: 'dev', role: 'вход', key: 'interval_s', value: 'редко' }] })]
    .concat(two({}, {})));
  ok('негодное значение — ошибка', has(i, 'err', /«редко» не число/), dump(i));
}
{
  const i = run([PAT({ env_over: [{ env: 'stage', role: 'вход', key: 'interval_s', value: '600.000' }] })]
    .concat(two({}, {})));
  ok('незнакомое окружение — предупреждение', has(i, 'warn', /такого окружения в плане нет/), dump(i));
}
{
  const i = run([PAT({ env_over: [
      { env: 'dev', role: 'вход', key: 'interval_s', value: '600.000' },
      { env: 'dev', role: 'вход', key: 'interval_s', value: '900.000' }] })]
    .concat(two({}, {})));
  ok('одна и та же строка дважды — ошибка', has(i, 'err', /задан дважды/), dump(i));
}
{
  const i = run([PAT({ env_over: [{ env: 'dev', role: 'вход', key: 'interval_s', value: '600.000' }] })]
    .concat(two({ env_over: [{ env: 'dev', key: 'interval_s', value: '120.000' }] }, {})));
  ok('исключение из общего правила — подсказка, а не ошибка',
     has(i, 'info', /задано и у узора .* и здесь .* берётся значение блока/), dump(i));
  ok('и это не считается расхождением повторов', !has(i, 'warn', /повторы разошлись/), dump(i));
}

console.log('\n— старые планы');
{
  const i = run([node('a', 'input', { kind: 'api', source: 's' }, { notes: 'z' })]);
  ok('без узоров и окружений — тихо', !i.some(x => /узор|окружени/i.test(x.text)), dump(i));
}

report();
