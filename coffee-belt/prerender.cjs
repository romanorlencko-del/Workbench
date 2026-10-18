// Сохраняет страницу уже отрисованной, чтобы она читалась и там, где JavaScript
// выключен (предпросмотр файлов на iPhone). Нужен Playwright с Chromium.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
  await p.route('**/*', r => r.request().url().startsWith('file:') ? r.continue() : r.abort());
  await p.goto('file://' + path.join(__dirname, 'build', 'standalone.html'));
  await p.waitForTimeout(500);
  const html = await p.evaluate(() => '<!doctype html>\n' + document.documentElement.outerHTML);
  fs.writeFileSync(path.join(__dirname, '..', 'coffee-belt.html'), html);
  await b.close();
})();
