// 2026-08-14: 抓取 cheerselfai.com 提示词库 → 导入 PromptTemplate（学习库）
// 用法: node scripts/fetch-cheerself-prompts.mjs --lib=seedance-2-5 [--limit N]
import { PrismaClient } from '@prisma/client'
// 运行方式: node --env-file=.env.local scripts/fetch-cheerself-prompts.mjs
const prisma = new PrismaClient()
const BASE = 'https://cheerselfai.com/prompts'
const LIBS = [
  { slug: 'seedance-2-5',   model: 'Seedance 2.5',   category: '视频提示词' },
  { slug: 'minimax-h3',     model: 'MiniMax H3',     category: '视频提示词' },
  { slug: 'gpt-image-2',    model: 'GPT Image 2',    category: '图像提示词' },
  { slug: 'seedream-5-pro', model: 'Seedream 5 Pro', category: '图像提示词' },
  { slug: 'flux-3',         model: 'FLUX 3',         category: '视频提示词' },
  { slug: 'ecommerce-image',model: 'GPT Image 2',    category: '电商图片提示词' },
]
const limit = parseInt(process.argv.find(a => a.startsWith('--limit='))?.split('=')[1] || '50', 10)
const only = process.argv.find(a => a.startsWith('--lib='))?.split('=')[1]

function stripTags(h) {
  return h.replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<style[\s\S]*?<\/style>/g, ' ')
    .replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim()
}

async function fetchLib(slug) {
  const url = `${BASE}/${slug}`
  const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(90000) })
  if (!r.ok) throw new Error(`${slug} HTTP ${r.status}`)
  const html = await r.text()
  const starts = [...html.matchAll(/<div class="imagePromptCard/g)].map(m => m.index)
  const actions = [...html.matchAll(/<div class="imagePromptCardActions">/g)].map(m => m.index)
  const items = []
  for (let i = 0; i < starts.length; i++) {
    const s = starts[i]
    const a = actions.find(x => x > s)
    if (!a) continue
    let prompt = stripTags(html.substring(s, a))
    const ti = prompt.indexOf('提示词')
    if (ti >= 0 && ti < 30) prompt = prompt.substring(ti + 3).trim()
    prompt = prompt.replace(/^[\s:：]*/, '').replace(/当前浏览器不支持视频播放\s*$/, '').replace(/\s+$/g, '').trim()
    const after = html.substring(a, a + 900)
    const mAuthor = after.match(/@([A-Za-z0-9_\-\.]+)/)
    const mX = after.match(/https:\/\/x\.com\/[^"\s'\)]+/)
    if (prompt.length > 50) items.push({ prompt, author: mAuthor?.[1] || '', xurl: mX?.[0] || '' })
  }
  return items
}

async function main() {
  const libs = LIBS.filter(l => !only || l.slug === only)
  let total = 0
  for (const lib of libs) {
    try {
      const items = await fetchLib(lib.slug)
      console.log(`[${lib.slug}] 解析到 ${items.length} 条`)
      let inserted = 0
      for (const it of items.slice(0, limit)) {
        const exist = await prisma.promptTemplate.findFirst({ where: { model: lib.model, originalUrl: it.xurl || undefined } })
        if (exist) continue
        await prisma.promptTemplate.create({
          data: {
            title: it.prompt.substring(0, 40),
            prompt: it.prompt,
            category: lib.category,
            model: lib.model,
            source: 'cheerselfai',
            author: it.author || null,
            originalUrl: it.xurl || null,
            tags: `${lib.model},cheerselfai`,
            isActive: true,
          },
        })
        inserted++
      }
      total += inserted
      console.log(`  → 入库 ${inserted} 条`)
    } catch (e) { console.error(`[${lib.slug}] 失败: ${e.message}`) }
  }
  console.log(`\n完成：共入库 ${total} 条（去重后）`)
  await prisma.$disconnect()
}
main()
