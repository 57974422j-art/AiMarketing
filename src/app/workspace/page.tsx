'use client'
import { useState, useEffect } from 'react'
import { useAuth } from '@/app/providers'
import Link from 'next/link'

interface WorkspaceData {
  name: string
  role: string
  isAdmin: boolean
  features: {
    aiCopy: { limit: number; used: number; remaining: number }
    videoEdit: { usedCount: number }
  }
}

// 终端用户工作台 — 6个功能入口
const featureCards = [
  {
    id: 'aiCopy',
    title: 'AI 文案',
    desc: '智能生成营销文案，支持抖音/小红书/快手等多平台多风格',
    icon: '\u270D\uFE0F',
    color: 'from-blue-500/20 to-blue-600/10 border-blue-500/30',
    hoverColor: 'hover:border-blue-400/50 hover:shadow-blue-500/10',
    path: '/ai-copy',
    badgeKey: 'aiCopy', // 显示配额
    badgeDefault: '免费使用',
    badgeColor: 'bg-emerald-500/20 text-emerald-400',
  },
  {
    id: 'autoCompile',
    title: '一键成片',
    desc: '输入文案+图片自动合成视频，支持TTS配音、字幕烧录、多比例输出',
    icon: '\uD83C\uDFA5',
    color: 'from-cyan-500/20 to-cyan-600/10 border-cyan-500/30',
    hoverColor: 'hover:border-cyan-400/50 hover:shadow-cyan-500/10',
    path: '/auto-compile',
    badgeDefault: '免费使用',
    badgeColor: 'bg-sky-500/20 text-sky-400',
  },
  {
    id: 'storage',
    title: '个人仓库',
    desc: '素材文件管理，上传图片/视频，查看存储空间和已保存的内容',
    icon: '\uD83D\uDCC1',
    color: 'from-emerald-500/20 to-emerald-600/10 border-emerald-500/30',
    hoverColor: 'hover:border-emerald-400/50 hover:shadow-emerald-500/10',
    path: '/storage',
    badgeDefault: '素材管理',
    badgeColor: 'bg-emerald-500/20 text-emerald-400',
  },
  {
    id: 'subscription',
    title: '我的套餐',
    desc: '查看当前订阅、本月用量、购买或升级套餐',
    icon: '💳',
    color: 'from-amber-500/20 to-amber-600/10 border-amber-500/30',
    hoverColor: 'hover:border-amber-400/50 hover:shadow-amber-500/10',
    path: '/my-subscription',
    badgeDefault: '套餐中心',
    badgeColor: 'bg-amber-500/20 text-amber-400',
  },
  {
    id: 'fingerprint',
    title: '指纹浏览器',
    desc: '本地Chromium多窗口管理，支持抖音/小红书/快手/B站自动化操作',
    icon: '\uD83C\uDF0E',
    color: 'from-violet-500/20 to-violet-600/10 border-violet-500/30',
    hoverColor: 'hover:border-violet-400/50 hover:shadow-violet-500/10',
    path: '/my-fingerprint',
    badgeDefault: '需要客户端',
    badgeColor: 'bg-violet-500/20 text-violet-400',
  },
  {
    id: 'dashboard',
    title: '仪表盘',
    desc: '数据总览：粉丝统计、发布量、互动率、平台数据一览',
    icon: '\uD83D\uDCCA',
    color: 'from-rose-500/20 to-rose-600/10 border-rose-500/30',
    hoverColor: 'hover:border-rose-400/50 hover:shadow-rose-500/10',
    path: '/dashboard',
    badgeDefault: '数据概览',
    badgeColor: 'bg-rose-500/20 text-rose-400',
  },
  {
    id: 'accounts',
    title: '账号管理',
    desc: '多平台账号绑定与状态管理，支持抖音/小红书/快手等平台',
    icon: '\uD83D\uDCBC',
    color: 'from-teal-500/20 to-teal-600/10 border-teal-500/30',
    hoverColor: 'hover:border-teal-400/50 hover:shadow-teal-500/10',
    path: '/accounts',
    badgeDefault: '账号中心',
    badgeColor: 'bg-teal-500/20 text-teal-400',
  },
  {
    id: 'textToVideo',
    title: '文生视频',
    desc: '输入描述文字，AI 一键生成高质量短视频',
    icon: '🎬',
    color: 'from-purple-500/20 to-purple-600/10 border-purple-500/30',
    hoverColor: 'hover:border-purple-400/50 hover:shadow-purple-500/10',
    path: '/text-to-video',
    badgeDefault: 'AI 生成',
    badgeColor: 'bg-purple-500/20 text-purple-400',
  },
  {
    id: 'imageGenerator',
    title: 'AI 生图',
    desc: '文字描述生成高质量图片，支持多风格、多尺寸输出',
    icon: '🎨',
    color: 'from-pink-500/20 to-pink-600/10 border-pink-500/30',
    hoverColor: 'hover:border-pink-400/50 hover:shadow-pink-500/10',
    path: '/image-generator',
    badgeDefault: 'AI 生成',
    badgeColor: 'bg-pink-500/20 text-pink-400',
  },
  {
    id: 'digitalHuman',
    title: '数字人',
    desc: '上传真人视频训练数字分身，AI 口播配音自动生成',
    icon: '🤖',
    color: 'from-orange-500/20 to-orange-600/10 border-orange-500/30',
    hoverColor: 'hover:border-orange-400/50 hover:shadow-orange-500/10',
    path: '/digital-human',
    badgeDefault: '形象克隆',
    badgeColor: 'bg-orange-500/20 text-orange-400',
  },
  {
    id: 'myAutomation',
    title: '我的自动化',
    desc: '配置定时任务、自动发布、批量操作，解放双手',
    icon: '⚙️',
    color: 'from-indigo-500/20 to-indigo-600/10 border-indigo-500/30',
    hoverColor: 'hover:border-indigo-400/50 hover:shadow-indigo-500/10',
    path: '/my-automation',
    badgeDefault: '自动化',
    badgeColor: 'bg-indigo-500/20 text-indigo-400',
  },
  {
    id: 'trendVideo',
    title: '趋势猎手',
    desc: 'AI 实时搜索全球热门趋势，爆款深度分析，批量合成视频',
    icon: '🔍',
    color: 'from-yellow-500/20 to-yellow-600/10 border-yellow-500/30',
    hoverColor: 'hover:border-yellow-400/50 hover:shadow-yellow-500/10',
    path: '/trendvideo',
    badgeDefault: 'NEW',
    badgeColor: 'bg-yellow-500/20 text-yellow-400',
  },
]

