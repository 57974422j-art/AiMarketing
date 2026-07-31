import { NextRequest, NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client'
import { getAuthFromHeaders } from '@/lib/api-auth'
import { getObject } from '@/lib/oss'

const prisma = new PrismaClient()

// 通过 Q1 shell 执行命令
async function q1Exec(port: number, cmd: string) {
  const r = await fetch(`http://127.0.0.1:${port}/modifydev?cmd=6&cmdline=${encodeURIComponent(cmd)}`, { signal: AbortSignal.timeout(60000) })
  return r.json()
}

export async function POST(request: NextRequest) {
  try {
    const auth = getAuthFromHeaders(request)
    if (!auth) return NextResponse.json({ success: false, message: '未登录' }, { status: 401 })

    const { fileName } = await request.json()
    if (!fileName) return NextResponse.json({ success: false, message: '缺少文件名' }, { status: 400 })

    // 从 OSS 读取文件
    const key = `storage/${auth.userId}/${fileName}`
    let buf: Buffer
    try {
      buf = await getObject(key)
    } catch {
      return NextResponse.json({ success: false, message: '文件不存在' }, { status: 404 })
    }

    let devices: { id: number; name: string | null; apiPort: number | null }[] = []

    if (auth.role === 'admin' || auth.role === 'editor') {
      const allDevs = await prisma.device.findMany({
        where: { apiPort: { not: null } },
        select: { id: true, name: true, apiPort: true },
      })
      devices = allDevs as typeof devices
    } else {
      const accts = await prisma.account.findMany({
        where: { userId: auth.userId, deviceId: { not: null } },
        include: { device: { select: { id: true, name: true, apiPort: true } } },
      })
      devices = accts.map(a => a.device!).filter(Boolean) as typeof devices
    }

    if (!devices.length) return NextResponse.json({ success: false, message: '没有可用的设备' }, { status: 400 })

    const details: { name: string; ok: boolean }[] = []

    for (const device of devices) {
      if (!device?.apiPort) continue
      const port = device.apiPort
      const dest = `/sdcard/DCIM/${fileName}`

      try {
        const form = new FormData()
        form.append('file', new Blob([buf], { type: 'video/mp4' }), fileName)
        const upRes = await fetch(`http://127.0.0.1:${port}/upload`, {
          method: 'POST', body: form, signal: AbortSignal.timeout(120000),
        })
        if (!upRes.ok) { details.push({ name: device.name || `#${device.id}`, ok: false }); continue }
        // 复制到 DCIM
        await fetch(`http://127.0.0.1:${port}/modifydev?cmd=6&cmdline=${encodeURIComponent(`cp "/sdcard/upload/${fileName}" "${dest}"`)}`, { signal: AbortSignal.timeout(10000) })
        // 通知系统扫描
        await fetch(`http://127.0.0.1:${port}/modifydev?cmd=6&cmdline=${encodeURIComponent(`am broadcast -a android.intent.action.MEDIA_SCANNER_SCAN_FILE -d "file://${dest}"`)}`, { signal: AbortSignal.timeout(5000) }).catch(() => {})
        details.push({ name: device.name || `#${device.id}`, ok: true })
      } catch (e) {
        console.error(`[push-to-phone] device ${device.id}:`, (e as any).message?.slice(0, 100))
        details.push({ name: device.name || `#${device.id}`, ok: false })
      }
    }

    const pushed = details.filter(d => d.ok).length
    const summary = details.map(d => `${d.name}:${d.ok ? '✓' : '✗'}`).join(' ')
    return NextResponse.json({ success: true, message: `已推送 ${pushed}/${devices.length} 台设备 (${summary})`, data: { details } })
  } catch (e: any) {
    return NextResponse.json({ success: false, message: e.message })
  } finally { await prisma.$disconnect() }
}

// 强制动态渲染：API 路由依赖 request.headers / 鉴权，禁止 Next 在构建期静态预渲染
export const dynamic = 'force-dynamic'
