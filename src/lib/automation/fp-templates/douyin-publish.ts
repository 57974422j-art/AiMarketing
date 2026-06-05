/**
 * 抖音视频发布模板 v4
 *
 * v4 修复：
 * 1. 标题/正文改用 contenteditable div 选择器（抖音实际DOM）
 * 2. 用 keyboard.type() 替代 fill()
 * 3. 正文选择器限定编辑区域
 * 4. 话题输入后点击下拉选项确认
 * 5. 上传完成检测增加二次确认
 * 6. 弹窗处理抽取为复用函数
 * 7. 封面选择检查默认选中项
 */

import { TemplateResult, LogFn, FingerprintTemplate, TemplateParamDef } from './types'

const meta = {
  key: 'douyin-publish',
  label: '📝 抖音发视频',
  description: '上传视频+填写文案+话题+封面+发布',
  platforms: ['douyin'],
  version: '4.0.0',
}

const params: TemplateParamDef[] = [
  {
    key: 'videoPath', label: '视频文件路径', type: 'file',
    placeholder: '如 D:\\video\\test.mp4 或 /home/user/video/test.mp4',
    required: true,
  },
  {
    key: 'caption', label: '文案/标题', type: 'textarea',
    placeholder: '输入作品描述、标题...', required: false, defaultValue: '',
  },
  {
    key: 'topics', label: '话题标签', type: 'text',
    placeholder: '#美食 #生活vlog', required: false,
  },
  {
    key: 'publishNow', label: '发布方式', type: 'select',
    options: [
      { label: '立即发布', value: 'true' },
      { label: '仅保存草稿', value: 'false' },
    ],
    defaultValue: 'true',
  },
]

// ════════════════════════════════════
// 工具函数
// ════════════════════════════════════

