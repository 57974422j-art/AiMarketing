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

    // ========== 2. TTS 配音（使用翻译后的文案） ==========
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

        const ttsAudioBuffer = await textToSpeech(finalText, selectedVoice)
        if (!ttsAudioBuffer) {
          console.log('[PostProcess] TTS 返回空 (火山+硅基均失败), 跳过配音')
        } else {
          const audioPath = join(tempDir, `tts_${timestamp}.mp3`)
          await writeFile(audioPath, Buffer.from(ttsAudioBuffer))
          const audioStats = await import('fs').then(fs => fs.promises.stat(audioPath).catch(() => ({ size: 0 })))
          console.log('[PostProcess] TTS 音频文件大小:', audioStats.size, 'bytes')

          if (audioStats.size > 100) {
            const ffmpegPath = process.env.FFMPEG_PATH || 'ffmpeg'

            // 步骤 2a: 消掉视频原声，只保留画面
            const mutedPath = join(tempDir, `muted_${timestamp}.mp4`)
            console.log('[PostProcess] FFmpeg 消除原声中...')
            await execFileAsync(ffmpegPath, [
              '-i', currentVideoPath,
              '-c:v', 'copy', '-an',
              mutedPath
            ])

            // 步骤 2b: 将 TTS 音频合并到无声视频上
            const outputPath = join(outputDir, `output_tts_${timestamp}.mp4`)
            console.log('[PostProcess] FFmpeg 合并 TTS 音频中...')
            await execFileAsync(ffmpegPath, [
              '-i', mutedPath, '-i', audioPath,
              '-c:v', 'copy', '-c:a', 'aac',
              '-map', '0:v:0', '-map', '1:a:0', '-shortest',
              outputPath
            ])

            // 清理临时文件
            await unlink(audioPath).catch(() => {})
            await unlink(mutedPath).catch(() => {})
            currentVideoPath = outputPath
            finalVideoUrl = `/outputs/output_tts_${timestamp}.mp4`
            processSteps.push('配音')
            console.log('[PostProcess] 配音完成:', outputPath)
          } else {
            console.log('[PostProcess] TTS 音频太小(' + audioStats.size + '字节), 跳过')
            await unlink(audioPath).catch(() => {})
          }
        }
      } catch (error) {
        console.error('[PostProcess] TTS/FFmpeg 失败:', error)
      }
    } else if (options.enableTTS && !finalText) {
      console.log('[PostProcess] 跳过TTS: 无文案')
    }

    // ========== 3. 字幕生成（使用翻译后的文案） ==========
    const needsSubtitle = options.enableSubtitle || options.enableTranslateSubtitle
    if (needsSubtitle && finalText) {
      try {
        console.log('[PostProcess] 步骤3: 生成字幕, 文本长度:', finalText.length)
        const srtPath = join(tempDir, `subtitle_${timestamp}.srt`)
        const subtitleContent = generateSRTFromText(finalText, subtitleLanguage || 'zh')
        await writeFile(srtPath, subtitleContent)
        console.log('[PostProcess] SRT 文件已生成:', srtPath)

        const outputPath = join(outputDir, `output_subtitle_${timestamp}.mp4`)
        const ffmpegPath = process.env.FFMPEG_PATH || 'ffmpeg'
        console.log('[PostProcess] FFmpeg 烧录字幕中...')
        
        await execFileAsync(ffmpegPath, [
          '-i', currentVideoPath,
          '-vf', `subtitles=${srtPath.replace(/\\/g, '/').replace(/(:)/g, '\\$1')}`,
          '-c:a', 'copy',
          outputPath
        ])
        
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

// 生成 SRT 字幕（支持多语言文本）
function generateSRTFromText(text: string, lang: string = 'zh'): string {
  const charsPerSecond = lang === 'zh' ? 8 : 5
  const lines: string[] = []
  // 根据语言使用不同的分句符
  const sentenceDelimiter = lang === 'zh' ? /[。！？；\n]+/ : /[.!?;\n]+/
  const sentences = text.split(sentenceDelimiter).filter(s => s.trim())
  let currentTime = 0
  let index = 1

  for (const sentence of sentences) {
    const trimmed = sentence.trim()
    if (!trimmed) continue
    const duration = Math.max(2, Math.ceil(trimmed.length / charsPerSecond))
    lines.push(`${index}\n${formatSRTTime(currentTime)} --> ${formatSRTTime(currentTime + duration)}\n${trimmed}\n`)
    currentTime += duration
    index++
  }
  return lines.join('\n')
}

function formatSRTTime(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  return `${pad(h)}:${pad(m)}:${pad(s)},000`
}

function pad(n: number): string {
  return n.toString().padStart(2, '0')
}
