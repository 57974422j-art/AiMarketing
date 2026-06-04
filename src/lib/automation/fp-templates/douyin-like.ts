/**
 * 抖音点赞模板
 *
 * 功能：批量点赞抖音视频
 * 模式：
 *   - 有 targetUrls 时：逐个打开指定视频链接并点赞
 *   - 无 URL 时：在当前页面滚动浏览 + 自动点赞
 *
 * 参数：
 *   - targetUrls: 目标视频URL数组（可选）
 *   - count: 点赞次数（默认3，最多20）
 */

import { TemplateResult, LogFn, FingerprintTemplate, TemplateParamDef } from './types'

const meta = {
  key: 'douyin-like',
  label: '👍 抖音点赞',
  description: '批量点赞指定视频或当前页滚动点赞',
  platforms: ['douyin'],
  version: '1.0.0',
}

const params: TemplateParamDef[] = [
  {
    key: 'targetUrls',
    label: '目标视频URL',
    type: 'text',
    placeholder: '多个URL用逗号分隔，留空则在当前页面滚动点赞',
    required: false,
  },
  {
    key: 'count',
    label: '点赞次数',
    type: 'number',
    defaultValue: 3,
    min: 1,
    max: 20,
  },
]

async function execute(page: any, p: Record<string, any>, log: LogFn): Promise<TemplateResult> {
  try {
    const count = Math.min(Number(p.count) || 3, 20)
    const urls: string[] = []
    if (p.targetUrls) {
      const raw = typeof p.targetUrls === 'string' ? p.targetUrls : String(p.targetUrls)
      urls.push(...raw.split(',').map((s: string) => s.trim()).filter((s: string) => s))
    }

    let liked = 0

    if (urls.length > 0) {
      // 模式A：逐个打开指定视频点赞
      log(`模式A: 打开 ${Math.min(urls.length, count)} 个目标视频...`)
      for (let i = 0; i < Math.min(urls.length, count); i++) {
        log(`[${i + 1}/${Math.min(urls.length, count)}] ${urls[i]}`)
        await page.goto(urls[i], { timeout: 20000 }).catch(() => {})
        await page.waitForTimeout(3000)

        const didLike = await tryClickLike(page, log)
        if (didLike) liked++
        await page.waitForTimeout(1000)
      }
    } else {
      // 模式B：当前页面滚动+点赞
      log(`模式B: 当前页面滚动点赞 (${count}次)...`)
      for (let i = 0; i < count; i++) {
        await page.mouse.wheel(0, 600).catch(() => {})
        await page.waitForTimeout(2000)

        // 尝试找到未激活的点赞按钮
        try {
          const likeBtn = await page.$('[class*="like"]:not([class*="active"]):not([class*="liked"])')
          if (likeBtn && await likeBtn.isVisible().catch(() => false)) {
            await likeBtn.click()
            liked++
            log(`滚动点赞 #${i + 1} ✅`)
          }
        } catch (_) {}
      }
    }

    return { success: true, message: `完成 ${liked}/${count} 次点赞操作` }

  } catch (e: any) {
    log(`❌ 出错: ${e.message}`)
    return { success: false, message: e.message }
  }
}

/** 尝试点赞 */
async function tryClickLike(page: any, log: LogFn): Promise<boolean> {
  const selectors = [
    '[data-e2e="video-like-icon"]',
    '[class*="like"] span',
    'svg[class*="like"]:not([class*="active"])',
    'button[aria-label*="赞"]',
    'button[aria-label*="like" i]',
  ]
  for (const sel of selectors) {
    try {
      const el = await page.$(sel)
      if (el && await el.isVisible().catch(() => false)) {
        await el.click({ timeout: 2000 })
        log('已点赞 ✅')
        return true
      }
    } catch (_) {}
  }
  return false
}

const template: FingerprintTemplate = { meta, params, execute }
export default template
