import { NextRequest, NextResponse } from 'next/server'
import { getAuthFromHeaders } from '@/lib/api-auth'
import { signedUrl } from '@/lib/oss'
import { saveToPersonalRepo } from '@/lib/personal-storage'
// ★VF_QUOTA_V2b（2026-10-12 收口）：配额常量与判定**只认 lib/storage-quota**（一处真源）。
//   这里原先自己写死 500MB + 自己 listObjects 求和（还把 .thumbs/ 缩略图与生成物算进去）—— 已删。
import { quotaUsed, quotaCheck as quotaMsgFn } from '@/lib/storage-quota'

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

    // 检查配额（★VF_QUOTA_V2b：走真源 —— 排除 .thumbs/ 缩略图与 gen_ 生成物；列目录失败返回 -1）
    const used = await quotaUsed(auth.userId)

    addLog(`[STORAGE] 开始下载视频`)

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

    // 配额检查（与上传口**同一判据**：450MB 拒传；统计失败也拒 ⇒ 绝不静默放行）
    const qMsg = quotaMsgFn(used, fileSize)
    if (qMsg) return NextResponse.json({ success: false, message: qMsg }, { status: 413 })

    // 统一写入个人仓库（日期序命名 + 自动缩略图）
    try {
      const res = await saveToPersonalRepo({ userId: auth.userId, buffer, ext: 'mp4', mime: 'video/mp4', quotaCheck: false, gen: true })
      addLog(`[STORAGE] 保存成功: ${res.name} (${Math.round(fileSize / 1024 / 1024)}MB)`)
      return NextResponse.json({
        success: true,
        data: {
          name: res.name,
          size: fileSize,
          url: `/api/storage/file?userId=${auth.userId}&name=${res.name}`,
        },
        message: `✅ 已存入素材库: ${res.name}`,
      })
    } catch (e) {
      const message = e instanceof Error ? e.message : '保存失败'
      return NextResponse.json({ success: false, message }, { status: 413 })
    }

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

// 强制动态渲染：API 路由依赖 request.headers / 鉴权，禁止 Next 在构建期静态预渲染
export const dynamic = 'force-dynamic'
