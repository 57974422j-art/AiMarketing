import { NextRequest, NextResponse } from 'next/server'
import path from 'path'
import fs from 'fs'
import { PrismaClient } from '@prisma/client'
import { getAuthFromHeaders } from '@/lib/api-auth'

const prisma = new PrismaClient()
const GENERATED = '/root/AiMarketing/public/generated'
const STORAGE_BASE = '/root/AiMarketing/public/storage'

export async function POST(request: NextRequest) {
  try {
    const auth = getAuthFromHeaders(request)
    if (!auth) return NextResponse.json({ success: false, message: '未登录' }, { status: 401 })
    if (auth.role === 'end-user') return NextResponse.json({ success: false, message: '无权操作' }, { status: 403 })

    const { taskId, endUserId, remark } = await request.json()
    if (!taskId || !endUserId) return NextResponse.json({ success: false, message: '缺少参数' }, { status: 400 })

    const videoFile = taskId.includes('.') ? taskId : taskId + '.mp4'
    // 优先查 generated/，再查 storage/{userId}/
    let src = path.join(GENERATED, videoFile)
    if (!fs.existsSync(src)) src = path.join(STORAGE_BASE, String(auth.userId), videoFile)
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

    const now = new Date()
    const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '')
    const timeStr = String(now.getHours()).padStart(2,'0') + String(now.getMinutes()).padStart(2,'0')
    const label = (remark || 'video').replace(/[^a-zA-Z0-9\u4e00-\u9fa5_-]/g, '_').slice(0, 20)
    let success = 0

    for (let i = 0; i < accounts.length; i++) {
      const device = accounts[i].device
      if (!device || !device.apiPort) continue

      const fileName = `${dateStr}_${timeStr}_${label}_${String(i + 1).padStart(2, '0')}.mp4`
      try {
        const buf = fs.readFileSync(src)
        const port = device.apiPort

        // 直接 base64 管道写入 DCIM（Q1 v0.8.0 shell 无法读取 /sdcard/upload/）
        const b64 = buf.toString('base64')
        const dest = `/sdcard/DCIM/${fileName}`
        const tmp = `/sdcard/DCIM/_b64_${Date.now()}.tmp`
        const shell = (cmd: string) => fetch(`http://127.0.0.1:${port}/modifydev?cmd=6&cmdline=${encodeURIComponent(cmd)}`, { signal: AbortSignal.timeout(60000) }).catch(() => {})

        // 分块写入（android shell 命令行有限长，每段最大 8000 字符）
        for (let j = 0; j < b64.length; j += 8000) {
          const chunk = b64.substring(j, j + 8000)
          await shell(`printf '%s' '${chunk}' >> ${tmp}`)
          await new Promise(r => setTimeout(r, 100))
        }
        // 解码到目标文件
        await shell(`base64 -d ${tmp} > ${dest} && rm ${tmp}`)
        // 刷新相册
        await shell(`am broadcast -a android.intent.action.MEDIA_SCANNER_SCAN_FILE -d file://${dest}`)
        success++
      } catch (e) {
        console.error(`[push] device ${device.id}:`, (e as any).message?.slice(0, 100))
      }
    }

    return NextResponse.json({ success: true, data: { pushed: success, total: accounts.length } })
  } catch (e: any) {
    return NextResponse.json({ success: false, message: e.message }, { status: 500 })
  } finally { await prisma.$disconnect() }
}

// 强制动态渲染：API 路由依赖 request.headers / 鉴权，禁止 Next 在构建期静态预渲染
export const dynamic = 'force-dynamic'
