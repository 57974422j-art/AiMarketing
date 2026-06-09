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

/** 字幕时间戳生成模式 */
export type SubtitleMode = 'tts-sync' | 'funasr' | 'legacy'

const tasks = new Map<string, VideoTask>()
let processing = false
const taskQueue: Array<{ fn: () => Promise<void>; onDone: () => void; onError: (e: any) => void }> = []

export function getTask(id: string) { return tasks.get(id) }

function processQueue() {
  if (processing || taskQueue.length === 0) return
  processing = true
  const next = taskQueue.shift()!
  next.fn()
    .then(() => { processing = false; next.onDone(); processQueue() })
    .catch((e) => { processing = false; next.onError(e); processQueue() })
}

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
    const out = execSync(`ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=s=x:p:0 "${file}"`, { timeout: 10000, encoding: 'utf8' })
    const [w, h] = out.trim().split('x').map(Number)
    if (w && h) return { w, h }
  } catch {}
  return null
}

function posXY(pos: string, W: number, H: number, fontSize: number): string {
  const m = fontSize * 0.6
  switch (pos) {
    case 'tr': return `x=w-tw-${m}:y=${m}`
    case 'bl': return `x=${m}:y=h-th-${m}`
    case 'br': return `x=w-tw-${m}:y=h-th-${m}`
    default: return `x=${m}:y=${m}`
  }
}

