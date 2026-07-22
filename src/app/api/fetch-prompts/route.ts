import { NextRequest, NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client'
import { getAuthFromHeaders } from '@/lib/api-auth'

const prisma = new PrismaClient()

// ===== 配置（均来自 .env.local / 后台设置页，运行时注入） =====
const PIXABAY_KEY = process.env.PIXABAY_API_KEY || ''
const DASHSCOPE_KEY = process.env.DASHSCOPE_API_KEY || ''
const DASHSCOPE_CHAT_BASE = 'https://dashscope.aliyuncs.com/compatible-mode/v1'

interface FetchedPrompt {
  title: string
  prompt: string
  category: string
  previewUrl: string
}

// 把远程图片下载为 base64（供 qwen-vl 使用）
async function imageUrlToBase64(url: string): Promise<string | null> {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(20000) })
    if (!r.ok) return null
    const buf = Buffer.from(await r.arrayBuffer())
    const ct = r.headers.get('content-type') || 'image/jpeg'
    return `data:${ct};base64,${buf.toString('base64')}`
  } catch { return null }
}

/**
 * 视觉理解：用真实图片生成「中文克隆提示词」
 * Agnes 经 /v1/models 确认仅提供生图 / 生视频 / 文本模型，无视觉理解(VL)能力，
 * 故统一用 qwen-vl-max 看真实画面写提示词（不再试 Agnes，避免 503 浪费）。
 */
async function visionClonePrompt(imageUrl: string, kindLabel: string): Promise<string | null> {
  const instruct = `请看这张${kindLabel}。请用简体中文写一段可用于 AI 文生图/文生视频的「克隆提示词」，要求：
1）准确描述画面主体、构图、光线、色彩、风格、氛围；
2）按「主体, 环境, 光线, 风格, 镜头」的结构组织关键词，用逗号分隔；
3）只输出提示词本身，不要解释、不要加引号、不要 markdown。`

  if (!DASHSCOPE_KEY) { console.log('[visionClone] 缺少 DASHSCOPE_API_KEY，退化为标签'); return null }
  const b64 = await imageUrlToBase64(imageUrl)
  if (!b64) { console.log('[visionClone] 图片下载为 base64 失败，退化为标签'); return null }
  try {
    const res = await fetch(`${DASHSCOPE_CHAT_BASE}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${DASHSCOPE_KEY}` },
      body: JSON.stringify({
        model: 'qwen-vl-max',
        messages: [{ role: 'user', content: [
          { type: 'text', text: instruct },
          { type: 'image_url', image_url: { url: b64 } },
        ] }],
        temperature: 0.4,
        max_tokens: 600,
      }),
      signal: AbortSignal.timeout(60000),
    })
    if (res.ok) {
      const d: any = await res.json()
      const t = d?.choices?.[0]?.message?.content?.trim()
      if (t) { console.log('[visionClone] qwen-vl-max 成功'); return t }
    } else {
      console.log(`[visionClone] qwen-vl-max 返回 ${res.status}，退化为标签`)
    }
  } catch (e: any) {
    console.log('[visionClone] qwen-vl 失败:', e?.message)
  }
  return null
}

// 分批并发（每批 4 个，避免瞬间打爆视觉 API）
async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = []
  for (let i = 0; i < items.length; i += limit) {
    const batch = items.slice(i, i + limit)
    const res = await Promise.all(batch.map(fn))
    out.push(...res)
  }
  return out
}

