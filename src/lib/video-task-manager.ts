import { exec, execSync } from 'child_process'
import path from 'path'
import fs from 'fs'

export interface VideoTask {
  id: string
  status: 'queued' | 'processing' | 'completed' | 'failed'
  progress: number
  videoUrl?: string
  error?: string
}

const tasks = new Map<string, VideoTask>()

export function getTask(id: string) { return tasks.get(id) }

function run(cmd: string, t = 120000): Promise<string> {
  return new Promise((res, rej) => {
    exec(cmd, { timeout: t, maxBuffer: 1024 * 1024 * 50 }, (e, o, er) => {
      if (e) rej(new Error(er || e.message))
      else res(o)
    })
  })
}

function isVideoFile(file: string): boolean {
  return /\.(mp4|mov|avi|mkv|webm)$/i.test(file)
}

function getDuration(file: string): number {
  try {
    const out = execSync(`ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${file}"`, { timeout: 10000, encoding: 'utf8' })
    return parseFloat(out.trim()) || 0
  } catch { return 0 }
}

function getVideoSize(file: string): { w: number; h: number } | null {
  try {
    const out = execSync(`ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=s=x:p=0 "${file}"`, { timeout: 10000, encoding: 'utf8' })
    const [w, h] = out.trim().split('x').map(Number)
    if (w && h) return { w, h }
  } catch {}
  return null
}

// Drawtext position helpers
function posXY(pos: string, W: number, H: number, fontSize: number): string {
  const m = fontSize * 0.6 // margin
  switch (pos) {
    case 'tr': return `x=w-tw-${m}:y=${m}`
    case 'bl': return `x=${m}:y=h-th-${m}`
    case 'br': return `x=w-tw-${m}:y=h-th-${m}`
    default: return `x=${m}:y=${m}` // tl
  }
}

export function startTask(taskId: string, workDir: string, mediaPaths: string[], text: string, voice: string, ratio: string, resolution: string, subtitleSize: number, bgmPath: string, duration: number, showSubs: boolean = true, stickerText: string = '', stickerPos: string = 'tl', titleText: string = '', colorFilter: string = '') {
  const task: VideoTask = { id: taskId, status: 'processing', progress: 0 }
  tasks.set(taskId, task)
  runTask(task, workDir, mediaPaths, text, voice, ratio, resolution, subtitleSize, bgmPath, duration, showSubs, stickerText, stickerPos, titleText, colorFilter).catch(e => {
    task.status = 'failed'
    task.error = e.message
  })
  return task
}

