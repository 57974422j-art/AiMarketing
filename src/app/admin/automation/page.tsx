'use client'
import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '@/app/providers'
import { showToast } from '@/components/Toast'

// ── 类型 ──────────────────────────────────────
interface DeviceItem {
  id: number; name: string; status: string; apiPort?: number; type?: string
}
interface AccountItem {
  id: number; platform: string; username: string; status: string; deviceId: number | null
}
type TaskAction = 'search' | 'like' | 'comment' | 'follow' | 'dm'
interface TaskConfig {
  id?: number; accountId: number; deviceId: number | null; platform: string
  keywords: string[]; timeStart: string; timeEnd: string
  actions: TaskAction[]; leadGen: Record<string, unknown>
}

const PLATFORMS = [
  { key: '抖音', color: 'from-pink-500/20 to-purple-500/20', border: 'border-pink-500/30', accent: 'text-pink-400', icon: '🎵' },
  { key: '快手', color: 'from-yellow-500/20 to-orange-500/20', border: 'border-yellow-500/30', accent: 'text-yellow-400', icon: '📹' },
  { key: '小红书', color: 'from-red-500/20 to-orange-500/20', border: 'border-red-500/30', accent: 'text-red-400', icon: '📕' },
  { key: '视频号', color: 'from-green-500/20 to-emerald-500/20', border: 'border-green-500/30', accent: 'text-green-400', icon: '💚' },
  { key: '微博', color: 'from-orange-500/20 to-red-500/20', border: 'border-orange-500/30', accent: 'text-orange-400', icon: '📢' },
  { key: 'B站', color: 'from-blue-500/20 to-cyan-500/20', border: 'border-blue-500/30', accent: 'text-blue-400', icon: '📺' },
]

const ACTION_META: Record<TaskAction, { label: string; desc: string; icon: string }> = {
  search: { label: '搜索浏览', desc: '按关键词搜索并浏览内容', icon: '🔍' },
  like: { label: '点赞互动', desc: '随机浏览中点赞', icon: '❤️' },
  comment: { label: '评论互动', desc: '从话术库随机选取评论', icon: '💬' },
  follow: { label: '关注同行', desc: '关注同领域账号', icon: '➕' },
  dm: { label: '私信触达', desc: '发送私信给潜在客户', icon: '✉️' },
}

const DEFAULT_CONFIG = {
  keywords: ['火锅', '美业', '减肥'],
  timeStart: '09:00',
  timeEnd: '23:00',
  actions: ['search', 'like', 'comment'] as TaskAction[],
  leadGen: {},
}

