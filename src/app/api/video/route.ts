import { NextRequest, NextResponse } from 'next/server'
import { writeFileSync, unlinkSync, existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import { execSync } from 'child_process'
import { PrismaClient } from '@prisma/client'
import { checkQuota, incrementUsage } from '@/lib/quota'
import OSS from 'ali-oss'

const prisma = new PrismaClient()

// 常见 FFmpeg 安装路径
const commonFFmpegPaths = process.platform === 'win32' ? [
  process.env.LOCALAPPDATA + '\\Microsoft\\WinGet\\Links\\ffmpeg.exe',
  'C:\\ffmpeg\\bin\\ffmpeg.exe',
  'C:\\ProgramData\\winget\\Packages\\Gyan.FFmpeg\\bin\\ffmpeg.exe',
  'C:\\Users\\Admin\\AppData\\Local\\Microsoft\\WinGet\\Links\\ffmpeg.exe',
  'ffmpeg',
] : [
  '/usr/bin/ffmpeg',
  '/usr/local/bin/ffmpeg',
  '/opt/homebrew/bin/ffmpeg',
  'ffmpeg',
];

// 获取 FFmpeg 路径
function getFFmpegPath(): string {
  // 优先使用环境变量
  if (process.env.FFMPEG_PATH) {
    console.log('FFmpeg from env:', process.env.FFMPEG_PATH);
    return process.env.FFMPEG_PATH;
  }
  
  console.log('Checking FFmpeg paths...');
  // 遍历常见路径
  for (const path of commonFFmpegPaths) {
    if (!path) continue;
    console.log('  Checking:', path, 'exists:', existsSync(path));
    if (existsSync(path)) {
      console.log('FFmpeg found at:', path);
      return path;
    }
  }
  
  console.log('FFmpeg not found in common paths, returning default');
  return 'ffmpeg';
}

// 构建 FFmpeg 命令（兼容 Windows）
function buildFFmpegCommand(...args: string[]): string {
  const ffmpegPath = getFFmpegPath();
  
  // 检查是否是完整路径（包含 \ 或 / 或 :）
  const isFullPath = /[\\/:]/.test(ffmpegPath);
  
  if (process.platform === 'win32' && isFullPath) {
    // Windows + 完整路径：需要引号
    return `"${ffmpegPath}" ${args.join(' ')}`;
  } else if (process.platform === 'win32') {
    // Windows + 命令名（ffmpeg）：直接用，不加引号
    return `ffmpeg ${args.join(' ')}`;
  } else {
    // macOS/Linux: 需要引号
    return `"${ffmpegPath}" ${args.join(' ')}`;
  }
}

// FFmpeg 检测函数 - 使用完整路径测试
function isFFmpegInstalled(): boolean {
  try {
    const command = buildFFmpegCommand('-version');
    console.log('Testing FFmpeg:', command);
    execSync(command, { stdio: 'ignore', timeout: 5000 });
    return true;
  } catch (error: any) {
    console.error('FFmpeg not found:', error.message);
    return false;
  }
}

// 创建 OSS 客户端
function createOSSClient() {
  const region = process.env.OSS_REGION || 'oss-cn-hangzhou';
  const accessKeyId = process.env.OSS_ACCESS_KEY_ID;
  const accessKeySecret = process.env.OSS_ACCESS_KEY_SECRET;
  const bucket = process.env.OSS_BUCKET;

  if (!accessKeyId || !accessKeySecret || !bucket) {
    throw new Error('OSS 配置不完整');
  }

  return new OSS({
    region,
    accessKeyId,
    accessKeySecret,
    bucket,
    secure: true
  });
}

// 生成唯一文件名
function generateUniqueFileName(ext: string): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8);
  return `outputs/${timestamp}_${random}.${ext}`;
}

