import { NextRequest, NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client'
import { getAuthFromHeaders } from '@/lib/api-auth'

const prisma = new PrismaClient()

interface FetchedPrompt {
  title: string
  prompt: string
  category: string
}

// 质量门槛：过滤过短的提示词
function qualityFilter(prompt: string): boolean {
  return prompt.length > 20 && !prompt.includes('http') && !prompt.includes('{') && !prompt.includes('<')
}

// Civitai API — 按最高热度排序
async function fetchFromCivitai(): Promise<FetchedPrompt[]> {
  const results: FetchedPrompt[] = []
  try {
    const res = await fetch('https://civitai.com/api/v1/images?limit=30&sort=Most Reactions&period=Week&nsfw=false', { signal: AbortSignal.timeout(15000) })
    if (!res.ok) return results
    const data: any = await res.json()
    const items = data.items || []
    const unique = new Set<string>()
    for (const item of items) {
      if (results.length >= 12) break
      const meta = item.meta || {}
      const prompt = (meta.prompt || '').trim()
      if (!prompt || !qualityFilter(prompt)) continue
      const key = prompt.substring(0, 60)
      if (unique.has(key)) continue
      unique.add(key)
      const reactions = (item.stats?.reactionCount || 0)
      results.push({
        title: `Civitai ⭐${reactions}`,
        prompt: prompt.substring(0, 1500),
        category: meta.negativePrompt ? '文生图' : '文生视频',
      })
    }
  } catch { /* ignore */ }
  return results
}

// Lexica API — 取搜索前几名
async function fetchFromLexica(): Promise<FetchedPrompt[]> {
  const results: FetchedPrompt[] = []
  const queries = ['marketing', 'product showcase', 'social media', 'advertising', 'e-commerce']
  const unique = new Set<string>()
  for (const q of queries) {
    try {
      const res = await fetch(`https://lexica.art/api/v1/search?q=${encodeURIComponent(q)}`, { signal: AbortSignal.timeout(10000) })
      if (!res.ok) continue
      const data: any = await res.json()
      const images = data.images || []
      for (const img of images) {
        if (results.length >= 15) break
        const prompt = (img.prompt || '').trim()
        if (!prompt || !qualityFilter(prompt)) continue
        const key = prompt.substring(0, 60)
        if (unique.has(key)) continue
        unique.add(key)
        results.push({
          title: `Lexica ${q}`,
          prompt: prompt.substring(0, 1500),
          category: '文生图',
        })
      }
    } catch { /* ignore */ }
  }
  return results
}

// PromptHero（React 渲染页面，能抓多少算多少）
async function fetchFromPromptHero(): Promise<FetchedPrompt[]> {
  const results: FetchedPrompt[] = []
  try {
    const res = await fetch('https://prompthero.com/search?q=product', { signal: AbortSignal.timeout(8000), headers: { 'User-Agent': 'Mozilla/5.0' } })
    if (res.ok) {
      const html = await res.text()
      const matches = html.match(/"prompt":"([^"]+)"/g) || html.match(/<div[^>]*class="[^"]*prompt[^"]*"[^>]*>([^<]+)</g)
      if (matches) {
        for (let i = 0; i < Math.min(matches.length, 8); i++) {
          const text = matches[i].replace(/^.*?"prompt":"|"$|<[^>]*>/g, '').trim()
          if (qualityFilter(text)) results.push({ title: `PromptHero ${i + 1}`, prompt: text, category: '文生图' })
        }
      }
    }
  } catch {}
  return results
}

export async function POST(request: NextRequest) {
  try {
    const auth = getAuthFromHeaders(request)
    if (!auth || auth.role !== 'admin') {
      return NextResponse.json({ success: false, message: '需要管理员权限' }, { status: 403 })
    }
    const { searchParams } = new URL(request.url)
    const fetchType = searchParams.get('type') || 'image' // 'image' | 'video'

    const sources = (process.env.PROMPT_SOURCES || 'civitai,lexica,prompthero').split(',').map(s => s.trim())
    console.log('[FetchPrompts] 抓取来源:', sources)

    let allPrompts: FetchedPrompt[] = []

    // 如果需要按类型筛选后插入
    const targetCategory = fetchType === 'video' ? '文生视频' : fetchType === 'image' ? '文生图' : fetchType === 'scene' ? '场景' : null

    // 按配置顺序抓取
    for (const source of sources) {
      if (source === 'civitai') {
        const r = await fetchFromCivitai()
        console.log(`[FetchPrompts] Civitai 抓取: ${r.length} 条`)
        allPrompts.push(...r)
      }
      if (source === 'lexica') {
        const r = await fetchFromLexica()
        console.log(`[FetchPrompts] Lexica 抓取: ${r.length} 条`)
        allPrompts.push(...r)
      }
      if (source === 'prompthero') {
        const r = await fetchFromPromptHero()
        console.log(`[FetchPrompts] PromptHero: ${r.length} 条`)
        allPrompts.push(...r)
      }
    }

    // 去重（按 prompt 去重）
    const seen = new Set<string>()
    const unique = allPrompts.filter(p => {
      const key = p.prompt.substring(0, 50)
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    console.log(`[FetchPrompts] 去重后: ${unique.length} 条`)

    // 批量写入数据库
    let inserted = 0
    for (const item of unique) {
      // 按类型筛选：image→只存文生图, video→只存文生视频, 空→所有
      if (targetCategory && item.category !== targetCategory) continue
      const existing = await prisma.promptTemplate.findFirst({
        where: { prompt: item.prompt.substring(0, 200) },
      })
      if (existing) continue
      await prisma.promptTemplate.create({
        data: { title: item.title, prompt: item.prompt, category: item.category },
      })
      inserted++
    }

    console.log(`[FetchPrompts] 写入完成: ${inserted} 条新记录`)
    return NextResponse.json({
      success: true,
      message: `抓取完成：共获取 ${unique.length} 条，新增 ${inserted} 条`,
      data: { total: unique.length, inserted },
    })
  } catch (error) {
    console.error('[FetchPrompts] 错误:', error)
    return NextResponse.json({ success: false, message: '抓取失败' }, { status: 500 })
  } finally {
    await prisma.$disconnect()
  }
}
