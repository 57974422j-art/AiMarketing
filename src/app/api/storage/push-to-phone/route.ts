import { NextRequest, NextResponse } from 'next/server'
import path from 'path'
import fs from 'fs'
import { PrismaClient } from '@prisma/client'
import { getAuthFromHeaders } from '@/lib/api-auth'

const prisma = new PrismaClient()
const STORAGE_BASE = '/root/AiMarketing/public/storage'

export async function POST(request: NextRequest) {
  try {
    const auth = getAuthFromHeaders(request)
    if (!auth) return NextResponse.json({ success: false, message: '未登录' }, { status: 401 })

    const { fileName } = await request.json()
    if (!fileName) return NextResponse.json({ success: false, message: '缺少文件名' }, { status: 400 })

    // 读取用户仓库的视频文件
    const src = path.join(STORAGE_BASE, String(auth.userId), fileName)
    if (!fs.existsSync(src)) return NextResponse.json({ success: false, message: '文件不存在' }, { status: 404 })

    const buf = fs.readFileSync(src)

    // 查找该用户绑定的设备
    const accounts = await prisma.account.findMany({
      where: { userId: auth.userId, deviceId: { not: null } },
      include: { device: true },
    })

    if (!accounts.length) return NextResponse.json({ success: false, message: '未绑定设备' }, { status: 400 })

    let pushed = 0
    for (const acct of accounts) {
      const device = acct.device
      if (!device?.apiPort) continue
      try {
        const form = new FormData()
        form.append('file', new Blob([buf], { type: 'video/mp4' }), fileName)
        const upRes = await fetch(`http://127.0.0.1:${device.apiPort}/upload`, {
          method: 'POST', body: form, signal: AbortSignal.timeout(120000),
        })
        if (!upRes.ok) continue
        // 通知系统扫描，让视频出现在相册
        await fetch(`http://127.0.0.1:${device.apiPort}/modifydev?cmd=6&cmdline=${encodeURIComponent('am broadcast -a android.intent.action.MEDIA_SCANNER_SCAN_FILE -d file:///sdcard/Download/' + fileName)}`, { signal: AbortSignal.timeout(5000) }).catch(() => {})
        pushed++
      } catch (e) {
        console.error(`[push-to-phone] device ${device.id}:`, (e as any).message?.slice(0, 100))
      }
    }

    return NextResponse.json({ success: true, message: `已推送 ${pushed}/${accounts.length} 台设备` })
  } catch (e: any) {
    return NextResponse.json({ success: false, message: e.message })
  } finally { await prisma.$disconnect() }
}
