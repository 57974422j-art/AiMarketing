import { NextRequest, NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client'
import { getAuthFromHeaders } from '@/lib/api-auth'

const prisma = new PrismaClient()
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

// 内置源预设（首次自动初始化）
export const BUILTIN_SOURCES = [
  { name: 'Banana Prompt Quicker', url: 'https://cdn.jsdelivr.net/gh/yukkcat/image-prompts@main/dist/sources/banana-prompt-quicker.json', homepage: 'https://glidea.github.io/banana-prompt-quicker/', builtIn: true },
  { name: 'DavidWu GPT Image 2', url: 'https://cdn.jsdelivr.net/gh/yukkcat/image-prompts@main/dist/sources/davidwu-gpt-image2-prompts.json', homepage: 'https://github.com/davidwuw0811-boop/awesome-gpt-image2-prompts', builtIn: true },
  { name: 'Awesome GPT Image', url: 'https://cdn.jsdelivr.net/gh/yukkcat/image-prompts@main/dist/sources/awesome-gpt-image.json', homepage: 'https://github.com/ZeroLu/awesome-gpt-image', builtIn: true },
  { name: 'Awesome GPT-4o', url: 'https://cdn.jsdelivr.net/gh/yukkcat/image-prompts@main/dist/sources/awesome-gpt4o-image-prompts.json', homepage: 'https://github.com/ImgEdify/Awesome-GPT4o-Image-Prompts', builtIn: true },
  { name: 'YouMind GPT Image 2', url: 'https://cdn.jsdelivr.net/gh/yukkcat/image-prompts@main/dist/sources/youmind-gpt-image-2.json', homepage: 'https://github.com/YouMind-OpenLab/awesome-gpt-image-2', builtIn: true },
  { name: 'YouMind Nano Banana Pro', url: 'https://cdn.jsdelivr.net/gh/yukkcat/image-prompts@main/dist/sources/youmind-nano-banana-pro.json', homepage: 'https://github.com/YouMind-OpenLab/awesome-nano-banana-pro-prompts', builtIn: true },
]

async function ensureBuiltins() {
  for (const s of BUILTIN_SOURCES) {
    const exist = await prisma.promptSource.findFirst({ where: { name: s.name, builtIn: true } })
    if (!exist) {
      await prisma.promptSource.create({ data: { name: s.name, url: s.url, homepage: s.homepage, builtIn: s.builtIn } })
    }
  }
}

// 封面转存 OSS（2026-08-10：外链封面 → 我们 OSS，防链接失效裂图）
async function migrateCover(url: string, prefix: string): Promise<string> {
  if (!url || !/^https?:\/\//.test(url) || url.includes('aliyuncs.com')) return url
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(20000) })
    if (!res.ok) return url
    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.length < 100) return url
    const m = url.split('?')[0].match(/\.(png|jpe?g|webp|gif|svg|avif)/i)
    const ext = (m ? m[1] : 'jpg').toLowerCase()
    const key = `prompt-covers/${prefix}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`
    const { getOSSClient } = await import('@/lib/oss')
    const client = await getOSSClient()
    await client.put(key, buf, { headers: { 'x-oss-object-acl': 'public-read' } })
    return `https://${process.env.OSS_BUCKET}.${process.env.OSS_REGION}.aliyuncs.com/${key}`
  } catch { return url }
}

// 同步单个源：拉 JSON → 按 sourceKey 去重入库 → 更新状态/条数
export async function syncSource(sourceId: number): Promise<{ added: number; skipped: number; error?: string }> {
  const src = await prisma.promptSource.findUnique({ where: { id: sourceId } })
  if (!src) return { added: 0, skipped: 0, error: '源不存在' }
  try {
    const res = await fetch(src.url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(90000) })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const items = await res.json()
    if (!Array.isArray(items)) throw new Error('JSON 非数组')
    let added = 0, skipped = 0
    for (const it of items) {
      try {
        const prompt = String(it.prompt || '').trim()
        if (!prompt) { skipped++; continue }
        const key = String(it.id || `${src.name}:${it.title || prompt.substring(0, 20)}`)
        const exist = await prisma.promptTemplate.findFirst({ where: { sourceKey: key } })
        if (exist) { skipped++; continue }
        await prisma.promptTemplate.create({
          data: {
            title: String(it.title || '').substring(0, 120) || null,
            prompt,
            category: String(it.tags?.join(',') || it.category || '').substring(0, 200) || null,
            previewUrl: String(it.coverUrl || '') || null,
            industry: String(it.sourceId || src.name) || null,
            // industry 存 sourceId（如 banana-prompt-quicker），与旧 prompt-sync 数据一致
            coverUrl: String(it.coverUrl || '') ? await migrateCover(String(it.coverUrl), String(src.name).replace(/[^a-zA-Z0-9]+/g, '-').substring(0, 30)) : null,
            originalUrl: String(it.sourceUrl || '') || null,
            tags: Array.isArray(it.tags) ? it.tags.join(',').substring(0, 200) : (String(it.tags || '') || null),
            author: String(it.author || '').substring(0, 100) || null,
            imageMode: String(it.imageMode || '') || null,
            sourceKey: key,
          },
        })
        added++
      } catch { skipped++ }
    }
    const sourceIds = Array.from(new Set(items.map((i: any) => String(i.sourceId || src.name)).filter(Boolean)))
    const total = sourceIds.length ? (await prisma.promptTemplate.groupBy({ by: ['industry'], where: { industry: { in: sourceIds } }, _count: { _all: true } })).reduce((s, g) => s + g._count._all, 0) : 0
    await prisma.promptSource.update({ where: { id: sourceId }, data: { lastSyncAt: new Date(), lastStatus: 'success', lastError: null, itemCount: total } })
    return { added, skipped }
  } catch (e: any) {
    await prisma.promptSource.update({ where: { id: sourceId }, data: { lastStatus: 'error', lastError: String(e?.message || e).substring(0, 200) } })
    return { added: 0, skipped: 0, error: String(e?.message || e).substring(0, 100) }
  }
}

