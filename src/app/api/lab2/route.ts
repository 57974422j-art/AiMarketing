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
import { getAuthFromHeaders, getAuthFromCookie } from '@/lib/api-auth'
import { shotFrames } from '@/lib/lab2/shot'
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

/**
 * ★★★ 2026-11-03 用户："生成一个就把上次做的抵掉了，不要一直是一"
 *
 * 上一版 bug：只扫**本地目录**算序号，但历史文件都在 OSS（本地是空的）
 *   ⇒ max 永远 0 ⇒ 永远返回 001 ⇒ **每次覆盖上一单**
 *
 * 现在：文件名用 **gen_YYYYMMDD_HHMMSS**（秒级时间戳）
 *   · 天然唯一，不覆盖
 *   · 同秒内再撞就在后面加 _1 / _2
 *   · 仓库页按 mtime 排序，不受命名影响
 */
function uniqueName(dir: string, ymd: string): string {
  const d = new Date()
  const hms = String(d.getHours()).padStart(2, '0')
    + String(d.getMinutes()).padStart(2, '0')
    + String(d.getSeconds()).padStart(2, '0')

  let name = 'gen_' + ymd + '_' + hms + '.html'
  let n = 1
  /* 同秒撞车（本地或 OSS 同名）⇒ 加后缀 */
  while (fs.existsSync(path.join(dir, name)) && n < 100) {
    name = 'gen_' + ymd + '_' + hms + '_' + n + '.html'
    n++
  }
  return name
}

/**
 * ★★★ 2026-11-04 用户：「你能拼成一张图它也会。让它拼成一张图快。」
 *
 * 为什么需要这个：
 *   逐张看 10 张图 ⇒ 得到 10 条独立记忆（"IMG_8 是猫"）
 *   看一张总览图  ⇒ 一次建立**空间地图**（"IMG_8 的猫头在左下，右边空"）
 *        ↓
 *   ⇒ 排版的偏差（切头/出框）来自"没同时看到全部素材的相对位置"
 *
 * 做法：把本次选中的 N 张拼成网格，左上角标序号 1..N
 *      序号 = {{IMG_1}}..{{IMG_N}} 的编号
 *      （把总览图放在 messages 的第一张，后面跟原图）
 */
async function makeContactSheet(b64s: string[]): Promise<string | null> {
  try {
    const valid = b64s.filter(Boolean)
    if (valid.length < 2) return null          /* 只有 1 张没必要拼 */

    /**
     * ★2026-11-04 用户要传几十张做长视频 ⇒ 拼图必须自适应，
     *   否则 40 张按 4 列 400px 拼出来 2260×5600（太大，模型也看不清）
     */
    const n = valid.length
    const cols = n <= 8 ? 4 : n <= 15 ? 5 : n <= 24 ? 6 : 7
    const cell = n <= 8 ? 400 : n <= 15 ? 340 : n <= 24 ? 290 : 250

    const sharpMod = (await import('sharp')).default
    const tiles: { buf: Buffer; w: number; h: number }[] = []

    for (const b of valid) {
      /* 每格统一 cell×cell（contain 居中，不裁切 —— 图完整，方便判断留白在哪） */
      const out = await sharpMod(Buffer.from(b, 'base64'))
        .resize({
          width: cell,
          height: cell,
          fit: 'contain',
          background: { r: 26, g: 28, b: 32 },
          withoutEnlargement: true,
        })
        .jpeg({ quality: 78 })
        .toBuffer()
      const m = await sharpMod(out).metadata()
      tiles.push({ buf: out, w: m.width || cell, h: m.height || cell })
    }

    const cellW = Math.max(...tiles.map((t) => t.w))
    const cellH = Math.max(...tiles.map((t) => t.h))
    const gap = 10
    const rows = Math.ceil(tiles.length / cols)
    const W = cols * (cellW + gap) + gap
    const H = rows * (cellH + gap) + gap

    const comps: { input: Buffer; left: number; top: number }[] = []
    tiles.forEach((t, i) => {
      const cx = (i % cols) * (cellW + gap) + gap
      const cy = Math.floor(i / cols) * (cellH + gap) + gap
      comps.push({ input: t.buf, left: cx, top: cy })
      /* 序号角标（序号 = IMG 编号） */
      const svg = '<svg width="46" height="46" xmlns="http://www.w3.org/2000/svg">'
        + '<rect width="46" height="46" rx="9" fill="#000" fill-opacity="0.78"/>'
        + '<text x="23" y="33" text-anchor="middle" font-family="sans-serif" '
        + 'font-size="27" font-weight="bold" fill="#FFD24A">' + (i + 1) + '</text></svg>'
      comps.push({ input: Buffer.from(svg), left: cx + 6, top: cy + 6 })
    })

    const outBuf = await sharpMod({
      create: { width: W, height: H, channels: 3, background: { r: 16, g: 18, b: 22 } },
    })
      .composite(comps)
      .jpeg({ quality: 80 })
      .toBuffer()

    console.log('[lab2] 素材总览图：' + tiles.length + ' 张 · ' + W + '×' + H + ' · ' + Math.round(outBuf.length / 1024) + 'KB')
    return 'data:image/jpeg;base64,' + outBuf.toString('base64')
  } catch (e) {
    console.log('[lab2] 拼总览图失败（不影响主流程）：' + String((e as Error)?.message || e).slice(0, 100))
    return null
  }
}