/** 关闭常见弹窗 */
async function dismissPopups(page: any, log: LogFn, prefix = ''): Promise<void> {
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

/** 填写标题（contenteditable div）- 抖音实际DOM是div不是input */
async function fillTitle(page: any, titleText: string, log: LogFn): Promise<boolean> {
  const text = titleText.substring(0, 30)
  const selectors = [
    'div[contenteditable="true"][data-placeholder*="标题"]',
    'div[contenteditable="true"][placeholder*="标题"]',
    '[class*="title-wrap"] div[contenteditable="true"]',
    '[class*="TitleInput"] div[contenteditable="true"]',
  ]

  for (const sel of selectors) {
    try {
      const el = await page.$(sel)
      if (!el || !(await el.isVisible().catch(() => false))) continue
      log(`  找到标题框: ${sel}`)
      await el.click({ timeout: 3000 })
      await page.waitForTimeout(800)
      // 清空 + 键盘输入（fill对contenteditable无效）
      await el.evaluate((n: any) => { n.innerText = '' })
      await page.waitForTimeout(200)
      await page.keyboard.type(text, { delay: 60 })
      await page.waitForTimeout(500)
      // 验证
      const value = await el.evaluate((n: any) => n.innerText).catch(() => '')
      if (value.trim().length > 0) { log(`  ✅ 标题:"${value}"`); return true }
      else { log(`  ⚠️ 验证为空`) }
    } catch (e: any) { log(`  ⚠️ ${sel}: ${e.message}`) }
  }
  return false
}

/** 填写正文/描述（contenteditable div 或 textarea） */
async function fillDescription(page: any, caption: string, log: LogFn): Promise<boolean> {
  const selectors = [
    'div[contenteditable="true"][data-placeholder*="添加作品简介"]',
    'div[contenteditable="true"][placeholder*="简介"]',
    'div[contenteditable="true"][placeholder*="描述"]',
    '.editor-wrapper div[contenteditable="true"]',
    'textarea[placeholder*="作品简介"]',
    'textarea[placeholder*="简介"]',
  ]

  for (const sel of selectors) {
    try {
      const el = await page.$(sel)
      if (!el || !(await el.isVisible().catch(() => false))) continue
      log(`  找到正文框: ${sel}`)
      await el.click({ timeout: 3000 })
      await page.waitForTimeout(800)
      if (sel.includes('contenteditable')) {
        await el.evaluate((n: any) => { n.innerText = '' })
        await page.keyboard.type(caption, { delay: 40 })
      } else {
        await el.fill(caption)
      }
      await page.waitForTimeout(500)
      const value = await el.evaluate((n: any) => n.value || n.innerText).catch(() => '')
      if (value.length > 0) { log(`  ✅ 正文(${value.length}字)`); return true }
    } catch (e: any) { log(`  ⚠️ ${sel}: ${e.message}`) }
  }
  return false
}

async function execute(page: any, p: Record<string, any>, log: LogFn): Promise<TemplateResult> {
  const fs = require('fs')

  // ═══ 校验 ═══
  if (!p.videoPath) return { success: false, message: '请提供视频文件路径' }
  if (!fs.existsSync(p.videoPath)) return { success: false, message: `视频文件不存在: ${p.videoPath}` }

  try {
    // ── Step 1: 导航到上传页 ──
    const targetUrl = 'https://creator.douyin.com/creator-micro/content/upload'
    const currentUrl = page.url()
    log(`当前页面: ${currentUrl}`)

    if (currentUrl !== targetUrl && !currentUrl.includes('/content/upload')) {
      log(`导航到: ${targetUrl}`)
      await page.goto(targetUrl, { timeout: 30000, waitUntil: 'networkidle' })
      await page.waitForTimeout(5000)
      log(`已到达: ${page.url()}`)
    } else {
      log('当前已在视频上传页')
      await page.waitForTimeout(2000)
    }

    // ── Step 1.5: 处理弹窗 ──
    await dismissPopups(page, log)

    // ── Step 2: 上传视频 ──
    log(`准备上传视频: ${p.videoPath}`)
    let uploaded = false

    // 2a. 探测 file input（含隐藏的）
    let allFileInputs: any[] = []
    try {
      allFileInputs = await page.evaluate(() => {
        const inputs = document.querySelectorAll('input[type="file"]')
        return Array.from(inputs).map((el: any, i: number) => ({
          index: i, accept: el.getAttribute('accept'), id: el.id,
          className: el.className.substring(0, 60),
        }))
      })
    } catch (e: any) { log(`探测出错: ${e.message}`) }

    log(`探测到 ${allFileInputs.length} 个 file input`)
    if (allFileInputs.length > 0) { log(JSON.stringify(allFileInputs)) }

    for (let i = 0; i < allFileInputs.length; i++) {
      try {
        const els = await page.$$('input[type="file"]')
        if (els[i]) {
          await els[i].setInputFiles(p.videoPath)
          uploaded = true
          log('✅ 视频已设置到 file input[' + i + ']')
          break
        }
      } catch (e: any) { log(`  input[${i}] 失败: ${e.message}`) }
    }

    // 2b. 兜底：点击触发 file chooser
    if (!uploaded) {
      log('尝试点击触发文件选择器...')
      const triggers = [
        'text=上传视频','text=上传','text=选择文件','text=拖拽',
        '[class*="upload-btn"]','[class*="UploadBtn"]',
        '[class*="upload-area"]','[class*="picker"]',
        '[data-e2e="upload"]',
      ]
      for (const trigger of triggers) {
        try {
          const [fc] = await Promise.all([
            page.waitForEvent('filechooser', { timeout: 3000 }).catch(() => null),
            page.click(trigger, { timeout: 2000 }).catch(() => {}),
          ])
          if (fc) {
            await fc.setFiles(p.videoPath)
            uploaded = true
            log('✅ 文件选择器上传成功 (' + trigger + ')')
            break
          }
        } catch (_) {}
      }
    }

    // 2c. page.setInputFiles 兜底
    if (!uploaded) {
      try {
        await page.setInputFiles('input[type="file"]', p.videoPath)
        uploaded = true
        log('✅ page.setInputFiles 成功')
      } catch (_) {}
    }

    if (!uploaded) {
      const info = await page.evaluate(() => ({ url: location.href, title: document.title, body: document.body.innerText.substring(0, 200) })).catch(() => ({} as any))
      return { success: false, message: '未找到上传入口 URL=' + info.url }
    }

    // ── Step 3: 等待上传完成进入编辑页 ──
    log('═══ Step 3: 等待视频上传+转码 ═══')
    const UPLOAD_WAIT_MS = 3000
    const MIN_UPLOAD_SEC = 30
    const MAX_UPLOAD_SEC = 270
    const MAX_LOOPS = Math.floor(MAX_UPLOAD_SEC * 1000 / UPLOAD_WAIT_MS)
    const MIN_LOOPS = Math.floor(MIN_UPLOAD_SEC * 1000 / UPLOAD_WAIT_MS)

    let editPageDetected = false
    let uploadStartTime = Date.now()

    for (let i = 0; i < MAX_LOOPS; i++) {
      await page.waitForTimeout(UPLOAD_WAIT_MS)

      const elapsedSec = Math.round((Date.now() - uploadStartTime) / 1000)
      const currentUrl = page.url()

      // 详细日志（每15秒或前3次）
      if (i % 5 === 4 || i < 3) {
        const info = await page.evaluate(() => {
          const body = document.body.innerText
          const matches: string[] = []
          for (const kw of ['上传中','上传完成','转码中','转码完成','处理中','%']) {
            if (body.includes(kw)) matches.push(kw)
          }
          return { url: location.href, matches }
        }).catch(() => ({ url: currentUrl, matches: [] as string[] }))
        log(`  [${elapsedSec}s] URL=${currentUrl.replace('https://creator.douyin.com','...')} | 关键词:${info.matches.join(',')||'无'}`)
      }

      // 弹窗处理（复用函数）
      await dismissPopups(page, log, `  [${elapsedSec}s] `)

      // ── 双重检测 ──
      const urlChanged = currentUrl.includes('/content/publish') || currentUrl.includes('/publish')
      let editElementsFound = false

      if (i >= MIN_LOOPS) {
        // 严格选择器：只匹配编辑页特有的 contenteditable 元素
        const strictSels = [
          'div[contenteditable="true"][data-placeholder*="标题"]',
          'div[contenteditable="true"][data-placeholder*="简介"]',
        ]
        for (const sel of strictSels) {
          try {
            const e = await page.$(sel)
            if (e && await e.isVisible().catch(() => false)) { editElementsFound = true; break }
          } catch (_) {}
        }
      }

      // 两个条件都满足 → 二次确认（防URL短暂跳变）
      if (urlChanged && editElementsFound) {
        log(`  [${elapsedSec}s] 首次检测到编辑页，二次确认中...`)
        await page.waitForTimeout(5000)
        // 二次验证：标题框真的可交互
        const titleBox = await page.$('div[contenteditable="true"][data-placeholder*="标题"]')
        if (titleBox && await titleBox.isVisible().catch(() => false)) {
          editPageDetected = true
          log(`✅ 视频上传+转码完成 (${elapsedSec}s)，已进入编辑页`)
          break
        } else {
          log(`  [${elapsedSec}s] 二次确认失败，继续等待...`)
        }
      }

      if (urlChanged && !editElementsFound && i < MIN_LOOPS) {
        log(`  [${elapsedSec}s] URL已变但未到最短等待时间(${MIN_UPLOAD_SEC}s)...`)
      }
      if (i % 10 === 9 && i >= MIN_LOOPS) {
        log(`  ...仍在等待 (${elapsedSec}s/${MAX_UPLOAD_SEC}s)`)
      }
    }

    if (!editPageDetected) {
      log(`⚠️ 等待超时 (${Math.round((Date.now()-uploadStartTime)/1000)}s)，尝试继续...`)
    }

    log('额外缓冲5秒...')
    await page.waitForTimeout(5000)
    await dismissPopups(page, log, '[上传后] ')

    // ════════════════════════════════════
    // 编辑页操作 — 每步间隔充足时间
    // ════════════════════════════════════

    // ── Step 4: 填写作品描述（标题+正文）──
    if (p.caption) {
      log('[步骤4] 填写作品描述')
      await page.waitForTimeout(2000)

      // 标题 (0/30) - 使用 contenteditable div
      const titleOk = await fillTitle(page, p.caption, log)
      if (!titleOk) log('  ❌ 标题未填入')
      await page.waitForTimeout(2000)

      // 正文 (0/1000) - 使用 contenteditable div 或 textarea
      const descOk = await fillDescription(page, p.caption, log)
      if (!descOk) log('  ❌ 正文未填入')

      log(`步骤4完成 → 标题:${titleOk?'OK':'失败'} 正文:${descOk?'OK':'失败'}`)
      await page.waitForTimeout(2000)
    } else { log('[步骤4] 跳过') }

    // ── Step 5: 话题 ──
    if (p.topics) {
      log('[步骤5] 添加话题: ' + p.topics)
      await page.waitForTimeout(1500)
      const topicList = p.topics.split(/[\s,，]+/).filter((t: string) => t.trim())
      let ok = 0

      for (let idx = 0; idx < topicList.length; idx++) {
        const ct = topicList[idx].startsWith('#') ? topicList[idx] : '#' + topicList[idx]
        log(`  [5.${idx+1}] ${ct}`)
        try {
          // 点 #添加话题 入口
          for (const tr of ['#添加话题', '添加话题']) {
            try {
              const tb = await page.$('text="' + tr + '"')
              if (tb && await tb.isVisible().catch(() => false)) {
                await tb.click()
                log('    已点话题入口')
                await page.waitForTimeout(1000); break
              }
            } catch (_) {}
          }
          // 找输入框
          let did = false
          const topicInputs = [
            'input[placeholder*="#"]', 'input[placeholder*="话题"]',
            '[class*="topic-input"] input', '[class*="TopicInput"] input',
            'div[contenteditable="true"][data-placeholder*="话题"]',
          ]
          for (const ti of topicInputs) {
            try {
              const te = await page.$(ti)
              if (te && await te.isVisible().catch(() => false)) {
                await te.click({ timeout: 2000 })
                if (ti.includes('contenteditable')) {
                  await te.evaluate((n: any) => { n.innerText = '' })
                  await page.keyboard.type(ct, { delay: 60 })
                } else {
                  await te.fill(ct.replace('#', ''))
                }
                await page.waitForTimeout(1200)
                // 点击下拉选项确认（关键！直接Enter可能不生效）
                let selected = false
                const optionSels = [
                  '[class*="option"]:not([style*="display:none"]) span',
                  '[class*="suggest"] span:not([style*="display:none"])',
                  '[class*="dropdown"] li span',
                  '[class*="topic-item"] span',
                  'text="' + ct + '" >> nth=0',
                ]
                for (const os of optionSels) {
                  try {
                    const opt = await page.$(os)
                    if (opt && await opt.isVisible().catch(() => false)) {
                      await opt.click({ timeout: 2000 }); selected = true; break
                    }
                  } catch (_) {}
                }
                if (!selected) { await page.keyboard.press('Enter'); log('    Enter兜底') }
                did = true; log(`    ✅ 输入:${ct}${selected?'(下拉选中)':''}`); break
              }
            } catch (_) {}
          }
          // 键盘兜底
          if (!did) {
            for (const c of ct) await page.keyboard.type(c, { delay: 80 })
            await page.waitForTimeout(800)
            await page.keyboard.press('Enter')
            log(`    ✅ 键盘:${ct}`); did = true
          }
          ok++; await page.waitForTimeout(1500)
        } catch (e: any) { log(`    ❌ ${ct}: ${e.message}`) }
      }
      log(`✅ 步骤5完成 (${ok}/${topicList.length})`)
      await page.waitForTimeout(1500)
    } else { log('[步骤5] 跳过') }

    // ── Step 6: 封面（竖3:4 + 横4:3）──
    log('[步骤6] 检查封面...')
    await page.waitForTimeout(1500)
    try {
      const covers: any[] = []
      for (const btn of await page.$$('button, div[role="button"]').catch(() => [])) {
        try { if ((await btn.innerText()).trim() === '选择封面') covers.push(btn) } catch (_) {}
      }
      log(`  找到 ${covers.length} 个选择封面按钮`)
      for (let i = 0; i < Math.min(covers.length, 2); i++) {
        const lab = i === 0 ? '竖封面(3:4)' : '横封面(4:3)'
        log(`  [6.${i+1}] 点击${lab}`)
        try {
          await covers[i].click({ timeout: 3000 })
          await page.waitForTimeout(2000)
          // 检查是否有默认选中的封面
          const selectedImg = await page.$('[class*="selected"] img, [class*="active"] img').catch(() => null)
          if (selectedImg) { log(`    有默认选中封面，跳过手动选择`) }
          else {
            // 没有默认选中 → 选第一张推荐图
            const imgs = await page.$$('[class*="recommend"] img, [class*="cover-list"] img, [class*="img-item"] img').catch(() => [])
            if (imgs.length) {
              await imgs[0].click({ timeout: 1500 }).catch(() => {})
              log(`    手动选择第1张封面`)
              await page.waitForTimeout(500)
            }
          }
          // 点确认按钮
          for (const cs of ['text=使用', 'text=确定', 'text=确认', 'text=保存']) {
            try {
              const cb = await page.$(cs)
              if (cb && await cb.isVisible().catch(() => false)) {
                await cb.click()
                log(`    ✅ 确认${lab}`)
                await page.waitForTimeout(1000); break
              }
            } catch (_) {}
          }
        } catch (e: any) { log(`    ⚠️ ${lab}: ${e.message}`) }
      }
      if (!covers.length) log('  ⚠️ 未找到封面按钮')
      log('✅ 步骤6完成')
    } catch (e: any) { log(`❌ 步骤6: ${e.message}`) }
    await page.waitForTimeout(2000)

    // ── Step 7: 发布 ──
    if (p.publishNow !== 'false') {
      log('[步骤7] 寻找发布按钮...')
      await page.waitForTimeout(2000)
      let pub = false

      try {
        const btns = await page.$$('button')
        const vis: Array<{t:string,n:number}> = []
        for (let i = 0; i < btns.length; i++) {
          try { const t = (await btns[i].innerText()).trim(); if (await btns[i].isVisible().catch(()=>false) && t) vis.push({t,n:i}) } catch(_) {}
        }
        log(`  可见按钮(${vis.length}): `); vis.forEach((b,i) => log(`    [${i}] "${b.t}"`))

        for (const b of vis) {
          if ((b.t === '发布' || b.t === '立即发布') && !b.t.includes('离开')) {
            await btns[b.n].click({ timeout: 5000 }); pub = true; log(`  ✅ 点击:"${b.t}"`); break
          }
        }
      } catch (e: any) { log(`  遍历异常: ${e.message}`) }

      if (!pub) { try { await page.click('button:has-text("发布")',{timeout:3000}); pub=true; log('  兜底成功') } catch(_){} }

      if (!pub) {
        log('❌ 未找到发布按钮！请手动点击')
        return { success: true, message: '内容已填完，请手动点「发布」', needConfirm: true }
      }

      log('等待发布响应(8s)...')
      await page.waitForTimeout(8000)

      const fu = page.url(), bt = await page.evaluate(()=>document.body.innerText).catch(()=>'')
      if (bt.includes('发布成功') || fu.includes('/manage')) { log('🎉 发布成功！'); return { success: true, message: '视频已发布到抖音' } }
      log('⚠️ 结果不确定，请确认')
      return { success: true, message: '已执行发布，请手动确认', needConfirm: true }
    } else {
      log('[步骤7] 草稿模式')
      return { success: true, message: '内容已填完，保存草稿', needConfirm: true }
    }

  } catch (e: any) {
    log(`❌ 出错: ${e.message}`)
    return { success: false, message: e.message }
  }
}

const template: FingerprintTemplate = { meta, params, execute }
export default template
