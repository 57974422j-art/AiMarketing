import { NextRequest, NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client'
import { randomBytes, scrypt } from 'crypto'
import { promisify } from 'util'

const prisma = new PrismaClient()
const scryptAsync = promisify(scrypt)

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex')
  const hashed = await scryptAsync(password, salt, 64) as Buffer
  return `${salt}:${hashed.toString('hex')}`
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { username, email, password, name, inviteCode } = body
    
    if (!username || !email || !password || !inviteCode) {
      return NextResponse.json(
        { success: false, message: '缺少必要参数（需包含邀请码）' },
        { status: 400 }
      )
    }
    
    const inviteCodeRecord = await prisma.inviteCode.findUnique({
      where: { code: inviteCode }
    })

    let teamIdToJoin: number | null = null

    if (!inviteCodeRecord) {
      const agentUser = await prisma.user.findFirst({
        where: { agentInviteCode: inviteCode }
      })

      if (agentUser && agentUser.teamId) {
        teamIdToJoin = agentUser.teamId
      } else {
        return NextResponse.json(
          { success: false, message: '邀请码不存在' },
          { status: 403 }
        )
      }
    } else if (inviteCodeRecord.isUsed) {
      return NextResponse.json(
        { success: false, message: '邀请码已被使用' },
        { status: 403 }
      )
    }
    
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
    
    const passwordHash = await hashPassword(password)

    const user = await prisma.user.create({
      data: {
        username,
        email,
        passwordHash,
        name,
        role: 'viewer',
        inviteCode,
        teamId: teamIdToJoin
      }
    })

    if (teamIdToJoin) {
      await prisma.teamMember.create({
        data: {
          teamId: teamIdToJoin,
          userId: user.id,
          role: 'viewer'
        }
      })
    } else if (inviteCodeRecord) {
      await prisma.inviteCode.update({
        where: { id: inviteCodeRecord.id },
        data: {
          isUsed: true,
          usedBy: user.id
        }
      })
    }
    
    return NextResponse.json({
      success: true,
      message: '注册成功',
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        name: user.name,
        role: user.role
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