import { NextRequest, NextResponse } from 'next/server'
import path from 'path'
import fs from 'fs'
import { getAuthFromHeaders } from '@/lib/api-auth'

const GENERATED = '/root/AiMarketing/public/generated'
const STORAGE = '/root/AiMarketing/public/storage'

export async function POST(request: NextRequest) {
  const auth = getAuthFromHeaders(request)
  if (!auth) return NextResponse.json({ success: false, message: '请先登录' }, { status: 401 })

  const { taskId } = await request.json()
  if (!taskId) return NextResponse.json({ success: false, message: '缺少taskId' }, { status: 400 })

  const src = path.join(GENERATED, taskId)
  if (!fs.existsSync(src)) return NextResponse.json({ success: false, message: '文件不存在' }, { status: 404 })

  const destDir = path.join(STORAGE, String(auth.userId))
  if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true })

  let used = 0
  for (const f of fs.readdirSync(destDir)) {
    used += fs.statSync(path.join(destDir, f)).size
  }
  const size = fs.statSync(src).size
  if (used + size > 500 * 1024 * 1024) {
    return NextResponse.json({ success: false, message: '存储空间不足' }, { status: 413 })
  }

  const dest = path.join(destDir, taskId.split('.')[0] + '.mp4')
  if (!fs.existsSync(dest)) fs.copyFileSync(src, dest)

  return NextResponse.json({ success: true, data: { name: path.basename(dest) } })
}
