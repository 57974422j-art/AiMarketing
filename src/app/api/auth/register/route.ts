import { NextRequest, NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { username, email, password, name } = body
    
    // 验证参数
    if (!username || !email || !password) {
      return NextResponse.json(
        { success: false, message: '缺少必要参数' },
        { status: 400 }
      )
    }
    
    // 检查用户名是否已存在
    const existingUser = await prisma.user.findFirst({
      where: {
        OR: [
          { username },
          { email }
        ]
      }
    })
    
    if (existingUser) {
      return NextResponse.json(
        { success: false, message: '用户名或邮箱已存在' },
        { status: 400 }
      )
    }
    
    // 加密密码（这里使用模拟加密，实际项目中应使用 bcrypt）
    const passwordHash = password // 实际项目中：await bcrypt.hash(password, 10)
    
    // 创建用户
    const user = await prisma.user.create({
      data: {
        username,
        email,
        passwordHash,
        name
      }
    })
    
    return NextResponse.json({
      success: true,
      message: '注册成功',
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        name: user.name
      }
    })
  } catch (error) {
    console.error('注册错误:', error)
    return NextResponse.json(
      {
        success: false,
        message: error instanceof Error ? error.message : '注册时发生错误'
      },
      { status: 500 }
    )
  } finally {
    await prisma.$disconnect()
  }
}