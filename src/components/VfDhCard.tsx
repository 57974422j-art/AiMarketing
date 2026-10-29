'use client'
/* ═══════════════════════════════════════════════════════════════════════════
 * ★VF_DH_V1（2026-10-27）【数字人口播 · 自己的卡片】
 *
 * 用户原话：「数字人不应该跟网页制作那套混在一起，它应该是单独状态机、**呼出页面不一样**。
 *            这里要加仓库选项卡但**不能和成片那个一样**，因为那个完全是为做视频设计的。」
 * ⇒ 本组件**刻意从零写**：不 import 任何 Vf*Card、不共用样式组件、不做"多选/勾选/上限/拼版"
 *   （那些是成片卡的语义）。这里只做三件事：**单选一张照片 / 贴一段文案 / 看结果**。
 *
 * 状态（由服务端下发的 `vj.step` 决定，全部 `dh_` 前缀）：
 *   · dh_photo   选照片（仓库缩略图单选 + 上传一张）
 *   · dh_copy    贴文案（实时算"约 N 字 · ≈N 秒 · 预计 N 点"，口径由服务端下发 cps/perSec）
 *   · dh_running 生成中（**自己**轮询 /api/agent/dh，不阻塞、可离开页面）
 *   · dh_done    交付（播放 + 已存个人仓库 + 再来一条）
 *
 * 协议（只发两种，都是本线自己的前缀）：
 *   VF_DH_FORM:{"at":"photo","name":"x.jpg"}          / {"at":"back"}     回去换照片
 *   VF_DH_FORM:{"at":"copy","script":"…","res":"480P"} / {"at":"abort"}   取消
 *   VF_DH_TASK:{"id":"…"}                           失败后"改一下再生成"（让服务端把文案卡重发一遍）
 * ═══════════════════════════════════════════════════════════════════════════ */
import { useEffect, useRef, useState } from 'react'

const BOX = 'mb-2 p-3 rounded-xl border border-cyan-500/30 bg-cyan-500/[0.05]'
const BTN = 'px-2.5 py-1 rounded-lg text-[11px] transition border'
const BTN_IDLE = 'bg-white/[0.05] border-white/[0.08] text-gray-300 hover:bg-white/[0.1]'
const BTN_ON = 'bg-cyan-500/25 border-cyan-400/40 text-cyan-100'

