'use client';
import { useState, useEffect } from 'react';

interface KnowledgeBase {
  content: string;
  updatedAt: string;
}

export default function SettingsPage() {
  const [knowledgeBase, setKnowledgeBase] = useState<KnowledgeBase>({
    content: '',
    updatedAt: '',
  });
  const [saveMessage, setSaveMessage] = useState('');

  // API Key 配置状态
  const [deepseekKey, setDeepseekKey] = useState('');
  const [dashscopeKey, setDashscopeKey] = useState('');
  const [showDeepseekKey, setShowDeepseekKey] = useState(false);
  const [showDashscopeKey, setShowDashscopeKey] = useState(false);
  const [testingDeepseek, setTestingDeepseek] = useState(false);
  const [testingDashscope, setTestingDashscope] = useState(false);
  const [testResult, setTestResult] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  useEffect(() => {
    loadSettings();
    loadApiKeyStatus();
  }, []);

  const loadSettings = async () => {
    try {
      const response = await fetch('/api/config', { credentials: 'include' });
      const result = await response.json();
      if (result.success && result.data) {
        setKnowledgeBase(result.data.knowledgeBase || { content: '', updatedAt: '' });
      }
    } catch (error) {
      console.error('加载配置失败:', error);
      const savedKnowledge = localStorage.getItem('knowledgeBase');
      setKnowledgeBase(savedKnowledge ? JSON.parse(savedKnowledge) : { content: '', updatedAt: '' });
    }
  };

  const loadApiKeyStatus = async () => {
    try {
      const response = await fetch('/api/admin/config', { credentials: 'include' });
      const result = await response.json();
      if (result.success) {
        // 只显示是否已配置，不显示实际 Key
        setDeepseekKey(result.data.deepseekConfigured ? '********' : '');
        setDashscopeKey(result.data.dashscopeConfigured ? '********' : '');
      }
    } catch (error) {
      console.error('加载 API Key 状态失败:', error);
    }
  };

  const saveAllSettings = async () => {
    try {
      const response = await fetch('/api/config', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          providers: [],
          defaultProvider: '',
          knowledgeBase
        }),
      });
      const result = await response.json();
      if (result.success) {
        setSaveMessage(result.message);
        localStorage.setItem('knowledgeBase', JSON.stringify(knowledgeBase));
        await loadSettings();
      } else {
        setSaveMessage('保存失败: ' + result.message);
      }
    } catch (error) {
      console.error('保存配置失败:', error);
      setSaveMessage('保存失败，请检查网络连接');
    }
    setTimeout(() => setSaveMessage(''), 3000);
  };

  const saveKnowledgeBase = () => {
    const updatedKnowledge: KnowledgeBase = {
      content: knowledgeBase.content,
      updatedAt: new Date().toISOString(),
    };
    setKnowledgeBase(updatedKnowledge);
    saveAllSettings();
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
      setTestResult({
        type: 'error',
        message: '测试请求失败'
      });
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
      setTestResult({
        type: 'error',
        message: '测试请求失败'
      });
    } finally {
      setTestingDashscope(false);
    }
  };

  // 保存 API Keys
  const saveApiKeys = async () => {
    try {
      // 如果 Key 是显示的掩码（********），则不保存
      const actualDeepseekKey = deepseekKey === '********' ? undefined : deepseekKey;
      const actualDashscopeKey = dashscopeKey === '********' ? undefined : dashscopeKey;

      // 如果两个 Key 都没有实际值，提示用户
      if ((!actualDeepseekKey || actualDeepseekKey === '') && (!actualDashscopeKey || actualDashscopeKey === '')) {
        setTestResult({ type: 'error', message: '请至少配置一个 API Key' });
        return;
      }

      const response = await fetch('/api/admin/config', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deepseekKey: actualDeepseekKey || undefined,
          dashscopeKey: actualDashscopeKey || undefined
        })
      });

      const result = await response.json();
      setTestResult({
        type: result.success ? 'success' : 'error',
        message: result.message
      });

      if (result.success) {
        // 重新加载状态
        await loadApiKeyStatus();
      }
    } catch (error) {
      setTestResult({ type: 'error', message: '保存失败，请重试' });
    }
  };

  const formatDate = (dateStr: string): string => {
    if (!dateStr) return '从未更新';
    const date = new Date(dateStr);
    return date.toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
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
            <div className="px-4 py-2 bg-emerald-500/20 text-emerald-400 rounded-xl text-sm font-mono">
              {saveMessage}
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
                <h3 className="font-medium text-white font-mono">API KEY 配置 / API KEY CONFIG</h3>
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
                    {testingDeepseek ? (
                      <span className="flex items-center gap-2">
                        <svg className="w-4 h-4 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                        </svg>
                        测试中...
                      </span>
                    ) : '测试连接'}
                  </button>
                </div>
                <p className="text-xs text-gray-500 mt-2 font-mono">
                  DeepSeek API Key，用于 AI 文案生成等功能
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
                    {testingDashscope ? (
                      <span className="flex items-center gap-2">
                        <svg className="w-4 h-4 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                        </svg>
                        测试中...
                      </span>
                    ) : '测试连接'}
                  </button>
                </div>
                <p className="text-xs text-gray-500 mt-2 font-mono">
                  阿里云百炼 API Key，用于语音识别、文生视频、数字人等功能
                </p>
              </div>

              {/* 保存按钮 */}
              <div className="pt-4 border-t border-white/10">
                <button
                  onClick={saveApiKeys}
                  className="px-6 py-3 bg-emerald-500 text-white rounded-xl hover:bg-emerald-600 transition-colors font-mono"
                >
                  保存 API Key
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* 知识库配置区域 */}
        <div className="bg-white/5 backdrop-blur-sm rounded-2xl border border-white/10">
          <div className="p-6">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="font-medium text-white font-mono">知识库 / KNOWLEDGE BASE</h3>
                <span className="text-sm text-gray-500 font-mono">
                  最后更新: {formatDate(knowledgeBase.updatedAt)}
                </span>
              </div>
              <div>
                <textarea
                  value={knowledgeBase.content}
                  onChange={(e) => setKnowledgeBase({ ...knowledgeBase, content: e.target.value })}
                  placeholder="企业话术、产品介绍、FAQ..."
                  className="w-full h-64 bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-emerald-500/50 resize-none font-mono"
                />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-500 font-mono">
                  {knowledgeBase.content.length} 字符
                </span>
                <button
                  onClick={saveKnowledgeBase}
                  className="px-4 py-2 bg-emerald-500 text-white rounded-xl hover:bg-emerald-600 transition-colors font-mono"
                >
                  保存知识库
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
