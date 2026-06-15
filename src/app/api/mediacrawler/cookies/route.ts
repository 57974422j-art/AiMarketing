/**
 * MediaCrawler Cookie 管理 API
 *
 * GET    /api/mediacrawler/cookies  - 列出当前 cookie 文件和状态
 * DELETE /api/mediacrawler/cookies  - 清除指定或全部 cookie
 * POST   /api/mediacrawler/cookies  - 验证 cookie 是否有效
 */

import { NextRequest, NextResponse } from 'next/server'
import { getAuthFromHeaders } from '@/lib/api-auth'
import { spawn } from 'child_process'

const MEDIA_CRAWLER_PATH = process.env.MEDIA_CRAWLER_PATH || '/opt/MediaCrawler'
const PYTHON_BIN = process.env.PYTHON_BIN || 'python3'

interface CookieFile {
  name: string
  path: string
  size: number
  modifiedAt: string
}

/**
 * GET - 列出所有 cookie 文件及其状态
 */
export async function GET(request: NextRequest) {
  try {
    const auth = getAuthFromHeaders(request)
    if (!auth) return NextResponse.json({ success: false, message: '请先登录' }, { status: 401 })
    if (auth.role !== 'admin') return NextResponse.json({ success: false, message: '仅管理员可操作' }, { status: 403 })

    const fs = await import('fs/promises')
    const pathModule = await import('path')

    // 搜索可能的 cookie 目录位置
    const searchDirs = [
      `${MEDIA_CRAWLER_PATH}/data/browser_data`,
      `${MEDIA_CRAWLER_PATH}/data/cookies`,
      `${MEDIA_CRAWLER_PATH}/browser_data`,
      `${MEDIA_CRAWLER_PATH}/data`,
    ]

    const allCookies: CookieFile[] = []

    for (const dir of searchDirs) {
      try {
        const stat = await fs.stat(dir)
        if (!stat.isDirectory()) continue

        const files = await fs.readdir(dir)
        for (const file of files) {
          const filePath = pathModule.join(dir, file)
          try {
            const fileStat = await fs.stat(filePath)
            if (fileStat.isFile() && (
              file.includes('cookie') ||
              file.includes('douyin') ||
              file.endsWith('.json') ||
              file === 'Local State'
            )) {
              allCookies.push({
                name: file,
                path: filePath,
                size: fileStat.size,
                modifiedAt: fileStat.mtime.toISOString(),
              })
            }
          } catch { /* skip */ }
        }
      } catch { /* 目录不存在，跳过 */ }
    }

    // 尝试读取 cookie 内容摘要（不返回完整 cookie 值）
    let cookiePreview: Array<{ platform: string; accounts: string[]; expires?: string }> = []

    for (const cf of allCookies.slice(0, 5)) {
      if (cf.name.endsWith('.json') && cf.size < 10 * 1024 * 1024) { // 只读小于 10MB 的 JSON
        try {
          const content = await fs.readFile(cf.path, 'utf-8')
          const parsed = JSON.parse(content)

          if (Array.isArray(parsed)) {
            // cookie 数组格式 [{name, value, domain, ...}]
            const domains = [...new Set((parsed as any[]).map(c => c.domain).filter(Boolean))]
            cookiePreview.push({
              platform: cf.name.replace(/[_\-\.](cookie|json)/gi, ''),
              accounts: domains.slice(0, 5),
              expires: (parsed as any[])?.[0]?.expires || undefined,
            })
          } else if (typeof parsed === 'object' && parsed !== null) {
            // 可能是用户信息或其他结构
            const keys = Object.keys(parsed).slice(0, 5)
            cookiePreview.push({
              platform: cf.name.split('.')[0],
              accounts: keys,
            })
          }
        } catch {
          // 无法解析的文件
          cookiePreview.push({
            platform: cf.name.split('.')[0],
            accounts: [`(二进制/加密文件, ${cf.size} bytes)`],
          })
        }
      }
    }

    // 检查 cookie 是否过期（简单验证）
    let validationStatus = 'unknown' as 'valid' | 'expired' | 'missing' | 'error' | 'unknown'
    let lastValidated: string | null = null

    if (allCookies.length > 0) {
      // 使用 Python 快速验证 cookie
      try {
        const result = await new Promise<any>((resolve) => {
          const proc = spawn(PYTHON_BIN, ['-c', `
import json, sys, os, glob
sys.path.insert(0, '${MEDIA_CRAWLER_PATH}')

result = {"status": "unknown"}

try:
    # 查找 cookie 文件
    patterns = [
        "${MEDIA_CRAWLER_PATH}/data/browser_data/**/*cookie*",
        "${MEDIA_CRAWLER_PATH}/data/cookies/**/*.json",
        "${MEDIA_CRAWLER_PATH}/data/**/douyin*.json",
    ]
    
    files = []
    for p in patterns:
        files.extend(glob.glob(p, recursive=True))
    
    if not files:
        result["status"] = "missing"
        result["message"] = "未找到 cookie 文件"
    else:
        # 尝试读取并检查是否为空
        for f in files[:1]:
            with open(f, 'r', encoding='utf-8', errors='ignore') as fp:
                content = fp.read()
                if len(content) > 50:
                    result["status"] = "valid"
                    result["file"] = f
                    result["size"] = len(content)
                else:
                    result["status"] = "expired"
                    result["message"] = f"Cookie 文件可能已失效 ({f})"
        
    print(json.dumps(result, ensure_ascii=False))
except Exception as e:
    result["status"] = "error"
    result["message"] = str(e)
    print(json.dumps(result, ensure_ascii=False))
`], {
            cwd: MEDIA_CRAWLER_PATH,
            env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
            stdio: ['pipe', 'pipe', 'pipe'],
          })

          let out = ''
          proc.stdout.on('data', (d: Buffer) => { out += d.toString() })

          const timer = setTimeout(() => {
            proc.kill()
            resolve({ status: 'timeout' })
          }, 10000)

          proc.on('close', () => {
            clearTimeout(timer)
            try { resolve(JSON.parse(out.trim()) )} catch { resolve({ status: 'parse_error', raw: out.slice(0, 200) }) }
          })
        })

        validationStatus = result.status || 'unknown'
        lastValidated = new Date().toISOString()
      } catch {
        validationStatus = 'error'
      }
    } else {
      validationStatus = 'missing'
    }

    return NextResponse.json({
      success: true,
      data: {
        cookies: allCookies.sort((a, b) =>
          new Date(b.modifiedAt).getTime() - new Date(a.modifiedAt).getTime()
        ),
        preview: cookiePreview,
        validation: {
          status: validationStatus,
          lastChecked: lastValidated,
        },
        summary: {
          totalFiles: allCookies.length,
          totalSize: allCookies.reduce((s, c) => s + c.size, 0),
          oldestDate: allCookies.length > 0 ? allCookies[allCookies.length - 1].modifiedAt : null,
          newestDate: allCookies.length > 0 ? allCookies[0].modifiedAt : null,
        },
      },
    })

  } catch (error) {
    console.error('[MediaCrawler-Cookies] 查询失败:', error)
    return NextResponse.json({
      success: false,
      message: error instanceof Error ? error.message : '查询失败',
    }, { status: 500 })
  }
}

