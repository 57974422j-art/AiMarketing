import { NextRequest, NextResponse } from 'next/server'
import { getAuthFromHeaders } from '@/lib/api-auth'
import { putObject } from '@/lib/oss'
import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

// POST /api/prompt-templates/fetch-image?id=X - 按提示词关键词拉一张图 → OSS → 更新 previewUrl
export async function POST(request: NextRequest) {
  const auth = getAuthFromHeaders(request)
  if (!auth) return NextResponse.json({ success: false, message: '未认证' }, { status: 401 })
  try {
    const id = parseInt(new URL(request.url).searchParams.get('id') || '', 10)
    if (!id) return NextResponse.json({ success: false, message: '缺少 id' }, { status: 400 })
    const tpl = await prisma.promptTemplate.findFirst({ where: { id } })
    if (!tpl) return NextResponse.json({ success: false, message: '模板不存在' }, { status: 404 })

    // 已有封面直接返回
    if (tpl.previewUrl) return NextResponse.json({ success: true, url: tpl.previewUrl, cached: true })

    // 按提示词关键词搜图（Pixabay 优先——免版权、国内可达）
    const kw = (tpl.prompt || '').replace(/\s+/g, ' ').split(' ').slice(0, 8).join(' ')
    const pixabayKey = process.env.PIXABAY_API_KEY
    let imgUrl = ''
    if (pixabayKey) {
      try {
        const r = await fetch(`https://pixabay.com/api/?key=${pixabayKey}&q=${encodeURIComponent(kw.substring(0, 100))}&image_type=photo&per_page=5&safesearch=true`, { signal: AbortSignal.timeout(15000) })
        const d = await r.json()
        if (d?.hits?.length) imgUrl = d.hits[0].webformatURL
      } catch {}
    }

    if (!imgUrl) {
      // 兜底：GIPHY/或直接返回失败（避免死链）
      return NextResponse.json({ success: false, message: '未搜到可用图片（Pixabay 无结果）——换关键词或稍后重试' }, { status: 404 })
    }

    // 下载 → OSS
    const buf = Buffer.from(await (await fetch(imgUrl, { signal: AbortSignal.timeout(20000) })).arrayBuffer())
    if (buf.length < 500) return NextResponse.json({ success: false, message: '图片下载失败' }, { status: 502 })
    const key = `prompts/cheerselfai/fetched/${id}-${Date.now()}.jpg`
    await putObject(key, buf, 'image/jpeg')
    const ossUrl = `https://${process.env.OSS_BUCKET}.${process.env.OSS_REGION}.aliyuncs.com/${key}`
    await prisma.promptTemplate.update({ where: { id }, data: { previewUrl: ossUrl, coverUrl: ossUrl } })
    return NextResponse.json({ success: true, url: ossUrl, keyword: kw.substring(0, 60) })
  } catch (e: any) {
    return NextResponse.json({ success: false, message: e?.message || '拉图失败' }, { status: 500 })
  }
}
