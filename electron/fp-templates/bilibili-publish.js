// B站（哔哩哔哩）创作中心自动发布脚本
// 平台：member.bilibili.com
// 登录方式：复用已登录 Chrome 会话（本脚本不处理登录，仅检测未登录并返回 needLogin:true）
// 发布模型：进入投稿页 -> 登录检测 -> 上传视频 -> 填标题/描述/分区/标签 -> 封面(方案A跳过) -> 发布/存草稿
// 参照：fjwang1/codexSkill bilibili-video-upload-draft SKILL（真实 Playwright 选择器）
const sleep = ms => new Promise(r => setTimeout(r, ms))

const BILIBILI_UPLOAD_URL = 'https://member.bilibili.com/platform/upload/video/frame?spm_id_from=333.33.top_bar.upload'
const { resolveLocalVideoPath, resolveLocalImagePath } = require('./_common')
const { clickByTextCDP } = require('./_cdpClick')

async function isLoggedIn(page, log) {
  try {
    const body = await page.textContent('body')
    if (body && (body.includes('当前浏览器未登录') || body.includes('登录已失效'))) return false
  } catch (_) {}
  return true
}

async function uploadVideo(page, videoPath, log) {
  // 1) 若已在编辑页（标题框可见），说明视频已就绪，直接跳过上传（避免去等不存在的 file input）
  try {
    const titleBox = await page.$('input[placeholder="请输入标题"]')
    if (titleBox && await titleBox.isVisible().catch(() => false)) {
      log('检测到已进入编辑页（标题框存在），跳过上传，直接填表')
      return
    }
  } catch (_) {}

  // 2) 多策略触发 filechooser 上传
  const triggers = ['.upload-area', '.bcc-upload', 'text=上传视频', '[class*="upload"] >> text=视频', '.upload-btn', '.bcc-upload-btn']
  let uploaded = false
  for (const sel of triggers) {
    try {
      const fc = page.waitForEvent('filechooser', { timeout: 6000 })
      await page.click(sel, { timeout: 4000 })
      const chooser = await fc
      await chooser.setFiles(videoPath)
      uploaded = true
      log('✅ 视频已选择 (' + sel + ')')
      break
    } catch (e) {
      log('  [上传] 触发失败: ' + sel)
    }
  }

  // 3) 兜底：iframe 内的 file input
  if (!uploaded) {
    try {
      for (const f of page.frames()) {
        const inp = await f.$('input[type="file"]').catch(() => null)
        if (inp) { await inp.setInputFiles(videoPath); uploaded = true; log('✅ 已通过 frame 内 file input 上传'); break }
      }
    } catch (_) {}
  }

  // 4) 最后兜底：主文档 file input
  if (!uploaded) {
    try {
      await page.setInputFiles('input[type="file"]', videoPath, { timeout: 15000 })
      uploaded = true
      log('✅ 已通过主文档 file input 上传')
    } catch (e) {
      log('  ❌ 所有上传方式均失败: ' + e.message)
    }
  }

  if (!uploaded) throw new Error('未找到 B站视频上传入口')

  log('视频已选择，等待上传/转码完成进入编辑页...')
  await page.waitForSelector('input[placeholder="请输入标题"]', { timeout: 180000 })
  log('已进入编辑页')
}

async function fillTitle(page, title, log) {
  const input = await page.$('input[placeholder="请输入标题"]')
  if (input) {
    // B站会自动把视频文件名填成标题，先全选清空再填我们的标题
    await input.click()
    await page.keyboard.press('ControlOrMeta+A')
    await page.keyboard.press('Backspace')
    await page.waitForTimeout(300)
    await input.fill(title || '')
    await page.keyboard.press('Tab')
    log('标题已填写: ' + (title || '(空)'))
  } else {
    log('未找到标题输入框，跳过')
  }
}

async function fillDescription(page, description, log) {
  const editor = await page.$('.desc-container .ql-editor')
  if (editor) {
    await editor.click()
    await page.keyboard.press('ControlOrMeta+A')
    await page.keyboard.press('Backspace')
    await page.keyboard.type(description || '')
    await page.keyboard.press('Tab')
    log('描述已填写')
  } else {
    log('未找到描述编辑框，跳过')
  }
}

