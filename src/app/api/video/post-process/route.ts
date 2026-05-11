import { NextRequest, NextResponse } from 'next/server'
import { translate, textToSpeech, cleanText } from '@/lib/ai-providers'
import { recognizeWithFunasr } from '@/lib/funasr-service'
import { join } from 'path'
import { writeFile, mkdir, unlink } from 'fs/promises'
import { existsSync } from 'fs'
import { execFile } from 'child_process'
import { promisify } from 'util'
import OSS from 'ali-oss'
import type { FunasrResult } from '@/lib/funasr-service'
import { getAuthFromHeaders } from '@/lib/api-auth'

export const runtime = 'nodejs'

const execFileAsync = promisify(execFile)

const DEBUG = true
function debug(...args: unknown[]) {
  if (DEBUG) console.log('[PostProcess:DEBUG]', ...args)
}

const TEMP_FILE_RETENTION = 60 * 60 * 1000 // 临时文件保留 1 小时

// FunASR 结果缓存（配音步骤产生，字幕步骤复用）
interface FunasrCache {
  audio: string
  result: FunasrResult
}
let funasrCache: FunasrCache | undefined

interface PostProcessingOptions {
  enableTTS: boolean
  enableSubtitle: boolean
  enableTranslateSubtitle: boolean
  enableFaceSwap: boolean
  enableLipSync: boolean
  enableBackgroundAudio?: boolean   // 保留背景音
  enableOriginalSubtitle?: boolean   // 删除原字幕（占位）
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
  const auth = getAuthFromHeaders(request)
  if (!auth) return NextResponse.json({ success: false, message: '请先登录' }, { status: 401 })

