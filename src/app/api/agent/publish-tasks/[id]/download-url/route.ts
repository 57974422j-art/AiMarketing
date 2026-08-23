import { NextRequest, NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client'
import { signedUrl } from '@/lib/oss'
import { getAuthFromHeaders } from '@/lib/api-auth'

const prisma = new PrismaClient()

// POST /api/agent/publish-tasks/[id]/download-url —— 客户端执行发布前取视频签名下载 URL（与 done 同鉴权）
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = getAuthFromHeaders(req)
  if (!auth) return NextResponse.json({ success: false, message: '未认证' }, { status: 401 })
  const taskId = parseInt(params.id || '0')
  if (!taskId) return NextResponse.json({ success: false, message: '缺少任务 ID' }, { status: 400 })
  try {
    const task: any = await prisma.agentPublishTask.findFirst({ where: { id: taskId, userId: auth.userId } })
    if (!task) return NextResponse.json({ success: false, message: '任务不存在' }, { status: 404 })
    if (!task.videoName) return NextResponse.json({ success: false, message: '任务无视频（videoName 为空）' }, { status: 400 })
    // 仓库视频 key：storage/{userId}/{videoName}
    const key = `storage/${task.userId}/${task.videoName}`
    const url = await signedUrl(key, 3600)
    return NextResponse.json({ success: true, url, videoName: task.videoName })
  } catch (e: any) {
    return NextResponse.json({ success: false, message: '生成下载链接失败：' + (e?.message || e) }, { status: 500 })
  } finally { await prisma.$disconnect() }
}
