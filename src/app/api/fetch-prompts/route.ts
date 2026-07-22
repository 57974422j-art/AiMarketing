import { NextRequest, NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client'
import { getAuthFromHeaders } from '@/lib/api-auth'

const prisma = new PrismaClient()

const PIXABAY_KEY = process.env.PIXABAY_API_KEY || ''
const DASHSCOPE_KEY = process.env.DASHSCOPE_API_KEY || ''
const DASHSCOPE_CHAT_BASE = 'https://dashscope.aliyuncs.com/compatible-mode/v1'

// ===== 行业 × 用途 抓取矩阵 =====
// 图片：行业 × 用途子分类（海报封面/产品展示/品牌宣传/节日营销/短视频封面）
// 视频：按行业搜视频词，暂归入「文生视频」（细分待用户看效果后定）
const INDUSTRIES = [
  { name: '美业', w: 'beauty salon' },
  { name: '教育', w: 'education training' },
  { name: '电商', w: 'ecommerce product' },
  { name: '餐饮', w: 'restaurant food' },
  { name: '房产', w: 'real estate property' },
  { name: '健身', w: 'fitness gym' },
  { name: '旅游', w: 'travel resort' },
  { name: '服装', w: 'fashion clothing' },
]
const IMAGE_USES = [
  { cat: '海报封面', q: (w: string) => `${w} poster promotion` },
  { cat: '产品展示', q: (w: string) => `${w} product` },
  { cat: '品牌宣传', q: (w: string) => `${w} brand store` },
  { cat: '节日营销', q: (w: string) => `${w} festival sale` },
  { cat: '短视频封面', q: (w: string) => `${w} portrait person` },
]
const PER_USE = 2       // 每个行业每个用途抓几条
const PER_VIDEO = 2     // 每个行业抓几条视频
const IMAGE_TOTAL_CAP = 80
const VIDEO_TOTAL_CAP = 24

interface Cand {
  title: string
  category: string
  industry: string
  prompt: string
  previewUrl: string   // 初始为 Pixabay 链接，转存 OSS 后替换
  originalUrl: string  // Pixabay 原始链接，用于跨次去重
  visionImage: string  // 喂视觉模型的图（图=webformat；视频=缩略图）
  kind: 'image' | 'video'
  _tags: string
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
 * Agnes 经 /v1/models 确认无 VL 模型，统一用 qwen-vl-max 看真实画面写提示词。
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

// 转存到阿里云 OSS（失败则保留 Pixabay 外链，不阻塞抓取）
async function uploadToOSS(url: string, kind: 'image' | 'video'): Promise<string | null> {
  const region = process.env.OSS_REGION
  const id = process.env.OSS_ACCESS_KEY_ID
  const secret = process.env.OSS_ACCESS_KEY_SECRET
  const bucket = process.env.OSS_BUCKET
  if (!region || !id || !secret || !bucket) { console.log('[OSS] 未配置，保留 Pixabay 外链'); return null }
  try {
    const to = kind === 'video' ? 120000 : 30000
    const resp = await fetch(url, { signal: AbortSignal.timeout(to) })
    if (!resp.ok) return null
    const buf = Buffer.from(await resp.arrayBuffer())
    const clean = url.split('?')[0]
    const ext = (clean.split('.').pop() || (kind === 'video' ? 'mp4' : 'jpg')).toLowerCase()
    const ct = resp.headers.get('content-type') || (kind === 'video' ? 'video/mp4' : 'image/jpeg')
    const OSS = (await import('ali-oss')).default
    const client = new OSS({ region, accessKeyId: id, accessKeySecret: secret, bucket, secure: true })
    const ossName = `prompt-templates/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`
    await client.put(ossName, buf, { headers: { 'x-oss-object-acl': 'public-read', 'Content-Type': ct } })
    const url2 = `https://${bucket}.${region}.aliyuncs.com/${ossName}`
    console.log(`[OSS] 转存成功 (${kind}): ${url2.substring(0, 70)}`)
    return url2
  } catch (e: any) { console.log('[OSS] 转存失败，保留外链:', e?.message); return null }
}

// 运行时建表 + 加列（避开 prisma generate，单文件自包含）
async function ensureColumns() {
  try {
    await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS PromptTemplate (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT, category TEXT, prompt TEXT, previewUrl TEXT,
      isActive BOOLEAN DEFAULT 1, createdAt DATETIME DEFAULT CURRENT_TIMESTAMP, updatedAt DATETIME,
      industry TEXT, originalUrl TEXT)`)
  } catch {}
  for (const col of ['industry', 'originalUrl']) {
    try { await prisma.$executeRawUnsafe(`ALTER TABLE PromptTemplate ADD COLUMN ${col} TEXT`) } catch {}
  }
}

// 分批并发
async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = []
  for (let i = 0; i < items.length; i += limit) {
    const batch = items.slice(i, i + limit)
    const res = await Promise.all(batch.map(fn))
    out.push(...res)
  }
  return out
}

// ===== 抓取：行业 × 用途 图片 =====
async function fetchImageCandidates(): Promise<Cand[]> {
  if (!PIXABAY_KEY) { console.log('[Fetch] 缺少 PIXABAY_API_KEY'); return [] }
  const out: Cand[] = []
  for (const ind of INDUSTRIES) {
    if (out.length >= IMAGE_TOTAL_CAP) break
    for (const use of IMAGE_USES) {
      if (out.length >= IMAGE_TOTAL_CAP) break
      const q = use.q(ind.w)
      try {
        const api = `https://pixabay.com/api/?key=${PIXABAY_KEY}&q=${encodeURIComponent(q)}&per_page=20&safesearch=true&image_type=photo`
        const r = await fetch(api, { signal: AbortSignal.timeout(20000) })
        if (!r.ok) { console.log(`[Fetch] 图查询失败 ${r.status} (${ind.name}/${use.cat})`); continue }
        const data: any = await r.json()
        const hits: any[] = data.hits || []
        let taken = 0
        for (const hit of hits) {
          if (taken >= PER_USE || out.length >= IMAGE_TOTAL_CAP) break
          const previewUrl = hit.largeImageURL || hit.webformatURL
          const visionImage = hit.webformatURL || hit.largeImageURL
          if (!previewUrl || !visionImage) continue
          const tags = (hit.tags || '').replace(/,/g, ', ').trim() || `${ind.name} ${use.cat}`
          const title = tags.length > 40 ? tags.substring(0, 40) + '…' : tags
          out.push({ title, category: use.cat, industry: ind.name, prompt: '', previewUrl, originalUrl: previewUrl, visionImage, kind: 'image', _tags: tags })
          taken++
        }
      } catch (e: any) { console.log(`[Fetch] 图异常 ${ind.name}/${use.cat}:`, e?.message) }
    }
  }
  return out
}

