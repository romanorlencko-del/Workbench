/* Интеграционный тест на живом плане. Юнит-наборы проверяют правила по
   отдельности; здесь — что на СОБРАННОЙ схеме они (а) молчат, когда всё верно,
   и (б) срабатывают, когда её ломаешь. Чистый план без второй половины ничего
   не доказывает: проверка могла просто ничего не уметь. */
const fs = require('fs'), path = require('path');
const { loadEngine, suite } = require('./harness');
const { Graph: G } = loadEngine();
const { ok, report } = suite();

const PLAN = path.join(__dirname, '..', 'projects', 'p_demo_fields.json');
const BASE = fs.readFileSync(PLAN, 'utf8');
const clean = () => JSON.parse(BASE);
const at = (p, id) => p.nodes.find(n => n.id === id);
const run = p => { G.fromJSON(p); return G.validate(); };

console.log('\n— эталон чист');
ok('демо-план проходит собственную проверку без замечаний',
   run(clean()).length === 0,
   run(clean()).map(i => i.level + ': ' + i.text).join('\n       '));

console.log('\n— каждую поломку ловит');
const breaks = P => run((() => { const p = clean(); P(p); return p; })());
const catches = (name, P, re) =>
  ok(name, breaks(P).some(i => re.test(i.text)),
     'всего замечаний: ' + breaks(P).length);

catches('повтор узора тихо разошёлся (у одного релей сменили на CDC)',
  p => { at(p, 'ord_chk').params.relay = 'cdc'; }, /повторы разошлись/);
catches('читаем поле, которого у сущности нет',
  p => { at(p, 'charge').params.input_var = 'ctx.payment_checked.sum'; }, /поля «sum» у сущности/);
catches('в отличии по окружению негодное значение',
  p => { at(p, 'u_intake').params.env_over[0].value = 'мало'; }, /не число/);
catches('в отличии по окружению опечатка в имени параметра',
  p => { at(p, 'u_intake').params.env_over[0].key = 'replica'; }, /такого параметра нет/);
catches('решение привязано в никуда',
  p => { at(p, 'dec_bus').params.affects = ['биллинг']; }, /непонятно, к чему относится/);
catches('у контура нет ответственного',
  p => { at(p, 'u_billing').params.owner = ''; }, /звать некого/);
catches('связь между контурами напрямую, минуя шину',
  p => { p.edges.push({ id: 'bad', kind: 'flow', from: { node: 'ord_chk', port: 'out' }, to: { node: 'charge', port: 'in' } }); },
  /связаны жёстко.*отвечают за них разные/);
catches('сущность ссылается на несуществующую',
  p => { at(p, 'entity_payment').params.fields[1].ref = 'заказ'; }, /ссылается на сущность «заказ»/);
catches('роль узора есть не во всех повторах',
  p => { at(p, 'pay_chk').params.pattern_role = 'разбор'; }, /нет в «заказы»|нет в «платежи»/);
catches('реплик не хватает под заявленную нагрузку',
  p => { at(p, 'ord_in').params.rps = 200; }, /реплик/i);
catches('лишний провод у одного повтора узора (форма разошлась)',
  p => { p.edges.push({ id: 'bad2', kind: 'flow', from: { node: 'pay_in', port: 'out' }, to: { node: 'bus', port: 'in' } }); },
  /собраны по-разному/);

report();