async function runTask(task: VideoTask, wd: string, mp: string[], text: string, voice: string, ratio: string, res: string, fs2: number, bgp: string, dur: number, showSubs: boolean = true, stickerText: string = '', stickerPos: string = 'tl', titleText: string = '', colorFilter: string = '') {
  try {
    const dim = { '16:9': { w: 1920, h: 1080 }, '9:16': { w: 1080, h: 1920 }, '1:1': { w: 1080, h: 1080 }, '4:3': { w: 1440, h: 1080 } }[ratio] || { w: 1920, h: 1080 }
    const sc = res === '720p' ? 0.5 : 1
    const W = Math.round(dim.w * sc), H = Math.round(dim.h * sc)
    const sf = `scale=${W}:${H}:force_original_aspect_ratio=1,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2`

    // Color filter map
    const cfMap: Record<string, string> = {
      warm: 'colorchannelmixer=rr=1.2:rg=0.1:rb=0.1',
      cool: 'colorchannelmixer=rr=0.8:gg=1.2:bb=1.2',
      bw: 'colorchannelmixer=.3:.6:.1:0:.3:.6:.1:0:.3:.6:.1:0',
    }
    const cf = cfMap[colorFilter] || ''

    task.progress = 10

    // ---- TTS ----
    const r = await fetch('http://localhost:3000/api/tts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, voice }) })
    const d = await r.json()
    if (!d.audioUrl) throw new Error('TTS失败')
    const ap = path.join(wd, 't.mp3')
    fs.copyFileSync('/root/AiMarketing/public/tts/' + path.basename(d.audioUrl), ap)
    task.progress = 20

    const totalDur = dur || 30
    const segDuration = totalDur / mp.length

    // ---- Audio ----
    const adjAudio = path.join(wd, 'ta.mp3')
    try {
      const origDur = await run(`ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${ap}"`, 10000)
      const audioDur = parseFloat(origDur.trim()) || 0
      if (audioDur > totalDur) {
        await run(`ffmpeg -y -i "${ap}" -t ${totalDur} -c copy "${adjAudio}"`, 30000)
      } else if (audioDur > 0 && audioDur < totalDur) {
        const padFile = path.join(wd, 'silence.mp3')
        await run(`ffmpeg -y -f lavfi -i anullsrc=r=24000:cl=mono -t ${(totalDur - audioDur).toFixed(1)} "${padFile}"`, 10000)
        await run(`ffmpeg -y -i "${ap}" -i "${padFile}" -filter_complex "[0:a][1:a]concat=n=2:v=0:a=1" -ac 1 "${adjAudio}"`, 30000)
      } else {
        await run(`cp "${ap}" "${adjAudio}"`, 5000)
      }
    } catch {
      await run(`cp "${ap}" "${adjAudio}"`, 5000)
    }

    // ---- Subtitles ----
    const ln = text.split('\n').filter(Boolean)
    const ft = (t: number) => { const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = Math.floor(t % 60), ms = Math.floor((t % 1) * 1000); return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms).padStart(3, '0')}` }
    const sp = path.join(wd, 's.srt')
    const wrapMax: Record<string, number> = { '16:9': 22, '9:16': 6, '1:1': 12, '4:3': 18 }
    const maxW = wrapMax[ratio] || 16
    function splitLine(l: string): string[] {
      if (l.length <= maxW) return [l]
      const r: string[] = []; let cur = ''
      for (const ch of l) { if (cur.length >= maxW) { r.push(cur); cur = ch } else cur += ch }
      if (cur) r.push(cur)
      return r
    }
    const perLineTime = totalDur / Math.max(ln.length, 1)
    let srtLines: string[] = [], entryIdx = 1
    for (let i = 0; i < ln.length; i++) {
      const chunks = splitLine(ln[i])
      const chunkTime = perLineTime / chunks.length
      for (let j = 0; j < chunks.length; j++) {
        const st = i * perLineTime + j * chunkTime
        const et = Math.min(st + chunkTime, totalDur)
        srtLines.push(entryIdx + '\n' + ft(st) + ' --> ' + ft(et) + '\n' + chunks[j] + '\n')
        entryIdx++
      }
    }
    fs.writeFileSync(sp, srtLines.join('\n'))
    task.progress = 30

    // ---- Encode segments ----
    for (let b = 0; b < mp.length; b += 2) {
      await Promise.all(mp.slice(b, b + 2).map(async (src, bi) => {
        const idx = b + bi
        const out = path.join(wd, `c${idx}.mp4`)
        const isVideo = isVideoFile(src)
        const segT = segDuration.toFixed(2)
        const timeout = isVideo ? 180000 : 60000 // longer for video encoding

        if (isVideo) {
          const srcDur = getDuration(src)
          const srcSize = getVideoSize(src)
          // Smart resolution: only scale if source < target
          let vf = sf
          if (srcSize && srcSize.w >= W && srcSize.h >= H) {
            // Source already >= target, don't scale up, just pad
            vf = `pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2`
          }
          if (cf) vf = vf + ',' + cf
          const loop = srcDur < segDuration ? '-stream_loop -1 ' : ''
          await run(`nice -n 19 ffmpeg -y ${loop}-i "${src}" -vf "${vf}" -t ${segT} -c:v libx264 -preset fast -pix_fmt yuv420p -threads 2 "${out}"`, timeout)
        } else {
          let vf = sf
          if (cf) vf = vf + ',' + cf
          await run(`nice -n 19 ffmpeg -y -i "${src}" -vf "${vf},fade=t=in:st=0:d=0.5,fade=t=out:st=${(segDuration - 0.5).toFixed(2)}:d=0.5" -t ${segT} -c:v libx264 -preset fast -pix_fmt yuv420p -threads 2 "${out}"`, timeout)
        }
      }))
      task.progress = 30 + Math.round((b + 2) / mp.length * 30)
    }

    // ---- Concat all segments ----
    const ct = path.join(wd, 'c.txt')
    fs.writeFileSync(ct, mp.map((_, i) => `file '${wd}/c${i}.mp4'`).join('\n'))
    const mv = path.join(wd, 'm.mp4')
    await run(`ffmpeg -y -f concat -safe 0 -i "${ct}" -c copy "${mv}"`, 120000)

    // ---- Mix BGM ----
    let ai = adjAudio
    if (bgp) {
      const mx = path.join(wd, 'x.mp3')
      await run(`ffmpeg -y -i "${adjAudio}" -i "${bgp}" -filter_complex "[0:a]volume=1[a1];[1:a]volume=0.25[a2];[a1][a2]amix=inputs=2:duration=first" -ac 2 "${mx}"`, 30000)
      ai = mx
    }
    task.progress = 85

    // ---- Build final vf string ----
    let finalVf = ''
    if (showSubs) {
      finalVf = `subtitles='${sp}':force_style='FontSize=${fs2},Alignment=2,MarginV=40'`
    }
    // Sticker
    if (stickerText) {
      const st = stickerText.replace(/'/g, '\\\'').slice(0, 20)
      const spXY = posXY(stickerPos, W, H, 28)
      const sticker = `drawtext=text='${st}':fontsize=28:fontcolor=white:${spXY}:shadowx=2:shadowy=2:shadowcolor=black@0.5`
      finalVf = finalVf ? finalVf + ',' + sticker : sticker
    }
    // Title (first 3s)
    if (titleText) {
      const tt = titleText.replace(/'/g, '\\\'').slice(0, 30)
      const title = `drawtext=text='${tt}':fontsize=48:fontcolor=white:x=(w-text_w)/2:y=(h-text_h)/2:shadowx=2:shadowy=2:shadowcolor=black@0.6:enable='between(t,0,3)'`
      finalVf = finalVf ? finalVf + ',' + title : title
    }

    // ---- Final output ----
    const op = path.join('/root/AiMarketing/public/generated', `${task.id}.mp4`)
    const vfArg = finalVf ? `-vf "${finalVf}"` : ''
    await run(`ffmpeg -y -i "${mv}" -i "${ai}" ${vfArg} -c:v libx264 -preset medium -crf 23 -c:a aac -map 0:v -map 1:a -t ${totalDur} -threads 2 "${op}"`, 300000)
    task.progress = 100
    task.status = 'completed'
    task.videoUrl = `/api/video/get?id=${task.id}.mp4`

    fs.rmSync(wd, { recursive: true, force: true })
  } catch (e: any) {
    task.status = 'failed'
    task.error = e.message
  }
}
