import { NextRequest, NextResponse } from 'next/server'
import { generateText, generateImage, generateVideo, deepSeekFunctionCall, ToolDefinition } from '@/lib/ai-providers'
import { getAuthFromHeaders } from '@/lib/api-auth'

// ==================== 工具定义 (OpenAI Function Calling 格式) ====================

const AGENT_TOOLS: ToolDefinition[] = [
  {
    name: 'generate_copy',
    description: '为用户生成营销文案、广告语、社交媒体内容。当用户提到"写文案"、"推广"、"广告"、"小红书文案"、"抖音脚本"时使用。',
    parameters: {
      type: 'object',
      properties: {
        product: { type: 'string', description: '产品或品牌名称' },
        platform: { type: 'string', description: '目标平台，如抖音/小红书/微信/多平台' },
        style: { type: 'string', description: '风格，如专业/活泼/幽默/高端' },
      },
      required: ['product'],
    },
  },
  {
    name: 'generate_image',
    description: '根据文字描述AI生成图片。当用户提到"生成图片"、"做海报"、"设计图"、"画一张"时使用。',
    parameters: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: '图片的详细描述' },
        size: { type: 'string', description: '尺寸，如1024*1024, 768*1344, 1440*720' },
      },
      required: ['prompt'],
    },
  },
  {
    name: 'generate_video',
    description: '根据文字描述AI生成短视频。当用户提到"做视频"、"生成视频"、"短视频"时使用。',
    parameters: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: '视频内容的详细描述' },
        duration: { type: 'number', description: '视频时长(秒)，默认5' },
        ratio: { type: 'string', description: '画面比例，16:9横屏/9:16竖屏，默认16:9' },
      },
      required: ['prompt'],
    },
  },
  {
    name: 'search_templates',
    description: '搜索后台素材库和提示词模板。当用户问有没有什么模板、场景、素材可用时使用。',
    parameters: {
      type: 'object',
      properties: {
        keyword: { type: 'string', description: '搜索关键词' },
        category: { type: 'string', description: '分类，如场景、文案、背景等' },
      },
    },
  },
]

// 系统提示词
const SYSTEM_PROMPT = `你是 AiMarketing 的智能助手（代号：小Ai），一个专业的AI营销创作平台的AI大脑。

你的能力：
📝 AI文案生成 — 帮用户写各种营销文案、广告语、社媒内容
🎨 AI图片生成 — 根据文字描述生成商业图片
🎬 AI视频生成 — 文字描述转短视频
🤖 数字人克隆 — 上传真人视频克隆数字人形象并生成口播视频
📦 素材管理 — 管理和推送视频/图片到设备
📡 直播推流 — 推流到抖音等直播平台

工作方式：
1. 用户发消息 → 你判断是否需要调用工具
2. 需要工具 → 调用对应函数获取结果
3. 拿到结果后 → 用自然语言友好地回复用户
4. 不需要工具 → 直接回答

回复规则：
- 简洁友好、专业但不死板
- 适当使用emoji增强可读性
- 中文回复为主
- 如果执行了工具，告诉用户做了什么、结果是什么
- 如果用户的问题超出能力范围，诚实告知并建议合适方向`

// ==================== 工具执行器 ====================

async function executeToolCall(name: string, args: Record<string, any>, auth: any): Promise<string> {
  switch (name) {
    case 'generate_copy': {
      const product = args.product || '产品'
      const platform = args.platform || '多平台'
      const style = args.style || '专业'
      const copyPrompt = `为"${product}"生成${platform}平台的营销文案，风格:${style}。要求：吸引眼球、有卖点、适合社交媒体传播。直接输出3条不同角度的文案，每条用【文案X】标记。`
      const result = await generateText(copyPrompt)
      return result || '抱歉，文案生成服务暂时不可用，请稍后再试。'
    }

    case 'generate_image': {
      const prompt = args.prompt || '商业海报'
      const size = args.size || '1024*1024'
      const result = await generateImage(prompt, size)
      if (result?.url) return `IMAGE_RESULT:${result.url}|MODEL:${result.model}`
      return '抱歉，图片生成服务暂时不可用，请检查AI配置后重试。'
    }

    case 'generate_video': {
      const prompt = args.prompt || '产品展示视频'
      const duration = parseInt(args.duration) || 5
      const ratio = args.ratio || '16:9'
      const result = await generateVideo(prompt, duration, '720P', ratio)
      if (result?.taskId && result.status === 'running') return `VIDEO_TASK:${result.taskId}|PROMPT:${prompt}`
      if (result?.videoUrl) return `VIDEO_RESULT:${result.videoUrl}`
      return '抱歉，视频生成任务创建失败，请检查AI配置后重试。'
    }

    case 'search_templates': {
      try {
        const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || ''
        const params = new URLSearchParams()
        if (args.category) params.set('category', args.category)
        if (args.keyword) params.set('keyword', args.keyword)
        const res = await fetch(`${baseUrl}/api/prompt-templates?${params}`, {
          headers: auth ? { Authorization: `Bearer ${auth.userId}` } : {},
        })
        const data = await res.json()
        if (data.success && data.data?.length > 0) {
          const items = data.data.slice(0, 6).map((t: any, i: number) =>
            `${i + 1}. ${t.title || t.prompt?.substring(0, 40)}${t.category ? ` [${t.category}]` : ''}`
          ).join('\n')
          return `TEMPLATE_RESULT:找到 ${data.data.length} 个相关模板:\n${items}\n\n你可以告诉我想要第几个，我来帮你进一步操作。`
        }
        return `TEMPLATE_RESULT:暂未找到匹配的模板。试试其他关键词？`
      } catch {
        return 'TEMPLATE_RESULT:模板库查询失败，请稍后再试。'
      }
    }

    default:
      return `未知工具: ${name}`
  }
}

