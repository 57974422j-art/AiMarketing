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

// 支持的语言列表
const SUPPORTED_LANGUAGES: Record<string, string> = {
  'zh': '中文',
  'en': '英语',
  'ja': '日语',
  'ko': '韩语',
  'es': '西班牙语',
  'fr': '法语',
  'de': '德语',
  'pt': '葡萄牙语',
  'ru': '俄语',
  'ar': '阿拉伯语',
  'it': '意大利语',
  'hi': '印地语',
  'th': '泰语',
  'vi': '越南语',
  'id': '印尼语',
  'ms': '马来语',
  'nl': '荷兰语',
  'pl': '波兰语',
  'tr': '土耳其语',
  'uk': '乌克兰语',
};

// 自动检测时使用的语言列表
const AUTO_DETECT_LANGUAGES = ['zh', 'en', 'ja', 'ko', 'es', 'fr', 'de', 'pt', 'ru', 'ar', 'hi'];

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
    // 确定语言 hints
    let languageHints: string[];
    let languageDisplay: string;

    if (language && SUPPORTED_LANGUAGES[language]) {
      // 指定了特定语言
      languageHints = [language];
      languageDisplay = SUPPORTED_LANGUAGES[language];
    } else {
      // 未指定或不支持的语言，使用自动检测
      languageHints = AUTO_DETECT_LANGUAGES;
      languageDisplay = '自动检测';
    }

    console.log(`[Paraformer] 开始调用 ASR API，音频 URL: ${audioUrl}`);
    console.log(`[Paraformer] 识别语言: ${languageDisplay} (${languageHints.join(', ')})`);

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
  let tempAudioPath = '';
  let uploadAudioPath = '';
  let uploadVideoPath = ''; // 保留视频文件用于调试

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

    // 1. 确保 public/uploads/asr 目录存在（视频和音频都保存在这里用于调试）
    const uploadsDir = join(process.cwd(), 'public', 'uploads', 'asr');
    if (!existsSync(uploadsDir)) {
      await mkdir(uploadsDir, { recursive: true });
    }

    // 2. 确保临时目录存在
    const tempDir = join(process.cwd(), 'temp');
    if (!existsSync(tempDir)) {
      await mkdir(tempDir, { recursive: true });
    }

    // 3. 设置文件路径
    tempAudioPath = join(tempDir, audioFileName);
    uploadAudioPath = join(uploadsDir, audioFileName);
    uploadVideoPath = join(uploadsDir, videoFileName); // 视频也保存在 uploads

    // 4. 保存上传的视频文件（同时保存到 uploads 用于调试）
    const videoBuffer = Buffer.from(await video.arrayBuffer());
    await writeFile(uploadVideoPath, videoBuffer); // 保存到 uploads
    console.log(`[Transcribe] 视频文件已保存: ${uploadVideoPath} (${video.size} bytes)`);

    // 5. 使用 FFmpeg 从视频提取音频并转换为 16kHz WAV
    // 常见 FFmpeg 路径
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

    // 6. 使用 ffprobe 检查视频是否有音频轨道
    // ffprobe 通常与 ffmpeg 在同一目录
    let ffprobePath = '';
    
    // 方法1：从 ffmpeg 路径推断 ffprobe 路径
    if (ffmpegPath.includes('ffmpeg')) {
      ffprobePath = ffmpegPath.replace(/ffmpeg(\.exe)?$/, 'ffprobe$1');
      if (existsSync(ffprobePath)) {
        console.log(`[Transcribe] 使用 ffprobe (从 ffmpeg 推断): ${ffprobePath}`);
      } else {
        ffprobePath = '';
      }
    }
    
    // 方法2：查找常见的 ffprobe 路径
    if (!ffprobePath) {
      const commonFfprobePaths = process.platform === 'win32' ? [
        process.env.LOCALAPPDATA + '\\Microsoft\\WinGet\\Links\\ffprobe.exe',
        'C:\\ffmpeg\\bin\\ffprobe.exe',
        'C:\\ProgramData\\winget\\Packages\\Gyan.FFmpeg\\Tools\\ffprobe.exe',
        'ffprobe',
      ] : ['/usr/bin/ffprobe', '/usr/local/bin/ffprobe', '/opt/homebrew/bin/ffprobe', 'ffprobe'];
      
      for (const p of commonFfprobePaths) {
        if (p && (existsSync(p) || p === 'ffprobe' || p === 'ffprobe.exe')) {
          ffprobePath = p;
          console.log(`[Transcribe] 使用 ffprobe (常见路径): ${ffprobePath}`);
          break;
        }
      }
    }
    
    // 方法3：使用 which 命令查找
    if (!ffprobePath) {
      try {
        const whichCmd = process.platform === 'win32' ? 'where ffprobe' : 'which ffprobe';
        const result = execSync(whichCmd, { encoding: 'utf-8', timeout: 5 }).trim();
        if (result) {
          ffprobePath = result.split('\n')[0];
          console.log(`[Transcribe] 使用 ffprobe (which): ${ffprobePath}`);
        }
      } catch {
        console.log('[Transcribe] which 命令未找到 ffprobe');
      }
    }
    
    ffprobePath = ffprobePath || 'ffprobe';
    console.log(`[Transcribe] 最终 ffprobe 路径: ${ffprobePath}`);
    
    let hasAudio = false;
    try {
      const probeCmd = `"${ffprobePath}" -v error -show_entries stream=codec_type -of csv=p=0 "${uploadVideoPath}"`;
      console.log(`[Transcribe] 检测音频轨道命令: ${probeCmd}`);
      const probeOutput = execSync(probeCmd, { encoding: 'utf-8', timeout: 30 });
      hasAudio = probeOutput.includes('audio');
      console.log(`[Transcribe] 视频流信息: ${probeOutput.trim()}`);
    } catch (error) {
      console.error('[Transcribe] ffprobe 执行失败:', error);
      console.error('[Transcribe] 错误类型:', error instanceof Error ? error.message : '未知错误');
      return NextResponse.json({
        success: false,
        message: '无法检测视频音轨，ffprobe 执行失败'
      }, { status: 400 });
    }

    if (!hasAudio) {
      console.warn('[Transcribe] 视频不包含音频轨道，文件已保存到:', uploadVideoPath);
      return NextResponse.json({
        success: false,
        message: '视频不包含音频轨道，无法进行语音识别'
      }, { status: 400 });
    }

    try {
      // 提取音频命令（使用经过验证的参数格式）
      const extractCmd = `"${ffmpegPath}" -i "${uploadVideoPath}" -vn -acodec pcm_s16le -ar 16000 -ac 1 "${tempAudioPath}"`;
      console.log(`[Transcribe] 执行: ${extractCmd}`);

      execSync(extractCmd, {
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 120,
        encoding: 'utf-8'
      });
      console.log(`[Transcribe] 音频提取成功: ${tempAudioPath}`);
    } catch (ffmpegError: unknown) {
      const errorObj = ffmpegError as { stderr?: string; message?: string };
      const errorOutput = errorObj.stderr || errorObj.message || '未知错误';
      console.error('[Transcribe] FFmpeg 错误输出:', errorOutput);
      console.log(`[Transcribe] 视频文件已保留: ${uploadVideoPath}`);
      return NextResponse.json({
        success: false,
        message: `音频提取失败: ${errorOutput.substring(0, 200)}`
      }, { status: 400 });
    }

    // 6. 开发环境：直接返回模拟文本
    if (isDevelopment()) {
      console.log('[Transcribe] 开发环境：跳过 ASR 调用，返回模拟识别文本');
      // 清理临时音频文件，保留上传的视频用于调试
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
      // 清理临时音频文件，保留上传的视频用于调试
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

    // 10. 调用阿里云 Paraformer ASR（传递语言参数）
    const asrResult = await callParaformerASR(audioUrl, apiKey, language || undefined);

    // 11. 清理临时文件，保留上传的视频和音频用于调试
    await Promise.all([
      unlink(tempAudioPath).catch(() => {}),
      unlink(uploadAudioPath).catch(() => {})
    ]);
    console.log(`[Transcribe] 临时音频已清理，视频保留在: ${uploadVideoPath}`);

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
    console.log(`[Transcribe] 视频文件已保留: ${uploadVideoPath}`);

    // 只清理临时文件，保留上传的视频用于调试
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
