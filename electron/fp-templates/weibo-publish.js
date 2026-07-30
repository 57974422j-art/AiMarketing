/**
 * 微博发视频脚本（指纹浏览器 B方案：每个平台独立端口/独立 profile）
 *
 * 微博采用「L1 第一页直发」模式（与早期三级页面 L1→L2→L3 不同）：
 *   在 weibo.com 主页发布框，直接把视频 setInputFiles 进隐藏 file input（贴入话题/视频框），
 *   同时把 标题+文案+话题 填入同一发布框的正文区，等视频上传/转码完成（发送按钮可用）后点「发送」。
 *   不再走 L2 上传页 / L3 独立标题页（那样反而找不到标题框，发布内容为空）。
 *
 * 微博发布框是普通 DOM（非 Web Component / 非 closed shadow），用常规文本/占位符定位即可。
 * 选择器随版本可能变化，本脚本采用「多策略兜底 + 诊断日志」，首次运行后请据日志微调。
 *
 * 参数（与抖音/小红书同名，前端复用）：
 *   - videoPath:   视频文件绝对路径（必填）
 *   - title:       标题（写入 L3 独立标题框，0~30 字）
 *   - description: 正文/简介（写入 L3 正文框）
 *   - topics:      自定义话题（逗号分隔）或留空跳过
 *   - coverImage:  自定义封面图片名（来自素材仓库），留空则使用平台默认帧
 *   - publishNow:  微博发布为即时，暂无草稿概念，忽略
 */

const path = require('path')
const { resolveLocalVideoPath, checkLoginState } = require('./_common')

// ════════════════════════════════════
// 工具函数
// ════════════════════════════════════

/** 关闭常见弹窗 */
async function dismissPopups(page, log, prefix = '') {
  for (const text of ['我知道了', '知道了', '确定', '稍后再说', '同意', '关闭']) {
    try {
      const btn = await page.$(`text="${text}"`)
      if (btn && await btn.isVisible().catch(() => false)) {
        await btn.click({ timeout: 2000 })
        log(`${prefix}关闭弹窗「${text}」`)
        await page.waitForTimeout(500)
      }
    } catch (_) {}
  }
}

/** 检测微博是否已登录；未登录返回 false */
async function isLoggedIn(page, log) {
  await page.waitForTimeout(2000)
  const url = page.url()
  if (url.includes('login') || url.includes('passport') || url.includes('sso')) {
    log('  ⚠️ 检测到登录页 URL: ' + url)
    return false
  }
  const bodyText = await page.evaluate(() => document.body.innerText).catch(() => '')
  const hasPublishBox =
    bodyText.includes('新鲜事') || bodyText.includes('想分享') ||
    bodyText.includes('说点什么') || bodyText.includes('有什么想')
  const hasLoginPrompt =
    bodyText.includes('登录微博') || bodyText.includes('注册微博') ||
    (bodyText.includes('登录') && bodyText.includes('验证码') && !hasPublishBox)
  if (hasLoginPrompt && !hasPublishBox) {
    log('  ⚠️ 页面显示登录入口，判定为未登录')
    return false
  }
  return true
}

/** 找到 L3 正文编辑器（placeholder 含「新鲜事」的 contenteditable） */
async function findBodyEditor(page, log) {
  try {
    const editables = await page.$$('div[contenteditable="true"]')
    for (const e of editables) {
      try {
        const ph = (await e.getAttribute('data-placeholder') || '') + (await e.getAttribute('placeholder') || '')
        if (/新鲜事|想分享|说点什么|有什么/i.test(ph)) {
          if (await e.isVisible().catch(() => false)) return e
        }
      } catch (_) {}
    }
    // fallback：第一可见 contenteditable
    for (const e of editables) {
      if (await e.isVisible().catch(() => false)) return e
    }
  } catch (e) { log('  [body] 探测异常: ' + e.message) }
  return null
}

/** 找 L1 主页发布框的可编辑正文区（多策略：contenteditable / textarea / 含新鲜事提示） */
async function findL1Editor(page, log) {
  try {
    const editables = await page.$$('div[contenteditable="true"], div[contenteditable=""], textarea')
    for (const e of editables) {
      try {
        const ph = (await e.getAttribute('data-placeholder') || '') + (await e.getAttribute('placeholder') || '') + (await e.getAttribute('aria-label') || '')
        const cls = (await e.getAttribute('class') || '')
        if (/新鲜事|想分享|说点什么|有什么|微博|发布/.test(ph + cls)) {
          if (await e.isVisible().catch(() => false)) return e
        }
      } catch (_) {}
    }
    const pub = await page.$('.WB_publish_box, [class*="publish"], [class*="WB_pub"]')
    if (pub) {
      const inner = await pub.$$('div[contenteditable="true"], div[contenteditable=""], textarea')
      for (const e of inner) if (await e.isVisible().catch(() => false)) return e
    }
    for (const e of editables) if (await e.isVisible().catch(() => false)) return e
  } catch (e) { log('  [L1 editor] 探测异常: ' + e.message) }
  return null
}

