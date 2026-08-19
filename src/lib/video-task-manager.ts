import { execSync, execFileSync, execFile } from 'child_process'
import path from 'path'
import fs from 'fs'
import { runFFmpeg, getQueueStatus } from './ffmpeg'

/** SRT 时间戳 "00:01:23,456" → 秒数 */
function parseHms(hms: string): number {
  const m = /(\d+):(\d+):([\d,.]+)/.exec(hms)
  if (!m) return 0
  return parseInt(m[1]) * 3600 + parseInt(m[2]) * 60 + parseFloat(m[3].replace(',', '.'))
}

/** 秒数 → SRT 时间戳 */
function fmtSrtTime(sec: number): string {
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${s.toFixed(3).padStart(6, '0')}`.replace('.', ',')
}

/** 按长度切分文本 */
function splitText(text: string, maxLen: number): string[] {
  const result: string[] = []
  let remain = text.trim()
  while (remain.length > 0) {
    if (remain.length <= maxLen) { result.push(remain); break }
    let cut = maxLen
    // 尽量在标点处切
    const punct = remain.lastIndexOf('，', maxLen) || remain.lastIndexOf(',', maxLen) || remain.lastIndexOf('。', maxLen) || remain.lastIndexOf('！', maxLen) || remain.lastIndexOf('？', maxLen)
    if (punct > maxLen / 2) cut = punct + 1
    result.push(remain.slice(0, cut))
    remain = remain.slice(cut)
  }
  return result
}

export interface VideoTask {
  id: string
  status: 'queued' | 'processing' | 'completed' | 'failed'
  progress: number
  videoUrl?: string
  error?: string
}

/** 字幕时间戳生成模式 */
export type SubtitleMode = 'tts-sync' | 'manual'

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

// 统一使用 ffmpeg.ts 的 runFFmpeg（自带 nice -n 19 + 全局串行队列 + threads 限制）

function isVideoFile(file: string): boolean {
  return /\.(mp4|mov|avi|mkv|webm)$/i.test(file)
}

function getDuration(file: string): number {
  try {
    // 方案1：execFileSync 数组传参，避免 shell 拆解参数
    const out = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', file], { timeout: 10000, encoding: 'utf8' })
    return parseFloat(out.trim()) || 0
  } catch {
    // 方案2：fallback 用 json 格式解析
    try {
      const out = execFileSync('ffprobe', ['-v', 'error', '-show_format', '-of', 'json', file], { timeout: 10000, encoding: 'utf8' })
      const j = JSON.parse(out)
      return parseFloat(j.format?.duration) || 0
    } catch { return 0 }
  }
}

function getVideoSize(file: string): { w: number; h: number } | null {
  try {
    const out = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=s=x:p:0', file], { timeout: 10000, encoding: 'utf8' })
    const [w, h] = out.trim().split('x').map(Number)
    if (w && h) return { w, h }
  } catch {
    try {
      const out = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_streams', '-of', 'json', file], { timeout: 10000, encoding: 'utf8' })
      const j = JSON.parse(out)
      const s = (j.streams || []).find((s: any) => s.codec_type === 'video')
      if (s?.width && s?.height) return { w: s.width, h: s.height }
    } catch {}
  }
  return null
}

/** 异步获取媒体时长（用于 async 函数内，不阻塞事件循环） */
async function getDurationAsync(file: string): Promise<number> {
  try {
    const out = await new Promise<string>((resolve, reject) => {
      execFile('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', file], { timeout: 10000 }, (err, stdout) => {
        if (err) reject(err)
        else resolve(stdout)
      })
    })
    return parseFloat(out.trim()) || 0
  } catch {
    // fallback: json 格式
    try {
      const out = await new Promise<string>((resolve, reject) => {
        execFile('ffprobe', ['-v', 'error', '-show_format', '-of', 'json', file], { timeout: 10000 }, (err, stdout) => {
          if (err) reject(err)
          else resolve(stdout)
        })
      })
      const j = JSON.parse(out)
      return parseFloat(j.format?.duration) || 0
    } catch { return 0 }
  }
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
 * TTS 同步方案（与智能成片完全一致）：按逐句真实 TTS 时长分配时间戳
 * 原理：每句独立合成 TTS 拿到真实时长，字幕按真实时长顺序排布；
 * 单句内按字数(kmax)切分小块，块时长 = 该句时长 / 块数，保证音字同步。
 */
function generateTTSSyncSubtitles(
  lines: string[],
  lineDurations: number[],
  ratio: string,
  workDir: string
): string {
  const wrapMax: Record<string, number> = { '16:9': 22, '9:16': 12, '1:1': 15, '4:3': 18 }
  const maxW = wrapMax[ratio] || 16

  const srtLines: string[] = []
  let entryIdx = 1
  let cursor = 0

  for (let li = 0; li < lines.length; li++) {
    const line = lines[li]
    const lineDur = lineDurations[li] || 2
    const chunks = splitText(line, maxW) // 与智能成片一致：按字数与标点切分
    const chunkDur = chunks.length > 0 ? lineDur / chunks.length : lineDur
    for (let ci = 0; ci < chunks.length; ci++) {
      const t1 = cursor + ci * chunkDur
      const t2 = t1 + chunkDur
      srtLines.push(`${entryIdx}\n${fmtSrtTime(t1)} --> ${fmtSrtTime(t2)}\n${chunks[ci]}`)
      entryIdx++
    }
    cursor += lineDur
  }

  const srtPath = path.join(workDir, 's.srt')
  fs.writeFileSync(srtPath, srtLines.join('\n\n') + '\n', 'utf8')
  console.log(`[字幕-TTS同步] ${lines.length}行→${srtLines.length}条SRT 字幕总时长=${cursor.toFixed(1)}s 比例=${ratio}`)
  return srtPath
}

/**
 * 手动模式：直接使用前端传入的自定义 SRT 时间戳
 */
function generateManualSubtitles(
  customSrt: string,
  workDir: string
): string {
  const srtPath = path.join(workDir, 's.srt')
  fs.writeFileSync(srtPath, customSrt)
  console.log(`[字幕-手动] 使用自定义时间戳 ${customSrt.split('\n').filter(l => /^\d+$/.test(l.trim())).length} 条`)
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
  titleStyle: TitleStyle = 'popin',
  titlePos: 'center' | 'top' | 'bottom' = 'center',
  titleTiming: 'intro' | 'full' = 'intro',
  colorFilter: string = '',
  subtitleMode: SubtitleMode = 'tts-sync',
  customSrt: string = ''
) {
  const task: VideoTask = { id: taskId, status: 'queued', progress: 0 }
  tasks.set(taskId, task)
  const runFn = () => runTask(task, workDir, mediaPaths, text, voice, ratio, resolution, subtitleSize, bgmPath, duration, showSubs, stickerText, stickerPos, titleText, titleStyle, titlePos, titleTiming, colorFilter, subtitleMode, customSrt)
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
  titleStyle: TitleStyle = 'popin',
  titlePos: 'center' | 'top' | 'bottom' = 'center',
  titleTiming: 'intro' | 'full' = 'intro',
  colorFilter: string = '',
  subtitleMode: SubtitleMode = 'tts-sync',
  customSrt: string = ''
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
    // Step 1: 逐句 TTS（与智能成片一致，拿每句真实时长用于字幕同步）
    // ═══════════════════════════════════════
    const ln = text.split('\n').filter(Boolean)
    const { ttsQwen3 } = await import('./qwen3-tts')
    const ttsResults: Array<{ path: string; duration: number }> = []
    for (let i = 0; i < ln.length; i++) {
      const r = await ttsQwen3(ln[i], voice, wd, i)
      // 2026-08-19: 过滤失败段（r.ok=false / 文件不存在）——避免空路径进 concat 列表导致 ffmpeg 报错
      if (r.ok && r.path && fs.existsSync(r.path)) ttsResults.push({ path: r.path, duration: r.duration })
      else console.warn(`[成片] 第${i}句 TTS 失败已跳过: ${(r as any).message || '未知'}（原文：${(ln[i] || '').slice(0, 30)}）`)
      task.progress = 10 + Math.round((i + 1) / ln.length * 10)
    }
    if (ttsResults.length === 0) throw new Error('TTS 合成全部失败，请检查后台百炼语音配置（DASHSCOPE_API_KEY / qwen-tts 模型）')
    const ap = path.join(wd, 't.mp3')
    if (ln.length === 1) {
      fs.copyFileSync(ttsResults[0].path, ap)
    } else {
      const audioList = path.join(wd, 'audio_concat.txt')
      fs.writeFileSync(audioList, ttsResults.map(r => `file '${r.path}'`).join('\n'))
      await runFFmpeg(`-y -f concat -safe 0 -i "${audioList}" -c copy "${ap}"`, { timeout: 60000 })
    }
    task.progress = 20

    // 逐句真实音频时长之和（用于 auto duration 与字幕时间戳）
    const audioDur = ttsResults.reduce((s, r) => s + r.duration, 0)
    console.log(`[合成] 逐句TTS完成 task=${task.id} ${ln.length}句 总音频=${audioDur.toFixed(2)}s`)

    // ═══════════════════════════════════════
    // Step 2: 计算最终视频时长
    //   - auto 模式：真实音频时长 + 1.0s 尾部留白（与智能成片一致）
    //   - 固定模式：使用用户指定时长
    // ═══════════════════════════════════════
    const totalDur = isAutoDur ? Math.max(audioDur + 1.0, dur || 30) : (dur || 30)
    // 固定时长短于真实音频时，按比例压缩每句时长，使字幕对齐被裁剪后的音频
    let lineDurations = ttsResults.map(r => r.duration)
    if (totalDur < audioDur && audioDur > 0) {
      const scale = totalDur / audioDur
      lineDurations = lineDurations.map(d => d * scale)
    }
    const segDuration = totalDur / mp.length
    console.log(`[合成] 视频时长 task=${task.id} totalDur=${totalDur.toFixed(1)}s (auto=${isAutoDur})`)

    // ═══════════════════════════════════════
    // Step 3: 音频处理（裁剪/补静音）
    // ═══════════════════════════════════════
    const adjAudio = path.join(wd, 'ta.mp3')
    try {
      if (audioDur > totalDur) {
        await runFFmpeg(`-y -i "${ap}" -t ${totalDur} -c copy "${adjAudio}"`, { timeout: 30000 })
      } else if (audioDur > 0 && audioDur < totalDur) {
        const padFile = path.join(wd, 'silence.mp3')
        await runFFmpeg(`-y -f lavfi -i anullsrc=r=24000:cl=mono -t ${(totalDur - audioDur).toFixed(1)} "${padFile}"`, { timeout: 10000 })
        await runFFmpeg(`-y -i "${ap}" -i "${padFile}" -filter_complex "[0:a][1:a]concat=n=2:v=0:a=1" -ac 1 "${adjAudio}"`, { timeout: 30000 })
      } else {
        fs.copyFileSync(ap, adjAudio)
      }
    } catch {
      fs.copyFileSync(ap, adjAudio)
    }

    // ═══════════════════════════════════════
    // Step 4: 字幕生成（与智能成片一致的逐句真实时长同步）
    // ═══════════════════════════════════════
    let sp = ''
    if (showSubs && ln.length > 0) {
      switch (subtitleMode) {
        case 'tts-sync':
          sp = generateTTSSyncSubtitles(ln, lineDurations, ratio, wd)
          break
        case 'manual':
          if (customSrt) sp = generateManualSubtitles(customSrt, wd)
          else { console.warn('[字幕-手动] 未提供自定义时间戳，降级到 TTS 同步'); sp = generateTTSSyncSubtitles(ln, lineDurations, ratio, wd) }
          break
        default:
          sp = generateTTSSyncSubtitles(ln, lineDurations, ratio, wd)
      }
    }
    task.progress = 35

    // ═══════════════════════════════════════
    // Step 5: 编码视频片段
    // ═══════════════════════════════════════
    for (let i = 0; i < mp.length; i++) {
      const src = mp[i]
      const out = path.join(wd, `c${i}.mp4`)
        const isVideo = isVideoFile(src)
        const segT = segDuration.toFixed(2)

        if (isVideo) {
          const srcDur = getDuration(src)
          const srcSize = getVideoSize(src)
          let vf = sf
          if (srcSize && srcSize.w >= W && srcSize.h >= H) vf = `pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2`
          if (cf) vf = vf + ',' + cf
          const loop = srcDur < segDuration ? '-stream_loop -1 ' : ''
          await runFFmpeg(`-y ${loop}-i "${src}" -vf "${vf}" -t ${segT} -c:v libx264 -preset fast -pix_fmt yuv420p "${out}"`, { timeout: 180000 })
        } else {
          let vf = sf
          if (cf) vf = vf + ',' + cf
          await runFFmpeg(`-y -loop 1 -r 25 -i "${src}" -vf "${vf},fade=t=in:st=0:d=0.5,fade=t=out:st=${(segDuration - 0.5).toFixed(2)}:d=0.5" -t ${segT} -c:v libx264 -preset fast -pix_fmt yuv420p "${out}"`, { timeout: 60000 })
        }
      task.progress = 35 + Math.round((i + 1) / mp.length * 30)
    }

    // ═══════════════════════════════════════
    // Step 6: 合并片段
    // ═══════════════════════════════════════
    const ct = path.join(wd, 'c.txt')
    fs.writeFileSync(ct, mp.map((_, i) => `file '${wd}/c${i}.mp4'`).join('\n'))
    const mv = path.join(wd, 'm.mp4')
    await runFFmpeg(`-y -f concat -safe 0 -i "${ct}" -c copy "${mv}"`, { timeout: 120000 })

    // ═══════════════════════════════════════
    // Step 7: BGM 混音（循环不足时自动拼接）
    // ═══════════════════════════════════════
    let ai = adjAudio
    if (bgp && fs.existsSync(bgp) && fs.statSync(bgp).size > 1000) {
      const bgpNorm = path.join(wd, 'b_norm.mp3')
      const bgpLoop = path.join(wd, 'b_loop.mp3')
      try {
        await runFFmpeg(`-y -i "${bgp}" -ac 2 -ar 44100 -b:a 128k "${bgpNorm}"`, { timeout: 30000 })
        let bgmSrc = bgpNorm
        try {
          const bgmDur = await getDurationAsync(bgpNorm)
          if (bgmDur < totalDur) {
            await runFFmpeg(`-y -stream_loop -1 -i "${bgpNorm}" -t ${totalDur} -c copy "${bgpLoop}"`, { timeout: 30000 })
            bgmSrc = bgpLoop
          }
        } catch {}
        const mx = path.join(wd, 'x.mp3')
        await runFFmpeg(`-y -i "${adjAudio}" -i "${bgmSrc}" -filter_complex "[0:a]volume=1[a1];[1:a]volume=0.25[a2];[a1][a2]amix=inputs=2:duration=first" -ac 2 "${mx}"`, { timeout: 30000 })
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
    if (showSubs && sp) {
      // libass 对 SRT 按默认虚拟画布 PlayResY=288 解释 force_style 的 FontSize/MarginV（非像素！）
      // 之前直接传像素值导致竖屏被放大 6.67 倍(~390px)且 MarginV=115 被解释为距底 40% 高度(字幕跑到中间)
      // 字幕像素字号：以 24 为基准放大三档梯度，使 小(28)/中(36)/大(44) 肉眼可辨
      // 注：仅调整字号缩放比例，不动 Alignment/MarginV 位置与字幕同步逻辑
      const pxFont = Math.max(14, Math.round(Math.min(W, H) * 0.055 * ((fs2 || 36) / 24)))
      const assFont = Math.max(6, Math.round(pxFont * 288 / H)) // 换算到 288 基准
      finalVf = `subtitles='${sp}':force_style='FontSize=${assFont},Alignment=2,MarginV=17'` // 17/288≈6% 距底
    }
    if (stickerText) {
      const pos = posXY(stickerPos, W, H, 28)
      const safeSticker = stickerText.slice(0, 12).replace(/[':]/g, '\\$&')
      const drawtext = `drawtext=text='${safeSticker}':fontfile='${TITLE_FONT}':fontsize=28:fontcolor=white:${pos}:shadowx=2:shadowy=2:shadowcolor=black@0.5`
      finalVf = finalVf ? finalVf + ',' + drawtext : drawtext
    }
    if (titleText) {
      const ts = titleStyle || 'popin'
      const tp = titlePos || 'center'
      const tt = titleTiming || 'intro'
      const title = buildTitleFilter(titleText.slice(0, 20), ts, dim.w, dim.h, tp, tt)
      finalVf = finalVf ? finalVf + ',' + title : title
      if (ts === 'fade') finalVf += ',fade=t=in:st=0:d=1'
    }

    const op = path.join('/root/AiMarketing/public/generated', `${task.id}.mp4`)
    const vfArg = finalVf ? `-vf "${finalVf}"` : ''
    console.log(`[合成] 最终渲染 task=${task.id} 时长=${totalDur}s 字幕模式=${subtitleMode}`)
    await runFFmpeg(`-y -i "${mv}" -i "${ai}" ${vfArg} -c:v libx264 -preset medium -crf 23 -c:a aac -map 0:v -map 1:a -t ${totalDur} "${op}"`, { timeout: 300000 })

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


// ═══════════════════════════════════════
// 智能成片模式（Smart Compile）
// 在普通成片基础上增加：转场/KenBurns/透明贴纸/动态字幕
// ═══════════════════════════════════════

import {
  SmartCompileOptions,
  CostEstimate,
  TitleStyle,
  TITLE_FONT,
  encodeClipsWithEffects,
  mergeWithTransition,
  finalRenderWithEffects,
  estimateCost,
  buildTitleFilter,
} from './smart-compile-engine'

export interface SmartTaskResult {
  taskId: string
  cost?: CostEstimate
}

/**
 * 启动智能成片任务（与 startTask 并行，互不干扰）
 */
export function startSmartTask(
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
  showSubs: boolean,
  stickerText: string = '',
  stickerPos: string = 'tl',
  titleText: string = '',
  titleStyle: TitleStyle = 'popin',
  titlePos: 'center' | 'top' | 'bottom' = 'center',
  titleTiming: 'intro' | 'full' = 'intro',
  colorFilter: string = '',
  subtitleMode: SubtitleMode = 'tts-sync',
  smartOptions: SmartCompileOptions,
  customSrt: string = '',
  shotDurations: number[] = []
): VideoTask {
  const task: VideoTask = { id: taskId, status: 'queued', progress: 0 }
  tasks.set(taskId, task)

  // 费用预估算
  const cost = estimateCost(smartOptions, duration || 30, subtitleMode)
  console.log(`[智能成片] 预估费用: ${cost.estimatedCNY.toFixed(4)}元 token=${cost.tokens}`)

  const runFn = () => runSmartTask(
    task, workDir, mediaPaths, text, voice, ratio, resolution, subtitleSize,
    bgmPath, duration, showSubs, stickerText, stickerPos, titleText, titleStyle, titlePos, titleTiming, colorFilter, subtitleMode,
    smartOptions, cost, customSrt, shotDurations
  )
  const onDone = () => {}
  const onError = (e: any) => { task.status = 'failed'; task.error = e.message }
  taskQueue.push({ fn: runFn, onDone, onError })
  processQueue()
  return task
}

/**
 * 获取费用估算（前端预览用）
 */
export function getCostEstimate(
  durationSeconds: number,
  subtitleMode: string,
  smartOptions: SmartCompileOptions
): CostEstimate {
  return estimateCost(smartOptions, durationSeconds, subtitleMode)
}

/**
 * 智能成片核心执行函数
 * 流程与普通成片类似，但在 Step 5/6/8 使用增强版渲染引擎
 */
async function runSmartTask(
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
  showSubs: boolean,
  stickerText: string,
  stickerPos: string,
  titleText: string,
  titleStyle: TitleStyle,
  titlePos: 'center' | 'top' | 'bottom',
  titleTiming: 'intro' | 'full',
  colorFilter: string,
  subtitleMode: SubtitleMode,
  smartOptions: SmartCompileOptions,
  costEstimate: CostEstimate,
  customSrt: string = '',
  shotDurations: number[] = []
): Promise<void> {
  try {
    task.status = 'processing'
    const isAutoDur = dur === 0
    console.log(`[智能成片] 开始 task=${task.id} 素材=${mp.length} 转场=${smartOptions.transition} KenBurns=${smartOptions.kenBurns} 字幕样式=${smartOptions.subtitleStyle}`)

    const dim = { '16:9': { w: 1920, h: 1080 }, '9:16': { w: 1080, h: 1920 }, '1:1': { w: 1080, h: 1080 }, '4:3': { w: 1440, h: 1080 } }[ratio] || { w: 1920, h: 1080 }
    const sc = res === '720p' ? 0.5 : 1
    const W = Math.round(dim.w * sc), H = Math.round(dim.h * sc)

    task.progress = 5

    // ── Step 1: 逐句 TTS（Qwen3优先，失败降级edge-tts）──
    const ln = text.split('\n').filter(Boolean)
    const { ttsQwen3 } = await import('./qwen3-tts')
    const ttsResults: Array<{ path: string; duration: number }> = []
    let totalAudioDur = 0

    for (let i = 0; i < ln.length; i++) {
      const r = await ttsQwen3(ln[i], voice, wd, i)
      ttsResults.push({ path: r.path, duration: r.duration })
      totalAudioDur += r.duration
      task.progress = 5 + Math.round((i + 1) / ln.length * 10)
    }
    console.log(`[智能成片-TTS] 逐句合成 ${ln.length}句 总音频=${totalAudioDur.toFixed(1)}s`)

    // concat 所有单句音频 → 完整配音
    const ap = path.join(wd, 't.mp3')
    if (ln.length === 1) {
      fs.copyFileSync(ttsResults[0].path, ap)
    } else {
      const audioList = path.join(wd, 'audio_concat.txt')
      fs.writeFileSync(audioList, ttsResults.map(r => `file '${r.path}'`).join('\n'))
      await runFFmpeg(`-y -f concat -safe 0 -i "${audioList}" -c copy "${ap}"`, { timeout: 60000 })
    }
    task.progress = 15

    // 每镜时长 = 该句TTS真实时长
    const segDuration: number[] = ttsResults.map(r => Math.max(1.0, r.duration))
    const totalDur = totalAudioDur + 1.0
    console.log(`[智能成片-字幕] 每镜时长(逐句TTS): ${segDuration.map(d => d.toFixed(1) + 's').join(', ')}`)

    // ── Step 2: 音频标准化 ──
    const adjAudio = path.join(wd, 'ta.mp3')
    if (totalAudioDur > totalDur) {
      await runFFmpeg(`-y -i "${ap}" -t ${totalDur} -c copy "${adjAudio}"`, { timeout: 30000 })
    } else if (totalAudioDur < totalDur) {
      const padFile = path.join(wd, 'silence.mp3')
      await runFFmpeg(`-y -f lavfi -i anullsrc=r=24000:cl=mono -t ${(totalDur - totalAudioDur).toFixed(1)} "${padFile}"`, { timeout: 10000 })
      await runFFmpeg(`-y -i "${ap}" -i "${padFile}" -filter_complex "[0:a][1:a]concat=n=2:v=0:a=1" -ac 1 "${adjAudio}"`, { timeout: 30000 })
    } else {
      fs.copyFileSync(ap, adjAudio)
    }

    // ── Step 3: 字幕生成（从逐句时长推算）──
    let sp = ''
    if (showSubs && ln.length > 0) {
      let subCursor = 0, entryIdx = 1
      const srtLines: string[] = []
      for (let li = 0; li < ln.length; li++) {
        const lineDur = segDuration[li] || 2
        const subMax = ratio === '9:16' ? 12 : ratio === '1:1' ? 15 : ratio === '4:3' ? 18 : 22
        const chunks = splitText(ln[li], subMax) // 竖屏每行最多12字，横屏22字，未结束自动双排
        const chunkDur = lineDur / chunks.length
        for (let ci = 0; ci < chunks.length; ci++) {
          const t1 = subCursor + ci * chunkDur
          const t2 = t1 + chunkDur
          srtLines.push(`${entryIdx}\n${fmtSrtTime(t1)} --> ${fmtSrtTime(t2)}\n${chunks[ci]}`)
          entryIdx++
        }
        subCursor += lineDur
      }
      sp = path.join(wd, 's.srt')
      fs.writeFileSync(sp, srtLines.join('\n\n') + '\n', 'utf8')
    }
    task.progress = 25

    // ══════════════════════════════════
    // Step 5 增强：带 Ken Burns 效果的片段编码
    // ══════════════════════════════════
    const clipFiles = await encodeClipsWithEffects(mp, wd, segDuration, W, H, sc, colorFilter, smartOptions, (pct) => {
      task.progress = 25 + Math.round(pct)
    })

    // ══════════════════════════════════
    // Step 6 增强：带转场的合并
    // ══════════════════════════════════
    const mergedVideo = await mergeWithTransition(clipFiles, wd, totalDur, smartOptions)
    task.progress = 65

    // ── Step 7: BGM 混音（完全同普通模式）──
    let ai = adjAudio
    if (bgp && fs.existsSync(bgp) && fs.statSync(bgp).size > 1000) {
      const bgpNorm = path.join(wd, 'b_norm.mp3')
      const bgpLoop = path.join(wd, 'b_loop.mp3')
      try {
        await runFFmpeg(`-y -i "${bgp}" -ac 2 -ar 44100 -b:a 128k "${bgpNorm}"`, { timeout: 30000 })
        let bgmSrc = bgpNorm
        try {
          const bgmDur2 = await getDurationAsync(bgpNorm)
          if (bgmDur2 < totalDur) {
            await runFFmpeg(`-y -stream_loop -1 -i "${bgpNorm}" -t ${totalDur} -c copy "${bgpLoop}"`, { timeout: 30000 })
            bgmSrc = bgpLoop
          }
        } catch {}
        const mx = path.join(wd, 'x.mp3')
        await runFFmpeg(`-y -i "${adjAudio}" -i "${bgmSrc}" -filter_complex "[0:a]volume=1[a1];[1:a]volume=0.25[a2];[a1][a2]amix=inputs=2:duration=first" -ac 2 "${mx}"`, { timeout: 30000 })
        ai = mx
      } catch { ai = adjAudio }
    }

    task.progress = 80

    // ══════════════════════════════════
    // Step 8 增强：最终渲染（ASS + overlay）
    // ══════════════════════════════════
    const op = path.join('/root/AiMarketing/public/generated', `${task.id}.mp4`)
    await finalRenderWithEffects(mergedVideo, ai, op, wd, {
      W, H,
      showSubs, srtPath: sp, subtitleSize: fs2, subtitleStyle: smartOptions.subtitleStyle,
      stickerText, stickerPos, stickerOn: !!stickerText,
      titleText, titleOn: !!titleText, titleStyle, titlePos, titleTiming, colorFilter,
      totalDuration: totalDur, smartOptions,
    })

    // 完成
    task.progress = 100
    console.log(`[智能成片] ✅ 完成 task=${task.id} 时长=${totalDur}s 转场=${smartOptions.transition} KenBurns=${smartOptions.kenBurns}`)
    task.status = 'completed'
    task.videoUrl = `/api/video/get?id=${task.id}.mp4`

    fs.rmSync(wd, { recursive: true, force: true })
  } catch (e: any) {
    task.status = 'failed'
    task.error = e.message
    console.error(`[智能成片] ❌ 失败 task=${task.id}`, e.message.slice(0, 300))
  }
}
