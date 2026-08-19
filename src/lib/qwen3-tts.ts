import fs from 'fs'
import path from 'path'
import { execSync } from 'child_process'

const QWEN_VOICE_MAP: Record<string, string> = {
  'zh_female_vv_uranus_bigtts': 'Cherry',
  'zh_female_vv_aurora_bigtts': 'Stella',
  'zh_male_fengge_bigtts': 'Harry',
  'zh_male_xiaoming_bigtts': 'Sunny',
  'zh_female_tianmei': 'Luna',
  'zh_male_sijie': 'Ethan',
  'zh_female_zhixia': 'Cherry',
  'zh_male_yanyang': 'Harry',
}

/**
 * 使用 Qwen3 TTS API 合成一句语音，返回 { ok, path, duration }
 * 失败时不会抛异常，返回 ok:false
 */
export async function ttsQwen3(text: string, voice: string, workDir: string, idx: number): Promise<{ ok: boolean; path: string; duration: number }> {
  const KEY = process.env.DASHSCOPE_API_KEY
  if (!KEY) {
    // 2026-08-14：统一百炼，弃用火山兜底
    console.warn('[Qwen3TTS] 未配置 DASHSCOPE_API_KEY，一键成片 TTS 无法合成（后台 AI 密钥 → 百炼 DASHSCOPE）')
    return { ok: false, path: '', duration: 0 }
  }

  const qwenVoice = QWEN_VOICE_MAP[voice] || 'Cherry'

  try {
    const res = await fetch('https://dashscope.aliyuncs.com/api/v1/services/aigc/text2speech/stream', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${KEY}`,
        'Content-Type': 'application/json',
        // 2026-08-19: 百炼该接口只支持 event-stream/json——音频在 SSE 事件里（base64），改 Accept + SSE 解析
        'Accept': 'text/event-stream',
        'X-DashScope-SSE': 'enable',
      },
      body: JSON.stringify({
        model: 'qwen-tts',
        input: { text: text.trim() },
        parameters: {
          voice: qwenVoice,
          language_type: 'Chinese',
          rate: 1.0,
        },
      }),
      signal: AbortSignal.timeout(20000),
    })

    // 解析 SSE 流：事件里 data: {"audio": "base64..."}
    const contentType = res.headers.get('content-type') || ''
    if (contentType.includes('event-stream') || contentType.includes('json') || contentType.includes('text')) {
      const raw = await res.text()
      // 提取所有 audio base64（data: 行里 {"audio":"..."}）
      const audioB64s: string[] = []
      const dataLines = raw.split('
').filter(l => l.startsWith('data:'))
      for (const line of dataLines) {
        const payload = line.replace(/^data:\s*/, '').trim()
        if (!payload || payload === '[DONE]') continue
        try {
          const obj = JSON.parse(payload)
          if (obj.audio) audioB64s.push(obj.audio)
        } catch {}
      }
      // 兼容：整体是 JSON（非流式变体）
      if (audioB64s.length === 0) {
        try {
          const obj = JSON.parse(raw)
          if (obj.output?.audio) audioB64s.push(obj.output.audio)
          if (obj.audio) audioB64s.push(obj.audio)
        } catch {}
      }
      if (audioB64s.length === 0) {
        console.warn(`[Qwen3TTS] 未提取到音频段: ${raw.slice(0, 200)}`)
        throw new Error('响应无音频数据')
      }
      const buf = Buffer.from(audioB64s.join(''), 'base64')
      if (buf.length < 500) throw new Error('音频太短')
      const outPath = path.join(workDir, `tts${idx}.mp3`)
      fs.writeFileSync(outPath, buf)
      const dur = await getMP3Duration(outPath)
      return { ok: true, path: outPath, duration: dur }
    }

    // 兼容：直接音频流
    if (contentType.includes('audio')) {
      const buf = Buffer.from(await res.arrayBuffer())
      if (buf.length < 500) throw new Error('音频太短')
      const outPath = path.join(workDir, `tts${idx}.mp3`)
      fs.writeFileSync(outPath, buf)
      const dur = await getMP3Duration(outPath)
      return { ok: true, path: outPath, duration: dur }
    }

    // 可能是错误 JSON 响应
    const errBody = await res.text()
    console.warn(`[Qwen3TTS] 非音频响应 (${res.status}): ${errBody.slice(0, 200)}`)
    throw new Error(`HTTP ${res.status}`)
  } catch (e: any) {
    // 2026-08-14：统一百炼，无火山降级（用户已删火山配置）——失败明确返回，由上层提示
    console.warn(`[Qwen3TTS] 第${idx}句失败: ${e.message}`)
    return { ok: false, path: '', duration: 0 }
  }
}


/** 获取 mp3 音频时长 */
function getMP3Duration(file: string): Promise<number> {
  return new Promise((resolve) => {
    try {
      if (!fs.existsSync(file) || fs.statSync(file).size < 500) { resolve(1.5); return }
      const out = execSync(`ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${file}"`, { timeout: 10000, encoding: 'utf8' })
      resolve(parseFloat(out.trim()) || 1.5)
    } catch { resolve(1.5) }
  })
}
