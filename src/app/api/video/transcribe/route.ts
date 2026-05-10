import { NextRequest, NextResponse } from 'next/server';
import { join } from 'path';
import { writeFile, mkdir, unlink } from 'fs/promises';
import { existsSync, statSync, readFileSync } from 'fs';
import { execFile } from 'child_process';
import { promisify } from 'util';
import OSS from 'ali-oss';

export const runtime = 'nodejs';

const execFileAsync = promisify(execFile);

const DEBUG = true; // 调试开关

function debug(...args: unknown[]) {
  if (DEBUG) console.log('[Transcribe:DEBUG]', ...args);
}

function getPythonPath(): string {
  const envPython = process.env.PYTHON_PATH;
  if (envPython) return envPython;
  return process.platform === 'win32' ? 'python' : 'python3';
}

function getScriptPath(): string {
  const envScript = process.env.FUNASR_SCRIPT_PATH;
  if (envScript) return envScript;
  return join(process.cwd(), 'scripts', 'funasr_asr.py');
}





// ==================== DashScope 语音识别（Qwen3 推荐格式） ====================

/** 检查 DashScope ASR 配置是否完整 */
function isDashscopeASRConfigured(): boolean {
  return !!(process.env.DASHSCOPE_API_KEY && process.env.OSS_ACCESS_KEY_ID && process.env.OSS_ACCESS_KEY_SECRET && process.env.OSS_BUCKET);
}

/** 创建 OSS 客户端 */
function createOSSClient(): OSS {
  return new OSS({
    region: process.env.OSS_REGION || 'oss-cn-hangzhou',
    accessKeyId: process.env.OSS_ACCESS_KEY_ID!,
    accessKeySecret: process.env.OSS_ACCESS_KEY_SECRET!,
    bucket: process.env.OSS_BUCKET!,
  });
}

/** 上传音频到 OSS */
async function uploadAudioToOSS(audioPath: string, ossKey: string): Promise<string> {
  const client = createOSSClient();
  const fileBuffer = readFileSync(audioPath);
  await client.put(ossKey, fileBuffer);
  const region = process.env.OSS_REGION || 'oss-cn-hangzhou';
  const bucket = process.env.OSS_BUCKET!;
  return `https://${bucket}.${region}.aliyuncs.com/${ossKey}`;
}

/** 提交 DashScope ASR 异步任务（需 X-DashScope-Async: enable） */
async function submitDashscopeTask(audioUrl: string): Promise<string> {
  const apiKey = process.env.DASHSCOPE_API_KEY!;

  const body = JSON.stringify({
    model: 'paraformer-v2',
    input: { file_urls: [audioUrl] },
    parameters: {
      diarization_enabled: true,
      timestamp_alignment_enabled: true,
    },
  });

  debug('[DashScope ASR] 提交任务, audioUrl:', audioUrl);
  const res = await fetch('https://dashscope.aliyuncs.com/api/v1/services/audio/asr/transcription', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
      'X-DashScope-Async': 'enable',
    },
    body,
    signal: AbortSignal.timeout(60000),
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`DashScope ASR HTTP ${res.status}: ${text.substring(0, 300)}`);
  }

  const data = JSON.parse(text);
  const taskId = data.output?.task_id || data.task_id;
  if (!taskId) {
    throw new Error(`DashScope 未返回 task_id: ${text.substring(0, 200)}`);
  }

  debug('[DashScope ASR] 任务提交成功, task_id:', taskId);
  return taskId;
}

