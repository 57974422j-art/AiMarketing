/**
 * ★★★ 2026-11-06 用户：
 *   「在预览页上加一个截图划范围功能，确认了直接加入会话框」
 *
 * 用途：用户在预览里拖一个框 ⇒ 截「那一帧的那一块」⇒ 直接进对话附件。
 *
 * 为什么放在后端截（而不是前端 canvas）：
 *   · iframe 里的内容有 --fit 缩放、base64 图，前端截容易跨域/错位
 *   · 后端 playwright 截的是**画布真实像素**，和自审同口径，不会错位
 *
 * 代价：每次要点一次浏览器（3~5 秒），所以前端要显示"截图…"状态
 */
import { NextRequest, NextResponse } from 'next/server'
import fs from 'node:fs'
import path from 'node:path'
import { getAuthFromHeaders, getAuthFromCookie } from '@/lib/api-auth'

export async function POST(req: NextRequest) {
  const auth = getAuthFromHeaders(req) || getAuthFromCookie(req)
  if (!auth?.userId) {
    return NextResponse.json({ ok: false, error: '请先登录' }, { status: 401 })
  }

  try {
    const body = await req.json().catch(() => ({}))
    const name = String(body?.name || '')
    const repoId = String(body?.repoId || auth.userId || '1')
    const t = Math.max(0, Number(body?.t) || 0)
    const rect = body?.rect || {}

    /* 只允许仓库命名（和 /api/lab2/file 同一套口径） */
    if (
      !/^gen_\d{8}_\d{6}(_\d+)?\.html$/.test(name)
      && !/^gen_\d{8}_\d{3}\.html$/.test(name)
      && !/^lab2_[\d]+\.html$/.test(name)
    ) {
      return NextResponse.json({ ok: false, error: '文件名不合法' }, { status: 400 })
    }
    if (!/^\d+$/.test(repoId)) {
      return NextResponse.json({ ok: false, error: 'repoId 不合法' }, { status: 400 })
    }

    let p = path.join(process.cwd(), 'storage', repoId, name)
    if (!fs.existsSync(p)) p = path.join(process.cwd(), 'temp', '_lab2', 'out', name)
    if (!fs.existsSync(p)) {
      return NextResponse.json({ ok: false, error: '找不到这份成片' }, { status: 404 })
    }
    const html = fs.readFileSync(p, 'utf8')

    /* 画布尺寸从 HTML 里读（720×1280 或 1280×720），读不到按竖屏 */
    let W = 720
    let H = 1280
    const m = html.match(/#stage\s*\{[^}]*?width:\s*(\d+)px[^}]*?height:\s*(\d+)px/)
    if (m) { W = Number(m[1]) || W; H = Number(m[2]) || H }

    const r = {
      x: Number(rect?.x) || 0,
      y: Number(rect?.y) || 0,
      w: Number(rect?.w) || W,
      h: Number(rect?.h) || H,
    }
    /* 至少 40×40（太小的框没意义） */
    if (r.w < 40 || r.h < 40) {
      return NextResponse.json({ ok: false, error: '框太小了（至少 40×40）' }, { status: 400 })
    }

    const { shootRegion } = await import('@/lib/lab2/shot')
    const shot = await shootRegion(html, W, H, t, r)
    if (!shot.ok || !shot.image) {
      return NextResponse.json({ ok: false, error: '截图失败：' + (shot.error || '未知') }, { status: 500 })
    }

    console.log('[lab2-shot-region] ✅ ' + name + ' @' + t + 's  ' + W + '×' + H
      + '  区域 ' + r.x + ',' + r.y + ' ' + r.w + '×' + r.h)

    return NextResponse.json({
      ok: true,
      image: shot.image,
      canvas: { W, H },
      atSeconds: t,
    })
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: String((e as Error)?.message || e) },
      { status: 500 },
    )
  }
}