export default function WorkspacePage() {
  const { user } = useAuth()
  const [data, setData] = useState<WorkspaceData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/workspace/status', { credentials: 'include' })
      .then(res => res.json())
      .then(result => {
        if (result.success) setData(result.data)
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  if (loading) return (
    <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center">
      <p className="text-gray-400 font-mono">加载中...</p>
    </div>
  )

  const getBadgeText = (card: typeof featureCards[0]) => {
    if (!card.badgeKey || !data) return card.badgeDefault
    if (card.badgeKey === 'aiCopy') return `今日剩余 ${data.features.aiCopy.remaining}/${data.features.aiCopy.limit}`
    return card.badgeDefault
  }

  const renderCard = (card: typeof featureCards[0]) => (
    <Link key={card.id} href={card.path}
      className={`group block bg-gradient-to-br ${card.color} border rounded-2xl p-6 transition-all duration-300 ${card.hoverColor} hover:shadow-lg`}>
      <div className="flex items-start justify-between mb-4">
        <span className="text-4xl">{card.icon}</span>
        <span className={`text-xs px-2 py-1 rounded-full font-mono ${card.badgeColor}`}>
          {getBadgeText(card)}
        </span>
      </div>
      <h3 className="text-white font-semibold text-lg mb-2 group-hover:text-blue-300 transition-colors">{card.title}</h3>
      <p className="text-gray-400 text-sm leading-relaxed">{card.desc}</p>
    </Link>
  )

  const allCards = featureCards

  return (
    <div className="min-h-screen bg-[#0a0a0f]">
      {/* 头部 */}
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 pt-8 pb-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs text-gray-500 font-mono tracking-wider mb-1">WORKSPACE</p>
            <h1 className="text-2xl font-bold text-white">
              你好{data?.name ? `，${data.name}` : ''} \uD83D\uDC4B
            </h1>
            <p className="text-gray-400 text-sm mt-1">选择你需要的功能</p>
          </div>
          {(user?.role === 'admin' || user?.role === 'editor') && (
            <Link href="/admin/settings"
              className="text-xs font-mono text-gray-400 hover:text-white px-3 py-2 rounded-lg border border-gray-700/50 hover:border-gray-600 transition-colors">
              ⚙️ 系统设置
            </Link>
          )}
        </div>
      </div>

      {/* 功能卡片 */}
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {allCards.map(card => renderCard(card))}
        </div>
      </div>

      {/* 底部提示 */}
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="border-t border-gray-800/50 pt-8 text-center">
          <p className="text-gray-500 text-sm font-mono">
            需要帮助？联系客服获取支持
          </p>
        </div>
      </div>
    </div>
  )
}
