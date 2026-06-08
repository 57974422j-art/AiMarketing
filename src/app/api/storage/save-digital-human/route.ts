import { NextRequest, NextResponse } from 'next/server'
import { getAuthFromHeaders } from '@/lib/api-auth'
import { putObject, listObjects, signedUrl } from '@/lib/oss'

const MAX_QUOTA = 500 * 1024 * 1024 // 500MB

/**
 * POST /api/storage/save-digital-human
 *
 * 将数字人生成的口播视频（OSS URL）下载并存入素材仓库（OSS）
 *
 * Body:
 *   - videoUrl: 视频地址（avatarUrl）
 *   - title:    可选标题，用作文件名前缀
 */
export async function POST(request: NextRequest) {
  const auth = getAuthFromHeaders(request)
  if (!auth) return NextResponse.json({ success: false, message: '请先登录' }, { status: 401 })

  try {
    const { videoUrl, title } = await request.json()
    if (!videoUrl) return NextResponse.json({ success: false, message: '缺少 videoUrl' }, { status: 400 })

    // 检查配额（从 OSS 统计已用空间）
    let used = 0
    try {
      const files = await listObjects(`storage/${auth.userId}/`)
      used = files.reduce((sum, f) => sum + f.size, 0)
    } catch { /* 首次使用可能无目录 */ }

    // 生成文件名：dh_时间戳_title(可选).mp4
    const timestamp = Date.now()
    const safeTitle = (title || 'video').replace(/[^a-zA-Z0-9\u4e00-\u9fff_-]/g, '_').slice(0, 30)
    const fileName = `dh_${timestamp}_${safeTitle}.mp4`
    const key = `storage/${auth.userId}/${fileName}`

    addLog(`[STORAGE] 开始下载视频 → ${fileName}`)
    
    // 下载视频
    const response = await fetch(videoUrl)
    if (!response.ok) {
      return NextResponse.json({
        success: false,
        message: `下载失败: HTTP ${response.status}`,
      }, { status: 502 })
    }

    const buffer = Buffer.from(await response.arrayBuffer())
    const fileSize = buffer.length

    // 配额检查
    if (used + fileSize > MAX_QUOTA) {
      return NextResponse.json({
        success: false,
        message: `存储空间不足 (已用 ${Math.round(used / 1024 / 1024)}MB / 500MB)`,
      }, { status: 413 })
    }

    // 上传到 OSS
    await putObject(key, buffer, 'video/mp4')
    addLog(`[STORAGE] 保存成功: ${fileName} (${Math.round(fileSize / 1024 / 1024)}MB)`)

    return NextResponse.json({
      success: true,
      data: {
        name: fileName,
        size: fileSize,
        url: `/api/storage/file?userId=${auth.userId}&name=${fileName}`,
      },
      message: `✅ 已存入素材库: ${fileName}`,
    })

  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : '保存失败'
    console.error('[STORAGE save-digital-human]', e)
    return NextResponse.json({ success: false, message: msg }, { status: 500 })
  }
}

// 简单的日志辅助（非必须，方便调试）
function addLog(msg: string) {
  const ts = new Date().toLocaleTimeString()
  console.log(`[${ts}] ${msg}`)
}
