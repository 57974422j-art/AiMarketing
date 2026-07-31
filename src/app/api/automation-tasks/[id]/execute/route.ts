import { NextRequest, NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client'
import { getAuthFromHeaders } from '@/lib/api-auth'
import { findByText, findAndClick, tapAndInput, scrollUp, tap, swipeToFind, sleep, goBack } from '@/lib/uiautomator-driver'

const prisma = new PrismaClient()

/**
 * POST /api/automation-tasks/{id}/execute
 * 通过 uiautomator 驱动执行任务（替代旧版 device-engine）
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let taskId: number | null = null
  try {
    const { id } = await params
    taskId = parseInt(id, 10)
    const auth = getAuthFromHeaders(request)
    if (!auth) return NextResponse.json({ success: false, message: '未认证' }, { status: 401 })
    if (auth.role === 'end-user') return NextResponse.json({ success: false, message: '无权操作' }, { status: 403 })

    const task = await prisma.automationTask.findUnique({ where: { id: taskId } })
    if (!task) return NextResponse.json({ success: false, message: '任务不存在' }, { status: 404 })
    if (task.status === '执行中') return NextResponse.json({ success: false, message: '任务正在执行中' }, { status: 400 })

    await prisma.automationTask.update({ where: { id: task.id }, data: { status: '执行中' } })

    const taskParams = JSON.parse(task.params || '{}')
    const device = task.assignedDeviceId
      ? await prisma.device.findUnique({ where: { id: task.assignedDeviceId } })
      : null
    const port = device?.apiPort
    if (!port) throw new Error('设备未配置 API 端口')

    let result: any

    switch (task.type) {
      case '抖音点赞':
      case '点赞': {
        await new Promise(r => setTimeout(r, 20000 + Math.random() * 10000))
        result = await findAndClick(port, '赞')
        break
      }

      case '抖音评论':
      case '评论': {
        const text = taskParams.comment || taskParams.text || '不错'
        const cr = await findAndClick(port, '评论')
        if (cr.success) { await new Promise(r => setTimeout(r, 2000)); await tapAndInput(port, '消息', text); await new Promise(r => setTimeout(r, 1000)); result = await findAndClick(port, '发送') }
        else result = cr
        break
      }

      case '抖音转发':
      case '转发': {
        await new Promise(r => setTimeout(r, 2000))
        result = await findAndClick(port, '分享')
        break
      }

      case '抖音发布':
      case '发抖音视频':
      case '发布视频': {
        result = { success: false, message: '发布功能已迁移至 RPA AI 模式' }
        break
      }

      case '抖音关注':
      case '互关':
      case '关注': {
        await new Promise(r => setTimeout(r, 3000))
        result = await findAndClick(port, '关注')
        break
      }

      default:
        throw new Error(`不支持的任务类型: ${task.type}`)
    }

    await prisma.taskLog.create({
      data: { taskId: task.id, action: task.type, result: JSON.stringify(result), errorMessage: result.success ? null : result.message },
    })
    await prisma.automationTask.update({ where: { id: task.id }, data: { status: result.success ? '已完成' : '失败' } })

    return NextResponse.json({ success: true, message: result.message || '完成', data: result })

  } catch (execError: any) {
    const errorMsg = execError.message || '执行异常'
    if (taskId) {
      await prisma.taskLog.create({ data: { taskId, action: 'error', result: 'error', errorMessage: errorMsg } }).catch(() => {})
      await prisma.automationTask.update({ where: { id: taskId }, data: { status: '失败' } }).catch(() => {})
    }
    return NextResponse.json({ success: false, message: errorMsg }, { status: 500 })
  } finally { await prisma.$disconnect() }
}

async function execShell(port: number, cmd: string) {
  const r = await fetch(`http://localhost:${port}/modifydev?cmd=6&cmdline=${encodeURIComponent(cmd)}`, { signal: AbortSignal.timeout(60000) })
  return r.json()
}



// 强制动态渲染：API 路由依赖 request.headers / 鉴权，禁止 Next 在构建期静态预渲染
export const dynamic = 'force-dynamic'
