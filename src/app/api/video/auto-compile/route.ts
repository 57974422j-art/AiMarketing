import { NextRequest, NextResponse } from 'next/server'
import { execSync } from 'child_process'
import path from 'path'
import fs from 'fs'
import crypto from 'crypto'

const UPLOAD_DIR = '/root/AiMarketing/public/generated'
const PUBLIC_URL = '/generated'

function ensureDir() {
  if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true })
}

async function tts(text: string, voice: string): Promise<string> {
  const res = await fetch('http://localhost:3000/api/tts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, voice: voice || 'zh_female_vv_uranus_bigtts' }),
  })
  const d = await res.json()
  if (!d.audioUrl) throw new Error('TTS failed: ' + JSON.stringify(d))
  return d.audioUrl
}

export async function POST(request: NextRequest) {
  try {
    const form = await request.formData()
    const text = (form.get('text') as string) || ''
    const voice = (form.get('voice') as string) || 'zh_female_vv_uranus_bigtts'
    const bgmUrl = form.get('bgmUrl') as string || ''
    const imageFiles = form.getAll('images') as File[]

    if (!text) return NextResponse.json({ success: false, message: '缺少文案' }, { status: 400 })
    if (imageFiles.length === 0) return NextResponse.json({ success: false, message: '请上传至少一张图片' }, { status: 400 })

    ensureDir()
    const jobId = crypto.randomUUID().slice(0, 8)
    const workDir = path.join(UPLOAD_DIR, jobId)
    fs.mkdirSync(workDir, { recursive: true })

    // 1. 保存上传的图片
    const imgs: string[] = []
    for (let i = 0; i < imageFiles.length; i++) {
      const buf = Buffer.from(await imageFiles[i].arrayBuffer())
      const ext = imageFiles[i].name.split('.').pop() || 'jpg'
      const p = path.join(workDir, `img_${String(i).padStart(3, '0')}.${ext}`)
      fs.writeFileSync(p, buf)
      imgs.push(p)
    }

    // 2. TTS 生成配音
    const ttsUrl = await tts(text, voice)
    const audioPath = path.join(workDir, 'tts.mp3')
    execSync(`curl -s -o "${audioPath}" "${ttsUrl}"`, { timeout: 30000 })

    // 3. 获取音频时长
    const durationStr = execSync(`ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${audioPath}"`, { timeout: 10000 }).toString().trim()
    const audioDuration = parseFloat(durationStr) || 10
    const imgDuration = audioDuration / imgs.length

    // 4. 生成视频：图片幻灯片 + 配音 + 字幕
    const outputPath = path.join(UPLOAD_DIR, `${jobId}.mp4`)
    const publicPath = `${PUBLIC_URL}/${jobId}.mp4`

    // 创建FFmpeg concat清单
    const filterParts = imgs.map((p, i) => `[${i}:v]scale=1920:1080:force_original_aspect_ratio=1,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,fade=t=in:st=0:d=0.5[v${i}];`)
    const concatInput = imgs.map((p, i) => `-loop 1 -t ${imgDuration.toFixed(2)} -i "${p}"`).join(' ')
    const concatFilter = imgs.map((_, i) => `[v${i}]`).join('') + `concat=n=${imgs.length}:v=1:a=0,format=yuv420p[v]`

    const cmd = `ffmpeg -y ${concatInput} -i "${audioPath}" ${
      bgmUrl ? `-i "${bgmUrl}"` : ''
    } -filter_complex "${filterParts.join('')}${concatFilter}" -map "[v]" -map "1:a" ${
      bgmUrl ? '-map "2:a"' : ''
    } -c:v libx264 -preset medium -crf 23 -c:a aac -shortest "${outputPath}"`

    execSync(cmd, { timeout: 120000 })

    // 清理临时目录
    fs.rmSync(workDir, { recursive: true, force: true })

    return NextResponse.json({ success: true, data: { videoUrl: publicPath } })
  } catch (e: any) {
    console.error('auto-compile error:', e.message)
    return NextResponse.json({ success: false, error: e.message })
  }
}
