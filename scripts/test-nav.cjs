const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto('http://127.0.0.1:3000/login', { waitUntil: 'domcontentloaded' });
  await page.evaluate(async () => {
    await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: 'admin123' }) });
  });
  const tests = ['打开文生视频', '去数字人', '打开一键成片', '打开AI生图', '打开音乐库', '打开素材库', '帮我生成一个奶茶广告视频'];
  for (const msg of tests) {
    const r = await page.evaluate(async (m) => {
      const res = await fetch('/api/agent/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: m, history: [] }) });
      const j = await res.json();
      return { scene: j.data?.scene?.type + (j.data?.scene?.path ? ':' + j.data.scene.path : ''), intent: j.data?.intent, reply: (j.data?.reply || '').slice(0, 30) };
    }, msg);
    console.log(msg, '→', JSON.stringify(r));
  }
  await browser.close();
})();
