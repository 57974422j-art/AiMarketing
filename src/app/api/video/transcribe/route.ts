import { NextRequest, NextResponse } from 'next/server';
import { join } from 'path';
import { writeFile, mkdir, unlink, readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';
import OSS from 'ali-oss';

const execAsync = promisify(exec);

// 初始化 OSS 客户端（从环境变量读取配置）
function createOSSClient() {
  const region = process.env.OSS_REGION;
  const accessKeyId = process.env.OSS_ACCESS_KEY_ID;
  const accessKeySecret = process.env.OSS_ACCESS_KEY_SECRET;
  const bucket = process.env.OSS_BUCKET;

  if (!region || !accessKeyId || !accessKeySecret || !bucket) {
    throw new Error('OSS 配置不完整，请检查环境变量');
  }

  return new OSS({
    region,
    accessKeyId,
    accessKeySecret,
    bucket,
    secure: true,
  });
}

// 生成唯一的文件名
function generateUniqueFileName(): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8);
  return `asr/audio_${timestamp}_${random}.wav`;
}

// 调用阿里云 Paraformer 录音文件识别 API（通过 OSS URL）
async function callParaformerFileASR(ossUrl: string, apiKey: string, language?: string): Promise<{ text: string; success: boolean; error?: string }> {
  try {
    console.log(`[Paraformer] 开始调用录音文件识别 API，OSS URL: ${ossUrl}`);

    const response = await fetch('https://dashscope.aliyuncs.com/api/v1/services/audio/asr/transcription', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'X-DashScope-Async': 'enable'
      },
      body: JSON.stringify({
        model: 'paraformer-v2',
        input: {
          audio_url: ossUrl
        },
        parameters: {
          language: language || 'zh',
          enable_timestamp: false,
          enable_punctuation_prediction: true,
          enable_inverse_text_normalization: true
        }
      })
    });

    const responseText = await response.text();
    console.log(`[Paraformer] API 响应状态: ${response.status}`);

    if (!response.ok) {
      console.error(`[Paraformer] API 调用失败: ${response.status}`, responseText);
      return { text: '', success: false, error: `API 错误: ${response.status} - ${responseText.substring(0, 200)}` };
    }

    const data = JSON.parse(responseText);
    
    // 检查是否异步任务已创建
    if (data.output && data.output.task_id) {
      console.log(`[Paraformer] 异步任务已创建，任务ID: ${data.output.task_id}`);
      
      // 轮询获取识别结果
      const taskId = data.output.task_id;
      const maxAttempts = 60; // 最大轮询次数（最多等待2分钟）
      const delay = 2000; // 2秒间隔
      
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        console.log(`[Paraformer] 轮询识别结果 (${attempt}/${maxAttempts})...`);
        
        await new Promise(resolve => setTimeout(resolve, delay));
        
        const taskResponse = await fetch(`https://dashscope.aliyuncs.com/api/v1/tasks/${taskId}`, {
          headers: {
            'Authorization': `Bearer ${apiKey}`
          }
        });
        
        if (!taskResponse.ok) {
          console.error(`[Paraformer] 任务查询失败: ${taskResponse.status}`);
          continue;
        }
        
        const taskData = await taskResponse.json();
        
        if (taskData.output && taskData.output.sentences) {
          // 提取所有句子的文本
          const sentences = taskData.output.sentences;
          const text = sentences.map((s: any) => s.text).join(' ').trim();
          
          console.log(`[Paraformer] 识别完成，文本长度: ${text.length} 字符`);
          return { text, success: true };
        }
        
        if (taskData.status === 'FAILED') {
          console.error(`[Paraformer] 识别任务失败: ${taskData.message}`);
          return { text: '', success: false, error: taskData.message };
        }
      }
      
      return { text: '', success: false, error: '识别超时，请稍后重试' };
    }
    
    return { text: '', success: false, error: '任务创建失败' };

  } catch (error) {
    console.error('[Paraformer] 调用异常:', error);
    return { text: '', success: false, error: error instanceof Error ? error.message : '未知错误' };
  }
}

// 删除 OSS 上的文件
async function deleteOSSFile(client: OSS, objectName: string): Promise<void> {
  try {
    await client.delete(objectName);
    console.log(`[OSS] 已删除文件: ${objectName}`);
  } catch (error) {
    console.error(`[OSS] 删除文件失败: ${objectName}`, error);
  }
}

