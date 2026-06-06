'use client'

import { useState, useEffect } from 'react'
import StatusDot from './StatusDot'
import type {
  StatusMap, QueryEngine, ActionEngine,
  MCHealthStatus, LoginStatus, CookieStatus,
  CookieFile, CookieSummary, ProxyItem, NewProxyForm, ProxyStats,
} from '../types'

interface EnginePanelProps {
  queryEngine: QueryEngine
  actionEngine: ActionEngine
  mcPath: string
  mcPythonBin: string
  mcHealthStatus: MCHealthStatus
  mcHealthDetail: string
  loginStatus: LoginStatus
  loginMessage: string
  loginElapsed: number
  cookieStatus: CookieStatus
  cookieFiles: CookieFile[]
  cookieSummary: CookieSummary
  proxies: ProxyItem[]
  proxyStats: ProxyStats | null
  proxyGlobalEnabled: boolean
  showAddProxy: boolean
  newProxy: NewProxyForm
  statusMap: StatusMap
  setters: {
    setQueryEngine: (v: QueryEngine) => void
    setActionEngine: (v: ActionEngine) => void
    setMcPath: (v: string) => void
    setMcPythonBin: (v: string) => void
    setMcHealthStatus: (v: MCHealthStatus) => void
    setMcHealthDetail: (v: string) => void
    setLoginStatus: (v: LoginStatus) => void
    setLoginMessage: (v: string) => void
    setLoginElapsed: (v: number | ((prev: number) => number)) => void
    setLoginPolling: (v: boolean) => void
    setCookieStatus: (v: CookieStatus) => void
    setCookieFiles: (v: CookieFile[]) => void
    setCookieSummary: (v: CookieSummary) => void
    setShowAddProxy: (v: boolean) => void
    setNewProxy: (v: NewProxyForm | ((prev: NewProxyForm) => NewProxyForm)) => void
    setProxies: (v: ProxyItem[]) => void
    setProxyStats: (v: ProxyStats | null) => void
    setProxyGlobalEnabled: (v: boolean) => void
    setStatusMap: (s: StatusMap | ((prev: StatusMap) => StatusMap)) => void
  }
}

