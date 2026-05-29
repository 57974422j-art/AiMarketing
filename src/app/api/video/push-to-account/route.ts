import { NextRequest, NextResponse } from 'next/server'
import path from 'path'
import fs from 'fs'
import { PrismaClient } from '@prisma/client'
import { getAuthFromHeaders } from '@/lib/api-auth'

const prisma = new PrismaClient()
const GENERATED = '/root/AiMarketing/public/generated'

export async function POST(request: NextRequest) {
  try {
    const auth = getAuthFromHeaders(request)
    if (!auth) return NextResponse.json({ success: false, message: '未登录' }, { status: 401 })
    if (auth.role === 'end-user') return NextResponse.json({ success: false, message: '无权操作' }, { status: 403 })

    const { taskId, endUserId, remark } = await request.json()
    if (!taskId || !endUserId) return NextResponse.json({ success: false, message: '缺少参数' }, { status: 400 })

    const videoFile = taskId.includes('.') ? taskId : taskId + '.mp4'
    const src = path.join(GENERATED, videoFile)
    if (!fs.existsSync(src)) return NextResponse.json({ success: false, message: '视频文件不存在' }, { status: 404 })

    if (auth.role === 'editor') {
      const client = await prisma.user.findFirst({
        where: { id: parseInt(endUserId), parentId: auth.userId },
      })
      if (!client) return NextResponse.json({ success: false, message: '非你的终端客户' }, { status: 403 })
    }

    const accounts = await prisma.account.findMany({
      where: { userId: parseInt(endUserId), deviceId: { not: null } },
      include: { device: true },
    })
    if (!accounts.length) return NextResponse.json({ success: false, message: '该客户没有绑定设备' }, { status: 400 })

    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '')
    const label = (remark || 'video').replace(/[^a-zA-Z0-9\u4e00-\u9fa5_-]/g, '_').slice(0, 20)
    let success = 0

    for (let i = 0; i < accounts.length; i++) {
      const device = accounts[i].device
      if (!device || !device.apiPort) continue

      const fileName = `${dateStr}_${label}_${String(i + 1).padStart(2, '0')}.mp4`
      try {
        const buf = fs.readFileSync(src)
        const port = device.apiPort
        const uploadUrl = `http://127.0.0.1:${port}/upload`
        const form = new FormData()
        form.append('file', new Blob([buf], { type: 'video/mp4' }), fileName)
        const upRes = await fetch(uploadUrl, { method: 'POST', body: form, signal: AbortSignal.timeout(120000) })
        if (!upRes.ok) continue

        // 上传到 /sdcard/upload/ 后，复制到 DCIM 并刷新相册
        const shellBase = `http://127.0.0.1:${port}/modifydev?cmd=6&cmdline=`
        await fetch(`${shellBase}${encodeURIComponent(`cp "/sdcard/upload/${fileName}" "/sdcard/DCIM/${fileName}"`)}`, { signal: AbortSignal.timeout(10000) }).catch(() => {})
        await fetch(`${shellBase}${encodeURIComponent(`am broadcast -a android.intent.action.MEDIA_SCANNER_SCAN_FILE -d "file:///sdcard/DCIM/${fileName}"`)}`, { signal: AbortSignal.timeout(5000) }).catch(() => {})
        success++
      } catch (e) {
        console.error(`[push] device ${device.id}:`, (e as any).message?.slice(0, 100))
      }
    }

    return NextResponse.json({ success: true, data: { pushed: success, total: accounts.length } })
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message })
  } finally { await prisma.$disconnect() }
}
