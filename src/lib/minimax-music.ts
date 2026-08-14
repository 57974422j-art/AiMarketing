// 2026-08-14: Minimax AI 音乐生成（国内站 api.minimaxi.com，同步返回 hex 音频）
// 关键：free 档不要 output_format=url（url 输出触发计费→1008 insufficient balance）——hex 免费
// hex → 写临时 mp3 到静态 public/tmp → 返回可播放/可被 ffmpeg 使用的 URL
import { join } from 'path'
import { mkdirSync, writeFileSync, existsSync } from 'fs'

const MINIMAX_MUSIC_URL = process.env.MINIMAX_MUSIC_URL || 'https://api.minimaxi.com/v1/music_generation'
const MINIMAX_MUSIC_MODEL = process.env.MINIMAX_MUSIC_MODEL || 'music-3.0-free'

export interface MusicGenResult {
  ok: boolean
  url?: string
  error?: string
  needsPayment?: boolean // 2061/1008: 套餐不支持/余额不足
}

export async function generateMusic(prompt: string): Promise<MusicGenResult> {
  const key = process.env.MINIMAX_API_KEY
  if (!key) return { ok: false, error: '未配置 MINIMAX_API_KEY（后台 AI 密钥 → Minimax）', needsPayment: false }
  try {
    const r = await fetch(MINIMAX_MUSIC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: MINIMAX_MUSIC_MODEL,
        prompt: prompt.substring(0, 2000),
        is_instrumental: true,
        audio_setting: { sample_rate: 44100, bitrate: 256000, format: 'mp3' },
        // 2026-08-14: 不加 output_format=url（free 档 url 输出计费→1008）；默认 hex 免费
      }),
      signal: AbortSignal.timeout(180000), // 音乐生成较慢，180s
    })
    if (!r.ok) return { ok: false, error: `Minimax HTTP ${r.status}` }
    const d = await r.json()
    const code = d?.base_resp?.status_code
    if (code !== 0 && code !== undefined) {
      const msg = d?.base_resp?.status_msg || `Minimax 错误 ${code}`
      if (String(code) === '2061' || /not support model|token plan/i.test(msg)) {
        return { ok: false, needsPayment: true, error: '当前 Minimax 套餐不支持音乐生成（music-3.0），请在 Minimax 控制台开通/充值后重试' }
      }
      if (String(code) === '1008' || /insufficient balance/i.test(msg)) {
        return { ok: false, needsPayment: true, error: 'Minimax 账户余额不足，请在控制台充值后重试' }
      }
      return { ok: false, error: msg }
    }
    const hex = String(d?.data?.audio || '')
    if (!hex || hex.length < 200) return { ok: false, error: 'Minimax 未返回音频（响应结构异常）' }
    const buf = Buffer.from(hex, 'hex')
    if (buf.length < 1000) return { ok: false, error: 'Minimax 返回音频数据异常' }

    // 写临时 mp3：standalone 模式写 .next/standalone/public（静态可读）；dev 写 public
    const cwd = process.cwd()
    const publicDir = existsSync(join(cwd, '.next', 'standalone'))
      ? join(cwd, '.next', 'standalone', 'public')
      : join(cwd, 'public')
    const tmpDir = join(publicDir, 'tmp')
    mkdirSync(tmpDir, { recursive: true })
    const fileName = `music-${Date.now()}-${Math.floor(Math.random() * 1000)}.mp3`
    writeFileSync(join(tmpDir, fileName), buf)
    return { ok: true, url: `/tmp/${fileName}` }
  } catch (e: any) {
    return { ok: false, error: `Minimax 音乐生成失败: ${e?.message || e}` }
  }
}
