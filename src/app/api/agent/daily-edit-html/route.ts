import { NextRequest, NextResponse } from 'next/server'
import { getAuthFromHeaders } from '@/lib/api-auth'

/**
 * 交付卡「✏️ 编辑」—— **把画面上某一句文字改成新的**（真正写回 HTML）
 *
 * ★VF_EDIT_HTML_API_V1（2026-10-24 用户定案「能让所有字都能改吗」）
 *
 * 为什么需要它：AI 自由档的出片产物是**一整页 HTML**，而编辑面板以前改的是 `d.plan`
 *   （那只是从 HTML 反推出来的影子）⇒ **改了画面不变**（用户实测"改了没反应"）。
 *   要让"改字"真的生效，只有一条路：**直接改 HTML 里那一段文字**，再重新出片。
 *
 * 定位方式：`(seg, idx)` —— 第 seg 段里、**按 DOM 顺序**的第 idx 个文字节点
 *   （跳过 `<style>/<script>` 内容、跳过无中文的节点，与 `planFromAiHtml` 的提取口径一致）。
 *   同时用 `from` 做**二次校验**：内容对不上就不改（防止顺序漂移改错地方）。
 *
 * POST { name: 'gen_xxx.html', edits: [{ seg, idx, from, to }] }
 *   => { success, data: { changed, skipped: [{seg,idx,reason}] } }
 *
 * 安全：① 只能改自己 `storage/<uid>/` 下的文件；② 改前先备份到 `dfcache/<uid>/html-bak/`；
 *      ③ `to` 最长 120 字、不许含 `<` `>`（防注入标签）。
 */
export const maxDuration = 60
export const dynamic = 'force-dynamic'

type Edit = { seg: number; idx: number; from: string; to: string }

/** 在第 `idx` 个「文字节点」上做替换；命中返回新串，未命中返回 null */
function replaceNthText(html: string, idx: number, from: string, to: string): string | null {
  // style / script 区间要跳过（CSS 选择器里也有 > 和 <）
  const skip: Array<[number, number]> = []
  for (const m of html.matchAll(/<(style|script)\b[\s\S]*?<\/\1>/gi)) {
    const i = m.index ?? -1
    if (i >= 0) skip.push([i, i + m[0].length])
  }
  const inSkip = (p: number) => skip.some(([a, b]) => p >= a && p < b)

  const wantFrom = String(from || '').replace(/\s+/g, ' ').trim()
  let count = 0
  for (const m of html.matchAll(/>([^<>]+)</g)) {
    const start = (m.index ?? -1) + 1
    if (start <= 0) continue
    if (inSkip(start)) continue
    const raw = m[1]
    const t = String(raw).replace(/\s+/g, ' ').trim()
    /* ⚠️ 这里的过滤条件**必须和 `planFromAiHtml` 提取时一模一样**，否则 idx 会错位（改错句子）：
       那边是：含中文 + 长度 ≥2 + 不是纯数字（页码）。 */
    if (!t || !/[\u4e00-\u9fa5]/.test(t)) continue
    if (t.length < 2 || /^\d+([.:]\d+)?$/.test(t)) continue
    if (count === idx) {
      // 二次校验：内容必须和面板上看到的一致，否则不动（防顺序漂移改错）
      if (wantFrom && t !== wantFrom) return null
      return html.slice(0, start) + String(to) + html.slice(start + raw.length)
    }
    count++
  }
  return null
}

/** 把 html 按 `<section class="sec">` 切开，返回每段的 [start,end) 区间 */
function sectionRanges(html: string): Array<[number, number]> {
  const out: Array<[number, number]> = []
  const re = /<section\b[^>]*\bclass="[^"]*\bsec\b[^"]*"[^>]*>[\s\S]*?<\/section>/gi
  for (const m of html.matchAll(re)) {
    const i = m.index ?? -1
    if (i >= 0) out.push([i, i + m[0].length])
  }
  return out
}

