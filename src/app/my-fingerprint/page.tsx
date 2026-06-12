'use client'

import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '@/app/providers'
import { showToast } from '@/components/Toast'

// ── 类型 ──

interface Account {
  id: number
  platform: string
  accountName: string
  accountId: string        // 平台唯一标识（如抖音号）
  cdpPort: number | null   // 指纹浏览器 CDP 端口（系统自动分配）
  isBound: boolean
  bindType: string
  status: string
  remark: string
  createdAt: string
}

interface BrowserInstance {
  port: number
  accountId: string | null
  platform: string
  proxy: string | null
  running: boolean
  startedAt: number
  currentUrl: string
}

// ── 平台配置 ──

const PLATFORMS = [
  { key: 'douyin', label: '抖音', icon: '🎵', url: 'https://creator.douyin.com/creator-micro/content/upload' },
  { key: 'xiaohongshu', label: '小红书', icon: '📕', url: 'https://creator.xiaohongshu.com/publish/publish' },
  { key: 'kuaishou', label: '快手', icon: '📹', url: 'https://cp.kuaishou.com/article/publish/video' },
  { key: 'bilibili', label: 'B站', icon: '📺', url: 'https://member.bilibili.com/platform/upload-video/frame' },
  { key: 'weibo', label: '微博', icon: '📢', url: 'https://weibo.com' },
]

const TEMPLATES = [
  { key: 'douyin-publish', label: '📝 抖音发视频', platforms: ['douyin'], desc: '上传视频+填写文案+话题，自动发布' },
  { key: 'douyin-like',   label: '👍 抖音点赞', platforms: ['douyin'], desc: '批量点赞指定视频或当前页' },
  { key: 'douyin-comment',label: '💬 抖音评论', platforms: ['douyin'], desc: '在目标视频下发表评论' },
  { key: 'xiaohongshu-publish', label: '📝 小红书发帖', platforms: ['xiaohongshu'], desc: '填写小红书文案内容' },
]

// ── Electron API 类型声明 ──

declare global {
  interface Window {
    electronAPI?: {
      isElectron?: boolean
      fpStart?: (opts: { port: number; accountId?: string; platform?: string; proxy?: string }) => Promise<{ success: boolean; data?: any; error?: string }>
      fpStop?: (port: number) => Promise<{ success: boolean; error?: string }>
      fpList?: () => Promise<{ success: boolean; data?: BrowserInstance[]; error?: string }>
      fpScreenshot?: (port: number) => Promise<{ success: boolean; data?: string; error?: string }>
      fpInfo?: (port: number) => Promise<{ success: boolean; data?: any; error?: string }>
      fpExecute?: (port: number, templateType: string, params: any) => Promise<{ success: boolean; data?: any; error?: string; logs?: string[] }>
      fpScriptStop?: () => Promise<{ success: boolean; message?: string }>
    }
  }
}


