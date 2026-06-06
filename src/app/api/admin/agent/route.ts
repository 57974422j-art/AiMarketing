import { NextRequest, NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { getAuthFromHeaders } from '@/lib/api-auth';

const prisma = new PrismaClient();

export async function GET(req: NextRequest) {
  try {
    const auth = getAuthFromHeaders(req);
    if (!auth) return NextResponse.json({ success: false, message: '未认证' }, { status: 401 });
    if (auth.role === 'end-user') return NextResponse.json({ success: false, message: '无权访问' }, { status: 403 });

    const userId = parseInt(req.nextUrl.searchParams.get('userId') || '0', 10) || auth.userId;

    /* 并行查询所有代理数据 */
    const [
      totalClients,
      activeClients,
      totalLeads,
      convertedLeads,
      pendingSubmissions,
      publishedCount,
      clients,
    ] = await Promise.all([
      prisma.user.count({ where: { parentId: userId } }),
      prisma.user.count({ where: { parentId: userId, updatedAt: { gte: new Date(Date.now() - 30 * 86400000) } } }),
      prisma.lead.count({ where: { assignedTo: { id: userId } } }),
      prisma.lead.count({ where: { assignedTo: { id: userId }, status: 'converted' } }),
      prisma.contentSubmission.count({
        where: {
          submitterId: { in: (await prisma.user.findMany({ where: { parentId: userId }, select: { id: true } })).map(u => u.id) },
          status: 'pending',
        },
      }),
      prisma.publishingTask.count({
        where: {
          userId: { in: (await prisma.user.findMany({ where: { parentId: userId }, select: { id: true } })).map(u => u.id) },
          status: 'published',
        },
      }),
      prisma.user.findMany({
        where: { parentId: userId },
        select: { id: true, username: true, email: true, plan: true, createdAt: true, updatedAt: true },
        orderBy: { updatedAt: 'desc' },
        take: 20,
      }),
    ]);

    /* 获取最近动态 */
    const recentActivities = await Promise.all([
      /* 最近发布任务 */
      prisma.publishingTask.findMany({
        where: { userId: { in: clients.map(c => c.id) }, status: 'published' },
        orderBy: { updatedAt: 'desc' },
        take: 3,
        select: { id: true, title: true, userId: true, updatedAt: true },
      }).then(items => items.map(i => ({
        type: 'publish', desc: i.title || '发布了内容', user: clients.find(c => c.id === i.userId)?.username || '客户',
        time: formatRelativeTime(i.updatedAt), id: i.id,
      }))),
      /* 最近提交审核 */
      prisma.contentSubmission.findMany({
        where: { submitterId: { in: clients.map(c => c.id) }, status: 'pending' },
        orderBy: { createdAt: 'desc' },
        take: 2,
        select: { id: true, title: true, submitterId: true, createdAt: true },
      }).then(items => items.map(i => ({
        type: 'submit', desc: i.title || '提交了素材待审核', user: clients.find(c => c.id === i.submitterId)?.username || '客户',
        time: formatRelativeTime(i.createdAt), id: i.id,
      }))),
    ]);

    return NextResponse.json({
      success: true,
      data: {
        stats: {
          totalClients, activeClients, totalLeads, convertedLeads,
          pendingSubmissions, publishedCount,
          monthlyRevenue: publishedCount * 200, commissionRate: 15,
        },
        clients: clients.map(c => ({
          ...c,
          status: new Date() - c.updatedAt < 7 * 86400000 ? 'active' : 'inactive',
          lastLogin: c.updatedAt.toISOString().split('T')[0],
          taskCount: 0,
        })),
        activities: recentActivities.flat().sort((a, b) => b.id - a.id).slice(0, 10),
      },
    });
  } catch (e: unknown) {
    console.error('[API /admin/agent GET]', e);
    return NextResponse.json({ success: false, message: '服务器错误' }, { status: 500 });
  }
}

function formatRelativeTime(date: Date): string {
  const diff = Date.now() - date.getTime();
  if (diff < 60000) return '刚刚';
  if (diff < 3600000) return Math.floor(diff / 60000) + '分钟前';
  if (diff < 86400000) return Math.floor(diff / 3600000) + '小时前';
  return Math.floor(diff / 86400000) + '天前';
}
