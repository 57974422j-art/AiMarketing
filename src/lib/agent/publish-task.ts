// 2026-09-12: 发布任务统一入口
// 「点平台按钮」「重发」「重发到其它平台」全部走这里——task 格式/files 签名/编号只有一处实现
import { PrismaClient } from '@prisma/client'
import { signedUrl } from '@/lib/oss'

const prisma = new PrismaClient()

export const PLATFORM_KEY: Record<string, string> = {
  '抖音': 'douyin', '小红书': 'xiaohongshu', '微博': 'weibo',
  'B站': 'bilibili', '快手': 'kuaishou', '视频号': 'shipinhao',
}
export const PLATFORM_NAME: Record<string, string> = {
  douyin: '抖音', xiaohongshu: '小红书', weibo: '微博',
  bilibili: 'B站', kuaishou: '快手', shipinhao: '视频号',
}
// 各平台发布页（客户端脚本兜底/展示用）
export const PLATFORM_URL: Record<string, string> = {
  douyin: 'https://creator.douyin.com/creator-micro/content/upload',
  xiaohongshu: 'https://creator.xiaohongshu.com/publish/publish?from=menu&target=video',
  weibo: 'https://weibo.com/upload/channel',
  bilibili: 'https://member.bilibili.com/platform/upload/video/frame',
  kuaishou: 'https://cp.kuaishou.com/article/publish/video',
  shipinhao: 'https://channels.weixin.qq.com/platform/post/create',
}

export type PublishParams = {
  platform: string          // douyin / xiaohongshu / ...
  videoName: string
  title?: string
  topics?: string
  coverUrl?: string
  coverFrames?: any[]
  skips?: string[]
}

/** 构造发布所需文件 URL 列表（视频 OSS 签名 + 封面）——签名会过期，每次建任务都重签 */
export async function buildPublishFiles(userId: number, p: PublishParams): Promise<string[]> {
  const files: string[] = []
  const skips = p.skips || []
  if (p.videoName) {
    try {
      const key = 'storage/' + userId + '/' + p.videoName
      files.push(await signedUrl(key, 86400))
    } catch (e) {
      // 个人仓库里没有该视频（可能已删）——留空，客户端会报"缺视频文件"
    }
  }
  if (p.coverUrl && !skips.includes('封面') && !skips.includes('抽帧')) {
    files.push(p.coverUrl)   // 已是签名 URL 或 /api/storage/... 路径
  }
  return files
}

/** 唯一建发布任务入口——返回 { task, files, platformName } */
export async function createPublishTask(userId: number, p: PublishParams, taskText = '') {
  const files = await buildPublishFiles(userId, p)
  const taskJson = JSON.stringify({
    kind: 'publish',
    platform: p.platform,
    videoName: p.videoName || '',
    title: p.title || '',
    topics: p.topics || '',
    cover: p.coverUrl || '',
    coverFrames: p.coverFrames || [],
    skips: p.skips || [],
    task: taskText,
  })
  const lastS = await prisma.agentBrowserTask
    .findFirst({ where: { userId }, orderBy: { seq: 'desc' }, select: { seq: true } })
    .catch(() => null) as any
  const t = await prisma.agentBrowserTask.create({
    data: { userId, task: taskJson, files: JSON.stringify(files), status: 'pending', seq: (lastS?.seq ?? 0) + 1 },
  })
  return { task: t, files, platformName: PLATFORM_NAME[p.platform] || p.platform }
}

/** 解析旧任务的 task 字段 → 参数（仅新格式 JSON；老的人话任务返回 null） */
export function parsePublishTask(taskText: string): PublishParams | null {
  try {
    const o = JSON.parse(String(taskText || ''))
    if (o && o.kind === 'publish' && o.videoName !== undefined) {
      return {
        platform: String(o.platform || 'douyin'),
        videoName: String(o.videoName || ''),
        title: String(o.title || ''),
        topics: String(o.topics || ''),
        coverUrl: String(o.cover || o.coverUrl || ''),
        coverFrames: o.coverFrames || [],
        skips: o.skips || [],
      }
    }
  } catch (e) { /* 老格式（人话文本） */ }
  return null
}
