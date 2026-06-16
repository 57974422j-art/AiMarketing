import { NextResponse } from 'next/server'

/**
 * GET /api/bgm - 返回可用的背景音乐列表
 * Pixabay 免版税音乐，直接 CDN 链接，无需 API Key
 */
export async function GET() {
  const pixabayConfigured = !!process.env.PIXABAY_API_KEY

  const tracks = [
    { name: '轻松愉快 - Uplifting', mood: 'happy', url: 'https://cdn.pixabay.com/download/audio/2022/05/27/audio_1808fbf07a.mp3?filename=uplifting-upbeat-corporate-inspiration.mp3' },
    { name: '温馨柔和 - Soft', mood: 'calm', url: 'https://cdn.pixabay.com/download/audio/2022/10/25/audio_946bc7ebc8.mp3?filename=acoustic-guitar-soft-instrumental-bg.mp3' },
    { name: '电子节奏 - Electronic', mood: 'energetic', url: 'https://cdn.pixabay.com/download/audio/2022/02/22/audio_d171c86b8d.mp3?filename=electronic-future-beats.mp3' },
    { name: '电影感 - Cinematic', mood: 'epic', url: 'https://cdn.pixabay.com/download/audio/2022/08/02/audio_884fe92c6b.mp3?filename=cinematic-epic-emotional.mp3' },
    { name: '爵士休闲 - Jazz Lounge', mood: 'relaxed', url: 'https://cdn.pixabay.com/download/audio/2022/01/18/audio_c6c8f49d4e.mp3?filename=jazz-lounge-relaxing.mp3' },
    { name: '钢琴独奏 - Piano Solo', mood: 'emotional', url: 'https://cdn.pixabay.com/download/audio/2022/05/16/audio_15b7e3f4c2.mp3?filename=solo-piano-emotional.mp3' },
    { name: '轻快流行 - Happy Pop', mood: 'upbeat', url: 'https://cdn.pixabay.com/download/audio/2022/10/14/audio_5c3a89d2b1.mp3?filename=happy-pop-upbeat.mp3' },
    { name: '氛围环境 - Ambient', mood: 'atmospheric', url: 'https://cdn.pixabay.com/download/audio/2022/03/10/audio_e86f7c5a3b.mp3?filename=ambient-atmospheric-space.mp3' },
    { name: '摇滚动力 - Rock Energy', mood: 'powerful', url: 'https://cdn.pixabay.com/download/audio/2022/08/23/audio_4d7b2c1e9a.mp3?filename=rock-energy-powerful.mp3' },
    { name: '古典优雅 - Classical', mood: 'elegant', url: 'https://cdn.pixabay.com/download/audio/2022/06/30/audio_9f3e8d1c4b.mp3?filename=classical-elegant-strings.mp3' },
  ]

  return NextResponse.json({
    success: true,
    poweredBy: 'Pixabay 免版税音乐',
    pixabayConfigured,
    count: tracks.length,
    data: tracks,
  })
}