/** 诊断：打印页面内所有含「发送」的按钮，便于微调 Step7 */
async function diagnoseSendButtons(page, log) {
  try {
    const btns = await page.evaluate(() =>
      Array.from(document.querySelectorAll('button')).map(b => ({
        t: (b.innerText || '').trim().slice(0, 12),
        cls: (typeof b.className === 'string' ? b.className : '').replace(/\s+/g, '.').slice(0, 30),
        dis: b.disabled,
      }))
    )
    const sendBtns = btns.filter(b => /发送|发布|发微博/.test(b.t))
    if (sendBtns.length) {
      log('  [发送候选] ' + sendBtns.map(b => `${b.t}(${b.cls})${b.dis ? '[DISABLED]' : ''}`).join(' | '))
    } else {
      log('  [发送候选] 未找到含「发送/发布」的按钮，页面按钮总数=' + btns.length)
    }
  } catch (_) {}
}

// ════════════════════════════════════
// 主流程
// ════════════════════════════════════

/**
 * 执行微博视频发布
 * @param {import('playwright').Page} page
 * @param {{ videoPath?: string, title?: string, description?: string, topics?: string, coverImage?: string, publishNow?: string, userId?: string, authToken?: string, storageFileName?: string }} params
 * @param {(msg:string)=>void} log
 */
