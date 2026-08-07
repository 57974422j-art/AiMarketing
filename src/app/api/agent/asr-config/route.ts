import { NextResponse } from 'next/server'
import { getAuthFromHeaders } from '@/lib/api-auth'

/**
 * GET /api/agent/asr-config — 确保本地百炼流式 ASR 代理服务在跑（2026-08-07）
 * 前端语音前调用本接口保活；服务在 127.0.0.1:8766，未启动则 spawn scripts/dashscope_asr_server.py
 */
export async function GET(request: Request) {
  const auth = getAuthFromHeaders(request)
  if (!auth) return NextResponse.json({ success: false, message: '未认证' }, { status: 401 })

  const PORT = 8766
  const http = require('http')
  const { spawn } = require('child_process')
  const fs = require('fs')
  const path = require('path')

  const alive = () => new Promise<boolean>((resolve) => {
    const req = http.get({ host: '127.0.0.1', port: PORT, path: '/', timeout: 1200 }, (r: any) => { r.resume(); resolve(true) })
    req.on('error', () => resolve(false))
    req.on('timeout', () => { req.destroy(); resolve(false) })
  })

  if (!(await alive())) {
    const script = path.join(process.cwd(), 'scripts', 'dashscope_asr_server.py')
    if (fs.existsSync(script)) {
      const child = spawn('python', [script], { stdio: 'ignore', detached: true })
      child.unref()
      // 等就绪（最多 6s）
      for (let i = 0; i < 4; i++) { if (await alive()) break; await new Promise(r => setTimeout(r, 1500)) }
    }
  }

  return NextResponse.json({ success: true, data: { endpoint: `ws://127.0.0.1:${PORT}`, running: await alive() } })
}

export const dynamic = 'force-dynamic'
