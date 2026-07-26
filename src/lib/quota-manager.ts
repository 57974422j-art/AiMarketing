/**
 * EditorQuota 管理器 — 端口自动分配 + 配额校验
 *
 * 核心职责：
 * 1. 为 editor 的 manual 类型账号自动分配 CDP 端口（从端口池中取，保证不重复）
 * 2. 校验配额是否超额（Q1容器 / 指纹端口 / 真机）
 * 3. 更新已用计数器
 */

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

// ── 类型定义 ──

export interface QuotaInfo {
  id: number
  editorId: number
  q1Containers: number
  q1Used: number
  fingerprintPorts: number
  fingerprintUsed: number
  realPhones: number
  realPhonesUsed: number
  portRangeStart: number
  portRangeEnd: number
}

// ── 配额 CRUD ──

/** 获取或创建 editor 的配额记录（不存在则用默认值创建） */
export async function getOrCreateQuota(editorId: number): Promise<QuotaInfo> {
  let quota = await prisma.editorQuota.findUnique({ where: { editorId } })
  if (!quota) {
    quota = await prisma.editorQuota.create({
      data: {
        editorId,
        q1Containers: 0,
        fingerprintPorts: 5,   // 默认给 5 个指纹端口
        realPhones: 0,
        portRangeStart: 9220,
        portRangeEnd: 9320,
      },
    })
  }
  return quota as unknown as QuotaInfo
}

/** admin 更新配额上限 */
export async function updateQuota(
  editorId: number,
  fields: Partial<Pick<QuotaInfo, 'q1Containers' | 'fingerprintPorts' | 'realPhones' | 'portRangeStart' | 'portRangeEnd'>>
): Promise<QuotaInfo> {
  const quota = await prisma.editorQuota.update({
    where: { editorId },
    data: fields,
  })
  return quota as unknown as QuotaInfo
}

/** 获取所有 editor 的配额（admin 用） */
export async function getAllQuotas(): Promise<(QuotaInfo & { editorName: string; editorUsername: string })[]> {
  const quotas = await prisma.editorQuota.findMany({
    include: {
      editor: { select: { name: true, username: true } },
    },
  })
  return quotas.map(q => ({
    ...(q as unknown as QuotaInfo),
    editorName: q.editor.name || q.editor.username,
    editorUsername: q.editor.username,
  }))
}

// ── 动态端口池（方案 D：运行时分配 / 停止释放，端口不绑账号）──

// 运行时端口占用注册表（进程内存；多实例部署需改为共享存储，当前单机足够）
const portRegistry = new Map<number, { userId: number; platform: string; startedAt: number }>()

/** 获取全局端口池范围（取首个 editorQuota 的范围，缺省 9220~9320） */
export async function getPortRange(): Promise<{ start: number; end: number }> {
  const q = await prisma.editorQuota.findFirst()
  if (q) return { start: q.portRangeStart, end: q.portRangeEnd }
  return { start: 9220, end: 9320 }
}

/** 旧数据仍写死的 cdpPort（legacy），分配时避开以免冲突 */
async function getOccupiedPorts(): Promise<Set<number>> {
  const legacy = await prisma.account.findMany({
    where: { bindType: 'manual', cdpPort: { not: null } },
    select: { cdpPort: true },
  })
  const set = new Set<number>()
  legacy.forEach(a => { if (a.cdpPort) set.add(a.cdpPort) })
  return set
}

/**
 * 运行时从空闲池分配一个端口（不绑账号、不写库）。
 * 同一用户+平台若已有运行中端口则复用，避免重复启动同一 profile。
 * @throws 端口池耗尽
 */
export async function allocateCdpPort(userId: number, platform: string): Promise<number> {
  for (const [p, info] of portRegistry) {
    if (info.userId === userId && info.platform === platform) return p
  }
  const { start, end } = await getPortRange()
  const occupied = await getOccupiedPorts()
  for (let p = start; p <= end; p++) {
    if (occupied.has(p)) continue
    if (portRegistry.has(p)) continue
    portRegistry.set(p, { userId, platform, startedAt: Date.now() })
    return p
  }
  throw new Error(`端口池 ${start}-${end} 已耗尽`)
}

/** 释放端口（停止浏览器时调用，仅从运行注册表移除） */
export function releaseCdpPort(port: number): boolean {
  return portRegistry.delete(port)
}

/** 当前运行中的端口列表（供状态查询） */
export function getActivePorts(): number[] {
  return Array.from(portRegistry.keys())
}

// ── Q1 容器配额校验 ──

export async function canAllocateQ1(editorId: number): Promise<boolean> {
  const quota = await getOrCreateQuota(editorId)
  return quota.q1Used < quota.q1Containers
}

export async function incrementQ1Used(editorId: number): Promise<void> {
  const quota = await getOrCreateQuota(editorId)
  await prisma.editorQuota.update({
    where: { editorId },
    data: { q1Used: quota.q1Used + 1 },
  })
}

export async function decrementQ1Used(editorId: number): Promise<void> {
  const quota = await getOrCreateQuota(editorId)
  if (quota.q1Used > 0) {
    await prisma.editorQuota.update({
      where: { editorId },
      data: { q1Used: Math.max(0, quota.q1Used - 1) },
    })
  }
}

// ── 真机 ADB 配额校验 ──

export async function canAllocatePhone(editorId: number): Promise<boolean> {
  const quota = await getOrCreateQuota(editorId)
  return quota.realPhonesUsed < quota.realPhones
}

export async function incrementPhoneUsed(editorId: number): Promise<void> {
  const quota = await getOrCreateQuota(editorId)
  await prisma.editorQuota.update({
    where: { editorId },
    data: { realPhonesUsed: quota.realPhonesUsed + 1 },
  })
}

export async function decrementPhoneUsed(editorId: number): Promise<void> {
  const quota = await getOrCreateQuota(editorId)
  if (quota.realPhonesUsed > 0) {
    await prisma.editorQuota.update({
      where: { editorId },
      data: { realPhonesUsed: Math.max(0, quota.realPhonesUsed - 1) },
    })
  }
}
