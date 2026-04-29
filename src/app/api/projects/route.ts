import { NextRequest, NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

export async function GET(request: NextRequest) {
  try {
    const projects = await prisma.project.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        assets: true
      }
    })
    
    const projectsWithCount = projects.map(project => ({
      ...project,
      assetCount: project.assets.length
    }))
    
    return NextResponse.json(projectsWithCount)
  } catch (error) {
    console.error('获取项目列表错误:', error)
    return NextResponse.json(
      { success: false, message: '获取项目列表失败' },
      { status: 500 }
    )
  } finally {
    await prisma.$disconnect()
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { name, description, userId } = body
    
    if (!name || !userId) {
      return NextResponse.json(
        { success: false, message: '缺少必要参数' },
        { status: 400 }
      )
    }
    
    const project = await prisma.project.create({
      data: {
        name,
        description: description || null,
        userId
      }
    })
    
    return NextResponse.json({
      success: true,
      message: '项目创建成功',
      project
    })
  } catch (error) {
    console.error('创建项目错误:', error)
    return NextResponse.json(
      { success: false, message: error instanceof Error ? error.message : '创建项目失败' },
      { status: 500 }
    )
  } finally {
    await prisma.$disconnect()
  }
}