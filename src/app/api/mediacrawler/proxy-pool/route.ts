/**
 * MediaCrawler IP 代理池管理 API
 *
 * GET    /api/mediacrawler/proxy-pool  - 获取代理池列表
 * POST   /api/mediacrawler/proxy-pool  - 添加/更新代理
 * DELETE /api/mediacrawler/proxy-pool  - 删除指定代理
 * PATCH  /api/mediacrawler/proxy-pool  - 测试单个代理连通性
 */

import { NextRequest, NextResponse } from 'next/server'
import { getAuthFromHeaders } from '@/lib/api-auth'
import { readFile, writeFile } from 'fs/promises'
import { join } from 'path'

// 代理配置文件路径
const PROXY_CONFIG_PATH = join(process.cwd(), '.proxy-pool.json')

export interface ProxyItem {
  id: string              // 唯一标识 (自动生成)
  host: string            // 代理主机地址 (IP 或域名)
  port: number            // 端口
  protocol: 'http' | 'https' | 'socks5'  // 协议类型
  username?: string       // 认证用户名（可选）
  password?: string       // 认证密码（可选）
  enabled: boolean        // 是否启用
  label?: string          // 自定义标签（如"美国节点"、"住宅IP"等）
  region?: string         // 地区代码 (CN, US, HK 等)
  type?: 'datacenter' | 'residential' | 'mobile'  // 代理类型
  maxUses?: number        // 最大使用次数 (-1 = 无限)
  usedCount: number       // 已使用次数
  lastUsedAt?: string     // 最后使用时间
  lastTestAt?: string     // 最后测试时间
  testStatus?: 'ok' | 'slow' | 'fail' | 'untested'  // 测试结果
  testLatencyMs?: number  // 测试延迟(ms)
  createdAt: string       // 创建时间
}

interface ProxyPoolData {
  proxies: ProxyItem[]
  settings: {
    autoRotate: boolean           // 是否自动轮换
    rotateInterval: number        // 轮换间隔(请求数)，默认 10
    failoverOnBan: boolean        // 被封禁时自动切换
    banThreshold: number          // 封禁检测阈值(连续失败次数)
    globalEnabled: boolean        // 是否全局启用代理
  }
}

/**
 * 默认设置
 */
const DEFAULT_SETTINGS: ProxyPoolData['settings'] = {
  autoRotate: true,
  rotateInterval: 10,
  failoverOnBan: true,
  banThreshold: 3,
  globalEnabled: false,
}

/**
 * 读取代理池配置
 */
async function readProxyPool(): Promise<ProxyPoolData> {
  try {
    const content = await readFile(PROXY_CONFIG_PATH, 'utf-8')
    return JSON.parse(content)
  } catch {
    return { proxies: [], settings: { ...DEFAULT_SETTINGS } }
  }
}

/**
 * 写入代理池配置
 */
async function writeProxyPool(data: ProxyPoolData): Promise<void> {
  await writeFile(PROXY_CONFIG_PATH, JSON.stringify(data, null, 2), 'utf-8')
}

/**
 * 生成唯一 ID
 */
