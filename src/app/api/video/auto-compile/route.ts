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
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, voice: voice || 'zh_female_vv_uranus_bigtts' }),
  })
  const d = await res.json()
  if (!d.audioUrl) throw new Error('TTS失败: ' + JSON.stringify(d))
  return d.audioUrl
}

export async function POST(request: NextRequest) {
  try {
    const form = await request.formData()
    const text = (form.get('text') as string) || ''
    const voice = (form.get('voice') as string) || 'zh_female_vv_uranus_bigtts'
    const bgmFile = form.get('bgm') as File | null
    const mediaFiles = form.getAll('media') as File[]

    if (!text) return NextResponse.json({ success: false, message: '缺少文案' }, { status: 400 })
    if (mediaFiles.length === 0) return NextResponse.json({ success: false, message: '请上传素材' }, { status: 400 })

    ensureDir()
    const jobId = crypto.randomUUID().slice(0, 8)
    const workDir = path.join(OUTPUT_DIR, jobId)
    fs.mkdirSync(workDir, { recursive: true })

    // 1. 保存素材
    const mediaPaths: string[] = []
    for (let i = 0; i < mediaFiles.length; i++) {
      const buf = Buffer.from(await mediaFiles[i].arrayBuffer())
      const ext = mediaFiles[i].name.split('.').pop() || 'mp4'
      const p = path.join(workDir, `media_${String(i).padStart(3, '0')}.${ext}`)
      fs.writeFileSync(p, buf)
      mediaPaths.push(p)
    }

    // 2. 保存 BGM（如果有）
    let bgmPath = ''
    if (bgmFile) {
      bgmPath = path.join(workDir, 'bgm' + (bgmFile.name.split('.').pop() || '.mp3'))
      fs.writeFileSync(bgmPath, Buffer.from(await bgmFile.arrayBuffer()))
    }

    // 3. TTS 生成配音
    const ttsUrl = await tts(text, voice)
    const audioPath = path.join(workDir, 'tts.mp3')
    execSync(`curl -s -o "${audioPath}" "${ttsUrl}"`, { timeout: 30000 })

    // 4. 获取音频时长
    const durStr = execSync(`ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${audioPath}"`, { timeout: 10000 }).toString().trim()
    const audioDuration = parseFloat(durStr) || 10
    const segDuration = audioDuration / mediaPaths.length

    // 5. 生成字幕文件（从文案逐行）
    const lines = text.split('\n').filter(Boolean)
    const perLineTime = audioDuration / Math.max(lines.length, 1)
    let srtContent = ''
    lines.forEach((line, i) => {
      const start = i * perLineTime
      const end = Math.min((i + 1) * perLineTime, audioDuration)
      const fmt = (t: number) => {
        const h = Math.floor(t / 3600); const m = Math.floor((t % 3600) / 60); const s = Math.floor(t % 60); const ms = Math.floor((t % 1) * 1000)
        return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')},${String(ms).padStart(3,'0')}`
      }
      srtContent += `${i + 1}\n${fmt(start)} --> ${fmt(end)}\n${line}\n\n`
    })
    const srtPath = path.join(workDir, 'subtitles.srt')
    fs.writeFileSync(srtPath, srtContent)

    // 6. 生成每个素材的片段（统一尺寸）
    const clipPaths: string[] = []
    for (let i = 0; i < mediaPaths.length; i++) {
      const clip = path.join(workDir, `clip_${String(i).padStart(3, '0')}.mp4`)
      const src = mediaPaths[i]
      const isVideo = mediaFiles[i].type.startsWith('video/')
      if (isVideo) {
        execSync(`ffmpeg -y -i "${src}" -vf "scale=1920:1080:force_original_aspect_ratio=1,pad=1920:1080:(ow-iw)/2:(oh-ih)/2" -t ${segDuration.toFixed(2)} -c:v libx264 -preset fast -c:a aac "${clip}"`, { timeout: 60000 })
      } else {
        execSync(`ffmpeg -y -loop 1 -i "${src}" -vf "scale=1920:1080:force_original_aspect_ratio=1,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,fade=t=in:st=0:d=0.5" -t ${segDuration.toFixed(2)} -c:v libx264 -preset fast -pix_fmt yuv420p "${clip}"`, { timeout: 60000 })
      }
      clipPaths.push(clip)
    }

    // 7. 拼接所有片段
    const concatFile = path.join(workDir, 'concat.txt')
    fs.writeFileSync(concatFile, clipPaths.map(p => `file '${p}'`).join('\n'))
    const mergedPath = path.join(workDir, 'merged.mp4')
    execSync(`ffmpeg -y -f concat -safe 0 -i "${concatFile}" -c copy "${mergedPath}"`, { timeout: 120000 })

    // 8. 合并配音、BGM、烧录字幕
    const outputPath = path.join(OUTPUT_DIR, `${jobId}.mp4`)
    const publicPath = `${PUBLIC_URL}/${jobId}.mp4`

    if (bgmPath) {
      // 有BGM：音频混合（配音+背景音乐），再叠加字幕
      const mixedAudio = path.join(workDir, 'mixed.mp3')
      execSync(`ffmpeg -y -i "${audioPath}" -i "${bgmPath}" -filter_complex "[0:a]volume=1[a1];[1:a]volume=0.3[a2];[a1][a2]amix=inputs=2:duration=first" -ac 2 "${mixedAudio}"`, { timeout: 30000 })
      execSync(`ffmpeg -y -i "${mergedPath}" -i "${mixedAudio}" -vf "subtitles='${srtPath}'" -c:v libx264 -preset medium -crf 23 -c:a aac -map 0:v -map 1:a -shortest "${outputPath}"`, { timeout: 120000 })
    } else {
      execSync(`ffmpeg -y -i "${mergedPath}" -i "${audioPath}" -vf "subtitles='${srtPath}'" -c:v libx264 -preset medium -crf 23 -c:a aac -map 0:v -map 1:a -shortest "${outputPath}"`, { timeout: 120000 })
    }

    // 9. 清理
    fs.rmSync(workDir, { recursive: true, force: true })

    return NextResponse.json({ success: true, data: { videoUrl: publicPath } })
  } catch (e: any) {
    console.error('auto-compile error:', e)
    return NextResponse.json({ success: false, error: e.message })
  }
}
