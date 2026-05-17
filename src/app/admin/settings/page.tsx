'use client';
import { useState, useEffect } from 'react';

export default function SettingsPage() {
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
  const [justoneToken, setJustoneToken] = useState('');
  const [showJustoneToken, setShowJustoneToken] = useState(false);
  const [automationEngine, setAutomationEngine] = useState('justoneapi');
  const [saveMessage, setSaveMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    loadApiKeyStatus();
    loadOSSStatus();
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
        setJustoneToken(d.justoneConfigured ? '********' : '');
        setAutomationEngine(d.automationEngine || 'justoneapi');
        setOssRegion(d.ossConfigured ? '********' : '');
        setOssBucket(d.ossConfigured ? '********' : '');
        // 已配置即显示 🟢已连接，测试失败才变 🔴
        setTtsAppId(d.ttsAppIdConfigured ? '********' : '')
        setTtsAccessKey(d.ttsAccessKeyConfigured ? '********' : '')
        setTtsResourceId(d.ttsResourceIdConfigured ? '********' : '')
        setStatusMap({
          deepseek: d.deepseekConfigured ? 'ok' : null,
          siliconflow: d.siliconflowConfigured ? 'ok' : null,
          dashscope: d.dashscopeConfigured ? 'ok' : null,
          volcano: d.volcanoConfigured ? 'ok' : null,
          justone: d.justoneConfigured ? 'ok' : null,
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
      const actualJustoneToken = justoneToken === '********' ? undefined : justoneToken;

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
          justoneToken: actualJustoneToken || undefined,
          automationEngine: automationEngine || undefined,
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
          <h3 className="text-white font-bold mb-2"><span className="text-blue-400">//</span> 自动化引擎</h3>
          <p className="text-gray-400 text-xs mb-4">选择自动化操作使用的引擎，写入操作（点赞/评论/发布）走 Q1 ADB，justoneapi 用于数据查询</p>

          {/* justoneapi Token */}
          <div className="mb-4">
            <label className="text-gray-400 text-xs mb-1 block">JUSTONEAPI_TOKEN</label>
            <div className="relative">
              <input
                type={showJustoneToken ? 'text' : 'password'}
                value={justoneToken}
                onChange={(e) => setJustoneToken(e.target.value)}
                placeholder="输入 justoneapi Token 或留空"
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-emerald-500/50 font-mono pr-10"
              />
              <button type="button" onClick={() => setShowJustoneToken(!showJustoneToken)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white">
                {showJustoneToken ? (
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" /></svg>
                ) : (
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
                )}
              </button>
            </div>
            <StatusDot name="justone" />
          </div>

          {/* 引擎选择 */}
          <div>
            <label className="text-gray-400 text-xs mb-1 block">AUTOMATION_ENGINE</label>
            <select
              value={automationEngine}
              onChange={(e) => setAutomationEngine(e.target.value)}
              className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-emerald-500/50"
            >
              <option value="justoneapi" className="bg-gray-900">justoneapi（优先）</option>
              <option value="justoneapi,q1-coordinates" className="bg-gray-900">justoneapi + Q1 降级</option>
              <option value="q1-coordinates" className="bg-gray-900">Q1 截图+坐标</option>
              <option value="tiktokdownloader" className="bg-gray-900">TikTokDownloader</option>
            </select>
            <p className="text-gray-500 text-xs mt-1">多个引擎用逗号分隔，按优先级依次尝试</p>
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
