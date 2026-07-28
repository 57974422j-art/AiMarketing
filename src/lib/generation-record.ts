/**
 * ═══════════════════════════════════════════════════════════
 * 生成记录总表（GenerationRecord）统一封装
 * ═══════════════════════════════════════════════════════════
 * 目标：
 * 1. 每笔 AI 生成（文生图/文生视频/数字人/声音克隆…）在数据库可追溯；
 * 2. 成功后把 AI 平台返回的资源【下载转存 OSS】，防止"平台生成了、
 *    客户没收到、平台链接又过期"导致的投诉——资产永远在我们手里；
 * 3. 后台按 用户/类型/状态/日期 查询，替代登服务器 grep 日志。
 *
 * 使用姿势（三步）：
 *   const recId = await createRecord({ userId, type: 'text2video', ... })
 *   // ...调 AI 平台...
 *   成功: await finalizeSuccess(recId, { platformUrl, costPoints, reason })
 *   失败: await finalizeFailure(recId, errMsg)   // 不扣款
 *
 * 扣款原则（2026-07-28 用户拍板）：全部"成功后扣款"，失败不扣。
 * OSS 转存失败不影响"成功"判定（AI 已出结果、已扣款），
 * 仅把 storageUrl 留空 + errorMessage 记录原因，后台可筛出补下载。
 */

import { PrismaClient } from '@prisma/client'
import { putObject, signedUrl } from '@/lib/oss'
import { spendTokens } from '@/lib/token-wallet'

const prisma = new PrismaClient()

const PROMPT_MAX_LEN = 500          // 提示词截断长度
const DOWNLOAD_TIMEOUT_MS = 120_000 // 下载超时（15s 视频可能上百 MB，给足 2 分钟）
const MAX_DOWNLOAD_BYTES = 500 * 1024 * 1024 // 最大 500MB，防异常巨型文件拖垮内存

export interface CreateRecordInput {
  userId: number
  /** text2img / text2video / digital_human / voice_clone / ai_chat / analyze_video ... */
  type: string
  /** agnes / dashscope / volcano / edge-tts / siliconflow ... */
  provider: string
  model?: string
  platformTaskId?: string
  prompt?: string
  /** 客户原始素材 URL（如数字人的形象照/音频） */
  sourceUrl?: string
  /** 预计消耗点数（异步任务先记着，成功时按此扣款；失败清零） */
  costPoints?: number
}

/** 第一步：提交 AI 任务前（或后）插入 pending 记录，返回记录 id */
export async function createRecord(input: CreateRecordInput): Promise<number> {
  try {
    const rec = await prisma.generationRecord.create({
      data: {
        userId: input.userId,
        type: input.type,
        provider: input.provider,
        model: input.model || null,
        platformTaskId: input.platformTaskId || null,
        prompt: input.prompt ? input.prompt.slice(0, PROMPT_MAX_LEN) : null,
        sourceUrl: input.sourceUrl || null,
        costPoints: input.costPoints || 0,
        status: 'pending',
      },
    })
    return rec.id
  } catch (e: any) {
    // 记录表异常绝不阻塞主流程（生成照常），返回 0 表示无记录
    console.error('[GenRecord] 创建记录失败:', e?.message)
    return 0
  }
}

/** 补写平台任务 id（异步任务提交后才拿到 taskId 时用） */
export async function attachTaskId(recordId: number, platformTaskId: string): Promise<void> {
  if (!recordId) return
  try {
    await prisma.generationRecord.update({
      where: { id: recordId },
      data: { platformTaskId },
    })
  } catch (e: any) {
    console.error('[GenRecord] 补写 taskId 失败:', e?.message)
  }
}

export interface FinalizeSuccessInput {
  /** AI 平台返回的原始资源 URL */
  platformUrl: string
  /** 本次消耗点数（成功后扣款） */
  costPoints: number
  /** 扣款用途，写进 usageLog.model，如 'text2video:15s' */
  reason: string
  /** 是否跳过 OSS 转存（纯文本类生成无资源文件时传 true） */
  skipOssBackup?: boolean
  /** 资源已由业务代码自行转存 OSS 时，直接传入其 key/URL，不再重复下载 */
  storageUrlOverride?: string
}

/**
 * 第二步（成功分支）：标记成功 + 扣款 + 下载转存 OSS。
 * 返回 storageUrl（OSS key），转存失败返回 null（记录里留痕，后台可补）。
 */
export async function finalizeSuccess(
  recordId: number,
  userId: number,
  input: FinalizeSuccessInput
): Promise<string | null> {
  // 1. 扣款（成功即扣，与记录表是否可用无关）
  await spendTokens(userId, input.costPoints, input.reason)

  let storageKey: string | null = input.storageUrlOverride || null
  let ossError: string | null = null

  // 2. 下载平台资源 → 转存 OSS（防投诉核心）
  if (!storageKey && !input.skipOssBackup && input.platformUrl) {
    try {
      storageKey = await backupToOSS(recordId, userId, input.platformUrl)
    } catch (e: any) {
      ossError = `OSS转存失败: ${e?.message || e}`
      console.error(`[GenRecord] 记录#${recordId} ${ossError}`)
    }
  }

  // 3. 更新记录
  if (recordId) {
    try {
      await prisma.generationRecord.update({
        where: { id: recordId },
        data: {
          status: 'succeeded',
          costPoints: input.costPoints,
          platformUrl: input.platformUrl || null,
          storageUrl: storageKey,
          errorMessage: ossError, // 成功但转存失败时留痕，后台筛 succeeded+storageUrl空 补下载
        },
      })
    } catch (e: any) {
      console.error('[GenRecord] 更新成功状态失败:', e?.message)
    }
  }
  return storageKey
}

