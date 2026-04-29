import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const { description } = await request.json();

    if (!description) {
      return NextResponse.json(
        { success: false, message: '缺少需求描述' },
        { status: 400 }
      );
    }

    const generated = analyzeDescription(description);

    return NextResponse.json({
      success: true,
      data: generated
    });
  } catch (error) {
    console.error('生成AI员工错误:', error);
    return NextResponse.json(
      { success: false, message: '生成失败' },
      { status: 500 }
    );
  }
}

function analyzeDescription(description: string) {
  let name = '智能客服';
  let welcomeMessage = '您好！很高兴为您服务！';
  let replyStyle = '亲切';
  let promptTemplate = '你是一个专业的客服助手，请根据提供的上下文信息回复用户的问题。';
  let trainingDocuments: { title: string; content: string; type: string }[] = [];

  if (description.includes('价格') || description.includes('多少钱') || description.includes('费用')) {
    name = '价格咨询客服';
    welcomeMessage = '您好！我是价格咨询客服，请问您想了解什么产品的价格呢？';
    replyStyle = '亲切';
    promptTemplate = '你是一个专业的价格咨询客服，当用户询问价格时，要友好地引导用户添加微信获取详细报价。';
    trainingDocuments.push({
      title: '价格引导话术',
      content: '当用户询问价格时，回复："具体价格需要根据您的需求来定，方便加个微信详细聊吗？我的微信是xxx"',
      type: '话术'
    });
  }

  if (description.includes('客服')) {
    name = '智能客服助手';
  }

  if (description.includes('销售')) {
    name = '销售客服';
    welcomeMessage = '您好！我是您的专属销售顾问，请问有什么可以帮到您的？';
    replyStyle = '专业';
    promptTemplate = '你是一个专业的销售客服，擅长介绍产品并引导客户下单购买。';
  }

  if (description.includes('微信') || description.includes('加微信')) {
    trainingDocuments.push({
      title: '引导加微信话术',
      content: '当用户表达出购买意向或询问详情时，引导用户添加微信："为了给您提供更优惠的价格和更详细的资料，方便加一下我的微信吗？"',
      type: '话术'
    });
  }

  if (description.includes('专业')) {
    replyStyle = '专业';
    welcomeMessage = '您好！我是专业顾问，很高兴为您提供专业的咨询服务。';
  }

  if (description.includes('产品')) {
    trainingDocuments.push({
      title: '产品介绍FAQ',
      content: '1. 我们的产品质量保证，支持7天无理由退换\n2. 发货时间：下单后48小时内\n3. 售后支持：7x24小时在线服务',
      type: 'FAQ'
    });
  }

  if (description.includes('幽默') || description.includes('有趣')) {
    replyStyle = '幽默';
    welcomeMessage = '哈喽！我是欢乐客服，有什么问题尽管抛过来，保证让您满意！';
  }

  return {
    name,
    welcomeMessage,
    replyStyle,
    promptTemplate,
    trainingDocuments
  };
}