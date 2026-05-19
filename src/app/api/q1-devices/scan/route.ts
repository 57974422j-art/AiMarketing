/**
 * ================================================================
 * Q1 设备一键扫描 API
 * ================================================================
 * 
 * POST /api/q1-devices/scan
 *   body: { ownerId?: number }
 *   - 扫描 127.0.0.1:30001~31101 共 12 个容器的状态
 *   - 自动创建/更新 Device 记录
 *   - 自动创建/更新 DevicePool
 * 
 * 端口公式（非桥接模式）：
 *   API 端口 = 30000 + (instance - 1) × 100 + 1
 *   RPA 端口 = 30000 + (instance - 1) × 100 + 2
 *   ADB 端口 = 30000 + (instance - 1) × 100 + 0
 * ================================================================
 */

import { NextRequest, NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client'
import { getAuthFromHeaders } from '@/lib/api-auth'

const prisma = new PrismaClient()
const MAX_INSTANCES = 12
const Q1_IP = '127.0.0.1'
const TIMEOUT_MS = 3000

interface ContainerInfo {
  instance: number
  name: string
  apiPort: number
  rpaPort: number
  adbPort: number
  hostIp: string
}

/**
 * 探测单个容器是否在线，返回容器信息
 */
async function probeContainer(instance: number): Promise<ContainerInfo | null> {
  const apiPort = 30000 + (instance - 1) * 100 + 1
  const rpaPort = 30000 + (instance - 1) * 100 + 2
  const adbPort = 30000 + (instance - 1) * 100 + 0

  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

    const res = await fetch(`http://${Q1_IP}:${apiPort}/info`, {
      signal: controller.signal,
    })
    clearTimeout(timer)

    if (!res.ok) return null

    const json = await res.json()
    if (json.code !== 200) return null

    return {
      instance,
      name: json.data?.name || `容器-${instance}`,
      apiPort,
      rpaPort,
      adbPort,
      hostIp: json.data?.hostIp || '-',
    }
  } catch {
    return null
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = getAuthFromHeaders(request)
    if (!auth) return NextResponse.json({ success: false, message: '未认证' }, { status: 401 })
    if (auth.role === 'end-user') return NextResponse.json({ success: false, message: '无权操作' }, { status: 403 })

    const body = await request.json().catch(() => ({}))
    // 扫描到的设备分配给谁：前端传 ownerId 或当前用户
    const ownerId = body.ownerId || auth.userId

    // ================================================================
    // 1. 并发探测所有容器
    // ================================================================
    const probes = Array.from({ length: MAX_INSTANCES }, (_, i) => probeContainer(i + 1))
    const results = await Promise.all(probes)
    const onlineContainers = results.filter((c): c is ContainerInfo => c !== null)

    // ================================================================
    // 2. 确保 DevicePool 存在
    // ================================================================
    let pool = await prisma.devicePool.findFirst({ where: { ownerId } })
    if (!pool) {
      pool = await prisma.devicePool.create({
        data: {
          ownerId,
          totalWindows: MAX_INSTANCES,
          usedWindows: 0,
          dailyQuota: 12,
        },
      })
    }

    // ================================================================
    // 3. 创建/更新 Device 记录
    // ================================================================
    const created: any[] = []
    const updated: any[] = []

    for (const container of onlineContainers) {
      const deviceName = container.name || `Q1-容器${container.instance}`

      // 查找是否已存在（按 apiPort 唯一标识）
      const existing = await prisma.device.findFirst({
        where: { apiPort: container.apiPort, ownerId },
      })

      if (existing) {
        // 更新在线状态
        await prisma.device.update({
          where: { id: existing.id },
          data: {
            status: 'online',
            lastHeartbeat: new Date(),
            ip: Q1_IP,
            rpaPort: container.rpaPort,
            adbPort: container.adbPort,
            name: deviceName,
            type: 'q1',
          },
        })
        updated.push({ id: existing.id, name: deviceName, apiPort: container.apiPort })
      } else {
        // 新建
        const device = await prisma.device.create({
          data: {
            name: deviceName,
            status: 'online',
            ownerId,
            ip: Q1_IP,
            apiPort: container.apiPort,
            rpaPort: container.rpaPort,
            adbPort: container.adbPort,
            type: 'q1',
            lastHeartbeat: new Date(),
            phyDeviceName: 'Q1-物理机',
          },
        })
        created.push({ id: device.id, name: deviceName, apiPort: container.apiPort })
      }
    }

    // ================================================================
    // 4. 将离线容器标为 offline
    // ================================================================
    const onlinePorts = onlineContainers.map(c => c.apiPort)
    if (onlinePorts.length > 0) {
      await prisma.device.updateMany({
        where: { ownerId, type: 'q1', apiPort: { notIn: onlinePorts } },
        data: { status: 'offline' },
      })
    }

    // ================================================================
    // 5. 更新 DevicePool 配额
    // ================================================================
    const totalQ1Devices = await prisma.device.count({ where: { ownerId, type: 'q1' } })
    await prisma.devicePool.update({
      where: { id: pool.id },
      data: {
        totalWindows: Math.max(pool.totalWindows, totalQ1Devices),
        usedWindows: onlineContainers.length,
      },
    })

    return NextResponse.json({
      success: true,
      data: {
        scanned: MAX_INSTANCES,
        online: onlineContainers.length,
        created: created.length,
        updated: updated.length,
        containers: onlineContainers,
        pool: {
          id: pool.id,
          totalWindows: Math.max(pool.totalWindows, totalQ1Devices),
          usedWindows: onlineContainers.length,
          dailyQuota: pool.dailyQuota,
        },
      },
    })
  } catch (error) {
    console.error('Q1 扫描错误:', error)
    return NextResponse.json({ success: false, message: '扫描失败' }, { status: 500 })
  } finally {
    await prisma.$disconnect()
  }
}
