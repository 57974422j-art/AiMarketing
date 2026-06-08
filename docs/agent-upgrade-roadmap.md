# AiMarketing Agent 升级路线图

> 创建时间: 2026-06-08  
> 状态: 规划中（当前已完成 v1 基础版）  
> 目标: 让 Agent 成为真正能操作项目数据的"智能大脑"

---

## 一、当前状态 (v1 — 已完成)

### 已有能力

| 工具 | 功能 | 数据来源 | 是否用项目数据 |
|------|------|----------|---------------|
| `generate_copy` | 生成营销文案 | DeepSeek 凭空生成 | ❌ 纯AI编 |
| `generate_image` | AI生图 | 百炼/硅基API | ❌ 纯AI画 |
| `generate_video` | AI生视频 | 百炼 wan2.7 | ❌ 纯AI渲染 |
| `search_templates` | 搜索提示词模板 | ✅ 查 prompt-templates 表 | ✅ 用了 |
| `digital_human_info` | 数字人使用说明 | 固定文字 | ❌ |
| `chat` | 通用闲聊问答 | DeepSeek 对话 | ❌ |

### 技术架构
- **大脑**: DeepSeek-V3 (`deepseek-chat`) Function Calling
- **前端**: `/agent` 页面 (豆包风格对话UI)
- **后端**: `/api/agent/chat/route.ts`
- **核心文件**: 
  - `src/lib/ai-providers.ts` → `deepSeekFunctionCall()` 函数
  - `src/app/api/agent/chat/route.ts` → Agent 路由 + 工具定义
  - `src/app/agent/page.tsx` → 前端对话页面

### 已知问题
1. **工具不读数据库**：文案/图片/视频生成全靠AI凭空创作，不参考系统已有数据
2. **无热度推荐**：无法按点赞量/播放量等指标推荐热门内容
3. **无克隆能力**：客户说"帮我做一个类似的"无法实现
4. **采集视频无API**：CrawledVideo表有大量热度数据但没有查询接口
5. **前端展示单一**：只有纯文本聊天，没有卡片/图片/视频预览组件
6. **无多轮任务记忆**：每次请求独立，不能追踪"正在生成的视频"状态

---

## 二、最终目标

```
客户: "我想做一个美妆类的短视频"
         ↓
🔍 Agent 查询项目真实数据（多源聚合）
  → 采集视频(按热度排序) + 素材库 + 文案历史 + 提示词模板
         ↓
📋 推荐展示给客户（卡片式，含封面/标题/热度）
   ┌──────┐ ┌──────┐ ┌──────┐
   │ 🔥12万│ │ 🔥8万 │ │ 🔥5万 │
   │ 夏日..│ │ 抗老..│ │ 口红..│
   │ [克隆]│ │ [克隆]│ │ [克隆]│
   └──────┘ └──────┘ └──────┘
         ↓
客户: "第1个不错，帮我克隆一个"
         ↓
🧠 AI 分析特征 → 自动调用生成工具 → 输出结果
         ↓
客户: "不错，帮我发布到抖音"
         ↓
📡 自动推流/发布 → 完成闭环
```

---

## 三、升级路线图

### Phase 1: 数据接入层 (让Agent能读到项目数据)

#### Step 1.1 — 新增采集视频查询 API ⭐⭐⭐ 最优先

**目的**: 开通 CrawledVideo 表的查询能力，这是最有价值的推荐数据源（自带热度指标）

**缺失内容**: 目前 CrawledVideo 表没有任何 API 接口

**需要新建的文件**: `src/app/api/crawled-videos/route.ts`

