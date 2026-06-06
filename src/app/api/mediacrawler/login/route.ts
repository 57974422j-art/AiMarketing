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

const MEDIA_CRAWLER_PATH = process.env.MEDIA_CRAWLER_PATH || '/opt/MediaCrawler'
const PYTHON_BIN = process.env.PYTHON_BIN || 'python3'

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
      await fs.access(MEDIA_CRAWLER_PATH)
      pathExists = true
    } catch {
      return NextResponse.json({
        success: false,
        message: `MediaCrawler 路径不存在: ${MEDIA_CRAWLER_PATH}`,
        hint: '请检查 MediaCrawler 安装路径配置'
      }, { status: 400 })
    }

    if (!pathExists) {
      return NextResponse.json({
        success: false,
        message: 'MediaCrawler 未安装或路径错误',
        hint: `请确认 ${MEDIA_CRAWLER_PATH} 存在`
      }, { status: 400 })
    }

    // 启动登录子进程
    // 使用 Python 脚本启动 Playwright 浏览器并获取二维码
    const loginScript = `
import json, sys, os, time, subprocess
sys.path.insert(0, '${MEDIA_CRAWLER_PATH}')

result = {"status": "starting"}

try:
    # 尝试导入 MediaCrawler 的登录模块
    from media_crawler.login.login import Login
    login = Login(platform='${platform}')
    
    # 输出等待扫码状态
    result["status"] = "waiting_scan"
    print(json.dumps(result, ensure_ascii=False))
    sys.stdout.flush()
    
    # 执行登录（会弹出浏览器或获取二维码）
    login_result = login.do_login()
    
    if login_result and login_result.get("success"):
        result["status"] = "success"
        result["message"] = "登录成功，Cookie 已保存"
        result["cookie_path"] = login_result.get("cookie_path", "")
    else:
        result["status"] = "error"
        result["message"] = login_result.get("message", "登录失败") if login_result else "未知错误"
    
    print(json.dumps(result, ensure_ascii=False))
    
except ImportError:
    # fallback: 使用 main.py --login 方式
    print(json.dumps({"status": "waiting_scan", "message": "正在启动浏览器，请在服务器桌面扫码..."}, ensure_ascii=False))
    sys.stdout.flush()
    
    proc = subprocess.Popen(
        ['${PYTHON_BIN}', '${MEDIA_CRAWLER_PATH}/main.py', '--login', '--platform', '${platform}'],
        cwd='${MEDIA_CRAWLER_PATH}',
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        env={**os.environ, "DISPLAY": ":99"}
    )
    stdout, stderr = proc.communicate(timeout=120)
    
    if proc.returncode == 0:
        print(json.dumps({"status": "success", "message": "登录成功"}, ensure_ascii=False))
    else:
        print(json.dumps({
            "status": "error",
            "message": f"登录进程退出码: {proc.returncode}",
            "detail": stderr.decode("utf-8", errors="ignore")[-500:]
        }, ensure_ascii=False))

except Exception as e:
    result["status"] = "error"
    result["message"] = str(e)
    import traceback
    result["detail"] = traceback.format_exc()[-1000:]
    print(json.dumps(result, ensure_ascii=False))
`

    const proc = spawn(PYTHON_BIN, ['-c', loginScript], {
      cwd: MEDIA_CRAWLER_PATH,
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
    const cookieDir = `${MEDIA_CRAWLER_PATH}/data/browser_data`
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
    const altCookieDir = `${MEDIA_CRAWLER_PATH}/data/cookies`
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
          mediaCrawlerPath: MEDIA_CRAWLER_PATH,
          pythonBin: PYTHON_BIN,
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