export async function POST(request: NextRequest) {
  const auth = getAuthFromHeaders(request)
  if (!auth) return NextResponse.json({ success: false, message: '请先登录' }, { status: 401 })
  const uid = String((auth as any)?.userId ?? (auth as any)?.uid ?? '')

  let body: any = {}
  try { body = await request.json() } catch { /* ignore */ }

  const name = String(body?.name || '').trim()
  const edits: Edit[] = Array.isArray(body?.edits) ? body.edits : []
  if (!name || !/^[\w.-]+\.html?$/i.test(name)) {
    return NextResponse.json({ success: false, message: '缺少产物名（gen_xxx.html）' }, { status: 400 })
  }
  if (!edits.length) return NextResponse.json({ success: false, message: '没有要改的内容' }, { status: 400 })
  if (edits.length > 200) return NextResponse.json({ success: false, message: '一次改太多了（>200 处）' }, { status: 400 })

  const { getObject, putObject } = await import('@/lib/oss')
  const key = 'storage/' + uid + '/' + name

  try {
    const buf = await getObject(key)
    let html = String(buf.toString('utf8') || '')
    if (!/<section\b[^>]*\bsec\b/i.test(html)) {
      return NextResponse.json({ success: false, message: '这不是日报页产物（没找到 .sec 分段）' }, { status: 422 })
    }

    // 先备份一份（用户改错了还能找回原始）
    try {
      await putObject('dfcache/' + uid + '/html-bak/' + Date.now() + '-' + name, buf, 'text/html')
    } catch { /* 备份失败不阻断，但要记 */ }

    const ranges = sectionRanges(html)
    // 按段倒序处理（段内替换不影响其它段偏移；同段按 idx 倒序避免内部偏移）
    const bySeg = new Map<number, Edit[]>()
    for (const e of edits) {
      const seg = Number(e.seg)
      if (!Number.isFinite(seg) || seg < 1) continue
      const arr = bySeg.get(seg) || []
      arr.push(e)
      bySeg.set(seg, arr)
    }

    let changed = 0
    const skipped: Array<{ seg: number; idx: number; reason: string }> = []

    const segsDesc = [...bySeg.keys()].sort((a, b) => b - a)
    for (const seg of segsDesc) {
      const range = ranges[seg - 1]
      if (!range) { for (const e of bySeg.get(seg)!) skipped.push({ seg, idx: e.idx, reason: '这段不存在' }); continue }
      let inner = html.slice(range[0], range[1])
      const list = (bySeg.get(seg) || []).slice().sort((a, b) => Number(b.idx) - Number(a.idx))
      for (const e of list) {
        const to = String(e.to == null ? '' : e.to).trim()
        if (!to) { skipped.push({ seg, idx: e.idx, reason: '新内容是空的' }); continue }
        if (to.length > 120) { skipped.push({ seg, idx: e.idx, reason: '新内容太长（>120 字）' }); continue }
        if (/[<>]/.test(to)) { skipped.push({ seg, idx: e.idx, reason: '新内容不能含 < >' }); continue }
        const next = replaceNthText(inner, Number(e.idx) || 0, String(e.from || ''), to)
        if (next === null) { skipped.push({ seg, idx: e.idx, reason: '对不上（页面上这句话变了？）' }); continue }
        inner = next
        changed++
      }
      html = html.slice(0, range[0]) + inner + html.slice(range[1])
    }

    if (!changed) {
      return NextResponse.json({ success: false, message: '一处都没改成：' + (skipped[0]?.reason || '未知') }, { status: 422 })
    }

    await putObject(key, Buffer.from(html, 'utf8'), 'text/html')
    try {
      console.log('[改画面文字] ' + name + ' 改了 ' + changed + ' 处' + (skipped.length ? '，跳过 ' + skipped.length + ' 处' : ''))
    } catch { /* ignore */ }

    return NextResponse.json({ success: true, data: { changed, skipped, name } })
  } catch (e: any) {
    return NextResponse.json({ success: false, message: '改失败：' + String(e?.message || e).slice(0, 160) }, { status: 500 })
  }
}
