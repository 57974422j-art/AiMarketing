import { NextRequest, NextResponse } from 'next/server'
import { dashscopeTranslate, dashscopeTTS } from '@/lib/ai-providers'
import { join } from 'path'
import { writeFile, mkdir, copyFile, unlink, readFile } from 'fs/promises'
import { existsSync } from 'fs'
import { execFile } from 'child_process'
import { promisify } from 'util'

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
  'zh': 'zh',
  'en': 'en-US',
  'ja': 'ja',
  'ko': 'ko',
  'fr': 'fr',
  'de': 'de',
  'es': 'es',
  'pt': 'pt',
  'ru': 'ru',
  'ar': 'ar'
}

export async function POST(request: NextRequest) {
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, message: '参数格式错误' }, { status: 400 });
  }
  
  const { 
    videoUrl, 
    options, 
    ttsScript, 
    ttsVoice, 
    subtitleLanguage 
  } = body as {
    videoUrl?: string;
    options: PostProcessingOptions;
    ttsScript?: string;
    ttsVoice?: string;
    subtitleLanguage?: string;
  }

  // 兜底逻辑：videoUrl -> ossUrl -> file_url
  const actualVideoUrl = videoUrl || body.ossUrl || body.file_url;

  if (!actualVideoUrl) {
    return NextResponse.json({ success: false, message: '缺少视频URL' }, { status: 400 });
  }

  try {
    // 确保输出目录存在
    const outputDir = join(process.cwd(), 'public', 'outputs')
    if (!existsSync(outputDir)) {
      await mkdir(outputDir, { recursive: true })
    }

    const tempDir = join(process.cwd(), 'temp')
    if (!existsSync(tempDir)) {
      await mkdir(tempDir, { recursive: true })
    }

    // 生成输出文件名
    const timestamp = Date.now()
    const inputFileName = actualVideoUrl.split('/').pop() || `input_${timestamp}.mp4`
    const inputPath = join(process.cwd(), 'public', actualVideoUrl.replace(/^\//, ''))
    let currentVideoPath = inputPath
    let finalVideoUrl = actualVideoUrl

    // 处理流程
    const processSteps: string[] = []

    // 1. 配音处理 (TTS)
    if (options.enableTTS && ttsScript) {
      processSteps.push('配音生成')
      try {
        // 获取配音语言
        const ttsLang = subtitleLanguage || 'zh'
        const voiceLangCode = langCodeMap[ttsLang] || 'zh-CN'
        
        // 调用 CosyVoice TTS API
        const ttsAudioBuffer = await dashscopeTTS(ttsScript, ttsVoice || 'aixia')
        
        // 静默降级：API 未配置或失败时跳过
        if (!ttsAudioBuffer) {
          console.log('TTS API 未配置，跳过配音处理')
        } else {
          // 保存配音文件
          const audioPath = join(tempDir, `tts_${timestamp}.wav`)
          await writeFile(audioPath, Buffer.from(ttsAudioBuffer))
          
          // 使用 FFmpeg 将配音替换视频音频
          const outputPath = join(outputDir, `output_tts_${timestamp}.mp4`)
          const ffmpegPath = process.env.FFMPEG_PATH || 'ffmpeg'
          
          await execFileAsync(ffmpegPath, [
            '-i', currentVideoPath,
            '-i', audioPath,
            '-c:v', 'copy',
            '-c:a', 'aac',
            '-map', '0:v:0',
            '-map', '1:a:0',
            '-shortest',
            outputPath
          ])
          
          // 清理临时音频文件
          await unlink(audioPath).catch(() => {})
          
          // 更新当前视频路径
          currentVideoPath = outputPath
          finalVideoUrl = `/outputs/output_tts_${timestamp}.mp4`
        }
      } catch (error) {
        console.error('TTS 处理失败:', error)
        // TTS 失败不影响整体流程，继续处理
      }
    }

    // 2. 字幕生成 (调用语音识别 API)
    if (options.enableSubtitle) {
      processSteps.push('字幕生成')
      try {
        const subtitleLang = subtitleLanguage || 'zh'
        
        // 调用 /api/video/transcribe 获取识别文本
        const videoFileName = `video_${timestamp}.mp4`
        const uploadsDir = join(process.cwd(), 'public', 'uploads', 'asr')
        if (!existsSync(uploadsDir)) {
          await mkdir(uploadsDir, { recursive: true })
        }
        const uploadVideoPath = join(uploadsDir, videoFileName)
        
        // 复制视频文件用于识别
        await copyFile(currentVideoPath, uploadVideoPath)
        
        // 调用转写 API
        const transcribeFormData = new FormData()
        transcribeFormData.append('video', new Blob([await readFile(uploadVideoPath)]), videoFileName)
        
        const transcribeRes = await fetch(new URL('/api/video/transcribe', request.url), {
          method: 'POST',
          body: transcribeFormData,
        })
        
        const transcribeData = await transcribeRes.json()
        
        if (!transcribeData.success || !transcribeData.text) {
          console.error('语音识别失败:', transcribeData.message)
        } else {
          console.log('[PostProcess] 识别文本:', transcribeData.text)
        }
        
        // 生成 SRT 字幕文件
        const srtPath = join(tempDir, `subtitle_${timestamp}.srt`)
        const recognizedText = transcribeData.text || ''
        const subtitleContent = generateSRTFromText(recognizedText)
        await writeFile(srtPath, subtitleContent)
        
        // 将字幕烧录到视频
        const outputPath = join(outputDir, `output_subtitle_${timestamp}.mp4`)
        const ffmpegPath = process.env.FFMPEG_PATH || 'ffmpeg'
        
        try {
          await execFileAsync(ffmpegPath, [
            '-i', currentVideoPath,
            '-vf', `subtitles=${srtPath.replace(/\\/g, '/')}`,
            '-c:a', 'copy',
            outputPath
          ])
          await unlink(srtPath).catch(() => {})
          await unlink(uploadVideoPath).catch(() => {})
          currentVideoPath = outputPath
          finalVideoUrl = `/outputs/output_subtitle_${timestamp}.mp4`
        } catch (subError) {
          console.error('字幕烧录失败，使用原视频:', subError)
        }
        
      } catch (error) {
        console.error('字幕生成失败:', error)
      }
    }

    // 3. 翻译字幕 (调用阿里云百炼 Qwen 翻译)
    if (options.enableTranslateSubtitle && subtitleLanguage) {
      processSteps.push('字幕翻译')
      try {
        const originalText = body.originalText || ttsScript || ''
        if (originalText) {
          const translatedText = await dashscopeTranslate(originalText, 'zh', subtitleLanguage)
          if (translatedText) {
            console.log('[PostProcess] 翻译结果:', translatedText)
            // 生成翻译后的 SRT 并烧录
            const srtPath = join(tempDir, `subtitle_translated_${timestamp}.srt`)
            const subtitleContent = generateSRTFromText(translatedText)
            await writeFile(srtPath, subtitleContent)
            
            const outputPath = join(outputDir, `output_translated_${timestamp}.mp4`)
            const ffmpegPath = process.env.FFMPEG_PATH || 'ffmpeg'
            
            try {
              await execFileAsync(ffmpegPath, [
                '-i', currentVideoPath,
                '-vf', `subtitles=${srtPath.replace(/\\/g, '/')}`,
                '-c:a', 'copy',
                outputPath
              ])
              await unlink(srtPath).catch(() => {})
              currentVideoPath = outputPath
              finalVideoUrl = `/outputs/output_translated_${timestamp}.mp4`
            } catch (subError) {
              console.error('翻译字幕烧录失败:', subError)
            }
          } else {
            console.log('翻译 API 未配置，跳过翻译')
          }
        }
      } catch (error) {
        console.error('翻译字幕失败:', error)
      }
    }

    // 4. 换脸处理 (人脸融合)
    if (options.enableFaceSwap) {
      processSteps.push('人脸融合')
      // 注意：换脸需要调用阿里云人脸融合 API
      // 这是一个复杂的图像处理任务，需要：
      // 1. 检测视频中的人脸
      // 2. 上传目标人脸模板
      // 3. 调用人脸融合 API
      // 4. 将融合后的帧替换回视频
      
      // 模拟处理
      console.log('换脸功能需要调用阿里云人脸融合 API')
      
      return NextResponse.json({ 
        success: true, 
        videoUrl: finalVideoUrl,
        message: '换脸功能暂未完全实现，当前返回原视频'
      })
    }

    // 5. 对口型处理
    if (options.enableLipSync) {
      processSteps.push('对口型调整')
      // 注意：对口型需要：
      // 1. 音频分析（提取音素/唇形信息）
      // 2. 视频中口型检测
      // 3. 3D 人脸重建
      // 4. 口型驱动生成
      
      // 模拟处理
      console.log('对口型功能暂未实现，返回模拟结果')
      
      return NextResponse.json({ 
        success: true, 
        videoUrl: finalVideoUrl,
        message: '对口型功能暂未完全实现，当前返回原视频'
      })
    }

    return NextResponse.json({ 
      success: true, 
      videoUrl: finalVideoUrl,
      processSteps
    })

  } catch (error) {
    console.error('后期处理错误:', error)
    return NextResponse.json({ 
      success: false, 
      message: error instanceof Error ? error.message : '后期处理失败' 
    }, { status: 500 })
  }
}

// 将文本转换为 SRT 字幕格式（每段 5 秒）
function generateSRTFromText(text: string): string {
  const maxCharsPerLine = 20
  const charsPerSecond = 10
  const lines: string[] = []
  
  // 简单分句
  const sentences = text.split(/[。！？；\n]+/).filter(s => s.trim())
  let currentTime = 0
  let index = 1
  
  for (const sentence of sentences) {
    const trimmed = sentence.trim()
    if (!trimmed) continue
    
    const duration = Math.max(2, Math.ceil(trimmed.length / charsPerSecond))
    const startTime = formatSRTTime(currentTime)
    const endTime = formatSRTTime(currentTime + duration)
    
    lines.push(`${index}\n${startTime} --> ${endTime}\n${trimmed}\n`)
    currentTime += duration
    index++
  }
  
  return lines.join('\n')
}

function formatSRTTime(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  const ms = 0
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')},${ms.toString().padStart(3, '0')}`
}
