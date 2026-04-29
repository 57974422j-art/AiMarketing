import { NextRequest, NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

export async function GET(request: NextRequest) {
  try {
    const accounts = await prisma.account.findMany({
      orderBy: { createdAt: 'desc' }
    })
    
    return NextResponse.json(accounts)
  } catch (error) {
    console.error('获取账号列表错误:', error)
    return NextResponse.json(
      { success: false, message: '获取账号列表失败' },
      { status: 500 }
    )
  } finally {
    await prisma.$disconnect()
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { accountName, platform, accountId, userId } = body
    
    if (!accountName || !platform || !userId) {
      return NextResponse.json(
        { success: false, message: '缺少必要参数' },
        { status: 400 }
      )
    }
    
    const account = await prisma.account.create({
      data: {
        accountName,
        platform,
        accountId: accountId || '',
        userId,
        isBound: true
      }
    })
    
    return NextResponse.json({
      success: true,
      message: '账号添加成功',
      account
    })
  } catch (error) {
    console.error('添加账号错误:', error)
    return NextResponse.json(
      { success: false, message: error instanceof Error ? error.message : '添加账号失败' },
      { status: 500 }
    )
  } finally {
    await prisma.$disconnect()
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')
    
    if (!id) {
      return NextResponse.json(
        { success: false, message: '缺少账号ID' },
        { status: 400 }
      )
    }
    
    await prisma.account.delete({
      where: { id: parseInt(id) }
    })
    
    return NextResponse.json({
      success: true,
      message: '账号删除成功'
    })
  } catch (error) {
    console.error('删除账号错误:', error)
    return NextResponse.json(
      { success: false, message: '删除账号失败' },
      { status: 500 }
    )
  } finally {
    await prisma.$disconnect()
  }
}