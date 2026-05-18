import { NextRequest, NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client'
import { getAuthFromHeaders } from '@/lib/api-auth'
import * as UI from '@/lib/uiautomator-driver'
import * as Douyin from '@/lib/douyin-automation'

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
    const act = action.toLowerCase()
    const A = { port, ...body }

    // --- UI 基础操作 ---
    if (act === 'dump') result = await UI.dumpXml(port)
    else if (act === 'findbytext') result = await UI.findByText(port, body.text || '')
    else if (act === 'click') result = await UI.findAndClick(port, body.text || '')
    else if (act === 'inputtext') result = await UI.inputText(port, body.text || '')
    else if (act === 'tapinput') result = await UI.tapAndInput(port, body.fieldtext || '', body.text || '')
    else if (act === 'swipetofind') result = await UI.swipeToFind(port, body.text || '')
    else if (act === 'scrollup') result = await UI.scrollUp(port)
    else if (act === 'scrolldown') result = await UI.scrollDown(port)
    else if (act === 'extract') result = await UI.extractScreenData(port)
    else if (act === 'tapshell') { const r = await UI.tap(port, body.x || 0, body.y || 0); result = r }
    else if (act === 'back') result = await UI.goBack(port)

    // --- 抖音自动化 ---
    else if (act === 'share') result = await Douyin.shareVideo(port, body.target)
    else if (act === 'search') result = await Douyin.search(port, body.keyword || '')
    else if (act === 'like') result = await Douyin.like(port)
    else if (act === 'comment') result = await Douyin.comment(port, body.text || body.message || '')
    else if (act === 'follow') result = await Douyin.follow(port)
    else if (act === 'dm') result = await Douyin.sendDirectMessage(port, body.username || '', body.message || '')
    else if (act === 'publish') result = await Douyin.publishVideo(port, body.options || {})
    else if (act === 'videoinfo') result = await Douyin.extractVideoInfo(port)
    else if (act === 'profile') result = await Douyin.extractProfile(port)
    else if (act === 'comments') result = await Douyin.extractComments(port)
    else if (act === 'interact') result = await Douyin.interact(port, body.options || {})
    else return NextResponse.json({ success: false, message: `未知操作: ${action}` }, { status: 400 })

    return NextResponse.json({ success: result.success ?? true, message: result.message || 'OK', data: result })
  } catch (e: any) {
    return NextResponse.json({ success: false, message: e?.message || '操作失败' }, { status: 500 })
  } finally { await prisma.$disconnect() }
}
