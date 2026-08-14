import { NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

/**
 * GET /api/bgm - 返回可用的背景音乐列表（一键成片选用）
 * 2026-08-14: 数据源改为「公共音乐库（MusicAsset source=public）」+ 1 首可用免费兜底
 * （原 Pixabay 硬编码 4 首只有第 1 首 CDN 可用，其余 3 首失效——移除）
 */
export async function GET() {
  try {
    // 公共音乐库（admin 生成并设为公开的 AI 音乐）
    const pubMusic = await prisma.mediaAsset.findMany({
      where: { source: 'public', type: 'audio', category: 'music' },
      orderBy: { createdAt: 'desc' },
      take: 20,
    })
    const aiTracks = pubMusic.map((m, i) => ({
      id: i + 1,
      name: (m.prompt || 'AI 音乐').substring(0, 20),
      mood: 'ai',
      url: m.ossUrl,
    }))

    // 免费兜底：Pixabay 第 1 首（实测可用的）
    const freeTrack = {
      id: 999,
      name: '轻松愉快 - Uplifting',
      mood: 'happy',
      url: 'https://cdn.pixabay.com/download/audio/2022/05/27/audio_1808fbf07a.mp3?filename=uplifting-upbeat-corporate-inspiration.mp3',
    }

    return NextResponse.json({
      success: true,
      poweredBy: '公共音乐库 + Pixabay 免费',
      count: aiTracks.length + 1,
      data: [...aiTracks, freeTrack],
    })
  } catch (e: any) {
    // 数据库异常时兜底免费曲
    return NextResponse.json({
      success: true,
      poweredBy: 'Pixabay 免费（库异常兜底）',
      count: 1,
      data: [{
        id: 999,
        name: '轻松愉快 - Uplifting',
        mood: 'happy',
        url: 'https://cdn.pixabay.com/download/audio/2022/05/27/audio_1808fbf07a.mp3?filename=uplifting-upbeat-corporate-inspiration.mp3',
      }],
    })
  }
}

// 强制动态渲染：读数据库
export const dynamic = 'force-dynamic'
