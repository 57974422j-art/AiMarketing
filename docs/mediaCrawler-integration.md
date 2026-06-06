# MediaCrawler 集成技术设计文档

> 版本: v1.0 | 日期: 2026-06-06 | 状态: 规划阶段

---

## 1. 背景与动机

### 1.1 当前问题
AiMarketing 的数据采集引擎（`automation-providers.ts`）此前全部使用 **Mock 假数据**：
- `douyinSearchVideo()` → 返回硬编码的假视频列表
- `douyinFetchComments()` → 返回 12 条模板假评论
- `douyinFetchUserProfile()` → 直接返回假用户信息

这导致 **Lead Collector（线索采集）** 和 **行业洞察（Insights）** 面板无法提供真实业务价值。

### 1.2 为什么选择 MediaCrawler
| 方案 | 可行性 | 数据覆盖 | 维护成本 |
|------|--------|----------|---------|
| 抖音官方 Open API | ❌ 需企业资质审核 | 仅自有账号数据 | 低 |
| 第三方数据服务（如飞瓜） | ⚠️ 贵，按量计费 | 覆盖广 | 中 |
| **MediaCrawler 开源爬虫** | ✅ 免费可控 | 公开内容全覆盖 | 中（需维护 cookie） |

**结论**: MediaCrawler 是目前唯一能获取**任意公开视频评论/用户画像/热门话题**的可行方案。

---

## 2. 技术架构

### 2.1 整体架构图

```
┌─────────────────────────────────────────────────────────────┐
│                    AiMarketing (Next.js)                     │
│                                                             │
│  ┌──────────────────┐    ┌───────────────────────────┐     │
│  │ Lead Collector   │    │ Insights 面板             │     │
│  │ /lead-collector  │    │ /dashboard/insights       │     │
│  └────────┬─────────┘    └────────────┬──────────────┘     │
│           │                          │                     │
│           └──────────┬───────────────┘                     │
│                      ▼                                     │
│           ┌────────────────────────┐                       │
│           │  engine-dispatcher.ts  │ ← 统一调度入口         │
│           └────────────┬───────────┘                       │
│                        ▼                                   │
│           ┌────────────────────────┐                       │
│           │ automation-providers.ts│ ← 实际调用逻辑        │
│           └────────────┬───────────┘                       │
└────────────────────────┼───────────────────────────────────┘
                         │ HTTP (localhost)
                         ▼
┌─────────────────────────────────────────────────────────────┐
│              MediaCrawler Wrapper Service                   │
│              (Node.js child_process → Python)               │
│                                                             │
│  ┌──────────────────────────────────────────────────┐      │
│  │  /api/mediacrawler/search    → 搜索视频            │      │
│  │  /api/mediacrawler/comments  → 爬取评论            │      │
│  │  /api/mediacrawler/user      → 用户画像            │      │
│  │  /api/mediacrawler/trending  → 热门话题            │      │
│  │  /api/mediacrawler/detail    → 视频详情            │      │
│  └──────────────────────────────────────────────────┘      │
│                        │                                   │
│                        ▼ child_process.spawn               │
│  ┌──────────────────────────────────────────────────┐      │
│  │          MediaCrawler (Python + Playwright)       │      │
│  │          安装路径: /opt/MediaCrawler              │      │
│  └──────────────────────────────────────────────────┘      │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 核心设计原则
1. **进程隔离**: MediaCrawler 运行在独立 Python 进程中，不阻塞 Node.js 事件循环
2. **超时控制**: 每次爬取调用设 60s 超时，避免挂死
3. **Cookie 管理**: 支持多账号 Cookie 轮换，自动检测过期
4. **错误降级**: 爬虫失败时返回明确错误（不再 fallback 到假数据）
5. **速率限制**: 内置请求间隔，防止触发反爬

---

## 3. 服务器部署步骤

### 3.1 环境准备

```bash
# ===== 1. 检查 Python 环境 =====
python3 --version  # 需要 >= 3.9

