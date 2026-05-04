import { NextRequest, NextResponse } from 'next/server';
import { join } from 'path';
import { writeFile, mkdir, unlink, readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

// 调用硅基流动 Whisper API
async function callSiliconFlowWhisper(audioFilePath: string, apiKey: string): Promise<{ text: string; success: boolean; error?: string }> {
  try {
    console.log('[SiliconFlow] 开始调用 Whisper API');

    // 读取音频文件
    const audioData = await readFile(audioFilePath);
    console.log(`[SiliconFlow] 音频文件大小: ${audioData.length} bytes`);

    // 创建 FormData
    const formData = new FormData();
    formData.append('file', new Blob([audioData]), 'audio.wav');
    formData.append('model', 'Qwen/Qwen3-ASR');

    const response = await fetch('https://api.siliconflow.cn/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`
      },
      body: formData
    });

    const responseText = await response.text();
    console.log(`[SiliconFlow] API 响应状态: ${response.status}`);

    if (!response.ok) {
      console.error(`[SiliconFlow] API 调用失败: ${response.status}`, responseText);
      return { text: '', success: false, error: `API 错误: ${response.status} - ${responseText.substring(0, 200)}` };
    }

    const data = JSON.parse(responseText);
    console.log('[SiliconFlow] 响应数据:', JSON.stringify(data).substring(0, 300));

    // 提取识别文本
    if (data.text) {
      const text = data.text.trim();
      console.log(`[SiliconFlow] 识别完成，文本长度: ${text.length} 字符`);
      return { text, success: true };
    }

    console.error('[SiliconFlow] 响应格式异常:', JSON.stringify(data).substring(0, 300));
    return { text: '', success: false, error: '响应格式异常' };

  } catch (error) {
    console.error('[SiliconFlow] 调用异常:', error);
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

    // 获取 API Key
    const apiKey = process.env.SILICONFLOW_API_KEY;
    if (!apiKey) {
      return NextResponse.json({
        success: false,
        message: '未配置 SILICONFLOW_API_KEY 环境变量'
      }, { status: 500 });
    }

    // 调用硅基流动 Whisper API
    console.log('[Transcribe] 开始调用硅基流动 Whisper API...');
    const asrResult = await callSiliconFlowWhisper(tempAudioPath, apiKey);

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
