import { NextRequest, NextResponse } from 'next/server'
// ★HOT_REPORT_AUTH_V1：不再需要鉴权（热点是公开榜单数据）

// 2026-09-13: 客户端热点上报端点
//   背景：微博/B站/抖音/小红书/快手 的榜单接口需要 cookie 或签名，服务器直调拿不到；
//        客户端每天首次启动时用【用户已登录的浏览器】采集 → POST 到这里 → 落文件
//   服务器 GET /api/agent/hotspots 时由 getReportedSources() 读该文件合并返回
export const dynamic = 'force-dynamic'

// 落盘位置：与 getReportedSources() 读取路径保持一致
const REPORT_FILE = '/root/AiMarketing/data/hotspot-report.json'

type Item = { title: string; hot?: string; url?: string; rank?: number }
type Payload = Record<string, { items: Item[]; fetchedAt?: number }>

export async function POST(request: NextRequest) {
  try {
    // ★HOT_REPORT_AUTH_V1（2026-09-16）：热点上报是【公开榜单数据】→ 不强制登录。
    //   原来必须登录 → 客户端采集成功后上报一直 401 → 服务器拿不到 → 大屏只有服务器直调的源。
    const body = (await request.json()) as Payload
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ success: false, message: '参数错误' }, { status: 400 })
    }

    const fs = await import('node:fs/promises')
    const path = await import('node:path')

    // 读旧数据（保留其它源：客户端可能只采到部分平台）
    let old: Payload = {}
    try {
      old = JSON.parse(await fs.readFile(REPORT_FILE, 'utf-8'))
    } catch { /* 首次没有文件 */ }

    const now = Date.now()
    const merged: Payload = { ...old }
    let accepted = 0
    for (const [source, v] of Object.entries(body)) {
      const items = Array.isArray(v?.items) ? v.items.filter((it) => it?.title).slice(0, 20) : []
      if (!items.length) continue
      merged[source] = { items, fetchedAt: Number(v?.fetchedAt) || now }
      accepted++
    }

    await fs.mkdir(path.dirname(REPORT_FILE), { recursive: true })
    await fs.writeFile(REPORT_FILE, JSON.stringify(merged), 'utf-8')

    console.log('[hotspot-report] 客户端上报：' + accepted + ' 个源（' + Object.keys(body).join('/') + '）')
    return NextResponse.json({ success: true, accepted, sources: Object.keys(merged) })
  } catch (e: any) {
    console.error('[hotspot-report] 失败:', e?.message || e)
    return NextResponse.json({ success: false, message: String(e?.message || e) }, { status: 500 })
  }
}

/** 查看当前已上报的源（只读，便于排查） */
export async function GET() {
  try {
    const fs = await import('node:fs/promises')
    const raw = await fs.readFile(REPORT_FILE, 'utf-8')
    return NextResponse.json({ success: true, data: JSON.parse(raw) })
  } catch {
    return NextResponse.json({ success: true, data: {}, message: '暂无上报数据' })
  }
}
