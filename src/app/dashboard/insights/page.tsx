'use client';

import { useState, useEffect } from 'react';

// ====== 类型定义 ======

interface OverviewData {
  summary: {
    totalLeads: number;
    newLeadsThisWeek: number;
    activeTasks: number;
    totalReferrals: number;
    conversionRate: number;
  };
  statusDistribution: Record<string, number>;
  dailyTrend: Array<{ date: string; count: number }>;
}

interface LeadsData {
  dailyTrend: Array<{ date: string; count: number }>;
  platformDistribution: Record<string, number>;
  sourceTypeDistribution: Record<string, number>;
  intentStats: { avg: number; max: number };
}

interface TrendingData {
  source: string;
  topics: Array<{ title: string; source?: string; score?: number; fallback?: boolean }>;
  fallback?: boolean;
}

interface KeywordData {
  keywordStats: Array<{
    taskId: number;
    taskName: string;
    keywords: string[];
    totalLeads: number;
    periodLeads: number;
    highIntentLeads: number;
    convertedLeads: number;
    conversionRate: number;
    avgIntentScore: number;
    status: string;
  }>;
  totalTasks: number;
}

type ViewType = 'overview' | 'leads' | 'trending' | 'keywords' | 'collection';

const VIEWS: { id: ViewType; label: string; sub: string }[] = [
  { id: 'overview', label: '总览', sub: 'OVERVIEW' },
  { id: 'leads', label: '线索分析', sub: 'LEADS' },
  { id: 'trending', label: '热门趋势', sub: 'TRENDING' },
  { id: 'keywords', label: '关键词分析', sub: 'KEYWORDS' },
  { id: 'collection', label: '采集统计', sub: 'COLLECTION' },
];

const DAYS_OPTIONS = [7, 14, 30, 90];

// ====== 组件 ======

