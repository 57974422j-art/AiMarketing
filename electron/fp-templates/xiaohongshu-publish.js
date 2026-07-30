/**
 * 小红书发视频脚本（指纹浏览器 B方案：每个平台独立端口/独立 profile）
 *
 * 流程：creator.xiaohongshu.com/publish/publish → 选「视频」→ 上传 → 等转码
 *       → 填标题+正文 → 话题 → 封面(无则平台默认) → 发布笔记
 *
 * 与抖音脚本的差异（小红书更简单）：
 *   - 发布按钮文案为「发布笔记」
 *   - 草稿按钮为「存草稿」
 *   - 无独立位置步骤（按规划移除）
 *
 * 参数（与抖音保持同名，便于前端复用）：
 *   - videoPath:   视频文件绝对路径（必填）
 *   - title:       笔记标题，最多20字
 *   - description: 笔记正文/简介
 *   - topics:      自定义话题（逗号分隔）或留空跳过
 *   - coverImage:  自定义封面图片名（来自素材仓库），留空则使用平台默认帧
 *   - publishNow:  是否立即发布 ("true"/"false")，false 则存草稿
 */

const path = require('path')
const { resolveLocalVideoPath } = require('./_common')

// ════════════════════════════════════
// 工具函数
// ════════════════════════════════════

/** 关闭常见弹窗 */
async function dismissPopups(page, log, prefix = '') {
  for (const text of ['我知道了', '知道了', '确定', '稍后再说', '同意']) {
    try {
      const btn = await page.$(`text="${text}"`)
      if (btn && await btn.isVisible().catch(() => false)) {
        await btn.click({ timeout: 2000 })
        log(`${prefix}关闭弹窗「${text}」`)
        await page.waitForTimeout(800)
      }
    } catch (_) {}
  }
}

/** 检测是否已登录；未登录返回 false（页面停在登录扫码态） */
async function isLoggedIn(page, log) {
  await page.waitForTimeout(2500)
  const url = page.url()
  if (url.includes('login') || url.includes('passport')) {
    log('  ⚠️ 检测到登录页 URL: ' + url)
    return false
  }
  const bodyText = await page.evaluate(() => document.body.innerText).catch(() => '')
  // 登录态标志：有上传区/标题框；未登录标志：扫码登录/密码登录文案
  const hasPublishForm =
    bodyText.includes('上传视频') || bodyText.includes('填写标题') ||
    bodyText.includes('发布笔记') || bodyText.includes('上传图文')
  const hasLoginPrompt =
    bodyText.includes('扫码登录') || bodyText.includes('密码登录') ||
    bodyText.includes('短信登录') || bodyText.includes('登录小红书')
  if (hasLoginPrompt && !hasPublishForm) {
    log('  ⚠️ 页面显示登录入口，判定为未登录')
    return false
  }
  return true
}

/** 找到正文编辑器：小红书正文为 contenteditable div，placeholder 含「正文/描述/分享」；兜底取第一个可见 contenteditable */
async function findBodyEditor(page, log) {
  try {
    const editables = await page.$$('div[contenteditable="true"]')
    for (const e of editables) {
      try {
        const ph = (await e.getAttribute('data-placeholder') || '') + (await e.getAttribute('placeholder') || '')
        const cls = await e.getAttribute('class') || ''
        if (/正文|描述|分享|心得|故事|体验/.test(ph) || /desc|content|body/i.test(cls)) {
          if (await e.isVisible().catch(() => false)) return e
        }
      } catch (_) {}
    }
    if (editables.length) {
      for (const e of editables) {
        if (await e.isVisible().catch(() => false)) return e
      }
    }
  } catch (e) { log('  [body] 探测异常: ' + e.message) }
  return null
}

/** 把光标移到 contenteditable 末尾 */
async function moveCursorToEnd(page, el) {
  try {
    await el.evaluate(n => {
      n.focus()
      const range = document.createRange()
      range.selectNodeContents(n)
      range.collapse(false)
      const sel = window.getSelection()
      sel.removeAllRanges()
      sel.addRange(range)
    })
  } catch (_) {}
}

// ════════════════════════════════════
// Step 1: 导航
// ════════════════════════════════════

