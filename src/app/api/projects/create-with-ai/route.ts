import { NextRequest, NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client/edge'

const prisma = new PrismaClient()

const INDUSTRY_CONFIG: Record<string, { copyTemplates: string[]; agentConfig: { name: string; welcomeMessage: string; promptTemplate: string }; keywords: string[] }> = {
  '茶叶': {
    copyTemplates: [
      '【限时福利】正宗XX茶叶，买二送一！点击领取专属优惠券',
      '每日一杯茶，健康永相随。XX茶叶，品质生活从一杯好茶开始',
      '送长辈、送亲友，XX茶叶礼盒装让您倍有面子！全国包邮',
      '茶香四溢，回味无穷。XX茶叶，您的品质之选',
      '好茶不贵，限时特惠！XX茶叶官方旗舰店全场8折起'
    ],
    agentConfig: {
      name: '茶叶顾问小茶',
      welcomeMessage: '您好！我是茶叶顾问小茶，很高兴为您服务~请问您喜欢喝什么类型的茶呢？我们有绿茶、红茶、普洱等多种选择。',
      promptTemplate: '你是一个专业的茶叶顾问，对各类茶叶有深入了解。你需要根据客户的需求，推荐合适的茶叶品种，并引导客户了解我们的产品优势。'
    },
    keywords: ['多少钱', '包邮吗', '送礼推荐', '口感描述', '保质期']
  },
  '服装': {
    copyTemplates: [
      '【新品上市】XX品牌2024新款，时尚与品质并存，立即抢购！',
      '换季清仓，全场低至5折！错过再等一年',
      '显瘦百搭，这件衣服让你美出新高度！买家秀征集活动中',
      '品质面料，舒适体验。XX服装，让每一次穿着都是享受',
      '潮流前线，个性之选。XX品牌服装，专为独特的你而生'
    ],
    agentConfig: {
      name: '时尚顾问小美',
      welcomeMessage: '您好！我是时尚顾问小美，很高兴为您服务！请问您今天想看什么类型的衣服呢？',
      promptTemplate: '你是一个专业的服装时尚顾问，熟悉各类服装搭配。你需要根据客户的身材、喜好和需求，推荐合适的服装款式，并促成购买。'
    },
    keywords: ['多少钱', '尺码', '发货时间', '退换货', '搭配推荐']
  },
  '餐饮': {
    copyTemplates: [
      '【到店有礼】XX餐厅欢迎您的到来，充值500送100！',
      '招牌菜推荐：秘制XX，经过3小时慢炖，口感绝佳！',
      '新店开业，全场8折！预约电话：XXX-XXXX-XXXX',
      'XX餐厅，您的第二客厅。承接各类宴席，欢迎预订',
      '美食热线：XXX-XXXX-XXXX，提前预约免等位'
    ],
    agentConfig: {
      name: '餐饮顾问小食',
      welcomeMessage: '您好！我是餐饮顾问小食，很高兴为您服务！请问您想了解我们的菜品还是想预订座位呢？',
      promptTemplate: '你是一个热情周到的餐饮顾问，熟悉本店菜品和套餐。你需要根据客户的用餐人数、口味偏好和预算，推荐合适的菜品和套餐，引导客户预订或到店消费。'
    },
    keywords: ['预订座位', '招牌菜', '人均消费', '停车位', '套餐优惠']
  },
  '美妆': {
    copyTemplates: [
      '【明星同款】XX品牌口红，滋润不干唇，显白又气质！',
      '护肤小课堂：如何根据肤质选择适合自己的护肤品？',
      '限时秒杀价，买一送一！XX品牌护肤套装限量抢购',
      '素颜霜+防晒+隔离，一套搞定裸妆！XX三件套特惠中',
      'XX品牌官方授权，正品保障，支持扫码验真'
    ],
    agentConfig: {
      name: '美妆顾问小美',
      welcomeMessage: '您好！我是美妆顾问小美，很高兴为您服务！请问您想了解护肤还是彩妆产品呢？',
      promptTemplate: '你是一个专业的美妆顾问，对各类美妆产品有深入了解。你需要根据客户的肤质、肤色和需求，推荐合适的化妆品或护肤品，并提供使用建议。'
    },
    keywords: ['多少钱', '适合肤质', '成分安全', '使用顺序', '优惠套装']
  },
  '教育': {
    copyTemplates: [
      '【限时报名】XX课程报名中，名师授课，小班教学！',
      '0基础入门，高薪就业！XX培训课程助您弯道超车',
      '家长必看：如何培养孩子的学习兴趣？',
      'XX教育，专注K12一对一辅导，提分效果看得见！',
      '免费试听课火热预约中！先试听再报名，不满意退费'
    ],
    agentConfig: {
      name: '教育顾问小育',
      welcomeMessage: '您好！我是教育顾问小育，很高兴为您服务！请问您是想了解课程还是想预约试听呢？',
      promptTemplate: '你是一个专业的教育咨询顾问，熟悉各类培训课程。你需要根据客户的学习目标、基础水平和时间安排，推荐合适的课程，引导客户报名或预约试听。'
    },
    keywords: ['课程价格', '上课时间', '师资力量', '试听课', '学习效果']
  },
  '家居': {
    copyTemplates: [
      '【家居焕新】XX品牌家具，简约现代风，让家更温馨！',
      '新房装修，旧屋翻新，XX家具一站式购齐！',
      '环保材质，呵护家人健康。XX品牌家具，绿色家居首选',
      '限时团购，全屋家具定制，立省30%！',
      'XX家居生活馆，样品处理，亏本清仓！'
    ],
    agentConfig: {
      name: '家居顾问小居',
      welcomeMessage: '您好！我是家居顾问小居，很高兴为您服务！请问您是想看沙发、床垫还是其他家具呢？',
      promptTemplate: '你是一个专业的家居顾问，熟悉各类家具产品的特点。你需要根据客户的家庭情况、装修风格和预算，推荐合适的家具产品，引导客户到店体验或下单购买。'
    },
    keywords: ['材质', '尺寸', '送货安装', '环保标准', '保修期限']
  },
  '数码': {
    copyTemplates: [
      '【新品预售】XX手机，性能怪兽，拍照神器！预约享好礼',
      '以旧换新，最高可抵2000元！XX品牌换新节火热进行中',
      'XX笔记本电脑，轻薄高性能，办公游戏两不误！',
      '数码装备焕新季，全场配件5折起！',
      '正品保障，全国联保。XX品牌官方旗舰店'
    ],
    agentConfig: {
      name: '数码顾问小数',
      welcomeMessage: '您好！我是数码顾问小数，很高兴为您服务！请问您想了解手机、电脑还是其他数码产品呢？',
      promptTemplate: '你是一个专业的数码产品顾问，熟悉各类数码产品的参数和性能。你需要根据客户的使用需求和预算，推荐合适的数码产品，并解答技术问题。'
    },
    keywords: ['多少钱', '参数配置', '保修政策', '以旧换新', '配件推荐']
  },
  '其他': {
    copyTemplates: [
      '【品质生活】选择XX，享受精致生活每一刻！',
      '专业服务，品质保障。XX品牌，您值得信赖',
      '限时优惠中，全场低至X折！错过不再有',
      'XX，让生活更美好。新用户专享福利，点击领取',
      '感谢支持XX，我们会做得更好！'
    ],
    agentConfig: {
      name: '客服顾问小助',
      welcomeMessage: '您好！我是客服顾问小助，很高兴为您服务！请问有什么可以帮助您的呢？',
      promptTemplate: '你是一个专业的客服顾问，需要根据客户的问题提供准确、及时的帮助和解答。'
    },
    keywords: ['产品介绍', '价格优惠', '售后服务', '配送时间', '会员权益']
  }
}

const MARKETING_GOALS = ['短视频推广', '直播引流', '私域转化', '品牌宣传']

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { industry, goals, projectName, projectDescription, userId } = body

    if (!industry || !goals || !userId) {
      return NextResponse.json(
        { success: false, message: '缺少必要参数' },
        { status: 400 }
      )
    }

    const config = INDUSTRY_CONFIG[industry] || INDUSTRY_CONFIG['其他']

    const project = await prisma.project.create({
      data: {
        name: projectName || `${industry}营销项目`,
        description: projectDescription || `专注于${industry}行业的${goals.join('、')}营销项目`,
        userId
      }
    })

    const copyTaskIds: number[] = []
    for (const template of config.copyTemplates) {
      const copyTask = await prisma.copyTask.create({
        data: {
          content: template,
          type: 'product',
          status: 'completed',
          userId
        }
      })
      copyTaskIds.push(copyTask.id)
    }

    const agent = await prisma.aIAgent.create({
      data: {
        name: config.agentConfig.name,
        welcomeMessage: config.agentConfig.welcomeMessage,
        replyStyle: '亲切',
        promptTemplate: config.agentConfig.promptTemplate,
        userId
      }
    })

    const keywordIds: number[] = []
    for (const keyword of config.keywords) {
      const leadKeyword = await prisma.leadCollector.create({
        data: {
          keyword,
          platform: 'all',
          status: 'active',
          userId
        }
      })
      keywordIds.push(leadKeyword.id)
    }

    return NextResponse.json({
      success: true,
      message: '项目创建成功，AI已自动生成营销内容',
      data: {
        project: {
          id: project.id,
          name: project.name
        },
        copyTasks: copyTaskIds.length,
        agent: {
          id: agent.id,
          name: agent.name
        },
        keywords: keywordIds.length
      }
    })
  } catch (error) {
    console.error('AI创建项目错误:', error)
    return NextResponse.json(
      { success: false, message: error instanceof Error ? error.message : '创建失败' },
      { status: 500 }
    )
  } finally {
    await prisma.$disconnect()
  }
}