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
