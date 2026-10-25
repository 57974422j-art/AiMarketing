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
 * ★VF_EDIT_BOTH_FILES_V1（2026-10-25 用户实测「编辑改完，出片还是旧字」）：
 *   **真 bug**：日报线有**两份产物**，编辑只改了其中一份 ⇒ 改了等于没改。
 *     · `htmlName`   = **配图版**（几十 KB，图是同级 `xxx.jpg` 外链）⇒ **分享短链 / 客户端镜像**用
 *     · `singleName` = **单文件版**（几 MB，图 base64 内嵌）⇒ **出片渲染**用
 *     而编辑面板只传了 `name`（配图版），出片却读 `singleName`（单文件版）⇒ 两份不同步。
 *   现口径：**同一批 edits 同时套用到两份**（两份文字内容完全一致，只是图片 src 不同，
 *   base64 在 `src="…"` 里、不是文字节点 ⇒ 不影响 (seg, idx) 定位）。
 *   返回里分别报每份改了几处，任一份失败都能看出来。
 *
 * 定位方式：`(seg, idx)` —— 第 seg 段里、**按 DOM 顺序**的第 idx 个文字节点
 *   （跳过 `<style>/<script>` 内容、跳过无中文的节点，与 `planFromAiHtml` 的提取口径一致）。
 *   同时用 `from` 做**二次校验**：内容对不上就不改（防止顺序漂移改错地方）。
 *
 * POST { name: 'gen_xxx.html', singleName?: 'gen_xxx_1.html', edits: [{ seg, idx, from, to }] }
 *   => { success, data: { changed, skipped, files: [{ name, changed, skipped }] } }
 *
 * 安全：① 只能改自己 `storage/<uid>/` 下的文件；② 改前先备份到 `dfcache/<uid>/html-bak/`；
 *      ③ `to` 最长 120 字、不许含 `<` `>`（防注入标签）。
 */
export const maxDuration = 120
export const dynamic = 'force-dynamic'

type Edit = { seg: number; idx: number; from: string; to: string }
type Skip = { seg: number; idx: number; reason: string }

/** 归一化：去掉所有空白与常见标点，只留字（比较用） */
function normCn(s: string): string {
  return String(s || '')
    .replace(/&nbsp;/g, ' ')
    .replace(/[\s\u3000]+/g, '')
    .replace(/[，。、；：！？…—·,.;:!?"'（）()【】\[\]《》<>「」『』~～\-]/g, '')
}

/**
 * 在第 `idx` 个「文字节点」上做替换。
 * ★VF_EDIT_MATCH_V2（2026-10-25 用户实测「一处都没改成：对不上（页面上这句话变了？）」）：
 *   原来只做**逐字精确比较**，只要面板上的字和页面上的字差一个空格/一个标点（`&nbsp;`、全角空格、
 *   换行产生的空白）就判"对不上" ⇒ 整批全废。
 *   现口径：**三级匹配**
 *     ① 精确（去多余空白后全等）；
 *     ② **归一化后全等**（去掉空白 + 标点再比）；
 *     ③ **归一化后互相包含**（面板显示的可能被截断到 60 字，页面原文更长）；
 *   三级都不中才判失败，并且**把"面板上的"和"页面上实际的"都带回去** ⇒ 下次一眼看出差在哪。
 */
function replaceNthText(html: string, idx: number, from: string, to: string):
  { out: string | null; actual?: string } {
  // style / script 区间要跳过（CSS 选择器里也有 > 和 <）
  const skip: Array<[number, number]> = []
  for (const m of html.matchAll(/<(style|script)\b[\s\S]*?<\/\1>/gi)) {
    const i = m.index ?? -1
    if (i >= 0) skip.push([i, i + m[0].length])
  }
  const inSkip = (p: number) => skip.some(([a, b]) => p >= a && p < b)

  const wantRaw = String(from || '').replace(/\s+/g, ' ').trim()
  const wantNorm = normCn(wantRaw)
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
      const tNorm = normCn(t)
      const hit = !wantRaw
        || t === wantRaw                          // ① 精确
        || (!!wantNorm && tNorm === wantNorm)     // ② 归一化后全等
        || (!!wantNorm && wantNorm.length >= 4 && (tNorm.includes(wantNorm) || wantNorm.includes(tNorm))) // ③ 互相包含
      if (!hit) return { out: null, actual: t }
      return { out: html.slice(0, start) + String(to) + html.slice(start + raw.length) }
    }
    count++
  }
  return { out: null, actual: '（这一段里没有第 ' + idx + ' 个文字节点）' }
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

/** 对**一份** HTML 套用全部 edits，返回新 html 与统计（不改文件，纯函数） */
function applyEdits(html: string, edits: Edit[]): { html: string; changed: number; skipped: Skip[] } {
  const ranges = sectionRanges(html)
  const skipped: Skip[] = []

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
      const r = replaceNthText(inner, Number(e.idx) || 0, String(e.from || ''), to)
      if (r.out === null) {
        // ★VF_EDIT_MATCH_V2：把"面板上的"和"页面上实际的"都带回去，下次一眼看出差在哪
        skipped.push({
          seg, idx: e.idx,
          reason: '对不上（面板：' + String(e.from || '').slice(0, 16) + ' ｜ 页面：' + String(r.actual || '').slice(0, 16) + '）',
        })
        continue
      }
      inner = r.out
      changed++
    }
    html = html.slice(0, range[0]) + inner + html.slice(range[1])
  }
  return { html, changed, skipped }
}

