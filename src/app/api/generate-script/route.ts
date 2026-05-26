import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  try {
    const { industry, style, duration } = await request.json()
    if (!industry) return NextResponse.json({ success: false, message: '请输入行业/产品描述' }, { status: 400 })

    const key = process.env.DEEPSEEK_API_KEY
    if (!key) return NextResponse.json({ success: false, message: 'DeepSeek API Key 未配置' }, { status: 400 })

    const prompt = `你是一个短视频脚本创作专家。根据以下要求生成一段短视频脚本（${Number(duration) >= 45 ? "约15-25句话" : Number(duration) >= 30 ? "约10-15句话" : "约5-8句话"}，每句话占一行，适合配音）：
产品/行业：${industry}
风格：${style || '通用'}
要求：每句话独立成行，语气自然口语化，适合配音，不要序号，不要标题。`

    const res = await fetch('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: 'deepseek-chat', messages: [{ role: 'user', content: prompt }], max_tokens: 500 }),
    })
    const d = await res.json()
    const script = d?.choices?.[0]?.message?.content?.trim()
    if (!script) return NextResponse.json({ success: false, message: '生成失败' }, { status: 500 })
    return NextResponse.json({ success: true, data: { script, lines: script.split('\n').filter(Boolean) } })
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message })
  }
}
