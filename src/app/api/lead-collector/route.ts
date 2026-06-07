import { NextRequest, NextResponse } from 'next/server'
import { getAuthFromHeaders } from '@/lib/api-auth'
import { generateText } from '@/lib/ai-providers'
import { PrismaClient } from '@prisma/client'
import { dispatchEngine, EngineAction } from '@/lib/engine-dispatcher'

const prisma = new PrismaClient()

/**
 * Lead Collector API - 线索采集系统完整 CRUD 接口
 * 
 * 路由：
 * GET    /api/lead-collector              → 查询线索列表
 * GET    /api/lead-collector/tasks        → 查询采集任务列表
 * POST   /api/lead-collector              → AI分析关键词 / 手动创建线索 / 导入线索
 * POST   /api/lead-collector/tasks        → 创建采集任务
 * PUT    /api/lead-collector/:id          → 更新线索状态
 * DELETE /api/lead-collector/:id          → 删除线索
 */

// ====== GET: 查询线索列表 ======
export async function GET(request: NextRequest) {
  const auth = getAuthFromHeaders(request)
  if (!auth) return NextResponse.json({ success: false, message: '请先登录' }, { status: 401 })

  try {
    const { searchParams } = new URL(request.url)
    const isTaskRequest = searchParams.get('type') === 'tasks'
    
    // 如果请求的是采集任务列表
    if (isTaskRequest) {
      return await handleGetTasks(auth.userId, searchParams)
    }
    
    // 否则返回线索列表
    return await handleGetLeads(auth.userId, searchParams)
    
  } catch (error) {
    console.error('查询失败:', error)
    return NextResponse.json(
      { success: false, message: '查询失败' },
      { status: 500 }
    )
  }
}

/**
 * 处理获取线索列表
 */
async function handleGetLeads(userId: number, searchParams: URLSearchParams) {
  const page = parseInt(searchParams.get('page') || '1')
  const limit = parseInt(searchParams.get('limit') || '10')
  const status = searchParams.get('status') || ''
  const sourceType = searchParams.get('sourceType') || ''
  const minScore = parseFloat(searchParams.get('minScore') || '0')
  
  // 构建查询条件（只查询当前用户或分配给当前用户的线索）
  const where: any = {
    OR: [
      { ownerId: userId },
      { assignedTo: userId }
    ]
  }
  
  if (status) where.status = status
  if (sourceType) where.sourceType = sourceType
  if (minScore > 0) where.intentScore = { gte: minScore }

  // 分页查询
  const [leads, total] = await Promise.all([
    prisma.lead.findMany({
      where,
      orderBy: [
        { intentScore: 'desc' },
        { createdAt: 'desc' }
      ],
      skip: (page - 1) * limit,
      take: limit,
      include: {
        task: {
          select: { id: true, name: true }
        },
        owner: {
          select: { id: true, name: true, username: true }
        },
        assignee: {
          select: { id: true, name: true, username: true }
        }
      }
    }),
    prisma.lead.count({ where })
  ])

  return NextResponse.json({
    success: true,
    data: {
      leads,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    }
  })
}

/**
 * 处理获取采集任务列表
 */
async function handleGetTasks(userId: number, searchParams: URLSearchParams) {
  const page = parseInt(searchParams.get('page') || '1')
  const limit = parseInt(searchParams.get('limit') || '10')
  const status = searchParams.get('status') || ''

  const where: any = { ownerId: userId }
  if (status) where.status = status

  const [tasks, total] = await Promise.all([
    prisma.collectionTask.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
      include: {
        _count: { select: { leads: true } }
      }
    }),
    prisma.collectionTask.count({ where })
  ])

  return NextResponse.json({
    success: true,
    data: {
      tasks,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    }
  })
}

