import { NextRequest, NextResponse } from 'next/server'
import { createDigitalHuman, queryDigitalHumanTask, generateDigitalHumanVideo, enrollVoice, synthesizeVoiceTTS } from '@/lib/ai-providers'
import { writeFile, mkdir, unlink } from 'fs/promises'
import { join } from 'path'
import { existsSync } from 'fs'
import { execSync } from 'child_process'
import { getAuthFromHeaders } from '@/lib/api-auth'
import { PrismaClient } from '@prisma/client'
import OSS from 'ali-oss'
import { checkTokens, TOKEN_COSTS } from '@/lib/token-wallet'
import {
  createRecord, attachTaskId, finalizeSuccess, finalizeFailure,
  finalizeSuccessByTaskId, finalizeFailureByTaskId,
} from '@/lib/generation-record'

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
  execSync(`edge-tts --voice zh-CN-XiaoxiaoNeural --text "${text.replace(/["$'`\\]/g, '')}" --write-media ${tmp}`, { timeout: 30000, shell: process.platform === 'win32' ? undefined : '/bin/bash' })
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

      // 点数前置检查（成功后才真正扣款）
      const tc = await checkTokens(auth.userId, TOKEN_COSTS.DH_VIDEO)
      if (!tc.allowed) return NextResponse.json({ success: false, message: tc.message, wallet: tc.wallet }, { status: 403 })

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
      // 生成记录：异步任务落 pending，query 到成功时再扣款+转存
      const recId = await createRecord({
        userId: auth.userId, type: 'digital_human', provider: 'dashscope', model: 'liveportrait',
        prompt: '照片+音频生成口播', sourceUrl: imgUrl, costPoints: TOKEN_COSTS.DH_VIDEO,
      })
      if (r?.taskId) await attachTaskId(recId, r.taskId)
      else await finalizeFailure(recId, '千寻提交失败（检查百炼 liveportrait 服务是否开通）')
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

      // 点数前置检查（成功后才真正扣款）
      const tc = await checkTokens(auth.userId, TOKEN_COSTS.DH_VIDEO)
      if (!tc.allowed) return NextResponse.json({ success: false, message: tc.message, wallet: tc.wallet }, { status: 403 })

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
      const recId = await createRecord({
        userId: auth.userId, type: 'digital_human', provider: 'dashscope', model: 'liveportrait',
        prompt: text, sourceUrl: tmpl.previewUrl, costPoints: TOKEN_COSTS.DH_VIDEO,
      })
      if (r?.taskId) await attachTaskId(recId, r.taskId)
      else await finalizeFailure(recId, '千寻提交失败（检查百炼 liveportrait 服务是否开通）')
      return r ? NextResponse.json({ success: true, taskId: r.taskId }) : NextResponse.json({ success: false, message: '提交失败' }, { status: 500 })
    }

    if (action === 'query') {
      const { taskId } = body
      if (!taskId) return NextResponse.json({ success: false, message: '缺少 taskId' }, { status: 400 })
      const r = await queryDigitalHumanTask(taskId)
      // 成功后扣款结算（原子认领，轮询多次只扣一次）；失败不扣款
      // 千寻返回字段为 avatarUrl（最终视频/形象资源 URL）
      if (r?.avatarUrl) {
        const storageKey = await finalizeSuccessByTaskId(taskId, r.avatarUrl)
        if (storageKey) console.log(`[数字人][查询] 已结算扣款并转存 OSS: ${storageKey}`)
      } else if ((r?.status || '').toUpperCase().includes('FAIL')) {
        await finalizeFailureByTaskId(taskId, `千寻任务失败 status=${r?.status}`)
      }
      return NextResponse.json({ success: true, ...r })
    }

    // 声音注册（克隆）
    if (action === 'voice-enroll') {
      const { audioUrl, prefix } = body
      if (!audioUrl) return NextResponse.json({ success: false, message: '缺少音频URL' }, { status: 400 })

      const tc = await checkTokens(auth.userId, TOKEN_COSTS.VOICE_ENROLL)
      if (!tc.allowed) return NextResponse.json({ success: false, message: tc.message, wallet: tc.wallet }, { status: 403 })

      const recId = await createRecord({
        userId: auth.userId, type: 'voice_clone', provider: 'dashscope', model: 'cosyvoice-clone',
        prompt: `声音注册 prefix=${prefix || `user_${auth.userId}`}`, sourceUrl: audioUrl,
      })
      const r = await enrollVoice(audioUrl, prefix || `user_${auth.userId}`)
      if (r?.voiceId) {
        // 同步成功：扣款（声音注册无资源文件，跳过 OSS 转存）
        await finalizeSuccess(recId, auth.userId, {
          platformUrl: '', costPoints: TOKEN_COSTS.VOICE_ENROLL, reason: 'voice_enroll', skipOssBackup: true,
        })
      } else {
        await finalizeFailure(recId, '声音注册失败')
      }
      return r ? NextResponse.json({ success: true, voiceId: r.voiceId }) : NextResponse.json({ success: false, message: '声音注册失败' }, { status: 500 })
    }

    // 用克隆声音合成音频
    if (action === 'voice-synthesize') {
      const { voiceId, text } = body
      if (!voiceId || !text) return NextResponse.json({ success: false, message: '缺少参数' }, { status: 400 })

      const tc = await checkTokens(auth.userId, TOKEN_COSTS.VOICE_TTS)
      if (!tc.allowed) return NextResponse.json({ success: false, message: tc.message, wallet: tc.wallet }, { status: 403 })

      const recId = await createRecord({
        userId: auth.userId, type: 'voice_tts', provider: 'dashscope', model: 'cosyvoice',
        prompt: text, costPoints: TOKEN_COSTS.VOICE_TTS,
      })
      const r = await synthesizeVoiceTTS(voiceId, text)
      if (!r) {
        await finalizeFailure(recId, '合成失败')
        return NextResponse.json({ success: false, message: '合成失败' }, { status: 500 })
      }
      // 下载合成的音频并上传到OSS（因为合成返回的URL可能是临时的）
      const resp = await fetch(r.audioUrl)
      if (!resp.ok) {
        await finalizeFailure(recId, '下载合成音频失败')
        return NextResponse.json({ success: false, message: '下载合成音频失败' }, { status: 502 })
      }
      const tmpDir = join(process.cwd(), 'temp')
      if (!existsSync(tmpDir)) await mkdir(tmpDir, { recursive: true })
      const tmp = join(tmpDir, `tts_${Date.now()}.mp3`)
      await writeFile(tmp, new Uint8Array(await resp.arrayBuffer()))
      const audUrl = await uploadOSS(tmp, 'mp3')
      await unlink(tmp).catch(() => {})
      // 成功后扣款（音频已由上面自行转存 OSS，直接登记地址）
      await finalizeSuccess(recId, auth.userId, {
        platformUrl: r.audioUrl, costPoints: TOKEN_COSTS.VOICE_TTS, reason: 'voice_tts', storageUrlOverride: audUrl,
      })
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

      const tc = await checkTokens(auth.userId, TOKEN_COSTS.DH_VIDEO)
      if (!tc.allowed) return NextResponse.json({ success: false, message: tc.message, wallet: tc.wallet }, { status: 403 })

      const r = await generateDigitalHumanVideo(avatarId, text)
      const recId = await createRecord({
        userId: auth.userId, type: 'digital_human', provider: 'dashscope', model: 'liveportrait',
        prompt: text, costPoints: TOKEN_COSTS.DH_VIDEO,
      })
      if (r?.taskId) await attachTaskId(recId, r.taskId)
      else await finalizeFailure(recId, '数字人视频提交失败')
      return r ? NextResponse.json({ success: true, taskId: r.taskId }) : NextResponse.json({ success: false, message: '失败' }, { status: 500 })
    }

    return NextResponse.json({ success: false, message: '未知action' }, { status: 400 })
  } catch (e: any) {
    console.error('[数字人]', e)
    return NextResponse.json({ success: false, message: e.message }, { status: 500 })
  }
}

// 强制动态渲染：API 路由依赖 request.headers / 鉴权，禁止 Next 在构建期静态预渲染
export const dynamic = 'force-dynamic'
