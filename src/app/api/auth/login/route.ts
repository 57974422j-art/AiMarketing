import { NextRequest, NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client'
import { randomBytes, scrypt, timingSafeEqual, createHmac } from 'crypto'
import { promisify } from 'util'

const prisma = new PrismaClient()
const scryptAsync = promisify(scrypt)

async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  const [salt, hash] = storedHash.split(':')
  const hashed = await scryptAsync(password, salt, 64) as Buffer
  const storedHashBuffer = Buffer.from(hash, 'hex')
  return timingSafeEqual(hashed, storedHashBuffer)
}

function createJWT(payload: { userId: number; username: string; role: string; teamId: number | null }, secret: string): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
  const payloadStr = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const signature = createHmac('sha256', secret)
    .update(`${header}.${payloadStr}`)
    .digest('base64url')
  return `${header}.${payloadStr}.${signature}`
}

function verifyJWT(token: string, secret: string): { userId: number; username: string; role: string; teamId: number | null } | null {
  try {
    const [header, payload, signature] = token.split('.')
    const expectedSignature = createHmac('sha256', secret)
      .update(`${header}.${payload}`)
      .digest('base64url')
    if (signature !== expectedSignature) return null
    return JSON.parse(Buffer.from(payload, 'base64url').toString())
  } catch {
    return null
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { username, password } = body
    const JWT_SECRET = process.env.JWT_SECRET || 'aimarketing-secret-key-2024'
    
    if (!username || !password) {
      return NextResponse.json(
        { success: false, message: '缺少必要参数' },
        { status: 400 }
      )
    }
    
    const user = await prisma.user.findFirst({
      where: { username }
    })
    
    if (!user) {
      return NextResponse.json(
        { success: false, message: '用户名或密码错误' },
        { status: 401 }
      )
    }
    
    const isPasswordValid = await verifyPassword(password, user.passwordHash)
    
    if (!isPasswordValid) {
      return NextResponse.json(
        { success: false, message: '用户名或密码错误' },
        { status: 401 }
      )
    }
    
    const token = createJWT(
      { userId: user.id, username: user.username, role: user.role, teamId: user.teamId },
      JWT_SECRET
    )
    
    const response = NextResponse.json({
      success: true,
      message: '登录成功',
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        name: user.name,
        role: user.role
      }
    })
    
    response.cookies.set('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
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

export async function GET(request: NextRequest) {
  const token = request.cookies.get('token')?.value
  const JWT_SECRET = process.env.JWT_SECRET || 'aimarketing-secret-key-2024'
  
  if (!token) {
    return NextResponse.json({ authenticated: false })
  }
  
  const payload = verifyJWT(token, JWT_SECRET)
  if (!payload) {
    return NextResponse.json({ authenticated: false })
  }
  
  return NextResponse.json({
    authenticated: true,
    user: {
      id: payload.userId,
      username: payload.username,
      role: payload.role
    }
  })
}