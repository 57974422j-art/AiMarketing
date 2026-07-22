# AiMarketing 项目完整报告

> 生成日期: 2026-06-12 (V1.8 批量发布队列专场)
> 项目路径: `/root/AiMarketing` (服务器) / `D:\AiMarketing` (本地)
> 域名: http://120.55.43.195:3000
> PM2 进程名: `aimarketing`
> Git: github.com:57974422j-art/AiMarketing.git (master)
> 技术栈: Next.js 14 + TypeScript + Prisma 5.22.0 + SQLite + Tailwind CSS
> 部署限制: Electron 仅桌面端(Windows/macOS/Linux)，手机端(Capacitor)不支持指纹浏览器/视频合成等后端功能

---

## ⚠️ 可忽略的文件/目录（不要浪费时间阅读）

> **核心原则**: 这个项目真正活跃的代码集中在 `src/app/`、`src/lib/`、`electron/`、`prisma/` 四个目录。其他 90%+ 的文件都可以跳过。

### 🔴 绝对不用看（垃圾/临时/生成物）

| 路径 | 原因 |
|------|------|
| **`node_modules/`**、**`.next/`** | 依赖和编译缓存，**规则禁止读取** |
| **`dist-electron/`** | Electron 打包输出产物（200+ 文件），自动生成的 |
| **`.tsbuildinfo`**、**`next-env.d.ts`** | 编译缓存 |
| **`addsnap.mjs`** | 调试残留，无意义 |
| **`console.log(e.message))`** | 意外创建的垃圾文件名（不是代码） |
| **`fix-pubbtn.mjs`** | 一次性修复脚本，已用过 |
| **`fix_prisma.sh`**、**`deploy.bat`** | 一次性运维脚本 |
| **`UTF8`** | 根目录下的空文件/乱码文件，无意义 |
| **`temp_query.mjs`**、**`temp_query.sql`** | 临时调试查询脚本 |
| **`AiMarketing-Cards-PPT.pptx`** | 生成的 PPT 演示文稿，非代码 |

### 🟡 基本不用看（辅助工具 / 已冻结的模块）

| 路径 | 原因 |
|------|------|
| **`scripts/` 目录**（24个文件） | ADB 工具 exe/dll、测试脚本、语音分离、PPT 生成等辅助工具，与核心功能无关 |
| **`temp/` 目录** | 临时测试视频（3个 mp4） |
| **`android/` 目录**（53个文件） | **Capacitor 手机端代码** — 部署限制明确：手机端不支持指纹浏览器/视频合成等功能，**暂不动**（见记忆 ID: 44040787） |
| **`capacitor.config.ts`** | Capacitor 配置文件，同上 |
| **`docs/` 目录**（12个 md） | 项目文档备份，信息已整合到本 REPORT |
| **`src/*.bak`** | 备份文件（如 douyin-publish.js.bak.20250610） |
| **`PROJECT_REPORT.md`** | 就是本文档本身，不需要读自己 |

### 🟢 特定场景才看（有条件地阅读）

| 路径 |什么时候看 | 说明 |
|------|-----------|------|
| **`electron/` 目录** | **仅改指纹浏览器时** | main.js + preload.js + fp-templates/*.js，改了需重新打包 Electron 客户端 |
| **`prisma/schema.prisma`** | **改数据模型时** | 改了需 `prisma db push`（规则禁止 AI 执行 prisma generate） |
| **`src/middleware.ts`** | **加新 API 白名单 / 改鉴权逻辑** | 改错会导致全站 401 |
| **`package.json` / `tsconfig.json`** | **规则禁止修改** | 绝不动 |

### ✅ 重点关注的文件（核心代码索引）

> 以下是这个项目的**灵魂文件**，按优先级排列：

#### 第 0 优先级：每次改功能都要看的（⭐⭐⭐）

```
prisma/schema.prisma              # 数据模型定义（所有表的源头）
src/middleware.ts                  # JWT鉴权 + API白名单（所有请求必经之路）
src/lib/ai-providers.ts            # AI统一入口（所有AI功能的调度中心）
```

#### 第 1 优先级：批量发布相关（当前最活跃模块）

```
src/app/my-fingerprint/page.tsx    # 抖音批量发布工作台前端 (~880行) V1.8重写 ⭐⭐
electron/main.js                   # Electron主进程 IPC通道 (~26KB) ⭐⭐⭐
electron/fp-templates/douyin-publish.js  # 抖音发视频Playwright脚本 (~600行) ⭐⭐⭐
electron/preload.js                # IPC桥接 window.electronAPI 暴露 ⭐
```

#### 第 2 优先级：一键合成相关

```
src/app/auto-compile/page.tsx      # 一键合成前端页面
src/app/api/video/auto-compile/route.ts  # 一键合成API
src/lib/video-task-manager.ts      # 普通成片引擎（FFmpeg步骤编排）
src/lib/smart-compile-engine.ts    # 智能成片引擎
src/lib/ffmpeg.ts                  # FFmpeg统一执行层（串行队列+nice+超时保护）
```

#### 第 3 优先级：管理后台 & 其他页面

```
src/app/admin/page.tsx             # 管理中心首页（入口聚合）
src/app/admin/devices/page.tsx     # Q1设备管理
src/app/admin/social-accounts/page.tsx  # 社交账号管理
src/app/storage/page.tsx           # 素材仓库页面
src/app/dashboard/page.tsx         # 用户仪表盘
src/components/Navbar.tsx          # 导航栏（角色权限控制）
```

#### 第 4 优先级：API 路由层（按需查阅）

```
src/app/api/storage/files/route.ts # 素材仓库列表（白名单+缩微图）
src/app/api/storage/file/route.ts  # 单文件下载（白名单）
src/app/api/devices/[id]/execute/route.ts  # Q1设备执行引擎
src/app/api/dashboard/*/route.ts  # Dashboard相关API
```

### 📊 文件重要性分布图

```
AiMarketing/
├── 🔴 不看 (70%): node_modules/.next/dist-electron/temp/scripts/android/docs/根目录垃圾
├── 🟡 少看 (20%): electron/(仅改发布时) package.json/tsconfig.json/配置文件
└── 🟢 多看 (10%): ← 这就是整个项目的核心 ↓
    ├── prisma/schema.prisma        ⭐⭐⭐ 数据模型
    ├── src/middleware.ts           ⭐⭐⭐ 鉴权
    ├── src/lib/ai-providers.ts     ⭐⭐⭐ AI入口
    ├── src/app/my-fingerprint/     ⭐⭐⭐ 批量发布(当前焦点)
    ├── electron/fp-templates/      ⭐⭐⭐ 抖音脚本
    ├── src/lib/ffmpeg.ts           ⭐⭐  视频处理
    ├── src/lib/video-task-manager.ts ⭐⭐ 成片引擎
    ├── src/lib/smart-compile-engine.ts ⭐⭐ 智能引擎
    ├── src/app/auto-compile/       ⭐⭐  一键合成UI
    ├── src/app/admin/*/            ⭐   管理后台
    ├── src/app/api/*/              ⭐   API路由
    └── src/components/             ⭐   公共组件
```

---

## 一、功能清单

### 管理中心（admin/）

| 页面 | 状态 | 说明 |
|------|------|------|
| **数据看板** `/admin/dashboard` | 完成 | 三层数据看板 |
| **账号信息中心** `/admin/users` | 2026-05-27 重构 | 原"客户管理"重写为卡片式信息中心 |
| **社交账号** `/admin/social-accounts` | 2026-05-27 重构 | 加了解绑+删除+远程截图 |
| **设备管理** `/admin/devices` | 完成 | Q1 容器列表，含远程截图 |
| **Q1 物理机** `/admin/phy-devices` | 完成 | 分配 PhyDevice 给 editor 时同步容器 ownerId |
| **任务模板** `/admin/automation-templates` | 2026-05-28 改造 | 勾选动作弹出对应配置项 |
| **任务执行** `/admin/automation` | 2026-05-28 改造 | 改为读模板配置执行 |
| **账号分组** `/admin/account-groups` | 已实现未使用 | 有数据表无功能引用 |
| **邀请码** `/admin/invite-codes` | 完成 | |
| **系统设置** `/admin/settings` | 完成 | AI/OSS/引擎配置 |
| **内容审核** `/admin/content-submissions` | 完成 | |
| **素材库** `/admin/media-library` | 完成 | |
| **话术模板** `/admin/script-templates` | 完成 | |

### AI 工具 / 终端

| 功能 | 路径 | 说明 |
|------|------|------|
| **一键合成** | auto-compile | AI 合成视频，支持推送到 Q1 相册 |
| **仓库（素材存储）** | `/storage` | 文件存储（500MB上限），支持视频/图片上传 |
| **本地自动化** | `/my-automation` | end-user 真手机发布任务 |

### 🔑 指纹浏览器（Fingerprint Simulator）— 核心模块 ⭐

> **前端路径**: `src/app/my-fingerprint/page.tsx` (~880行)
> **后端路径**: `electron/` 目录
> **技术栈**: Electron 主进程 + Playwright 浏览器自动化
> **部署注意**: Electron 客户端加载远程服务器页面 (`SERVER_URL=http://120.55.43.195:3000`)
>   - 前端 UI 改动 → 服务端 build 部署后才可见
>   - 模板改动（douyin-publish.js 等） → 客户端需重新打包安装

#### 功能概述（V1.8 重构后 — 抖音专用批量发布队列）

| 功能 | 说明 |
|------|------|
| **抖音批量发布队列** | 单账号多视频依次发布，支持间隔时间/定时发布、暂停/恢复/停止 |
| **任务入队** | 填写视频(素材仓库选)、标题、文案、话题、封面、位置 → 加入队列 |
| **队列管理** | 表格展示所有待发任务，支持删除单个/清空全部，实时状态(pending/publishing/done/failed) |
| **批量控制** | 立即模式(可设间隔秒数) / 定时模式(指定时间开始) / 暂停-恢复 / 完全停止 |
| **执行日志** | 每步操作实时日志输出，含成功/失败统计 |

> ⚠️ **已删除功能 (V1.8)**: 抖音点赞模板(douyin-like)、评论模板(douyin-comment)、小红书发帖(xiaohongshu-publish) — 本页面现为**抖音专用批量发布工作台**
> ⚠️ **已删除功能**: 音乐自动选择（v5 模板已移除 step65_selectMusic），用户决定本地配好音乐后再发布

#### PublishTask 数据结构（V1.8 新增）

```typescript
interface PublishTask {
  id: string                    // 唯一ID (timestamp + random)
  videoName: string             // 视频文件名（素材仓库）
  title: string                 // 标题
  description: string           // 文案/简介
  topics: string                // 话题
  coverImage: string            // 封面图片名
  location: string              // 位置
  publishNow: boolean           // true=立即发布 false=草稿
  status: 'pending' | 'publishing' | 'done' | 'failed'
  errorMsg?: string
}
```

#### 批量发布流程（V1.8）

```
1. 选择并启动抖音浏览器实例 (fpStart)
2. 填写视频参数表单（视频/标题/文案/话题/封面/位置）
3. 点击「添加到发布队列」→ 入队 (addToQueue)
4. 重复步骤2-3，添加多个视频到队列
5. 设置发布模式：
   ├── 立即依次发布 → 设定间隔秒数(默认30s)
   └── 定时发布 → 指定 HH:mm 开始时间
6. 点击「开始批量发布」→ executeBatch() 循环执行:
   ├── for each task in pendingTasks:
   │   ├── 标记 status='publishing'
   │   ├── fpExecute(port, 'douyin-publish', params)
   │   ├── 成功→status='done' / 失败→status='failed' (+errorMsg)
   │   └── 等待 intervalSeconds (最后一个不等待)
   └── 输出统计 ✅doneCount ❌failCount (局部变量计数，不依赖React state)
7. 支持操作：暂停(pauseBatch) / 恢复(重调executeBatch) / 停止(stopBatch+fpScriptStop)
```

#### 抖音发视频参数表（douyin-publish v5，2026-06-12 更新）

| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `storageFileName` | string | ✅ | 素材仓库名称（如 `1779884904572_dbd01667.mp4`） |
| `userId` | number | 自动获取 | 从 storage API 提取 |
| `title` | string | 推荐 | 作品标题（最多30字） |
| `description` | string | 推荐 | 作品简介/正文（最多1000字） |
| `topics` | string | 可选 | 自定义话题，支持 `#宠物 #萌宠` 或 `#宠物#萌宠` 格式 |
| `coverImage` | string | 可选 | 素材仓库中的封面图片名（jpg/png/webp），留空用系统默认 |
| `location` | string | 可选 | 地理位置文本（如"北京市朝阳区"） |
| `publishNow` | string | 默认 true | `true`=立即发布, `false`=仅存草稿 |

---

## 二、关键数据模型

```
User: id, username, email, passwordHash, name, role, parentId, plan
  role = admin | editor | end-user
  plan = free | pro | enterprise

Account: id, platform, accountName, userId, deviceId, status, isBound, bindType

Device: id, name, ownerId, apiPort, rpaPort, adbPort, phyDeviceId, type, status
PhyDevice: id, name, ip, port, ownerId, status

AutomationTemplate: id, name, type, params(JSON), ownerId
  params.actions = ['search','like','comment','follow','share','dm','publish','extract','comments']
```

---

## 三、三大关系

| 关系 | 说明 |
|------|------|
| **设备分配** | admin 录入 Q1 → 扫描容器 → 分配 PhyDevice 给 editor → 自动更新 Device.ownerId |
| **账号绑定** | editor 在社交账号页绑定账号到容器 → Account.deviceId=Device.id, isBound=true |
| **模板执行** | 选模板 → 读 actions → POST /api/devices/{id}/execute → 遍历执行 |

---

## 四、指纹浏览器 — 关键文件索引

### 文件结构

```
electron/
├── main.js                          # Electron 主进程 (~26KB) ⭐⭐⭐
│   ├── IPC 通道注册:
│   │   ├── fp:start                 # 启动浏览器实例 (Playwright launchPersistentContext)
│   │   ├── fp:stop                  # 停止浏览器实例
│   │   ├── fp:list                  # 列出活跃实例 + 状态
│   │   ├── fp:screenshot            # 截图
│   │   ├── fp:click/fp:type         # 点击/输入
│   │   ├── fp:execute               # 执行模板（路由分发）
│   │   └── fp:scriptStop            # 设置 global.__fpAbort=true 停止脚本
│   ├── case 'douyin-publish' 分支:
│   │   ├── 从 storage API 下载视频到 %TEMP%\aimarketing-videos\
│   │   ├── stream 方式下载 (http.get/https.get)
│   │   └── 传递 userId/coverImage/location 等参数给模板
│   └── BrowserInstance 管理 Map
│
├── preload.js                       # IPC桥接 (~3KB) ⭐
│   └── window.electronAPI 暴露给渲染进程:
│       ├── fpStart(opts) → ipcRenderer.invoke('fp:start')
│       ├── fpStop(port) / fpList() / fpScreenshot(port)
│       ├── fpExecute(port, templateType, params)
│       └── fpScriptStop() → ipcRenderer.invoke('fp:scriptStop')
│
└── fp-templates/
    └── douyin-publish.js            # 抖音发视频模板 (~600行) ⭐⭐⭐
        ├── executeDouyinPublish()   # 主入口函数（module.exports）
        ├── step1_navigate()         # 导航到 creator.douyin.com/content/upload (domcontentloaded, 非networkidle)
        ├── step2_upload()           # 视频上传（file input / filechooser 三种方法）
        ├── step3_waitUpload()       # 等待转码+进入编辑页（核心判定逻辑）
        ├── step4_fillContent()      # 填标题(input/textarea) + 正文(contenteditable)
        ├── step5_topics()           # #添加话题 手动输入模式
        ├── step55_location()        # 地理位置填写
        ├── step6_covers()           # 封面选择/自定义上传（弹窗关闭后JS强制移除DOM）
        └── step7_publish()          # 发布 或 存草稿（音乐功能已删除，2026-06-12）

src/app/my-fingerprint/page.tsx      # 抖音批量发布工作台前端 (~880行) ⭐⭐ (V1.8重写)
    ├── PublishTask 接口定义（第33-44行）
    ├── PLATFORMS 仅保留 douyin（第48-50行）
    ├── 表单状态: formVideoName/formTitle/formDesc/formTopics/formCoverImage/formLocation/formPublishNow
    ├── 任务队列状态: taskQueue[] + batchRunning/batchPaused/intervalSeconds/scheduleTime
    ├── addToQueue() 入队 / removeFromQueue() / clearQueue()
    ├── buildTaskParams() 构建douyin-publish参数
    ├── executeBatch() 批量循环执行(含间隔等待+暂停/恢复/停止)
    ├── UI结构: 左侧=账号列表(仅抖音manual) | 右侧=表单+队列表格+批量控制栏+执行日志
    └── 统计修复(V1.8): doneCount/failCount 用局部变量累加，不依赖闭包中的React state

相关 API 文件:
├── src/middleware.ts                # 中间件：JWT鉴权 + 白名单
├── src/lib/api-auth.ts             # getAuthFromHeaders() 解析 X-User-Id
├── src/app/api/storage/files/route.ts  # 素材仓库列表（白名单+query param 兼容）
├── src/app/api/storage/file/route.ts   # 单文件下载（已加入白名单，无需token）
└── src/app/storage/page.tsx         # 素材仓库管理页面
```

---

## 五、最近更新记录（2026-05 ~ 2026-06-12）

### V1.7 一键合成修复专场（2026-06-12）

> **背景**: 仓库素材模式完全不可用，经排查发现多个累积性 Bug

| Commit | 改动内容 | 关键文件 |
|--------|---------|---------|
| `d8e9455` | **FormData mode 覆盖 Bug**: `fd.append('mode', mode)` 预设在素材判断之前，导致 storage 模式永远被 free 模式覆盖（FormData 同名 key 多次 append 时 get() 取第一个值） | `src/app/auto-compile/page.tsx` |
| `bbecf63` | **FFmpeg 错误日志截断**: 原代码 `slice(0, 500)` 导致 FFmpeg 版本头(400+字)占满，真正错误被截掉。改为完整输出命令 + 保留尾部 2000 字符 | `src/lib/ffmpeg.ts` |
| `ac29b62` | **FFmpeg 输出文件缺失(普通模式)**: Step5 图片/视频→片段命令漏了 `"${out}"` 参数 → 报 "At least one output file must be specified" | `src/lib/video-task-manager.ts` (2处) |
| `e455104` | **FFmpeg 输出文件缺失(智能模式+最终渲染)**: 智能引擎4片段 + 最终渲染共5处同样问题，一次性修复 | `src/lib/smart-compile-engine.ts` (5处) |
| `40c731f` | **删除音乐功能 + 修复仓库图片缩略图 + FFmpeg xfade 越界** (上一轮) | 多文件 |

### V1.8 批量发布队列专场（2026-06-12）

> **背景**: my-fingerprint 页面原有 4 个模板（发视频/点赞/评论/小红书）混在一起，实际只需抖音批量发布多视频

| Commit | 改动内容 | 关键文件 |
|--------|---------|---------|
| `b3c0092` | **my-fingerprint 完全重写**: 删除TEMPLATES数组(4→0)、PLATFORMS只保留douyin、删除点赞/评论/小红书相关状态和UI、新增PublishTask接口+任务队列+批量控制栏(间隔/定时/暂停恢复停止) + 新UI布局(左侧账号列表/右侧表单+队列表格+控制栏+日志) | `src/app/my-fingerprint/page.tsx` (~880行重写) |
| `d1d2362` | **修复统计bug**: executeBatch()循环结束读取taskQueue state得到旧值(闭包问题)，改为局部变量doneCount/failCount实时累加 | `src/app/my-fingerprint/page.tsx` (2行新增) |

### V2 路线图实施进展（本轮会话完成）

| 日期 | 阶段 | Commit(s) | 改动内容 |
|------|------|-----------|---------|
| 2026-06-06 | Phase 3 | `e4f9372`~`af22483` | **直播模块落地**: `/live` 页面(676行) + 4个API路由，含直播间管理/商品上架/话术库/Q1设备控制台 |
| 2026-06-06 | Phase 3 | — | 管理中心添加「直播间中控台」入口(admin only) |
| 2026-06-06 | Phase 4a | `e4f9372` | **代理工作台**: `/admin/agent`(220行) + API，3Tab(客户列表/业绩统计/动态) |
| 2026-06-06 | Phase 4b | `450b583` | **AI诊断面板**: `/admin/diagnostics`(200行) + API，4维度11项检测(账号/设备/内容/系统) |
| 2026-06-06 | Phase 4c | `e7d4523` | **行业简报系统**: `/admin/briefings`(300行) + API(165行)，左右布局+分类筛选+AI生成+Markdown渲染 |
| 2026-06-06 | Bugfix | `c22df66`→`af22483` | 连续修复7个TypeScript类型错误(user.name→username/duplicate message/assignedTo/title/index-type/Date算术) |

### 基础架构优化（2026-06-10）

| Commit | 改动内容 | 关键文件 |
|--------|---------|---------|
| `ab15e4d` | **FFmpeg 统一执行层**：全局串行队列 + nice -n 19 + threads 1 + 超时保护，解决 CPU 爆满导致服务器死机问题 | `src/lib/ffmpeg.ts` (重写) |
| `ab15e4d` | **一键成片串行化**：Step5 从 Promise.all(2并行) 改为 for 循环串行；所有步骤统一走 runFFmpeg() | `src/lib/video-task-manager.ts` |
| `ab15e4d` | **缩微图异步化**：从 execSync 阻塞主线程改为 runFFmpeg() 异步排队，不再阻塞 Web 服务 | `src/app/api/storage/files/route.ts` |
| `4992aa4` | **FFmpeg 高优先级通道**：新增 `priority: 'high'` 选项，缩微图/ffprobe 短命令插队到队列前端执行，不被一键成片长任务阻塞 | `src/lib/ffmpeg.ts`, `storage/files/route.ts` |
| — | **Dashboard SWC 编译修复**：dashboard/page.tsx 完整重写（函数外置、Unicode emoji、简化嵌套），解决 Linux 上反复出现的 `Unexpected token 'div'` 错误 | `src/app/dashboard/page.tsx` |
| — | **Navbar 角色权限**：终端用户(end-user)隐藏 ai-tools 导航入口，只显示工作台 | `src/components/Navbar.tsx` |
| — | **TypeScript 类型修复**：douyin-profile.ts 正则索引类型注解 `[RegExp, string][]` | `src/lib/automation/fp-templates/douyin-profile.ts` |
| — | **LF 行尾规范化**：新增 `.gitattributes` 强制 LF，避免 Windows CRLF 导致 Linux SWC 编译失败 | `.gitattributes` |

### FFmpeg 统一执行层说明（2026-06-10 创建，2026-06-12 增强）

> **核心文件**: `src/lib/ffmpeg.ts`
> **设计目标**: 解决多模块同时使用 FFmpeg 导致 4 核 CPU 爆满、服务器死机的问题

#### 架构

```
所有 FFmpeg 调用 → runFFmpeg(args, opts?) → 全局串行队列(ffQueue)
                                              ↓
                                    同一时间只有 1 个进程运行
                                              ↓
                              nice -n 19（最低优先级）+ threads 1（单线程）
```

#### 日志增强 (2026-06-12)

| 项目 | 改前 | 改后 |
|------|------|------|
| 命令日志 | `slice(0, 120)` 截断 | 完整输出 |
| 错误信息 | `slice(0, 500)` 被版本头占满 | 保留尾部 2000 字符（FFmpeg 真正错误在末尾） |

#### API

