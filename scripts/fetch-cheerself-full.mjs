// 2026-08-14: playwright 全量抓取 cheerselfai（模拟点「加载更多」直到全量）→ 导出 JSON
// 用法: node scripts/fetch-cheerself-full.mjs [--lib=minimax-h3] [--headless]
import { chromium } from 'playwright'
import fs from 'fs'

const LIBS = [
  { slug: 'seedance-2-5',   model: 'Seedance 2.5' },
  { slug: 'minimax-h3',     model: 'MiniMax H3' },
  { slug: 'gpt-image-2',    model: 'GPT Image 2' },
  { slug: 'seedream-5-pro', model: 'Seedream 5 Pro' },
  { slug: 'flux-3',         model: 'FLUX 3' },
  { slug: 'ecommerce-image',model: 'GPT Image 2' },
]
const only = process.argv.find(a => a.startsWith('--lib='))?.split('=')[1]
const headless = !process.argv.includes('--headed')
const CHROME = "C:/Users/wo'shen/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe"

function stripTags(h) {
  return h.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim()
}

async function fetchFull(slug) {
  const browser = await chromium.launch({ executablePath: CHROME, headless, args: ['--no-sandbox'] })
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    locale: 'zh-CN',
  })
  const page = await context.newPage()
  await page.goto(`https://cheerselfai.com/prompts/${slug}`, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await page.waitForTimeout(3000)
  // 循环点「加载更多」（JS 点击）直到无按钮或数量不增
  let rounds = 0
  while (rounds < 100) {
    const clicked = await page.evaluate(() => {
      const btn = [...document.querySelectorAll('button')].find(b => b.textContent.includes('加载更多'))
      if (btn) { btn.click(); return true }
      return false
    }).catch(() => false)
    if (!clicked) break
    await page.waitForTimeout(2500)
    rounds++
    if (rounds % 5 === 0) {
      const n = (await page.content()).match(/imagePromptCard/g || []).length || 0
      console.log(`  [${slug}] 加载更多 ${rounds} 次（HTML卡片标记约 ${n}）`)
    }
  }
  const html = await page.content()
  // 提取全部卡片（正则，不依赖 DOM 选择器）
  const starts = [...html.matchAll(/<div class="imagePromptCard/g)].map(m => m.index)
  const actions = [...html.matchAll(/<div class="imagePromptCardActions">/g)].map(m => m.index)
  const items = []
  for (let i = 0; i < starts.length; i++) {
    const s = starts[i]
    const a = actions.find(x => x > s)
    if (!a) continue
    const cardHtml = html.substring(s, a)
    let prompt = stripTags(cardHtml)
    const ti = prompt.indexOf('提示词')
    if (ti >= 0 && ti < 30) prompt = prompt.substring(ti + 3).trim()
    prompt = prompt.replace(/^[\s:：]*/, '').replace(/当前浏览器不支持视频播放\s*$/, '').replace(/\s+$/g, '').trim()
    const poster = cardHtml.match(/poster="([^"]+)/)?.[1] || ''
    const mp4 = cardHtml.match(/<source[^>]*src="([^"]+\.mp4[^"]*)"/)?.[1] || ''
    const img = cardHtml.match(/<img[^>]*src="([^"]+)/)?.[1] || ''
    const after = html.substring(a, a + 900)
    const author = after.match(/@([A-Za-z0-9_\-\.]+)/)?.[1] || ''
    const xurl = after.match(/https:\/\/x\.com\/[^"\s'\)]+/)?.[0] || ''
    if (prompt.length > 20) items.push({ prompt, poster, mp4, img, author, xurl })
  }
  await browser.close()
  return items
}

const libs = LIBS.filter(l => !only || l.slug === only)
const all = {}
for (const lib of libs) {
  try {
    const items = await fetchFull(lib.slug)
    all[lib.slug] = { model: lib.model, count: items.length, items }
    console.log(`[${lib.slug}] 全量抓到 ${items.length} 条`)
  } catch (e) { console.error(`[${lib.slug}] 失败: ${e.message}`) }
}
let merged = {}
try { merged = JSON.parse(fs.readFileSync('scripts/cheerself-full.json', 'utf8')) } catch {}
Object.assign(merged, all)
fs.writeFileSync('scripts/cheerself-full.json', JSON.stringify(merged, null, 0))
console.log('已合并导出 scripts/cheerself-full.json（累计 ' + Object.keys(merged).length + ' 库）')
