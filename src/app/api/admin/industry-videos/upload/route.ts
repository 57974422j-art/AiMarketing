import { NextRequest, NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client'
import { getAuthFromHeaders } from '@/lib/api-auth'
import { getOSSClient } from '@/lib/oss'

const prisma = new PrismaClient()

/** 行业视频上传（2026-08-09）：yt_dlp_fetch.py multipart 上传 → ffmpeg 截首帧 → OSS 私有转存 → 入库 */
export async function POST(request: NextRequest) {
  const auth = getAuthFromHeaders(request)
  if (!auth || auth.role !== 'admin') return NextResponse.json({ success: false, message: '仅管理员' }, { status: 403 })
  try {
    const form = await request.formData()
    const file = form.get('file') as File | null
    const industry = String(form.get('industry') || '')
    const title = String(form.get('title') || '')
    const keyword = String(form.get('keyword') || '')
    const duration = parseInt(String(form.get('duration') || '0'), 10) || null
    if (!file || !industry) return NextResponse.json({ success: false, message: '缺少文件/行业' }, { status: 400 })

    const buf = Buffer.from(await file.arrayBuffer())
    if (buf.length < 1024) return NextResponse.json({ success: false, message: '文件过小' }, { status: 400 })

    const client = await getOSSClient()
    const day = new Date().toISOString().slice(0, 10).replace(/-/g, '')
    const id = Date.now().toString(36)
    const keyV = `industry-videos/${day}/${id}.mp4`

    // 先存临时文件 → 截帧 → 上传 OSS 私有
    const os = require('os'), path = require('path'), fs = require('fs'), { execFileSync } = require('child_process')
    const tmp = path.join(os.tmpdir(), `indv_${id}.mp4`)
    fs.writeFileSync(tmp, buf)
    let coverKey = ''
    try {
      const coverTmp = path.join(os.tmpdir(), `indv_${id}.jpg`)
      execFileSync('ffmpeg', ['-y', '-i', tmp, '-frames:v', '1', '-q:v', '3', coverTmp], { timeout: 60000 })
      if (fs.existsSync(coverTmp)) {
        const keyC = `industry-videos/${day}/${id}.jpg`
        await client.put(keyC, fs.readFileSync(coverTmp))
        coverKey = keyC
        fs.unlinkSync(coverTmp)
      }
    } catch {}
    await client.put(keyV, buf)
    fs.unlinkSync(tmp)

    const row = await prisma.industryVideo.create({
      data: { industry, title: title || keyword || '视频', videoUrl: keyV, coverUrl: coverKey || null, source: 'youtube', duration, keyword: keyword || null },
    })
    return NextResponse.json({ success: true, data: { id: row.id, title: row.title } })
  } catch (e: any) {
    return NextResponse.json({ success: false, message: e.message }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
