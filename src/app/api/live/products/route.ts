import { NextRequest, NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { getAuthFromHeaders } from '@/lib/api-auth';

const prisma = new PrismaClient();

/* GET: 获取直播间商品列表 */
export async function GET(req: NextRequest) {
  try {
    const roomId = req.nextUrl.searchParams.get('roomId');
    if (!roomId) return NextResponse.json({ success: false, message: '缺少 roomId' });

    const auth = getAuthFromHeaders(req)
    if (!auth) return NextResponse.json({ success: false, message: '未认证' }, { status: 401 })
    if (auth.role === 'end-user') return NextResponse.json({ success: false, message: '无权访问' }, { status: 403 })

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

    const auth = getAuthFromHeaders(req)
    if (!auth) return NextResponse.json({ success: false, message: '未认证' }, { status: 401 })
    if (auth.role === 'end-user') return NextResponse.json({ success: false, message: '无权操作' }, { status: 403 })

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

// 强制动态渲染：API 路由依赖 request.headers / 鉴权，禁止 Next 在构建期静态预渲染
export const dynamic = 'force-dynamic'
