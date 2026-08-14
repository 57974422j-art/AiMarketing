// 2026-08-14: Minimax AI 音乐生成（新平台 api.minimax.io，同步返回音频 URL）
// 官方文档: https://platform.minimax.io/docs/api-reference/music-generation
// 注意: 模型 music-3.0-free 免费 / music-3.0 付费(Token Plan)；2061 = 当前套餐不支持该模型（需充值）
const MINIMAX_MUSIC_URL = 'https://api.minimax.io/v1/music_generation'
const MINIMAX_MUSIC_MODEL = process.env.MINIMAX_MUSIC_MODEL || 'music-3.0-free'

export interface MusicGenResult {
  ok: boolean
  url?: string
  error?: string
  needsPayment?: boolean // 2061: 套餐不支持（需充值/开通）
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
        output_format: 'url',
      }),
      signal: AbortSignal.timeout(150000), // 音乐生成较慢，150s
    })
    if (!r.ok) return { ok: false, error: `Minimax HTTP ${r.status}` }
    const d = await r.json()
    const code = d?.base_resp?.status_code
    if (code !== 0 && code !== undefined) {
      const msg = d?.base_resp?.status_msg || `Minimax 错误 ${code}`
      // 2061: 套餐不支持该模型
      if (String(code) === '2061' || /not support model|token plan/i.test(msg)) {
        return { ok: false, needsPayment: true, error: '当前 Minimax 套餐不支持音乐生成（music-3.0），请在 platform.minimax.io 充值或开通后重试' }
      }
      return { ok: false, error: msg }
    }
    const url = d?.data?.audio
    if (!url) return { ok: false, error: 'Minimax 未返回音频（响应结构异常）' }
    return { ok: true, url: String(url) }
  } catch (e: any) {
    return { ok: false, error: `Minimax 音乐生成失败: ${e?.message || e}` }
  }
}
