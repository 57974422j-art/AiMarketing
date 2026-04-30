'use client';
import { useState, useEffect } from 'react'

interface PlatformStat {
  platform: string
  followers: number
  publishCount: number
  engagementRate: number
  growthRate: number
}

interface DashboardData {
  totalFollowers: number
  totalPublishCount: number
  averageEngagementRate: number
  platformStats: PlatformStat[]
}

const platformMap: Record<string, { cn: string; en: string }> = {
  'douyin': { cn: '抖音', en: 'DOUYIN' },
  'kuaishou': { cn: '快手', en: 'KUAISHOU' },
  'xiaohongshu': { cn: '小红书', en: 'XIAOHONGSHU' },
  'weibo': { cn: '微博', en: 'WEIBO' }
};

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
    const p = platformMap[platform.toLowerCase()] || { cn: platform, en: platform };
    return <><span>{p.cn}</span><span className="text-xs opacity-50 ml-1">{p.en}</span></>;
  };

  return (
    <div className="min-h-screen bg-gray-950">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-8">
          <p className="text-label mb-2">总览 / OVERVIEW</p>
          <h1 className="text-mono-lg text-white">仪表盘 / DASHBOARD</h1>
        </div>
        
        {loading ? (
          <div className="flex items-center justify-center h-64">
            <div className="text-center">
              <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-400"></div>
              <p className="mt-2 text-gray-400 text-sm">
                <span>加载中</span>
                <span className="text-xs opacity-50 ml-1">/ LOADING...</span>
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
                      <span className="opacity-50 ml-1">/ FOLLOWERS</span>
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
                  <span className="text-sm text-gray-500 ml-2">较上月 / vs last month</span>
                </div>
              </div>
              
              <div className="bg-white/5 backdrop-blur-sm rounded-2xl border border-white/10 p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-gray-400">
                      <span>总发布量</span>
                      <span className="opacity-50 ml-1">/ PUBLISH</span>
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
                  <span className="text-sm text-gray-500 ml-2">较上月 / vs last month</span>
                </div>
              </div>
              
              <div className="bg-white/5 backdrop-blur-sm rounded-2xl border border-white/10 p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-gray-400">
                      <span>平均互动率</span>
                      <span className="opacity-50 ml-1">/ ENGAGEMENT</span>
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
                  <span className="text-sm text-gray-500 ml-2">较上月 / vs last month</span>
                </div>
              </div>
            </div>
            
            <div className="bg-white/5 backdrop-blur-sm rounded-2xl border border-white/10 p-6">
              <h2 className="text-xl font-semibold text-white mb-6">
                <span>平台数据详情</span>
                <span className="text-sm opacity-50 ml-1">/ PLATFORM STATS</span>
              </h2>
              
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-white/10">
                  <thead className="bg-white/5">
                    <tr>
                      <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                        <span>平台</span>
                        <span className="opacity-50 ml-1">PLATFORM</span>
                      </th>
                      <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                        <span>粉丝数</span>
                        <span className="opacity-50 ml-1">FOLLOWERS</span>
                      </th>
                      <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                        <span>发布量</span>
                        <span className="opacity-50 ml-1">PUBLISH</span>
                      </th>
                      <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                        <span>互动率</span>
                        <span className="opacity-50 ml-1">RATE</span>
                      </th>
                      <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                        <span>增长率</span>
                        <span className="opacity-50 ml-1">GROWTH</span>
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
      </div>
    </div>
  )
}