// ====== POST: 多种操作 ======
export async function POST(request: NextRequest) {
  const auth = getAuthFromHeaders(request)
  if (!auth) return NextResponse.json({ success: false, message: '请先登录' }, { status: 401 })

  try {
    const body = await request.json()
    const { action, ...data } = body

    switch (action) {
      case 'analyze':
        return await handleAnalyzeKeywords(data)
      
      case 'create-lead':
        return await handleCreateLead(data, auth.userId)
      
      case 'import':
        return await handleImportLeads(data, auth.userId)
      
      case 'create-task':
        return await handleCreateTask(data, auth.userId)
      
      case 'run-task':
        // 执行自动采集任务（Phase 1 核心）
        return await handleRunTask(data, auth.userId)
      
      default:
        return NextResponse.json(
          { success: false, message: `未知操作: ${action}` },
          { status: 400 }
        )
    }

  } catch (error) {
    console.error('操作失败:', error)
    return NextResponse.json(
      { success: false, message: '操作失败' },
      { status: 500 }
    )
  }
}

/**
 * AI 分析关键词营销价值（保留原有功能）
 */
async function handleAnalyzeKeywords(data: any) {
  const { keywords } = data

  if (!keywords) {
    return NextResponse.json(
      { success: false, message: '缺少关键词' },
      { status: 400 }
    )
  }

  const prompt = `你是一个营销数据分析师。请分析以下关键词的营销价值，返回 JSON（只返回 JSON）：

关键词：${keywords}

返回格式：
{"intent":"用户意图描述（20字内）","targetGroup":"目标人群画像（30字内）","suggestions":["建议1","建议2","建议3"],"difficulty":"竞争难度（简单/中等/困难）","estimatedTraffic":"预估流量（高/中/低）"}`

  const result = await generateText(prompt)
  const jsonMatch = result?.match(/\{[\s\S]*\}/)
  const analysis = jsonMatch ? JSON.parse(jsonMatch[0]) : null
  
  return NextResponse.json({
    success: true,
    data: analysis || { message: '分析失败' }
  })
}

/**
 * 手动创建单条线索
 */
async function handleCreateLead(data: any, userId: number) {
  const {
    taskId,
    platform = '抖音',
    sourceType = 'manual',
    rawContent,
    contactInfo,
    tags = [],
    metadata = {}
  } = data

  if (!rawContent) {
    return NextResponse.json(
      { success: false, message: '缺少原始内容（rawContent）' },
      { status: 400 }
    )
  }

  const lead = await prisma.lead.create({
    data: {
      taskId: taskId || null,
      platform,
      sourceType,
      rawContent,
      contactInfo: contactInfo || null,
      intentScore: 0,  // 后续可通过 AI 打分更新
      status: 'new',
      tags: JSON.stringify(tags),
      metadata: JSON.stringify(metadata),
      ownerId: userId
    }
  })

  return NextResponse.json({
    success: true,
    data: lead,
    message: '线索创建成功'
  })
}

/**
 * 批量导入线索（CSV 或 JSON 数组）
 */
async function handleImportLeads(data: any, userId: number) {
  const { leads = [] } = data

  if (!Array.isArray(leads) || leads.length === 0) {
    return NextResponse.json(
      { success: false, message: '缺少导入数据（leads 数组）' },
      { status: 400 }
    )
  }

  // 批量创建线索
  const createdLeads = await Promise.all(
    leads.map(lead =>
      prisma.lead.create({
        data: {
          platform: lead.platform || '抖音',
          sourceType: lead.sourceType || 'import',
          rawContent: lead.rawContent || '',
          contactInfo: lead.contactInfo || null,
          intentScore: lead.intentScore || 0,
          status: lead.status || 'new',
          tags: JSON.stringify(lead.tags || []),
          metadata: JSON.stringify(lead.metadata || {}),
          ownerId: userId
        }
      })
    )
  )

  return NextResponse.json({
    success: true,
    data: {
      imported: createdLeads.length,
      leads: createdLeads
    },
    message: `成功导入 ${createdLeads.length} 条线索`
  })
}

/**
 * 创建采集任务
 */
