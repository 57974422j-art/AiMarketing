import { NextResponse } from 'next/server'

// 占位路由：synthesize 功能尚未实现，仅保证构建通过。
export async function POST() {
  return NextResponse.json({ success: false, message: '未实现' }, { status: 501 })
}

// 强制动态渲染：API 路由依赖 request.headers / 鉴权，禁止 Next 在构建期静态预渲染
export const dynamic = 'force-dynamic'