export default function VfDhCard({ vj, onSend }: { vj: any; onSend: (msg: string) => void }) {
  const step = String(vj?.step || 'dh_photo')

  /* ── 本地视图（running 轮询到结果后要就地切 done，不用再走一趟对话）──────────────── */
  const [view, setView] = useState<'running' | 'done' | 'failed' | ''>('')
  const [waited, setWaited] = useState(0)
  const [videoUrl, setVideoUrl] = useState('')
  const [repoName, setRepoName] = useState('')
  const [failMsg, setFailMsg] = useState('')
  const [, setTick] = useState(0)

  const startedAt = Number(vj?.startedAt) || 0
  const taskId = String(vj?.taskId || '')
  const polling = useRef(false)

  /* ── 1) 生成中：每 6 秒问一次进度（自己轮询，不刷对话）───────────────────────────── */
  useEffect(() => {
    if (step !== 'dh_running' || !taskId) return
    let stopped = false
    let ticks = 0
    const ivSec = setInterval(() => { if (!stopped) setTick((x) => x + 1) }, 1000)   // "已等待 N 秒"计时
    const run = async () => {
      if (polling.current) return
      polling.current = true
      ticks++
      try {
        const r = await fetch('/api/agent/dh?taskId=' + encodeURIComponent(taskId), { credentials: 'include' }).then((x) => x.json())
        if (stopped) return
        if (!r?.ok) {
          // 草稿没了（换了一单/过期）⇒ 别一直转圈，如实说
          setFailMsg(String(r?.message || '这一单已经结束'))
          setView('failed')
          clearInterval(iv)
          return
        }
        if (r.state === 'done' && r.videoUrl) {
          setVideoUrl(String(r.videoUrl))
          setRepoName(String(r.repoName || ''))
          setView('done')
          clearInterval(iv)
        } else if (r.state === 'failed') {
          setFailMsg(String(r.message || '云端生成失败'))
          setView('failed')
          clearInterval(iv)
        } else {
          setWaited(Number(r.waited) || 0)
          if (ticks > 200) {   // 20 分钟还没结果 ⇒ 停轮询，别把页面挂死
            setFailMsg('等太久了（超过 20 分钟还没有结果）。可能云端排队或任务丢了。')
            setView('failed')
            clearInterval(iv)
          }
        }
      } catch { /* 网络抖动：下一轮再问 */ } finally { polling.current = false }
    }
    run()
    const iv = setInterval(run, 6000)
    return () => { stopped = true; clearInterval(iv); clearInterval(ivSec) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, taskId])

  /* ══════════════ 第 1 步：选照片 ══════════════ */
  if (step === 'dh_photo') {
    const images: Array<{ name: string; url: string }> = Array.isArray(vj?.images) ? vj.images : []
    return (
      <div className={BOX}>
        <div className="text-xs text-cyan-300 mb-1">🤖 数字人口播 · 第 1 步 / 共 2 步</div>
        <div className="text-[11px] text-gray-300 mb-2">选一张人像照片（单人 · 正面 · 清晰）</div>
        {vj?.note ? <div className="text-[10px] text-amber-400 mb-2">{String(vj.note)}</div> : null}

        {images.length ? (
          <div className="grid grid-cols-4 gap-2 mb-2">
            {images.map((im) => (
              <button
                key={im.name}
                title={im.name}
                onClick={() => onSend('VF_DH_FORM:' + JSON.stringify({ at: 'photo', name: im.name }))}
                className="relative aspect-[3/4] rounded-lg overflow-hidden border border-white/10 hover:border-cyan-400/60 bg-black/40"
              >
                {im.url ? <img src={im.url} alt={im.name} className="w-full h-full object-cover" /> : null}
                <span className="absolute bottom-0 left-0 right-0 text-[8px] text-gray-300 bg-black/60 px-1 truncate">{im.name}</span>
              </button>
            ))}
          </div>
        ) : (
          <div className="text-[10px] text-gray-500 mb-2">仓库里还没有图片 —— 直接上传一张人像就行。</div>
        )}

        <UploadOne onDone={(name) => onSend('VF_DH_FORM:' + JSON.stringify({ at: 'photo', name }))} />

        <div className="text-[10px] text-gray-500 mt-2">
          {String(vj?.hint || '整张脸要清楚，别太远、别侧脸。')}
        </div>
        <div className="text-[9px] text-gray-600 mt-1">
          照片会先做一次**人脸检测**：不是人像的话会被拦下，**不扣点、也不提交**。
        </div>
      </div>
    )
  }

  /* ══════════════ 第 2 步：贴文案 ══════════════ */
  if (step === 'dh_copy') {
    return <CopyForm vj={vj} onSend={onSend} />
  }

  /* ══════════════ 生成中 / 交付 ══════════════ */
  const running = view ? view === 'running' : true
  const shownWaited = waited || (startedAt ? Math.max(0, Math.round((Date.now() - startedAt) / 1000)) : 0)

  if (step === 'dh_running' && running && view !== 'done' && view !== 'failed') {
    return (
      <div className={BOX}>
        <div className="text-xs text-cyan-300 mb-2">🤖 数字人口播 · 生成中</div>
        <div className="flex items-center gap-2 mb-2">
          <span className="inline-block w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />
          <span className="text-[11px] text-gray-300">已等待 {shownWaited} 秒（一般 2~6 分钟）</span>
        </div>
        <div className="text-[10px] text-gray-500 mb-2">
          可以离开这个页面 —— 回来我继续盯着这一单（关掉浏览器也不影响云端生成）。
        </div>
        <div className="text-[10px] text-gray-400 mb-2">
          参数：{String(vj?.res || '480P')} · 约 {Number(vj?.sec) || 0} 秒 · {Number(vj?.cost) || 0} 点（**出片成功才扣**）
        </div>
        <button
          className={BTN + ' ' + BTN_IDLE}
          onClick={() => onSend('VF_DH_FORM:' + JSON.stringify({ at: 'abort' }))}
        >取消这一单</button>
      </div>
    )
  }

  if (view === 'failed' || (step === 'dh_running' && view === '' && failMsg)) {
    return (
      <div className={BOX}>
        <div className="text-xs text-amber-300 mb-2">🤖 数字人口播 · 没成</div>
        <div className="text-[11px] text-amber-200/90 whitespace-pre-wrap mb-2">{failMsg || '云端生成失败'}</div>
        <div className="text-[9px] text-gray-500 mb-2">照片和文案都留着，改一下再点生成。</div>
        <div className="flex gap-2">
          <button className={BTN + ' ' + BTN_ON} onClick={() => onSend('VF_DH_TASK:' + JSON.stringify({ id: taskId }))}>
            改一下再生成
          </button>
          <button className={BTN + ' ' + BTN_IDLE} onClick={() => onSend('数字人')}>重新开始</button>
        </div>
      </div>
    )
  }

  /* dh_done（或轮询到 done） */
  const url = videoUrl || String(vj?.videoUrl || '')
  const name = repoName || String(vj?.repoName || '')
  return (
    <div className={BOX}>
      <div className="text-xs text-cyan-300 mb-2">🤖 数字人口播 · 完成</div>
      {url ? (
        <video src={url} controls playsInline preload="metadata" className="w-full max-h-[420px] rounded-lg bg-black" />
      ) : (
        <div className="text-[11px] text-amber-400">成片链接没拿到（可到个人仓库里找 {name || '这条视频'}）。</div>
      )}
      <div className="text-[10px] text-gray-500 mt-2">
        {name ? `已存入个人仓库：${name}` : '已提交，稍后可在个人仓库里看到'}
        {Number(vj?.sec) ? ` · ${String(vj?.res || '480P')} · 约 ${Number(vj.sec)} 秒 · ${Number(vj?.cost) || 0} 点` : ''}
      </div>
      <div className="flex gap-2 mt-2">
        <button className={BTN + ' ' + BTN_ON} onClick={() => onSend('数字人')}>再来一条</button>
        {url ? <a href={url} target="_blank" rel="noreferrer" className={BTN + ' ' + BTN_IDLE}>下载</a> : null}
      </div>
    </div>
  )
}

/* ── 上传一个文件（照片 / 声音样本共用；本线只要**一个**）──────────────────────────── */
function UploadOne({ onDone, accept = 'image/*', label = '⬆️ 上传一张照片' }: {
  onDone: (name: string) => void
  /** ★VF_DH_VOICE_V1：声音样本要放开音频类型 */
  accept?: string
  label?: string
}) {
  const ref = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const doUpload = async (files: FileList | null) => {
    const f = files?.[0]
    if (!f) return
    setBusy(true)
    setErr('')
    try {
      const fd = new FormData()
      fd.append('file', f)
      const r = await fetch('/api/storage/files', { method: 'POST', body: fd, credentials: 'include' })
      const j = await r.json().catch(() => null)
      if (j?.success) {
        const name = String(j?.data?.name || f.name)
        // 客户端在场就顺手镜像到本地仓库（与其它上传一致；浏览器里没有这个 API，跳过即可）
        try { (window as any).electronAPI?.storageMirror?.(`/api/storage/file?name=${encodeURIComponent(name)}`) } catch { /* ignore */ }
        onDone(name)
      } else {
        setErr(String(j?.message || '上传失败'))
      }
    } catch (e: any) {
      setErr(String(e?.message || e).slice(0, 80))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <button
        onClick={() => { if (!busy) ref.current?.click() }}
        className={BTN + ' ' + (busy ? BTN_IDLE : BTN_ON)}
      >{busy ? '⏳ 上传中…' : label}</button>
      <input ref={ref} type="file" accept={accept} className="hidden"
        onChange={(e: any) => { doUpload(e.target.files); e.target.value = '' }} />
      {err ? <span className="text-[10px] text-red-400 ml-2">{err}</span> : null}
    </div>
  )
}

/* ── 贴文案（报价口径全部来自服务端下发的 cps / perSec，卡片不自己写死）──────────────── */
function CopyForm({ vj, onSend }: { vj: any; onSend: (msg: string) => void }) {
  const [script, setScript] = useState<string>(String(vj?.script || ''))
  const [res, setRes] = useState<'480P' | '720P'>(String(vj?.res || '') === '720P' ? '720P' : '480P')
  /* ★VF_DH_VOICE_V1（2026-10-29 用户实测「男的数字人配了女声」）：配音选择。
     默认值由服务端下发（现在是男声 Ethan），选项也由服务端下发（白名单只在 vf/tts-voices 一处）。 */
  const [voice, setVoice] = useState<string>(String(vj?.voice || 'Ethan'))
  const voices = (Array.isArray(vj?.voices) ? vj.voices : []) as Array<{ id: string; name: string; gender: string }>
  const hasClone = !!vj?.clone?.voiceId

  const cps = Number(vj?.cps) || 4
  const prices = (vj?.prices || { '480P': 50, '720P': 90 }) as Record<string, number>
  const perSec = Number(prices?.[res]) || (res === '720P' ? 90 : 50)
  const maxChars = Number(vj?.maxChars) || 80

  const n = script.replace(/\s+/g, '').length
  const sec = n ? Math.max(1, Math.round(n / cps)) : 0
  const cost = sec * perSec
  const tooLong = n > maxChars

  const photoUrl = String(vj?.photo?.url || '')

  return (
    <div className={BOX}>
      <div className="text-xs text-cyan-300 mb-2">🤖 数字人口播 · 第 2 步 / 共 2 步</div>

      <div className="flex items-center gap-2 mb-2">
        {photoUrl ? <img src={photoUrl} alt="photo" className="w-12 h-16 object-cover rounded border border-white/10" /> : null}
        <div className="text-[10px] text-gray-400">
          照片：{String(vj?.photo?.name || '（未选）')}
          <button
            className="ml-2 px-1.5 py-0.5 rounded bg-white/[0.06] hover:bg-white/[0.12] text-gray-300 text-[9px]"
            onClick={() => onSend('VF_DH_FORM:' + JSON.stringify({ at: 'back' }))}
          >← 换一张</button>
        </div>
      </div>

      {/* ★VF_DH_VOICE_V1：配音（原来整张卡没有这一块 ⇒ 永远吃默认女声，用户实测「男的数字人配女声」） */}
      <div className="text-[10px] text-gray-400 mb-1">配音（按照片性别选）</div>
      <div className="flex flex-wrap gap-1.5 mb-2 max-h-[92px] overflow-y-auto pr-1">
        {hasClone ? (
          <button onClick={() => setVoice('clone')} title={String(vj?.clone?.model || '')}
            className={BTN + ' ' + (voice === 'clone' ? BTN_ON : BTN_IDLE)}>
            🎤 我的音色（克隆）
          </button>
        ) : null}
        {voices.map((v) => (
          <button key={v.id} onClick={() => setVoice(v.id)} title={v.id}
            className={BTN + ' ' + (voice === v.id ? BTN_ON : BTN_IDLE)}>
            {v.gender ? v.gender + ' · ' : ''}{v.name}
          </button>
        ))}
      </div>
      {!hasClone ? (
        <div className="mb-2">
          <UploadOne
            accept="audio/*,.wav,.mp3,.m4a"
            label="⬆️ 上传我的声音（10~20 秒朗读，克隆专属音色）"
            onDone={(name) => onSend('VF_DH_FORM:' + JSON.stringify({ at: 'enroll', name }))}
          />
          <div className="text-[9px] text-gray-600 mt-1">建音色免费（合成才计费）；样本要求：单人、清晰、别带 BGM。</div>
        </div>
      ) : null}

      <div className="text-[10px] text-gray-400 mb-1">文案（要念出来的话）</div>
      <textarea
        value={script}
        onChange={(e: any) => setScript(e.target.value)}
        rows={5}
        placeholder="例如：本店新到的一批毛肚，今天下午三点开涮，前二十位到店送一份鲜牛肉。"
        className="w-full px-2 py-1.5 rounded-lg text-[12px] leading-relaxed bg-white/[0.05] border border-white/[0.08] text-gray-200 placeholder-gray-600 outline-none resize-y"
      />

      <div className="text-[10px] mt-1 flex items-center gap-2 flex-wrap">
        <span className={tooLong ? 'text-red-400' : 'text-gray-400'}>
          约 {n} 字 · ≈ {sec} 秒 · 预计 {cost} 点
        </span>
        <span className="text-gray-600">（{cps} 字/秒 · {res} {perSec} 点/秒）</span>
        {tooLong ? <span className="text-red-400">超出上限 {maxChars} 字，请删短</span> : null}
      </div>

      <div className="flex items-center gap-2 mt-2 flex-wrap">
        <button
          className={BTN + ' ' + (res === '480P' ? BTN_ON : BTN_IDLE)}
          onClick={() => setRes('480P')}
        >480P · {Number(prices?.['480P']) || 50} 点/秒</button>
        <button
          className={BTN + ' ' + (res === '720P' ? BTN_ON : BTN_IDLE)}
          onClick={() => setRes('720P')}
          title="更清晰，但单价翻倍"
        >720P · {Number(prices?.['720P']) || 90} 点/秒（翻倍）</button>
      </div>

      <div className="flex items-center gap-2 mt-3">
        <button
          disabled={n < 4 || tooLong}
          onClick={() => onSend('VF_DH_FORM:' + JSON.stringify({ at: 'copy', script, res, voice }))}
          className={'px-4 py-1.5 rounded-lg text-sm font-medium ' + ((n < 4 || tooLong)
            ? 'bg-white/[0.06] text-gray-500 cursor-not-allowed'
            : 'bg-cyan-500/70 hover:bg-cyan-500 text-white')}
        >🚀 开始生成</button>
        <button
          className={BTN + ' ' + BTN_IDLE}
          onClick={() => onSend('VF_DH_FORM:' + JSON.stringify({ at: 'abort' }))}
        >取消</button>
        <span className="text-[9px] text-gray-600">提交前会先做一次**人脸检测**：不过不扣点</span>
      </div>

      <div className="text-[9px] text-gray-600 mt-2">
        计费口径：**成功出片才扣**（报价 = 实扣，同一个算法）。最长 {Number(vj?.maxSec) || 20} 秒。
      </div>
    </div>
  )
}
