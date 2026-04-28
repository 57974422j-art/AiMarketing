import { NextRequest, NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { username, password } = body
    
    // 验证参数
    if (!username || !password) {
      return NextResponse.json(
        { success: false, message: '缺少必要参数' },
        { status: 400 }
      )
    }
    
    // 查找用户
    const user = await prisma.user.findFirst({
      where: {
        username
      }
    })
    
    if (!user) {
      return NextResponse.json(
        { success: false, message: '用户名或密码错误' },
        { status: 401 }
      )
    }
    
    // 验证密码（这里使用模拟验证，实际项目中应使用 bcrypt）
    const isPasswordValid = password === user.passwordHash // 实际项目中：await bcrypt.compare(password, user.passwordHash)
    
    if (!isPasswordValid) {
      return NextResponse.json(
        { success: false, message: '用户名或密码错误' },
        { status: 401 }
      )
    }
    
    // 生成 JWT token（这里使用模拟 token，实际项目中应使用 jsonwebtoken）
    const token = `mock-token-${user.id}` // 实际项目中：jwt.sign({ userId: user.id }, process.env.JWT_SECRET, { expiresIn: '7d' })
    
    // 设置 cookie
    const response = NextResponse.json({
      success: true,
      message: '登录成功',
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        name: user.name
      },
      token
    })
    
    // 设置 cookie
    response.cookies.set('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      maxAge: 7 * 24 * 60 * 60,
      path: '/'
    })
    
    return response
  } catch (error) {
    console.error('登录错误:', error)
    return NextResponse.json(
      {
        success: false,
        message: error instanceof Error ? error.message : '登录时发生错误'
      },
      { status: 500 }
    )
  } finally {
    await prisma.$disconnect()
  }
}