function generateId(): string {
  return `px_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

/**
 * GET - 获取代理池列表和状态
 */
export async function GET(request: NextRequest) {
  try {
    const auth = getAuthFromHeaders(request)
    if (!auth) return NextResponse.json({ success: false, message: '请先登录' }, { status: 401 })
    if (auth.role !== 'admin') return NextResponse.json({ success: false, message: '仅管理员可操作' }, { status: 403 })

    const pool = await readProxyPool()

    // 计算统计信息
    const stats = {
      total: pool.proxies.length,
      enabled: pool.proxies.filter(p => p.enabled).length,
      ok: pool.proxies.filter(p => p.testStatus === 'ok').length,
      fail: pool.proxies.filter(p => p.testStatus === 'fail').length,
      untested: pool.proxies.filter(p => !p.testStatus || p.testStatus === 'untested').length,
      byProtocol: {
        http: pool.proxies.filter(p => p.protocol === 'http').length,
        https: pool.proxies.filter(p => p.protocol === 'https').length,
        socks5: pool.proxies.filter(p => p.protocol === 'socks5').length,
      },
      byType: {
        datacenter: pool.proxies.filter(p => p.type === 'datacenter').length,
        residential: pool.proxies.filter(p => p.type === 'residential').length,
        mobile: pool.proxies.filter(p => p.type === 'mobile').length,
      },
    }

    return NextResponse.json({
      success: true,
      data: {
        ...pool,
        stats,
      },
    })
  } catch (error) {
    console.error('[ProxyPool] GET 失败:', error)
    return NextResponse.json({ success: false, message: error instanceof Error ? error.message : '查询失败' }, { status: 500 })
  }
}

/**
 * POST - 添加新代理或批量导入
 */
export async function POST(request: NextRequest) {
  try {
    const auth = getAuthFromHeaders(request)
    if (!auth) return NextResponse.json({ success: false, message: '请先登录' }, { status: 401 })
    if (auth.role !== 'admin') return NextResponse.json({ success: false, message: '仅管理员可操作' }, { status: 403 })

    const body = await request.json()
    const pool = await readProxyPool()

    // 支持单条添加或批量添加
    const items: any[] = Array.isArray(body) ? body : [body]
    const added: ProxyItem[] = []

    for (const item of items) {
      // 验证必填字段
      if (!item.host || !item.port) {
        continue
      }

      const newProxy: ProxyItem = {
        id: generateId(),
        host: item.host.trim(),
        port: parseInt(String(item.port), 10),
        protocol: item.protocol || 'http',
        username: item.username || undefined,
        password: item.password || undefined,
        enabled: item.enabled !== false,
        label: item.label || undefined,
        region: item.region || undefined,
        type: item.type || undefined,
        maxUses: item.maxUses ?? -1,
        usedCount: 0,
        createdAt: new Date().toISOString(),
        testStatus: 'untested',
      }

      // 检查重复
      const duplicate = pool.proxies.find(
        p => p.host === newProxy.host && p.port === newProxy.port && p.protocol === newProxy.protocol
      )
      if (duplicate) {
        // 更新已有记录
        Object.assign(duplicate, newProxy, { id: duplicate.id, createdAt: duplicate.createdAt })
      } else {
        pool.proxies.push(newProxy)
        added.push(newProxy)
      }
    }

    await writeProxyPool(pool)

    return NextResponse.json({
      success: true,
      message: `已添加 ${added.length} 个代理`,
      data: { added, total: pool.proxies.length },
    })
  } catch (error) {
    console.error('[ProxyPool] POST 失败:', error)
    return NextResponse.json({ success: false, message: error instanceof Error ? error.message : '添加失败' }, { status: 500 })
  }
}

/**
 * DELETE - 删除指定代理或清空全部
 */
export async function DELETE(request: NextRequest) {
  try {
    const auth = getAuthFromHeaders(request)
    if (!auth) return NextResponse.json({ success: false, message: '请先登录' }, { status: 401 })
    if (auth.role !== 'admin') return NextResponse.json({ success: false, message: '仅管理员可操作' }, { status: 403 })

    const url = new URL(request.url)
    const proxyId = url.searchParams.get('id')
    const clearAll = url.searchParams.get('clear') === 'true'

    const pool = await readProxyPool()

    if (clearAll) {
      const count = pool.proxies.length
      pool.proxies = []
      await writeProxyPool(pool)
      return NextResponse.json({ success: true, message: `已清空 ${count} 个代理` })
    }

    if (proxyId) {
      const index = pool.proxies.findIndex(p => p.id === proxyId)
      if (index === -1) {
        return NextResponse.json({ success: false, message: '代理不存在' }, { status: 404 })
      }
      const removed = pool.proxies.splice(index, 1)[0]
      await writeProxyPool(pool)
      return NextResponse.json({
        success: true,
        message: `已删除: ${removed.label || `${removed.host}:${removed.port}`}`,
      })
    }

    return NextResponse.json({ success: false, message: '请提供 id 参数或 clear=true' }, { status: 400 })
  } catch (error) {
    console.error('[ProxyPool] DELETE 失败:', error)
    return NextResponse.json({ success: false, message: error instanceof Error ? error.message : '删除失败' }, { status: 500 })
  }
}

/**
 * PATCH - 测试代理 / 更新设置 / 切换启用状态
 */
export async function PATCH(request: NextRequest) {
  try {
    const auth = getAuthFromHeaders(request)
    if (!auth) return NextResponse.json({ success: false, message: '请先登录' }, { status: 401 })
    if (auth.role !== 'admin') return NextResponse.json({ success: false, message: '仅管理员可操作' }, { status: 403 })

    const body = await request.json()
    const action = body.action  // 'test' | 'toggle' | 'settings'

    const pool = await readProxyPool()

    if (action === 'test') {
      // 测试单个代理的连通性
      const proxyId = body.id
      if (!proxyId) return NextResponse.json({ success: false, message: '缺少 id' }, { status: 400 })

      const proxy = pool.proxies.find(p => p.id === proxyId)
      if (!proxy) return NextResponse.json({ success: false, message: '代理不存在' }, { status: 404 })

      // 执行连通性测试
      const result = await testProxyConnection(proxy)
      proxy.testStatus = result.ok ? 'ok' : 'fail'
      proxy.testLatencyMs = result.latency
      proxy.lastTestAt = new Date().toISOString()

      await writeProxyPool(pool)
      return NextResponse.json({ success: true, data: result })
    }

    if (action === 'test-all') {
      // 测试所有启用的代理
      const results: any[] = []
      for (const proxy of pool.proxies) {
        if (proxy.enabled) {
          const result = await testProxyConnection(proxy)
          proxy.testStatus = result.ok ? 'ok' : 'fail'
          proxy.testLatencyMs = result.latency
          proxy.lastTestAt = new Date().toISOString()
          results.push({ id: proxy.id, ...result })
        }
      }
      await writeProxyPool(pool)
      return NextResponse.json({ success: true, data: results })
    }

    if (action === 'toggle') {
      // 切换单个代理的启用状态
      const proxyId = body.id
      const enabled = body.enabled
      const proxy = pool.proxies.find(p => p.id === proxyId)
      if (!proxy) return NextResponse.json({ success: false, message: '代理不存在' }, { status: 404 })
      proxy.enabled = enabled !== undefined ? enabled : !proxy.enabled
      await writeProxyPool(pool)
      return NextResponse.json({
        success: true,
        message: `${proxy.label || `${proxy.host}:${proxy.port}`} 已${proxy.enabled ? '启用' : '禁用'}`,
      })
    }

    if (action === 'settings') {
      // 更新全局设置
      if (body.settings) {
        Object.assign(pool.settings, body.settings)
        await writeProxyPool(pool)
        return NextResponse.json({ success: true, message: '设置已更新', data: pool.settings })
      }
    }

    return NextResponse.json({ success: false, message: `未知操作: ${action}` }, { status: 400 })
  } catch (error) {
    console.error('[ProxyPool] PATCH 失败:', error)
    return NextResponse.json({ success: false, message: error instanceof Error ? error.message : '操作失败' }, { status: 500 })
  }
}

/**
 * 测试代理连通性
 */
async function testProxyConnection(proxy: ProxyItem): Promise<{ ok: boolean; latency?: number; error?: string }> {
  const start = Date.now()

  return new Promise((resolve) => {
    let agent: any

    // 根据协议选择代理方式
    const proxyUrl = proxy.username && proxy.password
      ? `${proxy.protocol}://${proxy.username}:${proxy.password}@${proxy.host}:${proxy.port}`
      : `${proxy.protocol}://${proxy.host}:${proxy.port}`

    // 使用 Node.js 的 fetch + 环境变量方式测试
    const proc = require('child_process').spawn(
      process.env.PYTHON_BIN || 'python3',
      ['-c', `
import urllib.request
import urllib.error
import sys
import time

start = time.time()
result = {"ok": False, "latency": 0}

try:
    proxy_handler = urllib.request.ProxyHandler({
        '${proxy.protocol}': '${proxyUrl}'
    })
    opener = urllib.request.build_opener(proxy_handler)
    
    req = urllib.request.Request('http://httpbin.org/ip', headers={
        'User-Agent': 'Mozilla/5.0 Proxy-Test',
        'Connection': 'close',
    })
    
    resp = opener.open(req, timeout=10)
    body = resp.read().decode('utf-8', errors='ignore')
    latency = round((time.time() - start) * 1000)
    
    result["ok"] = True
    result["latency"] = latency
    result["ip"] = body.strip()[:100] if len(body) < 500 else "(response too large)"
    
except urllib.error.URLError as e:
    result["latency"] = round((time.time() - start) * 1000)
    result["error"] = str(e.reason)[:200]
except Exception as e:
    result["latency"] = round((time.time() - start) * 1000)
    result["error"] = str(e)[:200]

print(result)
`],
      { timeout: 15000, env: process.env }
    )

    let out = ''
    proc.stdout.on('data', (d: Buffer) => { out += d.toString() })

    const timer = setTimeout(() => {
      proc.kill()
      resolve({ ok: false, latency: Date.now() - start, error: '连接超时 (>15s)' })
    }, 15000)

    proc.on('close', () => {
      clearTimeout(timer)
      try {
        const result = eval(out.trim())
        resolve(result)
      } catch {
        resolve({ ok: false, latency: Date.now() - start, error: '解析响应失败' })
      }
    })

    proc.on('error', () => {
      clearTimeout(timer)
      resolve({ ok: false, latency: Date.now() - start, error: '无法启动测试进程' })
    })
  })
}
