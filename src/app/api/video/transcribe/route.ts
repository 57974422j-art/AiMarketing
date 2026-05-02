import { NextRequest, NextResponse } from 'next/server';
import { join } from 'path';
import { writeFile, mkdir, unlink } from 'fs/promises';
import { existsSync } from 'fs';
import { execSync } from 'child_process';

// 获取公网访问的基础 URL
function getPublicBaseUrl(): string {
  // 生产环境使用环境变量配置的公网 IP
  if (process.env.NEXT_PUBLIC_BASE_URL) {
    return process.env.NEXT_PUBLIC_BASE_URL;
  }
  // 默认使用服务器 IP
  return 'http://121.199.164.168:3000';
}

// 判断是否为开发环境
function isDevelopment(): boolean {
  return process.env.NODE_ENV === 'development';
}

// 生成模拟识别文本（开发环境使用）
function generateMockText(): string {
  const mockTexts = [
    '这是一段测试音频的识别结果。',
    '欢迎使用语音识别功能。',
    '开发环境下返回的模拟文本。',
    '视频转文字功能测试成功。',
    '阿里云 Paraformer ASR 语音识别服务。'
  ];
  return mockTexts[Math.floor(Math.random() * mockTexts.length)];
}

// 阿里云百炼 Paraformer ASR 语音识别
export async function POST(request: NextRequest) {
  let tempVideoPath = '';
  let uploadAudioPath = '';

  try {
    const formData = await request.formData();
    const video = formData.get('video') as File;

    if (!video) {
      return NextResponse.json({
        success: false,
        message: '请上传视频文件'
      }, { status: 400 });
    }

    // 检查 API Key（生产环境必须）
    const apiKey = process.env.DASHSCOPE_API_KEY;
    if (!isDevelopment() && !apiKey) {
      return NextResponse.json({
        success: false,
        message: '语音识别服务未配置'
      }, { status: 500 });
    }

    const timestamp = Date.now();

    // 1. 确保临时目录存在
    const tempDir = join(process.cwd(), 'temp');
    if (!existsSync(tempDir)) {
      await mkdir(tempDir, { recursive: true });
    }

    // 2. 确保 public/uploads 目录存在（生产环境需要）
    const uploadsDir = join(process.cwd(), 'public', 'uploads', 'asr');
    if (!existsSync(uploadsDir)) {
      await mkdir(uploadsDir, { recursive: true });
    }

    tempVideoPath = join(tempDir, `video_${timestamp}.mp4`);
    const tempAudioPath = join(tempDir, `audio_${timestamp}.wav`);
    uploadAudioPath = join(uploadsDir, `audio_${timestamp}.wav`);

    // 3. 保存上传的视频文件
    const videoBuffer = Buffer.from(await video.arrayBuffer());
    await writeFile(tempVideoPath, videoBuffer);

    // 4. 使用 FFmpeg 提取音频并转换为 16kHz wav
    const ffmpegPath = process.env.FFMPEG_PATH || 'ffmpeg';

    try {
      execSync(`"${ffmpegPath}" -i "${tempVideoPath}" -ar 16000 -ac 1 -acodec pcm_s16le "${tempAudioPath}" -y`, {
        stdio: 'pipe'
      });
    } catch (ffmpegError) {
      console.error('FFmpeg 提取音频失败:', ffmpegError);
      await unlink(tempVideoPath).catch(() => {});
      return NextResponse.json({
        success: false,
        message: '音频提取失败，请确保视频包含音频轨道'
      }, { status: 500 });
    }

    // 5. 开发环境：清理临时文件并返回模拟文本
    if (isDevelopment()) {
      console.log('开发环境：跳过 ASR 调用，返回模拟识别文本');
      await unlink(tempVideoPath).catch(() => {});
      await unlink(tempAudioPath).catch(() => {});

      return NextResponse.json({
        success: true,
        text: generateMockText(),
        message: '识别成功（开发环境模拟）'
      });
    }

    // 6. 生产环境：将音频复制到 public/uploads 目录
    const fs = require('fs');
    fs.copyFileSync(tempAudioPath, uploadAudioPath);
    console.log(`音频文件已保存: ${uploadAudioPath}`);

    // 7. 清理临时文件
    await unlink(tempVideoPath).catch(() => {});
    await unlink(tempAudioPath).catch(() => {});

    // 8. 拼接公网可访问的 URL
    const baseUrl = getPublicBaseUrl();
    const audioUrl = `${baseUrl}/uploads/asr/audio_${timestamp}.wav`;
    console.log(`音频公网 URL: ${audioUrl}`);

    // 9. 调用阿里云 Paraformer ASR
    const response = await fetch('https://dashscope.aliyuncs.com/api/v1/services/asr/text/paraformer', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'paraformer-v2',
        input: {
          file_urls: [audioUrl]
        },
        parameters: {
          audio_format: 'wav',
          sample_rate: 16000
        }
      })
    });

    const responseText = await response.text();

    // 清理上传的音频文件
    await unlink(uploadAudioPath).catch(() => {});

    if (!response.ok) {
      console.error('Paraformer ASR error:', responseText);
      return NextResponse.json({
        success: false,
        message: '语音识别失败，请重试'
      }, { status: 500 });
    }

    const data = JSON.parse(responseText);

    // 提取识别文本
    let text = '';
    if (data.output?.text) {
      text = data.output.text;
    } else if (data.output?.sentence_count > 0 && data.output.sentences) {
      text = data.output.sentences.map((s: { text: string }) => s.text).join(' ');
    }

    return NextResponse.json({
      success: true,
      text: text,
      message: '识别成功'
    });

  } catch (error) {
    console.error('Transcribe error:', error);

    // 清理临时文件
    if (tempVideoPath) await unlink(tempVideoPath).catch(() => {});
    if (uploadAudioPath) await unlink(uploadAudioPath).catch(() => {});

    return NextResponse.json({
      success: false,
      message: '语音识别失败，请重试'
    }, { status: 500 });
  }
}
