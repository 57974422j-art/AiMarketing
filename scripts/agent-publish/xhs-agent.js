/**
 * AGENT 小红书发布（实测结构：标题 INPUT.d-text / 正文 tiptap / 设置封面 / 发布笔记）
 * 用法: node xhs-agent.js --video <path> --title <t> --topics "#a #b" --cover-file <jpg> [--no-publish]
 */
const { chromium } = require('playwright')
const fs = require('fs')
const path = require('path')
const http = require('http')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function parseArgs() {
  const a = {}
  for (let i = 2; i < process.argv.length; i++) {
    const k = process.argv[i]
    if (!k.startsWith('--')) continue
    const name = k.replace(/^--/, '')
    const nxt = process.argv[i + 1]
    if (nxt === undefined || nxt.startsWith('--')) a[name] = 'true'
    else { a[name] = nxt; i++ }
  }
  return a
}

async function main() {
  const a = parseArgs()
  const log = (m) => console.log('[' + new Date().toLocaleTimeString('zh-CN') + '] ' + m)
  const video = a.video || ''
  const title = a.title || ''
  const topics = a.topics || ''
  const coverFile = a['cover-file'] || ''
  const noPub = a['no-publish'] !== undefined
  log('视频=' + video + ' 标题=' + title + ' 话题=' + topics + ' 封面=' + (coverFile || '无') + (noPub ? ' [dry-run]' : ''))
  if (!video || !fs.existsSync(video)) { log('视频不存在'); process.exit(1) }

  const b = await chromium.connectOverCDP('http://127.0.0.1:9222')
  const ctx = b.contexts()[0]
  const page = ctx.pages().find((p) => /xiaohongshu/.test(p.url())) || ctx.pages()[0]
  await page.bringToFront().catch(() => {})
  log('URL=' + page.url())

  // Step0 确保在发布页
  if (!/publish/.test(page.url())) {
    await page.goto('https://creator.xiaohongshu.com/publish/publish', { waitUntil: 'domcontentloaded', timeout: 40000 }).catch(() => {})
    await sleep(3000)
    log('导航后 URL=' + page.url())
  }

  // Step1 上传视频
  const fi = (await page.$('input.upload-input')) || (await page.$('input[type="file"]'))
  if (!fi) { log('未找到上传 input'); await b.close(); process.exit(1) }
  await fi.setInputFiles(video)
  log('✅ 视频已设置')

  // Step2 等编辑页（标题框出现）
  let ready = false
  for (let i = 0; i < 40; i++) {
    await sleep(3000)
    const ok = await page.evaluate(() => {
      const vis = (e) => !!(e && e.offsetParent !== null)
      return Array.from(document.querySelectorAll('input')).filter(vis).some((e) => (e.getAttribute('placeholder') || '').indexOf('标题') >= 0)
    }).catch(() => false)
    if (ok) { ready = true; break }
  }
  log((ready ? '✅ 编辑页就绪' : '⚠️ 等编辑页超时') + ' (' + page.url() + ')')
  await sleep(2500)

  // Step3 标题
  if (title) {
    const ti = await page.$('input[placeholder*="标题"]')
    if (ti && (await ti.isVisible().catch(() => false))) { await ti.click(); await ti.fill(title); log('✅ 标题已填: ' + title.slice(0, 20)) }
    else log('⚠️ 未找到标题框')
  }

  // Step4 话题（tiptap 正文）
  if (topics) {
    try {
      const ce = (await page.$('.tiptap.ProseMirror, .ProseMirror[contenteditable="true"]')) || (await page.$('[contenteditable="true"]'))
      if (ce) { await ce.click(); await sleep(400); await page.keyboard.type(topics, { delay: 25 }); await sleep(800); await page.keyboard.press('Escape'); log('✅ 话题已填: ' + topics.slice(0, 25)) }
      else log('⚠️ 未找到正文/话题框')
    } catch (e) { log('话题失败: ' + e.message.slice(0, 60)) }
  }

  // Step5 封面（点「设置封面」→ 上传）
  if (coverFile && fs.existsSync(coverFile)) {
    try {
      await page.getByText('设置封面', { exact: true }).first().click({ timeout: 4000 }).catch(() => {})
      log('已点「设置封面」')
      await sleep(2500)
      const [fc] = await Promise.all([
        page.waitForEvent('filechooser', { timeout: 6000 }).catch(() => null),
        (async () => {
          const up = page.getByText('上传封面', { exact: false }).first()
          if (await up.isVisible().catch(() => false)) await up.click({ timeout: 2500 }).catch(() => {})
        })(),
      ])
      if (fc) { await fc.setFiles(coverFile); log('✅ 封面已上传(filechooser)'); await sleep(3000) }
      else {
        const ci = await page.$('input[type="file"][accept*="image"]')
        if (ci) { await ci.setInputFiles(coverFile); log('✅ 封面已上传(input)'); await sleep(3000) }
        else log('⚠️ 封面上传入口未找到')
      }
      // 完成/应用
      for (const t of ['完成', '确定', '应用', '保存']) {
        const btn = page.getByText(t, { exact: true }).first()
        if (await btn.isVisible().catch(() => false)) { await btn.click({ timeout: 2500 }).catch(() => {}); log('✅ 已点「' + t + '」'); await sleep(2000); break }
      }
    } catch (e) { log('封面异常: ' + e.message.slice(0, 80)) }
  } else log('无封面 → 平台默认')

  // Step6 发布
  if (noPub) { log('⏸ dry-run → 跳过发布'); }
  else {
    try {
      const pb = (await page.$('div.publish-video span.btn-text')) || page.getByText('发布笔记', { exact: true }).first()
      await pb.click({ timeout: 4000 })
      log('✅ 已点「发布笔记」')
      await sleep(6000)
      log('发布后 URL=' + page.url())
    } catch (e) { log('发布失败: ' + e.message.slice(0, 80)) }
  }
  await b.close().catch(() => {})
}
main().catch((e) => { console.error('ERR ' + e.message); process.exit(1) })
