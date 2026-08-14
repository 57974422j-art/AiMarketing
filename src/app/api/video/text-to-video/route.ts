import { NextRequest, NextResponse } from 'next/server'
import { generateVideo, generateLongVideo, queryVideoTask, generateImageToVideo } from '@/lib/ai-providers'
import { runFFmpeg } from '@/lib/ffmpeg'
import { putObject, getObject, signedUrl } from '@/lib/oss'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { getAuthFromHeaders } from '@/lib/api-auth'
import { checkFeatureAccess, FeatureCodes } from '@/lib/quota'
import { checkTokens, TOKEN_COSTS } from '@/lib/token-wallet'
import {
  createRecord, attachTaskId, finalizeSuccess, finalizeFailure,
  finalizeSuccessByTaskId, finalizeFailureByTaskId,
} from '@/lib/generation-record'

export async function POST(request: NextRequest) {
  try {
    const auth = getAuthFromHeaders(request)
    if (!auth) return NextResponse.json({ success: false, message: '请先登录' }, { status: 401 })

    // 检查文生视频功能是否已开通
    const featureCheck = await checkFeatureAccess(auth.userId, FeatureCodes.TEXT_TO_VIDEO)
    if (!featureCheck.allowed) {
      return NextResponse.json({
        success: false,
        message: featureCheck.message,
        needContactService: featureCheck.needContactService
      }, { status: 403 })
    }

    const body = await request.json()
    const { prompt, aspectRatio, duration, resolution, model, refImage, longVideo, segmentPrompts, refVideo, refImageUrl } = body
    const rawDuration = Math.max(2, parseInt(duration) || 5)
    const videoDuration = longVideo ? Math.min(60, rawDuration) : Math.min(15, rawDuration)
    const requestStart = Date.now()

    if (!prompt && !longVideo) {
      return NextResponse.json({ success: false, message: '缺少必要参数: prompt' }, { status: 400 })
    }

    // TOKEN 余额检查（100 TOKEN/秒；H3 768P=50/秒 2K=80/秒，余额不足直接拒绝）
    const costPerSec = model === 'h3-768p' ? 50 : model === 'h3-2k' ? 80 : TOKEN_COSTS.VIDEO_PER_SECOND
    const videoTokenCost = videoDuration * costPerSec
    const tokenCheck = await checkTokens(auth.userId, videoTokenCost)
    if (!tokenCheck.allowed) {
      return NextResponse.json({ success: false, message: tokenCheck.message, wallet: tokenCheck.wallet }, { status: 403 })
    }

    console.log(`[文生视频API] 开始, params=${JSON.stringify({ prompt: (prompt||'').substring(0, 50), ratio: aspectRatio, duration: videoDuration, resolution, model, longVideo, hasRef: !!refImage })}`)

    // 生成记录：先落 pending（记录预计点数，成功才真正扣款）
    const recId = await createRecord({
      userId: auth.userId,
      type: 'text2video',
      provider: model || 'auto',
      model: model || null as any,
      prompt: prompt || (segmentPrompts || []).join(' | '),
      costPoints: videoTokenCost,
    })

    // 长视频模式
    if (videoDuration > 15 && longVideo) {
      const segPrompts = segmentPrompts || (prompt ? [prompt] : [])
      const segDuration = body.segmentDuration || 15
      const segModel = model === 'happyhorse' ? 'happyhorse-1.0-t2v' : model || 'happyhorse-1.0-t2v'
      console.log(`[文生视频API] 进入长视频模式, target=${videoDuration}s, 段数=${segPrompts.length}, 每段=${segDuration}s, 模型=${segModel}`)
      const result = await generateLongVideo(segPrompts, videoDuration, resolution || '720P', aspectRatio || '16:9', undefined, segDuration, segModel)
      const cost = Math.round((Date.now() - requestStart) / 1000)
      if (!result?.videoUrl) {
        console.log(`[文生视频API] 长视频失败, 耗时=${cost}s`)
        await finalizeFailure(recId, '长视频生成失败')
        return NextResponse.json({ success: false, message: '长视频生成失败' }, { status: 500 })
      }
      console.log(`[文生视频API] 长视频成功, 耗时=${cost}s`)
      // 成功后扣款 + 下载转存 OSS（防投诉兜底）
      await finalizeSuccess(recId, auth.userId, {
        platformUrl: result.videoUrl,
        costPoints: videoTokenCost,
        reason: `text2video:${videoDuration}s`,
      })
      return NextResponse.json({ success: true, taskId: 'long_video', videoUrl: result.videoUrl, pointsSpent: videoTokenCost })
    }

    // 短视频模式（≤15s）
    console.log(`[文生视频API] 进入短视频模式, duration=${videoDuration}s` + (model ? `, model=${model}` : ''))
    let result
    if (refVideo || refImageUrl) {
      // 克隆视频（图生视频）：以参考视频首帧 / 参考图 为参考生成新视频
      const ref = await resolveRefImage(refVideo || refImageUrl, !!refVideo)
      if (!ref) {
        return NextResponse.json({ success: false, message: '参考素材处理失败（抽帧/下载失败，请确认文件可访问）' }, { status: 400 })
      }
      result = await generateImageToVideo(prompt, ref, videoDuration, resolution || '720P', aspectRatio || '16:9')
    } else {
      result = await generateVideo(prompt, videoDuration, resolution || '720P', aspectRatio || '16:9', model)
    }
    const cost = Math.round((Date.now() - requestStart) / 1000)

    if (!result) {
      console.log(`[文生视频API] 服务不可用, 耗时=${cost}s`)
      await finalizeFailure(recId, '视频生成服务未配置')
      return NextResponse.json({ success: false, message: '视频生成服务未配置' }, { status: 500 })
    }

    if (result.videoUrl) {
      console.log(`[文生视频API] 同步返回, 耗时=${cost}s, taskId=${result.taskId?.substring(0, 8)}..., videoUrl_len=${result.videoUrl.length}`)
      if (result.taskId) await attachTaskId(recId, result.taskId)
      // 成功后扣款 + 下载转存 OSS
      await finalizeSuccess(recId, auth.userId, {
        platformUrl: result.videoUrl,
        costPoints: videoTokenCost,
        reason: `text2video:${videoDuration}s`,
      })
      return NextResponse.json({ success: true, taskId: result.taskId, videoUrl: result.videoUrl, pointsSpent: videoTokenCost })
    }

    // 异步模式（只有 taskId，前端轮询）——改为【成功后扣款】：
    // 此处只把 taskId 挂到 pending 记录上，等 GET 查询到 SUCCEEDED 时再扣款+转存 OSS；失败不扣。
    console.log(`[文生视频API] 异步提交, 耗时=${cost}s, taskId=${result.taskId?.substring(0, 8)}...`)
    if (result.taskId) await attachTaskId(recId, result.taskId)
    else await finalizeFailure(recId, '上游未返回任务ID')
    return NextResponse.json({ success: true, taskId: result.taskId, message: '视频生成任务已提交，请稍后查询结果', pointsWillSpend: videoTokenCost })
  } catch (error) {
    console.error('[文生视频API] 异常:', error instanceof Error ? `${error.name}: ${error.message}\n${error.stack?.substring(0, 200)}` : error)
    return NextResponse.json({ success: false, message: error instanceof Error ? error.message : '视频生成失败' }, { status: 500 })
  }
}

