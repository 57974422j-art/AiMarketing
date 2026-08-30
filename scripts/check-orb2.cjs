const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message.slice(0, 150)));
  await page.goto('http://127.0.0.1:3000/login', { waitUntil: 'domcontentloaded' });
  await page.evaluate(async () => {
    await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: 'admin123' }) });
  });
  await page.goto('http://127.0.0.1:3000/agent', { waitUntil: 'domcontentloaded' }).catch(()=>{});
  await page.waitForTimeout(3500);
  const info = await page.evaluate(() => {
    const cs = Array.from(document.querySelectorAll('canvas'));
    return cs.map(c => {
      const r = c.getBoundingClientRect();
      let painted = 0, total = 0;
      try {
        const ctx = c.getContext('2d');
        const d = ctx.getImageData(0, 0, c.width, c.height).data;
        for (let i = 3; i < d.length; i += 40) { total++; if (d[i] > 0) painted++; }
        return { w: Math.round(r.width), h: Math.round(r.height), painted, total };
      } catch { return { w: Math.round(r.width), h: Math.round(r.height), painted: -1, total: 0 }; }
    });
  });
  console.log('canvas:', JSON.stringify(info));
  console.log('页面错误:', errors.length ? errors : '无');
  await browser.close();
})();
