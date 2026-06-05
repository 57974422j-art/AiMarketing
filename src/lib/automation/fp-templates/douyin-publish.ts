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

    // ── Step 4: 填写作品描述（标题+正文）──
    if (p.caption) {
      log(`填写作品描述: "${p.caption}"`)
      
      // 抖音发布页的文案输入区域结构：
      // 标题输入：placeholder 含 "标题"，0/30 限制
      // 正文输入：placeholder 含 "简介" 或 "描述"，0/1000 限制
      
      // 4a. 填标题（第一个输入框，0/30）
      const titleSelectors = [
        'input[placeholder*="填写作品标题"]',
        'input[placeholder*="作品标题"]',
        'input[maxlength="30"]',
        '[class*="title"] input',
        '[class*="input-title"] input',
        '[class*="TitleInput"] input',
      ]
      let titleFilled = false
      for (const sel of titleSelectors) {
        try {
          const el = await page.$(sel)
          if (el && await el.isVisible().catch(() => false)) {
            await el.click({ timeout: 2000 })
            await page.waitForTimeout(500)
            // 标题取 caption 前30字
            const titleText = p.caption.substring(0, 30)
            await el.fill(titleText)
            log(`✅ 标题已填: ${titleText}`)
            titleFilled = true
            break
          }
        } catch (_) {}
      }
      
      // 如果没找到独立标题框，尝试用通用文案区
      if (!titleFilled) {
        log('未找到独立标题框，尝试通用文案区...')
      }
      
      await page.waitForTimeout(800)

      // 4b. 填正文/描述（第二个输入框或大文本区，0/1000）
      const descSelectors = [
        'textarea[placeholder*="添加作品简介"]',
        'textarea[placeholder*="作品简介"]',
        'textarea[placeholder*="简介"]',
        'div[contenteditable="true"]', // 抖音可能用 contenteditable
        '[class*="desc"] textarea',
        '[class*="description"] textarea',
        '[class*="content"] textarea',
        'textarea',
      ]
      
      for (const sel of descSelectors) {
        try {
          const els = await page.$$(sel)
          for (const el of els) {
            if (await el.isVisible().catch(() => false)) {
              await el.click({ timeout: 2000 })
              await page.waitForTimeout(500)
              
              // 清空后填入
              if (sel.includes('contenteditable')) {
                await el.evaluate((node: any) => node.innerText = '')
                await page.keyboard.type(p.caption, { delay: 20 })
              } else {
                await el.fill(p.caption)
              }
              log(`✅ 作品描述已填 (${p.caption.length}字)`)
              break
            }
          }
          // 如果已经填了就跳出外层循环
          break
        } catch (_) {}
      }

      await page.waitForTimeout(1000)
    }

    // ── Step 5: 添加话题 ──
    if (p.topics) {
      log(`添加话题: ${p.topics}`)
      const topicList = p.topics.split(/[\s,，]+/).filter((t: string) => t.trim())
      
      // 方式1：通过 #添加话题 按钮/链接触发话题输入
      const topicTriggerSels = [
        'text=#添加话题',
        'text=添加话题',
        '[class*="topic-add"]',
        '[class*="TopicAdd"]',
        '[class*="hash-tag"]',
      ]

      for (const topic of topicList) {
        const cleanTopic = topic.startsWith('#') ? topic : '#' + topic
        
        // 先尝试点击 #添加话题 触发话题输入
        let topicInputFound = false
        for (const trigger of topicTriggerSels) {
          try {
            const btn = await page.$(trigger)
            if (btn && await btn.isVisible().catch(() => false)) {
              await btn.click()
              await page.waitForTimeout(500)
              topicInputFound = true
              log(`已点击话题入口`)
              break
            }
          } catch (_) {}
        }
        
        // 输入话题文字
        if (topicInputFound || true) {
          // 在话题输入框中输入（通常点击 #添加话题 后会出现输入框）
          // 也可能是直接在正文后追加
          
          // 方式A：找页面上的话题专用输入框
          const topicInputSels = [
            'input[placeholder*="#"]',
            'input[placeholder*="话题"]',
            '[class*="topic-input"] input',
            '[class*="TopicInput"] input',
          ]
          
          let typedInTopicBox = false
          for (const sel of topicInputSels) {
            try {
              const ti = await page.$(sel)
              if (ti && await ti.isVisible().catch(() => false)) {
                await ti.click()
                await ti.fill(cleanTopic)
                typedInTopicBox = true
                // 回车确认
                await page.keyboard.press('Enter')
                await page.waitForTimeout(600)
                break
              }
            } catch (_) {}
          }
          
          // 方式B：如果找不到专用输入框，在文案区追加
          if (!typedInTopicBox) {
            // 在最后一个可见的 textarea/contenteditable 追加
            const lastArea = await page.$$eval('textarea, [contenteditable="true"]', 
              (els: any[]) => {
                for (let i = els.length - 1; i >= 0; i--) {
                  if (els[i].offsetParent !== null) return els[i]
                }
                return null
              }
            ).catch(() => null)
            
            if (lastArea) {
              await lastArea.focus().catch(() => {})
              await page.keyboard.press('End')
              await page.waitForTimeout(200)
              for (const char of cleanTopic + ' ') {
                await page.keyboard.type(char, { delay: 30 })
              }
              await page.waitForTimeout(800)
            }
          }
        }

        await page.waitForTimeout(500)
      }
      log(`✅ 话题处理完成 (${topicList.length}个)`)
    }

    // ── Step 6: 确认封面（竖版+横版）──
    log('检查封面设置...')
    
    // 封面区域有两个选择按钮：竖封面3:4 和 横封面4:3
    // 通常系统会自动推荐封面，我们只需点击"选择封面"确认
    const coverButtons = [
      { label: '竖封面3:4', sels: [
        'text=选择封面', // 第一个出现的是竖封面
      ]},
      { label: '横封面4:3', sels: [] }, // 第二个选择封面是横封面
    ]
    
    // 找所有"选择封面"按钮并依次点击确认
    const allCoverBtns = await page.$$(':text("选择封面")').catch(() => [])
    log(`找到 ${allCoverBtns.length} 个「选择封面」按钮`)

    if (allCoverBtns.length >= 2) {
      // 有两个封面按钮：竖版 + 横版
      for (let i = 0; i < Math.min(allCoverBtns.length, 2); i++) {
        try {
          const btn = allCoverBtns[i]
          if (await btn.isVisible().catch(() => false)) {
            await btn.click({ timeout: 2000 })
            log(`✅ 已点击${i === 0 ? '竖' : '横'}封面「选择封面」`)
            await page.waitForTimeout(1000)
            
            // 如果弹出封面选择弹窗，选第一个推荐封面
            const recommendCover = await page.$('[class*="recommend"]').catch(() => null)
            if (recommendCover && await recommendCover.isVisible().catch(() => false)) {
              const firstItem = await recommendCover.$('[class*="item"], img, [class*="cover"]')
              if (firstItem) {
                await firstItem.click({ timeout: 1500 }).catch(() => {})
                await page.waitForTimeout(500)
                
                // 点确定/使用按钮
                for (const confirmText of ['使用', '确定', '确认']) {
                  try {
                    const cbtn = await page.$(`text="${confirmText}"`)
                    if (cbtn && await cbtn.isVisible().catch(() => false)) {
                      await cbtn.click()
                      log(`  已确认选择封面`)
                      await page.waitForTimeout(500)
                      break
                    }
                  } catch (_) {}
                }
              }
            }
          }
        } catch (e: any) {
          log(`  封面[${i}] 处理异常: ${e.message}`)
        }
      }
    } else if (allCoverBtns.length === 1) {
      // 只有一个封面按钮，直接点
      try {
        await allCoverBtns[0].click({ timeout: 2000 })
        log(`✅ 已点击「选择封面」`)
        await page.waitForTimeout(1000)
      } catch (_) {}
    } else {
      log('⚠️ 未找到封面选择按钮，跳过')
    }

    await page.waitForTimeout(1000)

    // ── Step 7: 点击发布 ──
    const shouldPublish = p.publishNow !== 'false'

    if (shouldPublish) {
      log('寻找「发布」按钮...')
      
      // 关键：抖音编辑页底部有多个按钮，必须精确定位到"发布"
      // 排除 "展示离开"、"保存草稿" 等干扰按钮
      const publishBtnSels = [
        // 最精确的：底部固定栏的发布按钮
        'button[data-e2e="publish-btn"]',
        '[class*="publish-bar"] button:has-text("发布")',
        '[class*="PublishBar"] button:has-text("发布")',
        '[class*="bottom-bar"] button:has-text("发布")',
        '[class*="footer-bar"] button:has-text("发布")",
        // 通用但排除干扰
        'button:has-text("立即发布")',
        // 最后兜底：所有含"发布"文字的按钮，但要验证不是"展示离开"
      ]

      let published = false
      
      // 方法1：用精确选择器
      for (const sel of publishBtnSels) {
        try {
          const btn = await page.$(sel)
          if (btn && await btn.isVisible().catch(() => false)) {
            const text = await btn.innerText().catch(() => '')
            // 排除包含"离开"、"取消"的按钮
            if (text.includes('离开') || text.includes('取消')) continue
            
            await btn.click({ timeout: 3000 })
            published = true
            log(`✅ 已点击发布按钮 (${text.trim()})`)
            break
          }
        } catch (_) {}
      }
      
      // 方法2：遍历所有按钮找"发布"
      if (!published) {
        log('精确选择器未命中，遍历所有按钮...')
        const allBtns = await page.$$eval('button', 
          (btns: any[]) => btns.map(b => ({ text: b.innerText?.trim(), visible: b.offsetParent !== null }))
        ).catch(() => [])
        
        log(`页面上共 ${allBtns.length} 个按钮: ${JSON.stringify(allBtns.filter(b => b.visible).map(b => b.text))}`)
        
        for (const btnInfo of allBtns) {
          if (!btnInfo.visible) continue
          const txt = btnInfo.text
          // 匹配纯"发布"或"立即发布"，排除其他
          if ((txt === '发布' || txt === '立即发布') && !txt.includes('离开')) {
            try {
              await page.click(`button:has-text("${txt}")`, { timeout: 3000 })
              published = true
              log(`✅ 已点击发布按钮 [${txt}]`)
              break
            } catch (_) {}
          }
        }
      }

      if (!published) {
        log('⚠️ 未找到发布按钮，请手动点击发布')
        return { success: true, message: '内容已填写完成，请手动点击「发布」按钮', needConfirm: true }
      }

      // 等待发布结果
      log('等待发布响应...')
      await page.waitForTimeout(5000)

      // 检查是否发布成功
      const finalUrl = page.url()
      const bodyText = await page.evaluate(() => document.body.innerText).catch(() => '')
      
      if (bodyText.includes('发布成功') || bodyText.includes('提交成功') || 
          finalUrl.includes('/manage') || finalUrl.includes('/content/manage')) {
        log('🎉 视频发布成功！')
        return { success: true, message: '视频已成功发布到抖音' }
      }

      log('请确认发布结果')
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
