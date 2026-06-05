/**
 * 抖音视频发布模板（完整版）
 *
 * 功能：自动上传视频 + 填写文案 + 选择话题/封面 + 发布
 * 流程：导航创作者中心 → 上传视频 → 等待转码完成 → 填写文案 → 选话题 → 发布
 *
 * 参数：
 *   - videoPath: 视频文件绝对路径（必填）
 *   - caption: 发布文案/标题
 *   - topics: 话题标签，多个用空格分隔
 *   - publishNow: 是否立即发布（true=立即 / false=仅草稿）
 */

import { TemplateResult, LogFn, FingerprintTemplate, TemplateParamDef } from './types'

const meta = {
  key: 'douyin-publish',
  label: '📝 抖音发视频',
  description: '上传视频+填写文案+选择话题，自动发布',
  platforms: ['douyin'],
  version: '2.0.0',
}

const params: TemplateParamDef[] = [
  {
    key: 'videoPath',
    label: '视频文件路径',
    type: 'file',
    placeholder: '如 D:\\video\\test.mp4 或 /home/user/video/test.mp4',
    required: true,
  },
  {
    key: 'caption',
    label: '文案/标题',
    type: 'textarea',
    placeholder: '输入作品描述、标题、话题等...',
    required: false,
    defaultValue: '',
  },
  {
    key: 'topics',
    label: '话题标签',
    type: 'text',
    placeholder: '多个话题用空格分隔，如：#美食 #生活vlog',
    required: false,
  },
  {
    key: 'publishNow',
    label: '发布方式',
    type: 'select',
    options: [
      { label: '立即发布', value: 'true' },
      { label: '仅保存草稿', value: 'false' },
    ],
    defaultValue: 'true',
  },
]