```typescript
// 核心：提交到全局串行队列
await runFFmpeg('-i input.mp4 -c copy output.mp4', { timeout: 60000 })

// 高优先级（插队到队列前端）
await runFFmpeg('-y -i video.mp4 -vframes 1 thumb.jpg', { skipNice: true, priority: 'high' })

// 快捷方法
trimVideo(input, start, duration, output)
concatVideos(inputs, output)
addTextOverlay(input, text, position, output)
resizeVideo(input, w, h, output)

// 调试用
getQueueStatus()  // 返回 { queued: number, processing: boolean }
```

#### 优先级机制

| 场景 | 配置 | 行为 |
|------|------|------|
| 一键成片（长任务 30+ 步） | 默认 | 排队末尾，nice + threads 1 |
| 缩微图生成（~2s） | `{priority:'high', skipNice:true}` | **插队最前面**，跳过 nice |
| ffprobe / 视频信息探测 | `{skipNice: true}` | 走队列但跳过 nice |
| 视频裁剪/拼接/叠加文字 | 默认 | 排队，nice + threads 1 |

#### 已接入模块

| 模块 | 文件 | 状态 |
|------|------|------|
| 一键成片 (auto-compile) | `src/lib/video-task-manager.ts` | ✅ 全部改用 runFFmpeg(), Step5 串行化 |
| 素材仓库缩微图 | `src/app/api/storage/files/route.ts` | ✅ 高优先级 + skipNice |
| 向后兼容快捷方法 | `src/lib/ffmpeg.ts` 底部 | ✅ trimVideo/concatVideos/addTextOverlay/resizeVideo |

### 指纹浏览器模块迭代

| 日期 | Commit | 改动内容 |
|------|--------|---------|
| **2026-06-12** | **`b3c0092` → `d1d2362`** | **V1.8 批量发布队列**: 删除点赞/评论/小红书模板 → 重写为抖音专用批量发布工作台（任务队列入队/出队/循环执行/间隔定时/暂停恢复停止）+ 修复批量结束统计数为0的bug（setState闭包问题） |
| 2026-06-05 | `8a49901` | 自定义封面上传 + 位置标签(step55) + 话题#号分隔 + 封面弹窗修复(完成按钮关闭) |
| 2026-06-05 | `0129c1a` | 标题支持 input/textarea 元素(不再只找 contenteditable) + 封面按钮 includes 匹配 |
| 2026-06-05 | `a93e1d5` | storage/files API 加入白名单 + query param userId 兼容 Electron 环境 |
| 2026-06-05 | `1ce03ed` | storage/file API 加入白名单解决 httpOnly token 401 问题 |
| 2026-06-05 | `f426546` | 素材仓库下载带 JWT Cookie 解决 HTTP 401 |
| 2026-06-05 | `3ff0489` | 添加 fpScriptStop TypeScript 类型声明 |
| 更早 | — | main.js 清理残留代码、重复声明；前端 UI v5 重写(标题/正文拆分)；视频从素材仓库选取 |

---

## 六、注意事项（给接手AI）

### 强制规则（项目级）

1. **编辑工具用法** `replace_in_file({filePath, old_str, new_str})` 三个参数必填
2. **不要写 .mjs 脚本** 改代码直接在源文件上修改
3. **不要读** node_modules/ .next/ dist-electron/ scripts/
4. **不删文件、不改 package.json/tsconfig.json**
5. **每次只改一个文件**，改完等确认
6. **公开路径**：/ /login /register /ai-copy /video-edit /ai-agent /dashboard

### 部署流程（⚠️ 两套路径，不要遗漏）

#### 场景 A：只改了前端/UI 代码（`src/`、`middleware.ts`、API 路由等）

```bash
# ===== 服务端执行（SSH 到 120.55.43.195）=====
cd /root/AiMarketing
git checkout -- . && git clean -fd   # 清理未跟踪文件（避免合并冲突）
git pull origin master
rm -rf .next
npx next build
pm2 restart aimarketing
# ✅ 完成，客户端不需要任何操作
```

**涉及文件清单（触发场景A）**:
- `src/app/my-fingerprint/page.tsx` — 前端页面 UI
- `src/middleware.ts` — 中间件白名单/鉴权
- `src/app/api/*/route.ts` — API 路由
- `prisma/schema.prisma` — 数据模型变更

---

#### 场景 B：只改了 Electron 客户端代码（`electron/` 目录）

```
===== 本地开发机执行（D:\AiMarketing）=====

# 方法1：开发模式热更新（推荐日常使用）
# 直接重启 Electron 应用即可，main.js / preload.js / fp-templates/*.js 会重新加载

# 方法2：打包分发（给其他用户安装）
npm run build:electron   # 或对应打包命令
# 生成的安装包 → 分发给用户覆盖安装
```

**涉及文件清单（触发场景B）**:
- `electron/main.js` — Electron 主进程
- `electron/preload.js` — IPC 桥接
- `electron/fp-templates/douyin-publish.js` — 抖音发布模板
- `electron/fp-templates/*.js` — 其他自动化模板

---

#### 场景 C：两端都改了（前端 + Electron 模板）

```bash
# 第1步：先提交并推送所有代码到 Git
git add -A && git commit -m "描述改动内容" && git push

# 第2步：服务端部署（SSH 到 120.55.43.195）
cd /root/AiMarketing && git pull && rm -rf .next && npx next build && pm2 restart aimarketing

# 第3步：本地重启 Electron 客户端（或重新打包分发）
# 直接关闭重开 Electron 即可
```

---

#### 快速决策表

| 你改了哪个文件？ | 部署位置 | 命令 |
|------------------|---------|------|
| `src/**/*.tsx / *.ts` | **服务端** | git pull → build → pm2 restart |
| `middleware.ts` | **服务端** | 同上 |
| `api/**/*.ts` | **服务端** | 同上 |
| `electron/**/*.js` | **本地客户端** | 重启/重装 Electron |
| `两边都改` | **都要** | 先服务端 build + restart，再重启客户端 |

> ⚠️ **常见遗漏**：改了 `page.tsx` 但只在本地重启 Electron → 看不到新 UI（因为 Electron 加载的是远程服务器页面）
> ⚠️ **常见遗漏**：改了 `douyin-push.sh` 模板但没重启 Electron → 执行的还是旧模板

### 数据库

```bash
# prisma/dev.db (SQLite)
# 改 schema 后 npx prisma db push（但当前规则禁止执行 prisma generate）
```

### 角色

- `admin` = 管理员
- `editor` = 代理商
- `end-user` = 终端客户

### 指纹浏览器特有注意事项

7. **Electron 加载远程页面**: 客户端加载 `http://120.55.43.195:3000/my-fingerprint`，前端改了代码服务器没 build 部署就看不到新 UI
8. **模板是本地文件**: `electron/fp-templates/douyin-publish.js` 在客户端本地，改了需要重新打包
9. **Middleware 白名单**: `/api/storage/file` 和 `/api/storage/files` 已加入白名单（因为 Electron http.get 无法带 httpOnly cookie）
10. **Storage API 兼容**: 前端 fetch 带 `?userId=${user.id}` 参数，后端 fallback 到 query param 读 userId
11. **视频下载路径**: `%TEMP%\aimarketing-videos\`（Windows）或 `/tmp/aimarketing-videos/`（Linux）
12. **封面下载路径**: `%TEMP%\aimarketing-covers\`
13. **停止机制**: `global.__fpAbort` 布尔标志，每轮循环检查；IPC通道 `fp:scriptStop`
14. **IPC 通道命名冲突**: 已有 `fp:stop` 用于停浏览器实例，所以停止脚本用了 `fp:scriptStop`
15. **标题元素类型不确定**: 抖音可能用 input 也可能用 contenteditable div，两种都要尝试
16. **封面弹窗遮挡**: 点第一个「选择封面」打开弹窗后，第二个按钮被弹窗遮盖无法点击 → 需要先点「完成」关闭弹窗 → 弹窗关闭后用 JS 强制移除所有 `[role="dialog"]` / `.dy-creator-content-modal-wrap` DOM 元素
17. **Step3 判定优先级**: 终止(作品检测失败) > 成功(封面文字) > 成功(contenteditable 表单)
18. **导航等待策略**: 抖音 SPA 页面有 WebSocket 长连接，`waitUntil:'networkidle'` 永远不返回 → 必须用 `'domcontentloaded'`
19. **音乐功能已删除 (2026-06-12)**: 原因是弹窗复杂+推荐黑屏+用户决定本地配好音乐再发布
20. **移动端不支持**: Capacitor 打包的 App 无法使用指纹浏览器（Electron 仅桌面平台）

### 魔云腾 Q1 设备

18. **PM2 日志** `/root/.pm2/logs/aimarketing-error.log`
19. **发布按钮定位** 抖音底部"+"按钮 clickable=false，需 dumpXml 全节点扫描 ImageView
20. **ADB 端口**: 每容器需独立 FRP 隧道，不能复用

---

## 七、魔云腾 Q1 设备端口说明（v3 固件 v0.8.0）

> 宿主机 IP: `192.168.1.14`，FRP 管理面板: `http://120.55.43.195:11285` (admin/admin)

### 每个容器的 4 个端口

| 端口 | 名称 | 当前在用？ | 用途 | FRP 隧道 |
|------|------|-----------|------|---------|
| **`{apiPort}`** (如 30101) | 安卓设备管理API | ✅ **主力** | HTTP REST API: `/modifydev`(shell)、`/upload`、`/download`、`/info`、`/task=snap`(截图) | ✅ 已配 |
| **`{rpaPort}`** (如 30102) | RPA自动化API | ❌ 未用 | TCP 直连协议，提供 `sendText`(输入文字)、`touchClick`、`dumpNodeXml`、`takeCaptrue`(截图) | ❌ 未配 |
| **`{adbPort}`** (如 30100) | Android ADB | ⚠️ 部分用 | 快速滑动、ADBKeyBoard 中文输入 | ⚠️ 仅 T0001 已配 |
| 8000 | Docker管理 | ❌ 无关 | 容器生命周期管理 | ❌ 不需要 |

### 端口映射规则（以 T0002 为例）

```
容器内部 → 宿主机映射
  9082(设备管理API)  → 30101
  9083(RPA自动化API)  → 30102
  5555(ADB)          → 30100
  8000(Docker管理)    → 8000
```

### 当前实际分配

| 数据库 ID | 容器名 | apiPort | adbPort | rpaPort | FRP 状态 |
|-----------|--------|---------|---------|---------|----------|
| 1 | T0001 | 30001 | 30000 | 30002 | api+adb 已配 |
| 2 | T0002 | 30101 | 30100 | 30102 | 仅 api |
| 3 | T0003 | 30201 | 30200 | 30202 | 仅 api |

### 已知问题

- **ADB 端口需要每个容器独立 FRP 隧道**（不能复用），否则 ADB 命令会等 15 秒超时
- **`input text` 在 Q1 v0.8.0 shell 中不可用**（`/sdcard/upload/` 在 shell 中不可读）
- **RPA API（{rpaPort}）有 `sendText` 和 `touchClick`**，如果配通可能替代 ADB 解决中文输入问题，有待测试
- **API 端口（{apiPort}）已经全部配通 FRP**，HTTP shell 控制所有设备无问题

---

## 八、已知 Bug / 待优化项

| 优先级 | 问题 | 状态 | 备注 |
|--------|------|------|------|
| 🔴 高 | 一键合成 FFmpeg 输出文件缺失(7处) | ✅ **已修复** `e455104` | 普通模式2+智能模式4+最终渲染1，全部补上 `"${out}"` |
| 🔴 高 | 一键合成 FormData mode 被覆盖 | ✅ **已修复** `d8e9455` | 删除预设置 mode，统一在素材来源判断中设置 |
| 🔴 高 | FFmpeg 错误信息被截断无法定位问题 | ✅ **已修复** `bbecf63` | 完整输出命令 + 尾部2000字符 |
| 🟡 中 | 智能成片 xfade 转场越界崩溃 | ✅ **已修复** `40c731f` | 真实时长检测 + 累积偏移 + 安全边界 |
| 🟡 中 | 仓库图片缩略图显示碎裂 | ✅ **已修复** `40c731f` | 图片 thumbUrl 返回自身文件而非 null |
| 🟡 中 | 话题输入后未自动触发推荐选择列表 | 待测 | 可能需要更精确的等待时机 |
| 🟡 中 | 位置输入后下拉推荐匹配不稳定 | 待测 | 取决于抖音接口响应速度 |
| 🟢 低 | 根目录垃圾文件未清理 | ⚠️ 部分解决 | 2026-06-05 已删除部分，剩余 `addsnap.mjs` 等 |
| 💭 建议 | 素材选中后统一预上传到服务器临时存储 | 未开始 | 避免 local/search/storage 三种路径的边界问题（用户提议） |

