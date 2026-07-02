import { NextRequest, NextResponse } from 'next/server'
import { createDigitalHuman, queryDigitalHumanTask, generateDigitalHumanVideo } from '@/lib/ai-providers'
import { writeFile, mkdir } from 'fs/promises'
import { join } from 'path'
import { existsSync } from 'fs'
import { execSync } from 'child_process'
import { getAuthFromHeaders } from '@/lib/api-auth'

export const runtime = 'nodejs'

/** avatar-dialog 公共形象库（https://help.aliyun.com/zh/model-studio/avatar-dialog-api）
 *  官方只提供了 avatar_id 和名称，未提供头像图片。
 *  实际人物形象在百炼控制台可视化选择，这里用通用头像做入口标识。 */
const PRESET_AVATARS: Record<string, { name: string; imageUrl: string }> = {
  taoji:    { name: '桃叽',  imageUrl: 'https://randomuser.me/api/portraits/women/1.jpg' },
  aria:     { name: 'Aria',  imageUrl: 'https://randomuser.me/api/portraits/women/2.jpg' },
  jiaoyue:  { name: '椒月',  imageUrl: 'https://randomuser.me/api/portraits/women/3.jpg' },
  shian:    { name: '时安',  imageUrl: 'https://randomuser.me/api/portraits/women/4.jpg' },
  meike:    { name: '莓可',  imageUrl: 'https://randomuser.me/api/portraits/women/5.jpg' },
  yanqiu:   { name: '砚秋',  imageUrl: 'https://randomuser.me/api/portraits/women/6.jpg' },
  tangli:   { name: '棠梨',  imageUrl: 'https://randomuser.me/api/portraits/women/7.jpg' },
  xingyao:  { name: '星瑶',  imageUrl: 'https://randomuser.me/api/portraits/women/8.jpg' },
  lengzhou: { name: '棱舟',  imageUrl: 'https://randomuser.me/api/portraits/men/1.jpg' },
  mowen:    { name: '墨翁',  imageUrl: 'https://randomuser.me/api/portraits/men/2.jpg' },
}

/** 保存文件到 public/dh/ 并返回完整URL */
async function saveFileToPublic(file: File, ext: string, request: NextRequest): Promise<string> {
  const dhDir = join(process.cwd(), 'public', 'dh')
  if (!existsSync(dhDir)) await mkdir(dhDir, { recursive: true })
  const filename = `${Date.now()}_${Math.random().toString(36).substring(2, 6)}.${ext}`
  const filepath = join(dhDir, filename)
  await writeFile(filepath, new Uint8Array(await file.arrayBuffer()))
  const host = request.headers.get('host') || 'localhost:3000'
  const proto = host.includes('localhost') || host.includes(':') ? 'http' : 'https'
  return `${proto}://${host}/dh/${filename}`
}

/** TTS 合成音频到 public/dh/ */
function generateAudio(text: string, request: NextRequest): string {
  const dhDir = join(process.cwd(), 'public', 'dh')
  if (!existsSync(dhDir)) { const f = require('fs'); f.mkdirSync(dhDir, { recursive: true }) }
  const filename = `tts_${Date.now()}.mp3`
  const outPath = join(dhDir, filename)
  // 使用 edge-tts 生成音频（免费稳定）
  const safeText = text.replace(/["$'`\\]/g, '')
  execSync(`edge-tts --voice zh-CN-XiaoxiaoNeural --text "${safeText}" --write-media ${outPath}`, { timeout: 30000, shell: '/bin/bash' })
  const host = request.headers.get('host') || 'localhost:3000'
  const proto = host.includes('localhost') || host.includes(':') ? 'http' : 'https'
  return `${proto}://${host}/dh/${filename}`
}

export async function POST(request: NextRequest) {
  const auth = getAuthFromHeaders(request)
  if (!auth) return NextResponse.json({ success: false, message: '请先登录' }, { status: 401 })

  try {
    const contentType = request.headers.get('content-type') || ''

    // 自定义形象上传
    if (contentType.includes('multipart/form-data')) {
      const formData = await request.formData()
      const imageFile = formData.get('image') as File | null
      const audioFile = formData.get('audio') as File | null

      if (!imageFile) return NextResponse.json({ success: false, message: '请上传人物照片' }, { status: 400 })
      if (!audioFile) return NextResponse.json({ success: false, message: '请上传配音音频' }, { status: 400 })

      const imageUrl = await saveFileToPublic(imageFile, 'png', request)
      const audioUrl = await saveFileToPublic(audioFile, 'mp3', request)
      const result = await createDigitalHuman(audioUrl, imageUrl)
      if (!result) return NextResponse.json({ success: false, message: '提交失败' }, { status: 500 })
      return NextResponse.json({ success: true, taskId: result.taskId })
    }

    // JSON 请求
    const body = await request.json()
    const { action } = body

    // 公共形象 + 文案 → 自动TTS + liveportrait合成
    if (action === 'avatar-speak') {
      const { avatarId, text } = body
      if (!avatarId) return NextResponse.json({ success: false, message: '请选择形象' }, { status: 400 })
      if (!text) return NextResponse.json({ success: false, message: '请输入文案' }, { status: 400 })

      const preset = PRESET_AVATARS[avatarId]
      if (!preset) return NextResponse.json({ success: false, message: '形象不存在' }, { status: 400 })

      // TTS 生成音频
      const audioUrl = generateAudio(text, request)
      console.log('[数字人] 公共形象合成:', avatarId, '音频:', audioUrl.substring(0, 60))

      const result = await createDigitalHuman(audioUrl, preset.imageUrl)
      if (!result) return NextResponse.json({ success: false, message: '提交失败' }, { status: 500 })
      return NextResponse.json({ success: true, taskId: result.taskId })
    }

    // 查询任务状态
    if (action === 'query') {
      const { taskId } = body
      if (!taskId) return NextResponse.json({ success: false, message: '缺少 taskId' }, { status: 400 })
      const result = await queryDigitalHumanTask(taskId)
      return NextResponse.json({ success: true, ...result })
    }

    // 生成口播（旧接口兼容）
    if (action === 'generate') {
      const { avatarId, text } = body
      if (!avatarId || !text) return NextResponse.json({ success: false, message: '缺少参数' }, { status: 400 })
      const result = await generateDigitalHumanVideo(avatarId, text)
      if (!result) return NextResponse.json({ success: false, message: '提交失败' }, { status: 500 })
      return NextResponse.json({ success: true, taskId: result.taskId })
    }

    // 获取预设形象列表
    if (action === 'list') {
      const list = Object.entries(PRESET_AVATARS).map(([id, info]) => ({ id, name: info.name, color: info.color, avatar: avatarSvg(info.name, info.color) }))
      return NextResponse.json({ success: true, data: list })
    }

    return NextResponse.json({ success: false, message: '未知 action' }, { status: 400 })
  } catch (error) {
    console.error('[数字人] 错误:', error)
    return NextResponse.json({ success: false, message: error instanceof Error ? error.message : '处理失败' }, { status: 500 })
  }
}
