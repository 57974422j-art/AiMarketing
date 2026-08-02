// 视频号（微信视频号）创作者中心自动发布脚本
// 平台：channels.weixin.qq.com
// 登录方式：微信扫码（本脚本不处理登录，仅检测未登录并返回 needLogin:true）
// 发布模型：进入发布页 -> 登录检测 -> 上传视频 -> 填标题/话题/描述 -> 封面(方案A跳过) -> 发布/存草稿
const sleep = ms => new Promise(r => setTimeout(r, ms))

const SHIPINHAO_PUBLISH_URL = 'https://channels.weixin.qq.com/platform/post/create'
const { resolveLocalVideoPath } = require('./_common')
const { clickByTextCDP } = require('./_cdpClick')

async function isLoggedIn(page, log) {
  try {
    await page.waitForTimeout(2500)
    const url = page.url()
    // 未登录：URL 落在登录/授权页
    if (url.includes('login') || url.includes('passport') || url.includes('connect')) {
      log('  ⚠️ 检测到登录页 URL: ' + url)
      return false
    }
    const bodyText = await page.evaluate(() => document.body.innerText).catch(() => '')
    // 正向信号：发布表单已加载（已登录态）
    const hasPublishForm =
      bodyText.includes('发表视频') || bodyText.includes('上传视频') ||
      bodyText.includes('填写标题') || bodyText.includes('添加标题') ||
      bodyText.includes('视频标题') || bodyText.includes('选择视频') ||
      bodyText.includes('发表') || bodyText.includes('创建视频')
    // 反向信号：仅当页面出现扫码登录入口且没发布表单时才判未登录
    const hasLoginPrompt = bodyText.includes('扫码登录') || bodyText.includes('微信扫码')
    if (hasLoginPrompt && !hasPublishForm) {
      log('  ⚠️ 页面显示登录入口且无发布表单，判定为未登录')
      return false
    }
    if (!hasPublishForm) {
      // 既没有发布表单也没有登录入口，可能是页面未加载完，保守放行并提示
      log('  ⚠️ 未识别到明确的发布表单或登录入口，按已登录放行（如实际未登录请先扫码）')
    }
    return true
  } catch (e) {
    log(`登录检测异常: ${e.message}`)
    return false
  }
}

async function uploadVideo(page, videoPath, log) {
  const sel = 'input[type="file"]'
  // 视频号上传入口可能在 iframe 内：优先在 frame 中按选择器上传
  for (const frame of page.frames()) {
    try {
      const found = await frame.$(sel)
      if (found) {
        // 用选择器写法，Playwright 每次执行重新定位元素，避免 "detached element"
        await frame.setInputFiles(sel, videoPath, { timeout: 30000 })
        log('视频已选择（弹层/iframe），等待转码进入编辑页...')
        await page.waitForSelector('input[placeholder*="标题"], .input-editor', { timeout: 180000 })
        log('已进入编辑页')
        return
      }
    } catch (_) {}
  }

  // 主页面未见 file input：点击"上传视频 / 发表"触发上传入口出现
  if (!(await page.$(sel))) {
    try {
      await page.click('text=上传视频', { timeout: 5000 })
    } catch (_) {
      try { await page.click('button:has-text("发表")', { timeout: 5000 }) } catch (_) {}
    }
    await page.waitForSelector(sel, { timeout: 20000 })
  }

  // 关键修复：用选择器写法而非元素句柄，规避 "Cannot set input files to detached element"
  await page.setInputFiles(sel, videoPath, { timeout: 30000 })
  log('视频已选择，等待转码进入编辑页...')
  await page.waitForSelector('input[placeholder*="标题"], .input-editor', { timeout: 180000 })
  log('已进入编辑页')
}

/**
 * 将 topics 统一解析为标签数组。
 * 注意：params.topics 是【字符串】（如 "AI工具 短视频运营" 或 "AI工具，短视频运营"），
 * 不能当数组遍历，否则会被拆成单个字符（之前 bug：#A #I #工 #具…）。
 */