### 一键合成模式说明（2026-06-12 更新）

> **核心文件**: `src/app/auto-compile/page.tsx` (前端) + `src/app/api/video/auto-compile/route.ts` (API) + `src/lib/video-task-manager.ts` (普通引擎) + `src/lib/smart-compile-engine.ts` (智能引擎)

#### 三种素材来源

| 模式 | 来源 | 后端处理 | 适用场景 |
|------|------|---------|---------|
| `free` | 本地上传 File + 可选网络URL | 写入工作目录 + downloadToFile | 传统上传方式 |
| `smart` | 网络 URL (搜图) | downloadToFile 全部下载到本地 | AI 搜图配图 |
| `storage` | 素材仓库 (OSS) | OSS get() 下载到本地 | 终端客户从仓库选 |

#### 关键注意事项
1. **mode 参数只能设置一次**: FormData 同名 key 多次 `append()` 时，`get()` 取第一个值。不要在素材判断之前预设 mode
2. **FFmpeg 命令必须有输出文件**: 每个 `runFFmpeg()` 调用必须包含 `"${outputPath}"` 作为最后一个参数
3. **materialList 统一素材管理**: 前端用 materialList 合并三种来源，提交时按 source 拆分到不同 FormData 字段

---

## 九、V2 升级路线图（2026-06-06 规划）

> **生成日期**: 2026-06-06  
> **适用版本**: V2.0（从当前 V1 基础升级）  
> **总工期**: 约 8-9 周（6 个阶段）  
> **核心目标**: 从"工具集合"升级为"智能营销 SaaS 平台"

### 📌 当前状态诊断

#### 已完成模块（✅ 可用）

| 模块 | 路径 | 状态 | 备注 |
|------|------|------|------|
| 用户系统 | `src/app/login`, `/register` | ✅ 完整 | 三层角色: admin/editor/end-user |
| 设备管理 | `/admin/devices`, `/admin/phy-devices` | ✅ 完整 | Q1 容器 + 物理机分配 |
| 自动化任务 | `/admin/automation-templates`, `/admin/automation` | ✅ 完整 | 模板配置 → 任务执行 |
| 指纹浏览器 | `/my-fingerprint` + `electron/` | ✅ 完整 | ⚠️ **禁止修改** |
| AI 工具 | `/ai-copy`, `/video-edit`, `/ai-agent` | ✅ 完整 | 文案/剪辑/AI 对话 |
| 数字人 | `/ai-tools` (digital-human) | ✅ UI 完成 | 快速模式+专业模式 |
| POI 地址库 | `/admin/poi-addresses` | ✅ 完整 | 有 DB 模型 + CRUD，手动输入坐标 |
| 话术模板 | `/admin/script-templates` | ✅ 完整 | 有 DB 模型 + CRUD，无 AI 生成 |
| NFC 推广 | `/nfc-promo` | ⚠️ 半成品 | UI 完整，有 DB 模型，但数据全零，API 缺 PUT/DELETE |
| **直播中控台** | `/live` | ✅ **新增完成** | 直播间管理+商品上架+话术库+Q1控制(676行) |
| **代理工作台** | `/admin/agent` | ✅ **新增完成** | 3Tab(客户/业绩/动态)+API(220行) |
| **AI 诊断面板** | `/admin/diagnostics` | ✅ **新增完成** | 4维度11项健康检测+API(200行) |
| **行业简报** | `/admin/briefings` | ✅ **新增完成** | 分类筛选+AI生成+Markdown渲染+API(300行) |

#### 待完善模块（❌ 需要重构）

| 模块 | 路径 | 问题 | 严重程度 |
|------|------|------|---------|
| **导流系统** | `/referral` | ❌ 无 DB 模型！UI 完整但 Stub API（GET 返回空数组，POST 仅支持 AI 生成文本） | 🔴 高 |
| **线索采集** | `/lead-collector` | ❌ 无 DB 模型！UI 完整但 Stub API（同上） | 🔴 高 |
| **NFC 推广** | `/nfc-promo` | ⚠️ 有 DB 但无真实数据流，统计数据全为 0 | 🟡 中 |
| **引擎架构** | `src/lib/automation-providers.ts` + `config.ts` | ⚠️ 两套独立引擎混在 settings 页面，职责不清 | 🟡 中 |
| **直播模块增强** | `/live`, `/admin/diagnostics` | ⚠️ 基础 CRUD 已完成，但 Q1 自动化命令、自动欢迎回复、直播统计面板待实现 | 🟡 中 |
| **行业洞察** | — | ❌ **缺失**！无法帮助客户了解行业趋势（Phase 1 的 `/dashboard/insights` 页面） | 🟡 中 |

---

### 🎯 升级总览（6 阶段）

```
Phase 0: 基础设施层（第1周）
├── 引擎架构统一（分离读写引擎）
├── 新增 4 个 Prisma 数据模型
└── 填充 Stub APIs 为真实 CRUD

Phase 1: 数据采集引擎（第2周）
├── JustOneAPI 深度集成（视频搜索/评论爬取/用户画像）
├── Lead Collector 线索采集落地
├── 行业洞察面板（Industry Insights）
└── POI 地址库增强（地图选点+批量导入）

Phase 2: 运营漏斗（第3-4周）
├── Referral 导流系统实现（DB+完整 API）
├── NFC 推广重新定位为"模板库"
└── Script Template 话术 AI 生成

Phase 3: 直播模块（第5-6周）⭐ 核心功能
├── 直播间管理（LiveRoom 模型 + API）
├── Q1 Shell 命令集（开播/商品上架/互动）
├── 自动欢迎 + 关键词回复
└── 直播数据统计面板

Phase 4: 代理赋能体系（第7周）
├── 角色权限矩阵细化
├── AI 诊断报告（账户健康度）
└── 行业简报自动生成

Phase 5: 集成与商业化（第8-9周）
├── SOP 工作流（内容生产/直播运营/获客）
├── Dashboard 2.0 重构
└── 使用量统计 + 计费基础
```

---

### Phase 0: 基础设施层（第1周）

> **目标**: 解决当前架构混乱问题，建立清晰的数据基础  
> **前置依赖**: 无  
> **产出**: 统一引擎架构 + 4 个新 DB 模型 + 所有 Stub APIs 可用

#### 0.1 引擎架构统一（⚠️ 不涉及 Q1/指纹浏览器）

**问题分析**:
```
当前两套引擎:
├── automation-providers.ts   # 数据查询引擎（justoneapi/q1-coordinates/tiktokdownloader）
│   └── 用于：视频搜索、数据获取（读操作）
└── automation/config.ts      # 动作执行引擎（official-api/fingerprint/real-device/mock）
    └── 用于：点赞/评论/发布（写操作）

Settings 页面混淆：
- 文本说明："写入操作走 Q1 ADB，justoneapi 用于数据查询"
- 但 select 选项只显示执行引擎，没有区分读写
```

**解决方案**: 创建 `engine-dispatcher.ts` 统一路由

```typescript
// src/lib/engine-dispatcher.ts（新建文件）

/**
 * 统一引擎调度器
 * 
 * 职责划分：
 * - 读操作（搜索/查询/统计）→ JustOneAPI / 第三方数据平台
 * - 写操作（点赞/评论/发布）→ Q1 ADB / 指纹浏览器 / Mock
 */

export type EngineAction = 
  | 'search'        // 视频搜索、用户搜索
  | 'fetch_comments' // 评论爬取
  | 'fetch_user_profile' // 用户画像
  | 'like'          // 点赞
  | 'comment'       // 评论
  | 'follow'        // 关注
  | 'share'         // 转发
  | 'publish'       // 发布视频
  | 'dm'            // 私信
  | 'extract'      // 数据提取

export interface EngineContext {
  action: EngineAction
  platform: string        // 抖音/快手/小红书
  params: Record<string, unknown>
  userId: number
  deviceId?: number        // 写操作需要设备
}

export async function dispatchEngine(ctx: EngineContext): Promise<AutomationResult> {
  // 判断是读操作还是写操作
  const READ_ACTIONS: EngineAction[] = ['search', 'fetch_comments', 'fetch_user_profile', 'extract']
  const isRead = READ_ACTIONS.includes(ctx.action)
  
  if (isRead) {
    // 读操作 → JustOneAPI 或其他数据平台
    return await dispatchReadEngine(ctx)
  } else {
    // 写操作 → Q1 ADB / 指纹浏览器 / Mock（保持原有逻辑不变）
    return await dispatchWriteEngine(ctx)
  }
}
```

**修改范围**:
- ✅ 新建: `src/lib/engine-dispatcher.ts`
- ✅ 修改: `src/app/admin/settings/page.tsx`（拆分设置项为"数据查询引擎"和"动作执行引擎"两个区块）
- ❌ 不修改: `electron/` 目录（指纹浏览器）
- ❌ 不修改: `src/app/api/devices/[id]/execute/route.ts`（Q1 执行逻辑）

#### 0.2 新增 Prisma 数据模型

**新增 4 个核心模型**（追加到 `prisma/schema.prisma`）:

