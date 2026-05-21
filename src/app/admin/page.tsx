'use client'
import { useAuth } from '@/app/providers'
import { useRouter } from 'next/navigation'
import { useEffect } from 'react'

interface CardItem {
  title: string
  desc: string
  href: string
  icon: string
  roles: string[]
}

interface CardSection { title: string; items: CardItem[] }

const sections: CardSection[] = [
  {
    title: '运营管理',
    items: [
      { title: '数据看板', desc: '实时统计：发布数、粉丝增长、成功率', href: '/admin/dashboard', icon: '📊', roles: ['admin', 'editor'] },
      { title: '设备管理', desc: '管理设备池、查看设备状态', href: '/admin/devices', icon: '🖥️', roles: ['admin', 'editor'] },
      { title: '社交账号', desc: '绑定/管理社交平台账号', href: '/admin/social-accounts', icon: '🔗', roles: ['admin', 'editor'] },
      { title: '任务执行', desc: '设备状态监控、执行任务', href: '/admin/automation', icon: '⚡', roles: ['admin', 'editor'] },
      { title: '素材审核', desc: '审核终端客户提交的视频素材', href: '/admin/content-submissions', icon: '📋', roles: ['admin', 'editor', 'end-user'] },
    ],
  },
  {
    title: '资源库',
    items: [
      { title: '视频素材库', desc: '上传和管理 OSS 视频素材', href: '/admin/media-library', icon: '🎬', roles: ['admin', 'editor'] },
      { title: 'POI 地址库', desc: '管理推广定位地址', href: '/admin/poi-addresses', icon: '📍', roles: ['admin', 'editor'] },
      { title: '话术模板', desc: '评论/私信/直播互动话术', href: '/admin/script-templates', icon: '💬', roles: ['admin', 'editor'] },
      { title: '账号分组', desc: '对社交账号进行分类管理', href: '/admin/account-groups', icon: '📁', roles: ['admin', 'editor'] },
      { title: '任务模板', desc: '配置自动任务（关键词/时间/动作）', href: '/admin/automation-templates', icon: '📋', roles: ['admin', 'editor'] },
      { title: '提示词模板库', desc: 'AI 生图提示词模板管理', href: '/admin/prompt-templates', icon: '🖼️', roles: ['admin', 'editor'] },
    ],
  },
  {
    title: '系统管理',
    items: [
      { title: 'Q1 管理', desc: '管理 Q1 物理机、扫描窗口容器', href: '/admin/phy-devices', icon: '📡', roles: ['admin', 'editor'] },
      { title: '客户管理', desc: '管理二级客户、分配窗口配额', href: '/admin/users', icon: '👥', roles: ['admin'] },
      { title: '邀请码管理', desc: '生成和管理注册邀请码', href: '/admin/invite-codes', icon: '🔑', roles: ['admin', 'editor'] },
      { title: '模板审核', desc: '审核文案模板的提交', href: '/admin/review', icon: '📝', roles: ['admin'] },
      { title: '系统设置', desc: 'AI API Key、OSS、TTS 配置', href: '/admin/settings', icon: '⚙️', roles: ['admin'] },
    ],
  },
]

export default function AdminDashboardPage() {
  const { user, loading } = useAuth()
  const router = useRouter()

  useEffect(() => {
    if (!loading && !user) {
      router.push('/login')
    }
  }, [loading, user, router])

  if (loading || !user) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="text-gray-400">加载中...</div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-950">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-8">
          <p className="text-label mb-2">管理后台 / ADMIN</p>
          <h1 className="text-mono-lg text-white">
            {user.role === 'admin' ? '平台管理 / PLATFORM ADMIN' : user.role === 'editor' ? '客户管理 / CLIENT DASHBOARD' : '我的提交 / MY SUBMISSIONS'}
          </h1>
          <p className="text-gray-400 text-sm mt-2">
            欢迎回来，<span className="text-emerald-400">{user.username}</span>
            {' · '}角色：<span className="text-white">{user.role}</span>
          </p>
        </div>

        {sections.map((section) => {
          const visibleItems = section.items.filter((c) => c.roles.includes(user.role))
          if (visibleItems.length === 0) return null
          return (
            <div key={section.title} className="mb-8">
              <h2 className="text-mono-sm text-gray-500 uppercase tracking-wider mb-4">{section.title}</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {visibleItems.map((card) => (
                  <a key={card.href} href={card.href} className="card-bento group cursor-pointer block">
                    <div className="text-3xl mb-3">{card.icon}</div>
                    <h3 className="text-white font-bold mb-1 group-hover:text-emerald-400 transition-colors">{card.title}</h3>
                    <p className="text-gray-400 text-sm">{card.desc}</p>
                  </a>
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
