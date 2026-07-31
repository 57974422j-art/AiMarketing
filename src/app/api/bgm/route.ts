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
  ]

  return NextResponse.json({
    success: true,
    poweredBy: 'Pixabay 免版税音乐',
    pixabayConfigured,
    count: tracks.length,
    data: tracks,
  })
}

// 强制动态渲染：API 路由依赖 request.headers / 鉴权，禁止 Next 在构建期静态预渲染
export const dynamic = 'force-dynamic'