async function selectCategory(page, log) {
  try {
    const container = await page.$('.selector-container')
    if (!container) return
    const txt = await container.textContent().catch(() => '')
    if (txt && txt.trim()) {
      log('分区已选: ' + txt.trim())
      return
    }
    await container.click()
    await sleep(500)
    let opt = page.locator('.bcc-option, .category-item, li').filter({ hasText: '日常' }).first()
    if (await opt.count() === 0) {
      opt = page.locator('.bcc-option, .category-item, li').first()
    }
    if (await opt.count() > 0) {
      await opt.click()
      log('已选择分区')
    }
  } catch (e) {
    log('分区选择失败(可忽略，B站可能已有默认分区): ' + e.message)
  }
}

async function fillTags(page, tags, log) {
  if (!tags || !tags.length) return
  const input = await page.$('#tag-container input, input[placeholder*="回车"]')
  if (!input) {
    log('未找到标签输入框，跳过标签')
    return
  }
  // 删除已有标签
  for (let i = 0; i < 10; i++) {
    const close = await page.$('.tag-pre-wrp .label-item-v2-container .close')
    if (!close) break
    await close.click()
    await sleep(200)
  }
  for (const tag of tags) {
    await input.click()
    await input.fill(tag)
    await page.keyboard.press('Enter')
    await sleep(300)
  }
  log('标签已填写')
}

async function uploadCover(page, coverImage, log) {
  // 方案A（1.0.4）：无自定义封面时跳过，使用平台默认帧
  if (!coverImage) return
  try {
    const coverItem = await page.$('.cover-item')
    if (coverItem) {
      const fc = page.waitForEvent('filechooser', { timeout: 8000 })
      await coverItem.click()
      const chooser = await fc
      await chooser.setFiles(coverImage)
      await page.click('.cover-editor .confirm-btn, button:has-text("完成")', { timeout: 5000 }).catch(() => {})
      log('封面已上传')
    }
  } catch (e) {
    log('封面上传失败(可忽略，使用默认帧): ' + e.message)
  }
}

async function publishOrDraft(page, publishNow, log) {
  if (publishNow) {
    log('点击最终发布按钮【立即投稿/发布】...')
    let ok = false
    try {
      const btn = page.locator('button', { hasText: /立即投稿|发布|详细发布|提交/ }).first()
      await btn.click({ timeout: 5000 })
      ok = true
    } catch (e) {
      log('  ⚠️ 常规点击失败，改用 CDP 保底: ' + e.message)
      ok = await clickByTextCDP(page, log, ['立即投稿', '发布', '提交'])
    }
    if (!ok) log('  ❌ 未能点击发布按钮，请手动点击')
  } else {
    log('点击【存草稿】...')
    try {
      const draft = page.locator('button', { hasText: '存草稿' }).first()
      await draft.click({ timeout: 5000 })
    } catch (e) {
      await clickByTextCDP(page, log, ['存草稿'])
    }
  }
  await sleep(5000)
  return page.url()
}

async function executeBilibiliPublish(page, params, log) {
  try {
    log('导航到 B站投稿页...')
    const url = page.url()
    if (!url.includes('member.bilibili.com')) {
      await page.goto(BILIBILI_UPLOAD_URL, { timeout: 30000 })
      await page.waitForTimeout(3000)
    }

    if (!(await isLoggedIn(page, log))) {
      return {
        success: false,
        message: '请先在指纹浏览器中登录 B站（member.bilibili.com），再发布。登录后账号会长期保留在 profile 中。',
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
    await fillTitle(page, params.title, log)
    await fillDescription(page, params.description, log)
    await selectCategory(page, log)
    await fillTags(page, params.topics, log)
    if (params.coverImage) {
      params.coverImage = (await resolveLocalImagePath(params.coverImage, params.userId, params.authToken, log)) || params.coverImage
    }
    await uploadCover(page, params.coverImage, log)

    const resultUrl = await publishOrDraft(page, params.publishNow !== false, log)
    log('B站发布流程完成')
    return {
      success: true,
      message: params.publishNow !== false ? 'B站发布成功' : '已存入草稿',
      url: resultUrl,
      needConfirm: false,
    }
  } catch (e) {
    log(`出错: ${e.message}`)
    return { success: false, message: e.message }
  }
}

module.exports = { executeBilibiliPublish }
