import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdminOrEditor } from '@/lib/auth';

/* GET: 获取直播间商品列表 */
export async function GET(req: NextRequest) {
  try {
    const roomId = req.nextUrl.searchParams.get('roomId');
    if (!roomId) return NextResponse.json({ success: false, message: '缺少 roomId' });

    const auth = await requireAdminOrEditor(req);
    if (auth) return auth;

    const products = await prisma.liveProduct.findMany({
      where: { roomId: parseInt(roomId) },
      orderBy: { sortOrder: 'asc' },
    });

    return NextResponse.json({ success: true, data: products });
  } catch (e: unknown) {
    console.error('[API /live/products GET]', e);
    return NextResponse.json({ success: false, message: '服务器错误' }, { status: 500 });
  }
}

/* POST: 添加商品 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { roomId, name, price, image, url } = body;

    if (!roomId || !name) return NextResponse.json({ success: false, message: '缺少必要参数' });

    const auth = await requireAdminOrEditor(req);
    if (auth) return auth;

    /* 获取当前最大排序值 */
    const lastProduct = await prisma.liveProduct.findFirst({
      where: { roomId },
      orderBy: { sortOrder: 'desc' },
    });
    const nextSort = (lastProduct?.sortOrder ?? 0) + 1;

    const product = await prisma.liveProduct.create({
      data: { roomId, name, price, image, url, sortOrder: nextSort },
    });

    /* 更新直播间商品计数 */
    const count = await prisma.liveProduct.count({ where: { roomId, status: 'active' } });
    await prisma.liveRoom.update({ where: { id: roomId }, data: { productCount: count } });

    return NextResponse.json({ success: true, data: product, message: '商品添加成功' });
  } catch (e: unknown) {
    console.error('[API /live/products POST]', e);
    return NextResponse.json({ success: false, message: '添加失败' }, { status: 500 });
  }
}
