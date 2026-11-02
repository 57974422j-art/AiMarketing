/**
 * ★LAB2 · 新实验线接口（2026-11-02）
 *
 * 和旧 lab 的关系：**完全独立**，不 import 任何 `lib/lab/*`。
 * 产物写 `temp/_lab2/out/`。
 *
 * 和旧 lab 的差别：
 *   ① 只用 lab2/prompt（导演宣言 + 硬底线 + 1 个分类维度）
 *   ② **读记忆**（memory.ts，按 userId）
 *   ③ 支持「重做 + 修改意见」：把上一次的 HTML + 意见一起喂回去
 *   ④ 返回值带 `trace`（从 HTML 里抠出来的 __trace）
 */
import { NextRequest, NextResponse } from 'next/server'
import fs from 'node:fs'
import path from 'node:path'
import { buildLab2Prompt, type Lab2Form } from '@/lib/lab2/prompt'
import { getMemories, addPending, confirmPending, rejectPending } from '@/lib/lab2/memory'

export const maxDuration = 900

/**
 * ★2026-11-02 用户要求："要放仓库 你不放仓库，我们俩什么都看不到，测试什么"
 *   ⇒ 产物直接写 **storage/<repoId>/**（和老线同一个仓库目录）
 *   ⇒ 文件名沿用仓库命名：gen_YYYYMMDD_NNN.html
 *   ⇒ 这样在仓库页能直接看到、能直接打开、能测
 */
function repoDir(repoId: string): string {
  const d = path.join(process.cwd(), 'storage', repoId)
  fs.mkdirSync(d, { recursive: true })
  return d
}

/** 当天序号：扫同目录已有 gen_YYYYMMDD_*.html，取最大 +1 */
function nextSeq(dir: string, ymd: string): string {
  let max = 0
  try {
    for (const f of fs.readdirSync(dir)) {
      const m = f.match(new RegExp('^gen_' + ymd + '_(\\d{3})\\.html$'))
      if (m) max = Math.max(max, parseInt(m[1], 10))
    }
  } catch { /* 空目录 */ }
  return String(max + 1).padStart(3, '0')
}

/** 读一张图 → base64（复用 oss） */
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

/**
 * ★2026-11-02 用户："用的素材和我给的毫无关系"
 *   根因：lab2 从没把图**内联**进 HTML ⇒ AI 只能自己编 URL / 用纯色块代替
 *   修法：prompt 要求写 {{IMG_1}} 占位符，后端替换成真实压缩图的 base64
 */
async function readImgForEmbed(key: string, errs?: string[]): Promise<string | null> {
  try {
    const { getObject } = await import('@/lib/oss')
    const buf = await getObject(key)
    if (!buf || !buf.length) {
      errs?.push(key + ' → 空 buffer')
      return null
    }
    try {
      const sharpMod = (await import('sharp')).default
      const out = await sharpMod(buf)
        .resize({ width: 1200, withoutEnlargement: true })
        .jpeg({ quality: 78, mozjpeg: true })
        .toBuffer()
      return 'data:image/jpeg;base64,' + out.toString('base64')
    } catch {
      /* sharp 不可用 ⇒ 原图直出（体积大但能显示） */
      return 'data:image/jpeg;base64,' + buf.toString('base64')
    }
  } catch (e) {
    errs?.push(key + ' → ' + String((e as Error)?.message || e).slice(0, 120))
    return null
  }
}

/**
 * ★★ 2026-11-02 用户："浏览器打开只能看到开始第一帧，这交付基础规则都没定吗"
 *   根因：AI 只写了 `window.__seek = function(){}` + `__seek(0)`，
 *         **没有任何东西在推它** ⇒ 永远停在 t=0
 *   兜底：没检测到 rAF 循环就自动注入
 */
