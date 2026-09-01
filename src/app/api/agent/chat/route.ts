import { NextRequest, NextResponse } from 'next/server'
// 2026-08-27: 发布草稿状态（多轮确认工作流用）：userId -> { videoName, frames, selectedFrame, title, topics, cover, step }
const PUBLISH_DRAFT: Map<number, any> = new Map()
import {
  generateText, generateImage, generateVideo, generateLongVideo, queryVideoTask,
  ToolDefinition,
  agnesChat, dashscopeFunctionCall, dashscopeGenerateImageAsync, type AgentChatMessage,
} from '@/lib/ai-providers'
import { searchTrendsReal } from '@/lib/gemini'
import { getAuthFromHeaders } from '@/lib/api-auth'
import { spendTokens, checkTokens, TOKEN_COSTS } from '@/lib/token-wallet'
import { listObjects, signedUrl, getOSSClient, putObject } from '@/lib/oss'
import { createRecord, finalizeSuccessByTaskId, finalizeSuccess } from '@/lib/generation-record'
import { execSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { getSystemConfigs, checkFeatureAccess } from '@/lib/quota'
import { PrismaClient } from '@prisma/client'

// 已接入的发布平台（其余视为"未接入需求"收集）
const SUPPORTED_PLATFORMS: Record<string, string> = {
  douyin: '抖音', xiaohongshu: '小红书', kuaishou: '快手', shipinhao: '视频号', bilibili: 'B站',
}
// 用户可能提的、我们暂未接入的平台（识别为未接入需求）
const UNMET_PLATFORM_ALIAS: Record<string, string> = {
  tiktok: 'TikTok', tik: 'TikTok', '抖音国际版': 'TikTok',
  youtube: 'YouTube', '油管': 'YouTube',
  weibo: '微博', '微博': '微博',
  instagram: 'Instagram', ins: 'Instagram', ig: 'Instagram', '照片墙': 'Instagram',
  facebook: 'Facebook', fb: 'Facebook', '脸书': 'Facebook',
  twitter: 'X(Twitter)', x: 'X(Twitter)', '推特': 'X(Twitter)',
  threads: 'Threads', reddit: 'Reddit', pinterest: 'Pinterest',
  kwai: '快手国际版', '快手海外': '快手国际版',
  '淘宝': '淘宝', taobao: '淘宝', '京东': '京东', jd: '京东',
  '大众点评': '大众点评', '知乎': '知乎', zhihu: '知乎',
}

export const runtime = 'nodejs'
const prisma = new PrismaClient()

// ==================== 工具定义 ====================

// 2026-08-21: 发布抽帧暂存（userId → 帧列表，"用第N帧"取用）
const frameStore = new Map<number, { frames: { idx: number; url: string }[]; videoName: string }>()
// 2026-08-29: 生图异步化——提交后立即返回，后台轮询+转存（避免长请求被网络层掐断"网络连接失败"）
const pendingImages = new Map<number, { taskId: string; ts: number; url?: string; fileName?: string; done: boolean }>()

const AGENT_TOOLS: ToolDefinition[] = [
  {
    name: 'generate_copy',
    description: '为用户生成营销文案、广告语、社交媒体内容。触发词："写文案""推广""广告""小红书""抖音脚本""帮我写"。',
    parameters: {
      type: 'object',
      properties: {
        product: { type: 'string', description: '产品或品牌名称' },
        platform: { type: 'string', description: '目标平台：抖音/小红书/微信/多平台' },
        style: { type: 'string', description: '风格：专业/活泼/幽默/高端/种草' },
      }, required: ['product'],
    },
  },
  {
    name: 'generate_image',
    description: 'AI生成图片/海报。触发词："生成图片""做海报""设计图""画一张""海报图""配图"。**v2 流程：生成前先调 search_templates 搜公共素材库推荐给用户选（用户选中的素材/模板 prompt 用于生成）；搜不到才直接生成。**前缀区分：用户说"打开AI生图/去生图页"是跳转（open_page /image-generator），不是生成——禁止调用本工具。**',
    parameters: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: '图片详细描述' },
        size: { type: 'string', description: '尺寸：1024*1024 / 768*1344(竖版) / 1440*720(横版)' },
      }, required: ['prompt'],
    },
  },
  {
    name: 'generate_video',
    description: 'AI生成视频（百炼 wan2.7）。触发词："做视频""生成视频""短视频""拍一个"。注意：首次调用必须先报费用预估（不要带 confirmed），用户确认后再带 confirmed=true 真正生成；时长超过15秒会自动分段拼接（每段用上一段尾帧做参考，保证衔接）。**前缀区分：用户说"打开文生视频/去文生视频"是跳转页面（open_page /text-to-video），不是生成——禁止调用本工具。**',
    parameters: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: '视频内容描述' },
        duration: { type: 'number', description: '时长(秒)，默认5；单次上限15秒，超过15秒自动分段拼接' },
        ratio: { type: 'string', description: '比例：16:9横屏 / 9:16竖屏' },
        confirmed: { type: 'boolean', description: '用户是否已确认费用。false/缺省=只报预估；true=真正生成' },
        segModel: { type: 'string', description: '分段模型（仅>15s时用），可选 wan2.7-t2v / happyhorse-1.0-t2v，缺省自动' },
      }, required: ['prompt'],
    },
  },
  {
    name: 'generate_storyboard',
    description: '生成视频分镜脚本（只出方案，不生成视频）。触发词："分镜""脚本""镜头方案"。根据用户视频创意输出分镜JSON（每镜：画面描述/英文prompt/时长/镜头感）+ 总费用预估。用户确认分镜后，再用 generate_video（confirmed=true）逐镜生成。**前缀区分：用户消息以"打开/去/进入"开头是跳转页面（open_page），不是生成——禁止调用本工具。**',
    parameters: {
      type: 'object',
      properties: {
        topic: { type: 'string', description: '视频主题/创意描述' },
        duration: { type: 'number', description: '目标总时长(秒)，默认30' },
        ratio: { type: 'string', description: '比例：16:9横屏 / 9:16竖屏' },
        style: { type: 'string', description: '风格要求（电影感/卡通/写实等），可选' },
      }, required: ['topic'],
    },
  },
  {
    name: 'create_ai_video',
    description: '一句话 AI 成片：内部自动分镜并创建后台生成任务（无需用户先要分镜）。触发词："帮我做个视频""一键成片""自动做视频""做一条视频"。规则同 generate_video：首次调用不带 confirmed 只报费用预估，用户确认后带 confirmed=true 才真正分镜+建任务。返回任务ID，可用 query_storyboard 查进度。**前缀区分：用户说"打开一键成片/去一键成片"是跳转页面（open_page /auto-compile），不是做视频——禁止调用本工具。**',
    parameters: {
      type: 'object',
      properties: {
        topic: { type: 'string', description: '视频主题/创意（一句话）' },
        duration: { type: 'number', description: '目标总时长(秒)，默认30' },
        ratio: { type: 'string', description: '比例：16:9横屏 / 9:16竖屏' },
        style: { type: 'string', description: '风格要求（电影感/卡通/写实等），可选' },
        confirmed: { type: 'boolean', description: '用户是否已确认费用。false/缺省=只报预估；true=真正分镜并创建任务' },
      }, required: ['topic'],
    },
  },
  {
    name: 'create_storyboard_task',
    description: '创建分镜成片任务（后台逐镜生成，可查进度）。在 generate_storyboard 出分镜且用户确认费用后调用。返回任务ID。**前缀区分：用户消息以"打开/去/进入"开头是跳转页面（open_page），不是生成——禁止调用本工具。**',
    parameters: {
      type: 'object',
      properties: {
        topic: { type: 'string', description: '视频主题' },
        shots: { type: 'array', items: { type: 'object' }, description: '分镜数组（来自 generate_storyboard）：每镜 {prompt, desc, duration, camera}' },
        ratio: { type: 'string', description: '比例 16:9 / 9:16' },
        duration: { type: 'number', description: '总时长(秒)' },
      }, required: ['topic', 'shots'],
    },
  },
  {
    name: 'query_storyboard',
    description: '查询分镜成片任务进度（每镜状态/完成数/成品URL）。参数：id（任务ID）。',
    parameters: {
      type: 'object',
      properties: { id: { type: 'number', description: '分镜任务ID' } },
      required: ['id'],
    },
  },
  {
    name: 'search_web_images',
    description: '网络搜图。触发词："找图片""搜图""有没有XX的图片""帮我找一张"。',
    parameters: {
      type: 'object',
      properties: {
        keyword: { type: 'string', description: '搜索关键词' },
        count: { type: 'number', description: '需要的图片数量，默认3' },
      }, required: ['keyword'],
    },
  },

  {
    name: 'search_web',
    description: '实时搜索互联网（Google，2026-08-07）。触发词："帮我搜""查一下""搜索""找找XX""看看XX新闻""找XX视频"。可搜网页/视频/新闻三种，视频会给出可播放的链接。',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '搜索关键词（中文直接给，服务端自动适配语言）' },
        type: { type: 'string', enum: ['web', 'videos', 'news'], description: '搜索类型：网页(默认)/videos视频/news新闻' },
      }, required: ['query'],
    },
  },
  {
    name: 'crawl_web',
    description: '抓取任意网页内容并转成 Markdown（2026-08-13，crawl4ai）。**用户消息中出现 http/https 链接时必须无条件调用（不要凭常识判断链接有效性/内容——抓了才知道）**。触发词："看看这个网页""抓取这个页面""这个链接内容""竞品网站""这个文章讲了什么"。',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: '要抓取的网页完整 URL（http/https）' },
        purpose: { type: 'string', description: '抓取目的（可选，帮助提炼重点，如"提取竞品价格""总结这篇文章"）' },
      }, required: ['url'],
    },
  },
  {
    name: 'digital_human_speak',
    description: '创建数字人口播视频：上传照片+选择声音+输入文案。触发词："数字人""口播""虚拟人""AI主播"。**前缀区分：用户说"打开数字人/去数字人"是跳转页面（open_page /digital-human），不是生成口播——禁止调用本工具。**',
    parameters: {
      type: 'object',
      properties: {
        text: { type: 'string', description: '口播文案内容' },
        imageUrl: { type: 'string', description: '人物照片URL（用户已上传或从仓库选）' },
        voiceType: { type: 'string', description: '声音：AI配音(默认) / 自定义录音' },
      }, required: ['text'],
    },
  },
  {
    name: 'search_storage',
    description: '搜索项目素材库（MediaAsset，平台级素材：趋势视频/BGM/图片等）。触发词："素材库""媒体库""项目素材""找视频""找图片"。制作日常内容时可主动调用挑选可用素材。注意：只返回数据库真实条目（标题/ID/条数）；没有时返回空，禁止编造素材清单。',
    parameters: {
      type: 'object',
      properties: {
        keyword: { type: 'string', description: '搜索关键词（匹配标题）' },
        type: { type: 'string', description: '素材类型：video/image/audio/all' },
      },
    },
  },
  {
    name: 'search_video',
    description: '搜索并可播放视频。用于对话/语音"找视频播放""帮我找个XX视频看看""播放白龙马的视频"。触发词："找视频""搜视频""播放""看看视频""找个XX的视频"。返回 VIDEO_RESULT(可直接播放的URL，前端自动弹播放器真播，支持B站/YouTube/直链iframe)；本地库无结果且用户要外站视频时返回 VIDEO_WEB(外站搜索/播放链接)。优先个人仓库与项目素材库，其次可外链播放。',
    parameters: {
      type: 'object',
      properties: {
        keyword: { type: 'string', description: '视频关键词或外站视频名，如"口红""美食""白龙马"(B站/YouTube视频名)' },
        scope: { type: 'string', description: '范围：all(默认,个人仓库+素材库) / personal(仅个人仓库) / storage(仅项目素材库) / web(外站播放，如B站/YouTube搜索结果)' },
      },
    },
  },
  {
    name: 'list_personal_files',
    description: '列出用户个人仓库（OSS 私有存储）的文件，含用户自己上传的视频/图片。触发词："我的仓库""个人素材""我上传的""之前传的视频"。发布内容前可主动调用挑选成片；返回的每个文件带可直接使用的URL。',
    parameters: {
      type: 'object',
      properties: {
        keyword: { type: 'string', description: '文件名关键词过滤（可选）' },
        type: { type: 'string', description: '类型过滤：video/image/all，默认all' },
      },
    },
  },
  {
    name: 'search_templates',
    description: '搜索提示词模板库。触发词："模板""场景""有什么可以用的"。**前缀区分："打开素材库/公共素材库"是跳转页面（open_page /media-library 或 /storage），不是搜模板——禁止调用本工具。**',
    parameters: {
      type: 'object',
      properties: {
        keyword: { type: 'string', description: '关键词' },
        category: { type: 'string', description: '分类：数字人/场景/文案/背景' },
      },
    },
  },
  {
      name: 'add_knowledge_site',
    description: '把用户给的网站 URL 加入知识库（用户说"加入知识库/收藏这个网站"时调用）。参数 url + 可选 title/desc/category。',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: '网站完整 URL' },
        title: { type: 'string', description: '站点标题（可选）' },
        desc: { type: 'string', description: '站点说明（可选）' },
        category: { type: 'string', description: '分类：提示词/素材/灵感/教程（可选）' },
      }, required: ['url'],
    },
  },
  {
    name: 'search_knowledge',
    description: '搜索知识库站点（用户问"知识库有什么/找某个方向的网站"时调用）。找到后如需要内容，再配合 crawl_web 抓取。',
    parameters: {
      type: 'object',
      properties: {
        keyword: { type: 'string', description: '关键词（标题/说明/分类）' },
        category: { type: 'string', description: '分类（可选）' },
      },
    },
  },
  {
    name: 'read_knowledge',
      description: '读取用户知识库文档（AI 智能体训练文档：产品介绍/项目说明/行业知识等）。触发词："了解我的项目""读文档""我的知识库""产品是什么"。返回文档标题+内容摘要，供回答引用。',
      parameters: { type: 'object', properties: { query: { type: 'string', description: '可选：想了解的关键词' } } },
    },
  {
      name: 'project_overview',
      description: '查看用户项目概况（绑定平台账号、素材数量、生成记录、套餐状态）。触发词："我的项目""我的账号""看看我的情况""我有什么素材""帮我了解下我的账号"。',
      parameters: {
        type: 'object',
        properties: { detail: { type: 'string', description: '可选：想要的重点（账号/素材/生成/全部）' } },
      },
    },
  {
    // [已移除]
    name: 'cancel_publish_task',
    description: '取消指定发布任务（用户说“取消任务#N/取消发布/不发了”时）。取消后客户端不再执行。只能取消自己的未完成任务。',
    parameters: { type: 'object', properties: { taskId: { type: 'number', description: '任务编号（如 7）' } }, required: ['taskId'] },
  },
  {
    name: 'query_publish_tasks',
    description: '查询发布任务状态（Agent 创建的发布任务是否已执行/成功/失败）。触发词："发布了吗""任务状态""发了没有""我的发布"。返回最近发布任务列表及状态。',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'automation_check',
    description: '查看自动化任务和定时任务状态。触发词："自动化""定时""自动发布""互关""机器人"。',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', description: 'list(查看列表) / create(创建)' },
      },
    },
  },
  {
    name: 'search_memory',
    description: '回顾与用户相关的长期记忆（偏好、品牌信息、过往约定）。触发词："你还记得""之前说的""我的偏好""上次"。',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '检索关键词' },
      },
    },
  },
  {
    name: 'upsert_memory',
    description: '把重要信息写入长期记忆，便于以后调用（用户偏好、品牌名、发布节奏、约定）。',
    parameters: {
      type: 'object',
      properties: {
        content: { type: 'string', description: '要记住的内容' },
        tags: { type: 'string', description: '逗号分隔的标签，如 偏好,品牌' },
        salience: { type: 'number', description: '重要度 0~1，默认0.5' },
      },       required: ['content'],
    },
  },
  {
    name: 'query_digital_human',
    description: '根据数字人口播任务 taskId 查询生成进度，成功后返回口播视频 URL。在调用 digital_human_speak 之后使用。',
    parameters: {
      type: 'object',
      properties: {
        taskId: { type: 'string', description: 'digital_human_speak 返回的任务ID' },
      },
      required: ['taskId'],
    },
  },
  {
    name: 'query_video_task',
    description: '根据文生视频任务ID查询生成进度，成功后返回视频 URL。在调用 generate_video 之后使用。',
    parameters: {
      type: 'object',
      properties: {
        taskId: { type: 'string', description: 'generate_video 返回的任务ID' },
      },
      required: ['taskId'],
    },
  },
  {
    name: 'collect_unmet_need',
    description: '收集用户提出但平台暂未接入的需求（如 TikTok/YouTube/微博等），记录并反馈人工客服会跟进。当用户明确要求某未接入平台/能力、或说"我要发tiktok/注册youtube"等时调用。',
    parameters: {
      type: 'object',
      properties: {
        need: { type: 'string', description: '需求简述，如 在TikTok发布内容' },
        platform: { type: 'string', description: '用户提到的平台/功能名（未接入的）' },
        detail: { type: 'string', description: '用户补充的细节（可选）' },
      },
      required: ['need', 'platform'],
    },
  },
  {
    name: 'clear_memory',
    description: '清空与该用户相关的长期记忆（用于用户说"重新定义我的画像/换行业了/你忘了我"时，先清空旧画像再重新收集）。可指定只清空某类标签。',
    parameters: {
      type: 'object',
      properties: {
        tag: { type: 'string', description: '只清空含此标签的记忆（如 画像）。留空则清空全部记忆' },
      },
    },
  },
  {
    name: 'set_agent_profile',
    description: '给用户自己的 AI 助手设定名字和性格/人设（白龙马式个性化）。当用户说"以后叫我你xx/你叫xx吧/你的人设是xx/我想给你起个名字"时调用。名字会显示在对话界面并用于自称。',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: '助手名字，如 小白、龙马、小助手' },
        persona: { type: 'string', description: '性格/人设描述（可选），如 活泼幽默、专业干练' },
      },
    },
  },
  {
    name: 'extract_video_frames',
    description: '发布前抽视频帧给用户选封面。触发词：发布流程选中视频后自动调用（如"发布XX视频"→抽帧展示）。参数 videoName（仓库文件名）。抽 4 帧（开头/1/3/结尾）→ 返回 SCENE video_frames 卡片让用户选帧；用户选帧后（"用第N帧"）再基于该帧识别画面/推荐标题/设计封面。**禁止在未抽帧看画面前凭文件名/记忆生成封面标题。**',
    parameters: {
      type: 'object',
      properties: {
        videoName: { type: 'string', description: '个人仓库视频文件名（如 20260821_001.mp4）' },
      }, required: ['videoName'],
    },
  },
  // [已移除]
]

