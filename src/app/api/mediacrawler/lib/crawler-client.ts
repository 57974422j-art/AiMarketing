/**
 * MediaCrawler 客户端 - Python 进程桥接
 *
 * 通过 child_process 调用 MediaCrawler Python 脚本，
 * 实现进程隔离、超时控制、错误处理。
 *
 * 功能模块:
 *  - crawl(): 数据爬取 (search/comments/user/trending/detail)
 *  - checkHealth(): 健康检查
 *  - getProxyPool(): 获取代理配置（供爬取时注入）
 *
 * 使用方式：
 * import { crawl } from '@/app/api/mediacrawler/lib/crawler-client'
 * const result = await crawl('search', { keyword: '美业', count: '20' })
 */

import { spawn } from 'child_process'
import { readFile } from 'fs/promises'
import { join } from 'path'

const getMediaCrawlerPath() = process.env.getMediaCrawlerPath() || '/opt/MediaCrawler'
const getPythonBin() = process.env.getPythonBin() || 'python3'
const DEFAULT_TIMEOUT = 60000

function getPythonBin(): string { return process.env.getPythonBin() || 'python3' }
function getMediaCrawlerPath(): string { return process.env.getMediaCrawlerPath() || '/opt/MediaCrawler' } // 60s

// 代理池配置文件路径
const PROXY_POOL_PATH = join(process.cwd(), '.proxy-pool.json')

export interface CrawlerOptions {
  timeout?: number   // 毫秒，默认 60000
  platform?: string  // 默认 douyin
}

export interface CrawlerError {
  code: string
  message: string
  retryable: boolean
  detail?: string
  hint?: string
}

/**
 * MediaCrawler 统一响应格式
 */
export interface CrawlerResponse<T = unknown> {
  success: boolean
  data?: T
  error?: CrawlerError
  meta?: {
    source: string
    crawledAt: string
    costMs: number
  }
}

/**
 * 调用 MediaCrawler 执行爬取任务
 *
 * @param action - 操作类型: search | comments | user | trending | detail
 * @param params - 传递给爬虫的参数（全部转为字符串）
 * @param options - 超时等选项
 */
