import { NextRequest, NextResponse } from 'next/server'
import path from 'path'
import fs from 'fs'
import { PrismaClient } from '@prisma/client'
import { getAuthFromHeaders } from '@/lib/api-auth'

const prisma = new PrismaClient()
const STORAGE_BASE = '/root/AiMarketing/public/storage'

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

    const src = path.join(STORAGE_BASE, String(auth.userId), fileName)
    if (!fs.existsSync(src)) return NextResponse.json({ success: false, message: '文件不存在' }, { status: 404 })

    const accounts = await prisma.account.findMany({
      where: { userId: auth.userId, deviceId: { not: null } },
      include: { device: true },
    })
    if (!accounts.length) return NextResponse.json({ success: false, message: '未绑定设备' }, { status: 400 })

    const buf = fs.readFileSync(src)
    let pushed = 0

    for (const acct of accounts) {
      const device = acct.device
      if (!device?.apiPort) continue
      const port = device.apiPort
      const dest = `/sdcard/DCIM/${fileName}`

      try {
        // 方案1：用 Q1 upload API 上传（已知能通），然后复制到 DCIM
        const form = new FormData()
        form.append('file', new Blob([buf], { type: 'video/mp4' }), fileName)
        const upRes = await fetch(`http://127.0.0.1:${port}/upload`, {
          method: 'POST', body: form, signal: AbortSignal.timeout(120000),
        })
        if (!upRes.ok) continue
        const upText = await upRes.text()

        // 上传成功后，查找文件位置（魔云腾通常存到 /sdcard/ 下）
        const findCmd = `find /sdcard -maxdepth 3 -name "${fileName}" 2>/dev/null | head -1`
        const findR = await q1Exec(port, findCmd)
        let srcPath = findR.ret?.trim()

        if (srcPath) {
          // 找到文件，复制到 DCIM
          await q1Exec(port, `cp "${srcPath}" "${dest}"`)
        } else {
          // 找不到，用 upload API 的 response 做参考
          // 尝试直接写到 DCIM：先用 base64 管道写入
          const b64 = buf.toString('base64')
          // 分批写入
          await q1Exec(port, `echo -n > "${dest}"`)
          for (let i = 0; i < b64.length; i += 8000) {
            const chunk = b64.substring(i, i + 8000)
            const safe = chunk.replace(/'/g, "'\\''")
            await q1Exec(port, `echo -n '${safe}' >> "${dest}.b64"`)
            await new Promise(r => setTimeout(r, 100))
          }
          await q1Exec(port, `base64 -d "${dest}.b64" > "${dest}" && rm "${dest}.b64"`)
        }

        // 通知系统扫描
        await q1Exec(port, `am broadcast -a android.intent.action.MEDIA_SCANNER_SCAN_FILE -d "file://${dest}"`)
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
