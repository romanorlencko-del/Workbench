/* Окружения и отличия по ним — без браузера. */
const { loadEngine, suite, node } = require('./harness');
const { Graph: G, BLOCKS: B } = loadEngine();
const { ok, report } = suite();

const run = (nodes, stage) => {
  G.fromJSON({ version: 1, name: 't', meta: { stage: stage || 'wiring' }, nodes, edges: [], seq: 99 });
  return G.validate();
};
const has = (i, lvl, re) => i.some(x => x.level === lvl && re.test(x.text));
const dump = i => i.map(x => `${x.level}: ${x.text}`).join('\n       ');

const ENV = (name, over) => node('env_' + name, 'env', Object.assign({ name }, over || {}));
const UNIT = (over) => node('u1', 'unit', Object.assign({ name: 'orders-api', replicas: 1 }, over || {}));

console.log('\n— поле есть у всех семи блоков');
{
  const want = ['unit', 'monitor', 'broker', 'dlq', 'store', 'input', 'sink'];
  const got = want.filter(t => (B.TYPES[t].params || []).some(p => p.key === 'env_over'));
  ok('env_over у ' + want.join(', '), got.length === want.length, 'нашлось: ' + got.join(', '));
  const extra = Object.keys(B.TYPES).filter(t => (B.TYPES[t].params || []).some(p => p.key === 'env_over'));
  ok('и больше нигде — кроме узора (там отличия на все повторы)',
     extra.length === want.length + 1 && extra.includes('pattern'), 'всего: ' + extra.join(', '));
  const pit = ((B.TYPES.pattern.params || []).find(p => p.key === 'env_over') || {}).item || [];
  ok('у узора в строке есть роль, у блока нет',
     pit.some(f => f.key === 'role') &&
     !(((B.TYPES.input.params || []).find(p => p.key === 'env_over') || {}).item || []).some(f => f.key === 'role'));
  ok('ключи не задвоились', Object.keys(B.TYPES).every(t => {
    const k = (B.TYPES[t].params || []).map(p => p.key);
    return new Set(k).size === k.length;
  }));
}

console.log('\n— объявление окружений');
{
  const i = run([ENV('prod', { base: true }), ENV('prod')]);
  ok('дубль имени — ошибка', has(i, 'err', /объявлено дважды/), dump(i));
}
{
  const i = run([ENV('prod'), ENV('dev')]);
  ok('никто не базовый — предупреждение', has(i, 'warn', /не помечено базовым/), dump(i));
}
{
  const i = run([ENV('prod', { base: true }), ENV('dev', { base: true })]);
  ok('двое базовых — ошибка', has(i, 'err', /Базовыми помечены несколько/), dump(i));
}
{
  const i = run([ENV('prod', { base: true }), ENV('dev')]);
  ok('один базовый — тихо', !has(i, 'warn', /базовым/) && !has(i, 'err', /Базовыми/), dump(i));
}
{
  const i = run([ENV('prod', { base: true }), ENV('dev')]);
  ok('окружение без единого отличия — подсказка', has(i, 'info', /ничем не отличается/), dump(i));
}

console.log('\n— отличия исполнимы');
const base = over => [ENV('prod', { base: true }), ENV('dev'), UNIT({ env_over: over })];
{
  const i = run(base([{ env: 'dev', key: 'replicas', value: '3' }]));
  ok('число в числовое поле — тихо', !has(i, 'err', /не число/), dump(i));
}
{
  const i = run(base([{ env: 'dev', key: 'replicas', value: 'мало' }]));
  ok('не число в числовое поле — ошибка', has(i, 'err', /«мало» не число/), dump(i));
}
{
  const i = run(base([{ env: 'dev', key: 'replica', value: '3' }]));
  ok('опечатка в имени параметра — ошибка', has(i, 'err', /такого параметра нет/), dump(i));
}
{
  const i = run(base([{ env: 'dev', key: 'restart', value: 'always' }]));
  ok('годный вариант select — тихо', !has(i, 'err', /не из вариантов/), dump(i));
}
{
  const i = run(base([{ env: 'dev', key: 'restart', value: 'иногда' }]));
  ok('негодный вариант select — ошибка', has(i, 'err', /не из вариантов/), dump(i));
}
{
  const i = run(base([{ env: 'stage', key: 'replicas', value: '2' }]));
  ok('незнакомое окружение — предупреждение', has(i, 'warn', /такого окружения в плане нет/), dump(i));
}
{
  const i = run(base([{ env: 'prod', key: 'replicas', value: '7' }]));
  ok('отличие для базового — подсказка', has(i, 'info', /и так стоят прямо в полях/), dump(i));
}
{
  const i = run(base([{ env: 'dev', key: 'replicas', value: '1' }, { env: 'dev', key: 'replicas', value: '2' }]));
  ok('одно поле дважды в одном окружении — ошибка', has(i, 'err', /задан дважды/), dump(i));
}
{
  const i = run(base([{ env: 'dev', key: 'replicas', value: '' }]));
  ok('пустое значение — ошибка', has(i, 'err', /значение не задано/), dump(i));
}
{
  const i = run(base([{ env: '', key: 'replicas', value: '1' }]));
  ok('не сказано окружение — ошибка', has(i, 'err', /какое окружение/), dump(i));
}
{
  const i = run(base([{ env: 'dev', key: '', value: '1' }]));
  ok('не сказан параметр — ошибка', has(i, 'err', /какой параметр/), dump(i));
}

console.log('\n— старые планы не шумят');
{
  const i = run([UNIT()]);
  ok('нет окружений — проверок нет', !has(i, 'warn', /базовым/) && !has(i, 'err', /окружени/i), dump(i));
}
{
  const i = run([UNIT({ env_over: [{ env: 'dev', key: 'replicas', value: '1' }] })]);
  ok('отличия без объявленных окружений — про «нет такого» молчим',
     !has(i, 'warn', /такого окружения в плане нет/), dump(i));
}
{
  const i = run([node('e1', 'env', { name: 'prod', base: true }, { notes: '' })]);
  ok('описатель не требует комментария', !has(i, 'info', /нет комментария/), dump(i));
}

report();