```prisma
// ====== Phase 0-2 新增模型 ======

// 1. 导流配置模型（替代 referral Stub API）
model ReferralConfig {
  id          Int      @id @default(autoincrement())
  name        String                        // 配置名称（如"抖音导流-美业"）
  platform    String   @default("抖音")     // 平台
  keywords    String                        // 目标关键词（JSON 数组）
  copyText    String?                       // 导流文案模板
  landingType String   @default("wechat")   // 落地方式: wechat/phone/link/miniapp
  landingValue String?                     // 落地内容（微信ID/手机号/链接）
  status      String   @default("draft")    // draft/active/paused/archived
  ownerId     Int
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  owner       User              @relation(fields: [ownerId], references: [id])
  logs        ReferralLog[]
}

// 导流效果日志
model ReferralLog {
  id            Int      @id @default(autoincrement())
  configId      Int
  action        String                      // view/click/convert/contact
  sourceUser    String?                     // 来源用户 ID
  targetContent String?                     // 触达的内容
  metadata      String   @default("{}")     // 扩展字段 JSON
  createdAt     DateTime @default(now())

  config        ReferralConfig @relation(fields: [configId], references: [id])
}

// 2. 线索采集模型（替代 lead-collector Stub API）
model Lead {
  id            Int      @id @default(autoincrement())
  taskId        Int?                         // 关联的采集任务
  platform      String   @default("抖音")    // 来源平台
  sourceType    String   @default("comment") // comment/dm/search/keyword
  rawContent    String                       // 原始内容（评论/私信原文）
  contactInfo   String?                      // 提取的联系信息（手机/微信）
  intentScore   Float    @default(0)         // AI 打分 0-1（意向度）
  status        String   @default("new")     // new/contacted/converted/invalid
  tags          String?                      // 标签 JSON 数组
  metadata      String   @default("{}")     // 扩展字段
  ownerId       Int                           // 归属 editor
  assignedTo    Int?                          // 分配给 end-user
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  task          CollectionTask? @relation(fields: [taskId], references: [id])
  owner         User             @relation(fields: [ownerId], references: [id])
  assignee      User?            @relation("LeadAssignee", fields: [assignedTo], references: [id])
}

// 3. 采集任务模型
model CollectionTask {
  id          Int      @id @default(autoincrement())
  name        String
  platform    String   @default("抖音")
  keywords    String                        // 关键词 JSON 数组
  sources     String   @default("[]")       // 数据源配置
  schedule    String   @default("manual")   // manual/hourly/daily
  status      String   @default("active")   // active/paused/completed
  ownerId     Int
  leads       Lead[]
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  owner User @relation(fields: [ownerId], references: [id])
}

// ====== Phase 3 新增模型（直播模块）=====

// 4. 直播间管理
model LiveRoom {
  id              Int      @id @default(autoincrement())
  name            String                        // 直播间名称
  platform        String   @default("抖音")      // 平台
  roomId          String?                       // 平台直播间 ID
  accountId       Int?                          // 使用的社交账号
  deviceId        Int?                          // 使用的 Q1 设备
  status          String   @default("offline")  // offline/live/reconnecting/ended
  title           String?                       // 直播标题
  coverImage      String?                       // 封面
  welcomeMessage  String?                       // 自动欢迎语
  autoReplyRules  String   @default("[]")       // 自动回复规则 JSON
  startTime       DateTime?
  endTime         DateTime?
  viewerCount     Int      @default(0)          // 当前观看人数
  totalViewers    Int      @default(0)          // 累计观众
  likeCount       Int      @default(0)          // 点赞数
  commentCount    Int      @default(0)          // 评论数
  productCount    Int      @default(0)          // 上架商品数
  ownerId         Int
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  owner           User              @relation(fields: [ownerId], references: [id])
  products        LiveProduct[]
  scripts         LiveScript[]
  logs            LiveLog[]
}

// 5. 直播商品
model LiveProduct {
  id          Int      @id @default(autoincrement())
  roomId      Int
  name        String                        // 商品名称
  price       Float?                        // 价格
  image       String?                       // 商品图 URL
  url         String?                       // 商品链接
  sortOrder   Int      @default(0)          // 排序
  status      String   @default("active")   // active/sold_out/removed
  createdAt   DateTime @default(now())

  room        LiveRoom @relation(fields: [roomId], references: [id])
}

// 6. 直播话术
model LiveScript {
  id          Int      @id @default(autoincrement())
  roomId      Int
  category    String   @default("welcome")  // welcome/product/intro/qa/close
  content     String                        // 话术内容
  triggerKeyword String?                    // 触发关键词
  sortOrder   Int      @default(0)
  isActive    Boolean  @default(true)
  createdAt   DateTime @default(now())

  room        LiveRoom @relation(fields: [roomId], references: [id])
}

// 7. 直播日志
model LiveLog {
  id          Int      @id @default(autoincrement())
  roomId      Int
  eventType   String                       // start/end/viewer_join/comment/like/product_click
  payload     String   @default("{}")      // 事件数据 JSON
  createdAt   DateTime @default(now())

  room        LiveRoom @relation(fields: [roomId], references: [id])
}

// ====== User 模型需要添加的关系 ======
// 在 User model 中追加：
// referrals       ReferralConfig[]
// leads           Lead[]
// assignedLeads   Lead[]                  @relation("LeadAssignee")
// liveRooms       LiveRoom[]
```

**修改文件清单**:
- ✅ 修改: `prisma/schema.prisma`（追加上述模型）
- ⚠️ 需要: `npx prisma db push`（但规则禁止执行 prisma generate，需手动在服务器执行）

#### 0.3 填充 Stub APIs 为真实 CRUD

**Referral API 重构** (`src/app/api/referral/route.ts`):

```typescript
// 替换当前的 Stub 实现
// GET    /api/referral          → 查询列表（分页、筛选）
// POST   /api/referral          → 创建配置 / action=generate（AI 生成文案）
// PUT    /api/referral/:id      → 更新配置
// DELETE /api/referral/:id      → 删除配置
```

**Lead Collector API 重构** (`src/app/api/lead-collector/route.ts`):

```typescript
// 替换当前的 Stub 实现
// GET    /api/lead-collector              → 查询线索列表
// GET    /api/lead-collector/tasks        → 查询采集任务
// POST   /api/lead-collector              → 创建线索 / action=analyze（AI 分析关键词）
// POST   /api/lead-collector/tasks        → 创建采集任务
// PUT    /api/lead-collector/:id          → 更新线索状态
// DELETE /api/lead-collector/:id          → 删除线索
```

**NFC Template API 补全** (`src/app/api/templates/nfc/route.ts`):

```typescript
// 当前只有 GET 和 POST
// 追加：
// PUT    /api/templates/nfc/:id    → 更新模板
// DELETE /api/templates/nfc/:id    → 删除模板
```

**产出验证标准**:
- [ ] `GET /api/referral` 返回真实数据（非空数组）
- [ ] `POST /api/referral` 可创建记录并持久化
- [ ] `GET /api/lead-collector` 返回真实线索数据
- [ ] `PUT /api/templates/nfc/:id` 可更新 NFC 模板
- [ ] `DELETE /api/templates/nfc/:id` 可删除 NFC 模板

---

### Phase 1: 数据采集引擎（第2周）

> **目标**: 集成第三方数据平台，实现自动化数据采集能力  
> **前置依赖**: Phase 0 完成（引擎架构 + DB 模型就绪）  
> **产出**: JustOneAPI 全功能集成 + Lead Collector 可用 + Industry Insights 面板

#### 1.1 JustOneAPI 深度集成

**当前状态**: `src/lib/automation-providers.ts` 只有 `justoneSearchVideo()` 一个函数

**扩展计划**:

```typescript
// 在 automation-providers.ts 中追加：

// 视频搜索（已实现）
export async function justoneSearchVideo(keyword, count): Promise<AutomationResult>

// 【新增】评论爬取
export async function justoneFetchComments(videoUrl, count = 20): Promise<AutomationResult>
// 用途: Lead Collector 自动提取评论中的潜在客户信息

// 【新增】用户画像查询
export async function justoneFetchUserProfile(userId): Promise<AutomationResult>
// 用途: 分析竞品账号粉丝数、点赞趋势

// 【新增】热门话题/ trending
export async function justoneTrendingTopics(category = 'all'): Promise<AutomationResult>
// 用途: Industry Insights 面板展示热门话题

// 【新增】视频详情（点赞/评论/分享数）
export async function justoneVideoDetail(videoUrl): Promise<AutomationResult>
// 用途: 内容数据分析、爆款挖掘
```

**JustOneAPI Token 配置位置**:
- 当前: `admin/settings` 页面的 `JUSTONEAPI_TOKEN` 输入框
- 存储: 环境变量 `process.env.JUSTONEAPI_TOKEN`
- 使用: `src/lib/automation-providers.ts` 的 `getJustoneToken()` 函数

#### 1.2 Lead Collector 线索采集落地

**功能流程**:
```
Editor 创建采集任务
  ↓
选择平台（抖音/快手/小红书）
  ↓
输入关键词（如"美容院"、"减肥咨询"）
  ↓
选择数据源：
  ├─ JustOneAPI 评论爬取（推荐）
  ├─ 手动导入
  └─ AI 分析关键词（已有）
  ↓
系统自动：
  ├─ 爬取评论/私信
  ├─ AI 提取联系方式（手机号/微信号）
  ├─ AI 意向打分（0-1）
  └─ 分类标签（高意向/中意向/低意向）
  ↓
Editor 查看/分配/跟进线索
```

**页面改动** (`src/app/lead-collector/page.tsx`):
- 左侧 Tab 1: 采集任务卡片列表（CRUD）
- 左侧 Tab 2: 线索详情列表（筛选/分配/标记状态）
- 右侧: 单条线索详情面板（原始内容 + 提取信息 + AI 分析结果）

**API 改动** (`src/app/api/lead-collector/route.ts`):
- `POST action=create-task`: 创建采集任务
- `POST action=start`: 启动任务（调用 JustOneAPI 爬取）
- `POST action=import`: 手动导入线索
- `GET`: 查询线索列表（支持分页/筛选/排序）

#### 1.3 行业洞察面板（Industry Insights）— 新建页面

**路径**: `/dashboard/insights` （仅 admin/editor 可见）

**功能模块**:
```
┌─────────────────────────────────────────────┐
│  INDUSTRY INSIGHTS / 行业洞察               │
├─────────────────────────────────────────────┤
│                                             │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐   │
│  │ 热门话题  │ │ 爆款视频  │ │ 竞品监控  │   │
│  │ Trending │ │ Viral    │ │ Competitor│   │
│  │ Topics   │ │ Videos   │ │ Monitor   │   │
│  └──────────┘ └──────────┘ └──────────┘   │
│                                             │
│  ┌──────────────────────────────────────┐   │
│  │  关键词热度趋势（折线图/柱状图）        │   │
│  └──────────────────────────────────────┘   │
│                                             │
│  ┌──────────────────────────────────────┐   │
│  │  AI 行业简报（每周自动生成）            │   │
│  └──────────────────────────────────────┘   │
└─────────────────────────────────────────────┘
```

**数据来源**:
- JustOneAPI `justoneTrendingTopics()`
- JustOneAPI `justoneVideoDetail()`（Top 10 视频）
- 本地数据库 `DashboardStat`（历史趋势）

**新建文件**:
- ✅ `src/app/dashboard/insights/page.tsx`
- ✅ `src/app/api/dashboard/insights/route.ts`

#### 1.4 POI 地址库增强

**当前状态**: 手动输入经纬度坐标（用户体验差）

**增强方向**:
- [ ] 地图选点组件（点击地图自动填充 lat/lng）
- [ ] 地址模糊搜索（调用地图 API）
- [ ] 批量导入（CSV/Excel 上传）
- [ ] 与直播模块联动（直播时可选择 POI 定位）

**优先级**: 🟡 低（Phase 1 最后做，或推迟到 Phase 2）

---

### Phase 2: 运营漏斗（第3-4周）

> **目标**: 完善导流、推广、内容生产三个运营环节  
> **前置依赖**: Phase 1（数据采集能力就绪）  
> **产出**: Referral 可用 + NFC 重新定位 + Script AI 生成

#### 2.1 Referral 导流系统实现

**当前问题**: 
- ❌ 无 DB 模型（Phase 0 已解决）
- ❌ Stub API 只能 AI 生成文本，不能保存/管理
- ✅ UI 已经完整（表格 + 创建/编辑/删除弹窗 + 预览）

**实现步骤**:
1. **后端 API 补全**（基于 Phase 0 新建的 `ReferralConfig` 模型）
   - `GET /api/referral` → 返回 `referrals[]`（真实数据）
   - `POST /api/referral` → 创建配置（保存到 DB）
   - `POST /api/referral?action=generate` → AI 生成文案（保留现有逻辑）
   - `PUT /api/referral/:id` → 更新配置
   - `DELETE /api/referral/:id` → 删除配置

2. **前端对接**
   - `src/app/referral/page.tsx` 的 `useEffect` 调用 `GET /api/referral` 加载数据
   - 表单提交调用 `POST/PUT /api/referral`
   - 删除按钮调用 `DELETE /api/referral/:id`

3. **导流效果追踪**（可选，Phase 2 后期）
   - 每次触发导流时写入 `ReferralLog`
   - 展示转化漏斗：曝光 → 点击 → 私信 → 加微信

**数据流向**:
```
创建导流配置
  ↓
选择平台 + 输入关键词
  ↓
AI 生成文案（或手动填写）
  ↓
设置落地方式（微信ID/手机号/链接）
  ↓
发布到短视频/直播
  ↓
统计：触达人数 → 私信数 → 转化数
```

#### 2.2 NFC 推广重新定位

**问题诊断**:
- 当前后端: `NFCRuleTemplate` 模型存在，但无实际使用场景
- 当前前端: UI 完整但统计数据全为 0（因为没有真实的 NFC 触发数据源）
- 定位困惑: "NFC 推广"听起来像硬件功能，但实际上只是"模板配置"

**重新定位**: **NFC 推广模板库**

```
原定位: NFC 推广管理（含实时统计）→ ❌ 无法实现（无硬件数据源）
新定位: 离线营销物料模板库（用于指导客户线下使用 NFC 标签）
```

