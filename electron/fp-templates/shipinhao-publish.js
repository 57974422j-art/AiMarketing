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
  let input = await page.$('input[type="file"]')
  // 视频号上传入口可能在 iframe 内
  if (!input) {
    for (const frame of page.frames()) {
      try {
        const f = await frame.$('input[type="file"]')
        if (f) { input = f; break }
      } catch (_) {}
    }
  }
  if (!input) {
    // 触发上传：点击"上传视频 / 发表"按钮弹出文件选择
    try {
      await page.click('text=上传视频', { timeout: 5000 })
    } catch (_) {
      try { await page.click('button:has-text("发表")', { timeout: 5000 }) } catch (_) {}
    }
    await page.waitForSelector('input[type="file"]', { timeout: 20000 })
    input = await page.$('input[type="file"]')
  }
  if (!input) throw new Error('未找到视频上传入口')
  await input.setInputFiles(videoPath)
  log('视频已选择，等待转码进入编辑页...')
  // 等待进入编辑页：标题输入框出现
  await page.waitForSelector('input[placeholder*="标题"], .input-editor', { timeout: 180000 })
  log('已进入编辑页')
}

async function fillTitleAndTags(page, title, topics, log) {
  const titleInput = await page.$('input[placeholder*="标题"]')
  if (titleInput) {
    await titleInput.click()
    await titleInput.fill(title || '')
    if (topics && topics.length) {
      for (const t of topics) {
        await page.keyboard.type('#' + t, { delay: 30 })
        await sleep(450)
        await page.keyboard.press('Space')
        await sleep(200)
      }
    }
    await page.keyboard.press('Enter')
    log('标题/话题已填写')
  } else {
    log('未找到标题输入框，跳过标题填写')
  }
}

async function fillDescription(page, description, log) {
  const desc = await page.$('textarea[placeholder*="描述"], textarea[placeholder*="介绍"], .desc-editor, div[contenteditable="true"]')
  if (desc) {
    await desc.click()
    await desc.fill(description || '')
    log('描述已填写')
  } else {
    log('未找到描述输入框，跳过描述填写')
  }
}

async function publishOrDraft(page, publishNow, log) {
  // 等待上传完成：发表按钮可用（去掉 disabled）
  const publishBtnSel = 'button[name="发表"]'
  await page.waitForSelector(publishBtnSel, { timeout: 180000 })
  // 等按钮可点击
  for (let i = 0; i < 60; i++) {
    const disabled = await page.$eval(publishBtnSel, el => el.classList.contains('weui-desktop-btn_disabled') || el.disabled).catch(() => false)
    if (!disabled) break
    await sleep(2000)
  }
  if (publishNow) {
    log('点击【发表】发布视频号...')
    await page.click('div.form-btns button:has-text("发表"), button:has-text("发表")')
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
    await fillTitleAndTags(page, params.title, params.topics, log)
    await fillDescription(page, params.description, log)

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
