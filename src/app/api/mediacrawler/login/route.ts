/**
 * MediaCrawler 扫码登录 API
 *
 * POST /api/mediacrawler/login  - 启动登录进程（生成二维码/等待扫码）
 * GET  /api/mediacrawler/login  - 获取当前登录状态
 * DELETE /api/mediacrawler/login - 终止登录进程
 */

import { NextRequest, NextResponse } from 'next/server'
import { getAuthFromHeaders } from '@/lib/api-auth'
import { spawn, execSync } from 'child_process'

function getMediaCrawlerPath() { return process.env.getMediaCrawlerPath() || '/opt/MediaCrawler' }
function getPythonBin() { return process.env.getPythonBin() || 'python3' }

// 存储登录进程信息（内存中，重启后丢失）
const activeLoginProcess: {
  pid?: number
  startedAt: number
  status: 'starting' | 'waiting_scan' | 'scanned' | 'confirmed' | 'success' | 'error' | 'timeout' | 'killed'
  qrcodeUrl?: string
  cookiePath?: string
  message?: string
} | null = null

/**
 * POST - 启动登录流程
 */
export async function POST(request: NextRequest) {
  try {
    const auth = getAuthFromHeaders(request)
    if (!auth) return NextResponse.json({ success: false, message: '请先登录' }, { status: 401 })
    if (auth.role !== 'admin') return NextResponse.json({ success: false, message: '仅管理员可操作' }, { status: 403 })

    // 如果已有活跃的登录进程，先终止
    if (activeLoginProcess?.pid) {
      try { process.kill(activeLoginProcess.pid, 'SIGTERM') } catch { /* ignore */ }
      activeLoginProcess.status = 'killed'
    }

    const body = await request.json().catch(() => ({}))
    const platform = body.platform || 'douyin'

    // 检查 MediaCrawler 是否存在
    const fs = await import('fs/promises')
    let pathExists = false
    try {
      await fs.access(getMediaCrawlerPath())
      pathExists = true
    } catch {
      return NextResponse.json({
        success: false,
        message: `MediaCrawler 路径不存在: ${getMediaCrawlerPath()}`,
        hint: '请检查 MediaCrawler 安装路径配置'
      }, { status: 400 })
    }

    if (!pathExists) {
      return NextResponse.json({
        success: false,
        message: 'MediaCrawler 未安装或路径错误',
        hint: `请确认 ${getMediaCrawlerPath()} 存在`
      }, { status: 400 })
    }

    // 新版 CLI: main.py --platform dy --lt qrcode
    const mcp = getMediaCrawlerPath()
    console.log(`[MC-Login] 启动登录: ${getPythonBin()} main.py --platform ${platform} --lt qrcode`)
    
    const proc = spawn(getPythonBin(), [
      `${mcp}/main.py`,
      '--platform', platform === 'douyin' ? 'dy' : platform,
      '--lt', 'qrcode',
      '--headless', 'false',
    ], {
      cwd: getMediaCrawlerPath(),
      env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUNBUFFERED: '1', DISPLAY: ':99' },
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: false,
    })

    let stdoutBuffer = ''
    let stderrBuffer = ''

    proc.stdout.on('data', (d: Buffer) => {
      stdoutBuffer += d.toString('utf-8')
      // 解析实时输出更新状态
      const lines = stdoutBuffer.split('\n').filter(l => l.trim())
      for (const line of lines) {
        try {
          const info = JSON.parse(line)
          if (info.status && activeLoginProcess) {
            Object.assign(activeLoginProcess, {
              status: info.status,
              message: info.message,
              qrcodeUrl: info.qrcodeUrl || info.qr_url,
              cookiePath: info.cookie_path,
            })
          }
        } catch { /* 非JSON行忽略 */ }
      }
    })

    proc.stderr.on('data', (d: Buffer) => {
      stderrBuffer += d.toString('utf-8')
    })

    // 初始化状态
    Object.assign(activeLoginProcess || {}, {
      pid: proc.pid,
      startedAt: Date.now(),
      status: 'starting',
      message: '正在启动浏览器...',
    })

    // 设置超时（2分钟）
    setTimeout(() => {
      if (activeLoginProcess?.status === 'waiting_scan' || activeLoginProcess?.status === 'starting') {
        try { proc.kill('SIGTERM') } catch { /* ignore */ }
        if (activeLoginProcess) {
          activeLoginProcess.status = 'timeout'
          activeLoginProcess.message = '扫码超时（120秒），请重试'
        }
      }
    }, 120000)

    proc.on('close', (code) => {
      if (activeLoginProcess) {
        if (code === 0 && activeLoginProcess.status !== 'error' && activeLoginProcess.status !== 'timeout') {
          activeLoginProcess.status = 'success'
          activeLoginProcess.message = activeLoginProcess.message || '登录成功，Cookie 已保存'
        } else if (activeLoginProcess.status !== 'timeout' && activeLoginProcess.status !== 'killed') {
          activeLoginProcess.status = 'error'
          activeLoginProcess.message = activeLoginProcess.message || `登录进程异常退出 (code: ${code})`
        }
        activeLoginProcess.pid = undefined
      }
    })

    return NextResponse.json({
      success: true,
      data: {
        status: 'starting',
        message: '登录进程已启动',
        platform,
        hint: '服务器需要有图形环境或已配置 Xvfb 虚拟显示器',
      },
    })

  } catch (error) {
    console.error('[MediaCrawler-Login] 启动失败:', error)
    return NextResponse.json({
      success: false,
      message: error instanceof Error ? error.message : '启动登录进程失败',
    }, { status: 500 })
  }
}