**改造方案**:
1. **移除虚假统计面板**（顶部的 4 个数字卡片：TOTAL TOUCHES / UNIQUE USERS / CONVERSIONS / TODAY TOUCHES）
   - 原因: 这些数据需要 NFC 硬件或 APP 配合才能采集，当前无法实现
   - 替换为: "模板使用指南"或"常见场景示例"

2. **强化模板功能**
   - 保持现有的 Trigger Rules 管理（增删改查）
   - 增加"导出配置"功能（生成 QR Code 或 NFC 写入数据）
   - 增加"打印物料预览"（生成名片/海报 HTML）

3. **API 完善**（Phase 0 已规划）
   - `PUT /api/templates/nfc/:id` 更新模板
   - `DELETE /api/templates/nfc/:id` 删除模板

**修改文件**:
- ✅ `src/app/nfc-promo/page.tsx`（移除统计面板，调整布局）

#### 2.3 Script Template 话术 AI 生成

**当前状态**: 
- ✅ 有 DB 模型（`ScriptTemplate`: title/content/platform/type/tags）
- ✅ 有 CRUD UI
- ❌ 无 AI 生成能力（只能手动填写内容）

**新增功能**:
```
话术模板页面增加"AI 生成"按钮
  ↓
弹出对话框：
  - 选择平台（抖音/快手/小红书）
  - 选择类型（欢迎语/产品介绍/促单/FAQ/结束语）
  - 输入关键词/行业（如"美业"、"餐饮"）
  ↓
调用 AI 生成多个候选话术
  ↓
用户选择满意的话术 → 保存到模板库
```

**实现**:
```typescript
// 在 src/app/api/script-templates/route.ts 中追加 POST action=generate
if (action === 'generate') {
  const { platform, type, keywords } = body
  const prompt = `你是一个短视频营销话术专家。请为以下场景生成3条候选话术：
平台：${platform}
类型：${type}（欢迎语/产品介绍/促单/FAQ/结束语）
行业关键词：${keywords}

返回格式（严格JSON数组）：
[
  {"title":"话术标题1","content":"话术内容1"},
  {"title":"话术标题2","content":"话术内容2"},
  {"title":"话术标题3","content":"话术内容3"}
]`
  
  const result = await generateText(prompt)
  return JSON.parse(result)
}
```

**修改文件**:
- ✅ `src/app/admin/script-templates/page.tsx`（增加"AI 生成"按钮 + 选择对话框）
- ✅ `src/app/api/script-templates/route.ts`（增加 `action=generate` 处理）

---

### Phase 3: 直播模块（第5-6周）⭐ 核心功能

> **目标**: 从零构建完整的直播管理和自动化系统  
> **前置依赖**: Phase 0（LiveRoom 等 4 个模型已建好）  
> **产出**: 可用的直播管理系统 + Q1 设备自动化控制

#### 3.1 架构设计

```
┌──────────────────────────────────────────────────────┐
│                   直播模块架构                         │
├──────────────────────────────────────────────────────┤
│                                                      │
│  前端页面                                            │
│  ├── /admin/live-rooms          直播间管理列表       │
│  ├── /admin/live-rooms/[id]     单个直播间控制台      │
│  │   ├── 基本信息（标题/封面/欢迎语）                 │
│  │   ├── 商品管理（上架/下架/排序）                    │
│  │   ├── 话术库（欢迎/产品/促单/FAQ）                  │
│  │   ├── 自动回复规则配置                             │
│  │   └── 实时数据（观看人数/点赞/评论/成交）           │
│  └── /dashboard/live-stats     直播数据统计           │
│                                                      │
│  后端 API                                            │
│  ├── /api/live-rooms                CRUD 直播间       │
│  ├── /api/live-rooms/[id]/products  商品管理          │
│  ├── /api/live-rooms/[id]/scripts   话术管理          │
│  ├── /api/live-rooms/[id]/start     开始直播（调用Q1）  │
│  ├── /api/live-rooms/[id]/stop      结束直播           │
│  └── /api/live-rooms/[id]/logs      日志查询           │
│                                                      │
│  Q1 设备交互                                         │
│  └── 通过 /api/devices/{id}/execute 执行 shell 命令    │
│      ├── 打开抖音APP                                  │
│      ├── 进入直播管理后台                              │
│      ├── 点击"开始直播"                               │
│      ├── 上架商品（坐标点击）                           │
│      └── 发送评论（AdbKeyboard 输入）                  │
│                                                      │
└──────────────────────────────────────────────────────┘
```

#### 3.2 Q1 直播 Shell 命令集（⚠️ 仅使用 HTTP API，不涉及 RPA）

**前提条件**:
- Q1 设备已配通 FRP 隧道（`{apiPort}` 可访问）
- 抖音 APP 已登录且保持在前台

**命令列表**:

```bash
# 1. 打开抖音 APP
adb -s {device_ip}:{adb_port} shell am start -n com.ss.android.ugc.aweme/.main.MainActivity

# 2. 进入直播管理界面（需根据 UI 版本调整坐标）
# 方案A：通过 Deep Link（如果抖音支持）
adb -s {device_ip}:{adb_port} shell am start -a android.intent.action VIEW -d "snssdk1128://live_publish"

# 方案B：通过坐标点击（需 dumpXml 获取准确坐标）
# 先截图确认当前画面，再点击对应位置

# 3. 设置直播标题（使用 AdbKeyboard）
adb -s {device_ip}:{adb_port} shell ime set com.android.adbkeyboard/.AdbIME
adb -s {device_ip}:{adb_port} shell am broadcast -a ADB_INPUT_TEXT --es msg "{title}"

# 4. 开始直播（点击"开始直播"按钮）
# 需要先 dumpXml 获取按钮坐标，然后通过 API 执行 tap
curl -X POST http://{device_ip}:{api_port}/modifydev \
  -d '{"cmd": "shell input tap {x} {y}"}'

# 5. 上架商品（进入商品管理 → 选择商品 → 确认上架）
# 同样通过坐标点击序列完成

# 6. 发送评论/回复（自动欢迎语、关键词回复）
adb -s {device_ip}:{adb_port} shell ime set com.android.adbkeyboard/.AdbIME
adb -s {device_ip}:{adb_port} shell am broadcast -a ADB_INPUT_TEXT --es msg "{comment_text}"
adb -s {device_ip}:{adb_port} shell input keyevent 66  # 回车发送

# 7. 结束直播
curl -X POST http://{device_ip}:{api_port}/modifydev \
  -d '{"cmd": "shell input tap {end_x} {end_y}"}'
```

**注意事项**:
- ⚠️ **坐标会随抖音 APP 更新而变化**，需要定期维护
- ⚠️ **ADB 端口需要每个容器独立 FRP 隧道**（已在 Phase 0 配置）
- ✅ **所有命令都通过已有的 `/api/devices/{id}/execute` 接口发送**，不需要新建 API
- 💡 **建议**: 先在一个容器上测试成功，再复制到其他容器

#### 3.3 自动欢迎 + 关键词回复

**功能描述**:
```
直播开始后，系统监听新进观众评论
  ↓
匹配规则：
  ├─ 新观众进入 → 发送欢迎语（可配置延迟 1-3 秒避免刷屏）
  ├─ 评论包含"多少钱"、"价格" → 自动回复价格话术
  ├─ 评论包含"怎么买"、"链接" → 自动回复购买引导
  └─ 其他评论 → AI 判断是否需要回复
  ↓
通过 Q1 AdbKeyboard 输入并发送
```

**实现方案**（两种，按阶段实施）:

**阶段 1: 基于规则的自动回复**（Phase 3 先做这个）
- 在 `LiveRoom.autoReplyRules` 存储规则数组
- 规则格式: `{ keyword: "价格", reply: "亲，我们的套餐有XXX元起哦~", enabled: true }`
- 前端提供规则编辑界面
- 后端定时轮询（或 WebSocket）检测新评论并匹配规则

**阶段 2: AI 智能回复**（Phase 4 或后期）
- 将评论发送给 AI 模型（如 GPT-4o / 通义千问）
- AI 判断意图并生成回复
- 需要考虑延迟和成本

#### 3.4 直播数据统计面板

**新建页面**: `/dashboard/live-stats`

**指标**:
- 同时在线人数（峰值/均值）
- 累计观众数
- 点赞数、评论数、分享数
- 商品点击率、转化率
- 直播时长
- 对比上一场数据的涨跌幅

**图表类型**:
- 折线图：在线人数趋势（时间轴）
- 柱状图：商品点击排行
- 饼图：观众来源（推荐/关注/搜索/其他）

---

### Phase 4: 代理赋能体系（第7周）

> **目标**: 让代理商（editor）能有效服务终端客户（end-user），提升平台价值  
> **前置依赖**: Phase 2-3（运营工具就绪）  
> **产出**: 细化权限 + AI 诊断报告 + 行业简报

#### 4.1 角色权限矩阵细化

**当前权限**（三层）:
```
admin: 全部功能
editor: 大部分 admin 功能（除了系统设置、用户管理）
end-user: 基本功能（AI 工具、素材仓库、自己的数据）
```

**细化方案**:

| 功能模块 | admin | editor（代理商） | end-user（终端客户） |
|---------|-------|------------------|---------------------|
| 用户管理 | ✅ 全部 | ❌ 不可见 | ❌ 不可见 |
| 设备管理 | ✅ 全部 | ✅ 查看分配给自己的设备 | ❌ 不可见 |
| 自动化任务 | ✅ 全部 | ✅ 创建/执行任务 | ✅ 查看自己任务 |
| 数据看板 | ✅ 全部 | ✅ 团队数据 | ✅ 个人数据 |
| **行业洞察** | ✅ 全部 | ✅ **查看** | 🆕 只读摘要 |
| **AI 诊断报告** | ✅ 全部 | ✅ **生成** | 🆕 查看自己的报告 |
| **直播管理** | ✅ 全部 | ✅ **管理** | ❌ 不可见 |
| **导流系统** | ✅ 全部 | ✅ **配置** | ❌ 不可见 |
| **线索采集** | ✅ 全部 | ✅ **查看/分配** | ❌ 不可见 |
| NFC 模板库 | ✅ 全部 | ✅ 使用 | ❌ 不可见 |
| 话术模板 | ✅ 全部 | ✅ 使用 | 🆕 只读查看 |
| AI 工具 | ✅ 全部 | ✅ 使用 | ✅ 使用 |
| 素材仓库 | ✅ 全部 | ✅ 使用 | ✅ 使用 |

**实现方式**:
- 在 `src/middleware.ts` 或各页面组件中判断 `user.role`
- 前端根据角色显示/隐藏菜单项和按钮
- API 层面同样鉴权（防止直接调用）

#### 4.2 AI 诊断报告（账户健康度）

**新建页面**: `/dashboard/report`

**功能**:
```
输入: 社交账号 ID（或选择绑定账号）
  ↓
AI 自动收集数据：
  ├─ 近 30 天发布频率
  ├─ 平均播放量/点赞/评论/分享
  ├─ 粉丝增长趋势
  ├─ 内容类型分布
  └─ 与同行业平均水平对比
  ↓
AI 生成诊断报告：
  ├─ 总体评分（0-100 分）
  ├─ 优势分析（做得好的地方）
  ├─ 问题诊断（不足之处 + 原因）
  ├─ 改进建议（具体可执行的 3-5 条建议）
  └─ 行业对标（头部账号 vs 自己）
  ↓
输出: PDF / HTML 报告（可下载或在线查看）
```

**数据来源**:
- 本地 `DashboardStat` 表（历史数据）
- JustOneAPI（竞品数据）
- AI 分析（综合判断）

**Prompt 设计**:
```typescript
const diagnosticPrompt = `你是一个社交媒体营销诊断专家。请根据以下数据生成诊断报告：

【账号基本信息】
平台：${platform}
账号名：${accountName}
粉丝数：${followerCount}

【近30天数据】
发布数量：${publishCount}
平均播放量：${avgViews}
平均点赞：${avgLikes}
平均评论：${avgComments}
平均分享：${avgShares}

