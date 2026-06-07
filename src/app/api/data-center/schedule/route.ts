import { NextRequest, NextResponse } from 'next/server'
import { getAuthFromHeaders } from '@/lib/api-auth'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

/**
 * 定时采集调度 API
 *
 * GET    /api/data-center/schedule              → 获取所有调度任务列表
 * POST   /api/data-center/schedule              → 创建/更新调度规则
 * DELETE /api/data-center/schedule?id=xx        → 停止/删除调度
 * POST   /api/data-center/schedule/run-now      → 立即执行一次调度任务
 */

interface ScheduleConfig {
  taskId: number
  cronExpr?: string        // 自定义 cron 表达式（高级）
  interval?: string        // hourly / daily / weekly / custom
  hour?: number            // 执行小时 (0-23)
  minute?: number          // 执行分钟 (0-59)
  weekdays?: number[]      // 周几执行 [1-7]
  enabled: boolean         // 是否启用
  lastRunAt?: string       // 上次运行时间
  nextRunAt?: string       // 下次预计运行时间
  runCount: number         // 已执行次数
}

// 内存中维护调度状态（生产环境应持久化到 DB 或 Redis）
const activeSchedules = new Map<number, ScheduleConfig>()
let schedulerInterval: NodeJS.Timeout | null = null

/**
 * 启动调度器（懒加载，首次调用时启动）
 */
function ensureSchedulerRunning() {
  if (schedulerInterval) return

  // 每分钟检查一次是否有需要触发的调度
  schedulerInterval = setInterval(async () => {
    const now = new Date()
    const currentHour = now.getHours()
    const currentMinute = now.getMinutes()
    const currentDay = now.getDay() || 7 // 周日=7

    for (const [taskId, config] of activeSchedules.entries()) {
      if (!config.enabled) continue

      let shouldRun = false

      switch (config.interval) {
        case 'hourly':
          shouldRun = config.minute === undefined || config.minute === currentMinute
          break
        case 'daily':
          shouldRun = config.hour === currentHour && (config.minute ?? 0) === currentMinute
          break
        case 'weekly':
          shouldRun =
            (config.weekdays?.includes(currentDay) ?? false) &&
            config.hour === currentHour &&
            (config.minute ?? 0) === currentMinute
          break
      }

      if (shouldRun && config.taskId) {
        executeScheduledTask(taskId)
      }
    }
  }, 60000) // 每分钟检查
}

async function executeScheduledTask(taskId: number) {
  const config = activeSchedules.get(taskId)
  if (!config) return

  try {
    console.log(`[定时采集] 开始执行任务 #${taskId}`)
    config.lastRunAt = new Date().toISOString()
    config.runCount++

    // 调用内部采集接口
    const res = await fetch(`${process.env.BASE_URL || 'http://localhost:3000'}/api/lead-collector`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'run-task', data: { taskId } }),
    })
    const result = await res.json()
    console.log(`[定时采集] 任务 #${taskId} 完成:`, result.success ? '成功' : result.message)
  } catch (error) {
    console.error(`[定时采集] 任务 #${taskId} 执行失败:`, error)
  }
}

