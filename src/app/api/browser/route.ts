/**
 * 指纹浏览器 API 路由
 * 
 * 仅服务于 bindType='manual' (指纹浏览器) 类型的账号
 * 
 * 端点：
 *   GET  /api/browser          - 获取所有活跃浏览器列表（Admin用）
 *   GET  /api/browser?port=xxx - 查询指定端口状态
 *   POST /api/browser          - 启动浏览器 { port, accountId? }
 *   DELETE /api/browser?port=xxx - 停止浏览器
 *   POST /api/browser/open     - 打开页面 { port, url }
 */

import { NextRequest, NextResponse } from 'next/server'
import {
  startBrowser,
  stopBrowser,
  getBrowserStatus,
  getAllBrowsers,
  openPage,
} from '@/lib/browser-manager'

// GET - 查询状态
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const portStr = searchParams.get('port')

    if (portStr) {
      // 查询单个端口状态
      const port = parseInt(portStr, 10)
      if (isNaN(port)) {
        return NextResponse.json({ error: '无效的端口号' }, { status: 400 })
      }

      const status = getBrowserStatus(port)
      return NextResponse.json({ success: true, data: status })
    }

    // 返回所有活跃浏览器列表
    const browsers = getAllBrowsers()
    return NextResponse.json({ success: true, data: browsers })

  } catch (error: any) {
    console.error('[API:/browser GET] 错误:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

// POST - 启动浏览器 或 打开页面
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { port, accountId, url, action } = body

    if (!port || isNaN(port)) {
      return NextResponse.json({ error: '缺少或无效的 port 参数' }, { status: 400 })
    }

    // 打开页面操作
    if (action === 'open') {
      if (!url) {
        return NextResponse.json({ error: '打开页面需要 url 参数' }, { status: 400 })
      }
      
      const page = await openPage(port, url)
      // 截图验证
      let screenshot = null
      try {
        if (page) {
          screenshot = await page.screenshot({ encoding: 'base64', fullPage: false })
        }
      } catch (_) {}

      return NextResponse.json({
        success: true,
        message: `已在端口 ${port} 打开 ${url}`,
        data: { screenshot: screenshot ? `data:image/png;base64,${screenshot}` : null },
      })
    }

    // 启动浏览器
    const instance = await startBrowser(port, accountId)

    // 启动后自动打开抖音创作者中心登录页
    try {
      await openPage(port, 'https://creator.douyin.com/creator-micro/content/publish')
    } catch (e) {
      console.warn(`[BrowserManager] 浏览器启动成功但初始页面加载异常:`, e instanceof Error ? e.message : e)
    }

    return NextResponse.json({
      success: true,
      message: `浏览器已启动 - CDP端口:${port}`,
      data: {
        port: instance.port,
        cdpUrl: `http://localhost:${port}`,
        startedAt: instance.startedAt,
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