/**
 * GET - 获取当前登录状态
 */
export async function GET(request: NextRequest) {
  try {
    const auth = getAuthFromHeaders(request)
    if (!auth) return NextResponse.json({ success: false, message: '请先登录' }, { status: 401 })
    if (auth.role !== 'admin') return NextResponse.json({ success: false, message: '仅管理员可操作' }, { status: 403 })

    // 检查 Cookie 文件是否存在
    const fs = await import('fs/promises')
    const cookieDir = `${getMediaCrawlerPath()}/data/browser_data`
    let cookieFiles: string[] = []
    let cookieExists = false

    try {
      const files = await fs.readdir(cookieDir)
      cookieFiles = files.filter(f =>
        f.includes('cookie') || f.includes('douyin') || f.endsWith('.json')
      )
      cookieExists = cookieFiles.length > 0
    } catch {
      // 目录不存在
    }

    // 也检查 data/cookies 目录
    const altCookieDir = `${getMediaCrawlerPath()}/data/cookies`
    try {
      const files = await fs.readdir(altCookieDir)
      if (files.length > 0 && !cookieExists) {
        cookieFiles = files
        cookieExists = true
      }
    } catch {
      // 目录不存在
    }

    return NextResponse.json({
      success: true,
      data: {
        loginProcess: activeLoginProcess
          ? {
              status: activeLoginProcess.status,
              startedAt: activeLoginProcess.startedAt,
              elapsed: Date.now() - activeLoginProcess.startedAt,
              message: activeLoginProcess.message,
              qrcodeUrl: activeLoginProcess.qrcodeUrl,
              cookiePath: activeLoginProcess.cookiePath,
            }
          : null,
        cookies: {
          exists: cookieExists,
          files: cookieFiles,
          directory: cookieDir,
        },
        serverInfo: {
          hasDisplay: !!process.env.DISPLAY,
          mediaCrawlerPath: getMediaCrawlerPath(),
          pythonBin: getPythonBin(),
        },
      },
    })

  } catch (error) {
    console.error('[MediaCrawler-Login] 状态查询失败:', error)
    return NextResponse.json({
      success: false,
      message: error instanceof Error ? error.message : '查询状态失败',
    }, { status: 500 })
  }
}

/**
 * DELETE - 终止当前登录进程
 */
export async function DELETE(request: NextRequest) {
  try {
    const auth = getAuthFromHeaders(request)
    if (!auth) return NextResponse.json({ success: false, message: '请先登录' }, { status: 401 })
    if (auth.role !== 'admin') return NextResponse.json({ success: false, message: '仅管理员可操作' }, { status: 403 })

    if (activeLoginProcess?.pid) {
      try {
        process.kill(activeLoginProcess.pid, 'SIGTERM')
        activeLoginProcess.status = 'killed'
        activeLoginProcess.message = '用户手动取消登录'
        return NextResponse.json({ success: true, message: '登录进程已终止' })
      } catch (e) {
        return NextResponse.json({ success: false, message: '终止进程失败' }, { status: 500 })
      }
    }

    return NextResponse.json({ success: true, message: '没有活跃的登录进程' })

  } catch (error) {
    return NextResponse.json({ success: false, message: error instanceof Error ? error.message : '操作失败' }, { status: 500 })
  }
}
