// AI 提供商统一接口 — 多级降级模式
// 优先级：百炼DashScope(通义千问) > 火山方舟(Volcano) > 硅基流动(SiliconFlow) > DeepSeek > 模拟兜底(Mock)
// 每个函数内部 try-catch，失败自动切换到下一个

import { join } from 'path'
import { existsSync } from 'fs'
import { mkdir, writeFile, unlink } from 'fs/promises'
import { execFile } from 'child_process'
import { promisify } from 'util'
const execFileAsync = promisify(execFile)

// ==================== 基础工具 ====================

async function fetchJSON(url: string, options: RequestInit, retries = 1): Promise<any> {
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await fetch(url, options);
      const text = await res.text();
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.substring(0, 200)}`);
      return JSON.parse(text);
    } catch (e) {
      if (i === retries) throw e;
      await new Promise(r => setTimeout(r, 1000 * (i + 1)));
    }
  }
}

async function fetchBuffer(url: string, options: RequestInit): Promise<ArrayBuffer | null> {
  try {
    const res = await fetch(url, options);
    if (!res.ok) {
      const text = await res.text();
      console.error(`[fetchBuffer] 请求失败:`, text.substring(0, 200));
      return null;
    }
    return res.arrayBuffer();
  } catch (e) {
    console.error(`[fetchBuffer] 网络异常:`, e);
    return null;
  }
}

function callChatAPI(baseUrl: string, apiKey: string, model: string, prompt: string, maxTokens = 1000): Promise<any> {
  return fetchJSON(`${baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.7,
      max_tokens: maxTokens,
    }),
  });
}

// ==================== 文本清洗工具 ====================

// Emoji → 情绪描述词映射（支持中英文）
const EMOJI_MAP: Record<string, string> = {
  '😡': '（愤怒地）', '😠': '（愤怒地）', '🤬': '（愤怒地）',
  '😊': '（开心地）', '😄': '（开心地）', '😁': '（开心地）', '😀': '（开心地）', '🙂': '（微笑）',
  '😂': '（笑着）', '🤣': '（大笑着）', '😅': '（尴尬地笑）',
  '😢': '（伤心地）', '😭': '（哭泣着）', '😞': '（失望地）', '😔': '（忧郁地）',
  '😍': '（喜爱地）', '😘': '（亲昵地）', '🥰': '（充满爱意地）',
  '😮': '（惊讶地）', '😱': '（惊恐地）', '😨': '（害怕地）', '😰': '（焦虑地）',
  '😎': '（得意地）', '🤩': '（兴奋地）', '😏': '（狡黠地）',
  '🤔': '（思考着）', '🧐': '（审视地）',
  '👍': '（赞许地）', '👎': '（反对地）', '🙏': '（恳求地）', '👏': '（鼓掌）',
  '❤️': '（深情地）', '💔': '（心痛地）', '💕': '（温柔地）',
  '🎉': '（欢呼）', '🎊': '（庆祝）', '🥳': '（欢庆地）',
  '😴': '（困倦地）', '🥱': '（打着哈欠）',
  '😤': '（不服气地）', '😩': '（无奈地）', '😫': '（疲惫地）',
  '🤗': '（热情地）', '🤝': '（握手）',
  '👀': '（注视着）', '🙄': '（翻白眼）',
  '💪': '（坚定地）', '✊': '（握拳）',
  '🎵': '', '🎶': '', '🎼': '',  // 音乐符号直接删除
  '✨': '', '🌟': '', '⭐': '',   // 星星符号直接删除
};

// 替换 Emoji 为情绪描述词（用于 TTS 配音前处理）
export function replaceEmoji(text: string): string {
  let result = text;
  for (const [emoji, desc] of Object.entries(EMOJI_MAP)) {
    result = result.split(emoji).join(desc);
  }
  // 删除剩余的未映射 Emoji
  result = result.replace(
    /[\u{1F000}-\u{1FFFF}\u{2700}-\u{27BF}\u{2600}-\u{26FF}\u{FE00}-\u{FE0F}\u{200D}\u{23CF}\u{23E9}-\u{23F3}\u{231A}-\u{231B}\u{2328}\u{23F0}\u{23F8}-\u{23FA}\u{24C2}\u{25AA}-\u{25FE}\u{2B05}-\u{2B55}\u{2934}-\u{2935}\u{3030}\u{303D}\u{3297}\u{3299}\u{D83C}-\u{DBFF}\u{DC00}-\u{DFFF}]/gu,
    ''
  );
  return result;
}

// 移除控制字符（修复 "Bad control character" 错误）
function removeControlChars(text: string): string {
  // 保留 \t \n \r，移除其他 0x00-0x1F 控制字符
  return text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
}

// 准备 TTS 文本：替换 Emoji → 清理控制字符 → 合并空格
export function prepareTextForTTS(text: string): string {
  if (!text?.trim()) return '';
  const withEmotion = replaceEmoji(text);
  const noControl = removeControlChars(withEmotion);
  return noControl.replace(/\s+/g, ' ').trim();
}

// 清除 Emoji 和杂项符号，根据目标语言保留对应字符集
export function cleanText(text: string, language = 'zh'): string {
  // 1. 替换/移除 Emoji
  const noEmoji = replaceEmoji(text);
  
  // 2. 根据语言保留合法字符
  const langPatterns: Record<string, RegExp> = {
    zh: /[^\u4E00-\u9FFF\u3400-\u4DBF\u3000-\u303F\uFF00-\uFFEF\u0020-\u007E\u2000-\u206F\u0021-\u002F\u003A-\u0040\u005B-\u0060\u007B-\u007E]/g,
    en: /[^\u0020-\u007E\u2000-\u206F\u00A0-\u00FF\u0100-\u017F]/g,
    ja: /[^\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF\u3400-\u4DBF\u3000-\u303F\uFF00-\uFFEF\u0020-\u007E\u2000-\u206F]/g,
    ko: /[^\uAC00-\uD7AF\u1100-\u11FF\u3130-\u318F\u3000-\u303F\u0020-\u007E\u2000-\u206F]/g,
    fr: /[^\u0020-\u007E\u00C0-\u00FF\u0152-\u0153\u0178\u2000-\u206F]/g,
    de: /[^\u0020-\u007E\u00C0-\u00FF\u1E9E\u2000-\u206F]/g,
    es: /[^\u0020-\u007E\u00C0-\u00FF\u00D1\u00F1\u2000-\u206F]/g,
    pt: /[^\u0020-\u007E\u00C0-\u00FF\u2000-\u206F]/g,
    ru: /[^\u0020-\u007E\u0400-\u04FF\u0500-\u052F\u2000-\u206F]/g,
    ar: /[^\u0020-\u007E\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\u2000-\u206F]/g,
  };
  
  const pattern = langPatterns[language] || langPatterns.en;
  const cleaned = noEmoji.replace(pattern, ' ');
  
  // 3. 移除控制字符 + 合并空格
  return removeControlChars(cleaned).replace(/\s+/g, ' ').trim();
}

