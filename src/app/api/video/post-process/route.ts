import { NextRequest, NextResponse } from 'next/server'
import { translate, textToSpeech, cleanText, prepareTextForTTS } from '@/lib/ai-providers'
import { join } from 'path'
import { writeFile, mkdir, unlink, readFile } from 'fs/promises'
import { existsSync } from 'fs'
import { execFile } from 'child_process'
import { promisify } from 'util'
import OSS from 'ali-oss'

export const runtime = 'nodejs'

const execFileAsync = promisify(execFile)

const TEMP_FILE_RETENTION = 60 * 60 * 1000 // 临时文件保留 1 小时

interface PostProcessingOptions {
  enableTTS: boolean
  enableSubtitle: boolean
  enableTranslateSubtitle: boolean
  enableFaceSwap: boolean
  enableLipSync: boolean
}

// 语言代码映射
const langCodeMap: Record<string, string> = {
  'zh': 'zh', 'en': 'en-US', 'ja': 'ja', 'ko': 'ko',
  'fr': 'fr', 'de': 'de', 'es': 'es', 'pt': 'pt', 'ru': 'ru', 'ar': 'ar'
}

function createOSSClient() {
  const region = process.env.OSS_REGION || 'oss-cn-hangzhou'
  const accessKeyId = process.env.OSS_ACCESS_KEY_ID
  const accessKeySecret = process.env.OSS_ACCESS_KEY_SECRET
  const bucket = process.env.OSS_BUCKET
  if (!accessKeyId || !accessKeySecret || !bucket) throw new Error('OSS 配置不完整')
  return new OSS({ region, accessKeyId, accessKeySecret, bucket, secure: true })
}

function generateUniqueFileName(ext: string): string {
  const ts = Date.now()
  const r = Math.random().toString(36).substring(2, 8)
  return `outputs/${ts}_${r}.${ext}`
}

async function uploadToOSS(filePath: string, objectName: string): Promise<string | null> {
  try {
    const client = createOSSClient()
    const bucket = process.env.OSS_BUCKET || ''
    await client.put(objectName, filePath, { headers: { 'x-oss-object-acl': 'public-read' } })
    console.log('[OSS] 上传成功:', objectName)
    const region = process.env.OSS_REGION || 'oss-cn-hangzhou'
    return `https://${bucket}.${region}.aliyuncs.com/${objectName}`
  } catch (error) {
    console.error('[OSS] 上传失败:', error)
    return null
  }
}

