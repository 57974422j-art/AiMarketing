import { NextRequest, NextResponse } from 'next/server';
import { join } from 'path';
import { writeFile, mkdir, unlink, readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';
import OSS from 'ali-oss';
import CryptoJS from 'crypto-js';

const execAsync = promisify(exec);

// NLS 应用配置
const NLS_APPKEY = 'airiirGFYdru0LGV4mHM';
const NLS_SUBMIT_URL = 'https://nls-gateway.cn-shanghai.aliyuncs.com/filetrans/submit';
const NLS_QUERY_URL = 'https://nls-gateway.cn-shanghai.aliyuncs.com/filetrans/query';

// 生成阿里云 API 签名
function generateSignature(accessKeySecret: string, stringToSign: string): string {
  return CryptoJS.enc.Base64.stringify(CryptoJS.HmacSHA1(stringToSign, accessKeySecret));
}

// 创建 OSS 客户端
function createOSSClient() {
  const region = process.env.OSS_REGION || 'oss-cn-shanghai';
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
  return `asr/${timestamp}_${random}.${ext}`;
}

// 上传文件到 OSS
async function uploadToOSS(filePath: string, objectName: string): Promise<string> {
  const client = createOSSClient();
  const result = await client.put(objectName, filePath);
  console.log('[OSS] 上传成功:', result.url);
  return result.url;
}

// 删除 OSS 文件
async function deleteOSSFile(objectName: string): Promise<void> {
  try {
    const client = createOSSClient();
    await client.delete(objectName);
    console.log('[OSS] 文件已删除:', objectName);
  } catch (error) {
    console.error('[OSS] 删除文件失败:', error);
  }
}

// 提交 NLS 识别任务
async function submitNLSTask(fileLink: string, accessKeyId: string, accessKeySecret: string): Promise<string> {
  const timestamp = new Date().toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
  const random = Math.random().toString(36).substring(2, 10);

  // 构造签名字符串
  const stringToSign = `POST\napplication/json\n${timestamp}\n/filetrans/submit`;
  const signature = generateSignature(accessKeySecret, stringToSign);
  const signatureHeader = `Dataplus ${accessKeyId}:${signature}`;

  const body = JSON.stringify({
    appkey: NLS_APPKEY,
    file_link: fileLink,
    version: '4.0',
    enable_words: false
  });

  console.log('[NLS] 提交识别任务:', { file_link: fileLink });

  const response = await fetch(NLS_SUBMIT_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': signatureHeader,
      'X-NLS-Architecture': 'Dataplus',
      'X-NLS-Timestamp': timestamp,
      'X-NLS-Nonce': random
    },
    body
  });

  const responseText = await response.text();
  console.log('[NLS] 提交响应:', response.status, responseText.substring(0, 300));

  if (!response.ok) {
    throw new Error(`NLS 提交失败: ${response.status} - ${responseText.substring(0, 200)}`);
  }

  const data = JSON.parse(responseText);
  if (data.data?.task_id) {
    console.log('[NLS] 任务已提交，TaskId:', data.data.task_id);
    return data.data.task_id;
  }

  throw new Error(`NLS 提交响应格式异常: ${responseText.substring(0, 200)}`);
}