async function executeWeiboPublish(page, params, log) {
  const fs = require('fs')
  log('📋 参数检查开始...')
  log('   title: ' + (params.title || '未提供'))
  log('   description: ' + (params.description || '未提供'))
  log('   topics: ' + (params.topics || '无'))
  log('   coverImage: ' + (params.coverImage || '无'))

  try {
    // ── 定位本地视频（优先 videoPath，否则从素材仓库下载）──
    const videoPath = await resolveLocalVideoPath(params, log)
    if (!fs.existsSync(videoPath)) throw new Error('视频文件不存在: ' + videoPath)
    log('✅ 视频文件校验通过: ' + videoPath)

    await dismissPopups(page, log)

    // ── Step 1: 确保页面在 weibo.com ──
    log('▶ Step 1/6: 确认在微博发布页...')
    let url = page.url()
    log('   当前页面: ' + url)
    if (!url.includes('weibo.com')) {
      log('   导航到 https://weibo.com ...')
      await page.goto('https://weibo.com', { timeout: 60000, waitUntil: 'domcontentloaded' }).catch(() => {})
      await page.waitForTimeout(3000)
    }
    const ls = checkLoginState('weibo', page.url())
    if (ls.needLogin) {
      log('  ⚠️ 未登录（URL 命中登录态）')
      return { success: false, message: '请先在微博窗口扫码登录后再发布', needLogin: true }
    }
    if (!(await isLoggedIn(page, log))) {
      return { success: false, message: '请先在微博窗口扫码登录后再发布', needLogin: true }
    }
    log('✅ 已登录，继续发布')

    // ════════════════════════════════════
    // 「L1 第一页直发」模式：
    //   ① 先在 L1 正文框填 标题+文案+话题（合并进正文，L1 无独立标题框）
    //   ② 再把视频 setInputFiles 进 L1 隐藏 file input（直接贴入，不走 L2/L3）
    //   ③ 等视频上传/转码完成（发送按钮可用即就绪）
    //   ④ 点 L1 发布框内的「发送」按钮
    // ════════════════════════════════════

    // ── Step 2: 填文案 + 话题（L1 正文框，先于视频）──
    log('▶ Step 2/6: 填写文案+话题（L1 正文框）...')
    const l1Editor = await findL1Editor(page, log)
    if (!l1Editor) {
      log('   ⚠️ 未找到 L1 正文框，将只发视频（不填文案/话题）')
    } else {
      await l1Editor.click().catch(() => {})
      await page.waitForTimeout(300)
      await page.keyboard.down('Control').catch(() => {})
      await page.keyboard.press('A').catch(() => {})
      await page.keyboard.up('Control').catch(() => {})
      await page.keyboard.press('Backspace').catch(() => {})
      await page.waitForTimeout(200)
      // 标题 + 文案合并进正文（L1 直发无独立标题框）
      const parts = []
      if (params.title) parts.push(params.title)
      if (params.description) parts.push(params.description)
      const bodyText = parts.join('\n\n')
      if (bodyText) {
        await page.keyboard.type(bodyText, { delay: 30 })
        log('✅ 正文已填写 (' + bodyText.length + ' 字)')
      }
      // 话题写尾部
      if (params.topics) {
        const topicList = String(params.topics).split(/[,，、]/).map(s => s.trim()).filter(Boolean)
        if (topicList.length) {
          await page.keyboard.press('End').catch(() => {})
          await page.keyboard.type(' ', { delay: 10 })
          for (const t of topicList) {
            const tag = '#' + t + '#'
            await page.keyboard.type(tag, { delay: 30 })
            await page.keyboard.type(' ', { delay: 10 })
          }
          log('✅ 已输入话题: ' + topicList.map(t => '#' + t + '#').join(' '))
        }
      }
    }
    log('✅ Step 2 完成')

    // ── Step 3: L1 直发 —— 把视频 setInputFiles 进 L1 隐藏 file input ──
    log('▶ Step 3/6: 上传视频（L1 直接贴入）...')
    let fileInput = await page.$('input[type="file"]')
    if (!fileInput) {
      log('   ⚠️ L1 未直接暴露 file input，尝试点「视频」入口触发')
      for (const sel of ['.WB_publish_box [title="视频"]', '[aria-label*="视频"]', 'text=视频']) {
        try {
          const b = page.locator(sel).first()
          if (await b.isVisible().catch(() => false)) {
            await b.click({ timeout: 3000 })
            log('   已点击 L1「视频」入口: ' + sel)
            break
          }
        } catch (_) {}
      }
      await page.waitForTimeout(1500)
      fileInput = await page.$('input[type="file"]')
    }
    if (!fileInput) {
      const dbg = await page.evaluate(() => {
        const ins = Array.from(document.querySelectorAll('input[type="file"]')).map(i => i.accept || 'file')
        return `fileInputs=${ins.length}(${ins.join(',')})`
      }).catch(() => '诊断失败')
      log('   [诊断] ' + dbg)
      throw new Error('未找到微博视频上传入口（file input）')
    }
    await fileInput.setInputFiles(videoPath)
    log('✅ 视频已设置到 file input')

    // ── Step 4: 等视频上传完成（L1 直发，不跳 L3）──
    log('▶ Step 4/6: 等待视频上传完成（L1）...')
    log('   ═══ Step 4: 等待视频上传/转码完毕，发送按钮可用即发 ═══')
    let uploaded = false
    for (let i = 0; i < 50; i++) {
      await page.waitForTimeout(2000)
      const st = await page.evaluate(() => {
        const b = document.body.innerText
        const uploading = /上传中|转码中|处理中|解析中|正在上传|\d+%/.test(b)
        const sendBtn = Array.from(document.querySelectorAll('button')).find(x => /发送/.test((x.innerText || '').trim()))
        const sendReady = !!sendBtn && !sendBtn.disabled
        return { uploading, sendReady }
      }).catch(() => ({ uploading: true, sendReady: false }))
      if (st.sendReady && !st.uploading) {
        uploaded = true
        log(`   [${((i + 1) * 2)}s] 发送按钮可用，视频已就绪`)
        break
      }
      if (i % 3 === 0) log(`   [${((i + 1) * 2)}s] ${st.uploading ? '视频上传/转码中...' : '等待就绪...'} sendReady=${st.sendReady}`)
    }
    if (!uploaded) log('   ⚠️ 等待超时，视频可能仍未上传完成，仍尝试发送')

    // ── Step 5: 封面（L1 直发默认首帧，跳过）──
    log('▶ Step 5/6: 封面...')
    log('   跳过封面（L1 直发使用平台默认帧）')
    log('✅ Step 5 完成')

    // ── Step 6: 发送（L1 发布框内的「发送」按钮）──
    log('▶ Step 6/6: 发送（L1）...')
    diagnoseSendButtons(page, log)
    let sent = false
    const sendCandidates = [
      page.locator('button.woo-button-main.woo-button-fla:has-text("发送")').first(),
      page.locator('button:has-text("发送")').first(),
      page.locator('button:has-text("发布")').first(),
    ]
    for (const loc of sendCandidates) {
      try {
        if (await loc.isVisible().catch(() => false)) {
          await loc.click({ timeout: 6000 })
          sent = true
          log('   ✅ 已点击发送按钮')
          break
        }
      } catch (_) {}
    }
    if (!sent) {
      log('   ❌ 未找到发送按钮！请手动点击')
      return { success: true, message: '内容已填完，请手动点「发送」', needConfirm: true }
    }

    await page.waitForTimeout(4000)
    log('🎉 微博发布完成')
    return { success: true, message: '发布成功' }

  } catch (e) {
    log('❌ 异常退出: ' + e.message)
    log('   堆栈: ' + (e.stack || '').substring(0, 300))
    return { success: false, message: e.message }
  }
}

module.exports = { executeWeiboPublish }
