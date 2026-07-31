import { NextRequest, NextResponse } from 'next/server'
import path from 'path'
import fs from 'fs'
import { PrismaClient } from '@prisma/client'
import { getAuthFromHeaders } from '@/lib/api-auth'

const prisma = new PrismaClient()
const STORAGE_BASE = '/root/AiMarketing/public/storage'

export async function GET(request: NextRequest, { params }: { params: Promise<{ userId: string }> }) {
  try {
    const auth = getAuthFromHeaders(request)
    if (!auth) return NextResponse.json({ success: false, message: '未登录' }, { status: 401 })
    if (auth.role === 'end-user') return NextResponse.json({ success: false, message: '无权访问' }, { status: 403 })

    const { userId } = await params
    const targetId = parseInt(userId)
    if (!targetId) return NextResponse.json({ success: false, message: '无效用户ID' }, { status: 400 })

    // editor 只能看自己下级
    if (auth.role === 'editor') {
      const child = await prisma.user.findFirst({
        where: { id: targetId, parentId: auth.userId },
      })
      if (!child) return NextResponse.json({ success: false, message: '非你的下级客户' }, { status: 403 })
    }

    const dir = path.join(STORAGE_BASE, String(targetId))
    if (!fs.existsSync(dir)) {
      return NextResponse.json({ success: true, data: { files: [], used: 0, total: 500 * 1024 * 1024 } })
    }

    const files = fs.readdirSync(dir)
      .filter(f => fs.statSync(path.join(dir, f)).isFile())
      .map(f => {
        const fp = path.join(dir, f)
        const isVideo = f.endsWith('.mp4') || f.endsWith('.mov') || f.endsWith('.avi')
        const thumbPath = path.join(dir, '.thumbs', f.replace(/\.(mp4|mov|avi)$/, '.jpg'))
        const hasThumb = fs.existsSync(thumbPath)
        return {
          name: f,
          size: fs.statSync(fp).size,
          mtime: fs.statSync(fp).mtime.toISOString(),
          isVideo,
          thumbUrl: hasThumb ? `/storage/${targetId}/.thumbs/${f.replace(/\.(mp4|mov|avi)$/, '.jpg')}` : null,
        }
      })
      .sort((a, b) => b.mtime.localeCompare(a.mtime))

    let used = 0
    for (const f of files) used += f.size

    return NextResponse.json({ success: true, data: { files, used, total: 500 * 1024 * 1024 } })
  } catch (e: any) {
    return NextResponse.json({ success: false, message: e.message })
  } finally { await prisma.$disconnect() }
}

// 强制动态渲染：API 路由依赖 request.headers / 鉴权，禁止 Next 在构建期静态预渲染
export const dynamic = 'force-dynamic'
