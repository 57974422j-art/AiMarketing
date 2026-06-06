'use client';

import { useAuth } from '@/app/providers';
import { useRouter } from 'next/navigation';
import { useEffect, useState, useCallback } from 'react';

/* ====== 类型定义 ====== */
interface Briefing {
  id: number;
  title: string;
  category: string;
  summary: string;
  content: string;
  createdAt: string;
  tags: string[];
}

interface GenRequest {
  category: string; period: string; focus: string;
}

const CATEGORIES = [
  { id: 'douyin', label: '抖音生态', desc: '短视频趋势、算法变化、爆款分析' },
  { id: 'ecommerce', label: '电商直播', desc: 'GMV趋势、带货策略、选品洞察' },
  { id: 'local', label: '本地生活', desc: 'POI推广、到店引流、团购策略' },
  { id: 'ai_marketing', label: 'AI营销', desc: 'AIGC工具、AI文案/视频/数字人' },
];

const MOCK_BRIEFINGS: Briefing[] = [
  {
    id: 1, title: '2026年6月抖音营销趋势报告',
    category: 'douyin', summary: '本月抖音重点：本地生活GMV增长34%，AI生成内容占比突破15%，直播间互动率提升至8.2%...',
    content: `## 核心数据
- **日活用户**: 突破7.8亿，环比+3.2%
- **电商GMV**: 本月预计2800亿，同比+45%
- **AI内容占比**: 15.3%，较上月提升2.1pp

## 趋势洞察
### 1. 本地生活持续爆发
- 团购券核销率提升至68%
- 到店POI视频曝光量+120%
- 建议：加大本地商家合作

### 2. AI内容成为新常态
- AI数字人直播时长占比达12%
- AIGC视频完播率逼近真人（82% vs 87%）
- 建议：引入AI工具降低内容成本

### 3. 私域流量价值凸显
- 粉丝群转化率是公域的4.6倍
- 直播间粉丝复购率达35%
- 建议：强化粉丝运营SOP`,
    createdAt: '2026-06-01', tags: ['抖音', '趋势', 'AI', '本地生活'],
  },
  {
    id: 2, title: 'Q2电商直播复盘与Q3策略建议',
    category: 'ecommerce', summary: 'Q2整体GMV超预期18%，美妆/服饰类目领涨。Q3重点关注618返场和暑期消费旺季...',
    content: `## Q2 复盘
| 指标 | 数值 | 同比 |
|------|------|------|
| GMV | 8500亿 | +42% |
| 场观峰值 | 2.3亿 | +28% |
| 转化率 | 3.8% | +0.5pp |

## 热门品类 TOP5
1. 美妆护肤 (GMV占比22%)
2. 女装服饰 (19%)
3. 食品饮料 (14%)
4. 3C数码 (11%)
5. 家居日用 (9%)

## Q3 策略建议
- **618返场**：利用余热做二次转化
- **暑期营销**：针对学生/亲子人群定制
- **新品首发**：配合平台大促节点`,
    createdAt: '2026-05-28', tags: ['电商', '直播', 'Q2复盘', 'Q3规划'],
  },
  {
    id: 3, title: '本地生活POI推广最佳实践',
    category: 'local', summary: '基于500+案例数据分析，总结POI推广的高效打法：视频+团购+直播三位一体...',
    content: `## 数据概览
- 参与商家数: 520家
- 平均曝光增量: +340%
- 平均到店转化: +85%
- ROI中位数: 4.2x

## 最佳实践

### 视频种草
- 15-30秒短视频效果最佳
- 必须包含门店外观/产品特写/价格信息
- 发布时间: 工作日11:00-13:00 / 17:00-20:00

### 团组配置
- 引流款定价 < 9.9元
- 利润款核销周期设为7天
- 爆款库存 > 100份避免售罄

### 直播配合
- 每周至少2场门店直播
- 直播前2h发布预热视频
- 直播中发放专属优惠券`,
    createdAt: '2026-05-25', tags: ['本地生活', 'POI', '团购', '实战'],
  },
  {
    id: 4, title: 'AI营销工具使用指南 v2026.06',
    category: 'ai_marketing', summary: '全面梳理当前可用的AI营销工具链：文案生成→视频制作→数字人→自动分发全流程...',
    content: `## 工具矩阵

### 文案层
| 工具 | 用途 | 效果 |
|------|------|------|
| AI Copy Writer | 产品描述/广告语 | ★★★★☆ |
| 话术模板库 | 直播话术/评论回复 | ★★★★★ |
| SEO优化器 | 关键词/标题优化 | ★★★☆☆ |

### 视频层
| 工具 | 用途 | 效果 |
|------|------|------|
| 文生视频 | 批量生产素材 | ★★★★☆ |
| 图生视频 | 静态图转动态 | ★★★★☆ |
| 数字人 | 口播/客服替代 | ★★★☆☆ |

### 分发层
| 功能 | 说明 |
|------|------|
| 多账号管理 | 一键多平台发布 |
| 定时发布 | 错峰发布避开竞争 |
| 数据回流 | 自动统计各渠道表现 |

## 使用建议
1. 新手：从AI文案开始，门槛最低
2. 进阶：接入文生视频流水线
3. 高阶：搭建全自动内容工厂`,
    createdAt: '2026-05-20', tags: ['AI', '工具', '效率', '指南'],
  },
];