// ==================== 火山方舟 (Volcano Engine) ====================

const VOLCANO_BASE = 'https://ark.cn-beijing.volces.com';
const VOLCANO_CHAT_MODEL = 'doubao-seed-1-6-flash-250828';

function getVolcanoKey(): string | null {
  return process.env.VOLCANO_API_KEY || readEnvFile('VOLCANO_API_KEY') || null;
}

async function volcanoChat(prompt: string, maxTokens = 1000): Promise<string | null> {
  const key = getVolcanoKey();
  if (!key) return null;
  try {
    const data = await callChatAPI(VOLCANO_BASE, key, VOLCANO_CHAT_MODEL, prompt, maxTokens);
    return data.choices?.[0]?.message?.content?.trim() || null;
  } catch (e) {
    console.error('[Volcano] 对话失败:', e);
    return null;
  }
}

async function volcanoTranslate(text: string, toLang: string, fromLang = 'zh'): Promise<string | null> {
  const sourceLabel = fromLang === 'zh' ? '中文' : fromLang;
  const prompt = `请将以下${sourceLabel}翻译成${toLang}，只返回翻译结果，不要带任何解释：\n\n${text}`;
  return volcanoChat(prompt, 2000);
}

// 火山方舟 TTS（从环境变量读取凭据，未配置时返回 null 自动降级）
async function volcanoTTS(text: string, speaker = 'zh_female_vv_uranus_bigtts'): Promise<ArrayBuffer | null> {
  const appId = process.env.VOLCANO_TTS_APP_ID;
  const accessKey = process.env.VOLCANO_TTS_ACCESS_KEY;
  const resourceId = process.env.VOLCANO_TTS_RESOURCE_ID;
  if (!appId || !accessKey || !resourceId) {
    console.warn('[Volcano TTS] 未配置 TTS 环境变量，跳过');
    return null;
  }
  const cleanText = prepareTextForTTS(text);
  if (!cleanText) return null;
  try {
    const body = JSON.stringify({
      user: { uid: appId },
      req_params: {
        text: cleanText,
        speaker,
        audio_params: { format: 'mp3', sample_rate: 24000 },
        volume: 2.0,
      },
    });
    console.log(`[Volcano TTS V3] 请求: speaker=${speaker}, text_len=${cleanText.length}`);
    const res = await fetch('https://openspeech.bytedance.com/api/v3/tts/unidirectional', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Api-App-Id': appId,
        'X-Api-Access-Key': accessKey,
        'X-Api-Resource-Id': resourceId,
      },
      body,
    });
    if (!res.ok) {
      const errText = await res.text();
      console.error(`[Volcano TTS] HTTP ${res.status}:`, errText.substring(0, 500));
      return null;
    }

    // 流式读取 chunked 响应，逐行解析 JSON
    const reader = res.body?.getReader();
    if (!reader) {
      console.error('[Volcano TTS] 无法获取 response body reader');
      return null;
    }

    const decoder = new TextDecoder();
    let buffer = '';
    const dataChunks: string[] = [];
    const sentenceTexts: string[] = [];
    let chunkCount = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      // 按换行分割，逐行处理
      const lines = buffer.split('\n');
      // 最后一段可能不完整，保留到下次拼接
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        let parsed: any;
        try {
          parsed = JSON.parse(trimmed);
        } catch {
          continue;
        }
        chunkCount++;

        // code === 0 且有 data：音频数据片段
        if (parsed.code === 0 && parsed.data) {
          dataChunks.push(parsed.data);
        }
        if (parsed.sentence?.text) {
          sentenceTexts.push(parsed.sentence.text);
        }
        // code === 20000000：流结束标记
        if (parsed.code === 20000000) {
          console.log(`[Volcano TTS] 收到结束标记 code=20000000, 已收集 ${dataChunks.length} 段音频`);
        }
      }
    }

    // 处理 buffer 中剩余内容
    if (buffer.trim()) {
      try {
        const parsed = JSON.parse(buffer.trim());
        chunkCount++;
        if (parsed.code === 0 && parsed.data) {
          dataChunks.push(parsed.data);
        }
        if (parsed.sentence?.text) {
          sentenceTexts.push(parsed.sentence.text);
        }
      } catch { /* 忽略 */ }
    }

    if (dataChunks.length === 0) {
      console.error('[Volcano TTS] 流式读取完成但无音频 data, JSON 块数:', chunkCount);
      return null;
    }

    // 拼接所有 Base64 数据，一次性解码为完整 mp3
    const combinedBase64 = dataChunks.join('');
    const audioBuffer = Buffer.from(combinedBase64, 'base64');
    console.log(`[Volcano TTS] 成功, 拼接 ${dataChunks.length} 段 data, JSON 块数: ${chunkCount}, 音频大小: ${audioBuffer.byteLength} bytes`);
    if (sentenceTexts.length > 0) {
      console.log(`[Volcano TTS] sentence.text 拼接: ${sentenceTexts.join('').substring(0, 80)}`);
    }
    return audioBuffer.buffer.slice(audioBuffer.byteOffset, audioBuffer.byteOffset + audioBuffer.byteLength) as ArrayBuffer;
  } catch (e) {
    console.error('[Volcano TTS] 失败:', e);
    return null;
  }
}

// ==================== 硅基流动 (SiliconFlow) ====================

function getSiliconFlowKey(): string | null {
  return process.env.SILICONFLOW_API_KEY || readEnvFile('SILICONFLOW_API_KEY') || null;
}

const SILICONFLOW_BASE = 'https://api.siliconflow.cn';

