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
    const url = this.config.baseUrl || 'https://api.openai.com/v1/chat/completions';
    
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

    if (!response.ok) {
      const error = await response.json();
      throw new Error(`OpenAI API error: ${error.error?.message || 'Unknown error'}`);
    }

    const data = await response.json();
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
    const url = this.config.baseUrl || 'https://api.deepseek.com/v1/chat/completions';
    
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

    if (!response.ok) {
      const error = await response.json();
      throw new Error(`DeepSeek API error: ${error.error?.message || 'Unknown error'}`);
    }

    const data = await response.json();
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

    if (!response.ok) {
      const error = await response.json();
      throw new Error(`Qwen API error: ${error.message || 'Unknown error'}`);
    }

    const data = await response.json();
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
    const url = this.config.baseUrl || 'https://open.bigmodel.cn/api/messages';
    
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

    if (!response.ok) {
      const error = await response.json();
      throw new Error(`GLM API error: ${error.error?.message || 'Unknown error'}`);
    }

    const data = await response.json();
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

// 提供商工厂
function createAIProvider(): AIProvider {
  const config = getAIConfig();
  
  switch (config.provider) {
    case 'openai':
      return new OpenAIProvider();
    case 'deepseek':
      return new DeepSeekProvider();
    case 'qwen':
      return new QwenProvider();
    case 'glm':
      return new GLMProvider();
    case 'ollama':
      return new OllamaProvider();
    default:
      throw new Error(`Unsupported AI provider: ${config.provider}`);
  }
}

// 统一调用函数
export async function generateText(prompt: string, options?: GenerateTextOptions): Promise<string> {
  if (!isAIConfigured()) {
    throw new Error('AI provider not configured. Please set AI_PROVIDER and AI_API_KEY in .env.local');
  }

  const provider = createAIProvider();
  return provider.generateText(prompt, options);
}

export { isAIConfigured };