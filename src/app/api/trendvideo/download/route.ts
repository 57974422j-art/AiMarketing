import { NextRequest, NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client'
import { getAuthFromHeaders } from '@/lib/api-auth'
import { putObject } from '@/lib/oss'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { spawnSync } from 'child_process'

const prisma = new PrismaClient()

export const dynamic = 'force-dynamic'

function detectType(url: string): 'video' | 'image' {
  const clean = url.split('?')[0].split('#')[0]
  const ext = clean.split('.').pop()?.toLowerCase() || ''
  return ['mp4', 'mov', 'avi', 'webm'].includes(ext) ? 'video' : 'image'
}

function ytDlpAvailable(): boolean {
  try {
    const r = spawnSync('yt-dlp', ['--version'], { timeout: 10000 })
    return r.status === 0
  } catch {
    return false
  }
}

/** 构造 OSS 公开访问 URL（媒体库需分享给用户，bucket 应公开读或配自定义域名） */
function publicUrl(key: string): string {
  const bucket = process.env.OSS_BUCKET || ''
  const region = process.env.OSS_REGION || ''
  return `https://${bucket}.${region}.aliyuncs.com/${key}`
}

export async function POST(request: NextRequest) {
  try {
    const auth = getAuthFromHeaders(request)
    if (!auth) return NextResponse.json({ success: false, message: '未认证' }, { status: 401 })
    if (auth.role === 'end-user') return NextResponse.json({ success: false, message: '无权限' }, { status: 403 })

    const { url, title, purpose, industry, platform, imageUrl } = await request.json()
    if (!url || !title) return NextResponse.json({ success: false, message: '缺少 url 或 title' }, { status: 400 })

    const slug = (s: string) => (s || 'general').replace(/[^a-zA-Z0-9一-龥_-]/g, '_')
    const ts = Date.now()
    const dir = path.join(os.tmpdir(), `trendvideo-${ts}`)
    fs.mkdirSync(dir, { recursive: true })

    let videoOssUrl = ''
    let thumbOssUrl = imageUrl || ''
    let videoDownloaded = false

    if (ytDlpAvailable()) {
      const outTpl = path.join(dir, 'video.%(ext)s')
      spawnSync(
        'yt-dlp',
        [
          '-f', 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best',
          '--merge-output-format', 'mp4',
          '--write-thumbnail',
          '--no-playlist',
          '-o', outTpl,
          url,
        ],
        { timeout: 120000, cwd: dir }
      )

      const files = fs.readdirSync(dir)
      const mp4 = files.find(f => f.toLowerCase().endsWith('.mp4'))
      const thumb = files.find(f => /\.(jpg|jpeg|png|webp)$/i.test(f))

      if (mp4) {
        const buf = fs.readFileSync(path.join(dir, mp4))
        const key = `trendvideo/${slug(industry)}/${slug(purpose)}/${ts}.mp4`
        await putObject(key, buf, 'video/mp4')
        videoOssUrl = publicUrl(key)
        videoDownloaded = true
      }
      if (thumb) {
        const buf = fs.readFileSync(path.join(dir, thumb))
        const ext = path.extname(thumb)
        const key = `trendvideo/${slug(industry)}/${slug(purpose)}/${ts}${ext}`
        await putObject(key, buf, `image/${ext.replace('.', '')}`)
        thumbOssUrl = publicUrl(key)
      }
    }

    // 回落：没拿到视频则把封面当主体，类型按封面判定，绝不丢元数据
    const finalOssUrl = videoOssUrl || thumbOssUrl || url
    const finalType = videoOssUrl ? 'video' : detectType(finalOssUrl)

    await prisma.$executeRawUnsafe(
      'INSERT INTO MediaAsset (ossUrl, title, prompt, type, category, source, purpose, industry, platform, thumbnailUrl, originalUrl, ownerId) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      finalOssUrl, title, '', finalType, '趋势采集', 'public',
      purpose || '', industry || '', platform || '', thumbOssUrl, url, auth.userId
    )

    try { fs.rmSync(dir, { recursive: true, force: true }) } catch {}

    return NextResponse.json({
      success: true,
      videoDownloaded,
      ossUrl: finalOssUrl,
      thumbnailUrl: thumbOssUrl,
      message: videoDownloaded ? '视频与真实封面已存入素材库' : '视频下载失败，已存元数据+封面',
    })
  } catch (e: any) {
    console.error(e)
    return NextResponse.json({ success: false, message: e?.message || '服务器错误' }, { status: 500 })
  } finally {
    await prisma.$disconnect()
  }
}
