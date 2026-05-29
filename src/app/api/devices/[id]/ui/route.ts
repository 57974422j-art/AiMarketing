import { NextRequest, NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client'
import { getAuthFromHeaders } from '@/lib/api-auth'
import * as UI from '@/lib/uiautomator-driver'

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

    // --- 抖音自动化（均已内联，无需 Douyin 模块） ---
    else if (act === 'share') { await UI.sleep(2000); result = await UI.findAndClick(port, '分享') }
    else if (act === 'search') { const s = await UI.findAndClick(port, '搜索'); if (!s.success) { await UI.goBack(port); await UI.sleep(500); await UI.findAndClick(port, '搜索') }; await UI.sleep(1500); await UI.tapAndInput(port, '搜索', body.keyword || ''); await UI.sleep(1000); await UI.tapRatio(port, 0.5, 0.104); await UI.sleep(3000); result = { success: true, message: `已搜索"${body.keyword || ''}"` } }
    else if (act === 'like') { await UI.sleep(20000 + Math.random()*10000); result = await UI.findAndClick(port, '赞') }
    else if (act === 'comment') { const cr = await UI.findAndClick(port, '评论'); if (cr.success) { await UI.sleep(2000); await UI.tapAndInput(port, '消息', body.text || body.message || ''); await UI.sleep(1000); result = await UI.findAndClick(port, '发送') } else result = cr }
    else if (act === 'follow') { await UI.sleep(3000); result = await UI.findAndClick(port, '关注') }
    else if (act === 'dm') { let dr = await UI.findAndClick(port, '消息'); if (!dr.success) { for (let i=0;i<3;i++){ await UI.goBack(port); await UI.sleep(500)}; dr = await UI.findAndClick(port, '消息') }; if (dr.success) { await UI.sleep(2000); const ur = await UI.findAndClick(port, body.username || ''); if (ur.success) { await UI.sleep(2000); await UI.tapAndInput(port, '消息', body.message || ''); await UI.sleep(1000); result = await UI.findAndClick(port, '发送') } else result = ur } else result = dr }
    else if (act === 'videoinfo' || act === 'profile' || act === 'comments') { result = await UI.extractScreenData(port) }
    else return NextResponse.json({ success: false, message: `未知操作: ${action}` }, { status: 400 })

    return NextResponse.json({ success: result.success ?? true, message: result.message || 'OK', data: result })
  } catch (e: any) {
    return NextResponse.json({ success: false, message: e?.message || '操作失败' }, { status: 500 })
  } finally { await prisma.$disconnect() }
}
