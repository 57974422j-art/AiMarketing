import { NextRequest, NextResponse } from 'next/server'
import { createDigitalHuman, queryDigitalHumanTask, generateDigitalHumanVideo } from '@/lib/ai-providers'
import { writeFile, mkdir } from 'fs/promises'
import { join } from 'path'
import { existsSync } from 'fs'
import { execSync } from 'child_process'
import { getAuthFromHeaders } from '@/lib/api-auth'
import { PrismaClient } from '@prisma/client'

export const runtime = 'nodejs'
const prisma = new PrismaClient()

/** 保存到 public/uploads/ */
async function saveToPublic(file: File, ext: string, request: NextRequest, prefix = ''): Promise<string> {
  const dir = join(process.cwd(), 'public', 'uploads')
  if (!existsSync(dir)) await mkdir(dir, { recursive: true })
  const fn = `${prefix}${Date.now()}_${Math.random().toString(36).substring(2, 6)}.${ext}`
  await writeFile(join(dir, fn), new Uint8Array(await file.arrayBuffer()))
  const host = request.headers.get('host') || 'localhost:3000'
  return `http://${host}/uploads/${fn}`
}

/** TTS 文本→MP3 */
function synthesizeTTS(text: string, request: NextRequest): string {
  const dir = join(process.cwd(), 'public', 'uploads')
  if (!existsSync(dir)) { require('fs').mkdirSync(dir, { recursive: true }) }
  const fn = `tts_${Date.now()}.mp3`
  const out = join(dir, fn)
  const safe = text.replace(/["$'`\\]/g, '')
  execSync(`edge-tts --voice zh-CN-XiaoxiaoNeural --text "${safe}" --write-media ${out}`, { timeout: 30000, shell: '/bin/bash' })
  const host = request.headers.get('host') || 'localhost:3000'
  return `http://${host}/uploads/${fn}`
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
      const iu = await saveToPublic(img, 'png', request)
      const au = await saveToPublic(aud, 'mp3', request)
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
      const au = synthesizeTTS(text, request)
      const r = await createDigitalHuman(au, tmpl.previewUrl)
      return r ? NextResponse.json({ success: true, taskId: r.taskId }) : NextResponse.json({ success: false, message: '提交失败' }, { status: 500 })
    }

    if (action === 'query') {
      const { taskId } = body
      if (!taskId) return NextResponse.json({ success: false, message: '缺少 taskId' }, { status: 400 })
      const r = await queryDigitalHumanTask(taskId)
      return NextResponse.json({ success: true, ...r })
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