export default function BriefingsPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [briefings, setBriefings] = useState<Briefing[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [generating, setGenerating] = useState(false);
  const [genForm, setGenForm] = useState<GenRequest>({ category: 'douyin', period: 'month', focus: '' });
  const [activeFilter, setActiveFilter] = useState<string>('all');

  useEffect(() => {
    if (!loading && !user) router.push('/login');
    if (!loading && user && user.role === 'end-user') router.push('/admin');
  }, [loading, user, router]);

  useEffect(() => { setBriefings(MOCK_BRIEFINGS); }, []);

  /* 生成简报 */
  const handleGenerate = async () => {
    setGenerating(true);
    try {
      const res = await fetch('/api/admin/briefings', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(genForm),
      });
      if (res.ok) {
        const j = await res.json();
        if (j.data) {
          setBriefings(prev => [j.data, ...prev]);
          setSelectedId(j.data.id || Date.now());
        }
      } else {
        /* Mock 生成 */
        const newB: Briefing = {
          id: Date.now(),
          title: genForm.period === 'week' ? '本周' : '本月' + ' ' + CATEGORIES.find(c => c.id === genForm.category)?.label + '简报',
          category: genForm.category,
          summary: '正在通过AI生成行业洞察报告，请稍候...',
          content: '> 🔄 AI 正在生成报告内容...\n\n## 生成参数\n- 类别: ' + genForm.category + '\n- 周期: ' + genForm.period + '\n- 关注点: ' + (genForm.focus || '综合'),
          createdAt: new Date().toISOString().split('T')[0],
          tags: [genForm.category, genForm.period],
        };
        setBriefings(prev => [newB, ...prev]);
        setSelectedId(newB.id);
      }
    } catch (_) {}
    setGenerating(false);
  };

  const selectedBriefing = selectedId ? briefings.find(b => b.id === selectedId) : null;
  const filtered = activeFilter === 'all' ? briefings : briefings.filter(b => b.category === activeFilter);

  if (loading || !user)
    return <div className="min-h-screen bg-gray-950 flex items-center justify-center"><div className="text-gray-400">加载中...</div></div>;

  return (
    <div className="min-h-screen bg-gray-950">
      {/* Header */}
      <div className="border-b border-gray-800">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <p className="text-label mb-2">行业简报 / BRIEFINGS</p>
          <h1 className="text-mono-lg text-white">AI 营销洞察</h1>
          <p className="text-gray-400 text-sm mt-2">定期生成的行业趋势分析与策略建议</p>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* 生成区 + 列表 */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* 左侧：列表 */}
          <div className="lg:col-span-1 space-y-4">
            {/* 分类过滤 */}
            <div className="flex flex-wrap gap-2">
              {[{id:'all',label:'全部'},...CATEGORIES].map(cat => (
                <button key={cat.id} onClick={() => setActiveFilter(cat.id)}
                  className={'px-3 py-1 rounded-full text-xs font-medium transition-colors '
                    + (activeFilter === cat.id ? 'bg-emerald-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-white')}>
                  {cat.label}
                </button>
              ))}
            </div>

            {/* 简报卡片列表 */}
            <div className="space-y-3 max-h-[calc(100vh-320px)] overflow-y-auto pr-1">
              {filtered.map(b => (
                <button key={b.id} onClick={() => setSelectedId(b.id)}
                  className={'w-full text-left card-bento p-4 transition-all '
                    + (selectedId === b.id ? 'border-emerald-600 bg-emerald-900/10' : 'hover:border-gray-700')}
                >
                  <div className="flex items-start justify-between mb-2">
                    <span className={'px-2 py-0.5 rounded text-[10px] font-medium '
                      + (b.category === 'douyin' ? 'bg-pink-500/20 text-pink-400' :
                         b.category === 'ecommerce' ? 'bg-orange-500/20 text-orange-400' :
                         b.category === 'local' ? 'bg-blue-500/20 text-blue-400' : 'bg-violet-500/20 text-violet-400')}>
                      {CATEGORIES.find(c => c.id === b.category)?.label || b.category}
                    </span>
                    <span className="text-[10px] text-gray-600">{b.createdAt}</span>
                  </div>
                  <h3 className="text-sm font-bold text-white mb-1 line-clamp-2">{b.title}</h3>
                  <p className="text-xs text-gray-500 line-clamp-2">{b.summary}</p>
                  {/* Tags */}
                  <div className="flex flex-wrap gap-1 mt-2">
                    {b.tags.map(t => (
                      <span key={t} className="px-1.5 py-0.5 bg-gray-800 rounded text-[10px] text-gray-500">{t}</span>
                    ))}
                  </div>
                </button>
              ))}
              {filtered.length === 0 && (
                <div className="card-bento text-center py-8 text-gray-500 text-sm">暂无简报</div>
              )}
            </div>

            {/* 快速生成表单 */}
            <div className="card-bento p-4">
              <h3 className="text-sm font-medium text-white mb-3">📝 生成新简报</h3>
              <select value={genForm.category} onChange={e => setGenForm(p => ({ ...p, category: e.target.value }))}
                className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-sm text-white mb-2"
              >
                {CATEGORIES.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
              </select>
              <select value={genForm.period} onChange={e => setGenForm(p => ({ ...p, period: e.target.value }))}
                className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-sm text-white mb-2"
              >
                <option value="week">本周</option><option value="month">本月</option><option value="quarter">本季度</option>
              </select>
              <input value={genForm.focus} onChange={e => setGenForm(p => ({ ...p, focus: e.target.value }))}
                placeholder="关注点（可选）" className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-sm text-white mb-3"
              />
              <button onClick={handleGenerate} disabled={generating}
                className="w-full py-2 bg-emerald-600 hover:bg-emerald-500 disabled:bg-gray-700 text-white text-sm font-bold rounded transition-colors"
              >
                {generating ? '⏳ AI生成中...' : '✨ 生成简报'}
              </button>
            </div>
          </div>

          {/* 右侧：详情 */}
          <div className="lg:col-span-2">
            {selectedBriefing ? (
              <div className="card-bento p-6">
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <span className={'px-2 py-0.5 rounded text-xs font-medium mb-2 inline-block '
                      + (selectedBriefing.category === 'douyin' ? 'bg-pink-500/20 text-pink-400' :
                         selectedBriefing.category === 'ecommerce' ? 'bg-orange-500/20 text-orange-400' :
                         selectedBriefing.category === 'local' ? 'bg-blue-500/20 text-blue-400' : 'bg-violet-500/20 text-violet-400')}>
                      {CATEGORIES.find(c => c.id === selectedBriefing.category)?.label}
                    </span>
                    <h2 className="text-xl font-bold text-white mt-2">{selectedBriefing.title}</h2>
                    <p className="text-gray-400 text-sm mt-1">{selectedBriefing.summary}</p>
                  </div>
                  <span className="text-xs text-gray-600 whitespace-nowrap ml-4">{selectedBriefing.createdAt}</span>
                </div>

                {/* Markdown 渲染区域 */}
                <div className="border-t border-gray-800 pt-4">
                  <div className="prose prose-invert prose-sm max-w-none text-gray-300 leading-relaxed whitespace-pre-wrap">
                    {selectedBriefing.content}
                  </div>
                </div>

                {/* 标签 */}
                <div className="flex flex-wrap gap-2 mt-6 pt-4 border-t border-gray-800">
                  {selectedBriefing.tags.map(tag => (
                    <span key={tag} className="px-2 py-1 bg-gray-800 rounded text-xs text-gray-400">#{tag}</span>
                  ))}
                </div>
              </div>
            ) : (
              <div className="card-bento h-full min-h-[500px] flex items-center justify-center">
                <div className="text-center">
                  <div className="text-5xl mb-4">📊</div>
                  <h3 className="text-xl text-white font-bold mb-2">选择一份简报查看</h3>
                  <p className="text-gray-500">从左侧列表选择或生成新的行业洞察报告</p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
