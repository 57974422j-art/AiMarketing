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
)`

const STYLES = ['男性青年', '女性青年', '商务正装', '休闲日常', '古风国潮', '科技未来']

const TEMPLATES = [
  { title: '男性青年-知识分享', prompt: '25岁中国男性，短发清爽，穿浅蓝衬衫，坐书桌前微笑看向镜头，暖色台灯光，背景书架，自然光线，高清摄影，知识分享场景' },
  { title: '女性青年-美妆教程', prompt: '28岁中国女性，长发披肩，精致淡妆，穿白色针织衫，手持化妆刷面对镜头，柔光窗边拍摄，温馨卧室背景，美妆教程口播场景' },
  { title: '商务正装-产品介绍', prompt: '35岁中国男性，西装领带，站姿自信，深色办公室背景，企业logo墙，专业灯光，手持产品展示，商务口播场景' },
  { title: '休闲日常-生活分享', prompt: '30岁中国女性，休闲卫衣，坐沙发自然姿态，客厅暖光环境，绿植背景，微笑聊天表情，生活分享口播场景' },
  { title: '古风国潮-文化讲解', prompt: '32岁中国女性，汉服妆造，古风背景（屏风/灯笼），手持折扇，古色古香光线，国潮文化讲解口播场景' },
  { title: '科技未来-数码评测', prompt: '28岁中国男性，黑色简约T恤，科技感蓝光背景，面前摆放数码产品，专业测评姿态，科技评测口播场景' },
]

export async function POST(request: NextRequest) {
  try {
    const auth = getAuthFromHeaders(request)
    if (!auth || auth.role !== 'admin') {
      return NextResponse.json({ success: false, message: '需要管理员权限' }, { status: 403 })
    }
    await prisma.$executeRawUnsafe(CREATE_TABLE_SQL).catch(() => {})
    const body = await request.json().catch(() => ({}))
    const count = body?.count || TEMPLATES.length

    let inserted = 0
    for (const t of TEMPLATES.slice(0, count)) {
      const exists = await prisma.$queryRawUnsafe('SELECT id FROM PromptTemplate WHERE prompt = ?', t.prompt) as any[]
      if (Array.isArray(exists) && exists.length > 0) continue
      await prisma.$executeRawUnsafe(
        'INSERT INTO PromptTemplate (title, category, prompt) VALUES (?, ?, ?)',
        t.title, '数字人', t.prompt
      )
      inserted++
    }
    return NextResponse.json({ success: true, message: `已添加 ${inserted} 个数字人模板` })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ success: false, message: '服务器错误' }, { status: 500 })
  } finally { await prisma.$disconnect() }
}
