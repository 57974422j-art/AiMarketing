'use client'
import { useState, useEffect } from 'react'
import { useAuth } from '@/app/providers'
import ApiKeyPanel from './components/ApiKeyPanel'
import EnginePanel from './components/EnginePanel'
import type {
  StatusMap, TestResult, SaveMessage,
  QueryEngine, ActionEngine, MCHealthStatus,
  LoginStatus, CookieStatus, CookieFile, CookieSummary,
  ProxyItem, NewProxyForm, ProxyStats,
} from './types'

export default function SettingsPage() {
  const { user, loading: authLoading } = useAuth()
  const [authorized, setAuthorized] = useState(false)

  useEffect(() => {
    if (!authLoading) setAuthorized(user?.role === 'admin')
  }, [authLoading, user])

  // ====== API Key 状态 ======
  const [deepseekKey, setDeepseekKey] = useState('')
  const [volcanoKey, setVolcanoKey] = useState('')
  const [siliconflowKey, setSiliconflowKey] = useState('')
  const [dashscopeKey, setDashscopeKey] = useState('')
  const [showDeepseekKey, setShowDeepseekKey] = useState(false)
  const [showVolcanoKey, setShowVolcanoKey] = useState(false)
  const [showSiliconflowKey, setShowSiliconflowKey] = useState(false)
  const [showDashscopeKey, setShowDashscopeKey] = useState(false)
  const [testingDeepseek, setTestingDeepseek] = useState(false)
  const [testingVolcano, setTestingVolcano] = useState(false)
  const [testingSiliconflow, setTestingSiliconflow] = useState(false)
  const [testingDashscope, setTestingDashscope] = useState(false)
  const [testResult, setTestResult] = useState<TestResult | null>(null)
  const [statusMap, setStatusMap] = useState<StatusMap>({})

  // ====== OSS 状态 ======
  const [ossRegion, setOssRegion] = useState('')
  const [ossAccessKeyId, setOssAccessKeyId] = useState('')
  const [ossAccessKeySecret, setOssAccessKeySecret] = useState('')
  const [ossBucket, setOssBucket] = useState('')
  const [showOssSecret, setShowOssSecret] = useState(false)
  const [testingOSS, setTestingOSS] = useState(false)

  // ====== TTS 状态 ======
  const [ttsAppId, setTtsAppId] = useState('')
  const [ttsAccessKey, setTtsAccessKey] = useState('')
  const [ttsResourceId, setTtsResourceId] = useState('')
  const [showTtsAppId, setShowTtsAppId] = useState(false)
  const [showTtsAccessKey, setShowTtsAccessKey] = useState(false)
  const [showTtsResourceId, setShowTtsResourceId] = useState(false)
  const [testingTTS, setTestingTTS] = useState(false)

  // ====== 引擎状态 ======
  const [queryEngine, setQueryEngine] = useState<QueryEngine>('mediacrawler')
  const [actionEngine, setActionEngine] = useState<ActionEngine>('q1-adb')
  const [mcPath, setMcPath] = useState('')
  const [mcPythonBin, setMcPythonBin] = useState('')
  const [mcHealthStatus, setMcHealthStatus] = useState<MCHealthStatus>('idle')
  const [mcHealthDetail, setMcHealthDetail] = useState('')

  // ====== 登录状态 ======
  const [loginStatus, setLoginStatus] = useState<LoginStatus>('idle')
  const [loginMessage, setLoginMessage] = useState('')
  const [loginElapsed, setLoginElapsed] = useState(0)

  // ====== Cookie 状态 ======
  const [cookieStatus, setCookieStatus] = useState<CookieStatus>('loading')
  const [cookieFiles, setCookieFiles] = useState<CookieFile[]>([])
  const [cookieSummary, setCookieSummary] = useState<CookieSummary>({ totalFiles: 0, totalSize: 0 })

  // ====== 代理池状态 ======
  const [proxies, setProxies] = useState<ProxyItem[]>([])
  const [proxyStats, setProxyStats] = useState<ProxyStats | null>(null)
  const [proxyGlobalEnabled, setProxyGlobalEnabled] = useState(false)
  const [showAddProxy, setShowAddProxy] = useState(false)
  const [newProxy, setNewProxy] = useState<NewProxyForm>({
    host: '', port: '', protocol: 'http', username: '', password: '', label: '', region: '',
  })

  // ====== Pixabay 图片+音乐 API ======
  const [pixabayKey, setPixabayKey] = useState('')
  const [showPixabayKey, setShowPixabayKey] = useState(false)
  const [testingPixabay, setTestingPixabay] = useState(false)
  const [pixabayTestMsg, setPixabayTestMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  // ====== GIPHY 贴纸 API ======
  const [giphyKey, setGiphyKey] = useState('')
  const [showGiphyKey, setShowGiphyKey] = useState(false)

  // ====== 海外API代理 ======
  const [overseasProxy, setOverseasProxy] = useState('')

  // ====== Gemini API ======
  const [geminiKey, setGeminiKey] = useState('')
  const [showGeminiKey, setShowGeminiKey] = useState(false)
  const [geminiBaseUrl, setGeminiBaseUrl] = useState('')

  // ====== Agnes AI（全模态生图/生视频，默认主用） ======
  const [agnesKey, setAgnesKey] = useState('')
  const [showAgnesKey, setShowAgnesKey] = useState(false)
  const [agnesBaseUrl, setAgnesBaseUrl] = useState('')

  // ====== 客服设置 ======
  const [serviceQrcode, setServiceQrcode] = useState('')
  const [serviceSaving, setServiceSaving] = useState(false)
  const [serviceMsg, setServiceMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  // ====== 全局消息 ======
  const [saveMessage, setSaveMessage] = useState<SaveMessage | null>(null)
  const [saving, setSaving] = useState(false)

  // ====== 初始加载 ======
  useEffect(() => {
    loadConfig()
  }, [])

  const loadConfig = async () => {
    try {
      const res = await fetch('/api/admin/config', { credentials: 'include' })
      const result = await res.json()
      if (!result.success) return
      const d = result.data

      // API Keys
      setDeepseekKey(d.deepseekConfigured ? '********' : '')
      setVolcanoKey(d.volcanoConfigured ? '********' : '')
      setSiliconflowKey(d.siliconflowConfigured ? '********' : '')
      setDashscopeKey(d.dashscopeConfigured ? '********' : '')
      // TTS
      setTtsAppId(d.ttsAppIdConfigured ? '********' : '')
      setTtsAccessKey(d.ttsAccessKeyConfigured ? '********' : '')
      setTtsResourceId(d.ttsResourceIdConfigured ? '********' : '')
      // OSS
      setOssRegion(d.ossRegion || '')
      setOssBucket(d.ossBucket || '')
      // 引擎
      setQueryEngine(d.queryEngine || 'mediacrawler')
      setActionEngine(d.actionEngine || 'q1-adb')
      // MediaCrawler
      if (d.mcPath) setMcPath(d.mcPath)
      if (d.mcPythonBin) setMcPythonBin(d.mcPythonBin)
      // Pixabay（图片+音乐通用）
      setPixabayKey(d.pixabayConfigured ? '********' : '')
      // GIPHY（贴纸库）
      setGiphyKey(d.giphyConfigured ? '********' : '')
      // 海外API代理
      setOverseasProxy(d.overseasProxy || '')
      // Gemini
      setGeminiKey(d.geminiConfigured ? '********' : '')
      setGeminiBaseUrl(d.geminiBaseUrl || '')
      // Agnes AI
      setAgnesKey(d.agnesConfigured ? '********' : '')
      setAgnesBaseUrl(d.agnesBaseUrl || '')

      // 客服设置
      try {
        const scRes = await fetch('/api/admin/system-config?keys=service_qrcode', { credentials: 'include' })
        const scResult = await scRes.json()
        if (scResult.success && scResult.data?.service_qrcode) {
          setServiceQrcode(scResult.data.service_qrcode.value || '')
        }
      } catch {} // 忽略，非关键功能

      setStatusMap({
        deepseek: d.deepseekConfigured ? 'ok' : null,
        siliconflow: d.siliconflowConfigured ? 'ok' : null,
        dashscope: d.dashscopeConfigured ? 'ok' : null,
        volcano: d.volcanoConfigured ? 'ok' : null,
        tts: (d.ttsAppIdConfigured && d.ttsAccessKeyConfigured && d.ttsResourceIdConfigured) ? 'ok' : null,
        oss: d.ossConfigured ? 'ok' : null,
        queryEngine: null,
      })
    } catch (e) {
      console.error('加载配置失败:', e)
    }
  }

  // ====== 保存所有配置 ======
  const saveAllSettings = async () => {
    setSaving(true)
    try {
      const mask = (v: string) => v === '********' ? undefined : v || undefined
      const res = await fetch('/api/admin/config', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deepseekKey: mask(deepseekKey),
          volcanoKey: mask(volcanoKey),
          siliconflowKey: mask(siliconflowKey),
          dashscopeKey: mask(dashscopeKey),
          ossRegion: ossRegion || undefined,
          ossAccessKeyId: mask(ossAccessKeyId),
          ossAccessKeySecret: mask(ossAccessKeySecret),
          ossBucket: ossBucket || undefined,
          ttsAppId: mask(ttsAppId),
          ttsAccessKey: mask(ttsAccessKey),
          ttsResourceId: mask(ttsResourceId),
          queryEngine: queryEngine || undefined,
          actionEngine: actionEngine || undefined,
          mcPath: mcPath || undefined,
          mcPythonBin: mcPythonBin || undefined,
          pixabayKey: mask(pixabayKey),
          giphyKey: mask(giphyKey),
          overseasProxy: overseasProxy || undefined,
          geminiKey: mask(geminiKey),
          geminiBaseUrl: geminiBaseUrl || undefined,
          agnesKey: mask(agnesKey),
          agnesBaseUrl: agnesBaseUrl || undefined,
        }),
      })
      const result = await res.json()
      if (result.success) {
        setSaveMessage({ type: 'success', text: '✅ 保存成功，立即生效' })
        await loadConfig()
      } else {
        setSaveMessage({ type: 'error', text: `❌ 保存失败：${result.message}` })
      }
    } catch {
      setSaveMessage({ type: 'error', text: '❌ 保存失败：网络错误' })
    }
    setSaving(false)
    setTimeout(() => setSaveMessage(null), 4000)
  }

  // ====== 测试 Pixabay Key ======
  const testPixabayKey = async () => {
    if (!pixabayKey || pixabayKey === '********') return
    setTestingPixabay(true); setTestResult(null); setPixabayTestMsg(null)
    try {
      const res = await fetch(`https://pixabay.com/api/?key=${pixabayKey}&q=test&per_page=3`)
      if (!res.ok) {
        const errText = await res.text()
        throw new Error(errText.slice(0, 100))
      }
      const d = await res.json()
      if (d.totalHits !== undefined) {
        const msg = `✅ 连接成功！Pixabay API 正常工作`
        setTestResult({ type: 'success', message: msg })
        setPixabayTestMsg({ type: 'success', text: msg })
        setStatusMap(prev => ({ ...prev, pixabay: 'ok' as any }))
      } else {
        const msg = `❌ 返回异常: ${JSON.stringify(d).slice(0, 80)}`
        setTestResult({ type: 'error', message: msg })
        setPixabayTestMsg({ type: 'error', text: msg })
        setStatusMap(prev => ({ ...prev, pixabay: 'fail' as any }))
      }
    } catch (e: any) {
      const msg = `❌ 网络错误: ${e.message}`
      setTestResult({ type: 'error', message: msg })
      setPixabayTestMsg({ type: 'error', text: msg })
      setStatusMap(prev => ({ ...prev, pixabay: 'fail' as any }))
    }
    setTestingPixabay(false)
  }

  // ====== 保存客服设置 ======
  const saveServiceConfig = async () => {
    setServiceSaving(true)
    setServiceMsg(null)
    try {
      const res = await fetch('/api/admin/system-config', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          configs: [{ key: 'service_qrcode', value: serviceQrcode, label: '客服微信二维码' }]
        }),
      })
      const result = await res.json()
      if (result.success) {
        setServiceMsg({ type: 'success', text: '✅ 客服设置已保存' })
      } else {
        setServiceMsg({ type: 'error', text: `❌ ${result.message}` })
      }
    } catch {
      setServiceMsg({ type: 'error', text: '❌ 网络错误' })
    }
    setServiceSaving(false)
    setTimeout(() => setServiceMsg(null), 4000)
  }

  // ====== 鉴权守卫 ======
  if (authLoading) return <div className="min-h-screen bg-gray-950 flex items-center justify-center"><p className="text-gray-400">加载中...</p></div>
  if (!authorized) return <div className="min-h-screen bg-gray-950 flex items-center justify-center"><p className="text-red-400">仅管理员可访问</p></div>

  // ====== 渲染 ======
  return (
    <div className="min-h-screen bg-gray-950">
      <div className="max-w-6xl mx-auto px-4 py-8">
        {/* 标题栏 */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <p className="text-label mb-2">系统 / SYSTEM</p>
            <h1 className="text-mono-lg text-white">设置 / SETTINGS</h1>
          </div>
          {saveMessage && (
            <div className={`fixed top-6 left-1/2 -translate-x-1/2 z-50 px-6 py-3 rounded-xl text-sm font-mono shadow-lg backdrop-blur animate-pulse-once ${
              saveMessage.type === 'success' ? 'bg-emerald-500/90 text-white' : 'bg-red-500/90 text-white'
            }`}>
              {saveMessage.text}
            </div>
          )}
        </div>

        {/* 测试结果提示 */}
        {testResult && (
          <div className={`mb-6 p-4 rounded-xl text-sm font-mono ${
            testResult.type === 'success'
              ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
              : 'bg-red-500/20 text-red-400 border border-red-500/30'
          }`}>{testResult.message}</div>
        )}

        {/* API Key + OSS 面板 */}
        <ApiKeyPanel
          deepseekKey={deepseekKey} volcanoKey={volcanoKey}
          siliconflowKey={siliconflowKey} dashscopeKey={dashscopeKey}
          showDeepseekKey={showDeepseekKey} showVolcanoKey={showVolcanoKey}
          showSiliconflowKey={showSiliconflowKey} showDashscopeKey={showDashscopeKey}
          testingDeepseek={testingDeepseek} testingVolcano={testingVolcano}
          testingSiliconflow={testingSiliconflow} testingDashscope={testingDashscope}
          testResult={testResult} statusMap={statusMap}
          ttsAppId={ttsAppId} ttsAccessKey={ttsAccessKey} ttsResourceId={ttsResourceId}
          showTtsAppId={showTtsAppId} showTtsAccessKey={showTtsAccessKey} showTtsResourceId={showTtsResourceId}
          testingTTS={testingTTS}
          ossRegion={ossRegion} ossAccessKeyId={ossAccessKeyId}
          ossAccessKeySecret={ossAccessKeySecret} ossBucket={ossBucket}
          showOssSecret={showOssSecret} testingOSS={testingOSS}
          setters={{
            setDeepseekKey, setVolcanoKey, setSiliconflowKey, setDashscopeKey,
            setShowDeepseekKey, setShowVolcanoKey, setShowSiliconflowKey, setShowDashscopeKey,
            setTestingDeepseek, setTestingVolcano, setTestingSiliconflow, setTestingDashscope,
            setTestResult, setStatusMap,
            setTtsAppId, setTtsAccessKey, setTtsResourceId,
            setShowTtsAppId, setShowTtsAccessKey, setShowTtsResourceId, setTestingTTS,
            setOssRegion, setOssAccessKeyId, setOssAccessKeySecret, setOssBucket,
            setShowOssSecret, setTestingOSS,
          }}
        />

        {/* ====== 媒体资源 API（Pixabay 图片+音乐） ====== */}
        <div className="card-glass p-6 mt-6">
          <h3 className="text-white font-bold mb-2"><span className="text-yellow-400">//</span> Pixabay API（免版税图片 + 音乐）</h3>
          <p className="text-gray-400 text-xs mb-4">一个 Key 搞定智能成片的素材搜索和背景音乐，全部免版税可商用</p>

          <div>
            <label className="block text-label mb-2">
              <span>Pixabay API Key</span>
              {pixabayKey === '********' && <span className="ml-2 text-xs text-emerald-400 font-mono">✓ 已配置</span>}
            </label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <input
                  type={showPixabayKey ? 'text' : 'password'}
                  value={pixabayKey}
                  onChange={e => setPixabayKey(e.target.value)}
                  placeholder="输入 Pixabay API Key"
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2.5 text-white text-sm font-mono focus:outline-none focus:border-yellow-500/50 pr-10"
                />
                <button type="button" onClick={() => setShowPixabayKey(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white">
                  {showPixabayKey ? '🙈' : '👁'}
                </button>
              </div>
              <button onClick={testPixabayKey} disabled={!pixabayKey || pixabayKey === '********' || testingPixabay}
                className="px-3 py-2 bg-yellow-500/20 border border-yellow-500/30 text-yellow-400 rounded-lg hover:bg-yellow-500/30 disabled:opacity-50 font-mono text-xs whitespace-nowrap">
                {testingPixabay ? '测试中...' : '测试连接'}
              </button>
            </div>
            {pixabayTestMsg && (
              <div className={`mt-2 text-xs font-mono px-3 py-1.5 rounded-lg inline-block ${
                pixabayTestMsg.type === 'success' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'
              }`}>{pixabayTestMsg.text}</div>
            )}
            <div className="flex flex-wrap gap-3 mt-2">
              <p className="text-[10px] text-gray-600 font-mono">
                免费注册 → <a href="https://pixabay.com/api/docs/" target="_blank" className="text-yellow-500 underline">pixabay.com</a>
              </p>
              <span className="text-[10px] text-emerald-600 font-mono">🖼 搜图</span>
              <span className="text-[10px] text-purple-600 font-mono">🎵 免版税 BGM</span>
              <span className="text-[10px] text-gray-600 font-mono">一键开通，图片+音乐全搞定</span>
            </div>

            {/* GIPHY 贴纸 Key */}
            <div className="border-t border-white/5 my-3"></div>
            <div>
              <label className="block text-label mb-2">
                <span>GIPHY API Key（在线贴纸库）</span>
                {giphyKey === '********' && <span className="ml-2 text-xs text-emerald-400 font-mono">✓ 已配置</span>}
              </label>
              <div className="relative">
                <input
                  type={showGiphyKey ? 'text' : 'password'}
                  value={giphyKey}
                  onChange={e => setGiphyKey(e.target.value)}
                  placeholder="输入 GIPHY API Key"
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2.5 text-white text-sm font-mono focus:outline-none focus:border-yellow-500/50 pr-10"
                />
                <button type="button" onClick={() => setShowGiphyKey(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white">
                  {showGiphyKey ? '🙈' : '👁'}
                </button>
              </div>
              <p className="text-[10px] text-gray-600 mt-1 font-mono">
                免费注册 → <a href="https://developers.giphy.com" target="_blank" className="text-yellow-500 underline">developers.giphy.com</a>
              </p>
            </div>

            {/* 海外API代理 */}
            <div className="border-t border-white/5 my-3"></div>
            <div>
              <label className="block text-label mb-2">
                <span>海外 API 代理</span>
                {overseasProxy && <span className="ml-2 text-xs text-emerald-400 font-mono">✓ 已配置</span>}
              </label>
              <input
                type="text"
                value={overseasProxy}
                onChange={e => setOverseasProxy(e.target.value)}
                placeholder="https://proxy.example.com"
                className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2.5 text-white text-sm font-mono focus:outline-none focus:border-yellow-500/50"
              />
              <p className="text-[10px] text-gray-600 mt-1 font-mono">
                CF Worker 代理地址，用于 GIPHY / Gemini 等海外 API。格式: https://xxx.com
              </p>
            </div>

            {/* Gemini API */}
            <div className="border-t border-white/5 my-3"></div>
            <div className="space-y-3">
              <label className="block text-label">
                <span>🤖 Gemini API</span>
                <span className="ml-2 text-[10px] text-gray-500">（趋势猎手 / AI 搜索 / 图文分析）</span>
                {geminiKey && <span className="ml-2 text-xs text-emerald-400 font-mono">✓ 已配置</span>}
              </label>
              <div className="relative">
                <input
                  type={showGeminiKey ? 'text' : 'password'}
                  value={geminiKey}
                  onChange={e => setGeminiKey(e.target.value)}
                  placeholder="sk-xxx 或直接粘贴 API Key"
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2.5 text-white text-sm font-mono focus:outline-none focus:border-purple-500/50"
                />
                <button type="button" onClick={() => setShowGeminiKey(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white">
                  {showGeminiKey ? '🙈' : '👁'}
                </button>
              </div>
              <input
                type="text"
                value={geminiBaseUrl}
                onChange={e => setGeminiBaseUrl(e.target.value)}
                placeholder="中转地址，例如 https://bboluo.com/v1"
                className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2.5 text-white text-sm font-mono focus:outline-none focus:border-purple-500/50"
              />
              <p className="text-[10px] text-gray-600 font-mono">
                优先用直连 Key；填了中转地址则作降级。支持 OpenAI 兼容 /v1 端点。模型名前缀 [L]按次 [V]按量
              </p>
            </div>
          </div>
        </div>

        {/* Agnes AI（全模态：文生图 / 文生视频，默认主用，其他厂商作降级兜底） */}
        <div className="card-glass p-6 mt-6">
          <h3 className="text-white font-bold mb-2"><span className="text-yellow-400">//</span> Agnes AI（全模态生图 / 生视频 · 主用）</h3>
          <p className="text-gray-400 text-xs mb-4">Sapiens AI 全模态免费 API。配置后「自动」模式生图/生视频将优先用 Agnes，失败再降级到百炼/硅基；也可在 Prompt 模板页单独指定 Agnes。</p>
          <div className="space-y-3">
            <label className="block text-label">
              <span>🔮 Agnes API Key</span>
              {agnesKey && <span className="ml-2 text-xs text-emerald-400 font-mono">✓ 已配置</span>}
            </label>
            <div className="relative">
              <input
                type={showAgnesKey ? 'text' : 'password'}
                value={agnesKey}
                onChange={e => setAgnesKey(e.target.value)}
                placeholder="粘贴 Agnes API Key（platform.agnes-ai.com → Settings → API Keys）"
                className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2.5 text-white text-sm font-mono focus:outline-none focus:border-emerald-500/50 pr-10"
              />
              <button type="button" onClick={() => setShowAgnesKey(v => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white">
                {showAgnesKey ? '🙈' : '👁'}
              </button>
            </div>
            <input
              type="text"
              value={agnesBaseUrl}
              onChange={e => setAgnesBaseUrl(e.target.value)}
              placeholder="API 地址（可选，默认 https://apihub.agnes-ai.com/v1）"
              className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2.5 text-white text-sm font-mono focus:outline-none focus:border-emerald-500/50"
            />
            <p className="text-[10px] text-gray-600 font-mono">
              文生图 agnes-image-2.1-flash · 文生视频 agnes-video-v2.0（异步轮询）。免费额度，谨慎高频调用。
            </p>
          </div>
        </div>

        {/* 引擎 + 登录 + 代理池面板 */}
        <EnginePanel
          queryEngine={queryEngine} actionEngine={actionEngine}
          mcPath={mcPath} mcPythonBin={mcPythonBin}
          mcHealthStatus={mcHealthStatus} mcHealthDetail={mcHealthDetail}
          loginStatus={loginStatus} loginMessage={loginMessage} loginElapsed={loginElapsed}
          cookieStatus={cookieStatus} cookieFiles={cookieFiles} cookieSummary={cookieSummary}
          proxies={proxies} proxyStats={proxyStats} proxyGlobalEnabled={proxyGlobalEnabled}
          showAddProxy={showAddProxy} newProxy={newProxy} statusMap={statusMap}
          setters={{
            setQueryEngine, setActionEngine,
            setMcPath, setMcPythonBin, setMcHealthStatus, setMcHealthDetail,
            setLoginStatus, setLoginMessage, setLoginElapsed,
            setLoginPolling: () => {}, // 内部管理
            setCookieStatus, setCookieFiles, setCookieSummary,
            setShowAddProxy, setNewProxy, setProxies, setProxyStats, setProxyGlobalEnabled, setStatusMap,
          }}
        />

        {/* 保存按钮 */}
        <div className="flex justify-end mt-6">
          <button onClick={saveAllSettings} disabled={saving}
            className={`px-6 py-3 rounded-xl text-white font-mono transition-colors ${
              saving ? 'bg-gray-600 cursor-wait' : 'bg-emerald-500 hover:bg-emerald-600'
            }`}>
            {saving ? '⏳ 保存中...' : '保存所有配置'}
          </button>
        </div>

        {/* ====== 客服设置 ====== */}
        <div className="mt-10 border border-gray-800/50 rounded-xl p-6">
          <div className="flex items-center gap-3 mb-4">
            <span className="text-xl">📱</span>
            <h2 className="text-white font-semibold">客服设置</h2>
          </div>
          <p className="text-gray-400 text-sm mb-5">配置客服微信二维码，未开通付费功能的用户可扫码联系客服。</p>

          {serviceMsg && (
            <div className={`mb-4 px-4 py-2 rounded-lg text-sm font-mono ${
              serviceMsg.type === 'success' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'
            }`}>{serviceMsg.text}</div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
            {/* 二维码输入 */}
            <div>
              <label className="block text-gray-300 text-sm font-mono mb-2">微信二维码图片 URL</label>
              <input
                type="text"
                value={serviceQrcode}
                onChange={e => setServiceQrcode(e.target.value)}
                placeholder="https://xxx.com/qrcode.png 或上传后填入地址"
                className="w-full bg-black/40 border border-gray-700/50 rounded-lg px-4 py-2.5 text-sm text-white placeholder-gray-600 focus:border-blue-500/50 focus:outline-none font-mono"
              />
              <p className="text-xs text-gray-500 mt-2 font-mono">建议尺寸 200x200 以上，支持 PNG/JPG 格式</p>
            </div>
            {/* 二维码预览 */}
            <div>
              <label className="block text-gray-300 text-sm font-mono mb-2">预览</label>
              {serviceQrcode ? (
                <img src={serviceQrcode} alt="预览" className="w-40 h-40 object-contain rounded-lg border border-gray-700/50 bg-white p-1" />
              ) : (
                <div className="w-40 h-40 border border-dashed border-gray-700/50 rounded-lg flex items-center justify-center">
                  <span className="text-gray-600 text-sm">暂无图片</span>
                </div>
              )}
            </div>
          </div>

          <div className="flex justify-end mt-5">
            <button onClick={saveServiceConfig} disabled={serviceSaving}
              className={`px-5 py-2.5 rounded-lg text-sm font-mono transition-colors ${
                serviceSaving
                  ? 'bg-gray-700 text-gray-400 cursor-wait'
                  : 'bg-blue-500/20 text-blue-400 border border-blue-500/30 hover:bg-blue-500/30'
              }`}>
              {serviceSaving ? '保存中...' : '保存客服设置'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
