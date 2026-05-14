import { NextRequest, NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client'
import { getAuthFromHeaders } from '@/lib/api-auth'
import { writeFile, mkdir, unlink } from 'fs/promises'
import { join } from 'path'
import { existsSync } from 'fs'
import { execFile } from 'child_process'
import { promisify } from 'util'
import OSS from 'ali-oss'

const prisma = new PrismaClient()
const execFileAsync = promisify(execFile)

function createOSSClient() {
  const region = process.env.OSS_REGION || 'oss-cn-hangzhou'
  const accessKeyId = process.env.OSS_ACCESS_KEY_ID
  const accessKeySecret = process.env.OSS_ACCESS_KEY_SECRET
  const bucket = process.env.OSS_BUCKET
  if (!accessKeyId || !accessKeySecret || !bucket) throw new Error('OSS 配置不完整')
  return new OSS({ region, accessKeyId, accessKeySecret, bucket, secure: true, timeout: '300s' })
}

async function uploadToOSS(filePath: string, objectName: string): Promise<string | null> {
  try {
    const client = createOSSClient()
    const bucket = process.env.OSS_BUCKET || ''
    await client.put(objectName, filePath, { headers: { 'x-oss-object-acl': 'public-read' } })
    const region = process.env.OSS_REGION || 'oss-cn-hangzhou'
    return `https://${bucket}.${region}.aliyuncs.com/${objectName}`
  } catch (error) {
    console.error('[BatchVideoOSS] 上传失败:', error)
    return null
  }
}

function getVolcanoKey(): string | null {
  return process.env.VOLCANO_API_KEY || null
}

/** 调用 AI 生成 5 秒视频，支持选择模型 */
async function generatePreviewVideo(prompt: string, model: string): Promise<string | null> {
  // 使用百炼 happyhorse 或 wan2.7
  if (model === 'happyhorse' || model === 'wan2.7' || model === '') {
    try {
      const { generateVideo: genVid } = await import('@/lib/ai-providers')
      const modelName = model === 'wan2.7' ? 'wan2.7' : 'happyhorse'
      const result = await genVid(prompt, 5, '720P', '16:9', modelName)
      if (result?.taskId) {
        // 轮询结果（generateVideo 异步模式下只返回 taskId）
        for (let i = 0; i < 60; i++) {
          await new Promise(r => setTimeout(r, 3000))
          const { queryVideoTask } = await import('@/lib/ai-providers')
          const segResult = await queryVideoTask(result.taskId)
          if (segResult?.videoUrl) return segResult.videoUrl
          if (segResult?.status === 'FAILED') return null
        }
      } else if (result?.videoUrl) {
        return result.videoUrl
      }
      return null
    } catch (e) {
      console.log(`[BatchVideo] ${model} 失败:`, e)
      return null
    }
  }
  // 火山 doubao（旧路径）
  const key = getVolcanoKey()
  if (!key) {
    console.warn('[BatchVideo] 火山 Key 未配置，跳过')
    return null
  }
  try {
    const submitRes = await fetch('https://ark.cn-beijing.volces.com/api/v1/video/generation', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
      body: JSON.stringify({
        model: 'doubao-seedance-2.0',
        input: { prompt },
        parameters: { duration: 5, resolution: '720P', aspect_ratio: '16:9' },
      }),
      signal: AbortSignal.timeout(30000),
    })
    if (!submitRes.ok) {
      const err = await submitRes.text()
      console.log(`[BatchVideo] 火山提交失败: ${err.substring(0, 200)}`)
      return null
    }
    const submitData = await submitRes.json()
    const taskId = submitData?.output?.task_id
    if (!taskId) return null

    // 轮询
    for (let i = 0; i < 60; i++) {
      await new Promise(r => setTimeout(r, 5000))
      const pollRes = await fetch(`https://ark.cn-beijing.volces.com/api/v1/video/generation/${taskId}`, {
        headers: { 'Authorization': `Bearer ${key}` },
        signal: AbortSignal.timeout(10000),
      })
      if (!pollRes.ok) continue
      const pollData = await pollRes.json()
      const status = pollData?.output?.task_status
      if (status === 'SUCCEEDED') {
        return pollData?.output?.video_url || null
      }
      if (status === 'FAILED') break
    }
    return null
  } catch (e) {
    console.error('[BatchVideo] 生成失败:', e)
    return null
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = getAuthFromHeaders(request)
    if (!auth || auth.role !== 'admin') {
      return NextResponse.json({ success: false, message: '需要管理员权限' }, { status: 403 })
    }

    const body = await request.json().catch(() => ({}))
    const { ids, limit, model } = body

    // 获取需要生成的视频模板
    let rows: { id: number; title: string; prompt: string }[]
    if (Array.isArray(ids) && ids.length > 0) {
      const placeholders = ids.map(() => '?').join(',')
      rows = await prisma.$queryRawUnsafe(
        `SELECT id, title, prompt FROM PromptTemplate WHERE id IN (${placeholders}) AND (previewUrl IS NULL OR previewUrl = '') ORDER BY id ASC`,
        ...ids
      ) as any[]
    } else {
      rows = await prisma.$queryRawUnsafe(
        `SELECT id, title, prompt FROM PromptTemplate WHERE category = '文生视频' AND (previewUrl IS NULL OR previewUrl = '') ORDER BY id ASC`
      ) as any[]
    }

    if (!Array.isArray(rows) || rows.length === 0) {
      return NextResponse.json({ success: true, message: '没有待生成的视频模板' })
    }

    const maxLimit = Math.min(limit || rows.length, rows.length)
    const targetRows = rows.slice(0, maxLimit)
    const total = targetRows.length
    const results: { id: number; title: string; success: boolean; url?: string; error?: string }[] = []

    for (let i = 0; i < targetRows.length; i++) {
      const t = rows[i]
      console.log(`[BatchVideo] ${i + 1}/${total} 生成: ${t.title}`)
      try {
        const videoUrl = await generatePreviewVideo(t.prompt, model || '')
        if (videoUrl) {
          // 下载视频到临时文件，上传 OSS
          const videoRes = await fetch(videoUrl, { signal: AbortSignal.timeout(60000) })
          if (videoRes.ok) {
            const buffer = await videoRes.arrayBuffer()
            const tempDir = join(process.cwd(), 'temp')
            if (!existsSync(tempDir)) await mkdir(tempDir, { recursive: true })
            const tempPath = join(tempDir, `preview_${t.id}_${Date.now()}.mp4`)
            await writeFile(tempPath, new Uint8Array(buffer))

            const ossName = `previews/${Date.now()}_${t.id}.mp4`
            const ossUrl = await uploadToOSS(tempPath, ossName)
            await unlink(tempPath).catch(() => {})

            if (ossUrl) {
              await prisma.$executeRawUnsafe(
                'UPDATE PromptTemplate SET previewUrl = ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ?',
                ossUrl, t.id
              )
              results.push({ id: t.id, title: t.title, success: true, url: ossUrl })
              console.log(`[BatchVideo] ✅ ${i + 1}/${total} ${t.title} -> OSS`)
            } else {
              results.push({ id: t.id, title: t.title, success: false, error: 'OSS 上传失败' })
            }
          } else {
            results.push({ id: t.id, title: t.title, success: false, error: '下载失败' })
          }
        } else {
          results.push({ id: t.id, title: t.title, success: false, error: 'AI 生成失败' })
        }
      } catch (e: any) {
        results.push({ id: t.id, title: t.title, success: false, error: e.message })
      }
      // 间隔 3 秒
      if (i < rows.length - 1) await new Promise(r => setTimeout(r, 3000))
    }

    const successCount = results.filter(r => r.success).length
    return NextResponse.json({
      success: successCount > 0,
      message: `视频预览生成完成：成功 ${successCount} / 总计 ${total}`,
      data: { total, success: successCount, failed: total - successCount, details: results },
    })
  } catch (error) {
    console.error('[BatchVideo] 错误:', error)
    return NextResponse.json({ success: false, message: '服务器错误' }, { status: 500 })
  } finally {
    await prisma.$disconnect()
  }
}
