/**
 * ★LAB_DAILY_V1 · 实验线接口（2026-10-30）
 * =============================================================================
 * ⚠️ 隔离承诺（用户明确要求）：
 *   · **不进** `daily.ts` 的 handleDailyLine 状态机
 *   · **不生成** photoCard / copyCard / doneCard 任何卡片
 *   · **不改** 任何现有文件
 *
 * 允许复用（用户授权）：页面、仓库读图、AI 调用。
 *
 * 本接口只做一件事：**表单 → 提示词 → AI → 一个 HTML 文件**（不渲染 mp4）。
 * 产物写 `temp/_lab/out/`，通过 `/api/lab/file?name=xxx` 取回。
 */
import { NextRequest, NextResponse } from 'next/server'
import fs from 'node:fs'
import path from 'node:path'
import { getAuthFromHeaders, getAuthFromCookie } from '@/lib/api-auth'
import { buildLabPrompt, type LabSeg, type LabForm } from '@/lib/lab/prompt'

export const maxDuration = 900

/** 实验线自己的产物目录（唯一写入点，删它不影响任何东西） */
function labDir(sub: string): string {
  const d = path.join(process.cwd(), 'temp', '_lab', sub)
  fs.mkdirSync(d, { recursive: true })
  return d
}

/** 读一张图 → base64（复用小图的思路：先缩到 512 再送，避免请求体过大） */
async function readImgB64(key: string): Promise<string | null> {
  try {
    const { getObject } = await import('@/lib/oss')
    const buf = await getObject(key)
    if (!buf || !buf.length) return null
    return buf.toString('base64')
  } catch {
    return null
  }
}

/** 用 ffmpeg 把图缩到指定长边（只影响送 AI / 内嵌那份，不改成品分辨率） */
async function shrinkB64(b64: string, maxEdge: number, quality: number): Promise<string> {
  try {
    const { spawnSync } = await import('node:child_process')
    const os = await import('node:os')
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lab-'))
    const inP = path.join(dir, 'i.bin')
    const outP = path.join(dir, 'o.jpg')
    try {
      fs.writeFileSync(inP, Buffer.from(b64, 'base64'))
      /* ⚠️ 这里**不加 -q:v 以下的缩放参数**（不加 -vf scale 之外的东西）；
         关键是 `scale=W:W:force_original_aspect_ratio=decrease` 这个写法必须对
         （`min(512,iw)` 那种写法里逗号要转义，之前踩过 ⇒ 17 张全失败）。 */
      const r = spawnSync('ffmpeg', ['-y', '-v', 'error', '-threads', '1', '-i', inP,
        '-vf', 'scale=' + maxEdge + ':' + maxEdge + ':force_original_aspect_ratio=decrease',
        '-threads', '1', '-q:v', String(quality), outP], { timeout: 20000 })
      if (r.status === 0 && fs.existsSync(outP)) {
        const out = fs.readFileSync(outP)
        if (out.length > 512 && out.length < Buffer.from(b64, 'base64').length) {
          return out.toString('base64')
        }
      }
    } finally {
      try { fs.rmSync(dir, { recursive: true, force: true }) } catch { /* ignore */ }
    }
  } catch { /* 缩图失败就用原图 */ }
  return b64
}

/**
 * ★把 HTML 里的 `1.jpg` / `url('2.jpg')` 换成 base64 内嵌。
 *
 * 为什么必须做：AI 生成的是相对路径引用，而我们**没有把图放进产物目录**
 * ⇒ 浏览器里全是碎图。成品线是靠 `daily-film.mjs` 的内嵌那一步解决的，
 * lab 没走那步，所以这里自己来。
 *
 * 用 **1024px / q4** 的版本内嵌（约 80~120KB/张 ⇒ 17 张约 1.5MB）：
 *   · 比原图小得多（浏览器打开快）
 *   · 比 512 清晰（能看出素材质量）
 */
