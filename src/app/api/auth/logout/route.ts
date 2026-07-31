import { NextResponse } from 'next/server'

export async function POST() {
  const response = NextResponse.json({ success: true, message: '退出成功' })
  
  // 清除 token Cookie - 使用多种方式确保清除
  response.cookies.set('token', '', {
    expires: new Date(0),
    path: '/',
    httpOnly: true,
    secure: false,
    sameSite: 'strict'
  })
  
  // 同时设置空值确保覆盖
  response.cookies.delete('token')
  
  return response
}

// 强制动态渲染：API 路由依赖 request.headers / 鉴权，禁止 Next 在构建期静态预渲染
export const dynamic = 'force-dynamic'
