import { NextRequest, NextResponse } from 'next/server'
import { getAuthFromHeaders } from '@/lib/api-auth'

// 阶段三·读取当前用户的长期记忆（给前端认知地图用）
export async function GET(request: NextRequest) {
  try {
    const auth = await getAuthFromHeaders(request)
    if (!auth?.userId) return NextResponse.json({ success: false, message: '未登录' }, { status: 401 })
    const { PrismaClient } = await import('@prisma/client')
    const prisma = new PrismaClient()
    // AgentMemory.userId 存的是 username（非数字 id），先取用户
    const user = await prisma.user.findUnique({ where: { id: auth.userId }, select: { username: true } })
    const username = user?.username || String(auth.userId)
    const rows = await prisma.agentMemory.findMany({
      where: { userId: username },
      orderBy: { salience: 'desc' },
      take: 30,
    })
    await prisma.$disconnect()
    return NextResponse.json({
      success: true,
      items: rows.map((r: any) => ({ id: r.id, content: r.content, tags: r.tags, salience: r.salience })),
    })
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'

// POST 画像登记（2026-08-10：注册/首登结构化登记 → 写 AgentMemory 画像）
export async function POST(request: NextRequest) {
  const { getAuthFromHeaders } = await import('@/lib/api-auth')
  const auth = getAuthFromHeaders(request)
  if (!auth?.userId) return NextResponse.json({ success: false, message: '未登录' }, { status: 401 })
  const { PrismaClient } = await import('@prisma/client')
  const prisma = new PrismaClient()
  let body: any = {}
  try { body = await request.json() } catch {}
  const industry = String(body.industry || '').trim()
  const occupation = String(body.occupation || '').trim()
  const needs = String(body.needs || '').trim()
  const platforms = Array.isArray(body.platforms) ? body.platforms.join(',') : String(body.platforms || '')
  // ★PROFILE_FIX_V1：新增「我关心的主题」（逗号分隔）—— 将来"按画像推热点"取的就是它
  const topics = Array.isArray(body.topics) ? body.topics.join(',') : String(body.topics || '').trim()
  if (!industry && !occupation && !needs && !topics) return NextResponse.json({ success: false, message: '请至少填写一项' }, { status: 400 })
  const user = await prisma.user.findUnique({ where: { id: auth.userId }, select: { username: true } })
  const uid = user?.username || String(auth.userId)
  // 幂等：先清旧画像（onboarding 登记的），避免重复
  await prisma.agentMemory.deleteMany({ where: { userId: uid, tags: { contains: 'onboarding' } } })
  const entries = [
    { content: `用户行业：${industry}`, tags: '画像,行业,onboarding' },
    { content: `用户关注主题：${topics}`, tags: '画像,主题,onboarding' },
    { content: `用户职业/身份：${occupation}`, tags: '画像,职业,onboarding' },
    { content: `用户核心需求：${needs}`, tags: '画像,需求,onboarding' },
    { content: `常用平台：${platforms}`, tags: '画像,平台,onboarding' },
    // ★PROFILE_FIX_V1：filter 改用正则（原来逐个 replace，新增条目会漏判）
  ].filter(e => e.content.replace(/^用户[^：]*：/, '').trim())
  for (const e of entries) {
    await prisma.agentMemory.create({ data: { userId: uid, content: e.content, tags: e.tags, salience: 0.9, visibility: 'user' } })
  }
  // ★PROFILE_FIX_V1：同步写入现成字段 User.industry（视频/热点按行业推送要用它）
  const industryField = (industry || topics.split(/[,，]/)[0] || '').trim()
  if (industryField) {
    try { await prisma.user.update({ where: { id: auth.userId }, data: { industry: industryField.slice(0, 40) } }) } catch (e) {}
  }
  return NextResponse.json({ success: true, message: `画像已登记 ${entries.length} 条` })
}