function ensureAutoplay(html: string): string {
  const hasLoop = /requestAnimationFrame\s*\(\s*loop/.test(html)
    || (/function\s+loop\s*\(/.test(html) && /__seek\(\s*t\s*\)/.test(html))
  if (hasLoop) return html

  let total = 0
  html.replace(/data-start=["']?([\d.]+)["']?[^>]*data-duration=["']?([\d.]+)/g, (_m, a, b) => {
    const end = parseFloat(a) + parseFloat(b)
    if (end > total) total = end
    return _m
  })
  if (!total) total = 30

  const script = '<script id="lab2-autoplay-guard">(function(){'
    + 'if(!window.__seek)return;'
    + 'var TOTAL=' + total + ';'
    + 'var acc=0,last=performance.now();'
    /* ★暂停时绝对不推 —— 否则盖掉外部 __seek(t) */
    + 'function loop(now){'
    + 'var dt=(now-last)/1000;last=now;'
    + 'if(!window.__lab2Paused){acc+=dt;if(acc>TOTAL)acc=0;window.__seek(acc);}'
    + 'requestAnimationFrame(loop);'
    + '}'
    + 'window.__seek(0);requestAnimationFrame(loop);'
    + '})();</script>'

  if (html.includes('</body>')) return html.replace('</body>', script + '</body>')
  return html + script
}

/**
 * ★★ 2026-11-02 用户："所有层都加在一帧上"
 *   根因：AI 写的 __seek 只设 --p，而 CSS 的 opacity:clamp(...) **p=1 后前一段不会消失**
 *        ⇒ 前一段一直亮着，后一段背景不够实就透出来 = 全叠一帧
 *   兜底：注入覆盖版 __seek，强制按 [start, start+duration) 控制 visibility + 淡入淡出
 */
function ensureSeekGuard(html: string): string {
  if (html.includes('lab2-seek-guard')) return html

  /* ⛔⛔ 先删掉致命规则 .sec:first-child{opacity:1}
     —— 它让第 1 段永远不消失，后面所有段都堆在它上面（2026-11-02 用户实测） */
  html = html.replace(/\.sec\s*:\s*first-child\s*\{[^}]*opacity\s*:\s*1[^}]*\}/gi, '')
  /* 同时把 .sec 的默认 opacity 压成 0（避免初始全亮） */
  if (!/\.sec\s*\{[^}]*opacity\s*:\s*0/.test(html)) {
    html = html.replace(/(\.sec\s*\{)/, '$1\n  opacity:0;')
  }

  const script = '<script id="lab2-seek-guard">(function(){'
    + 'window.__lab2Paused=false;'      /* ★外部可暂停（播放器控制这个） */
    + 'function seek2(t){'
    + 'var secs=document.querySelectorAll(".sec");'
    + 'for(var i=0;i<secs.length;i++){'
    + 'var sec=secs[i];'
    + 'var s=Number(sec.dataset.start)||0;'
    + 'var d=Number(sec.dataset.duration)||3;'
    + 'var p=Math.min(1,Math.max(0,(t-s)/d));'
    + 'sec.style.setProperty("--p",String(p));'
    + 'var on=(t>=s)&&(t<s+d);'
    + 'sec.style.visibility=on?"visible":"hidden";'
    + 'var fin=Math.min(1,p/0.04);'      /* ★淡入 4%（原来 10% 太早变暗） */
    + 'var fout=Math.min(1,(1-p)/0.04);' /* ★淡出 4% */
    + 'sec.style.opacity=on?String(Math.min(fin,fout)):"0";'
    + '}'
    + '}'
    + 'window.__seek=seek2;'
    + '/* 自动播放：★暂停时完全不推进（治"暂停停不住"） */'
    + 'if(!window.__lab2autoplay){'
    + 'window.__lab2autoplay=1;'
    + 'var total=0;var secs=document.querySelectorAll(".sec");'
    + 'for(var j=0;j<secs.length;j++){'
    + 'var e=(Number(secs[j].dataset.start)||0)+(Number(secs[j].dataset.duration)||3);'
    + 'if(e>total)total=e;}'
    + 'if(!total)total=30;'
    + 'window.__lab2Total=total;'
    + 'var acc=0;'
    + 'var last=performance.now();'
    /* ★★ 2026-11-02 实测修的 bug：暂停时**绝对不能**再调 seek2
       否则每帧都会把外部 __seek(t) 设的值盖掉 ⇒ "拖时间轴立刻跳回去" */
    + 'function loop(now){'
    + 'var dt=(now-last)/1000;last=now;'
    + 'if(!window.__lab2Paused){'
    + '  acc+=dt;if(acc>total)acc=0;'
    + '  seek2(acc);'                     /* ← 只在播放时推 */
    + '}'
    + 'requestAnimationFrame(loop);'
    + '}'
    + 'seek2(0);requestAnimationFrame(loop);'
    + '}'
    + '})();</script>'

  if (html.includes('</body>')) return html.replace('</body>', script + '</body>')
  return html + script
}

/**
 * ★★ 2026-11-02 用户："竖屏只看到上半截，下面看不见"
 *   根因：舞台是 720×1280 固定尺寸，窗口小就超出视口
 *   兜底：没检测到 --fit 缩放就自动注入（让整个舞台装进窗口）
 */
function ensureFit(html: string, W: number, H: number): string {
  if (/--fit/.test(html) && /innerWidth/.test(html)) return html

  const css = '<style id="lab2-fit-guard">'
    + 'html,body{margin:0;padding:0;width:100%;height:100%;overflow:hidden !important;background:#000}'
    + '#stage{position:absolute !important;left:50% !important;top:50% !important;'
    + 'width:' + W + 'px !important;height:' + H + 'px !important;'
    + 'transform-origin:center center !important;'
    + 'transform:translate(-50%,-50%) scale(var(--fit,1)) !important}'
    + '</style>'

  const js = '<script id="lab2-fit-guard-js">(function(){'
    + 'function fit(){'
    + 'var s=Math.min(window.innerWidth/' + W + ',window.innerHeight/' + H + ');'
    + 'document.documentElement.style.setProperty("--fit",String(s));'
    + '}'
    + 'window.addEventListener("resize",fit);fit();'
    + '})();</script>'

  let out = html
  if (out.includes('</head>')) out = out.replace('</head>', css + '</head>')
  else out = css + out
  if (out.includes('</body>')) out = out.replace('</body>', js + '</body>')
  else out = out + js
  return out
}

/**
 * 把 {{IMG_N}} 替换成真实 base64
 * ★★ 2026-11-02 兜底：实测 AI **不写占位符**，只写 <img src=""> 或 url('')
 *    ⇒ 必须能"按出现顺序"填图，不能依赖它照做
 */
function embedPlaceholders(html: string, imgs: (string | null)[]): string {
  let out = html
  const valid = imgs.filter(Boolean) as string[]
  if (!valid.length) return out

  /* ── ① 先按占位符精确替换（AI 照做的情况） ── */
  let byPlaceholder = 0
  imgs.forEach((dataUrl, i) => {
    if (!dataUrl) return
    const re = new RegExp('\\{\\{\\s*IMG_' + (i + 1) + '\\s*\\}\\}', 'g')
    if (re.test(out)) byPlaceholder++
    out = out.replace(re, dataUrl)
  })
  out = out.replace(/\{\{\s*IMG_\d+\s*\}\}/g, '')

  /* ── ② 兜底：把空的 src="" / url('') 按出现顺序填满 ── */
  if (byPlaceholder === 0) {
    let k = 0
    /* <img src=""> / <img src=''> / <img > 无 src */
    out = out.replace(/<img\b([^>]*?)\ssrc=(?:"\s*"|'\s*')([^>]*)>/gi, (m, a, b) => {
      const d = valid[k % valid.length]; k++
      return '<img' + a + ' src="' + d + '"' + b + '>'
    })
    out = out.replace(/<img\b(?![^>]*\ssrc=)([^>]*)>/gi, (m, a) => {
      const d = valid[k % valid.length]; k++
      return '<img src="' + d + '"' + a + '>'
    })
    /* background-image: url('') / url() / url("") */
    out = out.replace(/url\(\s*(?:''|""|)\s*\)/gi, () => {
      const d = valid[k % valid.length]; k++
      return 'url("' + d + '")'
    })
    console.log('[lab2] 兜底填图：' + k + ' 处（AI 没写占位符）')
  }

  return out
}

/** 从 HTML 里抠出 __trace */
function extractTrace(html: string): unknown {
  const m = html.match(/<script[^>]*id="__trace"[^>]*>([\s\S]*?)<\/script>/)
  if (!m) return null
  try {
    return JSON.parse(m[1])
  } catch {
    return { raw: m[1].slice(0, 4000) }
  }
}

/** 从 HTML 里抠技术指标（不改生成，只做统计） */
function scanMetrics(html: string) {
  const lh: number[] = []
  const ls: number[] = []
  const dark: number[] = []
  html.replace(/line-height\s*:\s*(0?\.\d+)/g, (_, v) => { lh.push(parseFloat(v)); return _ })
  html.replace(/letter-spacing\s*:\s*(-[\d.]+)\s*(?:em|px)/g, (_, v) => { ls.push(parseFloat(v)); return _ })
  html.replace(/brightness\s*\(\s*(0?\.\d+)/g, (_, v) => { const f = parseFloat(v); if (f < 0.95) dark.push(f); return _ })
  return {
    sections: (html.match(/<section/g) || []).length,
    svg: (html.match(/<svg/g) || []).length,
    text: (html.match(/<text/g) || []).length,
    canvas: (html.match(/<canvas/g) || []).length,
    lineHeightMin: lh.length ? Math.min(...lh) : null,
    lineHeightBad: lh.filter((v) => v < 0.95).length,
    letterSpacingNeg: ls.length,
    letterSpacingMin: ls.length ? Math.min(...ls) : null,
    darkCount: dark.length,
    darkMin: dark.length ? Math.min(...dark) : null,
    hasSticker: /0\s+0\s+0\s+\d+px\s+#?F{3,6}/i.test(html),
    hasTrace: html.includes('__trace'),
    hasAutoplay: /requestAnimationFrame\s*\(\s*loop/.test(html),
    /* 内联图 = data:base64 或 signedUrl（两种都算） */
    hasImgs: (html.match(/data:image\//g) || []).length
      + (html.match(/<img[^>]+src="https?:\/\//gi) || []).length
      + (html.match(/url\("https?:\/\//gi) || []).length,
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const userId = String(body?.userId || 'default')
    const imgs: string[] = Array.isArray(body?.images) ? body.images : []

    /* ── 动作：confirm / reject（用于记忆验证） ── */
    if (body?.action === 'confirm') {
      const n = confirmPending(userId)
      return NextResponse.json({ ok: true, confirmed: n })
    }
    if (body?.action === 'reject') {
      const n = rejectPending(userId)
      return NextResponse.json({ ok: true, rejected: n })
    }

    /* ── 重做时：把上次意见记成 pending ── */
    const feedback = String(body?.feedback || '').trim()
    if (feedback) addPending(userId, feedback)

    /* ── 读图片 ──
       ★2026-11-02 用户："让它看不到素材"
         根因：前端传的是**文件名**，但 getObject 要的是 **storage/<uid>/<文件名>**
         （老 lab 是 readImgB64('storage/' + auth.userId + '/' + nm)）
         我只传了文件名 ⇒ 全部读不到 ⇒ imgParts 空 ⇒ AI 根本没见过图 */
    const ossKey = (nm: string) => (/^storage\//.test(nm) ? nm : 'storage/' + userId + '/' + nm)
    const imgParts: { type: 'image_url'; image_url: { url: string } }[] = []
    let imgOk = 0
    for (const k of imgs.slice(0, 12)) {
      const b64 = await readImgB64(ossKey(k))
      if (b64) {
        imgOk++
        imgParts.push({ type: 'image_url', image_url: { url: 'data:image/jpeg;base64,' + b64 } })
      }
    }

    /* ── 组装 prompt ── */
    const form: Lab2Form = {
      imgCount: imgs.length,
      maxSeconds: Number(body?.maxSeconds || 45),
      aspect: String(body?.aspect || '9:16'),
      contentType: String(body?.contentType || ''),
      copyMode: String(body?.copyMode || 'sell'),
      decoDensity: String(body?.decoDensity || 'mid'),
      motion: String(body?.motion || 'on'),
      memories: getMemories(userId),
      userRules: String(body?.userRules || ''),
      selfReview: body?.selfReview !== false,
    }
    const prompt = buildLab2Prompt(form)

    /* ── 重做：带上一次的 HTML + 意见 ── */
    const prevHtml = String(body?.prevHtml || '').slice(0, 120000)
    const retryNote = prevHtml && feedback
      ? `\n\n【这是重做：上一版的问题】\n${feedback}\n\n【上一版 HTML（参考，不要照抄，要改掉上面的问题）】\n${prevHtml}`
      : ''

    /* ── 调 deepseek ── */
    const key = String(process.env.DEEPSEEK_API_KEY || '').trim()
    if (!key) return NextResponse.json({ ok: false, error: '缺少 DEEPSEEK_API_KEY' }, { status: 500 })

    const messages: Record<string, unknown>[] = [
      {
        role: 'user',
        content: [
          { type: 'text', text: prompt + retryNote },
          ...imgParts,
        ],
      },
    ]

    const t0 = Date.now()
    const r = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages,
        temperature: 0.7,
        max_tokens: 64000,
      }),
    })
    if (!r.ok) {
      const err = await r.text().catch(() => '')
      return NextResponse.json({ ok: false, error: 'AI 调用失败 ' + r.status + ' ' + err.slice(0, 300) }, { status: 500 })
    }
    const j = await r.json()
    let html: string = String(j?.choices?.[0]?.message?.content || '')
    if (!html.includes('<html')) {
      const m = html.match(/```html\s*([\s\S]*?)```/)
      if (m) html = m[1]
    }
    if (!html.includes('<!DOCTYPE') && !html.includes('<!doctype')) {
      html = '<!DOCTYPE html>\n' + html
    }

    /* ── 存文件：直接写进个人仓库 storage/<repoId>/ ── */
    const repoId = String(body?.repoId || '1')

    /* ★把 {{IMG_N}} 替换成真实图片
       ★★ 2026-11-02 双路：
       ① 优先用前端传来的 signedUrl（最稳，不需要读 OSS）
       ② signedUrl 缺失时才回落到 OSS 读图 + sharp 压缩 */
    const imgErrs: string[] = []
    const imageUrls: string[] = Array.isArray(body?.imageUrls) ? body.imageUrls : []
    const imageData: string[] = Array.isArray(body?.imageData) ? body.imageData : []
    const embedImgs: (string | null)[] = []
    for (let i = 0; i < Math.min(imgs.length, 12); i++) {
      /* ① 最高优先：前端压缩好的 base64（自包含，一定能显示） */
      const b64 = String(imageData[i] || '')
      if (/^data:image\//.test(b64)) {
        embedImgs.push(b64)
        continue
      }
      /* ② 次选：signedUrl */
      const u = String(imageUrls[i] || '')
      if (/^https?:\/\//.test(u)) {
        embedImgs.push(u)
        continue
      }
      /* ③ 兜底：后端读 OSS */
      embedImgs.push(await readImgForEmbed(ossKey(imgs[i]), imgErrs))
    }
    html = embedPlaceholders(html, embedImgs)

    /* ★兜底：覆盖 __seek（强制按段显示，治"所有层叠一帧"）—— 必须早于 autoplay */
    html = ensureSeekGuard(html)

    /* ★兜底：没有自动播放就注入（用户："打开只有第一帧"） */
    html = ensureAutoplay(html)

    /* ★兜底：舞台自适应视口（用户："竖屏只看到上半截"） */
    const isLand = String(form.aspect || '') === '16:9'
    html = ensureFit(html, isLand ? 1280 : 720, isLand ? 720 : 1280)

    const ymd = new Date().toISOString().slice(0, 10).replace(/-/g, '')
    let name = ''
    let savedTo = ''
    try {
      const dir = repoDir(repoId)
      const seq = nextSeq(dir, ymd)
      name = 'gen_' + ymd + '_' + seq + '.html'
      fs.writeFileSync(path.join(dir, name), html, 'utf8')
      savedTo = 'storage/' + repoId + '/' + name
    } catch (e) {
      /* 写仓库失败 ⇒ 回落临时目录（至少能看能下载） */
      const fb = path.join(process.cwd(), 'temp', '_lab2', 'out')
      fs.mkdirSync(fb, { recursive: true })
      name = 'lab2_' + Date.now() + '.html'
      fs.writeFileSync(path.join(fb, name), html, 'utf8')
      savedTo = 'temp/_lab2/out/' + name + '（仓库写入失败：' + String((e as Error)?.message || e) + '）'
    }

    /* 总时长 + 段表（给前端播放器 / 段导航用） */
    let totalSeconds = Number(form.maxSeconds || 45)
    const segments: { start: number; duration: number }[] = []
    try {
      let maxEnd = 0
      html.replace(/data-start=["']?([\d.]+)["']?[^>]*data-duration=["']?([\d.]+)/g, (_, a, b) => {
        const st = parseFloat(a)
        const du = parseFloat(b)
        segments.push({ start: st, duration: du })
        const end = st + du
        if (end > maxEnd) maxEnd = end
        return _
      })
      if (maxEnd > 0) totalSeconds = Math.ceil(maxEnd * 10) / 10
    } catch { /* 保底 */ }

    return NextResponse.json({
      ok: true,
      url: '/api/lab2/file?name=' + encodeURIComponent(name) + '&repoId=' + encodeURIComponent(repoId),
      repoId,
      name,
      savedTo,
      imgSent: imgOk,          /* AI 实际看到的图张数 */
      imgEmbedded: embedImgs.filter(Boolean).length,  /* 实际内联进 HTML 的张数 */
      imgErrs: imgErrs.slice(0, 4),   /* 读图失败原因（定位用） */
      ossKeys: imgs.slice(0, 3).map(ossKey),   /* 实际用的 OSS 路径（定位用） */
      elapsed: Math.round((Date.now() - t0) / 1000),
      totalSeconds,
      segments,
      trace: extractTrace(html),
      metrics: scanMetrics(html),
      prompt,             /* 把完整 prompt 返回，供「完成复制」用 */
      memoriesUsed: form.memories || [],
      /* 供前端「重做」用 */
      html,
    })
  } catch (e) {
    return NextResponse.json({ ok: false, error: String((e as Error)?.message || e) }, { status: 500 })
  }
}