export async function GET(request: NextRequest) {
  const auth = getAuthFromHeaders(request)
  if (!auth) return NextResponse.json({ success: false, message: '请先登录' }, { status: 401 })

  try {
    // 返回用户的采集任务及其调度状态
    const tasks = await prisma.collectionTask.findMany({
      where: { ownerId: auth.userId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        platform: true,
        keywords: true,
        schedule: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        crawledVideos: { select: { id: true } },
        leads: { select: { id: true } },
      },
    })

    // 合并内存中的调度状态
    const tasksWithSchedule = tasks.map(t => {
      const sched = activeSchedules.get(t.id)
      return {
        ...t,
        videoCount: t.crawledVideos.length,
        leadCount: t.leads.length,
        crawledVideos: undefined,
        leads: undefined,
        scheduleDetail: sched || {
          enabled: false,
          runCount: 0,
          lastRunAt: null,
          nextRunAt: null,
        },
      }
    })

    return NextResponse.json({
      success: true,
      data: {
        tasks: tasksWithSchedule,
        activeCount: Array.from(activeSchedules.values()).filter(s => s.enabled).length,
      },
    })
  } catch (error: any) {
    console.error('[调度API] 查询失败:', error)
    return NextResponse.json({ success: false, message: error.message }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const auth = getAuthFromHeaders(request)
  if (!auth) return NextResponse.json({ success: false, message: '请先登录' }, { status: 401 })

  try {
    const body = await request.json()
    const { action, ...data } = body

    if (action === 'run-now') {
      // 立即执行一次
      const { taskId } = data
      if (!taskId) return NextResponse.json({ success: false, message: '缺少 taskId' }, { status: 400 })

      // 验证权限
      const task = await prisma.collectionTask.findFirst({
        where: { id: taskId, ownerId: auth.userId },
      })
      if (!task) return NextResponse.json({ success: false, message: '任务不存在或无权限' }, { status: 404 })

      // 异步触发执行（不等待完成）
      executeScheduledTask(taskId)

      return NextResponse.json({
        success: true,
        message: `已触发任务 "${task.name}" 立即执行，请稍后在仪表盘查看结果`,
      })
    }

    // 设置/更新调度规则
    const {
      taskId,
      interval = 'daily',
      hour = 8,
      minute = 0,
      weekdays = [1, 2, 3, 4, 5],
      enabled = true,
    } = data

    if (!taskId) return NextResponse.json({ success: false, message: '缺少 taskId' }, { status: 400 })

    // 验证任务归属
    const task = await prisma.collectionTask.findFirst({
      where: { id: taskId, ownerId: auth.userId },
    })
    if (!task) return NextResponse.json({ success: false, message: '任务不存在或无权限' }, { status: 404 })

    // 更新任务的 schedule 字段
    await prisma.collectionTask.update({
      where: { id: taskId },
      data: { schedule: enabled ? interval : 'manual' },
    })

    // 注册到内存调度器
    const config: ScheduleConfig = {
      taskId,
      interval,
      hour,
      minute,
      weekdays,
      enabled,
      runCount: activeSchedules.get(taskId)?.runCount || 0,
      lastRunAt: activeSchedules.get(taskId)?.lastRunAt,
    }
    activeSchedules.set(taskId, config)

    if (enabled) {
      ensureSchedulerRunning()
    } else {
      activeSchedules.delete(taskId)
    }

    // 计算下次执行时间
    let nextRunDesc = ''
    if (enabled) {
      switch (interval) {
        case 'hourly': nextRunDesc = `每小时的第 ${minute} 分`; break
        case 'daily': nextRunDesc = `每天 ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`; break
        case 'weekly':
          const dayNames = ['一', '二', '三', '四', '五', '六', '日']
          nextRunDesc = `每周${weekdays.map(d => dayNames[d - 1]).join('/')} ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
          break
      }
    }

    return NextResponse.json({
      success: true,
      data: config,
      message: enabled
        ? `已设置定时采集：${nextRunDesc} 自动执行`
        : `已停止任务 "${task.name}" 的定时采集`,
    })
  } catch (error: any) {
    console.error('[调度API] 操作失败:', error)
    return NextResponse.json({ success: false, message: error.message }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  const auth = getAuthFromHeaders(request)
  if (!auth) return NextResponse.json({ success: false, message: '请先登录' }, { status: 401 })

  try {
    const { searchParams } = new URL(request.url)
    const taskId = parseInt(searchParams.get('id') || '0')

    if (!taskId) return NextResponse.json({ success: false, message: '缺少 taskId' }, { status: 400 })

    activeSchedules.delete(taskId)

    // 重置为手动模式
    await prisma.collectionTask.update({
      where: { id: taskId },
      data: { schedule: 'manual' },
    })

    return NextResponse.json({ success: true, message: '已停止该定时调度' })
  } catch (error: any) {
    console.error('[调度API] 删除失败:', error)
    return NextResponse.json({ success: false, message: error.message }, { status: 500 })
  }
}
