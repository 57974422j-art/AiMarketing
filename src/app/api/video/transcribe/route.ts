import { NextRequest, NextResponse } from 'next/server';
import { join } from 'path';
import { writeFile, mkdir, unlink } from 'fs/promises';
import { existsSync } from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

// 调用阿里云百炼 Qwen-Audio 语音识别
async function callQwenAudioASR(audioBase64: string, apiKey: string): Promise<{ text: string; success: boolean; error?: string }> {
  try {
    console.log('[Qwen-Audio] 开始调用语音识别 API');

    const response = await fetch('https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'qwen2.5-omni-7b',
        messages: [
          {
            role: 'user',
            content: [
              { type: 'audio_url', audio_url: { url: `data:audio/wav;base64,${audioBase64}` } },
              { type: 'text', text: '请识别音频中的文字，直接输出文字内容。' }
            ]
          }
        ]
      })
    });

    const responseText = await response.text();
    console.log(`[Qwen-Audio] API 响应状态: ${response.status}`);

    if (!response.ok) {
      console.error(`[Qwen-Audio] API 调用失败: ${response.status}`, responseText);
      return { text: '', success: false, error: `API 错误: ${response.status} - ${responseText.substring(0, 200)}` };
    }

    const data = JSON.parse(responseText);
    
    // 提取识别文本
    if (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) {
      const text = data.choices[0].message.content.trim();
      console.log(`[Qwen-Audio] 识别完成，文本长度: ${text.length} 字符`);
      return { text, success: true };
    }

    console.error('[Qwen-Audio] 响应格式异常:', JSON.stringify(data).substring(0, 300));
    return { text: '', success: false, error: '响应格式异常' };

  } catch (error) {
    console.error('[Qwen-Audio] 调用异常:', error);
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

    // 读取音频文件并转为 Base64
    const fs = require('fs');
    const audioData = fs.readFileSync(tempAudioPath);
    const fileSize = audioData.length;
    console.log(`[Transcribe] 音频文件大小: ${fileSize} bytes`);

    if (fileSize === 0) {
      return NextResponse.json({
        success: false,
        message: '音频文件为空，FFmpeg 提取音频失败'
      }, { status: 500 });
    }

    const audioBase64 = audioData.toString('base64');

    // 获取 API Key
    const apiKey = process.env.DASHSCOPE_API_KEY;
    if (!apiKey) {
      return NextResponse.json({
        success: false,
        message: '未配置 DASHSCOPE_API_KEY 环境变量'
      }, { status: 500 });
    }

    // 调用 Qwen-Audio 语音识别
    console.log('[Transcribe] 开始调用 Qwen-Audio 语音识别 API...');
    const asrResult = await callQwenAudioASR(audioBase64, apiKey);

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
