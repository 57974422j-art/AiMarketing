'use client'
import { useState, useEffect } from 'react'
import { useAuth } from '@/app/providers'
import Link from 'next/link'

interface FeatureStatus {
  available: boolean
  type: 'free' | 'paid'
  limit?: number
  used?: number
  remaining?: number
  usedCount?: number
}

interface WorkspaceData {
  name: string
  role: string
  isAdmin: boolean
  features: Record<string, FeatureStatus>
  serviceQrcode: string
}

const featureCards = [
  {
    id: 'aiCopy',
    title: 'AI 文案',
    desc: '智能生成营销文案，支持抖音/小红书/快手等多平台多风格',
    icon: '✍️',
    color: 'from-blue-500/20 to-blue-600/10 border-blue-500/30',
    hoverColor: 'hover:border-blue-400/50 hover:shadow-blue-500/10',
    path: '/ai-copy',
    badge: '每日免费5次',
    badgeColor: 'bg-emerald-500/20 text-emerald-400',
  },
  {
    id: 'textToVideo',
    title: '文生视频',
    desc: 'AI文字描述生成视频，支持短视频和长视频模式',
    icon: '🎬',
    color: 'from-purple-500/20 to-purple-600/10 border-purple-500/30',
    hoverColor: 'hover:border-purple-400/50 hover:shadow-purple-500/10',
    path: '/text-to-video',
    badge: '付费功能',
    badgeColor: 'bg-amber-500/20 text-amber-400',
  },
  {
    id: 'imageGenerator',
    title: 'AI 生图',
    desc: '文字描述生成图片，多种风格和尺寸可选',
    icon: '🎨',
    color: 'from-pink-500/20 to-pink-600/10 border-pink-500/30',
    hoverColor: 'hover:border-pink-400/50 hover:shadow-pink-500/10',
    path: '/image-generator',
    badge: '付费功能',
    badgeColor: 'bg-amber-500/20 text-amber-400',
  },
  {
    id: 'videoEdit',
    title: '一键成片',
    desc: '视频后期处理：TTS配音、字幕烧录、翻译、换脸等',
    icon: '🎞️',
    color: 'from-cyan-500/20 to-cyan-600/10 border-cyan-500/30',
    hoverColor: 'hover:border-cyan-400/50 hover:shadow-cyan-500/10',
    path: '/video-edit',
    badge: '免费使用',
    badgeColor: 'bg-sky-500/20 text-sky-400',
  },
]

export default function WorkspacePage() {
  const { user } = useAuth()
  const [data, setData] = useState<WorkspaceData | null>(null)
  const [loading, setLoading] = useState(true)
  const [showQrcodeModal, setShowQrcodeModal] = useState(false)

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

  const getCard = (card: typeof featureCards[0]) => {
    const feat = data?.features?.[card.id]
    if (!feat) return null

    // 已开通 / 可用
    if (feat.available) {
      return (
        <Link key={card.id} href={card.path} className={`group block bg-gradient-to-br ${card.color} border rounded-2xl p-6 transition-all duration-300 ${card.hoverColor} hover:shadow-lg`}>
          <div className="flex items-start justify-between mb-4">
            <span className="text-4xl">{card.icon}</span>
            <span className={`text-xs px-2 py-1 rounded-full font-mono ${card.badgeColor}`}>
              {feat.type === 'free' && card.id === 'aiCopy'
                ? `今日剩余 ${feat.remaining}/${feat.limit}`
                : card.badge}
            </span>
          </div>
          <h3 className="text-white font-semibold text-lg mb-2 group-hover:text-blue-300 transition-colors">{card.title}</h3>
          <p className="text-gray-400 text-sm leading-relaxed">{card.desc}</p>
          {feat.usedCount !== undefined && feat.usedCount > 0 && (
            <p className="text-xs text-gray-500 mt-3 font-mono">已使用 {feat.usedCount} 次</p>
          )}
        </Link>
      )
    }

    // 未开通（付费功能锁定）
    return (
      <div key={card.id} onClick={() => setShowQrcodeModal(true)}
        className={`group cursor-pointer bg-gradient-to-br ${card.color} border border-dashed border-red-500/30 rounded-2xl p-6 transition-all duration-300 hover:border-red-500/50 opacity-70 hover:opacity-100 relative overflow-hidden`}>
        {/* 锁定遮罩 */}
        <div className="absolute inset-0 bg-black/40 backdrop-blur-[1px] flex flex-col items-center justify-center z-10">
          <span className="text-4xl mb-2">🔒</span>
          <p className="text-white/90 text-sm font-medium">该功能需要充值开通</p>
          <p className="text-gray-400 text-xs mt-1">点击查看联系方式</p>
        </div>
        <div className="flex items-start justify-between mb-4">
          <span className="text-4xl grayscale">{card.icon}</span>
          <span className="text-xs px-2 py-1 rounded-full font-mono bg-red-500/20 text-red-400">
            未开通
          </span>
        </div>
        <h3 className="text-white/60 font-semibold text-lg mb-2">{card.title}</h3>
        <p className="text-gray-500 text-sm leading-relaxed">{card.desc}</p>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#0a0a0f]">
      {/* 头部 */}
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 pt-8 pb-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs text-gray-500 font-mono tracking-wider mb-1">WORKSPACE</p>
            <h1 className="text-2xl font-bold text-white">
              你好{data?.name ? `，${data.name}` : ''} 👋
            </h1>
            <p className="text-gray-400 text-sm mt-1">选择你需要的功能</p>
          </div>
          {user?.role === 'admin' && (
            <Link href="/admin/settings"
              className="text-xs font-mono text-gray-400 hover:text-white px-3 py-2 rounded-lg border border-gray-700/50 hover:border-gray-600 transition-colors">
              ⚙️ 系统设置
            </Link>
          )}
        </div>
      </div>

      {/* 功能卡片 */}
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {featureCards.map(card => getCard(card))}
        </div>
      </div>

      {/* 底部提示 */}
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="border-t border-gray-800/50 pt-8 text-center">
          <p className="text-gray-500 text-sm font-mono">
            需要帮助？联系客服获取支持
          </p>
          {data?.serviceQrcode ? (
            <button onClick={() => setShowQrcodeModal(true)}
              className="mt-3 inline-flex items-center gap-2 text-sm text-gray-400 hover:text-white transition-colors">
              📱 查看客服二维码
            </button>
          ) : (
            <p className="mt-3 text-xs text-gray-600">暂无客服信息</p>
          )}
        </div>
      </div>

      {/* 客服二维码弹窗 */}
      {showQrcodeModal && data?.serviceQrcode && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setShowQrcodeModal(false)}>
          <div className="bg-gray-900 border border-gray-700/50 rounded-2xl p-8 max-w-sm w-full mx-4 shadow-2xl" onClick={e => e.stopPropagation()}>
            <h3 className="text-white text-lg font-semibold text-center mb-2">联系客服</h3>
            <p className="text-gray-400 text-sm text-center mb-6">扫码添加客服微信，咨询功能开通</p>
            <div className="flex justify-center">
              <img src={data.serviceQrcode} alt="客服微信二维码" className="w-52 h-52 object-contain rounded-xl bg-white p-2" />
            </div>
            <button onClick={() => setShowQrcodeModal(false)}
              className="w-full mt-6 py-2.5 text-sm font-mono text-gray-400 hover:text-white border border-gray-700/50 hover:border-gray-600 rounded-xl transition-colors">
              关闭
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