// ===== 抓取：行业 视频（暂归「文生视频」，细分待定） =====
async function fetchVideoCandidates(): Promise<Cand[]> {
  if (!PIXABAY_KEY) return []
  const out: Cand[] = []
  for (const ind of INDUSTRIES) {
    if (out.length >= VIDEO_TOTAL_CAP) break
    const q = `${ind.w} promotion`
    try {
      const api = `https://pixabay.com/api/videos/?key=${PIXABAY_KEY}&q=${encodeURIComponent(q)}&per_page=20`
      const r = await fetch(api, { signal: AbortSignal.timeout(20000) })
      if (!r.ok) { console.log(`[Fetch] 视频查询失败 ${r.status} (${ind.name})`); continue }
      const data: any = await r.json()
      const hits: any[] = data.hits || []
      let taken = 0
      for (const hit of hits) {
        if (taken >= PER_VIDEO || out.length >= VIDEO_TOTAL_CAP) break
        const previewUrl = hit.videos?.medium?.url || hit.videos?.small?.url
        const visionImage = hit.picture
        if (!previewUrl || !visionImage) continue
        const tags = (hit.tags || '').replace(/,/g, ', ').trim() || `${ind.name} 视频`
        const title = tags.length > 40 ? tags.substring(0, 40) + '…' : tags
        out.push({ title, category: '文生视频', industry: ind.name, prompt: '', previewUrl, originalUrl: previewUrl, visionImage, kind: 'video', _tags: tags })
        taken++
      }
    } catch (e: any) { console.log(`[Fetch] 视频异常 ${ind.name}:`, e?.message) }
  }
  return out
}

