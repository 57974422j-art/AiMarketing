/**
 * ================================================================
 * Q1 容器窗口扫描 API
 * ================================================================
 * 
 * POST /api/q1-devices/scan
 *   body: { phyDeviceId: number }
 *   - 扫描指定 Q1 物理机的所有容器
 *   - 自动创建/更新 Device 记录并挂到该 Q1 下
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
const TIMEOUT_MS = 3000

interface ProbeResult {
  instance: number; name: string; apiPort: number; rpaPort: number; adbPort: number
}

async function probe(ip: string, instance: number): Promise<ProbeResult | null> {
  const port = 30000 + (instance - 1) * 100 + 1
  try {
    const c = new AbortController()
    const t = setTimeout(() => c.abort(), TIMEOUT_MS)
    const res = await fetch(`http://${ip}:${port}/info`, { signal: c.signal })
    clearTimeout(t)
    if (!res.ok) return null
    const json = await res.json()
    if (json.code !== 200) return null
    return {
      instance, name: json.data?.name || `容器-${instance}`,
      apiPort: port, rpaPort: port + 1, adbPort: port - 1,
    }
  } catch { return null }
}

export async function POST(request: NextRequest) {
  try {
    const auth = getAuthFromHeaders(request)
    if (!auth || auth.role !== 'admin') return NextResponse.json({ success: false, message: '仅管理员可操作' }, { status: 403 })
    const body = await request.json()
    if (!body.phyDeviceId) return NextResponse.json({ success: false, message: '缺少 phyDeviceId' }, { status: 400 })

    // 获取 Q1 物理机信息
    const phy = await prisma.phyDevice.findUnique({ where: { id: body.phyDeviceId } })
    if (!phy) return NextResponse.json({ success: false, message: 'Q1 设备不存在' }, { status: 404 })

    // 通过 FRP 隧道扫描（服务器 127.0.0.1 映射到 Q1 内网）
    const targetIP = '127.0.0.1'

    // 1. 并发探测所有容器
    const probes = Array.from({ length: MAX_INSTANCES }, (_, i) => probe(targetIP, i + 1))
    const results = (await Promise.all(probes)).filter(Boolean) as ProbeResult[]

    // 2. 创建/更新 Device 记录
    const created: any[] = []
    const updated: any[] = []
    for (const c of results) {
      const existing = await prisma.device.findFirst({
        where: { phyDeviceId: phy.id, apiPort: c.apiPort },
      })
      if (existing) {
        await prisma.device.update({
          where: { id: existing.id },
          data: { status: 'online', lastHeartbeat: new Date(), ip: targetIP, rpaPort: c.rpaPort, adbPort: c.adbPort, type: 'q1', phyDeviceName: phy.name },
        })
        updated.push(existing.id)
      } else {
        const d = await prisma.device.create({
          data: {
            name: c.name, status: 'online', ownerId: auth.userId, ip: targetIP,
            apiPort: c.apiPort, rpaPort: c.rpaPort, adbPort: c.adbPort,
            type: 'q1', phyDeviceName: phy.name, phyDeviceId: phy.id,
          },
        })
        created.push(d.id)
      }
    }

    // 3. 不在线的标 offline
    const onlinePorts = results.map(c => c.apiPort)
    if (onlinePorts.length) {
      await prisma.device.updateMany({
        where: { phyDeviceId: phy.id, apiPort: { notIn: onlinePorts } },
        data: { status: 'offline' },
      })
    }

    // 4. 更新 Q1 在线状态
    await prisma.phyDevice.update({ where: { id: phy.id }, data: { status: 'online', updatedAt: new Date() } })

    return NextResponse.json({
      success: true,
      data: { scanned: MAX_INSTANCES, online: results.length, created: created.length, updated: updated.length, containers: results },
    })
  } catch (error) { console.error('扫描错误:', error); return NextResponse.json({ success: false, message: '扫描失败' }, { status: 500 })
  } finally { await prisma.$disconnect() }
}
