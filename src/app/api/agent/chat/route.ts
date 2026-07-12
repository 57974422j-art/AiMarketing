import { NextRequest, NextResponse } from 'next/server'
import {
  generateText, generateImage, generateVideo, generateLongVideo,
  deepSeekFunctionCall, ToolDefinition,
  createDigitalHuman, queryDigitalHumanTask, synthesizeVoiceTTS,
} from '@/lib/ai-providers'
import { getAuthFromHeaders } from '@/lib/api-auth'
import { PrismaClient } from '@prisma/client'

export const runtime = 'nodejs'
const prisma = new PrismaClient()

// ==================== 工具定义 ====================

const AGENT_TOOLS: ToolDefinition[] = [
  {
    name: 'generate_copy',
    description: '为用户生成营销文案、广告语、社交媒体内容。触发词："写文案""推广""广告""小红书""抖音脚本""帮我写"。',
    parameters: {
      type: 'object',
      properties: {
        product: { type: 'string', description: '产品或品牌名称' },
        platform: { type: 'string', description: '目标平台：抖音/小红书/微信/多平台' },
        style: { type: 'string', description: '风格：专业/活泼/幽默/高端/种草' },
      }, required: ['product'],
    },
  },
  {
    name: 'generate_image',
    description: 'AI生成图片/海报。触发词："生成图片""做海报""设计图""画一张""海报图""配图"。',
    parameters: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: '图片详细描述' },
        size: { type: 'string', description: '尺寸：1024*1024 / 768*1344(竖版) / 1440*720(横版)' },
      }, required: ['prompt'],
    },
  },
  {
    name: 'generate_video',
    description: 'AI生成短视频。触发词："做视频""生成视频""短视频""拍一个"。',
    parameters: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: '视频内容描述' },
        duration: { type: 'number', description: '时长(秒)，默认5' },
        ratio: { type: 'string', description: '比例：16:9横屏 / 9:16竖屏' },
      }, required: ['prompt'],
    },
  },
  {
    name: 'search_web_images',
    description: '网络搜图。触发词："找图片""搜图""有没有XX的图片""帮我找一张"。',
    parameters: {
      type: 'object',
      properties: {
        keyword: { type: 'string', description: '搜索关键词' },
        count: { type: 'number', description: '需要的图片数量，默认3' },
      }, required: ['keyword'],
    },
  },
  {
    name: 'digital_human_speak',
    description: '创建数字人口播视频：上传照片+选择声音+输入文案。触发词："数字人""口播""虚拟人""AI主播"。',
    parameters: {
      type: 'object',
      properties: {
        text: { type: 'string', description: '口播文案内容' },
        imageUrl: { type: 'string', description: '人物照片URL（用户已上传或从仓库选）' },
        voiceType: { type: 'string', description: '声音：AI配音(默认) / 自定义录音' },
      }, required: ['text'],
    },
  },
  {
    name: 'search_storage',
    description: '搜索项目素材仓库。触发词："素材""仓库""找视频""找图片""媒体库""我的素材"。',
    parameters: {
      type: 'object',
      properties: {
        keyword: { type: 'string', description: '搜索关键词' },
        type: { type: 'string', description: '素材类型：video/image/audio/all' },
      },
    },
  },
  {
    name: 'search_templates',
    description: '搜索提示词模板库。触发词："模板""场景""有什么可以用的"。',
    parameters: {
      type: 'object',
      properties: {
        keyword: { type: 'string', description: '关键词' },
        category: { type: 'string', description: '分类：数字人/场景/文案/背景' },
      },
    },
  },
  {
    name: 'publish_content',
    description: '发布内容到抖音/快手等平台。触发词："发布""发抖音""发快手""上传视频""投稿"。需要先到/accounts绑定账号。',
    parameters: {
      type: 'object',
      properties: {
        platform: { type: 'string', description: '平台：抖音/快手/小红书' },
        contentUrl: { type: 'string', description: '要发布的内容URL' },
        caption: { type: 'string', description: '文案/标题' },
      }, required: ['platform'],
    },
  },
  {
    name: 'automation_check',
    description: '查看自动化任务和定时任务状态。触发词："自动化""定时""自动发布""互关""机器人"。',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', description: 'list(查看列表) / create(创建)' },
      },
    },
  },
]

