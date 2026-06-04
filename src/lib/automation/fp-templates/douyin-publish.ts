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
    // ── Step 1: 导航到创作者中心发布页 ──
    const currentUrl = page.url()
    if (!currentUrl.includes('creator.douyin.com')) {
      log('导航到抖音创作者中心...')
      await page.goto('https://creator.douyin.com/publish/video/', { timeout: 30000 })
      await page.waitForTimeout(4000)
    } else {
      log('当前已在创作者中心')
    }

    // ── Step 2: 找到并上传视频 ──
    log(`准备上传视频: ${p.videoPath}`)
    
    // 尝试找到文件上传 input
    let uploaded = false
    const fileInputSels = [
      'input[type="file"][accept*="video"]',
      'input[type="file"]',
      '[class*="upload"] input[type="file"]',
      '#upload-input',
    ]

    for (const sel of fileInputSels) {
      try {
        const el = await page.$(sel)
        if (el && await el.isVisible().catch(() => false)) {
          await el.setInputFiles(p.videoPath)
          uploaded = true
          log('✅ 视频已选择，等待上传...')
          break
        }
      } catch (_) {}
    }

    if (!uploaded) {
      // 兜底方案：通过 file chooser 监听
      log('未直接找到上传按钮，尝试触发文件选择器...')
      const [fileChooser] = await Promise.all([
        page.waitForEvent('filechooser', { timeout: 5000 }).catch(() => null),
        page.click('text=上传').catch(() =>
          page.click('[class*="upload"]').catch(() =>
            page.click('.upload-btn').catch(() => {})
          )
        ),
      ])
      if (fileChooser) {
        await fileChooser.setFiles(p.videoPath)
        uploaded = true
        log('✅ 视频已通过文件选择器上传')
      }
    }

    if (!uploaded) {
      return { success: false, message: '未找到可用的视频上传入口，可能页面结构已变化' }
    }

    // ── Step 3: 等待上传完成 ──
    log('等待视频上传中（大文件可能较慢）...')
    
    // 等待上传进度条消失或出现"上传成功"
    for (let i = 0; i < 60; i++) {
      await page.waitForTimeout(3000)
      
      // 检查是否还在上传中
      const uploadingTexts = ['上传中', '正在处理', '转码中']
      const stillUploading = await page.evaluate(() => document.body.innerText).then((text: string) => {
        return uploadingTexts.some(kw => text.includes(kw))
      }).catch(() => true)

      if (!stillUploading || i >= 59) {
        log('✅ 视频' + (i >= 59 ? '上传超时（继续尝试后续步骤）' : '上传完成'))
        break
      }

      if (i % 5 === 0) log(`   ... 已等待 ${(i+1)*3} 秒`)
    }

    await page.waitForTimeout(2000)

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