/** 第二步（失败分支）：标记失败，不扣款 */
export async function finalizeFailure(recordId: number, errorMessage: string): Promise<void> {
  if (!recordId) return
  try {
    await prisma.generationRecord.update({
      where: { id: recordId },
      data: { status: 'failed', errorMessage: (errorMessage || '未知错误').slice(0, 1000) },
    })
  } catch (e: any) {
    console.error('[GenRecord] 更新失败状态失败:', e?.message)
  }
}

/**
 * 异步任务专用：按 platformTaskId 结算成功（防重复扣款）。
 * 前端会反复轮询 GET 查询，同一任务可能多次拿到 SUCCEEDED——
 * 这里用「原子认领」（仅 pending → processing 的那一次生效）保证只扣一次款、只转存一次 OSS。
 * 返回 storageUrl（无记录/已处理过/转存失败均返回 null，不影响主流程）。
 */
export async function finalizeSuccessByTaskId(
  platformTaskId: string,
  platformUrl: string
): Promise<string | null> {
  if (!platformTaskId) return null
  try {
    // 原子认领：只有第一个把 pending 改成 processing 的请求继续处理
    const claimed = await prisma.generationRecord.updateMany({
      where: { platformTaskId, status: 'pending' },
      data: { status: 'processing' },
    })
    if (claimed.count === 0) return null // 已被处理过（或无此记录），直接跳过

    const rec = await prisma.generationRecord.findFirst({
      where: { platformTaskId, status: 'processing' },
      orderBy: { id: 'desc' },
    })
    if (!rec) return null

    const reason = `${rec.type}${rec.model ? ':' + rec.model : ''}`
    return await finalizeSuccess(rec.id, rec.userId, {
      platformUrl,
      costPoints: rec.costPoints,
      reason,
    })
  } catch (e: any) {
    console.error('[GenRecord] 按taskId结算成功失败:', e?.message)
    return null
  }
}

/** 异步任务专用：按 platformTaskId 标记失败（不扣款，点数清零）。同样防重复。 */
export async function finalizeFailureByTaskId(platformTaskId: string, errorMessage: string): Promise<void> {
  if (!platformTaskId) return
  try {
    await prisma.generationRecord.updateMany({
      where: { platformTaskId, status: 'pending' },
      data: { status: 'failed', costPoints: 0, errorMessage: (errorMessage || '未知错误').slice(0, 1000) },
    })
  } catch (e: any) {
    console.error('[GenRecord] 按taskId标记失败出错:', e?.message)
  }
}

/** 给后台/客服用：把 OSS key 换成临时可访问的签名 URL */
export async function recordSignedUrl(storageKey: string, expires = 3600): Promise<string> {
  return signedUrl(storageKey, expires)
}

// ══════════════════ 内部工具 ══════════════════

/** 下载平台资源并转存 OSS，返回 OSS key：generations/{type简写}/{userId}/{recordId}_{时间戳}.{ext} */
async function backupToOSS(recordId: number, userId: number, url: string): Promise<string> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS)
  try {
    const res = await fetch(url, { signal: controller.signal })
    if (!res.ok) throw new Error(`下载失败 HTTP ${res.status}`)

    const contentType = res.headers.get('content-type') || ''
    const lenHeader = Number(res.headers.get('content-length') || 0)
    if (lenHeader > MAX_DOWNLOAD_BYTES) throw new Error(`文件过大 ${Math.round(lenHeader / 1048576)}MB`)

    const buffer = Buffer.from(await res.arrayBuffer())
    if (buffer.length > MAX_DOWNLOAD_BYTES) throw new Error('文件超出大小上限')

    const ext = guessExt(contentType, url)
    const key = `generations/${userId}/${recordId}_${Date.now()}.${ext}`
    await putObject(key, buffer, contentType || undefined)
    console.log(`[GenRecord] 记录#${recordId} 已转存 OSS: ${key} (${Math.round(buffer.length / 1024)}KB)`)
    return key
  } finally {
    clearTimeout(timer)
  }
}

/** 根据 Content-Type / URL 后缀猜文件扩展名 */
function guessExt(contentType: string, url: string): string {
  const ct = contentType.toLowerCase()
  if (ct.includes('mp4')) return 'mp4'
  if (ct.includes('webm')) return 'webm'
  if (ct.includes('png')) return 'png'
  if (ct.includes('jpeg') || ct.includes('jpg')) return 'jpg'
  if (ct.includes('webp')) return 'webp'
  if (ct.includes('gif')) return 'gif'
  if (ct.includes('mpeg') && ct.includes('audio')) return 'mp3'
  if (ct.includes('mp3')) return 'mp3'
  if (ct.includes('wav')) return 'wav'
  // 从 URL 路径兜底
  const m = url.split('?')[0].match(/\.([a-zA-Z0-9]{2,5})$/)
  if (m) return m[1].toLowerCase()
  return 'bin'
}