/**
 * 读一张图 → base64（**原图，不压缩**）
 *
 * ★★★ 2026-11-03 用户定案：
 *   「给 AI 的图根本不需要压缩。AI 那边没有大小限制，是我们自己想多了。
 *     压缩要提前到**上传仓库**那一步（见 lib/personal-storage.ts），
 *     用图时就不用反复压了。」
 *
 * ⇒ 这里恢复"原图直出"。图的大小由**上传时**控制（长边 1800 / q82 ≈ 450KB）。
 */
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
    + 'window.__lab2Paused=false;'
    /* ★★★ 2026-11-02 关键修正（用户："没有动效，都是固定图片"）
       上一版我**整个替换**了 window.__seek ⇒ 把 AI 写的"逐元素入场动画"
       （el.style.transform / el.style.opacity 错帧）全杀掉了
       ⇒ 所有文字元素停在 opacity:0 ⇒ 看不见
       现在：**保留 AI 原版**，只补它缺的「段级可见性」 */
    + 'var origSeek=window.__seek;'
    + 'function guard(t){'
    + 'var secs=document.querySelectorAll(".sec");'
    /* ① 先跑原版（元素级动画） */
    + 'if(typeof origSeek==="function"){try{origSeek(t);}catch(e){}}'
    /* ② 再补段级可见性（原版可能没做，或做得不全） */
    + 'for(var i=0;i<secs.length;i++){'
    + 'var sec=secs[i];'
    + 'var s=Number(sec.dataset.start)||0;'
    + 'var d=Number(sec.dataset.duration)||3;'
    + 'var p=Math.min(1,Math.max(0,(t-s)/d));'
    + 'if(!sec.style.getPropertyValue("--p"))sec.style.setProperty("--p",String(p));'
    + 'var on=(t>=s)&&(t<s+d);'
    + 'if(!on){sec.style.visibility="hidden";sec.style.opacity="0";}'
    + 'else{'
    + '  sec.style.visibility="visible";'
    /* 只在原版没设 opacity 时才补（避免盖掉原版的淡入淡出） */
    + '  if(!sec.dataset.seekSetOp){'
    + '    var fin=Math.min(1,p/0.04),fout=Math.min(1,(1-p)/0.04);'
    + '    sec.style.opacity=String(Math.min(fin,fout));'
    + '  }'
    + '}'
    + '}'
    + '}'
    + 'window.__seek=guard;'
    + 'if(!window.__lab2autoplay){'
    + 'window.__lab2autoplay=1;'
    + 'var total=0;var secs=document.querySelectorAll(".sec");'
    + 'for(var j=0;j<secs.length;j++){'
    + 'var e=(Number(secs[j].dataset.start)||0)+(Number(secs[j].dataset.duration)||3);'
    + 'if(e>total)total=e;}'
    + 'if(!total)total=30;'
    + 'window.__lab2Total=total;'
    + 'var acc=0,last=performance.now();'
    + 'function loop(now){'
    + 'var dt=(now-last)/1000;last=now;'
    + 'if(!window.__lab2Paused){acc+=dt;if(acc>total)acc=0;guard(acc);}'
    /* ★2026-11-03 暴露真实时间给外层播放器（否则外部只能自己猜，会差 3 倍） */
    + 'window.__lab2Time=acc;'
    + 'requestAnimationFrame(loop);'
    + '}'
    + 'guard(0);requestAnimationFrame(loop);'
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
async function fetchAsBase64(url: string, errs?: string[]): Promise<string | null> {
  try {
    const r = await fetch(url, { cache: 'no-store' })
    if (!r.ok) { errs?.push('fetch ' + r.status); return null }
    const buf = Buffer.from(await r.arrayBuffer())
    if (!buf.length) { errs?.push('空图'); return null }
    try {
      const sharpMod = (await import('sharp')).default
      const out = await sharpMod(buf)
        .resize({ width: 1200, withoutEnlargement: true })
        .jpeg({ quality: 78, mozjpeg: true })
        .toBuffer()
      return 'data:image/jpeg;base64,' + out.toString('base64')
    } catch {
      return 'data:image/jpeg;base64,' + buf.toString('base64')
    }
  } catch (e) {
    errs?.push('fetch异常 ' + String((e as Error)?.message || e).slice(0, 60))
    return null
  }
}

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
  /* ★2026-11-04：原来这里直接替换成 '' ⇒ 超出范围的占位符变空 ⇒ `url('')` ⇒ 黑屏段
     （实测：13 张素材时它写 {{IMG_13}}，系统只有 12 张 ⇒ 末段全黑）
     现在：超范围就**用第一张图顶上**，宁可重复也不要空 */
  out = out.replace(/\{\{\s*IMG_(\d+)\s*\}\}/g, (_m, d) => {
    const i = Number(d) - 1
    return imgs[i] || valid[0] || ''
  })

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
    /* ★CSS 里真的有 var(--p) 吗（0 = 动效全靠 JS ⇒ 一崩就静止） */
    cssVarP: (html.match(/var\(--p\)/g) || []).length,
    /* 工具使用 */
    svgCount: (html.match(/<svg/g) || []).length,
    svgText: (html.match(/<text/g) || []).length,
    paintOrder: (html.match(/paint-order/g) || []).length,
    canvasCount: (html.match(/<canvas/g) || []).length,
    /* 内联图 = data:base64 或 signedUrl（两种都算） */
    hasImgs: (html.match(/data:image\//g) || []).length
      + (html.match(/<img[^>]+src="https?:\/\//gi) || []).length
      + (html.match(/url\("https?:\/\//gi) || []).length,
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()

    /* ★★★ 2026-11-02 修：userId 之前取 body?.userId || 'default'
       ⇒ 变成 storage/default/xxx.jpg ⇒ OSS 读不到 ⇒ **AI 一张图都没看到**（盲写）
       现在：优先从鉴权拿（header 或 cookie），保证是真实用户目录 */
    const authUser = getAuthFromHeaders(req) || getAuthFromCookie(req)
    const userId = String(authUser?.userId || body?.userId || '1')
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
    const imageUrlsEarly: string[] = Array.isArray(body?.imageUrls) ? body.imageUrls : []
    const imgParts: { type: 'image_url'; image_url: { url: string } }[] = []
    let imgOk = 0
    let imgBytes = 0
    /* ★2026-11-03 用户定案：**不再设总数上限**（"AI 那边根本没限制，都是我自己猜的"）
       图的大小由上传时控制（长边 1800 / q82 ≈ 450KB），这里只统计不拦截。 */

    const b64List: string[] = []      /* 按 IMG_1..IMG_N 顺序收集，用于拼总览图 */
    /* ★2026-11-04 用户："去掉你的硬上限，我没有张数限制，还准备传几十张做长视频"
       ⇒ 原来是 Math.min(imgs.length, 12)，而 prompt 却告诉它 imgs.length 张
         ⇒ 第 13 张开始它写了占位符但没图 ⇒ 替换成空 ⇒ **末段黑屏**（实测过）
       ⇒ 现在跟 imgs.length 一致，不设上限 */
    for (let i = 0; i < imgs.length; i++) {
      const k = imgs[i]
      /* ① 先试 OSS（原图，不压缩 —— 图早就在上传时压过了） */
      let b64 = await readImgB64(ossKey(k))
      /* ② OSS 读不到 ⇒ 回头 fetch signedUrl */
      if (!b64) {
        const u = String(imageUrlsEarly[i] || '')
        if (/^https?:\/\//.test(u)) {
          const d = await fetchAsBase64(u)
          if (d) b64 = d.replace(/^data:image\/[^;]+;base64,/, '')
        }
      }
      if (b64) {
        imgOk++
        imgBytes += b64.length
        b64List.push(b64)
        imgParts.push({ type: 'image_url', image_url: { url: 'data:image/jpeg;base64,' + b64 } })
      }
    }

    /* ★★★ 2026-11-04：拼一张「素材总览」（序号 1..N = IMG_1..IMG_N）
       插在**第一张** —— 让它一次看到全部素材的相对位置（脸在哪、哪空），
       再逐张看细节。比只看 10 张独立的图更容易保持"空间地图"。 */
    const sheet = await makeContactSheet(b64List)
    if (sheet) {
      imgParts.unshift({ type: 'image_url', image_url: { url: sheet } })
    }
    console.log('[lab2] 发给 AI：' + imgOk + ' 张素材' + (sheet ? ' + 1 张总览' : '')
      + '，合计 ' + (imgBytes / 1024 / 1024).toFixed(2) + ' MB（base64）')

    /* ── 组装 prompt ── */
    const form: Lab2Form = {
      imgCount: imgs.length,
      maxSeconds: Number(body?.maxSeconds || 45),
      aspect: String(body?.aspect || '9:16'),
      contentType: String(body?.contentType || ''),
      copyMode: String(body?.copyMode || 'sell'),
      decoDensity: String(body?.decoDensity || 'mid'),
      motion: String(body?.motion || 'on'),
      /* ★大图比（0~100）：让它按比例用满幅大图 */
      bigImg: Number(body?.bigImg ?? 100),
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

    /* ★反馈截图（用户上传的"哪里不对"的图）⇒ 一起发给模型看 */
    const fbImgs: string[] = Array.isArray(body?.feedbackImages) ? body.feedbackImages : []
    const fbParts = fbImgs
      .slice(0, 4)
      .filter((d) => /^data:image\//.test(String(d)))
      .map((d) => ({ type: 'image_url' as const, image_url: { url: String(d) } }))

    /* ★总览图说明（第一张） */
    const sheetNote = sheet
      ? '\n\n【图片说明】\n'
        + '  · **第 1 张 = 素材总览**：网格里每个格子左上角的**黄色数字**，'
        + '就是它的编号（1 = {{IMG_1}}，2 = {{IMG_2}}…）\n'
        + '  · 之后依次是各张原图（顺序与编号一致）\n'
        + '  · 总览图用来**看清每张的构图关系**（主体在哪、哪边是空的、哪些能配对）；'
        + '原图用来看细节'
      : ''

    const textBlock = (fbParts.length
      ? prompt + retryNote + '\n\n【用户上传的截图：这就是他说的"哪里不对"，请仔细看图，不要只看文字描述】'
      : prompt + retryNote) + sheetNote

    const messages: Record<string, unknown>[] = [
      {
        role: 'user',
        content: [
          { type: 'text', text: textBlock },
          ...imgParts,
          ...fbParts,
        ],
      },
    ]

    const t0 = Date.now()

    /* ── 统一的 LLM 调用（第 1 轮生成 / 第 2 轮自审都用它） ── */
    async function callLLM(msgs: Record<string, unknown>[], temp = 0.7): Promise<string> {
      const r = await fetch('https://api.deepseek.com/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
        body: JSON.stringify({
          model: 'deepseek-chat',
          messages: msgs,
          temperature: temp,
          max_tokens: 64000,
        }),
      })
      if (!r.ok) {
        const err = await r.text().catch(() => '')
        throw new Error('AI 调用失败 ' + r.status + ' ' + err.slice(0, 300))
      }
      const j = await r.json()
      let h = String(j?.choices?.[0]?.message?.content || '')
      if (!h.includes('<html')) {
        const m = h.match(/```html\s*([\s\S]*?)```/)
        if (m) h = m[1]
      }
      if (!h.includes('<!DOCTYPE') && !h.includes('<!doctype')) h = '<!DOCTYPE html>\n' + h
      return h
    }

    let html = ''
    try {
      html = await callLLM(messages)
    } catch (e) {
      /* ★2026-11-03：`fetch failed` 本身不带原因，必须打 e.cause
         （可能是 ECONNRESET / ETIMEDOUT / socket hang up / UND_ERR_CONNECT_TIMEOUT） */
      const msg = String((e as Error)?.message || e)
      const cause = String((e as { cause?: unknown })?.cause || '')
      const detail = cause ? msg + ' | cause: ' + cause : msg
      console.error('[lab2] callLLM 失败：' + detail)
      return NextResponse.json({ ok: false, error: detail }, { status: 500 })
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
    /* ★同上：内联也不设张数上限（否则第 13 张起变空 ⇒ 黑屏段） */
    for (let i = 0; i < imgs.length; i++) {
      /* ① 最高优先：前端压缩好的 base64（自包含，一定能显示） */
      const b64 = String(imageData[i] || '')
      if (/^data:image\//.test(b64)) {
        embedImgs.push(b64)
        continue
      }
      /* ② 次选：signedUrl ⇒ 后端 fetch 下来转 base64
         ★2026-11-02：直接塞 signedUrl 的话，1 小时后签名过期 ⇒ 下载的 HTML 图全裂
         ★★★ 2026-11-05 用户实测（gen_20261105_082951，横屏 17 张）：
             前端 imageData 空了 ⇒ 走这里 ⇒ fetch 403（签名已过期 11 小时）
             ⇒ 旧代码 `embedImgs.push(b || u)` **退回了原 URL**
             ⇒ HTML 里 13 个会过期的外链 ⇒ 打开全黑，AI 自审还说"没问题"
             ⇒ 现在：fetch 失败**绝不退回 URL**，继续往下走 ③ 读 OSS */
      const u = String(imageUrls[i] || '')
      if (/^https?:\/\//.test(u)) {
        const b = await fetchAsBase64(u, imgErrs)
        if (b) { embedImgs.push(b); continue }
      }
      /* ③ 服务端直读 OSS（有权限，不依赖签名） */
      const fromOss = await readImgForEmbed(ossKey(imgs[i]), imgErrs)
      if (fromOss) { embedImgs.push(fromOss); continue }
      /* ④ 实在读不到 ⇒ 先记 null，下面统一用「第一张成功的图」顶上
            （宁可重复一张，也不要留空/留外链 ⇒ 否则就是黑屏段） */
      embedImgs.push(null)
    }

    /* ★把读不到的图，用第一张成功的顶掉（保证每个占位符都有真图） */
    const firstOk = embedImgs.find((x) => x && /^data:image\//.test(x)) || null
    if (firstOk) {
      for (let i = 0; i < embedImgs.length; i++) {
        if (!embedImgs[i]) embedImgs[i] = firstOk
      }
    }
    /**
     * ★★★ 2026-11-05 用户："关于它看的是哪张，能在回执中看到最好"
     *
     * 必须在 **embedPlaceholders 之前**统计 —— 替换后全是 base64，认不出是第几张。
     * 目的：让「13 张素材只用了 7 张」这种问题**看得见**（现在它自己都不知道漏了 6 张）
     */
    const imgUsage: {
      total: number
      used: number[]
      missing: number[]
      perSec: number[][]
      unknown: boolean
    } = (() => {
      const secHtml = [...html.matchAll(/<section[^>]*class="sec[^"]*"[^>]*>[\s\S]*?<\/section>/g)]
        .map((m) => m[0])
      const perSec: number[][] = []
      const usedSet = new Set<number>()
      secHtml.forEach((s) => {
        const ids = [...s.matchAll(/\{\{\s*IMG_(\d+)\s*\}\}/g)].map((m) => Number(m[1]))
        perSec.push(ids)
        ids.forEach((i) => usedSet.add(i))
      })
      const used = [...usedSet].sort((a, b) => a - b)
      const missing: number[] = []
      for (let i = 1; i <= imgs.length; i++) if (!usedSet.has(i)) missing.push(i)
      return {
        total: imgs.length,
        used,
        missing,
        perSec,
        /* 一个占位符都没写 ⇒ 统计不可信（它可能用了空 src / background） */
        unknown: used.length === 0,
      }
    })()

    /**
     * ★★★ 2026-11-05 「设定 vs 实际」数字对照
     *
     * 用户实测：大图比设 60% → 实际 9/11 = 82%
     *   它的 __trace 写的是"避免视觉疲劳，增加版式变化"（用自己的尺子）
     *   ⇒ 软指标被审美覆盖
     *
     * 现在：代码数出"实际满幅段数"，和设定值一起给它（和用户）看。
     *   判据（保守）：段内含 `inset:0` ⇒ 认为这一段是满幅底图
     */
    const setCheck: {
      bigImgSet: number
      fullSecs: number
      totalSecs: number
      actualPct: number
    } = (() => {
      const secHtml = [...html.matchAll(/<section[^>]*class="sec[^"]*"[^>]*>[\s\S]*?<\/section>/g)]
        .map((m) => m[0])
      const fullSecs = secHtml.filter((s) => /inset:\s*0|inset:0/.test(s)).length
      const totalSecs = secHtml.length
      return {
        bigImgSet: Number(form.bigImg ?? 100),
        fullSecs,
        totalSecs,
        actualPct: totalSecs ? Math.round((fullSecs / totalSecs) * 100) : 0,
      }
    })()

    html = embedPlaceholders(html, embedImgs)

    /* ★兜底：覆盖 __seek（强制按段显示，治"所有层叠一帧"）—— 必须早于 autoplay */
    html = ensureSeekGuard(html)

    /* ★兜底：没有自动播放就注入（用户："打开只有第一帧"） */
    html = ensureAutoplay(html)

    /* ★兜底：舞台自适应视口（用户："竖屏只看到上半截"） */
    const isLand = String(form.aspect || '') === '16:9'
    const CW = isLand ? 1280 : 720
    const CH = isLand ? 720 : 1280
    html = ensureFit(html, CW, CH)

    /* ══════════════════════════════════════════════════════════════════════
       ★★ 2026-11-03 用户："先加一段让它自己审一下……让它自己说出每轮改了几次为什么改"
       第一次生成 ⇒ 无头 Chromium 截图 4 帧 ⇒ 把截图发回给它 ⇒ 它自审 + 改
       ⇒ **给它眼睛，不是给它规则**
       ══════════════════════════════════════════════════════════════════════ */
    let review: { rounds: number; issues: string[]; changes: string[]; shotOk: boolean; shotErr?: string } | null = null

    /* ★自审开关（2026-11-03）：关掉就跳过整段（省 4~5 分钱） */
    console.log('[lab2] 自审判断：form.selfReview=' + form.selfReview + '（body.selfReview=' + body?.selfReview + '）')
    if (!form.selfReview) {
      console.log('[lab2] 自审：已关闭，跳过')
      review = { rounds: 0, issues: [], changes: [], shotOk: false, shotErr: '已关闭（开关=关）' }
    } else
    try {
      console.log('[lab2] 自审：开始截图')
      /* ★★★ 2026-11-03 修：原来是 `await import('@/lib/lab2/shot')`（动态）
         Next.js **standalone 打包不会包含动态 import 的模块**
         ⇒ 运行时抛错 → 被 try/catch 吞掉 → 截图从未执行（temp/_lab2/shot 目录都不存在）
         ⇒ 改成**顶部静态 import**（见文件头） */
      let total0 = Number(form.maxSeconds || 45)
      try {
        let mx = 0
        html.replace(/data-start=["']?([\d.]+)["']?[^>]*data-duration=["']?([\d.]+)/g, (_m, a, b) => {
          const e = parseFloat(a) + parseFloat(b)
          if (e > mx) mx = e
          return _m
        })
        if (mx > 0) total0 = Math.ceil(mx * 10) / 10
      } catch { /* ignore */ }

      const shot = await shotFrames(html, CW, CH, total0)

      if (shot.ok && shot.images.length) {
        /* 把截图 + 自审要求发给模型 */
        const reviewPrompt = [
          '【自审 · 这是你自己刚做出来的成片截图】',
          '',
          `下面是同一条片子 **${shot.images.length} 帧**截图，对应 t = ${shot.times.map((x) => x + 's').join(' / ')}。`,
          '**每一帧取的都是那一段的中点**（淡入淡出已结束）⇒ 这就是观众看到的样子。',
          '⚠️ 请**逐帧**看，不要只看第一帧。片长多少段，就给你截了多少帧（超长片每段抽一帧）。',
          '',
          '逐项检查（有问题就改，没问题就说明"已检查，合格"）：',
          '  ① **文字**：有没有糊成一团 / 笔画粘连 / 挤出屏幕 / 压在图片主体上导致看不清',
          '  ② **留白**：有没有单侧空白超过画布 30%（看着"空"不是"留白"）',
          '  ③ **构图**：每段的视觉重心在哪？是不是都挤在同一个角落？',
          '  ④ **图片**：有没有被压暗/变灰/被半透明层盖住？',
          '  ⑤ **段落**：相邻帧画面是不是明显不同（如果一样 ⇒ 段落没切换）',
          '  ⑥ **空帧**：有没有哪一帧几乎全黑/全空（图片没加载、或者只剩一条线）',
          '     ⇒ 这种必须查：那张图的占位符是不是没填上、或者整段没有任何内容',
          '  ⑦ **末帧**：最后一帧有没有内容（落版 / 品牌 / 一句话），不能是黑的',
          '',
          '⚠️ 只在**确实有问题**时才改。没问题就别动（改了反而可能更糟）。',
          '',
          '输出格式（严格）：',
          '  先输出一段 ```json``` 自审日志：',
          '  {',
          '    "检查": { "文字": "...", "留白": "...", "构图": "...", "图片": "...", "段落": "..." },',
          '    "发现的问题": ["问题1", "问题2"],',
          '    "改了什么": ["改动1（为什么）", "改动2（为什么）"],',
          '    "改了几轮": N,',
          '    "没改的地方": "为什么不动"',
          '  }',
          '  然后输出**完整的新 HTML**（`<!DOCTYPE html>` 到 `</html>`）。',
          '  ⚠️ 如果判断没问题、不需要改 ⇒ JSON 里写 `"改了什么": []`，HTML 原样输出。',
        ].join('\n')

        const round2 = await callLLM([
          {
            role: 'user',
            content: [
              { type: 'text', text: reviewPrompt },
              ...shot.images.map((d) => ({ type: 'image_url', image_url: { url: d } })),
            ],
          },
        ], 0.4)

        /* 解析自审日志 */
        let issues: string[] = []
        let changes: string[] = []
        let rounds = 0
        const jm = round2.match(/```json\s*([\s\S]*?)```/)
        if (jm) {
          try {
            const o = JSON.parse(jm[1]) as Record<string, unknown>
            issues = Array.isArray(o['发现的问题']) ? (o['发现的问题'] as string[]) : []
            changes = Array.isArray(o['改了什么']) ? (o['改了什么'] as string[]) : []
            rounds = Number(o['改了几轮'] || 0)
          } catch { /* 解析失败就当没改 */ }
        }

        /* 如果它给了新 HTML（且含 html 标签），采用；否则保留原版 */
        const newHtmlMatch = round2.match(/<!DOCTYPE html>[\s\S]*<\/html>/i)
        if (newHtmlMatch && newHtmlMatch[0].length > html.length * 0.5) {
          html = newHtmlMatch[0]
          /* 新版还要再兜底一次（它可能又写坏了） */
          html = embedPlaceholders(html, embedImgs)
          html = ensureSeekGuard(html)
          html = ensureAutoplay(html)
          html = ensureFit(html, CW, CH)
        }

        review = { rounds, issues, changes, shotOk: true }
      } else {
        review = { rounds: 0, issues: [], changes: [], shotOk: false, shotErr: shot.error || '截图失败' }
      }
    } catch (e) {
      review = { rounds: 0, issues: [], changes: [], shotOk: false, shotErr: String((e as Error)?.message || e).slice(0, 120) }
    }

    const ymd = new Date().toISOString().slice(0, 10).replace(/-/g, '')
    let name = ''
    let savedTo = ''
    try {
      const dir = repoDir(repoId)
      name = uniqueName(dir, ymd)
      fs.writeFileSync(path.join(dir, name), html, 'utf8')
      savedTo = 'storage/' + repoId + '/' + name

      /* ★★★ 2026-11-03 用户："成片不交个人仓库，只能下载"
         根因：仓库页读的是 **OSS**（listAllObjects('storage/<repoId>/')），
              而 lab2 只写本地磁盘 ⇒ 仓库页永远看不到。
         修法：和老线一样，**同时 putObject 到 OSS**。 */
      try {
        const { putObject } = await import('@/lib/oss')
        await putObject(
          'storage/' + repoId + '/' + name,
          Buffer.from(html, 'utf8'),
          'text/html',
        )
        savedTo += '（已同步 OSS）'
      } catch (e2) {
        savedTo += '（OSS 同步失败：' + String((e2 as Error)?.message || e2).slice(0, 60) + '）'
      }
    } catch (e) {
      /* 写仓库失败 ⇒ 回落临时目录（至少能看能下载） */
      const fb = path.join(process.cwd(), 'temp', '_lab2', 'out')
      fs.mkdirSync(fb, { recursive: true })
      name = 'lab2_' + Date.now() + '.html'
      fs.writeFileSync(path.join(fb, name), html, 'utf8')
      savedTo = 'temp/_lab2/out/' + name + '（仓库写入失败：' + String((e as Error)?.message || e) + '）'
    }

    /* ★★★ 2026-11-04 用户：「要能跟我实现长期会话，自己有记忆。
       不是这份做完了下次它连自己干什么都忘记。」
       ⇒ 首轮生成后，把「在做什么 + 这版文件名」写进会话
         （后续 /api/lab2/chat 会带着它 + 历史 + 当前 HTML 去改，这才是"记得") */
    try {
      const { appendMessage } = await import('@/lib/lab2/session')
      const sid = String(body?.sessionId || 'main')
      const W0 = isLand ? 1280 : 720
      const H0 = isLand ? 720 : 1280
      appendMessage(
        userId,
        sid,
        {
          role: 'assistant',
          text: '首版已生成（' + (html.match(/<section[^>]*class="sec/g) || []).length + ' 段）',
          htmlName: name,
          ts: new Date().toISOString(),
        },
        {
          W: W0,
          H: H0,
          aspect: isLand ? '16:9' : '9:16',
          contentType: form.contentType,
          copyMode: form.copyMode,
          decoDensity: form.decoDensity,
          bigImg: form.bigImg,
          imgCount: imgs.length,
          imgs: imgs.slice(0, 20),
        },
      )
    } catch { /* 会话写失败不影响出片 */ }

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
      /* ★2026-11-05 用户："我要做横屏，出来是竖屏中一个横屏"
         根因：前端预览框写死 9/16 ⇒ 把实际画幅告诉它，预览跟着走 */
      aspect: isLand ? '16:9' : '9:16',
      savedTo,
      review,                  /* ★自审记录（改了几轮 / 发现什么 / 改了什么） */
      imgSent: imgOk,          /* AI 实际看到的图张数 */
      /* ★2026-11-05 修统计口径：原来 filter(Boolean) 把**外链 URL 也算"内联"**
         ⇒ 明明 0 张 base64，页面却显示"内联 17 张"，一直在骗人 */
      imgEmbedded: embedImgs.filter((x) => !!x && /^data:image\//.test(x)).length,
      /* 新增：HTML 里残留的外链数（>0 就是"这份成片会过期"） */
      imgExternal: (html.match(/https:\/\/[^"'\s)]*(?:aliyuncs|oss)/g) || []).length,
      /* ★素材使用明细（第几段用了哪几张图 / 漏了哪几张） */
      imgUsage,
      /* ★设定 vs 实际（大图比设多少 / 实际满幅几段） */
      setCheck,
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
