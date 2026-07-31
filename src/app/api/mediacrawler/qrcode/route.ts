import { NextRequest, NextResponse } from 'next/server'
import { readdir, readFile } from 'fs/promises'
import { join } from 'path'

/**
 * GET /api/mediacrawler/qrcode - 返回最新扫码二维码图片
 */
export async function GET(request: NextRequest) {
  try {
    const tmpDir = '/tmp'
    let files: string[]
    try {
      files = await readdir(tmpDir)
    } catch {
      return NextResponse.json({ success: false, message: '无法读取/tmp目录' }, { status: 500 })
    }

    // 找到最新的 tmpxxx.PNG 文件（MediaCrawler 生成）
    const pngFiles = files.filter(f => /^tmp.+\.PNG$/i.test(f)).map(f => join(tmpDir, f))

    if (pngFiles.length === 0) {
      return NextResponse.json({ success: false, message: '暂无二维码' }, { status: 404 })
    }

    // 取最新修改的文件
    let newest = ''
    let newestMtime = 0
    const fsStat = await import('fs/promises')
    for (const f of pngFiles) {
      try {
        const stat = await fsStat.stat(f)
        if (stat.mtimeMs > newestMtime) {
          newestMtime = stat.mtimeMs
          newest = f
        }
      } catch { /* skip */ }
    }

    if (!newest) {
      return NextResponse.json({ success: false, message: '暂无二维码' }, { status: 404 })
    }

    const buffer = await readFile(newest)
    return new NextResponse(buffer, {
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'no-cache',
      },
    })
  } catch {
    return NextResponse.json({ success: false, message: '获取二维码失败' }, { status: 500 })
  }
}

// 强制动态渲染：API 路由依赖 request.headers / 鉴权，禁止 Next 在构建期静态预渲染
export const dynamic = 'force-dynamic'
