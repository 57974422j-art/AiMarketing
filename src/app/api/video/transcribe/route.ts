import { NextRequest, NextResponse } from 'next/server';
import { join } from 'path';
import { writeFile, mkdir, unlink } from 'fs/promises';
import { existsSync } from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';
import OSS from 'ali-oss';

const execAsync = promisify(exec);

// 创建 OSS 客户端
function createOSSClient() {
  return new OSS({
    region: process.env.OSS_REGION || 'oss-cn-shanghai',
    accessKeyId: process.env.OSS_ACCESS_KEY_ID || '',
    accessKeySecret: process.env.OSS_ACCESS_KEY_SECRET || '',
    bucket: process.env.OSS_BUCKET || '',
  });
}

// 生成唯一文件名
function generateUniqueFileName(originalName: string): string {
  const timestamp = Date.now();
  const randomStr = Math.random().toString(36).substring(2, 8);
  const ext = originalName.substring(originalName.lastIndexOf('.')) || '.wav';
  return `asr/${timestamp}_${randomStr}${ext}`;
}

// 删除 OSS 文件
async function deleteOSSFile(objectKey: string): Promise<void> {
  try {
    const client = createOSSClient();
    await client.delete(objectKey);
    console.log(`[OSS] 已删除文件: ${objectKey}`);
  } catch (error) {
    console.error(`[OSS] 删除文件失败: ${objectKey}`, error);
  }
}

// 上传到 OSS
async function uploadToOSS(filePath: string, objectKey: string): Promise<string> {
  const client = createOSSClient();
  const result = await client.put(objectKey, filePath);
  console.log(`[OSS] 上传成功: ${result.url}`);
  return result.url;
}

// 调用 Paraformer 录音文件识别 API
async function callParaformerASR(ossUrl: string, apiKey: string): Promise<{ text: string; success: boolean; error?: string }> {
  try {
    console.log('[Paraformer] 开始调用录音文件识别 API');

    const response = await fetch('https://dashscope.aliyuncs.com/api/v1/services/asr/text/paraformer', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'paraformer-v2',
        input: {
          file_urls: [ossUrl]
        },
        parameters: {
          sample_rate: 16000
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
    console.log('[Paraformer] 响应数据:', JSON.stringify(data).substring(0, 500));

    // 检查是否有 task_id，需要轮询
    if (data.output && data.output.task_id) {
      const taskId = data.output.task_id;
      console.log(`[Paraformer] 获取到任务 ID: ${taskId}，开始轮询...`);

      // 轮询任务状态
      const pollResult = await pollTaskStatus(taskId, apiKey);
      if (pollResult.success) {
        return pollResult;
      } else {
        return { text: '', success: false, error: pollResult.error };
      }
    }

    // 直接返回结果（同步模式）
    if (data.output && data.output.results && data.output.results[0] && data.output.results[0].transcription) {
      const text = data.output.results[0].transcription.trim();
      console.log(`[Paraformer] 识别完成，文本长度: ${text.length} 字符`);
      return { text, success: true };
    }

    console.error('[Paraformer] 响应格式异常:', JSON.stringify(data).substring(0, 300));
    return { text: '', success: false, error: '响应格式异常' };

  } catch (error) {
    console.error('[Paraformer] 调用异常:', error);
    return { text: '', success: false, error: error instanceof Error ? error.message : '未知错误' };
  }
}

// 轮询任务状态
async function pollTaskStatus(taskId: string, apiKey: string): Promise<{ text: string; success: boolean; error?: string }> {
  const maxRetries = 40;
  const pollInterval = 3000; // 3 秒

  for (let i = 0; i < maxRetries; i++) {
    try {
      console.log(`[Paraformer] 轮询第 ${i + 1}/${maxRetries} 次...`);

      const response = await fetch(`https://dashscope.aliyuncs.com/api/v1/tasks/${taskId}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${apiKey}`
        }
      });

      const responseText = await response.text();
      console.log(`[Paraformer] 轮询响应状态: ${response.status}`);

      if (!response.ok) {
        console.error(`[Paraformer] 轮询请求失败: ${response.status}`, responseText);
        // 继续重试，不直接返回错误
        await sleep(pollInterval);
        continue;
      }

      const data = JSON.parse(responseText);
      console.log(`[Paraformer] 任务状态: ${data.output?.task_status}`);

      if (data.output?.task_status === 'SUCCEEDED') {
        if (data.output.results && data.output.results[0] && data.output.results[0].transcription) {
          const text = data.output.results[0].transcription.trim();
          console.log(`[Paraformer] 识别完成，文本长度: ${text.length} 字符`);
          return { text, success: true };
        }
        return { text: '', success: false, error: '任务成功但无识别结果' };
      }

      if (data.output?.task_status === 'FAILED') {
        const errorMsg = data.output?.error_message || '任务失败';
        console.error(`[Paraformer] 任务失败: ${errorMsg}`);
        return { text: '', success: false, error: errorMsg };
      }

      // 任务进行中，等待后继续轮询
      await sleep(pollInterval);

    } catch (error) {
      console.error(`[Paraformer] 轮询异常:`, error);
      await sleep(pollInterval);
    }
  }

  return { text: '', success: false, error: `轮询超时（${maxRetries} 次后仍无结果）` };
}

// 延迟函数
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function POST(request: NextRequest) {
  let tempAudioPath = '';
  let uploadVideoPath = '';
  let ossObjectKey = '';

  try {
    const formData = await request.formData();
    const video = formData.get('video') as File;

    if (!video) {
      return NextResponse.json({
        success: false,
        message: '请上传视频文件'
      }, { status: 400 });
    }

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

    // 查找 FFmpeg 路径
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

    // FFmpeg 提取音频
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

    // 检查音频文件
    if (!existsSync(tempAudioPath)) {
      return NextResponse.json({
        success: false,
        message: `音频文件不存在: ${tempAudioPath}`
      }, { status: 500 });
    }

    // 检查音频文件大小
    const fs = require('fs');
    const stats = fs.statSync(tempAudioPath);
    if (stats.size === 0) {
      return NextResponse.json({
        success: false,
        message: '音频文件为空，FFmpeg 提取音频失败'
      }, { status: 500 });
    }
    console.log(`[Transcribe] 音频文件大小: ${stats.size} bytes`);

    // 生成 OSS 文件名并上传
    const audioFileNameForOSS = `audio_${timestamp}.wav`;
    ossObjectKey = generateUniqueFileName(audioFileNameForOSS);

    console.log('[Transcribe] 开始上传音频到 OSS...');
    const ossUrl = await uploadToOSS(tempAudioPath, ossObjectKey);
    console.log(`[Transcribe] OSS 公网 URL: ${ossUrl}`);

    // 获取 API Key
    const apiKey = process.env.DASHSCOPE_API_KEY;
    if (!apiKey) {
      // 清理 OSS 文件
      await deleteOSSFile(ossObjectKey);
      return NextResponse.json({
        success: false,
        message: '未配置 DASHSCOPE_API_KEY 环境变量'
      }, { status: 500 });
    }

    // 调用 Paraformer 录音文件识别
    console.log('[Transcribe] 开始调用 Paraformer 录音文件识别 API...');
    const asrResult = await callParaformerASR(ossUrl, apiKey);

    // 识别完成后删除 OSS 临时文件
    await deleteOSSFile(ossObjectKey);

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

    // 清理 OSS 文件
    if (ossObjectKey) {
      await deleteOSSFile(ossObjectKey);
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
