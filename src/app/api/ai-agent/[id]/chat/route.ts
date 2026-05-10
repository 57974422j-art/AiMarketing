import { NextRequest, NextResponse } from 'next/server';
import { getAuthFromHeaders } from '@/lib/api-auth';
import { generateText } from '@/lib/ai-providers';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export async function GET(request: NextRequest) {
  const auth = getAuthFromHeaders(request)
  if (!auth) return NextResponse.json({ success: false, message: '请先登录' }, { status: 401 })

  try {
    const agents = await prisma.aIAgent.findMany({
      include: { trainingDocuments: true }
    });
    return NextResponse.json({ success: true, data: agents });
  } catch (error) {
    console.error('Get agents error:', error);
    return NextResponse.json({ success: false, message: '获取AI员工列表失败' }, { status: 500 });
  }
}

// POST: 聊天（有 message） 或 创建 AI 员工
export async function POST(
  request: NextRequest,
  { params: routeParams }: { params: Promise<{ id: string }> }
) {
  const auth = getAuthFromHeaders(request)
  if (!auth) return NextResponse.json({ success: false, message: '请先登录' }, { status: 401 })

  try {
    const body = await request.json()

    // 聊天模式
    if (body.message) {
      const { id: rawId } = await routeParams
      const agentId = parseInt(rawId, 10)
      const agent = agentId ? await prisma.aIAgent.findUnique({ where: { id: agentId } }) : null
      const prompt = agent
        ? `你是一个AI客服助手，名叫"${agent.name}"，回复风格：${agent.replyStyle || '亲切'}。
角色设定：${agent.promptTemplate || '专业客服'}
用户消息：${body.message}
请用以上角色设定回复用户，保持风格一致，回答简洁有力。`
        : `你是一个智能AI助手。用户说：${body.message}\n请友好回复。`

      const reply = await generateText(prompt)
      return NextResponse.json({
        success: true,
        data: { reply: reply || '抱歉，我现在无法回复，请稍后再试。' }
      })
    }

    // 创建模式
    const { name, welcomeMessage, replyStyle, promptTemplate } = body;
    if (!name) {
      return NextResponse.json({ success: false, message: '缺少员工名称' }, { status: 400 })
    }
    const agent = await prisma.aIAgent.create({
      data: {
        name,
        welcomeMessage: welcomeMessage || `你好，我是${name}，有什么可以帮助你的吗？`,
        replyStyle: replyStyle || '亲切',
        promptTemplate: promptTemplate || `你是一个名叫${name}的专业客服人员。`
      }
    });
    return NextResponse.json({ success: true, data: agent });
  } catch (error) {
    console.error('处理请求错误:', error);
    return NextResponse.json({ success: false, message: '处理失败' }, { status: 500 });
  }
}
