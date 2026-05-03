import { NextRequest, NextResponse } from 'next/server';
import { writeFile, readFile } from 'fs/promises';
import { join } from 'path';

// 保存 API Key 到 .env.local
export async function POST(request: NextRequest) {
  try {
    const { deepseekKey, dashscopeKey } = await request.json();

    console.log('[Admin-Config] 收到保存请求');

    // 读取现有 .env.local
    const envPath = join(process.cwd(), '.env.local');
    let envContent = '';

    try {
      envContent = await readFile(envPath, 'utf-8');
    } catch (error) {
      console.log('[Admin-Config] .env.local 不存在，将创建新文件');
    }

    // 更新或添加 DeepSeek API Key
    if (deepseekKey !== undefined) {
      const deepseekPattern = /^DEEPSEEK_API_KEY=.*$/m;
      if (deepseekPattern.test(envContent)) {
        envContent = envContent.replace(deepseekPattern, `DEEPSEEK_API_KEY=${deepseekKey}`);
      } else {
        envContent += `\nDEEPSEEK_API_KEY=${deepseekKey}`;
      }
    }

    // 更新或添加 DashScope API Key
    if (dashscopeKey !== undefined) {
      const dashscopePattern = /^DASHSCOPE_API_KEY=.*$/m;
      if (dashscopePattern.test(envContent)) {
        envContent = envContent.replace(dashscopePattern, `DASHSCOPE_API_KEY=${dashscopeKey}`);
      } else {
        envContent += `\nDASHSCOPE_API_KEY=${dashscopeKey}`;
      }
    }

    // 写入文件
    await writeFile(envPath, envContent, 'utf-8');

    console.log('[Admin-Config] API Key 已保存到 .env.local');

    return NextResponse.json({
      success: true,
      message: 'API Key 保存成功，重启服务后生效'
    });

  } catch (error) {
    console.error('[Admin-Config] 保存失败:', error);
    return NextResponse.json({
      success: false,
      message: error instanceof Error ? error.message : '保存失败'
    }, { status: 500 });
  }
}

// 获取当前 API Key 配置状态（不返回实际 Key，只返回是否已配置）
export async function GET() {
  try {
    const deepseekKey = process.env.DEEPSEEK_API_KEY;
    const dashscopeKey = process.env.DASHSCOPE_API_KEY;

    return NextResponse.json({
      success: true,
      data: {
        deepseekConfigured: !!deepseekKey,
        dashscopeConfigured: !!dashscopeKey
      }
    });
  } catch (error) {
    console.error('[Admin-Config] 获取配置失败:', error);
    return NextResponse.json({
      success: false,
      message: error instanceof Error ? error.message : '获取配置失败'
    }, { status: 500 });
  }
}