async function siliconChat(prompt: string, maxTokens = 1000): Promise<string | null> {
  const key = getSiliconFlowKey();
  if (!key) return null;
  try {
    const data = await fetchJSON(`${SILICONFLOW_BASE}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
      body: JSON.stringify({
        model: 'Qwen/Qwen2.5-7B-Instruct',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.7,
        max_tokens: maxTokens,
      }),
    });
    return data.choices?.[0]?.message?.content?.trim() || null;
  } catch (e) {
    console.error('[SiliconFlow] 对话失败:', e);
    return null;
  }
}

async function siliconTranslate(text: string, toLang: string, fromLang = 'zh'): Promise<string | null> {
  const sourceLabel = fromLang === 'zh' ? '中文' : fromLang;
  const prompt = `请将以下${sourceLabel}翻译成${toLang}，只返回翻译结果：\n\n${text}`;
  return siliconChat(prompt, 2000);
}

// 硅基流动语音识别 (SenseVoice)
async function siliconTranscribe(audioBuffer: ArrayBuffer, fileName = 'audio.wav'): Promise<string | null> {
  const key = getSiliconFlowKey();
  if (!key) return null;
  try {
    const formData = new FormData();
    formData.append('file', new Blob([audioBuffer]), fileName);
    formData.append('model', process.env.SILICONFLOW_AUDIO_MODEL || 'FunAudioLLM/SenseVoiceSmall');
    const res = await fetch(`${SILICONFLOW_BASE}/v1/audio/transcriptions`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${key}` },
      body: formData,
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.substring(0, 200)}`);
    const data = JSON.parse(text);
    return data.text?.trim() || null;
  } catch (e) {
    console.error('[SiliconFlow ASR] 失败:', e);
    return null;
  }
}

// 硅基流动 TTS (CosyVoice2) — 先清洗文本
async function siliconTTS(text: string, voice = 'FunAudioLLM/CosyVoice2-0.5B:alex'): Promise<ArrayBuffer | null> {
  const key = getSiliconFlowKey();
  const cleanText = prepareTextForTTS(text);
  if (!key || !cleanText) return null;
  try {
    const body = JSON.stringify({
      model: 'FunAudioLLM/CosyVoice2-0.5B',
      input: cleanText,
      voice,
      response_format: 'mp3',
      sample_rate: 44100,
    });
    return await fetchBuffer(`${SILICONFLOW_BASE}/v1/audio/speech`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
      body,
    });
  } catch (e) {
    console.error('[SiliconFlow TTS] 失败:', e);
    return null;
  }
}

// 硅基流动文生图
async function siliconGenerateImage(prompt: string, size = '1024x1024'): Promise<string | null> {
  const key = getSiliconFlowKey();
  if (!key) { console.log('[文生图] 硅基 Key 未设置，跳过'); return null; }
  try {
    const data = await fetchJSON(`${SILICONFLOW_BASE}/v1/images/generations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
      body: JSON.stringify({
        model: 'Tongyi-MAI/Z-Image-Turbo',
        prompt,
        image_size: size,
        batch_size: 1,
      }),
    });
    return data.data?.[0]?.url || null;
  } catch (e) {
    console.error('[SiliconFlow 文生图] 失败:', e);
    return null;
  }
}

// ==================== 阿里云百炼 DashScope（通义千问）====================

function getDashScopeKey(): string | null {
  return process.env.DASHSCOPE_API_KEY || readEnvFile('DASHSCOPE_API_KEY') || null;
}

const DASHSCOPE_CHAT_BASE = 'https://dashscope.aliyuncs.com/compatible-mode/v1';

async function dashscopeChat(prompt: string, maxTokens = 2000): Promise<string | null> {
  const key = getDashScopeKey();
  if (!key) return null;
  try {
    const data = await fetchJSON(`${DASHSCOPE_CHAT_BASE}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
      body: JSON.stringify({
        model: 'qwen-plus',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.7,
        max_tokens: maxTokens,
      }),
    });
    return data.choices?.[0]?.message?.content?.trim() || null;
  } catch (e) {
    console.error('[DashScope] 对话失败:', e);
    return null;
  }
}

async function dashscopeTranslate(text: string, toLang: string, fromLang = 'zh'): Promise<string | null> {
  const sourceLabel = fromLang === 'zh' ? '中文' : fromLang;
  const prompt = `请将以下${sourceLabel}翻译成${toLang}，只返回翻译结果，不要带任何解释：\n\n${text}`;
  return dashscopeChat(prompt, 2000);
}

// 百炼通义万相文生视频
async function dashscopeGenerateVideo(prompt: string, _duration = 5, _resolution = '720P', _ratio = '16:9', _model?: string): Promise<{ taskId: string; status: string; videoUrl?: string } | null> {
  const key = getDashScopeKey();
  if (!key) return null;
  const model = _model || 'wan2.7-t2v-2026-04-25'
  const shortModel = model.replace(/^wan2\.7/, 'wan').replace(/^happyhorse/, 'hh')
  console.log(`[百炼创建] model=${shortModel}, duration=${_duration}s, prompt_len=${prompt.length}`)
  try {
    const data = await fetchJSON('https://dashscope.aliyuncs.com/api/v1/services/aigc/video-generation/video-synthesis', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}`, 'X-DashScope-Async': 'enable' },
      body: JSON.stringify({
        model,
        input: { prompt },
        parameters: { resolution: _resolution, ratio: _ratio, duration: _duration },
      }),
    });
    if (data?.output?.task_id) {
      console.log(`[百炼创建] task_id=${data.output.task_id.substring(0, 8)}..., request_id=${data?.request_id?.substring(0, 12) || '-'}`);
      return { taskId: data.output.task_id, status: 'running' };
    }
    // 创建失败——记录百炼返回的完整诊断信息
    const errInfo = JSON.stringify({
      code: data?.code,
      message: data?.message?.substring(0, 300),
      request_id: data?.request_id,
      output: data?.output,
    })
    console.log(`[百炼创建][失败] model=${shortModel}, 响应: ${errInfo}`)
    return null;
  } catch (e) {
    console.error(`[百炼创建][网络异常] model=${shortModel}, 类型=${e?.name || typeof e}, 消息=${e?.message || e}`);
    return null;
  }
}