/**
 * POST - 验证 cookie 有效性（发送测试请求）
 */
export async function POST(request: NextRequest) {
  try {
    const auth = getAuthFromHeaders(request)
    if (!auth) return NextResponse.json({ success: false, message: '请先登录' }, { status: 401 })
    if (auth.role !== 'admin') return NextResponse.json({ success: false, message: '仅管理员可操作' }, { status: 403 })

    const body = await request.json().catch(() => ({}))
    const action = body.action || 'validate'

    if (action === 'import') {
      // 手动导入 Cookie：从浏览器DevTools复制Cookie字符串，写入MediaCrawler格式
      const cookieString: string = body.cookieString || ''
      if (!cookieString.trim()) {
        return NextResponse.json({ success: false, message: 'Cookie字符串不能为空' }, { status: 400 })
      }

      // 解析 Cookie 字符串 "key1=val1; key2=val2; ..."
      const cookies = cookieString.split(';').map(pair => {
        const [name, ...valParts] = pair.trim().split('=')
        return {
          name: name.trim(),
          value: valParts.join('=').trim(),
          domain: '.douyin.com',
          path: '/',
          httpOnly: false,
          secure: true,
        }
      }).filter(c => c.name && c.value)

      if (cookies.length === 0) {
        return NextResponse.json({ success: false, message: '未能解析到有效Cookie' }, { status: 400 })
      }

      try {
        const fs = await import('fs/promises')
        const pathModule = await import('path')
        const cookieDir = pathModule.join(MEDIA_CRAWLER_PATH, 'data', 'cookies')
        await fs.mkdir(cookieDir, { recursive: true })
        const filePath = pathModule.join(cookieDir, 'douyin_cookies.json')
        await fs.writeFile(filePath, JSON.stringify(cookies, null, 2), 'utf-8')

        // 同时也写一份到 browser_data 目录（MediaCrawler可能从这里读）
        const browserCookieDir = pathModule.join(MEDIA_CRAWLER_PATH, 'data', 'browser_data')
        await fs.mkdir(browserCookieDir, { recursive: true })
        await fs.writeFile(
          pathModule.join(browserCookieDir, 'douyin_cookies.json'),
          JSON.stringify(cookies, null, 2),
          'utf-8'
        )

        const summary = cookies.map(c => c.name).slice(0, 8).join(', ')
        return NextResponse.json({
          success: true,
          message: `已导入 ${cookies.length} 个Cookie: ${summary}${cookies.length > 8 ? '...' : ''}`,
          data: { count: cookies.length, path: filePath },
        })
      } catch (e: any) {
        return NextResponse.json({ success: false, message: `写入失败: ${e.message}` }, { status: 500 })
      }
    }

    if (action === 'validate') {
      // 发送一个轻量级请求验证 cookie 是否有效
      const validateScript = `
import json, sys, os
sys.path.insert(0, '${MEDIA_CRAWLER_PATH}')

result = {"status": "error", "message": ""}

try:
    import urllib.request
    import urllib.error
    
    # 尝试访问抖音个人主页来验证 cookie
    req = urllib.request.Request(
        'https://www.douyin.com/user/self?from_page_name=user_center',
        headers={
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        }
    )
    
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor())
    resp = opener.open(req, timeout=15)
    
    html = resp.read().decode('utf-8', errors='ignore')
    
    if 'login' in resp.url.lower() or 'passport' in resp.url.lower():
        result["status"] = "expired"
        result["message"] = "Cookie 已过期，被重定向到登录页"
    elif len(html) > 1000:
        result["status"] = "valid"
        result["message"] = f"Cookie 有效 (响应大小: {len(html)} bytes)"
    else:
        result["status"] = "warning"
        result["message"] = f"Cookie 可能部分有效 (响应: {len(html)} bytes)"

except urllib.error.HTTPError as e:
    if e.code == 403:
        result["status"] = "expired"
        result["message"] = f"HTTP 403 - Cookie 已失效或被封禁"
    else:
        result["status"] = "error"
        result["message"] = f"HTTP {e.code}"
except Exception as e:
    result["status"] = "error"
    result["message"] = str(e)[:200]

print(json.dumps(result, ensure_ascii=False))
`

      const validationResult = await new Promise<any>((resolve) => {
        const proc = spawn(PYTHON_BIN, ['-c', validateScript], {
          cwd: MEDIA_CRAWLER_PATH,
          env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
          stdio: ['pipe', 'pipe', 'pipe'],
        })

        let out = ''
        let err = ''
        proc.stdout.on('data', (d: Buffer) => { out += d.toString() })
        proc.stderr.on('data', (d: Buffer) => { err += d.toString() })

        const timer = setTimeout(() => {
          proc.kill()
          resolve({ status: 'timeout', message: '验证请求超时' })
        }, 30000)

        proc.on('close', () => {
          clearTimeout(timer)
          try { resolve(JSON.parse(out.trim())) }
          catch { resolve({ status: 'error', message: `解析失败: ${err.slice(0, 200)}` }) }
        })
      })

      return NextResponse.json({
        success: true,
        data: {
          validated: true,
          ...validationResult,
          checkedAt: new Date().toISOString(),
        },
      })
    }

    return NextResponse.json({ success: false, message: `未知操作: ${action}` }, { status: 400 })

  } catch (error) {
    console.error('[MediaCrawler-Cookies] 操作失败:', error)
    return NextResponse.json({
      success: false,
      message: error instanceof Error ? error.message : '操作失败',
    }, { status: 500 })
  }
}

