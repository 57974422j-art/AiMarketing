import { NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client'
import { existsSync, writeFileSync, unlinkSync } from 'fs'
import { join } from 'path'

const prisma = new PrismaClient()

export async function POST() {
  const results: { id: number; title: string; status: string; url?: string }[] = []
  try {
    const rows = await prisma.$queryRawUnsafe<any[]>('SELECT id, title, previewUrl FROM PromptTemplate WHERE previewUrl IS NOT NULL')
    for (const row of rows) {
      const url: string = row.previewUrl
      if (!url.includes('dashscope') && !url.includes('Expires=')) {
        results.push({ id: row.id, title: row.title, status: '跳过(非临时链接)' })
        continue
      }
      const ext = url.endsWith('.mp4') ? 'mp4' : url.endsWith('.png') ? 'png' : 'jpg'
      try {
        const resp = await fetch(url, { signal: AbortSignal.timeout(30000) })
        if (!resp.ok) {
          results.push({ id: row.id, title: row.title, status: `下载失败 HTTP ${resp.status}` })
          continue
        }
        const buf = await resp.arrayBuffer()
        const tempPath = join(process.cwd(), 'temp', `migrate_${row.id}_${Date.now()}.${ext}`)
        writeFileSync(tempPath, new Uint8Array(buf))

        const OSS = (await import('ali-oss')).default
        const client = new OSS({
          region: process.env.OSS_REGION || 'oss-cn-hangzhou',
          accessKeyId: process.env.OSS_ACCESS_KEY_ID!,
          accessKeySecret: process.env.OSS_ACCESS_KEY_SECRET!,
          bucket: process.env.OSS_BUCKET!,
          secure: true,
        })
        const ossName = `previews/${Date.now()}_${row.id}_${Math.random().toString(36).slice(2, 6)}.${ext}`
        await client.put(ossName, tempPath, { headers: { 'x-oss-object-acl': 'public-read' } })
        unlinkSync(tempPath)

        const ossUrl = `https://${process.env.OSS_BUCKET}.${process.env.OSS_REGION || 'oss-cn-hangzhou'}.aliyuncs.com/${ossName}`
        await prisma.$executeRawUnsafe('UPDATE PromptTemplate SET previewUrl = ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ?', ossUrl, row.id)
        results.push({ id: row.id, title: row.title, status: '已迁移', url: ossUrl })
      } catch (e: any) {
        results.push({ id: row.id, title: row.title, status: `迁移失败: ${e?.message?.substring(0, 100) || e}` })
      }
    }
    return NextResponse.json({ success: true, data: results })
  } catch (e) {
    return NextResponse.json({ success: false, message: String(e) }, { status: 500 })
  } finally {
    await prisma.$disconnect()
  }
}

// 强制动态渲染：API 路由依赖 request.headers / 鉴权，禁止 Next 在构建期静态预渲染
export const dynamic = 'force-dynamic'