/** 百炼图生视频（用参考图保证画面连贯） */
async function dashscopeImageToVideo(prompt: string, refImageUrl: string, _duration = 15, _resolution = '720P', _ratio = '16:9'): Promise<{ taskId: string; status: string; videoUrl?: string } | null> {
  const key = getDashScopeKey()
  if (!key) return null
  try {
    const data = await fetchJSON('https://dashscope.aliyuncs.com/api/v1/services/aigc/video-generation/video-synthesis', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}`, 'X-DashScope-Async': 'enable' },
      body: JSON.stringify({
        model: 'wan2.7-t2v-2026-04-25',
        input: { prompt, image_url: refImageUrl },
        parameters: { resolution: _resolution, ratio: _ratio, duration: _duration },
      }),
    })
    if (data?.output?.task_id) return { taskId: data.output.task_id, status: 'running' }
    return null
  } catch (e) {
    console.error('[DashScope 图生视频] 失败:', e)
    return null
  }
}

/** 下载视频文件并返回 ArrayBuffer */
async function downloadVideo(url: string): Promise<ArrayBuffer | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(120000) })
    if (!res.ok) return null
    return await res.arrayBuffer()
  } catch { return null }
}

/** 长视频自动拼接（>15s 拆分为多段，每段用上一段尾帧做参考） */
export async function generateLongVideo(prompt: string, totalDuration: number, _resolution = '720P', _ratio = '16:9'): Promise<{ videoUrl?: string; status: string } | null> {
  const segDuration = 15
  const segments = Math.ceil(totalDuration / segDuration)
  const actualDurations: number[] = []
  // 每段时长：前 N-1 段 15s，最后一段剩余
  for (let i = 0; i < segments; i++) {
    actualDurations.push(Math.min(segDuration, totalDuration - i * segDuration))
  }
  console.log(`[LongVideo] 拆分 ${segments} 段:`, actualDurations)

  const tempDir = join(process.cwd(), 'temp')
  if (!existsSync(tempDir)) await mkdir(tempDir, { recursive: true })

  const videoPaths: string[] = []
  const ffmpegPath = process.env.FFMPEG_PATH || 'ffmpeg'
  const fs = await import('fs/promises')

  for (let i = 0; i < segments; i++) {
    const segPrompt = i === 0 ? prompt : `${prompt}，延续上一段画面风格`
    console.log(`[文生视频] 长视频第 ${i + 1}/${segments} 段开始 (${actualDurations[i]}s)`)

    let taskId = ''
    if (i === 0 || !videoPaths[i - 1]) {
      // 第一段或无上一段视频：文生视频
      const model = 'wan2.7-t2v-2026-04-25'
      const result = await dashscopeGenerateVideo(segPrompt, actualDurations[i], _resolution, _ratio, model)
      if (!result?.taskId) {
        console.log(`[文生视频] 第 ${i + 1} 段创建失败, 终止`)
        return null
      }
      taskId = result.taskId
    } else {
      // 用上一段尾帧做参考 → 图生视频
      const prevVideo = videoPaths[i - 1]
      const lastFramePath = join(tempDir, `lastframe_${Date.now()}_${i}.png`)
      try {
        await execFileAsync(ffmpegPath, ['-i', prevVideo, '-sseof', '-1', '-update', '1', '-q:v', '1', '-y', lastFramePath], { timeout: 15000 })
        const frameSize = existsSync(lastFramePath) ? (await import('fs')).statSync(lastFramePath).size : 0
        if (frameSize < 100) throw new Error(`尾帧文件过小: ${frameSize} bytes`)
        console.log(`[文生视频] 第 ${i + 1}/${segments} 段, 尾帧保存到 ${lastFramePath} (${frameSize} bytes)`)
      } catch (e: any) {
        console.log(`[文生视频] 第 ${i + 1} 段尾帧提取失败: ${e.message}, 终止`)
        return null
      }
      let refUrl = lastFramePath
      if (process.env.OSS_ACCESS_KEY_ID && process.env.OSS_BUCKET) {
        const OSS = (await import('ali-oss')).default
        const client = new OSS({
          region: process.env.OSS_REGION || 'oss-cn-hangzhou',
          accessKeyId: process.env.OSS_ACCESS_KEY_ID!,
          accessKeySecret: process.env.OSS_ACCESS_KEY_SECRET!,
          bucket: process.env.OSS_BUCKET!, secure: true,
        })
        const ossName = `long-video/frame_${Date.now()}_${i}.png`
        await client.put(ossName, lastFramePath, { headers: { 'x-oss-object-acl': 'public-read' } })
        refUrl = `https://${process.env.OSS_BUCKET}.${process.env.OSS_REGION || 'oss-cn-hangzhou'}.aliyuncs.com/${ossName}`
      } else {
        const result = await dashscopeGenerateVideo(segPrompt, actualDurations[i], _resolution, _ratio, 'wan2.7-t2v-2026-04-25')
        if (!result?.taskId) return null
        taskId = result.taskId
        const segResult = await pollVideoTask(taskId)
        if (!segResult?.videoUrl) return null
        const buf = await downloadVideo(segResult.videoUrl)
        if (!buf) return null
        const segPath = join(tempDir, `longseg_${Date.now()}_${i}.mp4`)
        await fs.writeFile(segPath, new Uint8Array(buf))
        videoPaths.push(segPath)
        console.log(`[文生视频] 第 ${i + 1}/${segments} 段完成, 保存到 ${segPath}`)
        continue
      }
      const i2vResult = await dashscopeImageToVideo(segPrompt, refUrl, actualDurations[i], _resolution, _ratio)
      if (!i2vResult?.taskId) {
        console.log(`[文生视频] 第 ${i + 1} 段图生视频创建失败, 终止`)
        return null
      }
      taskId = i2vResult.taskId
      await fs.unlink(lastFramePath).catch(() => {})
    }

    const segResult = await pollVideoTask(taskId)
    if (!segResult?.videoUrl) {
      const failReason = segResult?.status === 'failed' ? '模型端FAILED' : '轮询无结果(超时/网络问题)'
      console.log(`[文生视频] 第 ${i + 1} 段 ${failReason}, task_id=${taskId.substring(0, 8)}..., 终止`)
      return null
    }
    const buf = await downloadVideo(segResult.videoUrl)
    if (!buf) {
      console.log(`[文生视频] 第 ${i + 1} 段下载失败, 终止`)
      return null
    }
    const segPath = join(tempDir, `longseg_${Date.now()}_${i}.mp4`)
    await fs.writeFile(segPath, new Uint8Array(buf))
    videoPaths.push(segPath)
    console.log(`[文生视频] 第 ${i + 1}/${segments} 段生成完成, task_id: ${taskId.substring(0, 8)}..., 保存尾帧到 ${segPath}`)
  }

  // FFmpeg concat 所有段
  if (videoPaths.length === 0) return null
  console.log(`[文生视频] 所有段生成完成, 待拼接: ${videoPaths.join(', ')}`)
  const concatList = videoPaths.map(p => `file '${p.replace(/\\/g, '/')}'`).join('\n')
  const concatListPath = join(tempDir, `long_concat_${Date.now()}.txt`)
  await fs.writeFile(concatListPath, concatList)
  const outputPath = join(tempDir, `long_output_${Date.now()}.mp4`)
  try {
    await execFileAsync(ffmpegPath, ['-f', 'concat', '-safe', '0', '-i', concatListPath, '-c', 'copy', '-y', outputPath], { timeout: 120000 })
  } catch (e) {
    console.error('[文生视频] FFmpeg concat 失败:', e)
    return null
  }
  await fs.unlink(concatListPath).catch(() => {})

  // 检查输出文件大小
  let outputSize = 0
  try { outputSize = (await import('fs')).statSync(outputPath).size } catch {}
  if (outputSize < 1024 * 1024) {
    console.log(`[文生视频] concat 输出文件过小: ${outputSize} bytes, 终止`)
    return null
  }
  console.log(`[文生视频] concat 成功, 输出文件: ${outputPath} (${Math.round(outputSize / 1024 / 1024 * 100) / 100} MB)`)

  // 上传成品到 OSS
  if (process.env.OSS_ACCESS_KEY_ID && process.env.OSS_BUCKET) {
    const OSS = (await import('ali-oss')).default
    const client = new OSS({
      region: process.env.OSS_REGION || 'oss-cn-hangzhou',
      accessKeyId: process.env.OSS_ACCESS_KEY_ID!,
      accessKeySecret: process.env.OSS_ACCESS_KEY_SECRET!,
      bucket: process.env.OSS_BUCKET!,
      secure: true, timeout: '300s',
    })
    const ossName = `long-video/output_${Date.now()}.mp4`
    await client.put(ossName, outputPath, { headers: { 'x-oss-object-acl': 'public-read' } })
    const bucket = process.env.OSS_BUCKET!
    const region = process.env.OSS_REGION || 'oss-cn-hangzhou'
    await fs.unlink(outputPath).catch(() => {})
    for (const p of videoPaths) await fs.unlink(p).catch(() => {})
    return { videoUrl: `https://${bucket}.${region}.aliyuncs.com/${ossName}`, status: 'completed' }
  }
  // 无 OSS 时返回本地临时路径
  return { videoUrl: outputPath, status: 'completed' }
}

