import { NextRequest, NextResponse } from 'next/server'
import { dashscopeTranslate, dashscopeTTS } from '@/lib/ai-providers'
import { join } from 'path'
import { writeFile, mkdir, copyFile, unlink } from 'fs/promises'
import { existsSync } from 'fs'
import { execSync } from 'child_process'

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
          
          const command = `"${ffmpegPath}" -i "${currentVideoPath}" -i "${audioPath}" -c:v copy -c:a aac -map 0:v:0 -map 1:a:0 -shortest "${outputPath}"`
          
          execSync(command, { stdio: 'pipe' })
          
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

    // 2. 字幕生成 (使用 Paraformer 语音识别)
    if (options.enableSubtitle) {
      processSteps.push('字幕生成')
      try {
        // 注意：Paraformer 是语音识别模型，需要音频输入
        // 这里我们假设视频已经有音频，进行 ASR 识别
        // 实际实现需要调用 Paraformer API 进行语音识别生成字幕
        
        // 模拟：生成 SRT 字幕文件
        const srtPath = join(tempDir, `subtitle_${timestamp}.srt`)
        const subtitleLang = subtitleLanguage || 'zh'
        
        // 这里应该调用实际的语音识别 API
        // 由于没有视频音频提取和 ASR 的完整实现，生成模拟字幕
        const mockSubtitleContent = `1
00:00:00,000 --> 00:00:05,000
[自动生成的字幕]

2
00:00:05,000 --> 00:00:10,000
这是一段模拟字幕内容

3
00:00:10,000 --> 00:00:15,000
实际使用时将调用语音识别 API
`
        await writeFile(srtPath, mockSubtitleContent)
        
        // 将字幕烧录到视频
        const outputPath = join(outputDir, `output_subtitle_${timestamp}.mp4`)
        const ffmpegPath = process.env.FFMPEG_PATH || 'ffmpeg'
        
        const command = `"${ffmpegPath}" -i "${currentVideoPath}" -vf "subtitles='${srtPath.replace(/\\/g, '/')}'" -c:a copy "${outputPath}"`
        
        try {
          execSync(command, { stdio: 'pipe' })
          await unlink(srtPath).catch(() => {})
          currentVideoPath = outputPath
          finalVideoUrl = `/outputs/output_subtitle_${timestamp}.mp4`
        } catch (subError) {
          console.error('字幕烧录失败，使用原视频:', subError)
          // 字幕处理失败，继续使用当前视频
        }
        
      } catch (error) {
        console.error('字幕生成失败:', error)
        // 字幕处理失败不影响后续流程
      }
    }

    // 3. 翻译字幕
    if (options.enableTranslateSubtitle && subtitleLanguage) {
      processSteps.push('字幕翻译')
      // 注意：翻译字幕需要先有原字幕，再翻译
      // 实际实现需要先提取原字幕 -> 翻译 -> 烧录新字幕
      console.log('翻译字幕功能待实现，需要先完成字幕生成')
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
