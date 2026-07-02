import { NextRequest, NextResponse } from 'next/server'
import { createDigitalHuman, queryDigitalHumanTask, generateDigitalHumanVideo } from '@/lib/ai-providers'
import { writeFile, mkdir, unlink } from 'fs/promises'
import { join } from 'path'
import { existsSync } from 'fs'
import { getAuthFromHeaders } from '@/lib/api-auth'

export const runtime = 'nodejs'

/** 保存文件到 public/dh/ 并返回完整 URL */
async function saveToPublic(file: File, ext: string, request: NextRequest): Promise<string> {
  const dhDir = join(process.cwd(), 'public', 'dh')
  if (!existsSync(dhDir)) await mkdir(dhDir, { recursive: true })

  const ts = Date.now()
  const r = Math.random().toString(36).substring(2, 6)
  const filename = `${ts}_${r}.${ext}`
  const filepath = join(dhDir, filename)
  await writeFile(filepath, new Uint8Array(await file.arrayBuffer()))

  // 构造URL：有端口走http，无端口走https
  const host = request.headers.get('host') || 'localhost:3000'
  const proto = host.includes('localhost') || host.includes(':') ? 'http' : 'https'
  const url = `${proto}://${host}/dh/${filename}`
  console.log('[数字人] 视频URL:', url)
  return url
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

      if (!videoFile) {
        return NextResponse.json({ success: false, message: '请上传真人视频' }, { status: 400 })
      }

      const videoUrl = await saveToPublic(videoFile, 'mp4', request)
      let audioUrl = ''
      if (audioFile) {
        audioUrl = await saveToPublic(audioFile, 'mp3', request)
      }

      const result = await createDigitalHuman(audioUrl || videoUrl, videoUrl)
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
