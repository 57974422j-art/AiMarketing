import { NextRequest, NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client'
import { getAuthFromHeaders } from '@/lib/api-auth'

const prisma = new PrismaClient()

// 内置提示词源预设（2026-08-10，源集合后续讨论可增删）
export const PROMPT_SOURCE_PRESETS = [
  { id: 'banana-prompt-quicker', name: 'Banana Prompt Quicker（中文社区·质量高）', url: 'https://cdn.jsdelivr.net/gh/yukkcat/image-prompts@main/dist/sources/banana-prompt-quicker.json' },
  { id: 'awesome-gpt-image', name: 'Awesome GPT Image', url: 'https://cdn.jsdelivr.net/gh/yukkcat/image-prompts@main/dist/sources/awesome-gpt-image.json' },
  { id: 'awesome-gpt4o-image-prompts', name: 'Awesome GPT-4o', url: 'https://cdn.jsdelivr.net/gh/yukkcat/image-prompts@main/dist/sources/awesome-gpt4o-image-prompts.json' },
  { id: 'youmind-nano-banana-pro', name: 'YouMind Nano Banana Pro', url: 'https://cdn.jsdelivr.net/gh/yukkcat/image-prompts@main/dist/sources/youmind-nano-banana-pro.json' },
]

async function syncSource(url: string, sourceKeyPrefix: string): Promise<{ added: number; skipped: number; failed: number }> {
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(60000) })
  if (!res.ok) throw new Error(`源拉取失败 HTTP ${res.status}`)
  const items = await res.json()
  if (!Array.isArray(items)) throw new Error('源 JSON 非数组')
  let added = 0, skipped = 0, failed = 0
  for (const it of items) {
    try {
      const prompt = String(it.prompt || '').trim()
      if (!prompt) { skipped++; continue }
      const key = String(it.id || `${sourceKeyPrefix}:${it.title || prompt.substring(0, 20)}`)
      const exist = await prisma.promptTemplate.findFirst({ where: { sourceKey: key } })
      if (exist) { skipped++; continue }
      await prisma.promptTemplate.create({
        data: {
          title: String(it.title || '').substring(0, 120) || null,
          prompt,
          category: String(it.tags?.join(',') || it.category || '').substring(0, 200) || null,
          previewUrl: String(it.coverUrl || '') || null,
          industry: String(it.sourceId || sourceKeyPrefix) || null,
          originalUrl: String(it.sourceUrl || '') || null,
          tags: Array.isArray(it.tags) ? it.tags.join(',').substring(0, 200) : (String(it.tags || '') || null),
          author: String(it.author || '').substring(0, 100) || null,
          coverUrl: String(it.coverUrl || '') || null,
          imageMode: String(it.imageMode || '') || null,
          sourceKey: key,
        },
      })
      added++
    } catch { failed++ }
  }
  return { added, skipped, failed }
}

// POST /api/admin/prompt-sync  body: { sources?: [{id,name,url}], urls?: string[] }
export async function POST(req: NextRequest) {
  const auth = getAuthFromHeaders(req)
  if (auth?.role !== 'admin') return NextResponse.json({ success: false, message: '仅管理员' }, { status: 403 })
  let body: any = {}
  try { body = await req.json() } catch {}
  const sources = Array.isArray(body.sources) ? body.sources : PROMPT_SOURCE_PRESETS
  const results: any[] = []
  for (const s of sources) {
    try {
      const r = await syncSource(s.url, s.id)
      results.push({ id: s.id, name: s.name, ...r })
    } catch (e: any) {
      results.push({ id: s.id, name: s.name, error: String(e?.message || e).substring(0, 100) })
    }
  }
  return NextResponse.json({ success: true, data: { results } })
}
