'use client'
import { useState, useEffect } from 'react'
import { useAuth } from '@/app/providers'
import { showToast } from '@/components/Toast'

const PLATFORM_KEY: Record<string, string> = {
  '抖音': 'douyin', '快手': 'kuaishou', '小红书': 'xiaohongshu',
  '视频号': 'shipinhao', '微博': 'weibo', 'B站': 'bilibili',
}
const PLATFORMS = Object.keys(PLATFORM_KEY)
const PLATFORM_ICON: Record<string, string> = {
  douyin: '🎵', kuaishou: '📹', xiaohongshu: '📕',
  shipinhao: '💚', weibo: '📢', bilibili: '📺',
}
const ACTIONS = [
  { key: 'search', label: '搜索', icon: '🔍', desc: '搜索关键词并浏览' },
  { key: 'like', label: '点赞', icon: '❤️', desc: '点赞当前视频' },
  { key: 'comment', label: '评论', icon: '💬', desc: '评论当前视频' },
  { key: 'follow', label: '关注', icon: '➕', desc: '关注作者' },
  { key: 'share', label: '转发', icon: '🔄', desc: '分享视频' },
  { key: 'extract', label: '采集', icon: '📥', desc: '提取视频/评论' },
  { key: 'publish', label: '发视频', icon: '📤', desc: '从媒体库选视频发布' },
]

function VideoSelector({ deviceSerial }: { deviceSerial: string }) {
  const [videos, setVideos] = useState<any[]>([])
  const [selected, setSelected] = useState<any>(null)
  const isElectron = typeof window !== 'undefined' && !!(window as any).electronAPI?.isElectron

  useEffect(() => {
    fetch('/api/media-library?source=private&type=video', { credentials: 'include' }).then(r => r.json()).then(d => {
      setVideos(Array.isArray(d?.data) ? d.data : [])
    }).catch(() => {})
  }, [])

  return (
    <div className="card-glass p-4 mb-4">
      <label className="text-xs text-gray-400 mb-2 block">选择视频</label>
      {videos.length === 0 ? (
        <p className="text-xs text-gray-500 text-center py-3">媒体库暂无视频，先在 AI 文案生成视频后保存</p>
      ) : (
        <div className="grid grid-cols-3 gap-2 mb-3">
          {videos.map((v: any) => (
            <button key={v.id} onClick={() => setSelected(v)}
              className={`p-2 rounded-xl border text-xs text-center transition ${
                selected?.id === v.id ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' : 'bg-white/5 text-gray-400 border-white/10 hover:bg-white/10'
              }`}>
              <p className="truncate">{v.title || '未命名'}</p>
              <p className="text-[10px] text-gray-600">{v.category}</p>
            </button>
          ))}
        </div>
      )}
      {selected && <p className="text-[10px] text-gray-500 mt-1">已选: {selected.title}</p>}
    </div>
  )
}

