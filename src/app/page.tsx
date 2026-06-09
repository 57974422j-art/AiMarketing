'use client'
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/app/providers'
import Link from 'next/link'

export default function Home() {
  const router = useRouter()
  const { user, loading } = useAuth()

  useEffect(() => {
    if (!loading && user) {
      router.replace('/workspace')
    }
  }, [user, loading, router])

  // 已登录 → 跳转中（短暂显示）
  if (!loading && user) {
    return (
      <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center">
        <div className="text-center">
          <p className="text-emerald-400 font-mono animate-pulse">正在进入工作台...</p>
        </div>
      </div>
    )
  }

  // 未登录 / 加载中 → 显示着陆页
  return (
    <div className="min-h-screen bg-[#0a0a0f]">
      {/* Hero */}
      <div className="max-w-5xl mx-auto px-4 pt-20 pb-16 text-center">
        <h1 className="text-4xl md:text-5xl font-bold text-white mb-4">
          AI营销平台 <span className="text-emerald-400">//</span> 新一代
        </h1>
        <p className="text-lg text-gray-400 max-w-2xl mx-auto mb-10">
          一站式短视频营销操作系统 · AI生成 · 多平台发布 · 智能数据分析
        </p>
        <Link
          href="/login"
          className="inline-block px-8 py-3.5 bg-emerald-500 hover:bg-emerald-600 text-white rounded-xl font-mono transition-colors"
        >
          登录使用 →
        </Link>
      </div>

      {/* 功能展示 */}
      <div className="max-w-6xl mx-auto px-4 py-12">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <Link href="/ai-copy" className="group block border border-gray-800/50 rounded-2xl p-8 hover:border-blue-500/30 hover:bg-blue-500/5 transition-all">
            <span className="text-3xl mb-4 block">✍️</span>
            <h3 className="text-white font-semibold text-lg mb-2 group-hover:text-blue-300 transition-colors">AI 文案</h3>
            <p className="text-gray-400 text-sm">智能生成营销文案，支持抖音/小红书等多平台多风格</p>
          </Link>
          <Link href="/auto-compile" className="group block border border-gray-800/50 rounded-2xl p-8 hover:border-cyan-500/30 hover:bg-cyan-500/5 transition-all">
            <span className="text-3xl mb-4 block">🎬</span>
            <h3 className="text-white font-semibold text-lg mb-2 group-hover:text-cyan-300 transition-colors">一键成片</h3>
            <p className="text-gray-400 text-sm">输入文案+图片自动合成视频，TTS配音字幕一键输出</p>
          </Link>
          <Link href="/video-edit" className="group block border border-gray-800/50 rounded-2xl p-8 hover:border-orange-500/30 hover:bg-orange-500/5 transition-all">
            <span className="text-3xl mb-4 block">✂️</span>
            <h3 className="text-white font-semibold text-lg mb-2 group-hover:text-orange-300 transition-colors">视频剪辑</h3>
            <p className="text-gray-400 text-sm">1080P视频剪辑引擎，混剪/拼接/故事板模板后期处理</p>
          </Link>
        </div>
      </div>

      {/* 底部 */}
      <div className="max-w-6xl mx-auto px-4 py-16 text-center border-t border-gray-800/30">
        <p className="text-gray-600 text-sm font-mono">AI Marketing Platform &copy; 2026</p>
      </div>
    </div>
  )
}
