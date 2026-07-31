import { NextRequest, NextResponse } from 'next/server'
import { getAuthFromHeaders } from '@/lib/api-auth'
import { deleteObject } from '@/lib/oss'

export async function DELETE(request: NextRequest) {
  const auth = getAuthFromHeaders(request)
  if (!auth) return NextResponse.json({ success: false, message: '请先登录' }, { status: 401 })

  const { name } = await request.json()
  if (!name) return NextResponse.json({ success: false, message: '缺少文件名' }, { status: 400 })

  const key = `storage/${auth.userId}/${name}`

  try {
    await deleteObject(key)
    return NextResponse.json({ success: true, message: '删除成功' })
  } catch (e: any) {
    return NextResponse.json({ success: false, message: e.message || '删除失败' }, { status: 500 })
  }
}

// 强制动态渲染：API 路由依赖 request.headers / 鉴权，禁止 Next 在构建期静态预渲染
export const dynamic = 'force-dynamic'