/** 查询 DashScope 任务状态 / 下载结果 */
async function pollDashscopeTask(taskId: string, maxWaitMs = 300000): Promise<any> {
  const apiKey = process.env.DASHSCOPE_API_KEY!;
  const startTime = Date.now();
  const pollInterval = 5000;

  while (Date.now() - startTime < maxWaitMs) {
    await new Promise(r => setTimeout(r, pollInterval));

    debug('[DashScope ASR] 轮询...');
    const res = await fetch(`https://dashscope.aliyuncs.com/api/v1/tasks/${taskId}`, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(15000),
    });

    const text = await res.text();
    if (!res.ok) {
      console.warn('[DashScope ASR] 轮询失败 HTTP', res.status, text.substring(0, 200));
      continue;
    }

    const data = JSON.parse(text);
    const status = data.output?.task_status || '';

    if (status === 'SUCCEEDED') {
      debug('[DashScope ASR] 任务完成，下载结果...');
      // 结果需要从 transcription_url 下载
      const transcriptionUrl = data.output?.results?.[0]?.transcription_url;
      if (transcriptionUrl) {
        const resultRes = await fetch(transcriptionUrl, { signal: AbortSignal.timeout(30000) });
        const resultText = await resultRes.text();
        debug('[DashScope ASR] 结果原始JSON前500字:', resultText.substring(0, 500));
        const resultData = JSON.parse(resultText);
        debug('[DashScope ASR] 结果 keys:', Object.keys(resultData).join(', '));
        if (resultData.output) debug('[DashScope ASR] output keys:', Object.keys(resultData.output).join(', '));
        if (resultData.output?.sentences) debug('[DashScope ASR] sentences数:', resultData.output.sentences.length);
        if (resultData.sentences) debug('[DashScope ASR] 顶层sentences数:', resultData.sentences.length);
        return resultData;
      }
      return data;
    }

    if (status === 'FAILED') {
      throw new Error(`DashScope ASR 失败: ${data.output?.message || '未知错误'}`);
    }

    // RUNNING / PENDING 继续
  }

  throw new Error(`DashScope ASR 超时（超过 ${maxWaitMs / 1000}s）`);
}

/** 解析 DashScope ASR 结果 */
function parseDashscopeResult(data: any): {
  text: string;
  segments: Array<{ text: string; start: number; end: number; speaker: string }>;
  speaker_count: number;
  speakers: string[];
} {
  // 真实格式: { transcripts: [{ sentences: [{ text, begin_time, end_time }] }] }
  const transcripts = data.transcripts || [];
  const sentences = transcripts[0]?.sentences || [];
  const fullText = transcripts[0]?.text || '';

  const segments = sentences.map((s: any) => ({
    text: String(s.text || ''),
    start: Number(s.begin_time || 0) / 1000,  // 毫秒转秒
    end: Number(s.end_time || 0) / 1000,
    speaker: '',
  }));

  return {
    text: fullText,
    segments,
    speaker_count: 1,
    speakers: ['SPEAKER_00'],
  };
}

