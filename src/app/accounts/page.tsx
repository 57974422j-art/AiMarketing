'use client'
import { useState, useEffect } from 'react'
import { useAuth } from '@/app/providers'
import { showToast } from '@/components/Toast'

const PLATFORMS = [
  { key: 'douyin',    label: '抖音',       icon: '🎵', color: 'from-pink-500/10 to-purple-500/10', border: 'border-pink-500/30', hover: 'hover:bg-pink-500/10' },
  { key: 'kuaishou',  label: '快手',       icon: '📹', color: 'from-yellow-500/10 to-orange-500/10', border: 'border-yellow-500/30', hover: 'hover:bg-yellow-500/10' },
  { key: 'xiaohongshu', label: '小红书',    icon: '📕', color: 'from-red-500/10 to-orange-500/10', border: 'border-red-500/30', hover: 'hover:bg-red-500/10' },
  { key: 'shipinhao', label: '视频号',      icon: '💚', color: 'from-green-500/10 to-emerald-500/10', border: 'border-green-500/30', hover: 'hover:bg-green-500/10' },
  { key: 'weibo',     label: '微博',       icon: '📢', color: 'from-orange-500/10 to-red-500/10', border: 'border-orange-500/30', hover: 'hover:bg-orange-500/10' },
  { key: 'bilibili',  label: 'B站',        icon: '📺', color: 'from-blue-500/10 to-cyan-500/10', border: 'border-blue-500/30', hover: 'hover:bg-blue-500/10' },
]

const BIND_TYPES = [
  { key: 'device',    label: 'Q1 群控',     desc: 'Q1 手机自动化',     icon: '📱', color: 'from-green-500/20 to-emerald-500/20', border: 'border-green-500/30', accent: 'text-green-400' },
  { key: 'imai',      label: 'IMAI WORK',   desc: 'AI云手机/浏览器',   icon: '🚀', color: 'from-purple-500/20 to-violet-500/20', border: 'border-purple-500/30', accent: 'text-purple-400' },
  { key: 'official',  label: '官方API',      desc: '平台开放接口',   icon: '🔗', color: 'from-blue-500/20 to-cyan-500/20', border: 'border-blue-500/30', accent: 'text-blue-400' },
]

interface Account {
  id: number; platform: string; accountName: string; accountId: string
  isBound: boolean; bindType: string; password: string; mobile: string; remark: string; createdAt: string
}

