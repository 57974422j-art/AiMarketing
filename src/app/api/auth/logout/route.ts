import { NextResponse } from 'next/server'

export async function POST() {
  const response = NextResponse.json({ success: true, message: '退出成功' })
  
  // 清除 token Cookie
  response.cookies.set('token', '', {
    expires: new Date(0),
    path: '/',
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax'
  })
  
  return response
}
