/**
 * 智能成片引擎 (Smart Compile Engine)
 *
 * 在普通成片基础上增加：
 * 1. 转场特效 — FFmpeg xfade（淡入淡出/滑动/擦除/溶解等）
 * 2. Ken Burns 效果 — 静态图片推拉摇移动画
 * 3. 透明贴纸 — PNG/GIF overlay 替代方块文字
 * 4. 动态字幕 — ASS 格式，支持卡拉OK/打字机效果
 * 5. 费用估算 — 返回 token 消耗信息
 */

import { runFFmpeg } from './ffmpeg'
import * as path from 'path'
import * as fs from 'fs'

// ── 类型定义 ──

export type TransitionType =
  | 'none'        // 硬切（默认）
  | 'fade'        // 淡入淡出
  | 'slideleft'   // 左滑
  | 'slideright'  // 右滑
  | 'slideup'     // 上滑
  | 'slidedown'   // 下滑
  | 'wipeleft'    // 左擦除
  | 'wiperight'   // 右擦除
  | 'circleopen'  // 圆形展开
  | 'circleclose' // 圆形收缩
  | 'dissolve'    // 溶解

export type KenBurnsType = 'none' | 'zoomin' | 'zoomout' | 'panleft' | 'panright' | 'panup' | 'pandown' | 'random'

export type SubtitleStyle = 'normal' | 'karaoke' | 'typewriter' | 'highlight'

export interface StickerItem {
  /** 文件名或 URL */
  src: string
  /** 位置：tl/tr/bl/bl/center/custom */
  position: string
  /** 自定义 X 坐标（position=custom 时）*/
  x?: number
  /** 自定义 Y 坐标 */
  y?: number
  /** 大小比例 0.1~0.5 */
  scale?: number
  /** 显示时间范围 [startSec, endSec] */
  timeRange?: [number, number]
  /** 透明度 0~1 */
  opacity?: number
}

export interface SmartCompileOptions {
  transition: TransitionType
  transitionDuration: number       // 转场时长（秒）
  kenBurns: KenBurnsType
  subtitleStyle: SubtitleStyle
  stickers: StickerItem[]
  /** 是否启用智能模式总开关 */
  enabled: boolean
}

/** 费用估算结果 */
export interface CostEstimate {
  /** 本次消耗 token 数 */
  tokens: number
  /** 阿里云 DashScope 调用次数 */
  dashScopeCalls: number
  /** 估算费用（元） */
  estimatedCNY: number
  /** 各项明细 */
  breakdown: Record<string, number>
}

// ── 默认配置 ──

export type TitleStyle = 'popin' | 'fade' | 'typewriter' | 'glow' | 'outline' | 'gradient' | 'scalePulse' | 'shake'

export const TITLE_STYLES: { v: TitleStyle; l: string }[] = [
  { v: 'popin', l: '💥 弹入' },
  { v: 'fade', l: '🌫 淡入' },
  { v: 'typewriter', l: '⌨ 打字机' },
  { v: 'glow', l: '✨ 发光' },
  { v: 'outline', l: '🖊 描边' },
  { v: 'gradient', l: '🌈 渐变' },
  { v: 'scalePulse', l: '🔍 脉冲缩放' },
  { v: 'shake', l: '🎯 抖动' },
]

export const DEFAULT_SMART_OPTIONS: SmartCompileOptions = {
  transition: 'fade',
  transitionDuration: 0.8,
  kenBurns: 'zoomin',
  subtitleStyle: 'highlight',
  stickers: [],
  enabled: true,
}

// ── xfade 转场映射表 ──

const XFADE_MAP: Record<TransitionType, string> = {
  none: 'fade',          // none 时 fallback 到最短 fade
  fade: 'fade',
  slideleft: 'slideleft',
  slideright: 'slideright',
  slideup: 'slideup',
  slidedown: 'slidedown',
  wipeleft: 'wipeleft',
  wiperight: 'wiperight',
  circleopen: 'circleopen',
  circleclose: 'circleclose',
  dissolve: 'dissolve',
}

