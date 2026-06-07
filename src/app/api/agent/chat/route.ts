import { NextRequest, NextResponse } from 'next/server'
import { generateText, generateImage, generateVideo } from '@/lib/ai-providers'
import { getAuthFromHeaders } from '@/lib/api-auth'

// ==================== Agent 工具定义 ====================

interface ToolCall {
  name: string
  params: Record<string, any>
  result?: any
}

// 意图分类提示词
const INTENT_PROMPT = `你是 AiMarketing AI 助手的意图分析器。用户会发送自然语言请求，你需要判断他想做什么。

可用工具列表：
1. chat - 闲聊/问答（不调用任何工具，直接回复）
2. generate_copy - 生成营销文案。参数: product(产品名), platform(平台,如"抖音/小红书"), style(风格)
3. generate_image - AI生成图片。参数: prompt(图片描述), size(尺寸)
4. generate_video - AI生成视频。参数: prompt(视频描述), duration(时长秒), ratio(比例)
4. search_templates - 搜索素材模板库。参数: keyword(关键词), category(分类)
5. digital_human_info - 数字人相关咨询（使用说明、流程介绍等）

请严格按以下JSON格式输出，不要输出任何其他内容：
{"intent":"工具名","params":{"参数名":"参数值",...},"confidence":0.0-1.0}

如果用户只是闲聊或问一般问题，intent设为"chat"。
如果无法判断意图，intent设为"chat"，confidence低于0.5。

用户输入：`

// ==================== 主处理函数 ====================

async function classifyIntent(userMessage: string): Promise<{ intent: string; params: Record<string, any>; confidence: number }> {
  const response = await generateText(INTENT_PROMPT + userMessage)
  if (!response) return { intent: 'chat', params: {}, confidence: 0 }

  try {
    // 尝试从响应中提取 JSON
    const jsonMatch = response.match(/\{[\s\S]*"intent"[\s\S]*\}/)
    if (!jsonMatch) return { intent: 'chat', params: {}, confidence: 0 }
    
    const parsed = JSON.parse(jsonMatch[0])
    return {
      intent: parsed.intent || 'chat',
      params: parsed.params || {},
      confidence: parsed.confidence || 0.5,
    }
  } catch {
    return { intent: 'chat', params: {}, confidence: 0 }
  }
}

