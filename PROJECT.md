# AiMarketing 项目文档

> 本文档为**唯一权威项目文档**（替代已删除的 PROJECT_REPORT.md 与 docs/ 全部散落文档）。
> 最后更新：2026-08-14 ｜2026-08-06 ｜ 配套文档：[ISSUES.md](./ISSUES.md)（问题清单）、[EXECUTION_LOG.md](./EXECUTION_LOG.md)（执行修改记录）
> 维护规则：**每次执行操作后**，必须同步更新本文档「当前进度/待办」章节 + EXECUTION_LOG.md + ISSUES.md。

## 🚨 架构定案（2026-08-06，最重要，勿再偏离）

**一切本地，不连服务器：**
- ✅ **前端本地**（打包进客户端，Electron 内置 standalone server 渲染，端口 3377）
- ✅ **后端本地**（API 全部本地执行，**无任何代理**；next.config.js 已移除 rewrites）
- ✅ **数据库本地**（`prisma/dev.db`，打包时复制进 standalone；登录/AI/热点/数据全走本地库）
- ✅ **AI key 本地**（`.env.local`，admin/settings 读写本地文件）
- ✅ **语音本地**（TTS 用本地 key、ASR 用本地 FunASR）
- ❌ **不连服务器**：客户端不请求 ai-niuma.cc / 120.55.43.195；服务器数据完全不动；**本地测试不跑通前不上传 GIT**
- ⚠️ **登录账号**：本地库 `admin / admin123`（本地插入，role=admin）；服务器账号与本地无关

**关键机制（踩过的坑，勿改）：**
- 数据库连接：`prisma/schema.prisma` 的 `url = env("DATABASE_URL")`；dev 时 `.env.local` 设 `DATABASE_URL=file:./prisma/dev.db`；客户端打包时 `electron/main.js` 启动 server 注入 `DATABASE_URL=file:<standalone绝对路径>/dev.db`
- 打包：`node scripts/build-local.mjs`（自动复制 dev.db 进 standalone + extraResources + 清理 updates）
- 开发：`npm run dev`（本地全栈，连本地库）

---

## 一、项目概况

AI 营销 SaaS 平台（短视频/直播/获客自动化），营销运营执行中枢，三层分销体系。

| 项 | 值 |
|---|---|
| 技术栈 | Next.js 14.2 + TypeScript + Prisma 5.22 (SQLite) + Tailwind 3.4 |
| 桌面端 | Electron 33（远程页面壳 + Playwright 指纹浏览器自动化） |
| 手机端 | Capacitor 8（**不支持**指纹浏览器/视频合成，已冻结） |
| 生产环境 | Linux `http://120.55.43.195:3000`（PM2 进程 `aimarketing`） |
| 对外域名 | **唯一权威域名 `https://ai-niuma.cc`**（Nginx 443 反代，已备案 HTTPS，certbot 自动续期） |
| Git | `github.com:57974422j-art/AiMarketing.git`（master） |

## 二、目录结构与核心代码索引

```
src/app/          页面 + API 路由（app router，API 全在 app/api/ 下）
src/lib/          业务逻辑库（AI/视频引擎/自动化/配额/支付/爬虫桥）
electron/         桌面客户端（main.js IPC + fp-templates 自动化脚本）
prisma/           schema.prisma（数据模型唯一源头）
scripts/          ADB/测试/语音分离/PPT 等辅助工具（勿动）
android/          Capacitor 手机端（冻结）
```

### 灵魂文件（改动前必读）
| 文件 | 作用 |
|---|---|
| `prisma/schema.prisma` | 全表数据模型（45KB，改后需服务端 `prisma db push`） |
| `src/middleware.ts` | JWT 解码 + API 白名单（改错全站 401） |
| `src/lib/ai-providers.ts` | AI 统一调度入口（91KB，供应商降级链） |
| `src/app/api/agent/chat/route.ts` | Agent 对话主路由（19 工具注册执行） |
| `electron/main.js` | Electron 主进程（IPC 通道 + 指纹浏览器） |

## 三、角色体系与鉴权

### 角色
- `admin` 管理员 → `editor` 代理商 → `end-user` 终端客户（另 `viewer`）
- `User.parentId` 上级链；`EditorQuota` 分配 editor 的 Q1 容器/指纹端口/真机配额

