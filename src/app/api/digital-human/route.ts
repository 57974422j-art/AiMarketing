import { NextRequest, NextResponse } from 'next/server'
import { createDigitalHuman, queryDigitalHumanTask, generateDigitalHumanVideo } from '@/lib/ai-providers'
import { writeFile, mkdir, unlink } from 'fs/promises'
import { join } from 'path'
import { existsSync } from 'fs'
import { getAuthFromHeaders } from '@/lib/api-auth'
import OSS from 'ali-oss'

export const runtime = 'nodejs'

function createOSSClient() {
  const region = process.env.OSS_REGION || 'oss-cn-hangzhou'
  const accessKeyId = process.env.OSS_ACCESS_KEY_ID
  const accessKeySecret = process.env.OSS_ACCESS_KEY_SECRET
  const bucket = process.env.OSS_BUCKET
  if (!accessKeyId || !accessKeySecret || !bucket) throw new Error('OSS 配置不完整')
  return new OSS({ region, accessKeyId, accessKeySecret, bucket, secure: true, timeout: 300000 })
}

function genOSSKey(ext: string): string {
  const ts = Date.now()
  const r = Math.random().toString(36).substring(2, 8)
  return `digital-human/${ts}_${r}.${ext}`
}

async function uploadToOSS(filePath: string, ext: string): Promise<string | null> {
  try {
    const client = createOSSClient()
    const objectName = genOSSKey(ext)
    const bucket = process.env.OSS_BUCKET || ''
    await client.put(objectName, filePath, { headers: { 'x-oss-object-acl': 'public-read' } })
    const region = process.env.OSS_REGION || 'oss-cn-hangzhou'
    return `https://${bucket}.${region}.aliyuncs.com/${objectName}`
  } catch (error) {
    console.error('[数字人 OSS] 上传失败:', error)
    return null
  }
}

export async function POST(request: NextRequest) {
  const auth = getAuthFromHeaders(request)
  if (!auth) return NextResponse.json({ success: false, message: '请先登录' }, { status: 401 })

  try {
    const contentType = request.headers.get('content-type') || ''

    // 文件上传 + 提交训练
    if (contentType.includes('multipart/form-data')) {
      const formData = await request.formData()
      const videoFile = formData.get('video') as File | null
      const audioFile = formData.get('audio') as File | null
      const mode = (formData.get('mode') as string) || 'fast'

      if (!videoFile) {
        return NextResponse.json({ success: false, message: '请上传真人视频' }, { status: 400 })
      }

      const tempDir = join(process.cwd(), 'temp')
      if (!existsSync(tempDir)) await mkdir(tempDir, { recursive: true })

      const timestamp = Date.now()
      const videoPath = join(tempDir, `dh_video_${timestamp}.mp4`)
      await writeFile(videoPath, new Uint8Array(await videoFile.arrayBuffer()))

      let audioPath = ''
      if (audioFile) {
        audioPath = join(tempDir, `dh_audio_${timestamp}.mp3`)
        await writeFile(audioPath, new Uint8Array(await audioFile.arrayBuffer()))
      }

      // 上传到 OSS
      const videoUrl = await uploadToOSS(videoPath, 'mp4')
      if (!videoUrl) {
        await unlink(videoPath).catch(() => {})
        return NextResponse.json({ success: false, message: '视频上传 OSS 失败' }, { status: 500 })
      }

      let audioUrl = ''
      if (audioPath) {
        audioUrl = (await uploadToOSS(audioPath, 'mp3')) || ''
        await unlink(audioPath).catch(() => {})
      }

      // 提交训练
      const result = await createDigitalHuman(audioUrl || videoUrl, videoUrl, mode as 'fast' | 'pro')
      await unlink(videoPath).catch(() => {})

      if (!result) {
        return NextResponse.json({ success: false, message: '提交形象克隆任务失败' }, { status: 500 })
      }

      return NextResponse.json({ success: true, taskId: result.taskId })
    }

    // JSON 请求
    const body = await request.json()
    const { action } = body

    if (action === 'query') {
      const { taskId } = body
      if (!taskId) return NextResponse.json({ success: false, message: '缺少 taskId' }, { status: 400 })
      const result = await queryDigitalHumanTask(taskId)
      return NextResponse.json({ success: true, ...result })
    }

    if (action === 'generate') {
      const { avatarId, text, background } = body
      if (!avatarId || !text) {
        return NextResponse.json({ success: false, message: '缺少 avatarId 或 text' }, { status: 400 })
      }
      const result = await generateDigitalHumanVideo(avatarId, text, background)
      if (!result) {
        return NextResponse.json({ success: false, message: '提交口播生成任务失败' }, { status: 500 })
      }
      return NextResponse.json({ success: true, taskId: result.taskId })
    }

    return NextResponse.json({ success: false, message: '未知 action' }, { status: 400 })
  } catch (error) {
    console.error('[数字人 API] 错误:', error)
    return NextResponse.json({ success: false, message: error instanceof Error ? error.message : '处理失败' }, { status: 500 })
  }
}