// 定时器：每 5 分钟检查 enabled 且 intervalMin>0 的源，距上次同步超过间隔则自动拉（服务端长驻进程有效）
let timerStarted = false
function startTimer() {
  if (timerStarted) return
  timerStarted = true
  setInterval(async () => {
    try {
      const due = await prisma.promptSource.findMany({
        where: { enabled: true, intervalMin: { gt: 0 } },
        select: { id: true, intervalMin: true, lastSyncAt: true },
      })
      for (const d of due) {
        const dueMs = d.intervalMin * 60 * 1000
        if (!d.lastSyncAt || Date.now() - d.lastSyncAt.getTime() >= dueMs) {
          syncSource(d.id).catch(() => {})
          await sleep(1500)
        }
      }
    } catch {}
  }, 5 * 60 * 1000)
}

async function init() {
  await ensureBuiltins()
  startTimer()
}
init().catch(() => {})

// GET 源列表
export async function GET(req: NextRequest) {
  const auth = getAuthFromHeaders(req)
  if (auth?.role !== 'admin') return NextResponse.json({ success: false, message: '仅管理员' }, { status: 403 })
  await ensureBuiltins()
  const list = await prisma.promptSource.findMany({ orderBy: [{ builtIn: 'desc' }, { id: 'asc' }] })
  return NextResponse.json({ success: true, data: { list } })
}

// POST 操作：{action: add|update|delete|refresh|sync-all|schedule}
export async function POST(req: NextRequest) {
  const auth = getAuthFromHeaders(req)
  if (auth?.role !== 'admin') return NextResponse.json({ success: false, message: '仅管理员' }, { status: 403 })
  let body: any = {}
  try { body = await req.json() } catch {}
  const action = body.action || 'add'
  if (action === 'add') {
    const name = (body.name || '').trim()
    const url = (body.url || '').trim()
    if (!name || !url) return NextResponse.json({ success: false, message: '缺少 name/url' }, { status: 400 })
    const src = await prisma.promptSource.create({ data: { name, url, homepage: body.homepage || null, builtIn: false } })
    const r = await syncSource(src.id)
    return NextResponse.json({ success: true, data: { id: src.id, ...r } })
  }
  if (action === 'update') {
    const id = parseInt(body.id || '0')
    if (!id) return NextResponse.json({ success: false, message: '缺少 id' }, { status: 400 })
    const data: any = {}
    if (body.name) data.name = String(body.name).trim()
    if (body.url) data.url = String(body.url).trim()
    if (body.homepage !== undefined) data.homepage = body.homepage || null
    if (body.enabled !== undefined) data.enabled = !!body.enabled
    if (body.intervalMin !== undefined) data.intervalMin = parseInt(body.intervalMin) || 0
    await prisma.promptSource.update({ where: { id }, data })
    return NextResponse.json({ success: true })
  }
  if (action === 'delete') {
    const id = parseInt(body.id || '0')
    if (!id) return NextResponse.json({ success: false, message: '缺少 id' }, { status: 400 })
    await prisma.promptSource.delete({ where: { id } })
    return NextResponse.json({ success: true })
  }
  if (action === 'refresh') {
    const id = parseInt(body.id || '0')
    if (!id) return NextResponse.json({ success: false, message: '缺少 id' }, { status: 400 })
    const r = await syncSource(id)
    return NextResponse.json({ success: !r.error, data: r })
  }
  if (action === 'migrate-covers') {
    // 补转存量记录封面到 OSS（异步后台跑，不阻塞响应）
    const rows = await prisma.promptTemplate.findMany({
      where: { coverUrl: { not: null } },
      select: { id: true, coverUrl: true },
      take: 5000,
    })
    const pending = rows.filter(r => r.coverUrl && !r.coverUrl.includes('aliyuncs.com'))
    ;(async () => {
      let done = 0
      for (const r of pending) {
        try {
          const oss = await migrateCover(r.coverUrl!, 'legacy')
          if (oss !== r.coverUrl) await prisma.promptTemplate.update({ where: { id: r.id }, data: { coverUrl: oss } })
        } catch {}
        done++
        if (done % 20 === 0) await sleep(500)
      }
    })().catch(() => {})
    return NextResponse.json({ success: true, message: `开始补转 ${pending.length} 张封面到 OSS（后台执行）` })
  }
  if (action === 'sync-all') {
    const list = await prisma.promptSource.findMany({ where: { enabled: true } })
    const results: any[] = []
    for (const s of list) {
      const r = await syncSource(s.id)
      results.push({ id: s.id, name: s.name, ...r })
      await sleep(1500)
    }
    return NextResponse.json({ success: true, data: { results } })
  }
  return NextResponse.json({ success: false, message: '未知 action' }, { status: 400 })
}
