import { PrismaClient } from '@prisma/client';
import { NextResponse } from 'next/server';

// 关键修复：添加调试日志并确保 Prisma 客户端正确实例化
const prisma = new PrismaClient();

// 获取所有 AI 员工
export async function GET() {
  try {
    const agents = await prisma.aIAgent.findMany({
      include: {
        trainingDocuments: true
      }
    });
    return NextResponse.json({ success: true, data: agents });
  } catch (error) {
    console.error('Get agents error:', error);
    return NextResponse.json(
      { success: false, message: '获取AI员工列表失败' },
      { status: 500 }
    );
  }
}

// 创建新的 AI 员工
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { name, welcomeMessage, replyStyle, promptTemplate } = body;
    
    const agent = await prisma.aIAgent.create({
      data: {
        name,
        welcomeMessage: welcomeMessage || `你好，我是${name}，有什么可以帮助你的吗？`,
        replyStyle: replyStyle || '亲切',
        promptTemplate: promptTemplate || `你是一个名叫${name}的专业客服人员。`
      }
    });
    
    return NextResponse.json({ success: true, data: agent });
  } catch (error) {
    console.error('Create agent error:', error);
    return NextResponse.json(
      { success: false, message: '添加AI员工失败' },
      { status: 500 }
    );
  }
}