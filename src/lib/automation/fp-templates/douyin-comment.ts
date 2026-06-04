/**
 * 抖音评论模板
 *
 * 功能：在指定抖音视频下自动发表评论
 * 流程：打开目标视频 → 找评论框 → 输入内容 → 点击发送
 *
 * 参数：
 *   - comment: 评论文字（必填）
 *   - targetUrl: 目标视频URL（可选，不填则在当前页面操作）
 */

import { TemplateResult, LogFn, FingerprintTemplate } from './types'

const meta = {
  key: 'douyin-comment',
  label: '💬 抖音评论',
  description: '在目标视频下发表评论',
  platforms: ['douyin'],
  version: '1.0.0',
}

const params = [
  {
    key: 'comment',
    label: '评论内容',
    type: 'textarea',
    placeholder: '输入要发表的评论...',
    required: true,
    defaultValue: '',
  },
  {
    key: 'targetUrl',
    label: '目标视频URL',
    type: 'url',
    placeholder: '留空则在当前浏览器页面操作',
    required: false,
  },
]

async function execute(page: any, p: Record<string, any>, log: LogFn): Promise<TemplateResult> {
  try {
    if (!p.comment || !p.comment.trim()) throw new Error('评论内容不能为空')

    // 导航到目标页面
    if (p.targetUrl && p.targetUrl.trim()) {
      log(`打开目标: ${p.targetUrl}`)
      await page.goto(p.targetUrl, { timeout: 20000 })
      await page.waitForTimeout(3000)
    }

    // 查找评论输入框
    const commentSels = [
      'textarea[placeholder*="评论"]',
      'textarea[placeholder*="说点什么"]',
      'input[placeholder*="评论"]',
      '[class*="comment-input"] textarea',
      '[class*="CommentInput"] textarea',
      '[data-e2e="comment-input"]',
    ]

    let commented = false
    for (const sel of commentSels) {
      try {
        const el = await page.$(sel)
        if (el && await el.isVisible().catch(() => false)) {
          await el.click({ timeout: 2000 })
          await page.waitForTimeout(300)
          await el.fill(p.comment)

          // 寻找发送按钮
          await page.waitForTimeout(500)
          const sendSels = ['text=发送', 'button:has-text("发送")', '[class*="send"]', '[class*="submit"]']
          for (const ss of sendSels) {
            try {
              const sendBtn = await page.$(ss)
              if (sendBtn && await sendBtn.isVisible().catch(() => false)) {
                await sendBtn.click()
                commented = true
                break
              }
            } catch (_) {}
          }

          if (commented) {
            log('✅ 评论已发送')
            break
          }
        }
      } catch (_) {}
    }

    return {
      success: commented,
      message: commented ? '评论已成功发送' : '未找到评论框，可能需要手动定位或页面结构已变化',
    }

  } catch (e: any) {
    log(`❌ 出错: ${e.message}`)
    return { success: false, message: e.message }
  }
}

const template: FingerprintTemplate = { meta, params, execute }
export default template
