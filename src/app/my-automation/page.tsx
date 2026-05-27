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
  { key: 'publish', label: '发视频', icon: '📤', desc: '推送到手机执行发布' },
]

function VideoSelector({ deviceSerial, selected, onSelect }: { deviceSerial: string; selected: any; onSelect: (v: any) => void }) {
  const [videos, setVideos] = useState<any[]>([])
  const [userId, setUserId] = useState('')
  useEffect(() => {
    fetch('/api/storage/files', { credentials: 'include' }).then(r => r.json()).then(d => {
      setVideos(d?.success ? d.data.files : []); if (d?.success) setStUserId(d.data.userId)
    }).catch(() => {})
  }, [])

  return (
    <div className="card-glass p-4 mb-4">
      <label className="text-xs text-gray-400 mb-2 block">从仓库选择视频</label>
      {videos.length === 0 ? (
        <p className="text-xs text-gray-500 text-center py-3">仓库暂无视频，先在AI工具生成视频后保存</p>
      ) : (
        <div className="grid grid-cols-3 gap-2 mb-3">
          {videos.map((v: any) => (
            <button key={v.name} onClick={() => onSelect({...v, videoUrl: "/api/storage/file?userId="+userId+"&name="+encodeURIComponent(v.name)})}
              className={`p-2 rounded-xl border text-xs text-center transition ${selected?.name === v.name ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' : 'bg-white/5 text-gray-400 border-white/10 hover:bg-white/10'}`}>
              <p className="truncate">{v.name}</p>
              <p className="text-[10px] text-gray-600">{(v.size / 1024 / 1024).toFixed(1) + 'MB'}</p>
            </button>
          ))}
        </div>
      )}
      {selected && <p className="text-[10px] text-gray-500 mt-1">已选: {selected.name}</p>}
    </div>
  )
}

export default function MyAutomationPage() {
  const { user, loading: authLoading } = useAuth()

  const [devices, setDevices] = useState<any[]>([])
  const [selectedDevice, setSelectedDevice] = useState('')
  const [platform, setPlatform] = useState('抖音')
  const [action, setAction] = useState('like')
  const [keywordsText, setKeywordsText] = useState('')
  const [pushing, setPushing] = useState(false)

  // 发视频专用
  const [publishTitle, setPublishTitle] = useState('')
  const [publishHook, setPublishHook] = useState('')
  const [selectedVideo, setSelectedVideo] = useState<any>(null)

  useEffect(() => {
    if (!user) return
    fetch('/api/accounts', { credentials: 'include' }).then(r => r.json()).then(d => {
      const list = Array.isArray(d) ? d : d.data || []
      const myDevices = list.filter((a: any) => a.platform === 'local-device' && a.isBound && a.accountId).map((a: any) => ({ serial: a.accountId, name: a.accountName }))
      setDevices(myDevices)
      if (myDevices.length > 0) setSelectedDevice(myDevices[0].serial)
    }).catch(() => {})
  }, [user])

  const handlePush = async () => {
    if (!selectedDevice) { showToast('请选择设备', 'error'); return }
    if (action === 'publish' && !selectedVideo) { showToast('请选择视频', 'error'); return }

    setPushing(true)
    try {
      const r = await fetch('/api/tasks/push', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deviceSerial: selectedDevice,
          platform: PLATFORM_KEY[platform],
          action,
          keywords: keywordsText.split('\n').filter(Boolean),
          videoUrl: selectedVideo?.name ? '/api/storage/file?userId=' + stUserId + '&name=' + encodeURIComponent(selectedVideo.name) : '',
          title: publishTitle,
          hook: publishHook,
        }),
      })
      const d = await r.json()
      if (d.success) {
        showToast('✅ 已推送到设备，去运行页面执行', 'success')
        setPublishTitle(''); setPublishHook(''); setSelectedVideo(null)
      } else {
        showToast('推送失败: ' + (d.message || ''), 'error')
      }
    } catch (e: any) {
      showToast('异常: ' + e.message, 'error')
    }
    setPushing(false)
  }

  if (authLoading) return <Loading />

  return (
    <div className="min-h-screen bg-gray-950">
      <div className="max-w-4xl mx-auto px-4 py-8">
        <div className="mb-8">
          <p className="text-label mb-2">个人自动化 / MY AUTOMATION</p>
          <h1 className="text-mono-lg text-white">创建推送任务</h1>
          <p className="text-gray-400 text-sm mt-1">配置任务后推送到本地设备，再到运行页面执行</p>
        </div>

        <div className="card-glass p-4 mb-4">
          <label className="text-xs text-gray-400 mb-2 block">选择设备</label>
          {devices.length === 0 ? (
            <div className="text-center text-gray-500 text-xs py-4">
              <p>暂无已绑定的本地设备</p>
              <p className="mt-1">请先登记并等待审核</p>
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

        {action === 'publish' && (
          <>
            <div className="card-glass p-4 mb-4">
              <label className="text-xs text-gray-400 mb-2 block">视频标题 <span className="text-gray-600">（发布时的文案）</span></label>
              <input className="input-dark w-full text-sm mb-3" placeholder="如：双十一必买清单！错过等一年！" value={publishTitle} onChange={e => setPublishTitle(e.target.value)} />
              <label className="text-xs text-gray-400 mb-2 block">勾子 <span className="text-gray-600">（引导互动的结尾文案）</span></label>
              <input className="input-dark w-full text-sm" placeholder="如：评论区告诉我你想看什么" value={publishHook} onChange={e => setPublishHook(e.target.value)} />
            </div>
            <VideoSelector deviceSerial={selectedDevice} selected={selectedVideo} onSelect={setSelectedVideo} />
          </>
        )}

        <button onClick={handlePush} disabled={pushing || devices.length === 0}
          className="w-full py-3 bg-emerald-500 text-white rounded-xl hover:bg-emerald-600 disabled:opacity-50 text-sm font-bold transition">
          {pushing ? '⏳ 推送中...' : `📤 推送到设备`}
        </button>

        <p className="text-[10px] text-gray-600 text-center mt-2">
          推送后请到「账号管理」→ 本地设备 → 点「运行」执行
        </p>
      </div>
    </div>
  )
}

function Loading() {
  return <div className="min-h-screen bg-gray-950 flex items-center justify-center"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-400" /></div>
}
