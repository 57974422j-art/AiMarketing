import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdminOrEditor } from '@/lib/auth';

/* GET: 获取当前用户的直播间列表 */
export async function GET(req: NextRequest) {
  try {
    const auth = await requireAdminOrEditor(req);
    if (auth) return auth;

    // TODO: 从 session 获取真实 userId，暂用 admin 查询
    const user = await prisma.user.findFirst({ where: { role: 'admin' } });
    if (!user) return NextResponse.json({ success: false, message: '用户不存在' }, { status: 404 });

    const rooms = await prisma.liveRoom.findMany({
      where: { ownerId: user.id },
      orderBy: { createdAt: 'desc' },
      include: {
        products: true,
        scripts: { where: { isActive: true }, orderBy: { sortOrder: 'asc' } },
        _count: { select: { logs: true } },
      },
    });

    return NextResponse.json({ success: true, data: rooms });
  } catch (e: unknown) {
    console.error('[API /live GET]', e);
    return NextResponse.json({ success: false, message: '服务器错误' }, { status: 500 });
  }
}

/* POST: 创建直播间 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { name, platform = '抖音', title, welcomeMessage } = body;

    if (!name) return NextResponse.json({ success: false, message: '直播间名称不能为空' });

    const auth = await requireAdminOrEditor(req);
    if (auth) return auth;

    const user = await prisma.user.findFirst({ where: { role: 'admin' } });
    if (!user) return NextResponse.json({ success: false, message: '用户不存在' }, { status: 404 });

    const room = await prisma.liveRoom.create({
      data: {
        name,
        platform,
        title,
        welcomeMessage,
        ownerId: user.id,
      },
    });

    return NextResponse.json({ success: true, data: room, message: '直播间创建成功' });
  } catch (e: unknown) {
    console.error('[API /live POST]', e);
    return NextResponse.json({ success: false, message: '创建失败' }, { status: 500 });
  }
}

/* PUT: 更新直播间 */
export async function PUT(req: NextRequest) {
  try {
    const body = await req.json();
    const { id, name, platform, title, welcomeMessage, autoReplyRules } = body;

    if (!id) return NextResponse.json({ success: false, message: '缺少 ID' });

    const auth = await requireAdminOrEditor(req);
    if (auth) return auth;

    const updateData: Record<string, unknown> = {};
    if (name !== undefined) updateData.name = name;
    if (platform !== undefined) updateData.platform = platform;
    if (title !== undefined) updateData.title = title;
    if (welcomeMessage !== undefined) updateData.welcomeMessage = welcomeMessage;
    if (autoReplyRules !== undefined) updateData.autoReplyRules = typeof autoReplyRules === 'string' ? autoReplyRules : JSON.stringify(autoReplyRules);

    const room = await prisma.liveRoom.update({
      where: { id },
      data: updateData,
    });

    return NextResponse.json({ success: true, data: room, message: '更新成功' });
  } catch (e: unknown) {
    console.error('[API /live PUT]', e);
    return NextResponse.json({ success: false, message: '更新失败' }, { status: 500 });
  }
}
