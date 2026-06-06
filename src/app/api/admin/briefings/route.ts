import { NextRequest, NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { getAuthFromHeaders } from '@/lib/api-auth';

const prisma = new PrismaClient();

export async function GET(req: NextRequest) {
  try {
    const auth = getAuthFromHeaders(req);
    if (!auth) return NextResponse.json({ success: false, message: '未认证' }, { status: 401 });
    if (auth.role === 'end-user') return NextResponse.json({ success: false, message: '无权访问' }, { status: 403 });

    const category = req.nextUrl.searchParams.get('category');

    /* 返回简报列表 - 目前使用内置数据 */
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

/* POST: AI生成新简报 */
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

    /* TODO: 接入AI生成真实内容 */
    const content = generateMockContent(category || 'douyin', period || 'month', focus);

    return NextResponse.json({
      success: true,
      data: {
        id: Date.now(),
        title,
        category: category || 'douyin',
        summary: 'AI生成的' + (catLabels[category] || '行业') + '洞察报告已就绪',
        content,
        createdAt: now,
        tags: [category || 'general', period || 'month'],
      },
    });
  } catch (e: unknown) {
    console.error('[API /admin/briefings POST]', e);
    return NextResponse.json({ success: false, message: '服务器错误' }, { status: 500 });
  }
}

function generateMockContent(category: string, period: string, focus?: string): string {
  const templates: Record<string, string> = {
    douyin: `## ${period === 'week' ? '本周' : period === 'quarter' ? '本季度' : '本月'}抖音生态洞察

### 核心数据
- **日活**: 稳定在7.5亿+水平
- **电商GMV**: 同比保持30%+增长
- **AI内容占比**: 持续攀升至15%+

### 趋势要点
1. **本地生活**仍是最大增长引擎
2. **AI数字人**直播渗透率加速
3. **搜索流量**成为新战场

${focus ? '\n### 专题: ' + focus + '\n基于您关注的「' + focus + '」方向，建议重点关注...\n' : ''}

### 行动建议
- 加大本地商家合作投入
- 引入AIGC工具降低内容成本
- 优化搜索关键词布局`,

    ecommerce: `## ${period === 'week' ? '本周' : period === 'quarter' ? '本季度' : '本月'}电商直播报告

### 数据概览
| 指标 | 表现 | 趋势 |
|------|------|------|
| GMV | 强劲 | ↗ |
| 转化率 | 稳定 | → |
| 客单价 | 微升 | ↗ |

### 热门品类
1. 美妆护肤
2. 女装服饰
3. 食品饮料

${focus ? '\n### 关注点: ' + focus + '\n' : ''}

### 策略建议
- 把握大促节奏优化库存
- 加强直播间互动提升停留
- 多渠道分发扩大触达`,

    local: `## ${period === 'week' ? '本周' : period === 'quarter' ? '本季度' : '本月'}本地生活简报

### 市场概况
- 团购券核销率达68%
- POI视频曝光量+120%
- 到店转化成本下降15%

### 最佳实践
1. 视频种草：15-30秒黄金时长
2. 团组定价：引流款<9.9元
3. 直播配合：每周2+场门店播

${focus ? '\n### 专题分析: ' + focus + '\n' : ''}`,

    ai_marketing: `## ${period === 'week' ? '本周' : period === 'quarter' ? '本季度' : '本月'}AI营销工具指南

### 工具矩阵更新
| 阶段 | 推荐工具 | 效果评级 |
|------|----------|----------|
| 文案 | AI Copy Writer | ★★★★☆ |
| 视频 | 文生视频流水线 | ★★★★☆ |
| 数字人 | 数字人直播 | ★★★☆☆ |

### 新功能亮点
1. 批量生成支持多风格切换
2. 数字人表情更自然
3. 自动SEO优化上线

${focus ? '\n### 关于: ' + focus + '\n' : ''}`,
  };
  return templates[category] || templates.douyin;
}