// ── 主组件 ──────────────────────────────────────
export default function AutomationPage() {
  const { user, loading: authLoading } = useAuth()
  const [devices, setDevices] = useState<DeviceItem[]>([])
  const [accounts, setAccounts] = useState<AccountItem[]>([])
  const [loading, setLoading] = useState(true)

  // 抽屉状态
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [drawerPlatform, setDrawerPlatform] = useState('')
  const [drawerAccounts, setDrawerAccounts] = useState<AccountItem[]>([])

  // 当前编辑的配置
  const [cfg, setCfg] = useState<TaskConfig>({
    accountId: 0, deviceId: null, platform: '',
    keywords: [...DEFAULT_CONFIG.keywords], timeStart: DEFAULT_CONFIG.timeStart,
    timeEnd: DEFAULT_CONFIG.timeEnd, actions: [...DEFAULT_CONFIG.actions], leadGen: {},
  })
  const [cfgLoading, setCfgLoading] = useState(false)
  const [cfgSaving, setCfgSaving] = useState(false)

  // ── 数据加载 ──
  useEffect(() => {
    if (!authLoading && user && user.role !== 'end-user') loadData()
    else if (!authLoading) setLoading(false)
  }, [authLoading, user])

  const loadData = async () => {
    try {
      const [dRes, aRes] = await Promise.all([
        fetch('/api/devices', { credentials: 'include' }),
        fetch('/api/social-accounts', { credentials: 'include' }),
      ])
      if (dRes.ok) setDevices(((await dRes.json()).data || []).filter((d: any) => d.type === 'q1'))
      if (aRes.ok) setAccounts((await aRes.json()).data || [])
    } catch {} finally { setLoading(false) }
  }

  // ── 打开平台抽屉 ──
  const openDrawer = useCallback((platform: string) => {
    setDrawerPlatform(platform)
    const platformAccounts = accounts.filter(a => a.platform === platform)
    setDrawerAccounts(platformAccounts)

    // 如果有账号，默认选第一个
    if (platformAccounts.length > 0) {
      const acct = platformAccounts[0]
      setCfg(prev => ({ ...prev, accountId: acct.id, deviceId: acct.deviceId, platform }))
      loadConfig(acct.id, acct.deviceId, platform)
    } else {
      setCfg(prev => ({ ...prev, accountId: 0, deviceId: null, platform,
        keywords: [...DEFAULT_CONFIG.keywords], timeStart: DEFAULT_CONFIG.timeStart,
        timeEnd: DEFAULT_CONFIG.timeEnd, actions: [...DEFAULT_CONFIG.actions], leadGen: {},
      }))
    }
    setDrawerOpen(true)
  }, [accounts])

  // ── 加载配置 ──
  const loadConfig = async (accountId: number, deviceId: number | null, platform: string) => {
    setCfgLoading(true)
    try {
      const params = new URLSearchParams({ accountId: String(accountId), platform })
      if (deviceId) params.set('deviceId', String(deviceId))
      const r = await fetch(`/api/task-configs?${params}`, { credentials: 'include' })
      const d = await r.json()
      if (d.success && d.data) {
        setCfg({
          accountId: d.data.accountId,
          deviceId: d.data.deviceId,
          platform: d.data.platform,
          keywords: Array.isArray(d.data.keywords) ? d.data.keywords : DEFAULT_CONFIG.keywords,
          timeStart: d.data.timeStart || DEFAULT_CONFIG.timeStart,
          timeEnd: d.data.timeEnd || DEFAULT_CONFIG.timeEnd,
          actions: Array.isArray(d.data.actions) ? d.data.actions : [...DEFAULT_CONFIG.actions],
          leadGen: d.data.leadGen || {},
        })
      }
    } catch {} finally { setCfgLoading(false) }
  }

  // ── 切换账号 ──
  const switchAccount = (acct: AccountItem) => {
    setCfg(prev => ({ ...prev, accountId: acct.id, deviceId: acct.deviceId }))
    loadConfig(acct.id, acct.deviceId, drawerPlatform)
  }

  // ── 保存配置 ──
  const saveConfig = async () => {
    if (!cfg.accountId) { showToast('请选择一个账号', 'error'); return }
    setCfgSaving(true)
    try {
      const r = await fetch('/api/task-configs', {
        method: 'PUT', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cfg),
      })
      const d = await r.json()
      if (d.success) showToast('配置已保存', 'success')
      else showToast(d.message || '保存失败', 'error')
    } catch { showToast('保存失败', 'error') } finally { setCfgSaving(false) }
  }

  const toggleAction = (action: TaskAction) => {
    setCfg(prev => ({
      ...prev,
      actions: prev.actions.includes(action)
        ? prev.actions.filter(a => a !== action)
        : [...prev.actions, action],
    }))
  }

  // ── 渲染 ──
  if (authLoading || loading) return <Loading />
  if (!user || user.role === 'end-user') return <div className="min-h-screen bg-gray-950 flex items-center justify-center"><p className="text-red-400">无权限</p></div>

  const deviceAccounts = (deviceId: number) => accounts.filter(a => a.deviceId === deviceId)

  return (
    <div className="min-h-screen bg-gray-950">
      <div className="max-w-7xl mx-auto px-4 py-8">
        {/* 标题 */}
        <div className="mb-8">
          <p className="text-label mb-2">任务中心 / TASK</p>
          <h1 className="text-mono-lg text-white">自动执行配置 / AUTOMATION</h1>
          <p className="text-gray-400 text-sm mt-1">每台设备·每个账号独立配置，一键保存自动执行</p>
        </div>

        {/* 主区域：设备面板 + 平台卡片 */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

          {/* ── 设备面板 ── */}
          <div className="lg:col-span-2 space-y-4">
            <h2 className="text-white font-semibold mb-3 flex items-center gap-2">
              <span>📱</span> 在线设备 / DEVICES
              <span className="text-xs text-gray-500 font-normal">（{devices.length} 台）</span>
            </h2>

            {devices.length === 0 ? (
              <div className="card-glass p-8 text-center text-gray-500">
                <p className="mb-2">暂无 Q1 设备</p>
                <p className="text-xs">请先在「Q1 管理」添加并扫描设备</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {devices.map(dev => {
                  const boundAccounts = deviceAccounts(dev.id)
                  return (
                    <div key={dev.id} className={`card-glass p-4 border-l-4 ${dev.status === 'online' ? 'border-l-emerald-500' : 'border-l-gray-500'}`}>
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <div className={`w-2 h-2 rounded-full ${dev.status === 'online' ? 'bg-emerald-400' : 'bg-gray-500'}`} />
                          <span className="text-white font-medium text-sm">{dev.name}</span>
                        </div>
                        <span className={`text-xs px-2 py-0.5 rounded ${dev.status === 'online' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-gray-500/20 text-gray-500'}`}>
                          {dev.status}
                        </span>
                      </div>

                      {/* 绑定账号 */}
                      <div className="space-y-1.5">
                        {boundAccounts.map(acct => (
                          <div key={acct.id} className="flex items-center justify-between bg-white/5 rounded-lg px-3 py-2 text-xs">
                            <span className="text-gray-300">{acct.username}</span>
                            <div className="flex items-center gap-2">
                              <span className={`px-1.5 py-0.5 rounded ${acct.status === '已绑定' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-gray-500/20 text-gray-500'}`}>
                                {acct.status}
                              </span>
                              <PlatformBtn platform={acct.platform} onClick={() => openDrawer(acct.platform)} />
                            </div>
                          </div>
                        ))}
                        {boundAccounts.length === 0 && <p className="text-xs text-gray-600 text-center py-1">暂无绑定账号</p>}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* ── 右侧：快捷平台入口 ── */}
          <div>
            <h2 className="text-white font-semibold mb-3 flex items-center gap-2">
              <span>🚀</span> 快捷配置 / QUICK
            </h2>
            <div className="grid grid-cols-2 gap-3">
              {PLATFORMS.map(p => (
                <button key={p.key} onClick={() => openDrawer(p.key)}
                  className={`relative card-glass p-4 text-center hover:scale-[1.02] transition-all cursor-pointer group border ${p.border} bg-gradient-to-br ${p.color}`}>
                  <div className="text-2xl mb-1">{p.icon}</div>
                  <div className={`text-sm font-medium ${p.accent}`}>{p.key}</div>
                  <div className="text-[10px] text-gray-500 mt-0.5">配置任务</div>
                </button>
              ))}
            </div>

            {/* 执行记录快捷入口 */}
            <div className="card-glass p-4 mt-4">
              <h3 className="text-xs text-gray-400 font-medium mb-2">⚡ 快捷操作</h3>
              <div className="space-y-2">
                <button className="w-full text-xs py-2 bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 rounded-lg hover:bg-emerald-500/30">
                  一键执行全部
                </button>
                <button className="w-full text-xs py-2 bg-white/5 text-gray-400 border border-white/10 rounded-lg hover:bg-white/10">
                  查看执行日志
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* ── 配置抽屉 ── */}
        {drawerOpen && (
          <div className="fixed inset-0 z-50 flex justify-end" onClick={() => setDrawerOpen(false)}>
            <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
            <div className="relative w-full max-w-lg bg-gray-900 border-l border-white/10 h-full overflow-y-auto shadow-2xl" onClick={e => e.stopPropagation()}>
              {/* 抽屉头部 */}
              <div className="sticky top-0 bg-gray-900/95 backdrop-blur-sm border-b border-white/10 p-6 z-10">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className="text-2xl">{PLATFORMS.find(p => p.key === drawerPlatform)?.icon}</span>
                    <div>
                      <h2 className="text-white text-lg font-bold">{drawerPlatform} 任务配置</h2>
                      <p className="text-xs text-gray-500">一个账号一个配置，保存后自动生效</p>
                    </div>
                  </div>
                  <button onClick={() => setDrawerOpen(false)} className="text-gray-500 hover:text-white text-xl">&times;</button>
                </div>
              </div>

              <div className="p-6 space-y-6">
                {cfgLoading ? (
                  <div className="py-12 text-center text-gray-500">加载配置中...</div>
                ) : (
                  <>
                    {/* 账号选择 */}
                    <Section title="账号选择" icon="👤">
                      {drawerAccounts.length === 0 ? (
                        <p className="text-sm text-gray-500">该平台暂无绑定账号</p>
                      ) : (
                        <div className="flex flex-wrap gap-2">
                          {drawerAccounts.map(acct => (
                            <button key={acct.id}
                              onClick={() => switchAccount(acct)}
                              className={`px-3 py-1.5 text-xs rounded-lg border transition ${
                                cfg.accountId === acct.id
                                  ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40'
                                  : 'bg-white/5 text-gray-400 border-white/10 hover:bg-white/10'
                              }`}>
                              {acct.username}
                            </button>
                          ))}
                        </div>
                      )}
                    </Section>

                    {/* 关键词 */}
                    <Section title="搜索关键词" icon="🔑" desc="输入行业关键词，用于搜索内容和创作灵感">
                      <div className="flex flex-wrap gap-2 mb-2">
                        {cfg.keywords.map((kw, i) => (
                          <span key={i} className="px-2 py-1 bg-cyan-500/20 text-cyan-400 border border-cyan-500/30 rounded text-xs flex items-center gap-1.5">
                            {kw}
                            <button onClick={() => setCfg(prev => ({ ...prev, keywords: prev.keywords.filter((_, j) => j !== i) }))} className="hover:text-red-400">&times;</button>
                          </span>
                        ))}
                      </div>
                      <div className="flex gap-2">
                        <input className="input-dark flex-1 text-sm" placeholder="输入关键词，如：拉面、麻辣香锅"
                          onKeyDown={e => { if (e.key === 'Enter' && (e.target as HTMLInputElement).value.trim()) {
                            setCfg(prev => ({ ...prev, keywords: [...prev.keywords, (e.target as HTMLInputElement).value.trim()] }))
                            ;(e.target as HTMLInputElement).value = ''
                          }}} />
                      </div>
                      <p className="text-[10px] text-gray-600 mt-1">按 Enter 添加，点击 × 删除</p>
                    </Section>

                    {/* 运行时间 */}
                    <Section title="运行时间" icon="⏰">
                      <div className="flex items-center gap-3">
                        <label className="text-xs text-gray-400">开始</label>
                        <input type="time" value={cfg.timeStart}
                          onChange={e => setCfg(prev => ({ ...prev, timeStart: e.target.value }))}
                          className="input-dark text-sm w-28" />
                        <label className="text-xs text-gray-400">结束</label>
                        <input type="time" value={cfg.timeEnd}
                          onChange={e => setCfg(prev => ({ ...prev, timeEnd: e.target.value }))}
                          className="input-dark text-sm w-28" />
                      </div>
                    </Section>

                    {/* 执行项目 */}
                    <Section title="执行项目" icon="🎯" desc="选择此账号自动执行的操作">
                      <div className="grid grid-cols-2 gap-2">
                        {(Object.entries(ACTION_META) as [TaskAction, typeof ACTION_META[TaskAction]][]).map(([key, meta]) => (
                          <button key={key} onClick={() => toggleAction(key)}
                            className={`flex items-center gap-2 px-3 py-2.5 rounded-lg border text-left text-xs transition ${
                              cfg.actions.includes(key)
                                ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40'
                                : 'bg-white/5 text-gray-400 border-white/10 hover:bg-white/10'
                            }`}>
                            <span>{meta.icon}</span>
                            <div>
                              <div className="font-medium">{meta.label}</div>
                              <div className="text-[10px] opacity-60">{meta.desc}</div>
                            </div>
                          </button>
                        ))}
                      </div>
                    </Section>

                    {/* 获客功能（预留） */}
                    <Section title="精准获客" icon="🎣" desc="建设中...后续支持企业获客、截流同行、直播获客">
                      <div className="bg-gradient-to-r from-purple-500/10 to-blue-500/10 rounded-lg p-4 border border-purple-500/20">
                        <div className="grid grid-cols-2 gap-2 text-xs text-gray-500">
                          {[
                            { icon: '🏢', label: '企业获客', desc: '工商大数据' },
                            { icon: '🗺️', label: '高德获客', desc: '地图POI' },
                            { icon: '📱', label: '截流同行', desc: '评论区获客' },
                            { icon: '🔴', label: '直播截流', desc: '弹幕实时抓取' },
                          ].map(item => (
                            <div key={item.label} className="bg-white/5 rounded p-2 text-center opacity-60">
                              <div className="text-lg mb-1">{item.icon}</div>
                              <div className="text-gray-400">{item.label}</div>
                              <div className="text-[10px] text-gray-600">{item.desc}</div>
                            </div>
                          ))}
                        </div>
                        <p className="text-[10px] text-center text-gray-600 mt-2">即将上线</p>
                      </div>
                    </Section>
                  </>
                )}

                {/* 保存按钮 */}
                <div className="sticky bottom-0 bg-gray-900/95 backdrop-blur-sm pt-4 pb-2 border-t border-white/10 -mx-6 px-6">
                  <button onClick={saveConfig} disabled={cfgSaving || !cfg.accountId}
                    className="w-full py-3 bg-emerald-500 text-white font-medium rounded-xl hover:bg-emerald-600 transition disabled:opacity-50">
                    {cfgSaving ? '保存中...' : '💾 保存配置'}
                  </button>
                  <p className="text-[10px] text-gray-600 text-center mt-2">保存后自动应用到此账号</p>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ── 子组件 ──
function Section({ title, icon, desc, children }: { title: string; icon: string; desc?: string; children: React.ReactNode }) {
  return (
    <div className="bg-white/5 rounded-xl p-4 border border-white/5">
      <div className="flex items-center gap-2 mb-3">
        <span>{icon}</span>
        <h3 className="text-white text-sm font-medium">{title}</h3>
        {desc && <span className="text-[10px] text-gray-500 ml-auto">{desc}</span>}
      </div>
      {children}
    </div>
  )
}

function PlatformBtn({ platform, onClick }: { platform: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="text-[10px] px-1.5 py-0.5 bg-cyan-500/20 text-cyan-400 rounded hover:bg-cyan-500/30 transition">
      配置
    </button>
  )
}

function Loading() {
  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center">
      <div className="text-center">
        <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-400" />
        <p className="mt-2 text-gray-400 text-sm">加载中...</p>
      </div>
    </div>
  )
}