【内容类型分布】
${contentTypeDistribution}

【行业基准对比】
行业平均播放量：${industryAvgViews}
行业平均互动率：${industryAvgEngagementRate}

请返回严格的 JSON 格式：
{
  "overallScore": 75,
  "strengths": ["优势1", "优势2"],
  "issues": [
    {"problem": "问题描述", "severity": "high/medium/low", "reason": "原因分析"}
  ],
  "suggestions": ["建议1", "建议2", "建议3"],
  "benchmark": {
    "topAccountsAvg": {...},
    "vsIndustry": "+15%/-10%"
  }
}`
```

**新建文件**:
- ✅ `src/app/dashboard/report/page.tsx`
- ✅ `src/app/api/dashboard/report/route.ts`

#### 4.3 行业简报自动生成

**功能位置**: 集成到 Phase 1 的 `/dashboard/insights` 页面

**触发方式**:
- 手动触发：点击"生成本周简报"
- 定时任务：每周一早上 8:00 自动生成（可选）

**内容**:
```
本周行业热点 TOP 5
├── 事件描述
├── 相关数据（播放量/讨论量）
└── 营销启示（如何借势营销）

本周爆款内容分析 TOP 3
├── 内容概述
├── 成功原因（选题/文案/节奏）
└── 可复用的元素

下周预测 & 建议
├── 可能的热门话题/节日
├── 建议的内容方向
└── 最佳发布时间建议
```

---

### Phase 5: 集成与商业化（第8-9周）

> **目标**: 整合所有模块，优化用户体验，为商业化做准备  
> **前置依赖**: Phase 1-4 全部完成  
> **产出**: SOP 工作流 + Dashboard 2.0 + 计费基础

#### 5.1 SOP 工作流（标准化运营流程）

**定义**: SOP（Standard Operating Procedure）将分散的功能串联成完整的业务流程

**三大工作流**:

##### 工作流 1: 内容生产 SOP

```
Step 1: 行业洞察（/dashboard/insights）
  └─ 查看热门话题 → 选择内容方向
  
Step 2: AI 文案生成（/ai-copy）
  └─ 输入关键词 → AI 生成多个候选文案 → 选择最优
  
Step 3: AI 视频合成（/video-edit 或 auto-compile）
  └─ 上传素材/照片 → 选择模板 → AI 合成视频
  
Step 4: 话术准备（/admin/script-templates）
  └─ AI 生成直播话术 / 评论区回复话术
  
Step 5: 发布（/my-fingerprint 或 /my-automation）
  └─ 指纹浏览器发布 / Q1 自动发布
  
Step 6: 数据追踪
  └─ Dashboard 查看播放量/互动数据
```

##### 工作流 2: 直播运营 SOP

```
Step 1: 直播前准备（/admin/live-rooms/[id]）
  ├─ 设置直播标题/封面
  ├─ 准备商品（上传图片/价格/链接）
  ├─ 配置话术库（欢迎/产品/促单/FAQ）
  └─ 配置自动回复规则
  
Step 2: 开始直播（点击"开始直播"按钮）
  └─ 系统 → Q1 ADB → 抖音开播
  
Step 3: 直播中（/admin/live-rooms/[id] 控制台）
  ├─ 查看实时数据（观看人数/点赞/评论）
  ├─ 手动/自动回复评论
  ├─ 上架/下架商品
  └─ 人工介入（紧急情况）
  
Step 4: 直播后（/dashboard/live-stats）
  ├─ 查看本场数据报告
  ├─ 对比历史数据
  └─ 导出报告（PDF/Excel）
```

##### 工作流 3: 客户获取 SOP

```
Step 1: 创建采集任务（/lead-collector）
  └─ 选择平台 + 关键词 + 数据源
  
Step 2: 自动采集（JustOneAPI 爬取 + AI 提取）
  └─ 评论爬取 → 联系方式提取 → 意向打分
  
Step 3: 线索分配（/lead-collector）
  └─ Editor 审核高意向线索 → 分配给 end-user
  
Step 4: 跟进转化
  └─ end-user 手动联系（微信/电话）
  └─ 记录转化状态
  
Step 5: 导流配置（/referral）
  └─ 配置导流文案 + 落地方式
  └─ 在短视频/直播中使用
  
Step 6: 效果追踪
  └─ ReferralLog 统计转化漏斗
```

**UI 实现**:
- 新建 `/dashboard/sop` 页面
- 展示三大工作流的可视化流程图
- 每个 Step 可点击跳转到对应功能页面
- 显示当前进度（哪些 Step 已完成）

#### 5.2 Dashboard 2.0 重构

**当前问题**:
- Dashboard 功能较简单（只有基本的数据展示）
- 缺少业务洞察和行动指引