export default function EnginePanel({
  queryEngine, actionEngine, mcPath, mcPythonBin,
  mcHealthStatus, mcHealthDetail,
  loginStatus, loginMessage, loginElapsed,
  cookieStatus, cookieFiles, cookieSummary,
  proxies, proxyStats, proxyGlobalEnabled, showAddProxy, newProxy, statusMap,
  setters: s,
}: EnginePanelProps) {

  // ---- 内部 polling 状态 ----
  const [loginPolling, setLoginPolling] = useState(false)

  // ====== MediaCrawler 测试 ======
  const testMediaCrawler = async () => {
    s.setMcHealthStatus('checking'); s.setMcHealthDetail('正在检查...')
    try {
      const res = await fetch('/api/mediacrawler', { credentials: 'include' })
      const result = await res.json()
      if (result.success && result.data?.available) {
        s.setMcHealthStatus('ok')
        s.setMcHealthDetail(`Python OK | 路径: ${result.data.pathExists ? '存在' : '不存在'}${result.data.version ? ` | v${result.data.version}` : ''}`)
        s.setStatusMap(prev => ({ ...prev as StatusMap, queryEngine: 'ok' }))
      } else {
        s.setMcHealthStatus('fail')
        s.setMcHealthDetail(result.data?.error || result.message || '连接失败')
        s.setStatusMap(prev => ({ ...prev as StatusMap, queryEngine: 'fail' }))
      }
    } catch (e: any) {
      s.setMcHealthStatus('fail')
      s.setMcHealthDetail(e.message || '网络错误')
      s.setStatusMap(prev => ({ ...prev as StatusMap, queryEngine: 'fail' }))
    }
  }

  // ====== 扫码登录 ======
  const startLogin = async () => {
    s.setLoginStatus('starting'); s.setLoginMessage('正在启动浏览器...')
    try {
      const res = await fetch('/api/mediacrawler/login', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform: 'douyin' }),
      })
      const result = await res.json()
      if (result.success) {
        s.setLoginMessage(result.data?.message || '已启动')
        startLoginPolling()
      } else {
        s.setLoginStatus('error'); s.setLoginMessage(result.message || '启动失败')
      }
    } catch (e: any) {
      s.setLoginStatus('error'); s.setLoginMessage(e.message)
    }
  }

  const startLoginPolling = () => {
    if (loginPolling) return
    setLoginPolling(true)
    const timer = setInterval(() => s.setLoginElapsed(e => e + 1), 1000)
    const poll = async () => {
      try {
        const res = await fetch('/api/mediacrawler/login', { credentials: 'include' })
        const result = await res.json()
        if (result.success && result.data?.loginProcess) {
          const lp = result.data.loginProcess
          s.setLoginStatus(lp.status); s.setLoginMessage(lp.message || '')
          if (['success', 'error', 'timeout', 'killed'].includes(lp.status)) {
            clearInterval(timer); setLoginPolling(false); loadCookieStatus()
          }
        }
      } catch {}
      if (loginPolling) setTimeout(poll, 2000)
    }
    poll()
  }

  const cancelLogin = async () => {
    await fetch('/api/mediacrawler/login', { method: 'DELETE', credentials: 'include' })
    s.setLoginStatus('killed'); s.setLoginMessage('已取消'); setLoginPolling(false)
  }

  // ====== Cookie 管理 ======
  const loadCookieStatus = async () => {
    s.setCookieStatus('loading')
    try {
      const res = await fetch('/api/mediacrawler/cookies', { credentials: 'include' })
      const result = await res.json()
      if (result.success) {
        s.setCookieStatus(result.data.validation?.status || 'unknown')
        s.setCookieFiles((result.data.cookies || []).map((f: any) => ({
          name: f.name, size: f.size, modifiedAt: f.modifiedAt,
        })))
        s.setCookieSummary(result.data.summary || { totalFiles: 0, totalSize: 0 })
      }
    } catch { s.setCookieStatus('error') }
  }

  const validateCookies = async () => {
    s.setCookieStatus('loading')
    try {
      const res = await fetch('/api/mediacrawler/cookies', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'validate' }),
      })
      const result = await res.json()
      s.setCookieStatus(result.data?.status || 'error')
      alert(`验证结果: ${result.message || JSON.stringify(result.data)}`)
    } catch { s.setCookieStatus('error') }
  }

  const clearCookies = async () => {
    if (!confirm('确定要清除所有 Cookie 吗？清除后需要重新扫码登录。')) return
    try {
      const res = await fetch('/api/mediacrawler/cookies', { method: 'DELETE', credentials: 'include' })
      const result = await res.json()
      alert(result.message); loadCookieStatus()
    } catch (e: any) { alert('删除失败: ' + e.message) }
  }

  // ====== IP 代理池 ======
  const loadProxyPool = async () => {
    try {
      const res = await fetch('/api/mediacrawler/proxy-pool', { credentials: 'include' })
      const result = await res.json()
      if (result.success) {
        s.setProxies(result.data.proxies || [])
        s.setProxyStats(result.data.stats)
        s.setProxyGlobalEnabled(result.data.settings?.globalEnabled || false)
      }
    } catch {}
  }

  // 初始化加载
  useEffect(() => { loadProxyPool(); loadCookieStatus() }, [])

  const addProxy = async () => {
    if (!newProxy.host || !newProxy.port) return
    try {
      const res = await fetch('/api/mediacrawler/proxy-pool', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(newProxy),
      })
      const result = await res.json()
      if (result.success) {
        s.setNewProxy({ host: '', port: '', protocol: 'http', username: '', password: '', label: '', region: '' })
        s.setShowAddProxy(false); loadProxyPool()
      } else { alert(result.message) }
    } catch (e: any) { alert('添加失败: ' + e.message) }
  }

  const testSingleProxy = async (id: string) => {
    await fetch('/api/mediacrawler/proxy-pool', {
      method: 'PATCH', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'test', id }),
    }).then(r => r.json()).then(() => loadProxyPool()).catch(() => {})
  }

  const testAllProxies = async () => {
    await fetch('/api/mediacrawler/proxy-pool', {
      method: 'PATCH', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'test-all' }),
    }).then(r => r.json()).then(() => loadProxyPool()).catch(() => {})
  }

  const deleteProxy = async (id: string) => {
    if (!confirm('确定删除此代理？')) return
    await fetch(`/api/mediacrawler/proxy-pool?id=${id}`, { method: 'DELETE', credentials: 'include' })
    loadProxyPool()
  }

  const toggleProxyGlobal = async (enabled: boolean) => {
    await fetch('/api/mediacrawler/proxy-pool', {
      method: 'PATCH', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'settings', settings: { globalEnabled: enabled } }),
    })
    s.setProxyGlobalEnabled(enabled)
  }

  return (
    <div className="card-glass p-6 mt-6">
      {/* ====== 查询引擎（READ） ====== */}
      <h3 className="text-white font-bold mb-2"><span className="text-blue-400">//</span> 数据查询引擎（READ）</h3>
      <p className="text-gray-400 text-xs mb-4">用于视频搜索、评论爬取、用户画像等读操作</p>

      <div>
        <label className="block text-label mb-2">
          <span>QUERY_ENGINE</span>
          <StatusDot name="queryEngine" statusMap={statusMap} />
        </label>
        <select value={queryEngine} onChange={e => s.setQueryEngine(e.target.value as QueryEngine)}
          className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-emerald-500/50 font-mono">
          <option value="mediacrawler" className="bg-gray-900">MediaCrawler 爬虫（推荐）</option>
          <option value="douyin-official" className="bg-gray-900">抖音官方 API</option>
        </select>
        <p className="text-xs text-gray-500 mt-2 font-mono">💡 推荐使用 MediaCrawler 爬虫服务，需先部署 MediaCrawler 并配置 cookie</p>
      </div>

      {/* MediaCrawler 子配置 */}
      {queryEngine === 'mediacrawler' && (
        <div className="mt-4 p-4 rounded-xl bg-blue-500/5 border border-blue-500/20">
          <h4 className="text-sm font-medium text-blue-400 mb-3 flex items-center gap-2">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z" /></svg>
            MediaCrawler 服务配置
          </h4>
          <div className="grid grid-cols-1 gap-3">
            <div>
              <label className="block text-xs text-gray-400 mb-1">安装路径</label>
              <input type="text" value={mcPath} onChange={e => s.setMcPath(e.target.value)} placeholder="/opt/MediaCrawler"
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm font-mono focus:outline-none focus:border-blue-500/50" />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Python 路径</label>
              <input type="text" value={mcPythonBin} onChange={e => s.setMcPythonBin(e.target.value)} placeholder="python3"
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm font-mono focus:outline-none focus:border-blue-500/50" />
            </div>
            <div className="flex items-center gap-3 pt-1">
              <button type="button" onClick={testMediaCrawler} disabled={mcHealthStatus === 'checking'}
                className="px-3 py-1.5 bg-blue-500/20 border border-blue-500/30 text-blue-400 rounded-lg hover:bg-blue-500/30 disabled:opacity-50 font-mono text-xs">
                {mcHealthStatus === 'checking' ? '检查中...' : '检查连接'}
              </button>
              {mcHealthStatus !== 'idle' && (
                <span className={`text-xs font-mono ${
                  mcHealthStatus === 'ok' ? 'text-emerald-400' : mcHealthStatus === 'fail' ? 'text-red-400' : 'text-gray-400'
                }`}>
                  {mcHealthStatus === 'ok' ? '✅' : mcHealthStatus === 'fail' ? '❌' : ''} {mcHealthDetail}
                </span>
              )}
            </div>
          </div>
          <p className="text-[10px] text-gray-600 mt-2 font-mono">需要在服务器上安装 MediaCrawler + Python3 + Playwright</p>
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

          {/* 登录状态显示 */}
          <div className={`rounded-lg p-3 mb-3 ${loginStatus !== 'idle' ? 'bg-white/5 border border-white/10' : ''}`}>
            {loginStatus === 'idle' ? (
              <p className="text-xs text-gray-500 font-mono">尚未启动登录流程。点击下方按钮在服务器端启动抖音浏览器进行扫码。</p>
            ) : ['waiting_scan', 'starting', 'scanned', 'confirmed'].includes(loginStatus) ? (
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
                    ? '📱 请使用抖音 APP 扫描服务器桌面弹出的二维码'
                    : loginStatus === 'scanned' ? '✅ 已扫描，请在手机上确认登录...' : '⏳ 正在处理...'}
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

          {/* 操作按钮 */}
          <div className="flex items-center gap-2 flex-wrap">
            {['idle', 'error', 'timeout', 'killed'].includes(loginStatus) && (
              <button onClick={startLogin}
                className="px-3 py-1.5 bg-purple-500/20 border border-purple-500/30 text-purple-400 rounded-lg hover:bg-purple-500/30 text-xs font-mono flex items-center gap-1.5">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v1m6 11h2m-6 0h-2m0 0a9 9 0 110-18 9 9 0 010 18z" /></svg>
                启动扫码登录
              </button>
            )}
            {['starting', 'waiting_scan'].includes(loginStatus) && (
              <button onClick={cancelLogin}
                className="px-3 py-1.5 bg-red-500/20 border border-red-500/30 text-red-400 rounded-lg hover:bg-red-500/30 text-xs font-mono">取消</button>
            )}
            <button onClick={validateCookies} disabled={cookieStatus === 'loading'}
              className="px-3 py-1.5 bg-cyan-500/20 border border-cyan-500/30 text-cyan-400 rounded-lg hover:bg-cyan-500/30 disabled:opacity-50 text-xs font-mono">验证 Cookie</button>
            <button onClick={clearCookies}
              className="px-3 py-1.5 bg-orange-500/20 border border-orange-500/30 text-orange-400 rounded-lg hover:bg-orange-500/30 text-xs font-mono">清除 Cookie</button>
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

          {/* 统计 */}
          {proxyStats && (
            <div className="grid grid-cols-5 gap-2 mb-3">
              {(Object.entries(proxyStats) as [string, number][]).map(([key, val]) => {
                const map: Record<string, [string, string]> = {
                  total: ['总计', 'gray'], enabled: ['启用', 'blue'], ok: ['可用', 'emerald'],
                  fail: ['失败', 'red'], untested: ['未测', 'yellow'],
                }
                const [lbl, color] = map[key] || ['?', 'gray']
                return (
                  <div key={key} className={`bg-${color}-500/10 rounded-lg p-2 text-center`}>
                    <div className={`text-${color}-400 text-sm font-bold font-mono`}>{val ?? 0}</div>
                    <div className="text-[9px] text-gray-500 font-mono">{lbl}</div>
                  </div>
                )
              })}
            </div>
          )}

          {/* 代理列表 */}
          <div className="space-y-1.5 max-h-48 overflow-y-auto mb-3">
            {proxies.length === 0 ? (
              <p className="text-xs text-gray-600 text-center py-4 font-mono">暂无代理节点</p>
            ) : proxies.map(px => (
              <div key={px.id} className={`flex items-center justify-between px-3 py-2 rounded-lg border text-xs font-mono group ${
                px.enabled ? 'bg-white/5 border-white/10' : 'bg-black/10 border-white/5 opacity-60'
              }`}>
                <div className="flex items-center gap-2 min-w-0">
                  <span className={`w-2 h-2 rounded-full shrink-0 ${
                    px.testStatus === 'ok' ? 'bg-emerald-400' : px.testStatus === 'slow' ? 'bg-yellow-400' : px.testStatus === 'fail' ? 'bg-red-400' : 'bg-gray-600'
                  }`} />
                  <span className="text-gray-300 truncate">{px.label || `${px.host}:${px.port}`}</span>
                  <span className="text-[9px] text-gray-600 uppercase shrink-0">{px.protocol}</span>
                  {px.region && <span className="text-[9px] bg-white/10 px-1 rounded text-gray-500 shrink-0">{px.region}</span>}
                </div>
                <div className="flex items-center gap-1.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                  {px.testLatencyMs != null && <span className={`text-[9px] ${px.testLatencyMs < 2000 ? 'text-emerald-400' : 'text-yellow-400'}`}>{px.testLatencyMs}ms</span>}
                  <button onClick={() => testSingleProxy(px.id)} className="p-1 hover:text-cyan-400 text-gray-500" title="测试">↻</button>
                  <button onClick={() => deleteProxy(px.id)} className="p-1 hover:text-red-400 text-gray-500" title="delete">×</button>
                </div>
              </div>
            ))}
          </div>

          {/* 操作栏 */}
          <div className="flex items-center gap-2 flex-wrap pt-2 border-t border-white/5">
            {!showAddProxy ? (
              <button onClick={() => s.setShowAddProxy(true)}
                className="px-3 py-1.5 bg-emerald-500/20 border border-emerald-500/30 text-emerald-400 rounded-lg hover:bg-emerald-500/30 text-xs font-mono">+ 添加代理</button>
            ) : (
              <div className="flex items-end gap-2 flex-wrap p-2 bg-black/20 rounded-lg w-full">
                <input placeholder="IP 地址" value={newProxy.host} onChange={e => s.setNewProxy(p => ({ ...p, host: e.target.value }))}
                  className="bg-white/5 border border-white/10 rounded px-2 py-1.5 text-white text-xs font-mono w-28" />
                <input placeholder="端口" value={newProxy.port} onChange={e => s.setNewProxy(p => ({ ...p, port: e.target.value }))}
                  className="bg-white/5 border border-white/10 rounded px-2 py-1.5 text-white text-xs font-mono w-16" />
                <select value={String(newProxy.protocol)} onChange={e => s.setNewProxy(p => ({ ...p, protocol: e.target.value as 'http' | 'https' | 'socks5' }))}
                  className="bg-white/5 border border-white/10 rounded px-2 py-1.5 text-white text-xs font-mono w-16">
                  <option value="http">HTTP</option><option value="https">HTTPS</option><option value="socks5">SOCKS5</option>
                </select>
                <input placeholder="用户名(可选)" value={newProxy.username} onChange={e => s.setNewProxy(p => ({ ...p, username: e.target.value }))}
                  className="bg-white/5 border border-white/10 rounded px-2 py-1.5 text-white text-xs font-mono w-24" />
                <input placeholder="密码(可选)" type="password" value={newProxy.password} onChange={e => s.setNewProxy(p => ({ ...p, password: e.target.value }))}
                  className="bg-white/5 border border-white/10 rounded px-2 py-1.5 text-white text-xs font-mono w-24" />
                <input placeholder="标签" value={newProxy.label} onChange={e => s.setNewProxy(p => ({ ...p, label: e.target.value }))}
                  className="bg-white/5 border border-white/10 rounded px-2 py-1.5 text-white text-xs font-mono w-20" />
                <input placeholder="地区(CN/US)" value={newProxy.region} onChange={e => s.setNewProxy(p => ({ ...p, region: e.target.value }))}
                  className="bg-white/5 border border-white/10 rounded px-2 py-1.5 text-white text-xs font-mono w-16" />
                <button onClick={addProxy} disabled={!newProxy.host || !newProxy.port}
                  className="px-2.5 py-1.5 bg-emerald-500 text-white rounded-lg hover:bg-emerald-600 disabled:opacity-50 text-xs font-mono">确认</button>
                <button onClick={() => s.setShowAddProxy(false)} className="px-2.5 py-1.5 text-gray-500 hover:text-white text-xs">取消</button>
              </div>
            )}
            <button onClick={testAllProxies} disabled={proxies.length === 0}
              className="px-3 py-1.5 bg-cyan-500/20 border border-cyan-500/30 text-cyan-400 rounded-lg hover:bg-cyan-500/30 disabled:opacity-50 text-xs font-mono ml-auto">测试全部</button>
          </div>
          <p className="text-[10px] text-gray-600 mt-2 font-mono">代理池数据存储于 .proxy-pool.json，支持 HTTP/HTTPS/SOCKS5 协议轮换</p>
        </div>
      )}

      {/* ====== 动作执行引擎（WRITE） ====== */}
      <div className="mt-6 pt-6 border-t border-white/10">
        <h3 className="text-white font-bold mb-2"><span className="text-emerald-400">//</span> 动作执行引擎（WRITE）</h3>
        <p className="text-gray-400 text-xs mb-4">用于点赞、评论、发布视频等写操作</p>
        <div>
          <label className="block text-label mb-2">
            <span>ACTION_ENGINE</span>
            <StatusDot name="actionEngine" statusMap={statusMap} />
          </label>
          <select value={actionEngine} onChange={e => s.setActionEngine(e.target.value as ActionEngine)}
            className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-emerald-500/50 font-mono">
            <option value="q1-adb" className="bg-gray-900">Q1 ADB 自动化（推荐）</option>
            <option value="fingerprint" className="bg-gray-900">指纹浏览器</option>
          </select>
          <p className="text-xs text-gray-500 mt-2 font-mono">⚠️ 写入操作会影响账号，请谨慎选择</p>
        </div>
      </div>
    </div>
  )
}