```typescript
// GET /api/crawled-videos?platform=抖音&keyword=美妆&sortBy=likeCount&limit=10

// 需要实现的查询参数:
// - platform: 平台过滤 (抖音/小红书/快手/全部)
// - keyword: 标题关键词搜索
// - category: 分类标签过滤
// - sortBy: 排序方式 (likeCount/playCount/commentCount/shareCount/crawledAt)
// - limit: 返回数量 (默认10, 最大50)
// - minHeat: 最低互动数门槛

// 返回格式:
{
  success: true,
  data: {
    total: 128,
    items: [{
      id: number,
      platform: string,          // "抖音"
      videoId: string,
      title: string,             // 视频标题
      description: string | null,
      coverUrl: string | null,   // 封面图URL ← 展示用
      videoUrl: string | null,   // 视频地址
      authorName: string | null,
      // === 热度指标 ===
      playCount: number | null,
      likeCount: number | null,     // ← 主要排序依据
      commentCount: number | null,
      shareCount: number | null,
      collectCount: number | null,
      publishedAt: string | null,
      tags: string | null,        // JSON数组
      crawledAt: string           // 采集时间
    }]
  }
}
```

**涉及的数据表 (Prisma Schema 已有)**:
- `CrawledVideo` — 第695行开始定义
- 关联字段: `taskId`(→CrawlTask), `platform`, `videoId`, `title`, `description`, `coverUrl`, `videoUrl`, `authorUid`, `authorName`, `authorAvatar`, `likeCount`, `commentCount`, `shareCount`, `collectCount`, `playCount`, `publishedAt`, `tags`, `crawledAt`

**实现要点**:
1. 使用 Prisma 的 `findMany` + `where` + `orderBy` 查询
2. keyword 参数用 `contains` 模糊匹配 title 字段
3. 如果 tags 存的是JSON字符串，搜索时需解析匹配
4. 权限控制：admin/editor 可查全部，end-user 只查公共的或自己的
5. 注意 coverUrl 和 videoUrl 可能是临时链接，考虑是否要做转存

**依赖**: 无（Prisma + 现有表结构即可）

---

#### Step 1.2 — 新增热门话题查询 API

**目的**: 提供平台热榜趋势数据，辅助 Agent 给出时效性建议

**缺失内容**: CrawledTrending 表没有 API

**需要新建的文件**: `src/app/api/trending/route.ts`

```typescript
// GET /api/trending?platform=抖音&limit=20

// 返回格式:
{
  success: true,
  data: [{
    id: number,
    platform: string,          // "抖音"/"小红书"/"微博"
    rank: number,              // 热榜排名
    title: string,             // 话题标题
    heatValue: number,         // 热度值
    category: string | null,
    url: string | null,        // 原始链接
    crawledAt: string
  }]
}
```

**涉及的数据表**: `CrawledTrending` (Prisma Schema 中应存在，需确认字段)

**实现要点**: 按 `heatValue DESC` 或 `rank ASC` 返回最新一轮爬取的热榜

**依赖**: 无

---

#### Step 1.3 — 新增综合推荐 API (聚合多数据源) ⭐⭐ 核心

**目的**: 一个接口返回所有维度的推荐数据，Agent 只调一次就能拿到全面推荐

**需要新建的文件**: `src/app/api/agent/recommend/route.ts`

```typescript
// GET /api/agent/recommend?query=美妆短视频&type=all

// query: 用户自然语言查询（会被分词提取关键词）
// type: all/video/image/copy/template
// limit: 每类返回数量

// 返回格式:
{
  success: true,
  data: {
    query: "美妆短视频",
    keywords: ["美妆", "短视频", "美妆视频"],  // AI 分词结果
    
    // === 来自采集视频 (最热门) ===
    trending: [
      { id, platform, title, coverUrl, likeCount, playCount, ... }
    ],
    
    // === 来自素材库 (系统内已有的) ===
    library: [
      { id, title, ossUrl, type, category, createdAt, ... }
    ],
    
    // === 来自文案历史 (优质文案) ===
    copies: [
      { id, keywords, platform, style, result: { title, content, tags }, ... }
    ],
    
    // === 来自提示词模板 (创作灵感) ===
    templates: [
      { id, title, category, prompt, previewUrl, ... }
    ],
    
    // === 来自创意库 (已审核的优质内容) ===
    approved: {
      copies: [...],     // CopyTemplate where status='approved'
      videos: [...]      // VideoTemplate where isActive=true
    }
  }
}
```

**实现要点**:
1. 先对 query 做**简单关键词提取**（可先用空格/逗号分割，后续升级为LLM分词）
2. 并行调用4个子查询 (trending/library/copies/templates)
3. 每个子查询内部做模糊匹配 + 排序 + 截断
4. 汇总后统一返回