export async function GET(request: NextRequest) {
  try {
    const auth = getAuthFromHeaders(request)
    if (!auth) return NextResponse.json({ success: false, message: '请先登录' }, { status: 401 })
    const { searchParams } = new URL(request.url)
    const taskId = searchParams.get('taskId')

    if (!taskId) {
      return NextResponse.json({ success: false, message: '缺少参数: taskId' }, { status: 400 })
    }

    console.log(`[文生视频API][查询] 前端查询 taskId=${taskId.substring(0, 8)}...`)
    const result = await queryVideoTask(taskId)
    console.log(`[文生视频API][查询] 返回 taskId=${taskId.substring(0, 8)}..., status=${result?.status}, hasUrl=${!!result?.videoUrl}`)

    // 成功后扣款结算：查询到最终态时按 taskId 结算（内部原子认领，轮询多次也只扣一次款/转存一次）
    const statusUpper = (result?.status || '').toUpperCase()
    if (result?.videoUrl) { // 拿到视频 URL 即视为最终成功（各平台状态大小写不一，以 URL 为准）
      const storageKey = await finalizeSuccessByTaskId(taskId, result.videoUrl)
      if (storageKey) console.log(`[文生视频API][查询] 已结算扣款并转存 OSS: ${storageKey}`)
    } else if (statusUpper.includes('FAIL') || statusUpper === 'CANCELED') {
      await finalizeFailureByTaskId(taskId, `上游任务失败 status=${result?.status}`)
    }

    return NextResponse.json({ success: true, ...result })
  } catch (error) {
    console.error('[文生视频API][查询异常]:', error instanceof Error ? `${error.name}: ${error.message}` : error)
    return NextResponse.json({ success: false, message: error instanceof Error ? error.message : '查询失败' }, { status: 500 })
  }
}

/**
 * 把参考视频 / 图片解析为可用于图生视频（百炼 i2v）的公开 URL。
 * 视频：服务端下载 → ffmpeg 抽首帧 → 上传 OSS 拿签名 URL；
 * 图片：下载 → 上传 OSS 拿签名 URL。
 */
async function resolveRefImage(src: string, isVideo: boolean): Promise<string | null> {
  try {
    let buffer: Buffer
    if (src.includes('/api/video/file?name=')) {
      const name = decodeURIComponent(src.split('name=')[1].split('&')[0])
      buffer = await getObject(name)
    } else if (src.startsWith('http')) {
      const res = await fetch(src)
      if (!res.ok) return null
      buffer = Buffer.from(await res.arrayBuffer())
    } else {
      buffer = await getObject(src)
    }
    if (!buffer || buffer.length === 0) return null

    let outBuffer = buffer
    if (isVideo) {
      const tmpBase = path.join(os.tmpdir(), `clone-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
      const tmpVid = tmpBase + '.mp4'
      const tmpImg = tmpBase + '.jpg'
      fs.writeFileSync(tmpVid, buffer)
      await runFFmpeg(`-y -i ${JSON.stringify(tmpVid)} -vframes 1 -q:v 2 ${JSON.stringify(tmpImg)}`)
      outBuffer = fs.readFileSync(tmpImg)
      try { fs.unlinkSync(tmpVid) } catch {}
      try { fs.unlinkSync(tmpImg) } catch {}
    }
    const key = `clone-ref/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`
    await putObject(key, outBuffer, 'image/jpeg')
    return await signedUrl(key)
  } catch (e) {
    console.error('[clone] 参考图解析失败:', e)
    return null
  }
}

// 强制动态渲染：API 路由依赖 request.headers / 鉴权，禁止 Next 在构建期静态预渲染
export const dynamic = 'force-dynamic'
