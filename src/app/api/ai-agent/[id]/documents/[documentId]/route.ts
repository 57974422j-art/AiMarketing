import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export async function DELETE(request: Request, { params }: { params: { id: string; documentId: string } }) {
  try {
    await prisma.trainingDocument.delete({
      where: { 
        id: parseInt(params.documentId),
        agentId: parseInt(params.id)
      }
    });
    
    return new Response(JSON.stringify({ success: true, message: '删除成功' }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    return new Response(JSON.stringify({ success: false, message: '删除文档失败' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}