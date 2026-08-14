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
    // 2026-08-14: 全部用 AI 音乐库（用户弃用 Pixabay——下载无效/仅 1 首可用）
    return NextResponse.json({
      success: true,
      poweredBy: 'AI 音乐库',
      count: pubMusic.length,
      data: pubMusic.map((m, i) => ({
        id: i + 1,
        name: (m.prompt || 'AI 音乐').substring(0, 20),
        mood: 'ai',
        url: m.ossUrl,
      })),
    })
  } catch (e: any) {
    return NextResponse.json({ success: true, poweredBy: 'AI 音乐库', count: 0, data: [] })
  }
}

// 强制动态渲染：读数据库
export const dynamic = 'force-dynamic'
