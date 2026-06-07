# 直播推流引擎使用指南

> **模块路径**: `/live` 页面 → 「📡 推流控制」Tab  
> **核心文件**: `src/lib/live-stream-engine.ts` | `src/app/api/live/stream/route.ts` | `src/app/live/page.tsx`  
> **技术方案**: 路线二 — 预渲染数字人视频 + FFmpeg RTMP 直推（MVP）  
> **执行位置**: AiMarketing 服务器（120.55.43.195:3000），非 Q1 / 非手机  

---

## 目录

- [一、架构概览](#一架构概览)
- [二、核心概念与数据模型](#二核心概念与数据模型)
- [三、前端操作指南](#三前端操作指南)
  - [3.1 推流控制面板](#31-推流控制面板)
  - [3.2 AI 一键生成内容](#32-ai一键生成内容)
  - [3.3 素材管理](#33-素材管理)
  - [3.4 使用流程速查表](#34-使用流程速查表)
- [四、API 接口参考](#四api接口参考)
  - [4.1 GET 查询类接口](#41-get查询类接口)
  - [4.2 POST 操作类接口](#42-post操作类接口)
  - [4.3 统一响应格式](#43统一响应格式)
- [五、引擎内部机制](#五引擎内部机制)
  - [5.1 FFmpeg 推流管道](#51-ffmpeg推流管道)
  - [5.2 内容生成管线](#52内容生成管线)
  - [5.3 反检测策略](#53反检测策略)
  - [5.4 会话持久化](#54会话持久化)
- [六、配置参数详解](#六配置参数详解)
- [七、数据存储结构](#七数据存储结构)
- [八、与其他模块的关系](#八与其他模块的关系)
- [九、常见问题 FAQ](#九常见问题-faq)
- [十、升级路线图](#十升级路线图)

---

## 一、架构概览

### 1.1 整体架构图

```
┌─────────────────────────────────────────────────────────────┐
│                    AiMarketing 服务器                         │
│                   (120.55.43.195:3000)                       │
│                                                              │
│  ┌──────────┐    ┌───────────────┐    ┌──────────────────┐  │
│  │ 前端页面   │───▶│ API Route     │───▶│ LiveStreamEngine │  │
│  │ /live     │    │ /api/live/    │    │ (核心引擎)        │  │
│  │ stream Tab│    │ stream        │    │                  │  │
│  └──────────┘    └───────┬───────┘    └────────┬─────────┘  │
│                          │                     │             │
│                          ▼                     ▼             │
│              ┌──────────────────┐   ┌──────────────────┐    │
│              │ ai-providers.ts   │   │ FFmpeg 子进程     │    │
│              │ ├ generateText()  │   │ (RTMP 推流)       │    │
│              │ ├ textToSpeech()  │   │                  │    │
│              │ └ digitalHumanV() │──▶│ concat 文件循环   │    │
│              │    (千寻 API)      │   │ libx264 编码      │    │
│              └──────────────────┘   │ flv 封装          │    │
│                                    │ rtmp://push...     │    │
│                                    └────────┬─────────┘    │
└─────────────────────────────────────────────┼──────────────┘
                                              │
                    ┌─────────────────────────┼──────────────┐
                    ▼                         ▼               ▼
            ┌──────────────┐         ┌────────────┐  ┌────────────┐
            │   抖音 CDN    │         │  快手 CDN   │  │  视频号 CDN │
            │  直播观众观看  │         │  直播观众观看 │  │ 直播观众观看 │
            └──────────────┘         └────────────┘  └────────────┘
```

### 1.2 数据流向

```
商品信息 / 品牌调性
       │
       ▼
  ┌──────────┐     ┌───────────┐     ┌──────────────┐
  │ LLM 话术 │ ──▶ │ TTS 语音  │ ──▶ │ 数字人视频合成  │
  │ 生成文案  │     │ 合成音频   │     │ (千寻 DashScope)│
  └──────────┘     └───────────┘     └──────┬───────┘
                                             │
                                             ▼
                                      ┌──────────────┐
                                      │ 素材池 (MP4)  │
                                      │ data/live-    │
                                      │ streams/clips │
                                      └──────┬───────┘
                                             │
                              播放列表编排 + Fisher-Yates 打乱
                                             │
                                             ▼
                                      ┌──────────────┐     ┌──────────────┐
                                      │ FFmpeg concat │────▶│ RTMP 推送     │
                                      │ 循环播放+编码   │     │ 到直播平台CDN │
                                      └──────────────┘     └──────────────┘
```

### 1.3 三层角色权限

| 角色 | 权限范围 | 说明 |
|------|---------|------|
| **admin** | 全部操作 | 推流启停、内容生成、素材管理 |
| **editor** | 全部操作 | 同 admin |
| **end-user** | 仅查看 GET 请求 | 无法启动推流或生成内容 |

> POST 请求在 API 层做了 `role === 'end-user'` 的拦截，返回 403。

---

## 二、核心概念与数据模型

### 2.1 StreamConfig — 推流配置

```typescript
interface StreamConfig {
  rtmpUrl: string           // 必填，RTMP 推流地址，如 rtmp://push.douyin.com/live/xxxx
  videoBitrate?: number     // 视频码率 bps，默认 2500000 (2.5Mbps)
  audioBitrate?: number     // 音频码率 bps，默认 128000 (128Kbps)
  fps?: number              // 帧率，默认 30
  resolution?: string       // 分辨率 WxH，默认 '1080x1920' (竖屏直播)
  targetDurationHours?: number // 目标时长(小时)，默认 4
  antiDetectSpeedVary?: boolean  // 反检测微变速开关，默认 true
  speedRange?: [number, number] // 微变速范围，默认 [0.995, 1.005] (±0.5%)
}
```

**默认值常量 `DEFAULT_CONFIG`：**

| 参数 | 默认值 | 适用场景 |
|------|--------|---------|
| videoBitrate | 2,500,000 bps (2.5Mbps) | 抖音推荐 1080P |
| audioBitrate | 128,000 bps (128Kbps) | 标准直播音质 |
| fps | 30 | 流畅直播帧率 |
| resolution | 1080x1920 | 竖屏手机直播 |
| targetDurationHours | 4 | 单次推流目标时长 |
| antiDetectSpeedVary | true | 开启反检测微变速 |
| speedRange | [0.995, 1.005] | ±0.5% 微变速范围 |

### 2.2 StreamSession — 推流会话

```typescript
interface StreamSession {
  id: string                // 会话唯一ID (时间戳_随机串)
  status: StreamStatus      // 当前状态: idle/preparing/streaming/stopping/error
  config: StreamConfig      // 本次推流的配置快照
  playlistId: string | null // 关联的播放列表ID
  pid: number | null        // FFmpeg 进程 PID (运行中时有值)
  startTime: string | null  // 推流开始时间 ISO
  endTime: string | null    // 推流结束时间 ISO
  durationSeconds: number   // 已推流秒数 (实时更新)
  bytesSent: number         // 已发送字节数
  error: string | null      // 错误信息
  lastHeartbeat: string     // 最后心跳时间 (FFmpeg 输出触发)
}
```

**状态流转：**

```
idle ──▶ preparing ──▶ streaming ──▶ stopping ──▶ idle
  │                                       │
  └─────────────────── error ◀────────────┘
                        │
                        ▼ (重试)
                       idle
```

### 2.3 StreamClip — 视频片段（素材）

```typescript
interface StreamClip {
  id: string       // 片段唯一ID
  type: ClipType   // 片段类型（见下方）
  filePath: string // 本地 MP4 文件绝对路径
  duration: number // 时长(秒)，粗估值 (文件大小/500KB/s)
  text?: string    // 原始文案
  productId?: string // 关联商品ID
  priority: number  // 播放优先级
  createdAt: string // 创建时间
}
```

**支持的片段类型 (`ClipType`)：**

| 类型 | 用途 | 建议时长 |
|------|------|---------|
| `welcome` | 开场欢迎语 | 15-20 秒 |
| `product_intro` | 产品介绍口播 | 30-60 秒 |
| `qa` | 问答回复 | 10-20 秒 |
| `hard_sell` | 逼单/促销话术 | 15-30 秒 |
| `close` | 结束语 | 10-15 秒 |
| `gift_thank` | 感谢送礼 | 5-10 秒 |
| `follow_welcome` | 关注感谢语 | 5-10 秒 |
| `interactive_prompt` | 互动引导 | 10-15 秒 |
| `bgm_change` | BGM 切换过渡 | 3-5 秒 |

### 2.4 Playlist — 播放列表

```typescript
interface Playlist {
  id: string           // 播放列表唯一ID
  name: string         // 名称，如 "直播_1749234567_abc123"
  roomId: number | null // 关联直播间ID
  clips: StreamClip[]  // 有序片段列表
  totalDuration: number // 总时长(秒)
  createdAt: string    // 创建时间
}
```

### 2.5 ContentGenTask — 内容生成任务

```typescript
interface ContentGenTask {
  id: string                           // 任务唯一ID
  status: 'pending' | 'generating' | 'completed' | 'failed'
  type: 'batch' | 'single'             // 批量 or 单条
  items: ContentGenItem[]              // 生成项列表
  progress: { done: number; total: number } // 进度计数器
  outputDir: string                    // 输出目录 (clips/{taskId}/)
  error: string | null                 // 任务级错误
  startedAt: string                    // 开始时间
  completedAt: string | null           // 完成时间
}
```

**子项 ContentGenItem：**

```typescript
interface ContentGenItem {
  id: string           // 项ID (taskId_idx)
  text: string         // 待合成的文案内容
  type: string         // 片段类型
  avatarId: string     // 数字人形象ID
  background?: string  // 自定义背景图URL
  status: 'pending' | 'generating' | 'completed' | 'failed'
  outputPath?: string  // 本地MP4输出路径 (完成后有值)
  taskId?: string      // 千寻异步任务ID (提交后获得)
  error?: string       // 项级错误信息
}
```

---

## 三、前端操作指南

### 3.1 推流控制面板

进入 `/live` 页面 → 选择一个直播间 → 点击 Tab 栏的 **「📡 推流控制」**。

#### 3.1.1 RTMP 地址输入

```
┌──────────────────────────────────────────────────┐
│  RTMP 推流地址 *                                  │
│  ┌────────────────────────────────────────────┐  │
│  │ rtmp://push.douyin.com/live/xxxxx          │  │
│  └────────────────────────────────────────────┘  │
│  从抖音/快手直播后台获取推流地址                   │
└──────────────────────────────────────────────────┘
```

**如何获取各平台 RTMP 地址：**

| 平台 | 获取路径 | 格式示例 |
|------|---------|---------|
| **抖音** | 抖音创作者中心 → 直播管理 → 开始直播 | `rtmp://push.douyin.com/live/xxxxx?streamname=xxx&sdkappid=xxx` |
| **快手** | 快手创作者后台 → 直播 → OBS 推流 | `rtmp://live-push.zj.kwbsy.com/live/xxx?xxx` |
| **视频号** | 微信视频号工具 → 直播推流地址 | `rtmp://videocall.weixin.qq.com/live/xxx` |

> **注意**: RTMP 地址是一次性的！每次开播都会重新生成新地址。不要复用旧地址。

#### 3.1.2 数字人形象 ID

```
┌──────────────────────────────────────────────────┐
│  数字人形象 ID                                     │
│  ┌────────────────────────────────────────────┐  │
│  │ avt_xxxxxxxxxxxxxxxxxxxxxxxxxxx            │  │
│  └────────────────────────────────────────────┘  │
│  在数字人板块克隆形象后获取                        │
└──────────────────────────────────────────────────┘
```

**获取方式：**
1. 进入项目中的「数字人」板块
2. 上传照片进行形象克隆训练
3. 训练完成后复制返回的 `avatarId`（格式通常为 `avt_` 开头）

#### 3.1.3 启动/停止按钮

| 按钮 | 条件 | 行为 |
|------|------|------|
| 📹 **开始推流** | RTMP 已填写 & 状态为 idle/error | 调用 `start-stream` API，启动 FFmpeg 子进程 |
| ⏹ **停止推流** | 状态为 streaming | 调用 `stop-stream` API，优雅关闭 FFmpeg |
| 🔄 **刷新素材列表** | 存在会话时可用 | 调用 `action=clips` 重新加载素材 |

#### 3.1.4 会话信息面板

推流成功后显示：

```
┌──────────────────────────────────────────────────────────────┐
│ Session: 1749234567_abc123  状态: streaming  时长: 01:23:45  │
│ PID: 12345                                                 │
│ 开始: 2026-06-07 16:30:00                                   │
└──────────────────────────────────────────────────────────────┘
```

| 字段 | 说明 |
|------|------|
| Session | 推流会话 ID，用于后续 stop/status 操作 |
| 状态 | idle/preparing/streaming/stopping/error |
| 时长 | 已推流时长 HH:MM:SS（从 FFmpeg 输出解析） |
| PID | FFmpeg 子进程号（用于调试和手动 kill） |
| 错误 | 出错时显示具体错误信息 |

### 3.2 AI 一键生成内容

这是最核心的功能入口——**从零到直播素材的一键流水线**。

#### 3.2.1 商品输入格式

每行一个商品，用 `|` 分隔字段：

```
名称|价格|特点1,特点2,特点3
```

**示例输入：**
```
面膜补水保湿|99元|深层补水,敏感肌可用,孕妇适用
精华液抗老|199元|烟酰胺,提亮肤色,抗氧化
防晒霜SPF50|79元|防水防汗,清爽不油腻,广谱防护
洁面慕斯|59元|温和清洁,泡沫丰富,洗后不紧绷
```

> 如果不填商品信息，AI 将生成通用欢迎语/结束语等不依赖商品的通用内容。

#### 3.2.2 品牌调性选择

| 选项 | 适用场景 | AI 输出风格 |
|------|---------|------------|
| **亲切热情** | 日用品/美妆/食品 | "家人们好！" "这款真的绝了~" |
| **专业严谨** | 数码/医疗/金融 | "根据测试数据..." "核心参数如下..." |
| **幽默活泼** | 潮牌/游戏/娱乐 | "兄弟们看这个！" "笑不活了家人们" |
| **高端奢华** | 奢侈品/珠宝/护肤 | "匠心独运的工艺..." "为您呈现非凡体验..." |

#### 3.2.3 点击「🎬 AI 生成」

点击后的完整流程（用户只需等待）：

```
[AI-GEN] 开始 AI 内容生成...
  ↓
Step 1: LLM 生成结构化 JSON 话术 (~3-5秒)
  ↓
Step 2: 解析 JSON → 提取 8-12 条口播文本
  ↓
Step 3: 并发调用千寻数字人 API (最多3个同时生成)
  ├── item_0: welcome → 提交任务... ✓ 完成
  ├── item_1: product_intro → 提交任务... ✓ 完成
  ├── item_2: product_intro → 提交任务... ✓ 完成
  ├── ... (每个约 30-60 秒)
  └── item_N: close → 提交任务... ✓ 完成
  ↓
Step 4: 下载所有生成的 MP4 视频 → 保存到本地
  ↓
[OK] AI 生成完成: 10/10 条 → 自动加载到素材列表
```

**进度显示:** 按钮文字会变为 `⏳ 3/10` 表示已完成 3/10 个片段。

#### 3.2.4 生成的素材预览

```
已生成素材 (10 个片段)          总时长约 7 分钟

 1. welcome           18s   abc12345
 2. product_intro     45s   def67890
 3. product_intro     38s   ghi11234
 4. qa                22s   jkl56789
 5. hard_sell         25s   mno90123
 ...
10. close             14s   xyz78901
```

### 3.3 素材管理

| 操作 | 方式 | 说明 |
|------|------|------|
| 查看所有素材 | `GET ?action=clips` | 返回所有已生成的 MP4 片段 |
| 查看指定任务的素材 | `GET ?action=clips&taskId=xxx` | 只返回某次生成任务的素材 |
| 创建播放列表 | `POST action=create-playlist` | 手动挑选片段组成列表 |
| 打乱播放顺序 | `POST action=shuffle` | Fisher-Yates 洗牌算法，反检测用 |
| 刷新素材列表 | 点击面板内「🔄 刷新素材列表」按钮 | 重新加载最新素材到前端 |

### 3.4 使用流程速查表

```
╔══════════════════════════════════════════════════════════╗
║  第一步: 准备形象                                           ║
║  数字人板块 → 克隆形象 → 复制 avatarId                      ║
╠══════════════════════════════════════════════════════════╣
║  第二步: 生成素材                                           ║
║  填入 avatarId → 填入商品信息 → 选品牌调性 → 点 AI 生成     ║
╠══════════════════════════════════════════════════════════╣
║  第三步: 获取推流地址                                        ║
║  抖音/快手/视频号后台 → 开始直播 → 复制 RTMP 地址           ║
╠══════════════════════════════════════════════════════════╣
║  第四步: 开始推流                                           ║
║  填入 RTMP 地址 → 点「开始推流」→ 看到 ● 直播中              ║
╠══════════════════════════════════════════════════════════╣
║  第五步: 监控与结束                                         ║
║  观察会话信息 → 手机打开直播间验证 → 结束时点「停止推流」     ║
╚══════════════════════════════════════════════════════════╝
```

---

## 四、API 接口参考

基础路径: `/api/live/stream`  
认证方式: JWT Cookie (`credentials: 'include'`)

### 4.1 GET 查询类接口

#### 4.1.1 查询推流状态

```
GET /api/live/stream?action=status
GET /api/live/stream?action=status&sessionId=1749234567_abc123
```

**无 sessionId**: 返回所有历史会话数组  
**有 sessionId**: 返回指定会话详情

**Response (单条):**
```json
{
  "success": true,
  "data": {
    "id": "1749234567_abc123",
    "status": "streaming",
    "config": { "rtmpUrl": "rtmp://...", ... },
    "playlistId": "pl_xxx",
    "pid": 12345,
    "startTime": "2026-06-07T08:30:00.000Z",
    "endTime": null,
    "durationSeconds": 5025,
    "bytesSent": 157286400,
    "error": null,
    "lastHeartbeat": "2026-06-07T09:13:45.000Z"
  }
}
```

**Response (多条):** `data` 为 `StreamSession[]` 数组，按 `startTime` 降序排列。

#### 4.1.2 查询素材列表

```
GET /api/live/stream?action=clips
GET /api/live/stream?action=clips&taskId=task_1749234567_def
```

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "task_xxx_0",
      "type": "welcome",
      "filePath": "/root/AiMarketing/data/live-streams/clips/task_xxx/task_xxx_0.mp4",
      "duration": 18,
      "text": "家人们大家好！欢迎来到今天的直播间...",
      "priority": 0,
      "createdAt": "2026-06-07T08:25:00.000Z"
    }
  ]
}
```

> **duration 是粗估值**: 通过 `文件大小 ÷ 500KB/s` 估算。如需精确值可在后续版本接入 ffprobe。

#### 4.1.3 查询播放列表

```
GET /api/live/stream?action=playlists          // 所有列表
GET /api/live/stream?action=playlist&id=pl_xxx // 单个列表
```

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "pl_xxx",
      "name": "直播_1749234567_abc123",
      "roomId": null,
      "clips": [...],
      "totalDuration": 420,
      "createdAt": "2026-06-07T08:26:00.000Z"
    }
  ]
}
```

### 4.2 POST 操作类接口

#### 4.2.1 启动推流

```
POST /api/live/stream
Content-Type: application/json

{
  "action": "start-stream",
  "rtmpUrl": "rtmp://push.douyin.com/live/xxxxx?...",
  "videoBitrate": 2500000,        // 可选
  "audioBitrate": 128000,         // 可选
  "fps": 30,                       // 可选
  "resolution": "1080x1920",       // 可选
  "targetDurationHours": 4,        // 可选
  "playlistId": "pl_xxx",          // 可选，已有播放列表时传
  "clips": [...]                   // 可选，直接传入片段列表
}
```

**必填:** `rtmpUrl`  
**可选参数:** 不传则使用默认值（见第六章配置参数详解）

**Response:**
```json
{
  "success": true,
  "message": "✅ 推流已启动 (session=1749234567_abc123)",
  "data": { /* StreamSession 对象 */ }
}
```

**错误场景:**
| HTTP Code | Message | 场景 |
|-----------|---------|------|
| 401 | 未认证 | 缺少有效 Cookie |
| 403 | 无权操作 | end-user 角色 |
| 400 | 缺少 rtmpUrl 推流地址 | body 中没有 rtmpUrl 字段 |
| 500 | 推流地址必须以 rtmp:// 开头 | URL 校验失败 |
| 500 | 没有可用的播放内容 | 既没有 playlistId 也没有 clips |

#### 4.2.2 停止推流

```
POST /api/live/stream
{ "action": "stop-stream", "sessionId": "1749234567_abc123" }
```

**Response:**
```json
{
  "success": true,
  "message": "✅ 推流已停止",
  "data": { /* 更新后的 StreamSession, status='idle' */ }
}
```

**停止流程:**
1. 向 FFmpeg stdin 写入 `'q'` 字符（FFmpeg 优雅退出命令）
2. 设置 5 秒超时的强制 kill（SIGTERM）
3. 等待进程 exit 事件
4. 更新 session 状态为 `idle` 并持久化

#### 4.2.3 批量生成素材（已有文案）

适用于已经准备好文案文本的场景，跳过 LLM 生成步骤。

```
POST /api/live/stream
Content-Type: application/json

{
  "action": "generate",
  "items": [
    {
      "text": "欢迎来到我们的直播间！今天给大家带来超值福利~",
      "type": "welcome",
      "avatarId": "avt_xxx",
      "background": "https://example.com/bg.jpg"  // 可选
    },
    {
      "text": "这款面膜采用了三重玻尿酸配方，深层补水直达肌底...",
      "type": "product_intro",
      "avatarId": "avt_xxx"
    },
    // ... 更多条目
  ]
}
```

**Response:**
```json
{
  "success": true,
  "message": "内容生成完成 (5/5)",
  "data": { /* ContentGenTask 对象 */ }
}
```

#### 4.2.4 AI 一键生成（商品→话术→视频）

这是最常用的全自动化入口。

```
POST /api/live/stream
Content-Type: application/json

{
  "action": "ai-generate",
  "avatarId": "avt_xxx",
  "brandTone": "亲切热情",
  "products": [
    { "name": "面膜补水保湿", "price": "99元", "features": ["深层补水", "敏感肌可用"] },
    { "name": "精华液抗老", "price": "199元", "features": ["烟酰胺", "提亮肤色"] }
  ],
  "scriptTypes": ["welcome", "product_intro", "qa", "hard_sell", "close"],
  "background": "https://example.com/bg.jpg"  // 可选
}
```

**字段说明:**

| 字段 | 必填 | 说明 |
|------|------|------|
| avatarId | ✅ | 数字人形象 ID（从数字人板块获取） |
| brandTone | ❌ | 品牌调性，默认 "亲切热情" |
| products | ❌ | 商品数组，不填则生成通用话术 |
| scriptTypes | ❌ | 要生成的话术类型数组，默认全部 5 种 |
| background | ❌ | 统一背景图 URL，不填使用默认 |

**支持的 scriptTypes 值:**

| 类型 | 说明 | 默认包含 |
|------|------|---------|
| `welcome` | 开场欢迎语 | ✅ |
| `product_intro` | 产品介绍口播 | ✅ |
| `qa` | 常见问答回复 | ✅ |
| `hard_sell` | 逼单促销话术 | ✅ |
| `close` | 结束收尾语 | ✅ |

**Response:** 同 4.2.3

#### 4.2.5 创建播放列表

```
POST /api/live/stream
{
  "action": "create-playlist",
  "name": "我的直播列表",
  "roomId": 1,
  "clips": [{ "id": "...", "type":"welcome", "filePath":"...", "duration":18, ... }]
}
```

#### 4.2.6 打乱播放顺序

```
POST /api/live/stream
{ "action": "shuffle", "playlistId": "pl_xxx" }
```

> 每次开播前建议调用此接口，避免每次播放顺序相同被平台检测为录播。

### 4.3 统一响应格式

**成功:**
```json
{ "success": true, "message": "操作说明", "data": { ... } }
```

**失败:**
```json
// 认证问题
{ "success": false, "message": "未认证" }          // HTTP 401
{ "success": false, "message": "无权操作" }         // HTTP 403

// 业务问题
{ "success": false, "message": "缺少 rtmpUrl" }     // HTTP 400

// 服务端异常
{ "success": false, "message": "具体错误原因" }     // HTTP 500
```

---

## 五、引擎内部机制

### 5.1 FFmpeg 推流管道

#### 5.1.1 构建命令行

当调用 `startStream()` 时，引擎自动构建以下 FFmpeg 命令：

```
ffmpeg -re \
  -f concat -safe 0 \
  -i /path/to/concat_1749234567.txt \        # concat 输入文件
  -filter_complex '[0:v]setPTS=PTS*0.9978[v];[0:a]atempo=0.9978[a]' \  # 微变速 (可选)
  -map '[v]' -map '[a]' \                     # 映射变速后的流
  -c:v libx264 -preset fast \                 # H.264 编码
  -b:v 2500000 \                               # 2.5Mbps 码率
  -maxrate 2695000 \                            // +7.8% 峰值
  -buf_size 3332500 \                           // 133% buffer
  -g 60 \                                       # GOP = 2秒 (30fps*2)
  -r 30 \                                        # 输出帧率
  -vf 'scale=1080:1920:...' \                   # 分辨率缩放 (可选)
  -c:a aac -b:a 128000 -ar 44100 \             # AAC 音频
  -f flv rtmp://push.douyin.com/live/xxxxx      # RTMP 输出
```

#### 5.1.2 Concat 文件格式

FFmpeg concat demuxer 要求的输入文件：

```
file '/root/AiMarketing/data/live-streams/clips/task_xxx/welcome.mp4'
file '/root/AiMarketing/data/live-streams/clips/task_xxx/product_1.mp4'
file '/root/AiMarketing/data/live-streams/clips/task_xxx/product_2.mp4'
file '/root/AiMarketing/data/live-streams/clips/task_xxx/qa.mp4'
file '/root/AiMarketing/data/live-streams/clips/task_xxx/hard_sell.mp4'
file '/root/AiMarketing/data/live-streams/clips/task_xxx/close.mp4'
```

> FFmpeg 会按顺序循环播放这些文件，实现无限时长直播。

#### 5.1.3 关键参数解释

| 参数组 | 值 | 为什么这样设置 |
|--------|---|--------------|
| `-re` | 以原始帧率读取 | 模拟实时采集，不会加速播放 |
| `-preset fast` | 快速编码 | 平衡 CPU 占用和压缩质量 |
| `-maxrate +7.8%` | VBR 峰值 | 抖音/快手推荐，防止码率突增导致断流 |
| `-buf_size 133%` | 缓冲区大小 | 配合 maxrate 使用 |
| `-g 60` | GOP 2秒 | 每 2 秒一个关键帧，保证画质切换及时 |
| `-f flv` | FLV 封装 | RTMP 协议要求 FLV 容器 |

### 5.2 内容生成管线

#### 5.2.1 AI 话术生成 (LLM)

**Prompt 结构:**

```
你是一个专业的电商直播话术师。请根据以下要求生成直播话术。

品牌调性: 亲切热情
需要的话术类型: welcome, product_intro, qa, hard_sell, close

商品信息:
1. 面膜补水保湿 (¥99) — 特点: 深层补水, 敏感肌可用

请严格按以下 JSON 格式返回：
{
  "welcome": ["欢迎语1"],
  "product_intro": [{"text": "...", "productName": "..."}],
  "qa": [{"q": "...", "a": "..."}],
  "hard_sell": ["逼单话术"],
  "close": ["结束话术"]
}
```

**解析策略:**
- 优先尝试 `JSON.parse()` 解析完整 JSON
- 解析失败时逐行提取（每行 > 5 字符的视为独立话术）
- QA 类型的 Q 和 A 会合并为一段文本

#### 5.2.2 TTS + 数字人视频

对每一条话术文本：

```
text (文案)
  │
  ▼
generateDigitalHumanVideo(avatarId, text, background?)
  │
  ├── 内部调用: 千寻 DashScope 数字人 API
  ├── 返回: { taskId: "dash_xxx" } (异步提交)
  │
  ▼
pollDHResult(taskId, 120)  // 最多轮询 120 次 (240秒)
  │
  ├── PENDING/RUNNING → 等 2 秒继续轮询
  ├── FAILED → 返回 null (该项标记 failed)
  └── SUCCEEDED → 返回 { videoUrl: "https://..." }
       │
       ▼
downloadFile(videoUrl, localPath)  // 下载 MP4 到服务器本地
```

**并发控制:** 最多同时 3 个数字人生成任务 (`MAX_CONCURRENT_DH = 3`)

### 5.3 反检测策略

#### 5.3.1 微变速

每次启动推流时，随机选取一个速度因子：

```
factor = random(0.995 ~ 1.005)  // 即正常速度的 99.5% ~ 100.5%
```

应用到 FFmpeg filter:
```
video: setPTS = PTS × factor     (调整视频 PTS 时间戳)
audio: atempo = factor           (调整音频播放速度)
```

效果：每小时产生约 ±18 秒的时间漂移，避免精确循环特征。

#### 5.3.2 播放顺序打乱

Fisher-Yates 洗牌算法，每次开播前通过 `shufflePlaylist()` 调用打乱片段顺序。

#### 5.3.3 内容多样性（规划中）

未来可扩展的反检测手段：

| 手段 | 状态 | 说明 |
|------|------|------|
| ✅ 微变速 | 已实现 | ±0.5% 随机速度变化 |
| ✅ 顺序打乱 | 已实现 | Fisher-Yates 洗牌 |
| ⏳ BGM 轮换 | 规划中 | 多首 BGM 随机插入 |
| ⏳ 插播片段 | 规划中 | 定期插入真人巡逻/互动画面 |
| ⏳ 动态水印 | 规划中 | 时间戳/滚动文字水印 |
| ⏳ 弹幕模拟 | 规划中 | 模拟真实弹幕密度 |

### 5.4 会话持久化

```
data/live-streams/
├── session_{id}.json        # 推流会话状态文件
├── concat_{uid}.txt         # FFmpeg concat 输入文件 (临时)
├── clips/                   # 素材目录
│   └── {taskId}/            # 每次生成任务一个目录
│       ├── {item_id}.mp4    # 数字人口播视频
│       └── ...
└── playlists/               # 播放列表
    └── playlist_{id}.json   # 播放列表数据
```

**内存 vs 文件:**
- `activeSessions` Map: 内存中的活跃会话（进程重启丢失）
- `session_{id}.json`: 磁盘持久化（用于恢复历史记录）
- FFmpeg 进程: 进程重启后丢失，需手动重新启动推流

---

## 六、配置参数详解

### 6.1 视频参数

| 参数 | 默认值 | 最小值 | 最大值 | 建议 |
|------|--------|--------|--------|------|
| videoBitrate | 2,500,000 (2.5Mbps) | 1,500,000 | 6,000,000 | 抖音 1080P 推荐 2-4Mbps |
| audioBitrate | 128,000 (128Kbps) | 64,000 | 256,000 | 128Kbps 音质足够 |
| fps | 30 | 24 | 60 | 30fps 是主流直播标准 |
| resolution | 1080x1920 | 720x1280 | 1440x2560 | 竖屏 9:16 比例 |

### 6.2 推流参数

| 参数 | 默认值 | 说明 |
|------|--------|------|
| targetDurationHours | 4 | 目标推流时长（小时），实际无限循环直到手动停止 |
| antiDetectSpeedVary | true | 是否启用反检测微变速 |
| speedRange | [0.995, 1.005] | 变速范围，±0.5% 是安全阈值（太大影响音画同步） |

### 6.3 各平台推荐配置

| 平台 | 分辨率 | 码率 | 备注 |
|------|--------|------|------|
| **抖音** | 1080x1920 | 2.5-4 Mbps | 推荐 30fps |
| **快手** | 1080x1920 | 2-3 Mbps | 支持更高码率但没必要 |
| **视频号** | 720x1280 | 1.5-2 Mbps | 目前支持较低分辨率 |

---

## 七、数据存储结构

### 7.1 目录树

```
AiMarketing/
└── data/
    └── live-streams/              # 引擎工作根目录
        ├── session_1749234567_abc123.json   # 会话状态
        ├── session_1749240000_def456.json
        ├── concat_1749234689.txt            # concat 临时文件
        │
        ├── clips/                           # 素材库
        │   └── task_1749234500_xyz/         # 一次生成任务的输出
        │       ├── task_1749234500_xyz_0.mp4   # welcome
        │       ├── task_1749234500_xyz_1.mp4   # product_intro
        │       ├── task_1749234500_xyz_2.mp4   # product_intro
        │       └── ...
        │
        └── playlists/                       # 播放列表
            └── playlist_pl_abc123.json       # 列表定义
```

### 7.2 Session 文件示例

```json
{
  "id": "1749234567_abc123",
  "status": "idle",
  "config": {
    "rtmpUrl": "rtmp://push.douyin.com/live/xxxxx",
    "videoBitrate": 2500000,
    "audioBitrate": 128000,
    "fps": 30,
    "resolution": "1080x1920",
    "targetDurationHours": 4,
    "antiDetectSpeedVary": true,
    "speedRange": [0.995, 1.005]
  },
  "playlistId": "pl_abc123",
  "pid": null,
  "startTime": "2026-06-07T08:30:00.000Z",
  "endTime": "2026-06-07T12:35:22.000Z",
  "durationSeconds": 14722,
  "bytesSent": 460800000,
  "error": null,
  "lastHeartbeat": "2026-06-07T12:35:20.000Z"
}
```

### 7.3 文件清理

当前版本**没有自动清理机制**。长期运行后可能需要手动清理：

```bash
# 查看占用空间
du -sh data/live-streams/

# 清理旧素材（谨慎操作）
rm -rf data/live-streams/clips/task_旧任务ID/

# 清理旧的 concat 临时文件
rm -f data/live-streams/concat_*.txt
```

> 后续版本可考虑添加 TTL 自动清理策略。

---

## 八、与其他模块的关系

### 8.1 依赖关系图

```
┌──────────────────────┐
│   ai-providers.ts    │  ← AI 能力统一入口
│  ┌────────────────┐  │
│  │ generateText() │──────→ LLM (通义千问/DeepSeek)
│  │ textToSpeech()│──────→ TTS (火山引擎)
│  │digitalHumanV()│──────→ 数字人 (千寻 DashScope)
│  │queryDHTask()  │──────→ 轮询任务结果
│  └────────────────┘  │
└──────────┬───────────┘
           │ 被 import
           ▼
┌──────────────────────────┐
│  live-stream-engine.ts   │  ← 推流核心引擎
│  ┌────────────────────┐  │
│  │ startStream()      │  │
│  │ stopStream()       │  │
│  │ aiGenerateLiveContent()│
│  │ generateLiveContent()  │
│  │ listClips()        │  │
│  │ createPlaylist()   │  │
│  └────────────────────┘  │
└──────────┬───────────────┘
           │ 被 import
           ▼
┌──────────────────────────┐
│  api/live/stream/route.ts│  ← API 路由层
│  (鉴权 + 请求分发)        │
└──────────┬───────────────┘
           │ HTTP
           ▼
┌──────────────────────────┐
│  app/live/page.tsx       │  ← 前端 UI
│  (推流控制 Tab 面板)       │
└──────────────────────────┘
```

### 8.2 与数字人模块的集成

| 步骤 | 来源 | 目标 | 说明 |
|------|------|------|------|
| 形象训练 | 数字人板块 | 千寻 API | 用户上传照片 → 训练形象 → 获得 `avatarId` |
| 视频合成 | 推流引擎 | 千寻 API | `avatarId` + `text` → 异步生成 MP4 |
| 结果轮询 | 推流引擎 | 千询 API | `queryDigitalHumanTask(taskId)` → 获取 `avatarUrl` |
| 视频下载 | 推流引擎 | 千寻 CDN | `fetch(videoUrl)` → 保存到 `data/live-streams/clips/` |

### 8.3 与直播其他功能的关系

| 功能模块 | 与推流引擎关系 | 说明 |
|----------|-------------|------|
| **直播间管理** (LiveRoom) | 独立 | 管理抖音/快手直播间账号信息 |
| **商品管理** (LiveProduct) | 数据来源 | 商品信息可导入 AI 生成 prompt |
| **话术库** (LiveScript) | 未来整合 | 可作为预设话术模板 |
| **Q1 命令控制台** | 辅助监控 | 用于弹幕收集、评论监控、ADB 控制 |
| **数据统计** | 数据消费者 | 推流时长、状态等可写入统计报表 |

---

## 九、常见问题 FAQ

### Q1: 推流启动失败 "FFmpeg 启动超时"

**可能原因:**
- RTMP 地址无效或过期（每次开播需要新的 RTMP 地址）
- 服务器网络不通（无法连接抖音/快手 CDN）
- FFmpeg 未安装或不在 PATH 中

**排查步骤:**
```bash
# 1. 检查 FFmpeg 是否安装
ffmpeg -version

# 2. 测试 RTMP 连接
ffmpeg -f lavfi -i color=c=black:s=1080x1920:d=10 -f flv "你的RTMP地址" -t 5
# 如果能看到 frame= 输出说明连通，Ctrl+C 退出

# 3. 检查防火墙
# 确保 TCP 1935 (RTMP端口) 出站开放
```

### Q2: 推流过程中断

**常见原因及处理:**

| 原因 | 表现 | 解决方法 |
|------|------|---------|
| RTMP 地址失效 | FFmpeg 退出 code≠0 | 重新获取 RTMP 地址并重启推流 |
| 网络波动 | 临时卡顿后恢复 | 引擎会自动重连（取决于平台超时设置） |
| 素材文件损坏 | FFmpeg 报错 Invalid data | 检查 MP4 文件完整性，删除损坏素材 |
| 内存不足 | OOM Kill | 减少并发数或增加服务器内存 |

**自动重启建议:** 可以结合 PM2 或 systemd 的 restart 策略实现断流自动恢复。

### Q3: 数字人生成失败 "提交数字人生成任务失败"

**检查项:**
1. `avatarId` 是否正确？去数字人板块确认形象是否训练完成
2. 千寻 API Key 是否配置？检查 `.env` 中的 `DASHSCOPE_API_KEY`
3. 账户余额是否充足？千寻数字人是付费 API
4. 文案长度是否合适？建议每条 15-80 字

### Q4: 生成的视频太短/太长

**调整方法:**
- **商品介绍偏短**: 在商品描述的 features 里多加几个卖点，LLM 会生成长文案
- **欢迎语偏长/短**: 在品牌调性提示词里注明期望长度
- **整体节奏控制**: 在 `ai-generate` 的 products 输入中调整商品数量

### Q5: 如何实现 24 小时不间断直播？

当前引擎设计就是**无限循环模式**——FFmpeg concat demuxer 播完最后一个片段后会自动从头开始。只要：
1. 素材总时长足够（建议至少 30 分钟以上的素材，避免重复感太强）
2. 服务器稳定运行
3. RTMP 地址不过期（部分平台有推流时长限制）

**应对 RTMP 过期:**
- 抖音：一般单次推流最长 12-48 小时，到期需要重新开播获取新地址
- 可配合定时脚本定期检查推流状态并自动重启

### Q6: 推流画面被平台检测为录播怎么办？

当前已实现的防检测措施：
1. ✅ 微变速 (±0.5%) — 每次启动随机速度因子
2. ✅ 顺序打乱 — Fisher-Yates 洗牌

**增强建议（需手动实施）：**
- 准备更多样化的素材（不同服装/背景/角度的数字人形象）
- 在素材间插入 BGM 过渡片段
- 定期插入真人出镜片段（哪怕几秒）
- 模拟弹幕互动（在画面上叠加弹幕字幕）

### Q7: 服务器资源占用预估

| 资源 | 推流中消耗 | 说明 |
|------|-----------|------|
| CPU | 1-2 核 | FFmpeg H.264 编码为主 |
| 内存 | 200-500MB | FFmpeg 进程 + Node.js |
| 带宽 | 上行 ≈ 码率 | 2.5Mbps ≈ 约 1.1GB/小时 |
| 磁盘 | 素材大小 | 取决于生成的视频总量 |

**1 小时推流上行流量计算:**
```
2.5 Mbps × 3600s ÷ 8 = ~1.125 GB/小时
4 小时直播 ≈ 4.5 GB 上行流量
```

### Q8: 如何同时推多个平台？

**方案一：SRS 中继服务器**（推荐）
```
FFmpeg → SRS Server (本地) → rtmp://抖音  → 观众A
                             → rtmp://快手  → 观众B
                             → rtmp://视频号 → 观众C
```
需要在服务器部署 SRS 流媒体服务器，将一路 RTMP 分发到多路。

**方案二：多个 FFmpeg 进程**
```
FFmpeg 进程1 → 抖音
FFmpeg 进程2 → 快手
CPU 和带宽翻倍
```

> SRS 方案已在路线图中（见第十章），当前 MVP 版本仅支持单路推送。

---

## 十、升级路线图

### Phase 1 — 当前 MVP ✅ (已完成)

- [x] FFmpeg RTMP 单路直推
- [x] AI 话术生成 (LLM)
- [x] 数字人视频批量生成 (千寻 API)
- [x] 前端推流控制面板
- [x] 反检测微变速 + 顺序打乱
- [x] 会话持久化

### Phase 2 — 增强 (近期)

- [ ] SRS 多平台分发（一路推流 → 抖音+快手+视频号）
- [ ] BGM 轮换插播系统
- [ ] 精确时长检测 (ffprobe 替代粗估算)
- [ ] 定时自动重启（应对 RTMP 过期）
- [ ] 推流状态 WebSocket 实时推送
- [ ] 素材 TTL 自动清理
- [ ] 断流自动恢复守护进程

### Phase 3 — GPU 实时升级 (中期)

- [ ] 集成 **LiveTalking** 开源方案
- [ ] 实时驱动数字人（不再需要预渲染）
- [ ] 支持 AI 实时问答互动（LLM + ASR + TTS）
- [ ] 弹幕关键词触发实时回复
- [ ] 商品展示联动（提到商品时弹出卡片）

### Phase 4 — Q1 深度整合 (远期)

- [ ] Q1 WHIP 推流通道（绕过 MacVlan 限制）
- [ ] Q1 弹幕实时采集 + AI 分析
- [ ] Q1 自动评论回复（ADB 模拟输入）
- [ ] Q1 真机环境指纹增强

### 技术选型对比回顾

| 维度 | 路线一 LiveTalking | 路线二 FFmpeg (当前) | 路线三 Q1 WHIP |
|------|---------------------|---------------------|---------------|
| **GPU 需求** | 必须 (NVIDIA) | 不需要 | 不需要 |
| **实时互动** | ✅ 支持 | ❌ 预渲染 | ⚠️ 有限 |
| **开发周期** | 5-7 天 | ✅ 已完成 (MVP) | 5-7+ 天 |
| **效果上限** | 最高 | 中等 | 中等 |
| **维护成本** | 高 | 低 | 高 |
| **升级路径** | 最终目标 | 过渡方案 | 辅助增强 |

---

## 附录 A: 完整 API 速查表

| Method | Action | 说明 | 认证 |
|--------|--------|------|------|
| GET | `status` | 查询所有/指定推流会话 | ✅ |
| GET | `status&sessionId=x` | 查询单个会话 | ✅ |
| GET | `clips` | 查询所有素材 | ✅ |
| GET | `clips&taskId=x` | 查询指定任务的素材 | ✅ |
| GET | `playlists` | 查询所有播放列表 | ✅ |
| GET | `playlist&id=x` | 查询单个播放列表 | ✅ |
| POST | `start-stream` | 启动推流 | ✅ admin/editor |
| POST | `stop-stream` | 停止推流 | ✅ admin/editor |
| POST | `generate` | 批量生成数字人视频 | ✅ admin/editor |
| POST | `ai-generate` | AI 一键生成 (话术+视频) | ✅ admin/editor |
| POST | `create-playlist` | 创建播放列表 | ✅ admin/editor |
| POST | `shuffle` | 打乱播放顺序 | ✅ admin/editor |

## 附录 B: 错误码速查

| HTTP Code | 场景 | 处理建议 |
|-----------|------|---------|
| 401 | Cookie 过期/未登录 | 重新登录 |
| 403 | end-user 无操作权限 | 联系管理员提升权限 |
| 400 | 缺少必填参数 (rtmpUrl/sessionId/avatarId) | 检查请求体 |
| 500 | RTMP URL 格式错误 | 确保以 `rtmp://` 开头 |
| 500 | 无可用播放内容 | 先调用 AI 生成素材 |
| 500 | FFmpeg 启动超时 | 检查网络/FFmpeg 安装 |
| 500 | LLM 话术生成失败 | 检查 AI Provider 配置 |
| 500 | 数字人视频生成失败 | 检查 avatarId / 千寻 API Key |
| 500 | 推流地址必须以 rtmp:// 开头 | URL 校验不通过 |

---

*文档版本: v1.0 | 最后更新: 2026-06-07 | 对应代码版本: fecd788*