async function handleCreateTask(data: any, userId: number) {
  const {
    name,
    platform = '抖音',
    keywords = [],
    sources = [],
    schedule = 'manual',
    status = 'active'
  } = data

  if (!name) {
    return NextResponse.json(
      { success: false, message: '缺少任务名称（name）' },
      { status: 400 }
    )
  }

  const task = await prisma.collectionTask.create({
    data: {
      name,
      platform,
      keywords: JSON.stringify(keywords),
      sources: JSON.stringify(sources),
      schedule,
      status,
      ownerId: userId
    }
  })

  return NextResponse.json({
    success: true,
    data: task,
    message: '采集任务创建成功'
  })
}

/**
 * 执行自动采集任务（Phase 1 核心）
 * 
 * 流程：
 * 1. 查找 CollectionTask 获取关键词配置
 * 2. 通过 engine-dispatcher 调用数据采集引擎批量搜索
 * 3. 对每个视频抓取评论
 * 4. AI 分析评论提取高意向线索
 * 5. 自动写入 Lead 表
 */
async function handleRunTask(data: any, userId: number) {
  const { taskId, keywords, platform = 'douyin', maxResults = 20 } = data

  // 确定要用的任务和关键词
  let taskKeywords: string[] = []
  let targetTaskId: number | undefined

  if (taskId) {
    // 从已有任务读取配置
    const task = await prisma.collectionTask.findFirst({
      where: { id: taskId, OR: [{ ownerId: userId }, { ownerId: 0 }] }  // ownerId=0 为系统任务
    })
    if (!task) {
      return NextResponse.json(
        { success: false, message: '采集任务不存在或无权限' },
        { status: 404 }
      )
    }
    taskKeywords = JSON.parse(task.keywords || '[]')
    targetTaskId = task.id
  } else if (keywords && Array.isArray(keywords) && keywords.length > 0) {
    // 直接传入关键词（一次性采集）
    taskKeywords = keywords.map((k: string | number) => String(k)).filter(Boolean)
  } else {
    return NextResponse.json(
      { success: false, message: '请提供 taskId 或 keywords 参数' },
      { status: 400 }
    )
  }

  if (taskKeywords.length === 0) {
    return NextResponse.json(
      { success: false, message: '采集关键词为空' },
      { status: 400 }
    )
  }

  // 更新任务状态为执行中
  if (targetTaskId) {
    await prisma.collectionTask.update({
      where: { id: targetTaskId },
      data: { status: 'running' }
    })
  }

  try {
    // 调用引擎调度器执行完整采集流程
    const result = await dispatchEngine({
      action: 'extract',
      platform,
      params: {
        extractType: 'collection',
        keywords: taskKeywords,
        maxResults,
        ownerId: userId,
        taskId: targetTaskId,
      },
      userId,
    })

    if (!result.success || !result.data) {
      // 恢复任务状态
      if (targetTaskId) {
        await prisma.collectionTask.update({ where: { id: targetTaskId }, data: { status: 'active' } })
      }
      return NextResponse.json({
        success: false,
        message: result.message || '采集执行失败',
        data: result.data,
      })
    }

    const collectionData = result.data as {
      videos: any[]
      comments: any[]
      extractedLeads: Array<{ content: string; source: string; intentScore: number; contactInfo?: string }>
      errors: string[]
    }

    // ====== 新增：持久化原始视频数据到 CrawledVideo 表 ======
    let savedVideoIds: Record<string, number> = {}  // { videoId_in_platform: db_id }
    if (collectionData.videos && collectionData.videos.length > 0) {
      const videoCreates = collectionData.videos.map((v: any) => {
        const platformVid = v.videoId || v.aweme_id || v.id || `unknown_${Date.now()}_${Math.random()}`
        return prisma.crawledVideo.upsert({
          where: {   // 用平台唯一ID去重（同一任务内不重复采集同一视频）
            platform_videoId: {
              platform: platform,
              videoId: String(platformVid),
            }
          },
          update: {},  // 已存在则不更新
          create: {
            taskId: targetTaskId || null,
            platform,
            videoId: String(platformVid),
            title: v.title || '',
            description: v.description || v.desc || null,
            coverUrl: v.cover || v.coverUrl || v.staticCoverUrl || null,
            videoUrl: v.playAddr || v.videoUrl || v.playApi || null,
            authorUid: v.authorUid?.toString() || v.author?.uid?.toString() || v.uniqueId?.toString() || null,
            authorName: v.authorName || v.author?.nickname || v.nickname || null,
            authorAvatar: v.authorAvatar || v.author?.avatarThumb || null,
            likeCount: typeof v.likeCount === 'number' ? v.likeCount : parseInt(v.likeCount || v.diggCount || '0', 10) || 0,
            commentCount: typeof v.commentCount === 'number' ? v.commentCount : parseInt(v.commentCount || v.commentCountStr || '0', 10) || 0,
            shareCount: typeof v.shareCount === 'number' ? v.shareCount : parseInt(v.shareCount || '0', 10) || 0,
            collectCount: typeof v.collectCount === 'number' ? v.collectCount : parseInt(v.collectCount || v.collectCountStr || '0', 10) || 0,
            playCount: v.playCount ? parseInt(String(v.playCount), 10) || null : null,
            publishedAt: v.createTime || v.publishedAt ? new Date(v.createTime || v.publishedAt) : null,
          }
        }).then(r => ({ platformVid, dbId: r.id }))
      })
      const videoResults = await Promise.all(videoCreates)
      for (const r of videoResults) {
        if (r) savedVideoIds[r.platformVid] = r.dbId
      }
    }

    // ====== 新增：持久化原始评论数据到 CrawledComment 表 ======
    if (collectionData.comments && collectionData.comments.length > 0) {
      const commentCreates = collectionData.comments.map((c: any) => {
        const commentId = c.commentId || c.cid || c.id || `unknown_${Date.now()}_${Math.random()}`
        // 找到该评论所属的视频的数据库ID
        const parentVideoId = c.videoId || c.awemeId || c.noteId || ''
        const crawledVideoDbId = savedVideoIds[parentVideoId] || null

        // 如果找不到关联视频，跳过该条评论（或存为孤儿）
        if (!crawledVideoDbId) return Promise.resolve(null)

        return prisma.crawledComment.create({
          data: {
            videoId: crawledVideoDbId,
            commentId: String(commentId),
            content: c.content || c.text || c.commentText || '',
            authorUid: c.uid?.toString() || c.userUid?.toString() || c.authorUid?.toString() || null,
            authorName: c.nickname || c.userName || c.authorName || null,
            authorAvatar: c.avatar || c.avatarThumb || null,
            likeCount: typeof c.likeCount === 'number' ? c.likeCount : parseInt(c.likeCount || c.diggCount || '0', 10) || 0,
            createdAt: c.createTime || c.commentTime ? new Date(c.createTime || c.commentTime) : null,
            replyTo: c.replyId || c.replyToCommentId || null,
            isAuthorReply: !!c.isAuthorReply,
          }
        })
      })
      await Promise.all(commentCreates)
    }

    // 将提取到的线索写入数据库
    let createdLeadsCount = 0
    if (collectionData.extractedLeads.length > 0) {
      const leadCreates = collectionData.extractedLeads.map(lead =>
        prisma.lead.create({
          data: {
            taskId: targetTaskId || null,
            platform,
            sourceType: 'auto_collection',
            rawContent: lead.content,
            contactInfo: lead.contactInfo || null,
            intentScore: lead.intentScore,
            status: 'new',
            tags: JSON.stringify(['自动采集']),
            metadata: JSON.stringify({ source: lead.source }),
            ownerId: userId,
          }
        }).catch(e => {
          console.error('创建线索失败:', e)
          return null
        })
      )

      const createdLeads = await Promise.all(leadCreates)
      createdLeadsCount = createdLeads.filter(l => l !== null).length
    }

    // 恢复/更新任务状态
    if (targetTaskId) {
      await prisma.collectionTask.update({
        where: { id: targetTaskId },
        data: { status: 'active' }
      })
    }

    return NextResponse.json({
      success: true,
      data: {
        videosCollected: collectionData.videos.length,
        commentsCollected: collectionData.comments.length,
        videosSaved: Object.keys(savedVideoIds).length,      // 新增：实际入库视频数
        commentsSaved: collectionData.comments?.filter(c => savedVideoIds[c.videoId || c.awemeId || '']).length || 0,  // 新增
        leadsExtracted: collectionData.extractedLeads.length,
        leadsSaved: createdLeadsCount,
        errors: collectionData.errors,
        videos: collectionData.videos.slice(0, 5),  // 返回前5个视频作为预览
      },
      message: `采集完成: ${collectionData.videos.length}视频(入库${Object.keys(savedVideoIds).length}), ${collectionData.comments.length}评论(入库), ${createdLeadsCount}条线索已保存`
    })

  } catch (error: any) {
    console.error('[自动采集] 异常:', error)
    if (targetTaskId) {
      await prisma.collectionTask.update({
        where: { id: targetTaskId },
        data: { status: 'active' }
      })
    }
    return NextResponse.json(
      { success: false, message: error.message || '采集过程出错' },
      { status: 500 }
    )
  }
}

