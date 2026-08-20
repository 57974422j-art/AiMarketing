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
  // 2026-08-20: 一键成片 TTS 降级链——火山 →（百炼→硅基 textToSpeech）；弃用 qwen-tts（模型是声音复刻，url error）
  const cleaned = (text || '').trim()
  if (!cleaned) return { ok: false, path: '', duration: 0 }
  const outPath = path.join(workDir, `tts${idx}.mp3`)
  try {
    const { volcanoTTS, textToSpeech } = await import('./ai-providers')
    let buf: ArrayBuffer | null = null
    // 1) 火山优先（用户已配火山 TTS key）
    try { buf = await volcanoTTS(cleaned) } catch {}
    // 2) 百炼 → 硅基（textToSpeech 降级链）
    if (!buf || buf.byteLength <= 100) { try { buf = await textToSpeech(cleaned) } catch {} }
    if (!buf || buf.byteLength <= 100) {
      console.warn('[Qwen3TTS] 火山/百炼/硅基 全部失败')
      return { ok: false, path: '', duration: 0 }
    }
    fs.writeFileSync(outPath, Buffer.from(buf))
    const dur = await getMP3Duration(outPath)
    return { ok: true, path: outPath, duration: dur }
  } catch (e: any) {
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