/** 轮询视频任务直到完成 */
async function pollVideoTask(taskId: string, maxWait = 300000): Promise<{ videoUrl?: string; status: string } | null> {
  const start = Date.now()
  const maxAttempts = Math.floor(maxWait / 3000)
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise(r => setTimeout(r, 3000))
    const result = await dashscopeQueryVideoTask(taskId)
    const elapsed = Math.round((Date.now() - start) / 1000)
    if (result?.videoUrl) {
      console.log(`[文生视频] 轮询完成 task=${taskId.substring(0, 8)}... status=SUCCEEDED, 耗时=${elapsed}s`)
      return result
    }
    if (result?.status === 'FAILED') {
      console.log(`[文生视频] 轮询失败 task=${taskId.substring(0, 8)}... status=FAILED, 耗时=${elapsed}s, 请检查上方[百炼查询]日志中的详细错误`)
      return { status: 'failed' }
    }
    if (i % 5 === 0 || i === maxAttempts - 1) {
      console.log(`[文生视频] 轮询中 task=${taskId.substring(0, 8)}... status=${result?.status || 'unknown'}, ${i + 1}/${maxAttempts}, 耗时=${elapsed}s`)
    }
  }
  console.log(`[文生视频] 轮询超时 task=${taskId.substring(0, 8)}..., 总等待=${Math.round((Date.now()-start)/1000)}s, 最大尝试=${maxAttempts}次`)
  return null
}

async function dashscopeQueryVideoTask(taskId: string): Promise<{ taskId: string; status: string; videoUrl?: string } | null> {
  const key = getDashScopeKey();
  if (!key) return null;
  const shortId = taskId.substring(0, 8)
  try {
    const data = await fetchJSON(`https://dashscope.aliyuncs.com/api/v1/tasks/${taskId}`, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${key}` },
    });
    const status = data?.output?.task_status || data?.output?.status || 'unknown';
    // 收集百炼返回的完整诊断信息
    const rawOutput = data?.output || {}
    const errCode = rawOutput.code || data?.code
    const errMsg = rawOutput.message || data?.message || rawOutput.error_message || ''
    const taskMetrics = rawOutput.task_metrics || ''
    const progress = rawOutput.task_progress !== undefined ? `${rawOutput.task_progress}%` : '-'

    // 尝试多种可能的 video_url 字段
    const videoUrl = data?.output?.video_url
      || data?.output?.results?.[0]?.url
      || data?.output?.result?.video_url
      || data?.output?.output?.video_url;

    // 详细日志：每次查询都打印关键诊断信息
    console.log(
      '[百炼查询] task=' + shortId + '... status=' + status +
      (errCode ? ' code=' + errCode : '') +
      (errMsg ? ' msg="' + errMsg.substring(0, 200) + '"' : '') +
      ' progress=' + progress +
      (taskMetrics ? ' metrics=' + (typeof taskMetrics === 'object' ? JSON.stringify(taskMetrics).substring(0, 100) : taskMetrics) : '') +
      (videoUrl ? ' hasUrl=true urlLen=' + videoUrl.length : ' hasUrl=false')
    )

    // FAILED 时补充打印更详细的完整响应（用于排查模型端错误）
    if (status === 'FAILED') {
      const responseSummary = JSON.stringify({
        request_id: data?.request_id,
        code: errCode,
        message: errMsg,
        status: rawOutput.task_status,
        progress: rawOutput.task_progress,
      })
      console.log(`[百炼查询][失败详情] task=${shortId}... 响应摘要: ${responseSummary}`)
      // 额外输出 rawOutput 中可能有的所有字段（方便发现新字段）
      const allKeys = Object.keys(rawOutput).join(', ')
      if (allKeys) console.log(`[百炼查询][失败详情] output字段列表: ${allKeys}`)
    }

    // SUCCEEDED 但无 URL 也打印警告
    if (status === 'SUCCEEDED' && !videoUrl) {
      console.log(`[百炼查询][警告] task=${shortId}... SUCCEEDED 但未找到 video_url, 完整output: ${JSON.stringify(rawOutput).substring(0, 500)}`)
    }

    return { taskId, status, videoUrl };
  } catch (e: any) {
    console.error(`[百炼查询][网络异常] task=${shortId}..., 类型=${e?.name || typeof e}, 消息=${e?.message || e}`);
    return null;
  }
}

// ==================== 百炼千寻数字人 ====================

const DH_MODEL = process.env.DASHSCOPE_DIGITALHUMAN_MODEL || 'qwen-avatar'
const DH_BASE = process.env.DASHSCOPE_DIGITALHUMAN_BASE_URL || 'https://dashscope.aliyuncs.com/api/v1'

/** 提交形象克隆任务 */
async function dashscopeCreateDigitalHuman(
  audioFileUrl: string,
  videoFileUrl: string,
  mode: 'fast' | 'pro' = 'fast'
): Promise<{ taskId: string } | null> {
  const key = getDashScopeKey();
  if (!key) return null;
  try {
    const body = JSON.stringify({
      model: DH_MODEL,
      input: {
        audio_file_url: audioFileUrl,
        video_file_url: videoFileUrl,
      },
      parameters: {
        mode,
        // fast: 极速版 ~3分钟, pro: 精品版 ~24小时
        // 上传的文件需先存到 OSS 并传 URL
      },
    });
    console.log('[千寻] 提交形象克隆, mode:', mode);
    const data = await fetchJSON(`${DH_BASE}/services/avatar/training`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}`, 'X-DashScope-Async': 'enable' },
      body,
    });
    const taskId = data?.output?.task_id || data?.task_id;
    if (!taskId) {
      console.error('[千寻] 创建失败, 响应:', JSON.stringify(data).substring(0, 300));
      return null;
    }
    return { taskId };
  } catch (e) {
    console.error('[千寻] 创建形象克隆失败:', e);
    return null;
  }
}

