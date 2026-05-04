'use client';
import { useState, useEffect } from 'react';

export default function SettingsPage() {
  // API Key 配置状态
  const [deepseekKey, setDeepseekKey] = useState('');
  const [dashscopeKey, setDashscopeKey] = useState('');
  const [siliconflowKey, setSiliconflowKey] = useState('');
  const [showDeepseekKey, setShowDeepseekKey] = useState(false);
  const [showDashscopeKey, setShowDashscopeKey] = useState(false);
  const [showSiliconflowKey, setShowSiliconflowKey] = useState(false);
  const [testingDeepseek, setTestingDeepseek] = useState(false);
  const [testingDashscope, setTestingDashscope] = useState(false);
  const [testingSiliconflow, setTestingSiliconflow] = useState(false);
  const [testResult, setTestResult] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // OSS 配置状态
  const [ossRegion, setOssRegion] = useState('');
  const [ossAccessKeyId, setOssAccessKeyId] = useState('');
  const [ossAccessKeySecret, setOssAccessKeySecret] = useState('');
  const [ossBucket, setOssBucket] = useState('');
  const [showOssSecret, setShowOssSecret] = useState(false);
  const [testingOSS, setTestingOSS] = useState(false);
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
        setDeepseekKey(result.data.deepseekConfigured ? '********' : '');
        setDashscopeKey(result.data.dashscopeConfigured ? '********' : '');
        setSiliconflowKey(result.data.siliconflowConfigured ? '********' : '');
        setOssRegion(result.data.ossConfigured ? '********' : '');
        setOssBucket(result.data.ossConfigured ? '********' : '');
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
      setTestResult({
        type: result.valid ? 'success' : 'error',
        message: result.message
      });
    } catch (error) {
      setTestResult({ type: 'error', message: '测试请求失败' });
    } finally {
      setTestingDeepseek(false);
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
      setTestResult({
        type: result.valid ? 'success' : 'error',
        message: result.message
      });
    } catch (error) {
      setTestResult({ type: 'error', message: '测试请求失败' });
    } finally {
      setTestingDashscope(false);
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
      setTestResult({
        type: result.valid ? 'success' : 'error',
        message: result.message
      });
    } catch (error) {
      setTestResult({ type: 'error', message: '测试请求失败' });
    } finally {
      setTestingOSS(false);
    }
  };

  // 保存所有配置
  const saveAllSettings = async () => {
    try {
      const actualDeepseekKey = deepseekKey === '********' ? undefined : deepseekKey;
      const actualDashscopeKey = dashscopeKey === '********' ? undefined : dashscopeKey;
      const actualSiliconflowKey = siliconflowKey === '********' ? undefined : siliconflowKey;
      const actualOssAccessKeyId = ossAccessKeyId === '********' ? undefined : ossAccessKeyId;
      const actualOssAccessKeySecret = ossAccessKeySecret === '********' ? undefined : ossAccessKeySecret;

      const response = await fetch('/api/admin/config', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deepseekKey: actualDeepseekKey || undefined,
          dashscopeKey: actualDashscopeKey || undefined,
          siliconflowKey: actualSiliconflowKey || undefined,
          ossRegion: ossRegion || undefined,
          ossAccessKeyId: actualOssAccessKeyId || undefined,
          ossAccessKeySecret: actualOssAccessKeySecret || undefined,
          ossBucket: ossBucket || undefined
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
              <div>
                <label className="block text-label mb-2">
                  <span>阿里云百炼 API Key</span>
                  <span className="opacity-50 ml-1">DASHSCOPE</span>
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
                    <button
                      type="button"
                      onClick={() => setShowDashscopeKey(!showDashscopeKey)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white"
                    >
                      {showDashscopeKey ? (
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
                    onClick={testDashscopeKey}
                    disabled={testingDashscope || !dashscopeKey || dashscopeKey === '********'}
                    className="px-4 py-3 bg-blue-500/20 border border-blue-500/30 text-blue-400 rounded-xl hover:bg-blue-500/30 disabled:opacity-50 disabled:cursor-not-allowed font-mono text-sm whitespace-nowrap"
                  >
                    {testingDashscope ? '测试中...' : '测试连接'}
                  </button>
                </div>
                <p className="text-xs text-gray-500 mt-2 font-mono">
                  阿里云百炼 API Key，用于文生视频、数字人等功能
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* OSS 配置区域 */}
        <div className="bg-white/5 backdrop-blur-sm rounded-2xl border border-white/10 mb-6">
          <div className="p-6">
            <div className="flex items-center justify-between mb-6">
              <div>
                <h3 className="font-medium text-white font-mono">阿里云 OSS 配置</h3>
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

        {/* 保存按钮 */}
        <div className="flex justify-end">
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
