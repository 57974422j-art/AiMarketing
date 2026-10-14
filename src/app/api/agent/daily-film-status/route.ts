import { NextRequest, NextResponse } from 'next/server'
import { readDailyFilmTask, findRunningDailyFilm } from '@/lib/agent/daily-film'

// ★VF_DAILYFILM_V2（2026-10-14 用户定案「先做1」）：**日报出片**的进度查询（前端每 6 秒轮一次。
//   同源范式见 `/api/agent/make-video-status`（成片线）；本接口只读本项目自己的 `df<ts>.json`，
//   与成片线的 `vf<ts>.json` 互不干扰。
//   任务文件：`<LOCAL_STORAGE>/<userId>/video-factory/df<ts>.json`
//   用法：GET /api/agent/daily-film-status?userId=<uid>[&taskId=<id>]
//     · 带 taskId ⇒ 查那一个；不带 ⇒ 返回该用户**正在跑**的那个（没有就 task:null）
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const userId = request.nextUrl.searchParams.get('userId') || ''
    const taskId = request.nextUrl.searchParams.get('taskId') || ''
    if (!userId) return NextResponse.json({ success: false, message: '缺少 userId' }, { status: 400 })

    const t = taskId ? readDailyFilmTask(userId, taskId) : findRunningDailyFilm(userId)
    if (!t) return NextResponse.json({ success: true, task: null })

    // 耗时：已完成用 finishedAt 收口（否则前端会看到"跑了 N 小时"还在涨 —— 成片线踩过这个）
    const t0 = t.startedAt ? new Date(t.startedAt).getTime() : 0
    const t1 = t.finishedAt ? new Date(t.finishedAt).getTime() : Date.now()
    return NextResponse.json({
      success: true,
      task: {
        id: t.id,
        status: t.status,
        elapsedSec: t0 ? Math.round((t1 - t0) / 1000) : 0,
        htmlName: t.htmlName || '',
        voiced: !!t.voiced,            // ★VF_DAILYVOICE_V2：这一单是不是配音版（前端完成卡据此换文案）
        repoName: t.repoName || '',
        url: t.url || '',
        tail: (t.tail || []).slice(-30),
        error: t.error || '',
      },
    })
  } catch (e: any) {
    return NextResponse.json({ success: false, message: String(e?.message || e).slice(0, 200) }, { status: 500 })
  }
}
