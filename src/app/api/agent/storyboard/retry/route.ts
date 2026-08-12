import { NextRequest, NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client'
import { getAuthFromHeaders } from '@/lib/api-auth'

const prisma = new PrismaClient()

// 重试单个分镜：重置该镜状态，重跑 runShots 逻辑（跳过 done 的镜）
export async function POST(req: NextRequest) {
  const auth = getAuthFromHeaders(req)
  if (!auth?.userId) return NextResponse.json({ success: false, message: '未登录' }, { status: 401 })
  let body: any = {}
  try { body = await req.json() } catch {}
  const id = parseInt(body.id || '0')
  const shotNo = parseInt(body.shot || '0')
  if (!id || !shotNo) return NextResponse.json({ success: false, message: '缺少 id 或 shot' }, { status: 400 })
  const task = await prisma.storyboardTask.findFirst({ where: { id, userId: auth.userId } })
  if (!task) return NextResponse.json({ success: false, message: '任务不存在' }, { status: 404 })
  // 2026-08-12 #10: 任务正在生成时拒绝重复重试（防并发双跑双倍成本）
  if (task.status === 'generating') return NextResponse.json({ success: false, message: '任务正在生成中，请稍后再重试' }, { status: 400 })
  const shots = JSON.parse(task.shots || '[]')
  const shot = shots.find((s: any) => s.shot === shotNo)
  if (!shot) return NextResponse.json({ success: false, message: '分镜不存在' }, { status: 404 })
  shot.status = 'pending'; shot.error = null; shot.videoUrl = null
  await prisma.storyboardTask.update({ where: { id }, data: { shots: JSON.stringify(shots) } })
  const { runShots } = await import('../route')
  runShots(id, shots, task.ratio).catch(e => console.error('[Storyboard retry]', e))
  return NextResponse.json({ success: true, message: '重试已启动' })
}
