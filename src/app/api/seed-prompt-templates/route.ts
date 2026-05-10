import { NextRequest, NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client'
import { getAuthFromHeaders } from '@/lib/api-auth'

const prisma = new PrismaClient()

const CREATE_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS PromptTemplate (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  category TEXT NOT NULL,
  prompt TEXT NOT NULL,
  previewUrl TEXT,
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
)
`

// ============ 优化后的 20 条高质量提示词 ============
const PRESET_TEMPLATES = [
  // ===== 海报封面 =====
  { title: '新品上市海报', category: '海报封面', prompt: '高清新品上市海报设计，产品居中展示，金白渐变背景，专业柔光布光，高端质感，杂志级排版，8K画质，电商展示风格，干净背景，中文文案排版留白' },
  { title: '促销活动海报', category: '海报封面', prompt: '高清促销活动海报，红金配色喜庆风格，爆炸式构图中大字"限时特惠"，周围点缀优惠券礼盒元素，专业打光，电商视觉，干净背景，节日氛围浓厚' },
  { title: '品牌形象海报', category: '海报封面', prompt: '高清品牌形象海报，极简主义深色背景，金色logo浮于中央，光影层次丰富，高级感留白艺术，电影级质感，专业布光，干净背景，中文品牌文案' },
  { title: '招聘宣传海报', category: '海报封面', prompt: '高清招聘海报，蓝橙渐变年轻活力，插画风格人物元素，大号"加入我们"，扁平化设计，互联网公司氛围，专业排版，干净背景，中文文案' },
  // ===== 产品展示 =====
  { title: '美妆产品展示', category: '产品展示', prompt: '高清护肤品电商展示，白色陶瓷瓶置于大理石台面，点缀鲜花绿叶，自然侧光柔和阴影，清新通透色调，微距特写，专业打光，干净背景，中文文案' },
  { title: '电子产品展示', category: '产品展示', prompt: '高清智能手表产品渲染，科技蓝背景，产品悬浮半空，周围环绕数据流光点，金属拉丝质感，赛博朋克风格，专业布光，干净背景，电商展示' },
  { title: '食品饮料展示', category: '产品展示', prompt: '高清美食产品俯拍，精致餐具摆盘，暖色灯光，蒸汽升腾效果，诱人光泽，木质桌面背景，ins风，专业食品摄影，干净背景，电商展示' },
  { title: '服装鞋包展示', category: '产品展示', prompt: '高清时尚穿搭展示，纯白背景，模特自然站姿，侧光突出面料质感与剪裁线条，高定服装摄影风格，极简高级感，专业打光，电商展示' },
  // ===== 品牌宣传 =====
  { title: '品牌故事宣传', category: '品牌宣传', prompt: '高清品牌故事宣传图，手绘水彩风格，暖色调画面展现品牌起源历程，复古纸张纹理，温暖治愈感，艺术插画，干净背景，中文品牌文案' },
  { title: '企业文化宣传', category: '品牌宣传', prompt: '高清企业文化海报，团队协作场景，明亮办公室环境，绿植点缀，员工笑容，阳光透过落地窗，正能量氛围，明亮通透色调，真实摄影风格' },
  { title: '公益品牌宣传', category: '品牌宣传', prompt: '高清公益环保海报，蓝天白云森林河流，动物与自然和谐共处，温暖感人画面，充满希望，真实摄影风格，专业调色，干净构图，中文文案' },
  { title: '科技品牌宣传', category: '品牌宣传', prompt: '高清科技品牌宣传图，深蓝星空背景，未来城市剪影，数据流光效交织，简洁线条，科技感强，大气磅礴，专业渲染，干净背景，中文品牌标语' },
  // ===== 节日营销 =====
  { title: '春节营销海报', category: '节日营销', prompt: '高清春节营销海报，红金配色传统中国风，灯笼烟花点缀，插画风格喜庆热闹，中央留白放中文促销文案，传统与现代结合，专业设计' },
  { title: '情人节营销海报', category: '节日营销', prompt: '高清情人节浪漫海报，粉红渐变色调，心形元素，玫瑰花瓣飘落，柔和光晕，浪漫温馨，手写中文字体，甜蜜氛围，专业布光，干净背景' },
  { title: '双十一大促海报', category: '节日营销', prompt: '高清双十一购物节海报，霓虹紫蓝色配，爆炸促销信息布局，倒计时元素，购物袋礼盒，年轻潮流动感，专业电商设计，中文促销文案' },
  { title: '圣诞营销海报', category: '节日营销', prompt: '高清圣诞节营销海报，深绿红经典配色，圣诞树彩灯装饰，雪花飘落，礼物盒堆叠，温馨节日氛围，手绘童话风格，干净背景，中文祝福文案' },
  // ===== 短视频封面 =====
  { title: '知识分享封面', category: '短视频封面', prompt: '高清知识分享短视频封面，左大字标题右人物半身像，简洁渐变背景，黄蓝撞色设计，信息层级清晰，高点击率风格，专业排版，干净背景' },
  { title: '美食探店封面', category: '短视频封面', prompt: '高清美食探店视频封面，诱人美食特写占主体，上方大字标题"探店XX"，暖色调，诱人光泽，食欲满满，专业美食摄影，干净背景，中文标题' },
  { title: '旅游Vlog封面', category: '短视频封面', prompt: '高清旅游Vlog封面，风景大片人物剪影，鲜艳色彩，大字标题留位，电影级调色，让人向往的旅行氛围，专业摄影构图，干净画面' },
  { title: '教程封面', category: '短视频封面', prompt: '高清教程视频封面，步骤式设计，数字序号配图标，简洁白底，文字清晰易读，专业教育感，知识干货风格，干净背景，中文标题排版' },
]

export async function POST(request: NextRequest) {
  try {
    const auth = getAuthFromHeaders(request)
    if (!auth || auth.role !== 'admin') {
      return NextResponse.json({ success: false, message: '需要管理员权限' }, { status: 403 })
    }

    // 创建表（如果不存在）
    await prisma.$executeRawUnsafe(CREATE_TABLE_SQL)

    // 检查是否已有数据
    const existing = await prisma.$queryRawUnsafe('SELECT COUNT(*) as cnt FROM PromptTemplate')
    const count = Array.isArray(existing) ? Number(existing[0]?.cnt || 0) : 0
    if (count > 0) {
      return NextResponse.json({ success: false, message: '已经预设过模板（当前 ' + count + ' 条），如需重新预设请先到提示词模板库手动清空' })
    }

    // 批量插入
    for (const t of PRESET_TEMPLATES) {
      await prisma.$executeRawUnsafe(
        'INSERT INTO PromptTemplate (title, category, prompt) VALUES (?, ?, ?)',
        t.title, t.category, t.prompt
      )
    }

    return NextResponse.json({ success: true, message: `已预设 ${PRESET_TEMPLATES.length} 条高质量提示词模板` })
  } catch (e) {
    console.error('预设模板失败:', e)
    return NextResponse.json({ success: false, message: '预设失败：' + (e instanceof Error ? e.message : '未知错误') }, { status: 500 })
  } finally {
    await prisma.$disconnect()
  }
}