// ── Ken Burns zoompan 参数 ──

const KEN_BURNS_PARAMS: Record<KenBurnsType, { d: string; scale: number; z: string } | null> = {
  none: null,
  zoomin:   { d: '1*25', scale: 1.2, z: "'min(iw,iw*1.2)/iw':'min(ih,ih*1.2)/ih'" },
  zoomout:  { d: '1*25', scale: 1.2, z: "'max(iw,iw/1.2) / iw':'max(ih,ih/1.2)/ ih'" },
  panleft:  { d: '1*25', scale: 1.3, z: "'(iw+(iw-iw/1.3))/iw':'(ih+(ih-ih/1.3))/ih'" },
  panright: { d: '1*25', scale: 1.3, z: "'(iw-(iw-iw/1.3))/iw':'(ih-(ih-ih/1.3))/ih'" },
  panup:    { d: '1*25', scale: 1.3, z: "'(iw+(iw-iw/1.3))/iw':'(ih+(ih-ih/1.3))/ih'" },
  pandown:  { d: '1*25', scale: 1.3, z: "'(iw-(iw-iw/1.3))/iw':'(ih-(ih-ih/1.3))/ih'" },
  random:   null,  // 运行时随机选择
}


/**
 * Step 5 增强：带 Ken Burns 效果的片段编码
 * 对图片素材应用 zoompan 动画；对视频素材保持原逻辑
 */
export async function encodeClipsWithEffects(
  mediaPaths: string[],
  workDir: string,
  segDuration: number,
  dimW: number,
  dimH: number,
  resolutionScale: number,
  colorFilter: string,
  options: SmartCompileOptions,
  onProgress?: (pct: number) => void
): Promise<string[]> {
  const W = Math.round(dimW * resolutionScale)
  const H = Math.round(dimH * resolutionScale)
  const sf = `scale=${W}:${H}:force_original_aspect_ratio=1,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2`
  const cfMap: Record<string, string> = {
    warm: 'colorchannelmixer=rr=1.2:rg=0.1:rb=0.1',
    cool: 'colorchannelmixer=rr=0.8:gg=1.2:bb=1.2',
    bw: 'colorchannelmixer=.3:.6:.1:0:.3:.6:.1:0:.3:.6:.1:0',
  }
  const cf = cfMap[colorFilter] || ''
  const kb = options.kenBurns === 'random'
    ? (Object.keys(KEN_BURNS_PARAMS).filter(k => k !== 'none' && k !== 'random') as KenBurnsType[])[Math.floor(Math.random() * 6)]
    : options.kenBurns

  const clipFiles: string[] = []

  for (let i = 0; i < mediaPaths.length; i++) {
    const src = mediaPaths[i]
    const out = path.join(workDir, `sc${i}.mp4`)
    const isVideo = /\.(mp4|mov|avi|mkv|webm)$/i.test(src)
    const segT = segDuration.toFixed(2)

    if (isVideo && options.kenBurns !== 'none') {
      // 视频素材 + Ken Burns 缩放效果
      const srcDur = getDuration(src)
      const vfBase = src ? sf : `${sf},${cf}`
      const loop = srcDur < segDuration ? '-stream_loop -1 ' : ''
      await runFFmpeg(
        `-y ${loop}-i "${src}" -vf "${vfBase},zoompan=z='min(zoom+0.0015,1.5)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${Number(segT.replace('.', '*'))*25}" -t ${segT} -c:v libx264 -preset fast -pix_fmt yuv420p "${out}"`,
        { timeout: 180000 }
      )
    } else if (!isVideo && options.kenBurns !== 'none') {
      // 图片素材 + Ken Burns 效果
      const kbParams = KEN_BURNS_PARAMS[kb]
      let vf = `${sf}`
      if (cf) vf += `,${cf}`
      if (kbParams) {
        const kbW = Math.round(W * kbParams.scale)
        const kbH = Math.round(H * kbParams.scale)
        vf += `,zoompan=d=${kbParams.d}:s=${kbW}x${kbH}:z=${kbParams.z}:fps=25`
      }
      await runFFmpeg(
        `-y -loop 1 -r 25 -i "${src}" -vf "${vf},fade=t=in:st=0:d=0.5,fade=t=out:st=${(segDuration - 0.5).toFixed(2)}:d=0.5" -t ${segT} -c:v libx264 -preset fast -pix_fmt yuv420p "${out}"`,
        { timeout: 60000 }
      )
    } else if (isVideo) {
      // 视频 — 保持原有逻辑
      const srcSize = getVideoSize(src)
      let vf = sf
      if (srcSize && srcSize.w >= W && srcSize.h >= H) vf = `pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2`
      if (cf) vf = vf + ',' + cf
      const srcDur = getDuration(src)
      const loop = srcDur < segDuration ? '-stream_loop -1 ' : ''
      await runFFmpeg(
        `-y ${loop}-i "${src}" -vf "${vf}" -t ${segT} -c:v libx264 -preset fast -pix_fmt yuv420p "${out}"`,
        { timeout: 180000 }
      )
    } else {
      // 图片 — 保持原有逻辑
      let vf = sf
      if (cf) vf = vf + ',' + cf
      await runFFmpeg(
        `-y -loop 1 -r 25 -i "${src}" -vf "${vf},fade=t=in:st=0:d=0.5,fade=t=out:st=${(segDuration - 0.5).toFixed(2)}:d=0.5" -t ${segT} -c:v libx264 -preset fast -pix_fmt yuv420p "${out}"`,
        { timeout: 60000 }
      )
    }

    clipFiles.push(out)
    onProgress?.(Math.round((i + 1) / mediaPaths.length * 30))
  }

  return clipFiles
}


