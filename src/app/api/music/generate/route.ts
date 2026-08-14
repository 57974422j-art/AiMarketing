import { NextRequest, NextResponse } from 'next/server'
import { getAuthFromHeaders } from '@/lib/api-auth'
import { generateMusic } from '@/lib/minimax-music'
import { putObject } from '@/lib/oss'
import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

// POST /api/music/generate - AI 生成背景音乐（Minimax music-3.0）
export async function POST(request: NextRequest) {
  const auth = getAuthFromHeaders(request)
  if (!auth) return NextResponse.json({ success: false, message: '请登录' }, { status: 401 })
  try {
    const body = await request.json().catch(() => ({}))
    const prompt = String(body?.prompt || '').trim()
    if (!prompt) return NextResponse.json({ success: false, message: '请输入音乐风格描述（如：欢快的电子音乐背景乐）' }, { status: 400 })
    if (prompt.length > 2000) return NextResponse.json({ success: false, message: '描述过长（≤2000 字符）' }, { status: 400 })
    const result = await generateMusic(prompt)
    if (!result.ok || !result.buffer) {
      return NextResponse.json({
        success: false,
        message: result.error || '生成失败',
        needsPayment: result.needsPayment || false,
      }, { status: result.needsPayment ? 402 : 500 })
    }
    // 2026-08-14: 上传 OSS + 入库 MediaAsset（type=audio / category=music）
    const fileName = `music-${Date.now()}-${Math.floor(Math.random() * 1000)}.mp3`
    const ossKey = `music/${auth.userId}/${fileName}`
    try {
      await putObject(ossKey, result.buffer, 'audio/mpeg')
    } catch (e: any) {
      return NextResponse.json({ success: false, message: 'OSS 上传失败: ' + (e?.message || e) }, { status: 500 })
    }
    const ossUrl = `https://${process.env.OSS_BUCKET || ''}.${process.env.OSS_REGION || 'oss-cn-hangzhou'}.aliyuncs.com/${ossKey}`
    const asset = await prisma.mediaAsset.create({
      data: {
        title: fileName,
        ossUrl,
        type: 'audio',
        prompt,
        category: 'music',
        source: 'private',
        ownerId: auth.userId,
      },
    })
    return NextResponse.json({ success: true, url: ossUrl, id: asset.id, title: fileName, poweredBy: 'Minimax music-3.0' })
  } catch (e: any) {
    return NextResponse.json({ success: false, message: e?.message || '生成失败' }, { status: 500 })
  }
}

export const runtime = 'nodejs'
