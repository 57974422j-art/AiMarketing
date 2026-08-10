import { NextRequest, NextResponse } from 'next/server'
import { getAuthFromHeaders } from '@/lib/api-auth'
import { spawn } from 'child_process'
import fs from 'fs'
import path from 'path'

const LOG_DIR = '/root/AiMarketing/logs'
const LOG_FILE = path.join(LOG_DIR, 'fetch-videos.log')

/**
 * 手动抓取视频（2026-08-10：admin/prompt-templates 触发，替代夜间自动）
 * POST { platform: youtube|tiktok, count, minDuration, maxDuration, keyword } → spawn 后台脚本
 * GET → 当前任务状态 + 日志尾部
 */
export async function POST(request: NextRequest) {
  const auth = getAuthFromHeaders(request)
  if (!auth || auth.role !== 'admin') return NextResponse.json({ success: false, message: '仅管理员' }, { status: 403 })
  try {
    const { platform = 'youtube', count = 3, minDuration = 15, maxDuration = 180, keyword = '' } = await request.json()
    if (!['youtube', 'tiktok'].includes(platform)) return NextResponse.json({ success: false, message: '平台仅支持 youtube/tiktok' }, { status: 400 })
    const n = Math.min(10, Math.max(1, parseInt(count) || 3))
    // 已有任务在跑则拒绝
    const marker = path.join(LOG_DIR, 'fetch-videos.pid')
    if (fs.existsSync(marker)) {
      try { process.kill(parseInt(fs.readFileSync(marker, 'utf8')), 0); return NextResponse.json({ success: false, message: '已有抓取任务进行中' }, { status: 409 }) } catch {}
    }
    const script = path.join(process.cwd(), 'scripts', 'yt_dlp_fetch.py')
    if (!fs.existsSync(script)) return NextResponse.json({ success: false, message: '脚本不存在' }, { status: 500 })
    fs.mkdirSync(LOG_DIR, { recursive: true })
    fs.writeFileSync(LOG_FILE, `[${new Date().toLocaleString('zh-CN')}] 手动抓取启动：${platform}×${n} 时长 ${minDuration}-${maxDuration}s 关键词「${keyword}」\n`)
    const child = spawn('python3', [script, '--platform', platform, '--count', String(n),
      '--min-duration', String(minDuration), '--max-duration', String(maxDuration), '--keyword', keyword], {
      cwd: process.cwd(), detached: true, stdio: ['ignore', 'pipe', 'pipe'],
    })
    // 2026-08-10 A：管道捕获 stdout/stderr → 流式写入日志（原 stdio:ignore 丢全部日志）
    const appendLog = (buf: Buffer) => {
      try { fs.appendFileSync(LOG_FILE, buf.toString().replace(/\r/g, '\n')) } catch {}
    }
    child.stdout?.on('data', appendLog)
    child.stderr?.on('data', appendLog)
    fs.writeFileSync(marker, String(child.pid))
    child.on('exit', () => { try { fs.unlinkSync(marker) } catch {} })
    child.unref()
    return NextResponse.json({ success: true, message: `抓取任务已启动（${platform}×${n}）`, data: { pid: child.pid } })
  } catch (e: any) {
    return NextResponse.json({ success: false, message: e.message }, { status: 500 })
  }
}

export async function GET(request: NextRequest) {
  try {
    const marker = path.join(LOG_DIR, 'fetch-videos.pid')
    let running = false
    if (fs.existsSync(marker)) {
      try { process.kill(parseInt(fs.readFileSync(marker, 'utf8')), 0); running = true } catch {}
    }
    let tail = ''
    if (fs.existsSync(LOG_FILE)) {
      const lines = fs.readFileSync(LOG_FILE, 'utf8').split('\n').filter(Boolean)
      tail = lines.slice(-30).join('\n')
    }
    return NextResponse.json({ success: true, data: { running, tail } })
  } catch (e: any) {
    return NextResponse.json({ success: false, message: e.message }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