// ===== 抓取：场景（地点关键词，无行业） =====
const SCENE_PLANS = [
  'shopping mall interior', 'beach resort', 'coffee shop bookstore',
  'city street night', 'supermarket shelf', 'outdoor camping',
]
async function fetchSceneCandidates(): Promise<Cand[]> {
  if (!PIXABAY_KEY) return []
  const out: Cand[] = []
  for (const q of SCENE_PLANS) {
    try {
      const api = `https://pixabay.com/api/?key=${PIXABAY_KEY}&q=${encodeURIComponent(q)}&per_page=20&safesearch=true&image_type=photo`
      const r = await fetch(api, { signal: AbortSignal.timeout(20000) })
      if (!r.ok) continue
      const data: any = await r.json()
      const hits: any[] = data.hits || []
      let taken = 0
      for (const hit of hits) {
        if (taken >= 2) break
        const previewUrl = hit.largeImageURL || hit.webformatURL
        const visionImage = hit.webformatURL || hit.largeImageURL
        if (!previewUrl || !visionImage) continue
        const tags = (hit.tags || '').replace(/,/g, ', ').trim() || q
        const title = tags.length > 40 ? tags.substring(0, 40) + '…' : tags
        out.push({ title, category: '场景', industry: '', prompt: '', previewUrl, originalUrl: previewUrl, visionImage, kind: 'image', _tags: tags })
        taken++
      }
    } catch {}
  }
  return out
}

export async function POST(request: NextRequest) {
  try {
    const auth = getAuthFromHeaders(request)
    if (!auth || auth.role !== 'admin') {
      return NextResponse.json({ success: false, message: '需要管理员权限' }, { status: 403 })
    }
    const { searchParams } = new URL(request.url)
    const fetchType = searchParams.get('type') || 'image'
    if (!['image', 'video', 'scene'].includes(fetchType)) {
      return NextResponse.json({ success: false, message: '未知抓取类型' }, { status: 400 })
    }

    await ensureColumns()

    let candidates: Cand[] = []
    let kindLabel = '营销图片'
    if (fetchType === 'video') { candidates = await fetchVideoCandidates(); kindLabel = '营销视频' }
    else if (fetchType === 'scene') { candidates = await fetchSceneCandidates(); kindLabel = '场景图片' }
    else { candidates = await fetchImageCandidates(); kindLabel = '营销图片' }
    console.log(`[Fetch] 抓取候选: ${candidates.length} 条 (type=${fetchType})`)

    // 逐条：视觉写中文克隆提示词 + 转存 OSS
    const enriched = await mapWithConcurrency(candidates, 3, async (c: Cand) => {
      const clone = await visionClonePrompt(c.visionImage, kindLabel)
      c.prompt = clone || c._tags
      const oss = await uploadToOSS(c.previewUrl, c.kind)
      if (oss) c.previewUrl = oss
      return c
    })

    // 入库（按 originalUrl 去重，避免重复抓取同一素材）
    let inserted = 0
    for (const c of enriched) {
      const rows: any[] = await prisma.$queryRawUnsafe('SELECT id FROM PromptTemplate WHERE originalUrl = ?', c.originalUrl)
      if (Array.isArray(rows) && rows.length) continue
      await prisma.$executeRawUnsafe(
        'INSERT INTO PromptTemplate (title, category, prompt, previewUrl, industry, originalUrl) VALUES (?, ?, ?, ?, ?, ?)',
        c.title, c.category, c.prompt, c.previewUrl, c.industry || '', c.originalUrl
      )
      inserted++
    }

    console.log(`[Fetch] 写入完成: ${inserted} 条新记录`)
    return NextResponse.json({
      success: true,
      message: `抓取完成：候选 ${enriched.length} 条，新增 ${inserted} 条`,
      data: { total: enriched.length, inserted },
    })
  } catch (error: any) {
    console.error('[Fetch] 错误:', error)
    return NextResponse.json({ success: false, message: '抓取失败: ' + (error?.message || '') }, { status: 500 })
  } finally {
    await prisma.$disconnect()
  }
}
