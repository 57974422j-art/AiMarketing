'use client'

import StatusDot from './StatusDot'
import type {
  StatusMap, TestResult,
  OSSConfig, TTSConfig, TTSVisibility
} from '../types'

interface ApiKeyPanelProps {
  // API Keys
  deepseekKey: string
  volcanoKey: string
  siliconflowKey: string
  dashscopeKey: string
  minimaxKey: string  // 2026-08-14 Minimax AI 音乐
  showDeepseekKey: boolean
  showVolcanoKey: boolean
  showSiliconflowKey: boolean
  showDashscopeKey: boolean
  showMinimaxKey: boolean
  testingMinimax: boolean
  testingDeepseek: boolean
  testingVolcano: boolean
  testingSiliconflow: boolean
  testingDashscope: boolean
  testResult: TestResult | null
  statusMap: StatusMap
  // TTS
  ttsAppId: string
  ttsAccessKey: string
  ttsResourceId: string
  volcAsrApiKey: string
  volcAsrAppKey: string
  volcAsrAccessKey: string
  volcAsrResourceId: string
  showTtsAppId: boolean
  showTtsAccessKey: boolean
  showTtsResourceId: boolean
  testingTTS: boolean
  // OSS
  ossRegion: string
  ossAccessKeyId: string
  ossAccessKeySecret: string
  ossBucket: string
  showOssSecret: boolean
  testingOSS: boolean
  // Setters (batched as object for clarity)
  setters: {
    setDeepseekKey: (v: string) => void
    setVolcanoKey: (v: string) => void
    setSiliconflowKey: (v: string) => void
    setDashscopeKey: (v: string) => void
    setShowDeepseekKey: (v: boolean) => void
    setShowVolcanoKey: (v: boolean) => void
    setShowSiliconflowKey: (v: boolean) => void
    setShowDashscopeKey: (v: boolean) => void
    setTestingDeepseek: (v: boolean) => void
    setTestingVolcano: (v: boolean) => void
    setTestingSiliconflow: (v: boolean) => void
    setTestingDashscope: (v: boolean) => void
    setTestResult: (r: TestResult | null) => void
    setStatusMap: (s: StatusMap | ((prev: StatusMap) => StatusMap)) => void
    setTtsAppId: (v: string) => void
    setTtsAccessKey: (v: string) => void
    setTtsResourceId: (v: string) => void
    setVolcAsrApiKey: (v: string) => void
    setVolcAsrAppKey: (v: string) => void
    setVolcAsrAccessKey: (v: string) => void
    setVolcAsrResourceId: (v: string) => void
    setShowTtsAppId: (v: boolean) => void
    setShowTtsAccessKey: (v: boolean) => void
    setShowTtsResourceId: (v: boolean) => void
    setTestingTTS: (v: boolean) => void
    setOssRegion: (v: string) => void
    setOssAccessKeyId: (v: string) => void
    setOssAccessKeySecret: (v: string) => void
    setOssBucket: (v: string) => void
    setShowOssSecret: (v: boolean) => void
    setTestingOSS: (v: boolean) => void
  }
}

