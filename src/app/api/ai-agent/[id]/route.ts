import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export async function GET(request: Request, { params }: { params: { id: string } }) {
  try {
    const agent = await prisma.aIAgent.findUnique({
      where: { id: parseInt(params.id) },
      include: {
        trainingDocuments: true
      }
    });
    
    if (!agent) {
      return new Response(JSON.stringify({ success: false, message: 'AI员工不存在' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    return new Response(JSON.stringify({ success: true, data: agent }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    return new Response(JSON.stringify({ success: false, message: '获取AI员工详情失败' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

export async function PUT(request: Request, { params }: { params: { id: string } }) {
  try {
    const body = await request.json();
    const { name, welcomeMessage, replyStyle, promptTemplate } = body;
    
    const agent = await prisma.aIAgent.update({
      where: { id: parseInt(params.id) },
      data: {
        name,
        welcomeMessage,
        replyStyle,
        promptTemplate
      }
    });
    
    return new Response(JSON.stringify({ success: true, data: agent }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    return new Response(JSON.stringify({ success: false, message: '更新AI员工失败' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

export async function DELETE(request: Request, { params }: { params: { id: string } }) {
  try {
    await prisma.trainingDocument.deleteMany({
      where: { agentId: parseInt(params.id) }
    });
    
    await prisma.aIAgent.delete({
      where: { id: parseInt(params.id) }
    });
    
    return new Response(JSON.stringify({ success: true, message: '删除成功' }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    return new Response(JSON.stringify({ success: false, message: '删除AI员工失败' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}