export async function crawl<T = unknown>(
  action: 'search' | 'comments' | 'user' | 'trending' | 'detail',
  params: Record<string, string>,
  options: CrawlerOptions = {}
): Promise<CrawlerResponse<T>> {
  const { timeout = DEFAULT_TIMEOUT } = options
  const startTime = Date.now()

  return new Promise((resolve) => {
    // 构建内联 Python 调用脚本
    const script = buildPythonScript(action, params)

    const proc = spawn(getPythonBin(), ['-c', script], {
      cwd: getMediaCrawlerPath(),
      env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUNBUFFERED: '1' },
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: false,
    })

    let stdout = ''
    let stderr = ''

    proc.stdout.on('data', (data: Buffer) => {
      stdout += data.toString('utf-8')
    })

    proc.stderr.on('data', (data: Buffer) => {
      stderr += data.toString('utf-8')
    })

    // 超时控制
    const timer = setTimeout(() => {
      proc.kill('SIGTERM')
      // 强制清理
      try { process.kill(-proc.pid!, 'SIGTERM') } catch { /* ignore */ }

      resolve({
        success: false,
        error: {
          code: 'TIMEOUT',
          message: `MediaCrawler ${action} 执行超时 (${timeout}ms)`,
          retryable: true,
          hint: '可尝试减少 count 参数或检查网络连接',
          detail: stderr.slice(0, 500),
        },
        meta: {
          source: 'mediacrawler',
          crawledAt: new Date().toISOString(),
          costMs: Date.now() - startTime,
        },
      })
    }, timeout)

    proc.on('close', (code) => {
      clearTimeout(timer)
      const costMs = Date.now() - startTime

      if (code === 0 || code === null) {
        try {
          // 尝试从 stdout 解析 JSON
          const result = JSON.parse(stdout.trim())
          resolve({
            success: true,
            data: result as T,
            meta: {
              source: 'mediacrawler',
              crawledAt: new Date().toISOString(),
              costMs,
            },
          })
        } catch (e) {
          // JSON 解析失败，可能输出的是纯文本或错误信息
          if (stdout.trim()) {
            resolve({
              success: true,
              data: { raw: stdout.trim() } as T,
              meta: {
                source: 'mediacrawler',
                crawledAt: new Date().toISOString(),
                costMs,
              },
            })
          } else {
            resolve({
              success: false,
              error: {
                code: 'PARSE_ERROR',
                message: '解析爬虫输出失败，无有效返回数据',
                retryable: false,
                detail: `stdout: ${stdout.slice(0, 200)}\nstderr: ${stderr.slice(0, 500)}`,
              },
              meta: { source: 'mediacrawler', crawledAt: new Date().toISOString(), costMs },
            })
          }
        }
      } else {
        resolve({
          success: false,
          error: {
            code: 'CRAWLER_ERROR',
            message: `MediaCrawler 退出码: ${code}`,
            retryable: code !== 1, // exit 1 通常是参数错误
            detail: stderr.slice(0, 1000),
            hint: code === 1 ? '检查参数是否正确' : '可能是 cookie 过期或网络问题',
          },
          meta: { source: 'mediacrawler', crawledAt: new Date().toISOString(), costMs },
        })
      }
    })

    proc.on('error', (err) => {
      clearTimeout(timer)
      resolve({
        success: false,
        error: {
          code: 'SPAWN_ERROR',
          message: `无法启动 MediaCrawler 进程: ${err.message}`,
          retryable: false,
          hint: `确认 Python (${getPythonBin()}) 已安装且 MediaCrawler 路径 (${getMediaCrawlerPath()}) 正确`,
        },
        meta: { source: 'mediacrawler', crawledAt: new Date().toISOString(), costMs: Date.now() - startTime },
      })
    })
  })
}

/**
 * 构建内联 Python 脚本
 */
function buildPythonScript(
  action: string,
  params: Record<string, string>
): string {
  const paramsJson = JSON.stringify(params)

  return `
import json, sys, os, asyncio
sys.path.insert(0, '${getMediaCrawlerPath()}')
os.chdir('${getMediaCrawlerPath()}')

async def _do():
    from media_platform.douyin.client import DouYinClient
    client = DouYinClient()
    p = ${paramsJson}
    if '${action}' == 'search':
        return await client.search_info_by_keyword(keyword=p.get('keyword',''))
    elif '${action}' == 'comments':
        return await client.get_aweme_all_comments(aweme_id=p.get('aweme_id',''))
    elif '${action}' == 'user':
        return await client.get_user_info(sec_user_id=p.get('sec_user_id',''))
    elif '${action}' == 'detail':
        return await client.get_video_by_id(aweme_id=p.get('aweme_id',''))
    elif '${action}' == 'trending':
        return {"error":"请用 main.py --platform dy --type search 搜索"}
    return {"error":"Unknown: ${action}"}

try:
    result = asyncio.run(_do())
except ImportError as e:
    result = {"error":"Import: "+str(e)}
except Exception as e:
    result = {"error":type(e).__name__+": "+str(e)}

print(json.dumps(result, ensure_ascii=False))
`.trim()
}

/**
 * 检查 MediaCrawler 是否可用（不执行实际爬取）
 */