async function execute(page: any, p: Record<string, any>, log: LogFn): Promise<TemplateResult> {
  const fs = require('fs')

  // ═══ 校验 ═══
  if (!p.videoPath) return { success: false, message: '请提供视频文件路径' }
  if (!fs.existsSync(p.videoPath)) return { success: false, message: `视频文件不存在: ${p.videoPath}` }

  try {
    // ── Step 1: 导航到抖音创作者中心视频上传页 ──
    const targetUrl = 'https://creator.douyin.com/creator-micro/content/upload'
    const currentUrl = page.url()
    log(`当前页面: ${currentUrl}`)
    
    // 强制导航到上传页面
    if (currentUrl !== targetUrl && !currentUrl.includes('/content/upload')) {
      log(`导航到视频上传页: ${targetUrl}`)
      await page.goto(targetUrl, { timeout: 30000, waitUntil: 'networkidle' })
      await page.waitForTimeout(5000)
      log(`已到达: ${page.url()}`)
    } else {
      log('当前已在视频上传页')
      await page.waitForTimeout(2000)
    }

    // ── Step 1.5: 处理可能出现的弹窗 ──
    for (const popupText of ['我知道了', '知道了', '确定', '关闭']) {
      try {
        const btn = await page.$(`text="${popupText}"`)
        if (btn && await btn.isVisible().catch(() => false)) {
          await btn.click({ timeout: 2000 })
          log(`已点击弹窗「${popupText}」`)
          await page.waitForTimeout(1000)
        }
      } catch (_) {}
    }

    // ── Step 2: 找到并上传视频 ──
    log(`准备上传视频: ${p.videoPath}`)
    
    let uploaded = false

    // 2a. 探测页面上所有 file input（包括隐藏的）
    let allFileInputs: any[] = []
    try {
      allFileInputs = await page.evaluate(() => {
        const inputs = document.querySelectorAll('input[type="file"]')
        return Array.from(inputs).map((el, i) => ({
          index: i,
          accept: el.getAttribute('accept'),
          id: el.id,
          className: el.className.substring(0, 80),
          parentTag: el.parentElement?.tagName,
          parentClass: el.parentElement?.className?.substring(0, 60),
        }))
      })
    } catch (e: any) {
      log(`探测 file input 出错: ${e.message}`)
    }
    
    log(`探测到 ${allFileInputs.length} 个 file input`)
    if (allFileInputs.length > 0) {
      log(JSON.stringify(allFileInputs))
    }
    
    if (allFileInputs.length > 0) {
      // 尝试直接设置文件（file input 经常是隐藏的，不检查可见性）
      for (let i = 0; i < allFileInputs.length; i++) {
        try {
          const els = await page.$$('input[type="file"]')
          if (els[i]) {
            await els[i].setInputFiles(p.videoPath)
            uploaded = true
            log('✅ 视频已通过 file input[' + i + '] 设置')
            break
          }
        } catch (e: any) {
          log(`  input[${i}] 失败: ${e.message}`)
        }
      }
    } else {
      log('未探测到 file input 元素')
    }

    // 2b. 兜底：通过点击上传区域触发 file chooser
    if (!uploaded) {
      log('尝试通过点击触发文件选择器...')
      
      const uploadTriggers = [
        'text=上传视频', 'text=上传', 'text=选择文件', 'text=拖拽',
        '[class*="upload-btn"]', '[class*="UploadBtn"]',
        '[class*="upload-area"]', '[class*="UploadArea"]',
        'div[role="button"]:has-text("上传")',
        '[class*="picker"]', '[class*="Picker"]',
        '[data-e2e="upload"]', '[data-e2e="pc-upload"]',
      ]

      for (const trigger of uploadTriggers) {
        try {
          const [fileChooser] = await Promise.all([
            page.waitForEvent('filechooser', { timeout: 3000 }).catch(() => null),
            page.click(trigger, { timeout: 2000 }).catch(() => {}),
          ])
          if (fileChooser) {
            await fileChooser.setFiles(p.videoPath)
            uploaded = true
            log('✅ 视频已通过文件选择器上传（触发器: ' + trigger + '）')
            break
          }
        } catch (_) {}
      }
    }

    // 2c. 最后兜底：page 级别 setInputFiles
    if (!uploaded) {
      try {
        await page.setInputFiles('input[type="file"]', p.videoPath)
        uploaded = true
        log('✅ 视频已通过 page.setInputFiles 上传')
      } catch (_) {}
    }

    if (!uploaded) {
      const debugInfo = await page.evaluate(() => ({
        url: location.href,
        title: document.title,
        bodySnippet: document.body.innerText.substring(0, 500),
      })).catch(() => ({ url: 'unknown' }))
      log(`调试信息: URL=${debugInfo.url}, 标题=${debugInfo.title}`)
      if (debugInfo.bodySnippet) {
        log(`页面文字: ${debugInfo.bodySnippet.substring(0, 200)}`)
      }
      return { success: false, message: '未找到可用的视频上传入口，请检查是否已在抖音发布页' }
    }

    // ── Step 3: 等待上传完成 ──
    log('等待视频上传中（大文件可能较慢）...')
    
    // 检测完成标志：文案输入框或发布按钮出现 = 上传完毕进入编辑页
    const doneSelectors = [
      'textarea[placeholder*="作品描述"]',
      'textarea[placeholder*="添加"]',
      'button:has-text("发布")',
      '[data-e2e="publish-textarea"]',
    ]
    
    for (let i = 0; i < 90; i++) { // 最多等 4.5 分钟
      await page.waitForTimeout(3000)
      
      // 先处理可能出现的弹窗
      for (const popupText of ['我知道了', '知道了', '确定', '关闭', '取消']) {
        try {
          const btn = await page.$(`text="${popupText}"`)
          if (btn && await btn.isVisible().catch(() => false)) {
            await btn.click({ timeout: 1000 })
            log(`上传过程中点击弹窗「${popupText}」`)
            await page.waitForTimeout(500)
          }
        } catch (_) {}
      }

      // 检测是否已进入编辑状态
      let done = false
      for (const sel of doneSelectors) {
        try {
          const el = await page.$(sel)
          if (el && await el.isVisible().catch(() => false)) {
            done = true
            break
          }
        } catch (_) {}
      }

      if (done) {
        log('✅ 视频上传完成，已进入编辑页面')
        break
      }

      if (i === 89) {
        log('⚠️ 等待超时，继续尝试后续步骤...')
      } else if (i % 10 === 9) {
        log(`   ... 已等待 ${(i+1)*3} 秒`)
      }
    }

    await page.waitForTimeout(2000)

    // 再处理一次弹窗（上传完成后可能又弹出）
    for (const popupText of ['我知道了', '知道了', '确定', '关闭']) {
      try {
        const btn = await page.$(`text="${popupText}"`)
        if (btn && await btn.isVisible().catch(() => false)) {
          await btn.click({ timeout: 2000 })
          log(`上传后点击弹窗「${popupText}」`)
          await page.waitForTimeout(1000)
        }
      } catch (_) {}
    }

    // ── Step 4: 填写文案 ──
    if (p.caption) {
      log(`填写文案 (${p.caption.length}字)...`)
      
      const captionSelectors = [
        'textarea[placeholder*="添加作品描述"]',
        'textarea[placeholder*="描述你的作品"]',
        'textarea[placeholder*="添加"]',
        '[class*="caption"] textarea',
        '[class*="description"] textarea',
        '[data-e2e="publish-textarea"] textarea',
        'textarea',
      ]

      for (const sel of captionSelectors) {
        try {
          const input = await page.$(sel)
          if (input && await input.isVisible().catch(() => false)) {
            await input.click({ timeout: 2000 })
            await page.waitForTimeout(300)
            await input.fill(p.caption)
            log('✅ 文案已填写')
            break
          }
        } catch (_) {}
      }
    }

    // ── Step 5: 添加话题 ──
    if (p.topics) {
      log(`添加话题: ${p.topics}`)
      const topicList = p.topics.split(/[\s,，]+/).filter((t: string) => t.trim())
      
      for (const topic of topicList) {
        const cleanTopic = topic.startsWith('#') ? topic : '#' + topic
        
        // 在文案框末尾追加话题
        const descInput = await page.$('textarea').catch(() => null)
        if (descInput) {
          await descInput.focus().catch(() => {})
          await page.keyboard.press('End')
          await page.waitForTimeout(100)
          
          // 输入话题
          for (const char of cleanTopic + ' ') {
            await page.keyboard.type(char, { delay: 30 })
          }
          await page.waitForTimeout(800)
        }

        // 等待话题下拉建议出现并回车选中
        await page.waitForTimeout(600)
        
        // 尝试点击第一个话题建议
        const topicSuggestionSel = [
          '[class*="topic-suggest"] li:first-child',
          '[class*="topic-item"]:first-child',
          '.topic-list .item:first-child',
        ]
        for (const sel of topicSuggestionSel) {
          try {
            const item = await page.$(sel)
            if (item && await item.isVisible().catch(() => false)) {
              await item.click()
              break
            }
          } catch (_) {}
        }

        await page.waitForTimeout(500)
      }
      log(`✅ 话题已添加 (${topicList.length}个)`)
    }

    // ── Step 6: 发布或保存 ──
    const shouldPublish = p.publishNow !== 'false'

    if (shouldPublish) {
      log('点击「发布」按钮...')
      
      const publishBtnSels = [
        'button:has-text("发布")',
        'button:has-text("立即发布")',
        '[class*="publish-btn"] button',
        '[class*="submit"] button',
        '[data-testid="publish-submit"]',
        'button.publish-btn',
      ]

      let published = false
      for (const sel of publishBtnSels) {
        try {
          const btn = await page.$(sel)
          if (btn && await btn.isVisible().catch(() => false)) {
            await btn.click({ timeout: 3000 })
            published = true
            log('✅ 已点击发布按钮')
            break
          }
        } catch (_) {}
      }

      if (!published) {
        log('⚠️ 未找到发布按钮，请手动点击发布')
        return { success: true, message: '内容已填写完成，请手动点击「发布」按钮', needConfirm: true }
      }

      // 等待发布结果
      await page.waitForTimeout(3000)

      // 检查是否发布成功（通常会有成功提示或跳转到管理页）
      const finalUrl = page.url()
      const bodyText = await page.evaluate(() => document.body.innerText).catch(() => '')
      
      if (bodyText.includes('发布成功') || bodyText.includes('提交成功') || 
          !finalUrl.includes('/publish')) {
        log('🎉 视频发布成功！')
        return { success: true, message: '视频已成功发布到抖音' }
      }

      log('⚠️ 请确认发布结果')
      return { success: true, message: '已执行发布操作，请在页面确认结果', needConfirm: true }
    } else {
      log('保存为草稿模式，跳过发布步骤')
      return { success: true, message: '内容已填写完成，保存为草稿状态', needConfirm: true }
    }

  } catch (e: any) {
    log(`❌ 执行出错: ${e.message}`)
    return { success: false, message: e.message }
  }
}

const template: FingerprintTemplate = { meta, params, execute }
export default template
