import { NextRequest, NextResponse } from 'next/server';
import { writeFile, readFile } from 'fs/promises';
import { join } from 'path';
import { getAuthFromHeaders } from '@/lib/api-auth';

// 保存配置到 .env.local
export async function POST(request: NextRequest) {
  try {
    const auth = getAuthFromHeaders(request)
    if (!auth) return NextResponse.json({ success: false, message: '请先登录' }, { status: 401 })
    if (auth.role !== 'admin') return NextResponse.json({ success: false, message: '仅管理员可操作' }, { status: 403 })
    const { deepseekKey, volcanoKey, siliconflowKey, dashscopeKey, ttsAppId, ttsAccessKey, ttsResourceId, ossRegion, ossAccessKeyId, ossAccessKeySecret, ossBucket, automationEngine, actionEngine, mcPath, mcPythonBin, pixabayKey, musicApiType, musicApiKey, musicApiUrl, giphyKey, overseasProxy, geminiKey, geminiBaseUrl, agnesKey, agnesBaseUrl } = await request.json();

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

    // 更新或添加阿里云百炼 API Key
    if (dashscopeKey !== undefined) {
      const pattern = /^DASHSCOPE_API_KEY=.*$/m;
      if (pattern.test(envContent)) {
        envContent = envContent.replace(pattern, `DASHSCOPE_API_KEY=${dashscopeKey}`);
      } else {
        envContent += `\nDASHSCOPE_API_KEY=${dashscopeKey}`;
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

    // 自动化引擎选择
    if (automationEngine !== undefined) {
      const p = /^AUTOMATION_ENGINE=.*$/m;
      if (p.test(envContent)) envContent = envContent.replace(p, `AUTOMATION_ENGINE=${automationEngine}`);
      else envContent += `\nAUTOMATION_ENGINE=${automationEngine}`;
    }

    // 动作执行引擎选择
    if (actionEngine !== undefined) {
      const p = /^ACTION_ENGINE=.*$/m;
      if (p.test(envContent)) envContent = envContent.replace(p, `ACTION_ENGINE=${actionEngine}`);
      else envContent += `\nACTION_ENGINE=${actionEngine}`;
    }

    // MediaCrawler 配置
    if (mcPath !== undefined) {
      const p = /^MEDIA_CRAWLER_PATH=.*$/m;
      if (p.test(envContent)) envContent = envContent.replace(p, `MEDIA_CRAWLER_PATH=${mcPath}`);
      else envContent += `\nMEDIA_CRAWLER_PATH=${mcPath}`;
    }
    if (mcPythonBin !== undefined) {
      const p = /^PYTHON_BIN=.*$/m;
      if (p.test(envContent)) envContent = envContent.replace(p, `PYTHON_BIN=${mcPythonBin}`);
      else envContent += `\nPYTHON_BIN=${mcPythonBin}`;
    }

    // Pixabay API Key
    if (pixabayKey !== undefined) {
      const p = /^PIXABAY_API_KEY=.*$/m;
      if (p.test(envContent)) envContent = envContent.replace(p, `PIXABAY_API_KEY=${pixabayKey}`);
      else envContent += `\nPIXABAY_API_KEY=${pixabayKey}`;
    }

    // 音乐 API 配置
    if (musicApiType !== undefined) {
      const p = /^MUSIC_API_TYPE=.*$/m;
      if (p.test(envContent)) envContent = envContent.replace(p, `MUSIC_API_TYPE=${musicApiType}`);
      else envContent += `\nMUSIC_API_TYPE=${musicApiType}`;
    }
    if (musicApiKey !== undefined) {
      const p = /^MUSIC_API_KEY=.*$/m;
      if (p.test(envContent)) envContent = envContent.replace(p, `MUSIC_API_KEY=${musicApiKey}`);
      else envContent += `\nMUSIC_API_KEY=${musicApiKey}`;
    }
    if (musicApiUrl !== undefined) {
      const p = /^MUSIC_API_URL=.*$/m;
      if (p.test(envContent)) envContent = envContent.replace(p, `MUSIC_API_URL=${musicApiUrl}`);
      else envContent += `\nMUSIC_API_URL=${musicApiUrl}`;
    }

    // GIPHY API Key（在线贴纸库）
    if (giphyKey !== undefined) {
      const p = /^GIPHY_API_KEY=.*$/m;
      if (p.test(envContent)) envContent = envContent.replace(p, `GIPHY_API_KEY=${giphyKey}`);
      else envContent += `\nGIPHY_API_KEY=${giphyKey}`;
    }

    // 海外API代理（CF Worker地址，用于GIPHY/Gemini等翻墙）
    if (overseasProxy !== undefined) {
      const p = /^OVERSEAS_PROXY=.*$/m;
      if (p.test(envContent)) envContent = envContent.replace(p, `OVERSEAS_PROXY=${overseasProxy}`);
      else envContent += `\nOVERSEAS_PROXY=${overseasProxy}`;
    }

    // Gemini API（直连key或中转代理）
    if (geminiKey !== undefined) {
      const p = /^GEMINI_API_KEY=.*$/m;
      if (p.test(envContent)) envContent = envContent.replace(p, `GEMINI_API_KEY=${geminiKey}`);
      else envContent += `\nGEMINI_API_KEY=${geminiKey}`;
    }
    if (geminiBaseUrl !== undefined) {
      const p = /^GEMINI_BASE_URL=.*$/m;
      if (p.test(envContent)) envContent = envContent.replace(p, `GEMINI_BASE_URL=${geminiBaseUrl}`);
      else envContent += `\nGEMINI_BASE_URL=${geminiBaseUrl}`;
    }
    // Agnes AI
    if (agnesKey !== undefined) {
      const p = /^AGNES_API_KEY=.*$/m;
      if (p.test(envContent)) envContent = envContent.replace(p, `AGNES_API_KEY=${agnesKey}`);
      else envContent += `\nAGNES_API_KEY=${agnesKey}`;
    }
    if (agnesBaseUrl !== undefined) {
      const p = /^AGNES_BASE_URL=.*$/m;
      if (p.test(envContent)) envContent = envContent.replace(p, `AGNES_BASE_URL=${agnesBaseUrl}`);
      else envContent += `\nAGNES_BASE_URL=${agnesBaseUrl}`;
    }

    // 写入文件
    await writeFile(envPath, envContent, 'utf-8');
    console.log('[Admin-Config] 配置已保存到 .env.local');

    // 同步到 process.env，立即生效无需重启
    if (deepseekKey !== undefined) process.env.DEEPSEEK_API_KEY = deepseekKey
    if (volcanoKey !== undefined) process.env.VOLCANO_API_KEY = volcanoKey
    if (siliconflowKey !== undefined) process.env.SILICONFLOW_API_KEY = siliconflowKey
    if (dashscopeKey !== undefined) process.env.DASHSCOPE_API_KEY = dashscopeKey
    if (ossRegion !== undefined) process.env.OSS_REGION = ossRegion
    if (ossAccessKeyId !== undefined) process.env.OSS_ACCESS_KEY_ID = ossAccessKeyId
    if (ossAccessKeySecret !== undefined) process.env.OSS_ACCESS_KEY_SECRET = ossAccessKeySecret
    if (ossBucket !== undefined) process.env.OSS_BUCKET = ossBucket
    if (mcPath !== undefined) process.env.MEDIA_CRAWLER_PATH = mcPath
    if (mcPythonBin !== undefined) process.env.PYTHON_BIN = mcPythonBin
    if (pixabayKey !== undefined) process.env.PIXABAY_API_KEY = pixabayKey
    if (musicApiType !== undefined) process.env.MUSIC_API_TYPE = musicApiType
    if (musicApiKey !== undefined) process.env.MUSIC_API_KEY = musicApiKey
    if (musicApiUrl !== undefined) process.env.MUSIC_API_URL = musicApiUrl
    if (giphyKey !== undefined) process.env.GIPHY_API_KEY = giphyKey
    if (overseasProxy !== undefined) process.env.OVERSEAS_PROXY = overseasProxy
    if (geminiKey !== undefined) process.env.GEMINI_API_KEY = geminiKey
    if (geminiBaseUrl !== undefined) process.env.GEMINI_BASE_URL = geminiBaseUrl
    if (agnesKey !== undefined) process.env.AGNES_API_KEY = agnesKey
    if (agnesBaseUrl !== undefined) process.env.AGNES_BASE_URL = agnesBaseUrl

    return NextResponse.json({
      success: true,
      message: '配置已保存，立即生效'
    });

  } catch (error) {
    console.error('[Admin-Config] 保存失败:', error);
    return NextResponse.json({
      success: false,
      message: error instanceof Error ? error.message : '保存失败'
    }, { status: 500 });
  }
}

// 从 .env.local 读取环境变量（补充 process.env，热重载后不会丢失）
async function readEnv(key: string): Promise<string | undefined> {
  if (process.env[key]) return process.env[key]
  try {
    const { readFile } = await import('fs/promises')
    const { join } = await import('path')
    const content = await readFile(join(process.cwd(), '.env.local'), 'utf-8')
    const match = content.match(new RegExp(`^${key}=(.+)$`, 'm'))
    return match?.[1] || undefined
  } catch { return undefined }
}

// 获取当前配置状态（不返回实际 Key，只返回是否已配置）
export async function GET(request: NextRequest) {
  try {
    const auth = getAuthFromHeaders(request)
    if (!auth) return NextResponse.json({ success: false, message: '请先登录' }, { status: 401 })
    if (auth.role !== 'admin') return NextResponse.json({ success: false, message: '仅管理员可操作' }, { status: 403 })
    const deepseekKey = await readEnv('DEEPSEEK_API_KEY');
    const volcanoKey = await readEnv('VOLCANO_API_KEY');
    const siliconflowKey = await readEnv('SILICONFLOW_API_KEY');
    const dashscopeKey = await readEnv('DASHSCOPE_API_KEY');
    const ossRegion = await readEnv('OSS_REGION');
    const ossBucket = await readEnv('OSS_BUCKET');
    const ossAkId = await readEnv('OSS_ACCESS_KEY_ID');
    const ossAkSecret = await readEnv('OSS_ACCESS_KEY_SECRET');
    const ttsAppId = await readEnv('VOLCANO_TTS_APP_ID');
    const ttsAccessKey = await readEnv('VOLCANO_TTS_ACCESS_KEY');
    const ttsResourceId = await readEnv('VOLCANO_TTS_RESOURCE_ID');
    const automationEngine = await readEnv('AUTOMATION_ENGINE');
    const actionEngine = await readEnv('ACTION_ENGINE');
    const mcPath = await readEnv('MEDIA_CRAWLER_PATH');
    const mcPythonBin = await readEnv('PYTHON_BIN');
    const pixabayKey = await readEnv('PIXABAY_API_KEY');
    const musicApiType = await readEnv('MUSIC_API_TYPE');
    const musicApiKey = await readEnv('MUSIC_API_KEY');
    const musicApiUrl = await readEnv('MUSIC_API_URL');
    const giphyKey = await readEnv('GIPHY_API_KEY');
    const overseasProxy = await readEnv('OVERSEAS_PROXY');
    const geminiKey = await readEnv('GEMINI_API_KEY');
    const geminiBaseUrl = await readEnv('GEMINI_BASE_URL');
    const agnesKey = await readEnv('AGNES_API_KEY');
    const agnesBaseUrl = await readEnv('AGNES_BASE_URL');

    // 检查 OSS 是否完整配置
    const ossConfigured = !!(ossRegion && ossAkId && ossAkSecret && ossBucket);

    return NextResponse.json({
      success: true,
      data: {
        deepseekConfigured: !!deepseekKey,
        volcanoConfigured: !!volcanoKey,
        siliconflowConfigured: !!siliconflowKey,
        dashscopeConfigured: !!dashscopeKey,
        ttsAppIdConfigured: !!ttsAppId,
        ttsAccessKeyConfigured: !!ttsAccessKey,
        ttsResourceIdConfigured: !!ttsResourceId,
        automationEngine: automationEngine || 'mediacrawler',
        actionEngine: actionEngine || 'q1-adb',
        mcPath: mcPath || '',
        mcPythonBin: mcPythonBin || '',
        pixabayConfigured: !!pixabayKey,
        musicApiType: musicApiType || '',
        musicApiConfigured: !!(musicApiKey && musicApiUrl),
        giphyConfigured: !!giphyKey,
        overseasProxy: overseasProxy || '',
        overseasProxyConfigured: !!overseasProxy,
        geminiConfigured: !!geminiKey,
        geminiBaseUrl: geminiBaseUrl || '',
        geminiBaseUrlConfigured: !!geminiBaseUrl,
        agnesConfigured: !!agnesKey,
        agnesBaseUrl: agnesBaseUrl || '',
        agnesBaseUrlConfigured: !!agnesBaseUrl,
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
