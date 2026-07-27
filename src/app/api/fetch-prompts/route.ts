import { NextRequest, NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client'
import { getAuthFromHeaders } from '@/lib/api-auth'

const prisma = new PrismaClient()

const PIXABAY_KEY = process.env.PIXABAY_API_KEY || ''
const DASHSCOPE_KEY = process.env.DASHSCOPE_API_KEY || ''
const DASHSCOPE_CHAT_BASE = 'https://dashscope.aliyuncs.com/compatible-mode/v1'

// ===== 抓取策略（2026-07-27 调整）=====
// 1. 一次只抓 1 条：同步执行，抓到 → 转存 OSS → 入库 → 返回结果；用户确认后再点下一次。
// 2. previewUrl 必须是 OSS 地址：转存失败直接不入库（不再保留 Pixabay 外链，避免死链）。
// 3. 按 originalUrl 跨次去重，抓到重复的自动跳过找下一条。

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
const SCENE_PLANS = [
  'shopping mall interior', 'beach resort', 'coffee shop bookstore',
  'city street night', 'supermarket shelf', 'outdoor camping',
]

interface Cand {
  title: string
  category: string
  industry: string
  prompt: string
  previewUrl: string   // 候选阶段为 Pixabay 链接，入库前必须替换为 OSS 地址
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

// 转存到阿里云 OSS。失败返回 null → 调用方【不入库】（不再保留外链）
async function uploadToOSS(url: string, kind: 'image' | 'video'): Promise<string | null> {
  const region = process.env.OSS_REGION
  const id = process.env.OSS_ACCESS_KEY_ID
  const secret = process.env.OSS_ACCESS_KEY_SECRET
  const bucket = process.env.OSS_BUCKET
  if (!region || !id || !secret || !bucket) { console.log('[OSS] 未配置，本条不入库'); return null }
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
  } catch (e: any) { console.log('[OSS] 转存失败，本条不入库:', e?.message); return null }
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

// 数组随机打乱（每次抓取随机换行业/用途，避免总在同一组合里打转）
function shuffle<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

// 查库判断该 Pixabay 原始链接是否已抓过
async function existsByOriginal(originalUrl: string): Promise<boolean> {
  const rows: any[] = await prisma.$queryRawUnsafe('SELECT id FROM PromptTemplate WHERE originalUrl = ?', originalUrl)
  return Array.isArray(rows) && rows.length > 0
}

// ===== 找 1 条未抓过的图片候选（随机行业×用途） =====
async function pickImageCandidate(): Promise<Cand | null> {
  const combos = shuffle(INDUSTRIES.flatMap(ind => IMAGE_USES.map(use => ({ ind, use }))))
  for (const { ind, use } of combos) {
    const q = use.q(ind.w)
    try {
      const api = `https://pixabay.com/api/?key=${PIXABAY_KEY}&q=${encodeURIComponent(q)}&per_page=20&safesearch=true&image_type=photo`
      const r = await fetch(api, { signal: AbortSignal.timeout(20000) })
      if (!r.ok) { console.log(`[Fetch] 图查询失败 ${r.status} (${ind.name}/${use.cat})`); continue }
      const data: any = await r.json()
      for (const hit of (data.hits || [])) {
        const previewUrl = hit.largeImageURL || hit.webformatURL
        const visionImage = hit.webformatURL || hit.largeImageURL
        if (!previewUrl || !visionImage) continue
        if (await existsByOriginal(previewUrl)) continue   // 重复的跳过
        const tags = (hit.tags || '').replace(/,/g, ', ').trim() || `${ind.name} ${use.cat}`
        const title = tags.length > 40 ? tags.substring(0, 40) + '…' : tags
        return { title, category: use.cat, industry: ind.name, prompt: '', previewUrl, originalUrl: previewUrl, visionImage, kind: 'image', _tags: tags }
      }
    } catch (e: any) { console.log(`[Fetch] 图异常 ${ind.name}/${use.cat}:`, e?.message) }
  }
  return null
}

// ===== 找 1 条未抓过的视频候选（随机行业） =====
async function pickVideoCandidate(orientation: string): Promise<Cand | null> {
  for (const ind of shuffle(INDUSTRIES)) {
    const q = `${ind.w} promotion`
    try {
      const api = `https://pixabay.com/api/videos/?key=${PIXABAY_KEY}&q=${encodeURIComponent(q)}&per_page=20${orientation ? `&orientation=${orientation}` : ''}`
      const r = await fetch(api, { signal: AbortSignal.timeout(20000) })
      if (!r.ok) { console.log(`[Fetch] 视频查询失败 ${r.status} (${ind.name})`); continue }
      const data: any = await r.json()
      for (const hit of (data.hits || [])) {
        const v = hit.videos?.medium || hit.videos?.small || hit.videos?.large
        const previewUrl = v?.url
        const visionImage = v?.thumbnail || hit.picture || ''
        if (!previewUrl) continue
        if (await existsByOriginal(previewUrl)) continue
        const tags = (hit.tags || '').replace(/,/g, ', ').trim() || `${ind.name} 视频`
        const title = tags.length > 40 ? tags.substring(0, 40) + '…' : tags
        return { title, category: '文生视频', industry: ind.name, prompt: '', previewUrl, originalUrl: previewUrl, visionImage, kind: 'video', _tags: tags }
      }
    } catch (e: any) { console.log(`[Fetch] 视频异常 ${ind.name}:`, e?.message) }
  }
  return null
}

// ===== 找 1 条未抓过的场景候选（随机场景词） =====
async function pickSceneCandidate(): Promise<Cand | null> {
  for (const q of shuffle(SCENE_PLANS)) {
    try {
      const api = `https://pixabay.com/api/?key=${PIXABAY_KEY}&q=${encodeURIComponent(q)}&per_page=20&safesearch=true&image_type=photo`
      const r = await fetch(api, { signal: AbortSignal.timeout(20000) })
      if (!r.ok) continue
      const data: any = await r.json()
      for (const hit of (data.hits || [])) {
        const previewUrl = hit.largeImageURL || hit.webformatURL
        const visionImage = hit.webformatURL || hit.largeImageURL
        if (!previewUrl || !visionImage) continue
        if (await existsByOriginal(previewUrl)) continue
        const tags = (hit.tags || '').replace(/,/g, ', ').trim() || q
        const title = tags.length > 40 ? tags.substring(0, 40) + '…' : tags
        return { title, category: '场景', industry: '', prompt: '', previewUrl, originalUrl: previewUrl, visionImage, kind: 'image', _tags: tags }
      }
    } catch {}
  }
  return null
}

/**
 * POST /api/fetch-prompts?type=image|video|scene
 * 单条同步抓取：找 1 条未抓过的素材 → 视觉写克隆提示词 → 转存 OSS（必须成功）→ 入库 → 返回该条。
 * OSS 转存失败则不入库并报错。前端确认结果后再点下一次抓取。
 */
export async function POST(request: NextRequest) {
  const auth = getAuthFromHeaders(request)
  if (!auth || auth.role !== 'admin') {
    return NextResponse.json({ success: false, message: '需要管理员权限' }, { status: 403 })
  }
  if (!PIXABAY_KEY) {
    return NextResponse.json({ success: false, message: '缺少 PIXABAY_API_KEY，无法抓取' }, { status: 400 })
  }
  const { searchParams } = new URL(request.url)
  const fetchType = searchParams.get('type') || 'image'
  if (!['image', 'video', 'scene'].includes(fetchType)) {
    return NextResponse.json({ success: false, message: '未知抓取类型' }, { status: 400 })
  }
  const kindLabel = fetchType === 'video' ? '营销视频' : fetchType === 'scene' ? '场景图片' : '营销图片'
  const orientation = fetchType === 'video' ? (searchParams.get('orientation') || '') : ''

  try {
    await ensureColumns()

    // 1) 找一条没抓过的候选
    let cand: Cand | null = null
    if (fetchType === 'video') cand = await pickVideoCandidate(orientation)
    else if (fetchType === 'scene') cand = await pickSceneCandidate()
    else cand = await pickImageCandidate()
    if (!cand) {
      return NextResponse.json({ success: false, message: '没有找到新素材（可能都已抓取过，或 Pixabay 查询失败）' })
    }

    // 2) 转存 OSS —— 必须成功，否则不入库
    const ossUrl = await uploadToOSS(cand.previewUrl, cand.kind)
    if (!ossUrl) {
      return NextResponse.json({ success: false, message: 'OSS 转存失败，本条未入库（请检查服务器 OSS_* 环境变量或网络）' })
    }
    cand.previewUrl = ossUrl

    // 3) 视觉写中文克隆提示词（失败退化为标签，不阻塞）
    const clone = await visionClonePrompt(cand.visionImage, kindLabel)
    cand.prompt = clone || cand._tags

    // 4) 入库（再查一次去重，防并发点击）
    if (await existsByOriginal(cand.originalUrl)) {
      return NextResponse.json({ success: false, message: '该素材刚被抓取过（重复），未重复入库' })
    }
    await prisma.$executeRawUnsafe(
      'INSERT INTO PromptTemplate (title, category, prompt, previewUrl, industry, originalUrl) VALUES (?, ?, ?, ?, ?, ?)',
      cand.title, cand.category, cand.prompt, cand.previewUrl, cand.industry || '', cand.originalUrl
    )
    console.log(`[Fetch] 单条入库成功: ${cand.title} (${cand.category})`)

    return NextResponse.json({
      success: true,
      message: `已抓取并存入 OSS：「${cand.title}」（${cand.industry || '场景'} / ${cand.category}）。确认无误后可继续抓取下一条。`,
      data: { title: cand.title, category: cand.category, industry: cand.industry, previewUrl: cand.previewUrl },
    })
  } catch (error: any) {
    console.error('[Fetch] 抓取失败:', error)
    return NextResponse.json({ success: false, message: `抓取失败: ${error?.message || '未知错误'}` }, { status: 500 })
  }
}