export async function checkHealth(): Promise<{
  available: boolean
  pythonOk: boolean
  pathExists: boolean
  version?: string
  error?: string
}> {
  // 检查路径
  const fs = await import('fs/promises')
  let pathExists = false
  try {
    await fs.access(getMediaCrawlerPath())
    pathExists = true
  } catch {
    pathExists = false
  }

  if (!pathExists) {
    return {
      available: false,
      pythonOk: false,
      pathExists: false,
      error: `MediaCrawler 路径不存在: ${getMediaCrawlerPath()}`,
    }
  }

  // 检查 Python 和基本导入
  return new Promise((resolve) => {
    const proc = spawn(getPythonBin(), ['-c', `
import sys; sys.path.insert(0, '${getMediaCrawlerPath()}')
try:
    import media_platform
    print(json.dumps({"ok": True, "version": "ok"}))
except ImportError as e:
    print(json.dumps({"ok": False, "error": str(e)}))
`], {
      cwd: getMediaCrawlerPath(),
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    let out = ''
    proc.stdout.on('data', (d: Buffer) => { out += d.toString() })

    const timer = setTimeout(() => {
      proc.kill()
      resolve({ available: false, pythonOk: false, pathExists: true, error: 'Python 健康检查超时' })
    }, 10000)

    proc.on('close', () => {
      clearTimeout(timer)
      try {
        const info = JSON.parse(out.trim())
        resolve({
          available: info.ok === true,
          pythonOk: info.ok === true,
          pathExists: true,
          version: info.version,
          error: info.error,
        })
      } catch {
        resolve({
          available: false,
          pythonOk: false,
          pathExists: true,
          error: `Python 输出异常: ${out.slice(0, 200)}`,
        })
      }
    })
  })
}

// ==================== Proxy Pool Support ====================

export interface ProxyItem {
  id: string
  host: string
  port: number
  protocol: string
  username?: string
  password?: string
  enabled: boolean
  label?: string
  region?: string
  type?: string
  testStatus?: string
  testLatencyMs?: number
  usedCount?: number
  lastUsedAt?: string
}

/**
 * 获取当前代理池配置（供 crawl() 调用时自动注入）
 * 返回一个可用的代理 URL 或 null（不使用代理）
 */
export async function getProxyForRequest(): Promise<string | null> {
  try {
    const content = await readFile(PROXY_POOL_PATH, 'utf-8')
    const pool = JSON.parse(content)

    // 检查是否全局启用
    if (!pool.settings?.globalEnabled) return null

    // 筛选可用代理
    const enabledProxies = (pool.proxies || []).filter(
      (p: ProxyItem) => p.enabled && p.testStatus !== 'fail'
    )

    if (enabledProxies.length === 0) return null

    // 简单轮询：选择使用次数最少的
    const sorted = [...enabledProxies].sort(
      (a: ProxyItem, b: ProxyItem) => (a.usedCount ?? 0) - (b.usedCount ?? 0)
    )
    const proxy = sorted[0]

    // 构建 proxy URL
    if (proxy.username && proxy.password) {
      return `${proxy.protocol}://${proxy.username}:${proxy.password}@${proxy.host}:${proxy.port}`
    }
    return `${proxy.protocol}://${proxy.host}:${proxy.port}`
  } catch {
    // 配置文件不存在或解析失败，不使用代理
    return null
  }
}

/**
 * 标记代理使用成功/失败（用于自动轮换和封禁检测）
 */
export async function markProxyResult(proxyUrl: string | null, success: boolean): Promise<void> {
  if (!proxyUrl) return

  try {
    const { writeFile: write } = await import('fs/promises')
    const content = await readFile(PROXY_POOL_PATH, 'utf-8')
    const pool = JSON.parse(content)

    // 从 URL 提取 host:port 匹配代理
    let urlHost = ''
    let urlPort = 0
    try {
      const u = new URL(proxyUrl)
      urlHost = u.hostname
      urlPort = parseInt(u.port, 10)
    } catch { return }

    const proxy = (pool.proxies || []).find(
      (p: ProxyItem) => p.host === urlHost && p.port === urlPort
    )
    if (proxy) {
      proxy.usedCount = (proxy.usedCount ?? 0) + 1
      proxy.lastUsedAt = new Date().toISOString()
      await write(PROXY_POOL_PATH, JSON.stringify(pool, null, 2), 'utf-8')
    }
  } catch { /* ignore */ }
}
