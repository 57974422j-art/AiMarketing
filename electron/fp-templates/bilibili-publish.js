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

// B站投稿页嵌在 iframe 中，主文档里查不到表单元素。
// 该函数返回承载上传部件的上下文（frame 或 page），后续所有 $/locator/keyboard 都走它。
async function getCtx(page) {
  try {
    for (const f of page.frames()) {
      if (f === page.mainFrame()) continue
      const u = (f.url() || '')
      if (u.includes('platform/upload')) return f
      // 兜底：按上传部件关键元素判定
      const el = await f.$('.upload-area, input[placeholder*="标题"], [class*="bcc-upload"], [class*="upload"]').catch(() => null)
      if (el) return f
    }
  } catch (_) {}
  return page
}

async function uploadVideo(page, videoPath, log) {
  // 1) 若已在编辑页（标题框可见），说明视频已就绪，直接跳过上传（避免去等不存在的 file input）
  try {
    const ctx = await getCtx(page)
    const titleBox = await ctx.$('input[placeholder*="标题"]')
    if (titleBox && await titleBox.isVisible().catch(() => false)) {
      log('检测到已进入编辑页（标题框存在），跳过上传，直接填表')
      return
    }
  } catch (_) {}

  // 2) 直接对隐藏的 file input 设置文件（B站视频上传框本质为隐藏 input[type=file]，Playwright 可对其 setInputFiles）
  const fileSels = [
    'input[type="file"][accept*="video"]',
    'input[type="file"][name*="video"]',
    '.bcc-upload input[type="file"]',
    'input[type="file"]',
  ]
  let uploaded = false
  for (const sel of fileSels) {
    try {
      const el = await page.$(sel)
      if (!el) continue
      await el.setInputFiles(videoPath, { timeout: 15000 })
      uploaded = true
      log('✅ 已通过 file input 上传 (' + sel + ')')
      break
    } catch (e) {
      log('  [上传] setInputFiles 失败: ' + sel)
    }
  }

  // 3) 兜底：iframe 内的 file input（B站上传页可能嵌在 frame 中）
  if (!uploaded) {
    try {
      for (const f of page.frames()) {
        for (const sel of fileSels) {
          const inp = await f.$(sel).catch(() => null)
          if (inp) {
            await inp.setInputFiles(videoPath, { timeout: 15000 })
            uploaded = true
            log('✅ 已通过 frame 内 file input 上传 (' + sel + ')')
            break
          }
        }
        if (uploaded) break
      }
    } catch (e) { log('  [上传] frame 兜底异常: ' + e.message) }
  }

  // 4) 再兜底：点击上传区触发原生文件选择框
  if (!uploaded) {
    const triggers = ['.upload-area', '.bcc-upload', '[class*="upload"]', 'text=上传视频']
    for (const sel of triggers) {
      try {
        const fc = page.waitForEvent('filechooser', { timeout: 8000 })
        await page.click(sel, { timeout: 5000, force: true })
        const chooser = await fc
        await chooser.setFiles(videoPath)
        uploaded = true
        log('✅ 视频已选择 (' + sel + ')')
        break
      } catch (e) {
        log('  [上传] 触发失败: ' + sel)
      }
    }
  }

  if (!uploaded) throw new Error('未找到 B站视频上传入口')

  log('视频已选择，等待上传/转码完成进入编辑页...')
  const ctx = await getCtx(page)
  await ctx.waitForSelector('input[placeholder*="标题"]', { timeout: 180000 })
  log('已进入编辑页')
}

async function fillTitle(page, title, log) {
  const ctx = await getCtx(page)
  const input = await ctx.$('input[placeholder*="标题"]')
  if (input) {
    // B站会自动把视频文件名填成标题，先全选清空再填我们的标题
    await input.click()
    await ctx.keyboard.press('ControlOrMeta+A')
    await ctx.keyboard.press('Backspace')
    await page.waitForTimeout(300)
    await input.fill(title || '')
    await ctx.keyboard.press('Tab')
    log('标题已填写: ' + (title || '(空)'))
  } else {
    log('未找到标题输入框，跳过')
  }
}

