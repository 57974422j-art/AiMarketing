/**
 * 小红书发帖模板
 *
 * 功能：在小红书创作服务平台填写发布内容
 * 流程：导航到发布页 → 填写文案 → 等待用户确认发布
 *
 * 参数：
 *   - caption: 笔记标题+正文内容
 */

import { TemplateResult, LogFn, FingerprintTemplate, TemplateParamDef } from './types'

const meta = {
  key: 'xiaohongshu-publish',
  label: '📝 小红书发帖',
  description: '填写小红书笔记内容，手动确认发布',
  platforms: ['xiaohongshu'],
  version: '1.0.0',
}

const params: TemplateParamDef[] = [
  {
    key: 'caption',
    label: '笔记内容',
    type: 'textarea',
    placeholder: '输入小红书笔记的标题和正文...',
    required: false,
    defaultValue: '',
  },
]

async function execute(page: any, p: Record<string, any>, log: LogFn): Promise<TemplateResult> {
  try {
    const url = page.url()
    if (!url.includes('creator.xiaohongshu.com') && !url.includes('xhslink')) {
      log('导航到小红书创作平台...')
      await page.goto('https://creator.xiaohongshu.com/publish/publish', { timeout: 30000 })
      await page.waitForTimeout(3000)
    }

    // 填写内容
    if (p.caption) {
      log('填写笔记内容...')
      const inputSels = ['textarea', '[contenteditable="true"]', '[class*="editor"]']
      for (const sel of inputSels) {
        try {
          const input = await page.$(sel)
          if (input && await input.isVisible().catch(() => false)) {
            await input.click({ timeout: 2000 })
            await page.waitForTimeout(300)
            // 小红书编辑器可能不支持 fill，尝试 type
            try {
              await input.fill(p.caption)
            } catch (_) {
              // fallback: click + keyboard
              await input.click()
              for (const char of p.caption.split('')) {
                await page.keyboard.type(char, { delay: 20 })
              }
            }
            log('✅ 内容已填写')
            break
          }
        } catch (_) {}
      }
    }

    return { success: true, message: '小红书发帖内容已填写完成，请手动确认发布', needConfirm: true }

  } catch (e: any) {
    log(`❌ 出错: ${e.message}`)
    return { success: false, message: e.message }
  }
}

const template: FingerprintTemplate = { meta, params, execute }
export default template
