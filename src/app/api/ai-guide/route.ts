import { NextRequest, NextResponse } from 'next/server'

// 系统默认 Key（免登录用户兜底 Key）
function getDefaultKey(): string | null {
  return process.env.DASHSCOPE_API_KEY || process.env.DEEPSEEK_API_KEY || null
}

/** 调用 AI 生成营销策略 */
async function generateStrategy(industry: string, goals: string[]): Promise<string | null> {
  const key = getDefaultKey()
  if (!key) return mockStrategy(industry, goals)

  const prompt = `你是一个营销策略专家。用户选择了以下信息：

行业：${industry}
营销目标：${goals.join('、')}

请生成一份简洁的营销策略建议，包含以下三部分（用 markdown 格式）：

## 账号定位
根据行业和目标，建议的账号人设和内容定位

## 内容建议
3-5 条具体的内容方向建议

## 推荐功能
根据策略推荐平台中的功能：AI 文案生成、AI 生图、视频编辑、数字人（选合适的列出来）

请直接输出策略，不要额外解释。`

  try {
    const res = await fetch('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.8,
        max_tokens: 2000,
      }),
      signal: AbortSignal.timeout(30000),
    })
    if (!res.ok) return mockStrategy(industry, goals)
    const data = await res.json()
    return data.choices?.[0]?.message?.content?.trim() || mockStrategy(industry, goals)
  } catch {
    return mockStrategy(industry, goals)
  }
}

/** 无 API Key 时的模拟策略 */
function mockStrategy(industry: string, goals: string[]): string {
  const goalMap: Record<string, string> = {
    '短视频推广': '高频发布15-60秒竖版短视频，突出产品卖点与使用场景',
    '直播引流': '每日固定时段直播，结合限时优惠引导转化',
    '私域转化': '通过评论区引导+主页链接将流量导入私域社群',
    '品牌宣传': '打造品牌人设IP，持续输出品牌故事与价值观内容',
  }
  const suggestions = goals.map(g => goalMap[g] || '').filter(Boolean)
  return `## 账号定位\n专注**${industry}**领域的专业内容创作者，以"行业专家+真实分享"的人设打造差异化IP。\n\n## 内容建议\n${suggestions.map((s, i) => `${i + 1}. ${s}`).join('\n')}\n\n## 推荐功能\n- **AI 文案生成** — 批量生成适配多平台的推广文案\n- **AI 生图** — 一键生成产品展示图/封面图\n- **视频编辑** — 多模板合成，自动配音+字幕\n- **数字人** — 克隆形象生成口播视频，降低出镜成本`
}

/** 场景→模板：AI 根据场景描述生成多条提示词模板 */
async function generateScenePrompts(scene: string): Promise<{ title: string; category: string; prompt: string }[] | null> {
  const key = getDefaultKey()
  if (!key) return mockScenePrompts(scene)

  const prompt = `你是一个营销提示词生成专家。根据用户描述的场景"${scene}"，生成 4 条对应的 AI 生图/生视频提示词模板。

要求：
- 2 条文生图（category="文生图"），用于生成营销配图/封面
- 2 条文生视频（category="文生视频"），用于生成短视频素材
- 每条包含 title（中文标题）、prompt（详细的英文提示词，含风格/光线/构图等描述）
- 直接输出 JSON 数组，不要多余文字
- 格式：[{"title":"...","category":"文生图","prompt":"..."},{"title":"...","category":"文生视频","prompt":"..."}]`

  try {
    const res = await fetch('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.8, max_tokens: 2000,
      }),
      signal: AbortSignal.timeout(30000),
    })
    if (!res.ok) return mockScenePrompts(scene)
    const data = await res.json()
    const text = data.choices?.[0]?.message?.content?.trim()
    if (!text) return mockScenePrompts(scene)
    // 提取 JSON
    const jsonMatch = text.match(/\[[\s\S]*?\]/)
    if (!jsonMatch) return mockScenePrompts(scene)
    return JSON.parse(jsonMatch[0])
  } catch { return mockScenePrompts(scene) }
}

function mockScenePrompts(scene: string): { title: string; category: string; prompt: string }[] {
  return [
    { title: `${scene}-封面图`, category: '文生图', prompt: `${scene}，高端大气，专业摄影，8K细节，营销海报风格` },
    { title: `${scene}-产品展示`, category: '文生图', prompt: `${scene}，产品展示，白底图，专业打光，电商风格，干净背景` },
    { title: `${scene}-短视频`, category: '文生视频', prompt: `${scene}，slow motion，cinematic lighting，professional footage` },
    { title: `${scene}-宣传片`, category: '文生视频', prompt: `${scene}，aerial view，smooth transition，brand promotion style` },
  ]
}

// ====== API 入口 ======

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { action, industry, goals, scene } = body

    if (action === 'generate-strategy') {
      if (!industry || !Array.isArray(goals) || goals.length === 0) {
        return NextResponse.json({ success: false, message: '请选择行业和营销目标' }, { status: 400 })
      }
      const strategy = await generateStrategy(industry, goals)
      return NextResponse.json({ success: true, strategy })
    }

    if (action === 'scene-prompts') {
      if (!scene) return NextResponse.json({ success: false, message: '请输入场景描述' }, { status: 400 })
      const prompts = await generateScenePrompts(scene)
      if (!prompts) return NextResponse.json({ success: false, message: '生成失败' }, { status: 500 })
      return NextResponse.json({ success: true, prompts })
    }

    return NextResponse.json({ success: false, message: '未知 action' }, { status: 400 })
  } catch (error) {
    console.error('[AIGuide] 异常:', error)
    return NextResponse.json({ success: false, message: '服务器错误' }, { status: 500 })
  }
}
