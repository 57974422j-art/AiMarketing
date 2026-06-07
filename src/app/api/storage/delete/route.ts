import { NextRequest, NextResponse } from 'next/server'
import path from 'path'
import fs from 'fs'
import { getAuthFromHeaders } from '@/lib/api-auth'

const STORAGE_BASE = '/root/AiMarketing/public/storage'

export async function DELETE(request: NextRequest) {
  const auth = getAuthFromHeaders(request)
  if (!auth) return NextResponse.json({ success: false, message: '请先登录' }, { status: 401 })

  const { name } = await request.json()
  if (!name) return NextResponse.json({ success: false, message: '缺少文件名' }, { status: 400 })

  const fp = path.join(STORAGE_BASE, String(auth.userId), name)
  if (!fp.startsWith(path.join(STORAGE_BASE, String(auth.userId)))) {
    return NextResponse.json({ success: false, message: '非法路径' }, { status: 403 })
  }
  if (!fs.existsSync(fp)) return NextResponse.json({ success: false, message: '文件不存在' }, { status: 404 })

  fs.unlinkSync(fp)
  return NextResponse.json({ success: true, message: '删除成功' })
}