**依赖**: 需要 Step 1.1 和 1.2 完成；还需要现有的 media-library、ai-copy、prompt-templates、templates API

---

### Phase 2: Agent 工具扩展 (让Agent能用新数据)

#### Step 2.1 — 新增 `search_recommend` 工具

**位置修改**: `src/app/api/agent/chat/route.ts` 中的 AGENT_TOOLS 数组

**新增工具定义**:

```typescript
{
  name: 'search_recommend',
  description: '根据用户需求搜索和推荐平台热门内容和系统内的优质素材。当用户想做某类内容但不知道做什么方向时使用，或者用户问"有什么热门的"、"最近什么火"、"给我推荐一些"。会同时从多个维度推荐。',
  parameters: {
    type: 'object',
    properties: {
      query: { 
        type: 'string', 
        description: '用户的搜索意图，如"美妆短视频"、"口红推广"、"夏日营销"' 
      },
      focus: { 
        type: 'string', 
        enum: ['all', 'trending', 'library', 'copy', 'template'],
        description: '推荐侧重点，默认all全部' 
      },
      platform: {
        type: 'string',
        description: '目标平台，如抖音/小红书/快手'
      },
      limit: {
        type: 'number',
        description: '每类返回数量，默认5'
      }
    },
    required: ['query']
  }
}
```

**executeToolCall 新增 case**:

```typescript
case 'search_recommend': {
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || ''
  const params = new URLSearchParams({ query: args.query || '', limit: String(args.limit || 5) })
  if (args.focus && args.focus !== 'all') params.set('type', args.focus)
  if (args.platform) params.set('platform', args.platform)
  
  const res = await fetch(`${baseUrl}/api/agent/recommend?${params}`, {
    headers: auth ? { Authorization: `Bearer ${auth.userId}` } : {},
  })
  const data = await res.json()
  
  if (!data.success) return `RECOMMEND_RESULT:推荐查询失败，请稍后再试。`
  
  const d = data.data
  let output = `🔍 为您找到「${d.query}」相关的推荐:\n\n`
  
  if (d.trending?.length > 0) {
    output += `📺 **热门视频** (来自${d.trending[0]?.platform || '各平台'}):\n`
    d.trending.forEach((item: any, i: number) => {
      const hot = item.likeCount ? `🔥${(item.likeCount/10000).toFixed(1)}万赞` : ''
      output += `${i+1}. ${item.title} ${hot}\n`
    })
    output += '\n'
  }
  
  if (d.library?.length > 0) {
    output += `📦 **系统素材库**:\n`
    d.library.forEach((item: any, i: number) => {
      output += `${i+1}. ${item.title} [${item.type}] (${item.category})\n`
    })
    output += '\n'
  }
  
  if (d.copies?.length > 0) {
    output += `📝 **优质文案**:\n`
    d.copies.slice(0, 3).forEach((item: any, i: number) => {
      try {
        const r = typeof item.result === 'string' ? JSON.parse(item.result) : item.result
        output += `${i+1}. 【${r.title || item.keywords}】${r.content?.substring(0, 50)}...\n`
      } catch {
        output += `${i+1}. ${item.keywords}\n`
      }
    })
    output += '\n'
  }
  
  if (d.templates?.length > 0) {
    output += `💡 **创意模板**:\n`
    d.templates.forEach((item: any, i: number) => {
      output += `${i+1}. ${item.title} [${item.category}]\n`
    })
  }
  
  output += `\n告诉我你想要第几个，我来帮你进一步操作或克隆！`
  return `RECOMMEND_RESULT:${output}`
}
```

---

#### Step 2.2 — 新增 `analyze_and_clone` 工具

**这是核心差异化功能 — 让Agent能分析一个视频/文案的特征然后重新生成**

**新增工具定义**:

