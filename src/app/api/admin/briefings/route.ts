import { NextRequest, NextResponse } from 'next/server';
import { getAuthFromHeaders } from '@/lib/api-auth';
import { generateText } from '@/lib/ai-providers';

export async function GET(req: NextRequest) {
  try {
    const auth = getAuthFromHeaders(req);
    if (!auth) return NextResponse.json({ success: false, message: '未认证' }, { status: 401 });
    if (auth.role === 'end-user') return NextResponse.json({ success: false, message: '无权访问' }, { status: 403 });

    const category = req.nextUrl.searchParams.get('category');

    /* 返回简报列表 - 内置示例数据 */
    const briefings = [
      { id: 1, title: '2026年6月抖音营销趋势报告', category: 'douyin', summary: '本月抖音重点：本地生活GMV增长34%，AI生成内容占比突破15%', createdAt: '2026-06-01', tags: ['抖音', '趋势'] },
      { id: 2, title: 'Q2电商直播复盘与Q3策略建议', category: 'ecommerce', summary: 'Q2整体GMV超预期18%，美妆/服饰类目领涨', createdAt: '2026-05-28', tags: ['电商', '直播'] },
      { id: 3, title: '本地生活POI推广最佳实践', category: 'local', summary: '基于500+案例数据分析，总结POI推广的高效打法', createdAt: '2026-05-25', tags: ['本地生活', 'POI'] },
      { id: 4, title: 'AI营销工具使用指南 v2026.06', category: 'ai_marketing', summary: '全面梳理当前可用的AI营销工具链', createdAt: '2026-05-20', tags: ['AI', '工具'] },
    ].filter(b => !category || b.category === category);

    return NextResponse.json({ success: true, data: briefings });
  } catch (e: unknown) {
    console.error('[API /admin/briefings GET]', e);
    return NextResponse.json({ success: false, message: '服务器错误' }, { status: 500 });
  }
}

/* POST: AI 生成新简报 */
export async function POST(req: NextRequest) {
  try {
    const auth = getAuthFromHeaders(req);
    if (!auth) return NextResponse.json({ success: false, message: '未认证' }, { status: 401 });
    if (auth.role === 'end-user') return NextResponse.json({ success: false, message: '无权操作' }, { status: 403 });

    const body = await req.json();
    const { category, period, focus } = body as { category?: string; period?: string; focus?: string };

    const catLabels: Record<string, string> = {
      douyin: '抖音生态', ecommerce: '电商直播', local: '本地生活', ai_marketing: 'AI营销',
    };
    const periodLabels: Record<string, string> = { week: '本周', month: '本月', quarter: '本季度' };

    const title = (periodLabels[period ?? 'month'] || '本月') + (catLabels[category ?? 'douyin'] || '') + '简报';
    const now = new Date().toISOString().split('T')[0];

    // 构建AI提示词
    const prompt = `你是一位资深行业分析师。请为${catLabels[category ?? 'douyin'] || '营销'}领域撰写一份${periodLabels[period ?? 'month'] || '本月'}行业洞察简报。

要求：
1. 使用 Markdown 格式
2. 包含核心数据、趋势要点、行动建议三个板块
3. 数据尽量真实可信（标注"基于公开数据分析"）
4. 语言专业简洁，适合企业决策者阅读
5. 总字数控制在800-1500字
${focus ? `\n6. 重点关注方向：${focus}\n7. 增加一个关于「${focus}」的专题分析板块` : ''}`;

    // 调用 AI 生成
    const content = await generateText(prompt) || 'AI 生成失败，请检查 AI 服务配置。';

    return NextResponse.json({
      success: true,
      data: {
        id: Date.now(),
        title,
        category: category || 'douyin',
        summary: 'AI生成的' + (catLabels[category ?? 'douyin'] || '行业') + '洞察报告已就绪',
        content,
        createdAt: now,
        tags: [category || 'general', period || 'month'],
      },
    });
  } catch (e: unknown) {
    console.error('[API /admin/briefings POST]', e);
    return NextResponse.json({
      success: false,
      message: e instanceof Error ? e.message : 'AI 生成简报失败，请确认 AI 服务（DeepSeek/SiliconFlow）已配置'
    }, { status: 500 });
  }
}
