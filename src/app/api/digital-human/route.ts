import { NextRequest, NextResponse } from 'next/server'
import { createDigitalHuman, queryDigitalHumanTask, generateDigitalHumanVideo, enrollVoice, synthesizeVoiceTTS } from '@/lib/ai-providers'
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
  if (!process.env.OSS_ACCESS_KEY_ID || !process.env.OSS_ACCESS_KEY_SECRET || !process.env.OSS_BUCKET) throw new Error('OSS未配置')
  return new OSS({
    region: process.env.OSS_REGION || 'oss-cn-hangzhou',
    accessKeyId: process.env.OSS_ACCESS_KEY_ID!,
    accessKeySecret: process.env.OSS_ACCESS_KEY_SECRET!,
    bucket: process.env.OSS_BUCKET!,
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
      const audUrl = fd.get('audio_url') as string | null
      if (!img) return NextResponse.json({ success: false, message: '请上传照片' }, { status: 400 })
      if (!aud && !audUrl) return NextResponse.json({ success: false, message: '请上传音频或提供音频URL' }, { status: 400 })

      const tmpDir = join(process.cwd(), 'temp')
      if (!existsSync(tmpDir)) await mkdir(tmpDir, { recursive: true })

      // 图片
      const tmpImg = join(tmpDir, `img_${Date.now()}`)
      await writeFile(tmpImg, new Uint8Array(await img.arrayBuffer()))
      execSync(`ffmpeg -y -i ${tmpImg} ${tmpImg}.jpg 2>/dev/null`)
      const imgUrl = await uploadOSS(tmpImg + '.jpg', 'jpg')
      await unlink(tmpImg).catch(() => {})

      // 音频：克隆合成URL or 直传文件
      let finalAudUrl: string
      if (audUrl) {
        finalAudUrl = audUrl
      } else {
        const tmpAud = join(tmpDir, `aud_${Date.now()}`)
        const tmpAudOut = join(tmpDir, `aud_${Date.now()}.mp3`)
        await writeFile(tmpAud, new Uint8Array(await aud!.arrayBuffer()))
        execSync(`ffmpeg -y -i ${tmpAud} -codec:a libmp3lame -q:a 2 ${tmpAudOut} 2>/dev/null`)
        finalAudUrl = await uploadOSS(tmpAudOut, 'mp3')
        await unlink(tmpAud).catch(() => {})
        await unlink(tmpAudOut).catch(() => {})
      }
      await unlink(tmpImg + '.jpg').catch(() => {})

      const r = await createDigitalHuman(finalAudUrl, imgUrl)
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
      console.log('[数字人-avatar] 开始TTS, 文案长度:', text.length)
      const au = await synthesizeTTS(text)
      console.log('[数字人-avatar] TTS完成, audio_url:', au.substring(0, 80))
      const r = await createDigitalHuman(au, tmpl.previewUrl)
      console.log('[数字人-avatar] 结果:', r ? `taskId=${r.taskId}` : 'NULL')
      return r ? NextResponse.json({ success: true, taskId: r.taskId }) : NextResponse.json({ success: false, message: '提交失败' }, { status: 500 })
    }

    if (action === 'query') {
      const { taskId } = body
      if (!taskId) return NextResponse.json({ success: false, message: '缺少 taskId' }, { status: 400 })
      const r = await queryDigitalHumanTask(taskId)
      return NextResponse.json({ success: true, ...r })
    }

    // 声音注册（克隆）
    if (action === 'voice-enroll') {
      const { audioUrl, prefix } = body
      if (!audioUrl) return NextResponse.json({ success: false, message: '缺少音频URL' }, { status: 400 })
      const r = await enrollVoice(audioUrl, prefix || `user_${auth.userId}`)
      return r ? NextResponse.json({ success: true, voiceId: r.voiceId }) : NextResponse.json({ success: false, message: '声音注册失败' }, { status: 500 })
    }

    // 用克隆声音合成音频
    if (action === 'voice-synthesize') {
      const { voiceId, text } = body
      if (!voiceId || !text) return NextResponse.json({ success: false, message: '缺少参数' }, { status: 400 })
      const r = await synthesizeVoiceTTS(voiceId, text)
      if (!r) return NextResponse.json({ success: false, message: '合成失败' }, { status: 500 })
      // 下载合成的音频并上传到OSS（因为合成返回的URL可能是临时的）
      const resp = await fetch(r.audioUrl)
      if (!resp.ok) return NextResponse.json({ success: false, message: '下载合成音频失败' }, { status: 502 })
      const tmpDir = join(process.cwd(), 'temp')
      if (!existsSync(tmpDir)) await mkdir(tmpDir, { recursive: true })
      const tmp = join(tmpDir, `tts_${Date.now()}.mp3`)
      await writeFile(tmp, new Uint8Array(await resp.arrayBuffer()))
      const audUrl = await uploadOSS(tmp, 'mp3')
      await unlink(tmp).catch(() => {})
      return NextResponse.json({ success: true, audioUrl: audUrl })
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