  let body: any
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ success: false, message: '参数格式错误' }, { status: 400 })
  }

  const { videoUrl, options, ttsScript, ttsVoice, subtitleLanguage, voiceAssignments, segments, useCloud } = body as {
    videoUrl?: string
    options: PostProcessingOptions
    ttsScript?: string
    ttsVoice?: string
    subtitleLanguage?: string
    voiceAssignments?: Array<{ speakerId: string; voice: string; label: string }>
    segments?: Array<{ text: string; start: number; end: number; speaker: string }>
    useCloud?: boolean
  }
  console.log('[PostProcess] 处理引擎:', useCloud ? '阿里云' : '本地')

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
    const processSteps: string[] = []
    const ffmpegPath = process.env.FFMPEG_PATH || 'ffmpeg'

    debug('输出目录:', outputDir)
    debug('临时目录:', tempDir)
    debug('输入路径:', inputPath)
    debug('FFmpeg 路径:', ffmpegPath)

    if (!existsSync(inputPath)) {
      console.error('[PostProcess] 输入文件不存在:', inputPath)
      return NextResponse.json({ success: false, message: '输入视频文件不存在', debug: { step: 'input_check', detail: `路径不存在: ${inputPath}` } }, { status: 400 })
    }
    const inputFileSize = (await import('fs')).statSync(inputPath).size
    console.log('[PostProcess] 输入文件存在, 大小:', inputFileSize, 'bytes:', inputPath)

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

    // 语言 → 默认音色映射（多语言配音支持）
    const langToVoice: Record<string, string> = {
      'zh': 'zh_female_vv_uranus_bigtts',
      'en': 'en_male_tim_uranus_bigtts',
      'ja': 'zh_female_vv_uranus_bigtts',
      'ko': 'zh_female_vv_uranus_bigtts',
      'fr': 'zh_female_vv_uranus_bigtts',
      'de': 'zh_female_vv_uranus_bigtts',
      'es': 'zh_female_vv_uranus_bigtts',
      'pt': 'zh_female_vv_uranus_bigtts',
      'ru': 'zh_female_vv_uranus_bigtts',
      'ar': 'zh_female_vv_uranus_bigtts',
    }

    // ========== 2. TTS 配音 ==========
    if (options.enableTTS && finalText) {
      try {
        const ttsLang = subtitleLanguage || 'zh'
        const voiceLangCode = langCodeMap[ttsLang] || 'zh-CN'
        console.log('[PostProcess] 步骤2: TTS配音, 语言:', voiceLangCode)
        console.log('[PostProcess] 背景音保留:', !!options.enableBackgroundAudio)
        console.log('[PostProcess] TTS 环境变量检查:',
          'VOLCANO_TTS_APP_ID=', !!process.env.VOLCANO_TTS_APP_ID,
          'VOLCANO_TTS_ACCESS_KEY=', !!process.env.VOLCANO_TTS_ACCESS_KEY,
          'VOLCANO_TTS_RESOURCE_ID=', !!process.env.VOLCANO_TTS_RESOURCE_ID,
          'SILICONFLOW_API_KEY=', !!process.env.SILICONFLOW_API_KEY)

        // 确定默认音色（根据语言自动匹配）
        const langDefaultVoice = langToVoice[ttsLang] || 'zh_female_vv_uranus_bigtts'
        const selectedVoice = ttsVoice || langDefaultVoice
        console.log('[PostProcess] TTS 音色:', selectedVoice, '(语言映射:', ttsLang, '→', langDefaultVoice, ')')
        if (voiceAssignments && voiceAssignments.length > 0) {
          console.log('[PostProcess] 多人配音分配:', voiceAssignments.map(v => `${v.speakerId}->${v.voice})`).join(', '))
        }



        // 步骤 2a: AI 人声分离提取背景音（Demucs → FFmpeg 降级）
        let bgAudioPath = ''
        if (options.enableBackgroundAudio) {
          const vocalScript = join(process.cwd(), 'scripts', 'vocal_separate.py')
          if (existsSync(vocalScript)) {
            const bgOut = join(tempDir, `bg_${timestamp}.aac`)
            try {
              const { stdout } = await execFileAsync('python', [vocalScript, currentVideoPath, bgOut], { timeout: 300000 })
              const result = JSON.parse(stdout.trim())
              if (result.success && existsSync(bgOut) && (await import('fs')).statSync(bgOut).size > 1000) {
                bgAudioPath = bgOut
                console.log('[PostProcess] AI 人声分离提取背景音成功')
              }
            } catch (e: any) {
              console.error('[PostProcess] AI 人声分离失败:', e.message)
              if (e.stderr) console.error('[PostProcess] Demucs stderr:', e.stderr.substring(0, 1000))
            }
          }
          if (!bgAudioPath) {
            console.log('[PostProcess] 背景音不可用（需先 pip install demucs）')
          }
        }

        // 检测原视频中第一句人声开始时间（使用 FunASR 时间戳优先，降级 silencedetect）
        let speechStartTime = 0
        try {
          // 先尝试 FunASR 获取精确首句时间戳
          const asrDetectAudio = join(tempDir, `asr_detect_${timestamp}.wav`)
          await execFileAsync(ffmpegPath, ['-i', currentVideoPath, '-vn', '-acodec', 'pcm_s16le', '-ar', '16000', '-ac', '1', '-y', asrDetectAudio], { timeout: 60000 }).catch(() => {})
          if (existsSync(asrDetectAudio) && (await import('fs')).statSync(asrDetectAudio).size > 100) {
            const asrDetectResult = await recognizeWithFunasr(asrDetectAudio)
            if (asrDetectResult.success && asrDetectResult.sentences && asrDetectResult.sentences.length > 0) {
              speechStartTime = asrDetectResult.sentences[0].start
              console.log(`[PostProcess] FunASR 首句时间戳: ${speechStartTime.toFixed(2)}s ("${asrDetectResult.sentences[0].text.substring(0, 30)}")`)
              // 保存 FunASR 结果供字幕步骤使用
              funasrCache = { audio: asrDetectAudio, result: asrDetectResult }
            }
            await unlink(asrDetectAudio).catch(() => {})
          }
        } catch (detectErr: any) {
          console.warn('[PostProcess] FunASR 时间戳检测失败:', detectErr.message)
        }

        // FunASR 未成功时降级 silencedetect
        if (speechStartTime <= 0) {
          try {
            const detectArgs = ['-i', currentVideoPath, '-af', 'silencedetect=noise=-40dB:d=0.3', '-f', 'null', '-']
            const detectResult = await execFileAsync(ffmpegPath, detectArgs)
            const stderr = detectResult.stderr || ''
            const endMatch = stderr.match(/silence_end:\s*([\d.]+)/)
            if (endMatch && endMatch[1]) {
              speechStartTime = parseFloat(endMatch[1])
              console.log('[PostProcess] silencedetect 语音开始:', speechStartTime.toFixed(2), 's')
            }
          } catch (e: any) {
            console.warn('[PostProcess] silencedetect 失败:', e.message)
          }
        }
        console.log('[PostProcess] 最终语音开始时间:', speechStartTime.toFixed(2), 's')

        // 步骤 2b: 无需单独消除原声 — 后面 merge 时直接用 -map 0:v:0 只取视频流

        // 步骤 2c: 逐句 TTS 生成配音（支持多人音色分配）
        const sentenceDelimiter = ttsLang === 'zh' ? /[。！？；\n]+/ : /[.!?;\n]+/
        const sentences = finalText.split(sentenceDelimiter).filter(s => s.trim()).map(s => s.trim())
        console.log('[PostProcess] 分句数量:', sentences.length)

        const segmentFiles: string[] = []
        for (let i = 0; i < sentences.length; i++) {
          const sentence = sentences[i]
          // 多人配音：按 voiceAssignments 循环分配不同音色
          let sentenceVoice = selectedVoice
          if (voiceAssignments && voiceAssignments.length > 0) {
            const assignment = voiceAssignments[i % voiceAssignments.length]
            sentenceVoice = assignment.voice || selectedVoice
            console.log(`[PostProcess] 第 ${i + 1} 句 使用音色: ${assignment.label || sentenceVoice}`)
          }
          console.log(`[PostProcess] TTS 第 ${i + 1}/${sentences.length} 句 voice=${sentenceVoice}`)
          try {
            const segBuffer = await textToSpeech(sentence, sentenceVoice, ttsLang)
            if (segBuffer && segBuffer.byteLength > 100) {
              const segPath = join(tempDir, `tts_seg_${timestamp}_${i}.mp3`)
              await writeFile(segPath, new Uint8Array(segBuffer))
              segmentFiles.push(segPath)
              console.log(`[PostProcess] 第 ${i + 1} 句 TTS 完成: ${segBuffer.byteLength} bytes`)
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
          // 步骤 2d: 拼接所有 TTS 片段
          const concatListPath = join(tempDir, `concat_${timestamp}.txt`)
          const concatContent = segmentFiles.map(f => `file '${f.replace(/\\/g, '/')}'`).join('\n')
          await writeFile(concatListPath, concatContent)

          // 步骤 2e: FFmpeg 转码修复火山流式 MP3 元数据错误 → 标准 AAC
          const fixedAudioPath = join(tempDir, `tts_fixed_${timestamp}.mp4`)
          const fixArgs = ['-f', 'concat', '-safe', '0', '-i', concatListPath, '-c:a', 'aac', '-b:a', '128k', '-ar', '44100', '-ac', '2', '-y', fixedAudioPath]
          console.log('[PostProcess] FFmpeg 转码修复 TTS, 命令:', ffmpegPath, fixArgs.join(' '))
          try {
            await execFileAsync(ffmpegPath, fixArgs)
            console.log('[PostProcess] FFmpeg 转码完成')
          } catch (fixError: any) {
            console.error('[PostProcess] 转码 TTS 失败:', fixError.stderr || fixError.message)
          }
          await unlink(concatListPath).catch(() => {})

          const ttsDur = await getMediaDuration(fixedAudioPath)
          console.log('[PostProcess] TTS 转码音频时长:', ttsDur, 's')

          // 步骤 2f: 合并视频 + TTS 配音 [+ 背景音]（合并到一次 FFmpeg 调用，消除中间文件）
          // 用 adelay 在 filter_complex 中直接对齐，避免单独写对齐文件
          const outputPath = join(outputDir, `output_tts_${timestamp}.mp4`)
          const delayMs = Math.round(Math.max(0, speechStartTime) * 1000)
          let mergeArgs: string[]
          if (bgAudioPath) {
            mergeArgs = [
              '-i', currentVideoPath, '-i', fixedAudioPath, '-i', bgAudioPath,
              '-c:v', 'copy',
              '-filter_complex',
                delayMs > 100
                  ? `[1:a]adelay=${delayMs}|${delayMs},volume=3.0[tts_vol];[tts_vol][2:a]amix=inputs=2:duration=longest:dropout_transition=2[aout]`
                  : `[1:a]volume=3.0[tts_vol];[tts_vol][2:a]amix=inputs=2:duration=longest:dropout_transition=2[aout]`,
              '-map', '0:v:0', '-map', '[aout]', '-y', outputPath
            ]
          } else {
            mergeArgs = [
              '-i', currentVideoPath, '-i', fixedAudioPath,
              '-c:v', 'copy',
              '-filter_complex',
                delayMs > 100
                  ? `[1:a]adelay=${delayMs}|${delayMs},volume=3.0[aout]`
                  : `[1:a]volume=3.0[aout]`,
              '-map', '0:v:0', '-map', '[aout]', '-y', outputPath
            ]
          }
          console.log('[PostProcess] FFmpeg 合并音频:', ffmpegPath, mergeArgs.join(' '))
          try {
            const mergeResult = await execFileAsync(ffmpegPath, mergeArgs)
            debug('合并 stdout:', mergeResult.stdout?.substring(0, 200))
            debug('合并 stderr:', mergeResult.stderr?.substring(0, 500))
          } catch (mergeError: any) {
            console.error('[PostProcess] 合并音频失败, stderr:', mergeError.stderr?.substring(0, 500) || mergeError.message)
            debug('合并完整 stderr:', mergeError.stderr || '无')
          }

          const outputExists = existsSync(outputPath)
          const outputSize = outputExists ? (await import('fs')).statSync(outputPath).size : 0
          console.log('[PostProcess] 合并输出文件:', outputPath, '存在:', outputExists, '大小:', outputSize, 'bytes')

          if (outputExists && outputSize > 0) {
            currentVideoPath = outputPath
            finalVideoUrl = `/outputs/output_tts_${timestamp}.mp4`
            processSteps.push('配音')
            debug('配音成功, 路径:', outputPath)
          } else {
            console.error('[PostProcess] 合并输出无效(0KB), 使用原视频:', currentVideoPath)
            if (outputExists) await unlink(outputPath).catch(() => {})
          }

          // 清理（mutedPath/alignedAudioPath 已消除，无需清理）
          for (const segPath of segmentFiles) await unlink(segPath).catch(() => {})
          await unlink(fixedAudioPath).catch(() => {})
          if (bgAudioPath) await unlink(bgAudioPath).catch(() => {})
        }
      } catch (error) {
        console.error('[PostProcess] TTS/FFmpeg 环节失败:', error)
        debug('TTS/FFmpeg 异常详情:', error instanceof Error ? error.stack?.substring(0, 500) : String(error))
      }
    } else if (options.enableTTS && !finalText) {
      console.log('[PostProcess] 跳过TTS: 无文案')
    }

    // ========== 3. 原字幕处理 ==========
    // 嵌入视频帧的字幕属于像素数据，无法被清除，故此步骤已跳过
    if (options.enableOriginalSubtitle) {
      console.log('[PostProcess] 步骤3a: 跳过原字幕删除（已嵌入帧中，无法清除）')
    }

    // ========== 4. 字幕生成（优先使用 FunASR 时间戳，与配音完全解耦） ==========
    const needsSubtitle = options.enableSubtitle || options.enableTranslateSubtitle
    if (needsSubtitle) {
      try {
        console.log('[PostProcess] 步骤4: 字幕生成')

        const srtPath = join(tempDir, `subtitle_${timestamp}.srt`)
        let subtitleContent = ''
        let funasrUsed = false

        // 优先使用前端 ASR segments（精确时间戳）+ 翻译文本（如果有）
        if (segments && segments.length > 0) {
          if (finalText && finalText !== ttsScript && finalText.length > 0) {
            // 按句子分割翻译文本（用 . ! ? 标点）
            const enSentences = finalText.split(/(?<=[.!?])\s*/).filter(s => s.trim())
            const translatedSegments = segments.map((s: any) => ({ ...s, text: '' }))
            // 将英文句子按比例分配到 ASR 时间段
            const totalSegments = translatedSegments.length
            const totalSentences = enSentences.length
            let sentIdx = 0
            for (let i = 0; i < totalSegments && sentIdx < totalSentences; i++) {
              // 计算此段应该分配多少句
              const baseCount = Math.floor(totalSentences / totalSegments)
              const extra = i < totalSentences % totalSegments ? 1 : 0
              const countForThisSeg = baseCount + extra
              const segText = enSentences.slice(sentIdx, sentIdx + countForThisSeg).join(' ').trim()
              translatedSegments[i].text = segText
              sentIdx += countForThisSeg
            }
            // 若还有剩余句子，追加到最后一段
            if (sentIdx < enSentences.length && translatedSegments.length > 0) {
              translatedSegments[translatedSegments.length - 1].text += ' ' + enSentences.slice(sentIdx).join(' ')
            }
            subtitleContent = generateSRTFromFunasr(translatedSegments)
            console.log(`[PostProcess] 翻译字幕: ${translatedSegments.length} 段, ${enSentences.length} 句`)
          } else {
            subtitleContent = generateSRTFromFunasr(segments)
          }
          funasrUsed = true
          console.log(`[PostProcess] 使用前端 ASR 时间戳: ${segments.length} 句`)
        }

        // 其次使用 TTS 步骤缓存的 FunASR 结果
        if (!funasrUsed) {
          const asrResult = funasrCache?.result
          if (asrResult && asrResult.success && asrResult.sentences && asrResult.sentences.length > 0) {
            subtitleContent = generateSRTFromFunasr(asrResult.sentences)
            funasrUsed = true
            console.log(`[PostProcess] FunASR 缓存字幕: ${asrResult.sentences.length} 句`)
          }
        }

        // 最后尝试独立运行 FunASR
        if (!funasrUsed) {
          const audioForAsr = join(tempDir, `asr_sub_${timestamp}.wav`)
          try {
            await execFileAsync(ffmpegPath, ['-i', currentVideoPath, '-vn', '-acodec', 'pcm_s16le', '-ar', '16000', '-ac', '1', '-y', audioForAsr], { timeout: 60000 })
            if (existsSync(audioForAsr) && (await import('fs')).statSync(audioForAsr).size > 100) {
              const asrResult = await recognizeWithFunasr(audioForAsr)
              if (asrResult && asrResult.success && asrResult.sentences && asrResult.sentences.length > 0) {
                subtitleContent = generateSRTFromFunasr(asrResult.sentences)
                funasrUsed = true
                console.log(`[PostProcess] FunASR 独立字幕: ${asrResult.sentences.length} 句`)
              }
            }
          } catch (e: any) {
            console.warn('[PostProcess] 字幕 ASR 音频提取失败:', e.message)
          }
          await unlink(audioForAsr).catch(() => {})
        }

        // 降级：FunASR 未成功且有文案时按语速估算
        if (!funasrUsed) {
          if (!finalText) {
            console.log('[PostProcess] FunASR 失败且无文案, 跳过字幕')
            throw new Error('无可用文案')
          }
          const videoDurationForSub = await getMediaDuration(currentVideoPath)
          console.log('[PostProcess] 降级: 按语速估算, 视频时长:', videoDurationForSub, 's')
          subtitleContent = generateSRTFromText(
            finalText,
            subtitleLanguage || 'zh',
            videoDurationForSub > 0 ? videoDurationForSub : undefined
          )
        }

        console.log('[PostProcess] SRT 预览:\n', subtitleContent.substring(0, 500))

        // 单次写入 SRT，Linux 服务器直接用绝对路径
        await writeFile(srtPath, subtitleContent)
        const subtitleFilter = `subtitles=${srtPath.replace(/\\/g, '/').replace(':', '\\:')}`
        const outputPath = join(outputDir, `output_subtitle_${timestamp}.mp4`)
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

    // 清理 FunASR 缓存
    funasrCache = undefined

    return NextResponse.json({
      success: true,
      videoUrl: ossFinalUrl || finalVideoUrl,
      processSteps,
      debug: { elapsed_ms: elapsed, steps: processSteps }
    })

  } catch (error) {
    // 清理 FunASR 缓存
    funasrCache = undefined

    console.error('[PostProcess] 未捕获错误:', error)
    const errMsg = error instanceof Error ? error.message : '后期处理失败'
    const errStack = error instanceof Error ? error.stack?.substring(0, 500) : String(error).substring(0, 500)
    return NextResponse.json({
      success: false,
      message: errMsg,
      debug: { step: 'uncaught', detail: errMsg, stack: errStack }
    }, { status: 500 })
  }
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

// 从 FunASR 句子级结果生成 SRT（精确时间戳对齐）
function generateSRTFromFunasr(sentences: Array<{ text: string; start: number; end: number; speaker?: string }>): string {
  const lines: string[] = []
  console.log(`[FunASR->SRT] 开始生成, ${sentences.length} 句`)

  for (let i = 0; i < sentences.length; i++) {
    const { text, start, end, speaker } = sentences[i]
    if (!text || !text.trim()) continue

    const startTime = Math.max(0, start)
    const endTime = end > startTime ? end : startTime + 0.5

    const prefix = speaker ? `[${speaker}] ` : ''
    const displayText = prefix + text.trim()

    const srtLine = `${i + 1}\n${formatSRTTime(startTime)} --> ${formatSRTTime(endTime)}\n${displayText}\n`
    lines.push(srtLine)
    console.log(`[FunASR->SRT] #${i + 1}: ${formatSRTTime(startTime)} --> ${formatSRTTime(endTime)} | ${speaker ? speaker + ' ' : ''}"${text.substring(0, 30)}"`)
  }

  console.log(`[FunASR->SRT] 完成: ${lines.length} 条字幕`)
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
