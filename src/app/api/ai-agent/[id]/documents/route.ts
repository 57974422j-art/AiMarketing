import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export async function GET(request: Request, { params }: { params: { id: string } }) {
  try {
    const documents = await prisma.trainingDocument.findMany({
      where: { agentId: parseInt(params.id) },
      orderBy: { createdAt: 'desc' }
    });
    
    return new Response(JSON.stringify({ success: true, data: documents }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    return new Response(JSON.stringify({ success: false, message: '获取培训文档失败' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const body = await request.json();
    const { title, content, type } = body;
    
    const document = await prisma.trainingDocument.create({
      data: {
        title,
        content,
        type,
        agentId: parseInt(params.id)
      }
    });
    
    return new Response(JSON.stringify({ success: true, data: document }), {
      status: 201,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    return new Response(JSON.stringify({ success: false, message: '添加培训文档失败' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}