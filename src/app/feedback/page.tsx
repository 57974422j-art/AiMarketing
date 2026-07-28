'use client'
import { useState, useEffect, useRef } from 'react'
import { showToast } from '@/components/Toast'

interface MyFeedback {
  id: number
  type: string
  content: string
  status: string
  reply: string | null
  createdAt: string
  imageUrls: string[]
}

const STATUS_CLS: Record<string, string> = {
  '待处理': 'text-amber-400', '处理中': 'text-blue-400', '已解决': 'text-emerald-400', '已关闭': 'text-gray-500',
}
const MAX_IMAGES = 4

export default function FeedbackPage() {
  const [type, setType] = useState('问题')
  const [content, setContent] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [previews, setPreviews] = useState<string[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [mine, setMine] = useState<MyFeedback[]>([])
  const fileRef = useRef<HTMLInputElement>(null)

  const loadMine = () => {
    fetch('/api/feedback', { credentials: 'include' })
      .then(r => r.json())
      .then(d => { if (d.success) setMine(d.data) })
      .catch(() => {})
  }
  useEffect(() => { loadMine() }, [])

  // 预览图管理
  useEffect(() => {
    const urls = files.map(f => URL.createObjectURL(f))
    setPreviews(urls)
    return () => urls.forEach(u => URL.revokeObjectURL(u))
  }, [files])

  const pickFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(e.target.files || [])
    const merged = [...files, ...picked].slice(0, MAX_IMAGES)
    setFiles(merged)
    if (fileRef.current) fileRef.current.value = ''
  }

  const submit = async () => {
    if (!content.trim()) { showToast('请填写反馈内容', 'error'); return }
    setSubmitting(true)
    try {
      const fd = new FormData()
      fd.append('type', type)
      fd.append('content', content.trim())
      files.forEach(f => fd.append('images', f))
      const r = await fetch('/api/feedback', { method: 'POST', credentials: 'include', body: fd })
      const d = await r.json()
      if (d.success) {
        showToast('反馈已提交，感谢！', 'success')
        setContent(''); setFiles([])
        loadMine()
      } else showToast(d.message, 'error')
    } catch { showToast('提交失败，请重试', 'error') } finally { setSubmitting(false) }
  }

  return (
    <div className="min-h-screen bg-gray-950 p-6">
      <div className="max-w-3xl mx-auto">
        <div className="mb-6">
          <h1 className="text-mono-lg text-white">📮 问题反馈</h1>
          <p className="text-gray-500 text-xs mt-1">遇到问题、有建议？告诉我们，支持附截图（最多 {MAX_IMAGES} 张）。</p>
        </div>

        {/* 提交表单 */}
        <div className="card-glass p-5 mb-6">
          <div className="flex gap-2 mb-3">
            {['问题', '建议', '投诉'].map(t => (
              <button key={t} onClick={() => setType(t)}
                className={`px-4 py-1.5 rounded-lg text-xs ${type === t ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30' : 'bg-white/5 text-gray-400'}`}>
                {t}
              </button>
            ))}
          </div>
          <textarea value={content} onChange={e => setContent(e.target.value)} rows={5} maxLength={2000}
            placeholder="请描述你遇到的问题（发生在哪个页面、做了什么操作、看到什么提示）..."
            className="input-dark w-full text-sm p-3 rounded-lg resize-none" />
          <div className="flex items-center justify-between mt-3">
            <div className="flex items-center gap-2">
              <button onClick={() => fileRef.current?.click()} disabled={files.length >= MAX_IMAGES}
                className="px-3 py-1.5 rounded-lg text-xs bg-white/5 text-gray-300 hover:bg-white/10 disabled:opacity-40">
                📷 添加截图 ({files.length}/{MAX_IMAGES})
              </button>
              <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={pickFiles} />
              <span className="text-gray-600 text-[11px]">{content.length}/2000</span>
            </div>
            <button onClick={submit} disabled={submitting || !content.trim()}
              className="px-5 py-1.5 rounded-lg text-xs bg-blue-600 text-white hover:bg-blue-500 disabled:opacity-40">
              {submitting ? '提交中...' : '提交反馈'}
            </button>
          </div>
          {previews.length > 0 && (
            <div className="flex gap-2 mt-3">
              {previews.map((u, i) => (
                <div key={i} className="relative">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={u} alt="" className="w-20 h-20 object-cover rounded-lg border border-white/10" />
                  <button onClick={() => setFiles(fs => fs.filter((_, j) => j !== i))}
                    className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-red-500 text-white text-[10px] leading-5">✕</button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 我的反馈 */}
        <h2 className="text-white text-sm font-bold mb-3">我的反馈</h2>
        {mine.length === 0 ? <p className="text-gray-600 text-xs">暂无反馈记录</p> : (
          <div className="space-y-3">
            {mine.map(fb => (
              <div key={fb.id} className="card-glass p-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2 text-xs">
                    <span className="px-2 py-0.5 rounded bg-white/5 text-gray-400">{fb.type}</span>
                    <span className={STATUS_CLS[fb.status] || 'text-gray-400'}>{fb.status}</span>
                  </div>
                  <span className="text-gray-600 text-[11px]">{new Date(fb.createdAt).toLocaleString('zh-CN')}</span>
                </div>
                <p className="text-gray-300 text-xs whitespace-pre-wrap">{fb.content}</p>
                {fb.imageUrls.length > 0 && (
                  <div className="flex gap-2 mt-2">
                    {fb.imageUrls.map((u, i) => (
                      // eslint-disable-next-line @next/next/no-img-element
                      <a key={i} href={u} target="_blank" rel="noreferrer"><img src={u} alt="" className="w-16 h-16 object-cover rounded border border-white/10" /></a>
                    ))}
                  </div>
                )}
                {fb.reply && (
                  <div className="mt-2 p-2 rounded bg-blue-500/10 border border-blue-500/20">
                    <p className="text-blue-400 text-[11px] mb-0.5">官方回复</p>
                    <p className="text-gray-300 text-xs whitespace-pre-wrap">{fb.reply}</p>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
