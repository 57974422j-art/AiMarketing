/** 直接执行：封面全流程（按实测结构）——点 coverControl 入口 → 弹窗 → semi 上传 → 保存 → 完成 */
const { chromium } = require('playwright')
const COVER = 'E:/ai-marketing/storage/cover_1788928821192.jpg'  // 竖 1080x1440（正斜杠）

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function main() {
  const b = await chromium.connectOverCDP('http://127.0.0.1:9222')
  const ctx = b.contexts()[0]
  const page = ctx.pages().find((p) => /creator\.douyin/.test(p.url())) || ctx.pages()[0]
  const log = (m) => console.log('[CF] ' + m)
  log('URL=' + page.url())

  const modalOpen = async () => (await page.$$('.semi-upload-drag-area')).length
  log('当前弹窗(.semi-upload-drag-area)数=' + (await modalOpen()))

  if ((await modalOpen()) === 0) {
    // 找横向 coverControl 入口并点击
    const ctrls = await page.$$('[class*="coverControl"]')
    log('coverControl 入口数=' + ctrls.length)
    let target = null
    for (const c of ctrls) {
      const t = String(await c.innerText().catch(() => '')).trim()
      const fs = require('fs'); const b = fs.readFileSync(COVER); let ori = 'portrait'; try { if (b[0] === 0x89) { ori = b.readUInt32BE(20) >= b.readUInt32BE(16) ? 'portrait' : 'landscape' } else { for (let i = 2; i < b.length - 9; i++) { if (b[i] === 0xFF && b[i+1] >= 0xC0 && b[i+1] <= 0xC2) { ori = b.readUInt16BE(i+5) >= b.readUInt16BE(i+7) ? 'portrait' : 'landscape'; break } } } } catch (e) {}
      const wantKw = ori === 'landscape' ? '横封面' : '竖封面'
      if (t.indexOf(wantKw) >= 0) { target = c; log('封面方向=' + ori + ' 选中入口: ' + t); break }
    }
    if (!target && ctrls.length) target = ctrls[0]
    if (!target) { log('未找到封面入口'); await b.close(); return }
    await target.scrollIntoViewIfNeeded().catch(() => {})
    await target.click({ timeout: 4000 }).catch((e) => log('入口点击异常: ' + e.message.slice(0, 60)))
    await sleep(2500)
    log('点击后弹窗数=' + (await modalOpen()))
  }

  // 弹窗内上传
  // ★ 排除 -custom（那是「生成参考图」区）——封面区是 .semi-upload-drag-area:not(.semi-upload-drag-area-custom)
  let upArea = await page.$('.semi-upload-drag-area:not(.semi-upload-drag-area-custom)')
  if (!upArea) upArea = await page.$('[class*="upload-ZOJTUA"]')  // 兜底：上传封面容器
  if (!upArea) { log('弹窗未开，无法上传'); await b.close(); return }
  const [fc] = await Promise.all([
    page.waitForEvent('filechooser', { timeout: 7000 }).catch(() => null),
    upArea.click({ timeout: 3000 }).catch(() => {}),
  ])
  if (fc) {
    await fc.setFiles(COVER)
    log('✅ 已上传(点上传区→文件框)')
  } else {
    const si = await page.$('.semi-upload-hidden-input')
    if (si) { await si.setInputFiles(COVER); log('✅ 已上传(semi input 兜底)') }
    else log('❌ 两种上传方式都没成功')
  }
  await sleep(4000)
  log('--- 弹窗内当前可见按钮 ---')
  const btns = await page.evaluate(() => {
    const vis = (e) => !!(e && e.offsetParent !== null)
    return Array.from(new Set(Array.from(document.querySelectorAll('.semi-upload-drag-area,[class*="modal"] button,[class*="modal"] [role="button"]'))
      .filter(vis).map((e) => (e.innerText || '').trim()).filter((t) => t && t.length <= 10)))
  })
  log(JSON.stringify(btns))
  // 保存
  const sv = await page.$('button:has-text("保存")')
  if (sv && (await sv.isVisible().catch(() => false))) { await sv.click({ timeout: 2500 }).catch(() => {}); log('✅ 已点保存'); await sleep(2500) }
  else log('未找到「保存」按钮')
  // 完成/确定
  const dn = await page.$('button:has-text("完成")')
  if (dn && (await dn.isVisible().catch(() => false))) { await dn.click({ timeout: 2500 }).catch(() => {}); log('✅ 已点完成'); await sleep(2000) }
  else log('未找到「完成」按钮')
  log('结束 弹窗残留数=' + (await modalOpen()))
  await b.close().catch(() => {})
}
main().catch((e) => { console.error('ERR ' + e.message); process.exit(1) })