// 轮询 NLS 任务状态
async function pollNLSResult(taskId: string, accessKeyId: string, accessKeySecret: string): Promise<string> {
  const maxAttempts = 40;
  const intervalMs = 5000;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    console.log(`[NLS] 轮询进度: ${attempt}/${maxAttempts}`);

    const timestamp = new Date().toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
    const random = Math.random().toString(36).substring(2, 10);

    // 构造签名
    const stringToSign = `POST\napplication/json\n${timestamp}\n/filetrans/query`;
    const signature = generateSignature(accessKeySecret, stringToSign);
    const signatureHeader = `Dataplus ${accessKeyId}:${signature}`;

    const body = JSON.stringify({
      appkey: NLS_APPKEY,
      taskid: taskId
    });

    const response = await fetch(NLS_QUERY_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': signatureHeader,
        'X-NLS-Architecture': 'Dataplus',
        'X-NLS-Timestamp': timestamp,
        'X-NLS-Nonce': random
      },
      body
    });

    const responseText = await response.text();
    console.log(`[NLS] 查询响应 (${attempt}):`, response.status, responseText.substring(0, 300));

    if (!response.ok) {
      console.error(`[NLS] 查询失败，${intervalMs / 1000}秒后重试...`);
      await new Promise(resolve => setTimeout(resolve, intervalMs));
      continue;
    }

    const data = JSON.parse(responseText);

    // 检查状态
    if (data.data?.status_text === 'SUCCESS') {
      console.log('[NLS] 识别成功');
      return data.data.result || '';
    }

    if (data.data?.status_text === 'RUNNING' || data.data?.status_text === 'QUEUEING') {
      console.log(`[NLS] 任务进行中 (${data.data.status_text})，等待 ${intervalMs / 1000} 秒...`);
      await new Promise(resolve => setTimeout(resolve, intervalMs));
      continue;
    }

    if (data.data?.status_text === 'FAILED') {
      throw new Error(`NLS 识别失败: ${data.data.failed_reason || '未知错误'}`);
    }

    // 未知状态，等待后重试
    console.log(`[NLS] 未知状态: ${data.data?.status_text}，等待 ${intervalMs / 1000} 秒...`);
    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }

  throw new Error('NLS 识别超时（40次轮询）');
}

// 调用阿里云 NLS 录音文件识别
async function callNLSASR(audioFilePath: string): Promise<{ text: string; success: boolean; error?: string }> {
  try {
    console.log('[NLS] 开始调用阿里云智能语音交互');

    const accessKeyId = process.env.OSS_ACCESS_KEY_ID;
    const accessKeySecret = process.env.OSS_ACCESS_KEY_SECRET;

    if (!accessKeyId || !accessKeySecret) {
      return { text: '', success: false, error: '未配置 OSS_ACCESS_KEY_ID 或 OSS_ACCESS_KEY_SECRET' };
    }

    // 上传音频到 OSS
    const ossFileName = generateUniqueFileName('wav');
    console.log('[NLS] 上传音频到 OSS...');
    const fileLink = await uploadToOSS(audioFilePath, ossFileName);

    try {
      // 提交识别任务
      const taskId = await submitNLSTask(fileLink, accessKeyId, accessKeySecret);

      // 轮询获取结果
      const result = await pollNLSResult(taskId, accessKeyId, accessKeySecret);

      // 清理 OSS 文件
      await deleteOSSFile(ossFileName);

      console.log(`[NLS] 识别完成，文本长度: ${result.length} 字符`);
      return { text: result, success: true };
    } catch (asrError) {
      // 清理 OSS 文件
      await deleteOSSFile(ossFileName);
      throw asrError;
    }

  } catch (error) {
    console.error('[NLS] 调用异常:', error);
    return { text: '', success: false, error: error instanceof Error ? error.message : '未知错误' };
  }
}

export async function POST(request: NextRequest) {
  let tempAudioPath = '';
  let uploadVideoPath = '';

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
    const stats = require('fs').statSync(tempAudioPath);
    if (stats.size === 0) {
      return NextResponse.json({
        success: false,
        message: '音频文件为空，FFmpeg 提取音频失败'
      }, { status: 500 });
    }
    console.log(`[Transcribe] 音频文件大小: ${stats.size} bytes`);

    // 调用阿里云 NLS 录音文件识别
    console.log('[Transcribe] 开始调用阿里云 NLS 录音文件识别...');
    const asrResult = await callNLSASR(tempAudioPath);

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

    // 清理本地临时文件
    await unlink(tempAudioPath).catch(() => {});
    await unlink(uploadVideoPath).catch(() => {});

    return NextResponse.json({
      success: false,
      message: `处理失败: ${error instanceof Error ? error.message : '未知错误'}`
    }, { status: 500 });
  }
}
