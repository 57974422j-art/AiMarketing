import { NextRequest, NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { getAuthFromHeaders } from '@/lib/api-auth';

const prisma = new PrismaClient();

export async function GET(req: NextRequest) {
  try {
    const auth = getAuthFromHeaders(req);
    if (!auth) return NextResponse.json({ success: false, message: '未认证' }, { status: 401 });
    if (auth.role === 'end-user') return NextResponse.json({ success: false, message: '无权访问' }, { status: 403 });

    /* 并行执行所有检查 */
    const [accountCount, deviceCount, pendingSubs, recentTasks] = await Promise.all([
      /* 账号数 */
      prisma.socialAccount.count({ where: { userId: auth.userId } }),
      /* 设备在线数 */
      prisma.device.findMany({ where: { status: 'online' }, select: { id: true } }).then(d => d.length),
      /* 待审核内容 */
      prisma.contentSubmission.count({ where: { status: 'pending' } }),
      /* 最近任务成功率 */
      prisma.videoTask.groupBy({
        by: ['status'],
        where: { createdAt: { gte: new Date(Date.now() - 7 * 86400000) } },
        _count: true,
      }),
    ]);

    /* 构建诊断结果 */
    const checks = [
      {
        key: 'acc_count', category: '账号', label: '社交账号绑定',
        status: accountCount > 0 ? ('pass' as const) : ('warn' as const),
        message: accountCount > 0 ? '已绑定 ' + accountCount + ' 个账号' : '未检测到绑定的社交账号',
        detail: '', fix: '/admin/social-accounts',
      },
      {
        key: 'dev_online', category: '设备', label: '设备状态',
        status: deviceCount > 3 ? ('pass' as const) : (deviceCount > 0 ? 'warn' as const : 'fail' as const),
        message: deviceCount + ' 台设备在线',
        detail: '建议保持至少3台设备在线以保障并发能力', fix: '/admin/devices',
      },
      {
        key: 'cont_pending', category: '内容', label: '待审核内容',
        status: pendingSubs === 0 ? ('pass' as const) : (pendingSubs < 10 ? 'warn' as const : 'fail' as const),
        message: pendingSubs + ' 条内容待审核',
        detail: pendingSubs > 0 ? '请及时处理以免影响客户体验' : '',
        fix: '/admin/content-submissions',
      },
    ];

    return NextResponse.json({ success: true, data: { checks } });
  } catch (e: unknown) {
    console.error('[API /admin/diagnostics]', e);
    return NextResponse.json({ success: false, message: '服务器错误' }, { status: 500 });
  }
}

// 强制动态渲染：API 路由依赖 request.headers / 鉴权，禁止 Next 在构建期静态预渲染
export const dynamic = 'force-dynamic'
