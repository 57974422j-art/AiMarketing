/*
 * 目的：查 HyperFrames 自带的 chrome-headless-shell 是否支持 H.264 / AAC 等「专有编解码器」。
 * 背景：chrome-headless-shell 由 @puppeteer/browsers 从 Chromium 通道下载，
 *       Chromium 官方构建通常**不含** H.264/AAC（专利）→ 若如此，把本地 .mp4 喂给 <video> 会解不了码，
 *       会让「<video> seek 验证」出现与 seek 无关的假阴性。
 * 用法：node codec-check.cjs [可选:自定义 headless-shell 路径]
 */
const path = require('path');
const fs = require('fs');
const puppeteer = require('puppeteer-core');

function findShell() {
  if (process.argv[2]) return process.argv[2];
  const base = path.join(process.env.USERPROFILE || process.env.HOME || '', '.cache', 'hyperframes', 'chrome', 'chrome-headless-shell');
  if (!fs.existsSync(base)) return '';
  for (const d of fs.readdirSync(base)) {
    const p = path.join(base, d, 'chrome-headless-shell-win64', 'chrome-headless-shell.exe');
    if (fs.existsSync(p)) return p;
    const alt = path.join(base, d, 'chrome-headless-shell-linux64', 'chrome-headless-shell');
    if (fs.existsSync(alt)) return alt;
  }
  return '';
}

(async () => {
  const SHELL = findShell();
  if (!SHELL) { console.log('NOT_FOUND: 找不到 chrome-headless-shell，请先 hyperframes browser ensure'); process.exit(1); }
  console.log('executable =', SHELL);
  console.log('puppeteer-core =', require('puppeteer-core/package.json').version);

  let lastErr = null, browser = null;
  for (const h of ['shell', true, 'new']) {
    try {
      browser = await puppeteer.launch({
        executablePath: SHELL,
        headless: h,
        args: ['--no-sandbox', '--disable-dev-shm-usage'],
      });
      console.log('launched with headless =', JSON.stringify(h));
      break;
    } catch (e) { lastErr = e; }
  }
  if (!browser) { console.log('LAUNCH_FAILED: ' + lastErr); process.exit(2); }

  const page = await browser.newPage();
  await page.goto('about:blank');
  const r = await page.evaluate(() => {
    const v = document.createElement('video');
    const t = (s) => v.canPlayType(s);
    return {
      userAgent: navigator.userAgent,
      brand: (navigator.userAgentData && navigator.userAgentData.brands || []).map(b => b.brand + ' ' + b.version).join(', '),
      'video/mp4 h264 baseline': t('video/mp4; codecs="avc1.42E01E"'),
      'video/mp4 h264 high': t('video/mp4; codecs="avc1.640028"'),
      'video/mp4 h265': t('video/mp4; codecs="hvc1.1.6.L93.B0"'),
      'video/mp4 av1': t('video/mp4; codecs="av01.0.05M.08"'),
      'video/webm vp8': t('video/webm; codecs="vp8"'),
      'video/webm vp9': t('video/webm; codecs="vp9"'),
      'audio/mp4 aac': t('audio/mp4; codecs="mp4a.40.2"'),
      'audio/mpeg mp3': t('audio/mpeg; codecs="mp3"'),
      'audio/webm opus': t('audio/webm; codecs="opus"'),
      'video/quicktime(.mov)': t('video/quicktime'),
      'video/x-msvideo(.avi)': t('video/x-msvideo'),
      'video/avi(.avi alt)': t('video/avi'),
      'video/x-matroska(.mkv)': t('video/x-matroska'),
      'video/mp2t(.ts)': t('video/mp2t'),
      'video/webm(.webm)': t('video/webm'),
    };
  });
  console.log(JSON.stringify(r, null, 2));
  const h264ok = (r['video/mp4 h264 baseline'] || '') !== '';
  console.log('\n>>> H.264 支持 = ' + (h264ok ? 'YES' : 'NO ❌ (Chromium 构建无专有编解码器)'));
  await browser.close();
})();
