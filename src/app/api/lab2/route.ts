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
import { buildLab2Prompt, buildLab2PromptConcept, buildLab2PromptStrong, type Lab2Form } from '@/lib/lab2/prompt'
import { TECHNIQUES as ALL_TECHS } from '@/lib/lab2/techniques'
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
/**
 * ★★★ 2026-11-07 技法验收（这是"勾了必须用"的闭环）
 *
 * 用户：「技法都编辑成按钮 勾选必须使用」「出错不怕，有截图二次修」
 *   ⇒ 勾了就在 prompt 里写"必须做到"，出片后**用代码逐条查**
 *   ⇒ 没做到的在报告里标 ❌，你可以点「🔧 补做」带着缺失清单去改片
 *
 * 判据来自 lib/lab2/techniques.ts 的 check / check2（正则 + 最少处数）
 * 少数没有正则的（纯排版页 / 巨型数字）单独判断。
 */
function scanTechniques(html: string, ids: string[]): Array<{
  id: string
  name: string
  ok: boolean
  detail: string
}> {
  if (!ids.length) return []
  const techs = ALL_TECHS.filter((t) => ids.includes(t.id))
  const secHtml = [...html.matchAll(/<section[^>]*class="sec[^"]*"[^>]*>[\s\S]*?<\/section>/g)]
    .map((m) => m[0])
  const total = secHtml.length

  const out: Array<{ id: string; name: string; ok: boolean; detail: string }> = []

  for (const t of techs) {
    let ok = false
    let detail = ''

    /* 有正则的走正则 */
    if (t.check) {
      const n1 = (html.match(t.check.re) || []).length
      const n2 = t.check2 ? (html.match(t.check2.re) || []).length : Infinity
      ok = n1 >= t.check.min && n2 >= (t.check2?.min ?? 0)
      detail = `${t.check.re.source.slice(0, 22)}… ${n1} 处`
      if (t.check2) detail += ` + ${n2} 处`
      if (!ok) detail += `（要求 ≥${t.check.min}${t.check2 ? ' / ≥' + t.check2.min : ''}）`
    }

    /* 单独判断：纯排版页 */
    if (t.id === 'typeonly') {
      const pure = secHtml.filter((s) => !/<img\b/i.test(s) && !/url\(\s*['"]?data:image/i.test(s)).length
      ok = pure >= 1
      detail = `无图段 ${pure}/${total}`
    }

    /* 单独判断：巨型数字（字号 ≥ 短边 25%） */
    if (t.id === 'bignum') {
      const fs = [...html.matchAll(/font-size\s*:\s*(\d+)px/g)].map((m) => Number(m[1]))
      const maxFs = fs.length ? Math.max(...fs) : 0
      ok = maxFs >= 320
      detail = `最大字号 ${maxFs}px（要求 ≥320）`
    }

    /* 单独判断：点阵生长（★2026-11-12 除了 opacity:calc，也认 canvas 画点）
       —— 实测 114615 用 canvas 画了一团粒子，却被判"0 处" */
    if (t.id === 'dotgrow') {
      const cssDots = (html.match(/opacity\s*:\s*calc\(/g) || []).length
      const canvasDots = /fillRect|arc\s*\(/.test(html) ? 1 : 0
      const loopDraw = /for\s*\(\s*var\s+\w+\s*=\s*0[^)]{0,40}\)\s*\{/.test(html) ? 1 : 0
      ok = cssDots >= 2 || (canvasDots === 1 && loopDraw === 1)
      detail = `CSS 错峰 ${cssDots} 处 · canvas 点阵 ${canvasDots && loopDraw ? '有' : '无'}`
    }

    /* 单独判断：透视网格（★2026-11-12 除了 perspective()，也认 canvas 画网格） */
    if (t.id === 'grid3d') {
      const cssP = /perspective\s*\(/.test(html)
      const svgGrid = /<pattern|transform="matrix|<line\b/.test(html)
      const canvasGrid = /lineTo\s*\(/.test(html) && (html.match(/lineTo\s*\(/g) || []).length >= 6
      ok = cssP || svgGrid || canvasGrid
      detail = `perspective ${cssP ? '有' : '无'} · svg网格 ${svgGrid ? '有' : '无'} · canvas网格 ${canvasGrid ? '有' : '无'}`
    }

    /* 单独判断：印章（红底 + rotate）
       ★2026-11-07 修判据：原来只认 #Cxxxxx / #Exxxxx / #FFxxxx 开头，
         实测 121302 明明有 3 个红印章却被判"红色无"（它的红是 #C8352B / #D93A2B） */
    if (t.id === 'seal') {
      const rot = (html.match(/rotate\(\s*-?[0-9.]+deg/g) || []).length
      /* 抓所有 #RRGGBB，判断"偏红"：R 高、G/B 低 */
      let red = false
      for (const m of html.matchAll(/#([0-9A-Fa-f]{6})\b/g)) {
        const v = m[1]
        const r = parseInt(v.slice(0, 2), 16)
        const g = parseInt(v.slice(2, 4), 16)
        const b = parseInt(v.slice(4, 6), 16)
        if (r >= 150 && g <= 95 && b <= 95) { red = true; break }
      }
      /* 也认 rgb(r,g,b) 写法 */
      if (!red) {
        for (const m of html.matchAll(/rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/g)) {
          const [r, g, b] = [Number(m[1]), Number(m[2]), Number(m[3])]
          if (r >= 150 && r - g > 55 && r - b > 55) { red = true; break }
        }
      }
      ok = rot >= 1 && red
      detail = `旋转块 ${rot} 处 · 红色 ${red ? '有' : '无'}`
    }

    out.push({ id: t.id, name: t.name, ok, detail })
  }
  return out
}

/**
 * ★★★ 2026-11-06 用户：「指标自审 / 完成复制 / PROMPT报告不再显示，**全部打印成一个文件**。
 *   镜像到本地，小眼睛点击弹窗看报告。」
 *
 * 之前：这份报告是**前端 buildReport() 拼的**，只显示在页面上
 *   ⇒ 从来不落文件 ⇒ 镜像只有 HTML（只有 __trace），本地看不到技术扫描/自审/素材统计
 *
 * 现在：后端生成一份纯文本，跟成片一起存：
 *   storage/<repoId>/gen_xxx.html
 *   storage/<repoId>/gen_xxx.report.txt     ← 这份
 * 两者都 putObject 到 OSS ⇒ 前端 storageMirror 一次拉两个
 */
function buildReportText(o: {
  f: Lab2Form
  W: number
  H: number
  name: string
  savedTo: string
  elapsed: number
  totalSeconds: number
  segCount: number
  trace: unknown
  prompt: string
  metrics: ReturnType<typeof scanMetrics>
  setCheck: { bigImgSet: number; fullSecs: number; totalSecs: number; actualPct: number }
  imgUsage: { total: number; used: number[]; missing: number[]; perSec: number[][]; unknown: boolean }
  imgSent: number
  imgEmbedded: number
  imgExternal: number
  imgErrs: string[]
  ossKeys: string[]
  review?: { shotOk: boolean; rounds: number; issues: string[]; changes: string[]; shotErr?: string }
  fixes: { deadlock: number; ids: number; animIn: number }
  /* ★2026-11-07 技法验收结果 */
  techCheck?: Array<{ id: string; name: string; ok: boolean; detail: string }>
}): string {
  const { f, metrics: m } = o
  const L: string[] = []

  L.push('══════ 本单要求 ══════')
  L.push('内容类型：' + (f.contentType || '不指定'))
  L.push('画幅：' + o.W + ' × ' + o.H + '（' + (String(f.aspect || '') === '16:9' ? '横屏 16:9' : '竖屏 9:16') + '）')
  L.push('文案模式：' + (f.copyMode || 'sell')
    + ' · 装饰密度：' + (f.decoDensity || 'mid')
    + ' · 动效：' + (f.motion || 'on'))
  L.push('大图比：' + (f.bigImg ?? 100) + '%'
    + ' · 收尾帧不用图：' + (f.endCard ? '是' : '否')
    + ' · 强提示词：' + (f.strongPrompt ? '开' : '关'))
  L.push('素材：' + (f.imgCount || 0) + ' 张 · 目标时长：约 ' + (f.maxSeconds || 45) + ' 秒')
  L.push('（历史教训：' + ((f.memories || []).length ? (f.memories || []).join(' / ') : '无') + '）')
  const ur = String(f.userRules || '').trim()
  if (ur) L.push('客户额外要求：' + ur)
  L.push('')

  L.push('══════ 时长达标 ══════')
  const want = Number(f.maxSeconds || 45)
  L.push('目标 ' + want + ' 秒 → 实际 ' + o.totalSeconds + ' 秒（' + o.segCount + ' 段）'
    + (Math.abs(o.totalSeconds - want) > 5 ? '　⚠️ 差 ' + Math.abs(o.totalSeconds - want) + ' 秒' : '　✅ 接近'))
  L.push('')

  L.push('══════ AI 思考日志（__trace）══════')
  try { L.push(JSON.stringify(o.trace, null, 2)) } catch { L.push('（无法解析）') }
  L.push('')

  L.push('══════ 技术扫描 ══════')
  L.push('段数：' + m.sections + ' · <svg>：' + m.svg + ' · <text>：' + m.text + ' · <canvas>：' + m.canvas)
  L.push('line-height 最低：' + m.lineHeightMin + '（违规 ' + m.lineHeightBad + ' 处）')
  L.push('负 letter-spacing：' + m.letterSpacingNeg + ' 处（最小 ' + m.letterSpacingMin + '）')
  L.push('压暗(<0.95)：' + m.darkCount + ' 处' + (m.darkMin ? '（最低 ' + m.darkMin + '）' : ''))
  L.push('贴纸白边：' + (m.hasSticker ? '有' : '无'))
  L.push('思考日志：' + (m.hasTrace ? '有' : '无'))
  L.push('自动播放：' + (m.hasAutoplay ? '有' : '无'))
  L.push('CSS var(--p)：' + (m.cssVarP ?? 0) + ' 处'
    + ((m.cssVarP ?? 0) < 3 ? '（≈0 ⇒ 动效全靠 JS，一崩就静止）' : ''))
  L.push('')
  if (o.fixes.deadlock + o.fixes.ids + o.fixes.animIn > 0) {
    L.push('══════ 自动修复（致命错误，代码级确定性修）══════')
    if (o.fixes.deadlock) L.push('⚠️ 动画死锁 ' + o.fixes.deadlock + ' 处：[data-p="1"] 可见时永远到不了 1 ⇒ 已放宽成 [data-p]')
    if (o.fixes.ids) L.push('⚠️ 段落 id 缺失 ' + o.fixes.ids + ' 个：CSS 用 #sN 但 section 没 id ⇒ 段落样式全废 ⇒ 已按顺序补')
    if (o.fixes.animIn) L.push('⚠️ 动画终态缺失 ' + o.fixes.animIn + ' 条：JS 加 .in 但 CSS 没写规则 ⇒ 已补终态')
    L.push('')
  }

  L.push('══════ 设定 vs 实际 ══════')
  L.push('大图比设 ' + o.setCheck.bigImgSet + '% → 实际满幅 '
    + o.setCheck.fullSecs + '/' + o.setCheck.totalSecs + ' = ' + o.setCheck.actualPct + '%'
    + (Math.abs(o.setCheck.actualPct - o.setCheck.bigImgSet) > 20 ? '（⚠️ 差得多）' : '（✅ 对得上）'))
  L.push('')

  /* ★2026-11-07 技法验收（勾了必须用 —— 这是闭环） */
  if (o.techCheck && o.techCheck.length) {
    const okN = o.techCheck.filter((x) => x.ok).length
    L.push('══════ 技法验收（勾了必须用）══════')
    L.push('勾了 ' + o.techCheck.length + ' 个 → 实际做到 ' + okN + ' 个'
      + (okN === o.techCheck.length ? '　✅ 全做到' : '　⚠️ 缺 ' + (o.techCheck.length - okN) + ' 个'))
    o.techCheck.forEach((x) => {
      L.push((x.ok ? '✅ ' : '❌ ') + x.name.padEnd(10, ' ') + ' ' + x.detail)
    })
    const miss = o.techCheck.filter((x) => !x.ok).map((x) => x.name)
    if (miss.length) {
      L.push('')
      L.push('⇒ 补做时把这句话发过去：')
      L.push('   「技法验收发现有 ' + miss.length + ' 个没做到：' + miss.join('、')
        + '。请只补这几样，其它别动。」')
    }
    L.push('')
  }

  L.push('══════ 素材使用 ══════')
  if (f.conceptMode) {
    /* ★2026-11-09 概念片不读素材，别报"它没写占位符"这种误导 */
    L.push('概念片模式 —— 不使用任何素材（全片由几何 / 数据 / 动效构成）')
  } else if (o.imgUsage.unknown) {
    L.push('（它没写 {{IMG_N}} 占位符，无法统计用了哪张）')
  } else {
    /* ★2026-11-07 用户：「减素材可以，但比例不能大于 10%」 */
    const cap = Math.max(0, Math.floor(o.imgUsage.total * 0.1))
    const over = o.imgUsage.missing.length > cap
    L.push('素材 ' + o.imgUsage.total + ' 张 → 用了 ' + o.imgUsage.used.length + ' 张'
      + (o.imgUsage.missing.length
        ? '｜漏了 ' + o.imgUsage.missing.length + ' 张（上限 ' + cap + ' 张'
          + (over ? '　❌ 超标' : '　✅ 在范围内') + '）'
        : '｜全部用上 ✅'))
    if (o.imgUsage.missing.length) {
      L.push('　漏了：IMG_' + o.imgUsage.missing.join('、IMG_'))
    }
    L.push('逐段：' + o.imgUsage.perSec
      .map((ids, i) => '段' + (i + 1) + '[' + (ids.length ? ids.map((x) => 'IMG_' + x).join('+') : '无图') + ']')
      .join(' '))
  }
  L.push('')

  L.push('══════ 图片落地 ══════')
  L.push('AI 看到：' + o.imgSent + ' 张 · 内联进 HTML：' + o.imgEmbedded + ' 张')
  L.push(o.imgExternal > 0
    ? '⚠️ 外链 ' + o.imgExternal + ' 个（签名会过期，1~2 小时后图全裂）'
    : '外链 0 个 ✅（自包含，永久有效）')
  if (o.imgErrs.length) L.push('读图失败：' + o.imgErrs.join(' ｜ '))
  if (o.ossKeys.length) L.push('OSS 路径：' + o.ossKeys.join(' | '))
  L.push('')

  L.push('══════ 自审 ══════')
  if (o.review) {
    L.push(o.review.shotOk
      ? '自审 ✓（改了 ' + o.review.rounds + ' 轮）'
      : '自审 ✗（截图失败：' + (o.review.shotErr || '未执行') + '）')
    L.push('发现的问题（' + o.review.issues.length + '）：' + (o.review.issues.length ? '' : '无（它认为合格）'))
    o.review.issues.forEach((s, i) => L.push('  ' + (i + 1) + '. ' + s))
    L.push('改了什么（' + o.review.changes.length + '）：' + (o.review.changes.length ? '' : '没改（它认为没问题）'))
    o.review.changes.forEach((s, i) => L.push('  ' + (i + 1) + '. ' + s))
  } else {
    L.push('（没有自审记录 —— 开关可能关着）')
  }
  L.push('')

  L.push('══════ 文件名 ══════')
  L.push(o.name + ' · 耗时 ' + o.elapsed + 's')
  L.push('存到：' + o.savedTo)
  L.push('')
  L.push('══════ 完整 prompt（复现用）══════')
  L.push(o.prompt)

  return L.join('\n')
}

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
    + 'if(!on){sec.style.visibility="hidden";sec.style.opacity="0";sec.dataset.lab2Played="";}'
    + 'else{'
    + '  sec.style.visibility="visible";'
    /**
     * ★★★ 2026-11-06 用户实测（gen_20261106_122343）："毫无动效 一张一张海报"
     *
     * 病灶：这单 CSS 里 `var(--p)` **0 次**、`transition` **0 次**，
     *   动画全用 `@keyframes` + `animation`（5 组关键帧）
     *   ⇒ animation 在**页面加载时**就开始播（元素早就在 DOM 里）
     *   ⇒ 而当时段是 hidden ⇒ **动画在看不见的时候播完了**
     *   ⇒ 切到那一段：已经静止 ⇒ 一张海报
     *
     * 兜底：段变可见时，把段内所有带动画的元素**重播一次**
     *   （只重播一次，靠 dataset 标记；离开时清标记，下次进来再播）
     */
    + '  if(sec.dataset.lab2Played!=="1"){'
    + '    sec.dataset.lab2Played="1";'
    + '    try{'
    + '      var kids=sec.querySelectorAll("*");'
    + '      for(var q=0;q<kids.length;q++){'
    + '        var el=kids[q];'
    + '        var cs=getComputedStyle(el);'
    + '        if(cs.animationName&&cs.animationName!=="none"){'
    + '          var orig=el.style.animation;'
    + '          el.style.animation="none";'
    + '          void el.offsetHeight;'
    + '          el.style.animation=orig;'
    + '        }'
    + '      }'
    + '    }catch(e){}'
    + '  }'
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
    /* ★2026-11-06 修口径：原来只认 `var(--p)`，漏了 `var(--p,0)`（AI 最常用的写法）
       ⇒ 明明几十处，报告显示"0 处 ⇒ 动效全靠 JS"，一直在误判 */
    cssVarP: (html.match(/var\(\s*--p\b/g) || []).length,
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
      /* ★2026-11-06 收尾帧：最后一段纯绘制（不用图） */
      endCard: body?.endCard === true,
      /* ★2026-11-06 强提示词档位 */
      strongPrompt: body?.strongPrompt === true,
      /* ★2026-11-07 技法勾选（勾了必须做到，报告里逐条验收） */
      techniques: Array.isArray(body?.techniques) ? body.techniques.map(String).slice(0, 30) : [],
      /* ★2026-11-09 概念片（无素材模式）—— 不读素材，只讲"形状怎么长" */
      conceptMode: body?.conceptMode === true,
      /* ★2026-11-08 用户：「记忆系统加开关…那个只要 2-3 分钱，有些人不追求高级所以没必要管」
         ⇒ 默认关（不注入 = 不花 token）；开了才带历史教训 */
      memories: body?.useMemory === true ? getMemories(userId) : [],
      userRules: String(body?.userRules || ''),
      selfReview: body?.selfReview !== false,
    }
    const prompt = form.conceptMode
      ? buildLab2PromptConcept(form)
      : (form.strongPrompt ? buildLab2PromptStrong(form) : buildLab2Prompt(form))
    console.log('[lab2] prompt 档位：' + (form.conceptMode ? '概念片（' : form.strongPrompt ? '强版（' : '简版（')
      + Math.round(prompt.length / 1000) + ' 千字）')

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
     *
     * ★★★ 2026-11-05 修：第一版判据只用 `inset:0`，
     *   实测 135355 那单 9 段全是满幅（`<img class="full-img">` + CSS 里 object-fit:cover），
     *   但我报了「0/9 = 0%」——**假警报**。
     *   现在三个判据叠加，且要求"该段只有 1 张图"（避免把双图并排算成满幅）：
     *     ① 段内含 `inset:0`
     *     ② 段内含 `background-size:cover` 且只有一处背景图
     *     ③ 段内唯一 `<img>` 的 class 在 CSS 里同时有 object-fit:cover + width:100% + height:100%
     */
    const setCheck: {
      bigImgSet: number
      fullSecs: number
      totalSecs: number
      actualPct: number
    } = (() => {
      /* 先把 CSS 里每个 class 的定义抓出来 */
      const cssMap: Record<string, string> = {}
      {
        const re = /\.([a-zA-Z0-9_-]+)\s*\{([^}]*)\}/g
        let m: RegExpExecArray | null
        while ((m = re.exec(html)) !== null) {
          cssMap[m[1]] = (cssMap[m[1]] || '') + m[2]
        }
      }

      const isFull = (s: string): boolean => {
        const imgCount = (s.match(/<img\b/g) || []).length
        const bgCount = (s.match(/background-image\s*:/g) || []).length
        /* ① ★2026-11-06 第三次修：原来要求"该段只有 1 张图"，结果 101822 那单
             11 段全有 inset:0（双图拼贴也是铺满画布），却被判成 0/11 ⇒ 假警报。
           "满幅"的定义就是**图铺满画布** —— 双图对切也是满幅。
           ⇒ 只要段内有 inset:0，就算满幅。 */
        if (/inset:\s*0/.test(s)) return true
        /* ② */
        if (/background-size:\s*cover/.test(s) && bgCount === 1 && imgCount === 0) return true
        /* ③ */
        if (imgCount === 1) {
          const cls = (s.match(/<img[^>]*\sclass="([^"]*)"/) || [])[1] || ''
          for (const c of cls.split(/\s+/).filter(Boolean)) {
            const def = cssMap[c] || ''
            if (/object-fit:\s*cover/.test(def)
              && /width:\s*100%/.test(def)
              && /height:\s*100%/.test(def)) return true
          }
          /* 兜底：class 名就叫 full / bg / cover 之类，且 CSS 里有 object-fit:cover */
          for (const c of cls.split(/\s+/).filter(Boolean)) {
            const def = cssMap[c] || ''
            if (/object-fit:\s*cover/.test(def) && /position:\s*absolute/.test(def)) return true
          }
        }
        return false
      }

      const secHtml = [...html.matchAll(/<section[^>]*class="sec[^"]*"[^>]*>[\s\S]*?<\/section>/g)]
        .map((m) => m[0])
      const fullSecs = secHtml.filter(isFull).length
      const totalSecs = secHtml.length
      return {
        bigImgSet: Number(form.bigImg ?? 100),
        fullSecs,
        totalSecs,
        actualPct: totalSecs ? Math.round((fullSecs / totalSecs) * 100) : 0,
      }
    })()

    html = embedPlaceholders(html, embedImgs)

    /**
     * ★★★ 2026-11-06 用户实测（gen_20261106_104824，9 段 7 段黑）：
     *   「这不需要在自审才发现，这属于致命错误。根本不需要什么审再来发现。」
     *
     * 死锁长这样：
     *   JS：sec.setAttribute('data-p', String(p))     // p = (t-start)/duration，连续值
     *   CSS：#s1[data-p="1"] .char { opacity: 1 }      // **要求字符串精确等于 "1"**
     *        ↓
     *   p === 1  ⟺  t === start + duration
     *   但可见条件是 t < start + duration
     *        ↓
     *   ★ **p 在"可见"时永远到不了 1** ⇒ 触发规则永远不成立
     *   ⇒ 所有 opacity:0 的元素永远不显示 ⇒ 纯排版段全黑、有图段"有图无字"
     *
     * 代码能确定性修：把**终点态** `[data-p="1"]` 放宽成 `[data-p]`（属性存在即匹配，
     * 而 __seek 每帧都会设这个属性）⇒ 逐字/逐项的 transition-delay 仍然生效。
     *   · 只替换 `="1"` / `='1'` / `=1` 这种**精确终点**，不动 `="0.3"` 这类中间态
     */
    let deadlockFix = 0
    html = html.replace(/\[data-p\s*=\s*["']?1(?:\.0+)?["']?\]/g, () => {
      deadlockFix++
      return '[data-p]'
    })
    if (deadlockFix > 0) {
      console.log('[lab2] ⚠️ 检测到 ' + deadlockFix + ' 处 [data-p="1"] 死锁 ⇒ 已放宽成 [data-p]')
    }

    /**
     * ★★★ 2026-11-06 用户实测（gen_20261106_114737，8 段全废）：
     *
     * 病灶：CSS 全部用 `#s1 .big` / `#s2 .overlay` / `#s3 .imgwrap` 这种**段落前缀**，
     *   但 HTML 里的 section **一个 id 都没有**（`<section class="sec" data-start="0">`）
     *   ⇒ 除无前缀的通用类（.sec/.grain/.vignette/.display/.imgwrap）外，
     *     **所有段落样式全部失效**
     *   ⇒ 表现：巨字退化成 16px、遮罩没有、文字失去定位变成"流式堆在图片下面"
     *     ⇒ 首尾纯排版段全黑、带图段"图占上半 + 底部大黑区"（自审误判成"图没铺满"）
     *
     * 代码能确定性修：CSS 用到了 #s1..#sN ⇒ 就按顺序给第 N 个 section 补 id="sN"。
     *   安全边界：
     *     · CSS 里没用到 #sN ⇒ 不动
     *     · section 数量 < 用到的最大编号 ⇒ 不动（可能是别的元素的 id）
     *     · 所有 section 都已有 id ⇒ 不动
     */
    let idFix = 0
    {
      const used = new Set<number>()
      const re = /#s(\d+)\b/g
      let mm: RegExpExecArray | null
      while ((mm = re.exec(html)) !== null) {
        const n = Number(mm[1])
        if (n >= 1 && n <= 60) used.add(n)
      }
      const maxN = used.size ? Math.max(...used) : 0

      const secRe = /<section\b([^>]*\bclass="[^"]*\bsec\b[^"]*"[^>]*)>/g
      const secs = [...html.matchAll(secRe)]
      const total = secs.length

      if (maxN > 0 && total >= maxN) {
        /* 有 section 缺 id（或者 id 和顺序对不上）才动手 */
        const needFix = secs.some((m, i) => {
          const idm = m[1].match(/\bid="([^"]*)"/)
          return !idm || idm[1] !== 's' + (i + 1)
        })
        if (needFix) {
          let i = 0
          html = html.replace(secRe, (whole, attrs: string) => {
            i++
            let a = String(attrs)
            if (/\bid="[^"]*"/.test(a)) a = a.replace(/\bid="[^"]*"/, 'id="s' + i + '"')
            else a = ' id="s' + i + '"' + a
            idFix++
            return '<section' + a + '>'
          })
          console.log('[lab2] ⚠️ 检测到 CSS 用了 #s1~#s' + maxN
            + '，但 section 缺 id ⇒ 已按顺序补 ' + idFix + ' 个')
        }
      }
    }

    /**
     * ★★★ 2026-11-06 用户实测（gen_20261106_120702，全片一个字没有）：
     *
     * 病灶：它写了 JS 去加类，但**忘了写对应的 CSS 规则**
     *   JS：  sec.querySelectorAll('.anim-up').forEach(el => el.classList.add('in'))
     *   CSS：.anim-up { transform: translateY(40px); opacity: 0; transition: ... }
     *         ↑ 只有初始态，**没有 `.anim-up.in { opacity: 1 }`**
     *   ⇒ `.in` 加上了但没有任何样式 ⇒ 所有文字永远停在 opacity: 0
     *   ⇒ 全片只有不带动画类的元素能看见（比如 .bg-text 那个 opacity:0.03 的巨型数字）
     *
     * 代码能确定性修：JS 里有 classList.add('in') 但 CSS 里没有 .in 规则 ⇒ 补三条终态。
     *   ⚠️ 不加 !important —— 片子自己有更具体规则时（如 #s1 .anim-up.in）优先级更高，让它赢。
     */
    let animInFix = 0
    {
      const usesIn = /classList\.add\(\s*['"]in['"]\s*\)/.test(html)
      if (usesIn) {
        /**
         * ★逐个类检查（实测 120702：它写了 .anim-scale.in 和 .mask-reveal.in，
         *   但**漏了 .anim-up.in** —— 而 .anim-up 用了 20+ 次，是全部文字）
         *   ⇒ 不能只看"有没有 .in 规则"，要看"每个用到的动画类有没有对应终态"
         */
        const need: Array<[string, string]> = [
          ['anim-up', '.anim-up.in { transform: translateY(0); opacity: 1; }'],
          ['anim-scale', '.anim-scale.in { transform: scale(1); opacity: 1; }'],
          ['mask-reveal', '.mask-reveal.in { clip-path: inset(0); opacity: 1; }'],
          ['fade-in', '.fade-in.in { opacity: 1; }'],
          ['reveal', '.reveal.in { opacity: 1; transform: none; }'],
        ]
        const missing: string[] = []
        for (const [cls, rule] of need) {
          /* HTML 里真的用了这个类（class="... anim-up ..."） */
          const usedInHtml = new RegExp('class="[^"]*\\b' + cls + '\\b').test(html)
          if (!usedInHtml) continue
          /* CSS 里有没有 .<cls>.in { 这条规则 */
          const hasRule = new RegExp('\\.' + cls + '\\.in\\s*\\{').test(html)
          if (!hasRule) missing.push(rule)
        }
        if (missing.length) {
          const inject = '\n/* ★ lab2 auto-fix（2026-11-06）：JS 会加 .in 但原片漏了这些终态 */\n'
            + missing.join('\n') + '\n'
          if (html.includes('</style>')) {
            html = html.replace('</style>', inject + '</style>')
          } else {
            html = html.replace(/<\/head>/i, '<style>' + inject + '</style></head>')
          }
          animInFix = missing.length
          console.log('[lab2] ⚠️ JS 会加 .in 但 CSS 漏了 ' + missing.length + ' 条终态 ⇒ 已补')
        }
      }
    }

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

    /**
     * ★★★ 2026-11-06 用户："今天 6 号，日期全部是 5 号的"
     *
     * 病灶：这里用 `toISOString()`（**UTC**）取日期，
     *   而 uniqueName() 里的 hms 用 `getHours()`（**本地时间**）
     *   ⇒ 两个不同源 ⇒ 北京时间 08:00 以前生成的文件，日期会写成**前一天**
     *   实测：北京 11-06 07:52 → UTC 11-05 23:52 → 文件名 gen_20261105_0752.html
     *
     * 修：日期也用本地时区（和 hms 同源）
     */
    const _now = new Date()
    const ymd = String(_now.getFullYear())
      + String(_now.getMonth() + 1).padStart(2, '0')
      + String(_now.getDate()).padStart(2, '0')
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

    /* ══ 报告落成文件（用户：全部打印成一个文件 + 镜像到本地）══ */
    const metrics = scanMetrics(html)
    const traceObj = extractTrace(html)
    const elapsedSec = Math.round((Date.now() - t0) / 1000)
    /* ★2026-11-07 技法验收：勾了的逐条查（做到 ✅ / 没做 ❌） */
    const techCheck = scanTechniques(html, form.techniques || [])
    let reportName = ''
    let reportText = ''
    try {
      reportText = buildReportText({
        f: form,
        W: CW,
        H: CH,
        name,
        savedTo,
        elapsed: elapsedSec,
        totalSeconds,
        segCount: segments.length,
        trace: traceObj,
        prompt,
        metrics,
        setCheck,
        imgUsage,
        imgSent: imgOk,
        imgEmbedded: embedImgs.filter((x) => !!x && /^data:image\//.test(x)).length,
        imgExternal: (html.match(/https:\/\/[^"'\s)]*(?:aliyuncs|oss)/g) || []).length,
        imgErrs: imgErrs.slice(0, 4),
        ossKeys: imgs.slice(0, 3).map(ossKey),
        review,
        fixes: { deadlock: deadlockFix, ids: idFix, animIn: animInFix },
        techCheck,
      })
      reportName = name.replace(/\.html$/, '') + '.report.txt'
      try {
        fs.writeFileSync(path.join(repoDir(repoId), reportName), reportText, 'utf8')
      } catch { /* 本地写失败不影响 OSS */ }
      try {
        const { putObject: putObj } = await import('@/lib/oss')
        await putObj(
          'storage/' + repoId + '/' + reportName,
          Buffer.from(reportText, 'utf8'),
          'text/plain; charset=utf-8',
        )
        console.log('[lab2] 报告已存：' + reportName + '（' + Math.round(reportText.length / 1024) + 'KB）')
      } catch (e3) {
        console.log('[lab2] 报告上传失败：' + String((e3 as Error)?.message || e3).slice(0, 80))
      }
    } catch (e4) {
      console.log('[lab2] 报告生成失败：' + String((e4 as Error)?.message || e4).slice(0, 80))
    }

    return NextResponse.json({
      ok: true,
      url: '/api/lab2/file?name=' + encodeURIComponent(name) + '&repoId=' + encodeURIComponent(repoId),
      repoId,
      name,
      /* ★2026-11-05 用户："我要做横屏，出来是竖屏中一个横屏"
         根因：前端预览框写死 9/16 ⇒ 把实际画幅告诉它，预览跟着走 */
      aspect: isLand ? '16:9' : '9:16',
      /* ★2026-11-06 自动修掉了几处动画死锁（[data-p="1"] ⇒ [data-p]） */
      deadlockFixed: deadlockFix,
      /* ★2026-11-06 自动补了几个 section 的 id（CSS 用了 #sN 但 HTML 没有 id） */
      sectionIdsFixed: idFix,
      /* ★2026-11-06 自动补了 .in 终态样式（JS 加类但 CSS 没写规则 ⇒ 全片无字） */
      animInFixed: animInFix,
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
      elapsed: elapsedSec,
      totalSeconds,
      segments,
      trace: traceObj,
      metrics,
      prompt,
      /* ★2026-11-06 报告落成文件（页面不再自己拼，镜像时一起拉到本地） */
      reportName,
      reportText,
      memoriesUsed: form.memories || [],
      /* 供前端「重做」用 */
      html,
    })
  } catch (e) {
    return NextResponse.json({ ok: false, error: String((e as Error)?.message || e) }, { status: 500 })
  }
}