// ====== PUT: 更新线索状态或分配 ======
export async function PUT(request: NextRequest) {
  const auth = getAuthFromHeaders(request)
  if (!auth) return NextResponse.json({ success: false, message: '请先登录' }, { status: 401 })

  try {
    const body = await request.json()
    const { id, ...updateData } = body

    if (!id) {
      return NextResponse.json(
        { success: false, message: '缺少线索 ID' },
        { status: 400 }
      )
    }

    // 检查线索是否存在且有权访问
    const existing = await prisma.lead.findFirst({
      where: {
        id,
        OR: [
          { ownerId: auth.userId },
          { assignedTo: auth.userId }
        ]
      }
    })

    if (!existing) {
      return NextResponse.json(
        { success: false, message: '线索不存在或无权限修改' },
        { status: 404 }
      )
    }

    // 准备更新数据
    const data: any = {}
    if (updateData.status !== undefined) data.status = updateData.status
    if (updateData.contactInfo !== undefined) data.contactInfo = updateData.contactInfo
    if (updateData.intentScore !== undefined) data.intentScore = updateData.intentScore
    if (updateData.tags !== undefined) data.tags = JSON.stringify(updateData.tags)
    if (updateData.metadata !== undefined) data.metadata = JSON.stringify(updateData.metadata)
    if (updateData.assignedTo !== undefined) data.assignedTo = updateData.assignedTo

    const lead = await prisma.lead.update({
      where: { id },
      data
    })

    return NextResponse.json({
      success: true,
      data: lead,
      message: '线索更新成功'
    })
  } catch (error) {
    console.error('更新线索失败:', error)
    return NextResponse.json(
      { success: false, message: '更新失败' },
      { status: 500 }
    )
  }
}

// ====== DELETE: 删除线索 ======
export async function DELETE(request: NextRequest) {
  const auth = getAuthFromHeaders(request)
  if (!auth) return NextResponse.json({ success: false, message: '请先登录' }, { status: 401 })

  try {
    const { searchParams } = new URL(request.url)
    const id = parseInt(searchParams.get('id') || '')

    if (!id) {
      return NextResponse.json(
        { success: false, message: '缺少线索 ID' },
        { status: 400 }
      )
    }

    // 检查线索是否存在且属于当前用户
    const existing = await prisma.lead.findFirst({
      where: {
        id,
        ownerId: auth.userId  // 只有 owner 才能删除
      }
    })

    if (!existing) {
      return NextResponse.json(
        { success: false, message: '线索不存在或无权限删除' },
        { status: 404 }
      )
    }

    await prisma.lead.delete({
      where: { id }
    })

    return NextResponse.json({
      success: true,
      message: '线索已删除'
    })
  } catch (error) {
    console.error('删除线索失败:', error)
    return NextResponse.json(
      { success: false, message: '删除失败' },
      { status: 500 }
    )
  }
}
