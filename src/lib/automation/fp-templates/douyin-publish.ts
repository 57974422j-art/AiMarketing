/**
 * 抖音视频发布模板 v3
 *
 * 功能：自动上传视频 + 填写文案 + 话题 + 封面确认 + 发布
 * 流程：/content/upload → 上传视频 → 等转码 → /content/publish编辑 → 填写→发布
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
  description: '上传视频+填写文案+话题+封面+发布',
  platforms: ['douyin'],
  version: '3.0.0',
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
    log('等待视频上传+转码...')
    const doneSels = [
      'textarea[placeholder*="作品描述"]', 'textarea[placeholder*="添加"]',
      'button:has-text("发布")', '[data-e2e="publish-textarea"]',
    ]

    for (let i = 0; i < 90; i++) {
      await page.waitForTimeout(3000)

      // 循环内也处理弹窗
      for (const pt of ['我知道了','知道了','确定','关闭','取消']) {
        try {
          const pb = await page.$(`text="${pt}"`)
          if (pb && await pb.isVisible().catch(() => false)) {
            await pb.click({ timeout: 1000 }); log(`弹窗:${pt}`); await page.waitForTimeout(500)
          }
        } catch (_) {}
      }

      let done = false
      for (const sel of doneSels) {
        try {
          const e = await page.$(sel)
          if (e && await e.isVisible().catch(() => false)) { done = true; break }
        } catch (_) {}
      }
      if (done) { log('✅ 已进入编辑页'); break }
      if (i % 10 === 9) log(`   ...等${(i+1)*3}s`)
    }

    await page.waitForTimeout(2000)

    // 再处理一次弹窗
    for (const pt of ['我知道了','知道了','确定','关闭']) {
      try {
        const pb = await page.$(`text="${pt}"`)
        if (pb && await pb.isVisible().catch(() => false)) {
          await pb.click({ timeout: 2000 }); log(`上传后弹窗:${pt}`); await page.waitForTimeout(1000)
        }
      } catch (_) {}
    }

    // ════════════════════════════════════
    // 编辑页操作 — 每步间隔充足时间
    // ════════════════════════════════════

    // ── Step 4: 填写作品描述（标题+正文）──
    if (p.caption) {
      log('[步骤4] 填写作品描述')
      await page.waitForTimeout(2000)

      // 标题 (0/30)
      let titleFilled = false
      for (const sel of [
        'input[placeholder*="填写作品标题"]','input[placeholder*="作品标题"]',
        'input[maxlength="30"]','[class*="title"] input','[class*="TitleInput"] input',
      ]) {
        try {
          const el = await page.$(sel)
          if (!el || !(await el.isVisible().catch(() => false))) continue
          log(`  [4a] 找到标题框: ${sel}`)
          await el.click({ timeout: 3000 })
          await page.waitForTimeout(1000)
          const t = p.caption.substring(0, 30)
          await el.fill(t)
          await page.waitForTimeout(500)
          const v = await el.inputValue().catch(() => '')
          if (v.length > 0) { log(`  ✅ 标题:"${v}"`); titleFilled = true; break }
          else log(`  ⚠️ 验证为空`)
        } catch (e: any) { log(`  ⚠️ ${sel}: ${e.message}`) }
      }
      if (!titleFilled) log('  ❌ 标题未找到')
      await page.waitForTimeout(2000)

      // 正文 (0/1000)
      let descFilled = false
      for (const sel of [
        'textarea[placeholder*="添加作品简介"]','textarea[placeholder*="作品简介"]',
        'textarea[placeholder*="简介"]','div[contenteditable="true"]','textarea',
      ]) {
        try {
          const els = await page.$$(sel)
          for (const el of els) {
            if (!(await el.isVisible().catch(() => false))) continue
            log(`  [4b] 找到正文框: ${sel}`)
            await el.click({ timeout: 3000 })
            await page.waitForTimeout(1000)
            if (sel.includes('contenteditable')) {
              await el.evaluate((n: any) => { n.innerText=''; n.focus() })
              for (const ch of p.caption) await page.keyboard.type(ch, { delay: 50 })
            } else {
              await el.fill(p.caption)
            }
            await page.waitForTimeout(500)
            const v = await el.evaluate((n: any) => n.value || n.innerText).catch(() => '')
            if (v.length > 0) {
              log(`  ✅ 正文(${v.length}字): "${v.substring(0,50)}..."`)
              descFilled = true; break
            } else log(`  ⚠️ 内容为空`)
          }
          if (descFilled) break
        } catch (e: any) { log(`  ⚠️ ${sel}: ${e.message}`) }
      }

      log(`步骤4完成 → 标题:${titleFilled?'OK':'跳过'} 正文:${descFilled?'OK':'跳过'}`)
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
          // 点 #添加话题
          for (const tr of ['#添加话题','添加话题']) {
            try {
              const tb = await page.$('text="' + tr + '"')
              if (tb && await tb.isVisible().catch(() => false)) { await tb.click(); log('    已点话题入口'); await page.waitForTimeout(1000); break }
            } catch (_) {}
          }
          // 专用输入框
          let did = false
          for (const ti of ['input[placeholder*="#"]','input[placeholder*="话题"]','[class*="topic-input"] input']) {
            try {
              const te = await page.$(ti)
              if (te && await te.isVisible().catch(() => false)) {
                await te.click({ timeout: 2000 }); await te.fill(ct); await page.keyboard.press('Enter')
                did = true; log(`    ✅ 输入:${ct}`); break
              }
            } catch (_) {}
          }
          // 键盘兜底
          if (!did) { for (const c of ct) await page.keyboard.type(c, { delay: 80 }); await page.keyboard.press('Enter'); log(`    ✅ 键盘:${ct}`); did = true }
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
          for (const cs of ['text=使用','text=确定','text=确认','text=保存']) {
            try {
              const cb = await page.$(cs)
              if (cb && await cb.isVisible().catch(() => false)) {
                const imgs = await page.$$('[class*="recommend"] img').catch(() => [])
                if (imgs.length) { await imgs[0].click({timeout:1500}).catch(()=>{}); await page.waitForTimeout(500) }
                await cb.click(); log(`    ✅ 确认${lab}`); await page.waitForTimeout(1000); break
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
