import { NextRequest, NextResponse } from 'next/server'
import path from 'path'
import fs from 'fs'
import { getAuthFromHeaders } from '@/lib/api-auth'
import { putObject, listObjects } from '@/lib/oss'

const GENERATED = '/root/AiMarketing/public/generated'

export async function POST(request: NextRequest) {
  const auth = getAuthFromHeaders(request)
  if (!auth) return NextResponse.json({ success: false, message: '请先登录' }, { status: 401 })

  const { taskId } = await request.json()
  if (!taskId) return NextResponse.json({ success: false, message: '缺少taskId' }, { status: 400 })

  // 从本地 generated 目录读取源文件
  const src = path.join(GENERATED, taskId)
  if (!fs.existsSync(src)) return NextResponse.json({ success: false, message: '文件不存在' }, { status: 404 })

  const srcBuf = fs.readFileSync(src)
  const destKey = `storage/${auth.userId}/${taskId.split('.')[0]}.mp4`

  // 检查存储配额（统计该用户已用空间）
  try {
    const files = await listObjects(`storage/${auth.userId}/`)
    let used = files.reduce((sum, f) => sum + f.size, 0)
    if (used + srcBuf.length > 500 * 1024 * 1024) {
      return NextResponse.json({ success: false, message: '存储空间不足' }, { status: 413 })
    }
  } catch {
    // OSS 列目录失败时跳过配额检查
  }

  // 上传到 OSS
  await putObject(destKey, srcBuf, 'video/mp4')

  return NextResponse.json({ success: true, data: { name: path.basename(destKey) } })
}
