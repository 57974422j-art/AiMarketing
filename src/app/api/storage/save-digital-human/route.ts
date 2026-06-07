import { NextRequest, NextResponse } from 'next/server'
import path from 'path'
import fs from 'fs'
import { getAuthFromHeaders } from '@/lib/api-auth'

const STORAGE = '/root/AiMarketing/public/storage'

/**
 * POST /api/storage/save-digital-human
 *
 * 将数字人生成的口播视频（OSS URL）下载并存入素材仓库
 *
 * Body:
 *   - videoUrl: OSS 视频地址（avatarUrl）
 *   - title:    可选标题，用作文件名前缀
 */
export async function POST(request: NextRequest) {
  const auth = getAuthFromHeaders(request)
  if (!auth) return NextResponse.json({ success: false, message: '请先登录' }, { status: 401 })

  try {
    const { videoUrl, title } = await request.json()
    if (!videoUrl) return NextResponse.json({ success: false, message: '缺少 videoUrl' }, { status: 400 })

    // 目标目录
    const destDir = path.join(STORAGE, String(auth.userId))
    if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true })

    // 检查配额（500MB）
    let used = 0
    if (fs.existsSync(destDir)) {
      for (const f of fs.readdirSync(destDir)) {
        try { used += fs.statSync(path.join(destDir, f)).size; } catch { /* skip */ }
      }
    }

    // 生成文件名：dh_时间戳_title(可选).mp4
    const timestamp = Date.now()
    const safeTitle = (title || 'video').replace(/[^a-zA-Z0-9\u4e00-\u9fff_-]/g, '_').slice(0, 30)
    const fileName = `dh_${timestamp}_${safeTitle}.mp4`
    const destPath = path.join(destDir, fileName)

    // 下载 OSS 视频
    addLog(`[STORAGE] 开始下载视频 → ${fileName}`)
    
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
    if (used + fileSize > 500 * 1024 * 1024) {
      return NextResponse.json({
        success: false,
        message: `存储空间不足 (已用 ${Math.round(used / 1024 / 1024)}MB / 500MB)`,
      }, { status: 413 })
    }

    // 写入文件
    fs.writeFileSync(destPath, buffer)
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
