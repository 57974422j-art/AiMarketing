// AI 提供商统一接口管理

import { getAIConfig, isAIConfigured } from './ai-config';

interface GenerateTextOptions {
  temperature?: number;
  maxTokens?: number;
}

// 通用 AI 提供商接口
interface AIProvider {
  generateText(prompt: string, options?: GenerateTextOptions): Promise<string>;
}

// OpenAI 提供商实现
class OpenAIProvider implements AIProvider {
  private config: ReturnType<typeof getAIConfig>;

  constructor() {
    this.config = getAIConfig();
  }

  async generateText(prompt: string, options?: GenerateTextOptions): Promise<string> {
    const url = (this.config.baseUrl || 'https://api.openai.com') + '/v1/chat/completions';
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.config.apiKey}`
      },
      body: JSON.stringify({
        model: this.config.model,
        messages: [{ role: 'user', content: prompt }],
        temperature: options?.temperature || 0.7,
        max_tokens: options?.maxTokens || 1000
      })
    });

    // 先读取响应文本，避免 body 被重复读取
    const responseText = await response.text();

    if (!response.ok) {
      try {
        const error = JSON.parse(responseText);
        throw new Error(`OpenAI API error: ${error.error?.message || 'Unknown error'}`);
      } catch (e) {
        throw new Error(`OpenAI API error: ${responseText}`);
      }
    }

    const data = JSON.parse(responseText);
    return data.choices[0].message.content.trim();
  }
}

// DeepSeek 提供商实现（兼容 OpenAI 接口）
class DeepSeekProvider implements AIProvider {
  private config: ReturnType<typeof getAIConfig>;

  constructor() {
    this.config = getAIConfig();
  }

  async generateText(prompt: string, options?: GenerateTextOptions): Promise<string> {
    const url = (this.config.baseUrl || 'https://api.deepseek.com') + '/v1/chat/completions';
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.config.apiKey}`
      },
      body: JSON.stringify({
        model: this.config.model || 'deepseek-chat',
        messages: [{ role: 'user', content: prompt }],
        temperature: options?.temperature || 0.7,
        max_tokens: options?.maxTokens || 1000
      })
    });

    // 先读取响应文本，避免 body 被重复读取
    const responseText = await response.text();
    console.log('DeepSeek 原始响应:', responseText);
    console.log('HTTP 状态:', response.status);

    if (!response.ok) {
      throw new Error(`DeepSeek API error ${response.status}: ${responseText}`);
    }

    const data = JSON.parse(responseText);
    return data.choices[0].message.content.trim();
  }
}

// 通义千问提供商实现
class QwenProvider implements AIProvider {
  private config: ReturnType<typeof getAIConfig>;

  constructor() {
    this.config = getAIConfig();
  }

  async generateText(prompt: string, options?: GenerateTextOptions): Promise<string> {
    const url = this.config.baseUrl || 'https://dashscope.aliyuncs.com/api/v1/services/aigc/text-generation/generation';
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.config.apiKey}`
      },
      body: JSON.stringify({
        model: this.config.model || 'qwen-plus',
        input: {
          prompt
        },
        parameters: {
          temperature: options?.temperature || 0.7,
          max_tokens: options?.maxTokens || 1000
        }
      })
    });

    // 先读取响应文本，避免 body 被重复读取
    const responseText = await response.text();

    if (!response.ok) {
      try {
        const error = JSON.parse(responseText);
        throw new Error(`Qwen API error: ${error.message || 'Unknown error'}`);
      } catch (e) {
        throw new Error(`Qwen API error: ${responseText}`);
      }
    }

    const data = JSON.parse(responseText);
    return data.output.text.trim();
  }
}

// 智谱 GLM 提供商实现
class GLMProvider implements AIProvider {
  private config: ReturnType<typeof getAIConfig>;

  constructor() {
    this.config = getAIConfig();
  }

  async generateText(prompt: string, options?: GenerateTextOptions): Promise<string> {
    const url = (this.config.baseUrl || 'https://open.bigmodel.cn') + '/api/messages';
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.config.apiKey}`
      },
      body: JSON.stringify({
        model: this.config.model || 'glm-4',
        messages: [{ role: 'user', content: prompt }],
        temperature: options?.temperature || 0.7,
        max_tokens: options?.maxTokens || 1000
      })
    });

    // 先读取响应文本，避免 body 被重复读取
    const responseText = await response.text();

    if (!response.ok) {
      try {
        const error = JSON.parse(responseText);
        throw new Error(`GLM API error: ${error.error?.message || 'Unknown error'}`);
      } catch (e) {
        throw new Error(`GLM API error: ${responseText}`);
      }
    }

    const data = JSON.parse(responseText);
    return data.choices[0].message.content.trim();
  }
}

// Ollama 本地模型提供商实现
class OllamaProvider implements AIProvider {
  private config: ReturnType<typeof getAIConfig>;

  constructor() {
    this.config = getAIConfig();
  }

  async generateText(prompt: string, options?: GenerateTextOptions): Promise<string> {
    const url = this.config.baseUrl || 'http://localhost:11434/api/generate';
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: this.config.model || 'llama3',
        prompt,
        options: {
          temperature: options?.temperature || 0.7
        }
      })
    });

    if (!response.ok) {
      throw new Error(`Ollama API error: ${response.statusText}`);
    }

    const data = await response.json();
    return data.response.trim();
  }
}

