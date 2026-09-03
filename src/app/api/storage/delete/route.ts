import { NextRequest, NextResponse } from 'next/server'
import { getAuthFromHeaders } from '@/lib/api-auth'
import { deleteObject } from '@/lib/oss'

export async function DELETE(request: NextRequest) {
  const auth = getAuthFromHeaders(request)
  if (!auth) return NextResponse.json({ success: false, message: '请先登录' }, { status: 401 })

  const { name, names } = await request.json()
  const list: string[] = Array.isArray(names) && names.length ? names : (name ? [name] : [])
  if (!list.length) return NextResponse.json({ success: false, message: '缺少文件名' }, { status: 400 })

  try {
    let failed = 0
    for (const n of list) {
      if (!/^[a-zA-Z0-9._\-]+$/.test(n)) { failed++; continue }
      try { await deleteObject(`storage/${auth.userId}/${n}`) } catch { failed++ }
    }
    return NextResponse.json({ success: true, message: `已删除 ${list.length - failed} 个` + (failed ? `，失败 ${failed} 个` : '') })
  } catch (e: any) {
    return NextResponse.json({ success: false, message: e.message || '删除失败' }, { status: 500 })
  }
}

// 强制动态渲染：API 路由依赖 request.headers / 鉴权，禁止 Next 在构建期静态预渲染
export const dynamic = 'force-dynamic'