export default function MyAutomationPage() {
  const { user, loading: authLoading } = useAuth()
  const isElectron = typeof window !== 'undefined' && !!(window as any).electronAPI?.isElectron

  const [devices, setDevices] = useState<any[]>([])
  const [selectedDevice, setSelectedDevice] = useState('')
  const [platform, setPlatform] = useState('抖音')
  const [action, setAction] = useState('like')
  const [keywordsText, setKeywordsText] = useState('')
  const [running, setRunning] = useState(false)
  const [logs, setLogs] = useState<string[]>([])

  useEffect(() => {
    if (!user) return
    fetch('/api/accounts', { credentials: 'include' }).then(r => r.json()).then(d => {
      const list = Array.isArray(d) ? d : d.data || []
      const myDevices = list.filter((a: any) => a.platform === 'local-device' && a.isBound && a.accountId).map((a: any) => ({ serial: a.accountId, name: a.accountName }))
      setDevices(myDevices)
      if (myDevices.length > 0) setSelectedDevice(myDevices[0].serial)
    }).catch(() => {})
  }, [user])

  const addLog = (msg: string) => setLogs(p => [...p, `[${new Date().toLocaleTimeString()}] ${msg}`])

  const runAction = async () => {
    if (!selectedDevice) { showToast('请先绑定本地设备', 'error'); return }
    setRunning(true); setLogs([])
    const api = (window as any).electronAPI
    const pkg: Record<string, string> = {
      douyin: 'com.ss.android.ugc.aweme/.main.MainActivity',
      kuaishou: 'com.smile.gifmaker/.MainActivity',
      xiaohongshu: 'com.xingin.xhs/.activity.SplashActivity',
      weibo: 'com.sina.weibo/.SplashActivity',
      bilibili: 'tv.danmaku.bili/.MainActivityV2',
    }

    addLog(`🚀 ${platform} → ${ACTIONS.find(a => a.key === action)?.label}`)
    addLog(`📱 ${selectedDevice}`)

    try {
      const pkgName = pkg[PLATFORM_KEY[platform]]
      if (pkgName) {
        addLog(`📲 打开 ${platform}...`)
        const r = await api.adbShell(selectedDevice, `am start -n ${pkgName}`)
        addLog(r.success ? '✅ 打开成功' : '⚠️ ' + (r.error || ''))
        await new Promise(r => setTimeout(r, 3000))
      }

      if (action === 'search' && keywordsText) {
        for (const kw of keywordsText.split('\n').filter(Boolean)) {
          addLog(`🔍 搜索: ${kw}`)
          await api.adbShell(selectedDevice, 'input tap 500 100'); await new Promise(r => setTimeout(r, 1000))
          await api.adbShell(selectedDevice, `input text "${kw.replace(/ /g, '%s')}"`); await new Promise(r => setTimeout(r, 1000))
          await api.adbShell(selectedDevice, 'input keyevent 66'); await new Promise(r => setTimeout(r, 3000))
          addLog('✅ 搜索完成')
        }
      } else if (action === 'like') {
        addLog('❤️ 等待20秒...'); await new Promise(r => setTimeout(r, 20000))
        await api.adbShell(selectedDevice, 'input tap 540 1400')
        addLog('✅ 点赞完成')
      } else if (action === 'comment') {
        await api.adbShell(selectedDevice, 'input tap 540 1500'); addLog('✅ 已打开评论框')
      } else if (action === 'follow') {
        await api.adbShell(selectedDevice, 'input tap 900 200'); addLog('✅ 关注完成')
      } else if (action === 'share') {
        await api.adbShell(selectedDevice, 'input tap 500 1500'); await new Promise(r => setTimeout(r, 2000)); addLog('✅ 转发完成')
      } else if (action === 'extract') {
        const r = await api.adbShell(selectedDevice, 'uiautomator dump /sdcard/ui.xml && cat /sdcard/ui.xml')
        addLog(r.success ? '✅ 采集完成' : '⚠️ ' + (r.error || ''))
      } else if (action === 'publish') {
        addLog('📤 视频推送到手机...')
        // TODO: 选择视频后 adb push 并发布
        addLog('📤 发视频功能开发中...')
      }

      await fetch('/api/my-automation/execute', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform: PLATFORM_KEY[platform], action, keywords: keywordsText.split('\n').filter(Boolean), deviceSerial: selectedDevice }),
      })
      addLog('✅ 全部完成'); showToast('执行完成', 'success')
    } catch (e: any) { addLog('❌ 异常: ' + e.message) }
    setRunning(false)
  }

  if (authLoading) return <Loading />

  return (
    <div className="min-h-screen bg-gray-950">
      <div className="max-w-4xl mx-auto px-4 py-8">
        <div className="mb-8">
          <p className="text-label mb-2">个人自动化 / MY AUTOMATION</p>
          <h1 className="text-mono-lg text-white">本地设备自动化</h1>
          <p className="text-gray-400 text-sm mt-1">连接本地手机，一键执行自动化操作</p>
        </div>

        <div className="card-glass p-4 mb-4">
          <label className="text-xs text-gray-400 mb-2 block">选择设备</label>
          {devices.length === 0 ? (
            <div className="text-center text-gray-500 text-xs py-4">
              <p>暂无已绑定的本地设备</p>
              <p className="mt-1">请在 Electron 客户端中点击「登记设备」申请</p>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {devices.map(d => (
                <button key={d.serial} onClick={() => setSelectedDevice(d.serial)}
                  className={`px-3 py-1.5 rounded-lg text-xs border transition ${selectedDevice === d.serial ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' : 'bg-white/5 text-gray-400 border-white/10 hover:bg-white/10'}`}>
                  {d.name || d.serial.slice(0, 8)}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="card-glass p-4 mb-4">
          <label className="text-xs text-gray-400 mb-2 block">选择平台</label>
          <div className="flex flex-wrap gap-2">
            {PLATFORMS.map(p => (
              <button key={p} onClick={() => setPlatform(p)}
                className={`px-3 py-1.5 rounded-lg text-xs border transition ${platform === p ? 'bg-blue-500/20 text-blue-400 border-blue-500/30' : 'bg-white/5 text-gray-400 border-white/10 hover:bg-white/10'}`}>
                {PLATFORM_ICON[PLATFORM_KEY[p]]} {p}
              </button>
            ))}
          </div>
        </div>

        <div className="card-glass p-4 mb-4">
          <label className="text-xs text-gray-400 mb-2 block">选择动作</label>
          <div className="grid grid-cols-3 gap-2">
            {ACTIONS.map(a => (
              <button key={a.key} onClick={() => setAction(a.key)}
                className={`flex flex-col items-center gap-1 p-3 rounded-xl border text-xs transition ${action === a.key ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' : 'bg-white/5 text-gray-400 border-white/10 hover:bg-white/10'}`}>
                <span className="text-lg">{a.icon}</span>
                <span>{a.label}</span>
                <span className="text-[10px] opacity-60">{a.desc}</span>
              </button>
            ))}
          </div>
        </div>

        {action === 'search' && (
          <div className="card-glass p-4 mb-4">
            <label className="text-xs text-gray-400 mb-2 block">搜索关键词（每行一个）</label>
            <textarea className="input-dark w-full text-sm h-20" placeholder="火锅&#10;美业&#10;减肥" value={keywordsText} onChange={e => setKeywordsText(e.target.value)} />
          </div>
        )}

        {action === 'publish' && <VideoSelector deviceSerial={selectedDevice} />}

        <button onClick={runAction} disabled={running || devices.length === 0 || !isElectron}
          className="w-full py-3 bg-emerald-500 text-white rounded-xl hover:bg-emerald-600 disabled:opacity-50 text-sm font-bold transition">
          {!isElectron ? '⚠️ 请在 Electron 客户端中执行'
            : running ? '⏳ 执行中...'
            : `▶ 在 ${devices.find(d => d.serial === selectedDevice)?.name || '设备'} 上执行`}
        </button>

        {logs.length > 0 && (
          <div className="card-glass p-4 mt-4">
            <label className="text-xs text-gray-400 mb-2 block">执行日志</label>
            <div className="bg-black/30 rounded-lg p-3 max-h-48 overflow-y-auto text-[10px] text-gray-400 font-mono space-y-1">
              {logs.map((l, i) => <p key={i}>{l}</p>)}
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