# ===== 2. 安装 Playwright 浏览器 =====
pip3 install playwright
playwright install chromium

# ===== 3. 克隆 MediaCrawler =====
cd /opt
git clone https://github.com/NanmiCoder/MediaCrawler.git
cd MediaCrawler

# ===== 4. 安装依赖 =====
pip3 install -r requirements.txt

# ===== 5. 配置 Cookie（关键步骤）=====
# 编辑 config/base_config.py 或使用浏览器登录获取 cookie
```

### 3.2 Cookie 获取方式

MediaCrawler 支持两种 Cookie 获取方式：

#### 方式 A：浏览器扫码（推荐）
```bash
cd /opt/MediaCrawler
python main.py --login --platform douyin
# 会弹出浏览器窗口，扫码登录抖音
# 登录成功后 cookie 自动保存到 data/ 目录
```

#### 方式 B：手动配置 Cookie
```python
# config/base_config.py
BROWSER_OPTIONS = {
    "cookies": [
        {
            "domain": ".douyin.com",
            "name": "ttwid",
            "value": "你的ttwid值",
            # ... 其他 cookie 字段
        }
    ]
}
```

### 3.3 创建 Wrapper API 服务

在 AiMarketing 项目中新建轻量级桥接服务：

```
src/app/api/mediacrawler/
├── route.ts              # 主路由分发
├── search/route.ts       # 视频搜索
├── comments/route.ts     # 评论爬取
├── user/route.ts         # 用户画像
├── trending/route.ts     # 热门话题
├── detail/route.ts       # 视频详情
└── lib/
    └── crawler-client.ts # Python 进程管理客户端
```

---

## 4. API 接口设计

### 4.1 统一响应格式

```typescript
interface MediaCrawlerResponse<T> {
  success: boolean
  data?: T
  error?: {
    code: string           // 错误码
    message: string        // 人类可读描述
    retryable: boolean     // 是否可重试
    hint?: string          // 解决建议
  }
  meta?: {
    source: 'mediacrawler' // 数据来源标识
    crawledAt: string      // ISO 时间戳
    costMs: number         // 耗时(ms)
  }
}
```

### 4.2 接口清单

| 方法 | 路径 | 参数 | 返回 | 说明 |
|------|------|------|------|------|
| GET | `/api/mediacrawler/search?keyword=美业&count=20&platform=douyin` | keyword, count, platform, sort_type | Video[] | 视频搜索 |
| GET | `/api/mediacrawler/comments?url={video_url}&count=50` | video_url, count | Comment[] | 视频评论 |
| GET | `/api/mediacrawler/user?sec_user_id=xxx` | sec_user_id, user_id | UserProfile | 用户画像 |
| GET | `/api/mediacrawler/trending?category=hot&count=20` | category, count | TrendingItem[] | 热门话题 |
| GET | `/api/mediacrawler/detail?url={video_url}` | video_url | VideoDetail | 视频详情 |

### 4.3 数据模型

```typescript
// 视频
interface Video {
  id: string               // 视频 ID（抖音的 aweme_id）
  title: string            // 标题/描述
  coverUrl: string         // 封面 URL
  videoUrl: string         // 视频播放地址
  authorUid: string        // 作者 UID
  authorName: string       // 作者昵称
  authorAvatar: string     // 作者头像
  likeCount: number        // 点赞数
  commentCount: number     // 评论数
  shareCount: number       // 分享数
  collectCount: number     // 收藏数
  playCount: number        // 播放数
  publishedAt: string      // 发布时间 ISO
  tags: string[]           // 标签
  location?: string        // 地理位置
}

// 评论
interface Comment {
  id: string               // 评论 ID
  content: string          // 评论正文
  authorUid: string        评论者 UID
  authorName: string       评论者昵称
  authorAvatar: string     评论者头像
  likeCount: number        // 点赞数
  createdAt: string        // 发布时间
  replyTo?: string         // 回复目标评论 ID
  isAuthorReply: boolean   // 是否作者回复
}

