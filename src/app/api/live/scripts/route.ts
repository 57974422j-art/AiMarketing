import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdminOrEditor } from '@/lib/auth';

/* GET: 获取直播间话术列表 */
export async function GET(req: NextRequest) {
  try {
    const roomId = req.nextUrl.searchParams.get('roomId');
    if (!roomId) return NextResponse.json({ success: false, message: '缺少 roomId' });

    const auth = await requireAdminOrEditor(req);
    if (auth) return auth;

    const scripts = await prisma.liveScript.findMany({
      where: { roomId: parseInt(roomId) },
      orderBy: [{ category: 'asc' }, { sortOrder: 'asc' }],
    });

    return NextResponse.json({ success: true, data: scripts });
  } catch (e: unknown) {
    console.error('[API /live/scripts GET]', e);
    return NextResponse.json({ success: false, message: '服务器错误' }, { status: 500 });
  }
}

/* POST: 添加话术 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { roomId, category = 'welcome', content, triggerKeyword, isActive = true } = body;

    if (!roomId || !content) return NextResponse.json({ success: false, message: '缺少必要参数' });

    const auth = await requireAdminOrEditor(req);
    if (auth) return auth;

    const lastScript = await prisma.liveScript.findFirst({
      where: { roomId, category },
      orderBy: { sortOrder: 'desc' },
    });
    const nextSort = (lastScript?.sortOrder ?? 0) + 1;

    const script = await prisma.liveScript.create({
      data: {
        roomId,
        category,
        content,
        triggerKeyword,
        sortOrder: nextSort,
        isActive,
      },
    });

    return NextResponse.json({ success: true, data: script, message: '话术添加成功' });
  } catch (e: unknown) {
    console.error('[API /live/scripts POST]', e);
    return NextResponse.json({ success: false, message: '添加失败' }, { status: 500 });
  }
}
