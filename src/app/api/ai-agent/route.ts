import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export async function GET() {
  try {
    const agents = await prisma.aIAgent.findMany({
      include: {
        trainingDocuments: true
      },
      orderBy: {
        createdAt: 'desc'
      }
    });
    return new Response(JSON.stringify({ success: true, data: agents }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    return new Response(JSON.stringify({ success: false, message: '获取AI员工列表失败' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { name, welcomeMessage, replyStyle, promptTemplate } = body;
    
    const agent = await prisma.aIAgent.create({
      data: {
        name,
        welcomeMessage,
        replyStyle,
        promptTemplate: promptTemplate || '你是一个专业的客服助手，请根据提供的上下文信息回复用户的问题。'
      }
    });
    
    return new Response(JSON.stringify({ success: true, data: agent }), {
      status: 201,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    return new Response(JSON.stringify({ success: false, message: '创建AI员工失败' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}