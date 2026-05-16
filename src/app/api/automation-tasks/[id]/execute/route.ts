import { NextRequest, NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client'
import { getAuthFromHeaders } from '@/lib/api-auth'
import type { DeviceActionResult } from '@/lib/device-engine'
import {
  executeFollowEachOther,
  executeLike,
  executeComment,
  executeRepost,
  publishVideo,
  publishTikTokVideo,
} from '@/lib/device-engine'

const prisma = new PrismaClient()

/**
 * POST /api/automation-tasks/{id}/execute
 * 手动触发任务执行
 */
export async function POST(
  request: NextRequest,
  { params: routeParams }: { params: Promise<{ id: string }> }
) {
  let taskId: number | null = null
  try {
    const { id } = await routeParams
    taskId = parseInt(id, 10)
    const auth = getAuthFromHeaders(request)
    if (!auth) {
      return NextResponse.json({ success: false, message: '未认证' }, { status: 401 })
    }
    if (auth.role === 'end-user') {
      return NextResponse.json({ success: false, message: '无权操作' }, { status: 403 })
    }

    const task = await prisma.automationTask.findUnique({
      where: { id: taskId },
    })

    if (!task) {
      return NextResponse.json({ success: false, message: '任务不存在' }, { status: 404 })
    }

    if (task.status === '执行中') {
      return NextResponse.json({ success: false, message: '任务正在执行中' }, { status: 400 })
    }

    // 标记为执行中
    await prisma.automationTask.update({
      where: { id: task.id },
      data: { status: '执行中' },
    })

    const deviceId = task.assignedDeviceId?.toString() || 'DEV-MOCK'
    const taskParams = JSON.parse(task.params || '{}')

    try {
      let result: DeviceActionResult

      switch (task.type) {
        case '互关':
          result = await executeFollowEachOther(deviceId, taskParams.targetAccounts || [])
          break
        case '点赞':
          result = await executeLike(deviceId, taskParams.targetUrls || [])
          break
        case '评论':
          result = await executeComment(deviceId, taskParams.targetUrl || '', taskParams.comment || '')
          break
        case '转发':
          result = await executeRepost(deviceId, taskParams.targetUrl || '')
          break
        case '发布视频':
          result = await publishVideo(deviceId, taskParams.videoUrl || '', taskParams.caption || '', taskParams.platform || '')
          break
        case '发抖音视频':
          result = await publishTikTokVideo(deviceId, taskParams.videoUrl || '', taskParams.caption || '')
          break
        default:
          throw new Error(`不支持的任务类型: ${task.type}`)
      }

      // 记录任务日志
      await prisma.taskLog.create({
        data: {
          taskId: task.id,
          action: task.type,
          result: JSON.stringify(result),
          errorMessage: result.success ? null : result.message,
        },
      })

      // 更新任务状态
      await prisma.automationTask.update({
        where: { id: task.id },
        data: { status: result.success ? '已完成' : '失败' },
      })

      return NextResponse.json({ success: true, message: result.message, data: result })
    } catch (execError) {
      // 执行失败
      const errorMsg = execError instanceof Error ? execError.message : '执行异常'

      await prisma.taskLog.create({
        data: {
          taskId: task.id,
          action: task.type,
          result: 'error',
          errorMessage: errorMsg,
        },
      })

      await prisma.automationTask.update({
        where: { id: task.id },
        data: { status: '失败' },
      })

      return NextResponse.json({ success: false, message: errorMsg }, { status: 500 })
    }
  } catch (error) {
    console.error('执行任务失败:', error)
    // 内层 catch 自身失败时，确保任务状态不被卡在"执行中"
    try {
      if (taskId) {
        await prisma.automationTask.update({
          where: { id: taskId },
          data: { status: '失败' },
        })
      }
    } catch { /* 忽略二次异常 */ }
    return NextResponse.json({ success: false, message: '服务器错误' }, { status: 500 })
  } finally {
    await prisma.$disconnect()
  }
}
