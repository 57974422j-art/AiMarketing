'use client'

/**
 * ★LAB2 页面（2026-11-02）
 *
 * 和老 lab 的差别：
 *   ① 只有 1 个分类（内容类型 8 选 1），不再有"引擎/手法卡/视觉类型"三层
 *   ② **重做 + 修改意见**（P0：用户和 AI 沟通的入口）
 *   ③ **完成复制**（P0：一键复制本单要求 + trace + 指标 + prompt）
 *   ④ 生成完直接显示 `__trace` 和 技术指标（不用读源码）
 */

import { useEffect, useRef, useState } from 'react'

type Item = { name?: string; key?: string; url?: string }

type Trace = Record<string, unknown> | null

type Metrics = {
  sections: number
  svg: number
  text: number
  canvas: number
  lineHeightMin: number | null
  lineHeightBad: number
  letterSpacingNeg: number
  letterSpacingMin: number | null
  darkCount: number
  darkMin: number | null
  hasSticker: boolean
  hasTrace: boolean
  hasAutoplay?: boolean
  hasImgs?: number
  cssVarP?: number
  svgCount?: number
  svgText?: number
  paintOrder?: number
  canvasCount?: number
}

type Seg = { start: number; duration: number }

type Review = {
  rounds: number
  issues: string[]
  changes: string[]
  shotOk: boolean
  shotErr?: string
}

type Result = {
  url: string
  name: string
  repoId?: string
  /** ★这一版实际用的画幅（生成时定下的，用户后来改选择也不影响预览） */
  aspect?: string
  savedTo?: string
  review?: Review | null
  imgSent?: number
  imgEmbedded?: number
  /** ★HTML 里残留的 OSS 外链数（>0 = 这份成片会过期） */
  imgExternal?: number
  /** ★自动修掉的动画死锁数（[data-p="1"] ⇒ [data-p]，修 n 处说明原片有 n 处全隐藏） */
  deadlockFixed?: number
  /** ★自动补的 section id 数（CSS 用了 #sN 但 HTML 没 id ⇒ 段落样式全废） */
  sectionIdsFixed?: number
  /** ★自动补的 .in 终态数（JS 加类但 CSS 漏规则 ⇒ 全片文字永远 opacity:0） */
  animInFixed?: number
  /** ★后端生成的报告全文（同时已存成本地文件 gen_xxx.report.txt） */
  reportText?: string
  /** ★报告文件名（镜像用） */
  reportName?: string
  /** ★设定 vs 实际（大图比） */
  setCheck?: { bigImgSet: number; fullSecs: number; totalSecs: number; actualPct: number }
  /** ★素材使用明细：每段用了哪几张、漏了哪几张 */
  imgUsage?: {
    total: number
    used: number[]
    missing: number[]
    perSec: number[][]
    unknown: boolean
  }
  imgErrs?: string[]
  ossKeys?: string[]
  elapsed: number
  totalSeconds?: number
  segments?: Seg[]
  trace: Trace
  metrics: Metrics
  prompt: string
  memoriesUsed: string[]
  html: string
}

const CONTENTS: [string, string][] = [
  ['', '不指定'],
  ['food', '餐饮探店'],
  ['product', '产品科技'],
  ['knowledge', '知识科普'],
  ['talking', '老板口播'],
  ['promo', '活动促销'],
  ['tutorial', '教程演示'],
  ['brand', '品牌落版'],
  ['mood', '情绪空镜'],
]

const CT_HINT: Record<string, string> = {
  food: '暖色特写（不压暗）+ 花字三层描边 + 贴纸化 + 超大数字 + 满幅诱惑图｜撞色：暖素材配冷底',
  product: '磨砂玻璃卡（1px内描边）+ 镀铬字 + 爆炸视图 + 精确图表 + WOW 时刻｜深底亮斑',
  knowledge: '贴纸化照片（9px白边）+ 引线标签 + 精确图表 + 数字滚动 + 连续镜头｜蓝灰克制',
  talking: '数字人窗口（5种位置）+ 大字幕三层描边 + 关键句压屏｜深底，人物区不加装饰',
  promo: '超大数字 + 放射线条纹 + 胶囊徽章 + 印章 + 爆点帧｜高饱和撞色',
  tutorial: '步骤编号 + 高亮框箭头 + 分屏对照 + 进度条｜每步等长',
  brand: '镀铬字/超大logo + 细线展开 + slogan｜收尾不加新元素',
  mood: '大图满幅 + 极简文字 + 慢推镜 + 颗粒暗角｜不加装饰',
}

