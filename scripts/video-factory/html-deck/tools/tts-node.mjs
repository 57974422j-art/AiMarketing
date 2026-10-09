#!/usr/bin/env node
/**
 * ★VF_TTSNODE_V1（2026-10-09 用户定案「先校准流程」）—— **纯 Node 的 TTS**（不依赖 python）
 * =============================================================================
 * 为什么需要它：配音流程要接到**主链路（AGENT 的 HTML成片线）**，而生产服务器是 Node 环境
 *   （deck 线的 TTS 走的就是 TS 的 `ttsQwen3`/`dashscopeTTS`，不是 python）。
 *   实验室原来用 `scripts/video-factory/tts.py`（python）—— 本机有，服务器不一定有。
 *   ⇒ 抽出一个**零依赖**的 Node CLI，协议与 `src/lib/ai-providers.ts:dashscopeTTS` **逐字对齐**：
 *      · URL  : https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation
 *      · model: qwen3-tts-flash（**同步接口，绝不能带 X-DashScope-Async**，带了会 403）
 *      · body : { model, input: { text, voice } }（voice ∈ Cherry / Serena / Ethan / Chelsie）
 *      · 取回 : 响应里挖 audio url → 下载 → 存 mp3
 *
 * 用法：
 *   node tools/tts-node.mjs --text "要念的一句话" --out tts.mp3 [--voice Cherry] [--voice-key longxiaochun]
 * 输出：stdout 打 `ok=True path=... kb=...`；失败非 0 退出（调用方据此回退或报错，不产坏片）。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')          // html-deck/
const PROJECT = path.resolve(HERE, '..', '..', '..')                                    // 项目根
const args = process.argv.slice(2)
const arg = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d }
const TEXT = arg('text', '')
const OUT = arg('out', '')
if (!TEXT.trim() || !OUT) { console.error('用法: node tools/tts-node.mjs --text "..." --out x.mp3 [--voice Cherry]'); process.exit(2) }

/** 凭据：进程环境变量优先 → 从项目根逐级向上找 .env.local（与 tts.py / ai-providers.ts 同口径） */
const readEnv = (k) => {
  if (process.env[k]) return process.env[k]
  let dir = PROJECT
  for (let i = 0; i < 4; i++) {
    for (const f of ['.env.local', '.env']) {
      const p = path.join(dir, f)
      if (!fs.existsSync(p)) continue
      for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
        const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)\s*$/)
        if (m && m[1] === k) return m[2].replace(/^["']|["']$/g, '')
      }
    }
    const up = path.dirname(dir)
    if (up === dir) break
    dir = up
  }
  return ''
}
const KEY = readEnv('DASHSCOPE_API_KEY')
if (!KEY) { console.error('✗ 没有 DASHSCOPE_API_KEY（环境变量与 .env.local 都没有）'); process.exit(3) }

/** 音色映射（与 ai-providers.ts 的 qwenTtsVoice 同表） */
const VOICE_MAP = { longxiaochun: 'Cherry', longxiaoxia: 'Serena', cherry: 'Chelsie', longshu: 'Ethan', longchen: 'Ethan', longjing: 'Ethan', longxiaohui: 'Ethan' }
const voiceIn = String(arg('voice-key', arg('voice', 'Cherry')))
const VOICE = ['Cherry', 'Serena', 'Ethan', 'Chelsie'].includes(voiceIn) ? voiceIn : (VOICE_MAP[voiceIn] || 'Cherry')

/** 文本预处理：与 prepareTextForTTS 同规矩 —— 全大写 ≥3 字母的缩写拆成逐字母读（避免"API 读成日语腔"） */
const prep = (s) => String(s).replace(/[A-Z]{3,}/g, (m) => m.split('').join(' ')).replace(/\s+/g, ' ').trim()

/** 在任意嵌套结构里挖第一个 http 音频地址（与 ai-providers 的 digAudioUrl 同思路） */
const digAudioUrl = (obj, depth = 0) => {
  if (!obj || depth > 6) return ''
  if (Array.isArray(obj)) { for (const v of obj) { const r = digAudioUrl(v, depth + 1); if (r) return r } return '' }
  if (typeof obj === 'object') {
    for (const k of ['url', 'audio_url', 'audio']) {
      const v = obj[k]
      if (typeof v === 'string' && v.startsWith('http')) return v
    }
    for (const v of Object.values(obj)) { const r = digAudioUrl(v, depth + 1); if (r) return r }
  }
  return ''
}

const url = process.env.DASHSCOPE_TTS_URL || 'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation'
const model = process.env.DASHSCOPE_TTS_MODEL || 'qwen3-tts-flash'
try {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + KEY },
    body: JSON.stringify({ model, input: { text: prep(TEXT), voice: VOICE } }),
    signal: AbortSignal.timeout(60000),
  })
  if (!res.ok) { console.error('✗ 百炼 TTS HTTP ' + res.status + ' ' + String(await res.text()).slice(0, 240)); process.exit(4) }
  const data = await res.json()
  const au = digAudioUrl(data)
  if (!au) { console.error('✗ 响应里没有音频地址：' + JSON.stringify(data).slice(0, 240)); process.exit(5) }
  const ar = await fetch(au, { signal: AbortSignal.timeout(30000) })
  if (!ar.ok) { console.error('✗ 下载音频失败 HTTP ' + ar.status); process.exit(6) }
  const buf = Buffer.from(await ar.arrayBuffer())
  if (buf.length < 512) { console.error('✗ 音频过小 ' + buf.length + ' bytes'); process.exit(7) }
  fs.mkdirSync(path.dirname(path.resolve(OUT)), { recursive: true })
  fs.writeFileSync(path.resolve(OUT), buf)
  console.log('ok=True path=' + path.resolve(OUT) + ' kb=' + Math.round(buf.length / 1024) + ' voice=' + VOICE)
} catch (e) {
  console.error('✗ 百炼 TTS 异常：' + String(e && e.message || e).slice(0, 240))
  process.exit(8)
}
