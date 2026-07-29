/**
 * 快手发视频脚本（指纹浏览器 B方案：每个平台独立端口/独立 profile）
 *
 * 流程：cp.kuaishou.com/article/publish/video → 点按钮触发上传 → 等转码
 *       → 填标题 → 填描述+话题(#标签 最多3个) → 封面(无则平台默认)
 *       → 发布（两步：发布 → 确认发布）
 *
 * 参照 dreammis/social-auto-upload 的 KSVideo 实现（2025-12 版）：
 *   - 上传必须「点按钮触发 filechooser」，不是直接 setInputFiles
 *   - 标题需清空再输入
 *   - 话题格式 "#标签 "（带空格），最多 3 个
 *   - 上传状态轮询文本「上传中」归零
 *   - 发布两步：先「发布」再「确认发布」
 *   - 未登录标志：页面出现「机构服务」
 *
 * 参数（与抖音/小红书保持同名）：
 *   - videoPath / title / description / topics / coverImage / publishNow / userId
 */

const path = require('path')
const { resolveLocalVideoPath } = require('./_common')

// ════════════════════════════════════
// 工具函数
// ════════════════════════════════════

/** 关闭常见弹窗（含快手「新功能公告」类） */
async function dismissPopups(page, log, prefix = '') {
  for (const text of ['我知道了', '知道了', '确定', '稍后再说', '关闭', '×']) {
    try {
      const btns = await page.$$(`:text-is("${text}"), :text("${text}")`)
      for (const btn of btns) {
        if (await btn.isVisible().catch(() => false)) {
          await btn.click({ timeout: 2000 }).catch(() => {})
          log(`${prefix}关闭弹窗「${text}」`)
          await page.waitForTimeout(600)
        }
      }
    } catch (_) {}
  }
}

/** 检测是否已登录；未登录返回 false */
async function isLoggedIn(page, log) {
  await page.waitForTimeout(2500)
  const url = page.url()
  if (url.includes('passport') || url.includes('login')) {
    log('  ⚠️ 检测到登录页 URL: ' + url)
    return false
  }
  const bodyText = await page.evaluate(() => document.body.innerText).catch(() => '')
  // 未登录标志：快手登录/机构服务入口
  const hasLoginPrompt =
    bodyText.includes('机构服务') || bodyText.includes('扫码登录') ||
    bodyText.includes('手机号登录') || bodyText.includes('密码登录')
  const hasPublishForm =
    bodyText.includes('上传') || bodyText.includes('填写作品标题') ||
    bodyText.includes('发布') || bodyText.includes('上传视频')
  if (hasLoginPrompt && !hasPublishForm) {
    log('  ⚠️ 页面显示登录入口（含「机构服务」），判定为未登录')
    return false
  }
  return true
}

// ════════════════════════════════════
// Step 1: 导航
// ════════════════════════════════════

