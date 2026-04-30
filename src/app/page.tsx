import './globals.css'
import Link from 'next/link'

export default function Home() {
  return (
    <div className="min-h-screen bg-gray-950">
      <div className="container-main max-w-7xl mx-auto">
        <div className="text-center mb-16 pt-12">
          <p className="text-label mb-4">系统已就绪 / SYSTEM INITIALIZED</p>
          <h1 className="text-mono-lg text-white mb-4">
            AIMARKETING <span className="text-emerald-400">//</span> NEXT GEN
          </h1>
          <p className="text-lg text-gray-400 max-w-2xl mx-auto">
            一站式短视频营销操作系统 / 集成 AI 生成 / 多平台发布 / 智能数据分析
          </p>
        </div>

        <div className="grid-bento mb-12">
          <div className="card-bento flex flex-col justify-center items-center text-center animate-float">
            <p className="text-label mb-2">视频处理 / VIDEO PROCESSING</p>
            <p className="text-mono-lg text-emerald-400 mb-2">1080P</p>
            <p className="text-mono-sm text-gray-500">视频剪辑引擎已就绪</p>
          </div>

          <div className="card-bento grid-bento-tall">
            <p className="text-label mb-4">AI 模块 / AI MODULES</p>
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <span className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse"></span>
                <span className="text-mono-sm text-gray-300">文案生成引擎</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse"></span>
                <span className="text-mono-sm text-gray-300">数字员工系统</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse"></span>
                <span className="text-mono-sm text-gray-300">意向采集模块</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse"></span>
                <span className="text-mono-sm text-gray-300">导流配置中心</span>
              </div>
            </div>
          </div>

          <div className="card-bento flex flex-col justify-center items-center text-center">
            <p className="text-label mb-2">账号 / ACCOUNTS</p>
            <p className="text-mono-lg text-emerald-400 mb-2">03</p>
            <p className="text-mono-sm text-gray-500">已接入平台</p>
          </div>

          <div className="card-bento flex flex-col justify-center items-center text-center">
            <p className="text-label mb-2">配额 / QUOTA</p>
            <p className="text-mono-lg text-emerald-400 mb-2">∞</p>
            <p className="text-mono-sm text-gray-500">本月配额</p>
          </div>

          <div className="card-bento flex flex-col justify-center items-center text-center">
            <p className="text-label mb-2">系统状态 / SYSTEM STATUS</p>
            <div className="flex items-center gap-2 mb-2">
              <span className="w-3 h-3 bg-emerald-400 rounded-full animate-pulse-glow"></span>
              <span className="text-mono text-emerald-400">ONLINE</span>
            </div>
            <p className="text-mono-sm text-gray-500">所有服务运行正常</p>
          </div>

          <div className="card-bento flex flex-col justify-center items-center text-center">
            <p className="text-label mb-2">项目 / PROJECTS</p>
            <p className="text-mono-lg text-emerald-400 mb-2">00</p>
            <p className="text-mono-sm text-gray-500">进行中</p>
          </div>
        </div>

        <div className="text-center">
          <Link
            href="/login"
            className="btn-primary text-lg px-8 py-3 inline-block hover:bg-emerald-600 transition-all"
          >
            启动系统 →
          </Link>
        </div>

        <div className="mt-16 grid grid-cols-1 md:grid-cols-3 gap-6">
          <Link href="/video-edit" className="card-bento group">
            <div className="flex items-center gap-4 mb-4">
              <div className="w-12 h-12 bg-emerald-500/20 rounded-xl flex items-center justify-center group-hover:bg-emerald-500/30 transition-colors">
                <svg className="w-6 h-6 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
              </div>
              <div>
                <p className="text-label">MODULE_01</p>
                <p className="text-lg font-semibold text-white">视频剪辑</p>
              </div>
            </div>
            <p className="text-mono-sm text-gray-400">FFmpeg 驱动 / 支持混剪 / 快剪 / 故事板</p>
          </Link>

          <Link href="/ai-copy" className="card-bento group">
            <div className="flex items-center gap-4 mb-4">
              <div className="w-12 h-12 bg-emerald-500/20 rounded-xl flex items-center justify-center group-hover:bg-emerald-500/30 transition-colors">
                <svg className="w-6 h-6 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                </svg>
              </div>
              <div>
                <p className="text-label">MODULE_02</p>
                <p className="text-lg font-semibold text-white">AI 文案</p>
              </div>
            </div>
            <p className="text-mono-sm text-gray-400">多平台适配 / 风格可选 / 批量生成</p>
          </Link>

          <Link href="/ai-agent" className="card-bento group">
            <div className="flex items-center gap-4 mb-4">
              <div className="w-12 h-12 bg-emerald-500/20 rounded-xl flex items-center justify-center group-hover:bg-emerald-500/30 transition-colors">
                <svg className="w-6 h-6 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                </svg>
              </div>
              <div>
                <p className="text-label">MODULE_03</p>
                <p className="text-lg font-semibold text-white">AI 员工</p>
              </div>
            </div>
            <p className="text-mono-sm text-gray-400">知识库训练 / 智能问答 / 多角色支持</p>
          </Link>
        </div>
      </div>
    </div>
  )
}