import { NextRequest, NextResponse } from 'next/server'
import { getAuthFromHeaders } from '@/lib/api-auth'
import { generateImage } from '@/lib/ai-providers'
import { checkFeatureAccess, FeatureCodes } from '@/lib/quota'
import { checkTokens, TOKEN_COSTS } from '@/lib/token-wallet'
import { createRecord, finalizeSuccess, finalizeFailure } from '@/lib/generation-record'

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

    // 生成记录：先落 pending，成功后扣款+转存 OSS
    const recId = await createRecord({
      userId: auth.userId, type: 'text2img', provider: provider || 'auto',
      prompt, costPoints: TOKEN_COSTS.IMAGE_PER_PIC,
    })

    const result = await generateImage(prompt, imageSize, provider)
    if (!result || !result.url || result.url.startsWith('[Mock')) {
      console.log('[生成图片] 所有服务均失败，返回503')
      await finalizeFailure(recId, 'AI 服务不可用（已尝试百炼→硅基流动，均失败）')
      return NextResponse.json({ success: false, message: 'AI 服务不可用（已尝试百炼→硅基流动，均失败）' }, { status: 503 })
    }
    console.log('[生成图片] 成功, 模型:', result.model, 'URL:', result.url.substring(0, 60) + '...')
    const pointsSpent = TOKEN_COSTS.IMAGE_PER_PIC
    // 成功后扣款 + 平台图片下载转存 OSS（防平台链接过期）
    await finalizeSuccess(recId, auth.userId, {
      platformUrl: result.url, costPoints: pointsSpent, reason: 'text2img',
    })
    return NextResponse.json({ success: true, data: { url: result.url, model: result.model }, pointsSpent })
  } catch (e) {
    console.error('[生成图片] 异常:', e)
    return NextResponse.json({ success: false, message: '生成失败' }, { status: 500 })
  }
}
