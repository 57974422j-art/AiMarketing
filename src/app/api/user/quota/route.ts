import { NextRequest, NextResponse } from 'next/server'
import { getQuotaInfo } from '@/lib/quota'

function getUserContext(request: NextRequest) {
  const userId = request.headers.get('X-User-Id')
  const role = request.headers.get('X-User-Role')
  if (!userId || !role) return null
  return { userId: parseInt(userId), role }
}

export async function GET(request: NextRequest) {
  try {
    const user = getUserContext(request)
    if (!user) {
      return NextResponse.json({ success: false, message: '未登录' }, { status: 401 })
    }
    
    const quotaInfo = await getQuotaInfo(user.userId as any)
    
    if (!quotaInfo) {
      return NextResponse.json({ success: false, message: '获取配额信息失败' }, { status: 500 })
    }
    
    const planInfo = {
      free: { name: '免费版', description: '适合个人用户体验', quota: 100 },
      basic: { name: '基础版', description: '适合小型团队', quota: 500 },
      pro: { name: '专业版', description: '适合中型企业', quota: 2000 },
      vip: { name: '旗舰版', description: '适合大型企业', quota: 10000 }
    }
    
    return NextResponse.json({
      success: true,
      data: {
        plan: quotaInfo.plan,
        planName: planInfo[quotaInfo.plan]?.name || '免费版',
        planDescription: planInfo[quotaInfo.plan]?.description || '免费版',
        monthlyQuota: quotaInfo.monthlyQuota,
        usedThisMonth: quotaInfo.usedThisMonth,
        remainingQuota: quotaInfo.remainingQuota,
        usageByAction: quotaInfo.usageByAction,
        usagePercent: Math.round((quotaInfo.usedThisMonth / quotaInfo.monthlyQuota) * 100)
      }
    })
  } catch (error) {
    console.error('获取配额信息错误:', error)
    return NextResponse.json({ success: false, message: '获取配额信息失败' }, { status: 500 })
  }
}