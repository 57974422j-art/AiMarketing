import { NextRequest, NextResponse } from 'next/server'
import { getAuthFromHeaders } from '@/lib/api-auth'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

/**
 * 数据导出 API
 *
 * GET /api/export?type=leads&format=csv&status=new&minScore=0.5
 * GET /api/export?type=videos&format=csv&platform=douyin
 * GET /api/export?type=comments&format=csv&videoId=5
 *
 * 支持格式: csv (P0), json (P1), xlsx (P2 - 需要 xlsx 依赖)
 */

export async function GET(request: NextRequest) {
  const auth = getAuthFromHeaders(request)
  if (!auth) return NextResponse.json({ success: false, message: '请先登录' }, { status: 401 })

  try {
    const { searchParams } = new URL(request.url)
    const type = searchParams.get('type') || 'leads'       // leads | videos | comments | users | trending
    const format = (searchParams.get('format') || 'csv').toLowerCase()  // csv | json

    switch (type) {
      case 'leads':
        return await exportLeads(auth.userId, searchParams, format)
      case 'videos':
        return await exportVideos(auth.userId, searchParams, format)
      case 'comments':
        return await exportComments(auth.userId, searchParams, format)
      case 'users':
        return await exportUsers(searchParams, format)
      case 'trending':
        return await exportTrending(searchParams, format)
      default:
        return NextResponse.json({ success: false, message: `不支持的导出类型: ${type}` }, { status: 400 })
    }
  } catch (error: any) {
    console.error('[导出API] 错误:', error)
    return NextResponse.json({ success: false, message: error.message || '导出失败' }, { status: 500 })
  }
}

// ====== 导出线索数据 ======
async function exportLeads(userId: number, params: URLSearchParams, format: string) {
  const status = params.get('status') || ''
  const minScore = parseFloat(params.get('minScore') || '0')
  const taskId = params.get('taskId')
  const hasContact = params.get('hasContact')

  // 构建查询条件
  const where: any = {
    OR: [
      { ownerId: userId },
      { assignedTo: userId }
    ]
  }

  if (status) where.status = status
  if (minScore > 0) where.intentScore = { gte: minScore }
  if (taskId) where.taskId = parseInt(taskId)
  if (hasContact === 'true') where.contactInfo = { not: '' }  // 有联系方式

  const leads = await prisma.lead.findMany({
    where,
    orderBy: [
      { intentScore: 'desc' },
      { createdAt: 'desc' }
    ],
    include: {
      task: { select: { id: true, name: true } },
      owner: { select: { name: true, username: true } },
    }
  })

  if (leads.length === 0) {
    return NextResponse.json({ success: false, message: '没有可导出的数据' })
  }

  // 构建 CSV 内容
  const header = ['ID', '任务名称', '平台', '来源类型', '原始内容', '联系方式', '意向度', '状态', '标签', '归属人', '创建时间']
  const rows = leads.map(l => [
    l.id,
    l.task?.name || '',
    l.platform,
    l.sourceType,
    escapeCsv(l.rawContent),
    escapeCsv(l.contactInfo || ''),
    l.intentScore.toFixed(2),
    l.status,
    escapeCsv(l.tags || ''),
    l.owner?.name || l.owner?.username || '',
    l.createdAt.toISOString(),
  ])

  return buildCsvResponse(header, rows, `leads_${formatDate(new Date())}`)
}

// ====== 导出视频数据 ======
async function exportVideos(userId: number, params: URLSearchParams, format: string) {
  const platform = params.get('platform') || ''
  const taskId = params.get('taskId')
  const keyword = params.get('keyword') || ''

  const where: any = {}
  if (platform) where.platform = platform
  if (taskId) where.taskId = parseInt(taskId)
  if (keyword) where.title = { contains: keyword }

  const videos = await prisma.crawledVideo.findMany({
    where,
    orderBy: { crawledAt: 'desc' },
    include: {
      task: { select: { id: true, name: true } },
      _count: { select: { comments: true } },
    },
    take: parseInt(params.get('limit') || '5000'),  // 安全上限
  })

  if (videos.length === 0) {
    return NextResponse.json({ success: false, message: '没有可导出的视频数据。请先执行采集任务。' })
  }

  const header = ['ID', '平台', '平台视频ID', '标题', '描述', '作者昵称', '播放数', '点赞数', '评论数', '分享数', '收藏数', '发布时间', '采集时间', '采集任务']
  const rows = videos.map(v => [
    v.id,
    v.platform,
    v.videoId,
    escapeCsv(v.title),
    escapeCsv(v.description || ''),
    escapeCsv(v.authorName || ''),
    v.playCount || '',
    v.likeCount,
    v.commentCount,
    v.shareCount,
    v.collectCount,
    v.publishedAt?.toISOString() || '',
    v.crawledAt.toISOString(),
    v.task?.name || '',
  ])

  return buildCsvResponse(header, rows, `videos_${formatDate(new Date())}`)
}