/** 查询训练进度 */
async function dashscopeQueryDigitalHumanTask(taskId: string): Promise<{
  status: string;
  progress: number;
  avatarUrl?: string;
} | null> {
  const key = getDashScopeKey();
  if (!key) return null;
  try {
    const data = await fetchJSON(`${DH_BASE}/tasks/${taskId}`, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${key}` },
    });
    const status = data?.output?.task_status || data?.output?.status || 'unknown';
    const progress = data?.output?.task_progress ?? data?.output?.progress ?? 0;
    const avatarUrl = data?.output?.avatar_id || data?.output?.result?.avatar_id || data?.output?.avatar_url;
    return { status, progress, avatarUrl };
  } catch (e) {
    console.error('[千寻] 查询任务失败:', e);
    return null;
  }
}

/** 用训练好的数字人生成口播视频 */
async function dashscopeGenerateDigitalHumanVideo(
  avatarId: string,
  text: string,
  background?: string
): Promise<{ taskId: string } | null> {
  const key = getDashScopeKey();
  if (!key) return null;
  try {
    const input: Record<string, any> = { avatar_id: avatarId, text };
    const params: Record<string, any> = {};
    if (background) {
      params.background_url = background;
    }
    const data = await fetchJSON(`${DH_BASE}/services/avatar/video/generation`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}`, 'X-DashScope-Async': 'enable' },
      body: JSON.stringify({
        model: DH_MODEL,
        input,
        parameters: params,
      }),
    });
    const taskId = data?.output?.task_id || data?.task_id;
    if (!taskId) return null;
    return { taskId };
  } catch (e) {
    console.error('[千寻] 生成口播视频失败:', e);
    return null;
  }
}

function getDeepSeekKey(): string | null {
  return process.env.DEEPSEEK_API_KEY || readEnvFile('DEEPSEEK_API_KEY') || null;
}

async function deepSeekChat(prompt: string, maxTokens = 1000): Promise<string | null> {
  const key = getDeepSeekKey();
  if (!key) return null;
  try {
    const data = await fetchJSON('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.7,
        max_tokens: maxTokens,
      }),
    });
    return data.choices?.[0]?.message?.content?.trim() || null;
  } catch (e) {
    console.error('[DeepSeek] 对话失败:', e);
    return null;
  }
}

async function deepSeekTranslate(text: string, toLang: string, fromLang = 'zh'): Promise<string | null> {
  const sourceLabel = fromLang === 'zh' ? '中文' : fromLang;
  const prompt = `请将以下${sourceLabel}翻译成${toLang}，只返回翻译结果：\n\n${text}`;
  return deepSeekChat(prompt, 2000);
}

// ==================== 模拟兜底 (Mock) ====================

// 同步从 .env.local 读取环境变量（热重载后 process.env 丢失时的兜底）
function readEnvFile(key: string): string | undefined {
  try {
    const fs = require('fs')
    const path = require('path')
    const content = fs.readFileSync(path.join(process.cwd(), '.env.local'), 'utf-8')
    const match = content.match(new RegExp(`^${key}=(.+)$`, 'm'))
    return match?.[1]
  } catch { return undefined }
}

function mockResult(category: string, input: string): string {
  console.warn(`[Mock] ${category} 返回模拟数据 (未配置 API Key)`);
  if (category === 'translate') return `[Mock Translation of: ${input.substring(0, 50)}]`;
  if (category === 'generateText') return `[Mock AI Response: 已收到您的请求"${input.substring(0, 30)}"，请配置 API Key 获取真实结果]`;
  return '';
}

// ==================== 导出函数 — 双保险模式 ====================

// 1. 文案生成 / 文本生成
export async function generateText(prompt: string): Promise<string | null> {
  // 百炼(通义千问) → 火山(豆包) → 硅基(Qwen) → DeepSeek → Mock
  const result = await dashscopeChat(prompt, 2000)
    || await volcanoChat(prompt, 2000)
    || await siliconChat(prompt, 2000)
    || await deepSeekChat(prompt, 2000);
  if (result) return result;
  return mockResult('generateText', prompt);
}

// 2. 翻译
export async function translate(text: string, toLang: string, fromLang = 'zh'): Promise<string | null> {
  if (!text?.trim()) return null;
  const cleanedText = cleanText(text, fromLang);
  if (!cleanedText) return null;
  // 百炼(通义千问) → 火山(豆包) → 硅基(Qwen) → DeepSeek → Mock
  const result = await dashscopeTranslate(cleanedText, toLang, fromLang)
    || await volcanoTranslate(cleanedText, toLang, fromLang) 
    || await siliconTranslate(cleanedText, toLang, fromLang) 
    || await deepSeekTranslate(cleanedText, toLang, fromLang);
  if (result) return cleanText(result, toLang);
  return mockResult('translate', text);
}

// 3. 语音识别 (ASR)
export async function transcribeAudio(audioBuffer: ArrayBuffer, fileName = 'audio.wav'): Promise<string | null> {
  // 硅基流动(SenseVoice) → Mock（火山方舟 ASR 需额外配置）
  const result = await siliconTranscribe(audioBuffer, fileName);
  if (result) return result;
  console.warn('[ASR] 所有 ASR 服务均不可用');
  return null;
}