// 思考流步骤中文标签（前端展示用）
const TOOL_STEP_LABEL: Record<string, string> = {
  generate_copy: '撰写营销文案（必须严格基于提供的主题/画面内容——不得编造主题未提及的产品/功效/场景——画面分析为空时不得编）',
  generate_image: 'AI 生成配图',
  generate_video: 'AI 生成视频',
  search_web_images: '上网搜索参考图',
  search_web: '实时搜索互联网',
  digital_human_speak: '生成数字人口播',
  query_digital_human: '查询数字人口播进度',
  search_storage: '检索项目素材库',
  list_personal_files: '读取个人仓库',
  search_templates: '查找模板',
  publish_content: '核对发布账号',
  query_publish_tasks: '查询发布任务',
  query_browser_tasks: 'query browser tasks list/progress (browser_use exec - publish/web ops) - return id/task/status/result',
  automation_check: '查看自动化任务',
  search_memory: '回忆长期记忆',
  upsert_memory: '写入长期记忆',
  collect_unmet_need: '记录未接入需求',
  clear_memory: '清空旧画像',
  set_agent_profile: '设定助手人设',
  search_trends: '搜索全球热点',
}

function buildSystemPrompt(profile?: { name?: string; persona?: string }, onboarding?: boolean): string {
  let header = `你是 AiMarketing 的 AI 运营助手，核心使命：帮用户执行自媒体运营的日常任务——每天的内容制作与发布（抖音/小红书/快手/视频号/B站）。
注意：用户的语音输入可能包含同音错字（例如「纹身视频」其实是「文生视频」、「热恋」是「热点」），请结合上下文理解真实意图后再执行，不要被错字误导。`
  if (profile?.name) {
    header = `你的名字叫「${profile.name}」，是用户的专属 AI 运营助手。用户在对话中称呼你为「${profile.name}」，你也要用这个名字自称（如开头说"我是${profile.name}"）。`
      + (profile.persona ? `你的人设/性格：${profile.persona}。` : '')
      + `\n核心使命：帮用户执行自媒体运营的日常任务——每天的内容制作与发布（抖音/小红书/快手/视频号/B站）。`
  }
  return header + (onboarding ? `

【首次摸底模式（仅本次对话生效，绝不影响后续能力）】
- 你正在和用户首次认识。先用 1~2 轮自然对话摸清他的：行业/产品、常发平台、内容形态（图文/短视频）、最想让你帮的事。
- 不要一口气抛一堆问题，像朋友聊天一样顺带问；用户回答了就调用 upsert_memory 记下（tags 含 画像，salience 0.9）。
- ⚠️ 必须真实调用 upsert_memory 工具写入记忆，**绝不能只口头说"已记住/已存入"**——只有调用工具才算真正记住。用户明确给出行业/产品/平台/偏好时，本回合就必须调用。
- 摸清后（通常 1~2 轮内），用一句自然的话收尾，必须包含类似"我已经记下你的基本情况，随时可以为你服务了"的意思，然后停止追问。
- 即使用户在摸底中说"帮我写个文案/做个视频"，你也照常调用对应能力去做，不要说"不知道/我是客服/暂不支持"这类套话——摸底和干活不冲突。
- 用户说"跳过/不用记了"就尊重，直接进入正常模式。


【助手人设设定】
- 用户可以用"你叫xx吧/给你起个名字叫xx/你的人设是xx"随时修改你的名字和性格，修改后你应立即以新名字自称，并把新名字记进长期记忆（set_agent_profile 已在背后保存）。
- 若用户没给过名字，你就是通用的「AI 运营助手」，无需强调自己没名字。

你可以直接做这些事情：
✍️ 写文案 — 各平台营销文案、脚本、标题、话题标签
🎨 AI生图 — 文生图，生成海报配图
🔍 网络搜图 — 上网帮用户找参考图/可用素材
🎬 AI视频 — 文字描述生成短视频
🤖 数字人口播 — 照片+文案生成AI主播视频（接口已打通，开通阿里 liveportrait 后即用）
🎞 一键成片 — 我理解你的意图后，帮你直接打开「一键成片」页并带入文案/配图，页面负责剪辑（你不用自己填表）
📦 项目素材库 — 平台级素材（趋势视频/图片/BGM）
🗂 个人仓库 — 用户自己上传的视频/图片（发布首选来源）
📋 模板库 — 项目内置的各种模板
📱 发布内容 — 发到5大平台（**浏览器通道执行**：你已登录的 Chrome/Edge 真发；未登录会自动打开登录页扫码；指纹页仅手动备用）
⚙️ 自动化 — 定时任务/互关/评论

【内容制作自由度】制作日常内容时你有主动权，不必等用户一步步指挥：
1. 找素材优先级：个人仓库(list_personal_files) → 项目素材库(search_storage) → 网上找(search_web_images) → AI现做(generate_image/generate_video)
2. 用户说"帮我做今天的内容/日更"这类模糊指令时，主动组合工具：查素材→写文案→配图/成片→给出发布建议，一次给出完整方案
3. 素材不合适就换下一个来源，不要卡住反问；实在缺关键信息（如产品名/平台）再问

【发布技能（2026-08-18 简化——发布是一条路，不是多轮确认）】
1. 用户说"发布/发 xx 到平台" → 确认三要素：平台、视频（仓库文件名）、文案（无文案可只用视频名作标题）
2. **发布标准流程（2026-08-21 升级，一条龙不再一路问）**：
   - 有视频（仓库名）→ **先调 extract_video_frames 抽 4 帧展示**（帧图卡片）→ 用户选帧（"用第N帧"）→ 基于该帧画面识别内容 → **自动推荐标题/话题标签 + 用该帧设计封面（IMAGE_RESULT 直接展示）——默认动作，不要问"要不要推荐封面/标题"**
- **- **“打开”区分（2026-08-30 强化——必读）**：用户说“打开XX”时，XX 是以下外部平台网页→ **必调 browser_use_execute**（AI 浏览器打开外部网页）：抖音创作者中心/creator.douyin.com、小红书创作者中心/creator.xiaohongshu.com/发布页、淘宝、京东、油管、X、任意平台官网。“小红书创作者中心”=外部网页，不是平台账号管理页。XX 是平台内页面（账号管理/我的素材/我的套餐/指纹发布/公共素材等 /accounts /storage /my-subscription /my-fingerprint /media-library）→ open_page。
- **封面生成中（2026-08-29）**：图片生成返回 IMAGE_PENDING = 封面正在后台生成（约1-3分钟）。用户问“封面好了吗”→ 调 list_personal_files 查仓库最新 ai_*.png 回复；未完成则告知“还在生成”。
- **图片链接识别（2026-08-28）**：用户推送的 oss-cn / .png / .jpg / .webp 链接 = **图片素材**（不是网页）——**禁止用 crawl_web 抓它**；发小红书/封面时直接引用为图片素材。用户说“发小红书+图片链接”→ 直接建小红书任务（图片当素材）。
   - **封面传仓库文件名（2026-08-28）**：publish_content 的 coverUrl 传**个人仓库文件名**（如 ai_xxx.png）——不传签名 URL（会过期）。图片生成后 IMAGE_RESULT 的 STORED 字段是仓库名，用它。
   - **小红书发布两条线（2026-08-28）**：本会话确认过视频（回“1”选过 videoName）→ 发小红书必须传 **videoName**（视频线，同时传封面）；只有图片→ 图文线。**回顾上下文视频名，不只看最后一条消息。**
   - **小红书发布规则（2026-08-28）**：小红书发布**必须带素材**（视频 videoName 或图片 URL）——不允许纯文字建任务。本尊会话已选过封面/抽过帧的视频，发多平台时**复用该视频名+封面**（publish_content 传 videoName + coverUrl）；无素材则先引导选视频/封面再建任务。
   - **选帧后直接出方案（2026-08-28）**：用户选帧/选完帧后，**直接输出 ②标题 3 个候选 + ③话题标签 + ④封面推荐**，严禁问“要不要推荐/确认吗”——只有视觉分析失败时才提示用户补充描述。
   - **重新分析思考链（2026-08-26）**：用户说“重新分析/再看视频/分析错了”时，**必须重新调用 extract_video_frames**（重新抽帧看原视频），不得凭旧有信息直接生成。视觉分析失败时（FRAMES_OK 中 visualDesc 为空），**不得编造画面内容**，明确告知用户“画面分析失败，请重试”。
   - **WF_JSON 红线（2026-08-31）**：WF_JSON:是系统内部协议（状态机输出）——你严禁输出/模拟 WF_JSON，严禁自己发布任务或回复“已创建/已发布”。用户要求发布时：状态机会自动处理（列视频→选择→A/B/C→建任务）——你只需回复状态机给的提示，不得跳出协议。说“直接发/执行发布”等确认话术时也不得自己发（等状态机——但若状态机未回应，回复“请说‘发布 xx.mp4 到抖音’重新开始”。
   - **发布红线（2026-08-30——自由模式同样适用）**：用户要求发布/发视频 → **必须调 browser_use_execute 建任务（唯一的发布工具）**——建任务后回复“已创建 AI 浏览器发布任务 #N”；**严禁**只回复“已发布/正在发布/已创建”而不调工具；严禁编造发布结果。查进度用 query_browser_tasks/query_publish_tasks（真实查库）。
   - 发布确认时列多平台（2026-08-28）：确认发布时加一句“同时发送：小红书 / 微博（回“全部发”同时发）”——用户回“全部发”时 publish_content 传 platforms:[抖音,小红书,微博] 同时建任务。
   - 用户确认标题/封面后 → **发布状态机会自动创建 AI 浏览器发布任务（browser_use）——你不要调任何发布工具，也不要重复建任务**
   - 例外：用户明确说"直接发布/不用封面/简单发" → 跳过抽帧，直接 publish_content
2a2. **发布工作流（V4 自己调工具，按顺序，不需要代码强制）**：用户说“发布/53d1抖音”→ 必须按此顺序自己调工具：
  - ① 第1步：**调 extract_video_frames(videoName=视频文件名) 抽帧看视频**（必须先看视频再写标题）
  - ② 第2步：基于帧容内容（画面描述）生成 标题+文案+话题（不得凭空编造画面内容）
  - ③ 第3步：展示 帧图+标题/文案 给用户确认
  - ④ 第4步：用户说“发/确认”后 调 publish_content(platform/videoName/caption) 建任务
：
  - ① **先找素材依据**：从「对话已有内容」提取 平台+视频文件名+文案——用户本次或之前消息给过文件名/文案就直接用它（对话里有就不要重新要）
  - ② **再确认存在**：必要时调 list_personal_files 确认文件在仓库（用户已给准确文件名可跳过，直接信任）
  - ③ **后定封面**：用户没指定封面→extract_video_frames 抽帧展示供选；用户说“跳过/直接发”→不抽帧
  - ④ **最后发布**：调 publish_content 建任务（platform=①提取的平台，videoName=①提取的文件名，caption=①提取的文案或文件名作标题）
  - 用户回答“确认/立即发布/跳过/可以”后→立即走④（用①已经拿到的信息建任务，不需要再问任何信息）
2a3. **发布不查历史（2026-08-27）**：用户说“发布/发抖音/发xx”时→ **直接调 publish_content 建任务（不要先查历史/不要提过去失败任务/不要说“查到之前失败”）**。历史查询（query_publish_tasks）只在用户问“查发布状态/发布了吗”时用。建任务后回复“已创建发布任务 #N，客户端自动执行”即可，不多说。
2b. **登录引导（硬规则）**：发布不需要账号登记、不需要去【账号管理】填表单——**禁止引导"去账号管理登记账号"**。正确说法："客户端会自动启动XX浏览器；若弹出登录页，扫码登录一次即可（登录态自动保存，以后直接发）"。执行时若任务失败（error 含"未找到账号/未登录"），如实引用 error 并提示扫码即可，不要引导表单登记。
3. 素材缺（没视频/没文案）→ 才问一句（"发哪个视频？文案？"）——缺哪个问哪个，不多问
4. publish_content 建任务后回固定模板："发布任务已创建（#数字）。客户端浏览器通道自动执行（你已登录的 Chrome 真发；未登录会自动打开登录页）。查进度说「查发布状态」。"
4c2. **引导 vs 执行分离（2026-08-24，铁律）**：
  - **引导**（"打开/去/进入 + 指纹浏览器/发布页/素材库/文生视频"）→ 只 open_page 跳转，**禁止**创建任务/说"正在发布"——话术"已为你打开 XX 页"
  - **执行**（"发布/发抖音/帮我发一条"）→ publish_content 建任务 → 客户端浏览器通道自动执行——话术统一"已创建发布任务，浏览器通道自动执行（你已登录的 Chrome 真发；未登录自动开登录页）；查进度说「查发布状态」"
  - **指纹浏览器 = 纯手动工具页**（矩阵号/手动发布）——AI 不操作、不自动执行；只有用户明确"打开"时才跳转
4c3. **平台能力表（2026-08-25，铁律——AI 必须按此回复，禁止瞎编）**：
  - **自动发布支持**：抖音/小红书/微博/视频号/X(Twitter)/即刻/闲鱼（浏览器通道，用户已登录 Chrome/内置浏览器真发）
  - **可登记但暂不支持自动发布**：B站/快手/其他平台（用户可登记账号（打开登录页），但自动发布暂不支持——明确告知，可引导手动发布）
  - **发布处理流程**：用户要发布到 X → ①先确认/引导登记 X（打开登录页，任何平台都能登记）②登记后：支持列表→建任务自动发；不在列表→如实"已登记但自动发布暂不支持"（不假装能发，不编造）
  - **登记方式**：客户端「🌐浏览器账号」区——点平台卡片打开内置浏览器登录（Google 登一次连带 YouTube）
4b2. **发布执行说明（2026-08-27）**：发布任务创建后由客户端自动执行（opencli 上传+提交），**不需要用户打开任何页面/不要引导用户去指纹发布页/不要叫用户手动发**。任务 pending 超过 1 分钟时提示“请确认客户端已开启并保持运行，切换到客户端查看”，不得引导去指纹页。
4c. **通道分流（2026-08-21）**：AGENT 发布**只走浏览器通道（CDP）**——抖音/小红书/微博自动发布；**快手/视频号/B站无适配器 → 提示"暂不支持自动发布"，并 [SCENE_JSON]{"type":"open_page","path":"/my-fingerprint"} 推送指纹发布页让用户手动发**（AGENT 不操作指纹，像一键成片一样只呼出）。指纹发布页=纯用户手动。

5. 多平台（"发抖音和快手"）→ platforms 数组一次建多任务
6. 版权：公共素材库/网络视频 → 提示"可能涉及版权，只能参考学习"引导修改/克隆；用户坚持 → 警告后发
【发布状态规则（硬规则）】
- **AI 无法看到执行过程**（上传中/填标题/点发布/预计时间全部看不到）——**禁止编造任何执行细节和进度**
- 只能报告 query_publish_tasks 查到的真实状态：⏳ pending / ✅ succeeded / ❌ failed
- **pending = 任务在等客户端指纹浏览器页执行**——告诉用户"任务已建好，正在等指纹浏览器页执行——请确认指纹浏览器页已打开且浏览器已启动（选账号启动）；若一直 pending 且页面已开，可能是浏览器未启动或平台未登录，看页面日志"；failed 时如实报告 error（页面会回传具体失败原因）
- 用户问"发了吗/进度" → 必须调 query_publish_tasks 查真实状态再答；不知道就说"我查一下"
- **没有自动通知/状态监听能力**——禁止说"静默轮询/完成会通知你"——只能建议"过会儿问查发布状态"
- 多轮对话中任务已创建过就不要再创建（先 query_publish_tasks 查历史）



【首次摸底模式（仅本次对话生效，绝不影响后续能力）】
- 你正在和用户首次认识。先用 1~2 轮自然对话摸清他的：行业/产品、常发平台、内容形态（图文/短视频）、最想让你帮的事。
- 不要一口气抛一堆问题，像朋友聊天一样顺带问；用户回答了就调用 upsert_memory 记下（tags 含 画像，salience 0.9）。
- ⚠️ 必须真实调用 upsert_memory 工具写入记忆，**绝不能只口头说"已记住/已存入"**——只有调用工具才算真正记住。用户明确给出行业/产品/平台/偏好时，本回合就必须调用。
- 摸清后（通常 1~2 轮内），用一句自然的话收尾，必须包含类似"我已经记下你的基本情况，随时可以为你服务了"的意思，然后停止追问。
- 即使用户在摸底中说"帮我写个文案/做个视频"，你也照常调用对应能力去做，不要说"不知道/我是客服/暂不支持"这类套话——摸底和干活不冲突。
- 用户说"跳过/不用记了"就尊重，直接进入正常模式。

` : '') + `

【助手人设设定】
- 用户可以用"你叫xx吧/给你起个名字叫xx/你的人设是xx"随时修改你的名字和性格，修改后你应立即以新名字自称，并把新名字记进长期记忆（set_agent_profile 已在背后保存）。
- 若用户没给过名字，你就是通用的「AI 运营助手」，无需强调自己没名字。

你可以直接做这些事情：
✍️ 写文案 — 各平台营销文案、脚本、标题、话题标签
🎨 AI生图 — 文生图，生成海报配图
🔍 网络搜图 — 上网帮用户找参考图/可用素材
🎬 AI视频 — 文字描述生成短视频
🤖 数字人口播 — 照片+文案生成AI主播视频（接口已打通，开通阿里 liveportrait 后即用）
🎞 一键成片 — 我理解你的意图后，帮你直接打开「一键成片」页并带入文案/配图，页面负责剪辑（你不用自己填表）
📦 项目素材库 — 平台级素材（趋势视频/图片/BGM）
🗂 个人仓库 — 用户自己上传的视频/图片（发布首选来源）
📋 模板库 — 项目内置的各种模板
📱 发布内容 — 发到5大平台（**浏览器通道执行**：你已登录的 Chrome/Edge 真发；未登录会自动打开登录页扫码；指纹页仅手动备用）
⚙️ 自动化 — 定时任务/互关/评论

【内容制作自由度】制作日常内容时你有主动权，不必等用户一步步指挥：
1. 找素材优先级：个人仓库(list_personal_files) → 项目素材库(search_storage) → 网上找(search_web_images) → AI现做(generate_image/generate_video)
2. 用户说"帮我做今天的内容/日更"这类模糊指令时，主动组合工具：查素材→写文案→配图/成片→给出发布建议，一次给出完整方案
3. 素材不合适就换下一个来源，不要卡住反问；实在缺关键信息（如产品名/平台）再问

【发布流程 v3（2026-08-18 定稿——按此流程，回复用固定模板）】
Step 0 用户说"发布 xx 视频" → 进入流程
Step 1 确认视频：用户自有（仓库/AI生成）→ 可发；公共素材库/网络 → 提示"可能涉及版权，只能参考学习"，引导修改/克隆；用户坚持 → 警告后发
Step 2 问"要我推荐封面、标题、标签吗？"（用户可跳过；跳过=平台智能封面+用户文案）
Step 3 确认参数（用户说"直接发布/随便" → 全用推荐/默认，不再问）
Step 4 publish_content 建任务（多平台传 platforms 数组一次建多个）→ **回复固定模板**：
"发布任务已创建（#数字ID）。客户端浏览器通道自动执行（你已登录的 Chrome 真发）。查进度直接说「查发布状态」。"
【发布状态规则（硬规则）】
- **AI 无法看到执行过程**（上传中/填标题/点发布/预计时间全部看不到）——**禁止编造任何执行细节和进度**
- 只能报告 query_publish_tasks 查到的真实状态：⏳ pending（等待执行）/ ✅ succeeded（已发布）/ ❌ failed（失败+原因）
- 用户问"发了吗/进度" → 必须调 query_publish_tasks 查真实状态再答；**不知道就说"我查一下"**
- 多轮对话中，任务已创建过就不要再创建（先 query_publish_tasks 查历史，避免重复建任务）
- **"已创建"必须真实**：只有 publish_content 工具真实返回 PUBLISH_QUEUED（含真实数字ID）后，才能说"发布任务已创建（#真实ID）"。**禁止**：没调工具就说"已创建"、编造任务ID（#4 之类）、工具失败还说"创建成功"。工具没调/失败 → 说"发布任务创建失败，我重新调用一下"或如实引用工具返回。
- **没有自动通知/状态监听能力**：你不能"静默轮询/主动通知"——只有用户问时才调 query_publish_tasks 查一次。禁止说"我已开启监听/完成会通知你/超时提醒"——只能建议用户"过会儿问'查发布状态'"。



【客户画像 / 需求记忆（重点能力）】
- 你擅长像资深运营顾问一样，逐步摸清并记住客户的生意：行业/产品、目标平台与人群、内容风格偏好、预算节奏、常做的内容类型。
- 在对话中自然收集关键信息，当确认到客户的行业、产品、偏好、常发平台、目标人群等稳定信息时，主动调用 upsert_memory 记下来（tags 用 画像/偏好/行业/平台 等），salience 设高（0.8~1.0）。
- 客户问"你还记得我吗/我是什么行业"时，先 search_memory 调出画像再回答，让客户感到"你真的懂他"。
- 记画像不要打断主任务：完成当前请求后，顺带把新确认的信息写进记忆即可。

【热点驱动选题（像白龙马一样主动）】
- 系统会在对话开头注入【今日热点上下文】（来自 vvhan/微博/抖音/知乎/小红书/HackerNews/Reddit 等）。
- 当用户点热点卡片、或说"今天发什么/给我个选题/日更内容"等模糊指令时，直接结合热点上下文给 2~3 个具体选题方向（带标题+文案要点+建议用哪个工具做），不要空泛、不要先反问"你是做什么的"——热点本身就是素材，先出方案再说。
- **热榜结合规则（2026-08-26）**：发视频/推荐封面/推荐标题时，热榜必须与视频实际画面（visualDesc）相关；只有生成新闻/泛内容时才可直接用热点话题。禁止将与视频无关的热榜硬套进文案。
- 如果用户行业不在热点里覆盖，可在出完方案后顺带问一句"你主要做哪个行业，我记一下以后更精准"，但绝不要阻塞出方案。

【一键成片（唤起页面，不代跑）】
- 你不直接执行一键成片剪辑。当用户要"把这段文案做成片/剪个视频"，你理解意图后，用 [SCENE_JSON]{"type":"open_page","path":"/auto-compile","params":{...}}[/SCENE_JSON] 让前端直接打开一键成片页并带入文案/配图参数，页面负责剪辑。
【网页抓取（crawl_web，2026-08-13）】
- **硬规则：用户消息中出现 http:// 或 https:// 链接（或说"看看这个网页/这个链接/竞品/这个文章"）时，必须无条件调用 crawl_web**——**不要先凭常识判断链接是否有效/是否示例域名/是否有内容——抓了才知道**。
- 抓取后：有内容 → 按用户目的提炼；**无内容/失败（CRAWL_FAIL/CRAWL_EMPTY）→ 必须原样告诉用户"抓取失败/该页面无可提取文本"并停止**。
- **【硬规则】严禁编造：绝不可以用自己的知识/猜测冒充抓取结果**（如"根据抓取，该网站有XX"）。抓取失败就说失败，可以建议用户换网址或换搜索引擎（search_web），**但绝不能编造网页内容/热点/新闻冒充真实抓取**。
- **抓取成功时也只描述抓取文本里实际出现的内容**；抓取文本没有的具体事件/数据/人物/新闻，**禁止编造**（如页面只显示栏目名，就说明"页面显示XX栏目，具体内容需点进子页"，不要说"XX事件最新进展"）。
- 抓取失败/页面无文本（视频页/需登录/动态加载）时，如实告诉用户"抓取失败/无文本"，并给出建议（换 URL/该站需登录）。
- 抓取成功后，按用户目的提炼（总结/提取价格/竞品分析/文案素材），不要原样堆砌全部文本。

【诚实红线（硬规则，违反=严重错误）】
1. **禁止编造品牌/店名/产品名**：用户没告诉过的事实（店名、地址、产品、预算）——绝不替用户设定。需要这些信息时明确问用户。
2. **禁止编造生成结果细节**：生图/生视频/成片完成后只报：尺寸、模型、文件、消耗点数——禁止编造画面细节（"末帧0.5秒黑场""拉花细腻到奶泡微弧"这类描述一律禁止——你没看过生成结果）。
3. **禁止编造模板/库字段**：search_templates/素材库返回什么就引用什么——禁止编造"模板关键词"等不存在的字段。
4. **画像必须用户确认**：你从对话推断的用户偏好——先列清单让用户确认（"我理解的你是：……对吗？"），用户确认后才 upsert_memory 保存。禁止自动把推断当事实存记忆。
5. **无法执行/无法确认**：明确说"这个我无法直接完成（原因）+ 替代方案或入口"，或"我无法确认这个信息（不在系统里），请你提供 X"。禁止假装"已执行/已生成/已发布"。
5b. **工具返回原文引用**：工具返回的任务 ID/链接/数字必须**原文照抄**（如"任务 #123"）——**禁止改写/编造 ID 格式**（如编造 pub_xhs_xxxx 这类数据库里不存在的格式）、禁止补充工具没返回的"已唤起/已预填/已跳转"等状态。
6. **粘贴 prompt = 生成意图**：用户粘贴一段英文提示词/素材卡片内容 = 想用这个生成——识别并执行（用该 prompt 生成图/视频），不要教育用户"与你的业务不匹配"。
7. **生成结果直接给内容（硬规则）**：生图/生视频/数字人完成后，**必须**在回复中输出 IMAGE_RESULT:URL|TITLE:标题 或 VIDEO_RESULT:URL|TITLE:标题 或 DH_RESULT:URL|TITLE:标题 格式（前端直接渲染图片/播放视频）。**禁止**：写成 Markdown 链接格式、说"点击查看/链接直达/下载地址"、把 URL 单独贴出来——图片就是图片卡片、视频就是视频播放，用户直接看到内容。仅"外部资源推荐"（竞品网页/参考素材站）可用链接。
8. **不暴露后台**：你是普通用户助手——功能范围只有用户页面（/agent /ai-copy /image-generator /text-to-video /auto-compile /digital-human /media-library /music-library /storage /my-fingerprint /my-subscription /team /projects /dashboard 等）——永不提到/跳转 /admin 后台、不暴露服务器地址/后台库路径。

【生成流程 v2（硬规则——用户提生成需求时必须走）】
1. 用户提"做海报/生成图/做视频/生成视频"等需求 → **先调 search_templates 搜公共素材库**（关键词=需求主题）推荐给用户（素材标题+类型）。
2. 用户**选中某个素材/模板** → 用该素材的 prompt 调 generate_image / generate_video 生成（prompt 直接用素材内容，不要重写）。
3. **搜不到匹配素材** → **出 2-3 个候选提示词**（差异化风格 + 模型 + 预估点数，如"① 电影感暖调（FLUX 3，12点）② 极简留白（FLUX 3，12点）"）→ 用户选 → 用选中的生成。
4. **禁止**：用户没确认就直接生成（生视频必须 confirmed；生图用户选了候选才算确认）。生成后只报尺寸/模型/文件/点数。

【open_page 边界（硬规则—2026-08-30 强化）】
- open_page 只能跳转下表内部页面——下表没有的路径（如“小红书创作者中心”“抖音创作者中心”“淘宝”“油管”等外部平台网页）→ **禁止 open_page（跳转会错）——必调 browser_use_execute**（AI 浏览器打开外部网页）。
- 账号管理页 /accounts 、指纹发布页 /my-fingerprint 已从 AGENT 跳转中撤回（不在路径表）——用户说“打开账号管理”→ 提示手动进（卡片/菜单），不跳转。
【open_page 边界（硬规则）】
- open_page 只能跳转内部页面（见下表路径）——**不能带入/预填第三方平台发布内容**（视频/文案/标签都不会自动填入）
- **禁止承诺"已打开发布页并预填内容"**——发布靠任务自动执行（见发布规则），不靠跳转
- 用户要看发布队列/执行情况 → open_page /my-fingerprint（页面自己轮询任务并自动执行）

【"打开/跳转"前缀硬规则（最高优先，先判前缀再判意图）】
- 用户消息以「打开/跳转/进入/去/带我去/看下」+ 功能名开头 = **意图跳转页面**——直接输出 open_page（按下方映射表选 path），**禁止调用任何生成/搜索/发布/查询工具、禁止推荐素材、禁止讨论内容、禁止报价**。
- **"打开XX"≠"生成XX"**（关键区分）："打开文生视频"≠"生成视频"、"打开AI生图"≠"生成图片"、"打开一键成片"≠"做一条视频"、"打开数字人"≠"生成数字人口播"、"打开AI文案"≠"写文案"、"打开发布/指纹浏览器"≠"发布内容"、"打开素材库"≠"搜素材/推荐模板"。
- 只有用户**明确**说「生成/做/制作/写/帮我做个/帮我生成 + 内容」才调用对应生成工具。
- 若用户"打开XX"后**紧跟内容指令**（如"打开文生视频，帮我生成一个奶茶广告"）→ 先 open_page 跳转，再按内容指令执行（此时才允许调生成工具）。

【功能页面路径映射（open_page 必须按此表选 path）】
- 一键成片/做成片/剪成片 → /auto-compile
- 文生视频/AI视频 → /text-to-video
- AI文案/写文案 → /ai-copy
- 素材库/个人仓库/素材仓库/我的素材/打开仓库 → /storage
  # [已撤回 2026-08-30] 指纹发布页 AGENT 不跳转（用户手动从卡片/指纹账号中心进）
- 数据看板/仪表盘 → /dashboard
# [已撤回] 账号管理 /accounts 不在路径表（AGENT 不跳账号页）
- AI生图/生成图片 → /image-generator
- 视频剪辑/后期处理/配音字幕 → /video-edit
- 我的套餐/套餐/充值/购买点数 → /my-subscription
- 数字人/AI主播/口播/数字人播报 → /digital-human
- 账号管理/我的账号/绑定账号 → /accounts
- 音乐库/BGM/配乐/背景音乐 → /music-library
- 公共素材库/素材库 → /media-library
- 文生视频(generate_video) 必须先报价（首次调用只返回预估，不带 confirmed），用户确认后才带 confirmed=true 生成；用户明确说"直接生成/马上生成/不用问"时可直接带 confirmed=true。文生视频、数字人口播(digital_human_speak) 是异步任务，会返回 taskId，返回后提示"正在生成中，稍后可问我进度"。

【异步任务处理】
- 文生视频(generate_video)、数字人口播(digital_human_speak) 都是异步任务，会返回 taskId。
- 返回 taskId 后，告诉用户"正在生成中，稍后你可以问我进度，或我再帮你查"，并可用对应 query_ 工具轮询结果。不要在本次回复里空等。

【场景卡片类型（阶段1：回复中可输出 [SCENE_JSON]{...}[/SCENE_JSON] 渲染原生卡片）】
- {"type":"image","title":"标题","url":"图片地址","desc":"说明"} —— 图片卡片（二维码/生成图）
- {"type":"video","title":"标题","video":{"url":"视频地址","poster":"封面(可选)"},"desc":"说明"} —— 视频卡片（成片/下载的视频）
- {"type":"confirm","title":"确认标题","desc":"说明","confirm":{"label":"按钮文字","prompt":"点击后发给我的指令"}} —— 确认卡片（征求用户确认，点击后 prompt 会作为下一条用户消息发回）
- {"type":"link","title":"标题","link":{"url":"https://外链"},"desc":"说明"} —— 外链卡片（系统浏览器打开）
- {"type":"task","title":"任务名","task":{"status":"状态文字","progress":0.6}} —— 任务进度卡片（progress 0~1）
- {"type":"open_page","path":"/页面路径","params":{...}} —— 唤起项目内页面
- {"type":"service_qrcode","title":"扫码联系客服","desc":"说明"} —— 客服二维码（系统自动填图）
- 用场景卡片把重要结果可视化（图片/视频/链接/确认），比纯文字更清晰；每轮最多 1 张卡片。

规则：简洁专业、适度emoji、中文回复、不啰嗦、不说"你不能"而是给替代方案

【当前日期（重要，写日期/时间必须用这个，禁止用训练知识里的旧日期）】
今天是 ${new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' })}（${new Date().getFullYear()}年${new Date().getMonth() + 1}月${new Date().getDate()}日）。引用新闻/热点/日期时必须基于此。

【未接入需求收集（重要）】
- 我们只接入了 5 个平台：抖音、小红书、快手、视频号、B站。如果客户提出 TikTok、YouTube、微博、Instagram、Facebook、X(Twitter)、淘宝、京东 等我们暂未接入的平台/能力，不要说"我不支持"就结束。
- 正确做法：调用 collect_unmet_need 工具记录该需求（平台+简述），然后回复："已记录你的需求：在{平台}上{做什么}。目前该平台还在接入中，我帮您登记了，人工客服会尽快与你联系～"
- 紧接着用场景卡片把客服微信二维码推给用户：在回复中输出 [SCENE_JSON]{"type":"service_qrcode","title":"扫码联系客服","desc":"人工客服会尽快与你联系"}[/SCENE_JSON]（二维码图由系统自动填充，你无需写URL）。
- 如果客户主动说"跳过/算了/不用了/先不用"，立即停止收集，转去聊别的，不要纠缠。

【多步任务编排（C4 全链路）】
- 用户一句话要完成整条链路时（如"追这个热点做个视频发抖音"），分步执行，每步说明进度：
  1. 追热点：用 search_trends 或结合已给热点，选 1 个最适合用户行业的选题
  2. 出文案：generate_copy 生成标题+正文+话题
  3. 做成片：用 [SCENE_JSON]{"type":"open_page","path":"/auto-compile","params":{"script":"文案"}} 打开一键成片页带入文案
  4. 发布：确认视频做好后，用 publish_content 创建发布任务（需用户确认视频文件在素材仓库并告知文件名）
- 步骤间不要跳步；用户打断时停下问下一步。单条消息最多推进 1-2 步，避免过长。

【了解项目（C3）】
- 用户问"我的项目/我的账号/看看我的情况/我有什么素材/帮我了解账号"时，先调用 project_overview 工具查看概况（绑定平台/素材/AI生成/套餐点数），再基于数据回答，不要凭空说。
- 结合概况给建议：有素材没账号→引导绑定；有账号没内容→推荐追热点出片；账号少→建议多平台。

【知识库（C3 增强）】
- 用户问"了解我的项目/产品/公司/业务/知识库"时，先调用 read_knowledge 读取训练文档，基于文档内容回答（引用文档观点），不要凭空说。
- 文档内容可帮助回答业务/产品问题；文档为空时引导用户到「AI 智能体」页上传。

【重新定义画像】
- 客户说"重新定义我的画像/换行业了/你忘了我/重新来过"时：先调用 clear_memory（tag=画像）清空旧画像，再像新用户一样重新问几个关键问题（行业/产品/常发平台/风格偏好），用 upsert_memory 重新记录。
- 客户问"你还记得我吗/我是什么行业"时，先 search_memory 调出画像再回答。

【收集时的分寸】
- 用户明确说"跳过"任何收集步骤，都尊重并继续；不要反复追问同一信息。
- 记画像不要打断主任务：完成当前请求后，顺带把新确认的信息写进记忆即可。`
}

