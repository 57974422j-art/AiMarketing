import { NextRequest, NextResponse } from 'next/server';
import { writeFile, readFile } from 'fs/promises';
import { join } from 'path';

// 保存配置到 .env.local
export async function POST(request: NextRequest) {
  try {
    const { deepseekKey, volcanoKey, siliconflowKey, ttsAppId, ttsAccessKey, ttsResourceId, ossRegion, ossAccessKeyId, ossAccessKeySecret, ossBucket } = await request.json();

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

    // 更新或添加 火山方舟 API Key
    if (volcanoKey !== undefined) {
      const volcanoPattern = /^VOLCANO_API_KEY=.*$/m;
      if (volcanoPattern.test(envContent)) {
        envContent = envContent.replace(volcanoPattern, `VOLCANO_API_KEY=${volcanoKey}`);
      } else {
        envContent += `\nVOLCANO_API_KEY=${volcanoKey}`;
      }
    }

    // 更新或添加 SiliconFlow API Key
    if (siliconflowKey !== undefined) {
      const siliconflowPattern = /^SILICONFLOW_API_KEY=.*$/m;
      if (siliconflowPattern.test(envContent)) {
        envContent = envContent.replace(siliconflowPattern, `SILICONFLOW_API_KEY=${siliconflowKey}`);
      } else {
        envContent += `\nSILICONFLOW_API_KEY=${siliconflowKey}`;
      }
    }

    // 更新或添加 OSS Region
    if (ossRegion !== undefined) {
      const regionPattern = /^OSS_REGION=.*$/m;
      if (regionPattern.test(envContent)) {
        envContent = envContent.replace(regionPattern, `OSS_REGION=${ossRegion}`);
      } else {
        envContent += `\nOSS_REGION=${ossRegion}`;
      }
    }

    // 更新或添加 OSS AccessKey ID
    if (ossAccessKeyId !== undefined) {
      const akPattern = /^OSS_ACCESS_KEY_ID=.*$/m;
      if (akPattern.test(envContent)) {
        envContent = envContent.replace(akPattern, `OSS_ACCESS_KEY_ID=${ossAccessKeyId}`);
      } else {
        envContent += `\nOSS_ACCESS_KEY_ID=${ossAccessKeyId}`;
      }
    }

    // 更新或添加 OSS AccessKey Secret
    if (ossAccessKeySecret !== undefined) {
      const skPattern = /^OSS_ACCESS_KEY_SECRET=.*$/m;
      if (skPattern.test(envContent)) {
        envContent = envContent.replace(skPattern, `OSS_ACCESS_KEY_SECRET=${ossAccessKeySecret}`);
      } else {
        envContent += `\nOSS_ACCESS_KEY_SECRET=${ossAccessKeySecret}`;
      }
    }

    // 更新或添加 OSS Bucket
    if (ossBucket !== undefined) {
      const bucketPattern = /^OSS_BUCKET=.*$/m;
      if (bucketPattern.test(envContent)) {
        envContent = envContent.replace(bucketPattern, `OSS_BUCKET=${ossBucket}`);
      } else {
        envContent += `\nOSS_BUCKET=${ossBucket}`;
      }
    }

    // 更新或添加 TTS App ID
    if (ttsAppId !== undefined) {
      const pattern = /^VOLCANO_TTS_APP_ID=.*$/m;
      if (pattern.test(envContent)) {
        envContent = envContent.replace(pattern, `VOLCANO_TTS_APP_ID=${ttsAppId}`);
      } else {
        envContent += `\nVOLCANO_TTS_APP_ID=${ttsAppId}`;
      }
    }

    // 更新或添加 TTS Access Key
    if (ttsAccessKey !== undefined) {
      const pattern = /^VOLCANO_TTS_ACCESS_KEY=.*$/m;
      if (pattern.test(envContent)) {
        envContent = envContent.replace(pattern, `VOLCANO_TTS_ACCESS_KEY=${ttsAccessKey}`);
      } else {
        envContent += `\nVOLCANO_TTS_ACCESS_KEY=${ttsAccessKey}`;
      }
    }

    // 更新或添加 TTS Resource ID
    if (ttsResourceId !== undefined) {
      const pattern = /^VOLCANO_TTS_RESOURCE_ID=.*$/m;
      if (pattern.test(envContent)) {
        envContent = envContent.replace(pattern, `VOLCANO_TTS_RESOURCE_ID=${ttsResourceId}`);
      } else {
        envContent += `\nVOLCANO_TTS_RESOURCE_ID=${ttsResourceId}`;
      }
    }

    // 写入文件
    await writeFile(envPath, envContent, 'utf-8');

    console.log('[Admin-Config] 配置已保存到 .env.local');

    return NextResponse.json({
      success: true,
      message: '配置保存成功，重启服务后生效'
    });

  } catch (error) {
    console.error('[Admin-Config] 保存失败:', error);
    return NextResponse.json({
      success: false,
      message: error instanceof Error ? error.message : '保存失败'
    }, { status: 500 });
  }
}

// 获取当前配置状态（不返回实际 Key，只返回是否已配置）
export async function GET() {
  try {
    const deepseekKey = process.env.DEEPSEEK_API_KEY;
    const volcanoKey = process.env.VOLCANO_API_KEY;
    const siliconflowKey = process.env.SILICONFLOW_API_KEY;
    const ossRegion = process.env.OSS_REGION;
    const ossBucket = process.env.OSS_BUCKET;
    const ttsAppId = process.env.VOLCANO_TTS_APP_ID;
    const ttsAccessKey = process.env.VOLCANO_TTS_ACCESS_KEY;
    const ttsResourceId = process.env.VOLCANO_TTS_RESOURCE_ID;

    // 检查 OSS 是否完整配置
    const ossConfigured = !!(ossRegion && process.env.OSS_ACCESS_KEY_ID && process.env.OSS_ACCESS_KEY_SECRET && ossBucket);

    return NextResponse.json({
      success: true,
      data: {
        deepseekConfigured: !!deepseekKey,
        volcanoConfigured: !!volcanoKey,
        siliconflowConfigured: !!siliconflowKey,
        ttsAppIdConfigured: !!ttsAppId,
        ttsAccessKeyConfigured: !!ttsAccessKey,
        ttsResourceIdConfigured: !!ttsResourceId,
        ossConfigured,
        ossRegion: ossRegion || '',
        ossBucket: ossBucket || ''
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
