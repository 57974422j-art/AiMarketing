import { NextRequest, NextResponse } from 'next/server'
import {
  generateText, generateImage, generateVideo, generateLongVideo, queryVideoTask,
  ToolDefinition,
  agnesChat, dashscopeFunctionCall, type AgentChatMessage,
} from '@/lib/ai-providers'
import { searchTrendsReal } from '@/lib/gemini'
import { getAuthFromHeaders } from '@/lib/api-auth'
import { spendTokens, checkTokens, TOKEN_COSTS } from '@/lib/token-wallet'
import { listObjects } from '@/lib/oss'
import { getSystemConfigs } from '@/lib/quota'
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
    description: 'AI生成图片/海报。触发词："生成图片""做海报""设计图""画一张""海报图""配图"。',
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
    description: 'AI生成视频（百炼 wan2.7）。触发词："做视频""生成视频""短视频""拍一个"。注意：首次调用必须先报费用预估（不要带 confirmed），用户确认后再带 confirmed=true 真正生成；时长超过15秒会自动分段拼接（每段用上一段尾帧做参考，保证衔接）。',
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
    description: '生成视频分镜脚本（只出方案，不生成视频）。触发词："分镜""脚本""镜头方案"。根据用户视频创意输出分镜JSON（每镜：画面描述/英文prompt/时长/镜头感）+ 总费用预估。用户确认分镜后，再用 generate_video（confirmed=true）逐镜生成。',
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
    description: '一句话 AI 成片：内部自动分镜并创建后台生成任务（无需用户先要分镜）。触发词："帮我做个视频""一键成片""自动做视频""做一条视频"。规则同 generate_video：首次调用不带 confirmed 只报费用预估，用户确认后带 confirmed=true 才真正分镜+建任务。返回任务ID，可用 query_storyboard 查进度。',
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
    description: '创建分镜成片任务（后台逐镜生成，可查进度）。在 generate_storyboard 出分镜且用户确认费用后调用。返回任务ID。',
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
    description: '创建数字人口播视频：上传照片+选择声音+输入文案。触发词："数字人""口播""虚拟人""AI主播"。',
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
    description: '搜索提示词模板库。触发词："模板""场景""有什么可以用的"。',
    parameters: {
      type: 'object',
      properties: {
        keyword: { type: 'string', description: '关键词' },
        category: { type: 'string', description: '分类：数字人/场景/文案/背景' },
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
    name: 'publish_content',
    description: '发布/准备发布内容到自媒体平台（抖音/小红书/快手/视频号/B站）。触发词："发布""发抖音""发小红书""投稿""上传视频"。会检查该平台绑定账号并给出发布指引；真实发布在客户端指纹浏览器执行，账号未登录平台时需用户先去登录（你不处理登录）。',
    parameters: {
      type: 'object',
      properties: {
        platform: { type: 'string', description: '平台：douyin/xiaohongshu/kuaishou/shipinhao/bilibili（或中文名）' },
        contentUrl: { type: 'string', description: '要发布的内容URL（个人仓库文件URL或生成结果URL）' },
        videoName: { type: 'string', description: '素材仓库中的视频文件名（如 xxx.mp4），与 contentUrl 二选一，优先用这个' },
        caption: { type: 'string', description: '文案/标题（含话题标签）' },
      }, required: ['platform'],
    },
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
    name: 'search_trends',
    description: '搜索国内外真实热点/趋势（舆情）。当用户问"最近有什么热点/海外在火什么/YouTube上xx热不热/TikTok趋势"时调用。国内走免费热榜，海外优先 Google grounding，失败时降级到 DuckDuckGo/Reddit 真实源。',
    parameters: {
      type: 'object',
      properties: {
        keyword: { type: 'string', description: '话题关键词' },
        platforms: { type: 'string', description: '平台范围：domestic(国内)/global(海外)/all(全部)，默认 all' },
        count: { type: 'number', description: '返回条数，默认 8' },
      },
      required: ['keyword'],
    },
  },
]

