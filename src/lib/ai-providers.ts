// AI 提供商统一接口 — 双保险模式
// 优先级：火山方舟(Volcano) > 硅基流动(SiliconFlow) > 模拟兜底(Mock)
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

// ==================== 火山方舟 (Volcano Engine) ====================

const VOLCANO_BASE = 'https://ark.cn-beijing.volces.com';
const VOLCANO_CHAT_MODEL = 'ep-20250421092936-4fdt4'; // 豆包 doubao-pro-32k 推理端点

function getVolcanoKey(): string | null {
  return process.env.VOLCANO_API_KEY || null;
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

async function volcanoTranslate(text: string, toLang: string): Promise<string | null> {
  const prompt = `请将以下中文翻译成${toLang}，只返回翻译结果，不要带任何解释：\n\n${text}`;
  return volcanoChat(prompt, 2000);
}

// 火山方舟 TTS（通过 OpenAI 兼容的 TTS 端点）
async function volcanoTTS(text: string, voice = 'zh_female_common'): Promise<ArrayBuffer | null> {
  const key = getVolcanoKey();
  if (!key || !text?.trim()) return null;
  try {
    return await fetchBuffer(`${VOLCANO_BASE}/api/v1/audio/tts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
      body: JSON.stringify({
        model: 'volcano-tts-1',
        input: { text: text.trim() },
        parameters: { voice, format: 'wav', sample_rate: 16000 },
      }),
    });
  } catch (e) {
    console.error('[Volcano TTS] 失败:', e);
    return null;
  }
}

// ==================== 硅基流动 (SiliconFlow) ====================

function getSiliconFlowKey(): string | null {
  return process.env.SILICONFLOW_API_KEY || null;
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
        model: 'Qwen/Qwen2.5-14B-Instruct',
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

async function siliconTranslate(text: string, toLang: string): Promise<string | null> {
  const prompt = `请将以下中文翻译成${toLang}，只返回翻译结果：\n\n${text}`;
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

// 硅基流动 TTS (CosyVoice2)
async function siliconTTS(text: string, voice = 'cosyvoice-v1'): Promise<ArrayBuffer | null> {
  const key = getSiliconFlowKey();
  if (!key || !text?.trim()) return null;
  try {
    return await fetchBuffer(`${SILICONFLOW_BASE}/v1/audio/speech`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
      body: JSON.stringify({
        model: 'FunAudioLLM/CosyVoice2-0.5B',
        input: text.trim(),
        voice,
        response_format: 'wav',
        sample_rate: 16000,
      }),
    });
  } catch (e) {
    console.error('[SiliconFlow TTS] 失败:', e);
    return null;
  }
}

// 硅基流动文生图
async function siliconGenerateImage(prompt: string): Promise<string | null> {
  const key = getSiliconFlowKey();
  if (!key) return null;
  try {
    const data = await fetchJSON(`${SILICONFLOW_BASE}/v1/images/generations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
      body: JSON.stringify({
        model: 'black-forest-labs/FLUX.1-dev',
        prompt,
        image_size: '1024x1024',
        batch_size: 1,
      }),
    });
    return data.data?.[0]?.url || null;
  } catch (e) {
    console.error('[SiliconFlow 文生图] 失败:', e);
    return null;
  }
}

// ==================== 模拟兜底 (Mock) ====================

function mockResult(category: string, input: string): string {
  console.warn(`[Mock] ${category} 返回模拟数据 (未配置 API Key)`);
  if (category === 'translate') return `[Mock Translation of: ${input.substring(0, 50)}]`;
  if (category === 'generateText') return `[Mock AI Response: 已收到您的请求"${input.substring(0, 30)}"，请配置 API Key 获取真实结果]`;
  return '';
}

// ==================== 导出函数 — 双保险模式 ====================

// 1. 文案生成 / 文本生成
export async function generateText(prompt: string): Promise<string | null> {
  // 火山(豆包) → 硅基(Qwen) → Mock
  const result = await volcanoChat(prompt, 2000) || await siliconChat(prompt, 2000);
  if (result) return result;
  return mockResult('generateText', prompt);
}

// 2. 翻译
export async function translate(text: string, toLang: string): Promise<string | null> {
  if (!text?.trim()) return null;
  // 火山(豆包) → 硅基(Qwen) → Mock
  const result = await volcanoTranslate(text, toLang) || await siliconTranslate(text, toLang);
  if (result) return result;
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

// 4. 配音 TTS
export async function textToSpeech(text: string, voice = 'zh_female_common'): Promise<ArrayBuffer | null> {
  if (!text?.trim()) return null;
  // 火山 TTS → 硅基 CosyVoice2 → Mock
  const result = await volcanoTTS(text, voice) || await siliconTTS(text, voice.replace('zh_female_common', 'cosyvoice-v1'));
  if (result && result.byteLength > 100) return result;
  console.warn('[TTS] 所有 TTS 服务均不可用');
  return null;
}

// 5. 文生图
export async function generateImage(prompt: string): Promise<string | null> {
  // 硅基流动(SD/FLUX) → Mock
  const result = await siliconGenerateImage(prompt);
  if (result) return result;
  console.warn('[文生图] 服务不可用');
  return '[Mock Image URL]';
}

// 6. 文生视频
export async function generateVideo(prompt: string, _aspectRatio = '16:9'): Promise<{ taskId: string; status: string; videoUrl?: string } | null> {
  // 火山方舟视频生成 → Mock
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

// 8. 数字人
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
  return !!(process.env.VOLCANO_API_KEY || process.env.SILICONFLOW_API_KEY);
}
