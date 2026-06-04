/**
 * Playwright + Stealth 指纹浏览器测试脚本 v2
 * 
 * 功能：
 *   1. 启动带反指纹伪装的 Chromium 浏览器
 *   2. 固定 CDP 端口 9222（供外部连接）
 *   3. 打开抖音创作者中心
 *   4. 检测指纹伪装效果
 * 
 * 用法：
 *   node scripts/browser-test.mjs          # 有头模式（显示浏览器窗口）
 *   node scripts/browser-test.mjs headless # 无头模式（服务器用）
 */

import { chromium } from 'playwright-extra'
import stealth from 'puppeteer-extra-plugin-stealth'

// ── 注入 Stealth 反检测插件 ──
chromium.use(stealth())

const HEADLESS = process.argv[2] === 'headless'
const CDP_PORT = 9222

console.log('═'.repeat(50))
console.log('  AiMarketing 指纹浏览器测试 v2')
console.log('═'.repeat(50))
console.log(`  模式: ${HEADLESS ? '无头(服务器)' : '有头(桌面)'}`)
console.log(`  CDP端口: ${CDP_PORT}`)
console.log(''.repeat(50))

let browser

try {
  // ── 启动浏览器 ──
  console.log('[1/5] 启动 Chromium (带 Stealth 指纹伪装)...')
  
  browser = await chromium.launch({
    headless: HEADLESS,
    args: [
      `--remote-debugging-port=${CDP_PORT}`,
      '--disable-blink-features=AutomationControlled',
      '--disable-infobars',
      '--no-first-run',
      '--no-default-browser-check',
      '--window-size=1280,800',
      '--lang=zh-CN',
      `--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36`,
      '--disable-features=IsolateOrigins,site-per-process',
    ],
  })

  console.log(`       ✓ 浏览器已启动`)
  console.log(`       CDP 地址: http://localhost:${CDP_PORT}`)

  // ── 创建页面 + 注入中文环境 ──
  const page = await browser.newPage()
  await page.setViewportSize({ width: 1280, height: 800 })
  
  // 设置中文 locale 和 timezone
  await page.setExtraHTTPHeaders({
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
  })

  // ── 检测指纹伪装效果 ──
  console.log('\n[2/5] 检测指纹伪装效果...')
  
  const fp = await page.evaluate(() => ({
    webdriver: navigator.webdriver,
    hasChrome: !!window.chrome,
    pluginsLength: navigator.plugins.length,
    platform: navigator.platform,
    languages: navigator.languages,
    ua: navigator.userAgent.substring(0, 70),
  }))
  
  const wdOk = fp.webdriver === false ? '✅' : '⚠️'
  const chOk = fp.hasChrome ? '✅' : '⚠️'
  const plOk = fp.pluginsLength > 0 ? '✅' : '⚠️'
  
  console.log(`       webdriver:     ${fp.webdriver}  ${wdOk}`)
  console.log(`       window.chrome: ${fp.hasChrome}   ${chOk}`)
  console.log(`       plugins:        ${fp.pluginsLength}个  ${plOk}`)
  console.log(`       platform:       ${fp.platform}`)
  console.log(`       languages:      ${fp.languages.join(',')}`)

  if (fp.webdriver === false) {
    console.log('\n       ✅ Stealth 反检测工作正常！')
  } else {
    console.log('\n       ⚠️ webdriver 未隐藏')
  }

  // ── 访问抖音创作者中心（加长等待） ──
  console.log('\n[3/5] 打开抖音创作者中心...')
  
  try {
    // 先访问抖音首页触发 Cookie/登录检测跳转
    await page.goto('https://creator.douyin.com/creator-micro/content/publish', {
      timeout: 45000,
      waitUntil: 'networkidle',  // 等网络空闲（比 domcontentload 更彻底）
    })
    
    console.log('       ✓ 页面加载完成，等待渲染...')
    
    // 额外等待 JS 渲染完成
    await page.waitForTimeout(5000)
    
    const title = await page.title()
    console.log(`       页面标题: ${title}`)
    
    // 获取当前 URL（可能被重定向到登录页）
    const url = page.url()
    console.log(`       当前URL: ${url}`)
    
    if (url.includes('login') || url.includes('passport')) {
      console.log('       ℹ️ 已跳转到登录页，需要先登录才能发布内容')
    }

    // 截图
    await page.screenshot({ path: 'scripts/douyin-test.png', fullPage: true })
    console.log('       ✅ 截图已保存: scripts/douyin-test.png')

    // 尝试获取页面文字内容（检查是否正常）
    const bodyText = await page.evaluate(() => document.body?.innerText?.substring(0, 300) || '(空)')
    console.log(`\n       页面文字预览:`)
    console.log('       ' + '-'.repeat(40))
    console.log('       ' + bodyText.split('\n').slice(0, 8).join('\n       '))
    console.log('       ' + '-'.repeat(40))

  } catch (e) {
    console.error(`       ⚠️ 页面异常: ${e.message.substring(0, 100)}`)
    
    // 即使超时也尝试截图看看当前状态
    try {
      await page.screenshot({ path: 'scripts/douyin-error.png' })
      console.log('       已保存错误截图: scripts/douyin-error.png')
    } catch(_) {}
  }

  // ── 保持运行 ──
  console.log('\n[4/4] 浏览器保持运行中... 按 Ctrl+C 停止\n')
  
  if (!HEADLESS) {
    await new Promise(() => {})
  } else {
    await new Promise(resolve => setTimeout(resolve, 60000))
  }

} catch (error) {
  console.error('\n❌ 错误:', error.message)
} finally {
  if (browser) {
    await browser.close()
    console.log('\n浏览器已关闭')
  }
}
