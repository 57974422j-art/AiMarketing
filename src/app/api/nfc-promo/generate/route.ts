import { NextRequest, NextResponse } from 'next/server'
import { getAuthFromHeaders } from '@/lib/api-auth'
import { generateText } from '@/lib/ai-providers'

// 智能生成 NFC 推广文案
export async function POST(request: NextRequest) {
  const auth = getAuthFromHeaders(request)
  if (!auth) return NextResponse.json({ success: false, message: '请先登录' }, { status: 401 })

  try {
    const { name, description, triggerType } = await request.json()
    if (!name) {
      return NextResponse.json({ success: false, message: '缺少名称' }, { status: 400 })
    }

    const prompt = `你是一个 NFC 营销文案撰写专家。请为以下 NFC 推广规则生成文案内容：

规则名称：${name}
触发方式：${triggerType || 'NFC 碰一碰'}
描述：${description || '无'}

要求：
1. 生成 contentTitle（标题，15字以内）
2. 生成 contentUrl 建议（适合推广的链接类型）
3. 生成 contentValue（推广文案，80-150字，包含引导行动）
4. 只返回 JSON，格式：{"contentTitle":"标题","contentUrl":"链接类型","contentValue":"推广文案"}`

    const result = await generateText(prompt)
    const jsonMatch = result?.match(/\{[\s\S]*\}/)
    const generated = jsonMatch ? JSON.parse(jsonMatch[0]) : null

    return NextResponse.json({
      success: true,
      data: generated || { contentTitle: name, contentValue: description || '欢迎了解' }
    })
  } catch (error) {
    console.error('NFC 文案生成失败:', error)
    return NextResponse.json({ success: false, message: '生成失败' }, { status: 500 })
  }
}

// 强制动态渲染：API 路由依赖 request.headers / 鉴权，禁止 Next 在构建期静态预渲染
export const dynamic = 'force-dynamic'