const SYSTEM_PROMPT = `你是 AiMarketing 的 AI 助手，一个全能AI营销创作平台的智能大脑。

你可以直接做这些事情：
✍️ 写文案 — 各平台营销文案、脚本、广告语
🎨 AI生图 — 文生图，生成海报配图
🔍 网络搜图 — 帮用户找参考图片
🎬 AI视频 — 文字描述生成短视频
🤖 数字人口播 — 照片+文案生成AI主播视频
📦 素材仓库 — 管理项目图片视频素材
📋 模板库 — 项目内置的各种模板
📱 发布内容 — 发抖音/快手（需要先绑定账号）
⚙️ 自动化 — 定时任务/互关/评论

工作方式：
1. 用户一句话指令 → 你直接执行 → 展示结果
2. 需要补充信息时友好询问
3. 执行完告诉用户做了什么、结果是什么
4. 如果涉及账号发布，告诉用户需要先绑定账号

规则：简洁专业、适度emoji、中文回复、不啰嗦、不说"你不能"而是给替代方案`

// ==================== 工具执行器 ====================

async function executeToolCall(name: string, args: Record<string, any>, auth: any): Promise<string> {
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || ''

  switch (name) {
    // ── 文案 ──
    case 'generate_copy': {
      const product = args.product || '产品'
      const platform = args.platform || '多平台'
      const style = args.style || '专业'
      const p = `为"${product}"生成${platform}营销文案，风格${style}。吸引眼球有卖点。输出3条，用【文案1】【文案2】【文案3】标记。`
      return await generateText(p) || '文案生成暂不可用'
    }

    // ── 图片 ──
    case 'generate_image': {
      const result = await generateImage(args.prompt || '商业海报', args.size || '1024*1024')
      if (result?.url) return `IMAGE_RESULT:${result.url}|MODEL:${result.model}`
      return '图片生成暂不可用，请检查AI配置'
    }

    // ── 视频 ──
    case 'generate_video': {
      const result = await generateVideo(args.prompt || '产品展示', parseInt(args.duration) || 5, '720P', args.ratio || '16:9')
      if (result?.taskId && result.status === 'running') return `VIDEO_TASK:${result.taskId}|PROMPT:${args.prompt}`
      if (result?.videoUrl) return `VIDEO_RESULT:${result.videoUrl}`
      return '视频生成暂不可用'
    }

    // ── 网络搜图 ──
    case 'search_web_images': {
      try {
        const res = await fetch(`${baseUrl}/api/search-images?keyword=${encodeURIComponent(args.keyword)}&limit=${args.count || 3}`)
        const data = await res.json()
        if (data.success && data.data?.length) {
          return `IMAGE_LIST:${JSON.stringify(data.data.slice(0, args.count || 4).map((i: any) => ({ url: i.url, title: i.title || '' })))}`
        }
        return '未找到相关图片，换个关键词试试？'
      } catch { return '网络搜图暂不可用' }
    }

    // ── 数字人口播 ──
    case 'digital_human_speak': {
      const text = args.text || ''
      if (!text) return '请提供口播文案内容'
      // 先查找用户的预设数字人形象
      const tmpl = await prisma.promptTemplate.findFirst({ where: { category: '数字人' }, orderBy: { id: 'asc' } })
      const imageUrl = args.imageUrl || (tmpl as any)?.previewUrl
      if (!imageUrl) return '数字人形象还未准备好。请先去数字人页面创建形象，或者上传一张人物照片。'
      try {
        const result = await createDigitalHuman(
          `https://dashscope.aliyuncs.com/api/v1/services/aigc/text-to-speech/synthesize`, // placeholder
          imageUrl
        )
        if (result?.taskId) return `DH_TASK:${result.taskId}|TEXT:${text.substring(0, 50)}`
        return '数字人口播任务创建失败'
      } catch (e: any) {
        // 降级：用AI配音生成
        return `DH_NEED_MEDIA:需要一个人物照片才能做口播。建议：1.上传一张正面半身照 2.或者去数字人页面创建形象`
      }
    }

    // ── 素材仓库 ──
    case 'search_storage': {
      try {
        const where: any = { ownerId: auth?.userId }
        if (args.type && args.type !== 'all') where.type = args.type
        const items = await prisma.mediaAsset.findMany({ where, orderBy: { createdAt: 'desc' }, take: 8 })
        if (items.length) {
          const list = items.map((m, i) => `${i + 1}. ${m.title} [${m.type}] ${m.url?.substring(0, 50)}`).join('\n')
          return `STORAGE_RESULT:找到${items.length}个素材:\n${list}`
        }
        return 'STORAGE_RESULT:素材仓库暂无内容。你可以上传素材，或让我帮你生成。'
      } catch { return 'STORAGE_RESULT:素材查询失败' }
    }

    // ── 模板 ──
    case 'search_templates': {
      try {
        const params = new URLSearchParams()
        if (args.category) params.set('category', args.category)
        if (args.keyword) params.set('keyword', args.keyword)
        const res = await fetch(`${baseUrl}/api/prompt-templates?${params}`, {
          headers: auth ? { Authorization: `Bearer ${auth.userId}` } : {},
        })
        const data = await res.json()
        if (data.success && data.data?.length) {
          const items = data.data.slice(0, 6).map((t: any, i: number) =>
            `${i + 1}. ${t.title}${t.category ? ` [${t.category}]` : ''}`
          ).join('\n')
          return `TEMPLATE_RESULT:${data.data.length}个模板:\n${items}`
        }
        return 'TEMPLATE_RESULT:暂无匹配模板'
      } catch { return 'TEMPLATE_RESULT:模板查询失败' }
    }

    // ── 发布 ──
    case 'publish_content': {
      try {
        const accts = await prisma.socialAccount.findMany({
          where: auth?.userId ? { userId: auth.userId, platform: args.platform || '抖音' } : { platform: args.platform || '抖音' },
          take: 5,
        })
        if (!accts.length) return `PUBLISH_NEED_LOGIN:你还没有绑定${args.platform || ''}账号。请先去【账号管理】页面绑定账号，支持：1.指纹浏览器模拟登录 2.真手机接入 3.魔云腾发布。绑好后跟我说，我帮你一键发布！`
        const list = accts.map(a => `- ${a.username} (${a.platform})`).join('\n')
        return `PUBLISH_READY:你已绑定以下账号:\n${list}\n\n确认用哪个账号发布？回复我即可执行。`
      } catch { return 'PUBLISH_READY:账号查询失败' }
    }

    // ── 自动化 ──
    case 'automation_check': {
      try {
        const tasks = await prisma.automationTask.findMany({
          where: auth?.userId ? { createdBy: auth.userId } : {},
          orderBy: { createdAt: 'desc' }, take: 5,
        })
        if (tasks.length) {
          const list = tasks.map(t => `- [${t.status}] ${t.type}: ${t.params?.substring(0, 40)}`).join('\n')
          return `你有${tasks.length}个自动化任务:\n${list}`
        }
        return '暂无自动化任务。要创建吗？'
      } catch { return '自动化查询失败' }
    }

    default:
      return `未知工具: ${name}`
  }
}