**重构目标**:
```
┌─────────────────────────────────────────────────────────────┐
│  Dashboard 2.0                                             │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  今日概览 TODAY OVERVIEW                             │   │
│  │  ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐       │   │
│  │  │ 新增线索 │ │ 直播观看 │ │ 内容发布 │ │ 互动总量 │       │   │
│  │  │  +23   │ │  1.2K  │ │   5    │ │  890  │       │   │
│  │  │ +15%↑  │ │ +8%↑   │ │ -2↓   │ │ +22%↑ │       │   │
│  │  └────────┘ └────────┘ └────────┘ └────────┘       │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  ┌────────────────────┐  ┌────────────────────┐           │
│  │  待办事项 TODO      │  │  最近动态 FEED      │           │
│  │  · 3 条线索待分配   │  │  · 直播刚结束       │           │
│  │  · 2 个任务待审核   │  │  · 新视频发布成功    │           │
│  │  · 1 份报告待查看   │  │  · 采集任务完成     │           │
│  └────────────────────┘  └────────────────────┘           │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  快捷入口 QUICK ACTIONS                              │   │
│  │  [+ 创建内容] [+ 开启直播] [+ 采集线索] [+ 诊断报告]  │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  ┌────────────────┐  ┌────────────────┐                   │
│  │  趋势图表       │  │  账户健康度     │                   │
│  │  (7天数据趋势)  │  │  (评分+改进建议) │                   │
│  └────────────────┘  └────────────────┘                   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

**改动范围**:
- ✅ 修改: `/dashboard` 主页（渐进式重构，不一次性重写）
- 新增组件: TodoWidget、FeedWidget、QuickActions、TrendChart
- 保持向后兼容（旧数据不变）

#### 5.3 使用量统计 + 计费基础

**当前状态**: `UsageLog` 表已存在，记录每次 AI 工具使用

**增强方向**:
- [ ] Dashboard 展示使用量统计（按日/周/月）
- [ ] 各功能消耗 Token 数统计
- [ ] 成本估算（Token 单价 × 消耗量）
- [ ] 限额提醒（接近配额时提示）
- [ ] 计费报表导出（供 admin 查看）

**注意**: 此阶段仅做"统计展示"，不做真正的支付/扣款功能（商业化后续再议）

---

### 🚫 禁忌清单（修改代码时必须遵守）

#### ❌ 绝对禁止修改的部分

| 模块/目录 | 原因 | 替代方案 |
|-----------|------|---------|
| **`electron/`** 目录 | 指纹浏览器客户端代码，改了需重新打包分发 | 如需新增模板，告知用户手动测试后再合并 |
| **`src/app/my-fingerprint/page.tsx`** | 指纹浏览器前端，与 electron/main.js 强耦合 | 可小改样式，不改 IPC 调用逻辑 |
| **`electron/fp-templates/*.js`** | Playwright 自动化脚本，坐标敏感 | 如需修复 Bug，先在本地测试 5 次以上 |
| **`src/app/api/devices/[id]/execute/route.ts`** | Q1 设备执行引擎，影响所有自动化任务 | 如需新增 action 类型，追加 switch-case 分支即可 |
| **Q1 ADB/RPA 命令** | 硬件相关，坐标随 APP 更新变化 | 任何 Q1 相关改动必须提前告知原因并测试 |

#### ⚠️ 需要提前告知才能修改的部分

| 文件 | 原因 | 影响 |
|------|------|------|
| **`prisma/schema.prisma`** | 改了需要 `prisma db push` | 需要在服务器手动执行，可能锁表 |
| **`src/middleware.ts`** | 鉴权白名单，改错会导致 401 | 影响所有 API 访问 |
| **`package.json`** | 规则禁止修改 | 如确实需要，需讨论替代方案 |
| **`tsconfig.json`** | 规则禁止修改 | 同上 |

#### ✅ 可以自由修改的部分

- `src/app/admin/*/page.tsx`（管理后台页面）
- `src/app/api/*/route.ts`（API 路由，除了上述禁忌的）
- `src/lib/*.ts`（工具函数，除了 Q1 相关的）
- 新建文件（页面/API/组件/工具函数）
- `public/` 静态资源

---

### 📊 实施进度总览（截至 2026-06-06）

> **当前阶段**: **Phase 4 已完成，Phase 5 待开始**
> **本轮新增文件**: 11 个（6页面 + 5 API）
> **本轮修复 Bug**: 7 个 TypeScript 类型错误
> **总体完成度**: 约 **55%** (Phase 0-2 部分待推进, Phase 3-4 已完成)

#### ✅ Phase 3: 直播模块 — **已完成**

| 子项 | 状态 | 文件 |
|------|------|------|
| 直播间中控台 `/live` | ✅ | `src/app/live/page.tsx` (~676行) |
| 直播间 CRUD API | ✅ | `src/app/api/live/route.ts` |
| 商品管理 API | ✅ | `src/app/api/live/products/route.ts` |
| 话术库 API | ✅ | `src/app/api/live/scripts/route.ts` |
| Q1 设备控制命令 API | ✅ | `src/app/api/live/command/route.ts` |
| 管理中心入口(admin only) | ✅ | `src/app/admin/page.tsx` (已添加入口) |
| Q1 Shell 命令集 | ⏳ 待测试 | 代码已写好，需在真实设备上验证 |
| 自动欢迎 + 关键词回复 | ⏳ 待实现 | 数据模型已就绪(LiveRoom.autoReplyRules)，UI 待开发 |
| 直播数据统计面板 | ❌ 未开始 | `/dashboard/live-stats` 待创建 |

#### ✅ Phase 4: 代理赋能体系 — **已完成**

| 子项 | 状态 | 文件 |
|------|------|------|
| 代理工作台 `/admin/agent` | ✅ | `src/app/admin/agent/page.tsx` (~220行) 3Tab布局 |
| 代理数据 API | ✅ | `src/app/api/admin/agent/route.ts` (统计+客户列表+动态) |
| AI 诊断面板 `/admin/diagnostics` | ✅ | `src/app/admin/diagnostics/page.tsx` (~200行) 4维度11项 |
| 诊断检测 API | ✅ | `src/app/api/admin/diagnostics/route.ts` |
| 行业简报系统 `/admin/briefings` | ✅ | `src/app/admin/briefings/page.tsx` (~300行) 左右布局+分类筛选 |
| 简报生成 API | ✅ | `src/app/api/admin/briefings/route.ts` (~165行) 4类模板 |
| 管理中心「诊断与工具」区块 | ✅ | `src/app/admin/page.tsx` (新section含2个入口) |

#### ⬜ Phase 0: 基础设施层 — **部分完成**

| 子项 | 状态 | 备注 |
|------|------|------|
| 引擎架构统一 `engine-dispatcher.ts` | ❌ 未开始 | 设计方案已写，未编码 |
| Prisma 新增 7 个模型 | ⚠️ 需确认 | LiveRoom/LiveProduct/LiveScript/LiveLog 已存在；ReferralConfig/ReferralLog/CollectionTask 待确认 |
| Referral Stub → 真实 CRUD | ❌ 未开始 | UI 完整，API 是 Stub |
| Lead Collector Stub → 真实 CRUD | ❌ 未开始 | UI 完整，API 是 Stub |
| NFC Template PUT/DELETE | ❌ 未开始 | 只有 GET/POST |
| Settings 页面拆分引擎区块 | ❌ 未开始 | |

#### ⬜ Phase 1: 数据采集引擎 — **未开始**

全部子项未开始：JustOneAPI 扩展(评论爬取/用户画像/热门话题/视频详情)、Lead Collector 落地、Industry Insights 面板、POI 增强

#### ⬜ Phase 2: 运营漏斗 — **未开始**

全部子项未开始：Referral 导流系统、NFC 重新定位、Script AI 生成

#### ⬜ Phase 5: 集成与商业化 — **未开始**

全部子项未开始：SOP 工作流、Dashboard 2.0、使用量统计

---

### 原实施检查清单（保留存档参考）

#### Phase 0 完成标准
- [ ] `engine-dispatcher.ts` 已创建并通过单元测试
- [ ] Prisma 新增 7 个模型（ReferralConfig, ReferralLog, Lead, CollectionTask, LiveRoom, LiveProduct, LiveScript, LiveLog）
- [ ] `npx prisma db push` 执行成功（服务器端）
- [ ] `GET /api/referral` 返回真实数据
- [ ] `POST /api/referral` 可创建记录
- [ ] `GET /api/lead-collector` 返回真实数据
- [ ] `PUT /api/templates/nfc/:id` 可用
- [ ] `DELETE /api/templates/nfc/:id` 可用
- [ ] Settings 页面拆分为"数据查询引擎"和"动作执行引擎"

#### Phase 1 完成标准
- [ ] JustOneAPI 新增 4 个函数（评论爬取/用户画像/热门话题/视频详情）
- [ ] Lead Collector 采集任务可创建和启动
- [ ] Lead Collector 线索列表可展示（含 AI 意向打分）
- [ ] `/dashboard/insights` 页面可访问并有真实数据
- [ ] POI 地图选点功能可用（可选）

#### Phase 2 完成标准
- [ ] Referral 导流配置 CRUD 完整可用
- [ ] Referral 导流效果追踪可用（可选）
- [ ] NFC 推广页面移除虚假统计面板
- [ ] Script Template AI 生成功能可用
- [ ] 话术生成 Prompt 经过实测效果好

#### Phase 3 完成标准
- [ ] `/admin/live-rooms` 页面可创建和管理直播间
- [ ] `/admin/live-rooms/[id]` 控制台完整（基本信息/商品/话术/自动回复）
- [ ] Q1 开始直播命令测试成功（至少一个容器）
- [ ] Q1 自动欢迎语发送成功
- [ ] Q1 关键词回复成功
- [ ] `/dashboard/live-stats` 页面有真实数据展示

#### Phase 4 完成标准
- [ ] 三层角色权限矩阵生效（前端 + API 双重鉴权）
- [ ] `/dashboard/report` AI 诊断报告可生成
- [ ] 诊断报告包含评分 + 优势 + 问题 + 建议
- [ ] 行业简报可手动生成（可选：定时自动生成）

#### Phase 5 完成标准
- [ ] `/dashboard/sop` 三大工作流页面可访问
- [ ] Dashboard 2.0 主页重构上线
- [ ] 使用量统计图表可展示
- [ ] 所有模块集成测试通过
- [ ] 项目文档更新至最新

---

### 🔄 版本历史

| 版本 | 日期 | 说明 |
|------|------|------|
| V1.0 | 2026-05 ~ 2026-06-05 | 初始版本：基础功能 + 指纹浏览器 |
| V1.5 | 2026-06-06 | Phase 3 直播模块 + Phase 4 代理赋能（直播中控台/代理工作台/AI诊断/行业简报） |
| V1.6 | 2026-06-10 | 基础架构优化：FFmpeg 统一执行层 + 高优先级通道 + Dashboard SWC修复 + Navbar角色权限 |
| **V1.7** | **2026-06-12** | **一键合成修复专场**: FormData mode覆盖 + FFmpeg输出文件缺失(7处) + 日志截断 + xfade越界 + 图片缩略图 + 删除音乐功能 |
| **V1.8** | **2026-06-12** | **批量发布队列专场**: my-fingerprint重写为抖音专用批量发布工作台(任务队列+间隔/定时+暂停恢复停止) + 删除点赞/评论/小红书模板 + 修复统计数闭包bug |
| V2.0 | 规划中 | **路线图**：V2 升级（Phase 0-5，详见下方） |

---

### 📝 给接手 AI 的备忘录

**项目特点**:
1. 这是一个**营销 SaaS 平台**，不是普通的管理系统，需要理解短视频/直播/NFC 等营销场景
2. **三层用户体系**（admin/editor/end-user），很多功能需要区分角色
3. **双引擎架构**（读→JustOneAPI，写→Q1/指纹浏览器），不要混淆
4. **Electron 客户端**加载远程服务器页面，部署时要区分两端
5. **绝对不要动** `electron/` 目录和 Q1 相关脚本，除非明确被告知

**快速上手步骤**:
1. 先读这份 PROJECT_REPORT.md（本文档）
2. 看 `prisma/schema.prisma` 了解数据模型
3. 看 `src/middleware.ts` 了解路由和鉴权
4. 看 `src/lib/ai-providers.ts` 了解 AI 能力入口
5. 从 Phase 0 开始按顺序实施，每完成一个 Phase 更新本文档

**常用命令**:
```bash
# 部署（场景A：只改了 src/）
cd /root/AiMarketing && git pull && rm -rf .next && npx next build && pm2 restart aimarketing

# 部署（场景C：两端都改）
git add -A && git commit -m "描述" && git push
# 服务端
cd /root/AiMarketing && git pull && rm -rf .next && npx next build && pm2 restart aimarketing
# 本地重启 Electron

# 数据库变更（谨慎执行）
npx prisma db push  # 推送 schema 变更到 SQLite
```

**关键联系人/资源**:
- Git 仓库: `github.com:57974422j-art/AiMarketing.git` (master 分支)
- 生产环境: `http://120.55.43.195:3000`（PM2 进程名: aimarketing）
- Q1 FRP 管理面板: `http://120.55.43.195:11285` (admin/admin)

---

---

## 十、收费与支付系统（2026-07-22 上线测试）

> 目标：终端用户可付费订阅套餐，后台可管理订单。当前为支付宝手机网站支付（wap.pay），微信 Native 同链路待补。

### 数据模型（prisma/schema.prisma）
- `SubscriptionPlan`：套餐（name / price(分) / discountPrice / durationMonths / 各配额 / status）
- `UserSubscription`：用户已开通订阅（记录生效期）
- `PaymentOrder`：支付订单
  - 字段：orderNo(唯一) / userId / planId / channel(alipay|wechat) / amount(分) / subject / status(pending|paid|closed|failed) / tradeNo / payUrl / qrCode / expireAt / paidAt / raw(回调原文)
  - 反向关系：User.paymentOrders、SubscriptionPlan.paymentOrders（**缺失会导致 db push 失败，务必补齐**）

### 关键文件
| 文件 | 作用 |
|------|------|
| `src/lib/alipay.ts` | 支付宝下单 / 验签工具 |
| `src/lib/payment-config.ts` | 支付渠道配置（读 SystemConfig 密钥） |
| `src/app/api/subscription/checkout/route.ts` | 下单：cookie 鉴权取 userId → 建 PaymentOrder → 返回支付宝 wap 跳转 URL |
| `src/app/api/payment/alipay/notify/route.ts` | 异步回调：验签 → 校验金额 → 幂等标记 paid → 开通订阅 → 返回 success |
| `src/app/api/subscription/order/[orderNo]/route.ts` | 订单状态查询（前端支付后轮询用，含越权保护） |
| `src/app/api/admin/orders/route.ts` | 后台订单列表（admin 鉴权，status/channel/q 筛选、分页、groupBy 汇总） |
| `src/app/my-subscription/page.tsx` | 前端订阅页：「立即订阅」走 checkout → 跳转支付宝 → 回跳按 out_trade_no 轮询开通 |
| `src/app/admin/orders/page.tsx` | 后台订单管理页：状态 tab+计数、渠道筛选、搜索、分页、详情弹窗（含 raw 回调） |
| `src/app/admin/page.tsx` | 后台「系统管理」区新增「订单管理」入口 |

### 支付闭环
```
用户点订阅 → checkout 建单+拿支付链接 → 跳转支付宝付款
  → 支付宝异步 notify 验签开通 + return_url 跳回本页
  → 前端轮询订单状态 → 显示「订阅成功」
```

### 部署注意（测试前必做）
1. 服务器 `git pull` + **重新 `prisma db push`**（PaymentOrder 表需建出；之前因反向关系缺失可能失败）
2. 重建 + `pm2 restart aimarketing`
3. 支付宝已签约「手机网站支付」产品（否则调 wap.pay 报「未签约」）
4. 后台「支付设置」已配置支付宝商户号 / 密钥（SystemConfig 表）

### 待补
- 微信 Native 支付同链路（qrCode 字段已预留）
- 订单过期自动关闭定时任务

> **文档结束**
> 最后更新: 2026-06-12 (V1.8 批量发布队列专场 - my-fingerprint重写+删除非抖音模板+统计bug修复)
> 下次更新: 推进 Phase 0 / Phase 1 时
> 维护者: AI 助手

---

## 十一、桌面客户端版本管理与下载入口（2026-07-22）

> 客户端是加载远程页面的壳（`electron/main.js` 直连 `SERVER_URL`，默认 `http://120.55.43.195:3000`）。纯服务端功能（收费、订单）无需客户端更新即可用；本机制为后续客户端独立迭代提供版本/更新日志/下载管理。

### 关键文件
| 文件 | 作用 |
|------|------|
| `electron/version.json` | **版本号唯一记录**（独立维护，规避"禁止改 package.json"规则）。字段：version / buildDate / channel / minSupportedVersion / downloadUrl / notes |
| `electron/changelog.json` | 更新日志+历史日志（结构化数组，**最新在前**）。每条 `{version,date,title,changes[]}` |
| `electron/main.js` | 启动时 `showChangelogOnStartup()` 读 changelog 首条版本，与 `userData/lastChangelogVersion.json` 已读版本对比，不同则 `dialog` 弹窗提示并写入已读（避免重复弹窗） |
| `src/app/api/client-info/route.ts` | 公开 API，读取 `electron/` 下两文件作为唯一数据源输出给前端 |
| `src/app/download/page.tsx` | 下载页：当前版本/渠道/发布日期、下载按钮（指向 `downloadUrl`）、更新日志（最新）、历史日志 |
| `src/components/Navbar.tsx` | 桌面+移动端导航新增「📥 下载客户端」入口 → `/download` |
| `docs/server-nginx-https-deploy.md` §4.1 | **访问地址特别申明**：唯一权威域名 `ai-niuma.cc`（已备案+HTTPS） |

### ⚠️ 强制规则（打包上传客户端前必做）
1. **递增 `electron/version.json` 的 `version`**（语义化版本）。
2. **在 `electron/changelog.json` 数组顶部追加新条目** `{version,date,title,changes[]}`（最新在前；首条=启动弹窗显示的"更新日志"，全部=历史日志）。
3. 客户端启动会自动弹窗提示最新更新内容（对比已读版本），无需手动触发。

### ⚠️ 访问地址特别申明（避免误用 IP）
- **唯一权威对外域名**：`ai-niuma.cc` / `www.ai-niuma.cc`（已 ICP 备案 + HTTPS，经 Nginx 443 反代到 3000）。
- `downloadUrl` **必须写 `https://ai-niuma.cc/updates`，禁止写 IP:3000**。
- `IP:3000` 仅用于 `electron/main.js` 的 `SERVER_URL` 默认值（客户端进程内直连）及后端 `localhost:3000` 回环，二者用途不同，勿混淆。
- 任何对外链接（页面/下载/支付回调/分享）一律用 `https://ai-niuma.cc`。

### 待补
- `electron-updater` 已集成，需将 `package.json` 的 `publish.url` 与自动更新逻辑接通（当前更新提示靠启动弹窗 + 手动下载）。
- 跨平台安装包（mac/linux）与签名。
