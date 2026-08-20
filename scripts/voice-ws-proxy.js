#!/usr/bin/env node
/**
 * 语音 WS 代理（1:1 复刻白龙马 cloud-asr.js aliyun 段，2026-08-20）
 * 前端 voice-core.js 连 ws://<host>:3721/voice/cloud → 本代理连百炼 paraformer-realtime-v2
 * 协议（与白龙马一致）：
 *   上行：JSON {type:'config',provider,lang} → 之后 Int16LE PCM 二进制 → JSON {type:'flush'}
 *   下行：JSON {type:'transcript',text,is_final,seg} / {type:'error'} / {type:'diag'}
 * 运行：node scripts/voice-ws-proxy.js   （端口 3721，pm2 或本地开发）
 */
const { WebSocketServer, WebSocket } = require('ws')
const crypto = require('crypto')

const PORT = process.env.VOICE_WS_PORT || 3721
const TOKEN = process.env.VOICE_WS_TOKEN || ''   // 可选：客户端 ws URL 带 ?token= 校验
const BAILLIAN_WS = 'wss://dashscope.aliyuncs.com/api-ws/v1/inference/'

// 读 .env.local 里的 DASHSCOPE_API_KEY（独立进程不自动读）
const fs = require('fs')
const path = require('path')
function loadEnv(p) {
  try {
    const txt = fs.readFileSync(p, 'utf8')
    for (const line of txt.split('\n')) {
      const m = line.match(/^([^#=]+)=(.*)$/)
      if (m) process.env[m[1].trim()] = m[2].trim()
    }
  } catch {}
}
const envPath = path.join(__dirname, '..', '.env.local')
if (fs.existsSync(envPath)) loadEnv(envPath)

const wss = new WebSocketServer({ port: PORT })
console.log(`[voice-ws] 代理监听 ws://0.0.0.0:${PORT}/voice/cloud`)

function createAliyunSession(apiKey, lang, onTranscript, onError, onClose) {
  const taskId = crypto.randomUUID()
  let ready = false, finishing = false
  const pending = []
  let ws
  try {
    ws = new WebSocket(BAILLIAN_WS, { headers: { Authorization: `bearer ${apiKey}` } })
  } catch (e) { onError(e.message); return null }
  ws.on('open', () => {
    const langCode = (lang === 'zh' || !lang) ? 'zh' : lang
    ws.send(JSON.stringify({
      header: { action: 'run-task', task_id: taskId, streaming: 'duplex' },
      payload: {
        task_group: 'audio', task: 'asr', function: 'recognition',
        model: 'paraformer-realtime-v2',
        parameters: { sample_rate: 16000, format: 'pcm', language_hints: [langCode], punctuation_prediction: true, inverse_text_normalization: true },
        input: {},
      },
    }))
    ready = true
    for (const buf of pending) { try { ws.send(buf) } catch {} }
    pending.length = 0
  })
  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString())
      const event = msg?.header?.event
      if (event === 'result-generated') {
        const sentence = msg?.payload?.output?.sentence
        if (sentence?.text) {
          const isFinal = sentence.status === 'sentence_end'
          const seg = sentence.begin_time != null ? `a${sentence.begin_time}` : null
          onTranscript(sentence.text, isFinal, seg)
        }
      } else if (event === 'task-failed') {
        onError(msg?.header?.error_message || '百炼 ASR 错误')
      } else {
        if (event === 'task-finished' && !finishing) { try { ws.close() } catch {} }
      }
    } catch {}
  })
  ws.on('error', (e) => { pending.length = 0; onError(e.message) })
  ws.on('close', () => { pending.length = 0; onClose() })
  return {
    sendAudio(buf) {
      if (!ready) { if (pending.length < 200) pending.push(buf); return }
      if (ws.readyState === WebSocket.OPEN) ws.send(buf)
    },
    flush() {
      if (ws.readyState !== WebSocket.OPEN) return
      finishing = true
      ws.send(JSON.stringify({ header: { action: 'finish-task', task_id: taskId, streaming: 'duplex' }, payload: { input: {} } }))
    },
    close() { try { ws.close() } catch {} },
  }
}

wss.on('connection', (socket, req) => {
  const url = new URL(req.url, 'http://x')
  if (TOKEN && url.searchParams.get('token') !== TOKEN) { socket.close(4001, 'bad token'); return }
  if (!url.pathname.endsWith('/voice/cloud')) { socket.close(4004, 'bad path'); return }
  let aliyun = null
  let lang = 'zh'
  socket.on('message', (data, isBinary) => {
    if (!isBinary) {
      try {
        const msg = JSON.parse(data.toString())
        if (msg.type === 'config') {
          lang = msg.lang || 'zh'
          const apiKey = process.env.DASHSCOPE_API_KEY
          if (!apiKey) { socket.send(JSON.stringify({ type: 'error', message: '服务器未配置 DASHSCOPE_API_KEY' })); return }
          aliyun = createAliyunSession(apiKey, lang,
            (text, isFinal, seg) => { try { socket.send(JSON.stringify({ type: 'transcript', text, is_final: isFinal, seg })) } catch {} },
            (message) => { try { socket.send(JSON.stringify({ type: 'error', message })) } catch {} },
            () => { try { socket.send(JSON.stringify({ type: 'diag', event: 'asr-closed' })) } catch {} },
          )
        } else if (msg.type === 'flush' && aliyun) {
          aliyun.flush()
        }
      } catch {}
      return
    }
    if (aliyun) aliyun.sendAudio(data)
  })
  socket.on('close', () => { if (aliyun) aliyun.close() })
  socket.on('error', () => {})
})

process.on('uncaughtException', () => {})
