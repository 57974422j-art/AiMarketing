import { NextRequest, NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client/edge';
import { checkQuota, incrementUsage } from '@/lib/quota';

const prisma = new PrismaClient();

function getUserContext(request: NextRequest) {
  const userId = request.headers.get('X-User-Id');
  const role = request.headers.get('X-User-Role');
  if (!userId || !role) return null;
  return { userId: parseInt(userId), role };
}

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = getUserContext(request);
    if (!user) {
      return NextResponse.json(
        { success: false, message: '未登录' },
        { status: 401 }
      );
    }

    const { message } = await request.json();
    const agentId = parseInt(params.id);

    if (!message) {
      return NextResponse.json(
        { success: false, message: '缺少消息内容' },
        { status: 400 }
      );
    }

    const quotaResult = await checkQuota(user.userId, 'AI对话');
    if (!quotaResult.allowed) {
      return NextResponse.json(
        { success: false, message: quotaResult.message },
        { status: 403 }
      );
    }

    const agent = await prisma.aIAgent.findUnique({
      where: { id: agentId },
      include: {
        trainingDocuments: true
      }
    });

    if (!agent) {
      return NextResponse.json(
        { success: false, message: 'AI员工不存在' },
        { status: 404 }
      );
    }

    let context = '';
    if (agent.trainingDocuments && agent.trainingDocuments.length > 0) {
      context = agent.trainingDocuments.map(doc => {
        return `【${doc.type}】${doc.title}\n${doc.content}`;
      }).join('\n\n');
    }

    let reply = '';
    const mockReplies: Record<string, string[]> = {
      '专业': [
        '感谢您的咨询，根据我们的知识库，这个问题的答案是：',
        '根据提供的信息，为您解答如下：',
        '参考我们的资料，建议您：',
        '根据知识库内容，我为您提供以下信息：'
      ],
      '亲切': [
        '好的呢~ 根据我们的资料，我来为您解答！',
        '嗯嗯，我看看资料~ 是这样的：',
        '让我查一下资料哦~ 然后告诉您！',
        '没问题，我来帮您看看~'
      ],
      '幽默': [
        '收到！让我翻一下我的"秘籍"~',
        '好问题！让我查阅一下知识库~',
        '稍等，我去查一下资料！',
        '这个问题难不倒我，让我看看资料~'
      ]
    };

    const styleReplies = mockReplies[agent.replyStyle] || mockReplies['亲切'];
    const prefix = styleReplies[Math.floor(Math.random() * styleReplies.length)];

    if (context) {
      reply = `${prefix}\n\n知识库内容：\n${context}\n\n根据以上信息，我的回答是：\n${message}`;
    } else {
      reply = `${prefix}\n\n关于您的问题："${message}"\n\n这是我的回答内容。由于目前没有配置知识库，我将根据我的训练数据为您提供帮助。`;
    }

    await incrementUsage(user.userId, 'AI对话', 1);

    return NextResponse.json({
      success: true,
      data: { reply }
    });
  } catch (error) {
    console.error('聊天错误:', error);
    return NextResponse.json(
      { success: false, message: '聊天失败' },
      { status: 500 }
    );
  } finally {
    await prisma.$disconnect();
  }
}