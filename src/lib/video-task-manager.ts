import { exec } from 'child_process'
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

export function startTask(taskId: string, workDir: string, mediaPaths: string[], text: string, voice: string, ratio: string, resolution: string, subtitleSize: number, bgmPath: string, duration: number) {
  const task: VideoTask = { id: taskId, status: 'processing', progress: 0 }
  tasks.set(taskId, task)
  runTask(task, workDir, mediaPaths, text, voice, ratio, resolution, subtitleSize, bgmPath, duration).catch(e => {
    task.status = 'failed'
    task.error = e.message
  })
  return task
}

async function runTask(task: VideoTask, wd: string, mp: string[], text: string, voice: string, ratio: string, res: string, fs2: number, bgp: string, dur: number) {
  try {
    const dim = { '16:9': { w: 1920, h: 1080 }, '9:16': { w: 1080, h: 1920 }, '1:1': { w: 1080, h: 1080 }, '4:3': { w: 1440, h: 1080 } }[ratio] || { w: 1920, h: 1080 }
    const sc = res === '720p' ? 0.5 : 1; const W = Math.round(dim.w * sc), H = Math.round(dim.h * sc)

    task.progress = 10

    // TTS - still generate audio for soundtrack
    const r = await fetch('http://localhost:3000/api/tts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, voice }) })
    const d = await r.json()
    if (!d.audioUrl) throw new Error('TTS失败')
    const ap = path.join(wd, 't.mp3')
    await run(`curl -s -o "${ap}" "http://localhost:3000${d.audioUrl}"`, 30000)
    task.progress = 20

    // Fixed duration instead of audio duration
    const totalDur = dur || 30
    const segDuration = totalDur / mp.length

    // Adjust audio to match total duration
    const adjAudio = path.join(wd, 'ta.mp3')
    try {
      const origDur = await run(`ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${ap}"`, 10000)
      const audioDur = parseFloat(origDur.trim()) || 0
      if (audioDur > totalDur) {
        // Trim audio
        await run(`ffmpeg -y -i "${ap}" -t ${totalDur} -c copy "${adjAudio}"`, 30000)
      } else if (audioDur > 0 && audioDur < totalDur) {
        // Pad with silence
        const padFile = path.join(wd, 'silence.mp3')
        await run(`ffmpeg -y -f lavfi -i anullsrc=r=24000:cl=mono -t ${(totalDur - audioDur).toFixed(1)} "${padFile}"`, 10000)
        await run(`ffmpeg -y -i "${ap}" -i "${padFile}" -filter_complex "[0:a][1:a]concat=n=2:v=0:a=1" -ac 1 "${adjAudio}"`, 30000)
      } else {
        // Fallback: just copy
        await run(`cp "${ap}" "${adjAudio}"`, 5000)
      }
    } catch {
      await run(`cp "${ap}" "${adjAudio}"`, 5000)
    }

    // Subtitles
    const ln = text.split('\n').filter(Boolean)
    const perLineTime = totalDur / Math.max(ln.length, 1)
    const ft = (t: number) => { const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = Math.floor(t % 60), ms = Math.floor((t % 1) * 1000); return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms).padStart(3, '0')}` }
    const sp = path.join(wd, 's.srt')
    fs.writeFileSync(sp, ln.map((l, i) => { const st = i * perLineTime, et = Math.min((i + 1) * perLineTime, totalDur); return `${i + 1}\n${ft(st)} --> ${ft(et)}\n${l}\n\n` }).join(''))
    task.progress = 30

    // Encode segments
    for (let b = 0; b < mp.length; b += 2) {
      await Promise.all(mp.slice(b, b + 2).map(async (src, bi) => {
        const c = path.join(wd, `c${b + bi}.mp4`)
        await run(`nice -n 19 ffmpeg -y -i "${src}" -r 25 -vf "scale=${W}:${H}:force_original_aspect_ratio=1,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2,fade=t=in:st=0:d=0.5,fade=t=out:st=${(segDuration - 0.5).toFixed(2)}:d=0.5" -t ${segDuration.toFixed(2)} -c:v libx264 -preset fast -pix_fmt yuv420p -threads 2 "${c}"`, 60000)
      }))
      task.progress = 30 + Math.round((b + 2) / mp.length * 30)
    }

    // Concat
    const ct = path.join(wd, 'c.txt')
    fs.writeFileSync(ct, mp.map((_, i) => `file '${wd}/c${i}.mp4'`).join('\n'))
    const mv = path.join(wd, 'm.mp4')
    await run(`ffmpeg -y -f concat -safe 0 -i "${ct}" -c copy "${mv}"`, 120000)
    task.progress = 70

    // Mix BGM
    let ai = adjAudio
    if (bgp) {
      const mx = path.join(wd, 'x.mp3')
      await run(`ffmpeg -y -i "${adjAudio}" -i "${bgp}" -filter_complex "[0:a]volume=1[a1];[1:a]volume=0.25[a2];[a1][a2]amix=inputs=2:duration=first" -ac 2 "${mx}"`, 30000)
      ai = mx
    }

    // Burn subtitles
    const op = path.join('/root/AiMarketing/public/generated', `${task.id}.mp4`)
    await run(`ffmpeg -y -i "${mv}" -i "${ai}" -vf "subtitles='${sp}':force_style='FontSize=${fs2},Alignment=2'" -c:v libx264 -preset medium -crf 23 -c:a aac -map 0:v -map 1:a -shortest -threads 2 "${op}"`, 180000)
    task.progress = 100
    task.status = 'completed'
    task.videoUrl = `/api/video/get?id=${task.id}.mp4`

    fs.rmSync(wd, { recursive: true, force: true })
  } catch (e: any) {
    task.status = 'failed'
    task.error = e.message
  }
}
