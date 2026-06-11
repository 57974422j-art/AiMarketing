import { NextRequest, NextResponse } from 'next/server'

// DeepSeek 定价（元/token）
const DEEPSEEK_PRICING = {
  input_per_1k:  0.001,  // 输入 ~0.001元/千token
  output_per_1k: 0.002   // 输出 ~0.002元/千token
}

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  try {
    const { description, industry, style, duration } = await request.json()
    if (!description && !industry) return NextResponse.json({ success: false, message: '请输入描述文字' }, { status: 400 })

    const key = process.env.DEEPSEEK_API_KEY
    if (!key) return NextResponse.json({ success: false, message: 'DeepSeek API Key 未配置' }, { status: 400 })

    const lineCount = Number(duration) >= 45 ? "15-25" : Number(duration) >= 30 ? "10-15" : "5-8"
    const durSec = Number(duration) || 30

    const prompt = `你是一个短视频导演AI。根据用户描述，输出完整的视频分镜脚本。

用户描述：${description || industry}
目标时长：${durSec}秒（${lineCount}句话）
风格：${style || '通用'}

【重要】你必须严格按以下JSON格式返回，不要输出其他任何内容：
{
  "lines": [
    {"text": "第一句口语化文案", "keyword": "英文搜图关键词"},
    {"text": "第二句文案", "keyword": "keyword for image search"}
  ],
  "title": {"text": "片头标题文字(8字以内)", "style": "bold|elegant|playful"},
  "sticker": {"text": "贴纸标签文字(6字以内，如'好可爱啊')", "position": "tl|tr|bl|br"},
  "filter": "warm|cool|bw|''",
  "voiceRecommend": "zh_female_vv_uranus_bigtts | zh_male_fengge_bigtts"
}

规则说明：
1. lines: ${lineCount}句口语化短视频文案，每句独立成行，不要序号。keyword要具体有画面感（英文），能搜到高质量配图
2. title: 从第一句文案提炼精华作为片头标题，吸引眼球
3. sticker: 设计一个互动贴纸标签，position=tl左上/tr右上/bl左下/br右下
4. filter: 根据内容氛围推荐色调（warm暖色温馨/cool冷色科技/bw黑白纪实/''原色）
5. voiceRecommend: 推荐最适合的配音（女声=zh_female_vv_uranus_bigtts, 温柔女声=zh_female_vv_aurora_bigtts, 稳重男声=zh_male_fengge_bigtts, 阳光男声=zh_male_xiaoming_bigtts）`

    const res = await fetch('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 2000,
      }),
    })
    const d = await res.json()
    const raw = d?.choices?.[0]?.message?.content?.trim()
    if (!raw) return NextResponse.json({ success: false, message: '生成失败' }, { status: 500 })

    // ── 精准 Token 费用计算 ──
    const usage = d.usage // { prompt_tokens, completion_tokens, total_tokens }
    let costData: any = null
    if (usage) {
      const inputCost = (usage.prompt_tokens || 0) / 1000 * DEEPSEEK_PRICING.input_per_1k
      const outputCost = (usage.completion_tokens || 0) / 1000 * DEEPSEEK_PRICING.output_per_1k
      costData = {
        tokens: usage.total_tokens || 0,
        inputTokens: usage.prompt_tokens || 0,
        outputTokens: usage.completion_tokens || 0,
        estimatedCNY: inputCost + outputCost,
        inputCNY: inputCost,
        outputCNY: outputCost,
      }
    }

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
    const validLines = parsed.lines.map((l: any) => ({
      text: (l.text || '').trim(),
      keyword: (l.keyword || '').trim() || (l.text || '').trim().slice(0, 20),
    })).filter((l: any) => l.text)

    return NextResponse.json({
      success: true,
      data: {
        script,
        lines: validLines,
        // 导演建议（AI生成后自动填充用）
        director: {
          title: parsed.title || { text: '', style: '' },
          sticker: parsed.sticker || { text: '', position: 'br' },
          filter: parsed.filter || '',
          voiceRecommend: parsed.voiceRecommend || '',
        },
        // 精准费用
        cost: costData,
      }
    })
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message })
  }
}
