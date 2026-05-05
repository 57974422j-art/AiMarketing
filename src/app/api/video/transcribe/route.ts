import { NextRequest, NextResponse } from 'next/server';
import { join } from 'path';
import { writeFile, mkdir, unlink, readFile } from 'fs/promises';
import { existsSync, statSync } from 'fs';
import { execFile } from 'child_process';
import { promisify } from 'util';

export const runtime = 'nodejs';

const execFileAsync = promisify(execFile);

async function callSiliconFlowWhisper(audioFilePath: string, apiKey: string): Promise<{ text: string; success: boolean; error?: string }> {
  try {
    const audioData = await readFile(audioFilePath);
    const formData = new FormData();
    formData.append('file', new Blob([audioData]), 'audio.wav');
    const audioModel = process.env.SILICONFLOW_AUDIO_MODEL || 'FunAudioLLM/SenseVoiceSmall';
    formData.append('model', audioModel);

    const response = await fetch('https://api.siliconflow.cn/v1/audio/transcriptions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}` },
      body: formData
    });

    const responseText = await response.text();
    if (!response.ok) {
      let errorMsg = responseText.substring(0, 200);
      try { errorMsg = JSON.parse(responseText).message || errorMsg; } catch {}
      return { text: '', success: false, error: `API 错误 ${response.status}: ${errorMsg}` };
    }

    const data = JSON.parse(responseText);
    if (data.text) return { text: data.text.trim(), success: true };
    return { text: '', success: false, error: 'API 未返回有效文本' };
  } catch (error) {
    return { text: '', success: false, error: error instanceof Error ? error.message : '网络或解析异常' };
  }
}

export async function POST(request: NextRequest) {
  let tempAudioPath = '', uploadVideoPath = '';
  try {
    const formData = await request.formData();
    const video = formData.get('video') as File;
    if (!video) return NextResponse.json({ success: false, message: '请上传视频文件' }, { status: 400 });

    const timestamp = Date.now();
    const uploadsDir = join(process.cwd(), 'public', 'uploads', 'asr');
    const tempDir = join(process.cwd(), 'temp');
    await mkdir(uploadsDir, { recursive: true });
    await mkdir(tempDir, { recursive: true });
    tempAudioPath = join(tempDir, `audio_${timestamp}.wav`);
    uploadVideoPath = join(uploadsDir, `video_${timestamp}.mp4`);

    await writeFile(uploadVideoPath, new Uint8Array(await video.arrayBuffer()));

    let ffmpegPath = process.env.FFMPEG_PATH || 'ffmpeg';
    if (!existsSync(ffmpegPath)) {
      for (const p of ['/usr/bin/ffmpeg', '/usr/local/bin/ffmpeg', 'ffmpeg']) {
        if (existsSync(p)) { ffmpegPath = p; break; }
      }
    }

    try {
      await execFileAsync(ffmpegPath, ['-i', uploadVideoPath, '-vn', '-acodec', 'pcm_s16le', '-ar', '16000', '-ac', '1', tempAudioPath], { timeout: 60000 });
    } catch (e: any) {
      return NextResponse.json({ success: false, message: '音频提取失败' }, { status: 400 });
    }

    const stats = statSync(tempAudioPath);
    if (stats.size === 0) return NextResponse.json({ success: false, message: '音频文件为空' }, { status: 500 });

    const apiKey = process.env.SILICONFLOW_API_KEY;
    if (!apiKey) return NextResponse.json({ success: false, message: '未配置 SILICONFLOW_API_KEY' }, { status: 500 });

    const asrResult = await callSiliconFlowWhisper(tempAudioPath, apiKey);
    // 只删除临时音频文件，保留上传的视频文件供后续处理
    await unlink(tempAudioPath).catch(() => {});
    
    if (!asrResult.success) {
      // 识别失败时删除上传的视频文件
      await unlink(uploadVideoPath).catch(() => {});
      return NextResponse.json({ success: false, message: `语音识别失败: ${asrResult.error}` }, { status: 500 });
    }
    
    // 返回识别结果和视频URL（相对路径）
    const videoUrl = `/uploads/asr/video_${timestamp}.mp4`;
    return NextResponse.json({ 
      success: true, 
      text: asrResult.text, 
      message: '识别成功',
      videoUrl: videoUrl  // 返回视频URL供后续处理使用
    });
  } catch (error) {
    // 出错时清理临时文件
    await Promise.all([unlink(tempAudioPath), unlink(uploadVideoPath)]).catch(() => {});
    return NextResponse.json({ success: false, message: '处理失败' }, { status: 500 });
  }
}
