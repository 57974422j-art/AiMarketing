/**
 * LAB2 · 段落增删（2026-11-04）
 *
 * 用户：「生成 30 段不合适我命令全部切掉」+「对，先把勾选删除 + 自动重排做出来」
 *
 * 为什么必须由代码做，而不是让它改：
 *   删掉第 5 段后，第 6 段还写着 data-start="20"
 *        ⇒ 时间轴中间空 5 秒 ⇒ **播到这里是黑屏**
 *        ⇒ 必须重排：第6段改成 15、第7段改成 20…
 *   这是纯加法 ⇒ 代码 100% 正确，AI 算错概率很高（实测过）
 *
 * 只做一件事：删段 + 重排 data-start + 存新文件，**完全不经过 AI**
 */

import { NextRequest, NextResponse } from 'next/server'
import fs from 'node:fs'
import path from 'node:path'
import { getAuthFromHeaders, getAuthFromCookie } from '@/lib/api-auth'
import { getOrCreateSession, appendMessage } from '@/lib/lab2/session'

export const dynamic = 'force-dynamic'

function repoDir(uid: string) {
  return path.join(process.cwd(), 'storage', uid)
}

/** 把 HTML 拆成 [头, 段1..N, 尾] */
function splitSections(html: string): { head: string; secs: string[]; tail: string } {
  const re = /<section\b[^>]*class="[^"]*\bsec\b[^"]*"[^>]*>[\s\S]*?<\/section>/gi
  const secs: string[] = []
  let last = 0
  let m: RegExpExecArray | null
  let firstStart = -1
  while ((m = re.exec(html)) !== null) {
    if (firstStart < 0) firstStart = m.index
    secs.push(m[0])
    last = m.index + m[0].length
  }
  if (firstStart < 0) return { head: html, secs: [], tail: '' }
  return { head: html.slice(0, firstStart), secs, tail: html.slice(last) }
}

/** 重排：按顺序累加 data-duration，写回 data-start */
function relayout(secs: string[]): string[] {
  let acc = 0
  return secs.map((s) => {
    const dm = s.match(/data-duration\s*=\s*["']?([\d.]+)/)
    const dur = dm ? parseFloat(dm[1]) : 3
    let out = s.replace(/data-start\s*=\s*(["']?)[\d.]+(\1)/, 'data-start="' + (Math.round(acc * 100) / 100) + '"')
    if (!/data-start\s*=/.test(out)) {
      out = out.replace(/<section\b/, '<section data-start="' + (Math.round(acc * 100) / 100) + '"')
    }
    acc += dur
    return out
  })
}

function writeHtml(uid: string, html: string): string {
  const d = new Date()
  const ymd = d.toISOString().slice(0, 10).replace(/-/g, '')
  const hms = String(d.getHours()).padStart(2, '0')
    + String(d.getMinutes()).padStart(2, '0')
    + String(d.getSeconds()).padStart(2, '0')
  const dir = repoDir(uid)
  fs.mkdirSync(dir, { recursive: true })
  let name = 'gen_' + ymd + '_' + hms + '.html'
  let n = 1
  while (fs.existsSync(path.join(dir, name)) && n < 100) {
    name = 'gen_' + ymd + '_' + hms + '_' + n + '.html'
    n++
  }
  fs.writeFileSync(path.join(dir, name), html, 'utf8')
  return name
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const authUser = getAuthFromHeaders(req) || getAuthFromCookie(req)
    const userId = String(authUser?.userId || body?.userId || '1')

    const sid = String(body?.sessionId || 'main')
    const s = getOrCreateSession(userId, sid)
    const name0 = String(body?.name || s.currentHtmlName || '')
    if (!name0) return NextResponse.json({ ok: false, error: '还没有成片' }, { status: 400 })

    const p = path.join(repoDir(userId), name0)
    if (!fs.existsSync(p)) return NextResponse.json({ ok: false, error: '文件不存在' }, { status: 404 })
    const html0 = fs.readFileSync(p, 'utf8')

    const { head, secs, tail } = splitSections(html0)
    if (!secs.length) return NextResponse.json({ ok: false, error: '这份 HTML 里没有 <section class="sec">' }, { status: 400 })

    /* 要删的段（1 基序号） */
    const del: number[] = Array.isArray(body?.delete)
      ? (body.delete as unknown[]).map((v) => Number(v)).filter((v) => v >= 1 && v <= secs.length)
      : []
    if (!del.length) return NextResponse.json({ ok: false, error: '没有指定要删的段' }, { status: 400 })

    const left = secs.filter((_s, i) => !del.includes(i + 1))
    if (!left.length) return NextResponse.json({ ok: false, error: '不能把最后一段也删了' }, { status: 400 })

    /* 重排时间轴 */
    const laid = relayout(left)

    /* 总时长（给播放脚本用：window.__lab2Total 或 TOTAL 常量） */
    let total = 0
    laid.forEach((x) => {
      const m = x.match(/data-start\s*=\s*["']?([\d.]+)/)
      const d = x.match(/data-duration\s*=\s*["']?([\d.]+)/)
      if (m && d) total = Math.max(total, parseFloat(m[1]) + parseFloat(d[1]))
    })
    total = Math.round(total * 10) / 10

    let html = head + laid.join('\n') + tail
    /* 总时长同步（两种常见写法都替换） */
    html = html
      .replace(/var\s+TOTAL\s*=\s*[\d.]+/, 'var TOTAL = ' + total)
      .replace(/window\.__lab2Total\s*=\s*[\d.]+/, 'window.__lab2Total = ' + total)

    const name = writeHtml(userId, html)

    /* 同步 OSS */
    let ossMsg = ''
    try {
      const { putObject } = await import('@/lib/oss')
      await putObject('storage/' + userId + '/' + name, Buffer.from(html, 'utf8'), 'text/html')
      ossMsg = '（已同步 OSS）'
    } catch { ossMsg = '（OSS 未同步）' }

    appendMessage(userId, sid, {
      role: 'assistant',
      text: '删掉第 ' + del.join('、') + ' 段，剩下 ' + laid.length + ' 段，时间轴已重排（总长 ' + total + 's）',
      htmlName: name,
      ts: new Date().toISOString(),
    })

    /* 返回新的段表（前端播放器要用） */
    const segments: { start: number; duration: number }[] = []
    laid.forEach((x) => {
      const m = x.match(/data-start\s*=\s*["']?([\d.]+)/)
      const d = x.match(/data-duration\s*=\s*["']?([\d.]+)/)
      if (m && d) segments.push({ start: parseFloat(m[1]), duration: parseFloat(d[1]) })
    })

    return NextResponse.json({
      ok: true,
      name,
      url: '/api/lab2/file?name=' + encodeURIComponent(name) + '&repoId=' + encodeURIComponent(userId),
      savedTo: 'storage/' + userId + '/' + name + ossMsg,
      deleted: del,
      totalSeconds: total,
      segments,
    })
  } catch (e) {
    return NextResponse.json({ ok: false, error: String((e as Error)?.message || e) }, { status: 500 })
  }
}
