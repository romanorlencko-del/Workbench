/* harness.js — прогон движка конструктора БЕЗ браузера.

   blocks.js и graph.js — самодостаточные IIFE, вешающие себя на window и не
   трогающие DOM. Поэтому их можно загрузить в поддельный window через vm и
   дёргать Graph.validate()/quality() напрямую, без сервера и без страницы.
   Отсюда — быстрые детерминированные тесты на саму логику проверок. */
const fs = require('fs'), vm = require('vm'), path = require('path');

const JS = path.join(__dirname, '..', 'js');

/* Свежий движок на каждый вызов: свой window, свой Graph. Тесты не делят
   состояние между файлами, и падение одного набора не пачкает остальные. */
function loadEngine() {
  const ctx = vm.createContext({ window: {}, console });
  for (const f of ['blocks.js', 'graph.js'])
    vm.runInContext(fs.readFileSync(path.join(JS, f), 'utf8'), ctx, f);
  return ctx.window;
}

/* Крохотный счётчик утверждений: ok(имя, условие[, подробности]) складывает
   зелёные и красные, report() печатает итог и выходит с нужным кодом. */
function suite() {
  let pass = 0, fail = 0;
  const ok = (name, cond, extra) => {
    if (cond) { pass++; console.log('  ok  ' + name); }
    else { fail++; console.log('  FAIL ' + name + (extra ? '\n       ' + extra : '')); }
  };
  const report = () => {
    console.log(`\nитого: ${pass} ok, ${fail} fail`);
    process.exit(fail ? 1 : 0);
  };
  return { ok, report, tally: () => ({ pass, fail }) };
}

/* Узел плана в той форме, которую ждёт validate(): id, тип, координаты,
   params и заметка. notes по умолчанию непустая — иначе почти каждый узел
   ловил бы info «нет комментария» и зашумлял бы тесты не по теме. */
const node = (id, type, params, extra) => Object.assign(
  { id, type, name: id, x: 0, y: 0, enabled: true, params, notes: 'зачем' }, extra || {});

module.exports = { loadEngine, suite, node };
