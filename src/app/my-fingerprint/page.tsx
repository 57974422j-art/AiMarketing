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
  coverImage: string      // 封面（自定义/AI 封面 URL 或素材仓库文件名；平台智能封面模式时为空）
  coverMode: 'upload' | 'platform'  // upload=上传封面 / platform=使用平台智能封面（不上传）
  location: string        // 位置
  publishNow: boolean     // true=立即发布 false=草稿
  declaration?: string        // B站创作声明（内容无需标注/含AI生成内容/含虚构演绎内容）
  declarationExtras?: string[]// B站附加声明（内容含营销信息/个人观点，仅供参考/内容为转载）
  copyrightSelf?: boolean     // B站授权声明：内容为自制，禁止转载
  status: 'pending' | 'publishing' | 'done' | 'failed'
  errorMsg?: string
  platform?: string          // Agent 任务指定平台（决定用哪个模板发，避免发错平台）
}

// ── 平台配置 ──

const PLATFORMS = [
  { key: 'douyin', label: '抖音', icon: '🎵', url: 'https://creator.douyin.com/creator-micro/content/upload' },
  { key: 'xiaohongshu', label: '小红书', icon: '📕', url: 'https://creator.xiaohongshu.com/publish/publish' },
  { key: 'kuaishou', label: '快手', icon: '🟠', url: 'https://cp.kuaishou.com/creator/video/upload' },
  { key: 'shipinhao', label: '视频号', icon: '🟢', url: 'https://channels.weixin.qq.com/platform/post/create' },
  { key: 'bilibili', label: 'B站', icon: '📺', url: 'https://member.bilibili.com/platform/upload/video/frame?spm_id_from=333.33.top_bar.upload' },
  { key: 'weibo', label: '微博', icon: '🐧', url: 'https://weibo.com' },
]

// 平台 -> 指纹浏览器发布模板类型（与 electron/main.js 的 fp:execute case 对应）
const TEMPLATE_MAP: Record<string, string> = {
  douyin: 'douyin-publish',
  xiaohongshu: 'xiaohongshu-publish',
  kuaishou: 'kuaishou-publish',
  shipinhao: 'shipinhao-publish',
  bilibili: 'bilibili-publish',
  weibo: 'weibo-publish',
}
// 平台名归一化：兼容中英文 / 大小写 / 常见别名 → 标准 key（与 TEMPLATE_MAP / main.js case / PLATFORMS.key 对应）
// 解决：账号库里 platform 若存成中文「微博」「抖音」或大小写不一致，导致 getTemplateType 落到默认 douyin-publish
const PLATFORM_ALIASES: Record<string, string> = {
  douyin: 'douyin', '抖音': 'douyin', 'tiktok': 'douyin',
  xiaohongshu: 'xiaohongshu', '小红书': 'xiaohongshu', 'xhs': 'xiaohongshu', 'red': 'xiaohongshu',
  kuaishou: 'kuaishou', '快手': 'kuaishou', 'ks': 'kuaishou',
  shipinhao: 'shipinhao', '视频号': 'shipinhao', 'weixin': 'shipinhao', 'channels': 'shipinhao',
  bilibili: 'bilibili', 'b站': 'bilibili', 'bili': 'bilibili',
  weibo: 'weibo', '微博': 'weibo', 'microblog': 'weibo',
}
const normalizePlatform = (p?: string) =>
  p ? (PLATFORM_ALIASES[(p || '').toLowerCase().trim()] || PLATFORM_ALIASES[(p || '').trim()] || (p || '').trim()) : 'douyin'

const getTemplateType = (platform?: string) => TEMPLATE_MAP[normalizePlatform(platform)] || 'douyin-publish'

// ── Electron API 类型声明 ──

