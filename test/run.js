/* run.js — прогнать все наборы. Каждый .test.js запускается ОТДЕЛЬНЫМ процессом:
   свежий движок, изоляция (падение одного не валит остальные) и честный код
   возврата для CI. Без зависимостей — только node.

   Запуск:  node test/run.js        (или  npm test) */
const { spawnSync } = require('child_process');
const fs = require('fs'), path = require('path');

const files = fs.readdirSync(__dirname)
  .filter(f => f.endsWith('.test.js')).sort();

let failed = 0;
for (const f of files) {
  console.log('\n══ ' + f);
  const r = spawnSync(process.execPath, [path.join(__dirname, f)], { stdio: 'inherit' });
  if (r.status !== 0) failed++;
}

console.log('\n' + '─'.repeat(40));
console.log(failed ? `ПРОВАЛ: наборов с ошибками ${failed} из ${files.length}`
                   : `всё зелено: ${files.length} наборов`);
process.exit(failed ? 1 : 0);
