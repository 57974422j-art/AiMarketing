import { NextRequest, NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client'
import { getAuthFromHeaders } from '@/lib/api-auth'
import { findByText, findAndClick, dumpXml, inputText } from '@/lib/uiautomator-driver'

const prisma = new PrismaClient()

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const auth = getAuthFromHeaders(request)
    if (!auth) return NextResponse.json({ success: false, message: '未认证' }, { status: 401 })

    const body = await request.json()
    const action = body.action || ''

    const row: any = await prisma.device.findUnique({ where: { id: parseInt(params.id) } })
    if (!row) return NextResponse.json({ success: false, message: '设备不存在' }, { status: 404 })
    const port = row.apiPort
    if (!port) return NextResponse.json({ success: false, message: '设备未配置 API 端口' }, { status: 400 })

    let result: any

    switch (action) {
      case 'dump':
        result = await dumpXml(port)
        break
      case 'findByText':
        result = await findByText(port, body.text || '')
        break
      case 'findAndClick':
        result = await findAndClick(port, body.text || '')
        break
      case 'inputText':
        result = await inputText(port, body.text || '')
        break
      default:
        return NextResponse.json({ success: false, message: `未知操作: ${action}` }, { status: 400 })
    }

    return NextResponse.json({ success: result.success, message: result.message, data: result })
  } catch (e: any) {
    return NextResponse.json({ success: false, message: e?.message || '操作失败' }, { status: 500 })
  } finally { await prisma.$disconnect() }
}