async function step1_navigate(page, params, log) {
  const targetUrl = 'https://cp.kuaishou.com/article/publish/video'
  const currentUrl = page.url()
  log(`当前页面: ${currentUrl}`)

  if (!currentUrl.includes('/article/publish')) {
    log(`导航到: ${targetUrl}`)
    await page.goto(targetUrl, { timeout: 30000, waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(4000)
    log(`已到达: ${page.url()}`)
  } else {
    log('当前已在发布页')
    await page.waitForTimeout(2000)
  }
  await dismissPopups(page, log)
}

// ════════════════════════════════════
// Step 2: 上传视频（点按钮触发 filechooser）
// ════════════════════════════════════

async function step2_upload(page, params, fs, log) {
  log('准备上传视频: ' + params.videoPath)

  let uploaded = false

  // 快手必须点按钮触发 filechooser（参照 social-auto-upload）
  const triggers = [
    'text=上传视频', 'text=选择视频', 'text=点击上传',
    '[class*="upload-btn"]', '[class*="uploadBtn"]',
    '[class*="upload-area"]', '[class*="uploader"]', 'text=上传',
  ]
  for (const trigger of triggers) {
    try {
      const [fc] = await Promise.all([
        page.waitForEvent('filechooser', { timeout: 3000 }).catch(() => null),
        page.click(trigger, { timeout: 2000 }).catch(() => {}),
      ])
      if (fc) {
        await fc.setFiles(params.videoPath)
        uploaded = true
        log('✅ 文件选择器上传成功 (' + trigger + ')')
        break
      }
    } catch (_) {}
  }

  // 兜底：直接 file input
  if (!uploaded) {
    try {
      await page.setInputFiles('input[type="file"]', params.videoPath)
      uploaded = true
      log('✅ 直接 setInputFiles 成功')
    } catch (e) {
      log('  ⚠️ 直接 input 失败: ' + e.message)
    }
  }

  if (!uploaded) {
    const info = await page.evaluate(() => ({ url: location.href })).catch(() => ({}))
    return { success: false, message: '未找到上传入口 URL=' + info.url }
  }
  return null
}

// ════════════════════════════════════
// Step 3: 等待上传完成（轮询「上传中」归零）
// ════════════════════════════════════

async function step3_waitUpload(page, log) {
  log('═══ Step 3: 等待视频上传+转码 ═══')

  const MAX_TRIES = 60
  const WAIT_MS = 2000
  let editPageReady = false
  let abortReason = ''
  const start = Date.now()

  for (let i = 0; i < MAX_TRIES; i++) {
    if (global.__fpAbort) { abortReason = '用户手动停止'; break }
    await page.waitForTimeout(WAIT_MS)
    const elapsed = Math.round((Date.now() - start) / 1000)

    let bodyText = ''
    try { bodyText = await page.evaluate(() => document.body.innerText) } catch (_) {}
    await dismissPopups(page, log, '  [' + elapsed + 's] ')

    if (i % 5 === 4 || i < 3) {
      const kw = ['上传中', '上传失败', '标题', '填写作品', '发布']
      log('  [' + elapsed + 's] 关键字:' + kw.filter(k => bodyText.includes(k)).join(',') + ' URL=' + page.url().replace('https://cp.kuaishou.com', '...'))
    }

    if (bodyText.includes('上传失败') || bodyText.includes('上传出错')) {
      abortReason = '⛔ 视频上传失败'
      break
    }

    // 上传完成标志：不再有「上传中」，且出现标题输入框
    const stillUploading = (bodyText.match(/上传中/g) || []).length > 0
    let titleVisible = false
    try {
      const el = await page.$('input[placeholder*="标题"], input[placeholder*="作品"]')
      if (el && await el.isVisible().catch(() => false)) titleVisible = true
    } catch (_) {}

    if (!stillUploading && titleVisible) {
      editPageReady = true
      log('✅ 编辑页就绪 (' + elapsed + 's)')
      break
    }
    if (!stillUploading && i > 3) {
      log('  [' + elapsed + 's] 上传完成，等待表单渲染...')
    }
  }

  if (abortReason) { log('❌ ' + abortReason); return { success: false, message: abortReason } }
  if (!editPageReady) log('⚠️ 等待超时，强制继续...')
  await page.waitForTimeout(4000)
  await dismissPopups(page, log, '[上传后] ')
  return null
}

// ════════════════════════════════════
// Step 4: 填标题 + 描述
// ════════════════════════════════════

async function step4_fillContent(page, params, log) {
  log('[步骤4] 填写标题+描述')
  await page.waitForTimeout(1500)

  // ── 标题（清空再输入，最多20字）──
  let titleFilled = false
  if (params.title) {
    const titleText = String(params.title).substring(0, 20)
    const sels = ['input[placeholder*="标题"]', 'input[placeholder*="作品"]', 'input[maxlength]']
    for (const sel of sels) {
      try {
        const el = await page.$(sel)
        if (!el || !(await el.isVisible().catch(() => false))) continue
        await el.click({ timeout: 3000 })
        await page.waitForTimeout(400)
        await el.fill('')          // 先清空（快手标题需 clear）
        await page.waitForTimeout(200)
        await el.type(titleText, { delay: 60 })
        await page.waitForTimeout(400)
        const v = await el.evaluate(n => n.value).catch(() => '')
        if (v.trim().length > 0) { log('  ✅ 标题:"' + v + '"'); titleFilled = true; break }
      } catch (e) { log('  ⚠️ ' + sel + ': ' + e.message) }
    }
    if (!titleFilled) log('  ❌ 标题未填入')
  } else {
    log('[4a] 跳过（无标题）')
  }
  await page.waitForTimeout(1000)

  // ── 描述 ──
  let descFilled = false
  if (params.description) {
    const sels = ['textarea[placeholder*="简介"]', 'textarea[placeholder*="描述"]', 'textarea[placeholder*="介绍"]', 'div[contenteditable="true"]']
    for (const sel of sels) {
      try {
        const el = await page.$(sel)
        if (!el || !(await el.isVisible().catch(() => false))) continue
        await el.click({ timeout: 3000 })
        await page.waitForTimeout(400)
        if (sel.includes('contenteditable')) {
          await el.evaluate(n => { n.innerText = '' })
          await page.keyboard.type(params.description, { delay: 30 })
        } else {
          await el.fill(params.description)
        }
        await page.waitForTimeout(400)
        const v = await el.evaluate(n => n.value || n.innerText).catch(() => '')
        if (v.length > 0) { log('  ✅ 描述(' + v.length + '字)'); descFilled = true; break }
      } catch (e) { log('  ⚠️ ' + sel + ': ' + e.message) }
    }
    if (!descFilled) log('  ❌ 描述未填入')
  } else {
    log('[4b] 跳过（无描述）')
  }
  log('步骤4完成 → 标题:' + (titleFilled ? 'OK' : '失败') + ' 描述:' + (descFilled ? 'OK' : '失败'))
  await page.waitForTimeout(1000)
}

// ════════════════════════════════════
// Step 5: 话题（#标签 空格，最多3个，并入描述）
// ════════════════════════════════════

async function step5_topics(page, params, log) {
  let topics = typeof params.topics === 'string' ? params.topics.trim() : ''
  if (!topics) { log('[步骤5] 跳过（无话题）'); return }

  const list = topics.split(/[\s,，#]+/).filter(t => t.trim()).slice(0, 3) // 快手最多3个
  if (list.length === 0) { log('  ⚠️ 无有效话题'); return }
  log('[步骤5] 添加话题(最多3): ' + JSON.stringify(list))

  // 话题并入描述字段，格式 "#标签 "
  try {
    const desc = await page.$('textarea[placeholder*="简介"], textarea[placeholder*="描述"], textarea[placeholder*="介绍"], div[contenteditable="true"]')
    if (desc && await desc.isVisible().catch(() => false)) {
      await desc.click({ timeout: 2000 })
      await page.waitForTimeout(400)
      // 若描述已有内容，先补个换行/空格
      const existing = await desc.evaluate(n => n.value || n.innerText).catch(() => '')
      if (existing && existing.trim().length > 0) await page.keyboard.press('Space')
      for (let i = 0; i < list.length; i++) {
        const t = '#' + list[i].trim() + ' '  // 带空格，触发快手话题识别
        await page.keyboard.type(t, { delay: 40 })
        await page.waitForTimeout(500)
        log('  ✅ 已输入: ' + t)
      }
      await page.waitForTimeout(600)
    } else {
      log('  ⚠️ 未找到描述框，话题跳过')
    }
  } catch (e) { log('  ⚠️ 话题失败: ' + e.message) }
  log('✅ 步骤5完成')
  await page.waitForTimeout(1000)
}

// ════════════════════════════════════
// Step 6: 封面（无自定义封面 → 平台默认）
// ════════════════════════════════════

async function step6_covers(page, params, log) {
  log('[步骤6] 检查封面...')
  await page.waitForTimeout(1200)

  let localCoverPath = null
  if (params.coverImage) {
    const serverUrl = process.env.SERVER_URL || 'http://120.55.43.195:3000'
    const userId = params.userId || ''
    const coverDownloadUrl = serverUrl + '/api/storage/file?userId=' + userId + '&name=' + encodeURIComponent(params.coverImage)
    const tmpDir = path.join(require('os').tmpdir(), 'aimarketing-covers')
    if (!require('fs').existsSync(tmpDir)) require('fs').mkdirSync(tmpDir, { recursive: true })
    localCoverPath = path.join(tmpDir, params.coverImage)
    try {
      await new Promise((resolve, reject) => {
        const u = new URL(coverDownloadUrl)
        const mod = require(u.protocol === 'https:' ? 'https' : 'http')
        mod.get(coverDownloadUrl, { timeout: 60000 }, res2 => {
          if (res2.statusCode !== 200) return reject(new Error('HTTP ' + res2.statusCode))
          const c = []
          res2.on('data', x => c.push(x))
          res2.on('end', () => { require('fs').writeFileSync(localCoverPath, Buffer.concat(c)); resolve() })
        }).on('error', reject).on('timeout', () => reject(new Error('下载超时')))
      })
      log('  ✅ 封面已下载')
    } catch (e2) { log('  ⚠️ 封面下载失败: ' + e2.message); localCoverPath = null }
  }

  if (!(localCoverPath && require('fs').existsSync(localCoverPath))) {
    log('  跳过封面设置（无自定义封面，使用平台默认）')
    log('✅ 步骤6完成')
    await page.waitForTimeout(1200)
    return
  }

  // 有自定义封面：尝试「编辑封面」→ 上传（快手封面交互不稳定，best-effort）
  try {
    const entry = await page.$('text=编辑封面, text=更换封面, [class*="cover"] button')
    if (entry && await entry.isVisible().catch(() => false)) {
      await entry.click({ timeout: 3000 }).catch(() => {})
      await page.waitForTimeout(1800)
      let uploaded = false
      try {
        const [fc] = await Promise.all([
          page.waitForEvent('filechooser', { timeout: 5000 }).catch(() => null),
          page.click('text=上传封面, text=上传图片, [class*="upload"]', { timeout: 2000 }).catch(() => {}),
        ])
        if (fc) { await fc.setFiles(localCoverPath); uploaded = true }
        else {
          const fip = await page.$('input[type=file]').catch(() => null)
          if (fip) { await fip.setInputFiles(localCoverPath).catch(() => {}); uploaded = true }
        }
      } catch (_) {}
      if (uploaded) {
        log('  ✅ 已上传自定义封面')
        await page.waitForTimeout(2000)
        const done = await page.$('button:has-text("完成"), [class*="confirm"] button').catch(() => null)
        if (done && await done.isVisible().catch(() => false)) { await done.click({ timeout: 3000 }).catch(() => {}); log('  ✅ 封面确认完成') }
      } else log('  ⚠️ 未找到上传封面入口，使用平台默认')
    } else log('  ⚠️ 未找到「编辑封面」，使用平台默认')
  } catch (e) { log('  ⚠️ 封面步骤: ' + e.message) }
  await page.waitForTimeout(1200)
  log('✅ 步骤6完成')
}

// ════════════════════════════════════
// Step 7: 发布（两步） / 存草稿
// ════════════════════════════════════

async function step7_publish(page, params, log) {
  const isDraft = params.publishNow === 'false'
  log('[步骤7] ' + (isDraft ? '存草稿' : '发布（两步）'))
  await page.waitForTimeout(2000)

  const stillLogin = await isLoggedIn(page, log)
  if (!stillLogin) {
    return { success: false, message: '发布前检测到掉登录，请重新在指纹浏览器扫码登录快手后再发', needLogin: true }
  }

  if (isDraft) {
    try {
      await page.click('button:has-text("存草稿")', { timeout: 4000 })
      log('  ✅ 点击存草稿')
      await page.waitForTimeout(5000)
      return { success: true, message: '已存草稿到快手' }
    } catch (_) {
      return { success: true, message: '内容已填完，请手动点「存草稿」', needConfirm: true }
    }
  }

  // 第一步：点「发布」
  let step1 = false
  try {
    await page.click('button:has-text("发布")', { timeout: 5000 })
    step1 = true
    log('  ✅ 点击「发布」')
  } catch (e) { log('  ⚠️ 未找到「发布」按钮: ' + e.message) }

  await page.waitForTimeout(2500)

  // 第二步：点「确认发布」
  let step2 = false
  try {
    await page.click('button:has-text("确认发布")', { timeout: 5000 })
    step2 = true
    log('  ✅ 点击「确认发布」')
  } catch (e) {
    // 有些版本直接发布成功，无二次确认
    log('  ℹ️ 无「确认发布」弹窗（可能已直接发布）')
  }

  if (!step1 && !step2) {
    return { success: true, message: '内容已填完，请手动点「发布」', needConfirm: true }
  }

  log('等待发布响应(8s)...')
  await page.waitForTimeout(8000)

  const url = page.url()
  const bt = await page.evaluate(() => document.body.innerText).catch(() => '')
  if (url.includes('/article/manage/video') || bt.includes('发布成功') || bt.includes('已发布')) {
    log('🎉 发布成功！')
    return { success: true, message: '视频已发布到快手' }
  }
  log('⚠️ 结果不确定，请确认')
  return { success: true, message: '已执行发布，请手动确认', needConfirm: true }
}

// ════════════════════════════════════
// 主入口
// ════════════════════════════════════

/**
 * 执行快手视频发布
 * @param {import('playwright').Page} page
 * @param {{ videoPath: string, title?: string, description?: string, topics?: string, coverImage?: string, publishNow?: string, userId?: string }} params
 * @param {(msg:string)=>void} log
 */
async function executeKuaishouPublish(page, params, log) {
  const fs = require('fs')
  log('📋 参数检查开始...')
  log('   videoPath: ' + (params.videoPath || '未提供'))
  log('   title: ' + (params.title || '未提供'))
  log('   coverImage: ' + (params.coverImage || '无'))

  // 解析视频（素材仓库名 → 本地路径；修复“缺少 videoPath”断点）
  try {
    const resolved = await resolveLocalVideoPath(params, log)
    log('✅ 视频文件校验通过: ' + resolved)
  } catch (e) {
    log('❌ 视频解析失败: ' + e.message)
    return { success: false, message: '视频获取失败: ' + e.message }
  }

  try {
    log('▶ Step 1/6: 导航到发布页...')
    await step1_navigate(page, params, log)

    log('▶ 登录态检测...')
    if (!await isLoggedIn(page, log)) {
      return { success: false, message: '请先在指纹浏览器中登录快手账号（扫码）后再发布。登录后重新点击发布即可。', needLogin: true }
    }
    log('✅ 已登录，继续发布')

    log('▶ Step 2/6: 上传视频...')
    const upErr = await step2_upload(page, params, fs, log)
    if (upErr) return upErr
    log('✅ Step 2 完成')

    log('▶ Step 3/6: 等待转码...')
    const s3 = await step3_waitUpload(page, log)
    if (s3 && !s3.success) return s3
    log('✅ Step 3 完成')

    log('▶ Step 4/6: 填写标题+描述...')
    await step4_fillContent(page, params, log)
    log('✅ Step 4 完成')

    log('▶ Step 5/6: 添加话题...')
    await step5_topics(page, params, log)
    log('✅ Step 5 完成')

    log('▶ Step 6/6: 封面...')
    await step6_covers(page, params, log)

    log('▶ 发布...')
    return await step7_publish(page, params, log)
  } catch (e) {
    log('❌ 异常退出: ' + e.message)
    log('   堆栈: ' + (e.stack || '').substring(0, 300))
    return { success: false, message: e.message }
  }
}

module.exports = { executeKuaishouPublish }
