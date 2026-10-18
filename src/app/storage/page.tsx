'use client'
import TourGuide from '@/components/TourGuide'
import { useState, useEffect, useRef } from 'react'
import { useAuth } from '@/app/providers'
import { showToast } from '@/components/Toast'

interface FileInfo {
  name: string; size: number; mtime: string; isVideo?: boolean; thumbUrl?: string | null
  /** ★VF_REPOSPLIT_V1：`gen` = 系统生成物（`gen_日期_序号.ext`）｜`asset` = 用户原始素材（列表接口下发） */
  kind?: 'gen' | 'asset'
}
/* ★VF_QUOTA_V3：加 `genUsed`（生成素材占用，只展示不参与拒传判定 —— 见 lib/storage-quota.ts 注释） */
interface Quota { used: number; total: number; genUsed?: number | null }

export default function StoragePage() {
  const { user } = useAuth()
  const [files, setFiles] = useState<FileInfo[]>([])
  const [quota, setQuota] = useState<Quota>({ used: 0, total: 500 * 1024 * 1024 })
  const [loading, setLoading] = useState(true)
  const [userId, setUserId] = useState<number>(0)
  const [pushFile, setPushFile] = useState<string | null>(null)
  const [pushLoading, setPushLoading] = useState(false)
  const [showPushDlg, setShowPushDlg] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [devices, setDevices] = useState<any[]>([])
  const [pushDevice, setPushDevice] = useState<any>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  // ★VF_LOCAL_BACKUP_V1（2026-09-24 用户要求）：一键备份到本地仓库 —— 进度状态
  const [backing, setBacking] = useState(false)
  const [backed, setBacked] = useState(0)
  // ★VF_THUMBGC_V1（2026-10-12 收口「缩略图孤儿」）：清理按钮的进行中状态
  const [cleaning, setCleaning] = useState(false)
  // ★VF_THUMBREBUILD_V1（2026-10-12 用户定案「个人仓库这里 先修改好」）：重建缩略图按钮的进行中状态
  const [rebuilding, setRebuilding] = useState(false)
  // ★VF_REPOSPLIT_V1b（2026-10-12 用户实测「我没看见切换生成素材原始素材的按键」）：
  //   **切换按键**（分段控件）：全部 / 原始素材 / 生成素材。
  const [tab, setTab] = useState<'all' | 'asset' | 'gen'>('all')

  const load = async () => {
    setLoading(true)
    try {
      const r = await fetch('/api/storage/files', { credentials: 'include' })
      const d = await r.json()
      if (d.success) { setFiles(d.data.files); setQuota({ used: d.data.used, total: d.data.total, genUsed: d.data.genUsed }); setUserId(d.data.userId) }
    } catch {}
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const upload = async () => {
    const f = fileRef.current?.files?.[0]
    if (!f) return
    if (quota.used + f.size > quota.total) { showToast('空间不足', 'error'); return }
    const fd = new FormData(); fd.append('file', f)
    try {
      const r = await fetch('/api/storage/files', { method: 'POST', body: fd, credentials: 'include' })
      const d = await r.json()
      if (d.success) { showToast('上传成功', 'success'); load(); const upUrl = `/api/storage/file?userId=${userId}&name=${encodeURIComponent(f.name)}&persist=1`; (window as any).electronAPI?.storageMirror?.(upUrl) }
      else showToast(d.message || '上传失败', 'error')
    } catch { showToast('上传失败', 'error') }
  }

  const del = async (name: string) => {
    try {
      const r = await fetch('/api/storage/delete', { method: 'DELETE', body: JSON.stringify({ name }), headers: { 'Content-Type': 'application/json' }, credentials: 'include' })
      const d = await r.json()
      if (d.success) { showToast('已删除', 'success'); load() }
    } catch {}
  }

  // ★VF_REPOSPLIT_V1b：批量删除（按钮终于在界面上接上了 —— 之前 delBatch 是**死函数**，界面上没有入口）
  //   ① 只删**当前显示这组**选中的（切到"生成素材"就只删生成素材）；
  //   ② 删的是 **OSS 上的对象本体**（不可恢复）⇒ 必须先确认，并把数量写清。
  const delBatch = async () => {
    if (!selected.size) return
    const names = Array.from(selected)
    if (!window.confirm(`将从 OSS 彻底删除 ${names.length} 个文件（不可恢复）：\n`
      + `当前分组：${tab === 'gen' ? '生成素材' : tab === 'asset' ? '原始素材' : '全部'}\n\n确定删除吗？`)) return
    try {
      const r = await fetch('/api/storage/delete', { method: 'DELETE', body: JSON.stringify({ names }), headers: { 'Content-Type': 'application/json' }, credentials: 'include' })
      const d = await r.json()
      if (d.success) { showToast(d.message || '已删除', 'success'); setSelected(new Set()); load() }
      else showToast(d.message || '删除失败', 'error')
    } catch { showToast('删除失败', 'error') }
  }

  /* ★VF_DELORDER_V1（2026-10-18 用户定案「**现在你看怎么成套删，能删除就行**」）：
       **删整单** —— 点一个 `.html`，把它这一单的文件一起彻底删：
         ① 该 HTML 本身（单文件版或配图版）
         ② **它引用的所有生成素材图**（从 HTML 原文里读 `src="gen_…"` / `url(gen_…)`）
         ③ **同一天、编号相邻的另一份 HTML**（`gen_YYYYMMDD_N` 的 N 差 1~3）——
            因为「单文件版 / 配图版」是连着编号的，用户不必点两次
         ④ 缩略图由服务端 `/api/storage/delete` 自动连带删（`storage/<uid>/.thumbs/<stem>.jpg`）
       ⚠️ 两步保险：**先弹确认框列出清单**（含个数），再删 ⇒ 不会误删。
       ⚠️ 读的是 `/api/storage/file`（**原始 HTML**），不是 `htmlview`（那个会把图名改写成签名短链，提取不到）。 */
  const delOrder = async (htmlName: string) => {
      try {
        showToast('正在读取这一单引用的图…', 'success')
        const r = await fetch(`/api/storage/file?userId=${userId}&name=${encodeURIComponent(htmlName)}`, { credentials: 'include' })
        if (!r.ok) { showToast('读不到这份 HTML（可能已被删）', 'error'); return }
        const txt = await r.text()
        const imgs = Array.from(new Set(
          Array.from(txt.matchAll(/(?:src\s*=\s*["']|url\(\s*["']?)(gen_[A-Za-z0-9_.-]+\.(?:jpg|jpeg|png|webp))/gi)).map((m) => m[1]),
        ))
        const names: string[] = [htmlName, ...imgs]
        // 同一天、编号相邻的 HTML（单文件版 / 配图版是一对）
        const base = htmlName.replace(/\.html?$/i, '')
        const mm = base.match(/^(gen_\d{8})_(\d+)$/)
        if (mm) {
          const day = mm[1], num = Number(mm[2])
          try {
            const r2 = await fetch(`/api/storage/files?userId=${userId}`, { credentials: 'include' })
            const j2 = await r2.json()
            const all: string[] = ((j2?.data?.files) || j2?.files || []).map((x: any) => String(x.name || ''))
            for (let d = -3; d <= 3; d++) {
              if (!d) continue
              const cand = day + '_' + String(num + d).padStart(3, '0') + '.html'
              if (all.includes(cand)) { names.push(cand); break }   // 只取最近的一份，避免连带别的单
            }
          } catch { /* 列表拿不到就只删当前这份 */ }
        }
        const list = Array.from(new Set(names))
        if (!window.confirm('将**彻底删除**这一单的 ' + list.length + ' 个文件（含缩略图，不可恢复）：\n\n'
          + list.slice(0, 8).join('\n') + (list.length > 8 ? '\n… 等 ' + list.length + ' 个' : ''))) return
        const d = await fetch('/api/storage/delete', {
          method: 'DELETE', body: JSON.stringify({ names: list }),
          headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        }).then((x) => x.json())
        if (d.success) { showToast(d.message || '已删除', 'success'); setSelected(new Set()); load() }
        else showToast(d.message || '删除失败', 'error')
      } catch { showToast('删除失败', 'error') }
      }

      const toggleSelect = (name: string) => {
      setSelected(prev => { const s = new Set(prev); s.has(name) ? s.delete(name) : s.add(name); return s })
      }
  // ★VF_REPOSPLIT_V1b：两组 + 当前显示的那组（全选/批量删除只作用于**当前显示**的这组）
  const assetFiles = files.filter(f => (f.kind === 'gen' ? false : true))
  const genFiles = files.filter(f => f.kind === 'gen')
  const shown = tab === 'all' ? files : tab === 'gen' ? genFiles : assetFiles
  const allSelected = shown.length > 0 && shown.every(f => selected.has(f.name))
  const toggleAll = () => {
    setSelected(allSelected ? new Set() : new Set(shown.map(f => f.name)))
  }
  // ★2026-09-22（用户实测「点下载弹窗非常慢」）：原来是 fetch → blob → createObjectURL → a.click()
  //   —— 必须**等整个文件下载完**才会弹出"另存为"（大视频等于卡住不动）。
  //   改为**浏览器原生下载**：直接把一个同源下载地址交给 <a>，浏览器立刻弹保存框、边下边写盘；
  //   服务端同步改成流式转发（见 api/storage/file），不再把整文件读进内存。
  const download = (name: string) => {
    const url = `/api/storage/file?userId=${userId}&name=${encodeURIComponent(name)}&download=1`
    try {
      const a = document.createElement('a')
      a.href = url
      a.download = name
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
    } catch {
      showToast('下载失败', 'error')
    }
  }

  const doPush = async () => {
    if (!pushFile || !pushDevice) return
    setPushLoading(true)
    try {
      const r = await fetch('/api/storage/push-to-phone', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileName: pushFile }),
      })
      const d = await r.json()
      if (d.success) showToast(`已推送到 ${pushDevice.name}`, 'success')
      else showToast(d.message || '推送失败', 'error')
    } catch { showToast('推送失败', 'error') }
    finally { setShowPushDlg(false); setPushFile(null); setPushDevice(null); setPushLoading(false) }
  }

  // ═══ ★VF_LOCAL_BACKUP_V1（2026-09-24 用户要求「各个仓库加一个一键备份到本地」）═══
  //   背景：素材目前只存在 OSS 个人仓库 —— 误删就没了；而客户端本来就有"本地仓库"
  //   （`electronAPI.storageMirror` → 落到本机 storage 目录）。
  //   这里把"单文件镜像"扩成【一键批量备份】：逐个镜像 + 进度 + 结束给结论。
  //   ⚠️ 只有【在客户端里打开】才有 electronAPI；浏览器里直接提示不可用（不假装成功）。
  // ★VF_THUMBGC_V1（2026-10-12 收口「缩略图孤儿」）：清理 `.thumbs/` 下**没有主文件**的缩略图
  //   （2026-10-10 之前删掉的素材留下的，以及 analyze/ 这类别的线写的）——**用户点才删**，结果如实回报。
  const cleanThumbs = async () => {
    setCleaning(true)
    try {
      const r = await fetch('/api/storage/cleanup-thumbs', { method: 'POST', credentials: 'include' })
      const d = await r.json()
      if (d.success) { showToast(d.message || '已清理', 'success'); load() }
      else showToast(d.message || '清理失败', 'error')
    } catch { showToast('清理失败', 'error') }
    finally { setCleaning(false) }
  }

  // ★VF_THUMBREBUILD_V1（2026-10-12 用户定案「个人仓库这里 先修改好」）：**重建缩略图**
  //   与「清理孤儿」分工：孤儿 = `.thumbs/` 里**没有主文件**（历史垃圾）；
  //   重建 = 有主文件、但缩略图**内容不对**（旧帧/张冠李戴）⇒ 删掉后由列表懒补齐**按现视频重抽**。
  //   ⚠️ 只删缩略图，不碰任何素材；用户点才删。
  const rebuildThumbs = async () => {
    setRebuilding(true)
    try {
      const r = await fetch('/api/storage/rebuild-thumbs', { method: 'POST', credentials: 'include' })
      const d = await r.json()
      if (d.success) { showToast(d.message || '已重建缩略图', 'success'); load() }
      else showToast(d.message || '重建失败', 'error')
    } catch { showToast('重建失败', 'error') }
    finally { setRebuilding(false) }
  }

  const backupAll = async () => {
    const api = (window as any).electronAPI
    if (!api?.storageMirror) { showToast('一键备份只在客户端里可用（浏览器没有本地仓库）', 'error'); return }
    if (!files.length) { showToast('个人仓库里没有素材', 'error'); return }
    setBacking(true); setBacked(0)
    // ★LOCAL_BACKUP_FIX_V1（2026-09-28 用户实测「提示下载了，去本地仓库看什么都没有」）：
    //   旧实现【没 await、也没看返回值】，只要调用没当场抛错就 n++ →
    //   于是后端失败（当时把相对路径当绝对路径解析，必然 Invalid URL）也照样提示"已发起备份 N/N"。
    //   现在逐个 await + 如实统计，并把落盘目录/失败原因直接告诉用户。
    let done = 0, failed = 0, lastErr = '', dir = ''
    for (const f of files) {
      try {
        const r = await api.storageMirror(`/api/storage/file?userId=${userId}&name=${encodeURIComponent(f.name)}&persist=1`)
        if (r && r.success) {
          done++
          if (r.path) dir = String(r.path).replace(/[\\/][^\\/]*$/, '')
        } else { failed++; lastErr = (r && r.error) || '未知错误' }
      } catch (e: any) { failed++; lastErr = String((e && e.message) || e) }
      setBacked(done + failed)
    }
    setBacking(false)
    if (!failed) showToast(`已备份 ${done} 个到本地仓库${dir ? '：' + dir : ''}`, 'success')
    else showToast(`备份完成 ${done} 个，失败 ${failed} 个${lastErr ? '（' + lastErr + '）' : ''}`, 'error')
  }

  const pct = Math.round(quota.used / quota.total * 100)
  const fmt = (b: number) => (b / 1024 / 1024).toFixed(1) + 'MB'

  return (
    <div className="min-h-screen bg-gray-950">
        <TourGuide />
      <div className="max-w-6xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="mb-8">
          {/* ★VF_REPO_NAME_V1（2026-10-08 用户定案「个人仓库 有『素材仓库』字样，一直没改，你可以改下」）：
              全站口径统一成**个人仓库**（这里以前写「素材管理 / 素材仓库」）。
              ⚠️ 只改**显示名**：路由仍是 /storage、接口与字段（files/quota/素材名单）一律不动 ⇒ 零回归。 */}
          <p className="text-xs tracking-[0.2em] text-gray-500 mb-1 font-mono">个人仓库 / STORAGE</p>
          <h1 className="text-mono-lg text-white">个人仓库 / MY LIBRARY</h1>
          <p className="text-sm text-gray-500 mt-1 font-mono">
            上传、管理与推送你的图片 / 视频 · 配额 {fmt(quota.total)}
          </p>
        </div>

        {/* 操作栏 */}
        <div className="flex items-center justify-between mb-6">
          <input ref={fileRef} type="file" accept="image/*,video/*" className="hidden" onChange={upload} />
          <div className="flex items-center gap-3">
            <button onClick={() => fileRef.current?.click()} className="btn-primary text-sm">+ 上传素材</button>
            {/* ★VF_LOCAL_BACKUP_V1（P1③）：一键把个人仓库的素材镜像到本机本地仓库（防误删） */}
            <button
              onClick={backupAll}
              disabled={backing || !files.length}
              title="把素材仓库里的文件逐个备份到本机（仅客户端可用）"
              className="text-sm px-3 py-2 rounded-lg bg-white/[0.06] hover:bg-white/[0.12] text-gray-200 border border-white/[0.08] disabled:opacity-50"
            >
              {backing ? `⏳ 备份中 ${backed}/${files.length}` : '⬇️ 一键备份到本地'}
            </button>
            {/* ★VF_THUMBGC_V1：清理"没有主文件"的孤儿缩略图（历史遗留 + analyze/ 这类别的线写的） */}
            <button
              onClick={cleanThumbs}
              disabled={cleaning}
              title="清理 .thumbs 里找不到主文件的缩略图（历史遗留垃圾，不影响任何素材）"
              className="text-sm px-3 py-2 rounded-lg bg-white/[0.06] hover:bg-white/[0.12] text-gray-200 border border-white/[0.08] disabled:opacity-50"
            >
              {cleaning ? '⏳ 清理中…' : '🧹 清理孤儿缩略图'}
            </button>
            {/* ★VF_THUMBREBUILD_V1（用户定案「个人仓库这里先修改好」）：**重建缩略图** ——
                「缩略图和素材不一样」时点它：删掉现有缩略图 ⇒ 刷新后系统按**现在的视频**重抽一帧。
                与「清理孤儿」的分工写在 title 里（孤儿=没主文件；重建=有主文件但图不对）。 */}
            <button
              onClick={rebuildThumbs}
              disabled={rebuilding}
              title="缩略图和视频对不上时点这个：删掉现有缩略图，刷新后按现在的视频重新抽帧（只动缩略图，不动素材）"
              className="text-sm px-3 py-2 rounded-lg bg-amber-500/[0.12] hover:bg-amber-500/[0.22] text-amber-100 border border-amber-400/25 disabled:opacity-50"
            >
              {rebuilding ? '⏳ 重建中…' : '🖼 重建缩略图'}
            </button>
          </div>
        </div>

        {/* Quota bar */}
        <div className="card-glass p-3 mb-4">
          <div className="flex justify-between text-[10px] text-gray-400 mb-1">
            <span>存储空间</span>
            <span>
              {fmt(quota.used)} / {fmt(quota.total)} ({pct}%)
              {/* ★VF_QUOTA_V3（2026-10-18 用户实测「存储空间 0.0MB / 450MB (0%)，这个要改，没计算生成素材」）：
                  **生成素材占用单独显示**。⚠️ 刻意**不并入**这条进度条：
                  拒传判定仍只看"用户自己上传的原始素材"，否则生成几单就撞 450MB、连原图都传不上来。
                  这一行是"看得见、能自己清"，不是配额。 */}
              {typeof quota.genUsed === 'number' && (
                <span className="ml-2 text-amber-300/80"
                  title="AI 生成物的实际占用（HTML + 配图 + 成片 mp4 + 缩略图）。不计入上面的配额，但确实占 OSS 空间，建议定期用「删整单」清理。">
                  · 生成素材 {fmt(quota.genUsed)}
                </span>
              )}
              {quota.genUsed === null && (
                <span className="ml-2 text-gray-500" title="统计失败（OSS 列表拿不到）">· 生成素材 —</span>
              )}
            </span>
          </div>
          <div className="w-full h-2 bg-white/5 rounded-full overflow-hidden">
            <div className="h-full bg-emerald-500/60 rounded-full transition-all" style={{ width: Math.min(pct, 100) + '%' }} />
          </div>
          {pct >= 90 && <p className="text-[10px] text-red-400 mt-1">空间即将用满，请清理或联系管理员</p>}
        </div>

        {/* ★VF_REPOSPLIT_V1b（2026-10-12 用户实测「我没看见切换生成素材原始素材的按键」）：
            这里给的是**切换按键**（分段控件）—— 全部 / 原始素材 / 生成素材 + 数量；列表只显示当前这组。
            （上一版做成了"同页两个分组标题"，不是切换 —— 用户要的是切换。） */}
        {!loading && files.length > 0 && (
          <div className="flex items-center gap-2 mb-3 flex-wrap">
            {[{ k: 'all' as const, t: '全部', n: files.length },
              { k: 'asset' as const, t: '原始素材', n: assetFiles.length },
              { k: 'gen' as const, t: '生成素材', n: genFiles.length }].map((o) => (
              <button key={o.k} onClick={() => { setTab(o.k); setSelected(new Set()) }}
                className={'px-3 py-1.5 rounded-lg text-xs border transition ' + (tab === o.k
                  ? 'bg-white/[0.14] border-white/25 text-white'
                  : 'bg-white/[0.04] border-white/10 text-gray-400 hover:bg-white/[0.10]')}>
                {o.t} <span className="text-[10px] opacity-70">{o.n}</span>
              </button>
            ))}
            <span className="text-[10px] text-gray-500">
              {tab === 'gen'
                ? '系统产出（成片 / 审片图 / 预览）· 不占配额 · 不进选材池'
                : tab === 'asset'
                  ? '你上传的图片 / 视频 · 出片时从这里选'
                  : '生成素材不占配额、不进选材池；老成片也认得出（按出片记录）'}
            </span>
            {/* ★VF_REPOSPLIT_V1b：批量删除入口（先前 delBatch 是死函数、界面上没按钮）——
                全选/清空/删除**都只作用于当前这组**；删除 = OSS 真删（按钮里会二次确认）。 */}
            <span className="flex-1" />
            <button onClick={toggleAll}
              className="px-3 py-1.5 rounded-lg text-xs border bg-white/[0.04] border-white/10 text-gray-300 hover:bg-white/[0.10]">
              {allSelected ? '取消全选' : `全选本组 ${shown.length}`}
            </button>
            {/* ★VF_DELETEALL_V1（2026-10-12 用户问「个人仓库中的全部删除键去哪里了」）：
                给一个**跨分组**的"全选全部"入口 —— 选中数 = 全部时，下面的按钮会变成「删除全部 N」，
                也就是**一键删全部**（仍然走 delBatch 的二次确认：删除 = OSS 真删、不可恢复）。 */}
            <button onClick={() => setSelected(new Set(files.map(f => f.name)))}
              title="选中两个分组里的全部文件（选中后按钮会变成「删除全部」）"
              className="px-3 py-1.5 rounded-lg text-xs border bg-white/[0.04] border-white/10 text-gray-300 hover:bg-white/[0.10]">
              全选全部 {files.length}
            </button>
            {selected.size > 0 && (
              <>
                <button onClick={() => setSelected(new Set())}
                  className="px-3 py-1.5 rounded-lg text-xs border bg-white/[0.04] border-white/10 text-gray-400 hover:bg-white/[0.10]">
                  清空选择
                </button>
                <button onClick={delBatch}
                  className={'px-3 py-1.5 rounded-lg text-xs border hover:bg-red-500/30 '
                    + (files.length > 0 && selected.size >= files.length
                      ? 'bg-red-500/35 border-red-400/60 text-white'
                      : 'bg-red-500/20 border-red-400/40 text-red-200')}>
                  {files.length > 0 && selected.size >= files.length
                    ? `删除全部 ${selected.size}`
                    : `删除选中 ${selected.size}`}
                </button>
              </>
            )}
          </div>
        )}

        {loading ? <p className="text-gray-400 text-xs">加载中...</p> : files.length === 0 ? (
          <p className="text-gray-500 text-xs text-center py-10">暂无文件，上传你的第一个素材吧</p>
        ) : shown.length === 0 ? (
          <p className="text-gray-500 text-xs text-center py-10">
            {tab === 'gen' ? '还没有生成素材（出片后会出现在这里）' : '这一组还没有文件'}
          </p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
            {shown.map(f => (
              <div key={f.name} className="card-glass p-2 rounded-lg relative group">
                {/* 缩略图 */}
                <div className="aspect-video bg-white/5 rounded mb-1 overflow-hidden flex items-center justify-center">
                  {f.isVideo ? (
                    /* ★VF_STORAGE_OOM_V1（2026-10-18 用户实测「成片可以进入 但一会就崩溃 页面没有了只有底色」）：
                       `preload="metadata"` ⇒ **每个视频一进列表就去拉文件头 + 建一个解码器实例**。
                       成片一多（20+ 个 mp4）⇒ 内存爆 ⇒ **标签页崩溃**（"进去几秒后只剩底色"正是元数据陆续加载完的那一刻）。
                       现口径：**`preload="none"`** —— 只显示 poster（缩略图），**点播放才真正加载**。
                       显示效果不变（缩略图照旧），内存从"N 个解码器"降到 0。 */
                    <video
                      src={`/api/storage/file?userId=${userId}&name=${encodeURIComponent(f.name)}`}
                      poster={f.thumbUrl || undefined}
                      className="w-full h-full object-cover"
                      controls
                      preload="none"
                    />
                  ) : f.thumbUrl ? (
                    <img src={f.thumbUrl} alt={f.name} loading="lazy" className="w-full h-full object-cover" />
                  ) : /\.(jpg|jpeg|png|gif|webp)$/i.test(f.name) ? (
                    <img src={`/api/storage/file?userId=${userId}&name=${encodeURIComponent(f.name)}`} alt={f.name} loading="lazy" className="w-full h-full object-cover" />
                  ) : (
                    <span className="text-2xl">📄</span>
                  )}
                </div>
                {/* ★VF_HTMLVIEW_V1（2026-10-13 用户实测「个人仓库也打不开」）：.html 走**站内预览页**
                    （`/preview/repo`，同源、服务端直出 text/html）；其它文件仍按老口径直接开/播。 */}
                <p className="text-[10px] text-gray-300 truncate cursor-pointer" onClick={()=>{
                  const isHtml = /\.(html?|svg)$/i.test(f.name)
                  const url = isHtml
                    ? '/preview/repo?userId='+userId+'&name='+encodeURIComponent(f.name)
                    : '/api/storage/file?userId='+userId+'&name='+encodeURIComponent(f.name)
                  window.open(url,'_blank')
                }}>{f.name}</p>
                <p className="text-[9px] text-gray-500">{fmt(f.size)}</p>
                <div className="flex gap-1 mt-1">
                  {f.isVideo && (
                    <button onClick={async () => {
                      setPushFile(f.name)
                      // admin 看全部设备，end-user 只看自己绑定的
                      const url = user?.role === 'admin' ? '/api/devices' : '/api/storage/my-devices'
                      const r = await fetch(url, { credentials: 'include' })
                      const d = await r.json()
                      if (d.success && d.data?.length > 0) { setDevices(d.data); setShowPushDlg(true) }
                      else showToast(d.data?.length === 0 ? '暂无绑定设备' : d.message || '获取失败', 'error')
                    }} className="btn-secondary flex-1 text-[9px] py-1">📤 推送</button>
                  )}
                  <button onClick={() => download(f.name)} className="w-6 h-6 bg-sky-500/80 text-white rounded-full text-[10px] opacity-0 group-hover:opacity-100 transition" title="下载">⬇</button>
                  <button onClick={() => del(f.name)} className="w-6 h-6 bg-red-500/80 text-white rounded-full text-[10px] opacity-0 group-hover:opacity-100 transition" title="删除">×</button>
                  {/* ★VF_DELORDER_V1：**删整单** —— 只对 .html 显示（把这份页面 + 它引用的图 + 相邻的另一份一起删） */}
                  {/\.html?$/i.test(f.name) && (
                    <button onClick={() => void delOrder(f.name)}
                      className="w-6 h-6 bg-rose-600/90 text-white rounded-full text-[10px] opacity-0 group-hover:opacity-100 transition"
                      title="删整单（这份页面 + 它引用的全部图 + 另一份封装，含缩略图）">🗑</button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {showPushDlg && <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center" onClick={()=>{setShowPushDlg(false);setPushFile(null);setPushDevice(null)}}>
          <div className="card-glass p-6 rounded-xl max-w-sm w-full mx-4" onClick={e=>e.stopPropagation()}>
            <h3 className="text-sm font-bold text-white mb-3">选择推送设备</h3>
            <div className="space-y-2 max-h-60 overflow-y-auto mb-4">
              {devices.filter((d:any) => d.type === 'q1' && d.apiPort).map((d: any) => (
                <button key={d.id} onClick={()=>setPushDevice(d)}
                  className={`w-full text-left p-3 rounded-lg border text-xs transition ${pushDevice?.id===d.id?"bg-emerald-500/20 border-emerald-500/30 text-emerald-400":"bg-white/5 border-white/10 text-gray-300 hover:bg-white/10"}`}>
                  <span className="font-mono text-emerald-300">{d.name}</span>
                  <span className="text-gray-500 ml-2">端口 {d.apiPort}</span>
                </button>
              ))}
              {devices.filter((d:any) => d.type === 'q1' && d.apiPort).length === 0 && (
                <p className="text-gray-500 text-xs text-center py-4">暂无可用Q1设备</p>
              )}
            </div>
            <div className="flex gap-2">
              <button onClick={()=>{setShowPushDlg(false);setPushFile(null);setPushDevice(null)}} className="btn-secondary flex-1 text-xs py-2">取消</button>
              <button disabled={!pushDevice||pushLoading} onClick={doPush}
                className={`flex-1 btn-primary text-xs ${(!pushDevice||pushLoading)?'opacity-50 cursor-not-allowed':''}`}>
                {pushLoading?'推送中...':'确认推送'}
              </button>
            </div>
          </div>
        </div>}
      </div>
    </div>
  )
}