export default function MyFingerprintPage() {
  const { user } = useAuth()
  const isElectron = typeof window !== 'undefined' && !!window.electronAPI?.isElectron

  // ── 账号列表 ──
  const [accounts, setAccounts] = useState<Account[]>([])
  const [loading, setLoading] = useState(true)

  // ── 浏览器实例列表 ──
  const [browsers, setBrowsers] = useState<BrowserInstance[]>([])

  // ── 选中的账号（工作台）──
  const [selectedAccount, setSelectedAccount] = useState<Account | null>(null)

  // ── 启动参数 ──
  const [proxyInput, setProxyInput] = useState('')

  // ── 模板执行 ──
  const [showTemplatePanel, setShowTemplatePanel] = useState(false)
  const [selectedTemplate, setSelectedTemplate] = useState<string>('')
  const [templateVideoPath, setTemplateVideoPath] = useState('')
  const [storageVideoName, setStorageVideoName] = useState<string>('')
  const [storageVideos, setStorageVideos] = useState<any[]>([])
  const [templateTitle, setTemplateTitle] = useState('')
  const [templateDesc, setTemplateDesc] = useState('')
  const [templateEnableTopics, setTemplateEnableTopics] = useState(true)
  const [templateCustomTopics, setTemplateCustomTopics] = useState('')
  const [templateCoverImage, setTemplateCoverImage] = useState('')
  const [storageImages, setStorageImages] = useState<any[]>([])
  const [templateAutoMusic, setTemplateAutoMusic] = useState('')
  const [storageMusics, setStorageMusics] = useState<any[]>([])
  const [templateLocation, setTemplateLocation] = useState('')
  const [templatePublishNow, setTemplatePublishNow] = useState(true)
  const [templateCaption, setTemplateCaption] = useState('')
  const [templateTargetUrl, setTemplateTargetUrl] = useState('')
  const [templateCount, setTemplateCount] = useState(3)
  const [executing, setExecuting] = useState(false)
  const [execLogs, setExecLogs] = useState<string[]>([])

  // ── 状态消息 ──
  const [msgText, setMsgText] = useState('')
  const [msgType, setMsgType] = useState<'info' | 'error' | 'success'>('info')


  // ── 数据加载 ──

  useEffect(() => {
    loadAccounts()
    if (isElectron) pollBrowserList()
  }, [])

  /** 定时轮询浏览器列表 */
  function pollBrowserList() {
    refreshBrowserList()
    const interval = setInterval(refreshBrowserList, 3000)
    return () => clearInterval(interval)
  }

  async function loadAccounts() {
    try {
      const r = await fetch('/api/accounts', { credentials: 'include' })
      if (r.ok) {
        const d = await r.json()
        const all = Array.isArray(d) ? d : (d.data || [])
        // 只显示 manual 类型的账号（已绑定且有端口的）
        setAccounts(all.filter((a: Account) => a.bindType === 'manual'))
      }
    } catch (_) {}
    setLoading(false)
  }

  async function refreshBrowserList() {
    if (!window.electronAPI?.fpList) return
    try {
      const res = await window.electronAPI.fpList()
      if (res.success && Array.isArray(res.data)) {
        setBrowsers(res.data)
      }
    } catch (_) {}
  }


  // ── 消息提示 ──

  const showMsg = useCallback((text: string, type: 'info' | 'error' | 'success' = 'info') => {
    setMsgText(text)
    setMsgType(type)
    setTimeout(() => setMsgText(''), 4000)
  }, [])


  // ── 浏览器操作 ──

  /** 启动浏览器 */
  const handleStart = async (acct: Account) => {
    if (!isElectron || !window.electronAPI?.fpStart) {
      showMsg('需要使用桌面客户端才能启动指纹浏览器', 'error')
      return
    }
    if (!acct.cdpPort) {
      showMsg('该账号未分配端口，请联系管理员绑定', 'error')
      return
    }

    const port = acct.cdpPort
    showMsg(`正在启动端口 ${port}...`, 'info')

    const res = await window.electronAPI.fpStart({
      port,
      accountId: String(acct.id),
      platform: acct.platform,
      proxy: proxyInput.trim(),
    })

    if (res.success) {
      showMsg(`✅ 浏览器已启动 - ${PLATFORMS.find(p => p.key === acct.platform)?.icon} ${acct.platform}`, 'success')
      setSelectedAccount(acct)
      setShowTemplatePanel(true)
      refreshBrowserList()
    } else {
      showMsg(`❌ 启动失败: ${res.error}`, 'error')
    }
  }

  /** 停止浏览器 */
  const handleStop = async (port: number) => {
    if (!window.electronAPI?.fpStop) return
    const res = await window.electronAPI.fpStop(port)
    if (res.success) {
      showMsg(`⏹ 端口 ${port} 已停止`, 'success')
      refreshBrowserList()
      if (selectedAccount && selectedAccount.cdpPort === port) {
        setSelectedAccount(null)
        setShowTemplatePanel(false)
        setExecLogs([])
      }
    } else {
      showMsg(`停止失败: ${res.error}`, 'error')
    }
  }

  /** 检查某端口的运行状态 */
  const isRunning = (port: number): boolean => {
    return browsers.some(b => b.port === port && b.running)
  }


  // ── 模板执行 ──

  const handleExecute = async () => {
    if (!selectedTemplate) { showMsg('请选择模板', 'error'); return }
    if (!selectedAccount?.cdpPort) return

    setExecuting(true)
    setExecLogs(['开始执行...'])

    const params: Record<string, any> = {}
    switch (selectedTemplate) {
      case 'douyin-publish':
        params.storageFileName = storageVideoName
        // 下载视频需要 userId + token（storage API 鉴权）
        try {
          const sr = await fetch(`/api/storage/files?userId=${user?.id || ''}`, { credentials: 'include' })
          const sd = await sr.json()
          if (sd.success) {
            params.userId = sd.data.userId
            // 提取当前 JWT token 供主进程下载时使用
            params.authToken = document.cookie.split(';').find(c => c.trim().startsWith('token='))?.trim().replace('token=', '') || ''
          }
        } catch {}
        params.title = templateTitle
        params.description = templateDesc
        params.topics = templateCustomTopics.trim()
        params.coverImage = templateCoverImage
        params.location = templateLocation
        params.publishNow = String(templatePublishNow)
        break
      case 'douyin-comment':
        params.comment = templateCaption
        params.targetUrl = templateTargetUrl
        break
      case 'douyin-like':
        params.targetUrls = templateTargetUrl ? [templateTargetUrl] : []
        params.count = templateCount
        break
      case 'xiaohongshu-publish':
        params.caption = templateCaption
        break
    }

    const port = selectedAccount.cdpPort!

    if (window.electronAPI?.fpExecute) {
      try {
        const res = await window.electronAPI.fpExecute(port, selectedTemplate, params)
        setExecuting(false)
        if (res.data?.logs) setExecLogs(res.data.logs)
        showMsg(res.data?.message || (res.success ? '执行完成' : '执行出错'), res.success ? 'success' : 'error')
      } catch (e: any) {
        setExecuting(false)
        setExecLogs(prev => [...prev, `错误: ${e.message}`])
        showMsg(`执行出错: ${e.message}`, 'error')
      }
    } else {
      setExecuting(false)
      setExecLogs(prev => [...prev, '需要客户端环境'])
      showMsg('需要在客户端中执行模板', 'error')
    }
  }


  // ── 渲染 ──


  if (loading) return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center">
      <p className="text-gray-400">加载中...</p>
    </div>
  )

  return (
    <div className="min-h-screen bg-gray-950 text-white p-4 md:p-6">
      {/* 标题 */}
      <div className="max-w-6xl mx-auto mb-6">
        <h1 className="text-2xl font-bold flex items-center gap-3">
          <span className="w-10 h-10 rounded-xl bg-purple-500/20 border border-purple-500/30 flex items-center justify-center text-xl">🌐</span>
          指纹浏览器工作台
          {!isElectron && (
            <span className="ml-2 text-xs px-2 py-1 rounded-full bg-yellow-500/20 text-yellow-400 border border-yellow-500/30">
              请在客户端中使用
            </span>
          )}
        </h1>
        <p className="text-sm text-gray-500 mt-2">本地 Chromium 多窗口管理 · 自动化脚本执行</p>
      </div>

      {/* 全局消息 */}
      {msgText && (
        <div className={`max-w-6xl mx-auto mb-4 px-4 py-3 rounded-lg text-sm border ${
          msgType === 'error' ? 'bg-red-500/10 text-red-400 border-red-500/30' :
          msgType === 'success' ? 'bg-green-500/10 text-green-400 border-green-500/30' :
          'bg-blue-500/10 text-blue-400 border-blue-500/30'
        }`}>
          {msgText}
        </div>
      )}

      {/* 代理设置栏 */}
      <div className="max-w-6xl mx-auto mb-6">
        <div className="bg-gray-900/50 border border-white/5 rounded-xl p-4 flex items-center gap-3">
          <span className="text-sm text-gray-400 whitespace-nowrap">🔀 代理:</span>
          <input
            type="text"
            value={proxyInput}
            onChange={e => setProxyInput(e.target.value)}
            placeholder="socks5://user:pass@ip:port （留空则直连）"
            className="flex-1 bg-gray-800/50 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:border-cyan-500/50 focus:outline-none"
          />
          <span className="text-[11px] text-gray-600">所有新启动的浏览器共用此代理设置</span>
        </div>
      </div>

      <div className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* ═══ 左侧：账号列表 ═══ */}
        <div className="lg:col-span-2 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-300">我的账号</h2>
            <span className="text-xs text-gray-600">{accounts.length} 个指纹浏览器账号</span>
          </div>

          {accounts.length === 0 ? (
            <div className="bg-gray-900/30 border border-dashed border-white/10 rounded-xl p-8 text-center">
              <p className="text-gray-500 text-sm mb-2">还没有指纹浏览器类型的账号</p>
              <p className="text-gray-600 text-xs">去「账号管理」登记一个 bindType=manual 的账号，管理员审核后会分配端口</p>
            </div>
          ) : (
            <div className="grid gap-3">
              {accounts.map(acct => {
                const plat = PLATFORMS.find(p => p.key === acct.platform) || { icon: '🌐', label: acct.platform }
                const port = acct.cdpPort || 0
                const running = port > 0 && isRunning(port)
                const browserInfo = browsers.find(b => b.port === port)

                return (
                  <div
                    key={acct.id}
                    onClick={() => setSelectedAccount(acct)}
                    className={`group relative bg-gray-900/40 border rounded-xl p-4 cursor-pointer transition-all ${
                      selectedAccount?.id === acct.id
                        ? 'border-purple-500/50 bg-purple-500/5 ring-1 ring-purple-500/20'
                        : 'border-white/5 hover:border-white/15 hover:bg-gray-900/60'
                    }`}
                  >
                    {/* 状态条 */}
                    <div className={`absolute left-0 top-4 bottom-4 w-1 rounded-r-full ${
                      running ? 'bg-emerald-500' : acct.isBound ? 'bg-cyan-500' : 'bg-gray-700'
                    }`} />

                    <div className="flex items-start justify-between pl-3">
                      <div className="flex items-start gap-3 min-w-0">
                        <span className="text-2xl mt-0.5">{plat.icon}</span>
                        <div className="min-w-0">
                          <p className="font-medium text-sm truncate">{acct.accountName}</p>
                          <p className="text-xs text-gray-500 mt-0.5">
                            {plat.label} · 端口 {acct.cdpPort || '未分配'} · {acct.status}
                            {running && browserInfo?.currentUrl && (
                              <span className="ml-2 text-cyan-400 truncate inline-block max-w-[200px]" title={browserInfo.currentUrl}>
                                🟢 运行中
                              </span>
                            )}
                          </p>
                        </div>
                      </div>

                      {/* 操作按钮 */}
                      <div className="flex items-center gap-2 shrink-0 ml-3">
                        {!running ? (
                          <button
                            onClick={(e) => { e.stopPropagation(); handleStart(acct) }}
                            disabled={!acct.cdpPort || !isElectron}
                            className="px-3 py-1.5 bg-purple-500/20 text-purple-400 border border-purple-500/30 rounded-lg text-xs hover:bg-purple-500/30 disabled:opacity-30 disabled:cursor-not-allowed transition"
                          >
                            启动
                          </button>
                        ) : (
                          <button
                            onClick={(e) => { e.stopPropagation(); handleStop(port) }}
                            className="px-3 py-1.5 bg-red-500/20 text-red-400 border border-red-500/30 rounded-lg text-xs hover:bg-red-500/30 transition"
                          >
                            停止
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>


        {/* ═══ 右侧：模板执行面板 ═══ */}
        <div className="space-y-4">
          <h2 className="text-sm font-semibold text-gray-300">自动化模板</h2>

          {(!selectedAccount || !selectedAccount.cdpPort || !isRunning(selectedAccount.cdpPort)) ? (
            <div className="bg-gray-900/30 border border-dashed border-white/10 rounded-xl p-6 text-center">
              <p className="text-gray-500 text-sm">先选择并启动一个浏览器</p>
              <p className="text-gray-600 text-xs mt-1">启动后可在此执行自动化脚本</p>
            </div>
          ) : (
            <div className="space-y-3">
              {/* 当前选中信息 */}
              <div className="bg-emerald-500/5 border border-emerald-500/20 rounded-xl p-3">
                <p className="text-xs text-emerald-400 font-medium">
                  🟢 当前: {selectedAccount.accountName}
                  ({PLATFORMS.find(p => p.key === selectedAccount.platform)?.label})
                </p>
                <p className="text-[11px] text-emerald-400/60 mt-0.5">端口 {selectedAccount.cdpPort} · 可执行模板</p>
              </div>

              {/* 模板选择 */}
              <div>
                <label className="text-xs text-gray-500 mb-1.5 block">选择模板</label>
                <div className="space-y-1.5">
                  {TEMPLATES.map(tmpl => {
                    const canUse = tmpl.platforms.includes(selectedAccount!.platform)
                    return (
                      <button
                        key={tmpl.key}
                        onClick={() => setSelectedTemplate(tmpl.key)}
                        disabled={!canUse}
                        className={`w-full text-left px-3 py-2.5 rounded-lg text-xs border transition ${
                          selectedTemplate === tmpl.key
                            ? 'bg-purple-500/15 border-purple-500/40 text-purple-300'
                            : canUse
                              ? 'bg-gray-800/30 border-white/5 text-gray-300 hover:border-white/15 hover:bg-gray-800/50'
                              : 'bg-gray-800/10 border-white/5 text-gray-600 cursor-not-allowed opacity-40'
                        }`}
                      >
                        <span className="font-medium">{tmpl.label}</span>
                        <p className="text-[10px] mt-0.5 opacity-60">{tmpl.desc}</p>
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* 模板参数 */}
              {selectedTemplate && (
                <div className="bg-gray-800/30 border border-white/5 rounded-xl p-3 space-y-2.5">
                  <p className="text-xs font-medium text-gray-300">
                    {TEMPLATES.find(t => t.key === selectedTemplate)?.label} 参数
                  </p>

                  {/* 抖音发帖/视频 专属参数 */}
                  {selectedTemplate === 'douyin-publish' && (
                    <>
                      {/* 素材仓库选择视频 */}
                      <div>
                        <label className="text-[11px] text-gray-500 block mb-1">选择视频（从素材仓库）</label>
                        {storageVideoName ? (
                          <div className="flex items-center gap-2 bg-purple-500/10 border border-purple-500/20 rounded-lg px-3 py-2">
                            <span className="text-[10px] text-purple-300 truncate flex-1">{storageVideoName}</span>
                            <button type="button" onClick={() => setStorageVideoName('')} className="text-red-400 hover:text-red-300 text-xs">✕</button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={async () => {
                              try {
                                const r = await fetch(`/api/storage/files?userId=${user?.id || ''}`, { credentials: 'include' })
                                const d = await r.json()
                                if (d.success) {
                                  const videos = d.data.files.filter((f: any) => f.isVideo)
                                  if (!videos.length) showToast('素材仓库暂无视频，请先上传', 'error')
                                  else { setStorageVideos(videos); }
                                } else showToast(d.message || '加载失败', 'error')
                              } catch { showToast('加载素材仓库失败', 'error') }
                            }}
                            className="w-full bg-gray-900/50 border border-white/10 rounded-lg px-3 py-2.5 text-xs text-gray-400 hover:text-white hover:border-purple-500/30 transition"
                          >📁 从素材仓库选择视频</button>
                        )}

                        {/* 视频列表弹层 */}
                        {storageVideos.length > 0 && !storageVideoName && (
                          <div className="mt-2 max-h-40 overflow-y-auto space-y-1">
                            {storageVideos.map((v: any) => (
                              <button key={v.name} type="button" onClick={() => { setStorageVideoName(v.name); setStorageVideos([]) }}
                                className={`w-full flex items-center gap-2 p-2 rounded-lg text-left transition ${
                                  storageVideoName === v.name ? 'bg-purple-500/20 border-purple-500/30' : 'bg-white/5 border border-transparent hover:bg-white/10'
                                }`}
                              >
                                <span className="text-sm shrink-0">{v.thumbUrl ? <img src={v.thumbUrl} className="w-10 h-6 object-cover rounded" alt="" /> : '🎬'}</span>
                                <div className="min-w-0 flex-1">
                                  <p className="text-[10px] text-gray-200 truncate">{v.name}</p>
                                  <p className="text-[9px] text-gray-500">{(v.size / 1024 / 1024).toFixed(1)}MB</p>
                                </div>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>

                      <div>
                        <label className="text-[11px] text-gray-500 block mb-1">作品标题（最多30字）</label>
                        <input
                          type="text"
                          value={templateTitle}
                          onChange={e => setTemplateTitle(e.target.value.slice(0, 30))}
                          placeholder="填写作品标题"
                          maxLength={30}
                          className="w-full bg-gray-900/50 border border-white/10 rounded-lg px-3 py-2 text-xs text-white placeholder-gray-600 focus:border-purple-500/30 focus:outline-none"
                        />
                      </div>

                      <div>
                        <label className="text-[11px] text-gray-500 block mb-1">作品简介 / 正文</label>
                        <textarea
                          value={templateDesc}
                          onChange={e => setTemplateDesc(e.target.value)}
                          placeholder="添加作品简介，最多1000字..."
                          rows={3}
                          className="w-full bg-gray-900/50 border border-white/10 rounded-lg px-3 py-2 text-xs text-white placeholder-gray-600 focus:border-purple-500/30 focus:outline-none resize-none"
                        />
                      </div>

                      <div>
                        <label className="text-[11px] text-gray-500 block mb-1">自定义话题（用逗号或空格分隔，如 #宠物 #萌宠）</label>
                        <input
                          type="text"
                          value={templateCustomTopics}
                          onChange={e => setTemplateCustomTopics(e.target.value)}
                          placeholder="#宠物 #萌宠 #日常"
                          className="w-full bg-gray-900/50 border border-white/10 rounded-lg px-3 py-2 text-xs text-white placeholder-gray-600 focus:border-purple-500/30 focus:outline-none"
                        />
                      </div>

                      {/* 自定义封面（可选） */}
                      <div>
                        <label className="text-[11px] text-gray-500 block mb-1">自定义封面图片（可选，留空使用系统默认）</label>
                        {templateCoverImage ? (
                          <div className="flex items-center gap-2 bg-purple-500/10 border border-purple-500/20 rounded-lg px-3 py-2">
                            <span className="text-[10px] text-purple-300 truncate flex-1">{templateCoverImage}</span>
                            <button type="button" onClick={() => setTemplateCoverImage('')} className="text-red-400 hover:text-red-300 text-xs">✕</button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={async () => {
                              try {
                                const r = await fetch(`/api/storage/files?userId=${user?.id || ''}`, { credentials: 'include' })
                                const d = await r.json()
                                if (d.success) {
                                  const imgs = d.data.files.filter((f: any) => !f.isVideo && /\.(jpg|jpeg|png|webp)$/i.test(f.name))
                                  if (!imgs.length) showToast('素材仓库暂无图片', 'error')
                                  else { setStorageImages(imgs); }
                                } else showToast(d.message || '加载失败', 'error')
                              } catch { showToast('加载素材仓库失败', 'error') }
                            }}
                            className="w-full bg-gray-900/50 border border-white/10 rounded-lg px-3 py-2.5 text-xs text-gray-400 hover:text-white hover:border-purple-500/30 transition"
                          >🖼️ 从素材仓库选择封面</button>
                        )}
                        {storageImages.length > 0 && !templateCoverImage && (
                          <div className="mt-2 max-h-32 overflow-y-auto space-y-1">
                            {storageImages.map((img: any) => (
                              <button key={img.name} type="button" onClick={() => { setTemplateCoverImage(img.name); setStorageImages([]) }}
                                className={`w-full flex items-center gap-2 p-2 rounded-lg text-left transition ${
                                  templateCoverImage === img.name ? 'bg-purple-500/20 border-purple-500/30' : 'bg-white/5 border border-transparent hover:bg-white/10'
                                }`}
                              >
                                <span className="text-sm shrink-0">🖼️</span>
                                <div className="min-w-0 flex-1">
                                  <p className="text-[10px] text-gray-200 truncate">{img.name}</p>
                                  <p className="text-[9px] text-gray-500">{(img.size / 1024).toFixed(1)}KB</p>
                                </div>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* 位置标签 */}
                      <div>
                        <label className="text-[11px] text-gray-500 block mb-1">地理位置（可选）</label>
                        <input
                          type="text"
                          value={templateLocation}
                          onChange={e => setTemplateLocation(e.target.value)}
                          placeholder="如：北京市朝阳区、上海市浦东新区"
                          className="w-full bg-gray-900/50 border border-white/10 rounded-lg px-3 py-2 text-xs text-white placeholder-gray-600 focus:border-purple-500/30 focus:outline-none"
                        />
                      </div>

                      <div>
                        <label className="text-[11px] text-gray-500 block mb-1">发布方式</label>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => setTemplatePublishNow(true)}
                            className={`flex-1 px-3 py-1.5 rounded-lg text-xs transition ${
                              templatePublishNow
                                ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                                : 'bg-gray-800/30 text-gray-500 border border-white/5'
                            }`}
                          >
                            立即发布
                          </button>
                          <button
                            type="button"
                            onClick={() => setTemplatePublishNow(false)}
                            className={`flex-1 px-3 py-1.5 rounded-lg text-xs transition ${
                              !templatePublishNow
                                ? 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/30'
                                : 'bg-gray-800/30 text-gray-500 border border-white/5'
                            }`}
                          >
                            仅保存草稿
                          </button>
                        </div>
                      </div>
                    </>
                  )}

                  {/* 评论模板参数 */}
                  {(selectedTemplate === 'douyin-comment') && (
                    <div>
                      <label className="text-[11px] text-gray-500 block mb-1">评论内容</label>
                      <textarea
                        value={templateCaption}
                        onChange={e => setTemplateCaption(e.target.value)}
                        placeholder="输入评论内容..."
                        rows={3}
                        className="w-full bg-gray-900/50 border border-white/10 rounded-lg px-3 py-2 text-xs text-white placeholder-gray-600 focus:border-purple-500/30 focus:outline-none resize-none"
                      />
                    </div>
                  )}

                  {(selectedTemplate === 'douyin-comment' || selectedTemplate === 'douyin-like') && (
                    <div>
                      <label className="text-[11px] text-gray-500 block mb-1">目标URL（可选）</label>
                      <input
                        type="text"
                        value={templateTargetUrl}
                        onChange={e => setTemplateTargetUrl(e.target.value)}
                        placeholder={selectedTemplate === 'douyin-like' ? '留空则在当前页面滚动点赞' : '留空则在当前页面评论'}
                        className="w-full bg-gray-900/50 border border-white/10 rounded-lg px-3 py-2 text-xs text-white placeholder-gray-600 focus:border-purple-500/30 focus:outline-none"
                      />
                    </div>
                  )}

                  {selectedTemplate === 'douyin-like' && (
                    <div>
                      <label className="text-[11px] text-gray-500 block mb-1">次数</label>
                      <input
                        type="number"
                        min={1}
                        max={20}
                        value={templateCount}
                        onChange={e => setTemplateCount(parseInt(e.target.value) || 3)}
                        className="w-full bg-gray-900/50 border border-white/10 rounded-lg px-3 py-2 text-xs text-white focus:border-purple-500/30 focus:outline-none"
                      />
                    </div>
                  )}

                  {/* 执行按钮 */}
                  <div className="flex gap-2">
                    {executing && (
                      <button
                        onClick={async () => {
                          if (window.electronAPI?.fpScriptStop) {
                            await window.electronAPI.fpScriptStop()
                            setExecLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] ⛔ 用户停止`])
                          }
                        }}
                        className="flex-1 py-2.5 rounded-lg text-sm font-medium bg-red-500/20 text-red-400 hover:bg-red-500/30 transition flex items-center justify-center gap-2"
                      >⏹ 停止</button>
                    )}
                    <button
                      onClick={handleExecute}
                      disabled={executing}
                      className={`flex-1 py-2.5 rounded-lg text-sm font-medium transition flex items-center justify-center gap-2 ${
                        executing
                          ? 'bg-gray-700 text-gray-400 cursor-wait'
                          : 'bg-gradient-to-r from-purple-500 to-violet-500 hover:from-purple-400 hover:to-violet-400 text-white'
                      }`}
                    >
                      {executing ? (
                        <>⏳ 执行中...</>
                      ) : (
                        <>▶️ 执行模板</>
                      )}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}


          {/* 执行日志 */}
          {execLogs.length > 0 && (
            <div className="bg-gray-950 border border-white/5 rounded-xl overflow-hidden">
              <div className="flex items-center justify-between px-3 py-2 border-b border-white/5">
                <span className="text-xs font-medium text-gray-400">📋 执行日志</span>
                <button onClick={() => setExecLogs([])} className="text-[10px] text-gray-600 hover:text-gray-400">清空</button>
              </div>
              <div className="max-h-48 overflow-y-auto p-3 space-y-1 font-mono text-[11px] leading-relaxed">
                {execLogs.map((log, i) => (
                  <p key={i} className="text-gray-500">{log}</p>
                ))}
              </div>
            </div>
          )}
        </div>

      </div>
    </div>
  )
}