declare global {
  interface Window {
    electronAPI?: {
      isElectron?: boolean
      fpStart?: (opts: { port: number; userId?: number; accountId?: string; platform?: string; proxy?: string }) => Promise<{ success: boolean; data?: any; error?: string }>
      fpStop?: (port: number) => Promise<{ success: boolean; error?: string }>
      fpList?: () => Promise<{ success: boolean; data?: BrowserInstance[]; error?: string }>
      fpScreenshot?: (port: number) => Promise<{ success: boolean; data?: string; error?: string }>
      fpInfo?: (port: number) => Promise<{ success: boolean; data?: any; error?: string }>
      fpExecute?: (port: number, templateType: string, params: any) => Promise<{ success: boolean; data?: any; error?: string; logs?: string[] }>
      fpScriptStop?: () => Promise<{ success: boolean; message?: string }>
      fpMarkLogin?: (accountId: number | string) => Promise<{ success: boolean; error?: string }>
      fpLoginState?: (accountId: number | string) => Promise<{ success: boolean; data?: { loggedIn: boolean }; error?: string }>
      fpLogout?: (accountId: number | string) => Promise<{ success: boolean; error?: string }>
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
  const [formCoverMode, setFormCoverMode] = useState<'upload' | 'platform'>('upload')  // upload=上传封面 / platform=平台智能封面
  // B站创作声明（必填，不选平台不给发布）
  const [formDeclaration, setFormDeclaration] = useState('内容无需标注')
  const [formDeclExtras, setFormDeclExtras] = useState<string[]>([])
  const [formCopyrightSelf, setFormCopyrightSelf] = useState(false)

  // ── OpenCLI 发布（2026-08-21：驱动用户已登录 Chrome 真发布——抖音/小红书/微博）──
  const [ocSite, setOcSite] = useState('douyin')
  const [ocTitle, setOcTitle] = useState('')
  const [ocVideo, setOcVideo] = useState('')
  const [ocResult, setOcResult] = useState('')
  const [ocBusy, setOcBusy] = useState(false)
  const opencliPublish = async () => {
    if (!ocTitle.trim()) { showToast('请填写标题', 'error'); return }
    setOcBusy(true); setOcResult('')
    try {
      const args: string[] = [ocTitle.trim()]
      if (ocVideo.trim()) args.push(ocVideo.trim())
      const r = await (window as any).electronAPI?.opencliPublish({ site: ocSite, args })
      setOcResult(r?.success ? '✅ 发布完成：' + (r.output || '') : '❌ ' + (r?.error || '失败') + (r?.hint ? '
' + r.hint : ''))
    } catch (e: any) { setOcResult('❌ ' + (e.message || e)) }
    setOcBusy(false)
  }

  // 封面缩微图下方的文件名显示：去掉多余 URL，只展示可读文件名
  const coverDisplayName = (() => {
    const raw = formCoverImage
    if (!raw) return ''
    if (raw.startsWith('http')) {
      try {
        const u = new URL(raw)
        const nameParam = u.searchParams.get('name')
        if (nameParam) return decodeURIComponent(nameParam.split('/').pop() || nameParam)
        const seg = u.pathname.split('/').filter(Boolean).pop()
        return seg ? decodeURIComponent(seg) : raw
      } catch { return raw }
    }
    return raw
  })()
  const [aiUsage, setAiUsage] = useState<null | { promptTokens: number; completionTokens: number; totalTokens: number }>(null)
  const [aiFillPoints, setAiFillPoints] = useState<number | null>(null)   // AI 看片消耗点数
  const [aiCoverPoints, setAiCoverPoints] = useState<number | null>(null) // AI 生封面消耗点数
  const [aiLog, setAiLog] = useState<string[]>([])                       // AI 看片过程日志（前端可见）
  const [storageImages, setStorageImages] = useState<any[]>([])
  const [formLocation, setFormLocation] = useState('')
  const [formPublishNow, setFormPublishNow] = useState(true)

  // ── AI 智能填充（可选）──
  const [aiMode, setAiMode] = useState<'frame' | 'full'>('frame')  // frame=抽帧3~5帧 / full=整段8~10帧
  const [aiLoading, setAiLoading] = useState(false)
  const [aiCoverLoading, setAiCoverLoading] = useState(false)

  // ── 任务队列 ──
  const [taskQueue, setTaskQueue] = useState<PublishTask[]>([])

  // ── 草稿箱 ──
  const [drafts, setDrafts] = useState<any[]>([])
  const [draftsOpen, setDraftsOpen] = useState(false)
  const [savingDraft, setSavingDraft] = useState(false)

  // ── 账号登录态（按 accountId 维度，跨刷新持久：启动时从本地标记文件读取）──
  const [loginState, setLoginState] = useState<Record<number, boolean>>({})
  const setAccountLoggedIn = (id: number, loggedIn: boolean) =>
    setLoginState(prev => ({ ...prev, [id]: loggedIn }))
  const [runningPort, setRunningPort] = useState<number | null>(null)
  const [activeAccountId, setActiveAccountId] = useState<number | null>(null)

  // ── 批量发布控制 ──
  const [batchMode, setBatchMode] = useState<'immediate' | 'scheduled'>('immediate')
  const [intervalSeconds, setIntervalSeconds] = useState(30)
  const [scheduleTime, setScheduleTime] = useState('')   // 格式 HH:mm
  const [batchRunning, setBatchRunning] = useState(false)
  const [batchPaused, setBatchPaused] = useState(false)
  const [execLogs, setExecLogs] = useState<string[]>([])

  // ── 跨平台排队发布 ──
  // 开启后：队列内容将依次发到勾选的多个账号（每个账号对应一个平台），即「一条草稿顺着 6 个媒体挨个发」
  const [crossPlatformMode, setCrossPlatformMode] = useState(false)
  // 勾选的多账号 id（跨平台模式使用；非跨平台模式仍用 selectedAccount 单账号）
  const [selectedAccountIds, setSelectedAccountIds] = useState<number[]>([])

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
    importAgentTasks()
    const interval = setInterval(() => { refreshBrowserList(); importAgentTasks() }, 3000)
    return () => clearInterval(interval)
  }

  async function loadAccounts() {
    try {
      const r = await fetch('/api/accounts', { credentials: 'include' })
      if (r.ok) {
        const d = await r.json()
        const all = Array.isArray(d) ? d : (d.data || [])
        // 显示所有 manual 类型账号（支持多平台）
        const manual = (all as Account[]).filter((a: Account) => a.bindType === 'manual')
        setAccounts(manual)
        // 同步本地登录态（Electron 端按 Account.id 维度的标记文件，跨刷新持久）
        if (isElectron && window.electronAPI?.fpLoginState) {
          const fpLoginState = window.electronAPI.fpLoginState
          const states: Record<number, boolean> = {}
          await Promise.all(manual.map(async (a: Account) => {
            try {
              const lr = await fpLoginState(a.id)
              states[a.id] = !!(lr.success && lr.data?.loggedIn)
            } catch { states[a.id] = false }
          }))
          setLoginState(states)
        }
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

  /** 启动浏览器（先向服务器动态申请端口，再用该端口本地启动） */
  const handleStart = async (acct: Account) => {
    if (!isElectron || !window.electronAPI?.fpStart) {
      showMsg('需要使用桌面客户端才能启动指纹浏览器', 'error')
      return
    }

    try {
      showMsg(`正在为 ${acct.platform} 申请端口并启动...`, 'info')
      // 1) 向服务器动态申请一个空闲端口（全局限量，订阅校验由中间件拦截）
      const alloc = await fetch('/api/browser/allocate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ platform: acct.platform }),
      })
      const ad = await alloc.json()
      if (!alloc.ok || !ad.success) {
        showMsg('申请端口失败：' + (ad.message || alloc.status), 'error')
        return
      }
      const port = ad.data.port
      // 2) 用该端口在本地启动指纹浏览器（profile 按 用户+平台 落盘）
      const res = await window.electronAPI.fpStart({
        port,
        userId: user?.id,
        accountId: String(acct.id),
        platform: acct.platform,
        proxy: proxyInput.trim(),
      })
      if (res.success) {
        setRunningPort(port)
        setActiveAccountId(acct.id)
        setSelectedAccount(acct)
        // 启动浏览器用于登录；登录态由「我已登录」按钮或发布成功后标记
        showMsg(`✅ 浏览器已启动 - ${PLATFORMS.find(p => p.key === normalizePlatform(acct.platform))?.icon} ${PLATFORMS.find(p => p.key === normalizePlatform(acct.platform))?.label || acct.platform}（端口 ${port}）`, 'success')
        refreshBrowserList()
      } else {
        // 启动失败则释放刚申请的端口
        await fetch(`/api/browser/release?port=${port}`, { method: 'DELETE', credentials: 'include' }).catch(() => {})
        showMsg(`❌ 启动失败: ${res.error}`, 'error')
      }
    } catch (e: any) {
      showMsg(`启动异常: ${e?.message || e}`, 'error')
    }
  }

  /** 标记账号已登录（扫码完成后手动确认，本地持久化登录态，解决“保存不住”） */
  const handleMarkLogin = async (acct: Account) => {
    if (!isElectron || !window.electronAPI?.fpMarkLogin) {
      showMsg('需要使用桌面客户端才能标记登录', 'error')
      return
    }
    const r = await window.electronAPI.fpMarkLogin(acct.id)
    if (r.success) {
      setAccountLoggedIn(acct.id, true)
      showMsg(`✅ 已记录 ${acct.platform} 账号登录态（持久保存，刷新不丢）`, 'success')
    } else {
      showMsg('标记失败: ' + (r.error || ''), 'error')
    }
  }

  /** 停止浏览器（同时向服务器释放端口） */
  const handleStop = async () => {
    if (runningPort === null || !window.electronAPI?.fpStop) return
    const port = runningPort
    const res = await window.electronAPI.fpStop(port)
    // 无论停止是否成功，都向服务器归还端口
    await fetch(`/api/browser/release?port=${port}`, { method: 'DELETE', credentials: 'include' }).catch(() => {})
    setRunningPort(null)
    setActiveAccountId(null)
    setSelectedAccount(null)
    setTaskQueue([])
    setExecLogs([])
    if (res.success) {
      showMsg(`⏹ 浏览器已停止，端口 ${port} 已释放`, 'success')
    } else {
      showMsg(`停止返回异常（端口已释放）: ${res.error}`, 'error')
    }
    refreshBrowserList()
  }

  /** 检查某账号当前是否处于运行态（基于动态端口注册） */
  const isRunning = (acct: Account): boolean => {
    return runningPort !== null && activeAccountId === acct.id
  }


  // ── 队列操作 ──

  /** 重置表单 */
  const resetForm = useCallback(() => {
    setFormVideoName('')
    setFormTitle('')
    setFormDesc('')
    setFormTopics('')
    setFormCoverImage('')
    setFormCoverMode('upload')
    setFormDeclaration('内容无需标注')
    setFormDeclExtras([])
    setFormCopyrightSelf(false)
    setAiUsage(null)
    setAiFillPoints(null)
    setAiCoverPoints(null)
    setFormLocation('')
    setFormPublishNow(true)
  }, [])

  /** AI 看片：自动填充标题/文案/话题/封面（用户可选，不点则自行填写） */
  const handleAIFill = async () => {
    if (!formVideoName) {
      showToast('请先选择视频', 'error'); return
    }
    if (aiLoading) return
    setAiLoading(true)
    const log: string[] = []
    const pushLog = (s: string) => { log.push(s); setAiLog([...log]) }
    try {
      pushLog(`[${new Date().toLocaleTimeString()}] 开始 AI 看片：${formVideoName}（模式 ${aiMode === 'full' ? '整段' : '抽帧'}）`)
      const r = await fetch('/api/ai/analyze-video', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ videoName: formVideoName, mode: aiMode }),
      })
      const d = await r.json()
      if (d.success) {
        if (d.title) setFormTitle(d.title)
        if (d.description) setFormDesc(d.description)
        if (Array.isArray(d.topics) && d.topics.length) setFormTopics(d.topics.join('，'))
        if (d.coverImage) setFormCoverImage(d.coverImage)
        if (d.usage) setAiUsage(d.usage)
        if (typeof d.pointsSpent === 'number' && d.pointsSpent > 0) setAiFillPoints(d.pointsSpent)
        // 诚实提示：只有真正填到文本才说「已填充」，否则提示只拿到封面
        const filledCount = [d.title, d.description, (d.topics || []).length].filter(Boolean).length
        if (d.partial || filledCount === 0) {
          pushLog('⚠️ AI 只生成了封面，标题/文案/话题未获取到')
          if (d.debug) pushLog('── Agnes 原始返回 ──\n' + d.debug)
          showToast(d.message || '⚠️ AI 只生成了封面，标题/文案/话题未获取到，请手动填写或重试', 'error')
        } else if (filledCount < 3) {
          pushLog(`✅ 已填充部分内容（标题/文案/话题 命中 ${filledCount}/3），请检查补充`)
          showToast('AI 已填充部分内容（可能缺标题/文案/话题），请检查补充', 'success')
        } else {
          pushLog('✅ 已自动填充：标题 / 文案 / 话题 / 封面')
          showToast('AI 已自动填充标题/文案/话题/封面', 'success')
        }
      } else {
        pushLog('❌ 分析失败：' + (d.message || '未知错误'))
        if (d.debug) pushLog('── Agnes 原始返回 ──\n' + d.debug)
        showToast(d.message || 'AI 分析失败', 'error')
      }
    } catch (e: any) {
      pushLog('❌ 请求异常：' + (e?.message || e))
      showToast('AI 分析异常: ' + (e?.message || e), 'error')
    } finally {
      setAiLoading(false)
    }
  }

  // 加载图片为 HTMLImageElement（用于 canvas 合成封面），相对路径自动补 origin
  const loadCoverImage = (src: string) =>
    new Promise<HTMLImageElement>((resolve, reject) => {
      const im = new Image()
      im.onload = () => resolve(im)
      im.onerror = () => reject(new Error('封面底图加载失败'))
      im.src = src.startsWith('http') ? src : `${window.location.origin}${src}`
    })

  // 多行文字绘制（按字符宽度换行，最多 maxLines 行，从 yBottom 向上排）
  const drawWrappedText = (
    ctx: CanvasRenderingContext2D,
    text: string,
    x: number,
    yBottom: number,
    maxWidth: number,
    lineHeight: number,
    maxLines: number,
  ) => {
    const chars = Array.from(text)
    const lines: string[] = []
    let line = ''
    for (const c of chars) {
      const test = line + c
      if (ctx.measureText(test).width > maxWidth && line) {
        lines.push(line)
        line = c
      } else {
        line = test
      }
    }
    if (line) lines.push(line)
    const shown = lines.slice(-maxLines)
    shown.forEach((ln, i) => {
      ctx.fillText(ln, x, yBottom - (shown.length - 1 - i) * lineHeight)
    })
  }

  /** 美化封面：用真实视频帧作底图，canvas 叠加标题文字（不再调文生图凭空生成） */
  const handleAICover = async () => {
    if (aiCoverLoading) return
    if (!formCoverImage) {
      showToast('请先用「AI 看片」或上传得到封面底图', 'error')
      return
    }
    setAiCoverLoading(true)
    try {
      const img = await loadCoverImage(formCoverImage)
      const W = img.width || 720
      const H = img.height || 1280
      const canvas = document.createElement('canvas')
      canvas.width = W
      canvas.height = H
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('canvas 不可用')
      ctx.drawImage(img, 0, 0, W, H)
      // 底部渐变遮罩，保证标题文字可读
      const grad = ctx.createLinearGradient(0, H * 0.5, 0, H)
      grad.addColorStop(0, 'rgba(0,0,0,0)')
      grad.addColorStop(1, 'rgba(0,0,0,0.78)')
      ctx.fillStyle = grad
      ctx.fillRect(0, H * 0.5, W, H * 0.5)
      // 叠加标题
      const title = (formTitle || formDesc || '').trim()
      const fontSize = Math.max(28, Math.floor(W / 16))
      ctx.textBaseline = 'alphabetic'
      ctx.fillStyle = '#ffffff'
      ctx.font = `bold ${fontSize}px sans-serif`
      if (title) {
        drawWrappedText(ctx, title, Math.floor(W * 0.06), H - Math.floor(H * 0.08), W * 0.88, fontSize * 1.25, 4)
      }
      const dataUrl = canvas.toDataURL('image/jpeg', 0.92)
      setFormCoverImage(dataUrl)
      showToast('✨ 美化封面已生成（已叠加标题）', 'success')
    } catch (e: any) {
      showToast('封面美化失败: ' + (e?.message || e), 'error')
    } finally {
      setAiCoverLoading(false)
    }
  }

  // ── 草稿箱：加载 / 保存 / 提取 ──
  const loadDrafts = async () => {
    try {
      const r = await fetch('/api/content-draft', { credentials: 'include' })
      const d = await r.json()
      if (d.success) {
        setDrafts(d.drafts || [])
      } else if (r.status === 401) {
        showToast('请先登录后再查看草稿', 'error')
      }
    } catch {}
  }

  const saveDraft = async () => {
    if (savingDraft) return
    if (!formTitle.trim()) { showToast('请先填写标题再保存草稿', 'error'); return }
    setSavingDraft(true)
    try {
      const r = await fetch('/api/content-draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          title: formTitle.trim(),
          description: formDesc,
          topics: formTopics,
          coverImage: formCoverImage || null,
          videoName: formVideoName || null,
        }),
      })
      const d = await r.json()
      if (d.success) {
        showToast('✅ 草稿已保存', 'success')
        await loadDrafts()
      } else {
        showToast(d.message || '保存失败', 'error')
      }
    } catch (e: any) {
      showToast('保存异常: ' + (e?.message || e), 'error')
    } finally {
      setSavingDraft(false)
    }
  }

  const extractDraft = (d: any) => {
    if (d.title) setFormTitle(d.title)
    if (d.description) setFormDesc(d.description)
    if (d.topics) setFormTopics(Array.isArray(d.topics) ? d.topics.join(' ') : d.topics)
    if (d.coverImage) setFormCoverImage(d.coverImage)
    if (d.videoName) setFormVideoName(d.videoName)
    setDraftsOpen(false)
    showToast('已提取到发布表单', 'success')
  }

  // 删除一条草稿（仅删自己的）
  const deleteDraft = async (id: string) => {
    try {
      const r = await fetch('/api/content-draft?id=' + encodeURIComponent(id), {
        method: 'DELETE',
        credentials: 'include',
      })
      const d = await r.json()
      if (d.success) {
        setDrafts(prev => prev.filter(x => x.id !== id))
        showToast('🗑 草稿已删除', 'success')
      } else {
        showToast(d.message || '删除失败', 'error')
      }
    } catch (e: any) {
      showToast('删除异常: ' + (e?.message || e), 'error')
    }
  }

  // 进入页面即加载草稿，避免「我的草稿 (数量)」要点击一次才显示
  useEffect(() => { loadDrafts(); importAgentTasks() }, [])

  /** 添加任务到队列 */
  // C2 发布闭环（2026-08-05）：自动导入 Agent 创建的待发布任务（AgentPublishTask → 队列）
  const importAgentTasks = async () => {
    try {
      const r = await fetch('/api/agent/publish-tasks?status=pending', { credentials: 'include' })
      const d = await r.json()
      if (d.success && d.data?.length) {
        const tasks: PublishTask[] = d.data.map((t: any) => ({
          id: `agent_${t.id}`,
          videoName: t.videoName,
          title: t.title,
          description: t.description,
          topics: (t.topics || []).join(' '),
          coverImage: t.coverUrl || '',
          coverMode: t.coverUrl ? 'upload' : 'platform',
          location: '',
          publishNow: true,
          status: 'pending',
          platform: t.platform || undefined,
        }))
        setTaskQueue(prev => {
          const exist = new Set(prev.map(x => x.id))
          const fresh = tasks.filter(x => !exist.has(x.id))
          if (fresh.length) {
            showToast(`已自动导入 ${fresh.length} 个待发布任务`, 'success')
            // 2026-08-18: Agent 任务自动执行——浏览器没启动/没选账号时按任务平台自动选账号启动
            setTimeout(async () => {
              if (batchRunning) return
              if (runningPort !== null) { executeBatch(); return }
              // 2026-08-19: 不查账号表、不匹配账号（无登录态数据）——直接启动对应平台浏览器，
              // 执行时脚本 isLoggedIn 检测登录：已登录直接发，未登录提示扫码
              const targetPlat = fresh[0].platform || 'douyin'
              const dummyAcct: Account = {
                id: 0, platform: targetPlat, accountName: targetPlat, accountId: '',
                cdpPort: null, isBound: false, bindType: 'manual', status: 'unknown',
                remark: '', createdAt: '',
              }
              showMsg(`正在启动 ${targetPlat} 浏览器执行发布（打开平台发布链接）...`, 'info')
              try {
                await handleStart(dummyAcct)
                setTimeout(() => executeBatch(), 3000)
              } catch (e: any) {
                for (const t of fresh) reportAgentTask(t.id, 'failed', `浏览器启动失败：${e?.message || '未知'}，请在指纹浏览器页手动启动`)
              }
            }, 800)
          }
          return [...prev, ...fresh]
        })
      }
    } catch {}
  }
  /** 回写 Agent 发布任务执行结果 */
  const reportAgentTask = (taskId: string, status: 'succeeded' | 'failed', error?: string) => {
    if (!taskId.startsWith('agent_')) return
    fetch(`/api/agent/publish-tasks/${taskId.replace('agent_', '')}/done`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status, error: error || null }),
    }).catch(() => {})
  }

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
      coverMode: formCoverMode,
      location: formLocation,
      publishNow: formPublishNow,
      declaration: formDeclaration,
      declarationExtras: formDeclExtras,
      copyrightSelf: formCopyrightSelf,
      status: 'pending',
    }

    setTaskQueue(prev => [...prev, task])
    resetForm()
    showToast(`已添加到队列 (#${taskQueue.length + 1})`, 'success')
  }

  /** 立即发布当前填写的内容（不进队列，直接发这条） */
  const publishNow = async () => {
    if (runningPort === null || !selectedAccount) {
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
    // 打印本次实际执行的模板，便于排查是否误判成其他平台（如跳抖音）
    const _tpl = getTemplateType(selectedAccount.platform)
    setExecLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] 🎯 执行模板: ${_tpl}（账号platform="${selectedAccount.platform}"）`])
    try {
      const task: PublishTask = {
        id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        videoName: formVideoName,
        title: formTitle.trim(),
        description: formDesc.trim(),
        topics: formTopics.trim(),
        coverImage: formCoverImage,
        coverMode: formCoverMode,
        location: formLocation,
        publishNow: formPublishNow,
        declaration: formDeclaration,
        declarationExtras: formDeclExtras,
        copyrightSelf: formCopyrightSelf,
        status: 'publishing',
      }
      const params = await buildTaskParams(task)
      if (window.electronAPI?.fpExecute) {
        const res = await window.electronAPI.fpExecute(runningPort, getTemplateType(selectedAccount.platform), params)
        if (res.success) {
          setExecLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] ✅ 发布完成: ${formVideoName}`])
          if (res.data?.logs) setExecLogs(prev => [...prev, ...res.data.logs])
          if (selectedAccount) setAccountLoggedIn(selectedAccount.id, true)
          showToast('发布成功', 'success')
        } else {
          const needLogin = (res as any).needLogin || (res as any).data?.needLogin
          if (needLogin && selectedAccount) {
            setAccountLoggedIn(selectedAccount.id, false)
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
    // B站必须传封面，但走平台自带「AI 生成」封面（不传我们的自定义图）；
    // 其它平台按 coverMode 决定：选了封面就传，没选就不传（可不传也能发）
    params.coverImage = selectedAccount?.platform === 'bilibili'
      ? ''
      : (task.coverMode === 'platform' ? '' : task.coverImage)
    params.coverMode = task.coverMode
    params.location = task.location
    params.publishNow = String(task.publishNow)
    // B站创作声明（其它平台无此项，传了也不用）
    if (normalizePlatform(selectedAccount?.platform) === 'bilibili') {
      params.declaration = task.declaration || ''
      params.declarationExtras = task.declarationExtras || []
      params.copyrightSelf = !!task.copyrightSelf
    }
    return params
  }

  /** 开始批量发布 */
  const startBatchPublish = async () => {
    if (runningPort === null) return
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
    if (!selectedAccount || runningPort === null) return
    setBatchRunning(true)
    setBatchPaused(false)
    const port = runningPort

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

      // 2026-08-16: Agent 任务平台校验——任务指定平台与当前账号不符时跳过（避免发错平台）
      if (task.platform && selectedAccount && task.platform !== selectedAccount.platform) {
        failCount++
        setTaskQueue(prev => prev.map(t =>
          t.id === task.id ? { ...t, status: 'failed' as const, errorMsg: `平台不匹配：任务指定发「${task.platform}」，当前账号是「${selectedAccount.platform}」。请切换账号后重试` } : t
        ))
        reportAgentTask(task.id, 'failed', `平台不匹配：任务指定发「${task.platform}」，当前账号是「${selectedAccount.platform}」`)
        setExecLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] ⚠️ 跳过 ${task.videoName}：任务平台(${task.platform}) ≠ 账号平台(${selectedAccount.platform})`])
        continue
      }

      // 标记为发布中
      setTaskQueue(prev => prev.map(t =>
        t.id === task.id ? { ...t, status: 'publishing' as const } : t
      ))
      setExecLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] 📤 发布第 ${i + 1}/${pendingTasks.length}: ${task.videoName}`])
      const _tpl2 = getTemplateType(selectedAccount.platform)
      setExecLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] 🎯 执行模板: ${_tpl2}（账号platform="${selectedAccount.platform}"）`])

      try {
        const params = await buildTaskParams(task)
        if (window.electronAPI?.fpExecute) {
          const res = await window.electronAPI.fpExecute(port, getTemplateType(selectedAccount.platform), params)
          if (res.success) {
            doneCount++
            setTaskQueue(prev => prev.map(t =>
              t.id === task.id ? { ...t, status: 'done' as const } : t
            ))
            reportAgentTask(task.id, 'succeeded')
            setExecLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] ✅ 第 ${i + 1} 个任务完成: ${task.videoName}`])
            if (res.data?.logs) setExecLogs(prev => [...prev, ...res.data.logs])
            if (selectedAccount) setAccountLoggedIn(selectedAccount.id, true)
          } else {
            failCount++
            const needLogin = (res as any).needLogin || (res as any).data?.needLogin
            if (needLogin && selectedAccount) {
              setAccountLoggedIn(selectedAccount.id, false)
            }
            setTaskQueue(prev => prev.map(t =>
              t.id === task.id ? { ...t, status: 'failed' as const, errorMsg: res.error } : t
            ))
            reportAgentTask(task.id, 'failed', res.error || '发布失败')
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
        reportAgentTask(task.id, 'failed', e.message || '执行异常')
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

  /**
   * 跨平台排队发布：对勾选的多个账号（每个对应一个平台），依次：
   *   申请端口 → fpStart → 整队任务 fpExecute → fpStop → 释放端口 → 间隔 → 下一账号
   * 即「一条草稿准备好了，6 个媒体顺着发」；也支持整队×多账号（笛卡尔式逐个发）。
   * 未登录的账号标记 needLogin 并跳过，不影响其他账号。
   */
  const executeMultiAccount = async () => {
    if (selectedAccountIds.length === 0) {
      showMsg('请先勾选要发布的目标账号', 'error')
      return
    }
    const targets = accounts.filter(a => selectedAccountIds.includes(a.id))
    if (targets.length === 0) return
    if (!isElectron || !window.electronAPI?.fpStart) {
      showMsg('跨平台排队发布需要使用桌面客户端', 'error')
      return
    }
    if (batchRunning) return
    setBatchRunning(true)
    setBatchPaused(false)

    // 待发任务快照
    const pendingTasks = [...taskQueue].filter(t => t.status === 'pending')
    if (pendingTasks.length === 0) {
      setBatchRunning(false)
      showMsg('队列为空', 'error')
      return
    }

    setExecLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] 🌐 跨平台排队发布启动：${targets.length} 个账号 × ${pendingTasks.length} 条内容`])
    let doneCount = 0
    let failCount = 0
    let skipCount = 0

    for (let a = 0; a < targets.length; a++) {
      if (batchPaused) {
        setExecLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] ⏸ 用户暂停`])
        break
      }
      const acct = targets[a]
      const tpl = getTemplateType(acct.platform)
      setExecLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] ── 账号 ${a + 1}/${targets.length}: ${acct.accountName}（${PLATFORMS.find(p => p.key === normalizePlatform(acct.platform))?.label || acct.platform}）──`])

      // 1) 申请端口
      let port: number
      try {
        const alloc = await fetch('/api/browser/allocate', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
          body: JSON.stringify({ platform: acct.platform }),
        })
        const ad = await alloc.json()
        if (!alloc.ok || !ad.success) {
          failCount++
          setExecLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] ❌ 端口申请失败: ${ad.message || alloc.status}，跳过该账号`])
          continue
        }
        port = ad.data.port
      } catch (e: any) {
        failCount++
        setExecLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] ❌ 端口申请异常: ${e.message}，跳过该账号`])
        continue
      }

      // 2) 启动浏览器
      try {
        const res = await window.electronAPI.fpStart({ port, userId: user?.id, accountId: String(acct.id), platform: acct.platform, proxy: proxyInput.trim() })
        if (!res.success) {
          failCount++
          setExecLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] ❌ 浏览器启动失败: ${res.error}，跳过该账号`])
          await fetch(`/api/browser/release?port=${port}`, { method: 'DELETE', credentials: 'include' }).catch(() => {})
          continue
        }
      } catch (e: any) {
        failCount++
        setExecLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] ❌ 浏览器启动异常: ${e.message}，跳过该账号`])
        await fetch(`/api/browser/release?port=${port}`, { method: 'DELETE', credentials: 'include' }).catch(() => {})
        continue
      }

      // 3) 逐条发布到该账号
      let accountOk = false
      for (let i = 0; i < pendingTasks.length; i++) {
        if (batchPaused) { setExecLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] ⏸ 用户暂停`]); break }
        const task = pendingTasks[i]
        setTaskQueue(prev => prev.map(t => t.id === task.id ? { ...t, status: 'publishing' as const } : t))
        setExecLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] 📤 发布第 ${i + 1}/${pendingTasks.length}: ${task.videoName}`])
        try {
          const params = await buildTaskParams(task)
          const res = await window.electronAPI.fpExecute(port, tpl, params)
          if (res.success) {
            accountOk = true
            doneCount++
            setTaskQueue(prev => prev.map(t => t.id === task.id ? { ...t, status: 'done' as const } : t))
            setExecLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] ✅ ${acct.accountName} 第 ${i + 1} 条完成: ${task.videoName}`])
            if (res.data?.logs) setExecLogs(prev => [...prev, ...res.data.logs])
            setAccountLoggedIn(acct.id, true)
          } else {
            failCount++
            const needLogin = (res as any).needLogin || (res as any).data?.needLogin
            if (needLogin) {
              setAccountLoggedIn(acct.id, false)
              skipCount++
              setExecLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] 🔓 账号未登录，请先去登录: ${acct.accountName}`])
            }
            setTaskQueue(prev => prev.map(t => t.id === task.id ? { ...t, status: 'failed' as const, errorMsg: res.error } : t))
              reportAgentTask(task.id, 'failed', res.error || '发布失败')
            setExecLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] ❌ ${acct.accountName} 第 ${i + 1} 条失败: ${res.error || ''}`])
          }
        } catch (e: any) {
          failCount++
          setTaskQueue(prev => prev.map(t => t.id === task.id ? { ...t, status: 'failed' as const, errorMsg: e.message } : t))
          reportAgentTask(task.id, 'failed', e.message || '执行异常')
          setExecLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] ❌ 异常: ${e.message}`])
        }
      }

      // 4) 停止浏览器并释放端口
      try { await window.electronAPI.fpStop(port) } catch {}
      await fetch(`/api/browser/release?port=${port}`, { method: 'DELETE', credentials: 'include' }).catch(() => {})
      setExecLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] 🔚 已停止并释放 ${acct.accountName} 的浏览器（端口 ${port}）`])

      // 5) 账号间间隔
      if (a < targets.length - 1 && !batchPaused) {
        setExecLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] ⏳ 等待 ${intervalSeconds}s 后切下一个账号...`])
        await new Promise(r => setTimeout(r, intervalSeconds * 1000))
      }
    }

    setBatchRunning(false)
    setExecLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] 🏁 跨平台排队发布结束: ✅${doneCount} ❌${failCount}${skipCount ? ` 🔓需登录${skipCount}` : ''}`])
    showMsg(`跨平台发布完成: 成功 ${doneCount}, 失败 ${failCount}${skipCount ? `, 需登录 ${skipCount}` : ''}`, (failCount > 0 || skipCount > 0) ? 'error' : 'success')
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
                const plat = PLATFORMS.find(p => p.key === normalizePlatform(acct.platform)) || { icon: '🎵', label: acct.platform }
                const running = isRunning(acct)
                const port = running ? runningPort! : 0
                const browserInfo = running ? browsers.find(b => b.port === runningPort) : undefined

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
                            {plat.label} · 端口 {running ? port : '动态分配'} · {acct.status}
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
                        {!loginState[acct.id] ? (
                          <>
                            <button
                              onClick={(e) => { e.stopPropagation(); handleStart(acct) }}
                              disabled={!isElectron}
                              className="px-3 py-1.5 bg-red-500/20 text-red-400 border border-red-500/40 rounded-lg text-xs hover:bg-red-500/30 disabled:opacity-30 disabled:cursor-not-allowed transition animate-pulse"
                            >
                              🔓 去登录
                            </button>
                            <button
                              onClick={(e) => { e.stopPropagation(); handleMarkLogin(acct) }}
                              disabled={!isElectron}
                              className="px-3 py-1.5 bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 rounded-lg text-xs hover:bg-emerald-500/30 disabled:opacity-30 disabled:cursor-not-allowed transition"
                            >
                              ✅ 我已登录
                            </button>
                          </>
                        ) : !running ? (
                          <button
                            onClick={(e) => { e.stopPropagation(); handleStart(acct) }}
                            disabled={!isElectron}
                            className="px-3 py-1.5 bg-purple-500/20 text-purple-400 border border-purple-500/30 rounded-lg text-xs hover:bg-purple-500/30 disabled:opacity-30 disabled:cursor-not-allowed transition"
                          >
                            启动
                          </button>
                        ) : (
                          <button
                            onClick={(e) => { e.stopPropagation(); handleStop() }}
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

          {/* ═══ OpenCLI 发布（2026-08-21：驱动用户已登录 Chrome 真发布——独立于指纹浏览器）═══ */}
          <div className="bg-gradient-to-b from-purple-500/10 to-gray-800/30 border border-purple-500/20 rounded-xl p-3 space-y-2">
            <p className="text-xs font-medium text-purple-300">⚡ OpenCLI 发布（Chrome 真发）</p>
            <select value={ocSite} onChange={e => setOcSite(e.target.value)}
              className="w-full bg-gray-800 border border-white/10 rounded-lg px-2 py-1.5 text-xs text-gray-200">
              <option value="douyin">抖音</option>
              <option value="xiaohongshu">小红书</option>
              <option value="weibo">微博</option>
            </select>
            <input value={ocTitle} onChange={e => setOcTitle(e.target.value)} placeholder="标题/文案"
              className="w-full bg-gray-800 border border-white/10 rounded-lg px-2 py-1.5 text-xs text-gray-200" />
            <input value={ocVideo} onChange={e => setOcVideo(e.target.value)} placeholder="视频路径（可选，默认打开发布页）"
              className="w-full bg-gray-800 border border-white/10 rounded-lg px-2 py-1.5 text-xs text-gray-200" />
            <button onClick={opencliPublish} disabled={ocBusy}
              className="w-full py-2 rounded-lg bg-purple-500/20 border border-purple-500/40 text-purple-200 text-xs font-medium hover:bg-purple-500/30 disabled:opacity-50">
              {ocBusy ? '发布中...' : '🚀 用 OpenCLI 发布'}
            </button>
            {ocResult && <pre className="text-[10px] text-gray-400 whitespace-pre-wrap break-all max-h-28 overflow-y-auto">{ocResult}</pre>}
            <p className="text-[9px] text-gray-600 leading-relaxed">需安装 OpenCLI（opencli.info/download）并在 Chrome 装 Browser Bridge 扩展；仅抖音/小红书/微博支持</p>
          </div>

          {/* ═══ 跨平台排队发布开关 ═══ */}
          <div className="bg-gradient-to-b from-sky-500/10 to-gray-800/30 border border-sky-500/20 rounded-xl p-3 space-y-2">
            <label className="flex items-center justify-between cursor-pointer">
              <span className="text-xs font-medium text-sky-300">🌐 跨平台排队发布</span>
              <input
                type="checkbox"
                checked={crossPlatformMode}
                onChange={e => setCrossPlatformMode(e.target.checked)}
                className="w-4 h-4 accent-sky-500"
              />
            </label>
            <p className="text-[10px] text-gray-500 leading-relaxed">
              开启后：勾选多个账号（每个对应一个平台），队列内容将依次发到每个平台（一条草稿顺着各媒体挨个发）。关闭则为单账号模式。
            </p>

            {crossPlatformMode && (
              <div className="pt-1 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-gray-400">选择目标账号（{selectedAccountIds.length}/{accounts.length}）</span>
                  <button
                    type="button"
                    onClick={() => setSelectedAccountIds(accounts.map(a => a.id))}
                    className="text-[10px] text-sky-400 hover:text-sky-300"
                  >全选</button>
                </div>
                <div className="max-h-44 overflow-y-auto space-y-1 pr-1">
                  {accounts.map(acct => {
                    const plat = PLATFORMS.find(p => p.key === normalizePlatform(acct.platform))
                    const checked = selectedAccountIds.includes(acct.id)
                    const loggedIn = loginState[acct.id]
                    return (
                      <label
                        key={acct.id}
                        className={`flex items-center gap-2 px-2 py-1.5 rounded-lg border cursor-pointer transition ${
                          checked ? 'bg-sky-500/10 border-sky-500/30' : 'bg-gray-900/30 border-white/5'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => setSelectedAccountIds(prev =>
                            checked ? prev.filter(id => id !== acct.id) : [...prev, acct.id]
                          )}
                          className="w-3.5 h-3.5 accent-sky-500"
                        />
                        <span className="text-base">{plat?.icon || '📱'}</span>
                        <span className="text-xs text-gray-200 flex-1 truncate">{acct.accountName}</span>
                        {loggedIn ? (
                          <span className="text-[10px] text-emerald-400">已登录</span>
                        ) : (
                          <span className="text-[10px] text-amber-400">需登录</span>
                        )}
                      </label>
                    )
                  })}
                  {accounts.length === 0 && (
                    <p className="text-[11px] text-gray-600 text-center py-2">暂无账号，请先在「账号管理」绑定</p>
                  )}
                </div>
              </div>
            )}
          </div>

          {(!selectedAccount || runningPort === null) && !crossPlatformMode ? (
            <div className="bg-gray-900/30 border border-dashed border-white/10 rounded-xl p-6 text-center">
              <p className="text-gray-500 text-sm">先选择并启动一个{PLATFORMS.find(p => p.key === normalizePlatform(selectedAccount?.platform))?.label || '目标平台'}浏览器</p>
              <p className="text-gray-600 text-xs mt-1">启动后可添加视频到发布队列</p>
            </div>
          ) : (
            <div className="space-y-3">
              {/* 当前选中信息 */}
              <div className="bg-emerald-500/5 border border-emerald-500/20 rounded-xl p-3">
                <p className="text-xs text-emerald-400 font-medium">
                  🟢 当前: {selectedAccount.accountName}
                </p>
                <p className="text-[11px] text-emerald-400/60 mt-0.5">端口 {runningPort}</p>
              </div>

              {/* ═══ 添加视频表单 ═══ */}
              <div className="bg-gray-800/30 border border-white/5 rounded-xl p-3 space-y-2.5">
                <p className="text-xs font-medium text-gray-300">📝 添加发布内容</p>

                {/* ═══ AI 智能填充（可选，不点则自行填写） ═══ */}
                <div className="bg-purple-500/5 border border-purple-500/20 rounded-xl p-3 space-y-2">
                  <p className="text-[11px] font-medium text-purple-300">🤖 AI 看片智能填充（可选 · 让 AI 自动写标题/文案/话题/封面）</p>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setAiMode('frame')}
                      className={`flex-1 px-2 py-1.5 rounded-lg text-[11px] transition ${
                        aiMode === 'frame'
                          ? 'bg-purple-500/20 text-purple-300 border border-purple-500/30'
                          : 'bg-gray-800/30 text-gray-500 border border-white/5'
                      }`}
                    >抽帧（3~5 帧）</button>
                    <button
                      type="button"
                      onClick={() => setAiMode('full')}
                      className={`flex-1 px-2 py-1.5 rounded-lg text-[11px] transition ${
                        aiMode === 'full'
                          ? 'bg-purple-500/20 text-purple-300 border border-purple-500/30'
                          : 'bg-gray-800/30 text-gray-500 border border-white/5'
                      }`}
                    >整段（8~10 帧）</button>
                  </div>
                  <button
                    type="button"
                    onClick={handleAIFill}
                    disabled={!formVideoName || aiLoading}
                    className="w-full py-2 rounded-lg text-xs font-medium bg-gradient-to-r from-purple-500 to-violet-500 hover:from-purple-400 hover:to-violet-400 text-white disabled:opacity-40 disabled:cursor-not-allowed transition flex items-center justify-center gap-2"
                  >
                    {aiLoading ? '⏳ AI 分析中...' : '✨ 让 AI 看片并自动填写'}
                  </button>
                  {aiLog.length > 0 && (
                    <div className="mt-2 bg-black/40 border border-white/10 rounded-lg p-2 max-h-40 overflow-y-auto">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[10px] text-purple-300/80">📋 AI 看片日志</span>
                        <button
                          type="button"
                          onClick={() => setAiLog([])}
                          className="text-[10px] text-gray-500 hover:text-gray-300"
                        >清空</button>
                      </div>
                      <pre className="text-[10px] leading-relaxed text-gray-300 whitespace-pre-wrap font-mono">
                        {aiLog.join('\n')}
                      </pre>
                    </div>
                  )}
                </div>

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

                  {/* 封面模式切换：上传封面 / 平台智能封面 */}
                  <div className="flex gap-2 mb-2">
                    <button type="button" onClick={() => setFormCoverMode('upload')}
                      className={`flex-1 px-2 py-1.5 rounded-lg text-[11px] border transition ${formCoverMode === 'upload' ? 'bg-purple-500/20 border-purple-500/40 text-purple-200' : 'bg-white/5 border-white/10 text-gray-400 hover:text-white'}`}>
                      🖼️ 上传封面
                    </button>
                    <button type="button" onClick={() => { setFormCoverMode('platform'); setFormCoverImage('') }}
                      className={`flex-1 px-2 py-1.5 rounded-lg text-[11px] border transition ${formCoverMode === 'platform' ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-200' : 'bg-white/5 border-white/10 text-gray-400 hover:text-white'}`}>
                      ✨ 平台智能封面
                    </button>
                  </div>

                  {formCoverMode === 'platform' ? (
                    <div className="text-[11px] text-emerald-300/90 bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-3 py-2.5">
                      ✓ 将使用平台智能封面，不单独上传（由平台自动取最佳帧）
                    </div>
                  ) : (
                  <>
                  {formCoverImage ? (
                    <div className="flex items-center gap-2 bg-purple-500/10 border border-purple-500/20 rounded-lg px-3 py-2">
                      <img
                        src={formCoverImage.startsWith('/') || formCoverImage.startsWith('http') || formCoverImage.startsWith('data:') ? formCoverImage : `/api/storage/file?userId=${user?.id || ''}&name=${encodeURIComponent(formCoverImage)}`}
                        alt="cover"
                        className="w-12 h-12 rounded object-cover shrink-0"
                      />
                      <span className="text-[10px] text-purple-300 truncate flex-1" title={formCoverImage}>{coverDisplayName}</span>
                      <button type="button" onClick={() => { setFormCoverImage(''); setAiUsage(null) }} className="text-red-400 hover:text-red-300 text-xs">✕</button>
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

                  {/* AI 生成封面（可选，与抽帧封面二选一） */}
                  <button
                    type="button"
                    onClick={handleAICover}
                    disabled={aiCoverLoading}
                    className="w-full mt-2 bg-gradient-to-r from-fuchsia-500/20 to-pink-500/20 border border-fuchsia-500/30 rounded-lg px-3 py-2.5 text-xs text-fuchsia-300 hover:from-fuchsia-500/30 hover:to-pink-500/30 transition disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                  >
                    {aiCoverLoading ? '⏳ 美化中...' : '🎨 美化封面（叠加标题）'}
                  </button>
                  {aiCoverPoints != null && (
                    <p className="mt-2 text-[10px] text-fuchsia-300/80">
                      🪙 本次 AI 封面消耗 {aiCoverPoints} 点
                    </p>
                  )}
                  {aiFillPoints != null && (
                    <p className="mt-2 text-[10px] text-amber-300/80">
                      🪙 本次 AI 看片消耗 {aiFillPoints} 点
                    </p>
                  )}
                  </>
                  )}
                </div>

                {/* 创作声明（B站必填，不选平台不给发布） */}
                {normalizePlatform(selectedAccount?.platform) === 'bilibili' && (
                  <div className="bg-sky-500/5 border border-sky-500/20 rounded-lg p-3 space-y-2">
                    <label className="text-[11px] text-sky-300 block">
                      📺 B站创作声明 <span className="text-red-400">*</span>
                      <span className="text-gray-500 ml-1">（B站必填，不选无法发布）</span>
                    </label>
                    <select
                      value={formDeclaration}
                      onChange={e => setFormDeclaration(e.target.value)}
                      className="w-full bg-gray-900/60 border border-white/10 rounded-lg px-3 py-2 text-xs text-white focus:border-sky-500/40 focus:outline-none"
                    >
                      <option value="内容无需标注">内容无需标注</option>
                      <option value="含AI生成内容">含AI生成内容</option>
                      <option value="含虚构演绎内容">含虚构演绎内容</option>
                    </select>

                    <div className="flex flex-wrap gap-1.5">
                      {['内容含营销信息', '个人观点，仅供参考', '内容为转载'].map(t => {
                        const on = formDeclExtras.includes(t)
                        return (
                          <button
                            key={t}
                            type="button"
                            onClick={() => setFormDeclExtras(prev => on ? prev.filter(x => x !== t) : [...prev, t])}
                            className={`px-2 py-1 rounded-md text-[10px] border transition ${
                              on ? 'bg-sky-500/20 border-sky-500/40 text-sky-200' : 'bg-white/5 border-white/10 text-gray-400 hover:text-white'
                            }`}
                          >{on ? '✓ ' : ''}{t}</button>
                        )
                      })}
                    </div>

                    <label className="flex items-center gap-2 text-[10px] text-gray-400 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={formCopyrightSelf}
                        onChange={e => setFormCopyrightSelf(e.target.checked)}
                        className="accent-sky-500"
                      />
                      内容为自制：未经作者允许，禁止转载（授权声明，非必选）
                    </label>
                  </div>
                )}

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

                {/* 草稿箱：保存 / 我的草稿 */}
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={saveDraft}
                    disabled={savingDraft}
                    className="flex-1 py-2.5 rounded-lg text-sm font-medium bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-white disabled:opacity-40 disabled:cursor-not-allowed transition flex items-center justify-center gap-2"
                  >
                    {savingDraft ? '⏳ 保存中...' : '💾 保存草稿'}
                  </button>
                  <button
                    type="button"
                    onClick={async () => { await loadDrafts(); setDraftsOpen(true) }}
                    className="flex-1 py-2.5 rounded-lg text-sm font-medium bg-gray-700/50 hover:bg-gray-600/50 text-gray-200 border border-white/10 transition flex items-center justify-center gap-2"
                  >
                    📂 我的草稿 ({drafts.length})
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

              {/* 草稿箱抽屉 */}
              {draftsOpen && (
                <div className="fixed inset-0 z-50 flex justify-end bg-black/50" onClick={() => setDraftsOpen(false)}>
                  <div className="w-[88%] max-w-md h-full bg-gray-900 border-l border-white/10 overflow-y-auto p-4" onClick={e => e.stopPropagation()}>
                    <div className="flex items-center justify-between mb-3">
                      <span className="text-sm font-medium text-gray-200">📂 我的草稿</span>
                      <button onClick={() => setDraftsOpen(false)} className="text-gray-500 hover:text-gray-300 text-lg">✕</button>
                    </div>
                    {drafts.length === 0 ? (
                      <p className="text-xs text-gray-500 mt-6 text-center">还没有草稿</p>
                    ) : (
                      <div className="space-y-2">
                        {drafts.map((d: any) => (
                          <div key={d.id} className="bg-gray-800/40 border border-white/5 rounded-lg p-3">
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <p className="text-xs text-white font-medium truncate">{d.title}</p>
                                <p className="text-[10px] text-gray-500 mt-0.5">
                                  {new Date(d.createdAt).toLocaleString('zh-CN')} · 可在任意平台使用
                                </p>
                              </div>
                              <div className="flex shrink-0 gap-1">
                                <button
                                  onClick={() => extractDraft(d)}
                                  className="text-[10px] px-2 py-1 rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/30"
                                >提取</button>
                                <button
                                  onClick={() => { if (confirm('确定删除该草稿？')) deleteDraft(d.id) }}
                                  title="删除草稿"
                                  className="text-[10px] px-2 py-1 rounded bg-red-500/15 text-red-400 border border-red-500/30 hover:bg-red-500/30"
                                >🗑</button>
                              </div>
                            </div>
                            {d.coverImage && (
                              <img src={d.coverImage} alt="" className="w-full h-20 object-cover rounded mt-2" />
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}

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
                      onClick={crossPlatformMode ? executeMultiAccount : startBatchPublish}
                      disabled={batchRunning || taskQueue.every(t => t.status !== 'pending') || (crossPlatformMode && selectedAccountIds.length === 0)}
                      className={`flex-1 py-2 rounded-lg text-sm font-medium transition flex items-center justify-center gap-1.5 ${
                        batchRunning
                          ? 'bg-gray-700 text-gray-400 cursor-wait'
                          : 'bg-gradient-to-r from-purple-500 to-violet-500 hover:from-purple-400 hover:to-violet-400 text-white disabled:opacity-40'
                      }`}
                    >
                      {batchRunning ? '⏳ 发布中...' : crossPlatformMode ? `🌐 跨平台发布 (${selectedAccountIds.length})` : '▶ 开始批量发布'}
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
