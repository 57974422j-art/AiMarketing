// AI 提供商统一接口 — 多级降级模式
// 优先级：百炼DashScope(通义千问) > 火山方舟(Volcano) > 硅基流动(SiliconFlow) > DeepSeek > 模拟兜底(Mock)
// 每个函数内部 try-catch，失败自动切换到下一个

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
async function dashscopeGenerateVideo(prompt: string, _aspectRatio = '16:9'): Promise<{ taskId: string; status: string; videoUrl?: string } | null> {
  const key = getDashScopeKey();
  if (!key) return null;
  try {
    const ratio = _aspectRatio === '16:9' ? '1280:720' : '720:1280';
    const data = await fetchJSON('https://dashscope.aliyuncs.com/api/v1/services/aigc/video-generation/video-synthesis', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
      body: JSON.stringify({
        model: 'wan2.1-t2v-turbo',
        input: { prompt },
        parameters: { size: ratio, duration: 5 },
      }),
    });
    if (data?.output?.task_id) return { taskId: data.output.task_id, status: 'running' };
    return null;
  } catch (e) {
    console.error('[DashScope 文生视频] 失败:', e);
    return null;
  }
}

async function dashscopeQueryVideoTask(taskId: string): Promise<{ taskId: string; status: string; videoUrl?: string } | null> {
  const key = getDashScopeKey();
  if (!key) return null;
  try {
    const data = await fetchJSON(`https://dashscope.aliyuncs.com/api/v1/services/aigc/video-generation/video-synthesis/${taskId}`, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${key}` },
    });
    const status = data?.output?.task_status || 'unknown';
    return { taskId, status, videoUrl: data?.output?.video_url };
  } catch (e) {
    console.error('[DashScope 查询视频] 失败:', e);
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

// 6. 文生视频
export async function generateVideo(prompt: string, _aspectRatio = '16:9'): Promise<{ taskId: string; status: string; videoUrl?: string } | null> {
  // 百炼(通义万相) → 火山方舟 → Mock
  const dashResult = await dashscopeGenerateVideo(prompt, _aspectRatio);
  if (dashResult) return dashResult;
  
  const key = getVolcanoKey();
  if (key) {
    try {
      const data = await fetchJSON(`${VOLCANO_BASE}/api/v1/video/generation`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
        body: JSON.stringify({
          model: 'volcano-video-v1',
          input: { prompt },
          parameters: { duration: 5, aspect_ratio: _aspectRatio },
        }),
      });
      if (data?.output?.task_id) return { taskId: data.output.task_id, status: data.output.task_status || 'running' };
    } catch (e) {
      console.error('[Volcano 文生视频] 失败:', e);
    }
  }
  console.warn('[文生视频] 服务不可用');
  return { taskId: 'mock', status: 'completed' };
}

// 7. 查询视频任务状态
export async function queryVideoTask(taskId: string): Promise<{ taskId: string; status: string; videoUrl?: string } | null> {
  // 百炼(通义万相) → 火山方舟
  const dashResult = await dashscopeQueryVideoTask(taskId);
  if (dashResult) return dashResult;
  
  const key = getVolcanoKey();
  if (key) {
    try {
      const data = await fetchJSON(`${VOLCANO_BASE}/api/v1/video/generation/${taskId}`, {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${key}` },
      });
      return { taskId, status: data?.output?.task_status || 'unknown', videoUrl: data?.output?.video_url };
    } catch (e) {
      console.error('[Volcano 查询视频] 失败:', e);
    }
  }
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
