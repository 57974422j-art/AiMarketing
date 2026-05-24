import { NextRequest, NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client'
import { getAuthFromHeaders } from '@/lib/api-auth'

const prisma = new PrismaClient()

export async function GET(request: NextRequest) {
  try {
    const auth = getAuthFromHeaders(request)
    if (!auth) return NextResponse.json({ success: false, message: '未认证' }, { status: 401 })
    const data = await prisma.automationTemplate.findMany({
      where: auth.role === 'admin' ? {} : { ownerId: auth.userId },
      orderBy: { createdAt: 'desc' },
    })
    return NextResponse.json({ success: true, data })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ success: false, message: '服务器错误' }, { status: 500 })
  } finally { await prisma.$disconnect() }
}

export async function POST(request: NextRequest) {
  try {
    const auth = getAuthFromHeaders(request)
    if (!auth) return NextResponse.json({ success: false, message: '未认证' }, { status: 401 })
    const { name, type, params } = await request.json()
    if (!name || !type) return NextResponse.json({ success: false, message: '缺少参数' }, { status: 400 })
    const tmpl = await prisma.automationTemplate.create({
      data: { name, type, params: JSON.stringify(params || {}), ownerId: auth.userId },
    })
    return NextResponse.json({ success: true, data: tmpl }, { status: 201 })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ success: false, message: '服务器错误' }, { status: 500 })
  } finally { await prisma.$disconnect() }
}

export async function DELETE(request: NextRequest) {
  try {
    const auth = getAuthFromHeaders(request)
    if (!auth) return NextResponse.json({ success: false, message: '未认证' }, { status: 401 })
    const { searchParams } = new URL(request.url)
    const id = parseInt(searchParams.get('id') || '', 10)
    if (!id) return NextResponse.json({ success: false, message: '缺少 id' }, { status: 400 })
    const tmpl = await prisma.automationTemplate.findUnique({ where: { id } })
    if (!tmpl) return NextResponse.json({ success: false, message: '模板不存在' }, { status: 404 })
    if (auth.role !== 'admin' && tmpl.ownerId !== auth.userId) {
      return NextResponse.json({ success: false, message: '无权删除' }, { status: 403 })
    }
    await prisma.automationTemplate.delete({ where: { id } })
    return NextResponse.json({ success: true, message: '已删除' })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ success: false, message: '服务器错误' }, { status: 500 })
  } finally { await prisma.$disconnect() }
}
