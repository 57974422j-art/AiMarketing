import { NextRequest, NextResponse } from 'next/server'
import { execSync } from 'child_process'
import path from 'path'
import fs from 'fs'
import crypto from 'crypto'

export const dynamic = 'force-dynamic'
const OUTPUT_DIR = '/root/AiMarketing/public/generated'
const PUBLIC_URL = '/generated'
function ensureDir() { if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true }) }

async function tts(text: string, voice: string): Promise<string> {
  const res = await fetch('http://localhost:3000/api/tts', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, voice: voice || 'zh_female_vv_uranus_bigtts' }),
  })
  const d = await res.json()
  if (!d.audioUrl) throw new Error('TTS失败: ' + JSON.stringify(d))
  return d.audioUrl
}

async function downloadImage(url: string, dest: string): Promise<void> {
  execSync(`curl -s -L -o "${dest}" "${url}"`, { timeout: 15000 })
}

export async function POST(request: NextRequest) {
  try {
    const form = await request.formData()
    const text = (form.get('text') as string) || ''
    const voice = (form.get('voice') as string) || 'zh_female_vv_uranus_bigtts'
    const bgmFile = form.get('bgm') as File | null
    const mode = form.get('mode') as string || 'free'

    ensureDir()
    const jobId = crypto.randomUUID().slice(0, 8)
    const workDir = path.join(OUTPUT_DIR, jobId)
    fs.mkdirSync(workDir, { recursive: true })

    // 收集素材路径
    const mediaPaths: string[] = []

    if (mode === 'smart') {
      // 智能模式：从 URL 下载图片
      const imageUrls: string[] = JSON.parse((form.get('imageUrls') as string) || '[]')
      if (imageUrls.length === 0) return NextResponse.json({ success: false, message: '无图片URL' }, { status: 400 })

      for (let i = 0; i < imageUrls.length; i++) {
        const ext = imageUrls[i].match(/\.(jpg|jpeg|png|webp|gif)/i)?.[1] || 'jpg'
        const p = path.join(workDir, `img_${String(i).padStart(3, '0')}.${ext}`)
        await downloadImage(imageUrls[i], p)
        mediaPaths.push(p)
      }
    } else {
      // 免费模式：从上传文件读取
      const mediaFiles = form.getAll('media') as File[]
      if (mediaFiles.length === 0) return NextResponse.json({ success: false, message: '请上传素材' }, { status: 400 })

      for (let i = 0; i < mediaFiles.length; i++) {
        const buf = Buffer.from(await mediaFiles[i].arrayBuffer())
        const ext = mediaFiles[i].name.split('.').pop() || 'mp4'
        const p = path.join(workDir, `media_${String(i).padStart(3, '0')}.${ext}`)
        fs.writeFileSync(p, buf)
        mediaPaths.push(p)
      }
    }

    // 保存 BGM
    let bgmPath = ''
    if (bgmFile) { bgmPath = path.join(workDir, 'bgm' + (bgmFile.name.split('.').pop()||'.mp3')); fs.writeFileSync(bgmPath, Buffer.from(await bgmFile.arrayBuffer())) }

    // TTS
    const ttsUrl = await tts(text, voice)
    const audioPath = path.join(workDir, 'tts.mp3')
    execSync(`curl -s -o "${audioPath}" "${ttsUrl}"`, { timeout: 30000 })

    const durStr = execSync(`ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${audioPath}"`, { timeout: 10000 }).toString().trim()
    const audioDuration = parseFloat(durStr) || 10
    const segDuration = audioDuration / mediaPaths.length

    // 字幕
    const lines = text.split('\n').filter(Boolean)
    const perLineTime = audioDuration / Math.max(lines.length, 1)
    let srt = ''
    lines.forEach((line, i) => {
      const s = i * perLineTime, e = Math.min((i+1)*perLineTime, audioDuration)
      const fmt = (t:number) => {const h=Math.floor(t/3600),m=Math.floor((t%3600)/60),s=Math.floor(t%60),ms=Math.floor((t%1)*1000);return String(h).padStart(2,'0')+':'+String(m).padStart(2,'0')+':'+String(s).padStart(2,'0')+','+String(ms).padStart(3,'0')}
      srt += `${i+1}\n${fmt(s)} --> ${fmt(e)}\n${line}\n\n`
    })
    fs.writeFileSync(path.join(workDir, 'subtitles.srt'), srt)

    // 生成素材片段
    const clips: string[] = []
    for (let i = 0; i < mediaPaths.length; i++) {
      const clip = path.join(workDir, `clip_${i}.mp4`)
      const src = mediaPaths[i]
      execSync(`ffmpeg -y -loop 1 -i "${src}" -vf "scale=1920:1080:force_original_aspect_ratio=1,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,fade=t=in:st=0:d=0.5" -t ${segDuration.toFixed(2)} -c:v libx264 -preset fast -pix_fmt yuv420p "${clip}"`, { timeout: 60000 })
      clips.push(clip)
    }

    // 拼接
    const concatFile = path.join(workDir, 'concat.txt')
    fs.writeFileSync(concatFile, clips.map(p => `file '${p}'`).join('\n'))
    const mergedPath = path.join(workDir, 'merged.mp4')
    execSync(`ffmpeg -y -f concat -safe 0 -i "${concatFile}" -c copy "${mergedPath}"`, { timeout: 120000 })

    // 合并音频+字幕
    const outputPath = path.join(OUTPUT_DIR, `${jobId}.mp4`)
    if (bgmPath) {
      const mixed = path.join(workDir, 'mixed.mp3')
      execSync(`ffmpeg -y -i "${audioPath}" -i "${bgmPath}" -filter_complex "[0:a]volume=1[a1];[1:a]volume=0.3[a2];[a1][a2]amix=inputs=2:duration=first" -ac 2 "${mixed}"`, { timeout: 30000 })
      execSync(`ffmpeg -y -i "${mergedPath}" -i "${mixed}" -vf subtitles='${path.join(workDir,'subtitles.srt')}' -c:v libx264 -preset medium -crf 23 -c:a aac -map 0:v -map 1:a -shortest "${outputPath}"`, { timeout: 120000 })
    } else {
      execSync(`ffmpeg -y -i "${mergedPath}" -i "${audioPath}" -vf subtitles='${path.join(workDir,'subtitles.srt')}' -c:v libx264 -preset medium -crf 23 -c:a aac -map 0:v -map 1:a -shortest "${outputPath}"`, { timeout: 120000 })
    }

    fs.rmSync(workDir, { recursive: true, force: true })
    return NextResponse.json({ success: true, data: { videoUrl: `${PUBLIC_URL}/${jobId}.mp4` } })
  } catch (e: any) {
    console.error('auto-compile error:', e)
    return NextResponse.json({ success: false, error: e.message })
  }
}
