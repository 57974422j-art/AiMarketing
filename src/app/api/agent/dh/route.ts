import { NextRequest, NextResponse } from 'next/server'
import { getAuthFromHeaders } from '@/lib/api-auth'
import { dhAdvance } from '@/lib/agent/dh'

/**
 * ★VF_DH_V1（2026-10-27）数字人口播线的**只读进度接口**（前端卡片轮询用）
 *
 *   GET /api/agent/dh?taskId=<wan2.2-s2v 的 task_id>
 *     => { ok, state:'running'|'done'|'failed', waited?, videoUrl?, repoName?, message? }
 *
 * 为什么单独一个接口（而不是再进一次 chat）：数字人出片 2~6 分钟，卡片要**每 6 秒问一次**，
 *   走 chat 每次都要过一遍标准模式闸门 + 会话落库，既慢又会把对话刷满。
 *
 * 安全：
 *   · 必须登录（`getAuthFromHeaders`，与其它 agent 接口同款）；
 *   · **只读自己的草稿**（`dh_draft_<uid>`），taskId 必须与草稿里的一致 ⇒ 拿别人的任务号读不到任何东西；
 *   · 成功时顺手入库（幂等：已入库就不再重复下载/上传），扣点也在这里做一次（`charged` 标记）。
 */
export const maxDuration = 60
export const dynamic = 'force-dynamic'

/** 进程内复用一个 PrismaClient（轮询每 6 秒一次，别每次都新建连接池） */
let _prisma: any = null
async function getPrisma() {
  if (!_prisma) {
    const { PrismaClient } = await import('@prisma/client')
    _prisma = new PrismaClient()
  }
  return _prisma
}

export async function GET(request: NextRequest) {
  const auth = getAuthFromHeaders(request)
  if (!auth) return NextResponse.json({ ok: false, message: '请先登录' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const taskId = String(searchParams.get('taskId') || '').trim()
  if (!taskId) return NextResponse.json({ ok: false, message: '缺少 taskId' }, { status: 400 })

  try {
    // 动态 import：这条线只在真的有人做数字人时才把 prisma/oss/ai 那一串拖进来
    // （本仓库没有 `@/lib/prisma` 单例 —— 全仓都是 `new PrismaClient()`，这里进程内复用一份）
    const prisma = await getPrisma()
    const r = await dhAdvance({ prisma, uid: auth.userId }, taskId)
    return NextResponse.json(r)
  } catch (e: any) {
    return NextResponse.json({ ok: false, message: '查进度失败：' + String(e?.message || e).slice(0, 160) }, { status: 200 })
  }
}