// ====== 导出评论数据 ======
async function exportComments(userId: number, params: URLSearchParams, format: string) {
  const videoId = params.get('videoId')
  const hasLead = params.get('hasLead')
  const minIntent = parseFloat(params.get('minIntent') || '0')

  const where: any = {}
  if (videoId) where.videoId = parseInt(videoId)
  if (hasLead === 'true') where.leadId = { not: null }
  if (minIntent > 0) where.intentScore = { gte: minIntent }

  const comments = await prisma.crawledComment.findMany({
    where,
    orderBy: { crawledAt: 'desc' },
    include: {
      video: {
        select: { id: true, title: true, platform: true, authorName: true },
      },
    },
    take: parseInt(params.get('limit') || '10000'),
  })

  if (comments.length === 0) {
    return NextResponse.json({ success: false, message: '没有可导出的评论数据。请先执行采集任务。' })
  }

  const header = ['ID', '所属视频', '视频作者', '平台评论ID', '评论者', '评论内容', '点赞数', '是否作者回复', 'AI意向度', '关联线索ID', '评论时间', '采集时间']
  const rows = comments.map(c => [
    c.id,
    escapeCsv(c.video?.title || ''),
    escapeCsv(c.video?.authorName || ''),
    c.commentId,
    escapeCsv(c.authorName || ''),
    escapeCsv(c.content),
    c.likeCount,
    c.isAuthorReply ? '是' : '否',
    c.intentScore?.toFixed(2) || '',
    c.leadId || '',
    c.createdAt?.toISOString() || '',
    c.crawledAt.toISOString(),
  ])

  return buildCsvResponse(header, rows, `comments_${formatDate(new Date())}`)
}

// ====== 导出用户画像 ======
async function exportUsers(params: URLSearchParams, format: string) {
  const platform = params.get('platform') || ''

  const where: any = {}
  if (platform) where.platform = platform

  const users = await prisma.crawledUserProfile.findMany({
    where,
    orderBy: { followerCount: 'desc' },
    take: parseInt(params.get('limit') || '5000'),
  })

  if (users.length === 0) {
    return NextResponse.json({ success: false, message: '没有可导出的用户画像数据。' })
  }

  const header = ['UID', '平台', '昵称', '头像', '简介', '粉丝数', '关注数', '获赞数', '作品数', '是否认证', '认证类型', '地区', '首次采集', '最后更新']
  const rows = users.map(u => [
    u.uid,
    u.platform,
    escapeCsv(u.nickname),
    u.avatar || '',
    escapeCsv(u.bio || ''),
    u.followerCount,
    u.followingCount,
    u.likeCount,
    u.videoCount,
    u.isVerified ? '是' : '否',
    u.verifyType || '',
    u.location || '',
    u.firstCrawledAt.toISOString(),
    u.lastCrawledAt.toISOString(),
  ])

  return buildCsvResponse(header, rows, `users_${formatDate(new Date())}`)
}

// ====== 导出热门话题 ======
async function exportTrending(params: URLSearchParams, format: string) {
  const platform = params.get('platform') || ''
  const category = params.get('category') || ''

  const where: any = {}
  if (platform) where.platform = platform
  if (category) where.category = category

  const trending = await prisma.crawledTrending.findMany({
    where,
    orderBy: [{ heatValue: 'desc' }, { rank: 'asc' }],
    take: parseInt(params.get('limit') || '2000'),
  })

  if (trending.length === 0) {
    return NextResponse.json({ success: false, message: '没有可导出的热门话题数据。' })
  }

  const header = ['ID', '平台', '类别', '排名', '话题标题', '热度值', '描述', '封面图', '采集时间']
  const rows = trending.map(t => [
    t.id,
    t.platform,
    t.category,
    t.rank || '',
    escapeCsv(t.title),
    t.heatValue || '',
    escapeCsv(t.description || ''),
    t.coverUrl || '',
    t.crawledAt.toISOString(),
  ])

  return buildCsvResponse(header, rows, `trending_${formatDate(new Date())}`)
}

// ====== 工具函数 ======

/** 构建带 BOM 的 UTF-8 CSV 响应（Excel 打开中文不乱码） */
function buildCsvResponse(header: string[], rows: any[][], filename: string): NextResponse {
  // CSV 头部加 BOM，让 Excel 正确识别 UTF-8 编码
  const BOM = '\uFEFF'
  const csvContent = BOM + [header.join(','), ...rows.map(r => r.join(','))].join('\n')

  return new NextResponse(csvContent, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}.csv"`,
    },
  })
}

/** CSV 字段转义：包含逗号/换行/双引号时用双引号包裹 */
function escapeCsv(value: string): string {
  if (!value) return ''
  const str = String(value)
  if (str.includes(',') || str.includes('\n') || str.includes('"') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`
  }
  return str
}

/** 格式化日期为文件名安全格式 */
function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10).replace(/-/g, '')
}

// 强制动态渲染：API 路由依赖 request.headers / 鉴权，禁止 Next 在构建期静态预渲染
export const dynamic = 'force-dynamic'
