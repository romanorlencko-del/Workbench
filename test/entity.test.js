/* Проверки словаря предметной области — без браузера. */
const { loadEngine, suite, node } = require('./harness');
const { Graph: G, BLOCKS: B } = loadEngine();
const { ok, report } = suite();

const run = (nodes, edges, stage) => {
  G.fromJSON({ version: 1, name: 't', meta: { stage: stage || 'wiring' }, nodes, edges: edges || [], seq: 99 });
  return G.validate();
};
const has = (iss, level, re) => iss.some(i => i.level === level && re.test(i.text));
const dump = iss => iss.map(i => `${i.level}: ${i.text}`).join('\n       ');

/* писатель ctx.order → читатель ctx.order.total */
const writer = () => node('w', 'process', { op: 'map', rule: 'r', output_var: 'ctx.order' });
const reader = (v) => node('r', 'process', { op: 'map', rule: 'r', input_var: v });
const wire = [{ kind: 'flow', from: { node: 'w', port: 'out' }, to: { node: 'r', port: 'in' } }];
const ORDER = (over) => node('e1', 'entity', Object.assign({
  key: 'order', vars: ['ctx.order'], id_field: 'id',
  fields: [{ name: 'id', kind: 'string', required: true }, { name: 'total', kind: 'money', required: true }],
}, over || {}));

console.log('\n— объявление сущности');
{
  const i = run([ORDER({ key: '' })]);
  ok('без ключа — ошибка', has(i, 'err', /как сущность зовут в коде/), dump(i));
}
{
  const i = run([ORDER(), node('e2', 'entity', { key: 'order', vars: ['ctx.o2'] })]);
  ok('дубль ключа — ошибка', has(i, 'err', /объявлена дважды/), dump(i));
}
{
  const i = run([node('e1', 'entity', { key: 'order', vars: ['ctx.order'] })]);
  ok('без полей — подсказка', has(i, 'info', /поля не перечислены/), dump(i));
}
{
  const i = run([ORDER({ fields: [{ name: 'id', kind: 'string' }, { name: 'id', kind: 'number' }] })]);
  ok('дубль поля — ошибка', has(i, 'err', /перечислено дважды/), dump(i));
}
{
  const i = run([ORDER({ id_field: 'uuid' })]);
  ok('опознаётся по несуществующему полю — ошибка', has(i, 'err', /опознаётся по «uuid»/), dump(i));
}
{
  const i = run([ORDER({ id_field: 'id' })]);
  ok('опознаётся по существующему — тихо', !has(i, 'err', /опознаётся/), dump(i));
}
{
  const i = run([ORDER(), node('e2', 'entity', { key: 'c', vars: ['ctx.order'], fields: [{ name: 'x', kind: 'string' }] })]);
  ok('одна переменная у двух сущностей — ошибка', has(i, 'err', /объявили своей две сущности/), dump(i));
}

console.log('\n— ссылки и хозяин');
{
  const i = run([ORDER({ fields: [{ name: 'buyer', kind: 'ref', ref: 'customer' }] })]);
  ok('ссылка на несуществующую сущность — ошибка', has(i, 'err', /ссылается на сущность «customer»/), dump(i));
}
{
  const i = run([ORDER({ fields: [{ name: 'buyer', kind: 'ref', ref: '' }] })]);
  ok('ссылка без цели — ошибка', has(i, 'err', /не сказано, на какую сущность/), dump(i));
}
{
  const i = run([ORDER({ fields: [{ name: 'buyer', kind: 'ref', ref: 'customer' }] }),
                 node('e2', 'entity', { key: 'customer', vars: ['ctx.cust'], fields: [{ name: 'id', kind: 'string' }] })]);
  ok('ссылка на объявленную — тихо', !has(i, 'err', /ссылается на сущность/), dump(i));
}
{
  const i = run([ORDER({ owner: 'orders-api' })]);
  ok('хозяин без контура — предупреждение', has(i, 'warn', /хозяин «orders-api»/), dump(i));
}
{
  const i = run([ORDER({ owner: 'orders-api' }), node('u1', 'unit', { name: 'orders-api' })]);
  ok('хозяин есть в плане — тихо', !has(i, 'warn', /хозяин /), dump(i));
}

console.log('\n— сверка читаемых полей');
{
  const i = run([writer(), reader('ctx.order.total'), ORDER()], wire);
  ok('поле есть — тихо', !has(i, 'warn', /поля «total»/), dump(i));
}
{
  const i = run([writer(), reader('ctx.order.sum'), ORDER()], wire);
  ok('поля нет — предупреждение', has(i, 'warn', /поля «sum» у сущности/), dump(i));
}
{
  const i = run([writer(), reader('ctx.order.sum'), ORDER()], wire, 'plan');
  ok('стадия «план» не гасит это в дело-на-потом',
     has(i, 'warn', /поля «sum»/), dump(i));
}
{
  const i = run([writer(), reader('ctx.order.total.cents'), ORDER()], wire);
  ok('второй уровень пути не разбираем', !has(i, 'warn', /поля «/), dump(i));
}
{
  const i = run([writer(), reader('ctx.order'), ORDER()], wire);
  ok('чтение сущности целиком — тихо', !has(i, 'warn', /поля «/), dump(i));
}
{
  const noFields = ORDER({ fields: [] });
  const i = run([writer(), reader('ctx.order.sum'), noFields], wire);
  ok('форма не объявлена — полей не сверяем', !has(i, 'warn', /поля «sum»/), dump(i));
}
{
  const i = run([writer(), reader('ctx.other.sum'), ORDER()], wire);
  ok('чужая переменная — сверка сущности не трогает', !has(i, 'warn', /у сущности/), dump(i));
}

console.log('\n— связь со схемой');
{
  const i = run([ORDER()]);
  ok('переменную никто не пишет — подсказка', has(i, 'info', /словарь оторван от схемы/), dump(i));
}
{
  const i = run([writer(), ORDER()]);
  ok('переменную пишут — тихо', !has(i, 'info', /оторван от схемы/), dump(i));
}
{
  const i = run([ORDER({ vars: [] })]);
  ok('без переменных — подсказка', has(i, 'info', /в каких переменных живёт/), dump(i));
}
{
  const i = run([node('e1', 'entity', { key: 'order', vars: ['ctx.order'], fields: [{ name: 'id', kind: 'string' }] }, { notes: '' })]);
  ok('описатель не требует комментария', !has(i, 'info', /нет комментария/), dump(i));
}

console.log('\n— пустой план не сломан');
{
  const i = run([writer(), reader('ctx.order.total')], wire);
  ok('без сущностей проверки молчат', !has(i, 'warn', /у сущности/), dump(i));
  ok('старая сверка стыка жива', run([reader('ctx.nobody.x')]).some(x => /никто не пишет/.test(x.text)));
}

report();
