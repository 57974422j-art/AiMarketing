import { NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
  // 模拟获取账号列表
  const accounts = [
    { id: 1, platform: '抖音', accountName: '抖音账号1', status: '已绑定' },
    { id: 2, platform: '快手', accountName: '快手账号1', status: '已绑定' },
    { id: 3, platform: '小红书', accountName: '小红书账号1', status: '未绑定' }
  ]
  
  return NextResponse.json(accounts)
}

export async function POST(request: NextRequest) {
  const body = await request.json()
  
  // 模拟添加账号
  return NextResponse.json({
    success: true,
    message: '账号添加成功',
    account: {
      id: Math.floor(Math.random() * 10000),
      ...body
    }
  })
}

export async function DELETE(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const id = searchParams.get('id')
  
  // 模拟删除账号
  return NextResponse.json({
    success: true,
    message: '账号删除成功'
  })
}