export default function Lab2Page() {
  const [items, setItems] = useState<Item[]>([])
  const [picked, setPicked] = useState<string[]>([])
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<Result | null>(null)

  /* ★★ 画幅（2026-11-03 用户："横屏竖屏加到实验2，作为最高级设置"）
     之前写死 9:16，用户选不了；prompt 里也没有"竖屏/横屏"字样 */
  const [aspect, setAspect] = useState('9:16')

  const [contentType, setContentType] = useState('food')
  const [copyMode, setCopyMode] = useState('sell')
  const [decoDensity, setDecoDensity] = useState('mid')
  const [motion, setMotion] = useState('on')
  /* ★★ 2026-11-03 用户要求加的两个：
     ① 自审开关（开 = 多一次调用，能自己看截图改；关 = 只生成一次）
     ② 大图比（让它都设计大图，容易发现问题）*/
  const [selfReviewOn, setSelfReviewOn] = useState(true)
  const [bigImg, setBigImg] = useState(100)
  /* ★2026-11-06 收尾帧：最后一段纯绘制（不用图） */
  const [endCard, setEndCard] = useState(false)

  /**
   * ★★★ 2026-11-06 用户：「把这份强提示词加一个按键。请注意区分 我们控制按键，
   *   有些是控制键控制的 不要忘记了。」
   *
   * 强版 = 老版那份 1.2 万字的要求（画幅常识/野心/质感/硬底线/禁止偷懒/三道闸/装饰清单）
   * 简版 = 现在默认的自由发挥
   * ⚠️ 强版里，下面那些开关（画幅/内容/文案/密度/大图比/动效/收尾帧）**照样生效**
   */
  const [strongPrompt, setStrongPrompt] = useState(false)
  const [userRules, setUserRules] = useState('')

  /* 重做 */
  const [feedback, setFeedback] = useState('')
  const [retrying, setRetrying] = useState(false)
  /* ★反馈截图（最多 4 张，转 base64 发给模型看） */
  const [fbImages, setFbImages] = useState<{ name: string; data: string }[]>([])

  /* ★2026-11-05 直播版：素材改用弹窗选（左栏不再堆几十张缩略图） */
  const [showMatPicker, setShowMatPicker] = useState(false)

  /**
   * ★2026-11-06 用户：「指标自审 / 完成复制 / PROMPT报告不再显示，全部打印成一个文件」
   *   ⇒ tab 栏已删（无法切换），初始值设成 'chat'
   *   ⇒ 'metrics' / 'report' 两段代码保留但**永远到不了**（想恢复就把这里改回 'metrics'）
   */
  const [tab, setTab] = useState<'metrics' | 'chat' | 'report'>('chat')

  /* ★2026-11-05 第 4 批：演示模式（隐藏两侧，只留预览）/ 报告弹窗 */
  const [zen, setZen] = useState(false)
  const [showReport, setShowReport] = useState(false)

  /**
   * ★★★ 2026-11-06 用户：「我说浮动悬窗是可以拖动的，你设计这个还是固定的。」
   *
   * 播放条改成**可拖动的浮动窗**：
   *   · position: absolute（不占文档流高度 ⇒ 预览头部再也不被裁）
   *   · 按住空白处 / 把手可以拖到任意位置
   *   · 偏移记在 state（刷新回默认；要持久化再加 localStorage）
   */
  const [ctrlPos, setCtrlPos] = useState({ x: 0, y: 0 })
  const ctrlDrag = useRef<{ sx: number; sy: number; ox: number; oy: number } | null>(null)

  /**
   * ★★★ 2026-11-06 用户：「在预览页上加一个截图划范围功能，确认了直接加入会话框」
   *
   * 交互：点「📷 框选」→ 预览变暗、鼠标十字 → 拖一个框 → 【✔ 加入对话】
   *   → 后端截「那一帧的那一块」→ 自动进「💬 对话改片」的附件 → 切到对话 tab
   *
   * 好处：不用手动截图、不用口述"第几段"——它看到的就是它自己画的画面。
   */
  const [cropOn, setCropOn] = useState(false)
  const [cropBusy, setCropBusy] = useState(false)
  /** 拖动中的框（屏幕像素，相对 iframe 左上角） */
  const [cropRect, setCropRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null)
  const cropStart = useRef<{ x: number; y: number } | null>(null)

  /* ★★★ 对话改片（2026-11-04）：长期会话 + 记忆 */
  const [chatMsgs, setChatMsgs] = useState<Array<{ role: 'user' | 'assistant'; text: string }>>([])
  const [chatText, setChatText] = useState('')
  const [chatBusy, setChatBusy] = useState(false)
  const [sessionId] = useState('main')
  /* ★对话截图（2026-11-04 用户："它看不到图就瞎改，加一个上传图片"） */
  const [chatImgs, setChatImgs] = useState<{ name: string; data: string }[]>([])

  /* ★段落删除（2026-11-04）：标记 → 代码删段 + 重排时间轴（不经过 AI） */
  const [delSel, setDelSel] = useState<number[]>([])
  const [secBusy, setSecBusy] = useState(false)

  function toggleDel(n: number) {
    setDelSel((p) => (p.includes(n) ? p.filter((x) => x !== n) : [...p, n]))
  }

  async function applyDelete() {
    if (!delSel.length || secBusy || !result) return
    setSecBusy(true)
    setErr('')
    try {
      const r = await fetch('/api/lab2/sections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ sessionId, name: result.name, delete: delSel }),
      })
      const j = await r.json()
      if (!j?.ok) { setErr(String(j?.error || '删除失败')); return }
      setResult((prev) => (prev
        ? {
          ...prev,
          url: j.url,
          name: j.name,
          savedTo: j.savedTo,
          segments: j.segments,
          totalSeconds: j.totalSeconds,
        }
        : prev))
      setChatMsgs((p) => [...p, { role: 'assistant', text: j.savedTo ? ('已删掉第 ' + delSel.join('、') + ' 段，时间轴重排完成') : '' }])
      setDelSel([])
      setSeekT(0)
    } catch (e) {
      setErr('删除异常：' + String((e as Error)?.message || e))
    } finally {
      setSecBusy(false)
    }
  }

  const [copied, setCopied] = useState('')
  const [seekT, setSeekT] = useState(0)
  const [playing, setPlaying] = useState(false)
  const rafRef = useRef<number>(0)
  const playStartRef = useRef<number>(0)
  const playFromRef = useRef<number>(0)
  const iframeRef = useRef<HTMLIFrameElement | null>(null)

  /**
   * ★★ 2026-11-02 用户："暂停也暂停不住 点帧也停不下来"
   *   根因：页面内有自己的 rAF 自动播放，我在外层又起一个 rAF ⇒ 两个打架
   *   修法：**不自己推 rAF**，只控制页面内的 window.__lab2Paused + window.__seek
   */
  function setPausedInFrame(p: boolean) {
    try {
      const w = iframeRef.current?.contentWindow as (Window & { __lab2Paused?: boolean }) | null
      if (w) w.__lab2Paused = p
    } catch { /* ignore */ }
  }

  function togglePlay() {
    if (playing) {
      setPlaying(false)
      setPausedInFrame(true)
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      return
    }
    /* 让页面内自己播；这里只**读**它的真实时间，不自己累加
       ★2026-11-03 修：之前是 prev + 0.05/帧 ⇒ 每秒 3 秒 ⇒ 进度条和画面对不上 */
    setPausedInFrame(false)
    setPlaying(true)
    const sync = () => {
      try {
        const w = iframeRef.current?.contentWindow as
          (Window & { __lab2Paused?: boolean; __lab2Total?: number; __lab2Time?: number }) | null
        if (w && typeof w.__lab2Time === 'number') {
          setSeekT(w.__lab2Time)     /* ← 读真实时间 */
        }
      } catch { /* ignore */ }
      rafRef.current = requestAnimationFrame(sync)
    }
    rafRef.current = requestAnimationFrame(sync)
  }

  /* 卸载时停掉 */
  useEffect(() => () => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    setPausedInFrame(true)
  }, [])

  /* ★2026-11-02 用户反馈"图片都堆在一个页面上，看不到效果"
     ⇒ 加"全屏"+"新标签"+"时间轴"三件，直接把单屏效果看出来 */
  function seekTo(t: number, quiet = false) {
    /* ★★★ 2026-11-06 用户实测两个 bug：
       ① 「点那段就是那段，确实能翻到那段，但下面永远显示第二段」
          根因：togglePlay 启动的 sync 轮询（读 iframe 的 __lab2Time）
                在点段号时**没有停** ⇒ 每帧 setSeekT(iframe 里的旧时间)
                ⇒ 把用户点的 t 覆盖掉 ⇒ 画面翻对了，段号标签还是旧的
          修：seekTo 里先 cancel 轮询
       ② 「段 1 怎么都点不开」
          根因：段号右边紧贴着 ✕（标记删除），点偏一点就点到 ✕ ⇒ 不跳转
          修：✕ 从段导航里挪走，改成独立的「标记当前段删除」按钮 */
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    const w = iframeRef.current?.contentWindow as
      (Window & { __seek?: (t: number) => void; __lab2Paused?: boolean; __lab2Time?: number }) | null
    try {
      if (w) w.__lab2Paused = true
      setPlaying(false)
      setSeekT(t)
      if (w?.__seek) w.__seek(t)
      else if (!quiet) setErr('这一版没有 __seek（模型漏了播放接口）')
    } catch { if (!quiet) setErr('跨域读不到 iframe（用「↗ 新标签」打开）') }
  }

  /**
   * ★★★ 2026-11-06 用户：「其它都支持生成后直接镜像到本地，去看日报线怎么镜像的抄一下就行」
   *
   * 抄的是日报线（app/agent/page.tsx）的同一套：
   *   window.electronAPI.storageMirror(`/api/storage/file?userId=X&name=Y`)
   *     ↓
   *   客户端（Electron）会把 OSS 上这份文件拉到本地仓库 storage/<uid>/
   *
   * 为什么用 /api/storage/file 而不是 /api/lab2/file：
   *   · 前者是日报线一直在用的，Electron 侧行为已验证
   *   · lab2 成片也在 `storage/<uid>/gen_xxx.html`（同一个 key 规则）⇒ 能读到
   *
   * AI 思考日志：**HTML 里自带 `__trace`**（生成时就写进去了）
   *   ⇒ 镜像 HTML 就等于把思考一起镜像下来了，不用单独存文件
   */
  function mirrorToLocal(name?: string, repoId?: string) {
    try {
      const n = String(name || '')
      if (!n) return
      const api = (window as unknown as {
        electronAPI?: { storageMirror?: (u: string) => void }
      }).electronAPI
      if (!api?.storageMirror) return   /* 网页版没有 electronAPI ⇒ 静默跳过 */
      const uid = String(repoId || '1')
      api.storageMirror(`/api/storage/file?userId=${uid}&name=${encodeURIComponent(n)}`)
      console.log('[lab2] 镜像到本地仓库：' + n)
    } catch { /* 镜像失败不影响主流程 */ }
  }

  /** ★框选确认：截「当前帧的这块」→ 塞进对话附件 + 切到对话 tab */
  async function doCrop() {
    if (!result || !cropRect) return
    const el = iframeRef.current
    if (!el) return
    const box = el.getBoundingClientRect()
    if (!box.width || !box.height) return

    const land = (result.aspect || aspect) === '16:9'
    const CW = land ? 1280 : 720
    const CH = land ? 720 : 1280
    const kx = CW / box.width
    const ky = CH / box.height

    setCropBusy(true)
    setErr('')
    try {
      const r = await fetch('/api/lab2/shot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          name: result.name,
          repoId: result.repoId || '1',
          t: seekT,
          rect: {
            x: cropRect.x * kx,
            y: cropRect.y * ky,
            w: cropRect.w * kx,
            h: cropRect.h * ky,
          },
        }),
      })
      const j = await r.json()
      if (!j?.ok) {
        /* ★失败必须让人看见（之前只在顶栏一行小字，用户以为"什么都没加入"） */
        const msg = String(j?.error || '截图失败')
        setErr('截图失败：' + msg)
        alert('截图失败：' + msg)
        return
      }

      setChatImgs((p) => [
        ...p,
        { name: 'crop@' + seekT.toFixed(1) + 's', data: String(j.image) },
      ].slice(0, 6))
      /* 预填一句，你补完就能发（省得再想怎么说） */
      setChatText('这块画面有问题（' + seekT.toFixed(1) + 's）：')
      /* ★在对话里也留一条，证明"真的加进去了" */
      setChatMsgs((p) => [...p, {
        role: 'assistant',
        text: '已附上 ' + seekT.toFixed(1) + 's 的框选截图（附在输入框上方，可以连同这句话一起发给我）',
      }])
      setCropOn(false)
      setCropRect(null)
      setTab('chat')
      setErr('')
    } catch (e) {
      const msg = '截图异常：' + String((e as Error)?.message || e)
      setErr(msg)
      alert(msg)
    } finally {
      setCropBusy(false)
    }
  }

  function openFullscreen() {
    const el = iframeRef.current
    if (!el) return
    if (el.requestFullscreen) el.requestFullscreen().catch(() => setErr('全屏被浏览器拒绝'))
    else setErr('浏览器不支持全屏')
  }

  /* 读素材（复用旧 lab 的只读接口） */
  useEffect(() => {
    ;(async () => {
      try {
        const r = await fetch('/api/lab/files', { credentials: 'include', cache: 'no-store' })
        const j = await r.json()
        if (j?.success && Array.isArray(j.data)) setItems(j.data)
      } catch { /* 静默 */ }
    })()
  }, [])

  /* ★★★ 2026-11-04 打开页面就恢复「上一次聊到哪」
     —— 用户："不是这份做完了下次它连自己干什么都忘记" */
  useEffect(() => {
    ;(async () => {
      try {
        const r = await fetch('/api/lab2/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ action: 'history', sessionId: 'main' }),
        })
        const j = await r.json()
        if (j?.ok && Array.isArray(j.messages) && j.messages.length) {
          setChatMsgs(j.messages.map((m: { role: 'user' | 'assistant'; text: string }) => ({ role: m.role, text: m.text })))
          /* 自动把预览切回它上次那一版 */
          if (j.url) {
            setResult((prev) => (prev ? { ...prev, url: j.url, name: j.currentHtmlName || prev.name } : prev))
      /* ★对话改片也出新文件 ⇒ 一样镜像到本地 */
      mirrorToLocal(j?.currentHtmlName, (result?.repoId) || '1')
          }
        }
      } catch { /* 静默 */ }
    })()
  }, [])

  /** 发一句，让它改当前版本 */
  async function sendChat() {
    const t = chatText.trim()
    if (!t || chatBusy) return
    if (!result) { setErr('先在左边点「生成」做一版，再聊着改'); return }
    setErr('')
    setChatText('')
    const sentImgs = chatImgs.map((x) => x.data)
    setChatMsgs((p) => [...p, {
      role: 'user',
      text: t + (sentImgs.length ? `（附 ${sentImgs.length} 张截图）` : ''),
    }])
    setChatImgs([])
    setChatBusy(true)
    try {
      const r = await fetch('/api/lab2/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ sessionId, text: t, images: sentImgs }),
      })
      const j = await r.json()
      if (!j?.ok) {
        setChatMsgs((p) => [...p, { role: 'assistant', text: '❌ ' + (j?.error || '改失败') }])
        return
      }
      setChatMsgs((p) => [...p, { role: 'assistant', text: j.reply || '已改好' }])
      /* 换新版本预览（指标基于上一版，不重算） */
      setResult((prev) => (prev ? { ...prev, url: j.url, name: j.name, savedTo: j.savedTo } : prev))
      /* ★删段重排也出新文件 ⇒ 一样镜像 */
      mirrorToLocal(j?.name, result?.repoId)
      setSeekT(0)
    } catch (e) {
      setChatMsgs((p) => [...p, { role: 'assistant', text: '❌ ' + String((e as Error)?.message || e) }])
    } finally {
      setChatBusy(false)
    }
  }

  function toggle(name: string) {
    /* ★2026-11-04 用户："我没有张数限制，准备传几十张做长视频" ⇒ 上限从 20 提到 60 */
    setPicked((p) => (p.includes(name) ? p.filter((x) => x !== name) : p.length >= 60 ? p : [...p, name]))
  }

  /**
   * ★2026-11-02 用户："图还是进不去"
   *   最可靠的路：**前端 fetch signedUrl → canvas 压缩 → base64**
   *   （后端 getObject 一直读不到，前端能拿到 signedUrl 就一定能转）
   */
  async function toB64(url: string, maxW = 1100, q = 0.78): Promise<string> {
    return new Promise((resolve) => {
      const img = new Image()
      img.crossOrigin = 'anonymous'
      img.onload = () => {
        try {
          const scale = Math.min(1, maxW / img.width)
          const c = document.createElement('canvas')
          c.width = Math.max(1, Math.round(img.width * scale))
          c.height = Math.max(1, Math.round(img.height * scale))
          const ctx = c.getContext('2d')
          if (!ctx) { resolve(''); return }
          ctx.drawImage(img, 0, 0, c.width, c.height)
          resolve(c.toDataURL('image/jpeg', q))
        } catch { resolve('') }
      }
      img.onerror = () => resolve('')
      img.src = url
    })
  }

  /**
 * ★2026-11-06 用户：「2个重复了 帮剪掉一个…下面那个不要了」
 *   ⇒ 删掉下面那块（独立 textarea + 独立上传截图），
 *     把「重做整条」合并到上面「对话改片」的输入框旁
 *   ⇒ 所以 gen() 要多收一个"这次的意见 + 图"，不再依赖下面那套 state
 */