async function fillDescription(page, description, log) {
  if (!description) { log('未提供简介内容，跳过'); return }
  const ctx = await getCtx(page)

  // 1) 多选择器直接找简介编辑器（B站为 quill 富文本 .ql-editor，容器类名可能随版本变化）
  let editor = await ctx.$('.desc-container .ql-editor, .video-desc .ql-editor, [class*="desc"] .ql-editor, [class*="desc"] [contenteditable="true"], textarea[placeholder*="简介"]')

  // 2) 兜底：按「简介」label 找同一表单项内的 contenteditable/textarea
  if (!editor) {
    editor = await ctx.evaluateHandle(() => {
      const labels = Array.from(document.querySelectorAll('label, .label, [class*="label"], [class*="title"]'))
      for (const lb of labels) {
        if (!(lb.textContent || '').trim().startsWith('简介')) continue
        let box = lb.closest('[class*="item"], [class*="row"], [class*="section"]') || lb.parentElement
        for (let i = 0; i < 3 && box; i++) {
          const ed = box.querySelector('.ql-editor, [contenteditable="true"], textarea')
          if (ed) return ed
          box = box.parentElement
        }
      }
      return null
    }).then(h => h.asElement()).catch(() => null)
  }

  if (!editor) {
    log('未找到简介编辑框，跳过（请把简介区 HTML 发我以便精修）')
    return
  }

  // 3) contenteditable 键盘输入不可靠，click 后先清空再 evaluate 直写 + 派发 input 事件
  try {
    await editor.click()
    await ctx.keyboard.press('ControlOrMeta+A')
    await ctx.keyboard.press('Backspace')
    await page.waitForTimeout(200)
    const filled = await editor.evaluate((el, text) => {
      if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
        el.value = text
      } else {
        el.innerHTML = ''
        const p = document.createElement('p')
        p.textContent = text
        el.appendChild(p)
      }
      el.dispatchEvent(new Event('input', { bubbles: true }))
      el.dispatchEvent(new Event('change', { bubbles: true }))
      return (el.value || el.textContent || '').trim().length > 0
    }, description)
    if (filled) {
      log('简介已填写')
    } else {
      // 直写没生效（quill 可能吞掉）→ 退回键盘逐字输入
      await editor.click()
      await ctx.keyboard.type(description)
      log('简介已填写(键盘输入)')
    }
    await ctx.keyboard.press('Tab').catch(() => {})
  } catch (e) {
    log('简介填写失败: ' + e.message)
  }
}