// 上传文件到 OSS 并返回公网直链
async function uploadToOSSAndGetUrl(filePath: string, objectName: string): Promise<string> {
  const client = createOSSClient();
  const bucket = process.env.OSS_BUCKET || '';
  
  await client.put(objectName, filePath, {
    headers: { 'x-oss-object-acl': 'public-read' }
  });
  console.log('[OSS] 上传成功:', objectName);
  
  // 返回 OSS 公网直链
  return `https://${bucket}.oss-cn-hangzhou.aliyuncs.com/${objectName}`;
}

// 视频裁剪
function trimVideo(input: string, startTime: number, duration: number, output: string): void {
  const command = buildFFmpegCommand(`-i "${input}"`, `-ss ${startTime}`, `-t ${duration}`, '-c copy', `"${output}"`)
  console.log('[FFmpeg] Running trim command:', command);
  try {
    execSync(command, { stdio: 'inherit' })
    console.log('[FFmpeg] Trim completed successfully');
  } catch (error: any) {
    console.error('[FFmpeg] Trim failed:', error.message);
    throw error;
  }
}

// 添加文字水印
function addTextOverlay(input: string, text: string, position: string, output: string): void {
  // FFmpeg drawtext positions - 使用 main_h/main_w 避免被 shell 解析为选项
  const positionMap: Record<string, string> = {
    'top-left': '10:10',
    'top-center': '(w-text_w)/2:10',
    'top-right': 'main_w-text_w-10:10',
    'bottom-left': '10:main_h-text_h-10',
    'bottom-center': '(w-text_w)/2:main_h-text_h-10',
    'bottom-right': 'main_w-text_w-10:main_h-text_h-10',
    'center': '(w-text_w)/2:(h-text_h)/2'
  }
  const pos = positionMap[position] || positionMap['bottom-center']
  const command = buildFFmpegCommand(
    `-i "${input}"`,
    `-vf "drawtext=text='${text}':fontcolor=white:fontsize=24:box=1:boxcolor=black@0.5:boxborderw=5:x=${pos}"`,
    '-c:a copy',
    `"${output}"`
  )
  console.log('[FFmpeg] Running text overlay command:', command);
  try {
    execSync(command, { stdio: 'inherit' })
    console.log('[FFmpeg] Text overlay completed successfully');
  } catch (error: any) {
    console.error('[FFmpeg] Text overlay failed:', error.message);
    throw error;
  }
}

// 调整分辨率
function resizeVideo(input: string, width: number, height: number, output: string): void {
  const command = buildFFmpegCommand(`-i "${input}"`, `-vf "scale=${width}:${height}"`, `"${output}"`)
  console.log('[FFmpeg] Running resize command:', command);
  try {
    execSync(command, { stdio: 'inherit' })
    console.log('[FFmpeg] Resize completed successfully');
  } catch (error: any) {
    console.error('[FFmpeg] Resize failed:', error.message);
    throw error;
  }
}

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

