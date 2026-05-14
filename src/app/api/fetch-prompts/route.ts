import { NextRequest, NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client'
import { getAuthFromHeaders } from '@/lib/api-auth'

const prisma = new PrismaClient()

interface FetchedPrompt {
  title: string
  prompt: string
  category: string
}

// Civitai API
async function fetchFromCivitai(): Promise<FetchedPrompt[]> {
  const results: FetchedPrompt[] = []
  try {
    const res = await fetch('https://civitai.com/api/v1/images?limit=20&sort=Newest&nsfw=false', { signal: AbortSignal.timeout(15000) })
    if (!res.ok) return results
    const data: any = await res.json()
    const items = data.items || []
    for (const item of items.slice(0, 15)) {
      const meta = item.meta || {}
      const prompt = meta.prompt || ''
      if (!prompt) continue
      results.push({
        title: `Civitai ${item.id}`,
        prompt: prompt.substring(0, 2000),
        category: meta.negativePrompt ? '文生图' : '文生视频',
      })
    }
  } catch { /* ignore */ }
  return results
}

// Lexica API
async function fetchFromLexica(): Promise<FetchedPrompt[]> {
  const results: FetchedPrompt[] = []
  const queries = ['marketing', 'product showcase', 'social media', 'advertising', 'e-commerce']
  for (const q of queries) {
    try {
      const res = await fetch(`https://lexica.art/api/v1/search?q=${encodeURIComponent(q)}`, { signal: AbortSignal.timeout(10000) })
      if (!res.ok) continue
      const data: any = await res.json()
      const images = data.images || []
      for (const img of images.slice(0, 5)) {
        const prompt = img.prompt || ''
        if (!prompt) continue
        results.push({
          title: `Lexica ${q}`,
          prompt: prompt.substring(0, 2000),
          category: '文生图',
        })
      }
    } catch { /* ignore */ }
  }
  return results
}

// PromptHero：尝试抓取，返回抓取到的内容，不给兜底
async function fetchFromPromptHero(): Promise<FetchedPrompt[]> {
  const results: FetchedPrompt[] = []
  try {
    const res = await fetch('https://prompthero.com/search?q=product', { signal: AbortSignal.timeout(8000), headers: { 'User-Agent': 'Mozilla/5.0' } })
    if (res.ok) {
      const html = await res.text()
      const matches = html.match(/"prompt":"([^"]+)"/g) || html.match(/<div[^>]*class="[^"]*prompt[^"]*"[^>]*>([^<]+)</g)
      if (matches) {
        for (let i = 0; i < Math.min(matches.length, 5); i++) {
          const text = matches[i].replace(/^.*?"prompt":"|"$|<[^>]*>/g, '').trim()
          if (text.length > 10) results.push({ title: `PromptHero ${i + 1}`, prompt: text, category: '文生图' })
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

    const sources = (process.env.PROMPT_SOURCES || 'civitai,lexica,prompthero').split(',').map(s => s.trim())
    console.log('[FetchPrompts] 抓取来源:', sources)

    let allPrompts: FetchedPrompt[] = []

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