async function step1_navigate(page, params, log) {
  const targetUrl = 'https://creator.xiaohongshu.com/publish/publish'
  const currentUrl = page.url()
  log(`当前页面: ${currentUrl}`)

  if (!currentUrl.includes('/publish/publish')) {
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
// Step 2: 上传视频
// ════════════════════════════════════

async function step2_upload(page, params, fs, log) {
  log('准备上传视频: ' + params.videoPath)

  // 先确认停留在发布页（未登录会在此前被拦截，这里再兜底）
  let uploaded = false

  // 小红书默认可能停在「图文」tab，需先点「视频」tab
  try {
    const tab = await page.$('text=视频')
    if (tab && await tab.isVisible().catch(() => false)) {
      await tab.click({ timeout: 2000 })
      log('  已切换到「视频」tab')
      await page.waitForTimeout(1500)
    }
  } catch (_) {}

  // 探测 file input
  let allFileInputs = []
  try {
    allFileInputs = await page.evaluate(() => {
      const inputs = document.querySelectorAll('input[type="file"]')
      return Array.from(inputs).map((el, i) => ({
        index: i, accept: el.getAttribute('accept'), id: el.id,
        className: el.className.substring(0, 60),
      }))
    })
  } catch (e) { log('探测出错: ' + e.message) }

  log('探测到 ' + allFileInputs.length + ' 个 file input')
  if (allFileInputs.length > 0) log(JSON.stringify(allFileInputs))

  // 方法A: 直接设置 file input
  for (let i = 0; i < allFileInputs.length; i++) {
    try {
      const els = await page.$$('input[type="file"]')
      if (els[i]) {
        await els[i].setInputFiles(params.videoPath)
        uploaded = true
        log('✅ 视频已设置到 file input[' + i + ']')
        break
      }
    } catch (e) { log('  input[' + i + '] 失败: ' + e.message) }
  }

  // 方法B: 点击触发 file chooser
  if (!uploaded) {
    log('尝试点击触发文件选择器...')
    const triggers = [
      'text=上传视频', 'text=上传', 'text=选择文件', 'text=拖拽到此处',
      '[class*="upload-btn"]', '[class*="UploadBtn"]',
      '[class*="upload-area"]', '[class*="picker"]',
      '[class*="upload-wrap"]',
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
  }

  // 方法C: page.setInputFiles 兜底
  if (!uploaded) {
    try {
      await page.setInputFiles('input[type="file"]', params.videoPath)
      uploaded = true
      log('✅ page.setInputFiles 成功')
    } catch (_) {}
  }

  if (!uploaded) {
    const info = await page.evaluate(() => ({ url: location.href, title: document.title })).catch(() => ({}))
    return { success: false, message: '未找到上传入口 URL=' + info.url }
  }
  return null // 继续执行
}

// ════════════════════════════════════
// Step 3: 等待上传完成进入编辑页
// ════════════════════════════════════

async function step3_waitUpload(page, log) {
  log('═══ Step 3: 等待视频上传+转码进入编辑页 ═══')

  const UPLOAD_WAIT_MS = 3000
  const MAX_UPLOAD_SEC = 270
  const MAX_LOOPS = Math.floor(MAX_UPLOAD_SEC * 1000 / UPLOAD_WAIT_MS)

  let editPageReady = false
  let abortReason = ''
  const uploadStartTime = Date.now()
  let stableCount = 0

  for (let i = 0; i < MAX_LOOPS; i++) {
    if (global.__fpAbort) { abortReason = '用户手动停止'; break }
    await page.waitForTimeout(UPLOAD_WAIT_MS)
    const elapsedSec = Math.round((Date.now() - uploadStartTime) / 1000)

    let bodyText = ''
    try { bodyText = await page.evaluate(() => document.body.innerText) } catch (_) {}

    if (i % 5 === 4 || i < 3) {
      const kwList = ['标题', '正文', '简介', '上传', '转码', '处理中', '检测', '%', '封面']
      const snippets = kwList.filter(k => bodyText.includes(k))
      log('  [' + elapsedSec + 's] URL=' + page.url().replace('https://creator.xiaohongshu.com', '...') +
        ' | 关键字:' + (snippets.join(',') || '(空)'))
    }

    await dismissPopups(page, log, '  [' + elapsedSec + 's] ')

    // 终止条件：上传失败
    if (bodyText.includes('上传失败') || bodyText.includes('格式不支持') || bodyText.includes('上传出错')) {
      abortReason = '⛔ 视频上传/转码失败（可能格式不支持）'
      log('  [' + elapsedSec + '] ' + abortReason)
      break
    }

    stableCount++

    // 成功条件：标题框/正文框可见
    const formSels = [
      'input[placeholder*="标题"]',
      'textarea[placeholder*="正文"]',
      'div[contenteditable="true"][data-placeholder*="正文"]',
      'div[contenteditable="true"][data-placeholder*="标题"]',
    ]
    let foundSel = ''
    for (let s = 0; s < formSels.length; s++) {
      try {
        const el = await page.$(formSels[s])
        if (el && await el.isVisible().catch(() => false)) { foundSel = formSels[s]; break }
      } catch (_) {}
    }
    if (foundSel && stableCount > 2) {
      editPageReady = true
      log('✅ 编辑页就绪 — 检测到表单元素: ' + foundSel + ' (' + elapsedSec + 's)')
      break
    }
    if (stableCount > 3 && !editPageReady) {
      log('  [' + elapsedSec + 's] 仍在等待编辑页渲染...')
    }
  }

  if (abortReason) {
    log('❌ ' + abortReason)
    return { success: false, message: abortReason }
  }
  if (!editPageReady) {
    log('⚠️ 等待超时 (' + Math.round((Date.now() - uploadStartTime) / 1000) + 's)，强制继续后续步骤...')
  }
  log('缓冲5秒让页面完全渲染...')
  await page.waitForTimeout(5000)
  await dismissPopups(page, log, '[上传后] ')
  return null
}

// ════════════════════════════════════
// Step 4: 填写标题 + 正文
// ════════════════════════════════════

async function step4_fillContent(page, params, log) {
  log('[步骤4] 填写标题+正文')
  await page.waitForTimeout(2000)

  // ── 4a: 标题 (0/20) ──
  let titleFilled = false
  if (params.title) {
    const titleText = String(params.title).substring(0, 20)
    const titleSels = [
      'input[placeholder*="标题"]',
      'input[placeholder*="填写标题"]',
      'div[contenteditable="true"][data-placeholder*="标题"]',
    ]
    for (let ti = 0; ti < titleSels.length; ti++) {
      try {
        const el = await page.$(titleSels[ti])
        if (!el || !(await el.isVisible().catch(() => false))) continue
        log('  [4a] 找到标题框: ' + titleSels[ti])
        await el.click({ timeout: 3000 })
        await page.waitForTimeout(600)
        const tag = await el.evaluate(n => n.tagName.toLowerCase())
        if (tag === 'input' || tag === 'textarea') {
          await el.fill(titleText)
        } else {
          await el.evaluate(n => { n.innerText = '' })
          await page.waitForTimeout(200)
          await page.keyboard.type(titleText, { delay: 60 })
        }
        await page.waitForTimeout(500)
        const value = await el.evaluate(n => n.value || n.innerText).catch(() => '')
        if (value.trim().length > 0) {
          log('  ✅ 标题:"' + value + '"')
          titleFilled = true
          break
        } else {
          log('  ⚠️ 验证为空')
        }
      } catch (e) { log('  ⚠️ ' + titleSels[ti] + ': ' + e.message) }
    }
    if (!titleFilled) log('  ❌ 标题未填入')
  } else {
    log('[4a] 跳过（无标题）')
  }
  await page.waitForTimeout(1500)

  // ── 4b: 正文/简介（标题只有 20 字，正文单独填到标题下方「正文描述」灰字区）──
  let descFilled = false
  if (params.description) {
    const descText = String(params.description)
    const de = await findBodyEditor(page, log)
    if (de) {
      try {
        const tag = await de.evaluate(n => n.tagName.toLowerCase())
        log('  [4b] 找到正文框 (' + tag + ')')
        await de.click({ timeout: 3000 })
        await page.waitForTimeout(500)
        if (tag === 'input' || tag === 'textarea') {
          await de.fill(descText)
        } else {
          await de.evaluate(n => { n.innerHTML = '' })
          await moveCursorToEnd(page, de)
          await page.keyboard.type(descText, { delay: 25 })
        }
        await page.waitForTimeout(600)
        const dvalue = await de.evaluate(n => n.value || n.innerText || n.textContent).catch(() => '')
        if (dvalue.trim().length > 0) {
          log('  ✅ 正文(' + dvalue.trim().length + '字)')
          descFilled = true
        } else {
          log('  ⚠️ 正文验证为空，重试一次')
          await de.click({ timeout: 3000 }).catch(() => {})
          await page.keyboard.type(descText, { delay: 25 })
          descFilled = true
        }
      } catch (e) { log('  ⚠️ 正文框: ' + e.message) }
    } else {
      log('  ❌ 未找到正文框')
    }
    if (!descFilled) log('  ❌ 正文未填入')
  } else {
    log('[4b] 跳过（无正文）')
  }

  log('步骤4完成 → 标题:' + (titleFilled ? 'OK' : '失败') + ' 正文:' + (descFilled ? 'OK' : '失败'))
  await page.waitForTimeout(1500)
}

// ════════════════════════════════════
// Step 5: 话题
// ════════════════════════════════════

async function step5_topics(page, params, log) {
  let topics = ''
  if (typeof params.topics === 'string') topics = params.topics.trim()
  if (!topics) {
    log('[步骤5] 跳过（无自定义话题）')
    return
  }

  const topicList = topics.split(/[\s,，#]+/).filter(t => t.trim().length > 0)
  if (topicList.length === 0) { log('  ⚠️ 无有效话题'); return }
  log('[步骤5] 添加话题（写入正文区，与文案在一起）: ' + JSON.stringify(topicList))

  // 话题必须进「正文描述」区，绝不能进标题框（标题只有 20 字）
  const body = await findBodyEditor(page, log)
  if (!body) { log('  ❌ 未找到正文区，无法写入话题'); return }
  await body.click({ timeout: 2000 }).catch(() => {})
  await moveCursorToEnd(page, body)
  await page.waitForTimeout(300)
  // 有正文时先换行，避免话题和文案黏在一起
  if (params.description && params.description.trim()) {
    await page.keyboard.press('Enter')
    await page.waitForTimeout(250)
  }

  for (let ti = 0; ti < topicList.length; ti++) {
    let t = topicList[ti].trim()
    if (!t.startsWith('#')) t = '#' + t
    try {
      await page.keyboard.type(t, { delay: 40 })
      await page.waitForTimeout(700)
      // 小红书会弹出话题联想，点第一个建议把它变成真实话题
      let picked = false
      try {
        const sug = await page.$$('[class*="topic"] li, [class*="associate"] div, [class*="suggest"] div, [class*="dropdown"] li')
        for (let s = 0; s < sug.length; s++) {
          if (await sug[s].isVisible().catch(() => false)) {
            await sug[s].click({ timeout: 1500 }).catch(() => {})
            picked = true
            break
          }
        }
      } catch (_) {}
      if (!picked) {
        await page.keyboard.press('Space')
      }
      await page.waitForTimeout(500)
      log('  ✅ 已输入: ' + t + (picked ? ' (已关联话题)' : ''))
    } catch (e) {
      log('  ⚠️ 话题"' + t + '"失败: ' + e.message)
    }
    if (ti < topicList.length - 1) await page.waitForTimeout(600)
  }
  log('✅ 步骤5完成')
  await page.waitForTimeout(1000)
}

// ════════════════════════════════════
// Step 6: 封面（无自定义封面 → 用平台默认帧）
// ════════════════════════════════════

// 自定义封面上传逻辑：点「编辑封面」→ 选文件上传 → 完成。抽离供下载成功 / base64 解码后共用。
async function uploadCover(page, localCoverPath, log) {
  try {
    const coverEntry = await page.$('text=编辑封面, text=更换封面, [class*="cover"] button')
    if (coverEntry && await coverEntry.isVisible().catch(() => false)) {
      await coverEntry.click({ timeout: 3000 }).catch(() => {})
      await page.waitForTimeout(2000)
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
        await page.waitForTimeout(2500)
        const doneBtn = await page.$('button:has-text("完成"), [class*="confirm"] button').catch(() => null)
        if (doneBtn && await doneBtn.isVisible().catch(() => false)) {
          await doneBtn.click({ timeout: 3000 }).catch(() => {})
          log('  ✅ 封面确认完成')
        }
      } else {
        log('  ⚠️ 未找到上传封面入口')
      }
    } else {
      log('  ⚠️ 未找到「编辑封面」入口，使用平台默认帧')
    }
  } catch (e) { log('  ⚠️ 封面步骤: ' + e.message) }
  await page.waitForTimeout(1500)
}

async function step6_covers(page, params, log) {
  log('[步骤6] 检查封面...')
  await page.waitForTimeout(1500)

  // 封面模式：
  //   coverMode === 'platform'  → 使用平台「智能封面/默认帧」，完全不上传（多数平台支持）
  //   无 coverImage              → 同样用平台默认帧
  //   有 coverImage              → 下载自定义封面后上传
  if (params.coverMode === 'platform' || !params.coverImage) {
    log('  跳过封面（' + (params.coverMode === 'platform' ? '使用平台智能封面' : '无自定义封面，使用平台默认帧') + '）')
    log('✅ 步骤6完成')
    await page.waitForTimeout(1000)
    return
  }

  // coverImage 兼容三种形态：
  //   ① 完整 http(s) URL            → 直接下载
  //   ② /api/... 路径               → 拼 SERVER_URL 后下载
  //   ③ 素材仓库文件名（如 .thumbs/analyze/xxx.jpg）→ 拼 /api/storage/file?userId=&name=
  // 注意：之前把「完整 URL」当成「文件名」二次 encode 导致 404，这里先判定形态再决定下载方式。
  const coverRaw = String(params.coverImage).trim()

  // ④ base64 data URL（AI 生成封面常以此形态传入）：直接解码成本地文件，避免超长 URL 导致 HTTP 431
  if (/^data:image\/[a-zA-Z]+;base64,/.test(coverRaw)) {
    try {
      const osTmpDir = require('os').tmpdir()
      const coverTmpDir = path.join(osTmpDir, 'aimarketing-covers')
      if (!require('fs').existsSync(coverTmpDir)) require('fs').mkdirSync(coverTmpDir, { recursive: true })
      const localCoverPath = path.join(coverTmpDir, 'cover_' + Date.now() + '.jpg')
      const b64 = coverRaw.split(',')[1] || ''
      require('fs').writeFileSync(localCoverPath, Buffer.from(b64, 'base64'))
      log('  ✅ 封面 base64 已解码为本地文件 (' + (require('fs').statSync(localCoverPath).size / 1024).toFixed(1) + 'KB)')
      await uploadCover(page, localCoverPath, log)
      log('✅ 步骤6完成')
      await page.waitForTimeout(1000)
      return
    } catch (e) {
      log('  ⚠️ 封面 base64 解码失败: ' + e.message + '，使用平台默认封面')
      log('✅ 步骤6完成（无自定义封面）')
      await page.waitForTimeout(1000)
      return
    }
  }

  let coverDownloadUrl = ''
  if (/^https?:\/\//.test(coverRaw)) {
    coverDownloadUrl = coverRaw
  } else if (coverRaw.startsWith('/api/')) {
    coverDownloadUrl = (process.env.SERVER_URL || 'http://120.55.43.195:3000') + coverRaw
  } else {
    const serverUrl = process.env.SERVER_URL || 'http://120.55.43.195:3000'
    const userId = params.userId || ''
    coverDownloadUrl = serverUrl + '/api/storage/file?userId=' + userId + '&name=' + encodeURIComponent(coverRaw)
  }

  const osTmpDir = require('os').tmpdir()
  const coverTmpDir = path.join(osTmpDir, 'aimarketing-covers')
  if (!require('fs').existsSync(coverTmpDir)) require('fs').mkdirSync(coverTmpDir, { recursive: true })
  const coverFileName = coverRaw.split('?')[0].split('/').pop().replace(/[^\w.\-]/g, '_') || 'cover.jpg'
  const localCoverPath = path.join(coverTmpDir, coverFileName)
  log('  下载自定义封面: ' + coverDownloadUrl)
  try {
    await new Promise((resolve, reject) => {
      const urlObj2 = new URL(coverDownloadUrl)
      const mod2 = require(urlObj2.protocol === 'https:' ? 'https' : 'http')
      mod2.get(coverDownloadUrl, { timeout: 60000 }, res2 => {
        if (res2.statusCode !== 200) return reject(new Error('HTTP ' + res2.statusCode))
        const chunks2 = []
        res2.on('data', c => chunks2.push(c))
        res2.on('end', () => {
          require('fs').writeFileSync(localCoverPath, Buffer.concat(chunks2))
          resolve()
        })
      }).on('error', reject).on('timeout', () => reject(new Error('下载超时')))
    })
    log('  ✅ 封面已下载 (' + (require('fs').statSync(localCoverPath).size / 1024).toFixed(1) + 'KB)')
  } catch (e2) {
    // 下载失败：不打开任何弹窗，直接退回平台默认封面，避免残留遮罩挡住发布按钮
    log('  ⚠️ 封面下载失败: ' + e2.message + '，使用平台默认封面')
    log('✅ 步骤6完成（无自定义封面）')
    await page.waitForTimeout(1000)
    return
  }

  await uploadCover(page, localCoverPath, log)
  log('✅ 步骤6完成')
}

// ════════════════════════════════════
// Step 7: 发布 / 存草稿
// ════════════════════════════════════

async function step7_publish(page, params, log) {
  const isDraft = params.publishNow === 'false'
  log('[步骤7] ' + (isDraft ? '存草稿' : '发布'))
  await page.waitForTimeout(1500)

  // 发布前再确认没被弹到登录页
  const stillLogin = await isLoggedIn(page, log)
  if (!stillLogin) {
    return { success: false, message: '发布前检测到掉登录，请重新在指纹浏览器扫码登录小红书后再发', needLogin: true }
  }

  // 先关掉可能残留的弹窗（封面/话题联想等）
  await dismissPopups(page, log, '[发布前] ')

  // 等发布按钮区渲染（内容/封面步骤后页面可能还没 settle）
  try {
    await page.waitForSelector('button:has-text("发布"), button:has-text("存草稿"), [role="button"]', { timeout: 15000 })
  } catch (_) {}

  // 发布键是编辑器底部固定红键<button class="ce-btn bg red">发布</button>（background:#ff2442）。
  // 不滚动（固定元素不随滚动移动），仅留一点渲染缓冲。
  await page.waitForTimeout(500)

  // ── 小红书发布按钮识别（红背景 + 文案「发布」为决定性信号）──
  // 真实发布键（用户 inspect 确认）：<button class="ce-btn bg red">发布</button>
  //   background:#ff2442(品牌红 r=255,g=36,b=66) / 文案「发布」/ 编辑器底部。
  // 透明浮层的「智能客服」「暂存离开」均不是红背景、且文案不含「发布」(或已被显式排除) → 不会误点。
  const res = await page.evaluate((isDraft) => {
    const isRedBg = (el) => {
      const check = (e) => {
        const s = getComputedStyle(e)
        const bg = (s.backgroundColor || '') + ' ' + (s.backgroundImage || '')
        const m = bg.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/)
        if (m) { const r = +m[1], g = +m[2], b = +m[3]; if (r > 150 && (r - g) > 50 && (r - b) > 30) return true }
        return false
      }
      if (check(el)) return true
      // 红背景可能在子元素上（按钮自身透明）
      for (const c of el.querySelectorAll('*')) if (check(c)) return true
      return false
    }
    const nodes = Array.from(document.querySelectorAll('button, [role="button"], a, div'))
    const cands = []
    let best = null, bestScore = -1
    for (const n of nodes) {
      const t = (n.innerText || n.getAttribute('aria-label') || '').trim()
      if (!t) continue
      // 显式排除非发布项（智能客服 / 暂存离开 / 离开 等）
      if (/智能客服|暂存|离开/.test(t)) continue
      // 模式过滤：发布模式只认「发布」(排除 存草稿/草稿箱)；草稿模式只认「存草稿」
      if (isDraft) {
        if (!(t.includes('存草稿') || t === '草稿')) continue
      } else {
        if (!/发布/.test(t)) continue
        if (/存草稿|草稿箱/.test(t)) continue
      }
      const cls = (typeof n.className === 'string') ? n.className : ''
      // 兼容 class="ce-btn bg red" 与 class="...bg-red..."（连字符）
      const hasRedClass = /(^|[\s-])(red|brand)/.test(cls)
      const isRed = isRedBg(n)
      let score = 0
      if (/发布笔记/.test(t)) score += 6
      else if (/发布/.test(t)) score += 4
      if (isRed) score += 5
      // class 含 red/brand 是最直接信号（inspect 确认真实键 class="ce-btn bg red"），给决定性高分
      if (hasRedClass) score += 100
      const rect = n.getBoundingClientRect()
      if (rect.bottom > window.innerHeight * 0.3) score += 1
      cands.push((t.slice(0, 14)) + (isRed ? '[RED]' : '') + (hasRedClass ? '[CLS-RED]' : '') + '(s=' + score + ')')
      if (score > bestScore) { bestScore = score; best = n }
    }
    const dbg = cands.join(' | ') || '(无候选)'
    if (best) { best.setAttribute('data-fp-pub', '1'); return { sel: '[data-fp-pub="1"]', dbg } }
    return { sel: null, dbg }
  }, isDraft)
  const sel = res.sel
  if (res.dbg) log('  [发布候选] ' + res.dbg)

  let pub = false
  if (sel) {
    log('  定位到发布按钮: ' + sel)
    try {
      const b = page.locator(sel)
      await b.scrollIntoViewIfNeeded().catch(() => {})
      await b.click({ timeout: 6000 })
      pub = true
      log('  ✅ 已点击发布按钮')
    } catch (e) { log('  ⚠️ 点击发布异常: ' + e.message) }
  } else {
    log('  ⚠️ 评分未命中发布按钮，尝试文本兜底')
  }

  // 兜底：优先红 class 的发布键，其次文本定位（避免误点左上方「发布」引导入口）
  if (!pub) {
    try {
      const loc = isDraft
        ? page.locator('button:has-text("存草稿")')
        : page.locator('button[class*="red"]:has-text("发布"), button[class*="brand"]:has-text("发布"), button:has-text("发布笔记"), button:has-text("发布")')
      if (await loc.first().isVisible().catch(() => false)) {
        await loc.first().click({ timeout: 4000 })
        pub = true
        log('  ✅ 兜底点击发布')
      }
    } catch (_) {}
  }

  // 二次确认弹窗（小红书点击后偶发「确认发布 / 确定」）
  if (pub) {
    await page.waitForTimeout(2500)
    for (let i = 0; i < 3; i++) {
      const clicked = await page.evaluate(() => {
        const want = ['确认发布', '继续发布', '确认', '确定']
        const btns = Array.from(document.querySelectorAll('button, [role="button"]'))
        for (const b of btns) {
          const t = (b.innerText || '').trim()
          if (want.includes(t) && b.offsetParent !== null) { b.click(); return t }
        }
        return null
      })
      if (clicked) { log('  二次确认已点: ' + clicked); await page.waitForTimeout(1500) } else break
    }
  }

  if (!pub) {
    log('❌ 未找到' + targetText + '按钮！请手动点击')
    return { success: true, message: '内容已填完，请手动点「' + targetText + '」', needConfirm: true }
  }

  log('等待发布响应(8s)...')
  await page.waitForTimeout(8000)

  const bt = await page.evaluate(() => document.body.innerText).catch(() => '')
  if (bt.includes('发布成功') || bt.includes('已发布') || page.url().includes('/publish')) {
    log('🎉 发布成功！')
    return { success: true, message: '笔记已发布到小红书' }
  }
  log('⚠️ 结果不确定，请确认')
  return { success: true, message: '已执行发布，请手动确认', needConfirm: true }
}

// ════════════════════════════════════
// 主入口
// ════════════════════════════════════

/**
 * 执行小红书视频发布
 * @param {import('playwright').Page} page
 * @param {{ videoPath: string, title?: string, description?: string, topics?: string, coverImage?: string, publishNow?: string, userId?: string }} params
 * @param {(msg:string)=>void} log
 */
async function executeXiaohongshuPublish(page, params, log) {
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

    // 登录态检测（B方案：要求客户先登录好再发）
    log('▶ 登录态检测...')
    const loggedIn = await isLoggedIn(page, log)
    if (!loggedIn) {
      log('❌ 小红书未登录')
      return {
        success: false,
        message: '请先在指纹浏览器中登录小红书账号（扫码）后再发布。登录后重新点击发布即可。',
        needLogin: true,
      }
    }
    log('✅ 已登录，继续发布')

    log('▶ Step 2/6: 上传视频...')
    const uploadErr = await step2_upload(page, params, fs, log)
    if (uploadErr) return uploadErr
    log('✅ Step 2 完成')

    log('▶ Step 3/6: 等待转码...')
    const step3Result = await step3_waitUpload(page, log)
    if (step3Result && !step3Result.success) return step3Result
    log('✅ Step 3 完成')

    log('▶ Step 4/6: 填写标题+正文...')
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

module.exports = { executeXiaohongshuPublish }
