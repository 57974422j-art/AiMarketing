import { NextRequest, NextResponse } from 'next/server'
import { getAuthFromHeaders } from '@/lib/api-auth'
import { deleteObject } from '@/lib/oss'

export async function DELETE(request: NextRequest) {
  const auth = getAuthFromHeaders(request)
  if (!auth) return NextResponse.json({ success: false, message: '请先登录' }, { status: 401 })

  const { name, names } = await request.json()
  const list: string[] = Array.isArray(names) && names.length ? names : (name ? [name] : [])
  if (!list.length) return NextResponse.json({ success: false, message: '缺少文件名' }, { status: 400 })

  try {
    let failed = 0
    let thumbs = 0
    for (const n of list) {
      if (!/^[a-zA-Z0-9._\-]+$/.test(n)) { failed++; continue }
      try { await deleteObject(`storage/${auth.userId}/${n}`) } catch { failed++ }
      // ★VF_THUMBDEL_V1（2026-10-10 用户服务器实测：**真删了 70 个素材、缩略图全留在 OSS**）：
      //   缩略图 key 是 storage/<uid>/.thumbs/<同名>.jpg（personal-storage.ts:103），
      //   而上面那条校验正则**不允许 '/'** ⇒ 永远拼不出这个 key ⇒ 删除后缩略图变孤儿
      //   （列表按 .thumbs 过滤 ⇒ 看不见，但 9.9MB 里大半是这种垃圾）。
      //   现口径：删主文件时**一并删缩略图**（对不存在的对象 delete 是幂等的，不会报错）。
      const stem = n.replace(/\.[A-Za-z0-9]+$/, '')
      if (stem !== n) {
        try { await deleteObject(`storage/${auth.userId}/.thumbs/${stem}.jpg`); thumbs++ } catch { /* 没有缩略图就算了 */ }
      }
    }
    return NextResponse.json({
      success: true,
      message: `已删除 ${list.length - failed} 个` + (failed ? `，失败 ${failed} 个` : '')
        + (thumbs ? `（含缩略图 ${thumbs} 个）` : ''),
    })
  } catch (e: any) {
    return NextResponse.json({ success: false, message: e.message || '删除失败' }, { status: 500 })
  }
}

// 强制动态渲染：API 路由依赖 request.headers / 鉴权，禁止 Next 在构建期静态预渲染
export const dynamic = 'force-dynamic'