// ===== 从 Pixabay 抓取素材 + AI 写中文克隆提示词 =====
async function fetchFromPixabay(kind: 'image' | 'video', keywords: string[], category: string, kindLabel: string, limit = 12): Promise<FetchedPrompt[]> {
  if (!PIXABAY_KEY) { console.log('[FetchPrompts] 缺少 PIXABAY_API_KEY，跳过'); return [] }
  const results: FetchedPrompt[] = []
  const seenUrl = new Set<string>()

  for (const q of keywords) {
    if (results.length >= limit) break
    try {
      let apiUrl: string
      if (kind === 'image') {
        apiUrl = `https://pixabay.com/api/?key=${PIXABAY_KEY}&q=${encodeURIComponent(q)}&per_page=20&safesearch=true&image_type=photo&orientation=all`
      } else {
        apiUrl = `https://pixabay.com/api/videos/?key=${PIXABAY_KEY}&q=${encodeURIComponent(q)}&per_page=20`
      }
      const res = await fetch(apiUrl, { signal: AbortSignal.timeout(20000) })
      if (!res.ok) { console.log(`[FetchPrompts] Pixabay ${kind} 查询失败 ${res.status}`); continue }
      const data: any = await res.json()
      const hits: any[] = (kind === 'image' ? data.hits : data.hits) || []
      for (const hit of hits) {
        if (results.length >= limit) break
        const previewUrl = kind === 'image'
          ? (hit.largeImageURL || hit.webformatURL)
          : (hit.videos?.medium?.url || hit.videos?.small?.url)
        const visionImage = kind === 'image'
          ? (hit.webformatURL || hit.largeImageURL)
          : hit.picture
        if (!previewUrl || !visionImage || seenUrl.has(previewUrl)) continue
        seenUrl.add(previewUrl)
        const tags = (hit.tags || '').replace(/,/g, ', ').trim() || `Pixabay ${kind}`
        const title = tags.length > 50 ? tags.substring(0, 50) + '…' : tags
        results.push({ title, prompt: '', category, previewUrl, _visionImage: visionImage, _tags: tags } as any)
      }
    } catch (e: any) {
      console.log(`[FetchPrompts] Pixabay ${kind} 异常:`, e?.message)
    }
  }

  // 逐条调视觉模型写中文克隆提示词
  const enriched = await mapWithConcurrency(results, 4, async (item: any) => {
    const clone = await visionClonePrompt(item._visionImage, kindLabel)
    return {
      title: item.title,
      category: item.category,
      previewUrl: item.previewUrl,
      prompt: clone || item._tags, // 视觉失败时退化为标签，保证素材入库
    }
  })
  return enriched
}

export async function POST(request: NextRequest) {
  try {
    const auth = getAuthFromHeaders(request)
    if (!auth || auth.role !== 'admin') {
      return NextResponse.json({ success: false, message: '需要管理员权限' }, { status: 403 })
    }
    const { searchParams } = new URL(request.url)
    const fetchType = searchParams.get('type') || 'image' // 'image' | 'video' | 'scene'

    // 关键词规划：image/video 偏营销物料；scene 偏真实场景
    const plans: Record<string, { kind: 'image' | 'video'; category: string; kindLabel: string; keywords: string[] }> = {
      image: { kind: 'image', category: '文生图', kindLabel: '营销图片', keywords: ['marketing product', 'advertising poster', 'brand social media', 'e-commerce product'] },
      video: { kind: 'video', category: '文生视频', kindLabel: '营销视频', keywords: ['business marketing', 'product promotion', 'advertising commercial', 'brand story'] },
      scene: { kind: 'image', category: '场景', kindLabel: '场景图片', keywords: ['shopping mall interior', 'beach resort', 'coffee shop bookstore', 'city street night', 'supermarket shelf', 'outdoor camping'] },
    }
    const plan = plans[fetchType]
    if (!plan) return NextResponse.json({ success: false, message: '未知抓取类型' }, { status: 400 })

    console.log(`[FetchPrompts] 开始抓取 Pixabay: type=${fetchType} kind=${plan.kind}`)
    const all = await fetchFromPixabay(plan.kind, plan.keywords, plan.category, plan.kindLabel)
    console.log(`[FetchPrompts] 抓取候选: ${all.length} 条`)

    // 写入数据库（按 previewUrl 去重，避免重复抓取同一素材）
    let inserted = 0
    for (const item of all) {
      const existing = await prisma.promptTemplate.findFirst({ where: { previewUrl: item.previewUrl } })
      if (existing) continue
      await prisma.promptTemplate.create({
        data: { title: item.title, prompt: item.prompt, category: item.category, previewUrl: item.previewUrl },
      })
      inserted++
    }

    console.log(`[FetchPrompts] 写入完成: ${inserted} 条新记录`)
    return NextResponse.json({
      success: true,
      message: `抓取完成：候选 ${all.length} 条，新增 ${inserted} 条`,
      data: { total: all.length, inserted },
    })
  } catch (error: any) {
    console.error('[FetchPrompts] 错误:', error)
    return NextResponse.json({ success: false, message: '抓取失败: ' + (error?.message || '') }, { status: 500 })
  } finally {
    await prisma.$disconnect()
  }
}