/** 密码输入框内的显示/隐藏按钮 */
function EyeButton({ show, onToggle }: { show: boolean; onToggle: () => void }) {
  return (
    <button type="button" onClick={onToggle} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white">
      {show ? (
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
  )
}

export default function ApiKeyPanel({
  deepseekKey, volcanoKey, siliconflowKey, dashscopeKey, minimaxKey,
  showDeepseekKey, showVolcanoKey, showSiliconflowKey, showDashscopeKey, showMinimaxKey,
  testingDeepseek, testingVolcano, testingSiliconflow, testingDashscope, testingMinimax,
  testResult, statusMap,
  ttsAppId, ttsAccessKey, ttsResourceId,
  volcAsrApiKey, volcAsrAppKey, volcAsrAccessKey, volcAsrResourceId,
  showTtsAppId, showTtsAccessKey, showTtsResourceId, testingTTS,
  ossRegion, ossAccessKeyId, ossAccessKeySecret, ossBucket,
  showOssSecret, testingOSS,
  setters: s,
}: ApiKeyPanelProps) {

  // ---- 测试 API Key ----
  const testKey = async (provider: string, key: string, label: string) => {
    if (!key || key === '********') {
      s.setTestResult({ type: 'error', message: `请输入有效的 ${label}` })
      return
    }
    const setLoading = provider === 'deepseek' ? s.setTestingDeepseek
      : provider === 'volcano' ? s.setTestingVolcano
      : provider === 'siliconflow' ? s.setTestingSiliconflow
      : s.setTestingDashscope
    setLoading(true)
    s.setTestResult(null)

    try {
      if (provider === 'siliconflow') {
        // 硅基流动直接调其 API 验证
        const res = await fetch('https://api.siliconflow.cn/v1/models', {
          headers: { Authorization: `Bearer ${key}` }
        })
        if (res.ok) {
          s.setTestResult({ type: 'success', message: '硅基流动 API Key 有效' })
        } else {
          const err = await res.json().catch(() => ({}))
          s.setTestResult({ type: 'error', message: err.error?.message || 'API Key 无效' })
        }
      } else {
        const res = await fetch('/api/admin/test-key', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ provider, key }),
        })
        const result = await res.json()
        s.setTestResult({ type: result.valid ? 'success' : 'error', message: result.message })
        s.setStatusMap(prev => ({ ...prev, [provider]: result.valid ? 'ok' : 'fail' }))
      }
    } catch {
      s.setTestResult({ type: 'error', message: '测试请求失败' })
      if (provider !== 'siliconflow') s.setStatusMap(prev => ({ ...prev, [provider]: 'fail' }))
    } finally {
      setLoading(false)
    }
  }

  // ---- 测试 OSS ----
  const testOSS = async () => {
    if (!ossRegion || !ossAccessKeyId || !ossAccessKeySecret || !ossBucket) {
      s.setTestResult({ type: 'error', message: '请填写完整的 OSS 配置' }); return
    }
    s.setTestingOSS(true); s.setTestResult(null)
    try {
      const res = await fetch('/api/admin/test-key', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: 'oss', region: ossRegion,
          accessKeyId: ossAccessKeyId, accessKeySecret: ossAccessKeySecret, bucket: ossBucket
        }),
      })
      const result = await res.json()
      s.setTestResult({ type: result.valid ? 'success' : 'error', message: result.message })
      s.setStatusMap(prev => ({ ...prev, oss: result.valid ? 'ok' : 'fail' }))
    } catch {
      s.setTestResult({ type: 'error', message: '测试请求失败' })
      s.setStatusMap(prev => ({ ...prev, oss: 'fail' }))
    } finally {
      s.setTestingOSS(false)
    }
  }

  // ---- 通用密码输入行（API Key） ----
  function KeyInputRow({
    label, sub, name, value, show, onShowChange,
    testing, onTest, placeholder = 'sk-xxxxxxxxxxxxxxxxxxxxxxxx',
    hint,
  }: {
    label: string; sub: string; name: string; value: string;
    show: boolean; onShowChange: () => void; testing: boolean; onTest: () => void;
    placeholder?: string; hint?: string;
  }) {
    return (
      <div>
        <label className="block text-label mb-2">
          <span>{label}</span>
          <span className="opacity-50 ml-1">{sub}</span>
          <StatusDot name={name} statusMap={statusMap} />
        </label>
        <div className="flex gap-3">
          <div className="flex-1 relative">
            <input type={show ? 'text' : 'password'} value={value}
              onChange={e => {
                if (name === 'deepseek') s.setDeepseekKey(e.target.value)
                else if (name === 'volcano') s.setVolcanoKey(e.target.value)
                else if (name === 'siliconflow') s.setSiliconflowKey(e.target.value)
                else if (name === 'dashscope') s.setDashscopeKey(e.target.value)
                else if (name === 'minimax') s.setMinimaxKey(e.target.value)
              }}
              placeholder={placeholder}
              className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-emerald-500/50 font-mono pr-20" />
            <EyeButton show={show} onToggle={onShowChange} />
          </div>
          <button type="button" onClick={onTest}
            disabled={testing || !value || value === '********'}
            className="px-4 py-3 bg-blue-500/20 border border-blue-500/30 text-blue-400 rounded-xl hover:bg-blue-500/30 disabled:opacity-50 disabled:cursor-not-allowed font-mono text-sm whitespace-nowrap">
            {testing ? '测试中...' : '测试连接'}
          </button>
        </div>
        {hint && <p className="text-xs text-gray-500 mt-2 font-mono">{hint}</p>}
      </div>
    )
  }

  return (
    <div>
      {/* ====== API KEY 配置面板 ====== */}
      <div className="bg-white/5 backdrop-blur-sm rounded-2xl border border-white/10 mb-6">
        <div className="p-6">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h3 className="font-medium text-white font-mono">API KEY 配置</h3>
              <p className="text-sm text-gray-500 mt-1">配置全局 API Key，所有 AI 功能将使用此处设置的 Key</p>
            </div>
          </div>

          <div className="space-y-6">
            {/* DeepSeek */}
            <KeyInputRow label="DeepSeek API Key" sub="深度求索" name="deepseek"
              value={deepseekKey} show={showDeepseekKey} onShowChange={() => s.setShowDeepseekKey(!showDeepseekKey)}
              testing={testingDeepseek} onTest={() => testKey('deepseek', deepseekKey, 'DeepSeek API Key')}
              hint="DeepSeek API Key，用于 AI 文案生成等功能" />

            {/* SiliconFlow */}
            <KeyInputRow label="硅基流动 API Key" sub="硅基流动" name="siliconflow"
              value={siliconflowKey} show={showSiliconflowKey} onShowChange={() => s.setShowSiliconflowKey(!showSiliconflowKey)}
              testing={testingSiliconflow} onTest={() => testKey('siliconflow', siliconflowKey, '硅基流动 API Key')}
              hint="硅基流动 API Key，用于语音识别（Whisper/SenseVoice）等功能" />

            {/* DashScope */}
            <div className="mt-6 pt-6 border-t border-white/10">
              <h4 className="text-label mb-4 flex items-center gap-2">
                <svg className="w-5 h-5 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" /></svg>
                阿里云百炼（DashScope）配置
              </h4>
              <p className="text-sm text-gray-500 mb-4 font-mono">用于语音识别（Paraformer 文件转写），需先在百炼控制台开通 Paraformer 模型</p>

              <KeyInputRow label="百炼 API Key" sub="阿里云百炼" name="dashscope"
                value={dashscopeKey} show={showDashscopeKey} onShowChange={() => s.setShowDashscopeKey(!showDashscopeKey)}
                testing={testingDashscope} onTest={() => testKey('dashscope', dashscopeKey, '阿里云百炼 API Key')} />
            </div>

            {/* Minimax（AI 音乐/BGM，2026-08-14） */}
            <div className="mt-6 pt-6 border-t border-white/10">
              <h4 className="text-label mb-4 flex items-center gap-2">
                🎵 AI 音乐（Minimax）配置
              </h4>
              <p className="text-sm text-gray-500 mb-4 font-mono">用于一键成片 BGM/AI 音乐生成（music-3.0）。key 有效即可用，按量计费。</p>
              <KeyInputRow label="Minimax API Key" sub="Minimax" name="minimax"
                value={minimaxKey} show={showMinimaxKey} onShowChange={() => s.setShowMinimaxKey(!showMinimaxKey)}
                testing={testingMinimax} onTest={() => testKey('minimax', minimaxKey, 'Minimax API Key')}
                hint="minimaxi.com 控制台获取" />
            </div>

            {/* Volcano */}
            <KeyInputRow label="火山方舟 API Key" sub="火山引擎" name="volcano"
              value={volcanoKey} show={showVolcanoKey} onShowChange={() => s.setShowVolcanoKey(!showVolcanoKey)}
              testing={testingVolcano} onTest={() => testKey('volcano', volcanoKey, '火山方舟 API Key')}
              hint="火山方舟 API Key，用于文案生成、翻译、配音等功能" />

            {/* 火山 ASR（语音识别）配置（2026-08-05：需在火山引擎控制台单独开通语音识别产品） */}
            <div className="mt-6 pt-6 border-t border-white/10">
              <h4 className="text-label mb-4 flex items-center gap-2">
                <svg className="w-5 h-5 text-cyan-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z" /></svg>
                火山引擎 ASR（语音识别）配置
              </h4>
              <p className="text-sm text-gray-500 mb-4 font-mono">用于 Agent 语音输入转文字。需在火山引擎控制台单独开通「语音识别」产品（与 TTS 是两个独立产品）。两种鉴权方式任选其一：① API Key + 资源ID（新式）② App Key + Access Key + 资源ID（旧式）。资源ID示例 volc.seedasr.sauc.duration</p>
              <div className="grid grid-cols-1 gap-4">
                <div>
                  <label className="block text-label mb-2">API Key（可选）</label>
                  <input type="password" value={volcAsrApiKey} onChange={e => s.setVolcAsrApiKey(e.target.value)} placeholder="X-Api-Key（新式鉴权）"
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-cyan-500/50 font-mono" />
                </div>
                <div>
                  <label className="block text-label mb-2">App Key（可选）</label>
                  <input type="password" value={volcAsrAppKey} onChange={e => s.setVolcAsrAppKey(e.target.value)} placeholder="旧式鉴权 App Key"
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-cyan-500/50 font-mono" />
                </div>
                <div>
                  <label className="block text-label mb-2">Access Key（可选）</label>
                  <input type="password" value={volcAsrAccessKey} onChange={e => s.setVolcAsrAccessKey(e.target.value)} placeholder="旧式鉴权 Access Key"
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-cyan-500/50 font-mono" />
                </div>
                <div>
                  <label className="block text-label mb-2">资源 ID（必填）</label>
                  <input type="password" value={volcAsrResourceId} onChange={e => s.setVolcAsrResourceId(e.target.value)} placeholder="如 volc.seedasr.sauc.duration"
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-cyan-500/50 font-mono" />
                </div>
              </div>
              <p className="text-xs text-gray-600 mt-3">填写后点页面底部「保存配置」，保存到本地 .env.local（VOLC_ASR_*）；识别服务自动优先走火山云端。</p>
            </div>

            {/* TTS */}
            <div className="mt-6 pt-6 border-t border-white/10">
              <h4 className="text-label mb-4 flex items-center gap-2">
                <svg className="w-5 h-5 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" /></svg>
                火山引擎 TTS（配音）配置
                <StatusDot name="tts" statusMap={statusMap} />
              </h4>
              <p className="text-sm text-gray-500 mb-4 font-mono">用于后期处理中的高质量 AI 配音。需在火山引擎控制台开通语音合成服务</p>
              <div className="grid grid-cols-1 gap-4">
                  <div>
                    <label className="block text-label mb-2">应用ID</label>
                    <div className="relative">
                      <input type={showTtsAppId ? 'text' : 'password'} value={ttsAppId} onChange={e => s.setTtsAppId(e.target.value)} placeholder="请输入 App ID"
                        className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-emerald-500/50 font-mono pr-10" />
                      <button type="button" onClick={() => s.setShowTtsAppId(!showTtsAppId)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white">
                        {showTtsAppId ? (
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" /></svg>
                        ) : (
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
                        )}
                      </button>
                    </div>
                  </div>
                  <div>
                    <label className="block text-label mb-2">访问密钥</label>
                    <div className="relative">
                      <input type={showTtsAccessKey ? 'text' : 'password'} value={ttsAccessKey} onChange={e => s.setTtsAccessKey(e.target.value)} placeholder="请输入 Access Key"
                        className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-emerald-500/50 font-mono pr-10" />
                      <button type="button" onClick={() => s.setShowTtsAccessKey(!showTtsAccessKey)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white">
                        {showTtsAccessKey ? (
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" /></svg>
                        ) : (
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
                        )}
                      </button>
                    </div>
                  </div>
                  <div>
                    <label className="block text-label mb-2">资源ID</label>
                    <div className="relative">
                      <input type={showTtsResourceId ? 'text' : 'password'} value={ttsResourceId} onChange={e => s.setTtsResourceId(e.target.value)} placeholder="请输入 Resource ID"
                        className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-emerald-500/50 font-mono pr-10" />
                      <button type="button" onClick={() => s.setShowTtsResourceId(!showTtsResourceId)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white">
                        {showTtsResourceId ? (
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" /></svg>
                        ) : (
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
                        )}
                      </button>
                    </div>
                  </div>
              </div>
              <div className="mt-4">
                <button type="button" onClick={() => {
                  if (!ttsAppId || ttsAppId === '********' || !ttsAccessKey || ttsAccessKey === '********' || !ttsResourceId || ttsResourceId === '********') {
                    s.setTestResult({ type: 'error', message: '请先填写完整的 TTS 配置并保存' }); return
                  }
                  s.setTestingTTS(true); s.setTestResult(null)
                  setTimeout(() => {
                    s.setTestResult({ type: 'success', message: 'TTS 配置已填写，保存后执行 pm2 restart aimarketing --update-env 生效' })
                    s.setTestingTTS(false)
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

      {/* ====== OSS 配置面板 ====== */}
      <div className="bg-white/5 backdrop-blur-sm rounded-2xl border border-white/10 mb-6">
        <div className="p-6">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h3 className="font-medium text-white font-mono">阿里云 OSS 配置 <StatusDot name="oss" statusMap={statusMap} /></h3>
              <p className="text-sm text-gray-500 mt-1">配置 OSS 用于文件存储（可选）</p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-label mb-2">OSS 地域</label>
              <input type="text" value={ossRegion} onChange={e => s.setOssRegion(e.target.value)} placeholder="oss-cn-hangzhou"
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-emerald-500/50 font-mono" />
            </div>
            <div>
              <label className="block text-label mb-2">Bucket 名称</label>
              <input type="text" value={ossBucket} onChange={e => s.setOssBucket(e.target.value)} placeholder="your-bucket-name"
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-emerald-500/50 font-mono" />
            </div>
            <div>
              <label className="block text-label mb-2">AccessKey ID</label>
              <input type="text" value={ossAccessKeyId} onChange={e => s.setOssAccessKeyId(e.target.value)} placeholder="LTAIxxxxxxxxxx"
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-emerald-500/50 font-mono" />
            </div>
            <div>
              <label className="block text-label mb-2">AccessKey Secret</label>
              <div className="relative">
                <input type={showOssSecret ? 'text' : 'password'} value={ossAccessKeySecret} onChange={e => s.setOssAccessKeySecret(e.target.value)}
                  placeholder="请输入 AccessKey Secret"
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-emerald-500/50 font-mono pr-10" />
                <EyeButton show={showOssSecret} onToggle={() => s.setShowOssSecret(!showOssSecret)} />
              </div>
            </div>
          </div>

          <div className="mt-4 flex gap-3">
            <button type="button" onClick={testOSS} disabled={testingOSS}
              className="px-4 py-3 bg-blue-500/20 border border-blue-500/30 text-blue-400 rounded-xl hover:bg-blue-500/30 disabled:opacity-50 disabled:cursor-not-allowed font-mono text-sm">
              {testingOSS ? '测试中...' : '测试连接'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
