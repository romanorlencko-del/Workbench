/* Ответственность за контур — без браузера. */
const { loadEngine, suite, node } = require('./harness');
const { Graph: G, BLOCKS: B } = loadEngine();
const { ok, report } = suite();

const run = (nodes, edges) => {
  G.fromJSON({ version: 1, name: 't', meta: { stage: 'wiring' }, nodes, edges: edges || [], seq: 99 });
  return G.validate();
};
const has = (i, lvl, re) => i.some(x => x.level === lvl && re.test(x.text));
const dump = i => i.map(x => `${x.level}: ${x.text}`).join('\n       ');

const U = (nm, owner) => node('u_' + nm, 'unit', { name: nm, owner: owner || '', logs_to: '' });
// два блока в разных контурах, связанных напрямую (без буфера)
const pair = (ua, ub) => ({
  nodes: [ node('a', 'process', { op: 'map', rule: 'r', unit: ua }),
           node('b', 'process', { op: 'map', rule: 'r', unit: ub }) ],
  edges: [ { id: 'x', kind: 'flow', from: { node: 'a', port: 'out' }, to: { node: 'b', port: 'in' } } ],
});

console.log('\n— поле живёт на контуре, а не на блоке');
{
  ok('owner есть у контура', (B.TYPES.unit.params || []).some(p => p.key === 'owner'));
  const onBlocks = Object.keys(B.TYPES).filter(t => t !== 'unit' && t !== 'entity' &&
    (B.TYPES[t].params || []).some(p => p.key === 'owner'));
  ok('и не расползлось по блокам', !onBlocks.length, 'нашлось у: ' + onBlocks.join(','));
  ok('у сущности своё «хозяин данных» осталось',
     (B.TYPES.entity.params || []).some(p => p.key === 'owner'));
}

console.log('\n— контур без ответственного');
{
  const i = run([U('orders-api')]);
  ok('не назван — подсказка', has(i, 'info', /звать некого/), dump(i));
}
{
  const i = run([U('orders-api', 'команда платежей')]);
  ok('назван — тихо', !has(i, 'info', /звать некого/), dump(i));
}
{
  const i = run([]);
  ok('контуров нет — вопроса нет', !has(i, 'info', /звать некого/), dump(i));
}

console.log('\n— жёсткая связь через границу ответственности');
{
  const p = pair('a-unit', 'b-unit');
  const i = run(p.nodes.concat([U('a-unit', 'Иван'), U('b-unit', 'Иван')]), p.edges);
  ok('один владелец — обычное предупреждение без добавки',
     has(i, 'warn', /связаны жёстко/) && !has(i, 'warn', /отвечают за них разные/), dump(i));
  ok('счётчик через границу = 0', G.quality().crossOwner === 0, 'crossOwner=' + G.quality().crossOwner);
}
{
  const p = pair('a-unit', 'b-unit');
  const i = run(p.nodes.concat([U('a-unit', 'Иван'), U('b-unit', 'Пётр')]), p.edges);
  ok('разные владельцы — добавка в тексте', has(i, 'warn', /отвечают за них разные: Иван ↔ Пётр/), dump(i));
  ok('счётчик через границу = 1', G.quality().crossOwner === 1, 'crossOwner=' + G.quality().crossOwner);
  ok('жёстких тоже 1', G.quality().hardLinks === 1, 'hardLinks=' + G.quality().hardLinks);
}
{
  const p = pair('a-unit', 'b-unit');
  const i = run(p.nodes.concat([U('a-unit', 'Иван'), U('b-unit', '')]), p.edges);
  ok('владелец назван не у всех — про разных молчим',
     !has(i, 'warn', /отвечают за них разные/), dump(i));
  ok('счётчик через границу = 0', G.quality().crossOwner === 0);
}
{
  // та же пара, но через брокер: связь не жёсткая
  const nodes = [ node('a', 'process', { op: 'map', rule: 'r', unit: 'a-unit' }),
                  node('m', 'broker', { topic: 't', unit: 'a-unit' }),
                  node('b', 'process', { op: 'map', rule: 'r', unit: 'b-unit' }),
                  U('a-unit', 'Иван'), U('b-unit', 'Пётр') ];
  const edges = [ { id: 'x1', kind: 'flow', from: { node: 'a', port: 'out' }, to: { node: 'm', port: 'in' } },
                  { id: 'x2', kind: 'flow', from: { node: 'm', port: 'out' }, to: { node: 'b', port: 'in' } } ];
  run(nodes, edges);
  ok('через брокер границу не считаем', G.quality().crossOwner === 0 && G.quality().hardLinks === 0,
     JSON.stringify({ crossOwner: G.quality().crossOwner, hardLinks: G.quality().hardLinks }));
}

console.log('\n— старые планы');
{
  const i = run([node('a', 'process', { op: 'map', rule: 'r' }, { notes: 'z' })]);
  ok('без контуров — ни слова про ответственность',
     !has(i, 'info', /звать некого/) && !has(i, 'warn', /отвечают/), dump(i));
  ok('crossOwner в сводке есть и равен 0', G.quality().crossOwner === 0);
}

report();