// 使用 concat 协议拼接多个视频
function concatVideosWithProtocol(inputPaths: string[], outputPath: string): void {
  const tempDir = join(process.cwd(), 'temp')
  if (!existsSync(tempDir)) {
    mkdirSync(tempDir, { recursive: true })
  }
  
  const concatListPath = join(tempDir, `concatList_${Date.now()}.txt`)
  
  // 生成 concat 列表文件，格式：file 'xxx.mp4'
  const concatContent = inputPaths.map(p => `file '${p}'`).join('\n')
  console.log('[FFmpeg] Concat list content:', concatContent);
  writeFileSync(concatListPath, concatContent, 'utf-8')
  
  try {
    // 使用 concat 协议拼接
    const command = buildFFmpegCommand(
      '-f concat',
      '-safe 0',
      `-i "${concatListPath}"`,
      '-c copy',
      `"${outputPath}"`
    )
    console.log('[FFmpeg] Running concat command:', command);
    execSync(command, { stdio: 'inherit' })
    console.log('[FFmpeg] Concat completed successfully');
  } catch (error: any) {
    console.error('[FFmpeg] Concat failed:', error.message);
    throw error;
  } finally {
    // 清理临时文件
    if (existsSync(concatListPath)) {
      unlinkSync(concatListPath)
    }
  }
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
    case 'delete': return ['editor', 'admin'].includes(role)  // editor 和 admin 都能删除
    default: return false
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = getUserContext(request)
    
    if (user && !checkPermission(user.role, 'write')) {
      return NextResponse.json({ success: false, message: '没有权限创建视频任务' }, { status: 403 })
    }
    
    const userId = user ? user.userId : null
    const quotaResult = await checkQuota(userId, '视频剪辑')
    if (!quotaResult.allowed) {
      return NextResponse.json({ success: false, message: quotaResult.message }, { status: 403 })
    }
    
    if (!isFFmpegInstalled()) {
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
    const resolution = formData.get('resolution') as string || 'original'

    // 解析分辨率
    const resolutionMap: Record<string, { width: number; height: number }> = {
      '720p': { width: 1280, height: 720 },
      '1080p': { width: 1920, height: 1080 },
      '4k': { width: 3840, height: 2160 },
      '9:16': { width: 1080, height: 1920 },
      '1:1': { width: 1080, height: 1080 },
      '4:3': { width: 1440, height: 1080 },
      '16:9': { width: 1920, height: 1080 },
    }
    const resConfig = resolutionMap[resolution] || null

    // 将分辨率信息合并到 style 中存储
    const styleWithResolution = resolution !== 'original' ? `${style}|${resolution}` : style

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

    console.log('[Video] Processing:', { template, duration, resolution, inputCount: inputPaths.length, inputPaths });

    // 临时文件路径（处理完成后会清理）
    let tempOutput = outputPath
    let needsResize = false

    switch (template) {
      case 'mix':
        if (inputPaths.length > 1) {
          // 先拼接所有视频
          const tempMerged = join(outputDir, `temp_merged_${taskId}_${timestamp}.mp4`)
          concatVideosWithProtocol(inputPaths, tempMerged)
          // 再裁剪到指定时长
          trimVideo(tempMerged, 0, duration, tempOutput)
          if (existsSync(tempMerged)) {
            unlinkSync(tempMerged)
          }
        } else {
          trimVideo(inputPaths[0], 0, duration, tempOutput)
        }
        // 需要根据分辨率调整
        if (resolution !== 'original') {
          needsResize = true
        }
        break
      case 'quick':
        if (inputPaths.length > 1) {
          // 先拼接所有视频
          const tempMerged = join(outputDir, `temp_merged_${taskId}_${timestamp}.mp4`)
          concatVideosWithProtocol(inputPaths, tempMerged)
          // 再裁剪到指定时长
          trimVideo(tempMerged, 0, duration, tempOutput)
          if (existsSync(tempMerged)) {
            unlinkSync(tempMerged)
          }
        } else {
          trimVideo(inputPaths[0], 0, duration, tempOutput)
        }
        addTextOverlay(tempOutput, 'AiMarketing', 'bottom-right', tempOutput)
        // 需要根据分辨率调整
        if (resolution !== 'original') {
          needsResize = true
        }
        break
      case 'story':
        // 故事板模式直接使用指定分辨率
        tempOutput = join(outputDir, `temp_story_${taskId}_${timestamp}.mp4`)
        trimVideo(inputPaths[0], 0, duration, tempOutput)
        addTextOverlay(tempOutput, '故事板视频', 'top-center', tempOutput)
        needsResize = true
        break
      case 'loop':
        trimVideo(inputPaths[0], 0, duration, tempOutput)
        // 需要根据分辨率调整
        if (resolution !== 'original') {
          needsResize = true
        }
        break
      default:
        trimVideo(inputPaths[0], 0, duration, tempOutput)
        // 需要根据分辨率调整
        if (resolution !== 'original') {
          needsResize = true
        }
    }

    // 如果需要调整分辨率
    if (needsResize) {
      const finalOutput = join(outputDir, `output_resized_${taskId}_${timestamp}.mp4`)
      resizeVideo(tempOutput, resConfig.width, resConfig.height, finalOutput)
      // 清理临时未调整分辨率的文件
      if (tempOutput !== outputPath && existsSync(tempOutput)) {
        unlinkSync(tempOutput)
      }
      tempOutput = finalOutput
    }

    for (const inputPath of inputPaths) {
      if (existsSync(inputPath)) {
        unlinkSync(inputPath)
      }
    }

    // 上传到 OSS
    let ossUrl = '';
    try {
      const ossFileName = generateUniqueFileName('mp4');
      ossUrl = await uploadToOSSAndGetUrl(tempOutput, ossFileName);
      console.log('[Video] OSS 上传成功:', ossUrl);
    } catch (ossError) {
      console.error('[Video] OSS 上传失败:', ossError);
      // OSS 上传失败，保留本地文件，返回本地路径
    }

    // 如果 OSS 上传成功，清理本地临时文件；否则保留供下载
    if (ossUrl) {
      if (existsSync(tempOutput)) {
        unlinkSync(tempOutput)
      }
    } else {
      console.log('[Video] OSS 未上传成功，保留本地文件:', tempOutput)
    }

    if (user) {
      await incrementUsage(user.userId, '视频剪辑', 1)

      // 保存视频任务到数据库
      const videoTask = await prisma.videoTask.create({
        data: {
          userId: user.userId,
          originalFile: videos.map(v => v.name).join(', '),
          template,
          duration,
          style: styleWithResolution,
          status: 'completed',
          outputPath: ossUrl || tempOutput.replace(join(process.cwd(), 'public'), ''),
          progress: 100
        }
      })
      console.log('[Video] Task saved to database:', videoTask.id)
    }

    const localOutputUrl = tempOutput.replace(join(process.cwd(), 'public'), '').replace(/\\/g, '/');

    return NextResponse.json({
      success: true,
      message: '视频剪辑任务已完成',
      taskId,
      outputUrl: ossUrl || localOutputUrl,
      downloadUrl: ossUrl || localOutputUrl
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

export async function DELETE(request: NextRequest) {
  try {
    const user = getUserContext(request)
    if (!user) {
      return NextResponse.json({ success: false, message: '未登录' }, { status: 401 })
    }

    if (!checkPermission(user.role, 'delete')) {
      return NextResponse.json({ success: false, message: '没有权限' }, { status: 403 })
    }

    const { searchParams } = new URL(request.url)
    const taskId = searchParams.get('id')

    if (!taskId) {
      return NextResponse.json({ success: false, message: '缺少任务ID' }, { status: 400 })
    }

    // 检查任务是否存在且属于当前用户
    const task = await prisma.videoTask.findUnique({
      where: { id: parseInt(taskId) }
    })

    if (!task) {
      return NextResponse.json({ success: false, message: '任务不存在' }, { status: 404 })
    }

    // 检查权限：管理员可以删除任何任务，团队成员可以删除团队任务，个人用户只能删除自己的任务
    if (user.role !== 'admin') {
      if (user.teamId) {
        const taskUser = await prisma.user.findUnique({ where: { id: task.userId } })
        if (taskUser?.teamId !== user.teamId) {
          return NextResponse.json({ success: false, message: '没有权限删除此任务' }, { status: 403 })
        }
      } else if (task.userId !== user.userId) {
        return NextResponse.json({ success: false, message: '没有权限删除此任务' }, { status: 403 })
      }
    }

    // 删除关联的发布任务
    await prisma.publishingTask.deleteMany({
      where: { videoTaskId: parseInt(taskId) }
    })

    // 删除视频任务
    await prisma.videoTask.delete({
      where: { id: parseInt(taskId) }
    })

    // 清理本地视频文件
    if (task.outputPath) {
      const filePath = join(process.cwd(), 'public', task.outputPath)
      if (existsSync(filePath)) {
        unlinkSync(filePath)
      }
    }

    return NextResponse.json({ success: true, message: '删除成功' })
  } catch (error) {
    console.error('删除视频任务错误:', error)
    return NextResponse.json({ success: false, message: '删除失败' }, { status: 500 })
  } finally {
    await prisma.$disconnect()
  }
}