// 阿里云百炼 DashScope 提供商实现（兼容 OpenAI 接口）
class DashScopeProvider implements AIProvider {
  private apiKey: string;

  constructor(apiKey?: string) {
    this.apiKey = apiKey || process.env.DASHSCOPE_API_KEY || '';
  }

  async generateText(prompt: string, options?: GenerateTextOptions): Promise<string> {
    const url = 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions';
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`
      },
      body: JSON.stringify({
        model: 'qwen-plus',
        messages: [{ role: 'user', content: prompt }],
        temperature: options?.temperature || 0.7,
        max_tokens: options?.maxTokens || 2000
      })
    });

    const responseText = await response.text();

    if (!response.ok) {
      throw new Error(`DashScope API error ${response.status}: ${responseText}`);
    }

    const data = JSON.parse(responseText);
    return data.choices[0].message.content.trim();
  }
}

// 阿里云百炼翻译 API
export async function dashscopeTranslate(text: string, fromLang: string = 'zh', toLang: string): Promise<string | null> {
  const apiKey = process.env.DASHSCOPE_API_KEY;
  if (!apiKey) {
    return null; // 静默降级
  }

  const langMap: Record<string, string> = {
    'zh': 'zh',
    'en': 'en',
    'ja': 'ja',
    'ko': 'ko',
    'fr': 'fr',
    'de': 'de',
    'es': 'es',
    'pt': 'pt',
    'ru': 'ru',
    'ar': 'ar'
  }

  const sourceLang = langMap[fromLang] || 'zh';
  const targetLang = langMap[toLang] || toLang;

  const response = await fetch('https://dashscope.aliyuncs.com/api/v1/services/aigc/translation/translation', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: 'gpt-4',
      input: {
        source_lang: sourceLang,
        target_lang: targetLang,
        source_text: text
      }
    })
  });

  const responseText = await response.text();

  if (!response.ok) {
    throw new Error(`DashScope Translation API error ${response.status}: ${responseText}`);
  }

  const data = JSON.parse(responseText);
  return data.output.result;
}

// 阿里云百炼文生视频 API
export async function dashscopeGenerateVideo(prompt: string, aspectRatio: string = '16:9'): Promise<VideoGenerationResult | null> {
  const apiKey = process.env.DASHSCOPE_API_KEY;
  if (!apiKey) {
    return null; // 静默降级
  }

  // 比例映射
  const ratioMap: Record<string, string> = {
    '16:9': '16:9',
    '9:16': '9:16',
    '1:1': '1:1'
  }

  const response = await fetch('https://dashscope.aliyuncs.com/api/v1/services/aigc/video-generation/video-synthesis', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: 'wanx2.1-t2v-plus',
      input: {
        prompt: prompt
      },
      parameters: {
        aspect_ratio: ratioMap[aspectRatio] || '16:9'
      }
    })
  });

  const responseText = await response.text();

  if (!response.ok) {
    throw new Error(`DashScope Video API error ${response.status}: ${responseText}`);
  }

  const data = JSON.parse(responseText);
  return {
    taskId: data.output.task_id,
    status: data.output.task_status
  };
}

// 查询视频生成任务状态
export async function dashscopeQueryVideoTask(taskId: string): Promise<VideoGenerationResult | null> {
  const apiKey = process.env.DASHSCOPE_API_KEY;
  if (!apiKey) {
    return null; // 静默降级
  }

  const response = await fetch(`https://dashscope.aliyuncs.com/api/v1/services/aigc/video-generation/video-synthesis/query`, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${apiKey}`
    }
  });

  const responseText = await response.text();

  if (!response.ok) {
    throw new Error(`DashScope Video Query API error ${response.status}: ${responseText}`);
  }

  const data = JSON.parse(responseText);
  return {
    taskId: data.output.task_id,
    status: data.output.task_status,
    videoUrl: data.output.video_url
  };
}

// 阿里云百炼语音合成 TTS API
export async function dashscopeTTS(text: string, voice: string = 'aixia'): Promise<ArrayBuffer | null> {
  const apiKey = process.env.DASHSCOPE_API_KEY;
  if (!apiKey) {
    return null; // 静默降级
  }

  const response = await fetch('https://dashscope.aliyuncs.com/api/v1/services/aigc/tts/cosyvoice', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: 'cosyvoice-v1',
      input: {
        text: text
      },
      parameters: {
        voice: voice
      }
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`DashScope TTS API error ${response.status}: ${errorText}`);
  }

  return response.arrayBuffer();
}

// 提供商工厂
function createAIProvider(providerName?: string): AIProvider {
  const config = getAIConfig();
  const provider = providerName || config.provider;
  
  switch (provider) {
    case 'openai':
      return new OpenAIProvider();
    case 'deepseek':
      return new DeepSeekProvider();
    case 'qwen':
      return new QwenProvider();
    case 'dashscope':
      return new DashScopeProvider();
    case 'glm':
      return new GLMProvider();
    case 'ollama':
      return new OllamaProvider();
    default:
      throw new Error(`Unsupported AI provider: ${provider}`);
  }
}

// 统一调用函数
export async function generateText(prompt: string, options?: GenerateTextOptions, providerName?: string): Promise<string | null> {
  const provider = providerName || getAIConfig().provider;
  
  if (!isAIConfigured() && !providerName) {
    return null; // 静默降级
  }

  const providerInstance = createAIProvider(providerName);
  return providerInstance.generateText(prompt, options);
}

export { isAIConfigured };