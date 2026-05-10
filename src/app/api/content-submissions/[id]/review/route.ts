import { NextRequest, NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client'
import { getAuthFromHeaders } from '@/lib/api-auth'

const prisma = new PrismaClient()

/**
 * PUT /api/content-submissions/{id}/review
 * 审核素材（仅 admin / editor 可操作）
 *   status = 已通过 → 自动创建 AutomationTask（type=发布视频）
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const auth = getAuthFromHeaders(request)
    if (!auth) {
      return NextResponse.json({ success: false, message: '未认证' }, { status: 401 })
    }
    if (auth.role === 'end-user') {
      return NextResponse.json({ success: false, message: '无权审核' }, { status: 403 })
    }

    const body = await request.json()
    const { status } = body // 已通过 / 已拒绝

    if (!['已通过', '已拒绝'].includes(status)) {
      return NextResponse.json({ success: false, message: '无效的审核状态' }, { status: 400 })
    }

    const submission = await prisma.contentSubmission.findUnique({
      where: { id: parseInt(id, 10) },
    })

    if (!submission) {
      return NextResponse.json({ success: false, message: '素材不存在' }, { status: 404 })
    }

    if (submission.status !== '待审核') {
      return NextResponse.json({ success: false, message: '该素材已被审核' }, { status: 400 })
    }

    // 更新审核状态
    await prisma.contentSubmission.update({
      where: { id: submission.id },
      data: {
        status,
        reviewerId: auth.userId,
      },
    })

    // 审核通过 → 自动创建发布视频任务
    if (status === '已通过') {
      // 查找可用的设备（优先选择有对应平台账号的）
      const account = await prisma.socialAccount.findFirst({
        where: {
          platform: submission.targetPlatform,
          userId: { in: [auth.userId, submission.submitterId] },
          status: '已绑定',
        },
        include: { device: true },
      })

      await prisma.automationTask.create({
        data: {
          type: '发布视频',
          status: '等待中',
          params: JSON.stringify({
            videoUrl: submission.videoUrl,
            caption: submission.caption,
            platform: submission.targetPlatform,
            contentSubmissionId: submission.id,
          }),
          assignedDeviceId: account?.deviceId || null,
          createdBy: auth.userId,
        },
      })

      // 更新素材状态为已发布
      await prisma.contentSubmission.update({
        where: { id: submission.id },
        data: { status: '已发布' },
      })
    }

    return NextResponse.json({
      success: true,
      message: status === '已通过' ? '审核通过，已创建发布任务' : '已拒绝',
    })
  } catch (error) {
    console.error('审核失败:', error)
    return NextResponse.json({ success: false, message: '服务器错误' }, { status: 500 })
  } finally {
    await prisma.$disconnect()
  }
}
