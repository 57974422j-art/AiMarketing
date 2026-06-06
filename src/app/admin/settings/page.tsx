'use client';
import { useState, useEffect } from 'react';
import { useAuth } from '@/app/providers';

export default function SettingsPage() {
  const { user, loading: authLoading } = useAuth()
  const [authorized, setAuthorized] = useState(false)

  useEffect(() => {
    if (!authLoading) setAuthorized(user?.role === 'admin')
  }, [authLoading, user])
  // API Key 配置状态
  const [deepseekKey, setDeepseekKey] = useState('');
  const [volcanoKey, setVolcanoKey] = useState('');
  const [siliconflowKey, setSiliconflowKey] = useState('');
  const [dashscopeKey, setDashscopeKey] = useState('');
  const [showDeepseekKey, setShowDeepseekKey] = useState(false);
  const [showVolcanoKey, setShowVolcanoKey] = useState(false);
  const [showSiliconflowKey, setShowSiliconflowKey] = useState(false);
  const [showDashscopeKey, setShowDashscopeKey] = useState(false);
  const [testingDeepseek, setTestingDeepseek] = useState(false);
  const [testingVolcano, setTestingVolcano] = useState(false);
  const [testingSiliconflow, setTestingSiliconflow] = useState(false);
  const [testingDashscope, setTestingDashscope] = useState(false);
  const [testResult, setTestResult] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [statusMap, setStatusMap] = useState<Record<string, string | null>>({})

  function StatusDot({ name }: { name: string }) {
    const s = statusMap[name]
    if (!s) return <span className="inline-flex items-center gap-1 text-xs text-gray-500 ml-2 px-2 py-0.5 rounded-full bg-white/5"><span className="w-1.5 h-1.5 rounded-full bg-gray-500" /><span>未配置</span><span className="text-[10px] opacity-50 ml-1">/ OFF</span></span>
    if (s === 'ok') return <span className="inline-flex items-center gap-1 text-xs text-emerald-400 ml-2 px-2 py-0.5 rounded-full bg-emerald-500/10"><span className="w-1.5 h-1.5 rounded-full bg-emerald-400" /><span>已连接</span><span className="text-[10px] opacity-50 ml-1">/ OK</span></span>
    if (s === 'fail') return <span className="inline-flex items-center gap-1 text-xs text-red-400 ml-2 px-2 py-0.5 rounded-full bg-red-500/10"><span className="w-1.5 h-1.5 rounded-full bg-red-400" /><span>连接失败</span><span className="text-[10px] opacity-50 ml-1">/ FAIL</span></span>
    return null
  }

  // OSS 配置状态
  const [ossRegion, setOssRegion] = useState('');
  const [ossAccessKeyId, setOssAccessKeyId] = useState('');
  const [ossAccessKeySecret, setOssAccessKeySecret] = useState('');
  const [ossBucket, setOssBucket] = useState('');
  const [showOssSecret, setShowOssSecret] = useState(false);
  const [testingOSS, setTestingOSS] = useState(false);
  const [testingTTS, setTestingTTS] = useState(false);
  // 火山 TTS 配置
  const [ttsAppId, setTtsAppId] = useState('');
  const [ttsAccessKey, setTtsAccessKey] = useState('');
  const [ttsResourceId, setTtsResourceId] = useState('');
  const [showTtsAppId, setShowTtsAppId] = useState(false);
  const [showTtsAccessKey, setShowTtsAccessKey] = useState(false);
  const [showTtsResourceId, setShowTtsResourceId] = useState(false);
  const [queryEngine, setQueryEngine] = useState('mediacrawler');
  const [actionEngine, setActionEngine] = useState('q1-adb');
  // MediaCrawler 配置
  const [mcPath, setMcPath] = useState('/opt/MediaCrawler');
  const [mcPythonBin, setMcPythonBin] = useState('python3');
  const [mcHealthStatus, setMcHealthStatus] = useState<'idle' | 'checking' | 'ok' | 'fail'>('idle');
  const [mcHealthDetail, setMcHealthDetail] = useState<string>('');
  const [saveMessage, setSaveMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  // 扫码登录状态
  const [loginStatus, setLoginStatus] = useState<'idle' | 'starting' | 'waiting_scan' | 'scanned' | 'confirmed' | 'success' | 'error' | 'timeout' | 'killed'>('idle');
  const [loginMessage, setLoginMessage] = useState<string>('');
  const [loginElapsed, setLoginElapsed] = useState<number>(0);
  const [loginPolling, setLoginPolling] = useState(false);
  // Cookie 状态
  const [cookieStatus, setCookieStatus] = useState<'loading' | 'valid' | 'expired' | 'missing' | 'error' | 'unknown'>('loading');
  const [cookieFiles, setCookieFiles] = useState<Array<{ name: string; size: number; modifiedAt: string }>>([]);
  const [cookieSummary, setCookieSummary] = useState<{ totalFiles: number; totalSize: number }>({ totalFiles: 0, totalSize: 0 });
  // IP 代理池
  const [proxies, setProxies] = useState<any[]>([]);
  const [proxyStats, setProxyStats] = useState<any>(null);
  const [proxyGlobalEnabled, setProxyGlobalEnabled] = useState(false);
  // 新增代理表单
  const [showAddProxy, setShowAddProxy] = useState(false);
  const [newProxy, setNewProxy] = useState({ host: '', port: '', protocol: 'http', username: '', password: '', label: '', region: '' });

  useEffect(() => {
    loadApiKeyStatus();
    loadOSSStatus();
    loadCookieStatus();
    loadProxyPool();
  }, []);

  const loadApiKeyStatus = async () => {
    try {
      const response = await fetch('/api/admin/config', { credentials: 'include' });
      const result = await response.json();
      if (result.success) {
        const d = result.data
        setDeepseekKey(d.deepseekConfigured ? '********' : '');
        setVolcanoKey(d.volcanoConfigured ? '********' : '');
        setSiliconflowKey(d.siliconflowConfigured ? '********' : '');
        setDashscopeKey(d.dashscopeConfigured ? '********' : '');
        setQueryEngine(d.automationEngine || 'mediacrawler');
        setActionEngine(d.automationEngine || 'q1-adb');
        setOssRegion(d.ossConfigured ? '********' : '');
        setOssBucket(d.ossConfigured ? '********' : '');
        // 已配置即显示 🟢已连接，测试失败才变 🔴
        setTtsAppId(d.ttsAppIdConfigured ? '********' : '')
        setTtsAccessKey(d.ttsAccessKeyConfigured ? '********' : '')
        setTtsResourceId(d.ttsResourceIdConfigured ? '********' : '')
        // MediaCrawler 配置
        if (d.mcPath) setMcPath(d.mcPath)
        if (d.mcPythonBin) setMcPythonBin(d.mcPythonBin)
        setStatusMap({
          deepseek: d.deepseekConfigured ? 'ok' : null,
          siliconflow: d.siliconflowConfigured ? 'ok' : null,
          dashscope: d.dashscopeConfigured ? 'ok' : null,
          volcano: d.volcanoConfigured ? 'ok' : null,
          tts: (d.ttsAppIdConfigured && d.ttsAccessKeyConfigured && d.ttsResourceIdConfigured) ? 'ok' : null,
          oss: d.ossConfigured ? 'ok' : null,
        })
      }
    } catch (error) {
      console.error('加载配置状态失败:', error);
    }
  };

  const loadOSSStatus = async () => {
    try {
      const response = await fetch('/api/admin/config', { credentials: 'include' });
      const result = await response.json();
      if (result.success) {
        setOssRegion(result.data.ossRegion || '');
        setOssBucket(result.data.ossBucket || '');
      }
    } catch (error) {
      console.error('加载 OSS 配置失败:', error);
    }
  };

  // 测试 DeepSeek API Key
  const testDeepseekKey = async () => {
    if (!deepseekKey || deepseekKey === '********') {
      setTestResult({ type: 'error', message: '请输入有效的 DeepSeek API Key' });
      return;
    }

    setTestingDeepseek(true);
    setTestResult(null);

    try {
      const response = await fetch('/api/admin/test-key', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: 'deepseek', key: deepseekKey })
      });

      const result = await response.json();
      setTestResult({ type: result.valid ? 'success' : 'error', message: result.message });
      setStatusMap(prev => ({ ...prev, deepseek: result.valid ? 'ok' : 'fail' }));
    } catch (error) {
      setTestResult({ type: 'error', message: '测试请求失败' });
      setStatusMap(prev => ({ ...prev, deepseek: 'fail' }));
    } finally {
      setTestingDeepseek(false);
    }
  };

  // 测试火山方舟 API Key
  const testVolcanoKey = async () => {
    if (!volcanoKey || volcanoKey === '********') {
      setTestResult({ type: 'error', message: '请输入有效的火山方舟 API Key' });
      return;
    }

    setTestingVolcano(true);
    setTestResult(null);

    try {
      const response = await fetch('/api/admin/test-key', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: 'volcano', key: volcanoKey })
      });

      const result = await response.json();
      setTestResult({ type: result.valid ? 'success' : 'error', message: result.message });
      setStatusMap(prev => ({ ...prev, volcano: result.valid ? 'ok' : 'fail' }));
    } catch (error) {
      setTestResult({ type: 'error', message: '测试请求失败' });
      setStatusMap(prev => ({ ...prev, volcano: 'fail' }));
    } finally {
      setTestingVolcano(false);
    }
  };

  // 测试硅基流动 API Key
  const testSiliconflowKey = async () => {
    if (!siliconflowKey || siliconflowKey === '********') {
      setTestResult({ type: 'error', message: '请输入有效的硅基流动 API Key' });
      return;
    }

    setTestingSiliconflow(true);
    setTestResult(null);

    try {
      const response = await fetch('https://api.siliconflow.cn/v1/models', {
        headers: {
          'Authorization': `Bearer ${siliconflowKey}`
        }
      });

      if (response.ok) {
        setTestResult({
          type: 'success',
          message: '硅基流动 API Key 有效'
        });
      } else {
        const errorData = await response.json().catch(() => ({}));
        setTestResult({
          type: 'error',
          message: errorData.error?.message || 'API Key 无效'
        });
      }
    } catch (error) {
      setTestResult({ type: 'error', message: '测试请求失败' });
    } finally {
      setTestingSiliconflow(false);
    }
  };

  // 测试阿里云百炼 API Key
  const testDashscopeKey = async () => {
    if (!dashscopeKey || dashscopeKey === '********') {
      setTestResult({ type: 'error', message: '请输入有效的阿里云百炼 API Key' });
      return;
    }

    setTestingDashscope(true);
    setTestResult(null);

    try {
      const response = await fetch('/api/admin/test-key', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: 'dashscope', key: dashscopeKey })
      });

      const result = await response.json();
      setTestResult({ type: result.valid ? 'success' : 'error', message: result.message });
      setStatusMap(prev => ({ ...prev, dashscope: result.valid ? 'ok' : 'fail' }))
    } catch (error) {
      setTestResult({ type: 'error', message: '测试请求失败' });
      setStatusMap(prev => ({ ...prev, dashscope: 'fail' }))
    } finally {
      setTestingDashscope(false);
    }
  };

  // 测试 MediaCrawler 连接
  const testMediaCrawler = async () => {
    setMcHealthStatus('checking')
    setMcHealthDetail('正在检查...')
    try {
      const response = await fetch('/api/mediacrawler', { credentials: 'include' })
      const result = await response.json()
      if (result.success && result.data?.available) {
        setMcHealthStatus('ok')
        setMcHealthDetail(`Python OK | 路径: ${result.data.pathExists ? '存在' : '不存在'}${result.data.version ? ` | v${result.data.version}` : ''}`)
        setStatusMap(prev => ({ ...prev, queryEngine: 'ok' }))
      } else {
        setMcHealthStatus('fail')
        setMcHealthDetail(result.data?.error || result.message || '连接失败')
        setStatusMap(prev => ({ ...prev, queryEngine: 'fail' }))
      }
    } catch (e: any) {
      setMcHealthStatus('fail')
      setMcHealthDetail(e.message || '网络错误')
      setStatusMap(prev => ({ ...prev, queryEngine: 'fail' }))
    }
  };

  // ==================== 扫码登录 ====================
  const startLogin = async () => {
    setLoginStatus('starting')
    setLoginMessage('正在启动浏览器...')
    try {
      const res = await fetch('/api/mediacrawler/login', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform: 'douyin' }),
      })
      const result = await res.json()
      if (result.success) {
        setLoginMessage(result.data?.message || '已启动')
        startLoginPolling()
      } else {
        setLoginStatus('error')
        setLoginMessage(result.message || '启动失败')
      }
    } catch (e: any) {
      setLoginStatus('error')
      setLoginMessage(e.message)
    }
  };

  const startLoginPolling = () => {
    if (loginPolling) return
    setLoginPolling(true)
    const timer = setInterval(() => setLoginElapsed(s => s + 1), 1000)
    const poll = async () => {
      try {
        const res = await fetch('/api/mediacrawler/login', { credentials: 'include' })
        const result = await res.json()
        if (result.success && result.data?.loginProcess) {
          const lp = result.data.loginProcess
          setLoginStatus(lp.status)
          setLoginMessage(lp.message || '')
          if (lp.status === 'success' || lp.status === 'error' || lp.status === 'timeout' || lp.status === 'killed') {
            clearInterval(timer)
            setLoginPolling(false)
            loadCookieStatus() // 登录完成后刷新 cookie 状态
          }
        }
      } catch {}
      if (loginPolling) setTimeout(poll, 2000)
    }
    poll()
  };

  const cancelLogin = async () => {
    await fetch('/api/mediacrawler/login', { method: 'DELETE', credentials: 'include' })
    setLoginStatus('killed')
    setLoginMessage('已取消')
    setLoginPolling(false)
  };

  // ==================== Cookie 状态 ====================
  const loadCookieStatus = async () => {
    setCookieStatus('loading')
    try {
      const res = await fetch('/api/mediacrawler/cookies', { credentials: 'include' })
      const result = await res.json()
      if (result.success) {
        setCookieStatus(result.data.validation?.status || 'unknown')
        setCookieFiles((result.data.cookies || []).map((f: any) => ({ name: f.name, size: f.size, modifiedAt: f.modifiedAt })))
        setCookieSummary(result.data.summary || { totalFiles: 0, totalSize: 0 })
      }
    } catch {
      setCookieStatus('error')
    }
  };

  const validateCookies = async () => {
    setCookieStatus('loading')
    try {
      const res = await fetch('/api/mediacrawler/cookies', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'validate' }),
      })
      const result = await res.json()
      setCookieStatus(result.data?.status || 'error')
      alert(`验证结果: ${result.message || JSON.stringify(result.data)}`)
    } catch {
      setCookieStatus('error')
    }
  };

  const clearCookies = async () => {
    if (!confirm('确定要清除所有 Cookie 吗？清除后需要重新扫码登录。')) return
    try {
      const res = await fetch('/api/mediacrawler/cookies', { method: 'DELETE', credentials: 'include' })
      const result = await res.json()
      alert(result.message)
      loadCookieStatus()
    } catch (e: any) {
      alert('删除失败: ' + e.message)
    }
  };

  // ==================== IP 代理池 ====================
  const loadProxyPool = async () => {
    try {
      const res = await fetch('/api/mediacrawler/proxy-pool', { credentials: 'include' })
      const result = await res.json()
      if (result.success) {
        setProxies(result.data.proxies || [])
        setProxyStats(result.data.stats)
        setProxyGlobalEnabled(result.data.settings?.globalEnabled || false)
      }
    } catch {}
  };

  const addProxy = async () => {
    if (!newProxy.host || !newProxy.port) return
    try {
      const res = await fetch('/api/mediacrawler/proxy-pool', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newProxy),
      })
      const result = await res.json()
      if (result.success) {
        setNewProxy({ host: '', port: '', protocol: 'http', username: '', password: '', label: '', region: '' })
        setShowAddProxy(false)
        loadProxyPool()
      } else {
        alert(result.message)
      }
    } catch (e: any) {
      alert('添加失败: ' + e.message)
    }
  };

  const testSingleProxy = async (id: string) => {
    await fetch('/api/mediacrawler/proxy-pool', {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'test', id }),
    }).then(r => r.json()).then(() => loadProxyPool()).catch(() => {})
  };

  const testAllProxies = async () => {
    await fetch('/api/mediacrawler/proxy-pool', {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'test-all' }),
    }).then(r => r.json()).then(() => loadProxyPool()).catch(() => {})
  };

  const deleteProxy = async (id: string) => {
    if (!confirm('确定删除此代理？')) return
    await fetch(`/api/mediacrawler/proxy-pool?id=${id}`, { method: 'DELETE', credentials: 'include' })
    loadProxyPool()
  };

  const toggleProxyGlobal = async (enabled: boolean) => {
    await fetch('/api/mediacrawler/proxy-pool', {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'settings', settings: { globalEnabled: enabled } }),
    })
    setProxyGlobalEnabled(enabled)
  };

  // 测试 OSS 配置
  const testOSSConnection = async () => {
    if (!ossRegion || !ossAccessKeyId || !ossAccessKeySecret || !ossBucket) {
      setTestResult({ type: 'error', message: '请填写完整的 OSS 配置' });
      return;
    }

    setTestingOSS(true);
    setTestResult(null);

    try {
      const response = await fetch('/api/admin/test-key', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: 'oss',
          region: ossRegion,
          accessKeyId: ossAccessKeyId,
          accessKeySecret: ossAccessKeySecret,
          bucket: ossBucket
        })
      });

      const result = await response.json();
      setTestResult({ type: result.valid ? 'success' : 'error', message: result.message });
      setStatusMap(prev => ({ ...prev, oss: result.valid ? 'ok' : 'fail' }))
    } catch (error) {
      setTestResult({ type: 'error', message: '测试请求 failed' });
      setStatusMap(prev => ({ ...prev, oss: 'fail' }))
    } finally {
      setTestingOSS(false);
    }
  };

  // 保存所有配置
  const saveAllSettings = async () => {
    try {
      const actualDeepseekKey = deepseekKey === '********' ? undefined : deepseekKey;
      const actualVolcanoKey = volcanoKey === '********' ? undefined : volcanoKey;
      const actualSiliconflowKey = siliconflowKey === '********' ? undefined : siliconflowKey;
      const actualDashscopeKey = dashscopeKey === '********' ? undefined : dashscopeKey;
      const actualOssAccessKeyId = ossAccessKeyId === '********' ? undefined : ossAccessKeyId;
      const actualOssAccessKeySecret = ossAccessKeySecret === '********' ? undefined : ossAccessKeySecret;
      const actualTtsAppId = ttsAppId === '********' ? undefined : ttsAppId;
      const actualTtsAccessKey = ttsAccessKey === '********' ? undefined : ttsAccessKey;
      const actualTtsResourceId = ttsResourceId === '********' ? undefined : ttsResourceId;

      const response = await fetch('/api/admin/config', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deepseekKey: actualDeepseekKey || undefined,
          volcanoKey: actualVolcanoKey || undefined,
          siliconflowKey: actualSiliconflowKey || undefined,
          dashscopeKey: actualDashscopeKey || undefined,
          ossRegion: ossRegion || undefined,
          ossAccessKeyId: actualOssAccessKeyId || undefined,
          ossAccessKeySecret: actualOssAccessKeySecret || undefined,
          ossBucket: ossBucket || undefined,
          ttsAppId: actualTtsAppId || undefined,
          ttsAccessKey: actualTtsAccessKey || undefined,
          ttsResourceId: actualTtsResourceId || undefined,
          automationEngine: queryEngine || undefined,
          mcPath: mcPath || undefined,
          mcPythonBin: mcPythonBin || undefined,
        })
      });

      const result = await response.json();

      if (result.success) {
        setSaveMessage({ type: 'success', text: '✅ 配置已保存，服务重启中' });
        await loadApiKeyStatus();
        await loadOSSStatus();
      } else {
        setSaveMessage({ type: 'error', text: `❌ 保存失败：${result.message}` });
      }
    } catch (error) {
      setSaveMessage({ type: 'error', text: '❌ 保存失败：网络错误' });
    }
    setTimeout(() => setSaveMessage(null), 5000);
  };

  if (authLoading) return <div className="min-h-screen bg-gray-950 flex items-center justify-center"><p className="text-gray-400">加载中...</p></div>
  if (!authorized) return <div className="min-h-screen bg-gray-950 flex items-center justify-center"><p className="text-red-400">仅管理员可访问</p></div>

  return (
    <div className="min-h-screen bg-gray-950">
      <div className="max-w-6xl mx-auto px-4 py-8">
        <div className="flex items-center justify-between mb-8">
          <div>
            <p className="text-label mb-2">系统 / SYSTEM</p>
            <h1 className="text-mono-lg text-white">设置 / SETTINGS</h1>
          </div>
          {saveMessage && (
            <div className={`px-4 py-2 rounded-xl text-sm font-mono ${
              saveMessage.type === 'success'
                ? 'bg-emerald-500/20 text-emerald-400'
                : 'bg-red-500/20 text-red-400'
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
          }`}>
            {testResult.message}
          </div>
        )}

        {/* API Key 配置区域 */}
        <div className="bg-white/5 backdrop-blur-sm rounded-2xl border border-white/10 mb-6">
          <div className="p-6">
            <div className="flex items-center justify-between mb-6">
              <div>
                <h3 className="font-medium text-white font-mono">API KEY 配置</h3>
                <p className="text-sm text-gray-500 mt-1">配置全局 API Key，所有 AI 功能将使用此处设置的 Key</p>
              </div>
            </div>

            <div className="space-y-6">
              {/* DeepSeek API Key */}
              <div>
                <label className="block text-label mb-2">
                  <span>DeepSeek API Key</span>
                  <span className="opacity-50 ml-1">DEEPSEEK</span>
                  <StatusDot name="deepseek" />
                </label>
                <div className="flex gap-3">
                  <div className="flex-1 relative">
                    <input
                      type={showDeepseekKey ? 'text' : 'password'}
                      value={deepseekKey}
                      onChange={(e) => setDeepseekKey(e.target.value)}
                      placeholder="sk-xxxxxxxxxxxxxxxxxxxxxxxx"
                      className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-emerald-500/50 font-mono pr-20"
                    />
                    <button
                      type="button"
                      onClick={() => setShowDeepseekKey(!showDeepseekKey)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white"
                    >
                      {showDeepseekKey ? (
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                        </svg>
                      ) : (
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                        </svg>
                      )}
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={testDeepseekKey}
                    disabled={testingDeepseek || !deepseekKey || deepseekKey === '********'}
                    className="px-4 py-3 bg-blue-500/20 border border-blue-500/30 text-blue-400 rounded-xl hover:bg-blue-500/30 disabled:opacity-50 disabled:cursor-not-allowed font-mono text-sm whitespace-nowrap"
                  >
                    {testingDeepseek ? '测试中...' : '测试连接'}
                  </button>
                </div>
                <p className="text-xs text-gray-500 mt-2 font-mono">
                  DeepSeek API Key，用于 AI 文案生成等功能
                </p>
              </div>

              {/* 硅基流动 API Key */}
              <div>
                <label className="block text-label mb-2">
                  <span>硅基流动 API Key</span>
                  <span className="opacity-50 ml-1">SILICONFLOW</span>
                  <StatusDot name="siliconflow" />
                </label>
                <div className="flex gap-3">
                  <div className="flex-1 relative">
                    <input
                      type={showSiliconflowKey ? 'text' : 'password'}
                      value={siliconflowKey}
                      onChange={(e) => setSiliconflowKey(e.target.value)}
                      placeholder="sk-xxxxxxxxxxxxxxxxxxxxxxxx"
                      className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-emerald-500/50 font-mono pr-20"
                    />
                    <button
                      type="button"
                      onClick={() => setShowSiliconflowKey(!showSiliconflowKey)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white"
                    >
                      {showSiliconflowKey ? (
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                        </svg>
                      ) : (
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                        </svg>
                      )}
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={testSiliconflowKey}
                    disabled={testingSiliconflow || !siliconflowKey || siliconflowKey === '********'}
                    className="px-4 py-3 bg-blue-500/20 border border-blue-500/30 text-blue-400 rounded-xl hover:bg-blue-500/30 disabled:opacity-50 disabled:cursor-not-allowed font-mono text-sm whitespace-nowrap"
                  >
                    {testingSiliconflow ? '测试中...' : '测试连接'}
                  </button>
                </div>
                <p className="text-xs text-gray-500 mt-2 font-mono">
                  硅基流动 API Key，用于语音识别（Whisper/SenseVoice）等功能
                </p>
              </div>

              {/* 阿里云百炼 API Key */}
              <div className="mt-6 pt-6 border-t border-white/10">
                <h4 className="text-label mb-4 flex items-center gap-2">
                  <svg className="w-5 h-5 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                  </svg>
                  阿里云百炼（DashScope）配置
                </h4>
                <p className="text-sm text-gray-500 mb-4 font-mono">
                  用于语音识别（Paraformer 文件转写），需先在百炼控制台开通 Paraformer 模型
                </p>

                <div>
                  <label className="block text-label mb-2">
                    <span>API Key</span>
                    <span className="opacity-50 ml-1">DASHSCOPE_API_KEY</span>
                    <StatusDot name="dashscope" />
                  </label>
                  <div className="flex gap-3">
                    <div className="flex-1 relative">
                      <input
                        type={showDashscopeKey ? 'text' : 'password'}
                        value={dashscopeKey}
                        onChange={(e) => setDashscopeKey(e.target.value)}
                        placeholder="sk-xxxxxxxxxxxxxxxxxxxxxxxx"
                        className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-emerald-500/50 font-mono pr-20"
                      />
                      <button type="button" onClick={() => setShowDashscopeKey(!showDashscopeKey)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white">
                        {showDashscopeKey ? (
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" /></svg>
                        ) : (
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
                        )}
                      </button>
                    </div>
                    <button
                      type="button"
                      onClick={testDashscopeKey}
                      disabled={testingDashscope || !dashscopeKey || dashscopeKey === '********'}
                      className="px-4 py-3 bg-blue-500/20 border border-blue-500/30 text-blue-400 rounded-xl hover:bg-blue-500/30 disabled:opacity-50 disabled:cursor-not-allowed font-mono text-sm whitespace-nowrap"
                    >
                      {testingDashscope ? '测试中...' : '测试连接'}
                    </button>
                  </div>
                </div>
              </div>

              {/* 火山方舟 API Key */}
              <div>
                <label className="block text-label mb-2">
                  <span>火山方舟 API Key</span>
                  <span className="opacity-50 ml-1">VOLCANO</span>
                  <StatusDot name="volcano" />
                </label>
                <div className="flex gap-3">
                  <div className="flex-1 relative">
                    <input
                      type={showVolcanoKey ? 'text' : 'password'}
                      value={volcanoKey}
                      onChange={(e) => setVolcanoKey(e.target.value)}
                      placeholder="sk-xxxxxxxxxxxxxxxxxxxxxxxx"
                      className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-emerald-500/50 font-mono pr-20"
                    />
                    <button
                      type="button"
                      onClick={() => setShowVolcanoKey(!showVolcanoKey)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white"
                    >
                      {showVolcanoKey ? (
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                        </svg>
                      ) : (
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                        </svg>
                      )}
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={testVolcanoKey}
                    disabled={testingVolcano || !volcanoKey || volcanoKey === '********'}
                    className="px-4 py-3 bg-blue-500/20 border border-blue-500/30 text-blue-400 rounded-xl hover:bg-blue-500/30 disabled:opacity-50 disabled:cursor-not-allowed font-mono text-sm whitespace-nowrap"
                  >
                    {testingVolcano ? '测试中...' : '测试连接'}
                  </button>
                </div>
                <p className="text-xs text-gray-500 mt-2 font-mono">
                  火山方舟 API Key，用于文案生成、翻译、配音等功能
                </p>
              </div>

              {/* 火山 TTS 配音配置 */}
              <div className="mt-6 pt-6 border-t border-white/10">
                <h4 className="text-label mb-4 flex items-center gap-2">
                  <svg className="w-5 h-5 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" /></svg>
                  火山引擎 TTS（配音）配置
                  <StatusDot name="tts" />
                </h4>
                <p className="text-sm text-gray-500 mb-4 font-mono">用于后期处理中的高质量 AI 配音。需在火山引擎控制台开通语音合成服务（console.volcengine.com/tts）</p>
                <div className="grid grid-cols-1 gap-4">
                  <div>
                    <label className="block text-label mb-2">App ID <span className="opacity-50 ml-1">VOLCANO_TTS_APP_ID</span></label>
                    <div className="relative">
                      <input type={showTtsAppId ? 'text' : 'password'} value={ttsAppId} onChange={e => setTtsAppId(e.target.value)} placeholder="请输入 App ID" className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-emerald-500/50 font-mono pr-10" />
                      <button type="button" onClick={() => setShowTtsAppId(!showTtsAppId)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white">{showTtsAppId ? (<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" /></svg>) : (<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>)}</button>
                    </div>
                  </div>
                  <div>
                    <label className="block text-label mb-2">Access Key <span className="opacity-50 ml-1">VOLCANO_TTS_ACCESS_KEY</span></label>
                    <div className="relative">
                      <input type={showTtsAccessKey ? 'text' : 'password'} value={ttsAccessKey} onChange={e => setTtsAccessKey(e.target.value)} placeholder="请输入 Access Key" className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-emerald-500/50 font-mono pr-10" />
                      <button type="button" onClick={() => setShowTtsAccessKey(!showTtsAccessKey)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white">{showTtsAccessKey ? (<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" /></svg>) : (<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>)}</button>
                    </div>
                  </div>
                  <div>
                    <label className="block text-label mb-2">Resource ID <span className="opacity-50 ml-1">VOLCANO_TTS_RESOURCE_ID</span></label>
                    <div className="relative">
                      <input type={showTtsResourceId ? 'text' : 'password'} value={ttsResourceId} onChange={e => setTtsResourceId(e.target.value)} placeholder="请输入 Resource ID" className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-emerald-500/50 font-mono pr-10" />
                      <button type="button" onClick={() => setShowTtsResourceId(!showTtsResourceId)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white">{showTtsResourceId ? (<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" /></svg>) : (<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>)}</button>
                    </div>
                  </div>
                </div>
                <div className="mt-4">
                  <button type="button" onClick={() => {
                    if (!ttsAppId || ttsAppId === '********' || !ttsAccessKey || ttsAccessKey === '********' || !ttsResourceId || ttsResourceId === '********') {
                      setTestResult({ type: 'error', message: '请先填写完整的 TTS 配置并保存' }); return
                    }
                    setTestingTTS(true)
                    setTestResult(null)
                    setTimeout(() => {
                      setTestResult({ type: 'success', message: 'TTS 配置已填写，保存后执行 pm2 restart aimarketing --update-env 生效' })
                      setTestingTTS(false)
                    }, 500)
                  }} disabled={testingTTS}
                    className="px-4 py-2 bg-blue-500/20 border border-blue-500/30 text-blue-400 rounded-xl hover:bg-blue-500/30 disabled:opacity-50 disabled:cursor-not-allowed font-mono text-sm">
                    {testingTTS ? '检查中...' : '检查配置'}
                  </button>
                </div>
              </div>
          </div>
        </div>
      </div>

        {/* OSS 配置区域 */}
        <div className="bg-white/5 backdrop-blur-sm rounded-2xl border border-white/10 mb-6">
          <div className="p-6">
            <div className="flex items-center justify-between mb-6">
              <div>
                <h3 className="font-medium text-white font-mono">阿里云 OSS 配置 <StatusDot name="oss" /></h3>
                <p className="text-sm text-gray-500 mt-1">配置 OSS 用于文件存储（可选）</p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              {/* OSS Region */}
              <div>
                <label className="block text-label mb-2">OSS Region</label>
                <input
                  type="text"
                  value={ossRegion}
                  onChange={(e) => setOssRegion(e.target.value)}
                  placeholder="oss-cn-hangzhou"
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-emerald-500/50 font-mono"
                />
              </div>

              {/* OSS Bucket */}
              <div>
                <label className="block text-label mb-2">Bucket 名称</label>
                <input
                  type="text"
                  value={ossBucket}
                  onChange={(e) => setOssBucket(e.target.value)}
                  placeholder="your-bucket-name"
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-emerald-500/50 font-mono"
                />
              </div>

              {/* AccessKey ID */}
              <div>
                <label className="block text-label mb-2">AccessKey ID</label>
                <input
                  type="text"
                  value={ossAccessKeyId}
                  onChange={(e) => setOssAccessKeyId(e.target.value)}
                  placeholder="LTAIxxxxxxxxxx"
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-emerald-500/50 font-mono"
                />
              </div>

              {/* AccessKey Secret */}
              <div>
                <label className="block text-label mb-2">AccessKey Secret</label>
                <div className="relative">
                  <input
                    type={showOssSecret ? 'text' : 'password'}
                    value={ossAccessKeySecret}
                    onChange={(e) => setOssAccessKeySecret(e.target.value)}
                    placeholder="请输入 AccessKey Secret"
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-emerald-500/50 font-mono pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowOssSecret(!showOssSecret)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white"
                  >
                    {showOssSecret ? (
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                      </svg>
                    ) : (
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                      </svg>
                    )}
                  </button>
                </div>
              </div>
            </div>

            <div className="mt-4 flex gap-3">
              <button
                type="button"
                onClick={testOSSConnection}
                disabled={testingOSS}
                className="px-4 py-3 bg-blue-500/20 border border-blue-500/30 text-blue-400 rounded-xl hover:bg-blue-500/30 disabled:opacity-50 disabled:cursor-not-allowed font-mono text-sm"
              >
                {testingOSS ? '测试中...' : '测试连接'}
              </button>
            </div>
          </div>
        </div>

        {/* 自动化引擎 */}
        <div className="card-glass p-6 mt-6">
          <h3 className="text-white font-bold mb-2"><span className="text-blue-400">//</span> 数据查询引擎（READ）</h3>
          <p className="text-gray-400 text-xs mb-4">用于视频搜索、评论爬取、用户画像等读操作</p>

          {/* 查询引擎选择 */}
          <div>
            <label className="block text-label mb-2">
              <span>QUERY_ENGINE</span>
              <StatusDot name="queryEngine" />
            </label>
            <select
              value={queryEngine}
              onChange={(e) => setQueryEngine(e.target.value)}
              className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-emerald-500/50 font-mono"
            >
              <option value="mediacrawler" className="bg-gray-900">MediaCrawler 爬虫（推荐）</option>
              <option value="douyin-official" className="bg-gray-900">抖音官方 API</option>
            </select>
            <p className="text-xs text-gray-500 mt-2 font-mono">
              💡 推荐使用 MediaCrawler 爬虫服务，需先部署 MediaCrawler 并配置 cookie
            </p>
          </div>

          {/* MediaCrawler 详细配置（当选择 mediacrawler 时显示） */}
          {queryEngine === 'mediacrawler' && (
            <div className="mt-4 p-4 rounded-xl bg-blue-500/5 border border-blue-500/20">
              <h4 className="text-sm font-medium text-blue-400 mb-3 flex items-center gap-2">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z" /></svg>
                MediaCrawler 服务配置
              </h4>
              <div className="grid grid-cols-1 gap-3">
                <div>
                  <label className="block text-xs text-gray-400 mb-1">安装路径</label>
                  <input
                    type="text"
                    value={mcPath}
                    onChange={(e) => setMcPath(e.target.value)}
                    placeholder="/opt/MediaCrawler"
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm font-mono focus:outline-none focus:border-blue-500/50"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Python 路径</label>
                  <input
                    type="text"
                    value={mcPythonBin}
                    onChange={(e) => setMcPythonBin(e.target.value)}
                    placeholder="python3"
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm font-mono focus:outline-none focus:border-blue-500/50"
                  />
                </div>
                <div className="flex items-center gap-3 pt-1">
                  <button
                    type="button"
                    onClick={testMediaCrawler}
                    disabled={mcHealthStatus === 'checking'}
                    className="px-3 py-1.5 bg-blue-500/20 border border-blue-500/30 text-blue-400 rounded-lg hover:bg-blue-500/30 disabled:opacity-50 font-mono text-xs"
                  >
                    {mcHealthStatus === 'checking' ? '检查中...' : '检查连接'}
                  </button>
                  {mcHealthStatus !== 'idle' && (
                    <span className={`text-xs font-mono ${mcHealthStatus === 'ok' ? 'text-emerald-400' : mcHealthStatus === 'fail' ? 'text-red-400' : 'text-gray-400'}`}>
                      {mcHealthStatus === 'ok' ? '✅' : mcHealthStatus === 'fail' ? '❌' : ''} {mcHealthDetail}
                    </span>
                  )}
                </div>
              </div>
              <p className="text-[10px] text-gray-600 mt-2 font-mono">
                需要在服务器上安装 MediaCrawler + Python3 + Playwright，详见 docs/mediaCrawler-integration.md
              </p>
            </div>
          )}

          {/* ====== 扫码登录面板 ====== */}
          {queryEngine === 'mediacrawler' && (
            <div className="mt-4 p-4 rounded-xl bg-purple-500/5 border border-purple-500/20">
              <h4 className="text-sm font-medium text-purple-400 mb-3 flex items-center gap-2">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v1m6 11h2m-6 0h-2m0 0a9 9 0 110-18 9 9 0 010 18zm-5.5-3.5l2.5 2.5 5-5" /></svg>
                抖音扫码登录 / Cookie 管理
                {cookieStatus === 'valid' && <span className="ml-auto text-xs bg-emerald-500/20 text-emerald-400 px-2 py-0.5 rounded-full">Cookie 有效</span>}
                {cookieStatus === 'expired' && <span className="ml-auto text-xs bg-red-500/20 text-red-400 px-2 py-0.5 rounded-full">Cookie 过期</span>}
                {cookieStatus === 'missing' && <span className="ml-auto text-xs bg-yellow-500/20 text-yellow-400 px-2 py-0.5 rounded-full">未登录</span>}
              </h4>

              {/* 登录状态显示区 */}
              <div className={`rounded-lg p-3 mb-3 ${loginStatus !== 'idle' ? 'bg-white/5 border border-white/10' : ''}`}>
                {loginStatus === 'idle' ? (
                  <p className="text-xs text-gray-500 font-mono">尚未启动登录流程。点击下方按钮在服务器端启动抖音浏览器进行扫码。</p>
                ) : loginStatus === 'waiting_scan' || loginStatus === 'starting' || loginStatus === 'scanned' || loginStatus === 'confirmed' ? (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <div className={`w-2 h-2 rounded-full animate-pulse ${
                        loginStatus === 'waiting_scan' ? 'bg-blue-400' : loginStatus === 'scanned' ? 'bg-yellow-400' : 'bg-green-400'
                      }`} />
                      <span className="text-xs text-gray-300 font-mono">{loginMessage}</span>
                      <span className="text-[10px] text-gray-600 ml-auto font-mono">{Math.floor(loginElapsed / 60)}:{String(loginElapsed % 60).padStart(2, '0')}</span>
                    </div>
                    <p className="text-[10px] text-gray-600 font-mono">
                      {loginStatus === 'waiting_scan'
                        ? '📱 请使用抖音 APP 扫描服务器桌面弹出的二维码（需 VNC/X11 远程查看或已配置 Xvfb 虚拟显示器）'
                        : loginStatus === 'scanned'
                          ? '✅ 已扫描，请在手机上确认登录...'
                          : '⏳ 正在处理...'}
                    </p>
                  </div>
                ) : loginStatus === 'success' ? (
                  <div className="flex items-center gap-2 text-emerald-400">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                    <span className="text-xs font-mono">{loginMessage}</span>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 text-red-400">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                    <span className="text-xs font-mono">{loginMessage}</span>
                  </div>
                )}
              </div>

              {/* 操作按钮行 */}
              <div className="flex items-center gap-2 flex-wrap">
                {(loginStatus === 'idle' || loginStatus === 'error' || loginStatus === 'timeout' || loginStatus === 'killed') && (
                  <button onClick={startLogin}
                    className="px-3 py-1.5 bg-purple-500/20 border border-purple-500/30 text-purple-400 rounded-lg hover:bg-purple-500/30 text-xs font-mono flex items-center gap-1.5">
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v1m6 11h2m-6 0h-2m0 0a9 9 0 110-18 9 9 0 010 18z" /></svg>
                    启动扫码登录
                  </button>
                )}
                {(loginStatus === 'starting' || loginStatus === 'waiting_scan') && (
                  <button onClick={cancelLogin}
                    className="px-3 py-1.5 bg-red-500/20 border border-red-500/30 text-red-400 rounded-lg hover:bg-red-500/30 text-xs font-mono">
                    取消
                  </button>
                )}
                <button onClick={validateCookies}
                  disabled={cookieStatus === 'loading'}
                  className="px-3 py-1.5 bg-cyan-500/20 border border-cyan-500/30 text-cyan-400 rounded-lg hover:bg-cyan-500/30 disabled:opacity-50 text-xs font-mono">
                  验证 Cookie
                </button>
                <button onClick={clearCookies}
                  className="px-3 py-1.5 bg-orange-500/20 border border-orange-500/30 text-orange-400 rounded-lg hover:bg-orange-500/30 text-xs font-mono">
                  清除 Cookie
                </button>
              </div>

              {/* Cookie 文件列表 */}
              {cookieFiles.length > 0 && (
                <div className="mt-3 max-h-32 overflow-y-auto space-y-1">
                  {cookieFiles.map((f, i) => (
                    <div key={i} className="flex items-center justify-between text-[10px] font-mono bg-black/20 rounded px-2 py-1">
                      <span className="text-gray-400 truncate flex-1 mr-2" title={f.name}>{f.name}</span>
                      <span className="text-gray-600 whitespace-nowrap">{(f.size / 1024).toFixed(1)} KB</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ====== IP 代理池管理 ====== */}
          {queryEngine === 'mediacrawler' && (
            <div className="mt-4 p-4 rounded-xl bg-emerald-500/5 border border-emerald-500/20">
              <h4 className="text-sm font-medium text-emerald-400 mb-3 flex items-center justify-between">
                <span className="flex items-center gap-2">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" /></svg>
                  IP 代理池
                </span>
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input type="checkbox" checked={proxyGlobalEnabled} onChange={e => toggleProxyGlobal(e.target.checked)}
                    className="w-3.5 h-3.5 rounded bg-white/10 border-white/20 text-emerald-500 focus:ring-emerald-500/50" />
                  <span className="text-[10px] text-gray-400">全局启用</span>
                </label>
              </h4>

              {/* 统计概览 */}
              {proxyStats && (
                <div className="grid grid-cols-5 gap-2 mb-3">
                  {[
                    ['total', '总计', proxyStats.total, 'gray'],
                    ['enabled', '启用', proxyStats.enabled, 'blue'],
                    ['ok', '可用', proxyStats.ok, 'emerald'],
                    ['fail', '失败', proxyStats.fail, 'red'],
                    ['untested', '未测', proxyStats.untested, 'yellow'],
                  ].map(([key, label, val, color]) => (
                    <div key={key} className={`bg-${color}-500/10 rounded-lg p-2 text-center`}>
                      <div className={`text-${color}-400 text-sm font-bold font-mono`}>{val ?? 0}</div>
                      <div className="text-[9px] text-gray-500 font-mono">{label}</div>
                    </div>
                  ))}
                </div>
              )}

              {/* 代理列表 */}
              <div className="space-y-1.5 max-h-48 overflow-y-auto mb-3">
                {proxies.length === 0 ? (
                  <p className="text-xs text-gray-600 text-center py-4 font-mono">暂无代理节点</p>
                ) : proxies.map((px) => (
                  <div key={px.id} className={`flex items-center justify-between px-3 py-2 rounded-lg border text-xs font-mono group ${px.enabled ? 'bg-white/5 border-white/10' : 'bg-black/10 border-white/5 opacity-60'}`}>
                    <div className="flex items-center gap-2 min-w-0">
                      <span className={`w-2 h-2 rounded-full shrink-0 ${
                        px.testStatus === 'ok' ? 'bg-emerald-400' :
                        px.testStatus === 'slow' ? 'bg-yellow-400' :
                        px.testStatus === 'fail' ? 'bg-red-400' : 'bg-gray-600'
                      }`} />
                      <span className="text-gray-300 truncate">{px.label || `${px.host}:${px.port}`}</span>
                      <span className="text-[9px] text-gray-600 uppercase shrink-0">{px.protocol}</span>
                      {px.region && <span className="text-[9px] bg-white/10 px-1 rounded text-gray-500 shrink-0">{px.region}</span>}
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                      {px.testLatencyMs != null && <span className={`text-[9px] ${px.testLatencyMs < 2000 ? 'text-emerald-400' : 'text-yellow-400'}`}>{px.testLatencyMs}ms</span>}
                      <button onClick={() => testSingleProxy(px.id)} className="p-1 hover:text-cyan-400 text-gray-500" title="测试">↻</button>
                      <button onClick={() => deleteProxy(px.id)} className="p-1 hover:text-red-400 text-gray-500" title="删除">×</button>
                    </div>
                  </div>
                ))}
              </div>

              {/* 操作栏 */}
              <div className="flex items-center gap-2 flex-wrap pt-2 border-t border-white/5">
                {!showAddProxy ? (
                  <button onClick={() => setShowAddProxy(true)}
                    className="px-3 py-1.5 bg-emerald-500/20 border border-emerald-500/30 text-emerald-400 rounded-lg hover:bg-emerald-500/30 text-xs font-mono">
                    + 添加代理
                  </button>
                ) : (
                  <div className="flex items-end gap-2 flex-wrap p-2 bg-black/20 rounded-lg w-full">
                    <input placeholder="IP 地址" value={newProxy.host} onChange={e => setNewProxy(p => ({ ...p, host: e.target.value }))}
                      className="bg-white/5 border border-white/10 rounded px-2 py-1.5 text-white text-xs font-mono w-28" />
                    <input placeholder="端口" value={newProxy.port} onChange={e => setNewProxy(p => ({ ...p, port: e.target.value }))}
                      className="bg-white/5 border border-white/10 rounded px-2 py-1.5 text-white text-xs font-mono w-16" />
                    <select value={newProxy.protocol} onChange={e => setNewProxy(p => ({ ...p, protocol: e.target.value }))}
                      className="bg-white/5 border border-white/10 rounded px-2 py-1.5 text-white text-xs font-mono w-16">
                      <option value="http">HTTP</option>
                      <option value="https">HTTPS</option>
                      <option value="socks5">SOCKS5</option>
                    </select>
                    <input placeholder="用户名(可选)" value={newProxy.username} onChange={e => setNewProxy(p => ({ ...p, username: e.target.value }))}
                      className="bg-white/5 border border-white/10 rounded px-2 py-1.5 text-white text-xs font-mono w-24" />
                    <input placeholder="密码(可选)" type="password" value={newProxy.password} onChange={e => setNewProxy(p => ({ ...p, password: e.target.value }))}
                      className="bg-white/5 border border-white/10 rounded px-2 py-1.5 text-white text-xs font-mono w-24" />
                    <input placeholder="标签" value={newProxy.label} onChange={e => setNewProxy(p => ({ ...p, label: e.target.value }))}
                      className="bg-white/5 border border-white/10 rounded px-2 py-1.5 text-white text-xs font-mono w-20" />
                    <input placeholder="地区(CN/US)" value={newProxy.region} onChange={e => setNewProxy(p => ({ ...p, region: e.target.value }))}
                      className="bg-white/5 border border-white/10 rounded px-2 py-1.5 text-white text-xs font-mono w-16" />
                    <button onClick={addProxy} disabled={!newProxy.host || !newProxy.port}
                      className="px-2.5 py-1.5 bg-emerald-500 text-white rounded-lg hover:bg-emerald-600 disabled:opacity-50 text-xs font-mono">确认</button>
                    <button onClick={() => setShowAddProxy(false)} className="px-2.5 py-1.5 text-gray-500 hover:text-white text-xs">取消</button>
                  </div>
                )}
                <button onClick={testAllProxies} disabled={proxies.length === 0}
                  className="px-3 py-1.5 bg-cyan-500/20 border border-cyan-500/30 text-cyan-400 rounded-lg hover:bg-cyan-500/30 disabled:opacity-50 text-xs font-mono ml-auto">
                  测试全部
                </button>
              </div>

              <p className="text-[10px] text-gray-600 mt-2 font-mono">
                代理池数据存储于 .proxy-pool.json，支持 HTTP/HTTPS/SOCKS5 协议轮换
              </p>
            </div>
          )}

          {/* 动作执行引擎（Write Engine） */}
          <div className="mt-6 pt-6 border-t border-white/10">
            <h3 className="text-white font-bold mb-2"><span className="text-emerald-400">//</span> 动作执行引擎（WRITE）</h3>
            <p className="text-gray-400 text-xs mb-4">用于点赞、评论、发布视频等写操作</p>
            <div>
              <label className="block text-label mb-2">
                <span>ACTION_ENGINE</span>
                <StatusDot name="actionEngine" />
              </label>
              <select
                value={actionEngine}
                onChange={(e) => setActionEngine(e.target.value)}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-emerald-500/50 font-mono"
              >
                <option value="q1-adb" className="bg-gray-900">Q1 ADB 自动化（推荐）</option>
                <option value="fingerprint" className="bg-gray-900">指纹浏览器</option>
                <option value="q1-adb" className="bg-gray-900">Q1 ADB 自动化</option>
              </select>
              <p className="text-xs text-gray-500 mt-2 font-mono">
                ⚠️ 写入操作会影响账号，请谨慎选择
              </p>
            </div>
          </div>
        </div>

        {/* 保存按钮 */}
        <div className="flex justify-end mt-6">
          <button
            onClick={saveAllSettings}
            className="px-6 py-3 bg-emerald-500 text-white rounded-xl hover:bg-emerald-600 transition-colors font-mono"
          >
            保存所有配置
          </button>
        </div>
      </div>
    </div>
  );
}
