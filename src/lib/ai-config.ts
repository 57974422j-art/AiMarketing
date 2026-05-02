// AI 配置管理

interface AIConfig {
  provider: string;
  apiKey: string;
  baseUrl: string;
  model: string;
}

export function getAIConfig(): AIConfig {
  return {
    provider: process.env.AI_PROVIDER || 'openai',
    apiKey: process.env.AI_API_KEY || '',
    // 移除末尾的 /v1，避免路径重复
    baseUrl: (process.env.AI_BASE_URL || '').replace(/\/$/, ''),
    model: process.env.AI_MODEL || 'gpt-3.5-turbo'
  };
}

export function isAIConfigured(): boolean {
  const config = getAIConfig();
  return config.apiKey !== '';
}