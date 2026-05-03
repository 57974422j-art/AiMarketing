import { NextRequest, NextResponse } from 'next/server';
import { join } from 'path';
import { writeFile, mkdir, unlink, copyFile } from 'fs/promises';
import { existsSync, statSync } from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

// 获取公网访问的基础 URL
function getPublicBaseUrl(): string {
  if (process.env.NEXT_PUBLIC_BASE_URL) {
    return process.env.NEXT_PUBLIC_BASE_URL;
  }
  return 'http://121.199.164.168:3000';
}

// 判断是否为开发环境
function isDevelopment(): boolean {
  return process.env.NODE_ENV === 'development';
}

// 生成模拟识别文本
function generateMockText(): string {
  const mockTexts = [
    '[模拟识别结果] 这是一段测试音频的识别结果。',
    '[模拟识别结果] 欢迎使用语音识别功能。',
    '[模拟识别结果] 视频转文字功能测试成功。',
    '[模拟识别结果] 阿里云 Paraformer ASR 语音识别服务运行正常。',
    '[模拟识别结果] 本次识别为开发环境模拟返回，实际使用时将调用真实 ASR API。'
  ];
  return mockTexts[Math.floor(Math.random() * mockTexts.length)];
}

// 调用阿里云 Paraformer ASR 语音识别
async function callParaformerASR(audioUrl: string, apiKey: string, language?: string): Promise<{ text: string; success: boolean; error?: string }> {
  try {
    let languageHints: string[];
    let languageDisplay: string;

    const AUTO_DETECT_LANGUAGES = ['zh', 'en', 'ja', 'ko', 'es', 'fr', 'de', 'pt', 'ru', 'ar', 'hi'];

    if (language && AUTO_DETECT_LANGUAGES.includes(language)) {
      languageHints = [language];
      languageDisplay = language;
    } else {
      languageHints = AUTO_DETECT_LANGUAGES;
      languageDisplay = '自动检测';
    }

    console.log(`[Paraformer] 开始调用 ASR API，音频 URL: ${audioUrl}`);
    console.log(`[Paraformer] 识别语言: ${languageDisplay} (${languageHints.join(', ')})`);

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
          sample_rate: 16000,
          language_hints: languageHints
        }
      })
    });

    const responseText = await response.text();
    console.log(`[Paraformer] API 响应状态: ${response.status}`);

    if (!response.ok) {
      console.error(`[Paraformer] API 调用失败: ${response.status}`, responseText);
      return { text: '', success: false, error: `API 错误: ${response.status}` };
    }

    const data = JSON.parse(responseText);

    let text = '';
    if (data.output?.text) {
      text = data.output.text;
    } else if (data.output?.sentences?.length > 0) {
      text = data.output.sentences.map((s: { text: string }) => s.text).join(' ');
    } else if (data.result) {
      text = typeof data.result === 'string' ? data.result : data.result.text || data.result.transcription || '';
    } else if (data.data?.text) {
      text = data.data.text;
    }

    console.log(`[Paraformer] 识别文本长度: ${text.length} 字符`);
    return { text, success: true };

  } catch (error) {
    console.error('[Paraformer] 调用异常:', error);
    return { text: '', success: false, error: error instanceof Error ? error.message : '未知错误' };
  }
}

export async function POST(request: NextRequest) {
  let tempAudioPath = '';
  let uploadAudioPath = '';
  let uploadVideoPath = '';

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
    uploadAudioPath = join(uploadsDir, audioFileName);
    uploadVideoPath = join(uploadsDir, videoFileName);

    const videoBuffer = Buffer.from(await video.arrayBuffer());
    await writeFile(uploadVideoPath, videoBuffer);
    console.log(`[Transcribe] 视频文件已保存: ${uploadVideoPath} (${video.size} bytes)`);

    // ========== 核心修复：使用异步 exec 替代同步 execFileSync ==========
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
    console.log(`[Transcribe] 提取音频（异步）: ${ffmpegCommand}`);

    try {
      const { stdout, stderr } = await execAsync(ffmpegCommand, { timeout: 60000 });
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

    // 开发环境：直接返回模拟文本
    if (isDevelopment()) {
      console.log('[Transcribe] 开发环境：跳过 ASR 调用，返回模拟识别文本');
      await unlink(tempAudioPath).catch(() => {});
      return NextResponse.json({
        success: true,
        text: generateMockText(),
        message: '识别成功（开发环境模拟）'
      });
    }

    // 生产环境：调用真实 ASR
    const apiKey = process.env.DASHSCOPE_API_KEY;
    if (!apiKey) {
      console.warn('[Transcribe] 生产环境：未配置 DASHSCOPE_API_KEY');
      await unlink(tempAudioPath).catch(() => {});
      return NextResponse.json({
        success: false,
        message: '未配置 DASHSCOPE_API_KEY 环境变量'
      }, { status: 500 });
    }

    await copyFile(tempAudioPath, uploadAudioPath);
    const baseUrl = getPublicBaseUrl();
    const audioUrl = `${baseUrl}/uploads/asr/audio_${timestamp}.wav`;

    const asrResult = await callParaformerASR(audioUrl, apiKey, language || undefined);

    await Promise.all([
      unlink(tempAudioPath).catch(() => {}),
      unlink(uploadAudioPath).catch(() => {})
    ]);

    if (!asrResult.success) {
      return NextResponse.json({
        success: false,
        message: `ASR 调用失败: ${asrResult.error}`
      }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      text: asrResult.text,
      message: '识别成功'
    });

  } catch (error) {
    console.error('[Transcribe] 处理异常:', error);
    await Promise.all([
      tempAudioPath ? unlink(tempAudioPath).catch(() => {}) : Promise.resolve(),
      uploadAudioPath ? unlink(uploadAudioPath).catch(() => {}) : Promise.resolve()
    ]);
    return NextResponse.json({
      success: false,
      message: `处理失败: ${error instanceof Error ? error.message : '未知错误'}`
    }, { status: 500 });
  }
}
