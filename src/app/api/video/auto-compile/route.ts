import { NextRequest, NextResponse } from 'next/server'
import { execSync } from 'child_process'
import path from 'path'
import fs from 'fs'
import crypto from 'crypto'
import { startTask, getTask } from '@/lib/video-task-manager'

export const dynamic = 'force-dynamic'
const OUT = '/root/AiMarketing/public/generated'
function dir() { if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true }) }

// POST: 创建任务（立即返回 taskId，后台异步执行）
export async function POST(req: NextRequest) {
  try {
    const f = await req.formData()
    const text = (f.get('text') as string) || ''
    const voice = (f.get('voice') as string) || 'zh_female_vv_uranus_bigtts'
    const bgmFile = f.get('bgm') as File | null
    const bgmUrl = (f.get('bgmUrl') as string) || ''
    const mode = (f.get('mode') as string) || 'free'
    const ratio = (f.get('ratio') as string) || '16:9'
    const resolution = (f.get('resolution') as string) || '1080p'
    const subtitleSize = parseInt((f.get('subtitleSize') as string) || '36')

    if (!text) return NextResponse.json({ success: false, message: '缺少文案' }, { status: 400 })
    dir()
    const taskId = crypto.randomUUID().slice(0, 8)
    const wd = path.join(OUT, taskId)
    fs.mkdirSync(wd, { recursive: true })

    // 收集素材
    const mp: string[] = []
    if (mode === 'smart') {
      const urls: string[] = JSON.parse((f.get('imageUrls') as string) || '[]')
      if (!urls.length) return NextResponse.json({ success: false, message: '无图片URL' }, { status: 400 })
      for (let i = 0; i < urls.length; i++) {
        const p = path.join(wd, `i${i}.jpg`)
        execSync(`curl -s -L -o "${p}" "${urls[i]}"`, { timeout: 15000 })
        mp.push(p)
      }
    } else {
      const mf = f.getAll('media') as File[]
      if (!mf.length) return NextResponse.json({ success: false, message: '请上传素材' }, { status: 400 })
      for (let i = 0; i < mf.length; i++) {
        const p = path.join(wd, `m${i}.${mf[i].name.split('.').pop() || 'jpg'}`)
        fs.writeFileSync(p, Buffer.from(await mf[i].arrayBuffer()))
        mp.push(p)
      }
    }

    // BGM
    let bgp = ''
    if (bgmFile) {
      bgp = path.join(wd, 'b.' + (bgmFile.name.split('.').pop() || 'mp3'))
      fs.writeFileSync(bgp, Buffer.from(await bgmFile.arrayBuffer()))
    } else if (bgmUrl) {
      bgp = path.join(wd, 'b.mp3')
      execSync(`curl -s -L -o "${bgp}" "${bgmUrl}"`, { timeout: 15000 })
    }

    // 启动异步任务（立即返回，不阻塞）
    startTask(taskId, wd, mp, text, voice, ratio, resolution, subtitleSize, bgp)
    return NextResponse.json({ success: true, data: { taskId } })
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message })
  }
}

// GET: 查询任务状态
export async function GET(req: NextRequest) {
  const taskId = req.nextUrl.searchParams.get('taskId')
  if (!taskId) return NextResponse.json({ success: false, message: '缺少taskId' }, { status: 400 })
  const task = getTask(taskId)
  if (!task) return NextResponse.json({ success: false, message: '任务不存在' }, { status: 404 })
  return NextResponse.json({ success: true, data: task })
}