// 用户画像
interface UserProfile {
  uid: string              // 用户唯一 ID
  nickname: string         // 昵称
  avatar: string           // 头像 URL
  bio: string              // 简介
  followerCount: number    // 粉丝数
  followingCount: number   // 关注数
  likeCount: number        // 获赞总数
  videoCount: number       // 作品数
  isVerified: boolean      // 是否认证
  verifyType?: string      // 认证类型
  location?: string        // 所在地
  tags: string[]           // 标签
}
```

---

## 5. 核心实现：crawler-client.ts

```typescript
// src/app/api/mediacrawler/lib/crawler-client.ts
import { spawn } from 'child_process'
import { resolve } from 'path'

const MEDIA_CRAWLER_PATH = process.env.MEDIA_CRAWLER_PATH || '/opt/MediaCrawler'
const PYTHON_BIN = process.env.PYTHON_BIN || 'python3'

interface CrawlerOptions {
  timeout?: number  // 默认 60000ms
  platform?: string // 默认 douyin
}

/**
 * 调用 MediaCrawler Python 脚本执行爬取任务
 */
export async function crawl(
  action: 'search' | 'comments' | 'user' | 'trending' | 'detail',
  params: Record<string, string>,
  options: CrawlerOptions = {}
): Promise<any> {
  const { timeout = 60000 } = options

  return new Promise((resolve, reject) => {
    const args = [
      '-c', `
import json, sys
sys.path.insert(0, '${MEDIA_CRAWLER_PATH}')
from media_crawler import ${getModuleName(action)}
result = ${getFunctionName(action)}(${JSON.stringify(params)})
print(json.dumps(result, ensure_ascii=False))
`
    ]

    const proc = spawn(PYTHON_BIN, args, {
      cwd: MEDIA_CRAWLER_PATH,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
      stdio: ['pipe', 'pipe', 'pipe']
    })

    let stdout = ''
    let stderr = ''

    proc.stdout.on('data', (data) => { stdout += data.toString() })
    proc.stderr.on('data', (data) => { stderr += data.toString() })

    // 超时控制
    const timer = setTimeout(() => {
      proc.kill('SIGTERM')
      reject({
        code: 'TIMEOUT',
        message: `MediaCrawler ${action} 执行超时 (${timeout}ms)`,
        retryable: true,
        hint: '可尝试减少 count 参数或检查网络连接'
      })
    }, timeout)

    proc.on('close', (code) => {
      clearTimeout(timer)
      if (code === 0) {
        try {
          const result = JSON.parse(stdout)
          resolve(result)
        } catch (e) {
          reject({ code: 'PARSE_ERROR', message: '解析爬虫输出失败', stderr })
        }
      } else {
        reject({
          code: 'CRAWLER_ERROR',
          message: `MediaCrawler 退出码: ${code}`,
          detail: stderr.slice(0, 500),
          retryable: code !== 1  // exit 1 通常是参数错误，不可重试
        })
      }
    })
  })
}

function getModuleName(action: string): string {
  const map: Record<string, string> = {
    search: 'douyin_search',
    comments: 'douyin_comment',
    user: 'douyin_user',
    trending: 'douyin_trending',
    detail: 'douyin_detail',
  }
  return map[action] || action
}

