import { NextRequest, NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client'
import { getAuthFromHeaders } from '@/lib/api-auth'
import { generateImage } from '@/lib/ai-providers'
import { existsSync, writeFileSync, unlinkSync } from 'fs'
import { join } from 'path'

const prisma = new PrismaClient()

/** 下载并转存到 OSS，返回永久链接 */
async function saveToOSS(url: string, ext: string): Promise<string | null> {
  if (!process.env.OSS_ACCESS_KEY_ID || !process.env.OSS_BUCKET) return null
  try {
    const resp = await fetch(url, { signal: AbortSignal.timeout(120000) })
    if (!resp.ok) return null
    const buf = await resp.arrayBuffer()
    const tempPath = join(process.cwd(), 'temp', `preview_${Date.now()}.${ext}`)
    writeFileSync(tempPath, new Uint8Array(buf))

    const OSS = (await import('ali-oss')).default
    const client = new OSS({
      region: process.env.OSS_REGION || 'oss-cn-hangzhou',
      accessKeyId: process.env.OSS_ACCESS_KEY_ID!,
      accessKeySecret: process.env.OSS_ACCESS_KEY_SECRET!,
      bucket: process.env.OSS_BUCKET!,
      secure: true,
    })
    const ossName = `previews/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`
    await client.put(ossName, tempPath, { headers: { 'x-oss-object-acl': 'public-read' } })
    unlinkSync(tempPath)
    return `https://${process.env.OSS_BUCKET}.${process.env.OSS_REGION || 'oss-cn-hangzhou'}.aliyuncs.com/${ossName}`
  } catch (e) {
    console.error('[转存OSS] 失败:', e)
    return null
  }
}

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

    const body = await request.json().catch(() => ({}))
    const { ids, limit, model, category } = body

    // 获取需要生成的模板
    let rows: { id: number; title: string; prompt: string; category: string }[]
    if (Array.isArray(ids) && ids.length > 0) {
      const placeholders = ids.map(() => '?').join(',')
      let sql = `SELECT id, title, prompt, category FROM PromptTemplate WHERE id IN (${placeholders})`
      if (category) sql += ' AND category = ?'
      sql += ' ORDER BY id ASC'
      rows = category
        ? await prisma.$queryRawUnsafe(sql, ...ids, category) as any[]
        : await prisma.$queryRawUnsafe(sql, ...ids) as any[]
    } else {
      let sql = 'SELECT id, title, prompt, category FROM PromptTemplate WHERE (previewUrl IS NULL OR previewUrl = ?)'
      if (category) sql += ' AND category = ?'
      sql += ' ORDER BY id ASC'
      rows = category
        ? await prisma.$queryRawUnsafe(sql, '', category) as any[]
        : await prisma.$queryRawUnsafe(sql, '') as any[]
    }

    if (!Array.isArray(rows) || rows.length === 0) {
      return NextResponse.json({ success: false, message: '没有待生成的模板' })
    }

    // 按 limit 截取
    const maxLimit = Math.min(limit || rows.length, rows.length)
    const targetRows = rows.slice(0, maxLimit)
    const total = targetRows.length
    const results: { id: number; title: string; success: boolean; url?: string; error?: string }[] = []

    for (let i = 0; i < targetRows.length; i++) {
      const t = targetRows[i]
      try {
        const enhancedPrompt = t.prompt + '，高清画质、电商展示风格、专业打光、干净背景、8K细节'
        const imageUrl = await generateImage(enhancedPrompt, '1280*1280', model as any)

        if (imageUrl?.url) {
          // 转存到自己的 OSS（临时链接会过期）——必须成功才写库，失败不写临时链接
          const ext = imageUrl.url.endsWith('.png') ? 'png' : 'jpg'
          const ossUrl = await saveToOSS(imageUrl.url, ext)
          if (ossUrl) {
            await prisma.$executeRawUnsafe(
              'UPDATE PromptTemplate SET previewUrl = ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ?',
              ossUrl, t.id
            )
            results.push({ id: t.id, title: t.title, success: true, url: ossUrl })
            console.log(`[${i + 1}/${total}] ✅ ${t.title} -> ${ossUrl.substring(0, 60)}...`)
          } else {
            results.push({ id: t.id, title: t.title, success: false, error: 'OSS 转存失败，未写库（请检查 OSS_* 环境变量或网络）' })
            console.warn(`[${i + 1}/${total}] ❌ ${t.title} -> OSS 转存失败，未写库`)
          }
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

// 强制动态渲染：API 路由依赖 request.headers / 鉴权，禁止 Next 在构建期静态预渲染
export const dynamic = 'force-dynamic'
