import { NextRequest, NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client'
import { generateVideo, queryVideoTask } from '@/lib/ai-providers'
import { getAuthFromHeaders } from '@/lib/api-auth'

const prisma = new PrismaClient()

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

// 逐镜生成（后台异步）：每镜 t2v 独立生成 + 5s 轮询 + 单镜失败不影响其它
export async function runShots(taskId: number, shots: any[], ratio: string) {
  for (let i = 0; i < shots.length; i++) {
    const shot = shots[i]
    if (shot.status === 'done' || shot.status === 'generating') continue
    shot.status = 'generating'
    shot.error = null
    try {
      await prisma.storyboardTask.update({ where: { id: taskId }, data: { status: 'generating', shots: JSON.stringify(shots) } })
    } catch {}
    let videoUrl = ''
    try {
      const r = await generateVideo(shot.prompt || shot.desc, Math.min(5, Math.max(2, shot.duration || 5)), '720P', ratio)
      if (r?.videoUrl) videoUrl = r.videoUrl
      else if (r?.taskId) {
        for (let n = 0; n < 48; n++) { // 最长 4 分钟轮询
          await sleep(5000)
          const q = await queryVideoTask(r.taskId)
          if (q?.videoUrl) { videoUrl = q.videoUrl; break }
          if (q?.status === 'failed' || q?.status === 'cancel') { shot.error = '模型端失败'; break }
        }
        if (!videoUrl && !shot.error) shot.error = '生成超时（4分钟）'
      } else shot.error = '任务创建失败'
    } catch (e: any) { shot.error = (e?.message || '异常').substring(0, 200) }
    if (videoUrl) { shot.status = 'done'; shot.videoUrl = videoUrl }
    else shot.status = 'failed'
    shots[i] = shot
    const doneShots = shots.filter((s: any) => s.status === 'done').length
    const allDone = doneShots === shots.length
    try {
      await prisma.storyboardTask.update({
        where: { id: taskId },
        data: { shots: JSON.stringify(shots), doneShots, status: allDone ? 'done' : 'generating' },
      })
    } catch {}
  }
}

// POST 创建分镜任务 + 后台逐镜生成
export async function POST(req: NextRequest) {
  const auth = getAuthFromHeaders(req)
  if (!auth?.userId) return NextResponse.json({ success: false, message: '未登录' }, { status: 401 })
  let body: any = {}
  try { body = await req.json() } catch {}
  const topic = (body.topic || '').trim()
  const shots = Array.isArray(body.shots) ? body.shots : []
  if (!topic || shots.length === 0) {
    return NextResponse.json({ success: false, message: '缺少 topic 或 shots（分镜数组）' }, { status: 400 })
  }
  const ratio = body.ratio || '16:9'
  const duration = parseInt(body.duration) || shots.reduce((s: number, x: any) => s + (parseInt(x.duration) || 5), 0)
  const costPoints = Math.ceil(duration * 100)
  const normalized = shots.map((s: any, i: number) => ({
    shot: s.shot ?? (i + 1), desc: s.desc || '', prompt: s.prompt || '', duration: Math.min(5, Math.max(2, parseInt(s.duration) || 5)),
    camera: s.camera || '', status: 'pending', videoUrl: null, error: null,
  }))
  const task = await prisma.storyboardTask.create({
    data: {
      userId: auth.userId, title: (body.title || topic).substring(0, 80), topic,
      ratio, style: body.style || null, duration,
      shots: JSON.stringify(normalized), status: 'pending', totalShots: normalized.length, costPoints,
    },
  })
  // 后台执行（不阻塞响应）
  runShots(task.id, normalized, ratio).catch(e => console.error('[Storyboard]', e))
  return NextResponse.json({ success: true, data: { id: task.id, totalShots: normalized.length, costPoints } })
}

// GET 查进度
export async function GET(req: NextRequest) {
  const auth = getAuthFromHeaders(req)
  if (!auth?.userId) return NextResponse.json({ success: false, message: '未登录' }, { status: 401 })
  const id = parseInt(new URL(req.url).searchParams.get('id') || '0')
  if (!id) return NextResponse.json({ success: false, message: '缺少 id' }, { status: 400 })
  const task = await prisma.storyboardTask.findFirst({ where: { id, userId: auth.userId } })
  if (!task) return NextResponse.json({ success: false, message: '任务不存在' }, { status: 404 })
  const shots = JSON.parse(task.shots || '[]')
  return NextResponse.json({ success: true, data: {
    id: task.id, title: task.title, status: task.status, doneShots: task.doneShots, totalShots: task.totalShots,
    costPoints: task.costPoints, videoUrl: task.videoUrl, error: task.error, shots,
    createdAt: task.createdAt,
  } })
}