function getFunctionName(action: string): string {
  return `run_${action}`
}
```

---

## 6. 改造 automation-providers.ts

清理完成后，当前 `automation-providers.ts` 的读操作函数全部返回 `"未配置引擎"` 的错误。接入 MediaCrawler 后需改造为：

```typescript
// 改造后的 douyinSearchVideo 示例
export async function douyinSearchVideo(keyword: string, count: number): Promise<AutomationResult> {
  const engine = process.env.AUTOMATION_ENGINE

  if (engine === 'mediacrawler') {
    try {
      const data = await crawl('search', { keyword, count: String(count) })
      return {
        success: true,
        message: `成功搜索 ${data.list?.length || 0} 条视频`,
        provider: 'mediacrawler',
        data
      }
    } catch (err) {
      return {
        success: false,
        message: err.message || '爬虫搜索失败',
        provider: 'mediacrawler',
        data: { error: err.code || 'CRAWLER_FAILED' }
      }
    }
  }

  if (engine === 'douyin-official') {
    // TODO: 接入抖音官方 Open API（需企业资质）
    return {
      success: false,
      message: '抖音官方 API 尚未对接（需要企业开发者资质）',
      provider: 'douyin-official' as any,
      data: { error: 'NOT_IMPLEMENTED' }
    }
  }

  // 未配置任何引擎
  return {
    success: false,
    message: '未配置数据采集引擎。请在 Settings → 数据查询引擎中选择 MediaCrawler 或抖音官方API。',
    provider: 'none' as any,
    data: { error: 'NO_ENGINE_CONFIGURED' }
  }
}
```

---

## 7. 安全与合规

### 7.1 反爬策略应对
| 策略 | 应对方式 |
|------|---------|
| IP 封禁 | 使用代理池轮换（可选）|
| Cookie 过期 | 自动检测 403 → 提示重新登录 |
| 验证码 | Playwright 自动识别或人工介入 |
| 请求频率限制 | 内置随机延迟 2~5s |

### 7.2 使用边界
- **仅抓取公开内容**，不尝试绕过登录墙/隐私设置
- **遵守 robots.txt**
- **不用于恶意目的**（如批量骚扰、刷量等）
- **Cookie 来自用户自愿授权**

---

## 8. 部署检查清单

部署前逐项确认：

```bash
# ===== 服务器端检查命令 =====

# 1. Python 环境
python3 --version && pip3 --version

# 2. MediaCrawler 已安装
ls -la /opt/MediaCrawler/main.py && echo "✅ MediaCrawler 已安装"

# 3. Playwright 浏览器
python3 -c "from playwright.sync_api import sync_playwright; print('✅ Playwright OK')"

# 4. Cookie 文件存在
ls -la /opt/MediaCrawler/data/cookies/douyin*.json 2>/dev/null && echo "✅ Cookie 存在" || echo "❌ 缺少 Cookie"

# 5. 测试基础爬取功能
cd /opt/MediaCrawler && python3 main.py --search --keyword "测试" --count 1

# 6. AiMarketing 环境变量已设置
grep "AUTOMATION_ENGINE=mediacrawler" /root/AiMarketing/.env.local && echo "✅ 引擎配置正确"
grep "MEDIA_CRAWLER_PATH" /root/AiMarketing/.env.local || echo "⚠️ 未自定义路径(使用默认 /opt/MediaCrawler)"
```

---

## 9. 工作量估算

| 任务 | 复杂度 | 预估时间 |
|------|--------|---------|
| 服务器安装 Python + Playwright + MediaCrawler | 低 | 1h |
| Cookie 配置与登录验证 | 中 | 1-2h |
| 编写 crawler-client.ts（进程管理+超时） | 中 | 3-4h |
| 实现 5 个 API 端点（search/comments/user/trending/detail） | 中 | 4-6h |
| 改造 automation-providers.ts 对接真实爬虫 | 中 | 2-3h |
| Lead Collector 页面对接真实数据 | 中 | 3-4h |
| Insights 面板对接真实数据 | 中 | 2-3h |
| Cookie 过期检测 + 重新登录提示 | 低 | 1-2h |
| 联调测试 | 高 | 3-4h |
| **总计** | | **20-29h (~3-4天)** |

---

## 10. 后续优化方向（Phase 5.5）

- [ ] **代理池集成**: 支持多 IP 轮换，降低封号风险
- [ ] **定时采集**: cron 定期爬取热门内容存入 DB
- [ ] **增量更新**: 只爬取新评论，避免重复
- [ ] **多平台扩展**: 小红书、快手、B站
- [ ] **分布式部署**: 多节点并行爬取
- [ ] **监控面板**: 爬虫状态、成功率、延迟可视化
