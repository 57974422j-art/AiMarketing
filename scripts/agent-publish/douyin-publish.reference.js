/**
 * 抖音发视频模板 v5
 *
 * 流程：/content/upload → 上传 → 等转码 → /content/post/video编辑 → 标题→正文→话题→封面→发布
 *
 * 参数：
 *   - videoPath:   视频文件绝对路径（必填）
 *   - title:       作品标题，最多30字
 *   - description: 作品简介/正文，最多1000字
 *   - topics:      自定义话题（逗号分隔）或留空跳过
 *   - publishNow:  是否立即发布 ("true"/"false")
 *   - coverImage:  自定义封面图片名（来自素材仓库），留空则使用默认
 *   - location:    地理位置（可选）
 *   - autoMusic:   自定义音乐文件名（来自素材仓库），留空则跳过
 */

const path = require('path')
const { resolveLocalVideoPath } = require('./_common')

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
    await page.goto(targetUrl, { timeout: 30000, waitUntil: 'domcontentloaded' })
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
  // 支持旧格式布尔值和新格式字符串
  var topics = ''
  if (typeof params.topics === 'string') {
    topics = params.topics.trim()
  } else if (params.topics && params.topics !== 'false') {
    // 旧格式 true → 跳过（不再支持推荐点击）
    log('[步骤5] 旧格式topics=true已废弃，请使用自定义话题')
    return
  }

  if (!topics) {
    log('[步骤5] 跳过（无自定义话题）')
    return
  }

  log('[步骤5] 添加自定义话题...')

  // 解析话题：支持逗号、空格、#号分隔
  var topicList = topics.split(/[\s,，#]+/).filter(function(t) { return t.trim().length > 0 })
  if (topicList.length === 0) { log('  ⚠️ 无有效话题'); return }
  log('  话题列表: ' + JSON.stringify(topicList))

  await page.waitForTimeout(1500)

  for (var ti = 0; ti < topicList.length; ti++) {
    var t = topicList[ti].trim()
    // 确保有#前缀
    if (!t.startsWith('#')) t = '#' + t

    try {
      // 方式1：点击 #添加话题 按钮
      var addBtn = null
      var addSels = ['text=#添加话题', 'text=添加话题', '[class*="add-topic"]', '[class*="addTopic"]']
      for (var si = 0; si < addSels.length; si++) {
        try {
          addBtn = await page.$(addSels[si])
          if (addBtn && await addBtn.isVisible().catch(function() { return false })) break
          addBtn = null
        } catch (_) {}
      }

      if (addBtn) {
        await addBtn.click({ timeout: 3000 })
        log('  点击「添加话题」')
        await page.waitForTimeout(1000)
      } else {
        // 兜底：直接在正文框后输入（部分版本没有独立按钮）
        log('  未找到「添加话题」按钮，尝试在话题区域输入...')
      }

      // 输入话题文字并回车确认
      await page.keyboard.type(t, { delay: 30 })
      await page.waitForTimeout(500)
      await page.keyboard.press('Enter')
      await page.waitForTimeout(1000)

      // 检查是否弹出选择列表，如果有则选第一个
      try {
        var suggestions = await page.$$('[class*="topic-suggest"] li, [class*="topic-list"] li, [class*="suggestion"] div').catch(function() { return [] })
        if (suggestions.length > 0 && await suggestions[0].isVisible().catch(function() { return false })) {
          await suggestions[0].click({ timeout: 1500 })
          log('  ✅ 选择推荐: ' + t)
          await page.waitForTimeout(800)
        }
      } catch (_) {}

      log('  ✅ 已输入: ' + t)
      await page.waitForTimeout(800)
    } catch (e) {
      log('  ⚠️ 话题"' + t + '"失败: ' + e.message)
    }

    // 防止过快
    if (ti < topicList.length - 1) await page.waitForTimeout(1000)
  }

  log('✅ 步骤5完成（添加了' + Math.min(ti, topicList.length) + '个话题）')
  await page.waitForTimeout(1500)
}

// ════════════════════════════════════
// Step 6: 封面（竖3:4 + 横4:3）
// ════════════════════════════════════

async function step6_covers(page, params, log) {
  log('[步骤6] 检查封面...')
  await page.waitForTimeout(1500)
  try {
    // 查找封面入口按钮：竖封面3:4 / 横封面4:3（点开各自弹窗）
    var covers = []
    var coverEntries = ['竖封面3:4', '横封面4:3']
    for (var ce = 0; ce < coverEntries.length; ce++) {
      try {
        var ceHandles = await page.getByText(coverEntries[ce], { exact: true }).elementHandles()
        for (var ch = 0; ch < ceHandles.length; ch++) {
          if (await ceHandles[ch].isVisible().catch(function() { return false })) covers.push(ceHandles[ch])
        }
      } catch (_) {}
    }
    if (!covers.length) {
      // 兜底：按 class 关键词找封面入口
      try {
        var alt = await page.$$('[class*="cover"] button, [class*="cover"] div[role="button"]').catch(function() { return [] })
        for (var a = 0; a < alt.length; a++) {
          var at = (await alt[a].innerText()).catch(function() { return '' })
          if (at && (at.indexOf('竖封面') >= 0 || at.indexOf('横封面') >= 0 || at.indexOf('选择封面') >= 0)) covers.push(alt[a])
        }
      } catch (_) {}
    }
    log('  找到 ' + covers.length + ' 个封面入口')

    // 如果有自定义封面图片，先下载到本地
    var localCoverPath = null
    if (params.coverImage) {
      var serverUrl = process.env.SERVER_URL || 'http://120.55.43.195:3000'
      var userId = params.userId || ''
      var coverDownloadUrl = serverUrl + '/api/storage/file?userId=' + userId + '&name=' + encodeURIComponent(params.coverImage)
      var osTmpDir = require('os').tmpdir()
      var coverTmpDir = path.join(osTmpDir, 'aimarketing-covers')
      if (!require('fs').existsSync(coverTmpDir)) require('fs').mkdirSync(coverTmpDir, { recursive: true })
      localCoverPath = path.join(coverTmpDir, params.coverImage)
      log('  下载自定义封面: ' + params.coverImage)
      try {
        await new Promise(function(resolve, reject) {
          var urlObj2 = new URL(coverDownloadUrl)
          var mod2 = require(urlObj2.protocol === 'https:' ? 'https' : 'http')
          mod2.get(coverDownloadUrl, { timeout: 60000 }, function(res2) {
            if (res2.statusCode !== 200) return reject(new Error('HTTP ' + res2.statusCode))
            var chunks2 = []
            res2.on('data', function(c) { chunks2.push(c) })
            res2.on('end', function() {
              require('fs').writeFileSync(localCoverPath, Buffer.concat(chunks2))
              resolve()
            })
          }).on('error', reject).on('timeout', function() { reject(new Error('下载超时')) })
        })
        log('  ✅ 封面已下载 (' + (require('fs').statSync(localCoverPath).size / 1024).toFixed(1) + 'KB)')
      } catch (e2) {
        log('  ⚠️ 封面下载失败: ' + e2.message)
        localCoverPath = null
      }
    }

    // ══ 方案A：无自定义封面 → 整个 step6 不进封面弹窗，直接用平台默认封面 ══
    if (!(localCoverPath && require('fs').existsSync(localCoverPath))) {
      log('  跳过封面设置（无自定义封面，使用平台默认封面）')
      log('✅ 步骤6完成')
      await page.waitForTimeout(2000)
      return
    }

    for (var i = 0; i < Math.min(covers.length, 2); i++) {
      var lab = i === 0 ? '竖封面3:4' : '横封面4:3'
      log('  [6.' + (i+1) + '] 打开' + lab + '弹窗')
      var selectedCover = false

      try {
        // 点击封面入口，打开设置弹窗（设置竖封面 / 设置横封面）
        await covers[i].click({ timeout: 4000 })
        await page.waitForTimeout(2000)

        if (localCoverPath && require('fs').existsSync(localCoverPath)) {
          // ══ 路线A：有自定义封面 → 上传 ══
          var uploaded = false
          // 等弹窗内按钮渲染
          await page.waitForTimeout(1500)
          try {
            // 取所有含"上传封面"的元素，挑第一个【可见】的（避免 .first() 命中隐藏弹窗里的同名按钮）
            var upAll = await page.$$(
              'button:has-text("上传封面"), [role="button"]:has-text("上传封面"), [class*="upload"]'
            ).catch(function() { return [] })
            var upLoc = null
            for (var u = 0; u < upAll.length; u++) {
              if (await upAll[u].isVisible().catch(function() { return false })) { upLoc = upAll[u]; break }
            }
            if (upLoc) {
              var fcResult = await Promise.all([
                page.waitForEvent('filechooser', { timeout: 5000 }).catch(function() { return null }),
                upLoc.click({ timeout: 2000 }).catch(function() {})
              ])
              if (fcResult[0]) {
                await fcResult[0].setFiles(localCoverPath)
                uploaded = true
                log('    ✅ 已上传自定义封面')
                await page.waitForTimeout(3000)
              } else {
                var fip = await page.$('input[type=file]').catch(function() { return null })
                if (fip) { await fip.setInputFiles(localCoverPath).catch(function() {}); uploaded = true; log('    ✅ 已上传自定义封面(直传input)'); await page.waitForTimeout(3000) }
              }
            } else {
              log('    ⚠️ 未找到可见的上传封面按钮（尝试直接定位 input）')
              var fip2 = await page.$('input[type=file]').catch(function() { return null })
              if (fip2) { await fip2.setInputFiles(localCoverPath).catch(function() {}); uploaded = true; log('    ✅ 已上传自定义封面(直传input)'); await page.waitForTimeout(3000) }
            }
          } catch (_) {}
          if (!uploaded) log('    ⚠️ 未找到上传封面按钮')
          else selectedCover = true
        }

        // ── 点「完成」确认封面选择（仅当已选封面时）──
        if (selectedCover) {
          var doneOk = false
          try {
            // 优先用 button 选择器，避免 .first() 误命中隐藏的"完成"文本节点
            var doneBtn = await page.$('button:has-text("完成")').catch(function() { return null })
            if (!doneBtn) doneBtn = page.getByText('完成', { exact: true }).first()
            if (doneBtn && await doneBtn.isVisible().catch(function() { return false })) {
              await doneBtn.click({ timeout: 3000 }).catch(function() {})
              doneOk = true
              log('    ✅ 完成(' + lab + ')')
            }
          } catch (_) {}
          if (!doneOk) log('    ⚠️ 未点中完成按钮（封面可能未生效）')
        } else {
          // 未选封面（默认帧）：直接关闭弹窗，保留平台默认
          try {
            var xBtn = await page.$('[aria-label="关闭"], [class*="close-btn"]')
            if (xBtn && await xBtn.isVisible().catch(function() { return false })) await xBtn.click().catch(function() {})
            else await page.keyboard.press('Escape')
          } catch (_) {}
        }

        // 用 JS 强制清除弹窗/遮罩残留 DOM，避免挡住后续步骤
        await page.waitForTimeout(800)
        try {
          await page.evaluate(function() {
            var selectors = [
              '[role="dialog"][aria-modal="true"]',
              '.dy-creator-content-modal-wrap',
              '.dy-creator-content-portal',
              '[class*="modal-overlay"]',
              '[class*="modal-mask"]',
            ]
            selectors.forEach(function(sel) {
              var els = document.querySelectorAll(sel)
              for (var k = 0; k < els.length; k++) { els[k].remove() }
            })
          })
          log('    弹窗已清除')
        } catch (_) {}
        await page.waitForTimeout(800)

      } catch (e) { log('    ⚠️ ' + lab + ': ' + e.message) }
    }
    if (!covers.length) log('  ⚠️ 未找到封面入口')
    log('✅ 步骤6完成')
  } catch (e) { log('❌ 步骤6: ' + e.message) }
  await page.waitForTimeout(2000)
}

// ════════════════════════════════════
// Step 6.5: 选择音乐
//
// 流程：点击"选择音乐"按钮 → 搜索/上传自定义音乐 → 确认使用
// params.autoMusic = 音乐文件名(来自素材仓库)，留空则跳过
// ════════════════════════════════════

async function step65_selectMusic(page, params, log) {
  if (!params.autoMusic || !params.autoMusic.trim()) {
    log('[步骤6.5] 跳过（无自定义音乐）')
    return
  }

  log('[步骤6.5] 选择自定义音乐: ' + params.autoMusic.trim())
  await page.waitForTimeout(1500)

  try {
    // ── 1. 查找"选择音乐"按钮 ──
    var musicBtns = []
    var allClickables = await page.$$('button, div[role="button"], [class*="music-btn"], [class*="musicBtn"], [class*="sound-btn"]').catch(function() { return [] })
    for (var b = 0; b < allClickables.length; b++) {
      try {
        var t = (await allClickables[b].innerText()).trim()
        // 匹配"选择音乐"、"添加音乐"、"配乐"、"换一个"等
        if (t.includes('选择音乐') || t.includes('添加音乐') || t === '配乐' || t.includes('换一个')) {
          musicBtns.push(allClickables[b])
        }
      } catch (_) {}
    }
    // 文本选择器兜底
    if (!musicBtns.length) {
      try {
        var textBtns = await page.$$(
          'text=/选择音乐/, text=/添加音乐/, text=/配乐/, text=/换一个/'
        ).catch(function() { return [] })
        for (var ti = 0; ti < textBtns.length; ti++) musicBtns.push(textBtns[ti])
      } catch (_) {}
    }

    // 也检查页面上是否有"音乐"相关文字区域（可能是个入口）
    if (!musicBtns.length) {
      var bodyText = await page.evaluate(function() { return document.body.innerText }).catch(function() { return '' })
      if (!bodyText.includes('音乐') && !bodyText.includes('配乐') && !bodyText.includes('BGM')) {
        log('  ⚠️ 页面上未检测到音乐相关区域，跳过')
        return
      }
      // 有文字但没找到按钮，用更宽泛的选择器再试一次
      try {
        var broadBtns = await page.$$('div[class*="music"], div[class*="sound"], div[class*="bgm"] button, div[class*="music"] span').catch(function() { return [] })
        musicBtns = broadBtns
      } catch (_) {}
    }

    log('  找到 ' + musicBtns.length + ' 个音乐相关按钮')

    if (!musicBtns.length) {
      log('  ⚠️ 未找到"选择音乐"按钮，跳过音乐设置')
      return
    }

    // ── 2. 点击第一个音乐按钮打开弹窗 ──
    await musicBtns[0].click({ timeout: 3000 })
    await page.waitForTimeout(2500)
    log('  已点击音乐按钮，等待弹窗...')

    // ── 3. 尝试上传自定义音乐 ──
    // 先下载音乐到本地
    var serverUrl = process.env.SERVER_URL || 'http://120.55.43.195:3000'
    var userId = params.userId || ''
    var musicDownloadUrl = serverUrl + '/api/storage/file?userId=' + userId + '&name=' + encodeURIComponent(params.autoMusic.trim())
    var osTmpDir = require('os').tmpdir()
    var musicTmpDir = path.join(osTmpDir, 'aimarketing-music')
    if (!require('fs').existsSync(musicTmpDir)) require('fs').mkdirSync(musicTmpDir, { recursive: true })
    var localMusicPath = path.join(musicTmpDir, params.autoMusic.trim())

    log('  下载自定义音乐: ' + params.autoMusic.trim())
    try {
      await new Promise(function(resolve, reject) {
        var urlObj = new URL(musicDownloadUrl)
        var mod = require(urlObj.protocol === 'https:' ? 'https' : 'http')
        mod.get(musicDownloadUrl, { timeout: 120000 }, function(res) {
          if (res.statusCode !== 200) return reject(new Error('HTTP ' + res.statusCode))
          var chunks = []
          res.on('data', function(c) { chunks.push(c) })
          res.on('end', function() {
            require('fs').writeFileSync(localMusicPath, Buffer.concat(chunks))
            resolve()
          })
        }).on('error', reject).on('timeout', function() { reject(new Error('音乐下载超时')) })
      })
      log('  ✅ 音乐已下载 (' + (require('fs').statSync(localMusicPath).size / 1024).toFixed(1) + 'KB)')
    } catch (e2) {
      log('  ⚠️ 音乐下载失败: ' + e2.message)
      // 关闭弹窗然后退出
      try { await page.keyboard.press('Escape'); await page.waitForTimeout(1000) } catch (_) {}
      return
    }

    // ── 4. 查找"上传音乐"按钮并上传 ──
    var uploadSelectors = ['text=上传音乐', 'text=+ 上传', 'text=本地上传', '[class*="upload-music"]', '[class*="upload-sound"]']
    var uploadClicked = false

    for (var ui = 0; ui < uploadSelectors.length; ui++) {
      try {
        var ub = await page.$(uploadSelectors[ui])
        if (ub && await ub.isVisible().catch(function() { return false })) {
          var fcResult = await Promise.all([
            page.waitForEvent('filechooser', { timeout: 5000 }).catch(function() { return null }),
            ub.click({ timeout: 2000 }).catch(function() {})
          ])
          if (fcResult[0]) {
            await fcResult[0].setFiles(localMusicPath)
            log('  ✅ 已上传自定义音乐')
            uploadClicked = true
            await page.waitForTimeout(3000)
            break
          }
        }
      } catch (_) {}
    }

    if (!uploadClicked) {
      log('  ⚠️ 未找到上传音乐入口，尝试使用已选音乐或默认推荐')
    }

    // ── 5. 确认使用 / 完成选择 ──
    var confirmSelectors = ['text=使用', 'text=确定使用', 'text=确认使用', 'text=完成', 'button:has-text("使用")']
    var confirmed = false
    for (var ci = 0; ci < confirmSelectors.length; ci++) {
      try {
        var cb = await page.$(confirmSelectors[ci])
        if (cb && await cb.isVisible().catch(function() { return false })) {
          await cb.click({ timeout: 3000 })
          confirmed = true
          log('  ✅ 已确认使用音乐')
          await page.waitForTimeout(1500)
          break
        }
      } catch (_) {}
    }

    if (!confirmed) {
      // 兜底：按 Enter 或点弹窗外关闭
      log('  未找到确认按钮，尝试关闭弹窗')
      try {
        var xBtn = await page.$('[aria-label="关闭"], [class*="close-btn"]')
        if (xBtn && await xBtn.isVisible().catch(function() { return false })) {
          await xBtn.click().catch(function() {})
        } else {
          await page.keyboard.press('Escape')
        }
        await page.waitForTimeout(1000)
      } catch (_) {}
    }

    log('✅ 步骤6.5完成')
  } catch (e) {
    log('❌ 步骤6.5: ' + e.message)
    // 出错时尝试恢复
    try { await page.keyboard.press('Escape') } catch (_) {}
  }
}

// ════════════════════════════════════
// Step 5.5: 位置标签
// ════════════════════════════════════

async function step55_location(page, params, log) {
  if (!params.location || !params.location.trim()) {
    log('[步骤5.5] 跳过（无位置信息）')
    return
  }

  var locText = String(params.location).trim()
  log('[步骤5.5] 填写地理位置: ' + locText)
  await page.waitForTimeout(1000)

  var filled = false

  // 路径1：直接找位置输入框（兼容多种 placeholder 文案）
  var locSels = [
    'input[placeholder*="地理位置"]',
    'input[placeholder*="位置"]',
    'input[placeholder*="你在哪"]',
    'input[placeholder*="所在"]',
    '[class*="location"] input',
    '[class*="geo"] input',
    '*[class*="locationInput"] input',
  ]
  for (var li = 0; li < locSels.length; li++) {
    try {
      var le = await page.$(locSels[li])
      if (!le || !(await le.isVisible().catch(function() { return false }))) continue
      log('  找到位置框: ' + locSels[li])
      await le.click({ timeout: 3000 })
      await page.waitForTimeout(500)
      await le.fill(locText)
      await page.waitForTimeout(2000)
      await selectFirstLocationSuggestion(page, log)
      filled = true
      log('  ✅ 位置已填入')
      break
    } catch (e) { log('  ⚠️ ' + locSels[li] + ': ' + e.message) }
  }

  // 路径2：点「位置」入口 → 等输入框出现（抖音这版位置入口是文本按钮，不是直接 input）
  if (!filled) {
    try {
      var entry = await page.locator('text=/位置|你在哪|所在位置|添加位置/').first()
      if (entry && await entry.isVisible().catch(function() { return false })) {
        await entry.click()
        log('  已点击位置入口，等待输入框...')
        await page.waitForSelector('input', { timeout: 5000 })
        await page.waitForTimeout(500)
        var ins = await page.$$('input')
        var target = ins[ins.length - 1]
        await target.click({ timeout: 3000 })
        await target.fill(locText)
        await page.waitForTimeout(2000)
        await selectFirstLocationSuggestion(page, log)
        filled = true
        log('  ✅ 位置已填入')
      }
    } catch (e) { log('  ⚠️ 入口点击失败: ' + e.message) }
  }

  // 路径3：兜底键盘输入
  if (!filled) {
    try {
      var locLabel = await page.getByText('位置', { exact: false }).first()
      if (locLabel && await locLabel.isVisible().catch(function() { return false })) {
        await locLabel.click()
        await page.waitForTimeout(500)
        await page.keyboard.type(locText, { delay: 30 })
        await page.waitForTimeout(1500)
        await page.keyboard.press('Enter')
        filled = true
        log('  ✅ 通过键盘输入位置')
      }
    } catch (_) {}
  }

  if (!filled) log('  ⚠️ 未找到位置输入框')
  await page.waitForTimeout(1000)
}

// 选第一个位置下拉建议
async function selectFirstLocationSuggestion(page, log) {
  try {
    var suggestions = await page.$$('[class*="location-suggest"] li, [class*="geo-item"] div, [role="option"]').catch(function() { return [] })
    if (suggestions.length > 0 && await suggestions[0].isVisible().catch(function() { return false })) {
      await suggestions[0].click({ timeout: 2000 }).catch(function() {})
      log('  ✅ 选择推荐位置')
      await page.waitForTimeout(800)
    }
  } catch (_) {}
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
 * @param {{ videoPath: string, title?: string, description?: string, topics?: string, publishNow?: string, coverImage?: string, location?: string, userId?: string }} params
 * @param {(msg:string)=>void} log
 */
async function executeDouyinPublish(page, params, log) {
  var fs = require('fs')

  log('📋 参数检查开始...')
  log('   videoPath: ' + (params.videoPath || '未提供'))
  log('   title: ' + (params.title || '未提供'))
  log('   coverImage: ' + (params.coverImage || '无'))

  // 校验 + 解析视频（素材仓库名 → 本地路径；修复“缺少 videoPath”断点）
  try {
    const resolved = await resolveLocalVideoPath(params, log)
    log('✅ 视频文件校验通过: ' + resolved)
  } catch (e) {
    log('❌ 视频解析失败: ' + e.message)
    return { success: false, message: '视频获取失败: ' + e.message }
  }

  try {
    // Step 1: 导航
    log('▶ Step 1/7: 导航到发布页...')
    await step1_navigate(page, params, log)
    // 登录态检测：导航后应停留在上传页，若被重定向到登录页则说明未登录
    const cur1 = page.url()
    if (!cur1.includes('/content/upload')) {
      log('⚠️ 未处于上传页（可能未登录）: ' + cur1)
      return { success: false, message: '账号未登录或已掉线，请先扫码登录', needLogin: true }
    }
    log('✅ Step 1 完成')

    // Step 2: 上传
    log('▶ Step 2/7: 上传视频...')
    var uploadErr = await step2_upload(page, params, fs, log)
    if (uploadErr) return uploadErr
    log('✅ Step 2 完成')

    // Step 3: 等待转码完成进入编辑页
    log('▶ Step 3/7: 等待转码...')
    var step3Result = await step3_waitUpload(page, log)
    if (step3Result && !step3Result.success) return step3Result
    log('✅ Step 3 完成')

    // Step 4: 填写标题+正文
    log('▶ Step 4/7: 填写标题+正文...')
    await step4_fillContent(page, params, log)
    log('✅ Step 4 完成')

    // Step 5: 话题
    log('▶ Step 5/7: 添加话题...')
    await step5_topics(page, params, log)
    log('✅ Step 5 完成')

    // Step 5.5: 位置
    log('▶ Step 5.5/6: 设置位置...')
    await step55_location(page, params, log)

    // Step 6: 封面
    log('▶ Step 6/6: 选择封面...')
    await step6_covers(page, params, log)

    // Step 7: 发布（音乐已移除，本地配好再上传）
    log('▶ 发布...')
    return await step7_publish(page, params, log)

  } catch (e) {
    log('❌ 异常退出: ' + e.message)
    log('   堆栈: ' + (e.stack || '').substring(0, 300))
    return { success: false, message: e.message }
  }
}

module.exports = { executeDouyinPublish }