// ==================== 结果格式化 ====================

function formatToolResult(output: string): string {
  if (output.startsWith('IMAGE_RESULT:')) {
    const url = output.split('|')[0]?.replace('IMAGE_RESULT:', '') || ''
    return `✅ 图片已生成！\n\n![图片](${url})\n\n[查看原图](${url})`
  }
  if (output.startsWith('IMAGE_LIST:')) {
    const data = output.replace('IMAGE_LIST:', '')
    try {
      const imgs = JSON.parse(data)
      return `🔍 找到以下图片:\n\n${imgs.map((i: any, n: number) => `${n + 1}. ${i.title || '图片'}\n   ![预览](${i.url})`).join('\n\n')}`
    } catch { return `🔍 找到相关图片\n${data}` }
  }
  if (output.startsWith('VIDEO_TASK:')) {
    const parts = output.split('|'); const taskId = parts[0]?.replace('VIDEO_TASK:', '') || ''; const prompt = parts.find(p => p.startsWith('PROMPT:'))?.replace('PROMPT:', '') || ''
    return `⏳ 视频正在生成...\n\n描述：${prompt}\n稍等2-5分钟后来问我"视频好了吗"查看`
  }
  if (output.startsWith('VIDEO_RESULT:')) {
    return `🎬 视频完成！\n\n[📥 下载](${output.replace('VIDEO_RESULT:', '')})`
  }
  if (output.startsWith('STORAGE_RESULT:')) return output.replace('STORAGE_RESULT:', '')
  if (output.startsWith('TEMPLATE_RESULT:')) return output.replace('TEMPLATE_RESULT:', '')
  if (output.startsWith('PUBLISH_NEED_LOGIN:')) return `⚠️ ${output.replace('PUBLISH_NEED_LOGIN:', '')}`
  if (output.startsWith('PUBLISH_READY:')) return output.replace('PUBLISH_READY:', '')
  if (output.startsWith('DH_TASK:')) { const taskId = output.split('|')[0]?.replace('DH_TASK:', '') || ''
    return `🤖 数字人口播已提交！\n任务ID: ${taskId}\n稍后问我"口播好了吗"查看进度`
  }
  if (output.startsWith('DH_NEED_MEDIA:')) return `📷 ${output.replace('DH_NEED_MEDIA:', '')}`
  return output
}