// 4. 配音 TTS（火山→硅基，先清洗文本防 Bad control character）
// 语言参数用于路由：zh/en 走火山+硅基；其他语言直接走硅基 CosyVoice2（多语言）
export async function textToSpeech(text: string, speaker = 'zh_female_vv_uranus_bigtts', language = 'zh'): Promise<ArrayBuffer | null> {
  if (!text?.trim()) {
    console.warn('[TTS] 文本为空');
    return null;
  }
  const cleaned = prepareTextForTTS(text);
  if (!cleaned) {
    console.warn('[TTS] 清洗后文本为空, 原文:', text.substring(0, 50));
    return null;
  }

  // 中文/英文：火山 → 百炼(CosyVoice) → 硅基
  if (language === 'zh' || language === 'en') {
    console.log(`[TTS] 尝试火山: speaker=${speaker}, lang=${language}, text_len=${cleaned.length}`);
    const volcanoResult = await volcanoTTS(cleaned, speaker);
    if (volcanoResult && volcanoResult.byteLength > 100) {
      console.log(`[TTS] 火山成功: ${volcanoResult.byteLength} bytes`);
      return volcanoResult;
    }
    console.log(`[TTS] 火山失败, 尝试百炼...`);

    // 百炼 CosyVoice（需要开通百炼 CosyVoice 服务）
    const dashResult = await dashscopeTTS(cleaned);
    if (dashResult && dashResult.byteLength > 100) {
      console.log(`[TTS] 百炼成功: ${dashResult.byteLength} bytes`);
      return dashResult;
    }
    console.log(`[TTS] 百炼失败, 尝试硅基...`);
  } else {
    console.log(`[TTS] 非中/英文(${language}), 跳过火山, 直接走百炼→硅基`);
    const dashResult = await dashscopeTTS(cleaned);
    if (dashResult && dashResult.byteLength > 100) {
      console.log(`[TTS] 百炼成功: ${dashResult.byteLength} bytes`);
      return dashResult;
    }
  }

  // 硅基 CosyVoice2（多语言模型，支持中/英/日/韩/法/德等）
  const siliconResult = await siliconTTS(cleaned, 'FunAudioLLM/CosyVoice2-0.5B:alex');
  if (siliconResult && siliconResult.byteLength > 100) {
    console.log(`[TTS] 硅基成功: ${siliconResult.byteLength} bytes`);
    return siliconResult;
  }
  console.warn('[TTS] 火山+百炼+硅基均失败');
  return null;
}

// 百炼通义万相文生图
async function dashscopeGenerateImage(prompt: string, size = '1280*1280'): Promise<string | null> {
  const key = getDashScopeKey()
  if (!key) { console.log('[文生图] DashScope Key 未设置，跳过'); return null }
  console.log('[文生图] 尝试百炼通义万相 wan2.6-t2i (同步调用)...')
  try {
    // wan2.6 支持 HTTP 同步调用，无需异步+轮询
    const res = await fetch('https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
      body: JSON.stringify({
        model: 'wan2.6-t2i',
        input: {
          messages: [
            {
              role: 'user',
              content: [{ text: prompt }],
            },
          ],
        },
        parameters: {
          size,
          n: 1,
          prompt_extend: true,
          watermark: false,
          negative_prompt: '',
        },
      }),
      signal: AbortSignal.timeout(120000),
    })

    if (!res.ok) {
      const err = await res.text()
      console.log('[文生图] 百炼同步调用失败:', res.status, err.substring(0, 300))
      return null
    }

    const data = await res.json()
    const imageUrl = data?.output?.choices?.[0]?.message?.content?.[0]?.image
    if (!imageUrl) {
      console.log('[文生图] 百炼未返回图片URL:', JSON.stringify(data).substring(0, 300))
      return null
    }
    return imageUrl
  } catch (e) {
    console.error('[DashScope 文生图] 失败:', e)
    return null
  }
}

// ==================== 百炼 CosyVoice TTS ====================

async function dashscopeTTS(text: string, voice = 'longxiaochun'): Promise<ArrayBuffer | null> {
  const key = getDashScopeKey()
  if (!key) return null
  console.log(`[DashScope TTS] 请求: voice=${voice}, text_len=${text.length}`)
  try {
    const res = await fetch('https://dashscope.aliyuncs.com/api/v1/services/tts/generation', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}`, 'X-DashScope-Async': 'enable' },
      body: JSON.stringify({
        model: 'cosyvoice-v1',
        input: { text },
        parameters: { voice, format: 'mp3' },
      }),
      signal: AbortSignal.timeout(30000),
    })
    if (!res.ok) {
      const err = await res.text()
      console.log('[DashScope TTS] 创建任务失败:', res.status, err.substring(0, 200))
      return null
    }
    const data = await res.json()
    const taskId = data?.output?.task_id
    if (!taskId) {
      console.log('[DashScope TTS] 未返回 task_id')
      return null
    }
    // 轮询结果
    for (let i = 0; i < 30; i++) {
      await new Promise(r => setTimeout(r, 2000))
      const pollRes = await fetch(`https://dashscope.aliyuncs.com/api/v1/tasks/${taskId}`, {
        headers: { 'Authorization': `Bearer ${key}` },
        signal: AbortSignal.timeout(10000),
      })
      if (!pollRes.ok) continue
      const pollData = await pollRes.json()
      const status = pollData?.output?.task_status
      if (status === 'SUCCEEDED') {
        const audioUrl = pollData?.output?.results?.[0]?.url
        if (audioUrl) {
          const audioRes = await fetch(audioUrl, { signal: AbortSignal.timeout(30000) })
          return await audioRes.arrayBuffer()
        }
        return null
      }
      if (status === 'FAILED') break
    }
    return null
  } catch (e) {
    console.error('[DashScope TTS] 失败:', e)
    return null
  }
}

// 5. 文生图（返回 {url, model}，model 标明实际使用的模型）
export async function generateImage(prompt: string, size = '1280*1280', provider?: 'auto' | 'dashscope' | 'siliconflow'): Promise<{ url: string; model: string } | null> {
  // provider 参数：auto=自动降级, dashscope=强制百炼, siliconflow=强制硅基
  if (provider === 'dashscope') {
    const url = await dashscopeGenerateImage(prompt, size)
    if (url) return { url, model: '百炼通义万相 wan2.6-t2i' }
    return null
  }
  if (provider === 'siliconflow') {
    const url = await siliconGenerateImage(prompt, size.replace(/\*/g, 'x'))
    if (url) return { url, model: '硅基流动 Tongyi-MAI/Z-Image-Turbo' }
    return null
  }
  // auto: 百炼(wan2.6-t2i) → 硅基流动 → null
  const dashUrl = await dashscopeGenerateImage(prompt, size)
  if (dashUrl) return { url: dashUrl, model: '百炼通义万相 wan2.6-t2i' }

  const siliconUrl = await siliconGenerateImage(prompt, size.replace(/\*/g, 'x'))
  if (siliconUrl) return { url: siliconUrl, model: '硅基流动 Tongyi-MAI/Z-Image-Turbo' }

  console.warn('[文生图] 服务不可用');
  return null
}

