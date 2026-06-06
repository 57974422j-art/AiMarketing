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
  const [mcPath, setMcPath] = useState('/opt/MediaCrawler')
  const [mcPythonBin, setMcPythonBin] = useState('python3')
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

  // ====== 全局消息 ======
  const [saveMessage, setSaveMessage] = useState<SaveMessage | null>(null)

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
        }),
      })
      const result = await res.json()
      if (result.success) {
        setSaveMessage({ type: 'success', text: '✅ 配置已保存，服务重启中' })
        await loadConfig()
      } else {
        setSaveMessage({ type: 'error', text: `❌ 保存失败：${result.message}` })
      }
    } catch {
      setSaveMessage({ type: 'error', text: '❌ 保存失败：网络错误' })
    }
    setTimeout(() => setSaveMessage(null), 5000)
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
            <div className={`px-4 py-2 rounded-xl text-sm font-mono ${
              saveMessage.type === 'success' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'
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
          <button onClick={saveAllSettings}
            className="px-6 py-3 bg-emerald-500 text-white rounded-xl hover:bg-emerald-600 transition-colors font-mono">
            保存所有配置
          </button>
        </div>
      </div>
    </div>
  )
}