async function selectCategory(page, log) {
  try {
    const ctx = await getCtx(page)
    const container = await ctx.$('.selector-container')
    if (!container) return
    const txt = await container.textContent().catch(() => '')
    if (txt && txt.trim()) {
      log('分区已选: ' + txt.trim())
      return
    }
    await container.click()
    await sleep(500)
    let opt = ctx.locator('.bcc-option, .category-item, li').filter({ hasText: '日常' }).first()
    if (await opt.count() === 0) {
      opt = ctx.locator('.bcc-option, .category-item, li').first()
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
  // 关键修复：前端可能传逗号分隔的「字符串」，for...of 字符串会逐字循环 → 一个字一个标签。
  // 统一规整成数组：字符串按中/英文逗号拆分。
  if (typeof tags === 'string') {
    tags = tags.split(/[,，]/).map(t => t.trim()).filter(Boolean)
  }
  if (!tags || !Array.isArray(tags) || !tags.length) {
    log('未提供标签，跳过')
    return
  }
  const ctx = await getCtx(page)
  const input = await ctx.$('#tag-container input, input[placeholder*="回车"], input[placeholder*="标签"]')
  if (!input) {
    log('未找到标签输入框，跳过标签')
    return
  }
  // 删除已有标签
  for (let i = 0; i < 12; i++) {
    const close = await ctx.$('.tag-pre-wrp .label-item-v2-container .close, .tag-item .close, [class*="tag"] [class*="close"]')
    if (!close) break
    await close.click().catch(() => {})
    await sleep(150)
  }
  await ctx.keyboard.press('Escape').catch(() => {})
  for (const tag of tags) {
    await input.click()
    await sleep(150)
    await input.fill('')                       // 先清空输入框，避免残留
    // 一次性写入整词（insertText 只触发一次 input 事件，不会逐字触发 B站「一个字一个标签」）
    await page.keyboard.insertText(tag)
    await sleep(250)
    await ctx.keyboard.press('Enter')          // 整词提交为单个标签
    await sleep(400)
  }
  log('标签已填写: ' + tags.join(' / '))
}

async function uploadCover(page, coverImage, log) {
  // 方案A（1.0.4）：无自定义封面时跳过，使用平台默认帧
  if (!coverImage) return
  try {
    const ctx = await getCtx(page)
    const coverItem = await ctx.$('.cover-item')
    if (coverItem) {
      const fc = ctx.waitForEvent('filechooser', { timeout: 8000 })
      await coverItem.click()
      const chooser = await fc
      await chooser.setFiles(coverImage)
      await ctx.click('.cover-editor .confirm-btn, button:has-text("完成")', { timeout: 5000 }).catch(() => {})
      log('封面已上传')
    }
  } catch (e) {
    log('封面上传失败(可忽略，使用默认帧): ' + e.message)
  }
}

// 使用 B站内置「AI生成」自动生成封面（无自定义封面时调用）
// 完成判定：按钮文案变为「重新生成」即视为生成好；生成中（文案含「生成中」或按钮 disabled）则持续等待
async function generateCoverAI(page, log) {
  const ctx = await getCtx(page)
  let btn
  try {
    btn = await ctx.locator('.generate-pill, span:has-text("AI生成"), [class*="ai-"]:has-text("AI生成")').first()
    if (await btn.count() === 0) {
      log('未找到「AI生成」封面按钮，跳过（将使用默认帧）')
      return
    }
    const cur = (await btn.textContent().catch(() => '')) || ''
    if (cur.includes('重新生成')) {
      log('封面已由 B站 AI 生成（检测到「重新生成」），复用')
      return
    }
    await btn.scrollIntoViewIfNeeded().catch(() => {})
    await btn.click({ timeout: 5000 }).catch(async () => {
      // 兜底：直接点父级可点元素
      await ctx.locator('[class*="ai-"]:has-text("AI生成"), [class*="generate"]:has-text("AI生成")').first().click({ timeout: 5000 })
    })
    log('已点击「AI生成」，等待 B站生成封面（耗时较长，最长等待 2 分钟）...')
  } catch (e) {
    log('点击「AI生成」失败: ' + e.message)
    return
  }

  const deadline = Date.now() + 120000
  let done = false
  // 先等生成真正开始（进入生成中/禁用态），避免瞬间判定完成
  await sleep(4000)
  while (Date.now() < deadline) {
    await sleep(3000)
    const disabled = await btn.isDisabled().catch(() => false)
    const txt = (await btn.textContent().catch(() => '')) || ''
    if (txt.includes('生成中') || disabled) continue        // 仍在生成，继续等
    if (txt.includes('重新生成')) { done = true; break }     // 生成完成信号
    // 文案回到「AI生成」且不再禁用，也视为一轮结束（兜底）
    if (txt.includes('AI生成') && !disabled) { done = true; break }
  }
  if (done) log('✅ B站 AI 封面已生成，可继续发布')
  else log('⚠️ 未能确认 AI 封面生成完成，仍继续发布（若 B站报缺封面请手动确认）')
}

// ───────────────── 创作声明（B站必填，不选不给发布） ─────────────────
// 页面结构（用户实拍）：
//   *创作声明
//     [ 含AI生成内容 ]  ← 组标题/收起态
//       内容无需标注 / 含AI生成内容 / 含虚构演绎内容   ← 三选一
//     内容含营销信息 / 个人观点，仅供参考 / 内容为转载  ← 可多选
//   是否添加内容授权声明(非必选)
//     内容为自制:未经作者允许，禁止转载
// 由于 B站类名随版本变动，这里一律「按文案定位」+ 关联 input 优先 + CDP 保底。

/** 在页面上下文里按文案点击一个声明选项。返回 {ok, via, count} */
async function _clickDeclOnce(ctx, text, prefix) {
  return await ctx.evaluate(({ t, usePrefix }) => {
    const norm = s => (s || '').replace(/\s+/g, '').trim()
    const target = norm(t)
    const all = Array.from(document.querySelectorAll('span,label,div,li,p,a'))
    const match = el => {
      const s = norm(el.textContent)
      if (!s || s.length > target.length + 30) return false
      return usePrefix ? s.startsWith(target) : s === target
    }
    // 只要「最内层」的匹配节点（子孙里没有同样匹配的），避免点到外层容器
    const nodes = all.filter(el => match(el) && !Array.from(el.children).some(c => match(c)))
    if (!nodes.length) return { ok: false, reason: 'notfound', count: 0 }
    const el = nodes[nodes.length - 1]   // 组标题在前、真实选项在后，取最后一个
    try { el.scrollIntoView({ block: 'center' }) } catch (_) {}
    const box = el.closest('label') || el.parentElement || el
    const input = box.querySelector && box.querySelector('input[type="checkbox"],input[type="radio"]')
    if (input) {
      if (input.checked) return { ok: true, via: 'already', count: nodes.length }
      input.click()
      return { ok: true, via: 'input', count: nodes.length }
    }
    el.click()
    return { ok: true, via: 'text', count: nodes.length }
  }, { t: text, usePrefix: !!prefix })
}

/** 点击一个创作声明选项：常规 → 展开后二次点击 → 前缀匹配 → CDP 保底 */
async function clickDecl(page, ctx, text, log, prefix) {
  let r = await _clickDeclOnce(ctx, text, prefix).catch(() => ({ ok: false }))
  if (r && r.ok) {
    await sleep(500)
    // 若第一次点的是「组标题」（点完才展开子项），再点一次真正的子项
    const r2 = await _clickDeclOnce(ctx, text, prefix).catch(() => ({ ok: false, count: 0 }))
    if (r2 && r2.ok && r2.count > (r.count || 0)) {
      log(`  ✅ 创作声明「${text}」已选（展开后二次点击, via=${r2.via}）`)
    } else {
      log(`  ✅ 创作声明「${text}」已选（via=${r.via}）`)
    }
    return true
  }
  // 前缀兜底（如「内容为自制:未经作者允许，禁止转载」冒号可能是全角/半角）
  if (!prefix) {
    r = await _clickDeclOnce(ctx, text, true).catch(() => ({ ok: false }))
    if (r && r.ok) { log(`  ✅ 创作声明「${text}」已选（前缀匹配, via=${r.via}）`); return true }
  }
  // CDP 保底（穿透 shadow / iframe）
  const ok = await clickByTextCDP(page, log, [text], text.length + 6, ['span', 'label', 'div', 'a', 'li'])
  if (ok) { log(`  ✅ 创作声明「${text}」已选（CDP 保底）`); return true }
  log(`  ⚠️ 未找到创作声明选项「${text}」`)
  return false
}

/** 诊断：把创作声明区域的可见文案打出来，便于按真实结构精修 */
async function dumpDeclarationArea(ctx, log) {
  try {
    const info = await ctx.evaluate(() => {
      const out = []
      for (const el of Array.from(document.querySelectorAll('div,section'))) {
        const t = (el.textContent || '').replace(/\s+/g, ' ').trim()
        if (t.includes('创作声明') && t.length < 300) {
          out.push({ cls: String(el.className || '').slice(0, 60), text: t.slice(0, 200) })
          if (out.length >= 3) break
        }
      }
      return out
    })
    log('  [创作声明诊断] ' + JSON.stringify(info))
  } catch (e) {
    log('  [创作声明诊断] 失败: ' + e.message)
  }
}

/**
 * 勾选创作声明
 * params.declaration        主声明（内容无需标注 / 含AI生成内容 / 含虚构演绎内容），空则跳过
 * params.declarationExtras  附加声明数组或逗号分隔串（内容含营销信息 / 个人观点，仅供参考 / 内容为转载）
 * params.copyrightSelf      是否勾选「内容为自制:未经作者允许，禁止转载」
 */
async function selectDeclaration(page, params, log) {
  const main = String(params.declaration || '').trim()
  let extras = params.declarationExtras || []
  if (typeof extras === 'string') extras = extras.split(/[,，]/).map(s => s.trim()).filter(Boolean)
  if (!Array.isArray(extras)) extras = []
  const copyrightSelf = params.copyrightSelf === true || params.copyrightSelf === 'true'

  if (!main && !extras.length && !copyrightSelf) {
    log('未指定创作声明，跳过（若 B站提示必填将无法发布）')
    return
  }

  const ctx = await getCtx(page)
  // 先把「创作声明」滚进视口（它在表单底部，不滚动可能未渲染/点不到）
  try {
    await ctx.evaluate(() => {
      for (const el of Array.from(document.querySelectorAll('div,span,label'))) {
        const t = (el.textContent || '').trim()
        if (t.startsWith('创作声明') && t.length < 60) { el.scrollIntoView({ block: 'center' }); return }
      }
    })
    await sleep(600)
  } catch (_) {}

  log('开始勾选创作声明...')
  let allOk = true
  if (main) allOk = (await clickDecl(page, ctx, main, log)) && allOk
  for (const t of extras) {
    allOk = (await clickDecl(page, ctx, t, log)) && allOk
    await sleep(300)
  }
  if (copyrightSelf) {
    allOk = (await clickDecl(page, ctx, '内容为自制', log, true)) && allOk
  }
  if (!allOk) await dumpDeclarationArea(ctx, log)
  await sleep(500)
}

async function publishOrDraft(page, publishNow, log) {
  const ctx = await getCtx(page)
  if (publishNow) {
    log('点击最终发布按钮【立即投稿】...')
    let ok = false
    try {
      // B站「立即投稿」是 <span class="submit-add">，位于表单底部，须先滚动进视口
      const submitContainer = await ctx.$('.submit-container')
      if (submitContainer) {
        await submitContainer.scrollIntoViewIfNeeded().catch(() => {})
        await sleep(300)
      }
      const btn = ctx.locator('.submit-add, span:has-text("立即投稿")').first()
      await btn.scrollIntoViewIfNeeded().catch(() => {})
      await btn.click({ timeout: 8000 })
      ok = true
    } catch (e) {
      log('  ⚠️ 常规点击失败，改用 CDP 保底: ' + e.message)
      // 关键：允许 span；且「立即投稿」精确匹配，必须排除误点「定时发布」
      ok = await clickByTextCDP(page, log, ['立即投稿'], 12, ['span', 'button', 'a', 'div'])
        || await clickByTextCDP(page, log, ['投稿'], 12, ['span', 'button', 'a', 'div'])
    }
    if (!ok) log('  ❌ 未能点击发布按钮，请手动点击')
  } else {
    log('点击【存草稿】...')
    try {
      const draft = ctx.locator('button, span', { hasText: '存草稿' }).first()
      await draft.click({ timeout: 5000 })
    } catch (e) {
      await clickByTextCDP(page, log, ['存草稿'], 12, ['span', 'button', 'a', 'div'])
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
      await uploadCover(page, params.coverImage, log)
    } else {
      // B站强制要求封面：无自定义封面时改用平台内置「AI生成」
      log('未提供自定义封面，改用 B站 AI 生成封面')
      await generateCoverAI(page, log)
    }

    // 创作声明（B站必填项，不勾选会被拦下不给发布）
    await selectDeclaration(page, params, log)

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