export async function POST(request: NextRequest) {
  let tempAudioPath = '';
  let uploadVideoPath = '';

  try {
    const formData = await request.formData();
    const video = formData.get('video') as File;
    if (!video) {
      return NextResponse.json({ success: false, message: '请上传视频文件' }, { status: 400 });
    }
    debug('收到视频文件:', video.name, video.size, 'bytes');

    const timestamp = Date.now();
    const uploadsDir = join(process.cwd(), 'public', 'uploads', 'asr');
    const tempDir = join(process.cwd(), 'temp');
    await mkdir(uploadsDir, { recursive: true });
    await mkdir(tempDir, { recursive: true });

    tempAudioPath = join(tempDir, `audio_${timestamp}.wav`);
    uploadVideoPath = join(uploadsDir, `video_${timestamp}.mp4`);

    await writeFile(uploadVideoPath, new Uint8Array(await video.arrayBuffer()));
    debug('视频已保存:', uploadVideoPath, statSync(uploadVideoPath).size, 'bytes');

    // 步骤1: FFmpeg 提取音频
    const ffmpegPath = process.env.FFMPEG_PATH || 'ffmpeg';
    debug('FFmpeg 路径:', ffmpegPath);
    debug('开始提取音频...');

    let ffmpegExtractResult: { stdout: string; stderr: string };
    try {
      ffmpegExtractResult = await execFileAsync(
        ffmpegPath,
        ['-i', uploadVideoPath, '-vn', '-acodec', 'pcm_s16le', '-ar', '16000', '-ac', '1', '-y', tempAudioPath],
        { timeout: 60000 }
      );
    } catch (e: unknown) {
      const err = e as { stderr?: string; message?: string; code?: string };
      const detail = err.stderr || err.message || String(e);
      console.error('[Transcribe:ERROR] FFmpeg 音频提取失败:', detail);
      return NextResponse.json(
        { success: false, message: `音频提取失败`, debug: { step: 'ffmpeg_extract', detail: detail.substring(0, 500) } },
        { status: 400 }
      );
    }

    if (ffmpegExtractResult.stderr) {
      debug('FFmpeg stderr:', ffmpegExtractResult.stderr.substring(0, 300));
    }

    if (!existsSync(tempAudioPath)) {
      return NextResponse.json(
        { success: false, message: '音频文件未生成', debug: { step: 'ffmpeg_extract', detail: '输出文件不存在' } },
        { status: 500 }
      );
    }

    const audioSize = statSync(tempAudioPath).size;
    debug('音频提取完成, 大小:', audioSize, 'bytes');
    if (audioSize === 0) {
      return NextResponse.json(
        { success: false, message: '音频文件为空', debug: { step: 'ffmpeg_extract', detail: '0 bytes' } },
        { status: 500 }
      );
    }

    // ========== 步骤2: 如果 DashScope 配置完整，走 DashScope ASR ==========
    if (isDashscopeASRConfigured()) {
      try {
        debug('[DashScope ASR] 配置完整，开始 DashScope Paraformer 文件转写...');
        const aliyunStartTime = Date.now();

        // 2a. 上传音频到 OSS
        const ossKey = `asr/audio_${timestamp}.wav`;
        debug('[DashScope ASR] 上传音频到 OSS...');
        const audioUrl = await uploadAudioToOSS(tempAudioPath, ossKey);
        debug('[DashScope ASR] OSS 上传成功, URL:', audioUrl);

        // 2b. 提交 ASR 任务
        const taskId = await submitDashscopeTask(audioUrl);

        // 2c. 轮询结果
        const resultData = await pollDashscopeTask(taskId);

        // 2d. 解析结果
        const parsed = parseDashscopeResult(resultData);
        const aliyunElapsed = Date.now() - aliyunStartTime;
        debug('[DashScope ASR] 总耗时:', aliyunElapsed, 'ms');
        debug('[DashScope ASR] 说话人:', parsed.speakers.join(', '), '| 段数:', parsed.segments.length);

        // 删除临时音频
        await unlink(tempAudioPath).catch(() => {});
        const videoUrl = `/uploads/asr/video_${timestamp}.mp4`;

        return NextResponse.json({
          success: true,
          text: parsed.text,
          message: '识别成功（DashScope Paraformer）',
          videoUrl,
          segments: parsed.segments,
          word_timestamps: [] as Array<[number, number]>,
          speaker_labels: parsed.speakers,
          speaker_count: parsed.speaker_count,
          debug: { aliyun_elapsed_ms: aliyunElapsed, audio_bytes: audioSize, sentences_count: parsed.segments.length },
        });
      } catch (aliyunErr: unknown) {
        const aliyunMsg = aliyunErr instanceof Error ? aliyunErr.message : String(aliyunErr);
        console.warn('[Transcribe:WARN] DashScope ASR 失败，降级到本地 FunASR:', aliyunMsg);
        // 降级：继续执行下面的 FunASR 代码
      }
    } else {
      debug('[DashScope ASR] 配置不完整（需 DASHSCOPE_API_KEY + OSS_*），跳过阿里云路径');
    }

    // ========== 降级路径: 调用本地 FunASR Python 脚本 ==========
    const pythonPath = getPythonPath();
    const scriptPath = getScriptPath();

    debug('Python:', pythonPath, '| 脚本:', scriptPath);

    if (!existsSync(scriptPath)) {
      return NextResponse.json(
        { success: false, message: `FunASR 脚本不存在: ${scriptPath}`, debug: { step: 'check_script', detail: scriptPath } },
        { status: 500 }
      );
    }
    if (!existsSync(pythonPath)) {
      // python 可能在 PATH 中但不存在于文件系统
      debug('Python 可执行文件不存在（可能在 PATH 中）:', pythonPath);
    }

    debug('开始调用 FunASR...');
    const funasrStartTime = Date.now();
    let stdout: string, stderr: string;

    try {
      const result = await execFileAsync(pythonPath, [scriptPath, tempAudioPath], {
        timeout: 300000,
        maxBuffer: 10 * 1024 * 1024,
      });
      stdout = result.stdout;
      stderr = result.stderr;
    } catch (e: unknown) {
      const err = e as { stderr?: string; stdout?: string; message?: string; code?: string };
      const detail = err.stderr || err.message || String(e);
      const outSnippet = err.stdout ? `, stdout前200字: ${String(err.stdout).substring(0, 200)}` : '';
      console.error('[Transcribe:ERROR] FunASR 调用失败:', detail, outSnippet);
      await unlink(tempAudioPath).catch(() => {});
      await unlink(uploadVideoPath).catch(() => {});
      return NextResponse.json(
        { success: false, message: 'FunASR 调用失败', debug: { step: 'funasr_exec', detail: detail.substring(0, 500), stderr: String(err.stderr || '').substring(0, 500) } },
        { status: 500 }
      );
    }

    const funasrElapsed = Date.now() - funasrStartTime;
    debug('FunASR 耗时:', funasrElapsed, 'ms');
    debug('FunASR stdout 长度:', stdout.length, '字符');
    debug('FunASR stderr 长度:', stderr.length, '字符');

    if (stderr && stderr.length > 0) {
      console.warn('[Transcribe:WARN] FunASR stderr:', stderr.substring(0, 800));
    }

    if (!stdout || stdout.trim().length === 0) {
      console.error('[Transcribe:ERROR] FunASR stdout 为空');
      await unlink(tempAudioPath).catch(() => {});
      await unlink(uploadVideoPath).catch(() => {});
      return NextResponse.json(
        { success: false, message: 'FunASR 输出为空', debug: { step: 'funasr_parse', detail: 'stdout 为空, stderr: ' + stderr.substring(0, 500) } },
        { status: 500 }
      );
    }

    // 步骤3: 解析 JSON
    let result: Record<string, unknown>;
    try {
      result = JSON.parse(stdout.trim());
    } catch (parseErr: unknown) {
      const parseMsg = parseErr instanceof Error ? parseErr.message : String(parseErr);
      console.error('[Transcribe:ERROR] JSON 解析失败:', parseMsg);
      console.error('[Transcribe:ERROR] stdout 原始内容前500字:', stdout.substring(0, 500));
      await unlink(tempAudioPath).catch(() => {});
      await unlink(uploadVideoPath).catch(() => {});
      return NextResponse.json(
        { success: false, message: 'FunASR 输出格式错误', debug: { step: 'json_parse', error: parseMsg, stdout_snippet: stdout.substring(0, 500) } },
        { status: 500 }
      );
    }

    const resultSentences = (result.sentences || []) as unknown[]
    const debugKeys = (result as Record<string, unknown>)._debug_keys as string[] | undefined
    debug('FunASR sentences 数量:', resultSentences.length)
    if (debugKeys) {
      debug('FunASR 可用 data keys:', debugKeys.join(', '))
    }
    if (resultSentences.length > 0) {
      const first = resultSentences[0] as Record<string, unknown>
      debug('FunASR 首段:', JSON.stringify({ text: String(first.text || '').substring(0, 30), start: first.start, end: first.end, speaker: first.speaker }))
    }
    const speakerLabels = (result.speakers || []) as string[]
    if (speakerLabels.length > 0) {
      debug('FunASR 说话人:', speakerLabels.join(', '), '数量:', result.speaker_count)
    }

    // 删除临时音频
    await unlink(tempAudioPath).catch(() => {});

    if (!result.success) {
      const errMsg = String(result.error || '语音识别失败');
      console.error('[Transcribe:ERROR] FunASR 识别失败:', errMsg);
      await unlink(uploadVideoPath).catch(() => {});
      return NextResponse.json(
        { success: false, message: errMsg, debug: { step: 'funasr_result', detail: errMsg, raw: result } },
        { status: 500 }
      );
    }

    const videoUrl = `/uploads/asr/video_${timestamp}.mp4`;
    debug('识别成功, text长度:', String(result.text || '').length);
    debug('返回 videoUrl:', videoUrl);

    return NextResponse.json({
      success: true,
      text: String(result.text || ''),
      message: '识别成功',
      videoUrl,
      segments: ((result.sentences || []) as Array<Record<string, unknown>>).map((s) => ({
        text: String(s.text || ''),
        start: Number(s.start || 0),
        end: Number(s.end || 0),
        speaker: String(s.speaker || ''),
      })),
      word_timestamps: (result.words || result.timestamp || []) as Array<[number, number]>,
      speaker_labels: (result.speakers || []) as string[],
      speaker_count: Number(result.speaker_count || 0),
      debug: { funasr_elapsed_ms: funasrElapsed, audio_bytes: audioSize, sentences_count: ((result.sentences || []) as unknown[]).length },
    });

  } catch (error: unknown) {
    await Promise.all([unlink(tempAudioPath), unlink(uploadVideoPath)]).catch(() => {});
    const msg = error instanceof Error ? error.message : '处理失败';
    console.error('[Transcribe:ERROR] 未捕获异常:', error);
    return NextResponse.json(
      { success: false, message: msg, debug: { step: 'uncaught', detail: String(error).substring(0, 500) } },
      { status: 500 }
    );
  }
}