export async function POST(request: NextRequest) {
  let tempAudioPath = '';
  let uploadVideoPath = '';
  let ossObjectName = '';
  let ossUrl = '';

  try {
    const formData = await request.formData();
    const video = formData.get('video') as File;
    const language = formData.get('language') as string | null;

    if (!video) {
      return NextResponse.json({
        success: false,
        message: '请上传视频文件'
      }, { status: 400 });
    }

    console.log(`[Transcribe] 接收语言参数: ${language || '未指定（自动检测）'}`);

    const timestamp = Date.now();
    const videoFileName = `video_${timestamp}.mp4`;
    const audioFileName = `audio_${timestamp}.wav`;

    const uploadsDir = join(process.cwd(), 'public', 'uploads', 'asr');
    if (!existsSync(uploadsDir)) {
      await mkdir(uploadsDir, { recursive: true });
    }

    const tempDir = join(process.cwd(), 'temp');
    if (!existsSync(tempDir)) {
      await mkdir(tempDir, { recursive: true });
    }

    tempAudioPath = join(tempDir, audioFileName);
    uploadVideoPath = join(uploadsDir, videoFileName);

    const videoArrayBuffer = await video.arrayBuffer();
    const videoData = new Uint8Array(videoArrayBuffer);
    await writeFile(uploadVideoPath, videoData);
    console.log(`[Transcribe] 视频文件已保存: ${uploadVideoPath} (${video.size} bytes)`);

    // 使用异步 exec 提取音频
    const commonFFmpegPaths = process.platform === 'win32' ? [
      process.env.LOCALAPPDATA + '\\Microsoft\\WinGet\\Links\\ffmpeg.exe',
      'C:\\ffmpeg\\bin\\ffmpeg.exe',
      'C:\\ProgramData\\winget\\Packages\\Gyan.FFmpeg\\Tools\\ffmpeg.exe',
      'ffmpeg',
    ] : ['/usr/bin/ffmpeg', '/usr/local/bin/ffmpeg', '/opt/homebrew/bin/ffmpeg', 'ffmpeg'];

    let ffmpegPath = process.env.FFMPEG_PATH;
    if (!ffmpegPath) {
      for (const p of commonFFmpegPaths) {
        if (p && existsSync(p)) {
          ffmpegPath = p;
          break;
        }
      }
      ffmpegPath = ffmpegPath || 'ffmpeg';
    }

    console.log(`[Transcribe] 使用 FFmpeg: ${ffmpegPath}`);

    if (!existsSync(uploadVideoPath)) {
      return NextResponse.json({
        success: false,
        message: '视频文件保存失败'
      }, { status: 500 });
    }

    const ffmpegCommand = `"${ffmpegPath}" -i "${uploadVideoPath}" -vn -acodec pcm_s16le -ar 16000 -ac 1 "${tempAudioPath}"`;
    console.log(`[Transcribe] 提取音频: ${ffmpegCommand}`);

    try {
      const { stderr } = await execAsync(ffmpegCommand, { timeout: 60000 });
      if (stderr) console.log(`[Transcribe] FFmpeg stderr（正常）: ${stderr.substring(0, 200)}`);
      console.log(`[Transcribe] 音频提取成功: ${tempAudioPath}`);
    } catch (ffmpegError: any) {
      const errorOutput = ffmpegError.stderr || ffmpegError.message || '未知错误';
      console.error('[Transcribe] FFmpeg 错误输出:', errorOutput.substring(0, 300));

      if (errorOutput.includes('No audio stream') ||
          errorOutput.includes('does not contain any stream') ||
          errorOutput.includes('does not have any stream')) {
        return NextResponse.json({
          success: false,
          message: '视频不包含音频轨道，无法进行语音识别'
        }, { status: 400 });
      }

      return NextResponse.json({
        success: false,
        message: `音频提取失败: ${errorOutput.substring(0, 200)}`
      }, { status: 400 });
    }

    // ========== 真实的阿里云语音识别流程 ==========

    // 1. 上传音频到 OSS
    console.log('[Transcribe] 开始上传音频到 OSS...');
    const client = createOSSClient();
    ossObjectName = generateUniqueFileName();

    const audioBuffer = await readFile(tempAudioPath);
    // 将 Buffer 转换为 Uint8Array 以符合 ali-oss 的类型要求
    const uint8Array = new Uint8Array(audioBuffer);
    await client.put(ossObjectName, uint8Array);
    
    // 构建 OSS 公网访问 URL
    ossUrl = `https://${process.env.OSS_BUCKET}.${process.env.OSS_REGION}.aliyuncs.com/${ossObjectName}`;
    console.log(`[Transcribe] 音频已上传到 OSS: ${ossUrl}`);

    // 2. 获取 DASHSCOPE_API_KEY
    const apiKey = process.env.DASHSCOPE_API_KEY;
    if (!apiKey) {
      await deleteOSSFile(client, ossObjectName);
      return NextResponse.json({
        success: false,
        message: '未配置 DASHSCOPE_API_KEY 环境变量'
      }, { status: 500 });
    }

    // 3. 调用 Paraformer 录音文件识别 API
    console.log('[Transcribe] 开始调用语音识别 API...');
    const asrResult = await callParaformerFileASR(ossUrl, apiKey, language || undefined);

    // 4. 删除 OSS 上的临时音频文件
    await deleteOSSFile(client, ossObjectName);

    // 清理本地临时文件
    await unlink(tempAudioPath).catch(() => {});
    await unlink(uploadVideoPath).catch(() => {});

    if (!asrResult.success) {
      return NextResponse.json({
        success: false,
        message: `语音识别失败: ${asrResult.error}`
      }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      text: asrResult.text,
      message: '识别成功'
    });

  } catch (error) {
    console.error('[Transcribe] 处理异常:', error);
    
    // 清理 OSS 上的临时文件
    if (ossObjectName) {
      try {
        const client = createOSSClient();
        await deleteOSSFile(client, ossObjectName);
      } catch {}
    }
    
    // 清理本地临时文件
    await unlink(tempAudioPath).catch(() => {});
    await unlink(uploadVideoPath).catch(() => {});
    
    return NextResponse.json({
      success: false,
      message: `处理失败: ${error instanceof Error ? error.message : '未知错误'}`
    }, { status: 500 });
  }
}