### 鉴权机制
- `src/middleware.ts`：Edge 手写 JWT HS256 解码 + **Web Crypto 验签**（2026-08-05 修复不验签漏洞），从 cookie `token` 取 userId/role/teamId 注入 `X-User-Id/Role/Team-Id` 请求头；密钥 `process.env.JWT_SECRET || 'aimarketing-secret-key-2024'`（与 login/route.ts 一致）
- API 白名单：`/login /register /api/auth /api/subscription /api/payment /api/devices/heartbeat /api/migrate-template-urls /api/tasks/mine /api/tts /api/mediacrawler/qrcode` + `/api/storage/file`
- 订阅门控：middleware 不硬拦截；各路由内用 `checkFeatureAccess` / `token-wallet` 软拦截
- 服务端 admin 校验范式：`getAuthFromHeaders(request)` → 401 → `role!=='admin'` → 403
- 前端守卫：`useAuth()` + `user?.role` 判断

## 四、数据模型概览（详见 schema.prisma）

- 用户/组织：User(role/parentId/plan/pointBalance/paidFeatures)、Team、TeamMember、InviteCode
- 设备：Device(容器 mock|q1)、PhyDevice(Q1物理机)、DevicePool、WindowSession、EditorQuota
- 账号：Account(bindType device|manual|official, cdpPort)、SocialAccount、AccountGroup/Item
- 自动化：AutomationTemplate、AutomationTask、TaskLog、TaskConfig
- 内容：VideoTask、CopyTask、PublishingTask、Project、MediaAsset(素材库)、ContentSubmission、ContentDraft、PromptTemplate、ScriptTemplate、DigitalHumanTemplate、NFCRuleTemplate、BgmTrack
- 导流获客：ReferralConfig、ReferralLog、Lead、CollectionTask、CrawledVideo/Comment/UserProfile/Trending、FilterPreset
- 直播：LiveRoom、LiveProduct、LiveScript、LiveLog
- AI：AIAgent(旧)、TrainingDocument、AgentMemory、ChatSession、ChatMessage、GenerationRecord(生成记录总表)、Feedback
- 收费：SubscriptionPlan、UserSubscription、PaymentOrder、PointCard、PointCardOrder、UsageLog
- 其他：PoiAddress、SystemConfig、DashboardStat、ScriptDiagnosis

## 五、核心模块清单

### 1. Agent（当前最活跃）
- 首页 `/` = `src/app/agent/page.tsx`（84KB）：三栏布局（左面板+声纹球 / 对话区 / 右思考流+客户画像），热点大屏全屏模式（3D 地球 GlobeTrends + 三柱热榜 + LIVE 跑马灯）
- 对话：`api/agent/chat/route.ts` 两阶段 agnesChat（工具决策→汇总回复），**19 个工具**：generate_copy/generate_image/generate_video/search_web_images/digital_human_speak/query_digital_human/query_video_task/search_storage/search_video/list_personal_files/search_templates/publish_content(只校验不真发)/automation_check/search_memory/upsert_memory/collect_unmet_need/clear_memory/set_agent_profile/search_trends
- Scene 协议：`[SCENE_JSON]` 卡片（open_page 跳转等）；非流式一次性 JSON；每条对话扣 1 点
- 热点：`api/agent/hotspots`（vvhan+天行国内 / HN+Reddit 全球，内存缓存 1h，内置兜底）；gemini.ts `searchTrendsReal` 降级链
- 记忆：AgentMemory 表；语音：TTS=火山方舟 V3，ASR=本地 FunASR（scripts/funasr_asr.py）
- IM：`api/agent/channel` 仅单向 webhook 推送（AGENT_WEBHOOK_WECHAT/FEISHU）
- 旧版 `/ai-agent`（AIAgent/TrainingDocument）= 客服 bot 配置器，与新 agent 独立并存

### 2. AI Provider（src/lib/ai-providers.ts）
- 供应商×能力：百炼 dashscope（聊天/翻译/生图 wan2.6/生视频 wan2.7/图生视频/数字人/CosyVoice TTS/声音克隆）、火山 volcano（聊天/TTS/视频任务）、硅基 silicon（聊天/SenseVoice ASR/TTS/Z-Image）、DeepSeek（聊天/function calling）、Agnes（agnes-2.5-flash→2.0 回退，多模态，走 OVERSEAS_PROXY）
- 降级链：generateText=百炼→火山→硅基→DeepSeek→Mock；generateImage=Agnes→百炼→硅基；generateVideo=Agnes→百炼→happyhorse；transcribeAudio 仅硅基
- 配置环境变量：DASHSCOPE/VOLCANO/SILICONFLOW/DEEPSEEK/AGNES_API_KEY、AGNES_BASE_URL、OSS_*、FFMPEG_PATH、OVERSEAS_PROXY（admin 设置页写 .env.local）

