'use client';
import { useState, useEffect } from 'react'

interface PlatformStat {
  platform: string
  followers: number
  publishCount: number
  engagementRate: number
  growthRate: number
}

interface TodoItem {
  id: number;
  text: string;
  type: 'lead' | 'task' | 'submission' | 'live';
  urgency: 'high' | 'medium' | 'low';
}

interface FeedItem {
  id: number;
  text: string;
  time: string;
  icon: string;
}

interface UsageSummary {
  totalUsage: number;
  topAction: string;
  tokenUsed: number;
}

interface DashboardData {
  totalFollowers: number
  totalPublishCount: number
  averageEngagementRate: number
  platformStats: PlatformStat[]
  /* V2 新增 */
  todayStats?: {
    newLeads: number;
    liveViews: number;
    publishedContent: number;
    totalInteractions: number;
  };
  todoList?: TodoItem[];
  recentFeed?: FeedItem[];
  usageSummary?: UsageSummary;
}

const platformMap: Record<string, { cn: string }> = {
  'douyin': { cn: '抖音' },
  'kuaishou': { cn: '快手' },
  'xiaohongshu': { cn: '小红书' },
  'weibo': { cn: '微博' }
};

/* V2 默认数据（API 未返回时兜底） */
const defaultTodos: TodoItem[] = [
  { id: 1, text: '3 条线索待分配给代理', type: 'lead', urgency: 'high' },
  { id: 2, text: '2 个自动化任务待审核', type: 'task', urgency: 'medium' },
  { id: 3, text: '1 份内容素材待审核', type: 'submission', urgency: 'low' },
];

const defaultFeed: FeedItem[] = [
  { id: 1, text: '直播刚结束，本场观看 1.2K 人', time: '10 分钟前', icon: '📺' },
  { id: 2, text: '新视频「夏季促销」已发布到抖音', time: '30 分钟前', icon: '✅' },
  { id: 3, text: '采集任务「美业关键词」完成，发现 23 条新线索', time: '1 小时前', icon: '🎯' },
  { id: 4, text: 'AI 诊断报告已生成，账号健康度评分 82', time: '2 小时前', icon: '🏥' },
];

