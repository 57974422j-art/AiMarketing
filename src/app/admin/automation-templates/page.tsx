'use client'
import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '@/app/providers'
import { showToast } from '@/components/Toast'

interface AccountItem {
  id: number; platform: string; accountName: string; status: string; deviceId: number | null
  device?: { id: number; name: string } | null
}
interface DeviceItem { id: number; name: string; status: string; apiPort?: number }
type TaskAction = 'search' | 'like' | 'comment' | 'follow' | 'dm' | 'share' | 'publish' | 'extract' | 'comments'
type PublishStep = 'video' | 'title' | 'topic' | 'location'

interface TaskConfig {
  id?: number; accountId: number; deviceId: number | null; platform: string; name: string
  keywords: string[]; timeStart: string; timeEnd: string
  actions: TaskAction[]; leadGen: Record<string, unknown>
  browseDuration?: number
  commentText?: string
  dmTarget?: string
  dmText?: string
  followMode?: 'search' | 'mutual'
  followTargets?: string
  // ── 发布视频子步骤（可勾选组合）──
  publishSteps?: PublishStep[]       // 勾选的发布子单元：video/title/location
  publishTitle?: string              // 标题文案（包含话题，如：乡村故事 #乡村 #民宿）
  publishTopics?: string             // 话题关键词（AI生成后自动填入）
  publishLocation?: string           // 所在城市/POI
}

const PLATFORMS = [
  { key: '抖音', color: 'from-pink-500/20 to-purple-500/20', border: 'border-pink-500/30', icon: '🎵' },
  { key: '快手', color: 'from-yellow-500/20 to-orange-500/20', border: 'border-yellow-500/30', icon: '📹' },
  { key: '小红书', color: 'from-red-500/20 to-orange-500/20', border: 'border-red-500/30', icon: '📕' },
  { key: '视频号', color: 'from-green-500/20 to-emerald-500/20', border: 'border-green-500/30', icon: '💚' },
  { key: '微博', color: 'from-orange-500/20 to-red-500/20', border: 'border-orange-500/30', icon: '📢' },
  { key: 'B站',   color: 'from-blue-500/20 to-cyan-500/20',   border: 'border-blue-500/30',   icon: '📺' },
]

const ALL_ACTIONS: { key: TaskAction; label: string; desc: string; icon: string; needConfig: boolean }[] = [
  { key: 'search',   label: '搜索浏览', desc: '按关键词搜索并浏览内容',   icon: '🔍', needConfig: true },
  { key: 'like',     label: '点赞',     desc: '随机浏览中点赞',           icon: '❤️', needConfig: false },
  { key: 'comment',  label: '评论',     desc: '从话术库随机选取评论',     icon: '💬', needConfig: true },
  { key: 'follow',   label: '关注同行', desc: '关注同领域账号',           icon: '➕', needConfig: true },
  { key: 'share',    label: '转发',     desc: '转发同行视频',             icon: '🔄', needConfig: false },
  { key: 'dm',       label: '私信触达', desc: '发送私信给潜在客户',       icon: '✉️', needConfig: true },
  { key: 'publish',  label: '发布视频', desc: '从素材库/草稿箱发布视频',   icon: '📤', needConfig: true },
  { key: 'extract',  label: '提取数据', desc: '采集评论/粉丝数据',        icon: '📊', needConfig: false },
  { key: 'comments', label: '抓评论',   desc: '抓取指定视频下的评论',     icon: '🗨️', needConfig: false },
]

