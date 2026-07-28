import { NextRequest, NextResponse } from 'next/server'
import { getAuthFromHeaders } from '@/lib/api-auth'
import { generateImage } from '@/lib/ai-providers'
import { checkFeatureAccess, FeatureCodes } from '@/lib/quota'
import { checkTokens, spendTokens, TOKEN_COSTS } from '@/lib/token-wallet'

export async function POST(request: NextRequest) {
  try {
    const auth = getAuthFromHeaders(request)
    if (!auth) return NextResponse.json({ success: false, message: '未认证' }, { status: 401 })

    // 检查AI生图功能是否已开通
    const featureCheck = await checkFeatureAccess(auth.userId, FeatureCodes.IMAGE_GENERATOR)
    if (!featureCheck.allowed) {
      return NextResponse.json({
        success: false,
        message: featureCheck.message,
        needContactService: featureCheck.needContactService
      }, { status: 403 })
    }

    // 点数余额检查（12 点/张，余额不足直接拒绝，避免先烧上游成本）
    const tokenCheck = await checkTokens(auth.userId, TOKEN_COSTS.IMAGE_PER_PIC)
    if (!tokenCheck.allowed) {
      return NextResponse.json({ success: false, message: tokenCheck.message, wallet: tokenCheck.wallet }, { status: 403 })
    }

    const body = await request.json()
    const { prompt, size, provider } = body
    if (!prompt?.trim()) {
      return NextResponse.json({ success: false, message: '请提供提示词' }, { status: 400 })
    }
    const imageSize = size || '1280*1280'

    console.log('[生成图片] ====== 开始诊断 ======')
    console.log('[生成图片] DASHSCOPE_API_KEY:', process.env.DASHSCOPE_API_KEY ? '已设置(len=' + process.env.DASHSCOPE_API_KEY.length + ')' : '未设置')
    console.log('[生成图片] SILICONFLOW_API_KEY:', process.env.SILICONFLOW_API_KEY ? '已设置' : '未设置')
    console.log('[生成图片] 提示词长度:', prompt.length, '尺寸:', imageSize, 'provider:', provider || 'auto')

    const result = await generateImage(prompt, imageSize, provider)
    if (!result || !result.url || result.url.startsWith('[Mock')) {
      console.log('[生成图片] 所有服务均失败，返回503')
      return NextResponse.json({ success: false, message: 'AI 服务不可用（已尝试百炼→硅基流动，均失败）' }, { status: 503 })
    }
    console.log('[生成图片] 成功, 模型:', result.model, 'URL:', result.url.substring(0, 60) + '...')
    const pointsSpent = TOKEN_COSTS.IMAGE_PER_PIC
    await spendTokens(auth.userId, pointsSpent, 'text2img')
    return NextResponse.json({ success: true, data: { url: result.url, model: result.model }, pointsSpent })
  } catch (e) {
    console.error('[生成图片] 异常:', e)
    return NextResponse.json({ success: false, message: '生成失败' }, { status: 500 })
  }
}
