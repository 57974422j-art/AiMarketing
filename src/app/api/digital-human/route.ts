import { NextRequest, NextResponse } from 'next/server'
import { createDigitalHuman, queryDigitalHumanTask, generateDigitalHumanVideo } from '@/lib/ai-providers'
import { writeFile, mkdir, unlink } from 'fs/promises'
import { join } from 'path'
import { existsSync } from 'fs'
import { execSync } from 'child_process'
import { getAuthFromHeaders } from '@/lib/api-auth'
import { PrismaClient } from '@prisma/client'
import OSS from 'ali-oss'

export const runtime = 'nodejs'
const prisma = new PrismaClient()

function ossClient() {
  if (!process.env.OSS_ACCESS_KEY_ID || !process.env.OSS_BUCKET) throw new Error('OSS未配置')
  return new OSS({
    region: process.env.OSS_REGION || 'oss-cn-hangzhou',
    accessKeyId: process.env.OSS_ACCESS_KEY_ID,
    accessKeySecret: process.env.OSS_ACCESS_KEY_SECRET,
    bucket: process.env.OSS_BUCKET,
    secure: true, timeout: 300000,
  })
}

/** 上传文件到 OSS，返回公开 URL */
async function uploadOSS(fileOrPath: File | string, ext: string): Promise<string> {
  const oss = ossClient()
  const key = `dh/${Date.now()}_${Math.random().toString(36).substring(2, 6)}.${ext}`
  if (typeof fileOrPath === 'string') {
    await oss.put(key, fileOrPath, { headers: { 'x-oss-object-acl': 'public-read' } })
  } else {
    const buf = Buffer.from(await fileOrPath.arrayBuffer())
    await oss.put(key, buf, { headers: { 'x-oss-object-acl': 'public-read' } })
  }
  return `https://${process.env.OSS_BUCKET}.${process.env.OSS_REGION || 'oss-cn-hangzhou'}.aliyuncs.com/${key}`
}

/** TTS 文本→MP3 到 OSS */
async function synthesizeTTS(text: string): Promise<string> {
  const tmpDir = join(process.cwd(), 'temp')
  if (!existsSync(tmpDir)) await mkdir(tmpDir, { recursive: true })
  const tmp = join(tmpDir, `tts_${Date.now()}.mp3`)
  execSync(`edge-tts --voice zh-CN-XiaoxiaoNeural --text "${text.replace(/["$'`\\]/g, '')}" --write-media ${tmp}`, { timeout: 30000, shell: '/bin/bash' })
  const url = await uploadOSS(tmp, 'mp3')
  await unlink(tmp).catch(() => {})
  return url
}

export async function POST(request: NextRequest) {
  const auth = getAuthFromHeaders(request)
  if (!auth) return NextResponse.json({ success: false, message: '请先登录' }, { status: 401 })

  try {
    const ct = request.headers.get('content-type') || ''

    if (ct.includes('multipart/form-data')) {
      const fd = await request.formData()
      const img = fd.get('image') as File | null
      const aud = fd.get('audio') as File | null
      if (!img || !aud) return NextResponse.json({ success: false, message: '请上传照片和音频' }, { status: 400 })
      const iu = await uploadOSS(img, 'png')
      const au = await uploadOSS(aud, 'mp3')
      const r = await createDigitalHuman(au, iu)
      return r ? NextResponse.json({ success: true, taskId: r.taskId }) : NextResponse.json({ success: false, message: '提交失败' }, { status: 500 })
    }

    const body = await request.json()
    const { action } = body

    if (action === 'list') {
      const items = await prisma.promptTemplate.findMany({
        where: { category: '数字人' },
        select: { id: true, title: true, previewUrl: true },
        orderBy: { id: 'asc' },
      })
      const list = items.map(i => ({ id: String(i.id), name: i.title, imageUrl: i.previewUrl || '' }))
      return NextResponse.json({ success: true, data: list })
    }

    if (action === 'avatar-speak') {
      const { avatarId, text } = body
      if (!avatarId || !text) return NextResponse.json({ success: false, message: '缺少参数' }, { status: 400 })
      const tmpl = await prisma.promptTemplate.findFirst({
        where: { category: '数字人', id: parseInt(avatarId) },
        select: { previewUrl: true },
      })
      if (!tmpl?.previewUrl) return NextResponse.json({ success: false, message: '形象未生成预览图，请后台先点「预览图」' }, { status: 400 })
      const au = await synthesizeTTS(text)
      const r = await createDigitalHuman(au, tmpl.previewUrl)
      return r ? NextResponse.json({ success: true, taskId: r.taskId }) : NextResponse.json({ success: false, message: '提交失败' }, { status: 500 })
    }

    if (action === 'query') {
      const { taskId } = body
      if (!taskId) return NextResponse.json({ success: false, message: '缺少 taskId' }, { status: 400 })
      const r = await queryDigitalHumanTask(taskId)
      return NextResponse.json({ success: true, ...r })
    }

    // 转存视频到本地
    if (action === 'save') {
      const { videoUrl, title } = body
      if (!videoUrl) return NextResponse.json({ success: false, message: '缺少视频URL' }, { status: 400 })
      const resp = await fetch(videoUrl)
      if (!resp.ok) return NextResponse.json({ success: false, message: '下载失败' }, { status: 400 })
      const buf = Buffer.from(await resp.arrayBuffer())
      const dir = join(process.cwd(), 'public', 'dh')
      if (!existsSync(dir)) await mkdir(dir, { recursive: true })
      const fn = `save_${Date.now()}.mp4`
      await writeFile(join(dir, fn), buf)
      const host = request.headers.get('host') || 'localhost:3000'
      const localUrl = `http://${host}/dh/${fn}`
      await prisma.mediaAsset.create({
        data: { title: title || '数字人口播', url: localUrl, type: 'video', ownerId: auth.userId },
      })
      return NextResponse.json({ success: true, url: localUrl })
    }

    if (action === 'generate') {
      const { avatarId, text } = body
      if (!avatarId || !text) return NextResponse.json({ success: false, message: '缺少参数' }, { status: 400 })
      const r = await generateDigitalHumanVideo(avatarId, text)
      return r ? NextResponse.json({ success: true, taskId: r.taskId }) : NextResponse.json({ success: false, message: '失败' }, { status: 500 })
    }

    return NextResponse.json({ success: false, message: '未知action' }, { status: 400 })
  } catch (e: any) {
    console.error('[数字人]', e)
    return NextResponse.json({ success: false, message: e.message }, { status: 500 })
  }
}
