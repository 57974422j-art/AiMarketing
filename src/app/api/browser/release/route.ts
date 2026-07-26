import { NextRequest, NextResponse } from 'next/server'
import { releaseCdpPort } from '@/lib/quota-manager'

// 释放端口：客户端停止指纹浏览器后调用，把端口归还全局池
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const portStr = searchParams.get('port')
    if (!portStr) return NextResponse.json({ success: false, message: '缺少 port' }, { status: 400 })
    const port = parseInt(portStr, 10)
    if (isNaN(port)) return NextResponse.json({ success: false, message: '无效端口' }, { status: 400 })
    const released = releaseCdpPort(port)
    return NextResponse.json({ success: true, data: { port, released } })
  } catch (e: any) {
    return NextResponse.json({ success: false, message: e?.message || '释放失败' }, { status: 500 })
  }
}