export default function InsightsPage() {
  const [activeView, setActiveView] = useState<ViewType>('overview');
  const [days, setDays] = useState(7);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 各视图数据
  const [overviewData, setOverviewData] = useState<OverviewData | null>(null);
  const [leadsData, setLeadsData] = useState<LeadsData | null>(null);
  const [trendingData, setTrendingData] = useState<TrendingData | null>(null);
  const [keywordData, setKeywordData] = useState<KeywordData | null>(null);
  const [collectionData, setCollectionData] = useState<any>(null);

  useEffect(() => {
    fetchView('overview');
  }, []);

  // 切换视图时自动加载
  useEffect(() => {
    if (activeView) fetchView(activeView);
  }, [activeView, days]);

  const fetchView = async (view: ViewType) => {
    setLoading(true);
    setError(null);
    try {
      const url = `/api/insights?view=${view}&days=${days}`;
      const res = await fetch(url, { credentials: 'include' });
      const json = await res.json();
      if (json.success) {
        switch (view) {
          case 'overview': setOverviewData(json.data); break;
          case 'leads': setLeadsData(json.data); break;
          case 'trending': setTrendingData(json.data); break;
          case 'keywords': setKeywordData(json.data); break;
          case 'collection': setCollectionData(json.data); break;
        }
      } else {
        setError(json.message || '加载数据失败');
      }
    } catch (e: any) {
      setError(e.message || '网络错误');
    } finally {
      setLoading(false);
    }
  };

  // ====== 渲染辅助 ======

  const statCard = (label: string, value: number | string, sub?: string, color: string = 'emerald') => (
    <div className="bg-white/5 backdrop-blur-sm rounded-2xl border border-white/10 p-6">
      <p className="text-gray-400 text-xs font-mono mb-1">{label}</p>
      <p className={`text-3xl font-bold text-${color}-400 font-mono`}>{value}</p>
      {sub && <p className="text-xs text-gray-500 font-mono mt-1">{sub}</p>}
    </div>
  );

  const miniBar = (data: Record<string, number>, colors: string[]) => {
    const entries = Object.entries(data).filter(([, v]) => v > 0);
    if (entries.length === 0) return <p className="text-gray-500 text-sm font-mono">暂无数据</p>;
    const max = Math.max(...entries.map(([, v]) => v));
    return (
      <div className="space-y-2">
        {entries.map(([key, val], i) => (
          <div key={key} className="flex items-center gap-3">
            <span className="text-sm text-gray-400 font-mono w-20 shrink-0">{key}</span>
            <div className="flex-1 bg-white/5 rounded-full h-4 overflow-hidden">
              <div
                className={`h-full rounded-full ${colors[i % colors.length]} transition-all`}
                style={{ width: `${max > 0 ? (val / max) * 100 : 0}%` }}
              />
            </div>
            <span className="text-sm text-white font-mono w-10 text-right">{val}</span>
          </div>
        ))}
      </div>
    );
  };

  const sparkline = (data: Array<{ date: string; count: number }>) => {
    if (!data.length) return null;
    const max = Math.max(...data.map(d => d.count), 1);
    const points = data.map((d, i) => `${i * (300 / (data.length - 1 || 1))},${60 - (d.count / max) * 50}`).join(' ');
    return (
      <svg viewBox="0 0 300 70" className="w-full h-16" preserveAspectRatio="none">
        <polyline points={points} fill="none" stroke="#34d399" strokeWidth="2" />
        {data.map((d, i) => (
          <circle key={i} cx={i * (300 / (data.length - 1 || 1))} cy={60 - (d.count / max) * 50} r="2" fill="#34d399" />
        ))}
      </svg>
    );
  };

  // ====== 视图渲染 ======

  return (
    <div className="min-h-screen bg-gray-950">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">

        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-8 gap-4">
          <div>
            <p className="text-label mb-2">数据分析 / ANALYTICS</p>
            <h1 className="text-mono-lg text-white">行业洞察 / INSIGHTS</h1>
          </div>
          <div className="flex items-center gap-3">
            <select
              value={days}
              onChange={(e) => setDays(Number(e.target.value))}
              className="bg-white/5 border border-white/10 rounded-xl px-4 py-2 text-white focus:outline-none focus:border-emerald-500/50 font-mono text-sm"
            >
              {DAYS_OPTIONS.map(d => <option key={d} value={d} className="bg-gray-900">近{d}天</option>)}
            </select>
            <button onClick={() => fetchView(activeView)} disabled={loading}
              className="px-4 py-2 bg-emerald-500/20 text-emerald-400 rounded-xl hover:bg-emerald-500/30 disabled:opacity-50 font-mono text-sm"
            >
              {loading ? 'LOADING...' : 'REFRESH'}
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-2 mb-8 overflow-x-auto pb-2">
          {VIEWS.map(v => (
            <button key={v.id}
              onClick={() => setActiveView(v.id)}
              className={`px-4 py-2 rounded-xl font-medium font-mono transition-colors whitespace-nowrap ${
                activeView === v.id
                  ? 'bg-emerald-500 text-white'
                  : 'bg-white/5 text-gray-400 hover:bg-white/10 border border-white/10'
              }`}
            >
              <span>{v.label}</span>
              <span className="text-xs opacity-50 ml-1">{v.sub}</span>
            </button>
          ))}
        </div>

        {/* Error */}
        {error && (
          <div className="mb-6 p-4 rounded-xl bg-red-500/20 border border-red-500/30 text-red-400 font-mono text-sm">
            ERROR: {error}
          </div>
        )}

        {/* ====== OVERVIEW ====== */}
        {activeView === 'overview' && overviewData && (
          <div className="space-y-6">
            {/* Stats Cards */}
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
              {statCard('总线索数', overviewData.summary.totalLeads, 'TOTAL LEADS')}
              {statCard('本周新增', overviewData.summary.newLeadsThisWeek, 'THIS WEEK', 'blue')}
              {statCard('活跃任务', overviewData.summary.activeTasks, 'ACTIVE TASKS', 'purple')}
              {statCard('导流配置', overviewData.summary.totalReferrals, 'REFERRALS', 'yellow')}
              {statCard('转化率', `${overviewData.summary.conversionRate}%`, 'CONVERSION RATE', 'orange')}
            </div>

            {/* Daily Trend + Status Distribution */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="bg-white/5 backdrop-blur-sm rounded-2xl border border-white/10 p-6">
                <h3 className="text-white font-bold mb-4 font-mono"><span className="text-blue-400">//</span> 每日新增趋势</h3>
                {sparkline(overviewData.dailyTrend)}
                <div className="flex justify-between mt-2 text-xs text-gray-500 font-mono">
                  {overviewData.dailyTrend.slice(-5).map(d => <span key={d.date}>{d.date.slice(5)}</span>)}
                </div>
              </div>

              <div className="bg-white/5 backdrop-blur-sm rounded-2xl border border-white/10 p-6">
                <h3 className="text-white font-bold mb-4 font-mono"><span className="text-purple-400">//</span> 线索状态分布</h3>
                {miniBar(overviewData.statusDistribution, ['bg-emerald-500', 'bg-yellow-500', 'bg-blue-500', 'bg-red-500', 'bg-gray-500'])}
              </div>
            </div>
          </div>
        )}

        {/* ====== LEADS ====== */}
        {activeView === 'leads' && leadsData && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {statCard('平均意向分', leadsData.intentStats.avg, '/ 100', 'emerald')}
              {statCard('最高意向分', leadsData.intentStats.max, '', 'blue')}
              {statCard('来源类型', Object.keys(leadsData.sourceTypeDistribution).length, '种', 'purple')}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="bg-white/5 backdrop-blur-sm rounded-2xl border border-white/10 p-6">
                <h3 className="text-white font-bold mb-4 font-mono"><span className="text-blue-400">//</span> 平台分布</h3>
                {miniBar(leadsData.platformDistribution, ['bg-pink-500', 'bg-green-500', 'bg-orange-500', 'bg-cyan-500', 'bg-violet-500'])}
              </div>

              <div className="bg-white/5 backdrop-blur-sm rounded-2xl border border-white/10 p-6">
                <h3 className="text-white font-bold mb-4 font-mono"><span className="text-emerald-400">//</span> 来源类型分布</h3>
                {miniBar(leadsData.sourceTypeDistribution, ['bg-blue-500', 'bg-purple-500', 'bg-yellow-500', 'bg-red-500'])}
              </div>
            </div>

            <div className="bg-white/5 backdrop-blur-sm rounded-2xl border border-white/10 p-6">
              <h3 className="text-white font-bold mb-4 font-mono"><span className="text-cyan-400">//</span> 每日趋势详情</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm font-mono">
                  <thead>
                    <tr className="border-b border-white/10 text-gray-400">
                      <th className="text-left py-2 px-3">日期</th>
                      <th className="text-right py-2 px-3">新增线索</th>
                    </tr>
                  </thead>
                  <tbody>
                    {leadsData.dailyTrend.map(d => (
                      <tr key={d.date} className="border-b border-white/5 hover:bg-white/5">
                        <td className="py-2 px-3 text-white">{d.date}</td>
                        <td className="py-2 px-3 text-right text-emerald-400">{d.count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ====== TRENDING ====== */}
        {activeView === 'trending' && trendingData && (
          <div className="space-y-6">
            <div className="flex items-center gap-3 text-sm font-mono">
              <span className="text-gray-400">DATA SOURCE:</span>
              <span className={`px-2 py-1 rounded ${trendingData.fallback ? 'bg-yellow-500/20 text-yellow-400' : 'bg-emerald-500/20 text-emerald-400'}`}>
                {trendingData.source}
              </span>
              {trendingData.fallback && <span className="text-yellow-400 text-xs">(本地缓存)</span>}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {(trendingData.topics || []).map((topic, idx) => (
                <div key={idx} className="bg-white/5 backdrop-blur-sm rounded-2xl border border-white/10 p-5 hover:border-emerald-500/30 transition-colors">
                  <div className="flex items-start justify-between mb-2">
                    <span className="text-lg font-bold text-white font-mono">#{idx + 1}</span>
                    <span className="px-2 py-0.5 bg-purple-500/20 text-purple-400 text-xs rounded font-mono">{topic.source || 'N/A'}</span>
                  </div>
                  <p className="text-gray-300 font-mono text-sm line-clamp-2">{topic.title}</p>
                  {topic.score !== undefined && (
                    <div className="mt-3 flex items-center gap-2">
                      <span className="text-xs text-gray-500 font-mono">HOT SCORE:</span>
                      <div className="flex-1 bg-white/5 rounded-full h-2 overflow-hidden">
                        <div className="h-full bg-gradient-to-r from-emerald-500 to-cyan-400 rounded-full" style={{ width: `${Math.min(topic.score, 100)}%` }} />
                      </div>
                      <span className="text-xs text-emerald-400 font-mono">{topic.score}</span>
                    </div>
                  )}
                </div>
              ))}
            </div>

            {!trendingData.topics?.length && (
              <div className="text-center py-12">
                <p className="text-gray-500 font-mono">NO TRENDING DATA / 暂无热门趋势数据</p>
              </div>
            )}
          </div>
        )}

        {/* ====== KEYWORDS ====== */}
        {activeView === 'keywords' && keywordData && (
          <div className="space-y-6">
            <div className="bg-white/5 backdrop-blur-sm rounded-2xl border border-white/10 p-4 flex items-center gap-4">
              <span className="text-gray-400 font-mono text-sm">TOTAL TASKS:</span>
              <span className="text-white font-mono font-bold">{keywordData.totalTasks}</span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm font-mono">
                <thead>
                  <tr className="border-b border-white/10 text-gray-400">
                    <th className="text-left py-3 px-4">TASK NAME</th>
                    <th className="text-left py-3 px-4">KEYWORDS</th>
                    <th className="text-right py-3 px-4">PERIOD</th>
                    <th className="text-right py-3 px-4">HIGH INTENT</th>
                    <th className="text-right py-3 px-4">CONVERTED</th>
                    <th className="text-right py-3 px-4">RATE</th>
                    <th className="text-right py-3 px-4">AVG SCORE</th>
                    <th className="text-left py-3 px-4">STATUS</th>
                  </tr>
                </thead>
                <tbody>
                  {(keywordData.keywordStats || []).map(stat => (
                    <tr key={stat.taskId} className="border-b border-white/5 hover:bg-white/5">
                      <td className="py-3 px-4 text-white font-medium">{stat.taskName}</td>
                      <td className="py-3 px-4">
                        <div className="flex flex-wrap gap-1">
                          {stat.keywords.map((kw, i) => (
                            <span key={i} className="px-1.5 py-0.5 bg-blue-500/20 text-blue-400 text-xs rounded">{kw}</span>
                          ))}
                        </div>
                      </td>
                      <td className="py-3 px-4 text-right text-white">{stat.periodLeads}</td>
                      <td className="py-3 px-4 text-right text-emerald-400">{stat.highIntentLeads}</td>
                      <td className="py-3 px-4 text-right text-cyan-400">{stat.convertedLeads}</td>
                      <td className="py-3 px-4 text-right text-yellow-400">{stat.conversionRate}%</td>
                      <td className="py-3 px-4 text-right text-purple-400">{stat.avgIntentScore}</td>
                      <td className="py-3 px-4">
                        <span className={`px-2 py-0.5 text-xs rounded font-mono ${
                          stat.status === 'running' ? 'bg-emerald-500/20 text-emerald-400' :
                          stat.status === 'completed' ? 'bg-gray-500/20 text-gray-400' :
                          'bg-yellow-500/20 text-yellow-400'
                        }`}>{stat.status.toUpperCase()}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ====== COLLECTION ====== */}
        {activeView === 'collection' && collectionData && (
          <div className="space-y-6">
            {/* Recent Leads */}
            <div className="bg-white/5 backdrop-blur-sm rounded-2xl border border-white/10 p-6">
              <h3 className="text-white font-bold mb-4 font-mono"><span className="text-emerald-400">//</span> 最近采集的线索 TOP 10</h3>
              <div className="space-y-3">
                {(collectionData.recentLeads || []).map((lead: any) => (
                  <div key={lead.id} className="flex items-center gap-4 p-3 bg-white/5 rounded-xl">
                    <div className="shrink-0 w-10 h-10 rounded-full bg-gradient-to-br from-emerald-500 to-cyan-400 flex items-center justify-center text-white text-xs font-bold">
                      {lead.platform?.[0]?.toUpperCase() || '?'}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-white text-sm font-mono truncate">{lead.rawContent || '(空内容)'}</p>
                      <div className="flex gap-2 mt-1">
                        <span className="text-xs text-purple-400 font-mono">{lead.platform}</span>
                        <span className="text-xs text-gray-500 font-mono">{lead.sourceType}</span>
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className={`text-sm font-mono font-bold ${(lead.intentScore || 0) >= 60 ? 'text-emerald-400' : 'text-gray-400'}`}>
                        {lead.intentScore || 0}
                      </div>
                      <div className="text-xs text-gray-500 font-mono">{new Date(lead.createdAt).toLocaleDateString()}</div>
                    </div>
                  </div>
                ))}
              </div>
              {(!collectionData.recentLeads || collectionData.recentLeads.length === 0) && (
                <p className="text-center text-gray-500 font-mono py-8">NO RECENT LEADS</p>
              )}
            </div>

            {/* Task Stats */}
            <div className="bg-white/5 backdrop-blur-sm rounded-2xl border border-white/10 p-6">
              <h3 className="text-white font-bold mb-4 font-mono"><span className="text-blue-400">//</span> 采集任务概览</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {(collectionData.tasks || []).map((task: any) => (
                  <div key={task.id} className="bg-white/5 rounded-xl p-4 border border-white/10">
                    <div className="flex justify-between items-start mb-2">
                      <span className="text-white font-mono text-sm font-medium truncate">{task.name}</span>
                      <span className={`px-1.5 py-0.5 text-xs rounded font-mono ${
                        task.status === 'running' ? 'bg-emerald-500/20 text-emerald-400' :
                        task.status === 'completed' ? 'bg-gray-500/20 text-gray-400' :
                        'bg-yellow-500/20 text-yellow-400'
                      }`}>{task.status}</span>
                    </div>
                    <div className="flex justify-between text-xs font-mono mt-2">
                      <span className="text-gray-400">Total: <span className="text-white">{task._count?.leads || 0}</span></span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Loading State */}
        {loading && !overviewData && !leadsData && !trendingData && !keywordData && !collectionData && (
          <div className="text-center py-20">
            <p className="text-gray-400 font-mono animate-pulse">LOADING DATA...</p>
          </div>
        )}
      </div>
    </div>
  );
}
