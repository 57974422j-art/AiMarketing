import { NextRequest, NextResponse } from 'next/server'
import { getAuthFromHeaders } from '@/lib/api-auth'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

// 项目知识库（系统指令上下文）
const PROJECT_KNOWLEDGE = `你是一个嵌入在 AiMarketing 全栈营销 SaaS 平台中的 AI 引导助手。

## 平台功能
1. AI 文案生成 — 根据关键词/平台/风格自动生成营销文案（支持抖音/小红书/快手等）
2. AI 生图 — 选模板或输提示词，AI 一键生成营销配图（百炼通义万相）
3. 视频编辑 — 多模板视频合成（mix/quick/story/loop），支持裁剪/拼接/水印/调分辨率
4. 数字人 — 上传真人视频克隆形象，生成口播视频（阿里云千寻）
5. AI 员工 — 自定义客服/AI 助手，配置回复风格和培训文档
6. 后期处理 — 配音(TTS) + 字幕生成，多语言翻译
7. 设备管理 — 摩云腾设备引擎，社交账号绑定，自动化任务执行
8. 账号分组 — 管理多平台社交账号
9. 自动化任务 — 互关/点赞/评论/转发/发布视频

## 回答风格
- 简洁专业，中文回答
- 用 markdown 格式（列表、加粗等）
- 如果用户问及具体功能操作，给出逐步引导
- 如果用户问平台不支持的功能，诚实告知暂不支持
- 首次使用时主动问候并引导体验核心功能`

function getDeepSeekKey(): string | null {
  return process.env.DEEPSEEK_API_KEY || null
}

export async function POST(request: NextRequest) {
  try {
    const auth = getAuthFromHeaders(request)
    const body = await request.json()
    const { message, history } = body

    if (!message?.trim()) {
      return NextResponse.json({ success: false, message: '消息不能为空' }, { status: 400 })
    }

    const key = getDeepSeekKey()
    if (!key) {
      return NextResponse.json({ success: false, message: 'AI 助手暂未配置' }, { status: 503 })
    }

    // 若已登录，获取用户的营销档案作为上下文
    let userContext = ''
    if (auth) {
      try {
        const copyTasks = await prisma.copyTask.findMany({
          where: { userId: auth.userId },
          orderBy: { createdAt: 'desc' },
          take: 5,
        })
        if (copyTasks.length > 0) {
          const samples = copyTasks.map(t =>
            `[${t.platform || '通用'}] 关键词: ${t.keywords} | 风格: ${t.style || '通用'} | 结果: ${t.resultJson?.substring(0, 200)}`
          ).join('\n')
          userContext = `\n\n## 该用户的营销档案（最近 ${copyTasks.length} 条）\n${samples}`
        }
      } catch { /* ignore */ }
    }

    // 构建 messages
    const messages: Array<{ role: string; content: string }> = [
      { role: 'system', content: PROJECT_KNOWLEDGE + userContext },
    ]

    // 追加对话历史（最多保留 6 条）
    if (Array.isArray(history) && history.length > 0) {
      const recent = history.slice(-6)
      for (const msg of recent) {
        messages.push({ role: msg.role, content: msg.content })
      }
    }

    messages.push({ role: 'user', content: message })

    // 调用 DeepSeek
    const res = await fetch('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages,
        temperature: 0.7,
        max_tokens: 1500,
      }),
      signal: AbortSignal.timeout(30000),
    })

    if (!res.ok) {
      const err = await res.text()
      console.error('[AIGuide] DeepSeek 错误:', res.status, err.substring(0, 200))
      return NextResponse.json({ success: false, message: 'AI 响应失败' }, { status: 502 })
    }

    const data = await res.json()
    const reply = data.choices?.[0]?.message?.content?.trim() || null

    if (!reply) {
      return NextResponse.json({ success: false, message: 'AI 返回为空' }, { status: 502 })
    }

    return NextResponse.json({ success: true, reply })
  } catch (error) {
    console.error('[AIGuide] 异常:', error)
    return NextResponse.json({ success: false, message: '服务器错误' }, { status: 500 })
  } finally {
    await prisma.$disconnect()
  }
}