export default function AccountsPage() {
  const { user, loading: authLoading } = useAuth()
  const [accounts, setAccounts] = useState<Account[]>([])
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)

  const [nickname, setNickname] = useState('')
  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>([])
  const [bindType, setBindType] = useState('device')
  const [profileLink, setProfileLink] = useState('')
  const [accountPassword, setAccountPassword] = useState('')
  const [accountMobile, setAccountMobile] = useState('')
  const [remark, setRemark] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const [workbench, setWorkbench] = useState<Account | null>(null)

  useEffect(() => {
    if (!authLoading && user) load()
    else if (!authLoading) setLoading(false)
  }, [authLoading, user])

  const load = async () => {
    try { const r = await fetch('/api/accounts', { credentials: 'include' }); if (r.ok) { const d = await r.json(); setAccounts(Array.isArray(d) ? d : d.data || []) } }
    catch {} finally { setLoading(false) }
  }

  const togglePlatform = (key: string) => {
    setSelectedPlatforms(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key])
  }

  const handleSubmit = async () => {
    if (!nickname.trim()) { showToast('请输入账号昵称', 'error'); return }
    if (selectedPlatforms.length === 0) { showToast('请选择至少一个平台', 'error'); return }
    setSubmitting(true)
    for (const platform of selectedPlatforms) {
      try {
        await fetch('/api/accounts', {
          method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ accountName: nickname.trim(), platform, accountId: profileLink.trim(), bindType, password: accountPassword.trim(), mobile: accountMobile.trim(), remark: remark.trim() }),
        })
      } catch {}
    }
    showToast(`已登记 ${selectedPlatforms.length} 个账号`, 'success')
    setShowAdd(false); setNickname(''); setSelectedPlatforms([]); setBindType('device'); setProfileLink(''); setAccountPassword(''); setAccountMobile(''); setRemark('')
    load()
    setSubmitting(false)
  }

  const handleDelete = async (id: number) => {
    if (!confirm('确定删除此账号？')) return
    const r = await fetch(`/api/accounts?id=${id}`, { method: 'DELETE', credentials: 'include' })
    if (r.ok) { showToast('已删除', 'success'); load() }
    else showToast('删除失败', 'error')
  }

  const getLoginUrl = (platform: string) => {
    const urls: Record<string, string> = {
      douyin: 'https://www.douyin.com/login',
      kuaishou: 'https://www.kuaishou.com/login',
      xiaohongshu: 'https://www.xiaohongshu.com/login',
      shipinhao: 'https://channels.weixin.qq.com/login',
      weibo: 'https://weibo.com/login',
      bilibili: 'https://www.bilibili.com/login',
    }
    return urls[platform] || '#'
  }

  // ── 运行脚本弹窗 ──
  const [runScript, setRunScript] = useState<{ deviceId: string; deviceName: string } | null>(null)
  const [scriptAction, setScriptAction] = useState('打开抖音')
  const [scriptRunning, setScriptRunning] = useState(false)
  const [scriptLog, setScriptLog] = useState<string[]>([])
  const [scriptCustomInput, setScriptCustomInput] = useState('')

  // ── Electron 本地设备 + 权限 ──
  const isElectron = typeof window !== 'undefined' && !!(window as any).electronAPI?.isElectron
  const [localDevices, setLocalDevices] = useState<any[]>([])
  const [mySerials, setMySerials] = useState<string[]>([])
  const [regLoading, setRegLoading] = useState<string | null>(null)

  useEffect(() => {
    if (!isElectron) return
    const poll = async () => {
      const res = await (window as any).electronAPI.adbDevices()
      if (res.success) setLocalDevices(res.data)
    }
    poll()
    const timer = setInterval(poll, 5000)
    return () => clearInterval(timer)
  }, [isElectron])

  // 加载当前用户已登记的本地设备序列号
  useEffect(() => {
    if (!user) return
    fetch('/api/accounts', { credentials: 'include' }).then(r => r.json()).then(d => {
      const list = Array.isArray(d) ? d : d.data || []
      setMySerials(list.filter((a: any) => a.bindType === 'imai' && a.platform === 'local-device').map((a: any) => a.accountId).filter(Boolean))
    }).catch(() => {})
  }, [user])

  const isRegistered = (serial: string) => mySerials.includes(serial)

  const registerDevice = async (serial: string, name: string) => {
    setRegLoading(serial)
    try {
      const r = await fetch('/api/accounts', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accountName: name,
          platform: 'local-device',
          bindType: 'imai',
          accountId: serial,
          remark: 'Electron本地设备',
        }),
      })
      const data = await r.json()
      if (data.success) {
        showToast('登记成功，等待管理员审核', 'success')
        setMySerials(prev => [...prev, serial])
      } else {
        showToast('登记失败: ' + (data.message || ''), 'error')
      }
    } catch (e: any) {
      showToast('登记异常: ' + e.message, 'error')
    }
    setRegLoading(null)
  }

  const platformMeta = (key: string) => PLATFORMS.find(p => p.key === key)

  if (authLoading || loading) return <Loading />

  return (
    <div className="min-h-screen bg-gray-950">
      <div className="max-w-6xl mx-auto px-4 py-8">
        {/* 标题 */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <p className="text-label mb-2">平台管理 / ACCOUNTS</p>
            <h1 className="text-mono-lg text-white">
              {user?.role === 'end-user' ? '我的账号 / MY ACCOUNTS' : '账号管理 / ACCOUNTS'}
            </h1>
            <p className="text-gray-400 text-sm mt-1">
              共 <span className="text-emerald-400">{accounts.length}</span> 个账号
              {user?.role === 'end-user' && ' · 登记后管理员会帮你绑定设备'}
            </p>
          </div>
          <button onClick={() => setShowAdd(true)} className="btn-primary text-sm py-2">
            + 登记账号
          </button>
        </div>

        {/* 账号列表 */}
        {accounts.length === 0 ? (
          <div className="card-glass p-12 text-center text-gray-500">
            <p className="text-lg mb-2">暂无账号</p>
            <p className="text-xs">点击右上角「登记账号」添加</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {accounts.map(acct => {
              const pm = platformMeta(acct.platform)
              const bindLabel = BIND_TYPES.find(b => b.key === acct.bindType)
              return (
                <div key={acct.id} className={`card-glass p-4 border-l-4 ${acct.isBound ? 'border-l-emerald-500' : 'border-l-gray-500'}`}>
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="text-xl">{pm?.icon || '📱'}</span>
                      <div>
                        <span className="text-white font-medium text-sm">{acct.accountName}</span>
                        <span className="text-xs text-gray-500 ml-2">{pm?.label || acct.platform}</span>
                      </div>
                    </div>
                    <button onClick={() => handleDelete(acct.id)} className="text-xs text-red-400 hover:text-red-300">删除</button>
                  </div>
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    <span className={`text-[10px] px-1.5 py-0.5 rounded ${bindLabel?.border || 'border-gray-500/30'} ${bindLabel?.accent || 'text-gray-500'} border`}>
                      {bindLabel?.label || acct.bindType}
                    </span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded ${acct.isBound ? 'bg-emerald-500/20 text-emerald-400' : 'bg-gray-500/20 text-gray-500'}`}>
                      {acct.isBound ? '已绑定' : '未绑定'}
                    </span>
                  </div>
                  <div className="text-[10px] text-gray-600 space-y-0.5 mb-2">
                    {acct.mobile && <p>📱 {acct.mobile}</p>}
                    {acct.password && <p>🔑 ****{acct.password.slice(-3)}</p>}
                    {acct.accountId && <p className="truncate">🔗 {acct.accountId}</p>}
                    {acct.remark && <p className="italic">📝 {acct.remark}</p>}
                  </div>
                  <button onClick={() => setWorkbench(acct)}
                    className={`w-full text-xs py-1.5 mt-1 rounded-lg border transition ${
                      acct.isBound
                        ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/30'
                        : 'bg-white/5 text-gray-500 border-white/10 cursor-not-allowed'
                    }`}
                    disabled={!acct.isBound}>
                    🚀 进入工作台
                  </button>
                </div>
              )
            })}
          </div>
        )}

        {/* ── Electron 本地设备 ── */}
        {isElectron && (
          <div className="card-glass p-4 mt-6">
            <h3 className="text-white text-sm font-bold mb-3 flex items-center gap-2">
              💻 本地设备 <span className="text-[10px] text-gray-500 font-normal">客户端直连 · 自动刷新</span>
            </h3>
            {localDevices.length === 0 ? (
              <div className="text-center text-gray-500 text-xs py-6">
                <p>未检测到设备</p>
                <p className="mt-1">请通过 USB 或 WiFi ADB 连接手机</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {localDevices.map((dev: any) => {
                  const regged = isRegistered(dev.id)
                  return (
                    <div key={dev.id} className="bg-white/5 rounded-xl p-3 border border-white/10">
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <span className="text-lg">📱</span>
                          <div>
                            <span className="text-white text-xs font-medium">{dev.name}</span>
                            <span className={`text-[10px] ml-2 ${dev.status === 'device' ? 'text-emerald-400' : 'text-yellow-400'}`}>
                              {dev.status === 'device' ? '已连接' : '未授权'}
                            </span>
                          </div>
                        </div>
                        <span className="text-[10px] text-gray-500">{dev.type === 'usb' ? '🔌 USB' : '📶 WiFi'}</span>
                      </div>
                      <p className="text-[10px] text-gray-600 truncate">{dev.id}</p>
                      <div className="flex gap-2 mt-2">
                        {dev.status === 'device' && !regged && (
                          <button onClick={() => registerDevice(dev.id, dev.name)} disabled={regLoading === dev.id}
                            className="w-full text-[10px] py-1.5 bg-yellow-500/20 text-yellow-400 border border-yellow-500/30 rounded hover:bg-yellow-500/30 disabled:opacity-50">
                            {regLoading === dev.id ? '登记中...' : '📋 登记设备'}
                          </button>
                        )}
                        {dev.status === 'device' && regged && (
                          <>
                            <button onClick={async () => {
                              try {
                                const snap = await (window as any).electronAPI.adbScreenshot(dev.id)
                                if (snap?.success) showToast('截图已保存', 'success')
                                else showToast('截图失败', 'error')
                              } catch (e: any) {
                                showToast('截图异常: ' + e.message, 'error')
                              }
                            }} className="flex-1 text-[10px] py-1 bg-blue-500/20 text-blue-400 border border-blue-500/30 rounded hover:bg-blue-500/30">
                              📸 截图
                            </button>
                            <button onClick={async () => {
                              const r = await (window as any).electronAPI.adbMirror(dev.id)
                              if (!r.success) showToast('投屏失败: ' + (r.error || ''), 'error')
                            }} className="flex-1 text-[10px] py-1 bg-purple-500/20 text-purple-400 border border-purple-500/30 rounded hover:bg-purple-500/30">
                              🖥️ 投屏
                            </button>
                            <button onClick={() => setRunScript({ deviceId: dev.id, deviceName: dev.name })}
                              className="flex-1 text-[10px] py-1 bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 rounded hover:bg-emerald-500/30">
                              ▶ 运行
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}

        {/* ── 运行脚本弹窗 ── */}
        {runScript && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={() => setRunScript(null)}>
            <div className="bg-gray-900 border border-white/10 rounded-2xl p-6 w-full max-w-md mx-4" onClick={e => e.stopPropagation()}>
              <h3 className="text-white font-bold mb-1">▶ 运行脚本</h3>
              <p className="text-xs text-gray-500 mb-4">{runScript.deviceName} · {runScript.deviceId}</p>
              <PushedTasks deviceId={runScript.deviceId} />
              <select className="input-dark w-full text-sm mb-3" value={scriptAction} onChange={e => setScriptAction(e.target.value)}>
                <option className="bg-gray-900">打开抖音</option>
                <option className="bg-gray-900">打开快手</option>
                <option className="bg-gray-900">打开小红书</option>
                <option className="bg-gray-900">返回桌面</option>
                <option className="bg-gray-900">输入文字</option>
                <option className="bg-gray-900">点击坐标</option>
                <option className="bg-gray-900">上滑</option>
                <option className="bg-gray-900">自定义 Shell</option>
              </select>
              {scriptAction === '输入文字' && (
                <input className="input-dark w-full text-sm mb-3" placeholder="要输入的文字..." value={scriptCustomInput} onChange={e => setScriptCustomInput(e.target.value)} />
              )}
              {scriptAction === '点击坐标' && (
                <div className="flex gap-2 mb-3">
                  <input className="input-dark flex-1 text-sm" placeholder="X Y (如 500 800)" value={scriptCustomInput} onChange={e => setScriptCustomInput(e.target.value)} />
                </div>
              )}
              {scriptAction === '自定义 Shell' && (
                <input className="input-dark w-full text-sm mb-3" placeholder="adb shell 命令（如 input tap 500 800）" value={scriptCustomInput} onChange={e => setScriptCustomInput(e.target.value)} />
              )}
              <div className="flex gap-3 mb-3">
                <button onClick={async () => {
                  setScriptRunning(true); setScriptLog([])
                  const api = (window as any).electronAPI
                  const log = (msg: string) => setScriptLog(p => [...p, msg])
                  try {
                    const actions: Record<string, string> = {
                      '打开抖音': 'am start -n com.ss.android.ugc.aweme/.main.MainActivity',
                      '打开快手': 'am start -n com.smile.gifmaker/.MainActivity',
                      '打开小红书': 'am start -n com.xingin.xhs/.activity.SplashActivity',
                      '返回桌面': 'input keyevent 3',
                      '上滑': 'input swipe 540 1500 540 500',
                    }
                    const cmd = actions[scriptAction] || scriptCustomInput || ''
                    if (cmd) {
                      log(`执行: ${cmd}`)
                      const r = await api.adbShell(runScript.deviceId, cmd)
                      log(r.success ? '✅ 成功' : '❌ 失败: ' + (r.error || ''))
                    }
                    if (scriptAction === '输入文字' && scriptCustomInput) {
                      log(`输入: ${scriptCustomInput}`)
                      const r = await api.adbShell(runScript.deviceId, `input text "${scriptCustomInput.replace(/ /g, '%s')}"`)
                      log(r.success ? '✅ 成功' : '❌ 失败: ' + (r.error || ''))
                    }
                  } catch (e: any) { log('❌ 异常: ' + e.message) }
                  setScriptRunning(false)
                }} disabled={scriptRunning} className="flex-1 py-2 bg-emerald-500 text-white rounded-lg hover:bg-emerald-600 disabled:opacity-50 text-sm">
                  {scriptRunning ? '⏳ 执行中...' : '▶ 执行'}
                </button>
                <button onClick={() => setRunScript(null)} className="flex-1 py-2 border border-white/10 text-gray-400 rounded-lg hover:bg-white/10 text-sm">关闭</button>
              </div>
              {scriptLog.length > 0 && (
                <div className="bg-black/30 rounded-lg p-3 max-h-32 overflow-y-auto text-[10px] text-gray-400 font-mono space-y-1">
                  {scriptLog.map((l, i) => <p key={i}>{l}</p>)}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── 登记弹窗 ── */}
        {showAdd && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={() => setShowAdd(false)}>
            <div className="bg-gray-900 border border-white/10 rounded-2xl p-6 w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
              <h3 className="text-white font-bold text-lg mb-1">📝 登记账号</h3>
              <p className="text-xs text-gray-500 mb-5">登记后管理员会帮你绑定设备并填密码</p>
              <label className="block text-xs text-gray-400 mb-1">昵称 <span className="text-red-400">*</span></label>
              <input className="input-dark w-full text-sm mb-4" placeholder="如：我的抖音号" value={nickname} onChange={e => setNickname(e.target.value)} />
              <label className="block text-xs text-gray-400 mb-2">选择平台 <span className="text-red-400">*</span> <span className="text-gray-600">（可多选）</span></label>
              <div className="grid grid-cols-3 gap-2 mb-4">
                {PLATFORMS.map(p => (
                  <button key={p.key} onClick={() => togglePlatform(p.key)}
                    className={`flex flex-col items-center gap-1 p-3 rounded-xl border text-xs transition bg-gradient-to-br ${
                      selectedPlatforms.includes(p.key)
                        ? `${p.color} ${p.border} text-white`
                        : 'border-white/10 text-gray-500 hover:bg-white/5'
                    }`}>
                    <span className="text-lg">{p.icon}</span>
                    <span>{p.label}</span>
                  </button>
                ))}
              </div>
              <label className="block text-xs text-gray-400 mb-2">绑定方式</label>
              <div className="grid grid-cols-3 gap-2 mb-4">
                {BIND_TYPES.map(bt => (
                  <button key={bt.key} onClick={() => setBindType(bt.key)}
                    className={`flex flex-col items-center gap-1 p-3 rounded-xl border text-xs transition ${
                      bindType === bt.key
                        ? `${bt.color} ${bt.border} ${bt.accent}`
                        : 'border-white/10 text-gray-500 hover:bg-white/5'
                    }`}>
                    <span className="text-lg">{bt.icon}</span>
                    <span className="font-medium">{bt.label}</span>
                    <span className="text-[10px] opacity-60">{bt.desc}</span>
                  </button>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-3 mb-4">
                <div>
                  <label className="block text-xs text-gray-400 mb-1">手机号</label>
                  <input className="input-dark w-full text-sm" type="tel" placeholder="绑定手机号" value={accountMobile} onChange={e => setAccountMobile(e.target.value)} />
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">密码</label>
                  <input className="input-dark w-full text-sm" type="password" placeholder="账号密码" value={accountPassword} onChange={e => setAccountPassword(e.target.value)} />
                </div>
              </div>
              <label className="block text-xs text-gray-400 mb-1">主页链接</label>
              <input className="input-dark w-full text-sm mb-4" type="url" placeholder="https://www.douyin.com/user/..." value={profileLink} onChange={e => setProfileLink(e.target.value)} />
              <label className="block text-xs text-gray-400 mb-1">备注</label>
              <textarea className="input-dark w-full text-sm mb-5 h-16" placeholder="可选，如：引流号、客服号" value={remark} onChange={e => setRemark(e.target.value)} />
              <div className="flex gap-3">
                <button onClick={() => setShowAdd(false)} className="flex-1 py-2.5 border border-white/10 text-gray-400 rounded-xl hover:bg-white/10 text-sm">取消</button>
                <button onClick={handleSubmit} disabled={submitting || !nickname.trim() || selectedPlatforms.length === 0}
                  className="flex-1 py-2.5 bg-emerald-500 text-white rounded-xl hover:bg-emerald-600 disabled:opacity-50 text-sm font-medium">
                  {submitting ? '提交中...' : `✅ 登记 (${selectedPlatforms.length}个平台)`}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── 工作台弹窗 ── */}
        {workbench && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={() => setWorkbench(null)}>
            <div className="bg-gray-900 border border-white/10 rounded-2xl p-6 w-full max-w-sm mx-4" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <span className="text-2xl">{platformMeta(workbench.platform)?.icon || '📱'}</span>
                  <div>
                    <h3 className="text-white font-bold">{workbench.accountName}</h3>
                    <p className="text-xs text-gray-500">{platformMeta(workbench.platform)?.label || workbench.platform}</p>
                  </div>
                </div>
                <button onClick={() => setWorkbench(null)} className="text-gray-500 hover:text-white text-xl">&times;</button>
              </div>
              <div className="space-y-2">
                <a href={getLoginUrl(workbench.platform)} target="_blank" rel="noopener noreferrer"
                  className="flex items-center gap-3 px-4 py-3 bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 rounded-xl text-sm hover:bg-emerald-500/30 transition block text-center">
                  🔑 前往 {platformMeta(workbench.platform)?.label || workbench.platform} 登录
                </a>
                <a href="/admin/social-accounts" className="flex items-center gap-3 px-4 py-3 bg-white/5 text-gray-400 border border-white/10 rounded-xl text-sm hover:bg-white/10 transition block text-center">
                  ⚙️ 账号设置（管理员用）
                </a>
              </div>
              <p className="text-[10px] text-gray-600 text-center mt-4">
                登录后通知管理员绑定设备即可使用
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function Loading() {
  return <div className="min-h-screen bg-gray-950 flex items-center justify-center"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-400" /></div>
}

// ── 推送任务列表（内嵌在运行弹窗中） ──
function PushedTasks({ deviceId }: { deviceId: string }) {
  const [tasks, setTasks] = useState<any[]>([])
  const [execId, setExecId] = useState<number | null>(null)
  const [logs, setLogs] = useState<Record<number, string[]>>({})

  useEffect(() => {
    fetch('/api/tasks/mine?serial=' + deviceId, { credentials: 'include' }).then(r => r.json()).then(d => {
      setTasks(Array.isArray(d?.data) ? d.data.filter((t: any) => t.status === '待执行') : [])
    }).catch(() => {})
  }, [deviceId])

  if (tasks.length === 0) return null

  return (
    <div className="mb-3 bg-emerald-500/5 rounded-xl p-3 border border-emerald-500/20">
      <p className="text-[10px] text-emerald-400 font-bold mb-2">📋 推送任务 ({tasks.length})</p>
      <div className="space-y-1.5">
        {tasks.map(t => {
          const executing = execId === t.id
          return (
            <div key={t.id} className="bg-white/5 rounded-lg p-2 border border-white/10">
              <div className="flex items-center justify-between">
                <div className="min-w-0 flex-1">
                  <p className="text-[10px] text-white truncate">{t.title || t.action}</p>
                  <p className="text-[9px] text-gray-500">{t.platform} · {t.action}{t.hook ? ' · ' + t.hook : ''}</p>
                </div>
                <button onClick={async () => {
                  setExecId(t.id)
                  const api = (window as any).electronAPI
                  const log = (m: string) => setLogs(p => ({ ...p, [t.id]: [...(p[t.id] || []), m] }))
                  try {
                    log('📲 打开应用...')
                    await api.adbShell(deviceId, 'am start -n com.ss.android.ugc.aweme/.main.MainActivity')
                    await new Promise(r => setTimeout(r, 3000))
                    if (t.action === 'publish') log('📤 发布: ' + (t.title || ''))
                    else if (t.action === 'like') { await new Promise(r => setTimeout(r, 5000)); await api.adbShell(deviceId, 'input tap 540 1400') }
                    else if (t.action === 'follow') await api.adbShell(deviceId, 'input tap 900 200')
                    log('✅ 完成')
                    await fetch('/api/tasks/' + t.id + '/execute', { method: 'POST', credentials: 'include' })
                    setTasks(p => p.filter(x => x.id !== t.id))
                  } catch (e: any) { log('❌ ' + e.message) }
                  setExecId(null)
                }} disabled={executing}
                  className="text-[10px] px-2 py-0.5 bg-emerald-500/20 text-emerald-400 rounded hover:bg-emerald-500/30 disabled:opacity-50 shrink-0 ml-2">
                  {executing ? '⏳' : '▶'}
                </button>
              </div>
              {logs[t.id]?.length > 0 && (
                <div className="text-[9px] text-gray-400 font-mono mt-1 space-y-0.5">
                  {logs[t.id].map((l, i) => <p key={i}>{l}</p>)}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
