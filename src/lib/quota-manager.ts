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

// ── 端口分配核心逻辑 ──

/**
 * 为一个 manual 类型的 Account 自动分配 CDP 端口
 * @returns 分配的端口号
 * @throws 超额/无可用端口时抛错
 */
export async function allocateCdpPort(editorId: number): Promise<number> {
  const quota = await getOrCreateQuota(editorId)

  // 1) 校验指纹端口配额是否已满
  if (quota.fingerprintUsed >= quota.fingerprintPorts) {
    throw new Error(`指纹浏览器端口配额已满 (${quota.fingerprintUsed}/${quota.fingerprintPorts})`)
  }

  // 2) 查出此 editor 已占用的所有端口（包括旧数据中 accountId 里存的）
  const usedPorts = new Set<number>()

  // 新字段 cdpPort 中已分配的 — 全局查重（防止不同 editor 分配同一端口）
  const cdpAccounts = await prisma.account.findMany({
    where: { bindType: 'manual', cdpPort: { not: null } },
    select: { cdpPort: true },
  })
  cdpAccounts.forEach(a => { if (a.cdpPort) usedPorts.add(a.cdpPort) })

  // 兼容旧数据：accountId 里存了数字端口的也计入占用（全局）
  const legacyAccounts = await prisma.account.findMany({
    where: { bindType: 'manual', cdpPort: null },
    select: { accountId: true },
  })
  legacyAccounts.forEach(a => {
    const p = parseInt(a.accountId, 10)
    if (!isNaN(p) && p >= 1024 && p <= 65535) usedPorts.add(p)
  })

  // 3) 从端口池中找第一个空闲端口
  for (let port = quota.portRangeStart; port <= quota.portRangeEnd; port++) {
    if (!usedPorts.has(port)) {
      // 找到可用端口，更新已用计数
      await prisma.editorQuota.update({
        where: { editorId },
        data: { fingerprintUsed: quota.fingerprintUsed + 1 },
      })
      return port
    }
  }

  throw new Error(`端口池 ${quota.portRangeStart}-${quota.portRangeEnd} 已耗尽`)
}

/** 释放端口（解绑 / 删除账号时调用） */
export async function releaseCdpPort(editorId: number, port: number): Promise<void> {
  const quota = await getOrCreateQuota(editorId)
  if (quota.fingerprintUsed > 0) {
    await prisma.editorQuota.update({
      where: { editorId },
      data: { fingerprintUsed: Math.max(0, quota.fingerprintUsed - 1) },
    })
  }
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