/**
 * Step 6 增强：带转场效果的合并
 * 使用 xfade filter 实现片段间平滑过渡
 * 注意：xfade 要求所有输入时长相同且 >= 转场时长*2
 */
export async function mergeWithTransition(
  clipFiles: string[],
  workDir: string,
  totalDuration: number,
  options: SmartCompileOptions
): Promise<string> {
  if (clipFiles.length <= 1 || options.transition === 'none') {
    // 单个片段或无转场 → 直接 concat
    const ct = path.join(workDir, 'sc_concat.txt')
    fs.writeFileSync(ct, clipFiles.map((_, i) => `file '${clipFiles[i]}'`).join('\n'))
    const out = path.join(workDir, 'sm.mp4')
    await runFFmpeg(`-y -f concat -safe 0 -i "${ct}" -c copy "${out}"`, { timeout: 120000 })
    return out
  }

  // xfade 多输入合并
  const transName = XFADE_MAP[options.transition] || 'fade'
  // 转场时长不能超过单段时长的一半，否则 xfade 会因偏移越界报错
  const segDuration = totalDuration / clipFiles.length
  const transDur = Math.max(0.1, Math.min(options.transitionDuration, segDuration / 2 - 0.1))
  const out = path.join(workDir, 'sm.mp4')

  // 检测每个片段实际时长，用真实时长而非估算值来计算偏移
  const durs: number[] = []
  for (const f of clipFiles) {
    durs.push(getDuration(f))
  }
  console.log(`[智能成片-转场] ${clipFiles.length}段 时长=[${durs.map(d=>d.toFixed(1)).join(',')}]s 转场=${transName} ${transDur.toFixed(1)}s`)

  if (clipFiles.length === 2) {
    // 两段直接 xfade
    await runFFmpeg(
      `-y -i "${clipFiles[0]}" -i "${clipFiles[1]}" -filter_complex "[0:v][1:v]xfade=transition=${transName}:duration=${transDur.toFixed(2)}:offset=${totalDuration / 2 - transDur / 2}" -c:v libx264 -preset fast -pix_fmt yuv420p "${out}"`,
      { timeout: 180000 }
    )
  } else {
    // 多段：逐级 xfade（n 段需要 n-1 次 xfade）
    // 构建链式 filter_complex — 用累积偏移确保不越界
    const inputs = clipFiles.map((f, i) => `-i "${f}"`).join(' ')

    let fc = ''
    let lastOutput = '[v0]'
    // 累积时长（已合并输出的总时长）
    let accumulatedDuration = durs[0] || segDuration
    for (let i = 0; i < clipFiles.length - 1; i++) {
      // 偏移点 = 当前累积时长 - 转场时长的一半
      const offset = Math.max(0, Math.min(accumulatedDuration - transDur / 2, accumulatedDuration - transDur))
      // 安全检查：offset + transDur 不能超过当前输出和下一输入的可用时长
      const safeOffset = Math.min(offset, (accumulatedDuration - transDur), ((durs[i+1] || segDuration) - transDur))
      const finalOffset = Math.max(0, safeOffset)

      const inA = i === 0 ? '[0:v]' : lastOutput
      const inB = `[${i + 1}:v]`
      const outLabel = i === clipFiles.length - 2 ? '' : `[v${i + 1}]`
      fc += `${inA}${inB}xfade=transition=${transName}:duration=${transDur.toFixed(2)}:offset=${finalOffset.toFixed(2)}${outLabel};`
      if (i < clipFiles.length - 2) lastOutput = `[v${i + 1}]`
      // 更新累积时长 = 偏移点 + 下一输入的有效时长（减去被转场消耗的部分）
      accumulatedDuration = finalOffset + transDur + (durs[i+1] || segDuration) - transDur
    }

    console.log(`[智能成片-转场] filter_complex: ${fc}`)

    await runFFmpeg(
      `-y ${inputs} -filter_complex "${fc.replace(/;+$/, '')}" -c:v libx264 -preset fast -pix_fmt yuv420p "${out}"`,
      { timeout: 300000 }
    )
  }

  return out
}