```typescript
{
  name: 'analyze_and_clone',
  description: '分析一个已有内容的特征（风格、结构、卖点），然后基于这些特征生成类似的新内容。当用户说"帮我做一个类似的"、"克隆这个"、"照着这个做一个"、"要这种风格的"时使用。',
  parameters: {
    type: 'object',
    properties: {
      sourceId: { 
        type: 'number', 
        description: '原始内容ID（来自推荐列表中的某个id）' 
      },
      sourceType: {
        type: 'string',
        enum: ['crawled_video', 'media_library', 'copy', 'template'],
        description: '原始内容的来源类型'
      },
      targetType: {
        type: 'string',
        enum: ['video', 'image', 'copy', 'digital_human'],
        description: '要生成的目标类型，默认video'
      },
      modifications: {
        type: 'string',
        description: '用户要求的修改点，如"换成口红产品"、"改成夏季主题"、保持原样则不填'
      }
    },
    required: ['sourceId', 'sourceType']
  }
}
```

**执行逻辑**:

```typescript
case 'analyze_and_clone': {
  const sourceId = args.sourceId
  const sourceType = args.sourceType  // crawled_video / media_library / copy / template
  const targetType = args.targetType || 'video'
  const modifications = args.modifications || ''
  
  // 1️⃣ 先获取原始内容数据
  let sourceData = null
  
  switch (sourceType) {
    case 'crawled_video':
      // 调用新API获取单个采集视频详情
      const cvRes = await fetch(`${baseUrl}/api/crawled-videos/${sourceId}`)
      sourceData = (await cvRes.json()).data
      break
      
    case 'media_library':
      // 从素材库获取（可能需要新增详情接口，或从list中筛选）
      break
      
    case 'copy':
      // 从文案历史获取
      const copyRes = await fetch(`${baseUrl}/api/ai-copy`)
      const copies = (await copyRes.json())
      sourceData = copies.find(c => c.id === sourceId)
      break
  }
  
  if (!sourceData) return 'CLONE_RESULT:找不到原始内容，请检查ID是否正确。'
  
  // 2️⃣ AI 分析特征
  const analysisPrompt = `你是内容分析师。请分析以下内容的特征，输出可用于重新生成的关键要素。

原始内容:
标题: ${sourceData.title}
描述: ${sourceData.description || ''}
标签: ${sourceData.tags || ''}
${sourceType === 'crawled_video' ? `热度: 点赞${sourceData.likeCount} 播放${sourceData.playCount}` : ''}

请以JSON格式输出（不要其他内容）:
{
  "style": "内容风格(如种草/测评/剧情/TVC)",
  "tone": "语调(如活泼专业幽默感性)",
  "keyPoints": ["核心卖点1", "核心卖点2"],
  "visualStyle": "视觉风格描述",
  "targetAudience": "目标人群",
  "suggestedPrompt": "基于以上特征，用于生成同类型新内容的提示词"
}
${modifications ? `\n用户额外要求: ${modifications}` : ''}`

  const analysis = await deepSeekFunctionCall(
    [{ role: 'user', content: analysisPrompt }],
    [], 2000
  )
  
  let features = {}
  try {
    const jsonMatch = analysis.content.match(/\{[\s\S]*\}/)
    features = jsonMatch ? JSON.parse(jsonMatch[0]) : {}
  } catch {}
  
  // 3️⃣ 基于分析结果调用对应生成工具
  let result = ''
  const prompt = features.suggestedPrompt || `${sourceData.title} 同款`
  
  switch (targetType) {
    case 'video':
      const vResult = await generateVideo(prompt, 5, '720P', '16:9')
      result = vResult?.taskId 
        ? `VIDEO_TASK:${vResult.taskId}|PROMPT:${prompt}`
        : `CLONE_RESULT:视频生成失败，请重试。`
      break
      
    case 'image':
      const iResult = await generateImage(prompt)
      result = iResult?.url 
        ? `IMAGE_RESULT:${iResult.url}|MODEL:${iResult.model}`
        : `CLONE_RESULT:图片生成失败，请重试。`
      break
      
    case 'copy':
      const cResult = await generateText(prompt)
      result = cResult || 'CLONE_RESULT:文案生成失败，请重试。'
      break
  }
  
  return `CLONE_RESULT:✅ 正在基于「${sourceData.title}」的特征为您生成${targetType === 'video' ? '视频' : targetType === 'image' ? '图片' : '文案'}...\n\n📊 特征分析:\n- 风格: ${features.style || '自动识别'}\n- 受众: ${features.targetAudience || '通用'}\n- 卖点: ${(features.keyPoints || []).join('、')}\n\n⏳ 生成中...请稍候。\n${result.startsWith('VIDEO_') ? '\n视频通常需要2-5分钟，之后问我"好了吗"' : ''}\n\n${result}`
}
```