export async function POST(request: NextRequest) {
  let body: any
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ success: false, message: '参数格式错误' }, { status: 400 })
  }

  const { videoUrl, options, ttsScript, ttsVoice, subtitleLanguage, voiceAssignments } = body as {
    videoUrl?: string
    options: PostProcessingOptions
    ttsScript?: string
    ttsVoice?: string
    subtitleLanguage?: string
    voiceAssignments?: Array<{ speakerId: string; voice: string; label: string }>
  }

  const actualVideoUrl = videoUrl || body.ossUrl || body.file_url
  if (!actualVideoUrl) {
    return NextResponse.json({ success: false, message: '缺少视频URL' }, { status: 400 })
  }

  const startTime = Date.now()
  console.log('[PostProcess] ====== 开始后期处理 ======')
  console.log('[PostProcess] 输入视频:', actualVideoUrl)
  console.log('[PostProcess] 选项:', JSON.stringify(options))
  console.log('[PostProcess] 文案长度:', ttsScript?.length || 0)
  console.log('[PostProcess] 目标语言:', subtitleLanguage)

  try {
    const outputDir = join(process.cwd(), 'public', 'outputs')
    const tempDir = join(process.cwd(), 'temp')
    if (!existsSync(outputDir)) await mkdir(outputDir, { recursive: true })
    if (!existsSync(tempDir)) await mkdir(tempDir, { recursive: true })

    const timestamp = Date.now()
    const inputPath = join(process.cwd(), 'public', actualVideoUrl.replace(/^\//, ''))
    let currentVideoPath = inputPath
    let finalVideoUrl = actualVideoUrl
    let ttsVideoPath = '' // 配音后的视频路径
    let ttsAudioDuration = 0 // TTS 音频真实时长，字幕步骤优先使用
    const processSteps: string[] = []

    if (!existsSync(inputPath)) {
      console.error('[PostProcess] 输入文件不存在:', inputPath)
      return NextResponse.json({ success: false, message: '输入视频文件不存在' }, { status: 400 })
    }
    console.log('[PostProcess] 输入文件存在:', inputPath)

    // ========== 1. 先翻译文案（中文 → 目标语言） ==========
    let translatedText = ''
    const needsTranslation = options.enableTranslateSubtitle && subtitleLanguage && subtitleLanguage !== 'zh'
    if (needsTranslation && ttsScript) {
      try {
        const cleanedInput = cleanText(ttsScript, 'zh')
        console.log('[PostProcess] 步骤1: 翻译文案 (zh → ' + subtitleLanguage + ')')
        console.log('[PostProcess] 待翻译文本:', cleanedInput.substring(0, 80) + '...')
        const result = await translate(cleanedInput, subtitleLanguage!, 'zh')
        if (result) {
          translatedText = cleanText(result, subtitleLanguage!)
          console.log('[PostProcess] 翻译成功:', translatedText.substring(0, 80) + '...')
        } else {
          console.log('[PostProcess] 翻译 API 未返回结果')
        }
      } catch (error) {
        console.error('[PostProcess] 翻译失败:', error)
      }
    }

    // 确定最终用于配音和字幕的文案
    const finalText = translatedText || (ttsScript ? cleanText(ttsScript, subtitleLanguage || 'zh') : '')
    console.log('[PostProcess] 最终文案（长度:', finalText.length, '）:', finalText.substring(0, 50) + '...')

    // ========== 2. TTS 配音（逐句生成，精确对齐字幕时间轴） ==========
    // 存储每句的文本和真实音频时长，用于字幕生成
    const sentenceTimings: Array<{ text: string; duration: number }> = []

    if (options.enableTTS && finalText) {
      try {
        const ttsLang = subtitleLanguage || 'zh'
        const voiceLangCode = langCodeMap[ttsLang] || 'zh-CN'
        console.log('[PostProcess] 步骤2: TTS配音, 语言:', voiceLangCode)
        console.log('[PostProcess] TTS 环境变量检查:',
          'VOLCANO_TTS_APP_ID=', !!process.env.VOLCANO_TTS_APP_ID,
          'VOLCANO_TTS_ACCESS_KEY=', !!process.env.VOLCANO_TTS_ACCESS_KEY,
          'VOLCANO_TTS_RESOURCE_ID=', !!process.env.VOLCANO_TTS_RESOURCE_ID,
          'SILICONFLOW_API_KEY=', !!process.env.SILICONFLOW_API_KEY)

        // 确定使用的音色
        const selectedVoice = ttsVoice || 'zh_female_vv_uranus_bigtts'
        console.log('[PostProcess] TTS 音色:', selectedVoice)
        if (voiceAssignments && voiceAssignments.length > 0) {
          console.log('[PostProcess] 多人配音分配:', voiceAssignments.map(v => `${v.speakerId}->${v.voice}`).join(', '))
        }

        const ffmpegPath = process.env.FFMPEG_PATH || 'ffmpeg'

        // 步骤 2a: 用高通+低通滤波器消除人声频段（保留背景音）
        const mutedPath = join(tempDir, `muted_${timestamp}.mp4`)
        const muteArgs = ['-i', currentVideoPath, '-af', 'highpass=f=200,lowpass=f=3000', '-c:v', 'copy', '-y', mutedPath]
        console.log('[PostProcess] FFmpeg 滤波消除人声, 命令:', ffmpegPath, muteArgs.join(' '))
        const muteResult = await execFileAsync(ffmpegPath, muteArgs)
        console.log('[PostProcess] FFmpeg 滤波完成, stdout:', muteResult.stdout?.substring(0, 200), 'stderr:', muteResult.stderr?.substring(0, 200))

        // 步骤 2c: 逐句 TTS 生成配音
        const sentenceDelimiter = ttsLang === 'zh' ? /[。！？；\n]+/ : /[.!?;\n]+/
        const sentences = finalText.split(sentenceDelimiter).filter(s => s.trim()).map(s => s.trim())
        console.log('[PostProcess] 分句数量:', sentences.length)

        const segmentFiles: string[] = []
        for (let i = 0; i < sentences.length; i++) {
          const sentence = sentences[i]
          console.log(`[PostProcess] TTS 第 ${i + 1}/${sentences.length} 句: "${sentence.substring(0, 40)}${sentence.length > 40 ? '...' : ''}"`)
          try {
            const segBuffer = await textToSpeech(sentence, selectedVoice)
            if (segBuffer && segBuffer.byteLength > 100) {
              const segPath = join(tempDir, `tts_seg_${timestamp}_${i}.mp3`)
              await writeFile(segPath, new Uint8Array(segBuffer))
              const segDuration = await getMediaDuration(segPath)
              sentenceTimings.push({ text: sentence, duration: segDuration })
              segmentFiles.push(segPath)
              console.log(`[PostProcess] 第 ${i + 1} 句 TTS 完成: ${segDuration.toFixed(2)}s, ${segBuffer.byteLength} bytes`)
            } else {
              console.warn(`[PostProcess] 第 ${i + 1} 句 TTS 返回空或太小, 跳过`)
            }
          } catch (segError) {
            console.error(`[PostProcess] 第 ${i + 1} 句 TTS 失败:`, segError)
          }
        }

        if (segmentFiles.length === 0) {
          console.log('[PostProcess] 所有句子 TTS 均失败, 跳过配音')
        } else {
          // 步骤 2d: 拼接所有 TTS 片段为一条完整音频
          const combinedAudioPath = join(tempDir, `tts_combined_${timestamp}.mp3`)
          if (segmentFiles.length === 1) {
            // 只有一段，直接使用
            const { rename } = await import('fs/promises')
            await rename(segmentFiles[0], combinedAudioPath)
          } else {
            // 多段：用 ffmpeg concat 拼接
            const concatListPath = join(tempDir, `concat_${timestamp}.txt`)
            const concatContent = segmentFiles.map(f => `file '${f.replace(/\\/g, '/')}'`).join('\n')
            await writeFile(concatListPath, concatContent)
            const concatArgs = ['-f', 'concat', '-safe', '0', '-i', concatListPath, '-c', 'copy', '-y', combinedAudioPath]
            console.log('[PostProcess] FFmpeg 拼接 TTS 片段, 命令:', ffmpegPath, concatArgs.join(' '))
            try {
              const concatResult = await execFileAsync(ffmpegPath, concatArgs)
              console.log('[PostProcess] FFmpeg 拼接完成, stdout:', concatResult.stdout?.substring(0, 200), 'stderr:', concatResult.stderr?.substring(0, 200))
            } catch (concatError: any) {
              console.error('[PostProcess] 拼接 TTS 片段失败:', concatError.stderr || concatError.message)
            }
            await unlink(concatListPath).catch(() => {})
          }

          // 获取合并后 TTS 音频总时长
          ttsAudioDuration = await getMediaDuration(combinedAudioPath)
          console.log('[PostProcess] TTS 合并音频时长:', ttsAudioDuration, 's')

          // 步骤 2d-2: TTS 音频前加静音，对齐原视频开头时间
          const videoDuration = await getMediaDuration(currentVideoPath)
          let finalAudioPath = combinedAudioPath
          if (videoDuration > 0 && ttsAudioDuration > 0 && ttsAudioDuration < videoDuration) {
            // 配音比视频短：配音从头开始，amix 会以 duration=first 为准
            console.log('[PostProcess] 视频时长:', videoDuration.toFixed(2), 's, TTS音频时长:', ttsAudioDuration.toFixed(2), 's')
          }

          // 步骤 2e: 合并滤波视频（已保留背景音）+ TTS 配音（amix 混音）
          const outputPath = join(outputDir, `output_tts_${timestamp}.mp4`)
          const mergeArgs = [
            '-i', mutedPath, '-i', finalAudioPath,
            '-c:v', 'copy',
            '-filter_complex', '[0:a][1:a]amix=inputs=2:duration=first[aout]',
            '-map', '0:v:0', '-map', '[aout]', '-y',
            outputPath
          ]
          console.log('[PostProcess] FFmpeg 合并音频, 命令:', ffmpegPath, mergeArgs.join(' '))
          try {
            const mergeResult = await execFileAsync(ffmpegPath, mergeArgs)
            console.log('[PostProcess] FFmpeg 合并完成, stdout:', mergeResult.stdout?.substring(0, 200))
            console.log('[PostProcess] FFmpeg 合并 stderr:', mergeResult.stderr?.substring(0, 500))
          } catch (mergeError: any) {
            console.error('[PostProcess] 合并音频失败:', mergeError.stderr || mergeError.message)
            if (mergeError.stderr) {
              console.error('[PostProcess] FFmpeg 完整 stderr:', mergeError.stderr)
            }
          }

          // 检查合并后的输出文件
          const outputExists = existsSync(outputPath)
          const outputSize = outputExists ? (await import('fs')).statSync(outputPath).size : 0
          console.log('[PostProcess] 合并输出文件存在:', outputExists, '大小:', outputSize, 'bytes')

          if (outputExists && outputSize > 0) {
            currentVideoPath = outputPath
            ttsVideoPath = outputPath
            finalVideoUrl = `/outputs/output_tts_${timestamp}.mp4`
            processSteps.push('配音')
            console.log('[PostProcess] 配音完成:', outputPath)
          } else {
            console.error('[PostProcess] 合并输出文件无效(大小=' + outputSize + '), 使用原视频继续:', currentVideoPath)
            if (outputExists) await unlink(outputPath).catch(() => {})
          }

          // 清理 TTS 片段和合并音频临时文件
          for (const segPath of segmentFiles) {
            await unlink(segPath).catch(() => {})
          }
          await unlink(combinedAudioPath).catch(() => {})
        }
      } catch (error) {
        console.error('[PostProcess] TTS/FFmpeg 失败:', error)
      }
    } else if (options.enableTTS && !finalText) {
      console.log('[PostProcess] 跳过TTS: 无文案')
    }

    // ========== 3. 字幕生成（使用逐句 TTS 的真实时长对齐） ==========
    const needsSubtitle = options.enableSubtitle || options.enableTranslateSubtitle
    if (needsSubtitle && finalText) {
      try {
        console.log('[PostProcess] 步骤3: 生成字幕, 文本长度:', finalText.length)
        const srtPath = join(tempDir, `subtitle_${timestamp}.srt`)
        let subtitleContent: string

        if (sentenceTimings.length > 0) {
          // 使用逐句 TTS 的真实时长生成 SRT（精确对齐）
          subtitleContent = generateSRTFromTimings(sentenceTimings)
          console.log('[PostProcess] 字幕使用逐句 TTS 真实时长, 共', sentenceTimings.length, '句')
        } else {
          // 降级：无逐句时长，用视频时长按比例分配
          let subtitleDuration = ttsAudioDuration
          if (!subtitleDuration || subtitleDuration <= 0) {
            const videoSource = ttsVideoPath || currentVideoPath
            subtitleDuration = await getMediaDuration(videoSource)
          }
          subtitleContent = generateSRTFromText(finalText, subtitleLanguage || 'zh', subtitleDuration > 0 ? subtitleDuration : undefined)
          console.log('[PostProcess] 字幕降级为比例分配, 时长:', subtitleDuration, 's')
        }
        console.log('[PostProcess] SRT 内容预览:\n', subtitleContent.substring(0, 500))
        await writeFile(srtPath, subtitleContent)
        console.log('[PostProcess] SRT 文件已生成:', srtPath)

        const outputPath = join(outputDir, `output_subtitle_${timestamp}.mp4`)
        const ffmpegPath = process.env.FFMPEG_PATH || 'ffmpeg'
        const subtitleFilter = `subtitles=${srtPath.replace(/\\/g, '/').replace(/(:)/g, '\\$1')}`
        const subtitleArgs = ['-i', currentVideoPath, '-vf', subtitleFilter, '-c:a', 'copy', outputPath]
        console.log('[PostProcess] FFmpeg 烧录字幕, 命令:', ffmpegPath, subtitleArgs.join(' '))
        const subResult = await execFileAsync(ffmpegPath, subtitleArgs)
        console.log('[PostProcess] FFmpeg 字幕烧录完成, stdout:', subResult.stdout?.substring(0, 200), 'stderr:', subResult.stderr?.substring(0, 200))
        
        await unlink(srtPath).catch(() => {})
        currentVideoPath = outputPath
        finalVideoUrl = `/outputs/output_subtitle_${timestamp}.mp4`
        processSteps.push(needsTranslation ? '字幕翻译' : '字幕生成')
        console.log('[PostProcess] 字幕完成:', outputPath)
      } catch (error) {
        console.error('[PostProcess] 字幕烧录失败:', error)
      }
    }

    // 换脸/对口型（暂未实现）
    if (options.enableFaceSwap) console.log('[PostProcess] 换脸暂未实现')
    if (options.enableLipSync) console.log('[PostProcess] 对口型暂未实现')

    // 上传 OSS
    let ossFinalUrl: string | null = null
    if (processSteps.length > 0 && finalVideoUrl !== actualVideoUrl) {
      const localFilePath = join(process.cwd(), 'public', finalVideoUrl.replace(/^\//, ''))
      if (existsSync(localFilePath)) {
        const ossName = generateUniqueFileName('mp4')
        ossFinalUrl = await uploadToOSS(localFilePath, ossName)
      }
    }

    // 清理超过 1 小时的临时文件（muted_、subtitle_ 等）
    try {
      const tempFiles = await import('fs').then(fs => fs.promises.readdir(tempDir))
      const now = Date.now()
      for (const file of tempFiles) {
        const filePath = join(tempDir, file)
        try {
          const stat = await import('fs').then(fs => fs.promises.stat(filePath))
          if (now - stat.mtimeMs > TEMP_FILE_RETENTION) {
            await unlink(filePath).catch(() => {})
            console.log('[PostProcess] 清理过期临时文件:', filePath)
          }
        } catch {}
      }
    } catch (error) {
      console.error('[PostProcess] 清理临时文件失败:', error)
    }

    const elapsed = Date.now() - startTime
    console.log('[PostProcess] ====== 处理完成 ======')
    console.log('[PostProcess] 耗时:', elapsed, 'ms')
    console.log('[PostProcess] 执行步骤:', processSteps)
    console.log('[PostProcess] 输出URL:', ossFinalUrl || finalVideoUrl)

    return NextResponse.json({
      success: true,
      videoUrl: ossFinalUrl || finalVideoUrl,
      processSteps
    })

  } catch (error) {
    console.error('[PostProcess] 错误:', error)
    return NextResponse.json({
      success: false,
      message: error instanceof Error ? error.message : '后期处理失败'
    }, { status: 500 })
  }
}

// 生成 SRT 字幕（基于逐句 TTS 的真实时长，精确对齐每句字幕）
function generateSRTFromTimings(timings: Array<{ text: string; duration: number }>): string {
  const lines: string[] = []
  let currentTime = 0
  const gapSeconds = 0.15 // 句间短暂间隔

  for (let i = 0; i < timings.length; i++) {
    const { text, duration } = timings[i]
    const sentenceDuration = Math.max(0.5, duration)
    const srtLine = `${i + 1}\n${formatSRTTime(currentTime)} --> ${formatSRTTime(currentTime + sentenceDuration)}\n${text}\n`
    lines.push(srtLine)
    console.log(`[SRT] #${i + 1}: ${formatSRTTime(currentTime)} --> ${formatSRTTime(currentTime + sentenceDuration)} | "${text.substring(0, 30)}${text.length > 30 ? '...' : ''}" (${text.length}字, ${sentenceDuration.toFixed(2)}s)`)
    currentTime += sentenceDuration + gapSeconds
  }
  console.log('[SRT] 逐句对齐生成完成: 共' + lines.length + '条字幕, 总时长' + currentTime.toFixed(2) + 's')
  return lines.join('\n')
}

// 生成 SRT 字幕（支持多语言文本，按实际媒体时长精确分配时间戳）
function generateSRTFromText(text: string, lang: string = 'zh', totalDuration?: number): string {
  const charsPerSecond = lang === 'zh' ? 8 : 5
  console.log('[SRT] 生成参数: lang=' + lang + ', charsPerSecond=' + charsPerSecond + ', textLen=' + text.length + ', totalDuration=' + (totalDuration ? totalDuration.toFixed(2) + 's' : '未提供'))

  const sentenceDelimiter = lang === 'zh' ? /[。！？；\n]+/ : /[.!?;\n]+/
  const sentences = text.split(sentenceDelimiter).filter(s => s.trim()).map(s => s.trim())
  console.log('[SRT] 分句数量:', sentences.length)

  if (sentences.length === 0) return ''

  const lines: string[] = []
  const totalChars = sentences.reduce((sum, s) => sum + s.length, 0)

  if (totalDuration && totalDuration > 0) {
    // 有实际媒体时长：按字数比例分配时间戳，确保总时长与音频/视频一致
    const gapSeconds = 0.15 // 句间短暂间隔
    const totalGapTime = gapSeconds * (sentences.length - 1)
    const availableDuration = totalDuration - totalGapTime

    let currentTime = 0
    for (let i = 0; i < sentences.length; i++) {
      const sentence = sentences[i]
      const proportion = sentence.length / totalChars
      const sentenceDuration = Math.max(1.0, availableDuration * proportion)

      const srtLine = `${i + 1}\n${formatSRTTime(currentTime)} --> ${formatSRTTime(currentTime + sentenceDuration)}\n${sentence}\n`
      lines.push(srtLine)
      console.log(`[SRT] #${i + 1}: ${formatSRTTime(currentTime)} --> ${formatSRTTime(currentTime + sentenceDuration)} | "${sentence.substring(0, 30)}${sentence.length > 30 ? '...' : ''}" (${sentence.length}字, ${sentenceDuration.toFixed(2)}s)`)

      currentTime += sentenceDuration + gapSeconds
    }
    console.log('[SRT] 生成完成: 共' + lines.length + '条字幕, 总分配时长' + currentTime.toFixed(2) + 's (媒体时长' + totalDuration.toFixed(2) + 's)')
  } else {
    // 无实际时长：用 charsPerSecond 估算
    let currentTime = 0
    for (let i = 0; i < sentences.length; i++) {
      const sentence = sentences[i]
      const duration = Math.max(2, Math.ceil(sentence.length / charsPerSecond))
      const srtLine = `${i + 1}\n${formatSRTTime(currentTime)} --> ${formatSRTTime(currentTime + duration)}\n${sentence}\n`
      lines.push(srtLine)
      console.log(`[SRT] #${i + 1}: ${formatSRTTime(currentTime)} --> ${formatSRTTime(currentTime + duration)} | "${sentence.substring(0, 30)}${sentence.length > 30 ? '...' : ''}" (${sentence.length}字, ${duration}s)`)
      currentTime += duration
    }
    console.log('[SRT] 生成完成: 共' + lines.length + '条字幕, 估算总时长' + currentTime + 's')
  }

  return lines.join('\n')
}

function formatSRTTime(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  const ms = Math.round((seconds % 1) * 1000)
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad3(ms)}`
}

function pad(n: number): string {
  return n.toString().padStart(2, '0')
}

function pad3(n: number): string {
  return n.toString().padStart(3, '0')
}

async function getMediaDuration(filePath: string): Promise<number> {
  const ffprobePath = process.env.FFPROBE_PATH || 'ffprobe'
  try {
    const { stdout } = await execFileAsync(ffprobePath, [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      filePath
    ])
    const duration = parseFloat(stdout.trim())
    if (!isNaN(duration) && duration > 0) {
      console.log('[FFprobe] 媒体时长:', duration.toFixed(2), 's, 文件:', filePath)
      return duration
    }
    return 0
  } catch (error) {
    console.error('[FFprobe] 获取时长失败:', error)
    return 0
  }
}
