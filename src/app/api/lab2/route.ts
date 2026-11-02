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

function outDir(): string {
  const d = path.join(process.cwd(), 'temp', '_lab2', 'out')
  fs.mkdirSync(d, { recursive: true })
  return d
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

    /* ── 读图片 ── */
    const imgParts: { type: 'image_url'; image_url: { url: string } }[] = []
    for (const k of imgs.slice(0, 12)) {
      const b64 = await readImgB64(k)
      if (b64) imgParts.push({ type: 'image_url', image_url: { url: 'data:image/jpeg;base64,' + b64 } })
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

    /* ── 存文件 ── */
    const name = 'lab2_' + Date.now() + '.html'
    fs.writeFileSync(path.join(outDir(), name), html, 'utf8')

    return NextResponse.json({
      ok: true,
      url: '/api/lab2/file?name=' + encodeURIComponent(name),
      name,
      elapsed: Math.round((Date.now() - t0) / 1000),
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