---

#### Step 2.3 — 新增 `get_status` 工具

**目的**: 查询正在进行的异步任务状态（视频生成进度等）

**新增工具定义**:

```typescript
{
  name: 'get_task_status',
  description: '查询异步任务的执行状态，如视频生成进度。当用户问"好了吗"、"视频生成完了吗"、"查看进度"时使用。',
  parameters: {
    type: 'object',
    properties: {
      taskId: { type: 'string', description: '任务ID（可选，不传则查询所有进行中的）' },
      type: { type: 'string', enum: ['video', 'all'], description: '任务类型' }
    }
  }
}
```

**注意**: 当前数字人训练有轮询机制 (`/api/digital-human?id=xxx`)，视频生成任务也有 taskId。此工具需要汇总查询这些状态。
**可能需要**: 一个统一的任务状态查询接口或在 Agent 内部分别调用现有接口。

---

### Phase 3: 前端体验升级 (让展示更好)

#### Step 3.1 — 推荐卡片组件

**当前问题**: Agent 回复全是纯文本/Mardown，推荐的封面图只是个链接

**需要新建的文件**: `src/components/agent/recommend-card.tsx` + `src/components/agent/media-preview.tsx`

**功能**:
- 热门视频推荐 → 显示缩略图 + 标题 + 热度徽章 + "克隆"按钮
- 文案推荐 → 卡片样式显示标题+正文预览+标签
- 图片/视频结果 → 内嵌播放器/图片预览
- 点击"克隆"按钮 → 自动发送 `analyze_and_clone` 指令

**前端解析规则**: 在 `page.tsx` 的 `renderMessage` 中新增对特殊标记的解析：
- `RECOMMEND_CARD:id:type:json` → 渲染为推荐卡片
- `VIDEO_PLAYER:url` → 渲染为视频播放器
- `IMAGE_PREVIEW:url` → 渲染为图片预览（支持点击放大）

---

#### Step 3.2 — 任务进度实时展示

**功能**: 
- 视频生成中 → 显示进度条/动画
- 多步骤操作（分析→生成→保存）→ 显示 step indicator
- WebSocket 或轮询实时更新状态

**可选方案**: 
- 简单方案: 每5秒轮询 `/api/agent/task-status`
- 进阶方案: WebSocket 实时推送

---

#### Step 3.3 — 移动端优化

**当前**: 基本可用但未针对手机深度优化

**需要做的**:
- 输入框固定在底部（不随消息滚动消失）
- 图片/视频全屏预览（swiper）
- 推荐卡片横向滑动（一行多张）
- 长按复制/分享功能
- PWA manifest 配置（添加到主屏幕）

---

### Phase 4: 高级功能 (远期规划)

#### Step 4.1 — 发布链路打通

**新增工具**: `publish_to_platform`

```
用户: "帮我把这个发到抖音"
  → Agent 调用 push_to_live (推流到直播间)
  → 或 push_to_account (推送到客户端设备)
  → 或 未来: 抖音开放API直接发布
```

**前置条件**: 需要先完善直播引擎和客户端推送的稳定性

---

#### Step 4.2 — 数字人完整集成

**新增工具**: `clone_digital_human` / `speak_as_human`

```
用户: "帮我克隆我的形象"
  → 引导上传视频 (需前端支持文件上传)
  → 调用 /api/digital-human 训练
  → 训练完成通知

用户: "让数字人念这段话"
  → 调用口播视频生成
  → 返回视频结果
```

**前置条件**: 前端需要增加文件上传能力

---

#### Step 4.3 — 用户画像与个性化推荐