async function gen(isRetry = false, fbOverride?: string, imgsOverride?: string[]) {
    if (picked.length < 1) { setErr('至少选 1 张素材'); return }
    const fbText = (fbOverride ?? feedback).trim()
    if (isRetry && !fbText) { setErr('重做请先写「哪里不对」'); return }
    setErr(''); setLoading(true)
    if (!isRetry) setResult(null)
    try {
      /* 先把选中的图转成 base64（自包含，不依赖后端读 OSS） */
      const pickedUrls = picked.map((n) => (items.find((it) => String(it.name) === n)?.url) || '')
      const b64s: string[] = []
      for (const u of pickedUrls) {
        b64s.push(u ? await toB64(u) : '')
      }
      /* ★2026-11-05：**不能 filter**！
         17 张里若有 3 张压缩失败，filter 后只剩 14 个
         ⇒ 后端 imageData[i] 和 imgs[i] **整体错位** ⇒ 图配错段
         保留空字符串占位，后端自己会跳过并走 OSS 兜底 */
      const imgData = b64s

      const r = await fetch('/api/lab2', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          images: picked,
          imageData: imgData,          /* ★base64 数组（前端压缩好的） */
          imageUrls: pickedUrls,
          contentType,
          copyMode,
          decoDensity,
          motion,
          selfReview: selfReviewOn,
          bigImg,
          endCard,
          strongPrompt,
          userRules,
          maxSeconds: 45,
          aspect,
          /* 重做：带上上次 HTML + 意见 */
          prevHtml: isRetry ? result?.html : '',
          feedback: isRetry ? fbText : '',
          feedbackImages: isRetry
            ? (imgsOverride ?? fbImages.map((x) => x.data))
            : [],
          sessionId,                 /* ★首版写进这个会话，之后对话改片继续用 */
        }),
      })
      const j = await r.json()
      if (!j?.ok) { setErr(String(j?.error || '生成失败')); return }
      setResult(j as Result)
      /* ★生成完立刻镜像到本地仓库（Electron 里生效；网页版静默跳过） */
      mirrorToLocal(j?.name, j?.repoId)
      /* ★报告也一起镜像（后端已存成 gen_xxx.report.txt） */
      mirrorToLocal(j?.reportName, j?.repoId)
      if (isRetry) setFeedback('')
      /* ★首版也记进对话（后端已写 session，这里只补前端显示） */
      setChatMsgs((p) => [
        ...p,
        {
          role: 'assistant',
          text: (isRetry ? '已按你的意见重做一版' : '首版已生成')
            + '（' + (j?.name || '') + '）\n接下来可以在这里直接说要改哪里。',
        },
      ])
    } catch (e) {
      setErr('异常：' + String((e as Error)?.message || e))
    } finally {
      setLoading(false); setRetrying(false)
    }
  }

  /* ── 完成复制 ── */
  async function copyAll(tag: string, text: string) {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(tag)
      setTimeout(() => setCopied(''), 1600)
    } catch { setErr('复制失败（浏览器权限）') }
  }

  function buildReport(): string {
    if (!result) return ''
    const m = result.metrics
    return [
      '══════ 本单要求 ══════',
      '内容类型：' + (CONTENTS.find((c) => c[0] === contentType)?.[1] || '不指定'),
      '文案模式：' + copyMode + ' · 装饰密度：' + decoDensity + ' · 动效：' + motion,
      '素材：' + picked.length + ' 张',
      result.memoriesUsed.length ? '注入的历史教训：\n' + result.memoriesUsed.map((s, i) => `  ${i + 1}. ${s}`).join('\n') : '（无历史教训）',
      '',
      '══════ AI 思考日志 ══════',
      JSON.stringify(result.trace, null, 2),
      '',
      '══════ 技术扫描 ══════',
      '段数：' + m.sections + ' · <svg>：' + m.svg + ' · <text>：' + m.text + ' · <canvas>：' + m.canvas,
      'line-height 最低：' + m.lineHeightMin + '（违规 ' + m.lineHeightBad + ' 处）',
      '负 letter-spacing：' + m.letterSpacingNeg + ' 处（最小 ' + m.letterSpacingMin + '）',
      '压暗(<0.95)：' + m.darkCount + ' 处' + (m.darkMin ? '（最低 ' + m.darkMin + '）' : ''),
      '贴纸白边：' + (m.hasSticker ? '有' : '无'),
      '思考日志：' + (m.hasTrace ? '有' : '无'),
      /* ★2026-11-06 用户："你这个报告为什么每次都不完整" ⇒ 把页面上有的细项全并进来 */
      '自动播放：' + (m.hasAutoplay ? '有' : '无'),
      'CSS var(--p)：' + (m.cssVarP ?? 0) + ' 处'
        + ((m.cssVarP ?? 0) < 3 ? '（≈0 ⇒ 动效全靠 JS，一崩就静止）' : ''),
      '<text>：' + (m.text ?? 0) + '（围边必错）',
      /* ★2026-11-06 致命错误自动修复提示（不是自审发现的，是代码确定性的修） */
      ...((result.deadlockFixed || 0) > 0
        ? ['',
          '⚠️ 动画死锁：检测到 ' + result.deadlockFixed + ' 处 [data-p="1"]（可见时 p 永远到不了 1）'
          + '\n   ⇒ 已自动放宽成 [data-p]，否则这些元素**整段都是隐藏的**（全黑）']
        : []),
      /* ★2026-11-06 段落 id 缺失（CSS 用 #sN 但 HTML 没 id ⇒ 段落样式全部失效） */
      ...((result.sectionIdsFixed || 0) > 0
        ? ['',
          '⚠️ 段落 id 缺失：CSS 用了 #s1~#sN，但 HTML 的 section 没有 id'
          + '\n   ⇒ 已按顺序补 ' + result.sectionIdsFixed + ' 个'
          + '（不补的话：巨字退化成 16px、遮罩失效、文字挤成一坨）']
        : []),
      /* ★2026-11-06 动画终态缺失（JS 加 .in 但 CSS 没写规则 ⇒ 全片无字） */
      ...((result.animInFixed || 0) > 0
        ? ['',
          '⚠️ 动画终态缺失：JS 会加 .in 类，但 CSS 漏了 ' + result.animInFixed + ' 条对应规则'
          + '\n   ⇒ 已补 .anim-up.in 等终态'
          + '（不补的话：所有文字永远 opacity:0 ⇒ 全片一个字没有）']
        : []),

      /* ★2026-11-05 补：素材使用明细 —— 它到底看了哪张、漏了哪张 */
      '',
      /* ★2026-11-05 补：设定 vs 实际（软指标有没有被执行） */
      ...(result.setCheck
        ? [
          '══════ 设定 vs 实际 ══════',
          '大图比设 ' + result.setCheck.bigImgSet + '% → 实际满幅 '
            + result.setCheck.fullSecs + '/' + result.setCheck.totalSecs
            + ' = ' + result.setCheck.actualPct + '%'
            + (Math.abs(result.setCheck.actualPct - result.setCheck.bigImgSet) > 20 ? '（⚠️ 差得多）' : '（✅ 对得上）'),
          '',
        ]
        : []),

      '══════ 素材使用 ══════',
      ...(result.imgUsage && !result.imgUsage.unknown
        ? [
          '素材 ' + result.imgUsage.total + ' 张 → 用了 ' + result.imgUsage.used.length + ' 张'
            + (result.imgUsage.missing.length
              ? '｜⚠️ 漏了 IMG_' + result.imgUsage.missing.join('、IMG_')
              : '｜全部用上 ✅'),
          '逐段：' + result.imgUsage.perSec
            .map((ids, i) => '段' + (i + 1) + '[' + (ids.length ? ids.map((x) => 'IMG_' + x).join('+') : '无图') + ']')
            .join(' '),
        ]
        : ['（它没写 {{IMG_N}} 占位符，无法统计用了哪张）']),

      /* ★2026-11-05 补：内联 / 外链（外链 > 0 ⇒ 这份 1~2 小时后图全裂） */
      '',
      '══════ 图片落地 ══════',
      'AI 看到：' + (result.imgSent ?? '?') + ' 张 · 内联进 HTML：' + (result.imgEmbedded ?? '?') + ' 张',
      (result.imgExternal || 0) > 0
        ? '⚠️ 外链 ' + result.imgExternal + ' 个（签名会过期，1~2 小时后图全裂）'
        : '外链 0 个 ✅（自包含，永久有效）',
      ...(result.imgErrs && result.imgErrs.length ? ['读图失败：' + result.imgErrs.join(' ｜ ')] : []),

      /* ★2026-11-05 补：自审（它自己看了成片，改了几轮 / 发现什么 / 改了什么） */
      '',
      '══════ 自审 ══════',
      ...(result.review
        ? [
          result.review.shotOk
            ? '自审 ✓（改了 ' + result.review.rounds + ' 轮）'
            : '自审 ✗（截图失败：' + (result.review.shotErr || '未执行') + '）',
          '发现的问题（' + result.review.issues.length + '）：'
            + (result.review.issues.length ? '' : '无（它认为合格）'),
          ...result.review.issues.map((s, i) => '  ' + (i + 1) + '. ' + s),
          '改了什么（' + result.review.changes.length + '）：'
            + (result.review.changes.length ? '' : '没改（它认为没问题）'),
          ...result.review.changes.map((s, i) => '  ' + (i + 1) + '. ' + s),
        ]
        : ['（没有自审记录 —— 开关可能关着）']),

      '',
      '══════ 文件名 ══════',
      result.name + ' · 耗时 ' + result.elapsed + 's',
      result.savedTo ? '存到：' + result.savedTo + '（已同步 OSS）' : '',
    ].filter(Boolean).join('\n')
  }

  /* ★2026-11-05 直播版：padding/margin 收紧（用户："还是超出必须滚轮"） */
  const box: React.CSSProperties = {
    background: '#0B0F14', border: '1px solid #242C38', borderRadius: 9, padding: 9, marginBottom: 8,
  }
  const label: React.CSSProperties = { fontSize: 10.5, color: '#7A8798', marginBottom: 6, display: 'block' }
  /* ★勾选框样式（2026-11-05：代替原来的三档按钮，省高度） */
  const chk: React.CSSProperties = {
    display: 'flex', alignItems: 'center', gap: 7, fontSize: 11, color: '#B0BEC8',
    padding: '5px 0', cursor: 'pointer', userSelect: 'none',
  }

  const btn = (active: boolean): React.CSSProperties => ({
    fontSize: 11, padding: '6px 11px', borderRadius: 6, cursor: 'pointer',
    border: active ? '1px solid #3ECF8E' : '1px solid #242C38',
    background: active ? 'rgba(62,207,142,.2)' : '#0B0F14',
    color: active ? '#D6FBEA' : '#7A8798',
  })

  return (
    <div style={{
      height: '100vh', overflow: 'hidden', background: '#06080B', color: '#D8E2EC',
      fontFamily: 'system-ui', display: 'flex', flexDirection: 'column',
    }}>
      {/* ══ 顶栏（2026-11-05 直播版）：画幅 / 素材 / 自审 / 生成 ── */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12, padding: '9px 14px',
        borderBottom: '1px solid #1A2028', background: '#080B10', flexShrink: 0,
      }}>
        {/* ★2026-11-06 这页隐藏了全局 Navbar（省高度）⇒ 得留个出口 */}
        <a href="/" title="返回首页"
          style={{
            fontSize: 11, color: '#7A8798', textDecoration: 'none',
            padding: '4px 8px', borderRadius: 6, border: '1px solid #1A2028', flexShrink: 0,
          }}>← 首页</a>
        <a href="/lab2" title="经典版（有全局导航）"
          style={{
            fontSize: 11, color: '#7A8798', textDecoration: 'none',
            padding: '4px 8px', borderRadius: 6, border: '1px solid #1A2028', flexShrink: 0,
          }}>经典版</a>
        {/* ★2026-11-07 加版本号：用户分不清"没改"和"没部署" —— 以后看这里 */}
        <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: .3 }}>LAB2 · 直播台</span>
        <span style={{
          fontSize: 9, color: '#3ECF8E', border: '1px solid rgba(62,207,142,.4)',
          borderRadius: 4, padding: '1px 5px', flexShrink: 0,
        }}>v11-07</span>
        <div style={{ width: 1, height: 18, background: '#1A2028' }} />
        <span style={{ fontSize: 11, color: aspect === '16:9' ? '#FFD9A0' : '#BFE3FF', fontWeight: 700 }}>
          {aspect === '16:9' ? '1280 × 720 横屏' : '720 × 1280 竖屏'}
        </span>
        <span style={{ fontSize: 11, color: '#7A8798' }}>素材 {picked.length} 张</span>
        <span style={{ fontSize: 11, color: selfReviewOn ? '#7CF' : '#7A8798' }}>
          自审 {selfReviewOn ? '开' : '关'}
        </span>
        <div style={{ flex: 1 }} />
        {err && <span style={{ fontSize: 10.5, color: '#FF6B6B', maxWidth: 420, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{err}</span>}
        {result && (
          <span style={{ fontSize: 10.5, color: '#7A8798' }}>
            {result.metrics?.sections ?? '?'} 段 · {result.elapsed}s
          </span>
        )}
        <button onClick={() => gen(false)} disabled={loading}
          style={{
            padding: '8px 26px', borderRadius: 8, border: 'none', fontSize: 12.5, fontWeight: 700,
            cursor: loading ? 'default' : 'pointer',
            background: loading ? '#2A3440' : 'linear-gradient(100deg,#3ECF8E,#4A9EFF)',
            color: loading ? '#7A8798' : '#06110B',
          }}>{loading ? '生成中…' : '● 生成'}</button>
      </div>

      {/* ══ 主区：左 260 设置 / 右自适应（预览 + 分析）══ */}
      <div style={{
        flex: 1, display: 'grid',
        /* ★2026-11-05 用户："怎么跟你设计的结构不一样" ⇒ 改成真三栏 */
        gridTemplateColumns: zen ? '0px 1fr 0px' : '260px 1fr 360px',
        gap: zen ? 0 : 12,
        padding: zen ? 6 : 12, overflow: 'hidden', minHeight: 0,
        transition: 'grid-template-columns .2s ease',
      }}>
        {/* 左栏：★zoom 0.86 —— 9 个设置块在 1080 屏一屏放不下，整体缩一档 */}
        <div style={{ overflowY: 'auto', minHeight: 0, paddingRight: 4, zoom: 0.86 }}>

          {/* ★★★ 2026-11-05 用户："补充我觉得应该是最高级"
              ⇒ 移到左栏最上面（它是最直接的意图输入，优先于所有滑杆） */}
          <div style={{
            ...box,
            border: '1px solid rgba(62,207,142,.5)',
            background: 'rgba(62,207,142,.06)',
          }}>
            <span style={{ ...label, color: '#8FE8C8', fontWeight: 700 }}>补充要求（最高优先）</span>
            <textarea value={userRules} onChange={(e) => setUserRules(e.target.value)}
              placeholder="这条片子你想怎么改？例如：结尾要有品牌名 / 别用金色 / 前 3 秒要抓人"
              rows={3}
              style={{
                width: '100%', background: '#06080B', border: '1px solid #242C38', borderRadius: 6,
                color: '#D8E2EC', fontSize: 11, padding: 8, resize: 'vertical', lineHeight: 1.6,
              }} />
          </div>

          {/* ★★ 画幅（最高级设置 · 2026-11-03 用户要求） */}
          <div style={{
            ...box,
            border: '1px solid rgba(255,179,71,.55)',
            background: 'rgba(255,179,71,.07)',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 7 }}>
              {/* ★2026-11-06 去掉"最优先" —— 上面「补充要求」才是最高优先，两个都说最优先会打架 */}
              <span style={{ fontSize: 11, color: '#FFD9A0', fontWeight: 700 }}>画幅</span>
              <span style={{ fontSize: 9, color: '#8A7A5C' }}>
                {aspect === '16:9' ? '1280 × 720 横屏' : '720 × 1280 竖屏'}
              </span>
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              {[['9:16', '📱 竖屏 9:16'], ['16:9', '🖥 横屏 16:9']].map(([v, t]) => (
                <button key={v} onClick={() => setAspect(v)}
                  style={{
                    flex: 1, fontSize: 11.5, padding: '9px 0', borderRadius: 6, cursor: 'pointer',
                    border: aspect === v ? '2px solid #FFB347' : '1px solid #242C38',
                    background: aspect === v ? 'rgba(255,179,71,.24)' : '#0B0F14',
                    color: aspect === v ? '#FFE9C8' : '#7A8798',
                    fontWeight: aspect === v ? 700 : 400,
                  }}>{t}</button>
              ))}
            </div>
          </div>

          {/* 内容类型 */}
          <div style={box}>
            <span style={label} title={CT_HINT[contentType] || ''}>内容类型（唯一的分类）</span>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
              {CONTENTS.map(([v, t]) => (
                <button key={v || 'auto'} onClick={() => setContentType(v)} style={btn(contentType === v)}>{t}</button>
              ))}
            </div>
            {/* ★注解改成鼠标悬停提示（用户："注解可以指上去再显示"） */}
          </div>

          {/* ★2026-11-05 用户："这里占的太大了。自审有个框打开就代表要不要就行了。装饰密度也是"
              ⇒ 三档按钮全改成勾选框（勾 = 要 / 多，不勾 = 不要 / 少） */}
          <div style={box}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 7 }}>
              <span style={{ fontSize: 10.5, color: '#7A8798' }}>文案</span>
              <div style={{ display: 'flex', gap: 4 }}>
                {[['desc', '说明'], ['sell', '卖点'], ['poem', '短句']].map(([v, t]) => (
                  <button key={v} onClick={() => setCopyMode(v)}
                    style={{ ...btn(copyMode === v), padding: '4px 10px', fontSize: 10 }}>{t}</button>
                ))}
              </div>
            </div>

            {/* ★2026-11-06 修：勾选框只有"开/关"两态，但装饰密度是三档（少/中/多）
                 ⇒ 原来勾上永远变 high、不勾永远变 low，**"中"档一旦动过就回不来**
                 ⇒ 现在把当前档位显示出来，勾选框只管"多一点/少一点" */}
            <label style={chk}>
              <input type="checkbox" checked={decoDensity !== 'low'}
                onChange={(e) => setDecoDensity(e.target.checked ? 'high' : 'low')}
                style={{ width: 14, height: 14, accentColor: '#3ECF8E' }} />
              装饰多一点
              <span style={{
                fontSize: 9, marginLeft: 2,
                color: decoDensity === 'high' ? '#FFB347' : '#4C5765',
              }}>
                {decoDensity === 'high' ? '多' : decoDensity === 'mid' ? '中（默认）' : '少'}
              </span>
            </label>

            <label style={chk}>
              <input type="checkbox" checked={motion === 'on'}
                onChange={(e) => setMotion(e.target.checked ? 'on' : 'off')}
                style={{ width: 14, height: 14, accentColor: '#3ECF8E' }} />
              动效
            </label>

            <label style={chk} title="开启后多一次截图自审（多 4~5 分钱）">
              <input type="checkbox" checked={selfReviewOn}
                onChange={(e) => setSelfReviewOn(e.target.checked)}
                style={{ width: 14, height: 14, accentColor: '#3ECF8E' }} />
              自审（截图自查）
              <span style={{ fontSize: 9, color: '#4C5765', marginLeft: 2 }}>
                {selfReviewOn ? '多 4~5 分' : '省 4~5 分'}
              </span>
            </label>

            {/* ★★★ 2026-11-06 强提示词档位（用户："把这份强提示词加一个按键"）*/}
            <label style={chk} title="打开后换成老版那份强要求：画幅常识 / 野心 / 质感 / 硬底线 / 禁止偷懒 / 三道闸 / 装饰清单。下面所有开关照样生效，只是要求写得更细。">
              <input type="checkbox" checked={strongPrompt}
                onChange={(e) => setStrongPrompt(e.target.checked)}
                style={{ width: 14, height: 14, accentColor: '#FFB347' }} />
              <span style={{ color: strongPrompt ? '#FFD9A0' : '#B0BEC8', fontWeight: strongPrompt ? 700 : 400 }}>
                强提示词
              </span>
              <span style={{ fontSize: 9, color: '#4C5765', marginLeft: 2 }}>
                {strongPrompt ? '约 8 千字' : '简版'}
              </span>
            </label>

            {/* ★2026-11-06 收尾帧：最后一段纯绘制（用户："以前支持几段自己画，特别是收尾帧"）*/}
            <label style={chk} title="最后一段不用图，纯绘制一个落版（品牌名 + 一句话 + 签名图形）">
              <input type="checkbox" checked={endCard}
                onChange={(e) => setEndCard(e.target.checked)}
                style={{ width: 14, height: 14, accentColor: '#3ECF8E' }} />
              收尾帧自己画
              <span style={{ fontSize: 9, color: '#4C5765', marginLeft: 2 }}>最后一段不用图</span>
            </label>

            {/* ★大图比 */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8, marginBottom: 2 }}>
              <span style={{ fontSize: 10.5, color: '#7A8798' }}>大图比</span>
              <span style={{ fontSize: 10, color: bigImg >= 80 ? '#FFB347' : '#7CF', fontWeight: 700 }}>
                {bigImg}%
              </span>
            </div>
            <input type="range" min={0} max={100} step={10} value={bigImg}
              onChange={(e) => setBigImg(Number(e.target.value))}
              style={{ width: '100%', accentColor: '#FFB347' }} />
            <div style={{ fontSize: 8.5, color: '#7A8798', marginTop: 2 }}>
              {bigImg === 0 ? '全用贴纸/局部' : bigImg < 60 ? '少量满幅' : bigImg < 100 ? '大部分满幅' : '★ 全满幅'}
            </div>
          </div>

          {/* 素材：★2026-11-05 直播版 —— 不再把 49 张堆在左栏，折叠成一行 + 弹窗选 */}
          <div style={box}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
              <div style={{ minWidth: 0 }}>
                <div style={{
                  fontSize: 11.5, fontWeight: 700,
                  color: picked.length ? '#3ECF8E' : '#FF6B6B',
                }}>
                  素材 {picked.length} 张{picked.length === 0 ? '（必须先选）' : ''}
                </div>
                <div style={{ fontSize: 9, color: '#4C5765', marginTop: 2 }}>
                  {items.length === 0 ? '读不到素材（检查登录）' : `共 ${items.length} 张可选`}
                </div>
              </div>
              <button onClick={() => setShowMatPicker(true)}
                style={{ ...btn(picked.length > 0), padding: '7px 13px', fontSize: 11, flexShrink: 0 }}>
                选择
              </button>
            </div>

            {picked.length > 0 && (
              <div style={{ display: 'flex', gap: 4, marginTop: 8, flexWrap: 'wrap' }}>
                {picked.slice(0, 6).map((n) => {
                  const u = items.find((it) => String(it.name || it.key) === n)?.url
                  return u
                    ? /* eslint-disable-next-line @next/next/no-img-element */
                    <img key={n} src={String(u)} alt="" style={{ width: 38, height: 38, objectFit: 'cover', borderRadius: 4, border: '1px solid #242C38' }} />
                    : null
                })}
                {picked.length > 6 && (
                  <span style={{ fontSize: 10, color: '#7A8798', alignSelf: 'center' }}>+{picked.length - 6}</span>
                )}
              </div>
            )}
          </div>

          {/* ★生成按钮已移到顶栏（直播时不用滚动就能点） */}
        </div>

        {/* ══ 中栏：预览（最大，直播时观众看这里）══
            ★2026-11-06 用户："要适当必然中间" ⇒ 预览块**水平 + 垂直居中**，
              不被右栏内容长短影响（右栏是独立滚动列，改它不动这里） */}
        <div style={{
          minHeight: 0, overflowY: 'auto', overflowX: 'hidden',
          display: 'flex', flexDirection: 'column',
          /**
           * ★★★ 2026-11-06 用户（第二次）：「预览给你截图看下头部被切掉了」
           *
           * 我上次以为是"播放条占高度"，给了负 margin —— 没用。
           * 真正原因：**justifyContent:'center'**
           *   ⇒ 只要内容比容器高，居中就一定**溢出顶部且被裁**
           *     （CSS 死规则：flex 居中溢出只往下滚，不往上）
           *
           * 现在：改成 flex-start（永远从顶部排，绝不裁头部）
           *   代价：内容不满时贴顶、不居中
           *   补偿：预览用 min(78vh, ...) 已经尽量撑满，视觉上差不多
           */
          justifyContent: 'flex-start', alignItems: 'stretch',
          position: 'relative',
        }}>
          {!result && (
            <div style={{ ...box, width: '100%', height: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#4C5765', fontSize: 12 }}>
              生成后这里全屏显示成片
            </div>
          )}
          {result && (
            <>
                {/* 预览 + 全屏 + 时间轴（常驻，不随 tab 切换）*/}
                <div style={{ position: 'relative' }}>
                  {/* ★★★ 2026-11-05 用户："我要做个横屏，出来效果又是竖屏中出来一个横屏"
                     根因：这个 iframe 的 aspectRatio **写死 '9 / 16'**
                          ⇒ 横屏成片（1280×720）塞进竖框
                          ⇒ 里面的 --fit 按竖框算 ⇒ 缩成中间一条，上下大片黑
                     现在：框比例跟着画布走（用 result 里存的，或当前选择） */}
                  <iframe ref={iframeRef} src={result.url} title="lab2-preview"
                    style={{
                      display: 'block', margin: '0 auto',
                      /* 三栏后中栏宽 = 100vw - 260 - 360 - 间距 ≈ 100vw - 660 */
                      /* ★2026-11-06 用户："预览区头部被遮挡"
                         根因：`justifyContent:center` + 内容比容器高 ⇒ flex 居中**溢出顶部被裁**
                         修：播放条改成**叠在预览底部**（负 margin，不占文档流高度）
                            ⇒ 内容总高 ≤ 容器 ⇒ 居中不再溢出，预览也能加高到 80vh */
                      height: (result.aspect || aspect) === '16:9'
                        ? 'min(70vh, (100vw - 660px) * 9 / 16)'
                        : 'min(78vh, (100vw - 660px) * 16 / 9)',
                      aspectRatio: (result.aspect || aspect) === '16:9' ? '16 / 9' : '9 / 16',
                      border: '1px solid #242C38', borderRadius: 10, background: '#000',
                    }} />
  
                  {/* 右上角：全屏 / 新标签 / 框选（框选时隐藏，避免被覆盖层挡住） */}
                  {!cropOn && (
                    <>
                      <button onClick={openFullscreen}
                        title="全屏播放"
                        style={{ position: 'absolute', right: 10, top: 10, zIndex: 5, padding: '5px 10px',
                          background: 'rgba(10,14,20,.8)', color: '#BFE3FF', border: '1px solid rgba(58,124,184,.7)',
                          borderRadius: 6, fontSize: 11, cursor: 'pointer' }}>⛶ 全屏</button>

                      <a href={result.url} target="_blank" rel="noreferrer"
                        title="在新标签打开（不受网站容器影响）"
                        style={{ position: 'absolute', right: 10, top: 46, zIndex: 5, padding: '5px 10px',
                          background: 'rgba(10,14,20,.8)', color: '#BFE3FF', border: '1px solid rgba(58,124,184,.7)',
                          borderRadius: 6, fontSize: 11, textDecoration: 'none' }}>↗ 新标签</a>

                      {/* ★2026-11-06 框选截图：框一块 → 直接进对话附件 */}
                      <button
                        onClick={() => { seekTo(seekT, true); setCropOn(true); setCropRect(null); setErr('') }}
                        title="在画面上框一块，截下来直接发给它看"
                        style={{ position: 'absolute', left: 10, top: 10, zIndex: 5, padding: '5px 10px',
                          background: 'rgba(10,14,20,.8)', color: '#BEFFE0', border: '1px solid rgba(62,207,142,.75)',
                          borderRadius: 6, fontSize: 11, cursor: 'pointer' }}>📷 框选</button>
                    </>
                  )}

                  {/* ══ 框选覆盖层 ══ */}
                  {cropOn && (
                    <div
                      onPointerDown={(e) => {
                        const el = e.currentTarget as HTMLDivElement
                        try { el.setPointerCapture(e.pointerId) } catch { /* ignore */ }
                        const r = el.getBoundingClientRect()
                        const sx = e.clientX - r.left
                        const sy = e.clientY - r.top
                        cropStart.current = { x: sx, y: sy }
                        setCropRect({ x: sx, y: sy, w: 0, h: 0 })
                      }}
                      onPointerMove={(e) => {
                        if (!cropStart.current) return
                        const el = e.currentTarget as HTMLDivElement
                        const r = el.getBoundingClientRect()
                        const x = e.clientX - r.left
                        const y = e.clientY - r.top
                        const s = cropStart.current
                        setCropRect({
                          x: Math.min(s.x, x), y: Math.min(s.y, y),
                          w: Math.abs(x - s.x), h: Math.abs(y - s.y),
                        })
                      }}
                      onPointerUp={() => { cropStart.current = null }}
                      style={{
                        position: 'absolute', inset: 0, zIndex: 20, cursor: 'crosshair',
                        touchAction: 'none',
                      }}
                    >
                      {/* 未选区时整体压暗 */}
                      {!cropRect || cropRect.w < 4 ? (
                        <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,.42)' }} />
                      ) : (
                        /* 选区：亮框 + 四周压暗（boxShadow 造出来的） */
                        <div style={{
                          position: 'absolute',
                          left: cropRect.x, top: cropRect.y,
                          width: cropRect.w, height: cropRect.h,
                          border: '2px solid #3ECF8E',
                          boxShadow: '0 0 0 9999px rgba(0,0,0,.42)',
                          pointerEvents: 'none',
                        }} />
                      )}

                      {/* 底部操作条 */}
                      <div style={{
                        position: 'absolute', left: 0, right: 0, bottom: 10, zIndex: 2,
                        display: 'flex', justifyContent: 'center', gap: 8, alignItems: 'center',
                      }}>
                        <span style={{ fontSize: 10, color: '#BFE3FF' }}>
                          {cropRect && cropRect.w > 4
                            ? '截 ' + Math.round(cropRect.w) + '×' + Math.round(cropRect.h) + ' (屏幕像素)'
                            : '拖动画一个框'}
                        </span>
                        <button
                          onClick={doCrop}
                          disabled={cropBusy || !cropRect || cropRect.w < 40 || cropRect.h < 40}
                          style={{
                            padding: '6px 14px', borderRadius: 6, border: 'none', fontSize: 11, fontWeight: 700,
                            cursor: (cropBusy || !cropRect || cropRect.w < 40) ? 'default' : 'pointer',
                            background: (cropBusy || !cropRect || cropRect.w < 40) ? '#2A3440' : '#3ECF8E',
                            color: (cropBusy || !cropRect || cropRect.w < 40) ? '#7A8798' : '#06110B',
                          }}>
                          {cropBusy ? '截图…' : '✔ 加入对话'}
                        </button>
                        <button
                          onClick={() => { setCropOn(false); setCropRect(null) }}
                          style={{
                            padding: '6px 12px', borderRadius: 6, fontSize: 11, cursor: 'pointer',
                            border: '1px solid #242C38', background: '#0B0F14', color: '#7A8798',
                          }}>✖ 取消</button>
                      </div>
                    </div>
                  )}
                </div>
  
                {/* ★播放器：▶播放 / ⏸暂停 / 时间轴 / 下载
                    ★2026-11-06 用户："浮动悬窗是可以拖动的，你设计这个还是固定的"
                       ⇒ 改成**绝对定位 + 可拖动**：不占高度（治顶部被裁），位置随意放 */}
                <div
                  onPointerDown={(e) => {
                    /* 按钮/输入框/链接不触发拖动，其余区域都能拖 */
                    if ((e.target as HTMLElement).closest('button, input, a, select')) return
                    ctrlDrag.current = { sx: e.clientX, sy: e.clientY, ox: ctrlPos.x, oy: ctrlPos.y }
                    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId) } catch { /* ignore */ }
                  }}
                  onPointerMove={(e) => {
                    if (!ctrlDrag.current) return
                    const d = ctrlDrag.current
                    setCtrlPos({ x: d.ox + (e.clientX - d.sx), y: d.oy + (e.clientY - d.sy) })
                  }}
                  onPointerUp={() => { ctrlDrag.current = null }}
                  onPointerCancel={() => { ctrlDrag.current = null }}
                  onDoubleClick={() => setCtrlPos({ x: 0, y: 0 })}
                  title="按住空白处可以拖动；双击复位"
                  onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.opacity = '1' }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.opacity = '0.62' }}
                  style={{
                    ...box,
                    position: 'absolute',
                    right: 14, bottom: 14,
                    transform: `translate(${ctrlPos.x}px, ${ctrlPos.y}px)`,
                    width: 'min(620px, calc(100% - 28px))',
                    zIndex: 20,
                    padding: '7px 12px',
                    background: 'rgba(8,12,16,.92)',
                    backdropFilter: 'blur(8px)',
                    borderRadius: 9,
                    boxShadow: '0 8px 30px rgba(0,0,0,.55)',
                    opacity: 0.62,
                    transition: 'opacity .18s ease',
                    cursor: 'grab',
                    touchAction: 'none',
                  }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <button onClick={togglePlay}
                      style={{ fontSize: 14, padding: '6px 14px', minWidth: 74, cursor: 'pointer',
                        background: playing ? 'rgba(255,179,71,.22)' : 'rgba(62,207,142,.22)',
                        border: '1px solid ' + (playing ? '#FFB347' : '#3ECF8E'),
                        borderRadius: 7, color: playing ? '#FFE9C8' : '#D6FBEA', fontWeight: 700 }}>
                      {playing ? '⏸ 暂停' : '▶ 播放'}
                    </button>
                    <input type="range" min={0} max={result.totalSeconds || 45} step={0.05} value={seekT}
                      onChange={(e) => { const v = Number(e.target.value); setSeekT(v); seekTo(v) }}
                      style={{ flex: 1, accentColor: '#3ECF8E' }} />
                    <span style={{ fontSize: 10, color: '#BFE3FF', minWidth: 62, textAlign: 'right' }}>
                      {seekT.toFixed(1)}s / {result.totalSeconds || 45}s
                    </span>
                    <button onClick={() => { setPlaying(false); setSeekT(0); seekTo(0) }}
                      style={{ ...btn(false), fontSize: 10, padding: '4px 8px' }}>⏮</button>
                    <a href={result.url + '&download=1'} download={result.name}
                      style={{ ...btn(false), fontSize: 11, padding: '5px 11px', textDecoration: 'none',
                        background: 'rgba(74,158,255,.2)', borderColor: '#4A9EFF', color: '#BFE3FF' }}>
                      ⬇ 下载 HTML
                    </a>
                  </div>
  
                  {/* 段导航（2026-11-06 改：只有段号，点就跳）
                      ★用户实测："段 1 怎么都点不开" —— 根因是段号右边紧贴着 ✕
                        （标记删除），点偏一点就点到 ✕ ⇒ 不跳转 ⇒ 以为坏了
                      ⇒ 现在 ✕ 挪出去，变成下面独立的「标记当前段删除」按钮 */}
                  {(result.segments || []).length > 0 && (
                    <div style={{ display: 'flex', gap: 5, marginTop: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                      {(result.segments || []).map((s, i) => {
                        const active = seekT >= s.start && seekT < s.start + (s.duration || 3)
                        const marked = delSel.includes(i + 1)
                        return (
                          <button key={i}
                            onClick={() => {
                              /* ★★★ 2026-11-06 用户："预览中每段看到的不是完整的，全是每段第一帧"
                                 根因：这里只往后 0.25 秒 ⇒ 正好落在入场动画开始的地方
                                       （文字还在 opacity:0 / translateY 40px）
                                 修：跳到段的 72% —— 和自审截图取帧一致（那边用 0.7）
                                     （不取 100%：段末可能有淡出，会截到半透明） */
                              const d = s.duration || 4
                              seekTo(s.start + Math.max(0.4, d * 0.72))
                            }}
                            title={(s.start.toFixed(1)) + 's ~ ' + (s.start + (s.duration || 3)).toFixed(1) + 's（跳到该段动画完成处）'}
                            style={{
                              ...btn(active), fontSize: 10, padding: '4px 10px',
                              opacity: marked ? 0.45 : 1,
                              textDecoration: marked ? 'line-through' : 'none',
                            }}>
                            段 {i + 1}
                          </button>
                        )
                      })}

                      {/* ★标记删除：独立按钮，指哪删哪（不再挤在段号右边） */}
                      <button
                        onClick={() => {
                          const cur = (result.segments || []).findIndex(
                            (s) => seekT >= s.start && seekT < s.start + (s.duration || 3),
                          )
                          if (cur < 0) { setErr('先点一个段号，再标记删除'); return }
                          toggleDel(cur + 1)
                        }}
                        title="把当前段标记为待删（再点「删除并重排时间轴」才真的删）"
                        style={{
                          fontSize: 9.5, padding: '4px 10px', cursor: 'pointer',
                          borderRadius: 5, marginLeft: 6,
                          border: '1px solid #4A3A3A', background: '#120C0C', color: '#C98A8A',
                        }}>
                        ✕ 标记当前段删除
                      </button>
                    </div>
                  )}
                  {delSel.length > 0 && (
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8 }}>
                      <span style={{ fontSize: 10, color: '#FF9B9B' }}>
                        已标记删除 {delSel.length} 段（第 {[...delSel].sort((a, b) => a - b).join('、')} 段）
                      </span>
                      <button onClick={applyDelete} disabled={secBusy}
                        style={{
                          fontSize: 10, padding: '5px 12px', borderRadius: 6, cursor: secBusy ? 'default' : 'pointer',
                          border: '1px solid #FF6B6B', background: secBusy ? '#2A3440' : 'rgba(255,107,107,.2)',
                          color: secBusy ? '#7A8798' : '#FFC8C8', fontWeight: 700,
                        }}>
                        {secBusy ? '删除中…' : '删除并重排时间轴'}
                      </button>
                      <button onClick={() => setDelSel([])}
                        style={{ ...btn(false), fontSize: 10, padding: '5px 10px' }}>
                        取消
                      </button>
                    </div>
                  )}
  
                  <div style={{ fontSize: 9, color: '#4C5765', marginTop: 6, lineHeight: 1.6 }}>
                    点「▶ 播放」自动播完；也可以拖时间轴 / 点段号直接跳。
                    {!playing && seekT === 0 && '（现在停在 0s，点播放就开始）'}
                  </div>
                </div>

                {/* ★演示模式（2026-11-05 用户："换一个点个再中间下面"）*/}
                <div style={{ textAlign: 'center', marginTop: 10 }}>
                  <button onClick={() => setZen((z) => !z)}
                    title={zen ? '退出演示模式' : '演示模式（收起两侧，只留预览）'}
                    style={{
                      padding: '7px 20px', borderRadius: 7, fontSize: 11, cursor: 'pointer',
                      border: '1px solid ' + (zen ? '#FFB347' : '#242C38'),
                      background: zen ? 'rgba(255,179,71,.2)' : '#0B0F14',
                      color: zen ? '#FFE9C8' : '#7A8798',
                    }}>{zen ? '⛶ 退出演示' : '⛶ 演示模式（收起两侧）'}</button>
                </div>

            </>
          )}
        </div>

        {/* ══ 右栏：对话改片（★2026-11-06 用户："会话框不生成不出现，我说的是固定在右侧"）══ */}
        <div style={{
          overflowY: 'auto', minHeight: 0, paddingRight: 4,
          display: 'flex', flexDirection: 'column',
        }}>
          {/**
           * ★★★ 2026-11-06 用户：
           *   「看一下会话框 不生成不出现 我说的是固定在右侧，不要生成才出现
           *     而且要适当必然中间，现在是出现时严重压缩中间」
           *
           * 两个问题：
           *   ① 没生成时右栏**整块空白**（不出现）⇒ 现在常驻一段说明
           *   ② 生成后右栏内容一长，**中栏预览被挤窄**（因为右栏 overflowY:auto 会撑）
           *      ⇒ 中栏用 flex 居中 + 固定高度，不被右栏内容影响
           */}
          {!result && !zen && (
            <div style={{
              ...box,
              border: '1px dashed #2A3440', background: 'transparent',
              color: '#5E6B7A', fontSize: 11, lineHeight: 1.9,
            }}>
              <div style={{ fontWeight: 700, color: '#7A8798', marginBottom: 6, fontSize: 11.5 }}>
                💬 对话改片
              </div>
              生成一版之后，这里就是你和它对话的地方。<br />
              直接说哪儿不对（例：第 3 段的字压住菜了 / 结尾换成品牌名 / 数字太小），<br />
              它会在**现有版本上**改，不会重做整条。<br />
              <span style={{ color: '#4C5765', fontSize: 10 }}>
                也可以先在预览里「📷 框选」一块画面发过去。
              </span>
            </div>
          )}

          {result && (
            <>
              {/* ★★★ 2026-11-06 用户：
                  「指标自审 / 完成复制 / PROMPT报告不再显示，全部打印成一个文件。
                    镜像到本地，小眼睛点击弹窗看报告。」

                  ⇒ tab 栏删掉，按钮排删掉
                  ⇒ 报告由**后端生成文件**（gen_xxx.report.txt）+ 镜像到本地
                  ⇒ 页面只留：对话改片（常驻） + 一个「👁 看报告」 + 分享 */}
              {!zen && (
                <div style={{ display: 'flex', gap: 6, marginBottom: 8, alignItems: 'center' }}>
                  <span style={{ fontSize: 11.5, fontWeight: 700, color: '#BFE3FF' }}>💬 对话改片</span>
                  <div style={{ flex: 1 }} />
                  <button onClick={() => setShowReport(true)}
                    title="看完整报告（同时已存成本地文件 gen_xxx.report.txt）"
                    style={{ ...btn(false), padding: '5px 10px', fontSize: 11 }}>👁 看报告</button>

                  {/* ★2026-11-06 用户：「记忆系统对它好像没什么帮助」
                      根因之一：👍/👎 按钮被我在"去 tab"那版删了
                      ⇒ confirmPending / rejectPending 永不调用 ⇒ 记忆永远是 pending
                      ⇒ 现在恢复这两个按钮（一票就能把记忆转成 active / dead） */}
                  <button
                    onClick={async () => {
                      try {
                        await fetch('/api/lab2', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          credentials: 'include',
                          body: JSON.stringify({ action: 'confirm' }),
                        })
                        setErr('')
                        setChatMsgs((p) => [...p, {
                          role: 'assistant',
                          text: '已记为"这版好" ⇒ 你之前提过的意见会被强化，下一单优先执行。',
                        }])
                      } catch { setErr('标记失败') }
                    }}
                    title="这版可以（你之前提的意见会被强化，下一单优先用）"
                    style={{ ...btn(false), padding: '5px 10px', fontSize: 11 }}>👍</button>

                  <button
                    onClick={async () => {
                      try {
                        await fetch('/api/lab2', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          credentials: 'include',
                          body: JSON.stringify({ action: 'reject' }),
                        })
                        setErr('')
                        setChatMsgs((p) => [...p, {
                          role: 'assistant',
                          text: '已记为"这版不行" ⇒ 相关意见会被标记为无效，下次不再照做。',
                        }])
                      } catch { setErr('标记失败') }
                    }}
                    title="这版不行（相关意见会被标记无效，下次不再照做）"
                    style={{ ...btn(false), padding: '5px 10px', fontSize: 11 }}>👎</button>
                  <button onClick={() => {
                    const u = location.origin + '/w/' + encodeURIComponent(result.repoId || '1')
                      + '/' + encodeURIComponent(result.name)
                    try { navigator.clipboard.writeText(u) } catch { /* ignore */ }
                    setCopied('share')
                    setTimeout(() => setCopied(''), 2500)
                    window.open(u, '_blank')
                  }}
                    title="复制分享链接 + 新标签打开"
                    style={{ ...btn(copied === 'share'), padding: '5px 10px', fontSize: 11 }}>
                    {copied === 'share' ? '✓' : '🔗'}
                  </button>
                </div>
              )}


              {/* ★★★ 对话改片 + 重做 —— 现在是**常驻**（2026-11-06 去掉 tab 后）*/}
              {!zen && (
              <>
              <div style={{ ...box, marginTop: 0, border: '1px solid rgba(74,158,255,.4)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <span style={{ fontSize: 11, color: '#BFE3FF', fontWeight: 700 }}>💬 对话改片</span>
                  <span style={{ fontSize: 9, color: '#4C5765' }}>它记得这条片子的上下文</span>
                </div>

                <div style={{
                  maxHeight: 200, overflow: 'auto', background: '#06080B', border: '1px solid #1A2028',
                  borderRadius: 6, padding: 8, marginBottom: 8, lineHeight: 1.65,
                }}>
                  {chatMsgs.length === 0 && (
                    <div style={{ fontSize: 10, color: '#4C5765' }}>
                      先在上面点「生成」做一版，然后在这里说：
                      <br />「第 3 段的字太大」「把最后一段换成另一个结尾」「整体慢一点」…
                    </div>
                  )}
                  {chatMsgs.map((m, i) => (
                    <div key={i} style={{ marginBottom: 7 }}>
                      <span style={{ fontSize: 9, color: m.role === 'user' ? '#7CF' : '#FFB347' }}>
                        {m.role === 'user' ? '你' : '导演'}：
                      </span>
                      <span style={{ fontSize: 10.5, color: m.role === 'user' ? '#D8E2EC' : '#A8D8C0', whiteSpace: 'pre-wrap' }}>
                        {m.text}
                      </span>
                    </div>
                  ))}
                  {chatBusy && <div style={{ fontSize: 10, color: '#7A8798' }}>导演正在改…（20~60s）</div>}
                </div>

                {/* ★上传截图：把它看不见/看错的地方直接给它看 */}
                <div style={{ marginBottom: 8 }}>
                  <label style={{
                    display: 'inline-block', fontSize: 10, padding: '5px 11px', borderRadius: 6, cursor: 'pointer',
                    background: 'rgba(74,158,255,.16)', border: '1px solid #4A9EFF', color: '#BFE3FF',
                  }}>
                    📎 上传截图（把它看错的地方给它看）
                    <input type="file" accept="image/*" multiple style={{ display: 'none' }}
                      onChange={async (e) => {
                        const files = Array.from(e.target.files || [])
                        if (!files.length) return
                        const arr: { name: string; data: string }[] = []
                        for (const f of files.slice(0, 4)) {
                          const d = await new Promise<string>((res) => {
                            const fr = new FileReader()
                            fr.onload = () => res(String(fr.result))
                            fr.onerror = () => res('')
                            fr.readAsDataURL(f)
                          })
                          if (d) arr.push({ name: f.name, data: d })
                        }
                        setChatImgs((p) => [...p, ...arr].slice(0, 4))
                        e.target.value = ''
                      }} />
                  </label>
                  {chatImgs.length > 0 && (
                    <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
                      {chatImgs.map((im, i) => (
                        <div key={i} style={{ position: 'relative' }}>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={im.data} alt={im.name} style={{ width: 52, height: 52, objectFit: 'cover', borderRadius: 5, border: '1px solid #242C38' }} />
                          <button onClick={() => setChatImgs((p) => p.filter((_, j) => j !== i))}
                            style={{ position: 'absolute', right: -4, top: -4, width: 15, height: 15, borderRadius: '50%', background: '#FF6B6B', color: '#fff', border: 'none', fontSize: 9, cursor: 'pointer', lineHeight: '15px', padding: 0 }}>×</button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div style={{ display: 'flex', gap: 6 }}>
                  <input
                    value={chatText}
                    onChange={(e) => setChatText(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) sendChat() }}
                    placeholder="例：第 3 段的字小一点；结尾换成品牌名"
                    style={{
                      flex: 1, background: '#06080B', border: '1px solid #242C38', borderRadius: 6,
                      color: '#D8E2EC', fontSize: 11, padding: '8px 10px',
                    }}
                  />
                  <button onClick={sendChat} disabled={chatBusy || !chatText.trim()}
                    style={{
                      padding: '8px 16px', borderRadius: 6, border: 'none', fontSize: 11, fontWeight: 700,
                      cursor: (chatBusy || !chatText.trim()) ? 'default' : 'pointer',
                      background: (chatBusy || !chatText.trim()) ? '#2A3440' : 'linear-gradient(100deg,#4A9EFF,#3ECF8E)',
                      color: (chatBusy || !chatText.trim()) ? '#7A8798' : '#06110B',
                    }}>
                    {chatBusy ? '改…' : '发送'}
                  </button>

                  {/* ★2026-11-06 用户："2个重复了 帮剪掉一个…下面那个不要了"
                      ⇒ 下面那块（独立 textarea + 独立上传截图 + 按意见重做）已删
                      ⇒ 但"推倒重来"的能力不能丢 ⇒ 收进这里，用输入框的话 + 这里的图
                      ⚠️ 区别：
                         发送  = 在**当前这一版上改**（3 分钱，几秒）
                         ↻ 重做 = 丢掉当前版，**重新生成一版**（6 分钱，50 秒） */}
                  <button
                    onClick={() => {
                      const fb = chatText.trim()
                      if (!fb) { setErr('先在输入框写一句「整条要怎么改」'); return }
                      if (!window.confirm('重做 = 丢掉当前这一版，用素材**重新生成**（约 50 秒 / 6 分钱）。\n\n继续？')) return
                      setRetrying(true)
                      gen(true, fb, chatImgs.map((x) => x.data))
                    }}
                    disabled={chatBusy || retrying || !chatText.trim()}
                    title="不带当前版本，从头重新生成一版（换思路用这个）"
                    style={{
                      padding: '8px 12px', borderRadius: 6, fontSize: 11, fontWeight: 700,
                      cursor: (chatBusy || retrying || !chatText.trim()) ? 'default' : 'pointer',
                      background: (chatBusy || retrying || !chatText.trim()) ? '#2A3440' : 'rgba(255,179,71,.22)',
                      border: '1px solid ' + ((chatBusy || retrying || !chatText.trim()) ? '#2A3440' : '#FFB347'),
                      color: (chatBusy || retrying || !chatText.trim()) ? '#7A8798' : '#FFE9C8',
                    }}>
                    {retrying ? '重做…' : '↻ 重做整条'}
                  </button>
                </div>

                <div style={{ fontSize: 9, color: '#4C5765', marginTop: 6, lineHeight: 1.6 }}>
                  发送 = 在**这一版上改**（快、便宜）｜ ↻ 重做整条 = 用素材**重新生成一版**（慢、贵，适合换思路）
                </div>
              </div>

              </>
              )}

              {/* AI 思考 + 技术扫描 + 自审 —— ★2026-11-06 用户要求"不再显示"
                  （全部打进 gen_xxx.report.txt，点「👁 看报告」看）
                  代码保留但永不渲染，方便以后恢复 */}
              {tab === 'metrics' && !zen && (
              <>
              <div style={{ ...box, marginTop: 0 }}>
                <span style={label}>AI 思考日志（__trace）</span>
                {result.trace ? (
                  <pre style={{ fontSize: 9.5, lineHeight: 1.6, color: '#A8C0D8', whiteSpace: 'pre-wrap', wordBreak: 'break-all', margin: 0, maxHeight: 320, overflow: 'auto' }}>
                    {JSON.stringify(result.trace, null, 1)}
                  </pre>
                ) : (
                  <div style={{ fontSize: 11, color: '#FF6B6B' }}>❌ 这一版没写 __trace（模型漏了）</div>
                )}
              </div>

              {/* 技术指标 */}
              <div style={{ ...box, marginTop: 12 }}>
                <span style={label}>技术扫描</span>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 14px', fontSize: 10.5 }}>
                  <div>段数：{result.metrics.sections}</div>
                  <div>耗时：{result.elapsed}s</div>
                  <div style={{ gridColumn: '1 / -1', fontSize: 9.5, color: '#7A8798' }}>
                    存到：{result.savedTo || result.name}
                  </div>
                  {/* ★★ 自审记录（2026-11-03）：它自己看了截图，改了几轮、为什么改 */}
                  <div style={{ gridColumn: '1 / -1', marginTop: 2, marginBottom: 4 }}>
                    <div style={{
                      fontWeight: 700, marginBottom: 6,
                      color: result.review?.shotOk ? '#7CF' : '#FF6B6B',
                    }}>
                      自审 {result.review?.shotOk ? '✓' : '✗'}
                      {result.review?.shotOk
                        ? `（改了 ${result.review.rounds} 轮）`
                        : `（截图失败：${result.review?.shotErr || '未执行'}）`}
                    </div>

                    {result.review?.shotOk && (
                      <div style={{ fontSize: 9.5, lineHeight: 1.75 }}>
                        <div style={{ color: '#FFB347', marginBottom: 3 }}>
                          发现的问题（{result.review.issues.length}）：
                        </div>
                        {result.review.issues.length === 0
                          ? <div style={{ color: '#7CF' }}>　无（它认为合格）</div>
                          : result.review.issues.map((s, i) => (
                            <div key={i} style={{ color: '#E8C88A' }}>　{i + 1}. {s}</div>
                          ))}

                        <div style={{ color: '#FFB347', marginTop: 6, marginBottom: 3 }}>
                          改了什么（{result.review.changes.length}）：
                        </div>
                        {result.review.changes.length === 0
                          ? <div style={{ color: '#7CF' }}>　没改（它认为没问题）</div>
                          : result.review.changes.map((s, i) => (
                            <div key={i} style={{ color: '#A8D8C0' }}>　{i + 1}. {s}</div>
                          ))}
                      </div>
                    )}
                  </div>

                  <div style={{ gridColumn: '1 / -1', fontSize: 9.5,
                    color: (result.imgEmbedded || 0) > 0 ? '#7CF' : '#FF6B6B' }}>
                    AI 看到图：{result.imgSent ?? '?'} 张 · 内联进 HTML：{result.imgEmbedded ?? '?'} 张
                    {(result.imgEmbedded || 0) === 0 ? '（0 张 = 图没进去）' : ''}
                    {/** ★2026-11-05：外链 > 0 ⇒ 这份 HTML 会过期（签名 1~2 小时） */}
                    {(result.imgExternal || 0) > 0 && (
                      <span style={{ color: '#FF6B6B' }}>
                        {' '}· ⚠️ 外链 {result.imgExternal} 个（签名会过期，1~2 小时后图全裂）
                      </span>
                    )}
                  </div>
                  {(result.ossKeys || []).length > 0 && (
                    <div style={{ gridColumn: '1 / -1', fontSize: 9, color: '#4C5765', wordBreak: 'break-all' }}>
                      OSS 路径：{(result.ossKeys || []).join(' | ')}
                    </div>
                  )}
                  {(result.imgErrs || []).length > 0 && (
                    <div style={{ gridColumn: '1 / -1', fontSize: 9, color: '#FF6B6B', wordBreak: 'break-all', lineHeight: 1.6 }}>
                      读图失败：{(result.imgErrs || []).join(' ｜ ')}
                    </div>
                  )}
                  <div style={{ color: result.metrics.text > 0 ? '#7CF' : '#FF6B6B' }}>
                    &lt;text&gt;：{result.metrics.text} {result.metrics.text === 0 ? '（围边必错）' : ''}
                  </div>
                  <div>&lt;svg&gt;：{result.metrics.svg} · canvas：{result.metrics.canvas}</div>
                  <div style={{ color: result.metrics.lineHeightBad > 0 ? '#FFB347' : '#7CF' }}>
                    line-height 最低：{result.metrics.lineHeightMin ?? '-'}（违规 {result.metrics.lineHeightBad}）
                  </div>
                  <div style={{ color: result.metrics.letterSpacingNeg > 0 ? '#FFB347' : '#7CF' }}>
                    负字距：{result.metrics.letterSpacingNeg} 处
                  </div>
                  <div style={{ color: result.metrics.darkCount > 0 ? '#FF6B6B' : '#7CF' }}>
                    压暗：{result.metrics.darkCount} 处{darkTip(result.metrics)}
                  </div>
                  <div style={{ color: result.metrics.hasSticker ? '#7CF' : '#7B8798' }}>
                    贴纸白边：{result.metrics.hasSticker ? '有' : '无'}
                  </div>
                  <div style={{ color: result.metrics.hasAutoplay ? '#7CF' : '#FF6B6B' }}>
                    自动播放：{result.metrics.hasAutoplay ? '有' : '无（打开只有第一帧）'}
                  </div>
                  {/* ★2026-11-06 动画死锁自动修复（致命错误，不靠自审发现） */}
                  {(result.deadlockFixed || 0) > 0 && (
                    <div style={{ gridColumn: '1 / -1', fontSize: 9.5, color: '#FF6B6B', lineHeight: 1.7 }}>
                      ⚠️ 动画死锁 {result.deadlockFixed} 处已自动修
                      （原片写的是 <code>[data-p=&quot;1&quot;]</code>，可见时 p 永远到不了 1
                      ⇒ 这些元素整段隐藏 ⇒ 全黑）
                    </div>
                  )}

                  {/* ★2026-11-06 动画终态缺失自动补（JS 加 .in 但 CSS 漏规则 ⇒ 全片无字） */}
                  {(result.animInFixed || 0) > 0 && (
                    <div style={{ gridColumn: '1 / -1', fontSize: 9.5, color: '#FF6B6B', lineHeight: 1.7 }}>
                      ⚠️ 动画终态缺失 {result.animInFixed} 条已自动补
                      （JS 会 <code>classList.add(&apos;in&apos;)</code>，但 CSS 没写{' '}
                      <code>.anim-up.in</code> ⇒ 所有文字永远 opacity:0 ⇒ 全片无字）
                    </div>
                  )}

                  {/* ★2026-11-06 段落 id 缺失自动补（CSS 用了 #sN 但 section 没 id） */}
                  {(result.sectionIdsFixed || 0) > 0 && (
                    <div style={{ gridColumn: '1 / -1', fontSize: 9.5, color: '#FF6B6B', lineHeight: 1.7 }}>
                      ⚠️ 段落 id 缺失 {result.sectionIdsFixed} 个已自动补
                      （CSS 用 <code>#s1 .big</code> 这种前缀，但 HTML 的 section 没有 id
                      ⇒ 段落样式全废：巨字变 16px、遮罩失效、文字挤成一坨）
                    </div>
                  )}

                  {/* ★2026-11-05 设定 vs 实际（软指标被审美覆盖，用数字堵住） */}
                  {result.setCheck && (
                    <div style={{
                      gridColumn: '1 / -1', fontSize: 9.5, lineHeight: 1.7,
                      color: Math.abs(result.setCheck.actualPct - result.setCheck.bigImgSet) > 20 ? '#FF6B6B' : '#7CF',
                    }}>
                      设定 vs 实际：
                      大图比设 <b>{result.setCheck.bigImgSet}%</b>
                      {' → '}实际满幅 <b>{result.setCheck.fullSecs}/{result.setCheck.totalSecs}</b>
                      {' = '}<b>{result.setCheck.actualPct}%</b>
                      {Math.abs(result.setCheck.actualPct - result.setCheck.bigImgSet) > 20
                        ? '　⚠️ 差得多，问它为什么'
                        : '　✅ 对得上'}
                    </div>
                  )}

                  {/* ★2026-11-05 素材使用明细（它看的是哪张 / 漏了哪张） */}
                  {result.imgUsage && !result.imgUsage.unknown && (
                    <div style={{ gridColumn: '1 / -1', fontSize: 9.5, lineHeight: 1.7 }}>
                      <div style={{ color: result.imgUsage.missing.length ? '#FF6B6B' : '#7CF' }}>
                        素材使用：{result.imgUsage.used.length} / {result.imgUsage.total} 张
                        {result.imgUsage.missing.length > 0
                          ? ` · ⚠️ 漏了 IMG_${result.imgUsage.missing.join('、IMG_')}`
                          : ' · 全部用上 ✅'}
                      </div>
                      <div style={{ color: '#7B8798', wordBreak: 'break-all' }}>
                        逐段：
                        {result.imgUsage.perSec.map((ids, i) => (
                          <span key={i}>
                            {' '}段{i + 1}
                            <span style={{ color: ids.length ? '#8FB8D8' : '#FF6B6B' }}>
                              [{ids.length ? ids.map((x) => 'IMG_' + x).join('+') : '无图'}]
                            </span>
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                  <div style={{ color: (result.metrics.hasImgs || 0) > 0 ? '#7CF' : '#FF6B6B' }}>
                    内联图：{result.metrics.hasImgs ?? 0} 张
                  </div>
                  <div style={{ color: (result.metrics.cssVarP || 0) > 20 ? '#7CF' : '#FFB347' }}>
                    CSS var(--p)：{result.metrics.cssVarP ?? 0} 处
                    {(result.metrics.cssVarP || 0) < 5 ? '（≈0 ⇒ 动效全靠 JS，一崩就静止）' : ''}
                  </div>
                  <div style={{ color: (result.metrics.svgText || 0) > 0 ? '#7CF' : '#FFB347' }}>
                    SVG：{result.metrics.svgCount ?? 0} 个 / text {result.metrics.svgText ?? 0} / paint-order {result.metrics.paintOrder ?? 0}
                  </div>
                  <div style={{ color: (result.metrics.canvasCount || 0) > 0 ? '#7CF' : '#7B8798' }}>
                    canvas：{result.metrics.canvasCount ?? 0} 个
                  </div>
                </div>
              </div>
              </>
              )}
            </>
          )}
        </div>
      </div>

      {/* ══ 完整报告弹窗（2026-11-05）══ */}
      {showReport && result && (
        <div onClick={() => setShowReport(false)}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,.8)', zIndex: 210,
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
          }}>
          <div onClick={(e) => e.stopPropagation()}
            style={{
              width: 'min(920px, 94vw)', maxHeight: '88vh', display: 'flex', flexDirection: 'column',
              background: '#0B0F14', border: '1px solid #2A3440', borderRadius: 12, overflow: 'hidden',
            }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 15px', borderBottom: '1px solid #1A2028' }}>
              <span style={{ fontSize: 13, fontWeight: 700 }}>本单完整报告</span>
              <div style={{ flex: 1 }} />
              <button onClick={() => copyAll('all', result.reportText || buildReport())} style={{ ...btn(copied === 'all'), fontSize: 11 }}>
                {copied === 'all' ? '✓ 已复制' : '📋 复制全文'}
              </button>
              <button onClick={() => setShowReport(false)} style={{ ...btn(true), fontSize: 11 }}>关闭</button>
            </div>
            <pre style={{
              flex: 1, minHeight: 0, overflow: 'auto', margin: 0, padding: 15,
              fontSize: 11, lineHeight: 1.75, color: '#C8D8E8', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
              background: '#06080B',
            }}>{result.reportText || buildReport()}</pre>
          </div>
        </div>
      )}

      {/* ══ 素材选择弹窗（2026-11-05 直播版：左栏不再堆几十张）══ */}
      {showMatPicker && (
        <div
          onClick={() => setShowMatPicker(false)}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,.78)', zIndex: 200,
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
          }}>
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: 'min(980px, 94vw)', maxHeight: '86vh', display: 'flex', flexDirection: 'column',
              background: '#0B0F14', border: '1px solid #2A3440', borderRadius: 12, overflow: 'hidden',
            }}>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px',
              borderBottom: '1px solid #1A2028', flexShrink: 0,
            }}>
              <span style={{ fontSize: 13, fontWeight: 700 }}>选择素材</span>
              <span style={{ fontSize: 11, color: picked.length ? '#3ECF8E' : '#7A8798' }}>
                已选 {picked.length} 张
              </span>
              <span style={{ fontSize: 10, color: '#4C5765' }}>共 {items.length} 张</span>
              <div style={{ flex: 1 }} />
              <button onClick={() => setPicked([])} style={{ ...btn(false), fontSize: 10.5 }}>清空</button>
              <button onClick={() => setPicked(items.slice(0, 60).map((it, i) => String(it.name || it.key || i)))}
                style={{ ...btn(false), fontSize: 10.5 }}>全选</button>
              <button onClick={() => setShowMatPicker(false)}
                style={{ ...btn(true), fontSize: 10.5 }}>完成</button>
            </div>

            <div style={{
              padding: 14, overflowY: 'auto', minHeight: 0,
              /* ★2026-11-05 用户："不要显示那么多图片出现挤压" ⇒ 格子加大，靠滚动 */
              display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(154px, 1fr))', gap: 10,
            }}>
              {items.map((it, i) => {
                const n = String(it.name || it.key || i)
                const on = picked.includes(n)
                return (
                  <button key={n} onClick={() => toggle(n)} title={n}
                    style={{
                      /* ★2026-11-05 修：原来用 aspectRatio:'1/1'，被 grid 的 stretch 打破
                         ⇒ 格子塌成横条、图片被压扁
                         ⇒ 改成**固定高度 132px**，宽由 grid 列宽决定，永远不塌 */
                      position: 'relative', padding: 0, cursor: 'pointer',
                      display: 'block', width: '100%', height: 152, lineHeight: 0,
                      border: on ? '2px solid #3ECF8E' : '1px solid #242C38',
                      borderRadius: 7, overflow: 'hidden',
                      background: on ? 'rgba(62,207,142,.15)' : '#0B0F14',
                    }}>
                    {it.url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={it.url} alt={n} loading="lazy"
                        style={{ width: '100%', height: 152, objectFit: 'cover', display: 'block' }} />
                    ) : (
                      <span style={{ fontSize: 9, color: '#7A8798' }}>{i + 1}</span>
                    )}
                    {on && (
                      <span style={{
                        position: 'absolute', right: 3, top: 3, width: 17, height: 17,
                        borderRadius: '50%', background: '#3ECF8E', color: '#06110B',
                        fontSize: 11, lineHeight: '17px', textAlign: 'center', fontWeight: 900,
                      }}>✓</span>
                    )}
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function darkTip(m: Metrics) {
  return m.darkMin ? '（最低 ' + m.darkMin + '）' : ''
}
