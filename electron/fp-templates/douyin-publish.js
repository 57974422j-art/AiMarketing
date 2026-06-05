/**
 * 抖音发视频模板 v5
 *
 * 流程：/content/upload → 上传 → 等转码 → /content/post/video编辑 → 标题→正文→话题→封面→发布
 *
 * 参数：
 *   - videoPath:   视频文件绝对路径（必填）
 *   - title:       作品标题，最多30字
 *   - description: 作品简介/正文，最多1000字
 *   - topics:      是否勾选推荐话题 (true/false)
 *   - publishNow:  是否立即发布 (true=立即 / false=草稿)
 */

const path = require('path')

// ════════════════════════════════════
// 工具函数
// ════════════════════════════════════

/** 关闭常见弹窗 */
async function dismissPopups(page, log, prefix = '') {
  for (const text of ['我知道了', '知道了', '确定']) {
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

// ════════════════════════════════════
// Step 1: 导航 + Step 2: 上传视频
// ════════════════════════════════════

async function step1_navigate(page, params, log) {
  const targetUrl = 'https://creator.douyin.com/creator-micro/content/upload'
  const currentUrl = page.url()
  log(`当前页面: ${currentUrl}`)

  if (!currentUrl.includes('/content/upload')) {
    log(`导航到: ${targetUrl}`)
    await page.goto(targetUrl, { timeout: 30000, waitUntil: 'networkidle' })
    await page.waitForTimeout(5000)
    log(`已到达: ${page.url()}`)
  } else {
    log('当前已在视频上传页')
    await page.waitForTimeout(2000)
  }
  await dismissPopups(page, log)
}

async function step2_upload(page, params, fs, log) {
  log('准备上传视频: ' + params.videoPath)
  let uploaded = false

  // 探测所有file input（含隐藏的）
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
      'text=上传视频', 'text=上传', 'text=选择文件', 'text=拖拽',
      '[class*="upload-btn"]', '[class*="UploadBtn"]',
      '[class*="upload-area"]', '[class*="picker"]',
      '[data-e2e="upload"]',
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
    const info = await page.evaluate(function() { return { url: location.href, title: document.title } }).catch(function() { return {} })
    return { success: false, message: '未找到上传入口 URL=' + info.url }
  }
  return null // 继续执行
}

// ════════════════════════════════════
// Step 3: 等待上传完成进入编辑页
//
// 判定编辑页就绪的方式（按优先级）：
//   1. ❌ 页面出现"作品检测失败/快速检测作品失败" → 视频不合格，终止
//   2. ✅ 页面出现"选择封面"按钮 或 "智能推荐封面"文字 → 编辑页已加载
//   3. ✅ contenteditable 标题/正文框可见 → 编辑表单已渲染
// ════════════════════════════════════

async function step3_waitUpload(page, log) {
  log('═══ Step 3: 等待视频上传+转码进入编辑页 ═══')

  const UPLOAD_WAIT_MS = 3000     // 检测间隔
  const MAX_UPLOAD_SEC = 270      // 最大等待4.5分钟
  const MAX_LOOPS = Math.floor(MAX_UPLOAD_SEC * 1000 / UPLOAD_WAIT_MS)

  // 有效编辑页URL列表
  const EDIT_URL_PATTERNS = ['/content/publish', '/content/post/video', '/publish']

  let editPageReady = false
  let abortReason = ''           // 如果需要终止（如检测失败）
  const uploadStartTime = Date.now()
  let stableCount = 0            // URL连续稳定在编辑页的次数

  for (let i = 0; i < MAX_LOOPS; i++) {
    // 支持外部停止：检查全局标志
    if (global.__fpAbort) { abortReason = '用户手动停止'; break }

    await page.waitForTimeout(UPLOAD_WAIT_MS)
    const elapsedSec = Math.round((Date.now() - uploadStartTime) / 1000)
    const curUrl = page.url()

    // ── 获取页面关键文字 ──
    var bodyText = ''
    try {
      bodyText = await page.evaluate(function() { return document.body.innerText })
    } catch (_) {}

    // 详细日志（每15秒或前3次）
    if (i % 5 === 4 || i < 3) {
      var snippets = []
      var kwList = ['封面', '标题', '简介', '上传', '转码', '处理中', '检测', '%']
      for (var k = 0; k < kwList.length; k++) {
        if (bodyText.includes(kwList[k])) snippets.push(kwList[k])
      }
      log('  [' + elapsedSec + 's] URL=' + curUrl.replace('https://creator.douyin.com', '...') +
          ' | 关键字:' + (snippets.join(',') || '(空)'))
    }

    // 弹窗处理
    await dismissPopups(page, log, '  [' + elapsedSec + 's] ')

    // ══ 终止条件1: 作品检测失败 ══
    if (bodyText.includes('作品检测失败') || bodyText.includes('快速检测作品失败')) {
      abortReason = '⛔ 作品检测失败（视频可能不符合规格）'
      log('  [' + elapsedSec + '] ' + abortReason)
      break
    }

    // ══ 判断是否在编辑页URL ══
    var urlInEdit = false
    for (var p = 0; p < EDIT_URL_PATTERNS.length; p++) {
      if (curUrl.includes(EDIT_URL_PATTERNS[p])) { urlInEdit = true; break }
    }

    if (!urlInEdit) {
      stableCount = 0
      // 还在上传页/其他页，继续等
      continue
    }

    // URL已在编辑页范围，开始检测页面内容
    stableCount++

    // ══ 成功条件1: 出现封面相关文字（最可靠） ══
    if (bodyText.includes('选择封面') || bodyText.includes('智能推荐封面')) {
      // 再等一下确认不是闪现
      await page.waitForTimeout(2000)
      var body2 = await page.evaluate(function() { return document.body.innerText }).catch(function() { return '' })
      if (body2.includes('选择封面') || body2.includes('智能推荐封面')) {
        editPageReady = true
        log('✅ 编辑页就绪 — 检测到封面区域 (' + elapsedSec + 's)')
        break
      }
    }

    // ══ 成功条件2: 表单输入框可见（兜底） ══
    if (stableCount > 2) {
      // URL稳定超过6秒后才开始找DOM元素
      var formSels = [
        'div[contenteditable="true"][data-placeholder*="标题"]',
        'div[contenteditable="true"][data-placeholder*="简介"]',
        'div[contenteditable="true"][data-placeholder*="添加作品"]',
        'textarea[placeholder*="作品"]',
      ]
      for (var s = 0; s < formSels.length; s++) {
        try {
          var el = await page.$(formSels[s])
          if (el && await el.isVisible().catch(function() { return false })) {
            editPageReady = true
            log('✅ 编辑页就绪 — 检测到表单元素: ' + formSels[s] + ' (' + elapsedSec + 's)')
            break
          }
        } catch (_) {}
      }
      if (editPageReady) break
    }

    // 进度提示
    if (stableCount > 3 && !editPageReady) {
      log('  [' + elapsedSec + 's] 已在编辑页URL但表单未完全渲染，继续等待...')
    }
  }

  // 结果判定
  if (abortReason) {
    log('❌ ' + abortReason)
    return { success: false, message: abortReason }
  }

  if (!editPageReady) {
    log('⚠️ 等待超时 (' + Math.round((Date.now() - uploadStartTime) / 1000) + 's)，强制继续后续步骤...')
  }

  // 缓冲让页面完全渲染
  log('缓冲5秒让页面完全渲染...')
  await page.waitForTimeout(5000)
  await dismissPopups(page, log, '[上传后] ')
  return null // 继续
}

// ════════════════════════════════════
// Step 4: 填写标题 + 正文
// ════════════════════════════════════

async function step4_fillContent(page, params, log) {
  log('[步骤4] 填写作品描述')
  await page.waitForTimeout(2000)

  // ── 4a: 标题 (0/30) ──
  var titleFilled = false
  if (params.title) {
    var titleText = String(params.title).substring(0, 30)
    var titleSels = [
      // contenteditable 方式
      'div[contenteditable="true"][data-placeholder*="标题"]',
      'div[contenteditable="true"][placeholder*="标题"]',
      '[class*="title-wrap"] div[contenteditable="true"]',
      // input/textarea 方式（抖音新版常用）
      'input[placeholder*="作品标题"]',
      'input[placeholder*="填写作品标题"]',
      'textarea[placeholder*="作品标题"]',
      'textarea[placeholder*="标题"]',
      '*[class*="titleInput"] input',
      '*[class*="title-input"] input',
    ]
    for (var ti = 0; ti < titleSels.length; ti++) {
      try {
        var el = await page.$(titleSels[ti])
        if (!el || !(await el.isVisible().catch(function() { return false }))) continue
        log('  [4a] 找到标题框: ' + titleSels[ti])
        await el.click({ timeout: 3000 })
        await page.waitForTimeout(800)
        // 判断元素类型：input/textarea 用 fill，contenteditable 用 keyboard.type
        var tag = await el.evaluate(function(n) { return n.tagName.toLowerCase() })
        if (tag === 'input' || tag === 'textarea') {
          await el.fill(titleText)
        } else {
          await el.evaluate(function(n) { n.innerText = '' })
          await page.waitForTimeout(200)
          await page.keyboard.type(titleText, { delay: 60 })
        }
        await page.waitForTimeout(500)
        var value = await el.evaluate(function(n) { return n.value || n.innerText }).catch(function() { return '' })
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
  await page.waitForTimeout(2000)

  // ── 4b: 正文/简介 (0/1000) ──
  var descFilled = false
  if (params.description) {
    var descText = String(params.description)
    var descSels = [
      'div[contenteditable="true"][data-placeholder*="添加作品简介"]',
      'div[contenteditable="true"][placeholder*="简介"]',
      'textarea[placeholder*="作品简介"]',
      'textarea[placeholder*="简介"]',
    ]
    for (var di = 0; di < descSels.length; di++) {
      try {
        var de = await page.$(descSels[di])
        if (!de || !(await de.isVisible().catch(function() { return false }))) continue
        log('  [4b] 找到正文框: ' + descSels[di])
        await de.click({ timeout: 3000 })
        await page.waitForTimeout(800)
        if (descSels[di].includes('contenteditable')) {
          await de.evaluate(function(n) { n.innerText = '' })
          await page.keyboard.type(descText, { delay: 40 })
        } else {
          await de.fill(descText)
        }
        await page.waitForTimeout(500)
        var dvalue = await de.evaluate(function(n) { return n.value || n.innerText }).catch(function() { return '' })
        if (dvalue.length > 0) {
          log('  ✅ 正文(' + dvalue.length + '字)')
          descFilled = true
          break
        }
      } catch (e) { log('  ⚠️ ' + descSels[di] + ': ' + e.message) }
    }
    if (!descFilled) log('  ❌ 正文未填入')
  } else {
    log('[4b] 跳过（无正文）')
  }

  log('步骤4完成 → 标题:' + (titleFilled ? 'OK' : '失败') + ' 正文:' + (descFilled ? 'OK' : '失败'))
  await page.waitForTimeout(2000)
}

// ════════════════════════════════════
// Step 5: 话题（勾选推荐话题）
// ════════════════════════════════════

async function step5_topics(page, params, log) {
  if (!params.topics || params.topics === 'false') {
    log('[步骤5] 跳过（话题未开启）')
    return
  }

  log('[步骤5] 勾选推荐话题...')
  await page.waitForTimeout(1500)

  // 推荐区域的话题标签格式：#xxx #yyy （带#号的span或button）
  // 从截图看，推荐行显示为：推荐  #变形  #上海陆家嘴建筑特色  #赛博朋克  ...
  var topicSelectors = [
    // 推荐行的可点击话题元素
    '[class*="recommend-topic"] span, [class*="recommend"] span[class*="tag"]',
    '[class*="topic-list"] span:not([style*="display:none"])',
    '[class*="topic-tag"]:not([style*="display:none"])',
    // 更通用的：包含#号的span/button
    'span[class*="topic"]',
  ]

  var selectedCount = 0
  const MAX_SELECT = 5 // 最多选5个

  for (var si = 0; si < topicSelectors.length; si++) {
    if (selectedCount >= MAX_SELECT) break
    try {
      var items = await page.$$(topicSelectors[si]).catch(function() { return [] })
      for (var idx = 0; idx < items.length && selectedCount < MAX_SELECT; idx++) {
        try {
          if (!(await items[idx].isVisible().catch(function() { return false }))) continue
          var text = (await items[idx].innerText()).trim()
          // 只选包含#号的话题标签
          if (text.startsWith('#')) {
            await items[idx].click({ timeout: 2000 })
            selectedCount++
            log('  ✅ 勾选:' + text)
            await page.waitForTimeout(500)
          }
        } catch (_) {}
      }
    } catch (_) {}
  }

  if (selectedCount > 0) {
    log('✅ 步骤5完成（勾选了' + selectedCount + '个话题）')
  } else {
    log('⚠️ 未找到推荐话题，跳过')
  }
  await page.waitForTimeout(1500)
}

// ════════════════════════════════════
// Step 6: 封面（竖3:4 + 横4:3）
// ════════════════════════════════════

async function step6_covers(page, log) {
  log('[步骤6] 检查封面...')
  await page.waitForTimeout(1500)
  try {
    var covers = []
    // 扩大搜索范围：button、可点击div、span等，用 includes 而非严格相等
    var allClickables = await page.$$('button, div[role="button"], [class*="cover-btn"], [class*="coverBtn"], [class*="upload-cover"]').catch(function() { return [] })
    for (var b = 0; b < allClickables.length; b++) {
      try {
        var t = (await allClickables[b].innerText()).trim()
        if (t.includes('选择封面')) covers.push(allClickables[b])
      } catch (_) {}
    }
    // 兜底：用 text 选择器直接找
    if (!covers.length) {
      try {
        var textCovers = await page.$$('text=/选择封面/').catch(function() { return [] })
        for (var tc = 0; tc < textCovers.length; tc++) {
          covers.push(textCovers[tc])
        }
      } catch (_) {}
    }
    log('  找到 ' + covers.length + ' 个选择封面按钮')

    for (var i = 0; i < Math.min(covers.length, 2); i++) {
      var lab = i === 0 ? '竖封面(3:4)' : '横封面(4:3)'
      log('  [6.' + (i+1) + '] 点击' + lab)
      try {
        await covers[i].click({ timeout: 3000 })
        await page.waitForTimeout(2000)
        // 检查是否有默认选中
        var selImg = await page.$('[class*="selected"] img, [class*="active"] img').catch(function() { return null })
        if (selImg) {
          log('    有默认选中封面')
        } else {
          var imgs = await page.$$(
            '[class*="recommend"] img, [class*="cover-list"] img, [class*="img-item"] img'
          ).catch(function() { return [] })
          if (imgs.length) {
            await imgs[0].click({ timeout: 1500 }).catch(function() {})
            log('    手动选择第1张')
            await page.waitForTimeout(500)
          }
        }
        // 点确认
        var confirmSels = ['text=使用', 'text=确定', 'text=确认', 'text=保存']
        for (var c = 0; c < confirmSels.length; c++) {
          try {
            var cb = await page.$(confirmSels[c])
            if (cb && await cb.isVisible().catch(function() { return false })) {
              await cb.click()
              log('    ✅ 确认' + lab)
              await page.waitForTimeout(1000)
              break
            }
          } catch (_) {}
        }
      } catch (e) { log('    ⚠️ ' + lab + ': ' + e.message) }
    }
    if (!covers.length) log('  ⚠️ 未找到封面按钮')
    log('✅ 步骤6完成')
  } catch (e) { log('❌ 步骤6: ' + e.message) }
  await page.waitForTimeout(2000)
}

// ════════════════════════════════════
// Step 7: 发布
// ════════════════════════════════════

async function step7_publish(page, params, log) {
  if (params.publishNow === 'false') {
    log('[步骤7] 草稿模式')
    return { success: true, message: '内容已填完，保存草稿', needConfirm: true }
  }

  log('[步骤7] 寻找发布按钮...')
  await page.waitForTimeout(2000)
  var pub = false

  try {
    var allBtns = await page.$$('button')
    var vis = []
    for (var i = 0; i < allBtns.length; i++) {
      try {
        var t = (await allBtns[i].innerText()).trim()
        if (await allBtns[i].isVisible().catch(function() { return false }) && t) {
          vis.push({ t: t, n: i })
        }
      } catch (_) {}
    }
    log('  可见按钮(' + vis.length + '):')
    for (var v = 0; v < vis.length; v++) log('    [' + vis[v].n + "] \"" + vis[v].t + '"')

    // 匹配 "发布" 或 "立即发布"，排除含"离开"的
    for (var b = 0; b < vis.length; b++) {
      if ((vis[b].t === '发布' || vis[b].t === '立即发布') && !vis[b].t.includes('离开')) {
        await allBtns[vis[b].n].click({ timeout: 5000 })
        pub = true
        log('  ✅ 点击:"' + vis[b].t + '"')
        break
      }
    }
  } catch (e) { log('  遍历异常: ' + e.message) }

  // 兜底
  if (!pub) {
    try {
      await page.click('button:has-text("发布")', { timeout: 3000 })
      pub = true
      log('  兜底成功')
    } catch (_) {}
  }

  if (!pub) {
    log('❌ 未找到发布按钮！请手动点击')
    return { success: true, message: '内容已填完，请手动点「发布」', needConfirm: true }
  }

  log('等待发布响应(8s)...')
  await page.waitForTimeout(8000)

  var fu = page.url()
  var bt = await page.evaluate(function() { return document.body.innerText }).catch(function() { return '' })
  if (bt.includes('发布成功') || fu.includes('/manage')) {
    log('🎉 发布成功！')
    return { success: true, message: '视频已发布到抖音' }
  }
  log('⚠️ 结果不确定，请确认')
  return { success: true, message: '已执行发布，请手动确认', needConfirm: true }
}

// ════════════════════════════════════
// 主入口
// ════════════════════════════════════

/**
 * 执行抖音视频发布
 * @param {import('playwright').Page} page
 * @param {{ videoPath: string, title?: string, description?: string, topics?: string, publishNow?: string }} params
 * @param {(msg:string)=>void} log
 */
async function executeDouyinPublish(page, params, log) {
  var fs = require('fs')

  // 校验
  if (!params.videoPath) return { success: false, message: '请提供视频文件路径' }
  if (!fs.existsSync(params.videoPath)) return { success: false, message: '视频文件不存在: ' + params.videoPath }

  try {
    // Step 1: 导航
    await step1_navigate(page, params, log)

    // Step 2: 上传
    var uploadErr = await step2_upload(page, params, fs, log)
    if (uploadErr) return uploadErr

    // Step 3: 等待转码完成进入编辑页
    var step3Result = await step3_waitUpload(page, log)
    if (step3Result && !step3Result.success) return step3Result // 上传失败或作品检测失败

    // Step 4: 填写标题+正文
    await step4_fillContent(page, params, log)

    // Step 5: 话题
    await step5_topics(page, params, log)

    // Step 6: 封面
    await step6_covers(page, log)

    // Step 7: 发布
    return await step7_publish(page, params, log)

  } catch (e) {
    log('❌ 出错: ' + e.message)
    return { success: false, message: e.message }
  }
}

module.exports = { executeDouyinPublish }