// ==================== API 入口 ====================

export async function POST(request: NextRequest) {
  const auth = getAuthFromHeaders(request)

  try {
    const body = await request.json()
    const { message, history = [], sessionId: sid, attachments } = body

    if (!message || typeof message !== 'string' || !message.trim()) {
      return NextResponse.json({ success: false, message: '请输入消息' }, { status: 400 })
    }

    const userMessage = message.trim()

    // 组装附件信息
    let contextMsg = userMessage
    if (attachments?.length) {
      contextMsg += '\n[用户上传了附件:' + attachments.map((a: any) => `${a.type}:${a.url}`).join(',') + ']'
    }

    // 构建消息
    const messages: Array<{ role: string; content: string; name?: string }> = [
      { role: 'system', content: SYSTEM_PROMPT },
    ]
    for (const h of history.slice(-10)) {
      messages.push({ role: h.role === 'assistant' ? 'assistant' : 'user', content: h.content })
    }
    messages.push({ role: 'user', content: contextMsg })

    // Step 1: Function Calling
    const fcResult = await deepSeekFunctionCall(messages, AGENT_TOOLS)
    const toolCalls = fcResult.toolCalls || []

    if (toolCalls.length > 0) {
      // Add assistant fc response
      messages.push({ role: 'assistant', content: fcResult.content || '', name: 'tool_use' } as any)

      for (const tc of toolCalls) {
        let args: Record<string, any> = {}
        try { args = JSON.parse(tc.arguments) } catch { args = {} }
        console.log(`[Agent] 🔧 ${tc.name}`, JSON.stringify(args).substring(0, 100))
        const result = await executeToolCall(tc.name, args, auth)
        messages.push({ role: 'tool', content: result } as any)
      }

      // Step 2: 回传结果
      const finalResult = await deepSeekFunctionCall(messages, [])
      const reply = finalResult.content || formatToolResult(
        messages.filter(m => (m as any).role === 'tool').pop()?.content || ''
      )

      // 存DB
      let sessionId = sid
      if (auth?.userId) {
        if (!sessionId) {
          const s = await prisma.chatSession.create({
            data: { userId: auth.userId, title: userMessage.substring(0, 30) },
          })
          sessionId = s.id
        }
        await prisma.chatMessage.createMany({
          data: [
            { sessionId, role: 'user', content: userMessage },
            { sessionId, role: 'assistant', content: reply, toolUsed: true, intent: toolCalls.map((t: any) => t.name).join(',') },
          ],
        })
        await prisma.chatSession.update({ where: { id: sessionId }, data: { updatedAt: new Date() } })
      }

      return NextResponse.json({
        success: true,
        data: { reply, intent: toolCalls.map((t: any) => t.name), toolUsed: true, sessionId },
      })
    }

    // 纯聊天
    const reply = fcResult.content || '抱歉，AI服务暂时繁忙。'
    let sessionId = sid
    if (auth?.userId) {
      if (!sessionId) {
        const s = await prisma.chatSession.create({
          data: { userId: auth.userId, title: userMessage.substring(0, 30) },
        })
        sessionId = s.id
      }
      await prisma.chatMessage.createMany({
        data: [
          { sessionId, role: 'user', content: userMessage },
          { sessionId, role: 'assistant', content: reply, toolUsed: false },
        ],
      })
      await prisma.chatSession.update({ where: { id: sessionId }, data: { updatedAt: new Date() } })
    }

    return NextResponse.json({
      success: true,
      data: { reply, intent: 'chat', toolUsed: false, sessionId },
    })
  } catch (error: any) {
    console.error('[Agent API]', error)
    return NextResponse.json({ success: false, message: error.message }, { status: 500 })
  }
}

