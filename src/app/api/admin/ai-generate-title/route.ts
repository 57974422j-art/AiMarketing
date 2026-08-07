import { NextRequest, NextResponse } from 'next/server'
import { generateText } from '@/lib/ai-providers'
import { getAuthFromHeaders } from '@/lib/api-auth'

export async function POST(req: NextRequest) {
  const auth = getAuthFromHeaders(req)
  if (!auth) return NextResponse.json({ success: false, message: '未认证，请先登录' }, { status: 401 })
  if (auth.role !== 'admin') return NextResponse.json({ success: false, message: '仅管理员可操作' }, { status: 403 })
  try {
    const { keyword } = await req.json()
    if (!keyword) return NextResponse.json({ error: '缺少keyword' }, { status: 400 })

    const prompt = `你是一个抖音SEO运营专家。请根据关键词生成：
1. 一个吸引人的标题（带钩子，20字以内）
2. 3~5个SEO优化热门话题标签
关键词：${keyword}
格式：标题文字|#话题1 #话题2 #话题3 #话题4 #话题5`

    const result = await generateText(prompt)
    if (result && result.includes('|')) {
      const parts = result.split('|')
      const title = parts[0].trim().replace(/^[「『""]|[」』""]$/g, '').replace(/^标题[：:]\s*/i, '')
      const topics = parts.slice(1).join('').trim()
      return NextResponse.json({ title, topics })
    }
    return NextResponse.json({ title: result || '', topics: '' })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || '生成失败' }, { status: 500 })
  }
}

// 强制动态渲染：API 路由依赖 request.headers / 鉴权，禁止 Next 在构建期静态预渲染
export const dynamic = 'force-dynamic'