// 思考流步骤中文标签（前端展示用）
const TOOL_STEP_LABEL: Record<string, string> = {
  generate_copy: '撰写营销文案',
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
📱 发布内容 — 发到5大平台（指纹浏览器执行，需账号已绑定且已登录平台）
⚙️ 自动化 — 定时任务/互关/评论

【内容制作自由度】制作日常内容时你有主动权，不必等用户一步步指挥：
1. 找素材优先级：个人仓库(list_personal_files) → 项目素材库(search_storage) → 网上找(search_web_images) → AI现做(generate_image/generate_video)
2. 用户说"帮我做今天的内容/日更"这类模糊指令时，主动组合工具：查素材→写文案→配图/成片→给出发布建议，一次给出完整方案
3. 素材不合适就换下一个来源，不要卡住反问；实在缺关键信息（如产品名/平台）再问

【发布规则】
- 发布前确认三要素：平台、内容URL（优先个人仓库成片）、文案标题
- publish_content 会检查绑定账号；真实发布在客户端「指纹浏览器」页执行
- 账号未登录平台时，引导用户去指纹浏览器页点「去登录」扫码；你不处理登录
- 没绑定账号时，引导去【账号管理】绑定（bindType=manual）

【客户画像 / 需求记忆（重点能力）】
- 你擅长像资深运营顾问一样，逐步摸清并记住客户的生意：行业/产品、目标平台与人群、内容风格偏好、预算节奏、常做的内容类型。
- 在对话中自然收集关键信息，当确认到客户的行业、产品、偏好、常发平台、目标人群等稳定信息时，主动调用 upsert_memory 记下来（tags 用 画像/偏好/行业/平台 等），salience 设高（0.8~1.0）。
- 客户问"你还记得我吗/我是什么行业"时，先 search_memory 调出画像再回答，让客户感到"你真的懂他"。
- 记画像不要打断主任务：完成当前请求后，顺带把新确认的信息写进记忆即可。

【热点驱动选题（像白龙马一样主动）】
- 系统会在对话开头注入【今日热点上下文】（来自 vvhan/微博/抖音/知乎/小红书/HackerNews/Reddit 等）。
- 当用户点热点卡片、或说"今天发什么/给我个选题/日更内容"等模糊指令时，直接结合热点上下文给 2~3 个具体选题方向（带标题+文案要点+建议用哪个工具做），不要空泛、不要先反问"你是做什么的"——热点本身就是素材，先出方案再说。
- 如果用户行业不在热点里覆盖，可在出完方案后顺带问一句"你主要做哪个行业，我记一下以后更精准"，但绝不要阻塞出方案。

【一键成片（唤起页面，不代跑）】
- 你不直接执行一键成片剪辑。当用户要"把这段文案做成片/剪个视频"，你理解意图后，用 [SCENE_JSON]{"type":"open_page","path":"/auto-compile","params":{...}}[/SCENE_JSON] 让前端直接打开一键成片页并带入文案/配图参数，页面负责剪辑。
【网页抓取（crawl_web，2026-08-13）】
- **硬规则：用户消息中出现 http:// 或 https:// 链接（或说"看看这个网页/这个链接/竞品/这个文章"）时，必须无条件调用 crawl_web**——**不要先凭常识判断链接是否有效/是否示例域名/是否有内容——抓了才知道**。
- 抓取后：有内容 → 按用户目的提炼；无内容（CRAWL_EMPTY）→ 如实说"该页面无可提取文本"，不要编造。
- 抓取失败/页面无文本（视频页/需登录/动态加载）时，如实告诉用户"抓取失败/无文本"，并给出建议（换 URL/该站需登录）。
- 抓取成功后，按用户目的提炼（总结/提取价格/竞品分析/文案素材），不要原样堆砌全部文本。

【功能页面路径映射（open_page 必须按此表选 path）】
- 一键成片/做成片/剪成片 → /auto-compile
- 文生视频/AI视频 → /text-to-video
- AI文案/写文案 → /ai-copy
- 素材库/个人仓库 → /storage
- 指纹浏览器/发抖音/发布 → /my-fingerprint
- 数据看板/仪表盘 → /dashboard
- AI生图/生成图片 → /image-generator
- 视频剪辑/后期处理/配音字幕 → /video-edit
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
      return await generateText(p) || '文案生成暂不可用'
    }

    // ── 图片（#2 2026-08-12: 工具前移扣费——执行前 check，成功后 spend）──
    case 'generate_image': {
      const uid = auth?.userId
      if (!uid) return 'TOOL_REJECT:未登录'
      const gCount = Math.max(1, parseInt(args.count) || 1)
      const gCost = TOKEN_COSTS.IMAGE_PER_PIC * gCount
      const gChk = await checkTokens(uid, gCost)
      if (!gChk.allowed) return `TOOL_REJECT:${gChk.message}`
      const result = await generateImage(args.prompt || '商业海报', args.size || '1024*1024')
      if (result?.url) {
        await spendTokens(uid, gCost, 'agent_generate_image')
        return `IMAGE_RESULT:${result.url}|MODEL:${result.model}|COST:${gCost}点`
      }
      return '图片生成暂不可用，请检查AI配置'
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
      if (result?.taskId && result.status === 'running') { await spendTokens(uid2, gvCost, 'agent_generate_video'); return `VIDEO_TASK:${result.taskId}|PROMPT:${gvPrompt}|COST:${gvCost}点` }
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
      await spendTokens(uid3, avCost, 'agent_create_ai_video')
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
      try {
        const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || ''
        const crawlRes = await fetch(`${baseUrl}/api/crawl?url=${encodeURIComponent(crawlUrl)}`, {
          headers: auth?.userId ? {} : {}, credentials: 'include', signal: AbortSignal.timeout(70000),
        })
        if (!crawlRes.ok) { const t = await crawlRes.text(); return `CRAWL_FAIL:抓取失败 HTTP ${crawlRes.status}` }
        const d = await crawlRes.json()
        const md = d?.data?.markdown || ''
        if (!md) return 'CRAWL_EMPTY:页面没有可提取的文本内容（可能是视频页/需要登录/动态加载）'
        const purpose = args.purpose ? `。抓取目的：${args.purpose}` : ''
        // 截断避免超 token，返回给 LLM 提炼
        return `CRAWL_RESULT:${md.substring(0, 15000)}|URL:${crawlUrl}${purpose}`
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
      if (!taskId) return '缺少 taskId'
      try {
        const r = await queryVideoTask(taskId)
        if (!r) return `VIDEO_PROGRESS:查询失败|TASK:${taskId}`
        if (r.status === 'completed' || r.status === 'SUCCEEDED' || r.status === 'done') {
          return `VIDEO_RESULT:${r.videoUrl || ''}`
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
          const list = items.map((m, i) => `${i + 1}. ${m.title} [${m.type}] ${m.url}`).join('\n')
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
            found.push(...items.map(m => ({ url: m.url, title: m.title })))
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
    case 'search_templates': {
      try {
        const params = new URLSearchParams()
        if (args.category) params.set('category', args.category)
        if (args.keyword) params.set('keyword', args.keyword)
        const res = await fetch(`${baseUrl}/api/prompt-templates?${params}`, {
          headers: auth ? { Authorization: `Bearer ${auth.userId}` } : {},
        })
        const data = await res.json()
        if (data.success && data.data?.length) {
          const items = data.data.slice(0, 6).map((t: any, i: number) =>
            `${i + 1}. ${t.title}${t.category ? ` [${t.category}]` : ''}`
          ).join('\n')
          return `TEMPLATE_RESULT:${data.data.length}个模板:\n${items}`
        }
        return 'TEMPLATE_RESULT:暂无匹配模板'
      } catch { return 'TEMPLATE_RESULT:模板查询失败' }
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
          `- 绑定平台账号：${socialCount} 个（${platformSet.join('、') || '无'}）`,
          `- 素材库：${assetCount} 条${assets.length ? '（最近：' + assets.map(a => a.title).join('、') + '）' : ''}`,
          `- AI 生成记录：${genCount} 条${recentGens.length ? '（最近：' + recentGens.map(g => g.type + (g.prompt ? '「' + g.prompt.slice(0, 12) + '」' : '')).join('、') + '）' : ''}`,
          `- 已发布任务可查客户端【指纹浏览器】队列。`,
        ].join('\n')
      } catch (e: any) { return 'PROJECT_OVERVIEW_ERROR:' + e.message }
    }

    // ── 发布 ──
    case 'publish_content': {
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
        const PLATFORM_LABEL: Record<string, string> = { douyin: '抖音', xiaohongshu: '小红书', kuaishou: '快手', shipinhao: '视频号', bilibili: 'B站' }
        const label = PLATFORM_LABEL[platform] || args.platform

        if (!auth?.userId) return 'PUBLISH_NEED_LOGIN:请先登录平台账号后再发布。'

        // 查该平台已绑定的指纹浏览器账号（bindType=manual）
        const accts = await prisma.socialAccount.findMany({
          where: { userId: auth.userId, platform },
          take: 5,
        })
        if (!accts.length) {
          return `PUBLISH_NEED_LOGIN:你还没有绑定${label}的指纹浏览器账号。请去【账号管理】登记一个 bindType=manual 的${label}账号，然后在【指纹浏览器】页启动并登录该平台（扫码），登录好之后就可以发布了。`
        }
        const list = accts.map(a => `- ${a.username}（${label}）`).join('\n')
        // C2 发布闭环（2026-08-05）：视频/文案齐备 → 创建发布任务，客户端自动发布（复用 7 平台脚本）
        const videoName = args.videoName || (typeof args.contentUrl === 'string' ? args.contentUrl.split('/').pop()?.split('?')[0] : '')
        const captionLine0 = args.caption ? `
📝 文案：${args.caption}` : ''
        if (videoName && args.caption) {
          try {
            const task = await prisma.agentPublishTask.create({
              data: {
                userId: auth.userId,
                platform,
                socialAccountId: accts[0]?.id || null,
                videoName,
                title: String(args.caption).slice(0, 80),
                description: String(args.caption),
                topics: JSON.stringify([]),
                status: 'pending',
              },
            })
            return `PUBLISH_QUEUED:已为「${label}」创建发布任务 #${task.id}（视频：${videoName}）。打开客户端【指纹浏览器】页会自动执行发布，也可在【应用 → 指纹浏览器】里查看队列。${captionLine0}`
          } catch (e: any) {
            return `PUBLISH_READY:创建发布任务失败（${e.message}），${label}已绑定账号：
${list}
👉 可手动去客户端【指纹浏览器】页发布。`
          }
        }
        const contentLine = args.contentUrl ? `\n📎 待发内容：${args.contentUrl}` : '\n📎 待发内容：还未确定，可从个人仓库选一个成片'
        const captionLine = args.caption ? `\n📝 文案：${args.caption}` : ''
        return `PUBLISH_READY:${label}已绑定 ${accts.length} 个指纹浏览器账号:\n${list}${contentLine}${captionLine}\n\n👉 告诉我要发哪个视频（素材仓库名）和文案，我直接创建发布任务；或去客户端【指纹浏览器】页手动发布。\n⚠️ 如果发布时提示「该账号未登录平台」，点账号卡片上的「🔓 去登录」扫码登录后重试（我不代你登录）。`
      } catch { return 'PUBLISH_READY:账号查询失败，请稍后重试' }
    }

    // ── 自动化 ──
    case 'automation_check': {
      try {
        const tasks = await prisma.automationTask.findMany({
          where: auth?.userId ? { createdBy: auth.userId } : {},
          orderBy: { createdAt: 'desc' }, take: 5,
        })
        if (tasks.length) {
          const list = tasks.map(t => `- [${t.status}] ${t.type}: ${t.params?.substring(0, 40)}`).join('\n')
          return `你有${tasks.length}个自动化任务:\n${list}`
        }
        return '暂无自动化任务。要创建吗？'
      } catch { return '自动化查询失败' }
    }

    // ── 长期记忆（融合 BaiLongma memory 模块）──
    case 'search_memory': {
      try {
        const { PrismaClient } = await import('@prisma/client')
        const prisma = new PrismaClient()
        const kw = (args.query || '').trim()
        const user = await prisma.user.findUnique({ where: { id: auth.userId }, select: { username: true } })
        const uid = user?.username || String(auth.userId)
        const rows = await prisma.agentMemory.findMany({
          where: {
            userId: uid,
            OR: kw ? [
              { content: { contains: kw } },
              { tags: { contains: kw } },
            ] : undefined,
          },
          orderBy: { salience: 'desc' },
          take: 8,
        })
        await prisma.$disconnect()
        if (!rows.length) return JSON.stringify({ found: false, hint: '没有相关记忆' })
        return JSON.stringify({ found: true, items: rows.map((r: any) => ({ content: r.content, tags: r.tags, salience: r.salience })) })
      } catch (e: any) {
        return JSON.stringify({ found: false, error: e.message })
      }
    }
    case 'upsert_memory': {
      try {
        const { PrismaClient } = await import('@prisma/client')
        const prisma = new PrismaClient()
        const content = (args.content || '').trim()
        if (!content) return JSON.stringify({ ok: false, error: '缺少内容' })
        const tags = Array.isArray(args.tags) ? args.tags.join(',') : (args.tags || '')
        const salience = Number(args.salience) || 0.5
        // 2026-08-06：AgentMemory.userId 存 username（非数字 id），统一口径才能查到
        const user = await prisma.user.findUnique({ where: { id: auth.userId }, select: { username: true } })
        const uid = user?.username || String(auth.userId)
        const existing = await prisma.agentMemory.findFirst({
          where: { userId: uid, content: { contains: content.substring(0, 20) } },
        })
        if (existing) {
          await prisma.agentMemory.update({ where: { id: existing.id }, data: { content, tags, salience, updatedAt: new Date() } })
        } else {
          await prisma.agentMemory.create({ data: { userId: uid, content, tags, salience } })
        }
        await prisma.$disconnect()
        return JSON.stringify({ ok: true })
      } catch (e: any) {
        return JSON.stringify({ ok: false, error: e.message })
      }
    }

    // ── 未接入需求收集 ──
    case 'collect_unmet_need': {
      try {
        const { PrismaClient } = await import('@prisma/client')
        const p = new PrismaClient()
        const user = await p.user.findUnique({ where: { id: auth.userId }, select: { username: true } })
        const userId = user?.username || String(auth.userId)
        const need = (args.need || '').trim()
        const platform = (args.platform || '').trim()
        const detail = (args.detail || '').trim()
        const content = `【未接入需求】平台/功能：${platform}；需求：${need}${detail ? `；细节：${detail}` : ''}`
        await p.agentMemory.create({
          data: { userId, content, tags: '未接入需求,平台', salience: 0.9 },
        })
        await p.$disconnect()
        return `UNMET_NEED:已记录|PLATFORM:${platform}|NEED:${need}`
      } catch (e: any) {
        return `UNMET_NEED_ERR:${e.message}`
      }
    }

    // ── 清空记忆（重新定义画像用）──
    case 'clear_memory': {
      try {
        const { PrismaClient } = await import('@prisma/client')
        const p = new PrismaClient()
        const user = await p.user.findUnique({ where: { id: auth.userId }, select: { username: true } })
        const userId = user?.username || String(auth.userId)
        const tag = (args.tag || '').trim()
        const where: any = { userId }
        if (tag) where.tags = { contains: tag }
        const n = await p.agentMemory.deleteMany({ where })
        await p.$disconnect()
        return JSON.stringify({ ok: true, deleted: n.count })
      } catch (e: any) {
        return JSON.stringify({ ok: false, error: e.message })
      }
    }

    // ── 设定助手名字/人设 ──
    case 'set_agent_profile': {
      try {
        const { PrismaClient } = await import('@prisma/client')
        const p = new PrismaClient()
        const userId = auth?.userId || ''
        const name = (args.name || '').trim()
        const persona = (args.persona || '').trim()
        if (!name && !persona) return JSON.stringify({ ok: false, error: '缺少名字或人设' })
        const content = `【助手人设】名字: ${name || '（未设）'}；人设: ${persona || '（未设）'}`
        // 更新或新建 agent_profile 记忆
        const existing = await p.agentMemory.findFirst({ where: { userId, tags: { contains: 'agent_profile' } } })
        if (existing) {
          await p.agentMemory.update({ where: { id: existing.id }, data: { content, updatedAt: new Date() } })
        } else {
          await p.agentMemory.create({ data: { userId, content, tags: 'agent_profile', salience: 1.0 } })
        }
        await p.$disconnect()
        return `AGENT_PROFILE_SET:名字=${name || '（通用）'}|人设=${persona || '（默认）'}`
      } catch (e: any) {
        return `AGENT_PROFILE_ERR:${e.message}`
      }
    }

    // ── 搜索全球真实热点（舆情，带降级）──
    case 'search_trends': {
      try {
        const keyword = (args.keyword || '').trim()
        if (!keyword) return JSON.stringify({ ok: false, error: '缺少关键词' })
        const scope = (args.platforms === 'domestic' || args.platforms === 'global') ? args.platforms : 'all'
        const { items, source } = await searchTrendsReal(keyword, scope as any, Number(args.count) || 8)
        const list = items.map((it, i) =>
          `${i + 1}. [${it.platform}] ${it.title}\n   ${it.description || ''}\n   链接: ${it.url}`
        ).join('\n')
        return `TRENDS_RESULT:来源=${source}\n${list}`
      } catch (e: any) {
        return `TRENDS_ERR:${e.message}`
      }
    }

    default:
      return `未知工具: ${name}`
  }
}

