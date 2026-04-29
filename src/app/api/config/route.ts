import { NextRequest, NextResponse } from 'next/server';
import { writeFileSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { spawn } from 'child_process';

// 获取 .env.local 文件路径
const getEnvPath = () => join(process.cwd(), '.env.local');

// 解析 .env 文件
function parseEnv(content: string): Record<string, string> {
  const env: Record<string, string> = {};
  const lines = content.split('\n');
  for (const line of lines) {
    if (line.startsWith('#') || !line.includes('=')) continue;
    const [key, ...valueParts] = line.split('=');
    env[key.trim()] = valueParts.join('=').trim();
  }
  return env;
}

// 序列化 .env 对象
function stringifyEnv(env: Record<string, string>): string {
  return Object.entries(env)
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
}

export async function POST(request: NextRequest) {
  try {
    const data = await request.json();
    const { providers, defaultProvider, knowledgeBase } = data;

    // 读取现有 .env 文件
    const envPath = getEnvPath();
    let envContent = existsSync(envPath) ? readFileSync(envPath, 'utf-8') : '';
    const env = parseEnv(envContent);

    // 更新环境变量
    if (providers && providers.length > 0) {
      const defaultIndex = parseInt(defaultProvider) || 0;
      const selectedProvider = providers[defaultIndex];
      
      if (selectedProvider) {
        env.AI_PROVIDER = selectedProvider.provider;
        env.AI_API_KEY = selectedProvider.apiKey;
        env.AI_BASE_URL = selectedProvider.baseUrl || '';
        env.AI_MODEL = selectedProvider.model || '';
      }
    }

    // 保存知识库到环境变量（Base64 编码）
    if (knowledgeBase) {
      env.KNOWLEDGE_BASE = Buffer.from(JSON.stringify(knowledgeBase)).toString('base64');
    }

    // 保存所有提供商配置
    if (providers) {
      env.AI_PROVIDERS = Buffer.from(JSON.stringify(providers)).toString('base64');
    }

    // 写入 .env.local 文件
    writeFileSync(envPath, stringifyEnv(env));

    // 触发服务重启（通过 touch package.json 触发 nodemon 重启）
    try {
      const packageJsonPath = join(process.cwd(), 'package.json');
      if (existsSync(packageJsonPath)) {
        // 使用 touch 命令触发重启（Linux/macOS）或 PowerShell（Windows）
        if (process.platform === 'win32') {
          spawn('powershell', ['-Command', `(Get-Item "${packageJsonPath}").LastWriteTime = Get-Date`]);
        } else {
          spawn('touch', [packageJsonPath]);
        }
      }
    } catch (restartError) {
      console.warn('Failed to trigger server restart:', restartError);
    }

    return NextResponse.json({
      success: true,
      message: '配置已保存，服务正在重启...'
    });
  } catch (error) {
    console.error('保存配置错误:', error);
    return NextResponse.json(
      {
        success: false,
        message: error instanceof Error ? error.message : '保存配置时发生错误'
      },
      { status: 500 }
    );
  }
}

export async function GET() {
  try {
    const envPath = getEnvPath();
    if (!existsSync(envPath)) {
      return NextResponse.json({
        success: true,
        data: {
          providers: [],
          defaultProvider: '',
          knowledgeBase: { content: '', updatedAt: '' }
        }
      });
    }

    const envContent = readFileSync(envPath, 'utf-8');
    const env = parseEnv(envContent);

    // 解析配置
    let providers = [];
    let knowledgeBase = { content: '', updatedAt: '' };

    if (env.AI_PROVIDERS) {
      try {
        providers = JSON.parse(Buffer.from(env.AI_PROVIDERS, 'base64').toString('utf-8'));
      } catch {
        providers = [];
      }
    }

    if (env.KNOWLEDGE_BASE) {
      try {
        knowledgeBase = JSON.parse(Buffer.from(env.KNOWLEDGE_BASE, 'base64').toString('utf-8'));
      } catch {
        knowledgeBase = { content: '', updatedAt: '' };
      }
    }

    // 查找默认提供商索引
    let defaultProvider = '';
    if (providers.length > 0 && env.AI_PROVIDER) {
      const index = providers.findIndex((p: { provider: string; apiKey: string }) => p.provider === env.AI_PROVIDER && p.apiKey === env.AI_API_KEY);
      if (index >= 0) {
        defaultProvider = index.toString();
      }
    }

    return NextResponse.json({
      success: true,
      data: {
        providers,
        defaultProvider,
        knowledgeBase,
        hasConfig: env.AI_API_KEY && env.AI_API_KEY !== ''
      }
    });
  } catch (error) {
    console.error('获取配置错误:', error);
    return NextResponse.json(
      {
        success: false,
        message: error instanceof Error ? error.message : '获取配置时发生错误'
      },
      { status: 500 }
    );
  }
}