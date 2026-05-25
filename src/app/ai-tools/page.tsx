'use client'
import { useAuth } from '@/app/providers'
import Link from 'next/link'

const cards = [
  // 视频创作区
  { icon: '🎬', title: '视频剪辑', desc: '1080P 视频剪辑引擎 / 混剪 / 拼接 / 故事板', href: '/video-edit', color: 'from-purple-500/20' },
  { icon: '🎤', title: '文字转视频', desc: 'AI 文生视频 / 长视频 / 分段生成', href: '/text-to-video', color: 'from-blue-500/20' },
  { icon: '🧑', title: '数字人', desc: '数字人训练 / 口播生成 / 上传录音', href: '/digital-human', color: 'from-cyan-500/20' },

  // 内容创作区
  { icon: '✍️', title: 'AI 文案', desc: '智能文案生成 / 多风格 / 批量写作', href: '/ai-copy', color: 'from-emerald-500/20' },
  { icon: '🖼️', title: 'AI 生图', desc: '文生图 / 图生图 / 风格迁移', href: '/image-generator', color: 'from-orange-500/20' },
  { icon: '🤖', title: 'AI 智能体', desc: 'AI 客服 / 问答 / 对话机器人', href: '/ai-agent', color: 'from-pink-500/20' },

  // 运营引流区
  { icon: '📱', title: 'NFC 引流', desc: 'NFC 规则管理 / 触发配置 / 数据分析', href: '/nfc-promo', color: 'from-yellow-500/20' },
  { icon: '🔗', title: '导流配置', desc: '多平台导流 / 自动回复 / 关键词引流', href: '/referral', color: 'from-rose-500/20' },
  { icon: '📋', title: '意向采集', desc: '线索采集 / 客户管理 / 跟进记录', href: '/lead-collector', color: 'from-indigo-500/20' },

  // 项目管理区
  { icon: '📂', title: '项目列表', desc: '项目管理和进度跟踪', href: '/projects', color: 'from-emerald-500/20' },
  { icon: '📡', title: '仪表盘', desc: '数据统计 / 粉丝增长 / 互动分析', href: '/dashboard', color: 'from-teal-500/20' },
  { icon: '🔑', title: '账号管理', desc: '多平台账号绑定 / 状态管理', href: '/accounts', color: 'from-violet-500/20' },
  { icon: '🤖', title: '自动化脚本', desc: '脚本模板 / 任务编排 / 一键执行', href: '/admin/automation-templates', color: 'from-emerald-500/20' },
  { icon: '📱', title: '本地自动化', desc: '本地设备一键执行 / 点赞评论搜索', href: '/my-automation', color: 'from-cyan-500/20' },
]

export default function AiToolsPage() {
  const { user } = useAuth()

  return (
    <div className="min-h-screen bg-gray-950">
      <div className="max-w-7xl mx-auto px-4 py-8">
        <div className="mb-8">
          <p className="text-label mb-2">AI TOOLS</p>
          <h1 className="text-mono-lg text-white">AI 工具集</h1>
          <p className="text-gray-400 text-sm mt-1">
            {user?.username || '用户'} · {user?.role === 'admin' ? '超级管理员' : user?.role === 'editor' ? '运营编辑' : '终端用户'}
          </p>
        </div>

        {/* 视频创作 */}
        <div className="mb-8">
          <h2 className="text-white font-bold mb-4 flex items-center gap-2">
            <span className="w-1 h-5 bg-emerald-400 rounded-full inline-block" />
            视频创作
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {cards.filter(c => ['视频剪辑', '文字转视频', '数字人'].includes(c.title)).map(card => (
              <Link key={card.href} href={card.href} className="card-bento group cursor-pointer block bg-gradient-to-br ${card.color} to-transparent">
                <div className="text-3xl mb-3">{card.icon}</div>
                <h3 className="text-white font-bold mb-1 group-hover:text-emerald-400 transition-colors">{card.title}</h3>
                <p className="text-gray-400 text-sm">{card.desc}</p>
              </Link>
            ))}
          </div>
        </div>

        {/* 内容创作 */}
        <div className="mb-8">
          <h2 className="text-white font-bold mb-4 flex items-center gap-2">
            <span className="w-1 h-5 bg-cyan-400 rounded-full inline-block" />
            内容创作
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {cards.filter(c => ['AI 文案', 'AI 生图', 'AI 智能体'].includes(c.title)).map(card => (
              <Link key={card.href} href={card.href} className="card-bento group cursor-pointer block">
                <div className="text-3xl mb-3">{card.icon}</div>
                <h3 className="text-white font-bold mb-1 group-hover:text-emerald-400 transition-colors">{card.title}</h3>
                <p className="text-gray-400 text-sm">{card.desc}</p>
              </Link>
            ))}
          </div>
        </div>

        {/* 运营引流 */}
        <div className="mb-8">
          <h2 className="text-white font-bold mb-4 flex items-center gap-2">
            <span className="w-1 h-5 bg-orange-400 rounded-full inline-block" />
            运营引流
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {cards.filter(c => ['NFC 引流', '导流配置', '意向采集'].includes(c.title)).map(card => (
              <Link key={card.href} href={card.href} className="card-bento group cursor-pointer block">
                <div className="text-3xl mb-3">{card.icon}</div>
                <h3 className="text-white font-bold mb-1 group-hover:text-emerald-400 transition-colors">{card.title}</h3>
                <p className="text-gray-400 text-sm">{card.desc}</p>
              </Link>
            ))}
          </div>
        </div>

        {/* 数据管理 */}
        <div className="mb-8">
          <h2 className="text-white font-bold mb-4 flex items-center gap-2">
            <span className="w-1 h-5 bg-violet-400 rounded-full inline-block" />
            数据管理
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {cards.filter(c => ['项目列表', '仪表盘', '账号管理'].includes(c.title)).map(card => (
              <Link key={card.href} href={card.href} className="card-bento group cursor-pointer block">
                <div className="text-3xl mb-3">{card.icon}</div>
                <h3 className="text-white font-bold mb-1 group-hover:text-emerald-400 transition-colors">{card.title}</h3>
                <p className="text-gray-400 text-sm">{card.desc}</p>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