const DEFAULT_CONFIG = { keywords: ['火锅', '美业', '减肥'], timeStart: '09:00', timeEnd: '23:00', actions: ['search', 'like', 'comment'] as TaskAction[], leadGen: {} }

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
function Loading() { return <div className="min-h-screen bg-gray-950 flex items-center justify-center"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-400" /></div> }
function NoAccess() { return <div className="min-h-screen bg-gray-950 flex items-center justify-center"><p className="text-red-400">无权限</p></div> }

export default function AutomationTemplatesPage() {
  const { user, loading: authLoading } = useAuth()
  const [accounts, setAccounts] = useState<AccountItem[]>([])
  const [devices, setDevices] = useState<DeviceItem[]>([])
  const [templates, setTemplates] = useState<TaskConfig[]>([])
  const [loading, setLoading] = useState(true)
  const [activePlatform, setActivePlatform] = useState('')
  const [cfg, setCfg] = useState<TaskConfig>({
    name: '', accountId: 0, deviceId: null, platform: '', keywords: [...DEFAULT_CONFIG.keywords],
    timeStart: DEFAULT_CONFIG.timeStart, timeEnd: DEFAULT_CONFIG.timeEnd, actions: [...DEFAULT_CONFIG.actions], leadGen: {},
    browseDuration: 30,
  })
  const [cfgSaving, setCfgSaving] = useState(false)
  const [testOpen, setTestOpen] = useState<TaskConfig | null>(null)
  const [testAction, setTestAction] = useState<TaskAction>('search')
  const [testDevId, setTestDevId] = useState('')
  const [testResult, setTestResult] = useState('')
  const [testLoading, setTestLoading] = useState(false)

  useEffect(() => {
    if (!authLoading && user) loadAll()
    else if (!authLoading) setLoading(false)
  }, [authLoading, user])

  const loadAll = async () => {
    try {
      const [aRes, dRes, tRes] = await Promise.all([
        fetch('/api/accounts', { credentials: 'include' }),
        fetch('/api/devices', { credentials: 'include' }),
        fetch('/api/automation-templates', { credentials: 'include' }),
      ])
      if (aRes.ok) { const d = await aRes.json(); setAccounts((d.data || []).filter((a: any) => a.status === '已绑定' && a.bindType === 'device')) }
      if (dRes.ok) setDevices(((await dRes.json()).data || []).filter((d: any) => d.type === 'q1'))
      if (tRes.ok) {
        const list = (await tRes.json()).data || []
        setTemplates(list.map((t: any) => {
          try { const p = typeof t.params === 'string' ? JSON.parse(t.params) : t.params; return { ...p, id: t.id, name: t.name, platform: p.platform || '抖音' } }
          catch { return { ...t, keywords: [], actions: [], leadGen: {} } }
        }))
      }
    } catch {} finally { setLoading(false) }
  }

  const openPlatform = (platform: string) => {
    setActivePlatform(platform)
    setCfg({ name: `${platform}自动任务`, accountId: 0, deviceId: null, platform, keywords: [...DEFAULT_CONFIG.keywords], timeStart: DEFAULT_CONFIG.timeStart, timeEnd: DEFAULT_CONFIG.timeEnd, actions: [...DEFAULT_CONFIG.actions], leadGen: {}, browseDuration: 30 })
  }

  const editTemplate = (tmpl: TaskConfig) => {
    setActivePlatform(tmpl.platform)
    setCfg({ ...tmpl, keywords: tmpl.keywords || [...DEFAULT_CONFIG.keywords], timeStart: tmpl.timeStart || DEFAULT_CONFIG.timeStart, timeEnd: tmpl.timeEnd || DEFAULT_CONFIG.timeEnd, actions: tmpl.actions || [...DEFAULT_CONFIG.actions], leadGen: tmpl.leadGen || {}, browseDuration: tmpl.browseDuration || 30 })
  }

  const saveConfig = async () => {
    if (!cfg.name.trim()) { showToast('请输入模板名称', 'error'); return }
    setCfgSaving(true)
    try {
      const r = await fetch('/api/automation-templates', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: cfg.name, type: activePlatform + '任务', params: cfg }),
      })
      if (r.ok) { showToast('模板已保存', 'success'); setActivePlatform(''); loadAll() }
      else { const d = await r.json(); showToast(d.message || '保存失败', 'error') }
    } catch { showToast('保存失败', 'error') } finally { setCfgSaving(false) }
  }

  const deleteTemplate = async (id: number) => {
    if (!confirm('确定删除此模板？')) return
    const r = await fetch(`/api/automation-templates?id=${id}`, { method: 'DELETE', credentials: 'include' })
    if (r.ok) loadAll(); else showToast('删除失败', 'error')
  }

  if (authLoading || loading) return <Loading />
  if (!user) return <NoAccess />

  return (
    <div className="min-h-screen bg-gray-950">
      <div className="max-w-7xl mx-auto px-4 py-8">
        <div className="mb-8">
          <p className="text-label mb-2">管理后台 / TEMPLATES</p>
          <h1 className="text-mono-lg text-white">任务模板 / AUTOMATION TEMPLATES</h1>
          <p className="text-gray-400 text-sm mt-1">为每个平台创建自动任务模板，分配账号后即可执行</p>
        </div>

        <div className="grid grid-cols-3 md:grid-cols-6 gap-3 mb-8">
          {PLATFORMS.map(p => {
            const isActive = activePlatform === p.key
            return (
            <button key={p.key} onClick={() => setActivePlatform(isActive ? '' : p.key)}
              className={`card-glass p-4 text-center hover:scale-[1.03] transition-all cursor-pointer border group ${isActive ? 'ring-2 ring-emerald-500/50 border-emerald-500/40' : ''}`}
              style={{ borderColor: p.border.replace('border-', '') }}>
              <div className="text-3xl mb-1">{p.icon}</div>
              <div className="text-sm font-medium text-white">{p.key}</div>
              <div className="text-[10px] text-gray-500 mt-0.5">{isActive ? '编辑中...' : '新建模板'}</div>
            </button>
          )})}
        </div>

        {activePlatform && (
          <div className="card-glass p-6 mb-8">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-3">
                <span className="text-2xl">{PLATFORMS.find(p => p.key === activePlatform)?.icon}</span>
                <div>
                  <h2 className="text-white text-lg font-bold">{activePlatform} 任务模板</h2>
                  <p className="text-xs text-gray-500">配置模板后，分配到账号即可自动执行</p>
                </div>
              </div>
              <button onClick={() => setActivePlatform('')} className="text-gray-500 hover:text-white text-2xl">&times;</button>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="space-y-4">
                <Section title="模板名称" icon="📝">
                  <input className="input-dark w-full text-sm" placeholder="如：抖音日常运营" value={cfg.name} onChange={e => setCfg(prev => ({ ...prev, name: e.target.value }))} />
                </Section>

                <Section title="关联账号" icon="👤" desc="选择此模板要执行哪个账号">
                  <div className="space-y-2 max-h-40 overflow-y-auto">
                    {(() => {
                      const pk: Record<string, string> = { '抖音': 'douyin', '快手': 'kuaishou', '小红书': 'xiaohongshu', '视频号': 'shipinhao', '微博': 'weibo', 'B站': 'bilibili' }
                      return accounts.filter(a => a.platform === pk[activePlatform])
                    })().map(acct => (
                      <button key={acct.id} onClick={() => setCfg(prev => ({ ...prev, accountId: acct.id, deviceId: acct.deviceId }))}
                        className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg border text-xs transition ${cfg.accountId === acct.id ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40' : 'bg-white/5 text-gray-400 border-white/10 hover:bg-white/10'}`}>
                        <span>🎵</span>
                        <span className="font-medium">{acct.accountName}</span>
                        <span className="text-gray-500">· {acct.device?.name || '待绑定'}</span>
                        {cfg.accountId === acct.id && <span className="ml-auto text-emerald-400">✓</span>}
                      </button>
                    ))}
                    {(() => {
                      const pk: Record<string, string> = { '抖音': 'douyin', '快手': 'kuaishou', '小红书': 'xiaohongshu', '视频号': 'shipinhao', '微博': 'weibo', 'B站': 'bilibili' }
                      return accounts.filter(a => a.platform === pk[activePlatform]).length === 0
                    })() && <p className="text-xs text-gray-500 text-center py-2">暂无已绑定的{activePlatform}账号</p>}
                  </div>
                </Section>
              </div>

              <div className="space-y-4">
                <Section title="运行时间" icon="⏰">
                  <div className="flex items-center gap-3">
                    <label className="text-xs text-gray-400">开始</label>
                    <input type="time" value={cfg.timeStart} onChange={e => setCfg(prev => ({ ...prev, timeStart: e.target.value }))} className="input-dark text-sm w-28" />
                    <label className="text-xs text-gray-400">结束</label>
                    <input type="time" value={cfg.timeEnd} onChange={e => setCfg(prev => ({ ...prev, timeEnd: e.target.value }))} className="input-dark text-sm w-28" />
                  </div>
                </Section>

                {/* Action buttons + per-action config */}
                <Section title="执行项目" icon="🎯" desc="勾选要执行的操作，勾选后下方出现配置项">
                  <div className="flex flex-wrap gap-2 mb-3">
                    {ALL_ACTIONS.map(a => {
                      const checked = cfg.actions.includes(a.key)
                      return (
                        <button key={a.key} onClick={() => setCfg(prev => ({
                          ...prev,
                          actions: checked ? prev.actions.filter(x => x !== a.key) : [...prev.actions, a.key],
                        }))}
                          className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs border transition ${
                            checked ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40' : 'bg-white/5 text-gray-400 border-white/10 hover:bg-white/10'
                          }`}>
                          <span className={checked ? 'text-emerald-400' : 'text-gray-600'}>{checked ? '✓' : '○'}</span>
                          <span>{a.icon}</span>
                          <span>{a.label}</span>
                        </button>
                      )
                    })}
                  </div>

                  {/* ── Per-action config panels ── */}

                  {cfg.actions.includes('search') && (
                    <div className="border-t border-white/10 pt-3 mt-2 space-y-3">
                      <div>
                        <label className="text-[10px] text-gray-400 mb-1 block">搜索关键词</label>
                        <div className="flex flex-wrap gap-2 mb-2">
                          {cfg.keywords.map((kw, i) => (
                            <span key={i} className="px-2 py-1 bg-cyan-500/20 text-cyan-400 rounded text-xs flex items-center gap-1.5 border border-cyan-500/30">
                              {kw}
                              <button onClick={() => setCfg(prev => ({ ...prev, keywords: prev.keywords.filter((_, j) => j !== i) }))} className="hover:text-red-400">&times;</button>
                            </span>
                          ))}
                        </div>
                        <input className="input-dark w-full text-sm" placeholder="输入关键词按回车，如：火锅、美业"
                          onKeyDown={e => { if (e.key === 'Enter' && (e.target as HTMLInputElement).value.trim()) {
                            setCfg(prev => ({ ...prev, keywords: [...prev.keywords, (e.target as HTMLInputElement).value.trim()] }))
                            ;(e.target as HTMLInputElement).value = ''
                          }}} />
                      </div>
                      <div className="flex items-center gap-3">
                        <label className="text-[10px] text-gray-400">浏览时长</label>
                        <input type="number" min={5} max={300} value={cfg.browseDuration || 30}
                          onChange={e => setCfg(prev => ({ ...prev, browseDuration: parseInt(e.target.value) || 30 }))}
                          className="input-dark text-sm w-20" />
                        <span className="text-xs text-gray-500">秒</span>
                      </div>
                    </div>
                  )}

                  {cfg.actions.includes('comment') && (
                    <div className="border-t border-white/10 pt-3 mt-2">
                      <label className="text-[10px] text-gray-400 mb-1 block">评论内容（留空则从话术模板库选取）</label>
                      <textarea value={cfg.commentText || ''} onChange={e => setCfg(prev => ({ ...prev, commentText: e.target.value }))}
                        placeholder="如：看起来不错，在哪买的？" className="input-dark w-full h-16 resize-y text-sm" rows={2} />
                    </div>
                  )}

                  {cfg.actions.includes('follow') && (
                    <div className="border-t border-white/10 pt-3 mt-2 space-y-3">
                      <label className="text-[10px] text-gray-400 mb-1 block">关注方式</label>
                      <div className="flex gap-2">
                        <button onClick={() => setCfg(prev => ({ ...prev, followMode: 'search' }))}
                          className={`px-3 py-1.5 rounded-lg text-xs border transition ${cfg.followMode !== 'mutual' ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' : 'bg-white/5 text-gray-400 border-white/10'}`}>
                          🔍 搜索抖音号关注
                        </button>
                        <button onClick={() => setCfg(prev => ({ ...prev, followMode: 'mutual' }))}
                          className={`px-3 py-1.5 rounded-lg text-xs border transition ${cfg.followMode === 'mutual' ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' : 'bg-white/5 text-gray-400 border-white/10'}`}>
                          🤝 旗下账号互关
                        </button>
                      </div>
                      {cfg.followMode !== 'mutual' && (
                        <div>
                          <label className="text-[10px] text-gray-400 mb-1 block">要关注的抖音号（逗号分隔）</label>
                          <input className="input-dark w-full text-sm" placeholder="user1, user2, user3" value={cfg.followTargets || ''}
                            onChange={e => setCfg(prev => ({ ...prev, followTargets: e.target.value }))} />
                        </div>
                      )}
                      {cfg.followMode === 'mutual' && (
                        <p className="text-[10px] text-gray-500">将自动拉取旗下所有绑定账号进行互关</p>
                      )}
                    </div>
                  )}

                  {cfg.actions.includes('dm') && (
                    <div className="border-t border-white/10 pt-3 mt-2 space-y-3">
                      <div>
                        <label className="text-[10px] text-gray-400 mb-1 block">目标用户抖音号</label>
                        <input className="input-dark w-full text-sm" placeholder="输入抖音号" value={cfg.dmTarget || ''}
                          onChange={e => setCfg(prev => ({ ...prev, dmTarget: e.target.value }))} />
                      </div>
                      <div>
                        <label className="text-[10px] text-gray-400 mb-1 block">私信内容</label>
                        <textarea value={cfg.dmText || ''} onChange={e => setCfg(prev => ({ ...prev, dmText: e.target.value }))}
                          placeholder="如：你好，有兴趣合作吗？" className="input-dark w-full h-16 resize-y text-sm" rows={2} />
                      </div>
                    </div>
                  )}

                  {cfg.actions.includes('publish') && (
                    <div className="border-t border-white/10 pt-3 mt-2 space-y-3">
                      {/* ── 发布子步骤勾选 ── */}
                      <div>
                        <label className="text-[10px] text-gray-400 mb-1.5 block">发布步骤（勾选需要执行的步骤）</label>
                        <p className="text-[9px] text-gray-500 mb-2">📹 选视频发布将作为前置步骤自动执行</p>
                        <div className="grid grid-cols-3 gap-2">
                          {[
                            { key: 'title' as PublishStep, label: '✏️ 添加标题', desc: '输入标题+AI话题生成' },
                            { key: 'location' as PublishStep, label: '📍 所在位置', desc: '添加城市定位' },
                          ].map(step => {
                              const checked = (cfg.publishSteps || []).includes(step.key)
                              return (
                                <button key={step.key} onClick={() => setCfg(prev => ({
                                  ...prev,
                                  publishSteps: checked
                                    ? (prev.publishSteps || []).filter(s => s !== step.key)
                                    : [...(prev.publishSteps || []), step.key],
                                }))}
                                  className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-xs transition ${
                                    checked ? 'bg-pink-500/15 text-pink-400 border-pink-500/30' : 'bg-white/5 text-gray-500 border-white/10 hover:bg-white/10'
                                  }`}>
                                  <span className={checked ? 'text-pink-400' : 'text-gray-600'}>{checked ? '✓' : '○'}</span>
                                  <div className="text-left">
                                    <div>{step.label}</div>
                                    <div className="text-[9px] opacity-50">{step.desc}</div>
                                  </div>
                                </button>
                              )
                            })}
                        </div>
                      </div>

                      {/* ── 标题+话题（AI增强）── */}
                      {(cfg.publishSteps || []).includes('title') && (
                        <div className="pl-2 border-l-2 border-pink-500/20 space-y-2">
                          <div className="flex items-center justify-between">
                            <label className="text-[10px] text-gray-400">✏️ 标题文案（含话题）</label>
                            <button
                              onClick={async () => {
                                const keyword = cfg.publishTitle || cfg.keywords?.[0] || '热门'
                                setCfg(prev => ({ ...prev, aiGenLoading: true }))
                                try {
                                  const r = await fetch('/api/admin/ai-generate-title', {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ keyword }),
                                    credentials: 'include',
                                  })
                                  const data = await r.json()
                                  if (data.title) {
                                    const topics = data.topics || ''
                                    setCfg(prev => ({
                                      ...prev,
                                      publishTitle: data.title + ' ' + topics,
                                      publishTopics: topics,
                                      aiGenLoading: false
                                    }))
                                  } else {
                                    setCfg(prev => ({ ...prev, aiGenLoading: false }))
                                  }
                                } catch { setCfg(prev => ({ ...prev, aiGenLoading: false })) }
                              }}
                              disabled={(cfg as any).aiGenLoading}
                              className="px-2 py-1 text-[10px] bg-purple-600/30 text-purple-300 rounded hover:bg-purple-600/50 disabled:opacity-50">
                              {(cfg as any).aiGenLoading ? '⏳' : '🤖'} AI生成
                            </button>
                          </div>
                          <textarea value={cfg.publishTitle || ''} onChange={e => setCfg(prev => ({ ...prev, publishTitle: e.target.value }))}
                            placeholder="输入标题关键词，点AI按钮自动扩展为SEO标题+话题&#10;如：小狗吃席 → AI生成：萌宠界的排面！小狗坐C位吃席现场太欢乐了 #萌宠 #搞笑 #治愈系"
                            className="input-dark w-full h-20 resize-y text-sm" rows={3} />
                          {cfg.publishTopics && (
                            <p className="text-[9px] text-emerald-400">🏷️ 检测到话题: {cfg.publishTopics}</p>
                          )}
                          <p className="text-[9px] text-gray-500">标题+话题合并输入到抖音标题框，无需额外操作</p>
                        </div>
                      )}

                      {/* ── 位置配置（勾选"所在位置"后显示）── */}
                      {(cfg.publishSteps || []).includes('location') && (
                        <div className="pl-2 border-l-2 border-pink-500/20 space-y-2">
                          <label className="text-[10px] text-gray-400 mb-1 block">📍 所在城市 / POI</label>
                          <input className="input-dark w-full text-sm"
                            placeholder="如：合肥、成都市太古里（留空则跳过）"
                            value={cfg.publishLocation || ''}
                            onChange={e => setCfg(prev => ({ ...prev, publishLocation: e.target.value }))} />
                          <p className="text-[9px] text-gray-500">留空自动跳过位置步骤，直接发布</p>
                        </div>
                      )}

                      {/* 默认全选提示 */}
                      {(cfg.publishSteps || []).length === 0 && (
                        <p className="text-[10px] text-yellow-400/60 text-center py-1">⚠ 至少勾选一个发布步骤</p>
                      )}
                    </div>
                  )}
                </Section>

                <button onClick={saveConfig} disabled={cfgSaving || !cfg.name.trim() || !cfg.accountId}
                  className="w-full py-3 bg-emerald-500 text-white font-medium rounded-xl hover:bg-emerald-600 disabled:opacity-50">
                  {cfgSaving ? '保存中...' : '💾 保存模板'}
                </button>
              </div>
            </div>
          </div>
        )}

        <h2 className="text-white font-semibold mb-3">已保存模板 / SAVED</h2>
        {templates.length === 0 ? (
          <div className="card-glass p-8 text-center text-gray-500">暂无模板，点击上方平台创建</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {templates.map(t => {
              const platform = PLATFORMS.find(p => p.key === t.platform)
              return (
                <div key={t.id} className={`card-glass p-4 border-l-4 ${platform?.border.replace('border-', 'border-l-') || 'border-l-white/10'}`}>
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="text-xl">{platform?.icon || '📋'}</span>
                      <span className="text-white font-medium text-sm">{t.name}</span>
                    </div>
                    <div className="flex gap-1">
                      <button onClick={() => { setTestOpen(t); setTestAction(t.actions[0] || 'search'); setTestDevId(''); setTestResult('') }} className="text-xs px-2 py-1 bg-emerald-500/20 text-emerald-400 rounded hover:bg-emerald-500/30">▶ 测试</button>
                      <button onClick={() => editTemplate(t)} className="text-xs px-2 py-1 bg-cyan-500/20 text-cyan-400 rounded hover:bg-cyan-500/30">编辑</button>
                      <button onClick={() => deleteTemplate(t.id!)} className="text-xs px-2 py-1 bg-red-500/20 text-red-400 rounded hover:bg-red-500/30">删除</button>
                    </div>
                  </div>
                  <div className="text-xs text-gray-500 space-y-0.5">
                    <div>平台：{t.platform}</div>
                    <div>时间：{t.timeStart} ~ {t.timeEnd}</div>
                    <div>动作：{t.actions.map(a => ALL_ACTIONS.find(aa => aa.key === a)?.label || a).join('、')}</div>
                    {t.keywords.length > 0 && <div>关键词：{t.keywords.join('、')}</div>}
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {testOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={() => setTestOpen(null)}>
            <div className="bg-gray-900 border border-white/10 rounded-2xl p-6 w-full max-w-sm mx-4" onClick={e => e.stopPropagation()}>
              <h3 className="text-white font-bold mb-1">▶ 测试模板</h3>
              <p className="text-xs text-gray-500 mb-4">{testOpen.name}</p>
              <label className="text-xs text-gray-400 mb-1 block">动作</label>
              <select className="input-dark w-full mb-3 text-sm" value={testAction} onChange={e => setTestAction(e.target.value as TaskAction)}>
                {testOpen.actions.map(a => {
                  const meta = ALL_ACTIONS.find(aa => aa.key === a)
                  return <option key={a} value={a} className="bg-gray-900">{meta?.icon} {meta?.label || a}</option>
                })}
              </select>
              <label className="text-xs text-gray-400 mb-1 block">设备</label>
              <select className="input-dark w-full mb-4 text-sm" value={testDevId} onChange={e => setTestDevId(e.target.value)}>
                <option value="">选择设备...</option>
                {devices.filter(d => d.status === 'online').map(d => <option key={d.id} value={d.id} className="bg-gray-900">{d.name}</option>)}
              </select>
              <button onClick={async () => {
                if (!testDevId) { showToast('请选择设备', 'error'); return }
                setTestLoading(true); setTestResult('')
                try {
                  // 把完整模板参数传给执行接口（不只是action，还有发布相关配置）
                  const execBody: Record<string, unknown> = {
                    platform: testOpen.platform || activePlatform,
                    actions: [testAction],
                    keywords: testOpen.keywords || [],
                    publishTitle: testOpen.publishTitle || '',
                    publishTopics: testOpen.publishTopics ? (Array.isArray(testOpen.publishTopics) ? testOpen.publishTopics : testOpen.publishTopics.split(',')) : [],
                    publishLocation: testOpen.publishLocation || '',
                  }
                  const r = await fetch(`/api/devices/${testDevId}/execute`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(execBody) })
                  const d = await r.json()
                  setTestResult(d.message || d.output || (r.ok ? '✅ 执行成功' : '❌ 失败'))
                  if (r.ok) showToast('✅ 测试完成', 'success')
                  else showToast('测试失败:' + (d.message || ''), 'error')
                } catch { setTestResult('❌ 请求失败') }
                finally { setTestLoading(false) }
              }} disabled={testLoading || !testDevId}
                className="w-full py-2 bg-emerald-500 text-white rounded-lg hover:bg-emerald-600 disabled:opacity-50 text-sm mb-2">
                {testLoading ? '执行中...' : '▶ 执行测试'}
              </button>
              {testResult && <pre className="bg-black/30 rounded-lg p-3 text-[10px] text-green-400 font-mono max-h-32 overflow-auto">{testResult}</pre>}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