### 3. 视频合成（一键成片）
- `lib/video-task-manager.ts` 普通成片 8 步：逐句 TTS(qwen3-tts)→时长→音频→SRT→逐段编码→concat→BGM→libass 渲染，输出 `public/generated/{id}.mp4`
- `lib/smart-compile-engine.ts` 智能成片：Ken Burns + xfade 转场(<=3段) + ASS 字幕 + 贴纸 + 8 标题；先 estimateCost
- `lib/ffmpeg.ts` 统一执行层：**全局串行队列** + nice -n 19 + threads 1，priority:'high' 插队
- API：`api/video/auto-compile`（主成片，素材源 free/smart/storage）、post-process（配音/字幕/翻译/换脸/口型）、transcribe（ASR→SRT）、text-to-video（>15s 长视频分镜）、push-to-account

### 4. 自动化/设备控制
- 读引擎 `lib/automation-providers.ts`：douyin 搜索/评论/画像/详情/热榜/用户 + runCollection 批量采集（AI 意向打分+提取联系方式）；优先 MediaCrawler 子进程，兜底官方 API
- 写引擎 `lib/engine-dispatcher.ts`：WRITE_ACTIONS 只路由，实际在 `api/devices/[id]/execute` + electron fp-templates
- `lib/automation/engine.ts` 抽象 5 方法，**四个实现全是桩**；`automation/fp-templates/` TS 版 5 模板
- Q1 设备三通道：apiPort(HTTP shell/截图) + adbPort(ADB 输入) + rpaPort(TCP 硬件触控)；`device-engine.ts` 坐标动作链、`uiautomator-driver.ts` XML 定位、`douyin-automation.ts`(140KB) 发布状态机、`douyin-publish-v4.ts` L1 坐标+L2 VL
- 直播：`live-stream-engine.ts` FFmpeg RTMP 推流（libx264 2.5Mbps 1080x1920 + 反检测微变速）

### 5. Electron（桌面客户端）
- IPC：adb:* 8 + fp:* 14（fp:start/stop/list/screenshot/click/type/enter/navigate/info/markLogin/loginState/logout/scriptStop/execute）+ app:get-version + updater:*
- 指纹浏览器：Playwright launchPersistentContext **按 accountId 分 profile**，登录态 `.loggedin` 文件；`fp:execute` 分发到 `electron/fp-templates/*.js`（douyin/kuaishou/bilibili/shipinhao/weibo/xiaohongshu 发布脚本）
- 版本：package.json 与 electron/version.json 同步维护（2026-08-11：原「package.json 禁止改」为误加规则已解除；打包产物名/latest.yml 自动对齐）；changelog.json 启动弹窗；electron-updater（源 https://ai-niuma.cc/updates）；打包 dist-rel
- 前端 `my-fingerprint/page.tsx`：抖音批量发布队列（入队/间隔/定时/暂停恢复停止）

### 6. 商业化（双轨计费）
- 1 点=¥0.01；`token-wallet.ts`：先扣当月套餐额度，不足扣点卡永久余额；文生图 12点/张、文生视频 100点/秒、对话 1点/条、数字人 200点/条
- `generation-record.ts`：成功后扣款+OSS 转存，finalizeSuccessByTaskId 原子认领防重复扣
- 支付：`alipay.ts` 手写 RSA2；checkout→支付宝 wap→notify 验签开通（幂等）；免费周卡 `claim-weekly` 终身一次
- 前端 `my-subscription/page.tsx`

### 7. 数据中台/爬虫
- MediaCrawler Python 子进程桥 `crawler-client.ts`（/opt/MediaCrawler，DouYinClient：search/comments/detail/user，**trending 未实现**）；Cookie 扫码登录需 DISPLAY；代理池 `.proxy-pool.json` 轮换；全部仅 admin
- `lead-collector run-task`：dispatchEngine extract → CrawledVideo/Comment upsert → Lead 入库（意向打分+正则提取联系方式）
- data-center 6 页面（仪表盘/视频库/评论池/线索/画像/热榜）+ 定时调度（内存实现，重启丢失）；insights 5 视图

### 8. 管理后台（src/app/admin/）
- 首页 4 区聚合（运营/诊断/资源库/系统管理）按角色过滤；22 个页面
- settings 单页：ApiKeyPanel（4 AI key+火山TTS+OSS）+ Pixabay/GIPHY/Gemini/Agnes/天行/webhook + EnginePanel（查询引擎 mediacrawler|douyin-official、动作引擎 q1-adb|fingerprint、MediaCrawler 路径、扫码登录、代理池）
- api/admin：config（写 .env.local）、dashboard、system-config、usage-stats、users、orders、agent、feedback、generation-records、test-key、seed-plans、subscription-plans、point-cards 等

### 9. 用户页面
dashboard(+insights/sop)、workspace、ai-tools、ai-copy、image-generator、auto-compile(+StoryboardEditor)、text-to-video、video-edit、digital-human、ai-agent、lead-collector、referral(+preview 纯前端模拟)、nfc-promo(API 失败回退 mock)、live、trendvideo、my-automation、run-task(Electron 内嵌)、storage(个人仓库 500MB)、media-library、my-subscription、team、projects、feedback、download、login/register
i18n：zh/en 双语（translations.ts + context.tsx，默认 zh）