// ==================== 工具执行器 ====================

async function executeToolCall(name: string, args: Record<string, any>, auth: any): Promise<string> {
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || ''

  switch (name) {
    // ── 文案 ──
    case 'generate_copy': {
      const product = args.product || '产品'
      const platform = args.platform || '多平台'
      const style = args.style || '专业'
      const p = `为"${product}"生成${platform}营销文案，风格${style}。吸引眼球有卖点。输出3条，用【文案1】【文案2】【文案3】标记。`
      const copyRaw = (await generateText(p)) || ''
      if (copyRaw && copyRaw !== '文案生成暂不可用') {
        try {
          const uidC = auth?.userId
          if (uidC) {
            const cKey = 'storage/' + uidC + '/copy_' + Date.now() + '.txt'
            await putObject(cKey, Buffer.from(copyRaw, 'utf8'), 'text/plain')
            console.log('[generate_copy] 文案已转存:', cKey)
            return copyRaw + String.fromCharCode(10, 10) + '[OK] 已存入个人仓库: copy_' + cKey.split('_').pop()
          }
        } catch (eCp) { console.error('[generate_copy] 转存失败:', eCp?.message || eCp) }
      }
      return copyRaw || '文案生成暂不可用'
    }

    // ── 图片（#2 2026-08-12: 工具前移扣费——执行前 check，成功后 spend）──
    case 'generate_image': {
      const uid = auth?.userId
      if (!uid) return 'TOOL_REJECT:未登录'
      // 2026-08-29: featureCode 对齐——周卡/套餐 paidFeatures 写入 'image-generator'（之前查 'generate_image' 永远不匹配→'需要充值'）
      const gChk = await checkFeatureAccess(uid, 'image-generator')
      if (!gChk.allowed) return `TOOL_REJECT:${gChk.message}`
      const gCost = 12
      // 2026-08-29: 异步化——提交即返回（长轮询被网络层掐→"网络连接失败"）；后台轮询+转存
      const sub = await dashscopeGenerateImageAsync(String(args.prompt || 'AI生成图片'), String(args.size || '1280*1280').replace(/\*/g, 'x'))
      if (!sub?.taskId) return '图片生成失败（提交被拒）——请稍后重试'
      pendingImages.set(uid, { taskId: sub.taskId, ts: Date.now(), done: false })
      // 后台轮询（不阻塞 chat）——完成转存 OSS + 入仓库
      ;(async () => {
        try {
          const deadline = Date.now() + 240000
          while (Date.now() < deadline) {
            await new Promise((r2) => setTimeout(r2, 5000))
            const q = await fetch('https://dashscope.aliyuncs.com/api/v1/tasks/' + sub.taskId, { headers: { 'Authorization': 'Bearer ' + process.env.DASHSCOPE_API_KEY } }).then((r3) => r3.json()).catch(() => null)
            const img = q?.output?.choices?.[0]?.message?.content?.[0]?.image
            const st = q?.output?.task_status || q?.task_status
            if (img) {
              const imgBuf = Buffer.from(await (await fetch(img, { signal: AbortSignal.timeout(60000) })).arrayBuffer())
              const imgKey = 'storage/' + uid + '/ai_' + Date.now() + '.png'
              await putObject(imgKey, imgBuf, 'image/png')
              const url = await signedUrl(imgKey, 86400)
              await prisma.mediaAsset.create({ data: { title: String(args.prompt || 'AI生成图片').slice(0, 30), ossUrl: url, type: 'image', prompt: String(args.prompt || '').slice(0, 200), category: 'AI生成', source: 'private', ownerId: uid, orientation: 'landscape' } }).catch(() => {})
              pendingImages.set(uid, { taskId: sub.taskId, ts: Date.now(), url, fileName: imgKey.replace('storage/' + uid + '/', ''), done: true })
              console.log('[生图异步] 完成转存:', imgKey)
              break
            }
            if (st === 'FAILED' || st === 'UNKNOWN') { pendingImages.set(uid, { taskId: sub.taskId, ts: Date.now(), done: true }); break }
          }
        } catch (eBk) { console.error('[生图异步] 后台轮询异常:', eBk?.message || eBk) }
      })()
      return 'IMAGE_PENDING:封面生成中（约1-3分钟）——生成后自动存入个人仓库，稍后说"封面好了吗"我会帮你查'
    }

    // ── 视频 ──
    case 'generate_video': {
      const gvDuration = parseInt(args.duration) || 5
      const gvPrompt = args.prompt || '产品展示'
      const gvRatio = args.ratio || '16:9'
      const gvCost = Math.ceil(gvDuration * 100) // 100 点/秒
      // A2 成本确认：未确认只报预估
      if (!args.confirmed) {
        return `VIDEO_COST_ESTIMATE:时长${gvDuration}秒 × 100点/秒 = ${gvCost}点（约¥${(gvCost / 100).toFixed(1)}）。请先向用户明确报价并等确认（用户说"确认/生成吧/可以"等即视为确认），确认后再次调用本工具并带 confirmed=true 才开始生成。${gvDuration > 15 ? '（超过15秒将自动分段拼接，每段用上一段尾帧做参考保证衔接，费用按总时长计）' : ''}`
      }
      // A1: >15s 走长视频拼接（首尾帧接力）
      // #2 扣费：执行前 check（confirmed 后才真正生成）
      const uid2 = auth?.userId
      if (!uid2) return 'TOOL_REJECT:未登录'
      const gvChk = await checkTokens(uid2, gvCost)
      if (!gvChk.allowed) return `TOOL_REJECT:${gvChk.message}`
      if (gvDuration > 15) {
        const segModel = args.segModel === 'wan2.7-t2v' ? 'wan2.7-t2v' : undefined // 缺省用引擎默认
        const lv = await generateLongVideo([gvPrompt], gvDuration, '720P', gvRatio, undefined, 5, segModel)
        if (lv?.videoUrl) { await spendTokens(uid2, gvCost, 'agent_generate_video'); return `VIDEO_RESULT:${lv.videoUrl}|DURATION:${gvDuration}s|COST:${gvCost}点` }
        return '长视频生成失败（分段模型可能不可用，可重试或换 wan2.7-t2v）'
      }
      const result = await generateVideo(gvPrompt, gvDuration, '720P', gvRatio)
      if (result?.taskId && result.status === 'running') {
        // 2026-08-24: 生成即落库（可追踪/断网可恢复）
        // 2026-08-26 B方案：提交不扣——成片成功（query_video_task 查到成功）才扣
        try { await createRecord({ userId: uid2, type: 'text2video', prompt: gvPrompt, costPoints: gvCost, platformTaskId: String(result.taskId) }) } catch {}
        return `VIDEO_TASK:${result.taskId}|PROMPT:${gvPrompt}|COST:${gvCost}点（成片完成后扣费）`
      }
      if (result?.videoUrl) { await spendTokens(uid2, gvCost, 'agent_generate_video'); return `VIDEO_RESULT:${result.videoUrl}|COST:${gvCost}点` }
      return '视频生成暂不可用'
    }

    // ── 分镜协议（A3）──
    case 'generate_storyboard': {
      const sbDuration = Math.min(180, parseInt(args.duration) || 30)
      const sbRatio = args.ratio || '16:9'
      const sbShots = Math.max(2, Math.ceil(sbDuration / 5))
      const sbCost = Math.ceil(sbDuration * 100)
      const sbPrompt = `你是短视频分镜导演。根据主题「${args.topic || ''}」生成 ${sbShots} 个镜头的分镜脚本（总时长约${sbDuration}秒，每镜约5秒，${sbRatio}画面）。只输出 JSON 数组（不要任何其它文字或代码块标记），每镜对象：{shot:序号, desc:"中文画面描述", prompt:"英文视频生成提示词，含主体/动作/场景/光影/运镜，80词内", duration:5, camera:"镜头感（如推近/航拍/慢动作）"}。风格要求：${args.style || '通用写实'}。`
      const sbRaw = await generateText(sbPrompt)
      if (!sbRaw) return '分镜生成失败，请稍后重试'
      const m = sbRaw.match(/\[[\s\S]*\]/)
      if (!m) return '分镜格式异常，请重试'
      return `STORYBOARD:${m[0]}|TOTAL:${sbDuration}秒|SHOTS:${sbShots}|COST:${sbCost}点（约¥${(sbCost / 100).toFixed(1)}）。分镜仅供确认：请向用户展示并确认费用，确认后调用 create_storyboard_task 创建任务（后台逐镜生成）。`
    }

    // ── 一句话成片（二期B）──
    case 'create_ai_video': {
      const avDuration = Math.min(180, parseInt(args.duration) || 30)
      const avRatio = args.ratio || '16:9'
      const avCost = Math.ceil(avDuration * 100)
      if (!args.confirmed) {
        return `AI_VIDEO_COST:时长${avDuration}秒 × 100点/秒 = ${avCost}点（约¥${(avCost / 100).toFixed(1)}）。请向用户报价并等确认（用户说"确认/生成吧/可以"即确认），确认后带 confirmed=true 自动分镜并创建任务。`
      }
      // #2 扣费：confirmed 后执行前 check，建任务成功后 spend
      const uid3 = auth?.userId
      if (!uid3) return 'TOOL_REJECT:未登录'
      const avChk = await checkTokens(uid3, avCost)
      if (!avChk.allowed) return `TOOL_REJECT:${avChk.message}`
      // 2026-08-26 B方案：提交不扣——成片成功（query_storyboard 查到 videoUrl）才扣
      // 分镜：调 LLM 出分镜 JSON
      const avShots = Math.max(2, Math.ceil(avDuration / 5))
      const avPrompt = `你是短视频分镜导演。根据主题「${args.topic || ''}」生成 ${avShots} 个镜头的分镜脚本（总时长约${avDuration}秒，每镜约5秒，${avRatio}画面）。只输出 JSON 数组（不要任何其它文字或代码块标记），每镜对象：{shot:序号, desc:"中文画面描述", prompt:"英文视频生成提示词，含主体/动作/场景/光影/运镜，80词内", duration:5, camera:"镜头感"}。风格：${args.style || '通用写实'}。`
      const avRaw = await generateText(avPrompt)
      const avMatch = avRaw ? avRaw.match(/\[[\s\S]*\]/) : null
      if (!avMatch) return '自动分镜失败，请用 generate_storyboard 手动分镜或重试'
      let avShotsArr = []
      try { avShotsArr = JSON.parse(avMatch[0]) } catch { return '分镜 JSON 解析失败' }
      if (!Array.isArray(avShotsArr) || avShotsArr.length === 0) return '分镜为空'
      // 建任务
      const { PrismaClient } = await import('@prisma/client')
      const p4 = new PrismaClient()
      const normalized = avShotsArr.map((s: any, i: number) => ({
        shot: s.shot ?? (i + 1), desc: s.desc || '', prompt: s.prompt || '', duration: Math.min(5, Math.max(2, parseInt(s.duration) || 5)),
        camera: s.camera || '', status: 'pending', videoUrl: null, error: null,
      }))
      const task = await p4.storyboardTask.create({
        data: { userId: auth?.userId || 0, title: (args.topic || '').substring(0, 80), topic: args.topic || '',
          ratio: avRatio, style: args.style || null, duration: avDuration, shots: JSON.stringify(normalized),
          status: 'pending', totalShots: normalized.length, costPoints: avCost },
      })
      // 2026-08-26 B：不再提交扣（query_storyboard 完成扣）
      const mod = await import('../storyboard/route')
      mod.runShots(task.id, normalized, avRatio).catch(e => console.error('[Storyboard]', e))
      return `AI_VIDEO_TASK:${task.id}|SHOTS:${normalized.length}|COST:${avCost}点（约¥${(avCost / 100).toFixed(1)}）。已自动分镜并开始后台生成，约每镜1-3分钟，可随时问我进度。`
    }

    // ── 分镜任务（A4）──
    case 'create_storyboard_task': {
      const { PrismaClient } = await import('@prisma/client')
      const p2 = new PrismaClient()
      const sbShots = Array.isArray(args.shots) ? args.shots : []
      if (sbShots.length === 0) return '缺少分镜数组'
      const ratio = args.ratio || '16:9'
      const duration = parseInt(args.duration) || sbShots.reduce((s: number, x: any) => s + (parseInt(x.duration) || 5), 0)
      const costPoints = Math.ceil(duration * 100)
      const normalized = sbShots.map((s: any, i: number) => ({
        shot: s.shot ?? (i + 1), desc: s.desc || '', prompt: s.prompt || '', duration: Math.min(5, Math.max(2, parseInt(s.duration) || 5)),
        camera: s.camera || '', status: 'pending', videoUrl: null, error: null,
      }))
      // #2 扣费：创建前 check，成功后 spend
      const uid4 = auth?.userId
      if (!uid4) return 'TOOL_REJECT:未登录'
      const sbChk = await checkTokens(uid4, costPoints)
      if (!sbChk.allowed) return `TOOL_REJECT:${sbChk.message}`
      const task = await p2.storyboardTask.create({
        data: { userId: auth?.userId || 0, title: (args.topic || '').substring(0, 80), topic: args.topic || '',
          ratio, style: args.style || null, duration, shots: JSON.stringify(normalized), status: 'pending',
          totalShots: normalized.length, costPoints },
      })
      await spendTokens(uid4, costPoints, 'agent_storyboard')
      const mod = await import('../storyboard/route')
      mod.runShots(task.id, normalized, ratio).catch(e => console.error('[Storyboard]', e))
      return `STORYBOARD_TASK:${task.id}|SHOTS:${normalized.length}|COST:${costPoints}点（约¥${(costPoints / 100).toFixed(1)}）。已开始后台逐镜生成，请告知用户任务已创建、约每镜1-3分钟，可随时问进度。`
    }
    case 'query_storyboard': {
      const { PrismaClient } = await import('@prisma/client')
      const p3 = new PrismaClient()
      const tid = parseInt(args.id || '0')
      if (!tid) return '缺少任务ID'
      const task = await p3.storyboardTask.findFirst({ where: { id: tid, userId: auth?.userId || 0 } })
      if (!task) return '任务不存在'
      const shots = JSON.parse(task.shots || '[]')
      const progress = shots.map((s: any) => `${s.shot}镜:${s.status === 'done' ? '✅' : s.status === 'failed' ? '❌' : '⏳'}${s.error ? '(' + s.error + ')' : ''}`).join(' ')
      const base = `分镜任务#${task.id} 状态:${task.status} 完成:${task.doneShots}/${task.totalShots} ${progress}`
      // 2026-08-26 B方案：成片出现才扣费（收到成片后扣）；costPoints 扣完置 0 防重复
      if (task.videoUrl && task.costPoints > 0) {
        try { await spendTokens(task.userId, task.costPoints, 'agent_video_complete'); await p3.storyboardTask.update({ where: { id: tid }, data: { costPoints: 0 } }) } catch (e6) { console.error('[charge] 成片扣费失败:', e6) }
      }
      return task.videoUrl ? `${base} 成品:${task.videoUrl}` : `${base}（未完成/无成品，可稍后问我或重试失败镜）`
    }

    // ── 网络搜图 ──
    case 'search_web_images': {
      try {
        const res = await fetch(`${baseUrl}/api/search-images?keyword=${encodeURIComponent(args.keyword)}&limit=${args.count || 3}`)
        const data = await res.json()
        if (data.success && data.data?.length) {
          return `IMAGE_LIST:${JSON.stringify(data.data.slice(0, args.count || 4).map((i: any) => ({ url: i.url, title: i.title || '' })))}`
        }
        return '未找到相关图片，换个关键词试试？'
      } catch { return '网络搜图暂不可用' }
    }

    case 'search_web': {
      try {
        const sk = process.env.SERPER_API_KEY
        if (!sk) return '未配置搜索服务（SERPER_API_KEY），请管理员在后台设置后重试'
        const q = String(args.query || '').slice(0, 200)
        const type = args.type === 'videos' || args.type === 'news' ? args.type : 'web'
        const hasCJK = /[一-鿿]/.test(q)
        const body: Record<string, any> = { q, num: 5, hl: hasCJK ? 'zh-cn' : 'en', gl: hasCJK ? 'cn' : 'us' }
        if (type !== 'web') body.type = type
        const res = await fetch('https://google.serper.dev/search', {
          method: 'POST',
          headers: { 'X-API-KEY': sk, 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(15000),
        })
        if (!res.ok) return '搜索服务暂时不可用（HTTP ' + res.status + '）'
        const data = await res.json()
        if (type === 'videos') {
          const vs = (data.videos || []).slice(0, 5).map((v: any) => ({ title: v.title || '', url: v.link || '', channel: v.channel || '', duration: v.duration || '' }))
          if (!vs.length) return '没有搜到相关视频'
          return 'VIDEO_WEB:' + JSON.stringify(vs)
        }
        if (type === 'news') {
          const ns = (data.news || []).slice(0, 5).map((n: any) => ({ title: n.title || '', url: n.link || '', source: n.source || '', date: n.date || '' }))
          if (!ns.length) return '没有搜到相关新闻'
          return 'NEWS:' + JSON.stringify(ns)
        }
        const ws = (data.organic || []).slice(0, 5).map((r: any) => ({ title: r.title || '', url: r.link || '', snippet: r.snippet || '' }))
        if (!ws.length) return '没有搜到相关内容'
        return 'WEB_RESULT:' + JSON.stringify(ws)
      } catch (e: any) {
        return '搜索失败：' + (e?.message || '网络错误')
      }
    }

    // ── 数字人口播 ──
    case 'crawl_web': {
      const crawlUrl = String(args.url || '').trim()
      if (!/^https?:\/\//.test(crawlUrl)) return 'CRAWL_INVALID:URL 无效（仅支持 http/https 链接）'
      const { crawlWeb, crawlScreenshot, isBlockedCrawlUrl } = await import('@/lib/crawl4ai')
      if (isBlockedCrawlUrl(crawlUrl)) return 'CRAWL_FAIL:目标地址不允许访问（内网/保留地址）'
      // 2026-08-14 C 方案：vision=true 时截图+视觉模型读图（需用户先确认，扣 20 点）
      if (args.vision === true) {
        const uidV = auth?.userId
        if (!uidV) return 'TOOL_REJECT:未登录'
        const VISION_COST = 20
        const vChk = await checkTokens(uidV, VISION_COST)
        if (!vChk.allowed) return `TOOL_REJECT:${vChk.message}`
        try {
          const shot = await crawlScreenshot(crawlUrl)
          if (!shot.ok || !shot.base64) return 'CRAWL_FAIL:' + (shot.error || '截图失败')
          const { describeImageWithVL } = await import('@/lib/ai-providers')
          const desc = await describeImageWithVL(shot.base64, args.purpose ? `用户想看：${args.purpose}。请用中文描述这张网页截图的主要内容和关键信息（只描述图中可见的）。` : undefined)
          if (!desc) return 'CRAWL_FAIL:视觉模型读图失败'
          await spendTokens(uidV, VISION_COST, 'agent_crawl_vision')
          return `CRAWL_VISION_RESULT:${desc.substring(0, 8000)}|URL:${crawlUrl}`
        } catch (e: any) {
          return 'CRAWL_FAIL:' + (e?.message || '截图读图异常')
        }
      }
      try {
        const cr = await crawlWeb(crawlUrl)
        if (!cr.ok) return 'CRAWL_FAIL:' + (cr.error || '抓取失败')
        if (!cr.markdown) return 'CRAWL_NEED_VISION:该页面没有可提取的文本内容。可用「截图+AI视觉扫描」查看整页（约20点/次）。请先向用户确认是否使用，用户同意后再调用本工具并带 vision:true 参数。'
        const purpose = args.purpose ? `。抓取目的：${args.purpose}` : ''
        return `CRAWL_RESULT:${cr.markdown.substring(0, 15000)}|URL:${crawlUrl}${purpose}`
      } catch (e: any) {
        return 'CRAWL_FAIL:' + (e?.message || '抓取异常')
      }
    }

    case 'digital_human_speak': {
      const text = (args.text || '').trim()
      if (!text) return '请提供口播文案内容'
      const avatarId = args.avatarId
      if (!avatarId) return 'DH_NEED_AVATAR:请先指定数字人形象ID（去「数字人」页查看已创建形象）。也可以先让我用 generate_image 生成一张形象照，再去数字人页创建形象。'
      try {
        const res = await fetch(`${baseUrl}/api/digital-human`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${auth?.userId}` },
          body: JSON.stringify({ action: 'avatar-speak', avatarId, text }),
        })
        const data = await res.json()
        if (data.success && data.taskId) return `DH_TASK:${data.taskId}|TEXT:${text.substring(0, 50)}`
        return `DH_NEED_AVATAR:${data.message || '数字人口播创建失败'}`
      } catch (e: any) {
        return `DH_NEED_AVATAR:数字人口播接口调用失败（${e.message}）`
      }
    }

    // ── 数字人任务进度查询 ──
    case 'query_digital_human': {
      const taskId = args.taskId
      if (!taskId) return '缺少 taskId'
      try {
        const res = await fetch(`${baseUrl}/api/digital-human`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${auth?.userId}` },
          body: JSON.stringify({ action: 'query', taskId }),
        })
        const data = await res.json()
        if (data.avatarUrl) return `DH_RESULT:${data.avatarUrl}`
        return `DH_PROGRESS:${data.status || '处理中'}|TASK:${taskId}`
      } catch { return `DH_PROGRESS:查询失败|TASK:${taskId}` }
    }

    // ── 一键成片进度查询（AGENT 不主动发起一键成片，仅当用户从一键成片页带参数回来问进度时查询）──
    case 'query_video_task': {
      const taskId = args.taskId
      if (!taskId) {
        // 2026-08-23: 用户问"最近任务进度"无 ID——查最近 5 条生成任务返回状态
        try {
          const recent = await prisma.videoTask.findMany({
            where: { userId: auth?.userId },
            orderBy: { createdAt: 'desc' }, take: 5,
            select: { id: true, status: true, videoUrl: true, createdAt: true },
          })
          if (recent.length) {
            const lines = recent.map((t, i) => i + 1 + '. 任务#' + t.id + ' 状态:' + (t.status || '处理中') + (t.videoUrl ? ' 已完成' : ''))
            return 'VIDEO_PROGRESS:最近 ' + recent.length + ' 个生成任务： ' + lines.join(' | ')
          }
          return 'VIDEO_PROGRESS:暂无生成任务（可让我"生成一段视频"开始）'
        } catch { return 'VIDEO_PROGRESS:任务查询失败' }
      }
      try {
        const r = await queryVideoTask(taskId)
        if (!r) return `VIDEO_PROGRESS:查询失败|TASK:${taskId}`
        if (r.status === 'completed' || r.status === 'SUCCEEDED' || r.status === 'succeeded' || r.status === 'success' || r.status === 'done') { // 2026-08-28: 火山返回小写 succeeded
          // 2026-08-24: 防丢——完成即转存 OSS + 自动入个人仓库 + 落生成记录（URL 不再是一次性的）
          let finalUrl = r.videoUrl || ''
          try {
            if (r.videoUrl && auth?.userId) {
              const key = 'storage/' + auth.userId + '/ai_' + Date.now() + '.mp4'  // 2026-08-24: AI生成视频直接进个人仓库目录(storage/{userId}/)，/storage页可见
              const buf = Buffer.from(await (await fetch(r.videoUrl, { signal: AbortSignal.timeout(120000) })).arrayBuffer())
              const oss = await getOSSClient()
              await oss.put(key, buf)
              finalUrl = await signedUrl(key, 86400)
              // 2026-08-26 B方案：成片完成才扣（finalizeSuccessByTaskId 原子认领——pending→processing→扣款，防重复）
              try { await finalizeSuccessByTaskId(String(taskId), finalUrl) } catch (e7) { console.error('[charge] 成片扣费失败:', e7) }
              await prisma.mediaAsset.create({
                data: { title: 'AI生成视频', ossUrl: finalUrl, type: 'video', prompt: String(args.prompt || 'AI生成视频').slice(0, 100), category: 'AI生成', source: 'private', ownerId: auth.userId, orientation: 'landscape' },
              })
              try {
                const rec = await createRecord({ userId: auth.userId, type: 'text2video', prompt: String(args.prompt || 'AI生成视频'), costPoints: 0 })
                await finalizeSuccess(rec, auth.userId, { platformUrl: r.videoUrl, costPoints: 0, reason: 'text2video' })
              } catch {}
            }
          } catch (e) { console.error('[query_video_task] 视频转存失败:', e) }
          return `VIDEO_RESULT:${finalUrl}`
        }
        return `VIDEO_PROGRESS:${r.status || '处理中'}|TASK:${taskId}`
      } catch { return `VIDEO_PROGRESS:查询失败|TASK:${taskId}` }
    }

    // ── 项目素材库 ──
    case 'search_storage': {
      try {
        const where: any = { ownerId: auth?.userId }
        if (args.type && args.type !== 'all') where.type = args.type
        if (args.keyword) where.title = { contains: args.keyword }
        const items = await prisma.mediaAsset.findMany({ where, orderBy: { createdAt: 'desc' }, take: 8 })
        if (items.length) {
          const list = items.map((m, i) => `${i + 1}. ${m.title} [${m.type}] ${m.ossUrl || m.url || ''}`).join('\n')
          return `STORAGE_RESULT:项目素材库找到${items.length}个素材（URL可直接用于配图/发布）:\n${list}`
        }
        return 'STORAGE_RESULT:项目素材库暂无匹配内容。可以试试个人仓库(list_personal_files)、网上找图，或让我AI生成。'
      } catch { return 'STORAGE_RESULT:素材查询失败' }
    }

    // ── 找视频播放（路线1·真播放：本地库 + 外站 web 播放）──
    case 'search_video': {
      try {
        const kw = (args.keyword || '').trim()
        const scope = (args.scope || 'all') as string
        let found: { url: string; title: string }[] = []

        // 1) 个人仓库视频
        if ((scope === 'all' || scope === 'personal') && auth?.userId) {
          try {
            const prefix = `storage/${auth.userId}/`
            const objects = await listObjects(prefix)
            const vids = objects
              .filter(o => !o.name.includes('/.thumbs/'))
              .map(o => {
                const name = o.name.replace(prefix, '')
                const isVideo = /\.(mp4|mov|avi|mkv|webm)$/i.test(name)
                return { name, isVideo, url: `/api/storage/file?userId=${auth.userId}&name=${encodeURIComponent(name)}` }
              })
              .filter(v => v.isVideo)
              .filter(v => !kw || v.name.includes(kw))
              .sort((a, b) => b.name.localeCompare(a.name))
              .slice(0, 5)
            found.push(...vids.map(v => ({ url: v.url, title: v.name })))
          } catch { /* 忽略个人仓库错误 */ }
        }

        // 2) 项目素材库视频
        if (scope === 'all' || scope === 'storage') {
          try {
            const where: any = { type: 'video' }
            if (kw) where.title = { contains: kw }
            const items = await prisma.mediaAsset.findMany({ where, orderBy: { createdAt: 'desc' }, take: 5 })
            found.push(...items.map(m => ({ url: m.ossUrl || m.url || '', title: m.title }))) // 2026-08-28: 同上——AI 可见
          } catch { /* 忽略 */ }
        }

        if (found.length && scope !== 'web') {
          // 返回首个可播放视频（VIDEO_RESULT 触发前端播放器），并列出全部候选
          const first = found[0]
          const list = found.map((f, i) => `${i + 1}. ${f.title}`).join('\n')
          return `VIDEO_RESULT:${first.url}|TITLE:${first.title}\n其它候选:\n${list}`
        }

        // 3) 外站播放（web scope 或 本地无结果时，返回可直接 iframe 真播的外站链接）
        if (scope === 'web' || !found.length) {
          const q = encodeURIComponent(kw || '热门视频')
          const bili = `https://search.bilibili.com/all?keyword=${q}`
          const yt = `https://www.youtube.com/results?search_query=${q}`
          if (kw) {
            return `VIDEO_WEB:${bili}|TITLE:在B站搜索「${kw}」\n备选YouTube:${yt}\n(前端播放器已支持B站/YouTube直链真播放；也可把具体视频链接发给我直接播)`
          }
          return 'VIDEO_RESULT_EMPTY:未指定视频关键词。请告诉我具体想看什么，例如"播放白龙马的视频"。'
        }
        return 'VIDEO_RESULT_EMPTY:未找到匹配的视频。可去【个人仓库】上传视频，或让我用 generate_video 生成一段。'
      } catch (e: any) {
        return 'VIDEO_RESULT_EMPTY:视频搜索失败'
      }
    }

    // ── 个人仓库（OSS 私有存储）──
    case 'list_personal_files': {
      if (!auth?.userId) return 'PERSONAL_RESULT:请先登录后再查看个人仓库'
      try {
        const prefix = `storage/${auth.userId}/`
        const objects = await listObjects(prefix)
        let files = objects
          .filter(o => !o.name.includes('/.thumbs/'))
          .map(o => {
            const name = o.name.replace(prefix, '')
            const isVideo = /\.(mp4|mov|avi|mkv|webm)$/i.test(name)
            const isImage = /\.(jpg|jpeg|png|gif|webp)$/i.test(name)
            return {
              name,
              type: isVideo ? 'video' : isImage ? 'image' : 'file',
              sizeMB: (o.size / 1024 / 1024).toFixed(1),
              mtime: o.lastModified.toISOString().substring(0, 10),
              url: `/api/storage/file?userId=${auth.userId}&name=${encodeURIComponent(name)}`,
            }
          })
        if (args.type === 'video') files = files.filter(f => f.type === 'video')
        if (args.type === 'image') files = files.filter(f => f.type === 'image')
        if (args.keyword) files = files.filter(f => f.name.includes(args.keyword))
        files = files.sort((a, b) => b.mtime.localeCompare(a.mtime)).slice(0, 10)
        if (!files.length) return 'PERSONAL_RESULT:个人仓库暂无匹配文件。可以去【个人仓库】页上传，或让我AI生成内容。'
        const list = files.map((f, i) => `${i + 1}. ${f.name} [${f.type}] ${f.sizeMB}MB ${f.mtime} URL:${f.url}`).join('\n')
        return `PERSONAL_RESULT:个人仓库找到${files.length}个文件（URL可直接作为发布内容）:\n${list}`
      } catch { return 'PERSONAL_RESULT:个人仓库读取失败' }
    }

    // ── 模板 ──
    case 'add_knowledge_site': {
      try {
        if (!args?.url) return 'KNOWLEDGE_RESULT:缺少 URL'
        const r = await fetch(`${baseUrl}/api/knowledge-sites`, {
          method: 'POST', headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: `Bearer ${auth.userId}` } : {}) },
          body: JSON.stringify({ url: args.url, title: args.title || '', desc: args.desc || '', category: args.category || '' }),
        })
        const d = await r.json()
        return d.success ? `KNOWLEDGE_RESULT:已加入知识库（${args.url}）` : `KNOWLEDGE_RESULT:${d.message || '加入失败'}`
      } catch (e: any) { return `KNOWLEDGE_RESULT:加入失败 ${e?.message}` }
    }
    case 'search_knowledge': {
      try {
        const q = new URLSearchParams()
        if (args?.category) q.set('category', args.category)
        const r = await fetch(`${baseUrl}/api/knowledge-sites?${q}`, { headers: auth ? { Authorization: `Bearer ${auth.userId}` } : {} })
        const d = await r.json()
        if (!d.success) return 'KNOWLEDGE_RESULT:查询失败'
        const list = (d.data || [])
        const kw = (args?.keyword || '').toLowerCase()
        const filtered = kw ? list.filter((s: any) => (s.title + s.desc + s.category + s.url).toLowerCase().includes(kw)) : list
        if (!filtered.length) return 'KNOWLEDGE_RESULT:知识库暂无匹配站点'
        return 'KNOWLEDGE_RESULT:知识库站点（可用 crawl_web 抓取查看内容）：\n' + filtered.slice(0, 8).map((s: any, i: number) => `${i + 1}. ${s.title || s.url} [${s.category || '未分类'}] ${s.url}`).join('\n')
      } catch (e: any) { return `KNOWLEDGE_RESULT:查询失败 ${e?.message}` }
    }
    case 'search_templates': {
      // 2026-08-18: 数据源改为公共素材库 MediaAsset（含提示词的素材）——prompt-library 后台不再对普通用户开放
      try {
        const kw = args.keyword || ''
        const cat = args.category || ''
        const where: any = { source: 'public', prompt: { not: '' } }
        if (kw) where.prompt = { contains: kw }
        const rows = await prisma.mediaAsset.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          take: 8,
          select: { id: true, title: true, prompt: true, type: true, category: true },
        })
        const filtered = rows.filter(r => !cat || (r.category || '').includes(cat) || (r.type || '').includes(cat))
        if (filtered.length) {
          const items = filtered.slice(0, 6).map((t: any, i: number) =>
            `${i + 1}. ${(t.title || t.prompt || '').substring(0, 30)}${t.category ? ` [${t.category}]` : ''}${t.type ? ` (${t.type})` : ''}`
          ).join('\n')
          return `TEMPLATE_RESULT:公共素材库找到${filtered.length}个相关素材:\n${items}\n（提示：回复用户"用第几个生成"即可直接生成）`
        }
        return 'TEMPLATE_RESULT:公共素材库暂无匹配素材'
      } catch (e: any) { return 'TEMPLATE_RESULT:模板查询失败（' + e.message + '）' }
    }

    case 'read_knowledge': {
      try {
        if (!auth?.userId) return 'KNOWLEDGE_NEED_LOGIN:请先登录。'
        const { PrismaClient } = await import('@prisma/client')
        const prisma = new PrismaClient()
        const user = await prisma.user.findUnique({ where: { id: auth.userId }, select: { username: true } })
        const uid = user?.username || String(auth.userId)
        const agents = await prisma.aIAgent.findMany({
          where: { userId: uid as any },
          include: { trainingDocuments: true },
          take: 5,
        })
        await prisma.$disconnect()
        if (!agents.length) return 'KNOWLEDGE_EMPTY:你的知识库还没有文档。可以到「AI 智能体」页创建一个智能体并上传训练文档（产品介绍/项目说明），我就能真正了解你的项目了。'
        const docs = agents.flatMap((a: any) => (a.trainingDocuments || []).map((d: any) => ({ agent: a.name, title: d.title, content: (d.content || '').slice(0, 1200) })))
        if (!docs.length) return 'KNOWLEDGE_EMPTY:智能体还没有训练文档，请先到「AI 智能体」页上传。'
        return docs.map((d: any) => `【${d.agent} · ${d.title}】\n${d.content}`).join('\n---\n')
      } catch (e: any) { return 'KNOWLEDGE_ERR:' + e.message }
    }

    case 'project_overview': {
      try {
        if (!auth?.userId) return 'PROJECT_NEED_LOGIN:请先登录。'
        const uid = auth.userId
        const [socialCount, socials, assetCount, assets, genCount, recentGens, user] = await Promise.all([
          prisma.socialAccount.count({ where: { userId: uid } }),
          prisma.socialAccount.findMany({ where: { userId: uid }, select: { platform: true, username: true, status: true }, take: 10 }),
          prisma.mediaAsset.count({ where: { ownerId: uid } }),
          prisma.mediaAsset.findMany({ where: { ownerId: uid }, select: { title: true, type: true, createdAt: true }, orderBy: { createdAt: 'desc' }, take: 5 }),
          prisma.generationRecord.count({ where: { userId: uid } }),
          prisma.generationRecord.findMany({ where: { userId: uid }, select: { type: true, prompt: true, createdAt: true }, orderBy: { createdAt: 'desc' }, take: 5 }),
          prisma.user.findUnique({ where: { id: uid }, select: { username: true, plan: true, pointBalance: true } }),
        ])
        const platformSet = [...new Set(socials.map(s => s.platform))]
        return [
          `【项目概况 · ${user?.username || ''}】`,
          `- 套餐：${user?.plan || 'free'} ｜ 点数余额：${user?.pointBalance ?? 0}`,
          `- 绑定平台账号：${socialCount} 个（${platformSet.join('、') || '无'}——登记用于状态跟踪，发布不依赖登记，任务建好后客户端自动执行）`,
          `- 素材库：${assetCount} 条${assets.length ? '（最近：' + assets.map(a => a.title).join('、') + '）' : ''}`,
          `- AI 生成记录：${genCount} 条${recentGens.length ? '（最近：' + recentGens.map(g => g.type + (g.prompt ? '「' + g.prompt.slice(0, 12) + '」' : '')).join('、') + '）' : ''}`,
          `- 已发布任务可查客户端【指纹浏览器】队列。`,
          `- 浏览器登录态：以客户端自检为准（登记页查看）。`,
        ].join('\n')
      } catch (e: any) { return 'PROJECT_OVERVIEW_ERROR:' + e.message }
    }

    // ── 发布 ──
    // 2026-08-29: 工具箱第一条——browser_use_execute（AI 驱动浏览器操作——admin 添加注册）
    case 'browser_use_execute': {
      const uidB = auth?.userId
      if (!uidB) return 'TOOL_REJECT:未登录'
      // 工具必须注册且 enabled（admin 关闭则不可见——这里再兜底）
      const regT = await prisma.agentTool.findUnique({ where: { name: 'browser_use_execute' } }).catch(() => null)
      if (!regT || !regT.enabled) return 'TOOL_REJECT:工具未启用'
      const taskB = String(args.task || '').trim()
      if (!taskB) return 'TOOL_REJECT:缺少任务描述（task）'
      const filesB = Array.isArray(args.files) ? args.files.map((f: any) => String(f)) : []
      const tB = await prisma.agentBrowserTask.create({ data: { userId: uidB, task: taskB, files: JSON.stringify(filesB) } })
      console.log('[browser_use] 任务已建 #' + tB.id + ':', taskB.slice(0, 50))
      return 'BROWSER_TASK_QUEUED:已创建浏览器自动化任务（#' + tB.id + '）——客户端将用 AI 浏览器（browser-use）执行，稍后说"查任务状态"看结果。任务：' + taskB
    }

    case 'query_browser_tasks': {
        try {
          const bt = await prisma.agentBrowserTask.findMany({ where: { userId: auth?.userId || 0 }, orderBy: { id: 'desc' }, take: 10 })
          if (!bt.length) return 'BROWSER_TASKS:no browser tasks yet.'
          return 'BROWSER_TASKS:' + '\n' + '\n' + bt.map((t: any) => '#' + t.id + ' [' + (t.status || 'pending') + '] ' + String(t.task || '').slice(0, 60) + (t.error ? '(' + String(t.error).slice(0, 80) + ')' : '') + (t.result ? ' -> ' + String(t.result).slice(0, 60) : '')).join('\n')
        } catch (eQ: any) { return 'BROWSER_TASKS_ERROR:' + String(eQ?.message || eQ).slice(0, 100) }
      }
    case 'publish_content': {
      const pubRoot = fs.existsSync(path.join(process.cwd(), '.next', 'standalone', 'public')) ? path.join(process.cwd(), '.next', 'standalone', 'public') : path.join(process.cwd(), 'public')

      {
        // 2026-08-30: OPENCLI 发布链已清除——发布走 AI 浏览器（browser_use 状态机⑤）。AI 若仍调此工具 → 提示改走状态机
        if (!args._wf) {
          return 'PUBLISH_MIGRATED: 发布已迁移至 AI 浏览器（browser_use）——请按状态机走：先提供视频（如“发布 20260821_001.mp4 到抖音”），确认后系统自动创建 AI 浏览器发布任务。'
        }
        // 2026-08-23: 发布前查浏览器登录态（客户端上报）——未登录平台告知用户，不盲发
        // 2026-08-23: 发布前查浏览器登录态（客户端上报）——未登录平台告知用户，不盲发
        try {
          const { getBrowserStatus } = await import('@/lib/browser-status')
          const accts = getBrowserStatus(Number(auth?.userId || 0))
          const plat = String(args.platform || '').toLowerCase()
          const hit = accts.find((a) => a.id === plat)
          if (hit && !hit.loggedIn) {
            return 'BROWSER_LOGIN_REQUIRED:' + plat + '——你的浏览器未登录该平台，发布时会自动打开登录页，扫码登录后继续'
          }
        } catch {}
      }

      try {
        // 平台名归一化（中文/英文 -> 统一 key）
        const raw = String(args.platform || 'douyin').toLowerCase()
        const PLATFORM_ALIAS: Record<string, string> = {
          douyin: 'douyin', '抖音': 'douyin',
          xiaohongshu: 'xiaohongshu', '小红书': 'xiaohongshu', xhs: 'xiaohongshu',
          kuaishou: 'kuaishou', '快手': 'kuaishou',
          shipinhao: 'shipinhao', '视频号': 'shipinhao', weixin: 'shipinhao', '微信视频号': 'shipinhao',
          bilibili: 'bilibili', 'b站': 'bilibili', 'B站': 'bilibili', 'bili': 'bilibili', '哔哩哔哩': 'bilibili',
        }
        const platform = PLATFORM_ALIAS[raw] || PLATFORM_ALIAS[args.platform] || raw
        const PLATFORM_LABEL: Record<string, string> = { douyin: '抖音', xiaohongshu: '小红书', kuaishou: '快手', shipinhao: '视频号', bilibili: 'B站', weibo: '微博', xianyu: '闲鱼' } // 2026-08-28: 接 opencli 已有平台（微博/闲鱼）
        const label = PLATFORM_LABEL[platform] || args.platform

        if (!auth?.userId) return 'PUBLISH_NEED_LOGIN:请先登录平台账号后再发布。'

        // 2026-08-18: 不再检查账号登记——默认用户已在指纹浏览器登录，直接建任务；
        // 若执行时客户端检测到未登录（fp 脚本 needLogin），任务会标记失败并提示扫码
        const accts = await prisma.socialAccount.findMany({
          where: { userId: auth.userId, platform },
          take: 5,
        })
        const list = accts.map(a => `- ${a.username}（${label}）`).join('\n')
        // C2 发布闭环（2026-08-05）：视频/文案齐备 → 创建发布任务，客户端自动发布（复用 7 平台脚本）
        // 2026-08-27: V4 flash 可能用 file/title/desc 参数名——兼容别名（videoName=file，caption=desc/title）
        const videoName = args.videoName || args.file || (typeof args.contentUrl === 'string' ? args.contentUrl.split('/').pop()?.split('?')[0] : '')
        // 2026-08-27 发布工作流：视频是日期+编号命名——用户没说具体哪个 → 列仓库最新3个编号让选（绝不问"视频叫什么名字"）
        if (!videoName) {
          try {
            const { listObjects } = await import('@/lib/oss')
            const objs = await listObjects('storage/' + auth.userId + '/')
            const vids = (objs || []).filter((o: any) => /\.(mp4|mov|avi|mkv|webm)$/i.test(o.name || '')).sort((a: any, b: any) => (b.lastModified || 0) - (a.lastModified || 0)).slice(0, 3)
            if (vids.length) return `WORKFLOW_NEED_VIDEO:发布工作流——你的仓库最近 ${vids.length} 个视频（日期+编号命名）：${vids.map((v: any, i: number) => i + 1 + '. ' + v.name.split('/').pop()).join(' | ')} —— 回复编号（如 1）或说“用最新”即发布。若都不对，可到个人仓库页选或本地上传。`
          } catch {}
          return 'WORKFLOW_NEED_VIDEO:发布工作流——未指定视频。请到个人仓库页选择要发布的视频，或直接本地上传后告诉我。'
        }
        const pubCaption = args.caption || args.desc || args.title || '' // V4 别名兼容
        const captionLine0 = pubCaption ? `
📝 文案：${pubCaption}` : ''
        if (videoName && (args.caption || true)) { // 2026-08-27: caption 空也建任务（用视频名作标题）——用户只说“发布抖音xx.mp4”不说文案也要建
          try {
            // 2026-08-18: 话题从文案提取 #标签（或用户显式传 topics）
            const hashTags = String(pubCaption || '').match(/#[^\s#，,。]+/g) || []
            const topicsArr = args.topics
              ? String(args.topics).split(/[,，]/).map((t: string) => t.trim()).filter(Boolean)
              : hashTags.map((t: string) => t.replace('#', ''))
            // 多平台：platforms 数组（或单 platform）
            const platformList: string[] = Array.isArray(args.platforms) && args.platforms.length
              ? args.platforms.map((pl: string) => PLATFORM_ALIAS[String(pl).toLowerCase()] || String(pl).toLowerCase())
              : [platform]
            const taskIds: number[] = []
            // 2026-08-28: 封面持久化——args.coverUrl 若是 /api/frames/ 临时帧（1h 后清理）→ 转存 OSS 永久代理 URL（克端可读不过期）
            let coverPersist = args.coverUrl || null
            if (coverPersist && coverPersist.includes('/api/frames/')) {
              try {
                // 2026-08-31 security: 路径遍历防护（去 ../ 和分隔符——限死 frames 目录）
                const cRel = String(coverPersist).replace('/api/frames/', '').replace(/\.\./g, '').replace(/[\s]+/g, ' ').slice(0, 40)
                  const kwMatch = vdTxt.match(/(?:展示|演示|是一个|呈现|画面)[:：]?\s*([^，。；
]{2,20})/) || vdTxt.match(/([^，。；
]{4,16})/)
                  const kw = (kwMatch?.[1] || vdTxt).slice(0, 14).slice(0, 14)
                  const titlesW = '【文案1】' + kw + '——3秒看懂核心
【文案2】' + kw + '，原来还能这样用
【文案3】揭秘' + kw + '的细节'
                }
                } else wfEarlyReply = '请回复帧编号 1-4 选帧，或“换一批”重抽。'
              }
            } else if (draftW.step === 'title') {
              const pickT = userMessage.trim().match(/^([1-3])$/)
              if (pickT) {
                // 2026-08-31: 从 titlesW 提取第 N 个标题（不再存'标题N'字面量）
                const tSegs = String(draftW.titles || '').split(/[\n\r]+/).map((s: string) => s.replace(/^\d+[.、、）)]*\s*/, '').trim()).filter((s: string) => s.length > 3)

                draftW.title = tSegs[Number(pickT[1]) - 1] || ('标题' + pickT[1])
                draftW.step = 'topics'
                draftW.topics = '#短视频技巧 #素材分享 #AI营销'
                wfEarlyReply = 'WF_JSON:' + JSON.stringify({ step: 'topics', topics: ['#短视频技巧', '#素材分享', '#AI营销'], hint: '③ 话题标签——点击选或回复“确认/换一批”' })
              } else wfEarlyReply = '请回复标题编号 1-3，或“换一批”重推。'
            } else if (draftW.step === 'topics') {
              if (/确认|可以|好|行/.test(userMessage.trim())) {
                draftW.step = 'cover'
                // 2026-08-31 v2③: ④ 真生成封面（文生图——visualDesc+标题 → 封面）——不再等 ⑤
                let covU = draftW.coverUrl || ''
                if (!covU && draftW.visualDesc) {
                  try {
                    const covR = await dashscopeGenerateImageAsync((draftW.visualDesc.slice(0, 200) + '，营销封面风格，标题文字：' + (draftW.title || '')).trim(), '768*1344').catch(() => null)
                    if (covR?.taskId) {
                      for (let pi = 0; pi < 4; pi++) {
                        await new Promise((res) => setTimeout(res, 4000))
                        const qt = await fetch('https://dashscope.aliyuncs.com/api/v1/tasks/' + covR.taskId, { headers: { Authorization: 'Bearer ' + process.env.DASHSCOPE_API_KEY } }).then((r) => r.json()).catch(() => null)
                        if (qt?.output?.task_status === 'SUCCEEDED') { const u = qt.output.results?.[0]?.url; if (u) { covU = u; draftW.coverUrl = u } break }
                      }
                    }
                  } catch {}
                }
                wfEarlyReply = 'WF_JSON:' + JSON.stringify({ step: 'cover', coverUrl: covU, hint: '④ 封面已生成' + (covU ? '' : '（失败——可重试）') + '——确认或换一批' })
              } else wfEarlyReply = '请回复“确认”话题。'
            } else if (draftW.step === 'cover') {
              if (/确认|可以|好|行/.test(userMessage.trim())) {
                // 2026-08-31 v2④: ⑤ 确认发布——先吐 WF_JSON publish（报告预览——确认键）——用户确认后再建任务
                draftW.step = 'publish'
                wfEarlyReply = 'WF_JSON:' + JSON.stringify({ step: 'publish', videoName: draftW.videoName, title: draftW.title || '', topics: draftW.topics || '', coverUrl: draftW.coverUrl || '', hint: '⑤ 确认发布到抖音——检查素材包，点「确认发布」执行' })
              } else wfEarlyReply = '请回复“确认”封面。'
            } else if (draftW.step === 'publish') {
              if (/确认发布|确认|发|好|行/.test(userMessage.trim())) {
                const wfA: any = { platform: 'douyin', videoName: draftW.videoName, caption: draftW.title || draftW.videoName, topics: draftW.topics, coverUrl: draftW.coverUrl || '' }
                let fileUrls: string[] = []
                try {
                  const vRel = String(wfA.videoName || '')
                  const vCands = [path.join(pubRoot, 'storage', String(auth?.userId || 0), vRel), path.join(pubRoot, 'generated', vRel), path.join(pubRoot, vRel)]
                  const vFp = vCands.find((fp: string) => fs.existsSync(fp))
                  if (vFp) {
                    const vBuf = fs.readFileSync(vFp)
                    const vKey = 'storage/' + auth?.userId + '/pub_' + Date.now() + '_' + vRel
                    await putObject(vKey, vBuf, 'video/mp4')
                    fileUrls.push('https://ai-niuma.cc/api/storage/file?name=' + vKey.replace('storage/' + auth?.userId + '/', '') + '&persist=1')
                    console.log('[发布⑤] 视频已转 OSS:', vKey)
                  } else { console.log('[发布⑤] 视频本地未找到（可能已在 OSS）:', vRel) }
                } catch (ePv: any) { console.error('[发布⑤] 视频转 OSS 失败:', ePv?.message || ePv) }
                const buTask = '发布视频到' + (wfA.platform === 'douyin' ? '抖音' : wfA.platform || '抖音') + '：先打开 https://creator.douyin.com/creator-micro/content/upload （如返回登录页说明未登录，直接告知结束），上传视频，标题：' + (wfA.caption || '') + '，话题：' + (wfA.topics || '') + '，用平台智能封面，然后点击发布'
                const buT = await prisma.agentBrowserTask.create({ data: { userId: auth?.userId || 0, task: buTask, files: JSON.stringify(fileUrls) } })
                // 2026-08-31 v2④: 完整报告（MD——封面/标题/话题/视频——跨平台素材包）
                const reportMd = '## 发布素材包（reportId: ' + buT.id + '）' + '\n' + '- 视频：' + (wfA.videoName || '') + '\n' + '- 封面：' + (wfA.coverUrl ? '![](' + wfA.coverUrl + ')' : '平台智能封面') + '\n' + '- 标题：' + (wfA.caption || '') + '\n' + '- 话题：' + (wfA.topics || '') + '\n' + '- 平台：' + (wfA.platform || 'douyin') + '\n' + '\n' + '- 此素材包已存库——后续说「发小红书/微博」即可复用（AI 读取 reportId 直接用）'

                const wfR3 = 'BROWSER_TASK_QUEUED:已创建 AI 浏览器发布任务（#' + buT.id + '）——客户端 AI 浏览器自动执行。' + (fileUrls.length ? '视频已就绪。' : '') + '\n' + '\n' + reportMd
                messages.push({ role: 'tool', tool_call_id: 'wf-' + Date.now(), content: String(wfR3) } as any)
PUBLISH_DRAFT.delete(uidW)
              } else wfEarlyReply = '请回复“确认”发布。'
            }
          } catch (eWF2) { console.error('[发布工作流] 异常:', eWF2) }
        }
        if (false && pubIntent && !calledPublish) { // 旧强制段已禁        if (false && pubIntent && !calledPublish) { // 旧强制段已禁
          // 从用户消息提取平台+视频文件名
          const platMatch = userMessage.match(/(抖音|小红书|微博|视频号)/)
          const platMap: Record<string, string> = { '抖音': 'douyin', '小红书': 'xiaohongshu', '微博': 'weibo', '视频号': 'shipinhao' }
          const platform = platMatch ? (platMap[platMatch![1] || ''] || 'douyin') : 'douyin'
          const vfMatch = userMessage.match(/([A-Za-z0-9_-]+\.(?:mp4|mov|avi|mkv|webm))/i)
          const vfName = vfMatch ? (vfMatch![1] || '') : ''
          const wfArgs: any = { platform }
          if (vfName) wfArgs.videoName = vfName
          const isConfirm = userMessage.trim().length <= 6 && /(发|确认|可以|就这样|好|行|发吧)/.test(userMessage.trim())
          if (vfName && !isConfirm) {
            // 首轮：只强制抽帧看视频（visualDesc 注入→AGENT 基于真实画面出标题/文案）——不建任务
            console.log('[发布工作流] 首轮看视频:', vfName)
            const frResult = await executeToolCall('extract_video_frames', { videoName: vfName }, auth).catch((e: any) => '抽帧失败: ' + (e.message || e))
            messages.push({ role: 'tool', tool_call_id: 'wf-fr-' + Date.now(), content: String(frResult) } as any)
          } else {
            // 确认轮/没视频：强制建任务（caption 从对话上轮标题提取，无则用视频名兕底）
            if (vfName) {
              try {
                const prevAsst = [...messages].reverse().find((m: any) => m.role === 'assistant' && typeof m.content === 'string' && m.content.indexOf('标题') >= 0)
                const tm = prevAsst ? String((prevAsst as any).content).match(/标题[\s:]*[：:]?([^\n]{2,40})/) : null
                if (tm) wfArgs.caption = (tm![1] || '').trim()
              } catch {}
            }
            console.log('[发布工作流] 确认建任务（browser_use 发布——opencli 链已清除）:', JSON.stringify(wfArgs))
            // 2026-08-30: 发布统一走 browser_use（AI 浏览器）——不再 opencli（create_v2 定时-2/旧 DOM）
            const buTask = '发布视频到' + (wfArgs.platform || '抖音') + '：打开对应创作者中心上传页，上传个人仓库视频 ' + (wfArgs.videoName || '') + '，标题：' + (wfArgs.caption || wfArgs.title || '') + '，话题：' + (wfArgs.topics || '') + (wfArgs.coverUrl ? '，封面：' + wfArgs.coverUrl : '，用平台智能封面') + '，然后点击发布'
            const buT = await prisma.agentBrowserTask.create({ data: { userId: auth?.userId || 0, task: buTask, files: JSON.stringify([]) } })
            const wfResult = 'BROWSER_TASK_QUEUED:已创建 AI 浏览器发布任务（#' + buT.id + '）——客户端 AI 浏览器自动执行（打开平台→上传→填标题→发布）。任务：' + buTask
            messages.push({ role: 'tool', tool_call_id: 'wf-' + Date.now(), content: String(wfResult) } as any)
            if (normCalls.length === 0) normCalls.push({ id: 'wf-' + Date.now(), name: 'browser_use_execute', arguments: JSON.stringify({ task: buTask }) } as any)
            if (vfName) {
              try { const fr2 = await executeToolCall('extract_video_frames', { videoName: vfName }, auth).catch((e: any) => '抽帧失败'); messages.push({ role: 'tool', tool_call_id: 'wf-fr-' + Date.now(), content: String(fr2) } as any) } catch {}
            }
          }
        }
      } catch (ePub2) { console.error('[发布工作流] 异常:', ePub2) }
      console.log('[状态机] 块尾——step=', (PUBLISH_DRAFT.get(auth?.userId || 0) as any)?.step, 'wfEarlyReply=', wfEarlyReply ? String(wfEarlyReply).slice(0, 60) : '(空——未设回复)', '消息=', String(userMessage).slice(0, 20))
      const toolMsg = messages.filter(m => (m as any).role === 'tool').pop() as AgentChatMessage | undefined
      const toolRaw = toolMsg?.content
      const toolText = typeof toolRaw === 'string' ? toolRaw : (toolRaw ? JSON.stringify(toolRaw) : '')

      let reply: string
      if (wfEarlyReply) { reply = wfEarlyReply; console.log('[状态机] wfEarlyReply 已设:', String(wfEarlyReply).slice(0, 60)) } else
      // 若模型在 Step2 又返回了 tool_calls（异常），忽略它，用工具结果兜底，避免死循环与脏输出
      if (finalResult && finalResult.toolCalls && finalResult.toolCalls.length > 0) {
        reply = formatToolResult(toolText)
      } else {
        reply = (typeof finalResult === 'string' ? finalResult : finalResult?.content) || formatToolResult(toolText)
      if (!reply) reply = '发布流程处理中——请回复“重试”或继续操作。'  // 2026-09-01: 回复空兑底（不白屏' 已执行'）
      }
      // 2026-08-27: 发布话术强制校验——模型说“已创建”但工具未真返回 PUBLISH_QUEUED → 强制纠正（不信模型话术，信工具结果）
      try {
        const userWantsPublish = /发布|发抖音|发小红书|发微博|发视频号|发到/.test(userMessage)
        const hasPublishToolResult = /PUBLISH_QUEUED|WORKFLOW_NEED_VIDEO|CANCEL_OK|FRAMES_OK|测试发布任务/.test(toolText) // 2026-08-27: FRAMES_OK(首轮看视频)也算工作流进行中——不误拦
        const claimsCreated = /已创建|创建发布任务|发布任务已创建|已为「/.test(reply)
        if (userWantsPublish && !wfEarlyReply && claimsCreated && !hasPublishToolResult) {
          console.error('[发布校验] 模型话术“已创建”但工具未返回，强制纠正:', userMessage.slice(0, 50))
          reply = toolText.includes('WORKFLOW_NEED_VIDEO')
            ? '⚠️ 发布任务未真正创建。' + toolText
            : '⚠️ 发布任务未真正创建。请说“发布抖音 XX 视频”（XX 为仓库视频编号），或到个人仓库页选择要发布的视频。'
        }
        // 2026-08-27 扩大校验：用户发布意图 + 本轮未真调发布工具（无 PUBLISH_QUEUED/WORKFLOW_NEED_VIDEO）→ 不管模型说什么（“检测到 pending”/“打开指纹浏览器”等）均强制走工作流
        if (userWantsPublish && !wfEarlyReply && !hasPublishToolResult && !/CANCEL_OK/.test(toolText)) {
          console.error('[发布校验] 用户要发布但本轮未调发布工具，强制引导工作流:', userMessage.slice(0, 50))
          reply = toolText.includes('WORKFLOW_NEED_VIDEO')
            ? '⚠️ 发布未进入工作流（本轮未触发发布工具）。' + toolText
            : '⚠️ 发布未进入工作流。请说“发布抖音 XX 视频”（XX=仓库视频编号），或到个人仓库页选择。已启用发布工作流，不再使用指纹浏览器流程。'
        }
      } catch (ePub) { console.error('[发布校验]异常:', ePub) }
      // 清理模型偶发吐出的工具调用 XML 脏标签（<tool_call> <function_calls> <invoke> 等）
      reply = stripToolCallTags(reply)
      // 解析 Scene 投影协议（工具分支，2026-08-05 提取共用函数）
      const extracted = await extractSceneFromReply(reply)
      reply = extracted.reply
      let scene = extracted.scene

      // 存DB
      let sessionId = sid
      if (auth?.userId) {
        if (!sessionId) {
          const s = await prisma.chatSession.create({
            data: { userId: auth.userId, title: userMessage.substring(0, 30) },
          })
          sessionId = s.id
        }
        await prisma.chatMessage.createMany({
          data: [
            { sessionId, role: 'user', content: userMessage },
            { sessionId, role: 'assistant', content: reply, toolUsed: true, intent: normCalls.map((t: any) => t.name).join(',') },
          ],
        })
        await prisma.chatSession.update({ where: { id: sessionId }, data: { updatedAt: new Date() } })
      }

      // 2026-08-12: 对话前先检查点数（无套餐且点卡0/额度不足 -> 主动弹「我的套餐」）
      if (auth?.userId) {
        const tok = await checkTokens(auth.userId, TOKEN_COSTS.CHAT_PER_MSG)
        if (!tok.allowed) {
          return NextResponse.json({ success: true, data: {
            reply: '⚠️ ' + (tok.message || '点数不足') + '——已为你打开「我的套餐」页面，可在其中开通套餐或购买点卡。',
            intent: 'no_quota', toolUsed: false, scene: { type: 'open_page', path: '/my-subscription', params: {} }, sessionId: sessionId, pointsSpent: 0,
          } })
        }
        await spendTokens(auth.userId, TOKEN_COSTS.CHAT_PER_MSG, 'agent_chat')
      }
      return NextResponse.json({
        success: true,
        data: { reply, intent: toolCalls.map((t: any) => t.name), toolUsed: true, steps, scene: scene || templateScene, scenes: extracted.scenes.length > 1 ? extracted.scenes : undefined, sessionId, pointsSpent: TOKEN_COSTS.CHAT_PER_MSG },
      })
    }

    // 纯聊天
    let reply = fcResult.content || '抱歉，AI服务暂时繁忙。'
    // 纯聊天分支同样解析 SCENE_JSON（2026-08-05：模型可能不调工具直接输出场景卡片）
    const extractedChat = await extractSceneFromReply(reply)
    reply = extractedChat.reply
    const scene = extractedChat.scene
    const scenes = extractedChat.scenes.length > 1 ? extractedChat.scenes : undefined
    // 2026-08-05：AI 自由度——仅输出场景卡片而无正文时，给一句自然引导（不让回复为空）
    if (!reply.trim() && scene) {
      if (scene.type === 'open_page') {
        const p = scene.path || ''
        const title = (p.split('/').filter(Boolean).pop() || '功能')
        reply = `已为你打开「${title}」，我一直在旁边。想让我帮你做什么？比如：结合当前页面给建议、生成内容、或告诉我下一步。`
      } else if (scene.type === 'image') {
        reply = scene.desc || '已为你生成，看看这张卡片～'
      } else {
        reply = '已为你处理，还有什么需要帮忙的吗？'
      }
    }
    let sessionId = sid
    if (auth?.userId) {
      if (!sessionId) {
        const s = await prisma.chatSession.create({
          data: { userId: auth.userId, title: userMessage.substring(0, 30) },
        })
        sessionId = s.id
      }
      await prisma.chatMessage.createMany({
        data: [
          { sessionId, role: 'user', content: userMessage },
          { sessionId, role: 'assistant', content: reply, toolUsed: false },
        ],
      })
      await prisma.chatSession.update({ where: { id: sessionId }, data: { updatedAt: new Date() } })
    }

    if (auth?.userId) {
      const tok = await checkTokens(auth.userId, TOKEN_COSTS.CHAT_PER_MSG)
      if (!tok.allowed) {
        return NextResponse.json({ success: true, data: {
          reply: '⚠️ ' + (tok.message || '点数不足') + '——已为你打开「我的套餐」页面。',
          intent: 'no_quota', toolUsed: false, scene: { type: 'open_page', path: '/my-subscription', params: {} }, sessionId: null, pointsSpent: 0,
        } })
      }
      await spendTokens(auth.userId, TOKEN_COSTS.CHAT_PER_MSG, 'agent_chat')
    }
    // #5 模型标注 + #6 敏感过滤（2026-08-21：回复末尾标注实际模型；剔除后台链接/IP/API key）
    const usedModel = (fcResult as any)?.model || (hasImage ? 'qwen3.8-flash' : 'qwen3.8-flash') // 2026-08-30: 统一 qwen3.8（不切 qwen-plus）
    reply = String(reply || '')
    if (reply && !/（模型：/.test(reply)) {
      reply = reply + String.fromCharCode(10, 10) + '（模型：' + usedModel + '）'
    }
    reply = reply
      .replace(/https?:\/\/[^\s）)]*(?:admin|120\.55\.43\.195)[^\s）)]*/g, '[内部链接已隐藏]')
      .replace(/\/admin/g, '')
      .replace(/sk-[A-Za-z0-9_-]{10,}/g, '******')
    return NextResponse.json({
      success: true,
      data: { reply, intent: 'chat', toolUsed: false, sessionId, scene: scene || templateScene, scenes, pointsSpent: TOKEN_COSTS.CHAT_PER_MSG },
    })
  } catch (error: any) {
    console.error('[Agent API]', error)
    return NextResponse.json({ success: false, message: error.message }, { status: 500 })
  }
}

