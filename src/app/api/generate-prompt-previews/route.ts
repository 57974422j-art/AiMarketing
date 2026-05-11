import { NextRequest, NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client'
import { getAuthFromHeaders } from '@/lib/api-auth'
import { generateImage } from '@/lib/ai-providers'

const prisma = new PrismaClient()

/**
 * POST /api/generate-prompt-previews
 * 为 PromptTemplate 表中所有 previewUrl 为空的记录逐个生成预览图
 * 需要配置硅基流动 SILICONFLOW_API_KEY
 */
export async function POST(request: NextRequest) {
  try {
    const auth = getAuthFromHeaders(request)
    if (!auth || auth.role !== 'admin') {
      return NextResponse.json({ success: false, message: '需要管理员权限' }, { status: 403 })
    }

    // 获取所有没有预览图的模板
    const rows = await prisma.$queryRawUnsafe(
      'SELECT id, title, prompt FROM PromptTemplate WHERE (previewUrl IS NULL OR previewUrl = ?) ORDER BY id ASC',
      ''
    ) as { id: number; title: string; prompt: string }[]

    if (!Array.isArray(rows) || rows.length === 0) {
      return NextResponse.json({ success: false, message: '所有模板已有预览图，无需生成' })
    }

    const total = rows.length
    const results: { id: number; title: string; success: boolean; url?: string; error?: string }[] = []

    for (let i = 0; i < rows.length; i++) {
      const t = rows[i]
      try {
        // 在提示词末尾追加质量关键词
        const enhancedPrompt = t.prompt + '，高清画质、电商展示风格、专业打光、干净背景、8K细节'
        const imageUrl = await generateImage(enhancedPrompt)

        if (imageUrl?.url) {
          // 更新 previewUrl
          await prisma.$executeRawUnsafe(
            'UPDATE PromptTemplate SET previewUrl = ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ?',
            imageUrl.url, t.id
          )
          results.push({ id: t.id, title: t.title, success: true, url: imageUrl.url })
          console.log(`[${i + 1}/${total}] ✅ ${t.title} -> ${imageUrl.url.substring(0, 60)}...`)
        } else {
          results.push({ id: t.id, title: t.title, success: false, error: 'AI 服务不可用，请检查硅基流动 API Key' })
          console.warn(`[${i + 1}/${total}] ❌ ${t.title} -> AI 服务不可用`)
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : '未知错误'
        results.push({ id: t.id, title: t.title, success: false, error: msg })
        console.error(`[${i + 1}/${total}] ❌ ${t.title} -> ${msg}`)
      }

      // 每张图间隔 1.5 秒，避免 API 限流
      if (i < rows.length - 1) {
        await new Promise(r => setTimeout(r, 1500))
      }
    }

    const successCount = results.filter(r => r.success).length
    return NextResponse.json({
      success: successCount > 0,
      message: `处理完成：成功 ${successCount} / 总计 ${total}`,
      data: { total, success: successCount, failed: total - successCount, details: results },
    })
  } catch (e) {
    console.error('生成预览图失败:', e)
    return NextResponse.json({ success: false, message: '服务器错误' }, { status: 500 })
  } finally {
    await prisma.$disconnect()
  }
}
