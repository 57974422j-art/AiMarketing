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
  const [minimaxKey, setMinimaxKey] = useState('')  // 2026-08-14 Minimax AI 音乐
  const [musicModel, setMusicModel] = useState('music-3.0-free')  // 2026-08-14 音乐模型
  const [showMinimaxKey, setShowMinimaxKey] = useState(false)
  const [testingMinimax, setTestingMinimax] = useState(false)
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
  const [volcAsrApiKey, setVolcAsrApiKey] = useState('')
  const [volcAsrAppKey, setVolcAsrAppKey] = useState('')
  const [volcAsrAccessKey, setVolcAsrAccessKey] = useState('')
  const [volcAsrResourceId, setVolcAsrResourceId] = useState('')
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

  // ====== 天行 API（热点榜：抖音/微博/微信等，有则优先，无则走 vvhan 免费兜底） ======
  const [vvhanApiKey, setVvhanApiKey] = useState('')
  const [vvhanApiBase, setVvhanApiBase] = useState('https://v1.vvhan.com')
  const [serperKey, setSerperKey] = useState('')
  // 下载代理（Shadowsocks，2026-08-09）
  const [ssServer, setSsServer] = useState('')
  const [ssPort, setSsPort] = useState('')
  const [ssPassword, setSsPassword] = useState('')
  const [ssMethod, setSsMethod] = useState('aes-256-gcm')
  const [showTianApiKey, setShowTianApiKey] = useState(false)
  const [testingTianApi, setTestingTianApi] = useState(false)
  const [tianApiTestMsg, setTianApiTestMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [showSerperKey, setShowSerperKey] = useState(false)
  const [serperTestMsg, setSerperTestMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  // ====== AGENT 微信/飞书 渠道 webhook（阶段四） ======
  const [agentWebhookWechat, setAgentWebhookWechat] = useState('')
  const [agentWebhookFeishu, setAgentWebhookFeishu] = useState('')
  const [showAgentWebhookWechat, setShowAgentWebhookWechat] = useState(false)
  const [showAgentWebhookFeishu, setShowAgentWebhookFeishu] = useState(false)

  // ====== GIPHY / 海外代理 / Gemini / Agnes 测试连接状态 ======
  const [testingGiphy, setTestingGiphy] = useState(false)
  const [giphyTestMsg, setGiphyTestMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [testingProxy, setTestingProxy] = useState(false)
  const [proxyTestMsg, setProxyTestMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [testingGemini, setTestingGemini] = useState(false)
  const [geminiTestMsg, setGeminiTestMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [testingAgnes, setTestingAgnes] = useState(false)
  const [agnesTestMsg, setAgnesTestMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  // ====== 配置页 Tab 分组（2026-08-14：密钥/媒体/引擎/系统分页） ======
  const [cfgTab, setCfgTab] = useState<'keys' | 'media' | 'engine' | 'system'>('keys')

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
      setMinimaxKey(d.minimaxConfigured ? '********' : '')
      setMusicModel(d.musicModel || 'music-3.0-free')
      // TTS
      setTtsAppId(d.ttsAppIdConfigured ? '********' : '')
      setTtsAccessKey(d.ttsAccessKeyConfigured ? '********' : '')
      setTtsResourceId(d.ttsResourceIdConfigured ? '********' : '')
      setVolcAsrApiKey(d.volcAsrApiKeyConfigured ? '********' : '')
      setVolcAsrAppKey(d.volcAsrAppKeyConfigured ? '********' : '')
      setVolcAsrAccessKey(d.volcAsrAccessKeyConfigured ? '********' : '')
      setVolcAsrResourceId(d.volcAsrResourceIdConfigured ? '********' : '')
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
      // 天行 API
      setVvhanApiKey(d.vvhanApiConfigured ? '********' : '')
      setVvhanApiBase(d.vvhanApiBase || 'https://v1.vvhan.com')
      setSerperKey(d.serperKeyConfigured ? '********' : '')
      setSsServer(d.ssServer || '')
      setSsPort(d.ssPort || '')
      setSsPassword(d.ssPasswordConfigured ? '********' : '')
      setSsMethod(d.ssMethod || 'aes-256-gcm')
      // AGENT 渠道 webhook
      setAgentWebhookWechat(d.agentWebhookWechatConfigured ? '********' : '')
      setAgentWebhookFeishu(d.agentWebhookFeishuConfigured ? '********' : '')

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
        minimax: d.minimaxConfigured ? 'ok' : null,  // 2026-08-14
        volcano: d.volcanoConfigured ? 'ok' : null,
        tts: (d.ttsAppIdConfigured && d.ttsAccessKeyConfigured && d.ttsResourceIdConfigured) ? 'ok' : null,
        oss: d.ossConfigured ? 'ok' : null,
        pixabay: d.pixabayConfigured ? 'ok' : null,
        giphy: d.giphyConfigured ? 'ok' : null,
        gemini: d.geminiConfigured ? 'ok' : null,
        agnes: d.agnesConfigured ? 'ok' : null,
        vvhan: d.vvhanApiConfigured ? 'ok' : null,
        serper: d.serperKeyConfigured ? 'ok' : null,
        wechat: d.agentWebhookWechatConfigured ? 'ok' : null,
        feishu: d.agentWebhookFeishuConfigured ? 'ok' : null,
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
          minimaxKey: mask(minimaxKey),
          musicModel: musicModel || undefined,
          ossRegion: ossRegion || undefined,
          ossAccessKeyId: mask(ossAccessKeyId),
          ossAccessKeySecret: mask(ossAccessKeySecret),
          ossBucket: ossBucket || undefined,
          ttsAppId: mask(ttsAppId),
          ttsAccessKey: mask(ttsAccessKey),
          ttsResourceId: mask(ttsResourceId),
          volcAsrApiKey: mask(volcAsrApiKey),
          volcAsrAppKey: mask(volcAsrAppKey),
          volcAsrAccessKey: mask(volcAsrAccessKey),
          volcAsrResourceId: mask(volcAsrResourceId),
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
          agentWebhookWechat: agentWebhookWechat || undefined,
          agentWebhookFeishu: agentWebhookFeishu || undefined,
          vvhanApiKey: mask(vvhanApiKey),
          vvhanApiBase: vvhanApiBase.trim() || 'https://v1.vvhan.com',
          serperKey: mask(serperKey),
          ssServer: ssServer || undefined,
          ssPort: ssPort || undefined,
          ssPassword: mask(ssPassword),
          ssMethod: ssMethod,
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

  // ====== 通用：调用后端 /api/admin/test-key 测试某个 provider ======
  const testProvider = async (
    provider: string,
    setTesting: (v: boolean) => void,
    setMsg: (m: { type: 'success' | 'error'; text: string } | null) => void,
    payload: Record<string, string> = {},
    onOk?: () => void,
    onFail?: () => void,
  ) => {
    setTesting(true)
    setMsg(null)
    try {
      const res = await fetch('/api/admin/test-key', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider, ...payload }),
      })
      const d = await res.json()
      if (d.valid) {
        onOk?.()
        setMsg({ type: 'success', text: `✅ ${d.message || '连接成功'}` })
      } else {
        onFail?.()
        setMsg({ type: 'error', text: `❌ ${d.message || '连接失败'}` })
      }
    } catch (e: any) {
      setMsg({ type: 'error', text: `❌ 网络错误: ${e.message}` })
    }
    setTesting(false)
  }

  const testGiphyKey = () =>
    testProvider('giphy', setTestingGiphy, setGiphyTestMsg, { key: giphyKey, proxy: overseasProxy })
  const testProxy = () =>
    testProvider('overseas_proxy', setTestingProxy, setProxyTestMsg, { proxy: overseasProxy })
  const testGeminiKey = () =>
    testProvider('gemini', setTestingGemini, setGeminiTestMsg, { key: geminiKey, baseUrl: geminiBaseUrl })
  const testAgnesKey = () =>
    testProvider('agnes', setTestingAgnes, setAgnesTestMsg, { key: agnesKey, baseUrl: agnesBaseUrl, proxy: overseasProxy })

  const testVvhanApiKey = () =>
    testProvider('vvhan', setTestingTianApi, setTianApiTestMsg, { key: vvhanApiKey }, () => setStatusMap(prev => ({ ...prev, vvhan: 'ok' })), () => setStatusMap(prev => ({ ...prev, vvhan: 'fail' })))
  // Serper 测试（2026-08-11：接入统一状态）
  const [testingSerper, setTestingSerper] = useState(false)
  const [serperTestMsg2, setSerperTestMsg2] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const testSerperKey = () =>
    testProvider('serper', setTestingSerper, setSerperTestMsg2, { key: serperKey }, () => setStatusMap(prev => ({ ...prev, serper: 'ok' })), () => setStatusMap(prev => ({ ...prev, serper: 'fail' })))

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
        {/* 2026-08-14：分页 Tab */}
        <div className="flex flex-wrap gap-2 mb-4">
          {([['keys', '🔑 API 密钥'], ['media', '🎨 媒体资源'], ['engine', '⚙️ 引擎'], ['system', '🛠️ 系统设置']] as const).map(([k, t]) => (
            <button key={k} onClick={() => setCfgTab(k)}
              className={`px-4 py-1.5 rounded-lg text-xs font-mono border transition-colors ${cfgTab === k ? 'border-emerald-500/50 bg-emerald-500/15 text-emerald-300' : 'border-white/10 bg-white/5 text-gray-400 hover:text-white'}`}>
              {t}
            </button>
          ))}
        </div>
        {/* 2026-08-14: 全局保存按钮（分页后放 Tab 下方，避免找不到保存按钮） */}
        <div className="flex justify-end mb-4">
          <button onClick={saveAllSettings} disabled={saving}
            className={`px-6 py-2.5 rounded-xl text-sm text-white font-mono transition-colors ${
              saving ? 'bg-gray-600 cursor-wait' : 'bg-emerald-500 hover:bg-emerald-600'
            }`}>
            {saving ? '⏳ 保存中...' : '💾 保存所有配置'}
          </button>
        </div>
        {/* 标题栏 */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <p className="text-label mb-2">系统 / SYSTEM</p>
            <h1 className="text-mono-lg text-white">设置 / SETTINGS</h1>
          </div>
          {/* 2026-08-11：API 配置汇总条——一眼看清各组通断 */}
          <div className="flex flex-wrap gap-2 mb-6">
            {[
              { g: 'AI 核心', keys: ['deepseek', 'volcano', 'dashscope', 'siliconflow', 'agnes'], total: 5 },
              { g: '语音', keys: ['tts'], total: 1 },
              { g: '存储', keys: ['oss'], total: 1 },
              { g: '搜索热点', keys: ['serper', 'vvhan'], total: 2 },
              { g: '媒体', keys: ['pixabay', 'giphy'], total: 2 },
              { g: '推送', keys: ['wechat', 'feishu'], total: 2 },
            ].map(grp => {
              const okN = grp.keys.filter(k => statusMap[k] === 'ok').length
              return (
                <div key={grp.g} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-[11px] font-mono ${okN === grp.total ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300' : okN > 0 ? 'border-amber-500/40 bg-amber-500/10 text-amber-300' : 'border-white/10 bg-white/5 text-gray-500'}`}>
                  <span className="font-semibold">{grp.g}</span>
                  <span>{okN}/{grp.total}</span>
                  {okN === grp.total ? '✅' : okN > 0 ? '⚠️' : '❌'}
                </div>
              )
            })}
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
        <div className={cfgTab === 'keys' ? '' : 'hidden'}>
        <ApiKeyPanel
          deepseekKey={deepseekKey} volcanoKey={volcanoKey}
          siliconflowKey={siliconflowKey} dashscopeKey={dashscopeKey} minimaxKey={minimaxKey}
          musicModel={musicModel} setMusicModel={setMusicModel}
          showDeepseekKey={showDeepseekKey} showVolcanoKey={showVolcanoKey}
          showSiliconflowKey={showSiliconflowKey} showDashscopeKey={showDashscopeKey}
          showMinimaxKey={showMinimaxKey} testingMinimax={testingMinimax}
          testingDeepseek={testingDeepseek} testingVolcano={testingVolcano}
          testingSiliconflow={testingSiliconflow} testingDashscope={testingDashscope}
          testResult={testResult} statusMap={statusMap}
          ttsAppId={ttsAppId} ttsAccessKey={ttsAccessKey} ttsResourceId={ttsResourceId}
          volcAsrApiKey={volcAsrApiKey} volcAsrAppKey={volcAsrAppKey} volcAsrAccessKey={volcAsrAccessKey} volcAsrResourceId={volcAsrResourceId}
          showTtsAppId={showTtsAppId} showTtsAccessKey={showTtsAccessKey} showTtsResourceId={showTtsResourceId}
          testingTTS={testingTTS}
          ossRegion={ossRegion} ossAccessKeyId={ossAccessKeyId}
          ossAccessKeySecret={ossAccessKeySecret} ossBucket={ossBucket}
          showOssSecret={showOssSecret} testingOSS={testingOSS}
          setters={{
            setDeepseekKey, setVolcanoKey, setSiliconflowKey, setDashscopeKey, setMinimaxKey,
            setShowDeepseekKey, setShowVolcanoKey, setShowSiliconflowKey, setShowDashscopeKey,
            setShowMinimaxKey, setTestingMinimax,
            setTestingDeepseek, setTestingVolcano, setTestingSiliconflow, setTestingDashscope,
            setTestResult, setStatusMap,
            setTtsAppId, setTtsAccessKey, setTtsResourceId,
            setVolcAsrApiKey, setVolcAsrAppKey, setVolcAsrAccessKey, setVolcAsrResourceId,
            setShowTtsAppId, setShowTtsAccessKey, setShowTtsResourceId, setTestingTTS,
            setOssRegion, setOssAccessKeyId, setOssAccessKeySecret, setOssBucket,
            setShowOssSecret, setTestingOSS,
          }}
        />

        </div>{/* keys 组结束 */}
        <div className={cfgTab === 'media' ? '' : 'hidden'}>        {/* ====== 媒体资源 API（Pixabay 图片+音乐） ====== */}
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
              <div className="flex gap-2">
                <div className="relative flex-1">
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
                <button onClick={testGiphyKey} disabled={!giphyKey || giphyKey === '********' || testingGiphy}
                  className="px-3 py-2 bg-yellow-500/20 border border-yellow-500/30 text-yellow-400 rounded-lg hover:bg-yellow-500/30 disabled:opacity-50 font-mono text-xs whitespace-nowrap">
                  {testingGiphy ? '测试中...' : '测试连接'}
                </button>
              </div>
              {giphyTestMsg && (
                <div className={`mt-2 text-xs font-mono px-3 py-1.5 rounded-lg inline-block ${
                  giphyTestMsg.type === 'success' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'
                }`}>{giphyTestMsg.text}</div>
              )}
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
              <div className="flex gap-2">
                <input
                  type="text"
                  value={overseasProxy}
                  onChange={e => setOverseasProxy(e.target.value)}
                  placeholder="https://proxy.example.com"
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2.5 text-white text-sm font-mono focus:outline-none focus:border-yellow-500/50"
                />
                <button onClick={testProxy} disabled={!overseasProxy || testingProxy}
                  className="px-3 py-2 bg-yellow-500/20 border border-yellow-500/30 text-yellow-400 rounded-lg hover:bg-yellow-500/30 disabled:opacity-50 font-mono text-xs whitespace-nowrap">
                  {testingProxy ? '测试中...' : '测试连接'}
                </button>
              </div>
              {proxyTestMsg && (
                <div className={`mt-2 text-xs font-mono px-3 py-1.5 rounded-lg inline-block ${
                  proxyTestMsg.type === 'success' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'
                }`}>{proxyTestMsg.text}</div>
              )}
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
              <button onClick={testGeminiKey} disabled={!geminiKey || geminiKey === '********' || testingGemini}
                className="mt-2 px-3 py-2 bg-purple-500/20 border border-purple-500/30 text-purple-300 rounded-lg hover:bg-purple-500/30 disabled:opacity-50 font-mono text-xs whitespace-nowrap">
                {testingGemini ? '测试中...' : '测试连接'}
              </button>
              {geminiTestMsg && (
                <div className={`mt-2 text-xs font-mono px-3 py-1.5 rounded-lg inline-block ${
                  geminiTestMsg.type === 'success' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'
                }`}>{geminiTestMsg.text}</div>
              )}
              <p className="text-[10px] text-gray-600 font-mono">
                优先用直连 Key；填了中转地址则作降级。支持 OpenAI 兼容 /v1 端点。模型名前缀 [L]按次 [V]按量
              </p>
            </div>
          </div>
        </div>

        {/* Agnes AI（全模态：文生图 / 文生视频，默认主用，其他厂商作降级兜底） */}
        <div className="card-glass p-6 mt-6">
        </div>{/* media 组结束 */}
        <div className={cfgTab === 'keys' ? '' : 'hidden'}>
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
            <button onClick={testAgnesKey} disabled={!agnesKey || agnesKey === '********' || testingAgnes}
              className="mt-2 px-3 py-2 bg-emerald-500/20 border border-emerald-500/30 text-emerald-400 rounded-lg hover:bg-emerald-500/30 disabled:opacity-50 font-mono text-xs whitespace-nowrap">
              {testingAgnes ? '测试中...' : '测试连接'}
            </button>
            {agnesTestMsg && (
              <div className={`mt-2 text-xs font-mono px-3 py-1.5 rounded-lg inline-block ${
                agnesTestMsg.type === 'success' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'
              }`}>{agnesTestMsg.text}</div>
            )}
            <p className="text-[10px] text-gray-600 font-mono">
              文生图 agnes-image-2.1-flash · 文生视频 agnes-video-v2.0（异步轮询）。免费额度，谨慎高频调用。
            </p>
          </div>
        </div>

        {/* 天行 API（热点榜：抖音/微博/微信等，有则优先，无则走 vvhan 免费兜底） */}
        <div className="bg-gray-900/60 backdrop-blur-xl rounded-xl border border-white/5 p-4 mb-4">
          <div className="flex items-center gap-2 mb-1">
            <h3 className="text-white font-bold mb-2"><span className="text-purple-400">//</span> vvhan 热点 API
              {statusMap.vvhan === 'ok'
                ? <span className="ml-2 text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">✅ 已配置</span>
                : <span className="ml-2 text-[10px] px-2 py-0.5 rounded-full bg-white/5 text-gray-500 border border-white/10">❌ 未配置（内置兜底可用）</span>}
            </h3>
          </div>
          <p className="text-gray-400 text-xs mb-4">填写后，AGENT 热点榜（微博/抖音/知乎/小红书/头条/百度）优先走 vvhan v1 官方接口。申请：<a href="https://v1.vvhan.com/" target="_blank" rel="noreferrer" className="text-cyan-400 underline">v1.vvhan.com</a>（VH-BunAPI 控制台）</p>
          <div className="flex gap-2 mb-2">
            <input
              type={showTianApiKey ? 'text' : 'password'}
              value={vvhanApiKey}
              onChange={e => setVvhanApiKey(e.target.value)}
              placeholder="vvhan API Key（留空=用内置兜底）"
              className="flex-1 bg-white/5 border border-white/10 rounded-lg px-4 py-2.5 text-white text-sm font-mono focus:outline-none focus:border-emerald-500/50"
            />
            <button onClick={() => setShowTianApiKey(v => !v)}
              className="px-3 py-2 bg-white/5 border border-white/10 text-gray-400 rounded-lg hover:bg-white/10 font-mono text-sm">
              {showTianApiKey ? '🙈' : '👁'}
            </button>
          </div>
          <div className="flex gap-2 mb-2">
            <input value={vvhanApiBase} onChange={e => setVvhanApiBase(e.target.value)}
              placeholder="API 域名（默认 https://v1.vvhan.com）"
              className="flex-1 bg-white/5 border border-white/10 rounded-lg px-4 py-2 text-white text-sm font-mono focus:outline-none focus:border-emerald-500/50" />
          </div>
          {/* 2026-08-11：掩码（已配置）状态也可测试——后端用已存 key 测 */}
          <button onClick={testVvhanApiKey} disabled={testingTianApi}
            className="mt-2 px-3 py-2 bg-emerald-500/20 border border-emerald-500/30 text-emerald-400 rounded-lg hover:bg-emerald-500/30 disabled:opacity-50 font-mono text-xs whitespace-nowrap">
            {testingTianApi ? '测试中...' : '测试连接'}
          </button>
          {tianApiTestMsg && (
            <div className={`mt-2 text-xs font-mono px-3 py-1.5 rounded-lg inline-block ${
              tianApiTestMsg.type === 'success' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'
            }`}>{tianApiTestMsg.text}</div>
          )}
        </div>

        {/* Google 搜索（Serper）— 网页/视频/新闻搜索信源 */}
        <div className="bg-gray-900/60 backdrop-blur-xl rounded-xl border border-white/5 p-4 mb-4">
          <div className="flex items-center gap-2 mb-1">
            <h3 className="text-white font-bold mb-2"><span className="text-cyan-400">//</span> Google 搜索（Serper）
              {statusMap.serper === 'ok'
                ? <span className="ml-2 text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">✅ 已配置</span>
                : <span className="ml-2 text-[10px] px-2 py-0.5 rounded-full bg-white/5 text-gray-500 border border-white/10">❌ 未配置</span>}
            </h3>
          </div>
          <p className="text-gray-400 text-xs mb-4">填写后，AGENT 可实时搜索 Google 网页 / 视频 / 新闻（语音说「帮我搜XX」即可呼出）。免费 2500 次/月，注册：<a href="https://serper.dev" target="_blank" rel="noreferrer" className="text-cyan-400 underline">serper.dev</a>。不填则搜索功能不可用。</p>
          <div className="flex gap-2">
            <input
              type={showSerperKey ? 'text' : 'password'}
              value={serperKey}
              onChange={e => setSerperKey(e.target.value)}
              placeholder="Serper API Key"
              className="flex-1 bg-white/5 border border-white/10 rounded-lg px-4 py-2.5 text-white text-sm font-mono focus:outline-none focus:border-emerald-500/50"
            />
            <button type="button" onClick={() => setShowSerperKey(v => !v)}
              className="px-3 py-2 bg-white/5 border border-white/10 text-gray-400 rounded-lg hover:bg-white/10 font-mono text-sm">
              {showSerperKey ? '🙈' : '👁'}
            </button>
          </div>
          <button type="button" onClick={testSerperKey} disabled={testingSerper}
            className="mt-2 px-3 py-2 bg-emerald-500/20 border border-emerald-500/30 text-emerald-400 rounded-lg hover:bg-emerald-500/30 disabled:opacity-50 font-mono text-xs">
            {testingSerper ? '测试中...' : '测试连接'}
          </button>
          {(serperTestMsg2 || serperTestMsg) && (
            <div className={`mt-2 text-xs font-mono px-3 py-1.5 rounded-lg inline-block ${
              (serperTestMsg2 || serperTestMsg)!.type === 'success' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'
            }`}>{(serperTestMsg2 || serperTestMsg)!.text}</div>
          )}
        </div>

        {/* 下载代理（Shadowsocks）— 夜间视频下载用 */}
        <div className="bg-gray-900/60 backdrop-blur-xl rounded-xl border border-white/5 p-4 mb-4">
          <div className="flex items-center gap-2 mb-1">
        </div>{/* keys 组结束 */}
        <div className={cfgTab === 'engine' ? '' : 'hidden'}>
            <h3 className="text-white font-bold mb-2"><span className="text-yellow-400">//</span> 下载代理（Shadowsocks）</h3>
          </div>
          <p className="text-gray-400 text-xs mb-4">用于夜间定时拉取 YouTube 行业视频（服务器直连被墙，需 SS 隧道转 SOCKS5）。填写后重启 ss-local：<code className="text-emerald-400">ss-local -c /etc/shadowsocks-libev/config.json -f /tmp/ss-local.pid</code></p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div>
              <label className="block text-xs text-gray-400 mb-1">服务器 IP</label>
              <input value={ssServer} onChange={e => setSsServer(e.target.value)} placeholder="如 3.88.222.230"
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm font-mono focus:outline-none focus:border-emerald-500/50" />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">端口</label>
              <input value={ssPort} onChange={e => setSsPort(e.target.value)} placeholder="如 11311"
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm font-mono focus:outline-none focus:border-emerald-500/50" />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">密码</label>
              <input type="password" value={ssPassword} onChange={e => setSsPassword(e.target.value)} placeholder="SS 密码"
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm font-mono focus:outline-none focus:border-emerald-500/50" />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">加密方式</label>
              <select value={ssMethod} onChange={e => setSsMethod(e.target.value)}
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-emerald-500/50">
                <option value="aes-256-gcm" className="bg-gray-900">aes-256-gcm</option>
                <option value="aes-128-gcm" className="bg-gray-900">aes-128-gcm</option>
                <option value="chacha20-ietf-poly1305" className="bg-gray-900">chacha20-ietf-poly1305</option>
                <option value="rc4-md5" className="bg-gray-900">rc4-md5</option>
              </select>
            </div>
          </div>
        </div>

        {/* AGENT 微信/飞书渠道（阶段四·融合 BaiLongma IM 连接） */}
        <div className="bg-gray-900/60 backdrop-blur-xl rounded-xl border border-white/5 p-4 mb-4">
          <div className="flex items-center gap-2 mb-1">
        </div>{/* engine 组结束 */}
        <div className={cfgTab === 'system' ? '' : 'hidden'}>
            <h3 className="text-white font-bold mb-2"><span className="text-purple-400">//</span> AGENT 微信 / 飞书渠道</h3>
          </div>
          <p className="text-gray-400 text-xs mb-4">把 AGENT 对话通过群机器人 webhook 推送到企业微信群 / 飞书群。填写后，在 AGENT 页可通过「转发到群」把内容同步过去。需在企业微信/飞书后台创建群机器人获取 webhook 地址。</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-gray-400 mb-1">企业微信机器人 Webhook</label>
              <div className="flex gap-2">
                <input
                  type={showAgentWebhookWechat ? 'text' : 'password'}
                  value={agentWebhookWechat}
                  onChange={e => setAgentWebhookWechat(e.target.value)}
                  placeholder="https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=..."
                  className="flex-1 px-3 py-2 bg-black/30 border border-white/10 rounded-lg text-white text-xs font-mono focus:border-emerald-500/50 focus:outline-none" />
                <button type="button" onClick={() => setShowAgentWebhookWechat(v => !v)} className="px-2 py-2 bg-white/5 rounded-lg text-gray-400 hover:text-gray-200">{showAgentWebhookWechat ? '🙈' : '👁'}</button>
              </div>
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">飞书机器人 Webhook</label>
              <div className="flex gap-2">
                <input
                  type={showAgentWebhookFeishu ? 'text' : 'password'}
                  value={agentWebhookFeishu}
                  onChange={e => setAgentWebhookFeishu(e.target.value)}
                  placeholder="https://open.feishu.cn/open-apis/bot/v2/hook/..."
                  className="flex-1 px-3 py-2 bg-black/30 border border-white/10 rounded-lg text-white text-xs font-mono focus:border-emerald-500/50 focus:outline-none" />
                <button type="button" onClick={() => setShowAgentWebhookFeishu(v => !v)} className="px-2 py-2 bg-white/5 rounded-lg text-gray-400 hover:text-gray-200">{showAgentWebhookFeishu ? '🙈' : '👁'}</button>
              </div>
            </div>
          </div>
          {(agentWebhookWechat || agentWebhookFeishu) && (
            <p className="mt-2 text-[10px] text-emerald-400 font-mono">✓ 已配置 {[agentWebhookWechat && '企业微信', agentWebhookFeishu && '飞书'].filter(Boolean).join(' / ')}</p>
          )}
        </div>

        </div>{/* system 组结束 */}
        <div className={cfgTab === 'engine' ? '' : 'hidden'}>
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

        </div>{/* engine 组结束 */}
        <div className={cfgTab === 'system' ? '' : 'hidden'}>
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
        </div>{/* system 组结束 */}
      </div>
    </div>
  )
}