## 六、当前进度与待办（做到哪里 / 哪些没执行）

### 2026-08-14 更新规划（已确认/待执行）

#### 生成流程 v2（用户设计，2026-08-14 确认——等库填好后实施）
- **用户先填库**：素材库（MediaAsset）/学习库（cheerselfai 已 113 条+封面 OSS）/公共素材——填满后 AI 推荐才有意义
- **生成流程（替代现"自动搜模板静默注入"）**：
  1. 用户提生成需求 → AI 搜库（学习库模板 + 个人素材 + 公共素材）
  2. 搜到 → 推荐模板/素材卡片 → 用户选 → 用选中的生成
  3. 搜不到 → **AI 生成 2-3 个候选提示词**（差异化风格+模型+预估点数）→ 用户选 → 用选中的生成
  4. **禁止**：AI 假装用了库/编造画面细节描述（生图后只报尺寸/模型/文件，细节让用户查看）
- 现状：自动注入逻辑（99f82bf）暂保留，但**库空时注入空 → AI 无参考**——v2 改为"无模板时明确告知 + 出候选"

- ✅ **Agent 实时数据**：画像/记忆/媒体舞台初始自动加载 + 对话后刷新（b361755）
- ✅ **音乐模型选择**：settings Minimax 段 free/music-3.0 下拉（1829fc5）
- ✅ **音乐计费**：music-3.0=100 点/首（先查后扣，失败不扣）；free=0（1829fc5）
- ✅ **音乐库全功能**：OSS 存储 + /music-library 页面 + BGM 全 AI 音乐库（423d435/e53dc91）
- ⏳ **H3 视频模型接入（待用户确认）**：国内站已公开（api.minimaxi.com/v2/video_generation，model=MiniMax-H3）；768P=50 点/秒、2K=80 点/秒（比 wan 100 点/秒便宜）；需 ai-providers 加 H3 通道 + generate_video 降级链 + 前端模型选择
- ⏳ **剩余隐患（低优先）**：点卡 checkout 配置源不一致 / token-wallet 非事务 / 订单过期定时 / 死代码清理（quota-checker/subscription-guard）/ 免费周卡口径 / 微信 Native 支付（待商户号）
- ⏳ **二期 B**：分镜节点链视图 + 一句话成片（create_ai_video）
- ⏳ **三期**：发布真执行（publish_content 打通 fingerprint-browser）



### 🚀 客户端智能化改造（白龙马 UI 克隆，2026-08-05 立项）
> 目标：把 AiMarketing 客户端打造成「白龙马式智能 UI + 项目服务器能力」的独立智能平台。
> 已确认决策：① UI 功能全部补齐 ② 不要本地内核（记忆/画像走服务器 AgentMemory）③ 客户端完全独立（打包前端+本地 API 代理）。
> 原则：只在 AiMarketing 内用 React 重写，不移植白龙马代码/技术栈；AI 能力统一走服务器 API。

