import { NextRequest, NextResponse } from 'next/server'
import { writeFileSync, unlinkSync, existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import { trimVideo, concatVideos, addTextOverlay, resizeVideo, checkFFmpeg } from '@/lib/ffmpeg'

// 确保上传和输出目录存在
function ensureDirectories() {
  const uploadDir = join(process.cwd(), 'public', 'uploads')
  const outputDir = join(process.cwd(), 'public', 'outputs')
  
  if (!existsSync(uploadDir)) {
    mkdirSync(uploadDir, { recursive: true })
  }
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true })
  }
  
  return { uploadDir, outputDir }
}

export async function POST(request: NextRequest) {
  try {
    // 检查 FFmpeg 是否安装
    if (!checkFFmpeg()) {
      return NextResponse.json(
        {
          success: false,
          message: 'FFmpeg 未安装，请先安装 FFmpeg。安装命令：\nWindows: winget install Gyan.FFmpeg\nmacOS: brew install ffmpeg\nLinux: apt install ffmpeg'
        },
        { status: 400 }
      )
    }
    
    // 解析表单数据
    const formData = await request.formData()
    const videos = formData.getAll('videos') as File[]
    const template = formData.get('template') as string
    const duration = parseInt(formData.get('duration') as string) || 30
    const style = formData.get('style') as string
    
    if (videos.length === 0) {
      return NextResponse.json(
        { success: false, message: '请上传至少一个视频文件' },
        { status: 400 }
      )
    }
    
    const { uploadDir, outputDir } = ensureDirectories()
    const taskId = Math.floor(Math.random() * 10000)
    const timestamp = Date.now()
    
    // 保存上传的视频文件
    const inputPaths: string[] = []
    for (let i = 0; i < videos.length; i++) {
      const video = videos[i]
      const fileName = `input_${taskId}_${i}_${timestamp}.mp4`
      const filePath = join(uploadDir, fileName)
      const buffer = Buffer.from(await video.arrayBuffer())
      writeFileSync(filePath, buffer)
      inputPaths.push(filePath)
    }
    
    // 生成输出文件路径
    const outputFileName = `output_${taskId}_${timestamp}.mp4`
    const outputPath = join(outputDir, outputFileName)
    const outputUrl = `/outputs/${outputFileName}`
    
    // 根据模板处理视频
    switch (template) {
      case 'mix':
        // 混剪：拼接所有视频并裁剪到指定时长
        if (inputPaths.length > 1) {
          const tempOutput = join(outputDir, `temp_${taskId}_${timestamp}.mp4`)
          concatVideos(inputPaths, tempOutput)
          trimVideo(tempOutput, 0, duration, outputPath)
          // 清理临时文件
          if (existsSync(tempOutput)) {
            unlinkSync(tempOutput)
          }
        } else {
          trimVideo(inputPaths[0], 0, duration, outputPath)
        }
        break
      case 'quick':
        // 快剪：快速裁剪并添加文字水印
        trimVideo(inputPaths[0], 0, duration, outputPath)
        addTextOverlay(outputPath, 'AiMarketing', 'bottom-right', outputPath)
        break
      case 'story':
        // 故事板：调整分辨率并添加标题
        resizeVideo(inputPaths[0], 1080, 1920, outputPath)
        addTextOverlay(outputPath, '故事板视频', 'top-center', outputPath)
        break
      case 'loop':
        // 循环：重复视频内容
        trimVideo(inputPaths[0], 0, duration, outputPath)
        break
      default:
        // 默认处理
        trimVideo(inputPaths[0], 0, duration, outputPath)
    }
    
    // 清理上传的输入文件
    for (const inputPath of inputPaths) {
      if (existsSync(inputPath)) {
        unlinkSync(inputPath)
      }
    }
    
    return NextResponse.json({
      success: true,
      message: '视频剪辑任务已完成',
      taskId,
      outputUrl
    })
  } catch (error) {
    console.error('视频剪辑错误:', error)
    return NextResponse.json(
      {
        success: false,
        message: error instanceof Error ? error.message : '视频剪辑时发生错误'
      },
      { status: 500 }
    )
  }
}

export async function GET(request: NextRequest) {
  // 模拟获取视频任务列表
  const tasks = [
    { id: 1, status: 'completed', progress: 100, template: '混剪', duration: 30 },
    { id: 2, status: 'processing', progress: 50, template: '快剪', duration: 15 },
    { id: 3, status: 'pending', progress: 0, template: '故事板', duration: 60 }
  ]
  
  return NextResponse.json(tasks)
}