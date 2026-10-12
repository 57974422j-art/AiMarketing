import { NextRequest, NextResponse } from 'next/server'
import * as fs from 'fs'
import * as path from 'path'
import { getAuthFromCookie } from '@/lib/api-auth'

// 2026-08-23: frames 图片读盘服务（兜底——静态目录服务不确定性时用 API 读文件返回）
const MIME: Record<string, string> = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif' }

export async function GET(req: NextRequest, { params }: { params: { path: string[] } }) {
  // ★VF_FRAMEAUTH_V1（2026-10-12 用户定案「有BUG先处理」）：本路由原来**无鉴权** ——
  //   帧图路径形如 `frames/{uid}/{ts}/fN.jpg`，知道路径就能读**别人的**抽帧图（隐私面）。
  //   现口径：① 必须登录；② 路径首段是**数字 uid** 时必须等于自己（admin 除外）；③ 非数字的历史路径放行（兼容老数据）。
  const auth = getAuthFromCookie(req)
  if (!auth?.userId) return new NextResponse('unauthorized', { status: 401 })
  const segs = (params.path || []).map(s => s).join(path.sep)
  if (!segs || /\.\./.test(segs)) return new NextResponse('forbidden', { status: 403 })
  const head = String(params.path?.[0] || '')
  if (/^\d+$/.test(head) && head !== String(auth.userId) && auth.role !== 'admin') {
    return new NextResponse('forbidden', { status: 403 })
  }
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
        // ★VF_FRAMEAUTH_V1：帧图是**用户私有**内容（已加登录+归属校验）⇒ 缓存同样改 private
        return new NextResponse(new Uint8Array(buf), { headers: { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': 'private, max-age=300' } })
      }
    } catch {}
  }
  return new NextResponse('not found', { status: 404 })
}
