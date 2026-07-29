// 视频号（微信视频号）创作者中心自动发布脚本
// 平台：channels.weixin.qq.com
// 登录方式：微信扫码（本脚本不处理登录，仅检测未登录并返回 needLogin:true）
// 发布模型：进入发布页 -> 登录检测 -> 上传视频 -> 填标题/话题/描述 -> 封面(方案A跳过) -> 发布/存草稿
const sleep = ms => new Promise(r => setTimeout(r, ms))

const SHIPINHAO_PUBLISH_URL = 'https://channels.weixin.qq.com/platform/post/create'
const { resolveLocalVideoPath } = require('./_common')

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
 * 视频号描述区在标题上方，标签「视频描述」。未激活时显示占位（#话题 / 添加描述，多为伪元素/占位 span），
 * 真正的可编辑区（div[contenteditable] 或 textarea）需【点击占位/#话题】才渲染出来。
 * 策略：①按「视频描述」标签定位容器；②在容器内点击「#话题」/「添加描述」占位触发渲染；
 * ③若未渲染则点击容器本身；④再在容器内找可编辑区填入「文案 + #话题」。
 * 注意：查找可编辑区时优先 textarea/contenteditable，避免误选上方的「短标题」input。
 */
async function fillDescription(page, description, topics, log) {
  // 1) 按「视频描述」标签定位其所在容器
  const containerSel = await page.evaluate(() => {
    const labels = Array.from(document.querySelectorAll('label, div, span, p, h3, h4, dt, th, b, strong'))
    for (const lab of labels) {
      const txt = (lab.textContent || '').trim()
      if (txt === '视频描述' || txt.includes('视频描述')) {
        const c =
          lab.closest('[class*="item"], [class*="form"], [class*="row"], [class*="field"], [class*="desc"], li, div') ||
          lab.parentElement
        if (c) {
          c.setAttribute('data-fp-desc-box', '1')
          return '[data-fp-desc-box="1"]'
        }
      }
    }
    return null
  })
  if (!containerSel) {
    log('未找到「视频描述」标签，跳过描述填写')
  }

  // 2) 点击容器内「#话题 / 添加描述」占位，激活真正的输入框（用户反馈：点 #话题 即出输入框）
  const clickTrigger = async () => {
    await page.evaluate(() => {
      const box = document.querySelector('[data-fp-desc-box="1"]') || document.body
      const all = Array.from(box.querySelectorAll('*'))
      for (const el of all) {
        const t = (el.textContent || '').trim()
        if (t === '#话题' || t === '添加描述' || t === '说点什么' || t.includes('添加描述') || t.includes('#话题')) {
          try { el.click(); return } catch (_) {}
        }
      }
      // 兜底：点 placeholder/tip 类占位元素
      const ph = box.querySelector('[class*="placeholder"], [class*="tip"], [class*="hint"]')
      if (ph) { try { ph.click() } catch (_) {} }
    })
  }

  // 3) 在容器内查找可编辑区（优先 textarea/contenteditable，排除标题 input）
  const tryFindEditable = () =>
    page.evaluate(() => {
      const box = document.querySelector('[data-fp-desc-box="1"]') || document.body
      let el = box.querySelector('textarea, [contenteditable]')
      if (!el) {
        const inp = Array.from(box.querySelectorAll('input')).find(
          (i) => !/标题/.test(i.getAttribute('placeholder') || '')
        )
        el = inp || null
      }
      if (el) { el.setAttribute('data-fp-desc', '1'); return '[data-fp-desc="1"]' }
      return null
    })

  let sel = null
  if (containerSel) {
    // 先点占位触发（点「#话题」即出输入框）
    await clickTrigger()
    await sleep(700)
    sel = await tryFindEditable()
    // 占位没生效 → 点击整个容器再试
    if (!sel) {
      await page.click(containerSel, { timeout: 5000 }).catch(() => {})
      await sleep(800)
      sel = await tryFindEditable()
    }
  }

  // 4) 兜底：任意含“描述/介绍” placeholder 的 textarea/input，或任意 [contenteditable]
  if (!sel) {
    sel = await page.evaluate(() => {
      const ta = document.querySelector(
        'textarea[placeholder*="描述"], textarea[placeholder*="介绍"], input[placeholder*="描述"], input[placeholder*="介绍"]'
      )
      if (ta) { ta.setAttribute('data-fp-desc', '1'); return '[data-fp-desc="1"]' }
      const ce = document.querySelector('[contenteditable]')
      if (ce) { ce.setAttribute('data-fp-desc', '1'); return '[data-fp-desc="1"]' }
      return null
    })
  }

  if (!sel) {
    log('未找到视频描述输入框，跳过描述填写')
    return
  }
  const tags = parseTopics(topics).map((t) => '#' + t)
  const parts = []
  if (description && description.trim()) parts.push(description.trim())
  if (tags.length) parts.push(tags.join(' '))
  const text = parts.join('\n')
  const box = page.locator(sel)
  try {
    await box.click()
    await box.fill(text)
  } catch (e) {
    // contenteditable 兜底：直接写文本并派发输入事件
    await box
      .evaluate((el, t) => {
        el.focus()
        el.textContent = t
        el.dispatchEvent(new Event('input', { bubbles: true }))
        el.dispatchEvent(new Event('change', { bubbles: true }))
      }, text)
      .catch(() => {})
  }
  log('视频描述（文案 + 话题）已填写')
}

async function publishOrDraft(page, publishNow, log) {
  // 视频号发表按钮没有 name="发表" 属性，必须用文本匹配
  const publishBtnSel = 'button:has-text("发表"), button[name="发表"]'
  await page.waitForSelector(publishBtnSel, { timeout: 180000 })
  // 等按钮可点击
  for (let i = 0; i < 60; i++) {
    const disabled = await page.$eval(publishBtnSel, el => el.classList.contains('weui-desktop-btn_disabled') || el.disabled).catch(() => false)
    if (!disabled) break
    await sleep(2000)
  }
  if (publishNow) {
    log('点击【发表】发布视频号...')
    await page.click(publishBtnSel)
  } else {
    log('点击【存草稿】...')
    await page.click('button:has-text("存草稿")')
  }
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
    await fillShortTitle(page, params.title, log)
    await fillDescription(page, params.description, params.topics, log)

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
