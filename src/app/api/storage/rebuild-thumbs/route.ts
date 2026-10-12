import { NextRequest, NextResponse } from 'next/server'
import { getAuthFromHeaders } from '@/lib/api-auth'
import { listAllObjects, deleteObject } from '@/lib/oss'

/**
 * ★VF_THUMBREBUILD_V1（2026-10-12 用户定案「个人仓库这里 先修改好」）
 * =============================================================================
 * 用途：**重建缩略图** —— 把"有主文件、但缩略图内容不对（张冠李戴/旧帧）"的缩略图**删掉**，
 *   列表下次加载时由 `ensureThumb` 按**现在的视频文件**重新抽一帧 ⇒ 缩略图与素材重新对上。
 * 与「清理孤儿缩略图」（`api/storage/cleanup-thumbs`）的分工：
 *   · 孤儿 = `.thumbs/` 下**找不到主文件**（历史垃圾）      → 那个按钮管
 *   · 本路由 = `.thumbs/` 下**有主文件但内容不对**（要重抽） → 这个按钮管
 * 口径：**用户点才删**（不后台自动删）；单次最多 200 个；只删缩略图，**不碰任何素材**。
 */
const VIDEO_RE = /\.(mp4|mov|avi|mkv|webm)$/i
const MAX_REBUILD = 200

export async function POST(request: NextRequest) {
  const auth = getAuthFromHeaders(request)
  if (!auth?.userId) return NextResponse.json({ success: false, message: '请先登录' }, { status: 401 })

  const prefix = `storage/${auth.userId}/`
  try {
    // ★VF_OSS_MAXKEYS_V1：分页全量（单次最多 1000 条，仓库里"素材 + .thumbs"叠起来常超）
    const objs = await listAllObjects(prefix, 20000)
    const sizeOf = new Map(objs.map((o) => [o.name, o.size || 0]))

    // 主视频名（去掉目录前缀），并算出"主干名"（去扩展名）集合
    const stems = new Set<string>()
    for (const o of objs) {
      if (o.name.includes('/.thumbs/') || o.name.includes('/_gen/')) continue
      const base = o.name.slice(prefix.length)
      if (!VIDEO_RE.test(base)) continue
      stems.add(base.replace(VIDEO_RE, ''))
    }

    // 需要重建 = `.thumbs/` 下**主干名能在主文件里找到**的那些（即"有主文件但图不对"）
    const targets: string[] = []
    for (const o of objs) {
      if (!o.name.includes('/.thumbs/')) continue
      const thumbBase = o.name.split('/.thumbs/')[1] || ''
      if (!/\.jpg$/i.test(thumbBase)) continue
      if (stems.has(thumbBase.replace(/\.jpg$/i, ''))) targets.push(o.name)
      if (targets.length >= MAX_REBUILD) break
    }

    let deleted = 0, bytes = 0
    for (const key of targets) {
      try { await deleteObject(key); deleted++; bytes += sizeOf.get(key) || 0 } catch { /* 单个失败跳过 */ }
    }
    const rest = Math.max(0, targets.length - deleted)
    return NextResponse.json({
      success: true,
      data: { scanned: objs.length, found: targets.length, deleted, bytes, rest },
      message: `已删除 ${deleted} 张缩略图（约 ${Math.round(bytes / 1024)}KB）——**刷新列表**后系统会按现有视频重新抽帧`
        + (rest ? `；还有 ${rest} 张没处理，再点一次即可` : '')
        + '。素材本身未做任何改动。',
    })
  } catch (e: any) {
    return NextResponse.json({ success: false, message: e.message || '重建失败' }, { status: 500 })
  }
}

// 强制动态渲染：依赖 request.headers 鉴权，禁止构建期静态预渲染
export const dynamic = 'force-dynamic'