// ==================== 结果格式化 ====================

function formatResult(toolOutput: string): string {
  if (toolOutput.startsWith('IMAGE_RESULT:')) {
    const parts = toolOutput.split('|')
    const url = parts[0]?.replace('IMAGE_RESULT:', '') || ''
    const model = parts[1]?.replace('MODEL:', '') || 'AI'
    return `✅ 图片已生成完成！\n\n模型：${model}\n\n![生成图片](${url})\n\n预览链接：${url}\n\n还需要我做什么吗？比如基于这张图片生成视频，或者调整描述重新生成？`
  }
  if (toolOutput.startsWith('VIDEO_TASK:')) {
    const parts = toolOutput.split('|')
    const taskId = parts[0]?.replace('VIDEO_TASK:', '') || ''
    const prompt = parts.find(p => p.startsWith('PROMPT:'))?.replace('PROMPT:', '') || ''
    return `⏳ 视频正在生成中...\n\n任务ID：${taskId.substring(0, 12)}...\n描述：${prompt}\n\n生成通常需要2-5分钟，你可以继续聊天，之后问我"视频好了吗"来查看进度。`
  }
  if (toolOutput.startsWith('VIDEO_RESULT:')) {
    const url = toolOutput.replace('VIDEO_RESULT:', '')
    return `🎬 视频已生成完成！\n\n[观看视频](${url})\n下载链接：${url}\n\n需要我帮你存入素材库，还是发布到直播间？`
  }
  if (toolOutput.startsWith('TEMPLATE_RESULT:')) {
    return toolOutput.replace('TEMPLATE_RESULT:', '')
  }
  // 文案等文本结果直接返回
  return toolOutput
}

// ==================== API 入口 ====================

export async function POST(request: NextRequest) {
  const auth = getAuthFromHeaders(request)

  try {
    const body = await request.json()
    const { message, history = [] } = body

    if (!message || typeof message !== 'string' || !message.trim()) {
      return NextResponse.json({ success: false, message: '请输入消息内容' }, { status: 400 })
    }

    const userMessage = message.trim()

    // 构建对话历史（DeepSeek格式）
    const messages: Array<{ role: string; content: string }> = [
      { role: 'system', content: SYSTEM_PROMPT },
    ]

    // 添加历史消息（保留最近10轮）
    for (const h of history.slice(-10)) {
      messages.push({ role: h.role === 'assistant' ? 'assistant' : 'user', content: h.content })
    }

    // 当前用户消息
    messages.push({ role: 'user', content: userMessage })

    // ===== 第1步：调用 DeepSeek Function Calling =====
    const fcResult = await deepSeekFunctionCall(messages, AGENT_TOOLS)

    // 如果有 tool_calls，执行工具并回传结果
    const toolCalls = fcResult.toolCalls || []
    if (toolCalls.length > 0) {
      // 把 assistant 的响应（含 tool_calls）加入消息
      messages.push({
        role: 'assistant',
        content: fcResult.content || '',
      } as any) // tool_calls 在实际API返回中，这里简化处理

      // 执行每个工具调用
      for (const tc of toolCalls) {
        let args: Record<string, any> = {}
        try { args = JSON.parse(tc.arguments) } catch { args = {} }

        console.log(`[Agent] 工具调用: ${tc.name}`, JSON.stringify(args).substring(0, 200))

        const toolResult = await executeToolCall(tc.name, args, auth)

        // 加入工具结果
        messages.push({
          role: 'tool',
          tool_call_id: tc.id,
          name: tc.name,
          content: toolResult,
        } as any)
      }

      // ===== 第2步：把工具结果喂回 DeepSeek，让它组织自然语言回复 =====
      const finalResult = await deepSeekFunctionCall(messages, [])
      const reply = finalResult.content || formatResult(
        // 兜底：如果DeepSeek不回复，取最后一个工具结果格式化
        messages.filter(m => (m as any).role === 'tool').pop()?.content || ''
      )

      return NextResponse.json({
        success: true,
        data: {
          reply,
          intent: toolCalls.map(t => t.name),
          toolUsed: true,
        },
      })
    }

    // 没有 tool_calls → 纯闲聊/问答，直接返回 DeepSeek 回复
    const reply = fcResult.content || '抱歉，AI服务暂时繁忙，请稍后再试。'

    return NextResponse.json({
      success: true,
      data: {
        reply,
        intent: 'chat',
        toolUsed: false,
      },
    })
  } catch (error: any) {
    console.error('[Agent API] 错误:', error)
    return NextResponse.json({
      success: false,
      message: error.message || '处理失败',
    }, { status: 500 })
  }
}