| 阶段 | 内容 | 状态 |
|---|---|---|
| 阶段 0 | 客户端本地化：next.config.js output:standalone + API_TARGET 条件 rewrites；electron/main.js 内置本地 server（ELECTRON_RUN_AS_NODE 跑 resources/standalone，端口 3377）+ /api/* 代理到 https://ai-niuma.cc（Cookie 透传）；build-local.mjs 构建 standalone（清理 public/updates 防 5GB 卡死）+ extraResources 入包 | ✅ 2026-08-05 验证通过：页面本地渲染 0.3s、代理返回远程真实热点数据、客户端内置 server Ready 229ms、关闭零残留、打包 304.8MB |
| 阶段 1 | UI 补齐：Scene 卡片完善（video/confirm/link/task+动画）、媒体舞台（/api/agent/media）、文档面板（智能体知识库）、语音打断、**终端流**（右栏实时请求日志）全部完成 | ✅ 2026-08-05 5/5，构建打包验证通过 |
| 阶段 2 | 智能化：主动推送完成（服务器 /api/agent/suggestions 规则建议：画像缺失→onboarding、进行中任务→进度提醒、热点/成片建议；前端登录后 8s+每 10 分钟拉取，欢迎区建议条可点击/关闭）；会话管理完善可选后续 | ✅ 2026-08-05 基础版完成 |
| 暂缓 | 本地唤醒词、悬浮声纹球窗、托盘（Electron 特性，后续可选） | ⬜ 暂缓 |

### 🧠 智能控制闭环路线（2026-08-05 研究定稿，待执行）
> 目标：语音/文字统一控制的智能助手——了解项目 → 调用功能 → 播放能力 → 热点驱动 → 创作发布全链路。

#### 白龙马能力盘点（对照）
| 能力 | 白龙马 | 我们现状 | 状态 |
|---|---|---|---|
| 语音连续/打断 | 常开流式+2s断句+barge-in | 点按录音+45s超时 | 🔴 空壳（C 待做） |
| 工具系统 | 15类+市场 | 19 工具全实现 | 🟢 基本 OK |
| 发布 | 平台直发 | **客户端完整**：electron/fp-templates 7 平台发布脚本（douyin/kuaishou/bilibili/shipinhao/weibo/xiaohongshu，测试过勿改）+ 登录态持久化 + my-fingerprint 队列执行（fp:execute）；断点仅：Agent(publish_content) 不能直接触发客户端 | 🟡 断点在 Agent→客户端触发 |
| 记忆 | SQLite+embedding+线程 | AgentMemory 画像/记忆 | 🟡 基础版 |
| 热点 | 抖音/小红书/微博/微信 | vvhan+天行 6 平台 | 🟢 OK |
| 创作→发布 | 生成→发布闭环 | 生成 OK、发布需手动 | 🔴 断点 |
| Scene/媒体/推送 | 完整 | 卡片+媒体舞台+建议条 | 🟡 基础版 |

#### 实施阶段
| 阶段 | 内容 | 说明 |
|---|---|---|
| **C1 连续监听+打断** | 常开麦克风 VAD + 静音 2s 自动断句发送 + TTS 播放中 barge-in 打断（参考白龙马 DUCK 两阶段） | ✅ 2026-08-05 完成：声纹球下「🎙 开启连续聆听」开关，说完停 2 秒自动发送，朗读中说话可打断 |
| **C2 发布闭环** | publish_content 增强：产出发布任务（标题/文案/话题/视频）→ 客户端 my-fingerprint 检测待发布任务自动入队执行（**复用现有 fp:execute + 7 平台脚本，不改脚本**）；或 Agent 工作区自动打开 my-fingerprint 大屏并带参 | ✅ 2026-08-05 完成：AgentPublishTask 模型+API+客户端自动导入回写，API 实测通过 |
| **C3 上下文增强** | 新增「了解项目」工具：用户绑定平台/账号/素材/历史一键概览；会话连续性增强 | ✅ 2026-08-05 完成：project_overview 工具 + OpenAI 格式兼容修复 |
| **C4 全链路编排** | 一键「追这个热点 → 出文案 → 做成片 → 发布到抖音」多步编排 | ✅ 2026-08-05 完成：多步编排 prompt |

#### 智能控制闭环设计（语音/文字统一）
```
用户（语音/文字）
 → 了解项目：画像 AgentMemory + 当前页面 currentApp + 热点 hotContext + 账号/素材概览(C3)
 → 调用功能：19 工具（生成/查询/搜索/记忆/趋势）
 → 播放能力：TTS 朗读（百炼/硅基已通）+ Scene 视频/音乐卡片播放
 → 热点驱动：search_trends / hotspots → 选题建议
 → 创作→发布：文案→一键成片(auto-compile)→推送(push-to-account)→指纹浏览器发布(C2)
```

### 语音交互升级（2026-08-07）
| 项 | 状态 | 说明 |
|---|---|---|
| ASR 换百炼实时（paraformer-realtime-v2） | ✅ | Python ws 代理 127.0.0.1:8766（前端→代理→百炼 Bearer），弃讯飞（RTASR 未开通 10105），FunASR 兜底 |
| 边说边执行 | ✅ | 百炼 sentence_end（一句说完）自动发送，无需手动点停止 |
| 语音停止/打断 | ✅ | 说「停/算了」中止；TTS 朗读中说话打断朗读 |
| 语音对话循环（白龙马式） | ✅ | 点声纹球进入对话模式：说→停顿自动执行→AI 回复自动朗读→朗读完自动再听→插话打断（回声基线防回音）→说「停/退出对话」退出 |
| 自定义 AI 名称 | ✅ | User.agentName（用户级）+ SystemConfig.agent_name（全局兜底）→ 标题栏显示 + chat prompt 注入自称；标题栏 ✎ 改名弹窗 |

### 应用随行 · AI 工作区（2026-08-05）
| 项 | 状态 | 说明 |
|---|---|---|
| 左面板应用列表（7 个 + 热点大屏） | ✅ | 一键成片/文生视频/AI文案/素材库/指纹浏览器/数据看板/AI生图 |
| iframe 大屏（左 2/3）+ AI 对话栏右 1/3 常驻 | ✅ | body.app-mode，复用热点互斥布局 |
| 紧凑模式（AI 右下角悬浮小窗） | ✅ | body.app-compact，功能页全屏 |
| AI 上下文注入（currentApp → system prompt） | ✅ | AI 知道用户当前在哪个应用 |
| 与热点大屏互斥 + 语音「关闭应用」 | ✅ | |

### Agent 白龙马融合（2026-08 主线）

> 状态图例：✅ 已完成 ｜ 🚧 部分/待验证 ｜ ⬜ 未开始
| 项 | 状态 | 说明 |
|---|---|---|
| 语音环（火山 TTS + ASR） | ✅ | /api/agent/tts、asr 已实现 |
| 长期记忆（AgentMemory + 5 记忆工具） | ✅ | upsert/search/clear/set_profile/collect_unmet_need |
| IM 渠道 webhook | 🚧 | 仅单向推送，无收发循环 |
| 思考流/Scene 卡片 UI | 🚧 | 右栏有思考流面板，场景卡片部分（open_page） |
| 认知地图 | ⬜ | 规划中 |
| **analyze_and_clone 克隆工具** | ⬜ | 未实现（客户旅程断点） |
| **publish_content 真发布** | ⬜ | 只校验账号绑定，真实发布在客户端指纹浏览器 |

### 指纹浏览器/发布
| 项 | 状态 | 说明 |
|---|---|---|
| 登录态按 accountId 持久化 | ✅ | fp:markLogin/loginState/logout + 分 profile |
| **5 平台发布脚本重写**（wait+retry+isLoggedIn+_common.js） | ⬜ | 待办 |
| B站 MPP 方案 | ⬜ | 需另寻源 |

### 支付
| 项 | 状态 | 说明 |
|---|---|---|
| 支付宝套餐闭环 | ✅ | checkout→wap→notify 验签开通 |
| 点卡充值闭环 | ✅ | PC 前缀订单+回调充值 |
| 微信 Native 支付 | ⬜ | 缺商户号，qrCode 字段已预留 |
| 订单过期自动关闭定时任务 | ⬜ | 未实现 |

### 数据中台
| 项 | 状态 | 说明 |
|---|---|---|
| MediaCrawler 采集（搜索/评论/详情/用户） | ✅ | lead-collector 落库 |
| MediaCrawler trending | 🚧 | crawler-client 未接 DouYinClient，走 main.py |
| 定时调度持久化 | ⬜ | 当前内存 setInterval，重启丢失 |
| Crawled* 数据写入端 | 🚧 | 仅 lead-collector 写入 |

### 自动化引擎
| 项 | 状态 | 说明 |
|---|---|---|
| engine-dispatcher 读写路由 | ✅ | |
| 4 个动作引擎实现（mock/official/real-device/fingerprint） | ⬜ | 全是桩 |
| douyin-official 开放平台适配 | ⬜ | 待申请资质 |

### 其他规划遗留
| 项 | 状态 | 说明 |
|---|---|---|
| Agent 客户旅程闭环（要资源→克隆→发布） | ⬜ | 原 docs 规划已删除，要点在此 |
| /api/subscription/buy 清理 | ✅ | 已删除（2026-08-05，无调用方） |
| 5 平台发布脚本坐标维护 | 🚧 | 抖音改版需重测 |

### 🚀 二期：AI 全自动成片（2026-08-10 规划定稿，待执行）
> 用户方向：AI 推荐**文生视频**全自动成片（一键成片只适合客户手动）；诚实协议已上线（f269c22：AI 先查库再回复、禁编素材/BGM/预填、无素材引导免费素材站上传个人仓库）。

| 阶段 | 内容 | 状态 |
|---|---|---|
| 一期 | 诚实协议：chat prompt 硬规则（先查库/禁胡诌/提议句式）+ search_storage 工具描述 + 免费素材站引导（Pixabay/Pexels/Videvo/Coverr/Mixkit） | ✅ 2026-08-10 f269c22 已推送，待部署 |
| 二期 A | ① generate_video 升级：>15s 自动走 generateLongVideo（首尾帧接力）② 分镜协议 generate_storyboard ③ 成片任务引擎（StoryboardTask 表：后台逐镜生成/单镜重试/进度，Agent 工具 create_storyboard_task/query_storyboard）④ 成本预估提示（两段式确认：首调只报价，用户确认才生成） | ✅ 2026-08-10 c08031f 已推送（待部署）|
| 二期 B | create_ai_video 一句话成片 ✅；/ai-video-tasks 分镜节点链 ✅；提示词库+发布到素材库 ✅；**生成历史+查看提示词 ✅**（/api/generation-records + image-generator/text-to-video 页面历史区：完整 prompt 复制/模型/复用再生成/放大）；**文生图升级 qwen-image-3.0-pro ✅**（修复中文乱码）；**用户画像登记 ✅**（首登结构化表单 → AgentMemory） |
| 三期 | Minimax AI 音乐（BGM 真生成）+ 发布真执行（publish_content 由只校验改真发，打通指纹浏览器） | ⬜ |
| 中转站调研 | 候选 OpenRouter/fal.ai/Replicate/infistar.ai（用户自研选型）。**必须覆盖**：文生图/文生视频/图生视频/克隆视频，按实际需求定。infistar 有 kling-v2-6/seedance-2.5/mimo/wan2.7（无 Sora/Veo）；OpenRouter/fal 有 Sora2/Veo3。接法：ai-providers.ts 加中转通道+双通道降级链 | 🟡 调研中 |

**参考**：infinite-canvas（basketikun）——借鉴节点化分镜管理/生成参数记录可重试；不借鉴画布本体/浏览器存凭据。成本：60s 成片 ≈ ¥20-65/条。

## 七、部署与运维要点

### 三端部署（2026-08-06 纯本地定案：**客户端=单机应用，服务器仅保留公网 SaaS 不动**）
| 改了哪里 | 部署动作 |
|---|---|
| `src/**`（前端/API） | 本地 `npm run dev` 直接测；要打包则 `node scripts/build-local.mjs`（~15 分钟） |
| `electron/**` | 本地重启/重打包分发 |
| `prisma/schema.prisma` | 改后 `npx prisma db push`（本地库）+ `npx prisma generate` + 重新打包 |
| `.env.local` | 本地 key 配置（admin/settings 页可写）；**不进 GIT** |
| 服务器 | **不动**（等本地测试跑通、用户确认后，另行决定是否部署/上传） |

### ⚠️ 服务器需部署的新 API（2026-08-05 起客户端已引用，未部署则 404）
- `/api/agent/media`（媒体舞台：BGM+生成记录）、`/api/agent/suggestions`（主动推送建议）
- 服务器执行：`git pull && rm -rf .next && npx next build && pm2 restart aimarketing`

### 数据库
- SQLite `prisma/dev.db`；改 schema 后服务端 `npx prisma db push`（**不手动执行 prisma generate**，postinstall 会做）

### 域名与外部
- 对外链接一律 `https://ai-niuma.cc`（禁 IP:3000）；downloadUrl 必须 `https://ai-niuma.cc/updates`
- Nginx 443 反代 127.0.0.1:3000，certbot 自动续期；保持 python3.10（update-alternatives），勿关安全组 80/443
- OVERSEAS_PROXY：CF Worker 转发器（URL 转发型），用于 Agnes/搜图等海外 API
- Pixabay（素材/BGM 免版税）、GIPHY（贴纸）、天行 API（热点）均后台配置 key

### 关键环境变量
DASHSCOPE_API_KEY / VOLCANO_API_KEY / VOLCANO_TTS_APP_ID+ACCESS_KEY+RESOURCE_ID / SILICONFLOW_API_KEY / DEEPSEEK_API_KEY / AGNES_API_KEY / AGNES_BASE_URL / OVERSEAS_PROXY / OSS_* / FFMPEG_PATH / MEDIA_CRAWLER_PATH / PYTHON_BIN / AUTOMATION_ENGINE / AGENT_WEBHOOK_WECHAT+FEISHU / TIAN_API_KEY（天行热点）

### 本地打包指南（Windows，2026-08-05 实测，一键脚本）
- **打包：`node scripts/build-local.mjs`**（推荐，自动完成下面全部步骤；其他 AI 打包直接用它，无需再排障）
  1. taskkill 清理客户端残留进程（AI营销助手.exe/electron.exe）
  2. 应用 7za 符号链接补丁（scripts/7za-wrapper-win-x64.exe 替换 node_modules 的 7za.exe，原版备份 7za_real.exe）
  3. 校验 electron 缓存 zip（损坏自动删除，重下走镜像）
  4. 动态生成 build.local.json（ms-playwright 自动检测本机路径，不动 package.json）
  5. 清理 dist-rel/win-unpacked → 镜像 electron-builder 打包
- 手动拆解：`npm run build`（后端）→ `npx electron-builder --config build.local.json`
- 镜像变量：`ELECTRON_MIRROR` / `ELECTRON_BUILDER_BINARIES_MIRROR` = npmmirror（避免 GitHub 下载卡死）
- 启动本地客户端测试：`SERVER_URL=http://localhost:3000 "dist-rel/win-unpacked/AI营销助手.exe"`
- 客户端自动检查更新（ai-niuma.cc/updates），本地版本高于服务器会提示「不降级」后继续，无害

#### 打包历史问题的根因与彻底解决（2026-08-05 排查）
| 问题 | 根因 | 解决 |
|---|---|---|
| winCodeSign 解压 darwin 符号链接失败（exit 2） | electron-builder 用 `7za x -snld` 建符号链接，Windows 普通用户默认无 SeCreateSymbolicLinkPrivilege | ① 脚本自动打 7za wrapper 补丁（-snld→-snl-，Windows 构建不需要 darwin）；② **根治：开启 Windows「设置→开发者选项→开发人员模式」并重启电脑**，符号链接权限恢复后补丁不再需要 |
| electron zip 缓存损坏（BadZipFile） | 下载中断/被杀留下损坏缓存，解压报 Bad magic number | build-local.mjs 用 7za t 校验，损坏自动删除重下 |
| rm -rf win-unpacked 失败（Device or resource busy） | ① 客户端从 win-unpacked 直接运行，关闭后句柄未释放；② 旧版 main.js 的 before-quit async 不被 Electron await，Playwright/Chromium 子进程残留 | ① 脚本打包前 taskkill；② electron/main.js 已修复为 preventDefault+await+app.exit（**需重新打包生效**） |
| GitHub 下载卡死 | 国内网络访问 github releases 超时 | 脚本强制 npmmirror 镜像 |

### 开发命令### 开发命令
- `npm run dev`（next dev :3000）；`npm run electron:dev`（桌面联调）
- 服务器 FFmpeg 串行队列防 CPU 爆满是硬约束（4 核），勿绕过 runFFmpeg

## 八、更新流程（服务器 + 客户端双端联动，2026-08-07 定稿）

> **核心规则：改 `src/` 任意代码 → 服务器和客户端【两处都要更新】**（客户端页面是打包时的快照，不重打包不生效）。

### 判断改了什么
| 改了 | 网页端 | 客户端安装包 |
|---|---|---|
| `src/**`（API/页面/组件） | ✅ 必须更新 | ✅ 必须重打包 |
| `electron/**`（主进程/发布脚本） | ❌ | ✅ 必须重打包 |
| `prisma/schema.prisma` | ✅ 加字段 | 跟随重打包 |
| 只改服务器配置（.env/key） | ✅ 重启即可 | ❌ |

### A. 服务器更新（Linux，网页生效）
```bash
cd /root/AiMarketing && cp prisma/dev.db prisma/dev.db.bak.$(date +%Y%m%d) && git fetch origin && git reset --hard origin/master && rm -rf .next && npm run build && cp -r .next/static .next/standalone/.next/static && cp -r public .next/standalone/public && DATABASE_URL="file:/root/AiMarketing/prisma/dev.db" pm2 delete aimarketing && DATABASE_URL="file:/root/AiMarketing/prisma/dev.db" pm2 start .next/standalone/server.js --name aimarketing && pm2 save && pm2 flush aimarketing && sleep 3 && curl -s http://127.0.0.1:3000/login -o /dev/null -w "HTTP %{http_code}
"
```
**注意**：
- ✅ **`npx prisma db push` 现在可用**（2026-08-07 已删 AgentSessionBrain 表，schema 与库一致；之前它会导致 db push 误删）
- pm2 启动**必须带 `DATABASE_URL="file:/root/AiMarketing/prisma/dev.db"`**（standalone 不读 .env，不带就连空库 → 全部 500）
- 验证：curl 返回 200 或 401（401=已连库仅缺登录，正常）；`pm2 logs aimarketing --lines 5 --err` 无 P2021

### B. 客户端重打包（本地 Windows）
```bash
cd D:\AiMarketing && node scripts/build-local.mjs
```
产物：`dist-rel/AI-Marketing-Setup-1.0.19.exe`（安装包=连服务器版：页面本地渲染、API 全走 https://ai-niuma.cc）

### C. 客户端自动更新发布（给已安装用户）
1. 打包产物上传服务器 `public/updates/`（AI-Marketing-Setup-X.Y.Z.exe + .blockmap + latest.yml，版本号走 electron/version.json）
2. 客户端启动时 electron-updater 自动检查（更新源 https://ai-niuma.cc/updates）

### D. 本次部署记录（2026-08-07）
- 服务器：git reset 到我们版本（d6ddd93）+ standalone 启动（server.js + DATABASE_URL 绝对路径）+ 手动 SQL 加 User 5 字段 + AgentPublishTask 表
- 踩坑：standalone 不读 .env（必须 pm2 注入 DATABASE_URL）；db push 会删 AgentSessionBrain（禁用）；.next/static+public 要复制进 standalone

## 九、文档体系
| 文档 | 用途 |
|---|---|
| **PROJECT.md**（本文档） | 唯一权威项目文档：架构/模块/进度/待办/运维 |
| **ISSUES.md** | 已知问题/Bug/风险清单（持续更新） |
| **EXECUTION_LOG.md** | 执行修改记录：每次操作后追加（日期/操作/文件/结果） |

> 历史文档已全部清理删除（git 历史可恢复）；本目录为唯一真相源。