/** 格式化 SRT 时间戳 */
function fmtSRTTime(t: number): string {
  const h = Math.floor(t / 3600)
  const m = Math.floor((t % 3600) / 60)
  const s = Math.floor(t % 60)
  const ms = Math.floor((t % 1) * 1000)
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms).padStart(3, '0')}`
}

/**
 * TTS 同步方案：按字数比例分配时间戳（推荐）
 * 原理：TTS 音频时长与文本长度大致成正比，按每行字数占比计算精确时间戳
 */
function generateTTSSyncSubtitles(
  lines: string[],
  totalAudioDur: number,
  totalVideoDur: number,
  ratio: string,
  workDir: string
): string {
  const wrapMax: Record<string, number> = { '16:9': 22, '9:16': 6, '1:1': 12, '4:3': 18 }
  const maxW = wrapMax[ratio] || 16

  function splitLine(l: string): string[] {
    if (l.length <= maxW) return [l]
    const r: string[] = []; let cur = ''
    for (const ch of l) { if (cur.length >= maxW) { r.push(cur); cur = ch } else cur += ch }
    if (cur) r.push(cur)
    return r
  }

  // 收集所有字幕块并计算总字数
  const allChunks: { text: string; charCount: number }[] = []
  for (const line of lines) {
    const chunks = splitLine(line)
    for (const chunk of chunks) allChunks.push({ text: chunk, charCount: chunk.length })
  }
  const totalChars = allChunks.reduce((sum, c) => sum + c.charCount, 0)

  // 按字数比例分配时间戳
  let srtLines: string[] = []
  let entryIdx = 1
  let currentTime = 0

  for (const chunk of allChunks) {
    const chunkDur = totalChars > 0
      ? (totalVideoDur * chunk.charCount) / totalChars
      : totalVideoDur / Math.max(allChunks.length, 1)

    const startTime = currentTime
    const endTime = Math.min(currentTime + chunkDur, totalVideoDur)
    const gap = Math.min(0.3, chunkDur * 0.1)

    srtLines.push(`${entryIdx}\n${fmtSRTTime(startTime)} --> ${fmtSRTTime(Math.max(endTime - gap, startTime + 0.5))}\n${chunk.text}\n`)
    entryIdx++
    currentTime = endTime
  }

  const srtPath = path.join(workDir, 's.srt')
  fs.writeFileSync(srtPath, srtLines.join('\n'))
  console.log(`[字幕-TTS同步] ${lines.length}行→${srtLines.length}条SRT 总字数=${totalChars} 音频=${totalAudioDur.toFixed(1)}s 视频=${totalVideoDur.toFixed(1)}s`)
  return srtPath
}

/**
 * FunASR 方案：调用语音识别 API 获取精确时间戳
 * 不可用时自动降级到 TTS 同步方案
 */
async function generateFunASRSubtitles(
  audioPath: string,
  originalLines: string[],
  totalVideoDur: number,
  ratio: string,
  workDir: string
): Promise<string> {
  try {
    const r = await fetch('http://localhost:3000/api/funasr', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ audioPath, outputFormat: 'srt' })
    })
    const d = await r.json()
    if (d.success && d.data?.srtPath) {
      console.log('[字幕-FunASR] 使用 ASR 精确时间戳')
      return d.data.srtPath
    }
    throw new Error(d.error || 'FunASR 返回无效结果')
  } catch (e) {
    console.warn('[字幕-FunASR] 不可用，降级到 TTS 同步:', (e as Error)?.message?.slice(0, 100))
    return generateTTSSyncSubtitles(originalLines, totalVideoDur, totalVideoDur, ratio, workDir)
  }
}

/**
 * 传统方案（兼容保留）：简单均分时间戳
 */
function generateLegacySubtitles(
  lines: string[],
  totalDur: number,
  ratio: string,
  workDir: string
): string {
  const wrapMax: Record<string, number> = { '16:9': 22, '9:16': 6, '1:1': 12, '4:3': 18 }
  const maxW = wrapMax[ratio] || 16
  function splitLine(l: string): string[] {
    if (l.length <= maxW) return [l]
    const r: string[] = []; let cur = ''
    for (const ch of l) { if (cur.length >= maxW) { r.push(cur); cur = ch } else cur += ch }
    if (cur) r.push(cur)
    return r
  }
  const perLineTime = totalDur / Math.max(lines.length, 1)
  let srtLines: string[] = [], entryIdx = 1
  for (let i = 0; i < lines.length; i++) {
    const chunks = splitLine(lines[i])
    const chunkTime = perLineTime / chunks.length
    for (let j = 0; j < chunks.length; j++) {
      const st = i * perLineTime + j * chunkTime
      const et = Math.min(st + chunkTime, totalDur)
      srtLines.push(entryIdx + '\n' + fmtSRTTime(st) + ' --> ' + fmtSRTTime(et) + '\n' + chunks[j] + '\n')
      entryIdx++
    }
  }
  const srtPath = path.join(workDir, 's.srt')
  fs.writeFileSync(srtPath, srtLines.join('\n'))
  console.log(`[字幕-传统均分] ${lines.length}行 ${srtLines.length}条SRT 时长=${totalDur}s`)
  return srtPath
}

export function startTask(
  taskId: string,
  workDir: string,
  mediaPaths: string[],
  text: string,
  voice: string,
  ratio: string,
  resolution: string,
  subtitleSize: number,
  bgmPath: string,
  duration: number,
  showSubs: boolean = true,
  stickerText: string = '',
  stickerPos: string = 'tl',
  titleText: string = '',
  colorFilter: string = '',
  subtitleMode: SubtitleMode = 'tts-sync'
) {
  const task: VideoTask = { id: taskId, status: 'queued', progress: 0 }
  tasks.set(taskId, task)
  const runFn = () => runTask(task, workDir, mediaPaths, text, voice, ratio, resolution, subtitleSize, bgmPath, duration, showSubs, stickerText, stickerPos, titleText, colorFilter, subtitleMode)
  const onDone = () => {}
  const onError = (e: any) => { task.status = 'failed'; task.error = e.message }
  taskQueue.push({ fn: runFn, onDone, onError })
  processQueue()
  return task
}

/**
 * 核心任务执行函数
 * 改进点：
 * 1. 支持 auto duration 模式（duration=0 → 用 TTS 实际时长）
 * 2. 三种字幕时间戳模式：tts-sync / funasr / legacy
 * 3. 字幕与音频实际同步
 */
async function runTask(
  task: VideoTask,
  wd: string,
  mp: string[],
  text: string,
  voice: string,
  ratio: string,
  res: string,
  fs2: number,
  bgp: string,
  dur: number,
  showSubs: boolean = true,
  stickerText: string = '',
  stickerPos: string = 'tl',
  titleText: string = '',
  colorFilter: string = '',
  subtitleMode: SubtitleMode = 'tts-sync'
) {
  try {
    task.status = 'processing'
    const isAutoDur = dur === 0  // auto 模式：时长由 TTS 决定
    console.log(`[合成] 开始 task=${task.id} 素材=${mp.length}个 时长=${isAutoDur ? 'auto(文案结束)' : dur + 's'} 比例=${ratio} 分辨率=${res} 字幕=${showSubs}(${subtitleMode}) 贴纸=${!!stickerText} 标题=${!!titleText} 滤镜=${colorFilter || '无'} BGM=${!!bgp}`)

    const dim = { '16:9': { w: 1920, h: 1080 }, '9:16': { w: 1080, h: 1920 }, '1:1': { w: 1080, h: 1080 }, '4:3': { w: 1440, h: 1080 } }[ratio] || { w: 1920, h: 1080 }
    const sc = res === '720p' ? 0.5 : 1
    const W = Math.round(dim.w * sc), H = Math.round(dim.h * sc)
    const sf = `scale=${W}:${H}:force_original_aspect_ratio=1,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2`
    const cfMap: Record<string, string> = { warm: 'colorchannelmixer=rr=1.2:rg=0.1:rb=0.1', cool: 'colorchannelmixer=rr=0.8:gg=1.2:bb=1.2', bw: 'colorchannelmixer=.3:.6:.1:0:.3:.6:.1:0:.3:.6:.1:0' }
    const cf = cfMap[colorFilter] || ''

    task.progress = 10

    // ═══════════════════════════════════════
    // Step 1: TTS 语音合成
    // ═══════════════════════════════════════
    const r = await fetch('http://localhost:3000/api/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, voice })
    })
    const d = await r.json()
    if (!d.audioUrl) throw new Error('TTS失败')
    const ap = path.join(wd, 't.mp3')
    fs.copyFileSync('/root/AiMarketing/public/tts/' + path.basename(d.audioUrl), ap)
    task.progress = 20

    // 获取 TTS 实际音频时长（关键：用于字幕时间戳和 auto duration）
    const origDurOut = await run(`ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${ap}"`, 10000)
    const audioDur = parseFloat(origDurOut.trim()) || 0
    console.log(`[合成] TTS完成 task=${task.id} 音频时长=${audioDur.toFixed(2)}s`)

    // ═══════════════════════════════════════
    // Step 2: 计算最终视频时长
    //   - auto 模式：音频时长 + 1.5s 尾部留白
    //   - 固定模式：使用用户指定时长
    // ═══════════════════════════════════════
    const totalDur = isAutoDur ? Math.max(audioDur + 1.5, dur || 30) : (dur || 30)
    const segDuration = totalDur / mp.length
    console.log(`[合成] 视频时长 task=${task.id} totalDur=${totalDur.toFixed(1)}s (auto=${isAutoDur})`)

    // ═══════════════════════════════════════
    // Step 3: 音频处理（裁剪/补静音）
    // ═══════════════════════════════════════
    const adjAudio = path.join(wd, 'ta.mp3')
    try {
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

    // ═══════════════════════════════════════
    // Step 4: 字幕生成（三种模式）
    // ═══════════════════════════════════════
    let sp = ''
    const ln = text.split('\n').filter(Boolean)

    if (showSubs && ln.length > 0) {
      switch (subtitleMode) {
        case 'tts-sync':
          sp = generateTTSSyncSubtitles(ln, audioDur, totalDur, ratio, wd)
          break
        case 'funasr':
          sp = await generateFunASRSubtitles(ap, ln, totalDur, ratio, wd)
          break
        default:
          sp = generateLegacySubtitles(ln, totalDur, ratio, wd)
      }
    }
    task.progress = 35

    // ═══════════════════════════════════════
    // Step 5: 编码视频片段
    // ═══════════════════════════════════════
    for (let b = 0; b < mp.length; b += 2) {
      await Promise.all(mp.slice(b, b + 2).map(async (src, bi) => {
        const idx = b + bi
        const out = path.join(wd, `c${idx}.mp4`)
        const isVideo = isVideoFile(src)
        const segT = segDuration.toFixed(2)

        if (isVideo) {
          const srcDur = getDuration(src)
          const srcSize = getVideoSize(src)
          let vf = sf
          if (srcSize && srcSize.w >= W && srcSize.h >= H) vf = `pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2`
          if (cf) vf = vf + ',' + cf
          const loop = srcDur < segDuration ? '-stream_loop -1 ' : ''
          await run(`nice -n 19 ffmpeg -y ${loop}-i "${src}" -vf "${vf}" -t ${segT} -c:v libx264 -preset fast -pix_fmt yuv420p -threads 2 "${out}"`, 180000)
        } else {
          let vf = sf
          if (cf) vf = vf + ',' + cf
          await run(`nice -n 19 ffmpeg -y -loop 1 -r 25 -i "${src}" -vf "${vf},fade=t=in:st=0:d=0.5,fade=t=out:st=${(segDuration - 0.5).toFixed(2)}:d=0.5" -t ${segT} -c:v libx264 -preset fast -pix_fmt yuv420p -threads 2 "${out}"`, 60000)
        }
      }))
      task.progress = 35 + Math.round((b + 2) / mp.length * 30)
    }

    // ═══════════════════════════════════════
    // Step 6: 合并片段
    // ═══════════════════════════════════════
    const ct = path.join(wd, 'c.txt')
    fs.writeFileSync(ct, mp.map((_, i) => `file '${wd}/c${i}.mp4'`).join('\n'))
    const mv = path.join(wd, 'm.mp4')
    await run(`ffmpeg -y -f concat -safe 0 -i "${ct}" -c copy "${mv}"`, 120000)

    // ═══════════════════════════════════════
    // Step 7: BGM 混音（循环不足时自动拼接）
    // ═══════════════════════════════════════
    let ai = adjAudio
    if (bgp && fs.existsSync(bgp) && fs.statSync(bgp).size > 1000) {
      const bgpNorm = path.join(wd, 'b_norm.mp3')
      const bgpLoop = path.join(wd, 'b_loop.mp3')
      try {
        await run(`ffmpeg -y -i "${bgp}" -ac 2 -ar 44100 -b:a 128k "${bgpNorm}"`, 30000)
        let bgmSrc = bgpNorm
        try {
          const durOut = await run(`ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${bgpNorm}"`, 10000)
          if ((parseFloat(durOut.trim()) || 0) < totalDur) {
            await run(`ffmpeg -y -stream_loop -1 -i "${bgpNorm}" -t ${totalDur} -c copy "${bgpLoop}"`, 30000)
            bgmSrc = bgpLoop
          }
        } catch {}
        const mx = path.join(wd, 'x.mp3')
        await run(`ffmpeg -y -i "${adjAudio}" -i "${bgmSrc}" -filter_complex "[0:a]volume=1[a1];[1:a]volume=0.25[a2];[a1][a2]amix=inputs=2:duration=first" -ac 2 "${mx}"`, 30000)
        ai = mx
      } catch (e) {
        console.log(`[合成] BGM跳过 task=${task.id}`)
        ai = adjAudio
      }
    }

    task.progress = 85

    // ═══════════════════════════════════════
    // Step 8: 最终渲染（字幕/贴纸/标题）
    // ═══════════════════════════════════════
    let finalVf = ''
    if (showSubs && sp) finalVf = `subtitles='${sp}':force_style='FontSize=${fs2},Alignment=2,MarginV=40'`
    if (stickerText) {
      const pos = posXY(stickerPos, W, H, 28)
      const drawtext = `drawtext=text='${stickerText.slice(0, 12)}':fontsize=28:fontcolor=white:${pos}:shadowx=2:shadowy=2:shadowcolor=black@0.5`
      finalVf = finalVf ? finalVf + ',' + drawtext : drawtext
    }
    if (titleText) {
      const title = `drawtext=text='${titleText.slice(0, 20)}':fontsize=48:fontcolor=white:x=(w-text_w)/2:y=(h-text_h)/2:shadowx=2:shadowy=2:shadowcolor=black@0.6:enable='between(t,0,3)'`
      finalVf = finalVf ? finalVf + ',' + title : title
    }

    const op = path.join('/root/AiMarketing/public/generated', `${task.id}.mp4`)
    const vfArg = finalVf ? `-vf "${finalVf}"` : ''
    console.log(`[合成] 最终渲染 task=${task.id} 时长=${totalDur}s 字幕模式=${subtitleMode}`)
    await run(`ffmpeg -y -i "${mv}" -i "${ai}" ${vfArg} -c:v libx264 -preset medium -crf 23 -c:a aac -map 0:v -map 1:a -t ${totalDur} -threads 2 "${op}"`, 300000)

    // 完成
    task.progress = 100
    console.log(`[合成] ✅ 完成 task=${task.id} 时长=${totalDur}s 模式=${subtitleMode}`)
    task.status = 'completed'
    task.videoUrl = `/api/video/get?id=${task.id}.mp4`

    fs.rmSync(wd, { recursive: true, force: true })
  } catch (e: any) {
    task.status = 'failed'
    task.error = e.message
    console.error(`[合成] ❌ 失败 task=${task.id}`, e.message.slice(0, 300))
  }
}
