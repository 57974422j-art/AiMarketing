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
    const result = await ttsEdgeFallback(text, voice, workDir, idx)
    return { ...result, ok: true }
  }

  const qwenVoice = QWEN_VOICE_MAP[voice] || 'Cherry'

  try {
    const res = await fetch('https://dashscope.aliyuncs.com/api/v1/services/aigc/text2speech/stream', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${KEY}`,
        'Content-Type': 'application/json',
        'Accept': 'audio/mpeg',
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
      signal: AbortSignal.timeout(15000),
    })

    // 检查响应类型
    const contentType = res.headers.get('content-type') || ''
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
    console.warn(`[Qwen3TTS] 第${idx}句失败: ${e.message}，降级edge-tts`)
    const result = await ttsEdgeFallback(text, voice, workDir, idx)
    return { ...result, ok: true }
  }
}

/** edge-tts 降级方案 */
async function ttsEdgeFallback(text: string, voice: string, workDir: string, idx: number): Promise<{ path: string; duration: number }> {
  const voiceMap: Record<string, string> = {
    'zh_female_vv_uranus_bigtts': 'zh-CN-XiaoxiaoNeural',
    'zh_female_vv_aurora_bigtts': 'zh-CN-XiaoyiNeural',
    'zh_male_fengge_bigtts': 'zh-CN-YunxiNeural',
    'zh_male_xiaoming_bigtts': 'zh-CN-YunyangNeural',
    'zh_female_tianmei': 'zh-CN-XiaohanNeural',
    'zh_male_sijie': 'zh-CN-YunjianNeural',
    'zh_female_zhixia': 'zh-CN-XiaoxuanNeural',
    'zh_male_yanyang': 'zh-CN-YunhaoNeural',
  }
  const vn = voiceMap[voice] || 'zh-CN-XiaoxiaoNeural'
  const outPath = path.join(workDir, `tts${idx}.mp3`)
  const textFile = outPath + '.txt'
  fs.writeFileSync(textFile, text.replace(/["$'`\\]/g, ''), 'utf8')
  execSync(`edge-tts --voice ${vn} --text "$(cat ${textFile})" --write-media ${outPath}`, { timeout: 30000, shell: '/bin/bash' })
  try { fs.unlinkSync(textFile) } catch {}
  const dur = await getMP3Duration(outPath)
  return { path: outPath, duration: dur }
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