// GET: 聊天历史
export async function GET(request: NextRequest) {
  const auth = getAuthFromHeaders(request)
  if (!auth) return NextResponse.json({ success: false, message: '请登录' }, { status: 401 })

  const url = new URL(request.url)
  const action = url.searchParams.get('action') || 'sessions'
  const sessionId = parseInt(url.searchParams.get('sessionId') || '')
  // 2026-08-21: 30 天自动清理旧会话（非收藏的 30 天前会话——懒清理，查询时触发）
  try {
    await prisma.chatSession.deleteMany({
      where: { userId: auth.userId, favorite: false, updatedAt: { lt: new Date(Date.now() - 30 * 24 * 3600 * 1000) } },
    })
  } catch {}
  // 2026-08-21 日历：按天查会话（回档用）
  if (action === 'sessionsByDate') {
    try {
      const sessions = await prisma.chatSession.findMany({
        where: { userId: auth.userId },
        orderBy: { createdAt: 'desc' },
        take: 200,
        select: { id: true, title: true, favorite: true, createdAt: true, updatedAt: true, _count: { select: { messages: true } } },
      })
      const byDate: Record<string, any[]> = {}
      for (const s of sessions) {
        const d = s.createdAt.toISOString().slice(0, 10)
        ;(byDate[d] = byDate[d] || []).push({ id: s.id, title: s.title, favorite: s.favorite, msgCount: s._count.messages, updatedAt: s.updatedAt.toISOString() })
      }
      return NextResponse.json({ success: true, data: byDate, favorites: sessions.filter(s => s.favorite).map(s => ({ id: s.id, title: s.title, date: s.createdAt.toISOString().slice(0, 10) })) })
    } catch (e: any) { return NextResponse.json({ success: false, message: e.message }, { status: 500 }) }
  }
  // 2026-08-21 日历：收藏/取消收藏会话
  if (action === 'favoriteToggle') {
    try {
      const id = parseInt(url.searchParams.get('id') || '0')
      const fav = url.searchParams.get('fav') === '1'
      await prisma.chatSession.updateMany({ where: { id, userId: auth.userId }, data: { favorite: fav } })
      return NextResponse.json({ success: true, favorite: fav })
    } catch (e: any) { return NextResponse.json({ success: false, message: e.message }, { status: 500 }) }
  }

  try {
    if (action === 'sessions') {
      const sessions = await prisma.chatSession.findMany({
        where: { userId: auth.userId },
        orderBy: { updatedAt: 'desc' },
        take: 30,
        select: { id: true, title: true, updatedAt: true },
      })
      return NextResponse.json({ success: true, data: sessions })
    }
    if (action === 'messages' && sessionId) {
      const session = await prisma.chatSession.findFirst({ where: { id: sessionId, userId: auth.userId } })
      if (!session) return NextResponse.json({ success: false, message: '会话不存在' }, { status: 404 })
      const messages = await prisma.chatMessage.findMany({
        where: { sessionId },
        orderBy: { createdAt: 'asc' },
        select: { id: true, role: true, content: true, toolUsed: true, intent: true, createdAt: true },
      })
      return NextResponse.json({ success: true, data: { session, messages } })
    }
    return NextResponse.json({ success: false, message: '未知操作' }, { status: 400 })
  } catch (e: any) {
    return NextResponse.json({ success: false, message: e.message }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
