/**
 * 指纹浏览器 API 路由（可交互版本）
 *
 * 端点：
 *   GET  /api/browser              - 获取所有活跃浏览器
 *   GET  /api/browser?port=xxx     - 查询状态
 *   POST /api/browser              - 启动浏览器 { port, accountId? }
 *   POST /api/browser              - 交互动作 { port, action, ... }
 *   DELETE /api/browser?port=xxx   - 停止浏览器
 *
 * 支持的 action：
 *   open       - 打开 URL          { url }
 *   click      - 点击坐标          { x, y }
 *   type       - 输入文字          { x, y, text }
 *   enter      - 按 Enter 键
 *   screenshot - 截取当前画面
 */

import { NextRequest, NextResponse } from 'next/server'
import {
  startBrowser,
  stopBrowser,
  getBrowserStatus,
  getAllBrowsers,
  openPage,
  clickAt,
  typeAt,
  pressEnter,
  takeScreenshot,
} from '@/lib/browser-manager'

// GET - 查询状态
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const portStr = searchParams.get('port')

    if (portStr) {
      const port = parseInt(portStr, 10)
      if (isNaN(port)) return NextResponse.json({ error: '无效的端口号' }, { status: 400 })
      const status = getBrowserStatus(port)
      return NextResponse.json({ success: true, data: status })
    }

    const browsers = getAllBrowsers()
    return NextResponse.json({ success: true, data: browsers })

  } catch (error: any) {
    console.error('[API:/browser GET] 错误:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

// POST - 启动浏览器 或 执行交互动作
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { port, accountId, url, action, x, y, text } = body

    if (!port || isNaN(port)) {
      return NextResponse.json({ error: '缺少或无效的 port 参数' }, { status: 400 })
    }

    // ── 交互动作 ──
    if (action === 'open' && url) {
      const result = await openPage(port, url)
      return NextResponse.json({
        success: true, message: `已在端口 ${port} 打开 ${url}`,
        data: { screenshot: result.screenshot || null },
      })
    }

    if (action === 'click') {
      if (x === undefined || y === undefined) {
        return NextResponse.json({ error: 'click 需要 x, y 坐标' }, { status: 400 })
      }
      const result = await clickAt(port, x, y)
      return NextResponse.json({
        success: true, message: `点击 (${x}, ${y})`,
        data: { screenshot: result.screenshot || null },
      })
    }

    if (action === 'type') {
      if (x === undefined || y === undefined || !text) {
        return NextResponse.json({ error: 'type 需要 x, y, text 参数' }, { status: 400 })
      }
      const result = await typeAt(port, x, y, String(text))
      return NextResponse.json({
        success: true, message: `输入文字`,
        data: { screenshot: result.screenshot || null },
      })
    }

    if (action === 'enter') {
      const result = await pressEnter(port)
      return NextResponse.json({
        success: true, message: '按 Enter',
        data: { screenshot: result.screenshot || null },
      })
    }

    if (action === 'screenshot') {
      const screenshot = await takeScreenshot(port)
      return NextResponse.json({
        success: true, message: '截图完成',
        data: { screenshot },
      })
    }

    // ── 启动浏览器（无 action 时）──
    const instance = await startBrowser(port, accountId)

    let initialScreenshot: string | null = null
    try {
      const pageResult = await openPage(port, 'https://creator.douyin.com/creator-micro/content/publish')
      initialScreenshot = pageResult.screenshot || null
      console.log('[BrowserManager] 初始页面加载成功')
    } catch (e) {
      console.warn(`[BrowserManager] 初始页面加载异常:`, e instanceof Error ? e.message : e)
    }

    return NextResponse.json({
      success: true,
      message: `浏览器已启动 - CDP端口:${port}`,
      data: {
        port: instance.port,
        cdpUrl: `http://localhost:${port}`,
        startedAt: instance.startedAt,
        screenshot: initialScreenshot,
      },
    })

  } catch (error: any) {
    console.error('[API:/browser POST] 错误:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

// DELETE - 停止浏览器
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const portStr = searchParams.get('port')

    if (!portStr) {
      return NextResponse.json({ error: '缺少 port 参数' }, { status: 400 })
    }

    const port = parseInt(portStr, 10)
    if (isNaN(port)) {
      return NextResponse.json({ error: '无效的端口号' }, { status: 400 })
    }

    await stopBrowser(port)

    return NextResponse.json({
      success: true,
      message: `浏览器已停止 - 端口:${port}`,
    })

  } catch (error: any) {
    console.error('[API:/browser DELETE] 错误:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
