import { NextRequest, NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client'
import { getAuthFromHeaders } from '@/lib/api-auth'

const prisma = new PrismaClient()

// 校验真是音频（Content-Type 或音频魔数）
function isLikelyAudio(buf: Buffer, ct: string | null): boolean {
  if (ct && ct.startsWith('audio/')) return true
  const head = buf.subarray(0, 8)
  if (head[0] === 0x49 && head[1] === 0x44 && head[2] === 0x33) return true // mp3 ID3
  if (head[0] === 0xff && (head[1] === 0xfb || head[1] === 0xf3 || head[1] === 0xf2)) return true // mp3
  if (head[0] === 0x52 && head[1] === 0x49 && head[2] === 0x46 && head[3] === 0x46) return true // wav RIFF
  if (head[0] === 0x4f && head[1] === 0x67 && head[2] === 0x67 && head[3] === 0x53) return true // ogg
  if (head[4] === 0x66 && head[5] === 0x74 && head[6] === 0x79 && head[7] === 0x70) return true // m4a ftyp
  return false
}

// 转存到阿里云 OSS
async function uploadToOSS(buf: Buffer, ext: string, ct: string): Promise<string | null> {
  const region = process.env.OSS_REGION
  const id = process.env.OSS_ACCESS_KEY_ID
  const secret = process.env.OSS_ACCESS_KEY_SECRET
  const bucket = process.env.OSS_BUCKET
  if (!region || !id || !secret || !bucket) {
    console.log('[BgmUpload][OSS] 未配置')
    return null
  }
  try {
    const OSS = (await import('ali-oss')).default
    const client = new OSS({ region, accessKeyId: id, accessKeySecret: secret, bucket, secure: true })
    const ossName = `bgm/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`
    await client.put(ossName, buf, { headers: { 'x-oss-object-acl': 'public-read', 'Content-Type': ct } })
    const url = `https://${bucket}.${region}.aliyuncs.com/${ossName}`
    console.log(`[BgmUpload][OSS] 上传成功: ${url.substring(0, 70)}`)
    return url
  } catch (e: any) {
    console.log('[BgmUpload][OSS] 上传失败:', e?.message)
    return null
  }
}

export async function POST(req: NextRequest) {
  const auth = getAuthFromHeaders(req)
  if (!auth || auth.role !== 'admin') {
    return NextResponse.json({ error: '需要管理员权限' }, { status: 401 })
  }

  let files: File[] = []
  try {
    const form = await req.formData()
    files = (form.getAll('files') as File[]).filter((f) => f && f.size > 0)
  } catch (e: any) {
    return NextResponse.json({ error: '解析上传失败: ' + (e?.message || '') }, { status: 400 })
  }
  if (files.length === 0) {
    return NextResponse.json({ error: '未收到文件（字段名 files）' }, { status: 400 })
  }

  const details: any[] = []
  let ingested = 0
  let failed = 0
  for (const f of files) {
    try {
      const buf = Buffer.from(await f.arrayBuffer())
      const ct = f.type || null
      if (!isLikelyAudio(buf, ct)) {
        details.push({ name: f.name, ok: false, reason: `非音频 (ct=${ct})` })
        failed++
        continue
      }
      const rawName = f.name || `bgm_${Date.now()}`
      const ext = (rawName.split('.').pop() || 'mp3').toLowerCase()
      const title = rawName.replace(/\.[^.]+$/, '') || '自定义 BGM'
      const ossUrl = await uploadToOSS(buf, ext, ct || 'audio/mpeg')
      if (!ossUrl) {
        details.push({ name: f.name, ok: false, reason: 'OSS 上传失败' })
        failed++
        continue
      }
      // 去重：同名同大小只保留一条
      const existing = await prisma.bgmTrack.findFirst({ where: { url: ossUrl } })
      if (existing) {
        details.push({ name: f.name, ok: false, reason: '已存在(跳过)' })
        continue
      }
      await prisma.bgmTrack.create({ data: { title, mood: 'custom', url: ossUrl, sourceUrl: null } })
      details.push({ name: f.name, ok: true, url: ossUrl })
      ingested++
    } catch (e: any) {
      details.push({ name: f.name, ok: false, reason: e?.message || 'unknown' })
      failed++
    }
  }

  console.log(`[BgmUpload] 完成 ingested=${ingested} failed=${failed}`)
  return NextResponse.json({ ingested, failed, total: files.length, details })
}