// 工具执行器
async function executeTool(intent: string, params: Record<string, any>, auth: any): Promise<string> {
  switch (intent) {
    case 'generate_copy': {
      const product = params.product || '产品'
      const platform = params.platform || '多平台'
      const style = params.style || '专业'
      const copyPrompt = `为"${product}"生成${platform}平台的营销文案，风格:${style}。要求：吸引眼球、有卖点、适合社交媒体传播。直接输出3条不同角度的文案，每条用【文案X】标记。`
      const result = await generateText(copyPrompt)
      return result || '抱歉，文案生成服务暂时不可用，请稍后再试。'
    }

    case 'generate_image': {
      const prompt = params.prompt || '商业海报'
      const size = params.size || '1024*1024'
      const result = await generateImage(prompt, size)
      if (result?.url) {
        return `IMAGE_RESULT:${result.url}|MODEL:${result.model}`
      }
      return '抱歉，图片生成服务暂时不可用，请检查AI配置后重试。'
    }

    case 'generate_video': {
      const prompt = params.prompt || '产品展示视频'
      const duration = parseInt(params.duration) || 5
      const ratio = params.ratio || '16:9'
      const result = await generateVideo(prompt, duration, '720P', ratio)
      if (result?.taskId && result.status === 'running') {
        return `VIDEO_TASK:${result.taskId}|STATUS:generating|PROMPT:${prompt}`
      }
      if (result?.videoUrl) {
        return `VIDEO_RESULT:${result.videoUrl}`
      }
      return '抱歉，视频生成任务创建失败，请检查AI配置后重试。'
    }

    case 'search_templates': {
      // 调用内部API搜索模板库
      try {
        const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || ''
        const category = params.category ? `&category=${encodeURIComponent(params.category)}` : ''
        const keyword = params.keyword ? `&keyword=${encodeURIComponent(params.keyword)}` : ''
        const res = await fetch(`${baseUrl}/api/prompt-templates?${category}${keyword}`, {
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

    case 'digital_human_info': {
      return `数字人功能说明：

🎬 **形象克隆流程**：
1. 上传真人视频（30-120秒，正面露脸）
2. 可选上传录音音频（用于声音克隆）
3. 选择模式：极速版(~3分钟) / 精品版(~24小时)
4. 等待训练完成

🎤 **口播视频生成**：
1. 训练完成后输入口播文案
2. 选择背景（纯色/自定义图片/场景库）
3. 点击生成，等待视频渲染完成
4. 可下载或存入素材仓库

💡 **小提示**：你可以说"我想克隆一个数字人"来开始，或者"帮我做一个关于XX的口播视频"。需要我帮你开始吗？`
    }

    default:
      return '' // chat 意图返回空字符串，由主流程处理
  }
}

// 格式化工具结果为自然语言
function formatToolResponse(intent: string, toolOutput: string): string {
  if (toolOutput.startsWith('IMAGE_RESULT:')) {
    const [urlInfo, modelInfo] = toolOutput.split('|')
    const url = urlInfo.replace('IMAGE_RESULT:', '')
    const model = modelInfo?.replace('MODEL:', '') || 'AI'
    return `✅ 图片已生成完成！\n\n模型：${model}\n\n![生成图片](${url})\n\n预览链接：${url}\n\n还需要我做什么吗？比如基于这张图片生成视频，或者调整描述重新生成？`
  }

  if (toolOutput.startsWith('VIDEO_TASK:')) {
    const parts = toolOutput.split('|')
    const taskId = parts[0]?.replace('VIDEO_TASK:', '') || ''
    const prompt = parts.find(p => p.startsWith('PROMPT:'))?.replace('PROMT:', '') || ''
    return `⏳ 视频正在生成中...\n\n任务ID：${taskId.substring(0, 12)}...\n描述：${prompt}\n\n生成通常需要2-5分钟，你可以继续聊天，之后问我"视频好了吗"来查看进度。`
  }

  if (toolOutput.startsWith('VIDEO_RESULT:')) {
    const url = toolOutput.replace('VIDEO_RESULT:', '')
    return `🎬 视频已生成完成！\n\n[观看视频](${url})\n下载链接：${url}\n\n需要我帮你存入素材库，还是发布到直播间？`
  }

  if (toolOutput.startsWith('TEMPLATE_RESULT:')) {
    return toolOutput.replace('TEMPLATE_RESULT:', '')
  }

  // 默认原样返回（文案等文本结果）
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

    // 1. 分类意图
    const { intent, params, confidence } = await classifyIntent(userMessage)
    console.log(`[Agent] intent=${intent}, confidence=${confidence}, params=`, JSON.stringify(params).substring(0, 200))

    // 2. 执行对应工具
    if (intent !== 'chat' && confidence >= 0.3) {
      const toolResult = await executeTool(intent, params, auth)
      if (toolResult) {
        const formattedResponse = formatToolResponse(intent, toolResult)
        return NextResponse.json({
          success: true,
          data: {
            reply: formattedResponse,
            intent,
            toolUsed: true,
          },
        })
      }
    }

    // 3. 闲聊/通用对话 - 直接调LLM
    const systemPrompt = `你是 AiMarketing 的智能助手，一个专业的AI营销创作平台。

你的能力包括：
📝 AI文案生成 - 帮用户写各种营销文案、广告语、社媒内容
🎨 AI图片生成 - 根据文字描述生成商业图片
🎬 AI视频生成 - 文字描述转短视频
🤖 数字人克隆 - 上传真人视频克隆数字人形象并生成口播视频
📦 素材管理 - 管理和推送视频/图片到设备
📡 直播推流 - 推流到抖音等直播平台

回复风格：简洁友好、专业但不死板、适当使用emoji增强可读性。中文回复为主。
如果用户想了解具体功能，给出清晰的步骤指引。
如果用户的问题超出能力范围，诚实告知并建议合适的功能方向。

当前用户消息历史（最近几轮）：
${history.map((h: any) => `${h.role}: ${h.content}`).slice(-6).join('\n')}`

    const fullPrompt = `${systemPrompt}\n\n用户最新消息：${userMessage}`
    const reply = await generateText(fullPrompt, 1500) || '抱歉，AI服务暂时繁忙，请稍后再试。'

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