export async function POST(request: NextRequest) {
  const auth = getAuthFromHeaders(request)
  if (!auth) return NextResponse.json({ success: false, message: '请先登录' }, { status: 401 })
  const uid = String((auth as any)?.userId ?? (auth as any)?.uid ?? '')

  let body: any = {}
  try { body = await request.json() } catch { /* ignore */ }

  const name = String(body?.name || '').trim()
  const singleName = String(body?.singleName || '').trim()
  const edits: Edit[] = Array.isArray(body?.edits) ? body.edits : []
  const okName = (n: string) => !!n && /^[\w.-]+\.html?$/i.test(n)
  if (!okName(name) && !okName(singleName)) {
    return NextResponse.json({ success: false, message: '缺少产物名（gen_xxx.html）' }, { status: 400 })
  }
  if (!edits.length) return NextResponse.json({ success: false, message: '没有要改的内容' }, { status: 400 })
  if (edits.length > 200) return NextResponse.json({ success: false, message: '一次改太多了（>200 处）' }, { status: 400 })

  // ★VF_EDIT_BOTH_FILES_V1：两份都改（分享版 + 出片版），去重、保持顺序
  const targets = [...new Set([name, singleName].filter(okName))]
  const { getObject, putObject } = await import('@/lib/oss')

  const files: Array<{ name: string; changed: number; skipped: Skip[]; err?: string }> = []
  let anyChanged = 0
  let firstSkip = ''

  try {
    for (const t of targets) {
      const key = 'storage/' + uid + '/' + t
      try {
        const buf = await getObject(key)
        const src = String(buf.toString('utf8') || '')
        if (!/<section\b[^>]*\bsec\b/i.test(src)) {
          files.push({ name: t, changed: 0, skipped: [], err: '这不是日报页产物（没找到 .sec 分段）' })
          continue
        }
        // 先备份一份（用户改错了还能找回原始）
        try { await putObject('dfcache/' + uid + '/html-bak/' + Date.now() + '-' + t, buf, 'text/html') } catch { /* 备份失败不阻断 */ }

        const r = applyEdits(src, edits)
        if (r.changed > 0) {
          await putObject(key, Buffer.from(r.html, 'utf8'), 'text/html')
          anyChanged += r.changed
        }
        if (!firstSkip && r.skipped.length) firstSkip = r.skipped[0].reason
        files.push({ name: t, changed: r.changed, skipped: r.skipped })
      } catch (e: any) {
        files.push({ name: t, changed: 0, skipped: [], err: String(e?.message || e).slice(0, 120) })
      }
    }

    if (!anyChanged) {
      const why = files.map((f) => f.err).filter(Boolean)[0] || firstSkip || '未知'
      /* ★VF_EDIT_LOG_FAIL_V1（2026-10-25 用户实测：接口返回 422，但 `pm2 logs` 里**一行都没有**
         ⇒ 只能看到前端那句"一处都没改成"，具体哪段哪句对不上完全查不到）。
         现口径：**失败也打日志**，带上每份文件的结果 + 前 3 条跳过原因（含面板文本 vs 页面文本）。 */
      try {
        const detail = files.map((f) => f.name + '：改' + f.changed
          + (f.err ? ' 错=' + f.err : '')
          + (f.skipped.length ? ' 跳过=' + f.skipped.slice(0, 3).map((s) => '段' + s.seg + '/第' + s.idx + ' ' + s.reason).join(' ; ') : '')
        ).join(' ｜ ')
        console.error('[改画面文字·失败] ' + detail.slice(0, 900))
      } catch { /* ignore */ }
      return NextResponse.json({ success: false, message: '一处都没改成：' + why, data: { files } }, { status: 422 })
    }

    try {
      console.log('[改画面文字] ' + files.map((f) => f.name + ' 改 ' + f.changed + ' 处' + (f.err ? '（错：' + f.err + '）' : '')).join(' ｜ '))
    } catch { /* ignore */ }

    const skipped = files.find((f) => f.skipped.length)?.skipped || []
    return NextResponse.json({
      success: true,
      data: { changed: anyChanged, skipped, name, files },
    })
  } catch (e: any) {
    return NextResponse.json({ success: false, message: '改失败：' + String(e?.message || e).slice(0, 160) }, { status: 500 })
  }
}