function parseTopics(raw) {
  if (Array.isArray(raw)) {
    return raw.map(t => String(t).replace(/^#/, '').trim()).filter(Boolean)
  }
  if (typeof raw === 'string') {
    return raw
      .split(/[\s,，、]+/)
      .map(t => t.replace(/^#/, '').trim())
      .filter(Boolean)
  }
  return []
}

/** 短标题：视频号独立输入框，限 16 字，只填标题本身（不塞话题） */
async function fillShortTitle(page, title, log) {
  const titleInput = await page.$('input[placeholder*="标题"]')
  if (!titleInput) {
    log('未找到短标题输入框，跳过')
    return
  }
  await titleInput.click()
  // 视频号短标题硬限 16 字，超出会被平台拒绝 → 截断避免“标题超过16字限制”
  const raw = (title || '').trim()
  const shortTitle = raw.slice(0, 16)
  if (raw.length > 16) log(`短标题超 16 字已截断为: ${shortTitle}`)
  await titleInput.fill(shortTitle)
  log('短标题已填写')
}

/**
 * 定位视频号「视频描述」输入框并填入。
 * 与短标题同一思路：短标题用 placeholder 定位（input[placeholder*="标题"]），
 * 描述则用它的专属 placeholder —— div.input-editor[data-placeholder="添加描述"]（contenteditable）。
 * ⚠️ 该字段在【视频上传/转码完成后】才渲染，且页面有多个 .post-deso-box（封面区也用，出现很早），
 *    所以【只等描述专属的 data-placeholder="添加描述"】，绝不用通用 .post-deso-box 等待（会提前放行）。
 * 找不到时返回 false —— 由主流程决定停止（不填标题、不点发布）。
 */
async function fillDescription(page, description, topics, log) {
  // 1) 只等「描述专属」的 data-placeholder="添加描述"，最多等 120s
  let sel = null
  try {
    await page.waitForSelector('div.input-editor[data-placeholder="添加描述"]', { timeout: 120000 })
    sel = 'div.input-editor[data-placeholder="添加描述"]'
    log('  [描述] 已等到描述输入框（data-placeholder="添加描述"）渲染')
  } catch (e) {
    log('  ⚠️ 等待描述输入框（data-placeholder="添加描述"）超时')
  }

  // 2) 兜底：按「视频描述」label 找所属 form-item 内的 contenteditable
  if (!sel) {
    sel = await page.evaluate(() => {
      const labels = Array.from(document.querySelectorAll('div.label, label, .label'))
      for (const lab of labels) {
        if ((lab.textContent || '').trim().includes('视频描述')) {
          const item = lab.closest('.form-item, [class*="item"], [class*="form"]') || lab.parentElement
          const ed = item && (item.querySelector('.input-editor') || item.querySelector('[contenteditable]'))
          if (ed) { ed.setAttribute('data-fp-desc', '1'); return '[data-fp-desc="1"]' }
        }
      }
      return null
    }).catch(() => null)
  }

  // 3) 再兜底：任意带“添加描述/话题/描述/简介”的 contenteditable
  if (!sel) {
    sel = await page.evaluate(() => {
      const all = Array.from(document.querySelectorAll('[contenteditable], .input-editor, textarea'))
      for (const el of all) {
        const ph = el.getAttribute('data-placeholder') || el.getAttribute('placeholder') || ''
        if (/添加描述|话题|描述|简介/.test(ph)) { el.setAttribute('data-fp-desc', '1'); return '[data-fp-desc="1"]' }
      }
      return null
    }).catch(() => null)
  }

  if (!sel) {
    // —— 找不到：dump 诊断信息，方便照真实结构精修，然后返回 false（主流程会停止）——
    try {
      const dump = await page.evaluate(() => {
        const forms = Array.from(document.querySelectorAll('.form-item'))
          .map((f) => (f.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80))
        const phs = Array.from(document.querySelectorAll('[data-placeholder]'))
          .map((el) => el.getAttribute('data-placeholder'))
        const hasEditor = !!document.querySelector('.input-editor')
        return { forms, phs, hasEditor }
      })
      log('  [描述诊断] form-item 文本: ' + JSON.stringify(dump.forms))
      log('  [描述诊断] 所有 data-placeholder: ' + JSON.stringify(dump.phs))
      log('  [描述诊断] 页面是否存在 .input-editor: ' + dump.hasEditor)
    } catch (_) {}
    log('  ❌ 未找到视频描述输入框，按约定【停止流程：不填标题、不点发布】')
    return false
  }
  log('  [描述] 已定位描述输入框: ' + sel)

  const tags = parseTopics(topics).map((t) => '#' + t)
  const parts = []
  if (description && description.trim()) parts.push(description.trim())
  if (tags.length) parts.push(tags.join(' '))
  const text = parts.join('\n')
  log('  [描述] 准备填入文本(' + text.length + '字): ' + text.slice(0, 60).replace(/\n/g, '\\n') + (text.length > 60 ? '…' : ''))
  const box = page.locator(sel)
  try {
    await box.click()
    // contenteditable 用 fill 不一定可靠，直接写 textContent + 派发 input/change 事件最稳
    await box.evaluate((el, t) => {
      el.focus()
      el.textContent = t
      el.dispatchEvent(new Event('input', { bubbles: true }))
      el.dispatchEvent(new Event('change', { bubbles: true }))
    }, text)
    log('  ✅ 视频描述（文案 + 话题）已填写')
  } catch (e) {
    log('  ⚠️ 视频描述填写失败: ' + e.message)
    return false
  }
  return true
}

async function publishOrDraft(page, publishNow, log) {
  // —— 等「发表」按钮出现且可点击（视频号编辑页底部主按钮，黄底白字 weui-desktop-btn_primary）——
  const baseSel = 'button:has-text("发表")'
  await page.waitForSelector(baseSel, { timeout: 180000 })
  for (let i = 0; i < 60; i++) {
    const disabled = await page
      .$eval(baseSel, (el) => el.classList.contains('weui-desktop-btn_disabled') || el.disabled)
      .catch(() => false)
    if (!disabled) break
    await sleep(2000)
  }

  if (!publishNow) {
    log('点击【存草稿】...')
    try { await page.click('button:has-text("存草稿")') } catch (_) {
      await clickByTextCDP(page, log, ['存草稿'])
    }
    await sleep(5000)
    return page.url()
  }

  log('点击【发表】发布视频号...')
  // ⚠️ 页面可能含多个“发表”（顶部“发表视频”入口等），必须点【底部黄底白字主按钮】。
  // 策略：① weui-desktop-btn_primary:has-text("发表") ② 最后一个 button:has-text("发表") ③ CDP 穿透保底
  let ok = false

  // ① 黄色主按钮（黄底白字）
  try {
    const primary = page.locator('button.weui-desktop-btn_primary:has-text("发表")').first()
    if (await primary.count()) {
      await primary.scrollIntoViewIfNeeded()
      await primary.click({ timeout: 10000 })
      ok = true
      log('  [发表] 已点击黄色主按钮(weui-desktop-btn_primary)')
    }
  } catch (e) { log('  [黄色主按钮点击失败] ' + e.message) }

  // ② 兜底：最后一个含“发表”的按钮（编辑页底部发表按钮在 DOM 末尾）
  if (!ok) {
    try {
      const all = page.locator('button:has-text("发表")')
      const n = await all.count()
      if (n) {
        const last = all.nth(n - 1)
        await last.scrollIntoViewIfNeeded()
        await last.click({ timeout: 10000 })
        ok = true
        log('  [发表] 已点击最后一个“发表”按钮(页面共 ' + n + ' 个匹配)')
      }
    } catch (e) { log('  [最后发表按钮点击失败] ' + e.message) }
  }

  // ③ CDP 穿透保底（绕过 Playwright 点击盲区）
  if (!ok) {
    log('  [常规点击失败] 改用 CDP 穿透保底点击「发表」')
    ok = await clickByTextCDP(page, log, ['发表', '发布'])
  }
  if (!ok) log('  ❌ 未能点击「发表」，请手动点击')

  await sleep(5000)
  return page.url()
}

async function executeShipinhaoPublish(page, params, log) {
  try {
    log('导航到视频号创作者发布页...')
    const url = page.url()
    if (!url.includes('channels.weixin.qq.com')) {
      await page.goto(SHIPINHAO_PUBLISH_URL, { timeout: 30000 })
      await page.waitForTimeout(3000)
    }

    if (!(await isLoggedIn(page, log))) {
      return {
        success: false,
        message: '请先在指纹浏览器中登录视频号（微信扫码），再发布。登录后账号会长期保留在 profile 中。',
        needLogin: true,
      }
    }

    // 解析视频（素材仓库名 → 本地路径；修复“缺少 videoPath”断点）
    try {
      await resolveLocalVideoPath(params, log)
    } catch (e) {
      log('❌ 视频解析失败: ' + e.message)
      return { success: false, message: '视频获取失败: ' + e.message }
    }

    await uploadVideo(page, params.videoPath, log)
    // 先填视频描述：找不到就停下整个流程（按约定不填标题、不点发布），便于排查
    const descOk = await fillDescription(page, params.description, params.topics, log)
    if (!descOk) {
      log('⛔ 视频描述未填写成功，已停止整个发布流程（未填短标题、未点发表）。请检查上方[描述诊断]')
      return { success: false, message: '未找到/未填写视频描述，已停止发布（未发布）' }
    }
    await fillShortTitle(page, params.title, log)

    // 封面：方案A（1.0.4）—— 无自定义封面时跳过，使用平台默认帧
    if (params.coverImage) {
      log('检测到自定义封面，视频号封面选择需手动，本次跳过使用平台默认')
    }

    const resultUrl = await publishOrDraft(page, params.publishNow !== false, log)
    log('视频号发布流程完成')
    return {
      success: true,
      message: params.publishNow !== false ? '视频号发布成功' : '已存入草稿',
      url: resultUrl,
      needConfirm: false,
    }
  } catch (e) {
    log(`出错: ${e.message}`)
    return { success: false, message: e.message }
  }
}

module.exports = { executeShipinhaoPublish }
