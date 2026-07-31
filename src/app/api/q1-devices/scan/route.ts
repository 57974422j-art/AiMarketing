/**
 * ================================================================
 * Q1 容器窗口扫描 API（v2 - 使用 Docker 管理接口）
 * ================================================================
 * 
 * POST /api/q1-devices/scan
 *   body: { phyDeviceId: number }
 *   - 调 Q1 Docker 接口 /android 获取所有容器
 *   - 自动从 portBindings 解析 API/RPA/ADB 端口
 *   - 创建/更新 Device 记录并挂到该 Q1 下
 * 
 * 端口映射规则（Q1 非桥接模式）：
 *   容器内 9082 → API 端口（安卓管理）
 *   容器内 9083 → RPA 端口
 *   容器内 5555 → ADB 端口
 * ================================================================
 */

import { NextRequest, NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client'
import { getAuthFromHeaders } from '@/lib/api-auth'

const prisma = new PrismaClient()

export async function POST(request: NextRequest) {
  try {
    const auth = getAuthFromHeaders(request)
    if (!auth || auth.role === 'end-user') return NextResponse.json({ success: false, message: '无权操作' }, { status: 403 })

    const body = await request.json()
    if (!body.phyDeviceId) return NextResponse.json({ success: false, message: '缺少 phyDeviceId' }, { status: 400 })

    // 获取 Q1 物理机信息
    const phy = await prisma.phyDevice.findUnique({ where: { id: body.phyDeviceId } })
    if (!phy) return NextResponse.json({ success: false, message: 'Q1 设备不存在' }, { status: 404 })

    // 通过 FRP 隧道调 Docker 接口（服务器 28000 → Q1 8000）
    const dockerPort = 28000
    const dockerUrl = `http://127.0.0.1:${dockerPort}/android`

    const authHeader = Buffer.from('admin:123456').toString('base64')

    const res = await fetch(dockerUrl, {
      headers: { Authorization: `Basic ${authHeader}` },
      signal: AbortSignal.timeout(10000),
    })

    if (!res.ok) return NextResponse.json({ success: false, message: `Docker 接口响应 ${res.status}` }, { status: 502 })

    const json = await res.json()
    if (json.code !== 0) return NextResponse.json({ success: false, message: json.message || 'Docker 接口异常' }, { status: 502 })

    const containers: any[] = json.data?.list || []

    // 解析端口绑定
    const created: number[] = []
    const updated: number[] = []

    for (const c of containers) {
      const bindings = c.portBindings || {}
      const apiPort = parseInt(bindings['9082/tcp']?.[0]?.HostPort)
      const rpaPort = parseInt(bindings['9083/tcp']?.[0]?.HostPort)
      const adbPort = parseInt(bindings['5555/tcp']?.[0]?.HostPort)

      if (!apiPort) continue

      // 查找是否已存在
      const existing = await prisma.device.findFirst({
        where: { phyDeviceId: phy.id, apiPort },
      })

      const deviceData = {
        name: c.name || `容器-${c.indexNum}`,
        status: c.status === 'running' ? 'online' : 'offline',
        ip: '127.0.0.1',
        apiPort,
        rpaPort: rpaPort || null,
        adbPort: adbPort || null,
        type: 'q1' as const,
        phyDeviceName: phy.name,
        lastHeartbeat: new Date(),
      }

      if (existing) {
        await prisma.device.update({ where: { id: existing.id }, data: deviceData })
        updated.push(existing.id)
      } else {
        const d = await prisma.device.create({
          data: { ...deviceData, ownerId: auth.userId, phyDeviceId: phy.id },
        })
        created.push(d.id)
      }
    }

    // 不在容器列表中的设备标 offline
    const onlinePorts = containers
      .map((c: any) => parseInt(c.portBindings?.['9082/tcp']?.[0]?.HostPort))
      .filter(Boolean)
    if (onlinePorts.length) {
      await prisma.device.updateMany({
        where: { phyDeviceId: phy.id, apiPort: { notIn: onlinePorts } },
        data: { status: 'offline' },
      })
    }

    // 更新 Q1 在线状态
    await prisma.phyDevice.update({
      where: { id: phy.id },
      data: { status: containers.some((c: any) => c.status === 'running') ? 'online' : 'offline' },
    })

    return NextResponse.json({
      success: true,
      data: {
        total: containers.length,
        online: containers.filter((c: any) => c.status === 'running').length,
        onlinePorts,
        created: created.length,
        updated: updated.length,
      },
    })
  } catch (error) {
    console.error('扫描错误:', error)
    const msg = error instanceof Error ? error.message : '扫描失败'
    return NextResponse.json({ success: false, message: msg }, { status: 500 })
  } finally { await prisma.$disconnect() }
}

// 强制动态渲染：API 路由依赖 request.headers / 鉴权，禁止 Next 在构建期静态预渲染
export const dynamic = 'force-dynamic'
