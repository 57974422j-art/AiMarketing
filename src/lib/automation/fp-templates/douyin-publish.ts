/**
 * 抖音发帖模板
 *
 * 功能：在抖音创作者中心自动填写发布内容
 * 流程：导航 → 点击发布按钮 → 填写文案 → 上传媒体（可选）→ 等待用户确认发布
 *
 * 参数：
 *   - caption: 发布文案/标题
 *   - images: 本地图片路径数组
 *   - videoPath: 本地视频文件路径
 */

import { TemplateResult, LogFn, FingerprintTemplate } from './types'

const meta = {
  key: 'douyin-publish',
  label: '📝 抖音发帖',
  description: '填写文案+上传媒体，手动确认发布',
  platforms: ['douyin'],
  version: '1.0.0',
}

const params = [
  {
    key: 'caption',
    label: '发布文案',
    type: 'textarea',
    placeholder: '输入作品描述、标题等...',
    required: false,
    defaultValue: '',
  },
  {
    key: 'images',
    label: '图片路径',
    type: 'file',
    placeholder: '本地图片路径，多张用逗号分隔',
    required: false,
  },
  {
    key: 'videoPath',
    label: '视频路径',
    type: 'file',
    placeholder: '本地视频文件路径',
    required: false,
  },
]

async function execute(page: any, p: Record<string, any>, log: LogFn): Promise<TemplateResult> {
  const fs = require('fs')

  try {
    // 1. 确保在创作者中心
    let url = page.url()
    if (!url.includes('creator.douyin.com')) {
      log('导航到抖音创作者中心...')
      await page.goto('https://creator.douyin.com/creator-micro/content/publish', { timeout: 30000 })
      await page.waitForTimeout(3000)
    }

    // 2. 寻找并点击发布入口
    log('寻找发布按钮...')
    const publishSelectors = ['text=发布', '[class*="publish"]', 'button:has-text("发布")', 'div[class*="publishBtn"]']
    let clicked = false

    for (const sel of publishSelectors) {
      try {
        const el = await page.$(sel)
        if (el && await el.isVisible().catch(() => false)) {
          await el.click({ timeout: 3000 })
          clicked = true
          log(`已点击: ${sel}`)
          break
        }
      } catch (_) {}
    }

    if (!clicked) {
      log('直接访问上传页面...')
      await page.goto('https://creator.douyin.com/publish/content/', { timeout: 20000 }).catch(() => {})
      await page.waitForTimeout(3000)
    }

    // 3. 填写文案
    if (p.caption) {
      log(`填写文案 (${p.caption.length}字)...`)
      const inputSels = [
        'textarea[placeholder*="添加作品描述"]',
        'textarea[placeholder*="作品描述"]',
        'textarea',
        '[contenteditable="true"]',
      ]
      for (const sel of inputSels) {
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

    // 4. 上传媒体文件
    const allMediaFiles: string[] = []
    if (p.images) {
      const imgs = typeof p.images === 'string' ? p.images.split(',').map((s: string) => s.trim()) : p.images
      allMediaFiles.push(...imgs.filter((f: string) => f))
    }
    if (p.videoPath) allMediaFiles.push(p.videoPath)

    if (allMediaFiles.length > 0) {
      log(`准备上传 ${allMediaFiles.length} 个文件...`)
      const existingFiles = allMediaFiles.filter(f => fs.existsSync(f))

      if (existingFiles.length > 0) {
        const fileInputs = await page.$$('input[type="file"]').catch(() => [])
        if (fileInputs.length > 0) {
          await fileInputs[0].setInputFiles(existingFiles).catch(() => {})
          log(`✅ 已选择 ${existingFiles.length} 个文件，等待上传...`)
          await page.waitForTimeout(5000)
        } else {
          log('⚠️ 未找到文件上传元素')
        }
      } else {
        log('⚠️ 指定的媒体文件不存在于本地')
      }
    }

    return { success: true, message: '抖音发帖内容已填写完成，请手动检查后点击发布', needConfirm: true }

  } catch (e: any) {
    log(`❌ 执行出错: ${e.message}`)
    return { success: false, message: e.message }
  }
}

const template: FingerprintTemplate = { meta, params, execute }
export default template
