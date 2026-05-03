import { NextRequest, NextResponse } from 'next/server';
import { join } from 'path';
import { writeFile, mkdir, unlink, copyFile } from 'fs/promises';
import { existsSync } from 'fs';
import { execSync } from 'child_process';

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
async function callParaformerASR(audioUrl: string, apiKey: string): Promise<{ text: string; success: boolean; error?: string }> {
  try {
    console.log(`[Paraformer] 开始调用 ASR API，音频 URL: ${audioUrl}`);

    // 阿里云百炼 Paraformer API 调用
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
          language_type: 'zh'
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

    // 提取识别文本 - 兼容多种返回格式
    let text = '';

    // 格式1: data.output.text
    if (data.output?.text) {
      text = data.output.text;
    }
    // 格式2: data.output.sentences 数组
    else if (data.output?.sentences?.length > 0) {
      text = data.output.sentences.map((s: { text: string }) => s.text).join(' ');
    }
    // 格式3: data.result
    else if (data.result) {
      text = typeof data.result === 'string' ? data.result : data.result.text || data.result.transcription || '';
    }
    // 格式4: data.data?.text
    else if (data.data?.text) {
      text = data.data.text;
    }

    console.log(`[Paraformer] 识别文本长度: ${text.length} 字符`);
    return { text, success: true };

  } catch (error) {
    console.error('[Paraformer] 调用异常:', error);
    return { text: '', success: false, error: error instanceof Error ? error.message : '未知错误' };
  }
}

// 阿里云百炼 Paraformer ASR 语音识别
export async function POST(request: NextRequest) {
  let tempVideoPath = '';
  let tempAudioPath = '';
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

    const timestamp = Date.now();

    // 1. 确保临时目录存在
    const tempDir = join(process.cwd(), 'temp');
    if (!existsSync(tempDir)) {
      await mkdir(tempDir, { recursive: true });
    }

    // 2. 确保 public/uploads 目录存在（用于公网访问）
    const uploadsDir = join(process.cwd(), 'public', 'uploads', 'asr');
    if (!existsSync(uploadsDir)) {
      await mkdir(uploadsDir, { recursive: true });
    }

    // 3. 设置文件路径
    tempVideoPath = join(tempDir, `video_${timestamp}.mp4`);
    tempAudioPath = join(tempDir, `audio_${timestamp}.wav`);
    uploadAudioPath = join(uploadsDir, `audio_${timestamp}.wav`);

    // 4. 保存上传的视频文件
    const videoBuffer = Buffer.from(await video.arrayBuffer());
    await writeFile(tempVideoPath, videoBuffer);
    console.log(`[Transcribe] 视频文件已保存: ${tempVideoPath} (${video.size} bytes)`);

    // 5. 使用 FFmpeg 从视频提取音频并转换为 16kHz WAV
    const ffmpegPath = process.env.FFMPEG_PATH || 'ffmpeg';
    console.log(`[Transcribe] 使用 FFmpeg: ${ffmpegPath}`);

    try {
      execSync(`"${ffmpegPath}" -i "${tempVideoPath}" -ar 16000 -ac 1 -acodec pcm_s16le "${tempAudioPath}" -y`, {
        stdio: 'pipe',
        timeout: 120 // 2分钟超时
      });
      console.log(`[Transcribe] 音频提取成功: ${tempAudioPath}`);
    } catch (ffmpegError) {
      console.error('[Transcribe] FFmpeg 提取音频失败:', ffmpegError);
      await unlink(tempVideoPath).catch(() => {});
      return NextResponse.json({
        success: false,
        message: '音频提取失败，请确保视频包含音频轨道'
      }, { status: 400 });
    }

    // 6. 开发环境：直接返回模拟文本
    if (isDevelopment()) {
      console.log('[Transcribe] 开发环境：跳过 ASR 调用，返回模拟识别文本');
      await unlink(tempVideoPath).catch(() => {});
      await unlink(tempAudioPath).catch(() => {});

      return NextResponse.json({
        success: true,
        text: generateMockText(),
        message: '识别成功（开发环境模拟）'
      });
    }

    // 7. 生产环境：检查 API Key（必须从环境变量读取）
    const apiKey = process.env.DASHSCOPE_API_KEY;

    if (!apiKey) {
      console.warn('[Transcribe] 生产环境：未配置 DASHSCOPE_API_KEY');
      await unlink(tempVideoPath).catch(() => {});
      await unlink(tempAudioPath).catch(() => {});

      return NextResponse.json({
        success: false,
        message: '未配置 DASHSCOPE_API_KEY 环境变量'
      }, { status: 500 });
    }

    // 8. 将音频复制到 public/uploads 目录供公网访问
    await copyFile(tempAudioPath, uploadAudioPath);
    console.log(`[Transcribe] 音频文件已复制到公网目录: ${uploadAudioPath}`);

    // 9. 拼接公网可访问的 URL
    const baseUrl = getPublicBaseUrl();
    const audioUrl = `${baseUrl}/uploads/asr/audio_${timestamp}.wav`;
    console.log(`[Transcribe] 音频公网 URL: ${audioUrl}`);

    // 10. 调用阿里云 Paraformer ASR
    const asrResult = await callParaformerASR(audioUrl, apiKey);

    // 11. 清理临时文件和上传的音频
    await Promise.all([
      unlink(tempVideoPath).catch(() => {}),
      unlink(tempAudioPath).catch(() => {}),
      unlink(uploadAudioPath).catch(() => {})
    ]);

    if (!asrResult.success) {
      return NextResponse.json({
        success: false,
        message: `ASR 调用失败: ${asrResult.error}`
      }, { status: 500 });
    }

    if (!asrResult.text) {
      return NextResponse.json({
        success: true,
        text: '',
        message: '未检测到语音内容'
      });
    }

    console.log(`[Transcribe] 识别成功，文本长度: ${asrResult.text.length}`);

    return NextResponse.json({
      success: true,
      text: asrResult.text,
      message: '识别成功'
    });

  } catch (error) {
    console.error('[Transcribe] 处理异常:', error);

    // 清理所有临时文件
    await Promise.all([
      tempVideoPath ? unlink(tempVideoPath).catch(() => {}) : Promise.resolve(),
      tempAudioPath ? unlink(tempAudioPath).catch(() => {}) : Promise.resolve(),
      uploadAudioPath ? unlink(uploadAudioPath).catch(() => {}) : Promise.resolve()
    ]);

    return NextResponse.json({
      success: false,
      message: `处理失败: ${error instanceof Error ? error.message : '未知错误'}`
    }, { status: 500 });
  }
}
