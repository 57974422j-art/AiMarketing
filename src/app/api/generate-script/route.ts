import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  try {
    const { description, industry, style, duration } = await request.json()
    if (!description && !industry) return NextResponse.json({ success: false, message: '请输入描述文字' }, { status: 400 })

    const key = process.env.DEEPSEEK_API_KEY
    if (!key) return NextResponse.json({ success: false, message: 'DeepSeek API Key 未配置' }, { status: 400 })

    const lineCount = Number(duration) >= 45 ? "15-25" : Number(duration) >= 30 ? "10-15" : "5-8"

    const prompt = `你是一个短视频脚本创作专家。根据以下描述生成一段短视频脚本。

描述内容：${description || industry}
风格：${style || '通用'}
要求：${lineCount}句话，每句话独立成行，语气自然口语化，适合配音。

【重要】你必须严格按以下JSON格式返回，不要输出其他任何内容：
{
  "lines": [
    {"text": "第一句文案内容", "keyword": "搜索这张图用的英文关键词"},
    {"text": "第二句文案内容", "keyword": "搜图关键词"}
  ]
}

规则：
- text: 一句口语化的短视频文案（不要序号）
- keyword: 用于图片搜索的精准关键词（英文优先），要能搜到和文案匹配的高质量配图
- keyword 要具体、有画面感，避免太抽象`

    const res = await fetch('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: 'deepseek-chat', messages: [{ role: 'user', content: prompt }], max_tokens: 1000 }),
    })
    const d = await res.json()
    const raw = d?.choices?.[0]?.message?.content?.trim()
    if (!raw) return NextResponse.json({ success: false, message: '生成失败' }, { status: 500 })

    // 尝试解析 JSON（AI 可能包裹在 ```json 中）
    let parsed: any
    try {
      const jsonStr = raw.replace(/```json\s*|\s*```/g, '').trim()
      parsed = JSON.parse(jsonStr)
    } catch {
      // JSON 解析失败，降级为纯文本处理
      const lines = raw.split('\n').filter((l: string) => l.trim())
      parsed = { lines: lines.map((l: string) => ({ text: l.trim(), keyword: l.trim().slice(0, 20) })) }
    }

    // 安全校验
    if (!parsed.lines || !Array.isArray(parsed.lines)) {
      parsed = { lines: [{ text: raw, keyword: description || industry || 'video' }] }
    }

    const script = parsed.lines.map((l: any) => l.text).join('\n')
    return NextResponse.json({
      success: true,
      data: {
        script,
        lines: parsed.lines.map((l: any) => ({
          text: (l.text || '').trim(),
          keyword: (l.keyword || '').trim() || (l.text || '').trim().slice(0, 20)
        })).filter((l: any) => l.text)
      }
    })
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message })
  }
}
