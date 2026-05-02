import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

function getUserContext(request: Request) {
  const userId = request.headers.get('X-User-Id')
  const role = request.headers.get('X-User-Role')
  if (!userId || !role) return null
  return { userId: parseInt(userId), role }
}

export async function DELETE(request: Request, { params }: { params: { id: string; documentId: string } }) {
  try {
    const user = getUserContext(request)
    if (!user) {
      return new Response(JSON.stringify({ success: false, message: '未登录' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    // editor 和 admin 都能删除
    if (!['editor', 'admin'].includes(user.role)) {
      return new Response(JSON.stringify({ success: false, message: '没有删除权限' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
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