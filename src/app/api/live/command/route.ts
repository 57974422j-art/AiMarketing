import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdminOrEditor } from '@/lib/auth';

/* POST: 执行直播控制命令 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { roomId, command, payload = {} } = body;

    if (!roomId || !command) return NextResponse.json({ success: false, message: '缺少参数' });

    const auth = await requireAdminOrEditor(req);
    if (auth) return auth;

    const room = await prisma.liveRoom.findUnique({ where: { id: roomId } });
    if (!room) return NextResponse.json({ success: false, message: '直播间不存在' }, { status: 404 });

    // ====== Mock 模式命令处理 ======
    let resultMessage = '';
    let updateData: Record<string, unknown> = {};

    switch (command) {
      case 'start_live':
        resultMessage = '📹 直播已开始 (Mock)';
        updateData = { status: 'live', startTime: new Date(), viewerCount: 0 };
        break;

      case 'end_live':
        resultMessage = '⏹ 直播已结束 (Mock)';
        updateData = { status: 'ended', endTime: new Date(), viewerCount: 0 };
        break;

      case 'send_welcome':
        resultMessage = room.welcomeMessage ? '👋 欢迎语已发送: ' + room.welcomeMessage : '未设置欢迎语';
        break;

      case 'refresh_stats': {
        const mockViewers = Math.floor(Math.random() * 500) + 50;
        const mockLikes = Math.floor(Math.random() * 2000);
        const mockComments = Math.floor(Math.random() * 300);
        resultMessage = '🔄 数据已刷新 (Mock): 在线=' + mockViewers + ' 点赞=' + mockLikes + ' 评论=' + mockComments;
        updateData = { viewerCount: mockViewers, likeCount: mockLikes, commentCount: mockComments };
        break;
      }

      case 'add_product':
        resultMessage = '📦 商品上架成功 (Mock)';
        break;

      case 'remove_product':
        resultMessage = '❌ 商品下架成功 (Mock)';
        break;

      case 'send_comment':
        resultMessage = '💬 评论发送成功 (Mock): ' + ((payload as Record<string, unknown>).text || '');
        updateData = { commentCount: { increment: 1 } };
        break;

      case 'like':
        resultMessage = '👍 点赞成功 (Mock)';
        updateData = { likeCount: { increment: 1 } };
        break;

      case 'share':
        resultMessage = '↗️ 分享成功 (Mock)';
        break;

      case 'follow_host':
        resultMessage = '+ 关注主播成功 (Mock)';
        break;

      case 'open_fans_club':
        resultMessage = '👥 粉丝团面板已打开 (Mock)';
        break;

      case 'send_gift':
        resultMessage = '🎁 礼物发送成功 (Mock): ' + JSON.stringify(payload);
        break;

      case 'switch_camera':
        resultMessage = '📷 镜头切换完成 (Mock)';
        break;

      case 'mute_mic':
        resultMessage = '🔇 麦克风静音/取消静音 (Mock)';
        break;

      default:
        resultMessage = '⚙️ 命令执行中: ' + command + ' (Mock模式，实际Q1接入后真实执行)';
    }

    /* 更新房间状态 */
    if (Object.keys(updateData).length > 0) {
      await prisma.liveRoom.update({ where: { id: roomId }, data: updateData });
    }

    /* 记录日志 */
    await prisma.liveLog.create({
      data: {
        roomId,
        eventType: command,
        payload: JSON.stringify({ command, ...payload }),
      },
    });

    return NextResponse.json({
      success: true,
      message: resultMessage,
      data: { command, executedAt: new Date().toISOString() },
    });
  } catch (e: unknown) {
    console.error('[API /live/command POST]', e);
    return NextResponse.json({ success: false, message: '执行失败' }, { status: 500 });
  }
}
