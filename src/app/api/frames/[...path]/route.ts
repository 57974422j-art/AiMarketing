import { NextRequest, NextResponse } from 'next/server'
import * as fs from 'fs'
import * as path from 'path'

// 2026-08-23: frames 图片读盘服务（兜底——静态目录服务不确定性时用 API 读文件返回）
const MIME: Record<string, string> = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif' }

export async function GET(req: NextRequest, { params }: { params: { path: string[] } }) {
  const segs = (params.path || []).map(s => s).join(path.sep)
  if (!segs || /\.\./.test(segs)) return new NextResponse('forbidden', { status: 403 })
  // 目录：standalone public 优先，dev public 兜底
  const roots = [
    path.join(process.cwd(), '.next', 'standalone', 'public', 'frames'),
    path.join(process.cwd(), 'public', 'frames'),
  ]
  for (const root of roots) {
    const fp = path.join(root, segs)
    try {
      if (fs.existsSync(fp) && fs.statSync(fp).isFile()) {
        const buf = fs.readFileSync(fp)
        const ext = path.extname(fp).toLowerCase()
        return new NextResponse(new Uint8Array(buf), { headers: { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': 'public, max-age=300' } })
      }
    } catch {}
  }
  return new NextResponse('not found', { status: 404 })
}
