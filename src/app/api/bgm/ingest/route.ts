import { NextRequest, NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client'
import { getAuthFromHeaders } from '@/lib/api-auth'

const prisma = new PrismaClient()

// 内置 Pixabay 免版税 BGM 种子直链（服务器现拉→转存 OSS→落库，避免直链过期）
const SEED_TRACKS: { url: string; title: string; mood: string }[] = [
  {
    url: 'https://cdn.pixabay.com/download/audio/2022/05/27/audio_1808fbf07a.mp3?filename=uplifting-upbeat-corporate-inspiration.mp3',
    title: '轻松愉快',
    mood: 'uplifting',
  },
  {
    url: 'https://cdn.pixabay.com/download/audio/2022/10/25/audio_946bc7ebc8.mp3?filename=acoustic-guitar-soft-instrumental-bg.mp3',
    title: '温柔舒缓',
    mood: 'soft',
  },
  {
    url: 'https://cdn.pixabay.com/download/audio/2022/02/22/audio_d171c86b8d.mp3?filename=electronic-future-beats.mp3',
    title: '电子律动',
    mood: 'electronic',
  },
  {
    url: 'https://cdn.pixabay.com/download/audio/2022/08/02/audio_884fe92c6b.mp3?filename=cinematic-epic-emotional.mp3',
    title: '史诗氛围',
    mood: 'cinematic',
  },
]

// 转存到阿里云 OSS（失败则保留原链，不阻塞入库）
async function uploadToOSS(url: string, kind: 'audio'): Promise<string | null> {
  const region = process.env.OSS_REGION
  const id = process.env.OSS_ACCESS_KEY_ID
  const secret = process.env.OSS_ACCESS_KEY_SECRET
  const bucket = process.env.OSS_BUCKET
  if (!region || !id || !secret || !bucket) {
    console.log('[BgmIngest][OSS] 未配置，保留原链')
    return null
  }
  try {
    const to = 60000
    const resp = await fetch(url, { signal: AbortSignal.timeout(to) })
    if (!resp.ok) {
      console.log(`[BgmIngest][OSS] 下载失败 ${resp.status}`)
      return null
    }
    const buf = Buffer.from(await resp.arrayBuffer())
    const clean = url.split('?')[0]
    const ext = (clean.split('.').pop() || 'mp3').toLowerCase()
    const ct = resp.headers.get('content-type') || 'audio/mpeg'
    const OSS = (await import('ali-oss')).default
    const client = new OSS({ region, accessKeyId: id, accessKeySecret: secret, bucket, secure: true })
    const ossName = `bgm/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`
    await client.put(ossName, buf, { headers: { 'x-oss-object-acl': 'public-read', 'Content-Type': ct } })
    const url2 = `https://${bucket}.${region}.aliyuncs.com/${ossName}`
    console.log(`[BgmIngest][OSS] 转存成功: ${url2.substring(0, 70)}`)
    return url2
  } catch (e: any) {
    console.log('[BgmIngest][OSS] 转存失败，保留原链:', e?.message)
    return null
  }
}

// 校验真是音频（HTTP 200 + 音频 Content-Type 或音频魔数）
function isLikelyAudio(buf: Buffer, ct: string | null): boolean {
  if (ct && ct.startsWith('audio/')) return true
  const head = buf.subarray(0, 8)
  // mp3: ID3 或 0xFFFB / 0xFFF3 / 0xFFF2
  if (head[0] === 0x49 && head[1] === 0x44 && head[2] === 0x33) return true
  if (head[0] === 0xff && (head[1] === 0xfb || head[1] === 0xf3 || head[1] === 0xf2)) return true
  // wav: RIFF....WAVE
  if (head[0] === 0x52 && head[1] === 0x49 && head[2] === 0x46 && head[3] === 0x46) return true
  // ogg: OggS
  if (head[0] === 0x4f && head[1] === 0x67 && head[2] === 0x67 && head[3] === 0x53) return true
  // m4a: ftyp
  if (head[4] === 0x66 && head[5] === 0x74 && head[6] === 0x79 && head[7] === 0x70) return true
  return false
}

async function ingestOne(item: { url: string; title: string; mood: string }) {
  const { url, title, mood } = item
  try {
    // Pixabay CDN 热链保护：带浏览器 UA + Referer 才能拿到 200
    const resp = await fetch(url, {
      signal: AbortSignal.timeout(60000),
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        Referer: 'https://pixabay.com/',
        Accept: '*/*',
      },
    })
    if (!resp.ok) {
      return { url, ok: false, reason: `HTTP ${resp.status}` }
    }
    const buf = Buffer.from(await resp.arrayBuffer())
    const ct = resp.headers.get('content-type')
    if (!isLikelyAudio(buf, ct)) {
      return { url, ok: false, reason: `非音频 (ct=${ct})` }
    }
    const ossUrl = await uploadToOSS(url, 'audio') || url
    const existing = await prisma.bgmTrack.findFirst({ where: { sourceUrl: url } })
    if (existing) {
      return { url, ok: false, reason: '已存在(跳过)' }
    }
    await prisma.bgmTrack.create({
      data: {
        title,
        mood: mood || null,
        url: ossUrl,
        sourceUrl: url,
      },
    })
    return { url, ok: true, stored: ossUrl !== url ? 'oss' : 'origin' }
  } catch (e: any) {
    return { url, ok: false, reason: e?.message || 'unknown' }
  }
}

export async function POST(req: NextRequest) {
  const auth = getAuthFromHeaders(req)
  if (!auth || auth.role !== 'admin') {
    return NextResponse.json({ error: '需要管理员权限' }, { status: 401 })
  }

  let extraUrls: string[] = []
  try {
    const body = await req.json()
    if (Array.isArray(body?.urls)) extraUrls = body.urls.filter((u: any) => typeof u === 'string' && u.trim())
  } catch {
    // 无 body 则用内置种子
  }

  const list = [...SEED_TRACKS]
  for (const u of extraUrls) {
    list.push({ url: u.trim(), title: '自定义 BGM', mood: 'custom' })
  }

  const details: any[] = []
  let ingested = 0
  let skipped = 0
  let failed = 0
  for (const item of list) {
    const r = await ingestOne(item)
    details.push(r)
    if (r.ok) ingested++
    else if (r.reason?.includes('已存在')) skipped++
    else failed++
  }

  console.log(`[BgmIngest] 完成 ingested=${ingested} skipped=${skipped} failed=${failed}`)
  return NextResponse.json({ ingested, skipped, failed, total: list.length, details })
}