// ==================== 结果格式化 ====================

// 清理模型偶发吐出的工具调用 XML 脏标签（不同模型命名不一）
function stripToolCallTags(text: string): string {
  if (!text) return text
  return text
    .replace(/<function_calls?>/gi, '')
    .replace(/<\/function_calls?>/gi, '')
    .replace(/<tool_call(s)?>/gi, '')
    .replace(/<\/tool_call(s)?>/gi, '')
    .replace(/<invoke>/gi, '')
    .replace(/<\/invoke>/gi, '')
    .replace(/<tool_call\s+name="[^"]*">/gi, '')
    .replace(/<function_call\s+[^>]*>/gi, '')
    .replace(/<\/?tool_name>/gi, '')
    .replace(/<\/?parameters>/gi, '')
    .replace(/<parameter\s+name="[^"]*">/gi, '')
    .replace(/<\/parameter>/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function formatToolResult(output: string): string {
  if (output.startsWith('IMAGE_RESULT:')) {
    const url = output.split('|')[0]?.replace('IMAGE_RESULT:', '') || ''
    return `✅ 图片已生成！\n\n![图片](${url})\n\n[查看原图](${url})`
  }
  if (output.startsWith('IMAGE_LIST:')) {
    const data = output.replace('IMAGE_LIST:', '')
    try {
      const imgs = JSON.parse(data)
      return `🔍 找到以下图片:\n\n${imgs.map((i: any, n: number) => `${n + 1}. ${i.title || '图片'}\n   ![预览](${i.url})`).join('\n\n')}`
    } catch { return `🔍 找到相关图片\n${data}` }
  }
  if (output.startsWith('VIDEO_TASK:')) {
    const parts = output.split('|'); const taskId = parts[0]?.replace('VIDEO_TASK:', '') || ''; const prompt = parts.find(p => p.startsWith('PROMPT:'))?.replace('PROMPT:', '') || ''
    return `⏳ 视频正在生成...\n\n描述：${prompt}\n稍等2-5分钟后来问我"视频好了吗"查看`
  }
  if (output.startsWith('VIDEO_RESULT:')) {
    return `🎬 视频完成！\n\n[📥 下载](${output.replace('VIDEO_RESULT:', '')})`
  }
  if (output.startsWith('VIDEO_WEB:')) {
    const parts = output.replace('VIDEO_WEB:', '').split('\n')
    const url = parts[0]?.replace('TITLE:', '') || ''
    const yt = parts.find(p => p.startsWith('备选YouTube:'))?.replace('备选YouTube:', '') || ''
    return `📺 已为你打开外站视频播放（B站/YouTube 支持真播放）：\n\n🔗 ${url}${yt ? `\n🔗 ${yt}` : ''}\n\n（也可把具体视频链接发给我，我直接帮你播）`
  }
  if (output.startsWith('STORAGE_RESULT:')) return output.replace('STORAGE_RESULT:', '')
  if (output.startsWith('PERSONAL_RESULT:')) return output.replace('PERSONAL_RESULT:', '')
  if (output.startsWith('TEMPLATE_RESULT:')) return output.replace('TEMPLATE_RESULT:', '')
  if (output.startsWith('PUBLISH_NEED_LOGIN:')) return `⚠️ ${output.replace('PUBLISH_NEED_LOGIN:', '')}`
  if (output.startsWith('PUBLISH_READY:')) return output.replace('PUBLISH_READY:', '')
  if (output.startsWith('UNMET_NEED:')) {
    const plat = output.split('|').find(p => p.startsWith('PLATFORM:'))?.replace('PLATFORM:', '') || ''
    return `✅ 已记录你对「${plat}」的需求。该平台/能力目前还在接入中，我已为你登记，人工客服会尽快与你联系～\n\n（稍后我会把客服微信二维码推给你，方便直接沟通）`
  }
  if (output.startsWith('DH_TASK:')) { const taskId = output.split('|')[0]?.replace('DH_TASK:', '') || ''
    return `🤖 数字人口播已提交！\n任务ID: ${taskId}\n稍后问我"口播好了吗"查看进度`
  }
  if (output.startsWith('DH_NEED_MEDIA:')) return `📷 ${output.replace('DH_NEED_MEDIA:', '')}`
  if (output.startsWith('AGENT_PROFILE_SET:')) {
    const name = output.split('|').find(p => p.startsWith('名字='))?.replace('名字=', '') || ''
    const persona = output.split('|').find(p => p.startsWith('人设='))?.replace('人设=', '') || ''
    return `✅ 好的，以后我就是「${name}」啦${persona && persona !== '（默认）' ? `，性格：${persona}` : ''}～有什么运营上的事尽管吩咐！`
  }
  if (output.startsWith('TRENDS_RESULT:')) {
    const src = output.split('\n')[0]?.replace('TRENDS_RESULT:', '') || ''
    const list = output.split('\n').slice(1).join('\n')
    return `🌐 为你搜到以下真实热点（数据来源：${src}）：\n\n${list}\n\n需要我针对哪条帮你写文案或做成视频吗？`
  }
  if (output.startsWith('TRENDS_ERR:')) return `⚠️ 海外舆情服务暂不可用：${output.replace('TRENDS_ERR:', '')}`
  return output
}

// ==================== API 入口 ====================

// 从回复中提取并剥离 SCENE_JSON 场景卡片（2026-08-05：工具分支与纯聊天分支共用，
// 避免模型未调工具直接输出场景卡片时前端显示原文）
async function extractSceneFromReply(raw: string): Promise<{ reply: string; scene: any }> {
  let reply = raw
  let scene: any = null
  const sceneMatch = reply.match(/\[SCENE_JSON\]([\s\S]*?)\[\/SCENE_JSON\]/)
  if (sceneMatch) {
    try { scene = JSON.parse(sceneMatch[1]) } catch {}
    reply = reply.replace(sceneMatch[0], '').trim()
  }
  // 客服二维码场景：从 SystemConfig 读取 service_qrcode 并注入为图片卡片
  if (scene && scene.type === 'service_qrcode') {
    try {
      const cfg = await getSystemConfigs(['service_qrcode'])
      const qr = cfg?.service_qrcode || ''
      if (qr) {
        scene = { type: 'image', title: scene.title || '扫码联系客服', desc: scene.desc || '人工客服会尽快与你联系', url: qr }
      } else {
        scene = null // 未配置则不渲染，避免空图
      }
    } catch {
      scene = null
    }
  }
  return { reply, scene }
}

export async function POST(request: NextRequest) {
  const auth = getAuthFromHeaders(request)

  try {
    const body = await request.json()
    const { message, history = [], sessionId: sid, attachments, hotContext, onboarding, currentApp } = body

    if (!message || typeof message !== 'string' || !message.trim()) {
      return NextResponse.json({ success: false, message: '请输入消息' }, { status: 400 })
    }

    const userMessage = message.trim()

    // 组装附件：图像作为视觉块(image_url)让模型"看到"，视频等非图像以文本说明
    let userContent: any = userMessage
    if (attachments?.length) {
      const blocks: any[] = [{ type: 'text', text: userMessage }]
      for (const a of attachments as any[]) {
        if (typeof a.url === 'string' && (a.type || '').startsWith('image')) {
          blocks.push({ type: 'image_url', image_url: { url: a.url } })
        } else {
          blocks.push({ type: 'text', text: `\n[用户上传了附件:${a.type || 'file'}:${a.url}]` })
        }
      }
      userContent = blocks
    }

    // 读取用户给助手设定的名字/人设（agent_profile 记忆）
    // 用户级 AI 设置（2026-08-07：温度）
    let userTemperature = 0.7
    try {
      const u0 = await prisma.user.findUnique({ where: { id: auth?.userId || '' }, select: { agentTemperature: true } })
      if (typeof u0?.agentTemperature === 'number') userTemperature = u0.agentTemperature
    } catch {}
    let agentProfile: { name?: string; persona?: string } | undefined
    try {
      const profMem = await prisma.agentMemory.findFirst({
        where: { userId: auth?.userId || '', tags: { contains: 'agent_profile' } },
        orderBy: { updatedAt: 'desc' },
      })
      if (profMem) {
        const m = profMem.content.match(/名字[:：]\s*([^\n;；]+)/)
        const p = profMem.content.match(/人设[:：]\s*([^\n;；]+)/)
        agentProfile = { name: m?.[1]?.trim(), persona: p?.[1]?.trim() }
      }
    } catch {}
    // 自定义名称兜底（2026-08-07）：用户级 User.agentName > 全局 SystemConfig.agent_name
    try {
      if (!agentProfile?.name && auth?.userId) {
        const u = await prisma.user.findUnique({ where: { id: auth.userId }, select: { agentName: true } })
        if (u?.agentName) agentProfile = { name: u.agentName, persona: agentProfile?.persona }
      }
      if (!agentProfile?.name) {
        const cfg = await prisma.systemConfig.findUnique({ where: { key: 'agent_name' } })
        if (cfg?.value) agentProfile = { name: cfg.value, persona: agentProfile?.persona }
      }
    } catch {}

    // 2026-08-06：自动画像提取（不依赖模型调用工具——模型常口头答应但实际不写记忆）
    try {
      const pt = String(message || '')
      const platforms = ['抖音','快手','小红书','视频号','B站','微博','微信公众号','公众号','淘宝','拼多多','美团','饿了么','知乎','闲鱼']
      const foundPlat = platforms.find(p => pt.includes(p))
      const indMatch = pt.match(/(?:我|我们)(?:是|做|主营|主做|在(?:做|搞|经营))([\u4e00-\u9fa5]{2,12})(?:的|行业|生意|业务)?/)
      if (foundPlat || indMatch) {
        const { PrismaClient } = await import('@prisma/client')
        const pm = new PrismaClient()
        const u = await pm.user.findUnique({ where: { id: auth.userId }, select: { username: true } })
        const uid = u?.username || String(auth.userId)
        const parts: string[] = []
        if (indMatch) parts.push('行业/业务：' + indMatch[1])
        if (foundPlat) parts.push('主要平台：' + foundPlat)
        if (parts.length) {
          const content = parts.join('；')
          const exist = await pm.agentMemory.findFirst({ where: { userId: uid, content: { contains: content.substring(0, 8) } } })
          if (exist) {
            await pm.agentMemory.update({ where: { id: exist.id }, data: { content, tags: '画像,行业', salience: 0.9, updatedAt: new Date() } })
          } else {
            await pm.agentMemory.create({ data: { userId: uid, content, tags: '画像,行业', salience: 0.9 } })
          }
        }
        await pm.$disconnect()
      }
    } catch {}

    // 构建消息（Agnes 多模态对话格式）
    const sysBlocks: string[] = [buildSystemPrompt(agentProfile, onboarding === true)]
    // 2026-08-05：应用随行模式——用户在当前功能大屏内，让 AI 结合场景回答
    if (currentApp) sysBlocks.push(`【当前页面】用户正在使用「${currentApp}」应用（左侧功能大屏内操作）。请结合该应用场景简洁指导/回答，必要时给出下一步操作建议。`)
    if (hotContext && typeof hotContext === 'string' && hotContext.trim()) {
      sysBlocks.push(
        `\n【今日热点上下文（用户主页展示的真实热榜，可主动结合做内容，但只在相关时提及，不要每条都硬塞）】\n${hotContext}`
      )
    }
    const messages: AgentChatMessage[] = [
      { role: 'system', content: sysBlocks.join('\n') },
    ]
    for (const h of history.slice(-10)) {
      messages.push({ role: h.role === 'assistant' ? 'assistant' : 'user', content: h.content })
    }
    messages.push({ role: 'user', content: userContent })

    // Step 1: 多模态 + 工具调用
    // 2026-08-05：默认使用 DeepSeek（用户要求，本地无需海外代理）；仅当用户上传图片时
    // 才用 Agnes（多模态视觉），否则 DeepSeek 纯文本模型无法处理 image_url
    const hasImage = messages.some(m => Array.isArray(m.content) && (m.content as any[]).some((b: any) => b?.type === 'image_url'))
    const fcResult = hasImage
      ? await agnesChat(messages, AGENT_TOOLS)
      : await dashscopeFunctionCall(messages as any, AGENT_TOOLS, 2000, userTemperature)
    const toolCalls = fcResult.toolCalls || []
    // 2026-08-05：兼容 OpenAI 格式 tool_calls（百炼 qwen：{function:{name,arguments}}）与扁平格式（{name,arguments}）
    const normTool = (tc: any) => ({
      id: tc.id || '',
      name: tc.name || tc.function?.name || '',
      arguments: typeof tc.arguments === 'string' ? tc.arguments : (tc.function?.arguments ? String(tc.function.arguments) : '{}'),
    })
    const normCalls = toolCalls.map(normTool)

    if (normCalls.length > 0) {
      // 按 OpenAI 兼容格式回传 assistant(tool_calls) + tool(tool_call_id)
      messages.push({
        role: 'assistant',
        content: fcResult.content || '',
        tool_calls: normCalls.map((tc: any) => ({
          id: tc.id,
          type: 'function',
          function: { name: tc.name, arguments: tc.arguments },
        })),
      } as any)

      const steps: { tool: string; label: string }[] = []
      for (const tc of normCalls) {
        let args: Record<string, any> = {}
        try { args = JSON.parse(tc.arguments) } catch { args = {} }
        const stepLabel = TOOL_STEP_LABEL[tc.name] || tc.name
        steps.push({ tool: tc.name, label: stepLabel })
        console.log(`[Agent] 🔧 ${tc.name}`, JSON.stringify(args).substring(0, 100))
        const result = await executeToolCall(tc.name, args, auth)
        // #2 2026-08-12: 点数不足拦截（跳过模型，直接回复 + 弹「我的套餐」）
        if (typeof result === 'string' && result.startsWith('TOOL_REJECT:')) {
          const rejMsg = result.substring('TOOL_REJECT:'.length)
          return NextResponse.json({ success: true, data: {
            reply: '⚠️ ' + rejMsg + '——已为你打开「我的套餐」页面，可在其中开通套餐或购买点卡补充点数。',
            intent: 'no_quota', toolUsed: false, scene: { type: 'open_page', path: '/my-subscription', params: {} }, sessionId: session?.id || null, pointsSpent: 0,
          } })
        }
        messages.push({ role: 'tool', tool_call_id: tc.id, content: result } as any)
      }

      // Step 2: 回传结果（不再让模型二次决定调工具，直接用结果文本，避免脏标签）
      const finalResult = hasImage
        ? await agnesChat(messages, [])
        : await dashscopeFunctionCall(messages as any, [], 2000, userTemperature)
      const toolMsg = messages.filter(m => (m as any).role === 'tool').pop() as AgentChatMessage | undefined
      const toolRaw = toolMsg?.content
      const toolText = typeof toolRaw === 'string' ? toolRaw : (toolRaw ? JSON.stringify(toolRaw) : '')

      let reply: string
      // 若模型在 Step2 又返回了 tool_calls（异常），忽略它，用工具结果兜底，避免死循环与脏输出
      if (finalResult.toolCalls && finalResult.toolCalls.length > 0) {
        reply = formatToolResult(toolText)
      } else {
        reply = finalResult.content || formatToolResult(toolText)
      }
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
            intent: 'no_quota', toolUsed: false, scene: { type: 'open_page', path: '/my-subscription', params: {} }, sessionId: session?.id || null, pointsSpent: 0,
          } })
        }
        await spendTokens(auth.userId, TOKEN_COSTS.CHAT_PER_MSG, 'agent_chat')
      }
      return NextResponse.json({
        success: true,
        data: { reply, intent: toolCalls.map((t: any) => t.name), toolUsed: true, steps, scene, sessionId, pointsSpent: TOKEN_COSTS.CHAT_PER_MSG },
      })
    }

    // 纯聊天
    let reply = fcResult.content || '抱歉，AI服务暂时繁忙。'
    // 纯聊天分支同样解析 SCENE_JSON（2026-08-05：模型可能不调工具直接输出场景卡片）
    const extractedChat = await extractSceneFromReply(reply)
    reply = extractedChat.reply
    const scene = extractedChat.scene
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
    return NextResponse.json({
      success: true,
      data: { reply, intent: 'chat', toolUsed: false, sessionId, scene, pointsSpent: TOKEN_COSTS.CHAT_PER_MSG },
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

// DELETE: 删除会话
export async function DELETE(request: NextRequest) {
  const auth = getAuthFromHeaders(request)
  if (!auth) return NextResponse.json({ success: false, message: '请登录' }, { status: 401 })
  const url = new URL(request.url)
  const sessionId = parseInt(url.searchParams.get('sessionId') || '')
  if (!sessionId) return NextResponse.json({ success: false, message: '缺少会话ID' }, { status: 400 })
  try {
    await prisma.chatSession.deleteMany({ where: { id: sessionId, userId: auth.userId } })
    return NextResponse.json({ success: true })
  } catch (e: any) {
    return NextResponse.json({ success: false, message: e.message }, { status: 500 })
  }
}

// 强制动态渲染：API 路由依赖 request.headers / 鉴权，禁止 Next 在构建期静态预渲染
export const dynamic = 'force-dynamic'