export default function DashboardPage() {
  const [dashboardData, setDashboardData] = useState<DashboardData>({
    totalFollowers: 0,
    totalPublishCount: 0,
    averageEngagementRate: 0,
    platformStats: []
  })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const fetchDashboardData = async () => {
      try {
        const response = await fetch('/api/dashboard', { credentials: 'include' })
        const data = await response.json()
        setDashboardData(data)
      } catch (error) {
        console.error('获取仪表盘数据错误:', error)
      } finally {
        setLoading(false)
      }
    }

    fetchDashboardData()
  }, [])

  const getPlatformDisplay = (platform: string) => {
    const p = platformMap[platform.toLowerCase()] || { cn: platform };
    return <>{p.cn}</>;
  };

  return (
    <div className="min-h-screen bg-gray-950">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-8">
          <p className="text-label mb-2">总览</p>
          <h1 className="text-mono-lg text-white">仪表盘</h1>
        </div>
        
        {loading ? (
          <div className="flex items-center justify-center h-64">
            <div className="text-center">
              <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-400"></div>
              <p className="mt-2 text-gray-400 text-sm">
                <span>加载中...</span>
              </p>
            </div>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
              <div className="bg-white/5 backdrop-blur-sm rounded-2xl border border-white/10 p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-gray-400">
                      <span>总粉丝数</span>
                    </p>
                    <p className="text-3xl font-bold text-white mt-1">{dashboardData.totalFollowers.toLocaleString()}</p>
                  </div>
                  <div className="p-3 bg-emerald-500/20 rounded-full">
                    <svg className="w-6 h-6 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                    </svg>
                  </div>
                </div>
                <div className="mt-4 flex items-center">
                  <span className="text-sm font-medium text-emerald-400 flex items-center">
                    <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                    </svg>
                    10.5%
                  </span>
                  <span className="text-sm text-gray-500 ml-2">较上月</span>
                </div>
              </div>
              
              <div className="bg-white/5 backdrop-blur-sm rounded-2xl border border-white/10 p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-gray-400">
                      <span>总发布量</span>
                    </p>
                    <p className="text-3xl font-bold text-white mt-1">{dashboardData.totalPublishCount}</p>
                  </div>
                  <div className="p-3 bg-blue-500/20 rounded-full">
                    <svg className="w-6 h-6 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                  </div>
                </div>
                <div className="mt-4 flex items-center">
                  <span className="text-sm font-medium text-emerald-400 flex items-center">
                    <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                    </svg>
                    8.2%
                  </span>
                  <span className="text-sm text-gray-500 ml-2">较上月</span>
                </div>
              </div>
              
              <div className="bg-white/5 backdrop-blur-sm rounded-2xl border border-white/10 p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-gray-400">
                      <span>平均互动率</span>
                    </p>
                    <p className="text-3xl font-bold text-white mt-1">{dashboardData.averageEngagementRate.toFixed(1)}%</p>
                  </div>
                  <div className="p-3 bg-purple-500/20 rounded-full">
                    <svg className="w-6 h-6 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                </div>
                <div className="mt-4 flex items-center">
                  <span className="text-sm font-medium text-red-400 flex items-center">
                    <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                    1.2%
                  </span>
                  <span className="text-sm text-gray-500 ml-2">较上月</span>
                </div>
              </div>
            </div>
            
            <div className="bg-white/5 backdrop-blur-sm rounded-2xl border border-white/10 p-6">
              <h2 className="text-xl font-semibold text-white mb-6">
                <span>平台数据详情</span>
              </h2>
              
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-white/10">
                  <thead className="bg-white/5">
                    <tr>
                      <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                        <span>平台</span>
                      </th>
                      <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                        <span>粉丝数</span>
                      </th>
                      <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                        <span>发布量</span>
                      </th>
                      <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                        <span>互动率</span>
                      </th>
                      <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                        <span>增长率</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/10">
                    {dashboardData.platformStats.map((stat, index) => (
                      <tr key={index} className="hover:bg-white/5">
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-white">
                          {getPlatformDisplay(stat.platform)}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-400">
                          {stat.followers.toLocaleString()}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-400">
                          {stat.publishCount}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-400">
                          {stat.engagementRate}%
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className={`px-2 py-1 inline-flex text-xs leading-5 font-semibold rounded-full ${stat.growthRate > 0 ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'bg-red-500/20 text-red-400 border border-red-500/30'}`}>
                            {stat.growthRate > 0 ? '+' : ''}{stat.growthRate.toFixed(1)}%
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}

        {/* ====== V2 增强区域 ====== */}
        {!loading && (
          <>
            {/* 今日概览 4 卡片 */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
              {[
                { label: '新增线索', sub: '', value: dashboardData.todayStats?.newLeads ?? 0, icon: '🎯', color: 'text-blue-400 bg-blue-500/15', trend: '+12%' },
                { label: '直播观看', sub: '', value: (dashboardData.todayStats?.liveViews ?? 0) > 1000 ? `${((dashboardData.todayStats?.liveViews ?? 0) / 1000).toFixed(1)}K` : dashboardData.todayStats?.liveViews ?? 0, icon: '📺', color: 'text-red-400 bg-red-500/15', trend: '+8%' },
                { label: '内容发布', sub: '', value: dashboardData.todayStats?.publishedContent ?? 0, icon: '📝', color: 'text-emerald-400 bg-emerald-500/15', trend: '+3' },
                { label: '互动总量', sub: '', value: dashboardData.todayStats?.totalInteractions ?? 0, icon: '💬', color: 'text-purple-400 bg-purple-500/15', trend: '+22%' },
              ].map((card) => (
                <div key={card.label} className="bg-white/5 backdrop-blur-sm rounded-xl border border-white/10 p-4 hover:bg-white/[0.07] transition-colors">
                  <p className="text-xs text-gray-500">{card.label}</p>
                  <div className="flex items-center justify-between mt-1">
                    <span className="text-xl font-bold text-white">{card.value}</span>
                    <span className={`text-lg ${card.color.split(' ')[0]} px-1.5 py-0.5 rounded ${card.color.split(' ')[1]}`}>{card.icon}</span>
                  </div>
                  <p className="text-[10px] text-emerald-400 mt-1.5">{card.trend} 较昨日</p>
                </div>
              ))}
            </div>

            {/* 双栏：待办 + 动态 */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
              {/* 待办事项 */}
              <div className="bg-white/5 backdrop-blur-sm rounded-2xl border border-white/10 p-5">
                <h3 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
                  <span>待办事项</span>
                  <span className="ml-auto text-xs bg-orange-500/20 text-orange-400 px-2 py-0.5 rounded-full">
                    {dashboardData.todoList?.length || 0}
                  </span>
                </h3>
                <div className="space-y-2">
                  {(dashboardData.todoList && dashboardData.todoList.length > 0 ? dashboardData.todoList : defaultTodos).map((item) => (
                    <div key={item.id} className={`flex items-center gap-3 p-3 rounded-lg ${
                      item.urgency === 'high' ? 'bg-red-500/5 border border-red-500/10' :
                      item.urgency === 'medium' ? 'bg-yellow-500/5 border border-yellow-500/10' :
                      'bg-white/[0.02] border border-white/5'
                    }`}>
                      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                        item.type === 'lead' ? 'bg-blue-400' :
                        item.type === 'task' ? 'bg-purple-400' :
                        item.type === 'submission' ? 'bg-emerald-400' :
                        'bg-red-400'
                      }`} />
                      <span className="text-sm text-gray-300 flex-1 truncate">{item.text}</span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded shrink-0 ${
                        item.urgency === 'high' ? 'bg-red-500/15 text-red-400' :
                        item.urgency === 'medium' ? 'bg-yellow-500/15 text-yellow-400' :
                        'bg-gray-500/10 text-gray-500'
                      }`}>
                        {item.urgency === 'high' ? '紧急' : item.urgency === 'medium' ? '中等' : '普通'}
                      </span>
                    </div>
                  ))}
                  {(!dashboardData.todoList || dashboardData.todoList.length === 0) && (
                    <p className="text-xs text-gray-600 text-center py-4">暂无待办事项</p>
                  )}
                </div>
              </div>

              {/* 最近动态 */}
              <div className="bg-white/5 backdrop-blur-sm rounded-2xl border border-white/10 p-5">
                <h3 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
                  <span>最近动态</span>
                </h3>
                <div className="space-y-3">
                  {(dashboardData.recentFeed && dashboardData.recentFeed.length > 0 ? dashboardData.recentFeed : defaultFeed).map((item) => (
                    <div key={item.id} className="flex items-start gap-3 group">
                      <span className="text-base mt-0.5">{item.icon}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-gray-300 group-hover:text-white transition-colors">{item.text}</p>
                        <p className="text-[10px] text-gray-600 mt-0.5">{item.time}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* 快捷入口 */}
            <div className="bg-white/5 backdrop-blur-sm rounded-2xl border border-white/10 p-5 mb-8">
              <h3 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
                <span>快捷入口</span>
              </h3>
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                {[
                  { label: '数据中心', sub: '采集数据 / 线索 / 视频', href: '/data-center', icon: '📊', color: 'from-cyan-500/10 to-cyan-500/5 border-cyan-500/15 hover:border-cyan-500/30' },
                  { label: '创建内容', sub: 'AI 文案 / 视频合成', href: '/ai-copy', icon: '✨', color: 'from-blue-500/10 to-blue-500/5 border-blue-500/15 hover:border-blue-500/30' },
                  { label: '开启直播', sub: '直播间中控台', href: '/live', icon: '📺', color: 'from-red-500/10 to-red-500/5 border-red-500/15 hover:border-red-500/30' },
                  { label: '采集线索', sub: '自动采集 + AI 分析', href: '/lead-collector', icon: '🎯', color: 'from-emerald-500/10 to-emerald-500/5 border-emerald-500/15 hover:border-emerald-500/30' },
                  { label: '诊断报告', sub: '系统健康检测', href: '/admin/diagnostics', icon: '🏥', color: 'from-purple-500/10 to-purple-500/5 border-purple-500/15 hover:border-purple-500/30' },
                ].map((action) => (
                  <a
                    key={action.label}
                    href={action.href}
                    className={`group relative overflow-hidden rounded-xl bg-gradient-to-br ${action.color} border p-4 hover:shadow-lg transition-all`}
                  >
                    <span className="text-lg">{action.icon}</span>
                    <p className="text-sm font-medium text-white mt-2 group-hover:text-blue-300 transition-colors">{action.label}</p>
                    <p className="text-[10px] text-gray-500 mt-0.5">{action.sub}</p>
                  </a>
                ))}
              </div>
            </div>

            {/* 使用量统计 */}
            {dashboardData.usageSummary && (
              <div className="bg-white/5 backdrop-blur-sm rounded-2xl border border-white/10 p-5 mb-8">
                <h3 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
                  <span>AI 使用量</span>
                </h3>
                <div className="grid grid-cols-3 gap-4">
                  <div className="text-center p-3 bg-white/[0.02] rounded-xl">
                    <p className="text-2xl font-bold text-blue-400">{dashboardData.usageSummary.totalUsage}</p>
                    <p className="text-xs text-gray-500 mt-1">总调用次数</p>
                  </div>
                  <div className="text-center p-3 bg-white/[0.02] rounded-xl">
                    <p className="text-lg font-bold text-emerald-400">{dashboardData.usageSummary.topAction || '-'}</p>
                    <p className="text-xs text-gray-500 mt-1">最常用功能</p>
                  </div>
                  <div className="text-center p-3 bg-white/[0.02] rounded-xl">
                    <p className="text-2xl font-bold text-purple-400">{(dashboardData.usageSummary.tokenUsed / 1000).toFixed(0)}K</p>
                    <p className="text-xs text-gray-500 mt-1">Token 消耗</p>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