// GET: 聊天历史
export async function GET(request: NextRequest) {
  const auth = getAuthFromHeaders(request)
  if (!auth) return NextResponse.json({ success: false, message: '请登录' }, { status: 401 })

  const url = new URL(request.url)
  const action = url.searchParams.get('action') || 'sessions'
  const sessionId = parseInt(url.searchParams.get('sessionId') || '')

  try {
    if (action === 'sessions') {
      const sessions = await prisma.chatSession.findMany({
        where: { userId: auth.userId },
        orderBy: { updatedAt: 'desc' },
        take: 30,
        select: { id: true, title: true, updatedAt: true },
      })
      return NextResponse.json({ success: true, data: sessions })
    }
    if (action === 'messages' && sessionId) {
      const session = await prisma.chatSession.findFirst({ where: { id: sessionId, userId: auth.userId } })
      if (!session) return NextResponse.json({ success: false, message: '会话不存在' }, { status: 404 })
      const messages = await prisma.chatMessage.findMany({
        where: { sessionId },
        orderBy: { createdAt: 'asc' },
        select: { id: true, role: true, content: true, toolUsed: true, intent: true, createdAt: true },
      })
      return NextResponse.json({ success: true, data: { session, messages } })
    }
    return NextResponse.json({ success: false, message: '未知操作' }, { status: 400 })
  } catch (e: any) {
    return NextResponse.json({ success: false, message: e.message }, { status: 500 })
  }
}

// DELETE: 删除会话
export async function DELETE(request: NextRequest) {
  const auth = getAuthFromHeaders(request)
  if (!auth) return NextResponse.json({ success: false, message: '请登录' }, { status: 401 })
  const url = new URL(request.url)
  const sessionId = parseInt(url.searchParams.get('sessionId') || '')
  if (!sessionId) return NextResponse.json({ success: false, message: '缺少会话ID' }, { status: 400 })
  try {
    await prisma.chatSession.deleteMany({ where: { id: sessionId, userId: auth.userId } })
    return NextResponse.json({ success: true })
  } catch (e: any) {
    return NextResponse.json({ success: false, message: e.message }, { status: 500 })
  }
}
