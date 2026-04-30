import { NextRequest, NextResponse } from 'next/server'
import { writeFileSync, unlinkSync, existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import { PrismaClient } from '@prisma/client'
import { trimVideo, concatVideos, addTextOverlay, resizeVideo, checkFFmpeg } from '@/lib/ffmpeg'
import { checkQuota, incrementUsage } from '@/lib/quota'

const prisma = new PrismaClient()

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

function getUserContext(request: NextRequest) {
  const userId = request.headers.get('X-User-Id')
  const role = request.headers.get('X-User-Role')
  const teamId = request.headers.get('X-User-Team-Id')
  if (!userId || !role) return null
  return { userId: parseInt(userId), role, teamId: teamId ? parseInt(teamId) : null }
}

function checkPermission(role: string, action: 'read' | 'write' | 'delete'): boolean {
  switch (action) {
    case 'read': return ['viewer', 'editor', 'admin'].includes(role)
    case 'write': return ['editor', 'admin'].includes(role)
    case 'delete': return role === 'admin'
    default: return false
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = getUserContext(request)
    if (!user) {
      return NextResponse.json({ success: false, message: '未登录' }, { status: 401 })
    }
    
    if (!checkPermission(user.role, 'write')) {
      return NextResponse.json({ success: false, message: '没有权限创建视频任务' }, { status: 403 })
    }
    
    const quotaResult = await checkQuota(user.userId as any, '视频剪辑')
    if (!quotaResult.allowed) {
      return NextResponse.json({ success: false, message: quotaResult.message }, { status: 403 })
    }
    
    if (!checkFFmpeg()) {
      return NextResponse.json(
        {
          success: false,
          message: 'FFmpeg 未安装，请先安装 FFmpeg。安装命令：\nWindows: winget install Gyan.FFmpeg\nmacOS: brew install ffmpeg\nLinux: apt install ffmpeg'
        },
        { status: 400 }
      )
    }

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

    const inputPaths: string[] = []
    for (let i = 0; i < videos.length; i++) {
      const video = videos[i]
      const fileName = `input_${taskId}_${i}_${timestamp}.mp4`
      const filePath = join(uploadDir, fileName)
      const buffer = new Uint8Array(await video.arrayBuffer())
      writeFileSync(filePath, buffer as any)
      inputPaths.push(filePath)
    }

    const outputFileName = `output_${taskId}_${timestamp}.mp4`
    const outputPath = join(outputDir, outputFileName)
    const outputUrl = `/outputs/${outputFileName}`
    const downloadUrl = `http://121.199.164.168:3000/outputs/${outputFileName}`

    switch (template) {
      case 'mix':
        if (inputPaths.length > 1) {
          const tempOutput = join(outputDir, `temp_${taskId}_${timestamp}.mp4`)
          concatVideos(inputPaths, tempOutput)
          trimVideo(tempOutput, 0, duration, outputPath)
          if (existsSync(tempOutput)) {
            unlinkSync(tempOutput)
          }
        } else {
          trimVideo(inputPaths[0], 0, duration, outputPath)
        }
        break
      case 'quick':
        if (inputPaths.length > 1) {
          const tempOutput = join(outputDir, `temp_${taskId}_${timestamp}.mp4`)
          concatVideos(inputPaths, tempOutput)
          trimVideo(tempOutput, 0, duration, outputPath)
          if (existsSync(tempOutput)) {
            unlinkSync(tempOutput)
          }
        } else {
          trimVideo(inputPaths[0], 0, duration, outputPath)
        }
        addTextOverlay(outputPath, 'AiMarketing', 'bottom-right', outputPath)
        break
      case 'story':
        resizeVideo(inputPaths[0], 1080, 1920, outputPath)
        addTextOverlay(outputPath, '故事板视频', 'top-center', outputPath)
        break
      case 'loop':
        trimVideo(inputPaths[0], 0, duration, outputPath)
        break
      default:
        trimVideo(inputPaths[0], 0, duration, outputPath)
    }

    for (const inputPath of inputPaths) {
      if (existsSync(inputPath)) {
        unlinkSync(inputPath)
      }
    }

    await incrementUsage(user.userId as any, '视频剪辑', 1)

    return NextResponse.json({
      success: true,
      message: '视频剪辑任务已完成',
      taskId,
      outputUrl,
      downloadUrl
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
  try {
    const user = getUserContext(request)
    if (!user) {
      return NextResponse.json({ success: false, message: '未登录' }, { status: 401 })
    }

    if (!checkPermission(user.role, 'read')) {
      return NextResponse.json({ success: false, message: '没有权限' }, { status: 403 })
    }

    let whereClause: any = {}
    if (user.role === 'admin') {
      whereClause = {}
    } else if (user.teamId) {
      whereClause = { user: { teamId: user.teamId } }
    } else {
      whereClause = { user: { id: user.userId as any } }
    }

    const tasks = await prisma.videoTask.findMany({
      where: whereClause,
      orderBy: { createdAt: 'desc' },
      take: 50
    })

    return NextResponse.json(tasks)
  } catch (error) {
    console.error('获取视频任务错误:', error)
    return NextResponse.json({ success: false, message: '获取失败' }, { status: 500 })
  } finally {
    await prisma.$disconnect()
  }
}