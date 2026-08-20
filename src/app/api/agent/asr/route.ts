import { NextRequest, NextResponse } from 'next/server'
import path from 'path'
import fs from 'fs'
import os from 'os'
import crypto from 'crypto'
import { recognizeWithFunasr } from '@/lib/funasr-service'

// AGENT 语音输入：接收浏览器录制的音频文件 → 本地 FunASR 转写 → 返回文本
// 复用现有 src/lib/funasr-service.ts（调用 scripts/funasr_asr.py）
export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()
    const file = formData.get('audio') as File | null
    if (!file) return NextResponse.json({ success: false, message: '缺少音频' }, { status: 400 })

    const tmpDir = path.join(os.tmpdir(), 'agent-asr-' + crypto.randomBytes(4).toString('hex'))
    fs.mkdirSync(tmpDir, { recursive: true })
    const ext = (file.name.split('.').pop() || 'webm').split('?')[0]
    const rawPath = path.join(tmpDir, 'input.' + ext)
    const buf = Buffer.from(await file.arrayBuffer())
    fs.writeFileSync(rawPath, buf)

    // FunASR 需要 wav(16k 单声道)；非 wav 用 ffmpeg 转一下（若存在）
    let wavPath = rawPath
    if (ext !== 'wav') {
      const converted = path.join(tmpDir, 'input.wav')
      try {
        const { execFileSync } = require('child_process')
        // 2026-08-06：-err_detect ignore_err 忽略坏 opus 帧（录音偶发不完整），-vn 去掉视频轨，避免转码整段失败
        execFileSync('ffmpeg', ['-y', '-err_detect', 'ignore_err', '-i', rawPath, '-vn', '-ar', '16000', '-ac', '1', '-f', 'wav', converted], { timeout: 30000 })
        if (fs.existsSync(converted) && fs.statSync(converted).size > 1000) wavPath = converted
      } catch {
        // ffmpeg 不可用则直接用原文件尝试（FunASR 也可能支持）
      }
    }

    // 2026-08-06：优先调常驻 FunASR 服务（模型加载一次，识别秒级）；服务未启动则启动，失败回退脚本模式
    // 2026-08-20 方案一：百炼 paraformer-v2 优先 → 硅基 SenseVoice → FunASR
    let result = { success: false, text: '', error: '' } as { success: boolean; text: string; error?: string }
    result = await recognizeViaBailian(wavPath)
    if (!result.success) {
      console.warn('[ASR] 百炼失败，转硅基:', result.error)
      try {
        const fs2 = await import('fs')
        const buf = fs2.readFileSync(wavPath)
        const { transcribeAudio } = await import('@/lib/ai-providers')
        const text = await transcribeAudio(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), 'audio.wav')
        if (text && text.trim()) result = { success: true, text: text.trim() }
      } catch (e: any) { console.warn('[ASR] 硅基失败:', e?.message) }
    }
    if (!result.success) {
      const r2 = await recognizeViaServer(wavPath)
      if (r2.success) result = r2
      else { const r3 = await recognizeWithFunasr(wavPath); if (r3.success) result = r3 }
    }
    // 清理临时目录
    try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch {}

    if (!result.success) {
      return NextResponse.json({ success: false, message: result.error || '识别失败' }, { status: 500 })
    }
    return NextResponse.json({ success: true, text: result.text })
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 })
  }
}