// 6. 文生视频 — 降级链：Doubao-Seedance 2.0 → wan2.7-t2v → happyhorse-1.0-t2v → Mock
export async function generateVideo(prompt: string, _duration = 5, _resolution = '720P', _ratio = '16:9'): Promise<{ taskId: string; status: string; videoUrl?: string } | null> {
  // ① 火山 Doubao-Seedance 2.0
  const volcanoKey = getVolcanoKey();
  if (volcanoKey) {
    try {
      console.log(`[火山视频] 创建: model=doubao-seedance-2.0, duration=${_duration}s, resolution=${_resolution}, ratio=${_ratio}, prompt_len=${prompt.length}`);
      const data = await fetchJSON(`${VOLCANO_BASE}/api/v1/video/generation`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${volcanoKey}` },
        body: JSON.stringify({
          model: 'doubao-seedance-2.0',
          input: { prompt },
          parameters: { duration: _duration, resolution: _resolution, aspect_ratio: _ratio },
        }),
      });
      if (data?.output?.task_id) {
        console.log(`[火山视频] 创建成功: task_id=${data.output.task_id.substring(0, 12)}..., task_status=${data.output.task_status || '-'}`);
        return { taskId: data.output.task_id, status: data.output.task_status || 'running' };
      }
      // 检查是否直接返回了视频URL（同步模式）
      if (data?.output?.video_url) {
        console.log(`[火山视频] 同步返回视频: url_len=${data.output.video_url.length}`);
        return { taskId: 'volcano_sync', status: 'completed', videoUrl: data.output.video_url };
      }
      console.log(`[火山视频] 创建失败: 未返回task_id, 完整响应: ${JSON.stringify(data).substring(0, 300)}`);
    } catch (e) {
      console.error(`[火山视频] 创建异常: ${e?.name || typeof e}, ${e?.message || e}`);
    }
  }

  // ② 百炼 wan2.7-t2v
  console.log(`[文生视频] 火山失败, 降级到百炼 wan2.7-t2v`)
  const dash27Result = await dashscopeGenerateVideo(prompt, _duration, _resolution, _ratio, 'wan2.7-t2v-2026-04-25');
  if (dash27Result) return dash27Result;

  // ③ 百炼 happyhorse-1.0-t2v（自动配音兜底）
  console.log(`[文生视频] 百炼wan降级到 happyhorse-1.0-t2v`)
  const dashHhResult = await dashscopeGenerateVideo(prompt, _duration, '720P', _ratio, 'happyhorse-1.0-t2v');
  if (dashHhResult) return dashHhResult;

  console.warn('[文生视频] 所有服务均不可用');
  return { taskId: 'mock', status: 'completed' };
}

// 7. 查询视频任务状态
export async function queryVideoTask(taskId: string): Promise<{ taskId: string; status: string; videoUrl?: string } | null> {
  // 先查百炼
  const dashResult = await dashscopeQueryVideoTask(taskId);
  // 百炼明确成功/失败 → 直接用（只有 RUNNING 不确定来源时，继续查火山）
  if (dashResult && (dashResult.status === 'SUCCEEDED' || dashResult.status === 'FAILED')) {
    return dashResult;
  }

  // 再查火山（无论百炼返回 RUNNING/unknown，都查火山确认）
  const key = getVolcanoKey();
  if (key) {
    try {
      const shortId = taskId.substring(0, 12)
      console.log(`[火山查询] 开始: task=${shortId}...`)
      const data = await fetchJSON(`${VOLCANO_BASE}/api/v1/video/generation/${taskId}`, {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${key}` },
      });
      const status = data?.output?.task_status || 'unknown'
      const videoUrl = data?.output?.video_url || data?.output?.results?.[0]?.url || ''
      const rawOutput = data?.output || {}
      const errCode = rawOutput.code || data?.code
      const errMsg = rawOutput.message || data?.message || ''
      console.log(
        '[火山查询] task=' + shortId + '... status=' + status +
        (errCode ? ' code=' + errCode : '') +
        (errMsg ? ' msg="' + errMsg.substring(0, 200) + '"' : '') +
        (videoUrl ? ' hasUrl=true' : ' hasUrl=false')
      )
      if (status === 'FAILED') {
        console.log(`[火山查询][失败] task=${shortId}..., 响应摘要: ${JSON.stringify({ code: errCode, message: errMsg, request_id: data?.request_id }).substring(0, 500)}`)
      }
      // 火山有明确结果（非unknown）→ 用火山的结果
      if (status !== 'unknown' || videoUrl) {
        return { taskId, status, videoUrl };
      }
    } catch (e) {
      console.error(`[火山查询] 网络异常: ${e?.name || typeof e}, ${e?.message || e}`);
    }
  }

  // 如果火山也查不到明确结果，回退到百炼的状态
  if (dashResult) return dashResult;
  console.log(`[火山查询] 两路都无返回, 兜底`)
  return { taskId, status: 'completed', videoUrl: undefined };
}

// 8. 数字人 — 形象克隆
export async function createDigitalHuman(
  audioFileUrl: string,
  videoFileUrl: string,
  mode: 'fast' | 'pro' = 'fast'
): Promise<{ taskId: string } | null> {
  return dashscopeCreateDigitalHuman(audioFileUrl, videoFileUrl, mode);
}

// 9. 查询数字人训练进度
export async function queryDigitalHumanTask(taskId: string): Promise<{
  status: string;
  progress: number;
  avatarUrl?: string;
} | null> {
  return dashscopeQueryDigitalHumanTask(taskId);
}

// 10. 用数字人生成口播视频（返回挂起视频播放页面的 URL）
export async function generateDigitalHumanVideo(
  avatarId: string,
  text: string,
  background?: string
): Promise<{ taskId: string } | null> {
  return dashscopeGenerateDigitalHumanVideo(avatarId, text, background);
}

// 保留原 digitalHuman 签名兼容（直接生成口播，不经过形象克隆）
export async function digitalHuman(text: string, _avatar = 'default'): Promise<{ videoUrl?: string; status: string } | null> {
  const key = getVolcanoKey();
  if (key) {
    try {
      const data = await fetchJSON(`${VOLCANO_BASE}/api/v1/digital-human/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
        body: JSON.stringify({
          model: 'volcano-digital-human-v1',
          input: { text },
        }),
      });
      if (data?.output?.task_id) return { status: 'running', videoUrl: data.output.video_url };
    } catch (e) {
      console.error('[Volcano 数字人] 失败:', e);
    }
  }
  return { status: 'mock_completed', videoUrl: undefined };
}

export async function isAIConfigured(): Promise<boolean> {
  return !!(process.env.DASHSCOPE_API_KEY || process.env.VOLCANO_API_KEY || process.env.SILICONFLOW_API_KEY);
}
