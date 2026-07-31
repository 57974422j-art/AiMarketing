import { NextRequest, NextResponse } from 'next/server'
import path from 'path'
import fs from 'fs'
import { getAuthFromHeaders } from '@/lib/api-auth'
import { saveToPersonalRepo } from '@/lib/personal-storage'

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

  try {
    const res = await saveToPersonalRepo({ userId: auth.userId, buffer: srcBuf, ext: 'mp4', mime: 'video/mp4' })
    return NextResponse.json({ success: true, data: { name: res.name } })
  } catch (e) {
    const message = e instanceof Error ? e.message : '保存失败'
    return NextResponse.json({ success: false, message }, { status: 413 })
  }
}

// 强制动态渲染：API 路由依赖 request.headers / 鉴权，禁止 Next 在构建期静态预渲染
export const dynamic = 'force-dynamic'
