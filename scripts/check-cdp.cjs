const { chromium } = require('playwright');
(async () => {
  try {
    const browser = await chromium.connectOverCDP('http://127.0.0.1:9333');
    const ctx = browser.contexts()[0];
    if (!ctx) { console.log('无 context'); process.exit(0) }
    // ① 窗口/tab 数
    const pages = ctx.pages();
    console.log('=== 打开的 tab 数:', pages.length, '===');
    pages.forEach((p, i) => console.log(`  [${i}] ${p.url().slice(0, 70)}`));
    // ② cookie（抖音/小红书域）
    const cookies = await ctx.cookies();
    const douyin = cookies.filter(c => c.domain.includes('douyin.com')).map(c => c.name);
    const xhs = cookies.filter(c => c.domain.includes('xiaohongshu.com')).map(c => c.name);
    console.log('\n=== 抖音 cookie:', douyin.length, '个 ===');
    console.log('  ', [...new Set(douyin)].join(', '));
    console.log('\n=== 小红书 cookie:', xhs.length, '个 ===');
    console.log('  ', [...new Set(xhs)].join(', '));
    const hasWebSession = xhs.includes('web_session') || xhs.includes('web_session_SSO');
    console.log('\n小红书 web_session 存在?', hasWebSession ? '✅ 有' : '❌ 无');
    await browser.close().catch(()=>{});
  } catch (e) { console.log('连接失败（内置浏览器可能没开）:', e.message.slice(0, 100)) }
})();