function inlineImages(html: string, b64ByName: Record<string, string>): { html: string; n: number } {
  let out = html
  let n = 0
  /* 匹配 `url("1.jpg")` / `url('1.jpg')` / `url(1.jpg)` / `src="1.jpg"` / `src='1.jpg'` */
  const re = /(url\(\s*['"]?|src\s*=\s*['"])(?!data:)([0-9]{1,3}\.(?:jpg|jpeg|png|webp))/gi
  out = out.replace(re, (m0, pre, name) => {
    const b64 = b64ByName[name] || b64ByName[name.toLowerCase()]
    if (!b64) return m0
    n++
    const ext = (String(name).split('.').pop() || '').toLowerCase()
    const mime = ext === 'png' ? 'png' : ext === 'webp' ? 'webp' : 'jpeg'
    return pre + 'data:image/' + mime + ';base64,' + b64
  })
  return { html: out, n }
}

/** 默认分镜（用户没给分镜表时，按素材数量均分） */
function defaultSegs(n: number, noImgEnds: boolean): LabSeg[] {
  const pool = Array.from({ length: n }, (_, i) => i + 1)
  const mid = pool.slice(0, Math.max(0, n - (noImgEnds ? 2 : 0)))
  const per = Math.max(1, Math.ceil(mid.length / 4))
  const chunks: number[][] = []
  for (let i = 0; i < mid.length; i += per) chunks.push(mid.slice(i, i + per))

  const titles = [
    ['一锅老汤', '煮了二十三年'],
    ['鲜切现涮', '红白分明'],
    ['炭火铜锅', '热气不散'],
    ['今晚就来', '老地方见'],
    ['慢慢吃', '不着急'],
    ['再来一锅', '还是这个味'],
  ]
  const bodies = [
    '锅里的汤从早滚到晚，一天也没凉过。',
    '肉切得薄厚均匀，红白纹路看得清清楚楚。',
    '炭火烧得旺，铜锅边上一圈热气。',
    '门口灯还亮着，推门进去就有位置。',
    '吃到一半，汤还滚着，人也不想走。',
    '锅底还是那个味，来的人都认这个。',
  ]

  const segs: LabSeg[] = []
  if (noImgEnds) {
    segs.push({ t1: titles[0][0], t2: titles[0][1], body: bodies[0], imgs: [] })
  }
  chunks.forEach((c, i) => {
    const t = titles[(i + 1) % titles.length]
    segs.push({ t1: t[0], t2: t[1], body: bodies[(i + 1) % bodies.length], imgs: c })
  })
  if (noImgEnds) {
    segs.push({ t1: '今晚就来', t2: '老地方见', body: '别等周末了，今晚就约一桌热乎的。', imgs: [] })
  }
  return segs.slice(0, 12)
}

export async function POST(request: NextRequest) {
  /* ★LAB_DAILY_V1：**两种鉴权都试** —— middleware 正常会给 `X-User-Id`，
     但如果它因为任何原因没注入（白名单 / 路径未匹配 / 部署差异），会误报"未登录"。
     ⇒ 先读 header，拿不到再直接解析登录 cookie。 */
  const auth = getAuthFromHeaders(request) || getAuthFromCookie(request)
  if (!auth) return NextResponse.json({ success: false, message: '请先登录' }, { status: 401 })

  let body: any = {}
  try { body = await request.json() } catch { /* ignore */ }

  const form: LabForm = {
    sellingPoints: String(body?.sellingPoints || ''),
    tone: String(body?.tone || 'auto'),
    aspect: String(body?.aspect || '9:16'),
    plateRatio: Number(body?.plateRatio ?? 6),
    designStyle: String(body?.designStyle || ''),
    drawMode: String(body?.drawMode || ''),
    tier: String(body?.tier || 'strict'),
    noImgEnds: !!body?.noImgEnds,
  }

  /* ── 取素材：读仓库（只读，不写） ── */
  const names: string[] = Array.isArray(body?.names) ? body.names.map(String) : []
  if (!names.length) {
    return NextResponse.json({ success: false, message: '请先选素材（names 为空）' }, { status: 400 })
  }
  form.imgCount = names.length

  const t0 = Date.now()
  const imgParts: any[] = []
  /** 映射：`1.jpg` → 1024px 的 base64（内嵌进 HTML 用） */
  const b64ByName: Record<string, string> = {}
  let shrinkFail = 0
  for (const nm of names) {
    const raw = await readImgB64('storage/' + auth.userId + '/' + nm)
    if (!raw) continue
    /* 送 AI 看：512px（省请求体） */
    const small = await shrinkB64(raw, 512, 5)
    if (small === raw) shrinkFail++
    imgParts.push({ type: 'image_url', image_url: { url: 'data:image/jpeg;base64,' + small } })
    /* 内嵌进 HTML：1024px（比 512 清晰，比原图小） */
    const mid = await shrinkB64(raw, 1024, 4)
    /* HTML 里可能是 `20261019_001.jpg` 也可能是 `1.jpg` —— 两种键都登记 */
    const base = String(nm)
    b64ByName[base] = mid
    const idx = names.indexOf(nm) + 1
    b64ByName[idx + '.jpg'] = mid
    b64ByName[idx + '.jpeg'] = mid
  }
  if (!imgParts.length) {
    return NextResponse.json({ success: false, message: '素材一张都没读到' }, { status: 400 })
  }
  console.log('[LAB] 读图完成 ' + imgParts.length + ' 张 · 缩图失败 ' + shrinkFail + ' 张'
    + ' · 内嵌用 1024px')

  /* ── 生成分镜（用户可选传入，否则默认） ── */
  const segs: LabSeg[] = Array.isArray(body?.segs) && body.segs.length
    ? body.segs.map((s: any) => ({
      t1: String(s?.t1 || '').slice(0, 16),
      t2: String(s?.t2 || '').slice(0, 18),
      body: String(s?.body || '').slice(0, 60),
      imgs: Array.isArray(s?.imgs) ? s.imgs.map(Number) : [],
    }))
    : defaultSegs(names.length, !!form.noImgEnds)

  const prompt = buildLabPrompt(segs, form)

  /* ── 调 deepseek（只用一个模型，不回落） ── */
  const key = String(process.env.DEEPSEEK_API_KEY || '').trim()
  if (!key) return NextResponse.json({ success: false, message: '没有 DEEPSEEK_API_KEY' }, { status: 500 })

  const payload = JSON.stringify({
    model: 'deepseek-flash',
    messages: [{ role: 'user', content: [{ type: 'text', text: prompt }, ...imgParts] }],
    max_tokens: 65536,
    temperature: 0.8,
    stream: false,
  })
  const mb = Buffer.byteLength(payload) / 1048576
  console.log('[LAB] 送图 ' + imgParts.length + ' 张 · 请求体约 ' + mb.toFixed(2) + ' MB'
    + ' · prompt ' + prompt.length + ' 字 · 分镜 ' + segs.length + ' 段')

  let txt = ''
  let diag = ''
  try {
    const r = await fetch('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
      body: payload,
      signal: AbortSignal.timeout(600000),
    })
    const j: any = await r.json().catch(() => null)
    txt = String(j?.choices?.[0]?.message?.content || '')
    const rc = String(j?.choices?.[0]?.message?.reasoning_content || '')
    diag = 'finish=' + String(j?.choices?.[0]?.finish_reason || '?')
      + ' · 思考 ' + rc.length + ' 字 · 输出 ' + txt.length + ' 字'
      + ' · in=' + String(j?.usage?.prompt_tokens || '?')
      + ' out=' + String(j?.usage?.completion_tokens || '?')
  } catch (e: any) {
    const code = String(e?.cause?.code || '')
    return NextResponse.json({
      success: false,
      message: 'DeepSeek 调用失败：' + String(e?.message || e).slice(0, 160) + (code ? ' | code=' + code : ''),
    }, { status: 502 })
  }

  /* ── 提取 HTML ── */
  const m = /```(?:html)?\s*([\s\S]*?)```/.exec(txt)
  let html = (m ? m[1] : txt).trim()
  const s = html.indexOf('<!DOCTYPE')
  const e2 = html.lastIndexOf('</html>')
  if (s >= 0 && e2 > s) html = html.slice(s, e2 + 7)

  if (html.length < 8000) {
    return NextResponse.json({
      success: false,
      message: 'AI 输出过短（' + html.length + ' 字，正常 1.5 万字以上）—— ' + diag,
    }, { status: 502 })
  }

  /* ── ① 内嵌图片（否则浏览器里全是碎图） ── */
  let inlineN = 0
  {
    const before = html.length
    const r = inlineImages(html, b64ByName)
    html = r.html
    inlineN = r.n
    console.log('[LAB] 内嵌图 ' + r.n + ' 处 · ' + Math.round(before / 1024) + 'KB → '
      + Math.round(html.length / 1024) + 'KB'
      + (r.n === 0 ? '  ⚠️ 一处都没匹配到（检查 HTML 里的图片引用写法）' : ''))
  }

  /* ── ② 强制注入「预览模式」（不靠模型照抄；漏了就只能看第一屏） ── */
  {
    const { injectPreviewMode } = await import('@/lib/lab/preview')
    const isLand = String(form.aspect || '') === '16:9'
    const before = html.length
    html = injectPreviewMode(html, isLand ? 1280 : 720, isLand ? 720 : 1280)
    console.log('[LAB] preview guard 注入: ' + before + ' → ' + html.length + ' 字'
      + ' · data-mode=' + (/data-mode="preview"/.test(html) ? 'preview' : '⚠️未注入'))
  }

  /* ── 落盘（唯一写入点） ── */
  const outDir = labDir('out')
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const name = 'lab-' + ts + '.html'
  fs.writeFileSync(path.join(outDir, name), html, 'utf8')
  /* ★存一份 meta（`1.jpg` 对应哪张原图）—— 以后想"重新内嵌历史文件"时需要它，
     否则 HTML 里只有 `1.jpg` 这种序号，无法还原。 */
  try {
    fs.writeFileSync(path.join(outDir, name.replace('.html', '.meta.json')),
      JSON.stringify({
        at: new Date().toISOString(),
        names,                                  // 顺序即 1.jpg / 2.jpg …
        segs: segs.length,
        form,
        diag,
      }, null, 2), 'utf8')
  } catch { /* meta 失败不影响出页面 */ }

  /* 同时存一份 trace（方便回看提示词） */
  const traceDir = labDir('trace')
  fs.writeFileSync(path.join(traceDir, name.replace('.html', '-prompt.txt')), prompt, 'utf8')
  fs.writeFileSync(path.join(traceDir, name.replace('.html', '-out.txt')),
    '【' + diag + '】\n' + txt.slice(0, 2000), 'utf8')

  const guessName = names[0] ? names[0].replace(/\.[^.]+$/, '') : 'asset'

  /* ── ③ 落库到个人仓库（gen_ 前缀，占配额；失败不影响预览） ── */
  let repoName = ''
  let repoSaved = false
  try {
    const { saveToPersonalRepo } = await import('@/lib/personal-storage')
    const saved = await saveToPersonalRepo({
      userId: auth.userId,
      buffer: Buffer.from(html, 'utf8'),
      ext: 'html',
      mime: 'text/html',
      gen: true,                    // 系统生成物 ⇒ gen_日期_序号.html
    })
    repoName = saved.name
    repoSaved = true
    console.log('[LAB] 已落库: ' + repoName)
  } catch (e: any) {
    console.log('[LAB] 落库失败（不影响预览）: ' + String(e?.message || e).slice(0, 140))
  }

  return NextResponse.json({
    success: true,
    data: {
      name,
      url: '/api/lab/file?name=' + encodeURIComponent(name),
      diag,
      segs: segs.length,
      imgs: imgParts.length,
      bodyMB: Number(mb.toFixed(2)),
      htmlKB: Math.round(html.length / 1024),
      seconds: Math.round((Date.now() - t0) / 1000),
      shrinkFail,
      promptKB: Math.round(prompt.length / 1024),
      guessName,
      /* 落库结果：页面拿到后用 electronAPI 镜像到本地 */
      repoName,
      repoSaved,
      inlineCount: inlineN,
    },
  })
}