/**
 * DELETE - 清除 cookie 文件
 */
export async function DELETE(request: NextRequest) {
  try {
    const auth = getAuthFromHeaders(request)
    if (!auth) return NextResponse.json({ success: false, message: '请先登录' }, { status: 401 })
    if (auth.role !== 'admin') return NextResponse.json({ success: false, message: '仅管理员可操作' }, { status: 403 })

    const url = new URL(request.url)
    const fileName = url.searchParams.get('file')

    const fs = await import('fs/promises')
    const pathModule = await import('path')

    if (fileName) {
      // 删除指定文件（安全检查：必须在 MediaCrawler 目录内）
      const targetPath = pathModule.resolve(MEDIA_CRAWLER_PATH, fileName)
      if (!targetPath.startsWith(MEDIA_CRAWLER_PATH)) {
        return NextResponse.json({ success: false, message: '非法路径' }, { status: 400 })
      }

      await fs.unlink(targetPath)
      console.log(`[MediaCrawler-Cookies] 已删除: ${targetPath}`)
      return NextResponse.json({ success: true, message: `已删除: ${fileName}` })
    }

    // 删除所有 cookie 相关文件
    const searchDirs = [
      `${MEDIA_CRAWLER_PATH}/data/browser_data`,
      `${MEDIA_CRAWLER_PATH}/data/cookies`,
    ]

    let deletedCount = 0
    const errors: string[] = []

    for (const dir of searchDirs) {
      try {
        const files = await fs.readdir(dir)
        for (const file of files) {
          if (file.includes('cookie') || file.includes('douyin') || file.includes('browser')) {
            try {
              await fs.unlink(pathModule.join(dir, file))
              deletedCount++
            } catch (e: any) {
              errors.push(`${file}: ${e.message}`)
            }
          }
        }
      } catch { /* 目录不存在 */ }
    }

    return NextResponse.json({
      success: true,
      message: deletedCount > 0 ? `已删除 ${deletedCount} 个文件` : '没有找到可删除的 cookie 文件',
      data: { deletedCount, errors },
    })

  } catch (error) {
    console.error('[MediaCrawler-Cookies] 删除失败:', error)
    return NextResponse.json({
      success: false,
      message: error instanceof Error ? error.message : '删除失败',
    }, { status: 500 })
  }
}
