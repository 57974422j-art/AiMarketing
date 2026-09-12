// 2026-09-12: 从 chat/route.ts 抽出——工具定义（纯数据，标准/自由模式共用）
// 拆分规划：本文件 = common（两种模式共用）；标准模式专属 = standard-flow 待抽；自由模式专属 = free-flow 待抽
import { ToolDefinition } from '@/lib/ai-providers'

export const AGENT_TOOLS: ToolDefinition[] = [
  {
    name: 'generate_copy',
    description: '为用户生成营销文案、广告语、社交媒体内容。',
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
    description: 'AI生成图片/海报。**v2 流程：生成前先调 search_templates 搜公共素材库推荐给用户选（用户选中的素材/模板 prompt 用于生成）；搜不到才直接生成。**前缀区分：用户说"打开AI生图/去生图页"是跳转（open_page /image-generator），不是生成——禁止调用本工具。**',
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
    description: 'AI生成视频（百炼 wan2.7）。注意：首次调用必须先报费用预估（不要带 confirmed），用户确认后再带 confirmed=true 真正生成；时长超过15秒会自动分段拼接（每段用上一段尾帧做参考，保证衔接）。**前缀区分：用户说"打开文生视频/去文生视频"是跳转页面（open_page /text-to-video），不是生成——禁止调用本工具。**',
    parameters: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: '视频内容描述' },
        duration: { type: 'number', description: '时长(秒)，默认5；单次上限15秒，超过15秒自动分段拼接' },
        ratio: { type: 'string', description: '比例：16:9横屏 / 9:16竖屏' },
        confirmed: { type: 'boolean', description: '用户是否已确认费用。false/缺省=只报预估；true=真正生成' },
        refImage: { type: 'string', description: '参考图 URL（图生视频/克隆用——用户发图时从消息里图片URL列表选一张传入；不传=文生视频）' },
        segModel: { type: 'string', description: '分段模型（仅>15s时用），可选 wan2.7-t2v / happyhorse-1.0-t2v，缺省自动' },
      }, required: ['prompt'],
    },
  },
  {
    name: 'generate_storyboard',
    description: '生成视频分镜脚本（只出方案，不生成视频）。根据用户视频创意输出分镜JSON（每镜：画面描述/英文prompt/时长/镜头感）+ 总费用预估。用户确认分镜后，再用 generate_video（confirmed=true）逐镜生成。**前缀区分：用户消息以"打开/去/进入"开头是跳转页面（open_page），不是生成——禁止调用本工具。**',
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
    description: '一句话 AI 成片：内部自动分镜并创建后台生成任务（无需用户先要分镜）。规则同 generate_video：首次调用不带 confirmed 只报费用预估，用户确认后带 confirmed=true 才真正分镜+建任务。返回任务ID，可用 query_storyboard 查进度。**前缀区分：用户说"打开一键成片/去一键成片"是跳转页面（open_page /auto-compile），不是做视频——禁止调用本工具。**',
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
    description: '网络搜图：查互联网上的图片、参考图、素材图。',
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
    description: '实时搜索互联网（Google，2026-08-07）。可搜网页/视频/新闻三种，视频会给出可播放的链接。',
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
    description: '抓取任意网页内容并转成 Markdown（2026-08-13，crawl4ai）。**用户消息中出现 http/https 链接时必须无条件调用（不要凭常识判断链接有效性/内容——抓了才知道）**。',
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
    description: '创建数字人口播视频：上传照片+选择声音+输入文案。**前缀区分：用户说"打开数字人/去数字人"是跳转页面（open_page /digital-human），不是生成口播——禁止调用本工具。**',
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
    description: '搜索项目素材库（MediaAsset，平台级素材：趋势视频/BGM/图片等）。制作日常内容时可主动调用挑选可用素材。注意：只返回数据库真实条目（标题/ID/条数）；没有时返回空，禁止编造素材清单。',
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
        description: '搜索并播放视频（本地库或外站），用户想看某类视频时用。',
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
    description: '列出用户个人仓库（OSS 私有存储）的文件，含用户自己上传的视频/图片。发布内容前可主动调用挑选成片；返回的每个文件带可直接使用的URL。',
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
    description: '搜索提示词模板库。**前缀区分："打开素材库/公共素材库"是跳转页面（open_page /media-library 或 /storage），不是搜模板——禁止调用本工具。**',
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
      description: '读取用户知识库文档（AI 智能体训练文档：产品介绍/项目说明/行业知识等）。返回文档标题+内容摘要，供回答引用。',
      parameters: { type: 'object', properties: { query: { type: 'string', description: '可选：想了解的关键词' } } },
    },
  {
      name: 'project_overview',
      description: '查看用户项目概况（绑定平台账号、素材数量、生成记录、套餐状态）。',
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
    description: '查询发布任务状态（Agent 创建的发布任务是否已执行/成功/失败）。返回最近发布任务列表及状态。',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'automation_check',
    description: '查看自动化任务和定时任务状态。',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', description: 'list(查看列表) / create(创建)' },
      },
    },
  },
  {
    name: 'search_memory',
    description: '回顾与用户相关的长期记忆（偏好、品牌信息、过往约定）。',
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
    description: '发布前抽视频帧给用户选封面。参数 videoName（仓库文件名）。抽 4 帧（开头/1/3/结尾）→ 返回 SCENE video_frames 卡片让用户选帧；用户选帧后（"用第N帧"）再基于该帧识别画面/推荐标题/设计封面。**禁止在未抽帧看画面前凭文件名/记忆生成封面标题。**',
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
export const TOOL_STEP_LABEL: Record<string, string> = {
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
