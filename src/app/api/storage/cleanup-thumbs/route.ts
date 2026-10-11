import { NextRequest, NextResponse } from 'next/server'
import { getAuthFromHeaders } from '@/lib/api-auth'
import { listObjects, deleteObject } from '@/lib/oss'
import { orphanThumbs } from '@/lib/repo-naming'

/**
 * ★VF_THUMBGC_V1（2026-10-12 收口「缩略图孤儿」）
 * =============================================================================
 * 病灶：删除接口直到 2026-10-10 才补上"连缩略图一起删"（VF_THUMBDEL_V1）
 *   ⇒ **在那之前删掉的素材**，缩略图全留在 `.thumbs/`（用户实测：真删 70 个素材、缩略图全在，
 *     9.9MB 里大半是这种垃圾）；另外 `.thumbs/analyze/…` 这类**别的线写的**，删除时也没人清。
 * 口径：
 *   · 孤儿判定 = `.thumbs/` 下找不到"同名主干的主文件"（判定在 lib/repo-naming.orphanThumbs，纯函数可单测）
 *   · **由用户点按钮触发**，不做后台自动删（删数据的动作要透明）
 *   · 单次最多 200 个，超出提示再点一次（避免一次请求打爆 OSS API）
 */
const MAX_DELETE = 200

export async function POST(request: NextRequest) {
  const auth = getAuthFromHeaders(request)
  if (!auth?.userId) return NextResponse.json({ success: false, message: '请先登录' }, { status: 401 })

  const prefix = `storage/${auth.userId}/`
  try {
    const objs = await listObjects(prefix, 2000)
    const sizeOf = new Map(objs.map((o) => [o.name, o.size || 0]))
    const orphans = orphanThumbs(objs.map((o) => o.name))
    const batch = orphans.slice(0, MAX_DELETE)

    let deleted = 0, bytes = 0
    for (const key of batch) {
      try { await deleteObject(key); deleted++; bytes += sizeOf.get(key) || 0 } catch { /* 单个失败跳过，不阻断整批 */ }
    }
    const rest = Math.max(0, orphans.length - deleted)
    return NextResponse.json({
      success: true,
      data: { found: orphans.length, deleted, bytes, rest },
      message: `孤儿缩略图：发现 ${orphans.length} 个，已清理 ${deleted} 个（约 ${Math.round(bytes / 1024)}KB）`
        + (rest ? `；还剩 ${rest} 个，再点一次即可` : ''),
    })
  } catch (e: any) {
    return NextResponse.json({ success: false, message: e.message || '清理失败' }, { status: 500 })
  }
}

// 强制动态渲染：依赖 request.headers 鉴权，禁止构建期静态预渲染
export const dynamic = 'force-dynamic'
