const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  page.on('pageerror', e => console.log('=== PAGEERROR ===\n' + (e.stack || e.message).slice(0, 1200)));
  page.on('console', m => { if (m.type() === 'error') console.log('CONSOLE-ERR:', m.text().slice(0, 300)) });
  await page.goto('http://127.0.0.1:3000/login', { waitUntil: 'domcontentloaded' });
  await page.evaluate(async () => {
    await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: 'admin123' }) });
  });
  await page.goto('http://127.0.0.1:3000/agent', { waitUntil: 'domcontentloaded' }).catch(()=>{});
  await page.waitForTimeout(5000);
  console.log('最终 URL:', page.url());
  const body = await page.evaluate(() => document.body.innerText.slice(0, 200));
  console.log('页面文本:', body);
  await browser.close();
})();
