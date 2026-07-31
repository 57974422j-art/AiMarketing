import { NextRequest, NextResponse } from 'next/server'
import { getAuthFromHeaders } from '@/lib/api-auth'
import OSS from 'ali-oss'

export const runtime = 'nodejs'

function ossClient() {
  return new OSS({
    region: process.env.OSS_REGION || 'oss-cn-hangzhou',
    accessKeyId: process.env.OSS_ACCESS_KEY_ID!,
    accessKeySecret: process.env.OSS_ACCESS_KEY_SECRET!,
    bucket: process.env.OSS_BUCKET!,
    secure: true, timeout: 300000,
  })
}

export async function POST(request: NextRequest) {
  const auth = getAuthFromHeaders(request)
  if (!auth) return NextResponse.json({ success: false, message: '请先登录' }, { status: 401 })

  try {
    const fd = await request.formData()
    const audio = fd.get('audio') as File | null
    if (!audio) return NextResponse.json({ success: false, message: '请上传音频' }, { status: 400 })

    const oss = ossClient()
    const key = `dh/voice_${Date.now()}_${Math.random().toString(36).substring(2, 6)}.${audio.name.endsWith('.wav') ? 'wav' : 'mp3'}`
    const buf = Buffer.from(await audio.arrayBuffer())
    await oss.put(key, buf, { headers: { 'x-oss-object-acl': 'public-read' } })
    const url = `https://${process.env.OSS_BUCKET}.${process.env.OSS_REGION || 'oss-cn-hangzhou'}.aliyuncs.com/${key}`
    return NextResponse.json({ success: true, url })
  } catch (e: any) {
    console.error('[upload-audio]', e)
    return NextResponse.json({ success: false, message: e.message }, { status: 500 })
  }
}

// 强制动态渲染：API 路由依赖 request.headers / 鉴权，禁止 Next 在构建期静态预渲染
export const dynamic = 'force-dynamic'
