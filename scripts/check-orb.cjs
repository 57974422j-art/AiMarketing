const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text().slice(0, 150)) });
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message.slice(0, 150)));
  await page.goto('http://127.0.0.1:3000/login', { waitUntil: 'domcontentloaded' });
  // API 登录拿 cookie
  const loginRes = await page.evaluate(async () => {
    const r = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: 'admin123' }) });
    return { status: r.status, body: await r.text() };
  });
  console.log('API 登录:', loginRes.status, loginRes.body.slice(0, 120));
  await page.goto('http://127.0.0.1:3000/agent', { waitUntil: 'domcontentloaded' }).catch(()=>{});
  await page.waitForTimeout(3000);
  console.log('URL:', page.url());
  const n = await page.$$eval('canvas', cs => cs.length).catch(() => -1);
  console.log('canvas 数量:', n);
  if (n > 0) {
    const box = await page.$eval('canvas', c => { const b = c.getBoundingClientRect(); return { w: b.width, h: b.height } }).catch(() => null);
    console.log('canvas 尺寸:', JSON.stringify(box));
  }
  console.log('console errors:', errors.length ? errors.slice(0, 6) : '无');
  await browser.close();
})();
