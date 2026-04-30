import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const data = await request.json();
    const { knowledgeBase } = data;

    if (knowledgeBase) {
      localStorage.setItem('knowledgeBase', JSON.stringify(knowledgeBase));
    }

    return NextResponse.json({
      success: true,
      message: '配置已保存'
    });
  } catch (error) {
    console.error('保存配置错误:', error);
    return NextResponse.json(
      {
        success: false,
        message: error instanceof Error ? error.message : '保存配置时发生错误'
      },
      { status: 500 }
    );
  }
}

export async function GET() {
  try {
    return NextResponse.json({
      success: true,
      data: {
        providers: [],
        defaultProvider: '',
        knowledgeBase: { content: '', updatedAt: '' }
      }
    });
  } catch (error) {
    console.error('获取配置错误:', error);
    return NextResponse.json(
      {
        success: false,
        message: error instanceof Error ? error.message : '获取配置时发生错误'
      },
      { status: 500 }
    );
  }
}