// 调常驻 FunASR 服务（127.0.0.1:8765）；未启动则 spawn 启动（首次加载模型 ~20s，之后秒级）
// 2026-08-20 方案一：百炼 paraformer-v2 文件转录（OSS 上传 → 提交 → 轮询）
async function recognizeViaBailian(wavPath: string): Promise<{ success: boolean; text: string; error?: string }> {
  try {
    const KEY = process.env.DASHSCOPE_API_KEY
    if (!KEY) return { success: false, text: '', error: '无 DASHSCOPE_API_KEY' }
    const fs2 = await import('fs')
    const { putObject, signedUrl } = await import('@/lib/oss')
    const buf = fs2.readFileSync(wavPath)
    const key = `asr-tmp/${Date.now()}-${Math.random().toString(36).slice(2)}.wav`
    await putObject(key, buf, 'audio/wav')
    const url = await signedUrl(key, 3600)
    // 提交任务
    const submitRes = await fetch('https://dashscope.aliyuncs.com/api/v1/services/audio/asr/transcription', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${KEY}`, 'Content-Type': 'application/json', 'X-DashScope-Async': 'enable' },
      body: JSON.stringify({ model: 'paraformer-v2', input: { file_urls: [url] }, parameters: { language_hints: ['zh'], channel_id: [0] } }),
      signal: AbortSignal.timeout(20000),
    })
    const sub = await submitRes.json()
    const taskId = sub?.output?.task_id
    if (!taskId) return { success: false, text: '', error: '百炼提交失败: ' + JSON.stringify(sub).slice(0, 200) }
    // 轮询（最多 30s——避免前端卡住）
    for (let i = 0; i < 30; i++) {
      const pollRes = await fetch(`https://dashscope.aliyuncs.com/api/v1/tasks/${taskId}`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${KEY}` },
        signal: AbortSignal.timeout(10000),
      })
      const pd = await pollRes.json()
      const status = pd?.output?.task_status
      if (status === 'SUCCEEDED') {
        const trUrl = pd?.output?.results?.[0]?.transcription_url
        if (trUrl) {
          const tr = await fetch(trUrl).then(r => r.json())
          const text = (tr?.transcripts || []).map((t: any) => t.text || '').join('')
          if (text.trim()) return { success: true, text: text.trim() }
        }
        break
      }
      if (status === 'FAILED' || pd?.code) return { success: false, text: '', error: '百炼任务失败: ' + JSON.stringify(pd).slice(0, 200) }
      await new Promise(r => setTimeout(r, 1000))
    }
    return { success: false, text: '', error: '百炼识别超时' }
  } catch (e: any) {
    return { success: false, text: '', error: '百炼异常: ' + (e?.message || String(e)) }
  }
}

async function recognizeViaServer(wavPath: string): Promise<{ success: boolean; text: string; error?: string }> {
  const PORT = 8765
  const { spawn } = require('child_process')
  const http = require('http')
  const fs = require('fs')
  const path = require('path')

  const serverReady = () => new Promise<boolean>((resolve) => {
    const req = http.get({ host: '127.0.0.1', port: PORT, path: '/', timeout: 1500 }, (r: any) => { r.resume(); resolve(true) })
    req.on('error', () => resolve(false))
    req.on('timeout', () => { req.destroy(); resolve(false) })
  })

  if (!(await serverReady())) {
    const script = path.join(process.cwd(), 'scripts', 'funasr_server.py')
    if (!fs.existsSync(script)) return { success: false, text: '' }
    const child = spawn('python', [script], { stdio: 'ignore', detached: true })
    child.unref()
    // 等就绪（首次含模型加载，最多 70s）
    let ready = false
    for (let i = 0; i < 47; i++) { if (await serverReady()) { ready = true; break } await new Promise(r => setTimeout(r, 1500)) }
    if (!ready) return { success: false, text: '' }
  }

  // 上传 wav 识别
  return new Promise((resolve) => {
    const data = fs.readFileSync(wavPath)
    const req = http.request({ host: '127.0.0.1', port: PORT, path: '/recognize', method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': data.length }, timeout: 60000 }, (r: any) => {
      let body = ''
      r.on('data', (d: any) => body += d)
      r.on('end', () => {
        try {
          const j = JSON.parse(body)
          if (j && typeof j.text === 'string' && j.text.trim()) resolve({ success: true, text: j.text })
          else resolve({ success: false, text: '' })
        } catch { resolve({ success: false, text: '' }) }
      })
    })
    req.on('error', () => resolve({ success: false, text: '' }))
    req.on('timeout', () => { req.destroy(); resolve({ success: false, text: '' }) })
    req.end(data)
  })
}

export const dynamic = 'force-dynamic'