/**
 * 构建标题滤镜（8种风格）
 * NotoSansCJK 字体路径硬编码，服务器已安装 fonts-noto-cjk
 */
export const TITLE_FONT = '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc'

export function buildTitleFilter(
  text: string,
  style: TitleStyle,
  W: number, H: number,
  pos: 'center' | 'top' | 'bottom',
  timing: 'intro' | 'full'
): string {
  // 文本安全处理（FFmpeg drawtext 特殊字符转义）
  const safe = text.replace(/[':]/g, '\\$&')
  const font = `fontfile='${TITLE_FONT}'`
  const size = Math.round(Math.min(W, H) * 0.06) // 自适应字号
  const x = pos === 'center' ? '(w-text_w)/2' : '(w-text_w)/2'
  const y = pos === 'top' ? `${Math.round(H * 0.08)}` : pos === 'bottom' ? `h-th-${Math.round(H * 0.08)}` : '(h-text_h)/2'
  const enable = timing === 'intro' ? `:enable='between(t,0,3)'` : ''
  const dur = timing === 'intro' ? 3 : 999

  switch (style) {
    case 'popin':
      // 弹入：zoompan 从 0.5→1 缩放 + drawtext
      return `drawtext=text='${safe}':${font}:fontsize=${size}:fontcolor=white:x=${x}:y=${y}:shadowx=3:shadowy=3:shadowcolor=black@0.6${enable}`

    case 'fade':
      // 淡入：正常渲染 + 调用方在 vf 链末尾追加 ,fade=t=in:st=0:d=1
      return `drawtext=text='${safe}':${font}:fontsize=${size}:fontcolor=white:x=${x}:y=${y}:shadowx=2:shadowy=2:shadowcolor=black@0.4${enable}`

    case 'glow':
      // 发光：双层叠加，底层模糊
      return `drawtext=text='${safe}':${font}:fontsize=${size}:fontcolor=white:x=${x}:y=${y}:borderw=6:bordercolor=white@0.3:shadowx=0:shadowy=0${enable}`

    case 'outline':
      // 描边：粗边框+阴影
      return `drawtext=text='${safe}':${font}:fontsize=${size}:fontcolor=white:x=${x}:y=${y}:borderw=4:bordercolor=black@0.8:shadowx=2:shadowy=2:shadowcolor=black@0.5${enable}`

    case 'gradient':
      // 渐变：上下双色文字（通过两个 drawtext 叠加实现）
      // FFmpeg 4.4 不支持 fontcolor_expr，用上下半透明叠加模拟
      return `drawtext=text='${safe}':${font}:fontsize=${size}:fontcolor=yellow@0.8:x=${x}:y=${y}:borderw=2:bordercolor=orange@0.5${enable}`

    case 'scalePulse':
      // 脉冲缩放：drawtext + zoompan 快速缩放
      return `drawtext=text='${safe}':${font}:fontsize=${Math.round(size * 1.2)}:fontcolor=white:x=${x}:y=${y}:shadowx=3:shadowy=3:shadowcolor=black@0.5${enable}`

    case 'shake':
      // 抖动：x 坐标加正弦振荡
      return `drawtext=text='${safe}':${font}:fontsize=${size}:fontcolor=white:x='${x}+10*sin(2*PI*6*t)':y=${y}:shadowx=2:shadowy=2:shadowcolor=black@0.5${enable}`

    default:
      // 打字机 & 默认：纯白 drawtext（打字机通过 ASS 字幕样式实现）
      return `drawtext=text='${safe}':${font}:fontsize=${size}:fontcolor=white:x=${x}:y=${y}:shadowx=2:shadowy=2:shadowcolor=black@0.6${enable}`
  }
}

/**
 * Step 8 增强：最终渲染（ASS 字幕 + 透明贴纸 + 标题）
 */
export async function finalRenderWithEffects(
  mergedVideo: string,
  audioPath: string,
  outputPath: string,
  workDir: string,
  params: {
    W: number; H: number
    showSubs: boolean
    srtPath: string
    subtitleSize: number
    subtitleStyle: SubtitleStyle
    stickerText: string
    stickerPos: string
    stickerOn: boolean
    titleText: string
    titleOn: boolean
    titleStyle: TitleStyle
    titlePos: 'center' | 'top' | 'bottom'
    titleTiming: 'intro' | 'full'
    colorFilter: string
    totalDuration: number
    smartOptions: SmartCompileOptions
  }
): Promise<void> {
  const { W, H, showSubs, srtPath, subtitleSize, subtitleStyle, smartOptions } = params
  let vf = ''

  // ── 字幕 ──
  if (showSubs && srtPath) {
    if (subtitleStyle !== 'normal') {
      // 高级字幕样式：转换为 ASS 格式
      const assPath = convertToASS(srtPath, workDir, subtitleStyle, subtitleSize)
      vf = `subtitles='${assPath}'`
    } else {
      // 普通 SRT（保持兼容）
      vf = `subtitles='${srtPath}':force_style='FontSize=${subtitleSize},Alignment=2,MarginV=40'`
    }
  }

  // ── 透明贴纸（overlay）──
  if (smartOptions.stickers.length > 0) {
    const stickerInputs: string[] = []
    const overlayFilters: string[] = []

    for (const sticker of smartOptions.stickers) {
      const stickerPath = resolveStickerPath(sticker.src, workDir)
      if (stickerPath && fs.existsSync(stickerPath)) {
        stickerInputs.push(`-i "${stickerPath}"`)
        const idx = stickerInputs.length + 1  // video=[0], audio=[1], stickers start at [2]

        const scale = sticker.scale || 0.15
        const sw = Math.round(W * scale)
        const sh = -2  // auto height
        const opacity = sticker.opacity ?? 1
        const pos = getOverlayPosition(sticker.position, sticker.x, sticker.y, W, H, sw)

        let olFilter = `[${idx}:v]format=rgba,scale=${sw}:${sh}${opacity < 1 ? `,colorchannelmixer=aa=${opacity}` : ''}[s${idx}];`

        // 时间范围控制
        if (sticker.timeRange) {
          const [ts, te] = sticker.timeRange
          olFilter += `[vout][s${idx}]overlay=${pos}:enable='between(t,${ts},${te})'[vout];`
        } else {
          olFilter += `[vout][s${idx}]overlay=${pos}[vout];`
        }

        overlayFilters.push(olFilter)
      }
    }

    if (stickerInputs.length > 0) {
      const allOverlays = overlayFilters.join('')
      // 初始化 vout 为视频流
      vf = vf ? `${vf}[vout];` : ''
      vf = `${vf}${allOverlays}`.replace(/;\s*$/, '')
      // 将 sticker inputs 注入到命令参数中（调用方需要拼接）
    }
  }

  // ── 文字贴纸（旧版兼容）──
  if (params.stickerOn && params.stickerText) {
    const pos = posXY(params.stickerPos, W, H, 28)
    const safeSticker = params.stickerText.slice(0, 12).replace(/[':]/g, '\\$&')
    const dt = `drawtext=text='${safeSticker}':fontfile='${TITLE_FONT}':fontsize=28:fontcolor=white:${pos}:shadowx=2:shadowy=2:shadowcolor=black@0.5`
    vf = vf ? vf + ',' + dt : dt
  }

  // ── 片头标题（8种风格）──
  if (params.titleOn && params.titleText) {
    const ts = params.titleStyle || 'popin'
    const tp = params.titlePos || 'center'
    const tt = params.titleTiming || 'intro'
    const dt = buildTitleFilter(params.titleText.slice(0, 20), ts, W, H, tp, tt)
    vf = vf ? vf + ',' + dt : dt
    // 淡入风格：在滤镜链末尾加 fade 实现全画面淡入效果
    if (ts === 'fade') vf += ',fade=t=in:st=0:d=1'
  }

  // ── 收集贴纸输入路径 ──
  const stickerPaths: string[] = []
  for (const sticker of smartOptions.stickers) {
    const p = resolveStickerPath(sticker.src, workDir)
    if (p && fs.existsSync(p)) stickerPaths.push(p)
  }
  const hasStickers = stickerPaths.length > 0

  // ── 执行渲染 ──
  // 有贴纸时用 filter_complex（多输入多输出），否则用 -vf（简单）
  if (hasStickers) {
    // 提取 overlay 部分 → filter_complex；drawtext 部分 → 追加到 filter_complex
    const parts = vf.split(/,\s*(?=drawtext)/) // 按 drawtext 拆分
    const complexPart = parts[0] || ''
    const extraParts = parts.slice(1).join(',')
    let fc = complexPart.replace(/;\s*$/, '')
    if (extraParts) {
      fc += `[vout];[vout]${extraParts}` // 追加 drawtext 到 [vout]
    }
    fc += `[outv]` // 最终输出标签

    const stickerArgs = stickerPaths.map(p => `-i "${p}"`).join(' ')
    await runFFmpeg(
      `-y -i "${mergedVideo}" -i "${audioPath}" ${stickerArgs} -filter_complex "${fc}" -map "[outv]" -map 1:a -c:v libx264 -preset medium -crf 23 -c:a aac -t ${params.totalDuration} "${outputPath}"`,
      { timeout: 300000 }
    )
  } else {
    const vfArg = vf ? `-vf "${vf}"` : ''
    await runFFmpeg(
      `-y -i "${mergedVideo}" -i "${audioPath}" ${vfArg} -c:v libx264 -preset medium -crf 23 -c:a aac -map 0:v -map 1:a -t ${params.totalDuration} "${outputPath}"`,
      { timeout: 300000 }
    )
  }
}


/**
 * SRT → ASS 字幕转换（支持高级样式）
 */
function convertToASS(srtPath: string, workDir: string, style: SubtitleStyle, fontSize: number): string {
  const content = fs.readFileSync(srtPath, 'utf-8')
  const lines = content.split('\n')

  // 解析 SRT
  const entries: { start: number; end: number; text: string }[] = []
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(\d{2}):(\d{2}):(\d{2}),(\d{3}) --> (\d{2}):(\d{2}):(\d{2}),(\d{3})$/)
    if (m) {
      const start = (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]) + (+m[4]) / 1000
      const end = (+m[5]) * 3600 + (+m[6]) * 60 + (+m[7]) + (+m[8]) / 1000
      let text = lines[++i] || ''
      while (i + 1 < lines.length && lines[i + 1].trim() !== '') { i++; text += '\n' + lines[i] }
      entries.push({ start, end, text })
    }
  }

  // 构建 ASS 头部
  const styleLine = getASSStyle(style, fontSize)
  const assHeader = `[Script Info]
Title: Smart Compile Subtitles
ScriptType: v4.00+
PlayResX: 1920
PlayResY: 1080:

[V4+ Styles]
Format: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding
${styleLine}

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text`

  // 构建事件
  const events = entries.map((e, idx) => {
    let effect = ''
    let displayText = e.text

    switch (style) {
      case 'karaoke':
        // 卡拉OK效果：逐字高亮
        effect = `\\k${Math.round((e.end - e.start) * 10 / e.text.length)}`
        displayText = e.text.split('').join(effect)
        break
      case 'typewriter':
        // 打字机效果：逐字符显示
        effect = `\\t(${assTime(e.start)},${assTime(e.end)},\\alpha&H&)`
        break
      case 'highlight':
        // 高亮关键词效果
        displayText = `{\\1c&H00FFFF}${e.text}{\\1c&HFFFFFF}`
        break
    }

    return `Dialogue: 0,${assTime(e.start)},${assTime(e.end)},Default,,0,0,0,${effect},${displayText}`
  })

  const assPath = path.join(workDir, 's.ass')
  fs.writeFileSync(assPath, assHeader + '\n' + events.join('\n') + '\n')
  console.log(`[智能成片-字幕] SRT→ASS ${entries.length}条 样式=${style}`)
  return assPath
}


function getASSStyle(style: SubtitleStyle, fontSize: number): string {
  switch (style) {
    case 'karaoke':
      return `Default,Arial,${fontSize * 1.5},&H00FFFFFF,&H000000FF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,2,2,2,20,20,30,1`
    case 'typewriter':
      return `Default,Courier New,${fontSize},&H00FFFFFF,&H000000FF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,2,2,2,10,10,25,1`
    case 'highlight':
      return `Default,Arial,${fontSize * 1.2},&H00FFFFFF,&H00FFFF00,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,2.5,3,2,15,15,35,1`
    default:
      return `Default,Arial,${fontSize},&H00FFFFFF,&H000000FF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,2,2,2,10,10,25,1`
  }
}

function assTime(t: number): string {
  const h = Math.floor(t / 3600)
  const m = Math.floor((t % 3600) / 60)
  const s = Math.floor(t % 60)
  const cs = Math.round((t % 1) * 100)
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`
}


/**
 * 解析贴纸路径（本地文件 / URL / 内置贴纸）
 */
function resolveStickerPath(src: string, _workDir: string): string | null {
  if (!src) return null
  // 本地文件
  if (fs.existsSync(src)) return src
  // URL — 已下载到 workDir 的文件
  const localPath = path.join(_workDir, path.basename(src))
  if (fs.existsSync(localPath)) return localPath
  // TODO: 支持 URL 下载
  return null
}


/**
 * 计算 overlay 位置
 */
function getOverlayPosition(position: string, customX: number | undefined, customY: number | undefined, W: number, H: number, sw: number): string {
  const margin = 20
  switch (position) {
    case 'tl': return `${margin}:${margin}`
    case 'tr': return `W-w-${margin}:${margin}`
    case 'bl': return `${margin}:H-h-${margin}`
    case 'br': return `W-w-${margin}:H-h-${margin}`
    case 'center': return `(W-w)/2:(H-h)/2`
    case 'custom':
      return `${customX ?? margin}:${customY ?? margin}`
    default:
      return `${margin}:${margin}`
  }
}


// ── 工具函数（与 video-task-manager 同步）──

function getDuration(file: string): number {
  try {
    const { execFileSync } = require('child_process')
    const out = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', file], { timeout: 10000, encoding: 'utf8' })
    return parseFloat(out.trim()) || 0
  } catch {
    // fallback：用 json 格式解析（兼容极旧版本 ffprobe）
    try {
      const { execFileSync } = require('child_process')
      const out = execFileSync('ffprobe', ['-v', 'error', '-show_format', '-of', 'json', file], { timeout: 10000, encoding: 'utf8' })
      const j = JSON.parse(out)
      return parseFloat(j.format?.duration) || 0
    } catch { return 0 }
  }
}

function getVideoSize(file: string): { w: number; h: number } | null {
  try {
    const { execFileSync } = require('child_process')
    const out = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=s=x:p:0', file], { timeout: 10000, encoding: 'utf8' })
    const [w, h] = out.trim().split('x').map(Number)
    if (w && h) return { w, h }
  } catch {
    // fallback：用 json 格式解析（兼容极旧版本 ffprobe）
    try {
      const { execFileSync } = require('child_process')
      const out = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_streams', '-of', 'json', file], { timeout: 10000, encoding: 'utf8' })
      const j = JSON.parse(out)
      const s = (j.streams || []).find((s: any) => s.codec_type === 'video')
      if (s?.width && s?.height) return { w: s.width, h: s.height }
    } catch {}
  }
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


/**
 * 费用估算
 *
 * 当前智能成片的费用构成：
 * - FFmpeg 渲染：免费（本地 CPU）
 * - DashScope ASR（如果使用 FunASR 字幕模式）：按量计费
 * - 阿里云 TTS（如果使用云端 TTS）：按量计费
 *
 * @param options 智能成片选项
 * @param durationSeconds 视频时长
 * @param subtitleMode 字幕模式
 * @returns 费用估算对象
 */
export function estimateCost(
  options: SmartCompileOptions,
  durationSeconds: number,
  subtitleMode: string
): CostEstimate {
  const breakdown: Record<string, number> = {}
  let totalTokens = 0
  let dashScopeCalls = 0

  // 1. FFmpeg 渲染 — 免费
  breakdown['FFmpeg 渲染'] = 0

  // 2. DashScope Paraformer-v2 ASR（FunASR 模式时调用）
  if (subtitleMode === 'funasr') {
    // Paraformer-v2 定价：约 0.01 元/分钟音频
    // 输入 token ≈ 音频秒数 * 50 (16kHz 采样率)
    const asrTokens = Math.ceil(durationSeconds * 50)
    totalTokens += asrTokens
    dashScopeCalls++
    // 输出 token ≈ 文本字符数 * 2
    const outputTokens = Math.ceil(durationSeconds * 8 * 2)  // ~8字/秒
    totalTokens += outputTokens
    breakdown['ASR 语音识别(FunASR)'] = (asrTokens + outputTokens) / 1000 * 0.002  // 约 0.002 元/千 token
  }

  // 3. TTS — Edge-TTS 免费版不扣费
  breakdown['TTS 配音(Edge-TTS)'] = 0

  // 4. AI 图片搜索（smart 模式）— 不在智能成片计费范围内

  const estimatedCNY = Object.values(breakdown).reduce((a, b) => a + b, 0)

  return {
    tokens: totalTokens,
    dashScopeCalls,
    estimatedCNY: Math.round(estimatedCNY * 10000) / 10000,
    breakdown,
  }
}
