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

/** 单个发布任务 */
interface PublishTask {
  id: string
  videoName: string       // 视频文件名（素材仓库）
  title: string           // 标题
  description: string     // 文案/简介
  topics: string          // 话题
  coverImage: string      // 封面
  location: string        // 位置
  publishNow: boolean     // true=立即发布 false=草稿
  status: 'pending' | 'publishing' | 'done' | 'failed'
  errorMsg?: string
}

// ── 平台配置 ──

const PLATFORMS = [
  { key: 'douyin', label: '抖音', icon: '🎵', url: 'https://creator.douyin.com/creator-micro/content/upload' },
  { key: 'xiaohongshu', label: '小红书', icon: '📕', url: 'https://creator.xiaohongshu.com/publish/publish' },
  { key: 'kuaishou', label: '快手', icon: '🟠', url: 'https://cp.kuaishou.com/creator/video/upload' },
  { key: 'shipinhao', label: '视频号', icon: '🟢', url: 'https://channels.weixin.qq.com/platform/post/create' },
  { key: 'bilibili', label: 'B站', icon: '📺', url: 'https://member.bilibili.com/platform/upload/video/frame?spm_id_from=333.33.top_bar.upload' },
]

// 平台 -> 指纹浏览器发布模板类型（与 electron/main.js 的 fp:execute case 对应）
const TEMPLATE_MAP: Record<string, string> = {
  douyin: 'douyin-publish',
  xiaohongshu: 'xiaohongshu-publish',
  kuaishou: 'kuaishou-publish',
  shipinhao: 'shipinhao-publish',
  bilibili: 'bilibili-publish',
}
const getTemplateType = (platform?: string) => TEMPLATE_MAP[platform || 'douyin'] || 'douyin-publish'

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

  // ── 发布参数表单（用于添加到队列）──
  const [formVideoName, setFormVideoName] = useState('')
  const [storageVideos, setStorageVideos] = useState<any[]>([])
  const [formTitle, setFormTitle] = useState('')
  const [formDesc, setFormDesc] = useState('')
  const [formTopics, setFormTopics] = useState('')
  const [formCoverImage, setFormCoverImage] = useState('')
  const [storageImages, setStorageImages] = useState<any[]>([])
  const [formLocation, setFormLocation] = useState('')
  const [formPublishNow, setFormPublishNow] = useState(true)

  // ── 任务队列 ──
  const [taskQueue, setTaskQueue] = useState<PublishTask[]>([])

  // ── 未登录账号标记（发布返回 needLogin 时记录，用于提示去登录）──
  const [needLoginIds, setNeedLoginIds] = useState<string[]>([])

  // ── 批量发布控制 ──
  const [batchMode, setBatchMode] = useState<'immediate' | 'scheduled'>('immediate')
  const [intervalSeconds, setIntervalSeconds] = useState(30)
  const [scheduleTime, setScheduleTime] = useState('')   // 格式 HH:mm
  const [batchRunning, setBatchRunning] = useState(false)
  const [batchPaused, setBatchPaused] = useState(false)
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
        // 显示所有 manual 类型账号（支持多平台）
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
      setNeedLoginIds(prev => prev.filter(id => id !== String(acct.id)))
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
        setTaskQueue([])
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


  // ── 队列操作 ──

  /** 重置表单 */
  const resetForm = useCallback(() => {
    setFormVideoName('')
    setFormTitle('')
    setFormDesc('')
    setFormTopics('')
    setFormCoverImage('')
    setFormLocation('')
    setFormPublishNow(true)
  }, [])

  /** 添加任务到队列 */
  const addToQueue = () => {
    if (!formVideoName) {
      showToast('请先选择视频', 'error'); return
    }
    if (!formTitle.trim()) {
      showToast('请填写标题', 'error'); return
    }

    const task: PublishTask = {
      id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      videoName: formVideoName,
      title: formTitle.trim(),
      description: formDesc.trim(),
      topics: formTopics.trim(),
      coverImage: formCoverImage,
      location: formLocation,
      publishNow: formPublishNow,
      status: 'pending',
    }

    setTaskQueue(prev => [...prev, task])
    resetForm()
    showToast(`已添加到队列 (#${taskQueue.length + 1})`, 'success')
  }

  /** 立即发布当前填写的内容（不进队列，直接发这条） */
  const publishNow = async () => {
    if (!selectedAccount?.cdpPort) {
      showToast('请先选择并启动指纹浏览器', 'error'); return
    }
    if (!formVideoName) {
      showToast('请先选择视频', 'error'); return
    }
    if (!formTitle.trim()) {
      showToast('请填写标题', 'error'); return
    }
    if (batchRunning) return

    setBatchRunning(true)
    setExecLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] 🚀 立即发布: ${formVideoName}`])
    try {
      const task: PublishTask = {
        id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        videoName: formVideoName,
        title: formTitle.trim(),
        description: formDesc.trim(),
        topics: formTopics.trim(),
        coverImage: formCoverImage,
        location: formLocation,
        publishNow: formPublishNow,
        status: 'publishing',
      }
      const params = await buildTaskParams(task)
      if (window.electronAPI?.fpExecute) {
        const res = await window.electronAPI.fpExecute(selectedAccount.cdpPort, getTemplateType(selectedAccount.platform), params)
        if (res.success) {
          setExecLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] ✅ 发布完成: ${formVideoName}`])
          if (res.data?.logs) setExecLogs(prev => [...prev, ...res.data.logs])
          showToast('发布成功', 'success')
        } else {
          const needLogin = (res as any).needLogin || (res as any).data?.needLogin
          if (needLogin && selectedAccount) {
            setNeedLoginIds(prev => prev.includes(String(selectedAccount.id)) ? prev : [...prev, String(selectedAccount.id)])
          }
          setExecLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] ✗ 发布失败: ${res.error || '未知错误'}`])
          showToast(needLogin ? '该账号未登录平台，请点击「去登录」后重试' : ('发布失败: ' + (res.error || '未知错误')), 'error')
        }
      } else {
        setExecLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] ✗ 客户端未连接，无法发布`])
        showToast('客户端未连接，无法发布', 'error')
      }
    } catch (e: any) {
      setExecLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] ✗ 异常: ${e?.message || e}`])
      showToast('发布异常: ' + (e?.message || e), 'error')
    } finally {
      setBatchRunning(false)
    }
  }

  /** 从队列移除任务 */
  const removeFromQueue = (taskId: string) => {
    setTaskQueue(prev => prev.filter(t => t.id !== taskId))
  }

  /** 清空队列 */
  const clearQueue = () => {
    if (batchRunning) return
    setTaskQueue([])
  }


  // ── 批量发布执行 ──

  /** 构建单个任务的执行参数 */
  const buildTaskParams = async (task: PublishTask): Promise<Record<string, any>> => {
    const params: Record<string, any> = {}
    params.storageFileName = task.videoName
    // 获取鉴权信息
    try {
      const sr = await fetch(`/api/storage/files?userId=${user?.id || ''}`, { credentials: 'include' })
      const sd = await sr.json()
      if (sd.success) {
        params.userId = sd.data.userId
        params.authToken = document.cookie.split(';').find(c => c.trim().startsWith('token='))?.trim().replace('token=', '') || ''
      }
    } catch {}
    params.title = task.title
    params.description = task.description
    params.topics = task.topics
    params.coverImage = task.coverImage
    params.location = task.location
    params.publishNow = String(task.publishNow)
    return params
  }

  /** 开始批量发布 */
  const startBatchPublish = async () => {
    if (!selectedAccount?.cdpPort) return
    if (taskQueue.length === 0) { showToast('队列为空', 'error'); return }
    if (batchRunning) return

    // 定时模式：检查是否到了时间
    if (batchMode === 'scheduled' && scheduleTime) {
      const [h, m] = scheduleTime.split(':').map(Number)
      const now = new Date()
      const target = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h || 0, m || 0, 0)
      if (target > now) {
        const waitMs = target.getTime() - now.getTime()
        showMsg(`定时模式: 将在 ${scheduleTime} 开始发布`, 'info')
        setExecLogs(prev => [...prev, `[${now.toLocaleTimeString()}] ⏰ 定时设置: ${scheduleTime}, 等待 ${Math.round(waitMs / 1000)}s`])
        setTimeout(() => executeBatch(), waitMs)
        return
      }
    }

    await executeBatch()
  }

  /** 执行批量发布主循环 */
  const executeBatch = async () => {
    setBatchRunning(true)
    setBatchPaused(false)
    const port = selectedAccount!.cdpPort!

    // 获取当前待发任务快照
    const pendingTasks = [...taskQueue].filter(t => t.status === 'pending')

    if (pendingTasks.length === 0) {
      setBatchRunning(false); return
    }

    setExecLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] 🚀 开始批量发布，共 ${pendingTasks.length} 个任务`])

    let doneCount = 0
    let failCount = 0

    for (let i = 0; i < pendingTasks.length; i++) {
      if (batchPaused) {
        setExecLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] ⏸ 用户暂停`])
        break
      }

      const task = pendingTasks[i]

      // 标记为发布中
      setTaskQueue(prev => prev.map(t =>
        t.id === task.id ? { ...t, status: 'publishing' as const } : t
      ))
      setExecLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] 📤 发布第 ${i + 1}/${pendingTasks.length}: ${task.videoName}`])

      try {
        const params = await buildTaskParams(task)
        if (window.electronAPI?.fpExecute) {
          const res = await window.electronAPI.fpExecute(port, getTemplateType(selectedAccount.platform), params)
          if (res.success) {
            doneCount++
            setTaskQueue(prev => prev.map(t =>
              t.id === task.id ? { ...t, status: 'done' as const } : t
            ))
            setExecLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] ✅ 第 ${i + 1} 个任务完成: ${task.videoName}`])
            if (res.data?.logs) setExecLogs(prev => [...prev, ...res.data.logs])
          } else {
            failCount++
            const needLogin = (res as any).needLogin || (res as any).data?.needLogin
            if (needLogin && selectedAccount) {
              setNeedLoginIds(prev => prev.includes(String(selectedAccount.id)) ? prev : [...prev, String(selectedAccount.id)])
            }
            setTaskQueue(prev => prev.map(t =>
              t.id === task.id ? { ...t, status: 'failed' as const, errorMsg: res.error } : t
            ))
            setExecLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] ❌ 第 ${i + 1} 个任务失败: ${res.error || ''}${needLogin ? '（账号未登录，请先去登录）' : ''}`])
          }
        } else {
          throw new Error('需要客户端环境')
        }
      } catch (e: any) {
        failCount++
        setTaskQueue(prev => prev.map(t =>
          t.id === task.id ? { ...t, status: 'failed' as const, errorMsg: e.message } : t
        ))
        setExecLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] ❌ 异常: ${e.message}`])
      }

      // 间隔等待（最后一个不等待）
      if (i < pendingTasks.length - 1 && !batchPaused) {
        const delay = intervalSeconds * 1000
        setExecLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] ⏳ 等待 ${intervalSeconds}s...`])
        await new Promise(r => setTimeout(r, delay))
      }
    }

    setBatchRunning(false)
    setExecLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] 🏁 批量发布结束: ✅${doneCount} ❌${failCount}`])
    showMsg(`批量发布完成: 成功 ${doneCount}, 失败 ${failCount}`, failCount > 0 ? 'error' : 'success')
  }

  /** 暂停批量发布 */
  const pauseBatch = () => {
    setBatchPaused(true)
    setExecLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] ⏸ 正在暂停...`])
  }

  /** 停止批量发布（完全停止） */
  const stopBatch = async () => {
    setBatchPaused(true)
    setBatchRunning(false)
    if (window.electronAPI?.fpScriptStop) {
      await window.electronAPI.fpScriptStop()
    }
    setExecLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] ⛔ 已停止`])
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
          抖音批量发布工作台
          {!isElectron && (
            <span className="ml-2 text-xs px-2 py-1 rounded-full bg-yellow-500/20 text-yellow-400 border border-yellow-500/30">
              请在客户端中使用
            </span>
          )}
        </h1>
        <p className="text-sm text-gray-500 mt-2">选择账号 → 添加视频到队列 → 批量自动发布</p>
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
            <span className="text-xs text-gray-600">{accounts.length} 个账号</span>
          </div>

          {accounts.length === 0 ? (
            <div className="bg-gray-900/30 border border-dashed border-white/10 rounded-xl p-8 text-center">
              <p className="text-gray-500 text-sm mb-2">还没有指纹浏览器类型的账号</p>
              <p className="text-gray-600 text-xs">去「账号管理」登记一个 bindType=manual 的账号</p>
            </div>
          ) : (
            <div className="grid gap-3">
              {accounts.map(acct => {
                const plat = PLATFORMS.find(p => p.key === acct.platform) || { icon: '🎵', label: acct.platform }
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
                        {needLoginIds.includes(String(acct.id)) ? (
                          <button
                            onClick={(e) => { e.stopPropagation(); handleStart(acct) }}
                            disabled={!acct.cdpPort || !isElectron}
                            className="px-3 py-1.5 bg-red-500/20 text-red-400 border border-red-500/40 rounded-lg text-xs hover:bg-red-500/30 disabled:opacity-30 disabled:cursor-not-allowed transition animate-pulse"
                          >
                            🔓 去登录
                          </button>
                        ) : !running ? (
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


        {/* ═══ 右侧：批量发布面板 ═══ */}
        <div className="space-y-4">
          <h2 className="text-sm font-semibold text-gray-300">批量发布</h2>

          {(!selectedAccount || !selectedAccount.cdpPort || !isRunning(selectedAccount.cdpPort)) ? (
            <div className="bg-gray-900/30 border border-dashed border-white/10 rounded-xl p-6 text-center">
              <p className="text-gray-500 text-sm">先选择并启动一个{PLATFORMS.find(p => p.key === selectedAccount?.platform)?.label || '目标平台'}浏览器</p>
              <p className="text-gray-600 text-xs mt-1">启动后可添加视频到发布队列</p>
            </div>
          ) : (
            <div className="space-y-3">
              {/* 当前选中信息 */}
              <div className="bg-emerald-500/5 border border-emerald-500/20 rounded-xl p-3">
                <p className="text-xs text-emerald-400 font-medium">
                  🟢 当前: {selectedAccount.accountName}
                </p>
                <p className="text-[11px] text-emerald-400/60 mt-0.5">端口 {selectedAccount.cdpPort}</p>
              </div>

              {/* ═══ 添加视频表单 ═══ */}
              <div className="bg-gray-800/30 border border-white/5 rounded-xl p-3 space-y-2.5">
                <p className="text-xs font-medium text-gray-300">📝 添加发布内容</p>

                {/* 选择视频 */}
                <div>
                  <label className="text-[11px] text-gray-500 block mb-1">视频 *</label>
                  {formVideoName ? (
                    <div className="flex items-center gap-2 bg-purple-500/10 border border-purple-500/20 rounded-lg px-3 py-2">
                      <span className="text-[10px] text-purple-300 truncate flex-1">{formVideoName}</span>
                      <button type="button" onClick={() => setFormVideoName('')} className="text-red-400 hover:text-red-300 text-xs">✕</button>
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
                    >📁 从素材仓库选视频</button>
                  )}
                  {storageVideos.length > 0 && !formVideoName && (
                    <div className="mt-2 max-h-40 overflow-y-auto space-y-1">
                      {storageVideos.map((v: any) => (
                        <button key={v.name} type="button" onClick={() => { setFormVideoName(v.name); setStorageVideos([]) }}
                          className={`w-full flex items-center gap-2 p-2 rounded-lg text-left transition ${
                            formVideoName === v.name ? 'bg-purple-500/20 border-purple-500/30' : 'bg-white/5 border border-transparent hover:bg-white/10'
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

                {/* 标题 */}
                <div>
                  <label className="text-[11px] text-gray-500 block mb-1">标题 *（最多30字）</label>
                  <input
                    type="text"
                    value={formTitle}
                    onChange={e => setFormTitle(e.target.value.slice(0, 30))}
                    placeholder="填写作品标题"
                    maxLength={30}
                    className="w-full bg-gray-900/50 border border-white/10 rounded-lg px-3 py-2 text-xs text-white placeholder-gray-600 focus:border-purple-500/30 focus:outline-none"
                  />
                </div>

                {/* 文案/简介 */}
                <div>
                  <label className="text-[11px] text-gray-500 block mb-1">文案 / 简介</label>
                  <textarea
                    value={formDesc}
                    onChange={e => setFormDesc(e.target.value)}
                    placeholder="添加作品简介..."
                    rows={2}
                    className="w-full bg-gray-900/50 border border-white/10 rounded-lg px-3 py-2 text-xs text-white placeholder-gray-600 focus:border-purple-500/30 focus:outline-none resize-none"
                  />
                </div>

                {/* 话题 */}
                <div>
                  <label className="text-[11px] text-gray-500 block mb-1">话题（逗号分隔）</label>
                  <input
                    type="text"
                    value={formTopics}
                    onChange={e => setFormTopics(e.target.value)}
                    placeholder="#宠物 #萌宠"
                    className="w-full bg-gray-900/50 border border-white/10 rounded-lg px-3 py-2 text-xs text-white placeholder-gray-600 focus:border-purple-500/30 focus:outline-none"
                  />
                </div>

                {/* 封面（可选） */}
                <div>
                  <label className="text-[11px] text-gray-500 block mb-1">封面（可选）</label>
                  {formCoverImage ? (
                    <div className="flex items-center gap-2 bg-purple-500/10 border border-purple-500/20 rounded-lg px-3 py-2">
                      <span className="text-[10px] text-purple-300 truncate flex-1">{formCoverImage}</span>
                      <button type="button" onClick={() => setFormCoverImage('')} className="text-red-400 hover:text-red-300 text-xs">✕</button>
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
                    >🖼️ 从素材仓库选封面</button>
                  )}
                  {storageImages.length > 0 && !formCoverImage && (
                    <div className="mt-2 max-h-32 overflow-y-auto space-y-1">
                      {storageImages.map((img: any) => (
                        <button key={img.name} type="button" onClick={() => { setFormCoverImage(img.name); setStorageImages([]) }}
                          className={`w-full flex items-center gap-2 p-2 rounded-lg text-left transition ${
                            formCoverImage === img.name ? 'bg-purple-500/20 border-purple-500/30' : 'bg-white/5 border border-transparent hover:bg-white/10'
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

                {/* 位置 */}
                <div>
                  <label className="text-[11px] text-gray-500 block mb-1">位置（可选）</label>
                  <input
                    type="text"
                    value={formLocation}
                    onChange={e => setFormLocation(e.target.value)}
                    placeholder="如：北京市朝阳区"
                    className="w-full bg-gray-900/50 border border-white/10 rounded-lg px-3 py-2 text-xs text-white placeholder-gray-600 focus:border-purple-500/30 focus:outline-none"
                  />
                </div>

                {/* 发布方式 */}
                <div>
                  <label className="text-[11px] text-gray-500 block mb-1">发布方式</label>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setFormPublishNow(true)}
                      className={`flex-1 px-3 py-1.5 rounded-lg text-xs transition ${
                        formPublishNow
                          ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                          : 'bg-gray-800/30 text-gray-500 border border-white/5'
                      }`}
                    >立即发布</button>
                    <button
                      type="button"
                      onClick={() => setFormPublishNow(false)}
                      className={`flex-1 px-3 py-1.5 rounded-lg text-xs transition ${
                        !formPublishNow
                          ? 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/30'
                          : 'bg-gray-800/30 text-gray-500 border border-white/5'
                      }`}
                    >仅草稿</button>
                  </div>
                  {/* 真正的立即发布动作按钮 */}
                  <button
                    type="button"
                    onClick={publishNow}
                    disabled={!formVideoName || !formTitle.trim() || batchRunning}
                    className="w-full mt-2 py-2.5 rounded-lg text-sm font-medium bg-gradient-to-r from-emerald-500 to-green-500 hover:from-emerald-400 hover:to-green-400 text-white disabled:opacity-40 disabled:cursor-not-allowed transition flex items-center justify-center gap-2"
                  >
                    🚀 立即发布当前内容
                  </button>
                </div>

                {/* 添加到队列按钮 */}
                <button
                  type="button"
                  onClick={addToQueue}
                  disabled={!formVideoName || !formTitle.trim()}
                  className="w-full py-2.5 rounded-lg text-sm font-medium bg-gradient-to-r from-cyan-500 to-blue-500 hover:from-cyan-400 hover:to-blue-400 text-white disabled:opacity-40 disabled:cursor-not-allowed transition flex items-center justify-center gap-2"
                >
                  ➕ 添加到发布队列 ({taskQueue.length})
                </button>
              </div>

              {/* ═══ 队列表格 ═══ */}
              {taskQueue.length > 0 && (
                <div className="bg-gray-800/30 border border-white/5 rounded-xl overflow-hidden">
                  <div className="flex items-center justify-between px-3 py-2 border-b border-white/5">
                    <span className="text-xs font-medium text-gray-400">📋 发布队列 ({taskQueue.length})</span>
                    <button onClick={clearQueue} disabled={batchRunning} className="text-[10px] text-red-400 hover:text-red-300 disabled:text-gray-600">清空</button>
                  </div>
                  <div className="max-h-56 overflow-y-auto">
                    <table className="w-full text-[11px]">
                      <thead className="sticky top-0 bg-gray-800/90">
                        <tr className="text-gray-500">
                          <th className="py-1.5 px-2 text-left font-medium w-8">#</th>
                          <th className="py-1.5 px-2 text-left font-medium">视频</th>
                          <th className="py-1.5 px-2 text-left font-medium hidden sm:table-cell">文案</th>
                          <th className="py-1.5 px-2 text-center font-medium w-16">状态</th>
                          <th className="py-1.5 px-2 text-center font-medium w-8"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {taskQueue.map((task, idx) => (
                          <tr key={task.id} className={`border-t border-white/5 ${idx % 2 ? 'bg-transparent' : 'bg-white/[0.02]'}`}>
                            <td className="py-1.5 px-2 text-gray-500">{idx + 1}</td>
                            <td className="py-1.5 px-2 text-gray-300 max-w-[120px] truncate" title={task.videoName}>{task.videoName}</td>
                            <td className="py-1.5 px-2 text-gray-500 max-w-[100px] truncate hidden sm:table-cell" title={task.title}>{task.title}</td>
                            <td className="py-1.5 px-2 text-center">
                              {task.status === 'pending' && <span className="text-gray-500">○ 待发</span>}
                              {task.status === 'publishing' && <span className="text-cyan-400 animate-pulse">● 发布中</span>}
                              {task.status === 'done' && <span className="text-emerald-400">✓ 完成</span>}
                              {task.status === 'failed' && <span className="text-red-400" title={task.errorMsg}>✗ 失败</span>}
                            </td>
                            <td className="py-1.5 px-2 text-center">
                              {(task.status === 'pending' && !batchRunning) && (
                                <button onClick={() => removeFromQueue(task.id)} className="text-gray-600 hover:text-red-400 text-xs">✕</button>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* ═══ 批量发布控制栏 ═══ */}
              {taskQueue.length > 0 && (
                <div className="bg-gradient-to-b from-purple-500/10 to-gray-800/30 border border-purple-500/20 rounded-xl p-3 space-y-2.5">
                  <p className="text-xs font-medium text-gray-300">⚙️ 发布控制</p>

                  {/* 发布模式切换 */}
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setBatchMode('immediate')}
                      className={`flex-1 px-3 py-1.5 rounded-lg text-xs transition ${
                        batchMode === 'immediate'
                          ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                          : 'bg-gray-800/30 text-gray-500 border border-white/5'
                      }`}
                    >○ 立即依次发布</button>
                    <button
                      type="button"
                      onClick={() => setBatchMode('scheduled')}
                      className={`flex-1 px-3 py-1.5 rounded-lg text-xs transition ${
                        batchMode === 'scheduled'
                          ? 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/30'
                          : 'bg-gray-800/30 text-gray-500 border border-white/5'
                      }`}
                    >🕐 定时发布</button>
                  </div>

                  {/* 参数 */}
                  <div className="flex gap-2">
                    {batchMode === 'immediate' ? (
                      <div className="flex-1 flex items-center gap-2">
                        <label className="text-[10px] text-gray-500 whitespace-nowrap">间隔</label>
                        <input
                          type="number"
                          min={5}
                          max={300}
                          value={intervalSeconds}
                          onChange={e => setIntervalSeconds(parseInt(e.target.value) || 30)}
                          className="w-16 bg-gray-900/50 border border-white/10 rounded-lg px-2 py-1 text-xs text-white focus:border-purple-500/30 outline-none"
                        />
                        <span className="text-[10px] text-gray-500">秒</span>
                      </div>
                    ) : (
                      <div className="flex-1 flex items-center gap-2">
                        <label className="text-[10px] text-gray-500 whitespace-nowrap">时间</label>
                        <input
                          type="time"
                          value={scheduleTime}
                          onChange={e => setScheduleTime(e.target.value)}
                          className="flex-1 bg-gray-900/50 border border-white/10 rounded-lg px-2 py-1 text-xs text-white focus:border-purple-500/30 outline-none"
                        />
                      </div>
                    )}
                  </div>

                  {/* 操作按钮 */}
                  <div className="flex gap-2">
                    {batchRunning && (
                      <>
                        <button
                          onClick={batchPaused ? () => executeBatch() : pauseBatch}
                          className="flex-1 py-2 rounded-lg text-xs font-medium bg-yellow-500/20 text-yellow-400 hover:bg-yellow-500/30 transition"
                        >
                          {batchPaused ? '▶ 恢复' : '⏸ 暂停'}
                        </button>
                        <button
                          onClick={stopBatch}
                          className="flex-1 py-2 rounded-lg text-xs font-medium bg-red-500/20 text-red-400 hover:bg-red-500/30 transition"
                        >⛔ 停止</button>
                      </>
                    )}
                    <button
                      onClick={startBatchPublish}
                      disabled={batchRunning || taskQueue.every(t => t.status !== 'pending')}
                      className={`flex-1 py-2 rounded-lg text-sm font-medium transition flex items-center justify-center gap-1.5 ${
                        batchRunning
                          ? 'bg-gray-700 text-gray-400 cursor-wait'
                          : 'bg-gradient-to-r from-purple-500 to-violet-500 hover:from-purple-400 hover:to-violet-400 text-white disabled:opacity-40'
                      }`}
                    >
                      {batchRunning ? '⏳ 发布中...' : '▶ 开始批量发布'}
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