**功能**: 基于用户历史行为，主动推荐
- 用户常做美妆类 → 下次登录优先推荐美妆素材
- 用户偏好抖音 → 默认展示抖音热门
- 用户活跃时间段 → 推送最佳发布时机建议

**需要新增**: UserPreference 表 + 行为埋点

---

#### Step 4.4 — 多Agent协作 (远期)

```
主Agent (调度者)
  ├── 🎨 创意Agent (文案/图片/视频生成专家)
  ├── 📊 数据Agent (热点分析/竞品监控)
  ├── 🤖 数字人Agent (形象管理/口播)
  └── 📡 运营Agent (发布/排期/数据分析)
```

---

## 四、技术债务 & 待解决事项

| # | 问题 | 影响 | 建议 |
|---|------|------|------|
| 1 | `prompt-templates` 排序是 ASC（最早的在前）不是 DESC | 推荐旧模板 | 改为 ORDER BY createdAt DESC 或加 sort 参数 |
| 2 | `media-library` 用 Raw SQL 自建表，schema 不一致 | 维护风险 | 统一到 Prisma schema 或至少注释说明 |
| 3 | `CrawledVideo` coverUrl 可能是临时链接 | 封面图失效 | 转存到永久OSS或定期刷新 |
| 4 | 无统一任务管理表 | 无法跨模块追踪任务状态 | 新建 Task 表记录所有异步任务 |
| 5 | Agent 无持久化对话历史 | 刷新页面丢失上下文 | 存入 Conversation 表 |
| 6 | 无用量/配额控制 | 可能被滥用 | 加 rate limit + 每日次数限制 |

---

## 五、文件变更清单 (按实施顺序)

### Phase 1 — 数据层
| 序号 | 操作 | 文件路径 | 说明 |
|------|------|----------|------|
| 1.1 | **新建** | `src/app/api/crawled-videos/route.ts` | 采集视频查询API |
| 1.2 | **新建** | `src/app/api/trending/route.ts` | 热门话题查询API |
| 1.3 | **新建** | `src/app/api/agent/recommend/route.ts` | 综合推荐聚合API |

### Phase 2 — Agent工具层
| 序号 | 操作 | 文件路径 | 说明 |
|------|------|----------|------|
| 2.1 | **修改** | `src/app/api/agent/chat/route.ts` | 新增 search_recommend 工具 |
| 2.2 | **修改** | `src/app/api/agent/chat/route.ts` | 新增 analyze_and_clone 工具 |
| 2.3 | **修改** | `src/app/api/agent/chat/route.ts` | 新增 get_task_status 工具 |
| 2.4 | **修改** | `src/lib/ai-providers.ts` | 如需增强 deepSeekFunctionCall 能力 |

### Phase 3 — 前端层
| 序号 | 操作 | 文件路径 | 说明 |
|------|------|----------|------|
| 3.1 | **新建** | `src/components/agent/recommend-card.tsx` | 推荐卡片组件 |
| 3.2 | **新建** | `src/components/agent/media-preview.tsx` | 媒体预览组件 |
| 3.3 | **修改** | `src/app/agent/page.tsx` | 解析新标记+渲染组件 |

### Phase 4 — 高级功能
| 序号 | 操作 | 文件路径 | 说明 |
|------|------|----------|------|
| 4.1 | **修改** | `src/app/api/agent/chat/route.ts` | publish 工具 |
| 4.2 | **修改** | `src/app/agent/page.tsx` + route | 文件上传+数字人工具 |
| 4.3 | **新建** | Prisma schema | UserPreference 表 |
| 4.4 | 架构设计 | 多Agent调度器 | 远期 |

---

## 六、快速启动检查清单

开始实施前确认：

- [ ] `DEEPSEEK_API_KEY` 已配置且可用 ✅ (已完成)
- [ ] `CrawledVideo` 表有实际数据（运行过采集任务）
- [ ] 服务器内存/CPU足够支撑额外的LLM调用（DeepSeek很便宜但频率高了也要注意）
- [ ] 前端 `/agent` 页面已部署可访问 ✅ (已完成)
- [ ] 网络能访问 `api.deepseek.com` ✅ (已在用)
