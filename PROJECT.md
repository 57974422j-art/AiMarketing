# AiMarketing 项目文档

> 本文档为**唯一权威项目文档**（替代已删除的 PROJECT_REPORT.md 与 docs/ 全部散落文档）。
> 最后更新：2026-10-05 ｜ 配套文档：[AGENT-HANDOFF.md](./AGENT-HANDOFF.md)（**AGENT 页接手文档——换工具/换机器先读它**）、[ISSUES.md](./ISSUES.md)（问题清单）、[EXECUTION_LOG.md](./EXECUTION_LOG.md)（执行修改记录）
> 维护规则：**每次执行操作后**，必须同步更新本文档「当前进度/待办」章节 + EXECUTION_LOG.md + ISSUES.md。


## 📌 会话恢复速查（2026-09-12，压缩后先读这段）

## 当前版本与产物
- **1.0.146（333MB）已打包未发布**；`dist-rel/` 里有 1.0.141~146
- 打包：`node scripts/bump-version.mjs X.Y.Z && node scripts/build-local.mjs`（~13 分钟）
- 发版：scp 三件套 → 服务器 `node scripts/update-oss`（实际脚本 `upload-update-oss.mjs public/updates`）→ cp latest.yml → pm2 restart

## 客户端（Electron 纯壳）
- 加载远程页面 `https://ai-niuma.cc`（`loadURL`）——**前端改动只需服务器部署，不用重打包**
- **userData = 安装目录\data\**（登录态/browser-profile/bu_debug.log）；本地仓库 = 安装目录\storage\
- 安装包瘦身已完成（547→333MB）：`build.files` 去 `.next` + 17 条 node_modules 排除；`electronLanguages` 中英；extraResources 去 models/sherpa
- **必须保留**：`ms-playwright`（指纹发布内核）、`scripts/{scrcpy,platform-tools}`（群控发布）、`scripts/{browser-use,agent-publish}`、`opencli`
- ⚠️ `package.json.bak-sl` / `scripts/build-local.mjs.bak-sl` 是**瘦身前旧备份**，勿覆盖回去

## AGENT 发布（四平台，确定性脚本）
- 链路：chat route 建任务（task 存 JSON）→ 客户端 `checkBrowserTasks` → `scriptMap` 分发
  - `douyin→bu_pub_douyin.py`｜`xiaohongshu→bu_pub_xhs.py`｜`weibo→bu_pub_weibo.py`｜`shipinhao→bu_pub_shipinhao.py`
  - 无脚本平台 → 回退 `bu_exec.py`（browser-use）
- 脚本目录：`scripts/agent-publish/`（客户端里在 `resources/scripts/agent-publish/`）
- **发布按钮统一用 CDP 穿透点击**（`_cdp_click.py`）：`DOM.getDocument(pierce)` → `getBoxModel` 准确坐标 → `mouse.click`；**参数 exact=True（精确文本）+ prefer_bottom_right（右下优先）+ 候选日志**
- 踩过的坑：文本【包含】匹配会命中导航/菜单（任务#15 点了左侧导航）；`frame.evaluate` 自算坐标会偏（视频号 iframe 偏 400px）

## 封面生成（百炼生图）
- 常态 **81~105 秒**（实测 3/3 成功），偶发更久 → **硬等**：服务器轮询 **570s**、前端 fetch **600s**、nginx **600s**
- 取值字段：`output.choices[0].message.content[0].image`（**不是** `results[0].url`）
- 提示要点：prompt 含标题文字，偶发会触发审核/失败

## 环境自检（客户端 Python）
- 启动 8 秒后静默自检 + 缺则后台装（内置→系统 pip→下载 zip）；**装完弹窗告知已安装组件**
- 发布时未就绪 → **静默补装**（不弹窗）
- **禁止主进程同步调用**（spawnSync/execSync）→ 一律 `runAsync`（曾致界面未响应）
- `python-bu.zip`（OSS updates/，89,581,744 字节）**已含 playwright/greenlet/pyee**

## 常用命令
- 服务器部署：`cd /root/AiMarketing && git fetch origin && git reset --hard origin/master && bash scripts/deploy-server.sh`
- 客户端日志：`安装目录\data\bu_debug.log`
- 服务器日志：`pm2 logs aimarketing --lines 200 --nostream`

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

### 2026-10-06 批 3c-1：素材/视频镜渐变遮罩（✅ 代码完成，待部署实测）

- **起因**：用户提示「素材都是我们自己的海报截图、**文字多的很**」+「**注意审美**」+「大字仿佛添加过字库，还有渐变这些」。
- **家底核实**：字体层级（`VF_FONTIER_V1`）、渐变（deck 渐变底 + `gradA/B` + 渐变流）、素材体检（`_probe_material` 的 `lum/edge/flat`，`_graphic`=判"截图/海报"）**本来都在** ⇒ 缺的是**素材页层次**：原来是整幅均匀压暗 + 一条硬边黑板（文字多的截图越压越灰，72% 处还有可见横线）。
- **改动（`VF_SCRIM_V1`）**：新增 `scrim_boxes()` 带状渐变遮罩（顶 0.42→0 / 中 0.05 / 底 0→0.52；深色素材 ×0.35），替换 `card_video` 两处（视频镜 + AI 片段镜）。用 drawbox 近似，单输入链内可做、不走 `geq`、alpha 绝不为 0/科学计数法。
- **端测**：`python render.py --selftest` 12 镜全过、成片 41.56s（改完 `card_bgimage` 后复跑同样全过）。
- ✅ **已覆盖全部素材页路径**：`card_video` 两处 + `card_bgimage` 两处（正常素材页 / "素材不适合当背景→改质感底板"）+ 删掉死变量 `_bar_y`；全库再无"整幅均匀压暗 / 0.72H 硬边黑板"。
- ✅ **3c-3「按素材文字密度克制叠加层」核实 = 引擎早已实现**（`VF_MATGUARD_V1/V2/V3`）：满字/海报/深色截图 ⇒ 大字缩 0.72 + 底衬 0.48 + **固定落"下三分之一 + 全宽渐隐底衬带"**；又深又满字 ⇒ 放弃该素材改出质感底板；`VF_NOBLACKBOX_V1` 早已把实心黑框换成渐隐蒙版带。⇒ 本批只把它的判据与渐变遮罩接到同一套观感，**不重复造**。
- 📋 **剩余**：批 4 = 双幅拼版 / 相框多幅排版（素材不够时）→ ✅ **引擎已就位（见下条），待 TS 接线**。

### 2026-10-06 批 4：双幅拼版 / 相框多幅（✅ 引擎完成，待接线 + 部署实测）

- 新增卡型 **`duo`（2 张）/ `frame`（3~4 张）**；做法 = 先用 ffmpeg 把素材拼成**一张合成 PNG**（等比 + 留边 + 细缝；竖屏上下/横屏左右/3~4 张 2×2；外层 `pad` 补到画幅），再交给 `card_bgimage` ⇒ 渐变遮罩/大字避让/动效/字幕全部继承。
- 两个关键细节：① **必须 `pad` 到画幅尺寸**（否则走"不放大保清晰"分支 ⇒ 拼版缩成一小块居中）；② 拼版镜**豁免** `_screen` 判据（用户点名要拼的图，不能被"素材不适合当背景"换成空底板）。
- 兜底：凑不齐 2 张 / 拼版失败 ⇒ 回落单图。
- **端测**：本机真渲 duo 2 张 + frame 3 张 ⇒ 两镜 OK、成片 8.00s；抽帧核对版式正常。
- ✅ **接线已完成**（`VF_DUO_WIRE_V1`）：图片成片提示词放开到 9 种 type + `picks`→本地路径取材分支；图视混剪同口径分支 + 提示词 `②b`。**刻意不把 duo/frame 加进 `KNOWN_TYPES`**（加了会让取不到图的 duo 原样透给渲染层 ⇒ 白镜）；渲染侧兜底 = 凑不齐 2 张回落单图。
- 📋 **观察项**：素材少时是否真的出现拼版镜（部署后实测）；`duo/frame` 不参与 i2v（图生视频）与素材去重（按 `src` 的判据看不到 `srcs`），如需再补。

### 2026-10-06 批 5（C4）：`make.py` 兜底切句避险（✅ 单测通过，待部署）

- `split_text_by_cap` 原来"标点切不出来就按字数硬切" ⇒ 会把 `6.1MB`/`12400人`/`96.5%` 切碎（配音念错 + 字幕断词）。现加**禁则回退**（同 TS `pickKinsokuCut` 口径），回退救不回来时**宁可超 cap ≤6 字也不切坏**。
- 两个坑：`isalnum()` 对汉字为真（必须 `isascii()` 限定）+ 只护数字不护字母（`ABCDEFG` 仍被切）。契约 `''.join(segs) === 原文` 永不破坏（7 例单测全等）。
- **另核实（不重复造）**：素材页"PPT 信息层元素"早已实现（`VF_PPT_OVERLAY_V1/V2`：kicker + 要点 + 数据卡 + 进度线 + 竖屏三带几何）。
- ⏳ **批 3.5b 结论修正**：查证 `buildVideoPlan`（`banner.ts:285`）里**根本没有 `duration` 字段** ⇒ "尾卡被裁"不是它造成的。**（已由用户服务端日志结案，见下条）**

### 2026-10-06 批 3.5b：尾卡"一闪而过"真因 + 修复（✅ 逻辑校验通过，待部署）

- **真因（用户日志）**：`[时长] 分镜预估合计 35 秒 / 目标 30 秒（仅供参考：最终时长由逐镜配音决定，不再按目标缩放）` ⇒ 成片 29.6s **不是被裁**，是**配音实际就这么多**；卡片显示的 30s 是"目标"（同一日志里还有"时长≈25秒"的字数口径预估）。
- **落点**：`tts.py:976` `s['dur'] = dur + 0.35` ⇒ 旁白很短的**纯文字卡**（收尾/标题）被换算成 1.x 秒。
- **修复（`VF_MINSTOP_V1`）**：纯文字卡抬**最短停留**（end 3.0 / title·quote 2.8 / compare·chart·list 2.6 / number 2.4）；**素材镜不抬**。音频侧按镜长 `apad` 补静音 ⇒ A/V 仍对齐；字幕窗口用 `voice` ⇒ 字幕不多停。
- ✅ **批 4 拼版在生产验证成功**：日志「取图上限 5 张 / 图5张 镜6个」+ 用户「合并图片我看到了」⇒ `duo/frame` 端到端跑通。
- 📋 **同日两个待办**：① 合并日志「20 与 21 镜」**连续出现两次**（同一对疑似合并/打印两遍，待查）；② 卡片时长口径建议统一为"最终以配音为准（约 N 秒）"。

### 2026-10-06 批 3a：时长以素材为准（上传素材后不给选时长）（✅ 代码完成，待部署实测）

- **用户定案**：「上传素材不给选时长。已实际素材合成剪辑为准，可以轻微调整。」
- **改动（`VF_DURAUTO_V1`）**：带上传素材 ⇒ 客户端「时长」整行**置灰**（改显示"以素材合成剪辑后的实际时长为准"）；服务端**不接受手填秒数**；起草完把 `vd.dur` 回填成**分镜实际合计** ⇒ `planRoot.duration` = 分镜总和 ⇒ **卡片显示的秒数 = 成片秒数**，且**尾镜不再被目标秒数裁掉**（043 的 32.0s/30s/29.6s 问题，一并解决批 3.5）。
- **"轻微调整"口径**：保留既有"片段不够时放慢 ≤1.35x"，**不引入变速加速**（会让画面语速与配音不匹配）。
- **B4「不拆视频」现状已满足**：素材文件整体使用，每镜只取 ≤10s 窗口，不切片不转码。
- 纯仓库模式（没上传）行为一字未改（零回归）。
- 📋 **批 3 剩余（未做）**：3c 视频页满屏 + **PPT 信息层动效**；批 4 素材不够时**双幅拼版 / 相框多幅排版**（`render.py` 新卡型）。

### 2026-10-06 批 2/2.5b：大字与字幕同文治理 + 上传卡按线统一（✅ 代码完成，待部署实测）

- **`VF_BIGSUB_V1`（大字与字幕同文）**：043 实拍同一镜两层写同一句（大字「4个认知升级的关键帧」= 字幕「4个认知升级的关键帧。」）。治法只减不增、**字幕零改动**：只治 `bgimage/image/video`（大字是叠加层）——大字是该镜字幕前缀 ⇒ ① 有 `kicker`/`label` 换 kicker；② 没有就清掉大字（只留字幕）。**独立文字卡不动**。接线 3 处（图片成片首次起草 + 重排 + 图视混剪）。
- **A2/A5 上传卡统一**：`VideoFormCard` 的 `accept`/按钮文案按线走（图视混剪收视频、图片成片只收图片并指路）；`VfAiSetupCard` 明说"本线只吃图片"、回显统一成"本次只从这几张取，不掺仓库"（**不放开**它的 accept，避免新的"传了不用"误导）。
- **端测**：同文无 kicker ⇒ 清掉 ✓ / 有 kicker ⇒ 换 kicker ✓ / 不同文 ⇒ 不动 ✓ / `title` 卡同文 ⇒ **不动** ✓。

### 2026-10-06 C2（提前）：画面大字避词边界截断（✅ 代码完成，待部署实测）

- **起因**：043 成片里出现大字「真正价值在**6**」（原句「真正价值在6.1MB背后的逻辑。」）——14 字硬切切在数字/英文串中间。
- **改动（`VF_BIGCUT_V1`）**：新增避词边界截断，**三处刻意同口径**（改一处必须三处一起改）：TS `anti-ai.bigTextCut`（`route.ts` 图片成片线 4 个调用点 + `vf-video.ts` 混剪线）/ `vf-mix.cutBig`（该文件契约"零 import"，刻意重复一份）/ Python `render.py::_cut_big_text`（渲染最后一道闸）。
- **端测**：直接 import 真函数 ——「真正价值在6.1MB…」保住 `6.1MB` ✓、「96.5%的企业…」保住 `%` ✓、长纯英文仍硬切（无法避免）。
- **顺带澄清**：043 取的是**仓库里那条 72.3s 旧成片**（不是用户上传的 30 秒素材）⇒ 正是批 1 修的病；批 1 生效后重跑只吃上传的那条。
- 📋 **同类待办**：大字与字幕**同文**（"4个认知升级的关键帧" 两层都写）⇒ 同文时应改用 kicker/关键词。

### 2026-10-06 043 片体检 + 相邻镜防重复（✅ 代码完成，待部署实测）

- **成片 `20261006_043`**（图视混剪 · 用户上传单个 72.3s 视频）：720×1280 / 29.6s；分镜 8 镜 = 1 title + **5 video**（`vstart` 7/7/23/23/40/56）+ 1 title ⇒ **批 1 生效**（上传的视频真被画进片子、等比居中、banner/大字/字幕/BGM 正常）。
- **已修（`VF_VDUP_V1`）**：相邻镜吃同一段画面（2/3 镜同 `vstart=7`、4/5 镜同 `vstart=23` ⇒ 同一画面连放 5~6s）⇒ 服务端顺延取样起点。
- **新发现待办（实锤）**：① **C2 提前**：大字被切在数字/英文中间（成片出现「真正价值在6」，原句含「6.1MB」）——14 字硬切不避词边界，**老引擎四线共用**；② **大字与字幕同文**（"4个认知升级的关键帧" 两层都写）；③ **分镜总和 32.0s > 目标 30s ⇒ 尾卡被裁到 ~1.6s**（核实 `planRoot.duration` 与裁切口径）。

### 2026-10-06 批 1：图视混剪"上传不被认" + 近重复页 + 预览误判（✅ 代码完成，待部署实测）

- **用户实测**：「图视混剪这里上传的完全不走上传，还是走库」+「几个制片上传素材打开的路径不一致（图视混剪和素材+AI 完全不同）」。
- **事实钉死**：上传目标与读取目录**四条线本来就是同一个**（`POST /api/storage/files` → OSS `storage/<uid>/`；出片都走 `listRepoMaterials`）。感知到的"两个路径" = 两张不同的卡（`VideoFormCard` vs `VfAiSetupCard`）+ `accept` 不同（image+video vs 仅 image）+ 文案不同 + **本次上传名单认不认（唯一真 bug）**。
- **改动**：① `VF_UPLOADWHITELIST_V1` 图视混剪接上传白名单（有名单 ⇒ `recent` + 精确过滤 + 不打散不降权）；② `VF_LINETAG_V1` 服务端下发 `line`（`'video'`/`'local'`）+ 客户端按线出文案（不再误告"视频不会被画出来"）；③ `VF_MATWARN_V1` 素材被丢弃/找不到时写入 `vd.matWarn`，确认卡可见；④ `VF_NEARDUP_V1` 相邻镜**近重复**（前缀/忽略标点）也去重；⑤ `VF_PREVIEWTXT_V1` 老引擎逐镜预览 8 字截断放宽到 14 字 + 悬停看全文。
- **端测**：直接 import 真函数跑去重例（近似页被改 / 长句不误伤 / 完全相等照改）✓；`tsc` 0 新增。
- 📋 **后续批次（用户已定方向，未做）**：A2/A5 两卡上传体验统一；**B 批** 图视混剪"单/多视频直接改 + PPT 动效"（视频页满屏 + PPT 信息层动效、时长不够用 PPT 版式页凑、**不拆视频**、**上传视频时时长选项置灰并按素材自动预估**、允许轻微加速、素材不够时双幅拼版/相框排版）；C2 老引擎大字 14 字硬切避词边界（四线共用）；C4 `make.py` 兜底切句避险；C5「000+这些关键」丢头需原始 `s.text`。
- ⚠️ **未做但已确认的差异**：素材+AI 的卡 `accept="image/*"`（选不了视频），VideoFormCard 是 `image/*,video/*` —— 属 A2 统一范围。

### 2026-10-07 素材镜 → 新引擎 `image` 页型（✅ 已推送，含母版遮罩加固）

- **这一步才叫"整片真·新引擎"**：素材以母版版式呈现（图在框里 + 页面自带 title/caption/kicker/页码），不再是"满屏素材 + 大字压上去"。
- **契约照做**：`title(4~24)/asset(相对 deck 文件)/layout`；**9:16 只允许 `full`**；asset 缺文件生成期抛错；素材按**内容 sha1**命名落 `pptimg-assets/`；取不到 title 就**不换**（不编内容）；`--no-imgpages` 可关。
- **实测**：6 页真渲 29.6s、校验 PASS、`verify-image.mjs` **① 素材真上屏 12/12、14/14 全达标**。
- **修掉的真隐患**：缓存键不含母版资产 ⇒ 改母版后命旧帧（"像没生效"）；现已把母版指纹算进键。
- **母版加固**：10 份 `master.css` 的 `.p9-full-scrim` → `.97/.90/.62/.10/0`（不越过 0.34 比色线）。
- ⚠️ **遗留 1 项**：亮底素材仍有 1 处对比度 2.29:1（**遮罩无关**，属引擎侧元素/校验口径）；**教训**：别用"筛素材"治对比度。

### 2026-10-07 "老引擎 / 新引擎"可判定化 + A/B 实证（✅ 已推送）

- **用户质疑**：「你是分不清哪个是老引擎使用的PPT和新引擎是哪个吗？还是用的老的」→ 认账：**是画面上没标记**，不是分不清。
- **本轮**：① 预览格子直接标「🆕 新引擎整页 / 老引擎画法」+ 顶部统计；② 本机 A/B（同分镜同时刻，只差 `pptpage` 键）：老引擎深蓝居中大字 vs 新引擎**米白纸感 + 左细红线 + 01/02/03 编号 + 描边大字 + 金句页**；两条都 51.00s（时序未变）。对照图 `temp/v9/AB.jpg`。
- ⚠️ **"还是老的"的统计原因**：换页**只覆盖纯文字镜**（title/list/number/quote/chart）；**素材镜 `bgimage` 与 `end` 仍是老引擎** ⇒ 素材为主的片子（他那条 13 页 ≈ 10 页素材镜）**只有 1~2 页会变**。
- 📋 **下一步（关键）**：**素材镜 → 新引擎 `image` 页型**（引擎已有页型 + `setImagePages`），这才叫"整片真·新引擎"。**待用户点头**。

### 2026-10-07 新线预览对齐成片（✅ 已推送）

- **用户实测**：贴确认卡的「👀 先看 PPT 页」网格 →「不还是老样子吗？」
- **查明**：那张网格是**老引擎逐镜静帧**（`render.py --ppt-preview`），而新线换页在**出片那一刻** ⇒ 必然不一致（"看的不是看的地方"）。
- **修法**：`ppt-preview/route.ts` 先调 `ppt-pages.mjs` 换页再逐镜渲（与出片同一把尺子）；**只对带 plan 根级 `pptpage` 的线生效**（老线预览照旧）。
- **副作用（好事）**：**不出片就能验皮肤**（预览即所得）；首次看某套皮肤需要一次 deck 渲染（10 页 ≈ 45s），之后同皮肤命中缓存秒级。

### 2026-10-07 结构性隔离：新引擎换页只属于新线（✅ 已推送）

- **用户原则**（原话）：「逻辑不能混就不混在一起」「这就是我为什么不让你在图片成片上直接改的原因，为了少写代码用一套逻辑导致前后矛盾」「你先在新模式下试通新引擎」。
- **改动**：换页入口要求 plan 根级有 `pptpage` 键，**只有新线写该键** ⇒ 老线一行都不进新引擎，**彻底回到 P0 之前**（文字页老画法、5 套风格字面生效、无粗映射影响）。
- **验证**：老线 → `不换页，文字页用老引擎画法`；新线 → `皮肤=master-editorial/vermilion · 页型编排=开` + `9 镜换页`。
- 📋 **仍有一处"混"（下一步）**：新线目前共用素材线的**草稿/状态机**（只补了"换线作废"）；按用户原则应抽独立模块（`vf-pptimg.ts`：独立草稿/step/协议串/分派）。**待用户点头再动**（避免在他要测的当口大改）。

### 2026-10-07 修「换线不生效」（004「还是用的原来的皮肤」的根因）（✅ 已推送，待重测）

- **现象**：004 里纯文字镜**已是新引擎页**（左侧竖线 + 进度线 + kicker），但皮肤是 **master-tech/cyan = 默认**。
- **根因（代码级）**：`route.ts` "新成片指令 → 作废旧草稿"那处只认 `vfIntent`（旧素材线正则），新线入口词不在其中 ⇒ 已有草稿时 `vd.line` 仍是 `'local'` ⇒ ① 卡片还是老 5 套皮肤（10 母版选择器不出现）② 出片不写 `pptpage` ⇒ 落到 style 粗映射默认皮肤。
- **修法**：① 命令命中本线一律作废旧草稿（`_vfNewLineCmd` + 日志 `[换线]`）；② 客户端回传**卡片上看到的 `line`**，服务端白名单后以它为准（卡片显示哪条线，出片就是哪条线）。
- **必然现象（待用户定）**：老线粗映射默认（未选风格 / 深色渐变）也落在 master-tech/cyan，**与新线默认相同** ⇒ 两条线默认长得一样。

### 2026-10-07 新线「PPT+图视」入口打通（✅ 已推送，待实测）

- **入口词**：主词 `PPT+图视`；别名 `HTML+图视` / `PPT图视` / `PPT+图片` / `版式混剪`（用户「用户不理解至少我们自己能分清」）。
- **接线 5 处**：`standard-commands` 登记 → `route.ts` 分派块服务 `['vf_local','vf_pptimg']` + 意图判定 → 起稿写 `line:'pptimg'`/皮肤默认 → 卡片下发 `line/skin/palette` → `VF_FORM` 皮肤白名单解析 → `banner.ts` 写 plan 根级 `pptpage{master,palette,mix}`（**只有本线写 ⇒ 老线零回归**）。
- **客户端**：`VideoFormCard` 第三条线分支；「🎨 画面风格」= **10 母版卡 + 4 配色色点**（40 组全可达），老线 5 套 + 样张不动。
- **隔离口径**：入口/卡片/皮肤表/plan 键**全隔离**（参数层不互相污染）；状态机与渲染内核**共用一份**（不复制渲染器）。
- **验证**：`matchStdCommand` 5 种写法全命中；tsc 93=基线（0 新增）；皮肤含中文配色 id 也 validate PASS。
- ⚠️ **第一版只吃图片**；"图视"的视频那半下一步接。
- 📋 **下一步**：① 视频素材接入（复用图视混剪的视频镜逻辑）；② 母版样张图（可选，40 张要批量渲）。

### 2026-10-07 新线「PPT+图视」第一步（引擎侧）：页型编排 + 皮肤贯通（✅ 本机验证）

- **用户定案**：「先推进新模式」+「**不要让 AI 总是只用最简单的『一页三排字』去画重点**」+ 皮肤 **master×palette 全开**。
- **① `VF_PAGEMIX_V1` 页型编排器**（`ppt-pages.mjs`）：镜 → **候选页型列表**（整句→quote／步骤词→steps／条目均长≥15→bullets／短条目→toc／大数字→section(number)／多数值→chart／两副卡→data），编排器按**去单调闸门**挑（连续同型 ≤2、bullets/toc 各 ≤40%、违反换下一候选）。**实测**：种类 **5** vs 旧行为 **3**（`--no-mix` 对照）；10 页真渲 45s、校验通过、抽帧见 **7 种形态**（`temp/v8/pages_sheet.jpg`）。
- **② `VF_BULLETSUM_V1`（真 bug）**：`bullets` 的 `summary` 是 **schema 必填**，改前只在副标 6~334 字时补 ⇒ 副标太短时**非法 deck → 渲染失败 → 换页白做**。现已改为"拿不到合规 summary 就不提供 bullets 候选"。
- **③ `VF_DECKGATE_V1`**：渲染前先 `validate-deck.mjs`，不过就**不换页**并打出原因（不再"白渲一遍"）。
- **④ `VF_PPTSKIN_V1`**：plan 根级 `pptpage{master,palette,mix}` → `make.py` 透传（**老线不写 ⇒ 零回归**）；`mix:false` 可退回机械映射排障。
- 📋 **下一步（未做）**：新线入口词（`PPT+图视` 主词 + `HTML+图视` 等别名）登记 `standard-commands` → `route.ts` 分派 → 卡片 **10 母版卡 + 每套 4 个配色点**（色值读 `masters/*/master.json`，**不必生成 40 张样张**）。

### 2026-10-07 用户定案「PPT+图视下 删除所有老引擎相关」→ 新线整片页化（`VF_PPTIMG_FULL_V1`）

- **含义**：新线**整片都是新引擎版式页**，不再有"这一镜保持老画法"。每个卡型都要能进版式页，
  且**只用他自己的字/图**：短大字（<4 字）⇒ 用**本镜字幕**的短句当标题、原大字降为**眉标**；
  `end` ⇒ 读 `line1` + 兜底英文 `AI MARKETING` + 字幕补 cta；`compare` ⇒ 引擎对比页（左右各 2~4 条，
  条目由 `leftDesc/rightDesc` 拆句、不足用字幕补）；`duo/frame` ⇒ **ffmpeg 先拼成一张图**再走 `image` 页（不丢图）；
  视频镜 ⇒ 抽一帧走 `image` 页（失去运动，日志写明）。
- **开关**：`VF_PPTIMG_FULL=0` 一键回退到"映射不上就保持老画法"。
- **本机实测**（7 镜：4 素材 + 对比 + 短标题 + 拼版 + 收尾）⇒ **换页 7/7、skipped 0**，校验 PASS、8 页渲 41.0s。
- ⚠️ **仍在"老引擎"的只有**：**合成链本身**（逐镜拼接 / 烧字幕 / 混音 / 时序）—— 那是全片同步的真源，不在本次范围。

### 2026-10-07 "没换页的原因"必须说实话（`VF_SKIPWHY2_V1`）

- **症状**：用户看到 换页 2/6，质问"新模块新引擎 分不清楚吗"。核对发现**卡片的原因文案在骗人**：
  第5镜 `bgimage`「地球」（2 字）被写成"本批不映射的卡型"，**真实原因是引擎 `pageImage.title` 硬性 ≥4 字**。
- **修**：`mapShot` 按卡型逐条给可执行原因（素材镜差几个字 / 对比卡结构不匹配 / 图表卡数值条数 /
  拼版镜丢图风险 / 视频镜只吃静态图 / `end` 缺英文）。本机用他那 6 镜同款卡型实测：7 条原因逐条可读。
- **引擎硬窗口（查清）**：`pageImage` 必填 `type/title/asset/layout`，`title` **4~24 字**、9:16 **只允许 `full`**；
  `pageCompare` 必填 `title/left/right/conclusion`，**左右各 2~4 条**（老引擎对比卡只有左右各 1 条 ⇒ 结构对不上）；
  `pageSection.title` 同为 4~24。
- 📋 **待用户定（能否"救"这几页）**：① 2~3 字大字的素材镜/标题卡 ⇒ 用**他自己字幕里的短句**当页标题、
  原大字降为眉标（字一个不丢，但标题措辞变）；② `end` ⇒ 兜底英文（如 `AI MARKETING`）；
  ③ 拼版 `duo` ⇒ 先拼成一张图再进 `image` 页（两张图都在）。

### 2026-10-07 换页 0/7 的**真正根因**：一个字撞引擎字体闸门 → 整批作废（✅ 已修，本机实测）

- **取证（服务器上，两条同时命中）**：① `check-engine-lint.mjs --deploy` ⇒ 引擎环境 OK（其 FAIL 是引擎
  自己的 lint 口径"部署模式不许跳过像素复测"，与我们无关）；② 重渲**失败那次留下的 deck**（脚本先落盘再渲染）
  ⇒ `✗ 字体覆盖闸门：缺字 "飙"(U+98D9)` → `code:8, stage:fonts`。
- **根因**：引擎内嵌字体 = **GB2312 一级 3755 字**；用户片顶部标题第二行 `ROI飙升 12.4K Reach` 的 `飙` 是表外字
  ⇒ 渲染前闸门 `exit 8`；而"一条片一个 deck"⇒ **一个字作废整批**（卡片只剩 `render-failed`）。
  我漏的原因：字表预筛只筛**页面**，`meta`/`cover.kicker` 来自顶部标题、**没过那道筛**（与"预览接口漏 `pptpage`"同族）。
- **修法（`VF_DECKFONT_V1`）**：meta/cover.kicker（占位页，从不贴回）⇒ 去表外字；页内**次要小字** ⇒ 去掉那一行；
  页内**主要文字** ⇒ 这一镜不换；组装后**整份 deck 兜底断言**（宁可本次不换页，也不让引擎渲染期才炸）。
- **本机实测**：同数据改前 0 镜 → 改后 **PASS、渲 21.0s、换页 2 镜**；两条分支各验一次。
- 📋 **用户那条片部署后预期**：**换页 4/7**（5 个素材镜里 1 个的 title 含表外字被跳过，其余 4 个 → `image` 页；2 个 `end` 仍老画法）。

### 2026-10-07 ⚠️ 更正：服务器**装了**引擎（"没装引擎"是我的误判）

- 用户举证 3 条 10-05/06 的片子含新引擎页 ⇒ 核实：`出品：` 在**新引擎 93 处**、**老引擎 0 处**，
  `001` 首帧正是「出品：AiMarketing 视频工厂 · 2026-10」⇒ **新引擎在服务器上跑得起来**。
- ⇒ `render-failed` **不能**归因于"引擎缺失"；真因必须看**引擎原始报错**。
- 本轮加"看得见"的能力：`VF_ENGINEPATH_V1`（打印引擎解析来源：ENGINE_HF_BIN / PATH / 引擎根 .bin）
  + `VF_RENDERLOG_V1`（引擎完整输出落盘 `<outdir>/<deck>.render.log` —— **引擎报错不进 pm2 日志**是最大盲区）。
- 🔍 下一步：他的 `0 换页` 走**我的换页链**（`render-deck.mjs`，cwd=应用目录），而能跑的新引擎片走
  **`gen-deck`+`batch-video`（cwd=引擎目录）** ⇒ 两条路径差异（命令/cwd/env/引擎来源）是真因所在。
- 🧰 验证命令：`node scripts/video-factory/html-deck/check-env.mjs`（应见 `✓ 渲染器 hyperframes 已安装 —— v0.8.111`）、
  `check-engine-lint.mjs --deploy | head -4`、`cat $(ls -t scripts/video-factory/html-deck/out/pptpage/*.render.log | head -1)`。

### 2026-10-07 新线「PPT+图视」换页 0/7 第二层根因：服务器没装渲染引擎（⚠️ 该结论已被上面更正）

- **用户侧证据（我上一轮加的"把依据打出来"生效了）**：卡片显示 `换页 0/7`、`⚠️ 换页未生效：note:"render-failed"`
  + 未换清单 ⇒ **`render-failed` 说明 meta 那关已过**，失败点移到了渲染。
- **根因**：`scripts/video-factory/html-deck/` 有**自己的 package.json**（`hyperframes` + `fontkit`、自带
  `node_modules`），而 `deploy-server.sh` **完全没管它** ⇒ 服务器上**没有渲染引擎** ⇒ 一渲就失败。
  **这也解释了 P0 为何从未在线上真正生效。**
- **修复**：① `deploy-server.sh` 新增 `[3b/7]` 自动装引擎依赖 + 打印「引擎/Chrome/Node」口径；
  ② `ppt-pages.mjs` 渲染前**预检引擎**（缺 → `note:engine-missing` + 修复命令，省掉白等的一次渲染）；
  ③ 渲染失败**带引擎原始报错尾**；④ 卡片未换清单只取"最后一轮"（降级重试会有两轮日志）。
- **服务器上立刻解锁**：`cd /root/AiMarketing/scripts/video-factory/html-deck && npm ci --omit=dev`
  （然后 `node ../../html-deck/check-engine-lint.mjs --deploy` 看引擎/Chrome 口径；或直接重跑 deploy-server.sh）。
- **你那条 7 镜的预期**：5 个素材镜中「第4镜 AI赋能」命中字表外字符 → 不换；其余 4 个 → `image` 版式页
  ⇒ **换页 4/7**；2 个 `end` 仍老画法（待你定是否给兜底英文）。

### 2026-10-07 新线「PPT+图视」换页整批作废的真根因（✅ 本机端到端修好，待部署）

- **症状**：用户用 PPT+图视 出片，预览显示「共 7 页（其中 0 页 = 新引擎整页，其余 7 页 = 老引擎画法）」。
- **真根因（本机复现）**：`deck 校验没过 → 不换页：✗ 不达标 meta.title | ✗ 不达标 meta.subtitle`。
  本脚本"一条片一个 deck 渲一次"（引擎下限 4 页 + 无单页渲染开关所迫），而 `meta` 是 schema **硬性必填**
  （title 4~33 / subtitle 6~203）；改前 `clip(banner.line1 || sb.topic || …, 50)` **没做窗口校验**、
  **截断 50 还超过上限 33** ⇒ **meta 一不合，整批换页全部作废**（表现 = "这条线又是老画法"）。
- **`VF_METAWIN_V1`**：meta **窗口内自适应**（挑窗口内候选 → 全不合就用本片信息补到合法长度）。
  实测（主题故意 2 字「测试」）：改前 FAIL → 改后 **PASS**、5 页渲 **25.8s**、**4 镜换成新引擎页**。
- **`VF_DECKRESIL_V1`**：整批失败**自动降级重试一次**（摘掉素材 `image` 页，只换纯文字镜）。
- **`VF_SKIPWHY_V1` + 标签补丁②**：跳过原因**回传到卡片**（「本线 PPT+图视 · 皮肤 … · 换页 4/7 镜」+ 未换清单）；
  预览接口原先是白名单重建、漏了 `pptpage` 字段 ⇒ 标签恒显示"老引擎/0 页"，现改 `...it` 透传。
- ⚠️ **已知边界**：`end` 卡与"3 字短条目清单"**本批仍不换**（引擎对应页型对 `en` 与条目字数有硬窗口）。
- 📋 待你定：① 是否让 `end` 卡也换（需我给 `en` 兜底一句英文）；② 3 字短条目是否允许我补成完整短语（= 改文案）。

### 2026-10-07 四件小事：日志重复 / 时长口径 / 素材页遮罩 / 版式页逐镜关标题（✅ 本机验证，待部署）

- **①`VF_MERGELOG_V1`（日志重复，一行）**：`material-pool.ts` 报镜号用了**合并后不前进的 `out.length`** ⇒ 连续 3 张以上同内容时同一对镜号连打两次（用户实测「第 20 与 21 镜」）。改成「并入原始第 N 镜 → 合并进第 M 镜」。**数据层无重复合并**。
- **②`VF_CPSONE_V1`（时长口径统一）**：卡片三个数字（目标/预估/概要）收成一句「**最终以配音为准（约 N 秒）**」；**12 处 `chars / 4.5` 统一为 `chars / VF_SUB_CPS`（4.3）**，`targetSec` 只留给成本公式。真时长仍只有 `tts.py` 跑完才有（`tts.py:975-976`）。
- **③`VF_DECKSCRIM_V1`（一行）**：`card_bgimage` 的 **deck 卡片版式分支**补 `scrim_boxes` —— 它是全库唯一没有渐变压暗的素材画面。
- **④`VF_BANNERSKIP_V1`（版式页不被横幅压住）**：顶部固定标题支持**逐镜跳过**（`banner.skip` = 1-based 镜号；`render.py` 换算成秒区间做 `base*not(...)`）。`ppt-pages.mjs` 换页时**自动写入**。本机实测：素材镜/老画法镜有横幅、换页镜顶部干净（`temp/v8/banner_sheet.jpg`）。
- 📋 **查清的两条**：`[素材配比] 36→5` = **配额**（每 30 秒 5 张）不是过滤器；批3c 素材页版式层**大部分早已做**，真缺口就是 ③。

### 2026-10-07 P0：文字镜换新引擎整页版式图（✅ 本机端到端实测通过，已部署）

- **用户定案**：「先做 P0」；并提醒「素材多为文字和海报，**别干扰你的判断**，用户也可能这样 ⇒ 设计逻辑要严谨」。
- **形态（受引擎硬约束决定）**：新引擎 deck **下限 4 页 + 首页必须 cover**，且**没有"只渲某页"开关** ⇒ 一镜一 deck 不可行。改为**一条片的文字镜合成一个 deck 渲一次**，再把 `frames/pN-full.png`（0 基，`p0`=封面）**按序贴回**对应镜；`type:'bgimage'` + `src:<本地 PNG 绝对路径>` ⇒ 老引擎的 Ken Burns/渐变遮罩/字幕全部自动继承，**不新增第二条渲染链**。
- **新文件** `scripts/video-factory/ppt-pages.mjs`：卡型映射（title→section / list→bullets|toc / number→section；end·compare·chart·quote 本批跳过）+ **窗口硬校验**（不合则**不换这一镜**）+ 字表预筛 + 内容 hash 缓存 + 兜底日志 + `RESULT` 收尾。
- **挂点** `make.py::_pptpage_swap`：**配音之后、渲染之前**；只对**图片成片/图视混剪**生效（`--source ai`/`--mix` 跳过）；失败/跳过回落原 storyboard；`VF_PPTPAGE=0` 一键回退。
- **渲染侧配套**：`_screen` 对 `_pptpage` 例外（否则深色母版页面被判废换空底板）；`kb` 增加静止档（`VF_KBSTATIC_V1`，否则每镜推近会切掉页面安全边）。
- **本机实测**：真渲 4 页 ~20s → 换页 → 老引擎 **7 镜全 OK / 31.00s** → 抽帧**整屏满幅**。
- 📋 **P1/P2 待做**：皮肤映射（老 `style` → `master+palette` 的正式对齐）、该镜关掉顶部固定标题、**预览网格与成片对齐**（预览目前仍是老画法）；P2 = 动效版（把页渲成短片，需先 TTS 再渲页）。

### 2026-10-06 ONELAYER：图片成片/图视混剪视觉选项「三层 → 一层」（✅ 代码完成，待部署实测）

- **用户定案**（原话）：「目的只有一套 PPT 选择。PPT 成片单独放着，我需要这个独立成片能力，可能会找个热点没有图片直接让它出口播视频。PPT 成片不动，只优化图片成片和图视混剪」+「确定重复内容冗余 删除」。
- **病根**：`VideoFormCard`（四条线共用）并列三层视觉选项 —— ①「🎨 画面风格」5 套 ②「高级：主题」10 个 ③「高级：PPT 版式」7 项；而 `themes.py` 的 `STYLES` 内部就是 `theme+deck+period` 的打包 ⇒ 同一件事三个旋钮，靠"选了风格就把后两层置灰"回避冲突。
- **本轮改动**（只动 `src/app/agent/page.tsx` 一个组件，`+31/−82`）：删「高级：主题」「高级：PPT 版式」两段 + `styleOn` 置灰 + 折叠按钮 + 「成片方式」死段落；`theme/deckStyle` 改普通常量但**仍照原值提交**（零回归）。**PPT 成片线一字未动**。
- ⚠️ **待部署实测**（客户端 Ctrl+Shift+R）：① 无「高级」入口 ② 5 张样张可选可看 ③ 出片观感与改前同风格一致。
- 📋 **待办（未做，等实测后再定）**：① **皮肤扩库 5 → 10**（把 5 个裸主题 dark/blue/tech/mint/vivid 升级成正式皮肤，并与新引擎 10 母版并入同一列表）；② 卡片里那个「主题」是**文案主题输入框**，与刚删掉的配色「主题」同名 → 建议改名「文案主题」；③ **不改**：素材+AI / AI 制片与本卡共用风格区（同步变"一层"），如需只留两条线就得拆卡（不建议）。

### 2026-10-06 PPT 成片彻底拆线 + 图表不画空图 + 页时长节奏（✅ 代码完成，待部署）

- **用户定案**（原话）：「如果 2 者相互矛盾，你给我彻底拆开，做个 PPT 成片 / HTML 逐帧成片，原设计图视混剪和图片成片单独保留。不要混在一起。要不这个好了那个又坏了，我们调试起来很麻烦。」+「全部一起做完，另外前面调试字幕配音等如果有成熟技术可以用」。
- **两套时序真源（冲突根源）**：图片成片/图视混剪/素材+AI/AI 制片 = **分镜 `dur`**（卡片承诺 6s/镜，老引擎 make.py 执行）；deck 引擎 = **配音句**（`vf-deck-render.ts` 里 `shot.dur` 一次都没读）。卡片展示前者、引擎执行后者 ⇒ 必然对不上。
- **拆线结果**：新增第 6 条状态机线「**PPT成片**」（`vf-ppt.ts`，入口命令 + 别名；只吃 文案/主题 + 皮肤 + 画幅/时长/音色/BGM；不取素材、不排分镜、不插素材图；`deckOnly` 草稿标记）；**封路** handler：其余四条线收到 `engine='deck'` 一律拒绝（前端也删了那个选项，成片方式块改成静态说明）。
- **节奏**：口播切块（与字幕共用 `chunkSub`，长句切 ≤16/24 字）+ 封面/尾页各 ≤1 单元 + 其余均分 + 无单元页 = 平均页时长（不再 2.5/3.4s 闪页）。
- **图表**：数值逐行取（跳过标签列）+ 空串判 NaN + 全 0 不出图 + 占位词表头⇒从表体找真单位；提示词禁写「单位」二字、数字必须在第 2 列、节标题禁标签词、节数 4~8。
- **标题硬拦**：sanitize 去掉「要点节/图表节/对比节…」标签词，不足 4 字从本节内容派生。
- **端测**：001 同形态 ⇒ `chart(bar) series=42,78.5,15,8.5 unit=[%]`；全 0 表 ⇒ 不出图；render reconcile 全 0；gen-deck 自测 3/3；tsc 无新增。
- ⚠️ **待部署**：`cd /root/AiMarketing && git pull origin master && npm run build && pm2 restart aimarketing`；**客户端需重新打包**（新卡 VfPptCard/确认卡 + 素材卡去掉动态 PPT 选项）。
- ✅ **10-06 收尾**：① 非数值表降级条目改取"行内最后一个真值"（`VF_TBLITEM_V1`，不再出「社媒声量：%」）；② `check-examples` 基线按实测重设（`★VF_REBASE_1006`，11 个 bad 样例；真因 = 同一判据被 schema 检查与专用检查各报一次）⇒ **22/22 全绿**。
- ✅ **本轮不需要打包客户端**：三次提交零 `electron/`/`public/` 改动；`build-local.mjs` 写明"纯壳模式（页面/API 全在服务器）"、`build.files` 只含 `electron/**`+`public/**` ⇒ 客户端加载服务器页面，**只需服务器部署**（更正此前"客户端要重打包"的说法）。
- 🟡 **可选待办**：要不要在 validate-deck 里对"同一 path + 同一判据"去重（去重后计数回旧基线，须同步把 `check-examples.mjs` 基线改回去）。

### 2026-10-05 CHARTKIND + ENDFIX：图表页入口恢复（折线/占比环/柱状）+ 尾页硬伤（✅ 代码完成，待部署重出片）

- **用户反馈**（看 008 片后）：「为什么 PPT 始终都是打字，没有任何曲线图、图表等」+ 尾页两处问题。
- **根因①（图表恒为 0）**：`gen-deck` 的 chart 页唯一入口 = ≥4 行数据的 markdown 表格；而 PPT 转写 prompt 里写着「不要写成 markdown 表格」（修 GEN-TOO-FEW-PAGES 时加的）⇒ AI 永不写表格 ⇒ 入口堵死；且 `chart.type` 写死 `bar`（`line`/`donut` 引擎早支持、有像素对账，只是生成器没入口）。
- **修复（`VF_CHARTKIND_V1`）**：① prompt 放开表格（数据节 = 大数字页 + 柱状/折线/占比环三种图表节，规定表头第 2 列写单位、≥4 行纯数字、说明 8~39 字）；② gen-deck 按节标题选图型（占比/构成/结构/比例/份额/分布→donut、趋势/走势/增长/变化/曲线→line、其余→bar），labels/series 成对过滤。
- **修复（`VF_ENDFIX_V1`）**：尾页 CTA 过 `stripItem`（去掉 `- ` 横杠）；去掉写死的 `ONE SCRIPT · MANY SKINS` 与开发术语兜底，改中性文案 + 开放 `--cta`/`--en`。
- **端测**：三图型联测（16:9 + 9:16 各渲一次 reconcile 全 0）· sanitize→gen-deck 全链（表格保留、字体闸门 PASS）· 引擎 lint PASS · gen-deck 自测 3/3。
- **闸门卫生**：selfcheck ④ 段两处陈旧标记修掉（`VF_SUBCHUNK_V1` 重复、`VF_AVIMG_V1` 期望 8→实数 5）⇒ ④ 段 61 OK / 0 FAIL。
- ⚠️ **待部署重测**：服务器 build 后重出片，确认出现折线/占比环/柱状页、尾页无横杠、无内部术语。
- 🟡 **已知既有红（不在部署闸门里）**：`node check-examples.mjs` 11/22 样例偏离基线（bad 样例的"不达标项数"多于基线，是 validate-deck 后来加检查后的漂移，非本批引入；未改基线，等排期确认）。

### 2026-10-05 FONTFIT：render=8 字体覆盖闸门整单红 → 三出口净化（✅ 代码完成，待部署重测）

- **用户实测炸点**：vf1791197069965「batch-video 退出码 1：BATCH-ITEM-FAILED · render=8 · 未找到产物 mp4」，且 **30s 单成功、180s 单失败**。
- **根因**：`render=8` = render-deck **字体覆盖闸门**（`EXIT.FONT`）。PPT 内嵌字体是子集（`fonts/chars-cmn.txt` = GB2312 一级 3755 + ASCII + 标点 = 3926 码点），deck 出现一个表外字（婷/鑫/喆/emoji/特殊符号）⇒ 闸门红 ⇒ 整单红。文案越长撞表概率越大——解释 30s/180s 差异。
- **修复（`VF_FONTFIT_V1`）**：copy.md 三个进字出口（sanitizeDeckMd 行预处理 / buildRuleMd 分镜·切句·封面 / 图片页 title·caption）全部先过 `fitFont` 删表外字，删字打日志+落任务文件 `fontSanitized`；prompt 补「禁 emoji/生僻字」。闸门不动（服务器无 CJK 系统字体，缺字真豆腐块）。
- **端测对照**：脏文案 render-deck `exit 8` 一字不差复现；净化后 `ok=true` 6 页 19.8s 渲染成功；纯表内文案净化零动作。
- ⚠️ **待部署重测**：服务器 build 后重出 180s 长单。后续优化（未做）：字表扩 GB2312 全量 6763（重跑 make-fonts.py）。

### 2026-10-05 DECKRESCUE：sanitize flatMap 真凶修复 + gen-deck 救援网（✅ 代码完成，待部署重测）

- **用户实测炸点**：vf1791195178923 整单红「gen-deck 退出码 1：GEN-TOO-FEW-PAGES 只生成 2 页」。
- **真凶**：MATDOM/PAGEMIX 改造时 `sanitizeDeckMd` 的 `flatMap` 误写成 `map`——节数组没摊平，join 把每节变成「## 标题，要点，要点」**一行**，gen-deck 全部节丢弃 = 恰好 2 页。上午端测只喂手写 md 绕过了 sanitize，没测出（教训：**端测必须过 sanitize 再喂 gen-deck**，已写进代码注释）。
- **修四刀（`VF_DECKRESCUE_V1`）**：flatMap 修复；sanitize 硬化（弱表格不当图表节/非数值表降条目/表格节保留 items/6~7 字步骤按节型放行/剥粗体与【标签】）；**救援网**（buildRuleMd 闭包化，gen-deck 失败回退规则映射重跑一次，`rescued:true` 落任务文件）；prompt 数据节禁表格。
- **端测**（过 sanitize → gen-deck）：std 六页五型全亮、chart/shortstep/bold 各 4 页，全绿。
- ⚠️ **待部署重测**：服务器 build 后重出同款单。

### 2026-10-05 MATDOM/PAGEMIX/SUBATOM 三连修：素材量破窗 40 页 + 页型混排 + 字幕原子切块（✅ 代码完成，待部署实测）

- **用户定案**（实测 004/005/006 后）：「4 日语腔先不动；其它再改。素材图必有、量要大于 PPT；不一定要页页有图、图也不一定要页页背 PPT。」
- **修 1 素材量（`VF_MATDOM_V1`）**：schema `pages.maxItems` 12→40（唯一真源 + `deck.p40-test.json` 40 页实测渲染 exit 0 + measured-limits/renderedMax=40 + check-schema-vs-limits 绿）；注帧 = `min(图镜, max(口播句数−PPT页, PPT页+1))`，**每帧背 1 句配音（voice-over）**——总时长 ≈ 音频长度不膨胀（上午 IMGFRAME 静默帧方案 20 帧会白加 50s，已取代）；句子全部页均分。单测：003 单 → 20 帧 > 8 PPT · 28 页 · 179s 零静默 ✓。
- **修 2 页型（`VF_PAGEMIX_V1`）**：sanitizeDeckMd 放行 4 种节型（要点/数据/流程/对比）+ AI 转写 prompt 给节型菜单——gen-deck 本就支持 data/steps/compare/chart 页型，只是 copy.md 全是 bullets 喂不出来。端测：`cover→bullets→data→steps→compare→end` ✓。
- **修 3 字幕（`VF_SUBATOM_V1`）**：原子块贪心打包——数字+单位/英文单词为原子、标点粘前块（块永无「，」开头）、句读过半即收、<2 字碎块并邻。三事故句（「，点击率8.5%」「出」「3分|钟」）单测全过。
- **修 4（`VF_DECKROUTE_V1`）**：导流提示阈值 90s→300s（40 页窗 ≈5 分钟才是真超容量）。
- **不动**：日语腔（qwen3-tts 英文整词发音问题，用户明确 4 先不动——将来做：TTS 预处理整词转中文/拆读，或整句降级硅基 CosyVoice2 对比）。
- ⚠️ **待部署实测**：重出 003/005/006 同款单——素材帧量与配音、页型混排、字幕三处观感。

### 2026-10-05 B+C 落地：deck 线图片快闪帧 + 长单导流提示（✅ 代码完成，已被下午 MATDOM 取代注入/分配段）

- **背景**（180s 单 `20261005_003.mp4` 实测「38 镜只有几帧」）：deck 线三重压缩——38 镜塌缩成 3~6 PPT 节；图片注入写死 6 张且每内容页只配 1 张（27 张 bgimage 只进 3 张）；schema `pages maxItems=12` 硬顶 + 每页均分 ~17s 长旁白。
- **用户定案**：「不是每张图都要背一个 PPT 页——图片帧就是帧；先试 B-C 看效果」。
- **C（`VF_IMGFRAME_V1`）**：图片页 = 独立快闪帧——2.5s/张、不背旁白（配音只落非图片页，帧内短静默 BGM 铺过）、上限 = 填满 12 页窗（12−PPT页数）、均摊穿插各内容页后。
- **B（`VF_DECKROUTE_V1`）**：新引擎且镜数>12 或预计>90s → 确认卡明示建议走老引擎（只提示不拦，仍可强行 deck）。
- 已知取舍：PPT 页挤满 12 页时图帧 0 张（B 已把这种长单导去老引擎）；图片按分镜顺序取前 N 张、不按内容相关性挑（后续可升级相关性排序）。
- ⚠️ **待部署实测**：①30 秒短单看快闪帧观感；②38 镜长单看导流提示 + 强行新引擎时帧密度。

### 2026-10-05 新引擎出片整单失败修：两套文案转写层太脆（✅ 代码完成，待部署实测）

- **失败现象**（用户 11:10 实测）：「分镜可用的文字太少（可用要点 5 条，文案切句也不足 6 条，新引擎至少需要 6 条）」整单失败。
- **用户三问三答**：① 现在是 2 套文案吗 —— **是**（`VF_DECKCOPY_V1`：口播版给配音/字幕、AI 转写要点版给 PPT）；这次失败是转写未过校验/异常 → 掉规则兜底 → 兜底也凑不齐。② PPT 字数放宽 —— 8~28 字窗口下限 8 是引擎 schema `minLength=8` 硬约束（短了整节被引擎丢弃），本层放不了宽；放宽的是"不得改写"枷锁。③ 权力放大给 AI 自主编排 —— 即修法方向。
- **修 2 处**：㈠ AI 转写重试 1 次 + prompt 放宽润色（允许轻度润色/扩写成完整短语满足 ≥8 字窗口；数字/事实不动、不加新信息）（`VF_DECKRETRY_V1`）。㈡ 规则兜底切句增强：<8 字碎句与后句合并（口播文案天然多短句，老逻辑直接丢光）+ >28 字长句按逗号二切（替代截断加…）（`VF_SCRIPTCHUNK_V1`；单测：上午实文案出 8 条 ✓）。
- ⚠️ **待部署实测**：重试该失败单（30 秒短文案），确认 AI 转写成功或兜底出片不再整单失败。

### 2026-10-05 新引擎（动态 PPT）成片四连修（✅ 代码完成，待部署实测）

- **① TTS 缩写"日语腔"**（用户实测非首次：配音把 `API` 段读成日语腔；此前曾被误判为"英语问题/是否全改中文"——用户定案"全部改中文肯定不合适"）：根因是 qwen3-tts 对中文句中英文缩写按**多语种整词**发音。修法 = `prepareTextForTTS` 把全大写 ≥3 字母缩写拆成「A P I」逐字母读（`VF_TTS_ACRONYM_V1`；AI/OK/iPhone 不动；拆读版已实测合成正常 + ASR 识别为中文）。**排查证据链**：BGM 曲名正常、配音 8 句全成功、三条 TTS 档位（百炼/硅基/火山）本机实测均输出中文 → 排除 BGM 与 TTS 语言路由。
- **② 音色参数被整个忽略**（用户选任何音色出来都是同一个声音）：`textToSpeech` 的 speaker 从未下传——百炼永远默认 Cherry、硅基兜底写死 alex。修 = 百炼两处传参 + 硅基音色映射（8 个预置音色逐一实测存在）+ 失败回退 alex + 火山兜底传音色（`VF_VOICE_PASS_V1`）。
- **③ deck 线自产 SRT 切断数字**（用户实测 2 次：`99.8%` 被切成 `99`/`%` 两段字幕）：固定字宽盲切不认数字/百分号/英文串边界。修 = `chunkSub` 块点回退（`VF_SUBCHUNK_V1`，单测 4 例过）。
- **④ 分镜用图太少 + 多 end 镜**（留档 `vf-20261005-100944-u1.json` 实锤：8 镜 = bgimage×1 + title×1 + compare×1 + number×1 + list×1 + **end×3**，5 张素材图只用 1 张）：注入层没丢图，是 AI 排分镜就没用图（提示词只说"信息卡换着来"，没说"图要多用"）。修 = vfShotsPrompt 加两条硬规矩：⑤ 素材图 ≥2 张时 bgimage 至少排一半以上 ⑥ end 只许 1 个（`VF_SHOTIMG_V1`）。
- **⑤ 存档撞名**（用户删了 `20261005_001` 后新片又占 `001` → 客户端按文件名判重跳过同步，"本地没找到新片"）：序号原取 `existing.length+1`，会复用被删空号。修 = 当天最大序号+1（`VF_NAMESEQ_V1`）。⚠️ 局限：当天文件全删光时仍会从 001 起（无历史可查）。
- **不改（用户拍板）**：文字 PPT 页压素材图当背景——deck 引擎 schema 文字页无背景图字段，需要引擎扩展；用户确认素材字密，"这个有问题就改没问题不改，原则上逻辑对就可以" → 维持独立图片页（`pageImage`）现状。
- ⚠️ **待实测**（服务器部署后重出一条新引擎成片）：API 逐字母读、换音色生效（选龙书出男声）、字幕不再切数字、分镜图变多、end 只 1 个、新片序号不撞名。

### 2026-09-21 素材成片：两条真 bug 修复 + 中转站 403 真因（✅ 代码完成，待部署实测）

- **①「第二条被吃掉」与「选 60 秒出成 200 秒」是同一个根因**：成片草稿（`AgentMemory` tag `vf_draft`）停在 `running`/`script` 时，用户提交的 `VF_FORM:{...}` **只在 `step=form/source` 才被解析** → 要么被 running 分支拦下回"渲染中"，要么**落进「文案微调」分支被当成"改文案的要求"喂给 AI**（时长 + 上传名单全丢）→ 接着点确认就用**旧草稿的 180 秒分镜**出片（200 秒 ≈ 900 字 ≈ 180 秒目标的字数）。
  **修**：`VF_FORM_CLAIM_V1`（孤儿草稿 → 作废 + 用本次表单重新起草，一次点击到位）+ `VF_RUN_CLOSE_V1`（**入队即作废草稿**，顺带修掉"之后最长 30 分钟内任何消息都被回『已在后台渲染中』"）
- **②主题被写成协议串**：`VF_TOPIC_GUARD_V1` + `VF_TOPIC_CLEAN_V1`（含清理历史脏草稿）
- **③中转站 403 真因（实测三组对照）**：Python `urllib` 默认 UA 被 Cloudflare 拦（403 且响应体非 JSON）；同一请求换 curl / Node UA → **400 JSON（key 有效、通道通）** → "服务器测试通过、实际成片全 403"对得上。**修**：`make.py` 补 `User-Agent`（`H3_UA_V1`）+ 响应体非 JSON 时把原始前 200 字入日志（`H3_DIAG_V1`）
- **④时长认知纠正**：素材成片**最终时长 = 文案字数 ÷ 4.5**，且由 `tts.py` **逐镜真实配音时长回填**（`s['dur']` 覆盖分镜 `dur`）→「时长护栏」只能管"无配音的镜头"（`VF_DURFIX_NOTE_V1` 日志写实）
- **⑤并发结论**：**不同用户完全隔离**（草稿 / 任务文件 / 出片 workdir / 素材仓库 / 配额全按 userId；出片 workdir 已按 `work_<时间戳>` 独立，不会互相覆盖）；**同一用户连做两条**才需要上面的"草稿认领"逻辑。⚠️ pm2 须保持 `instances=1`（`VIDEO_DRAFT` 是进程内 Map）
- **⑥「素材线的『确认』被 AI 制片线抢走」（用户实测）**：AI 制片线 / 混合线也有"入队写 `step='running'` 但没人收尾"→ 草稿终身 running，而它们的接管规则是"有本线草稿 → 一定接管" → **僵尸草稿终身吞掉所有消息**（含别线的「确认」）。**修**：`VF_AI_RUNCLOSE_V1` / `VF_MIX_RUNCLOSE_V1`（入队即作废本线草稿；接管判定里 running 一律视为僵尸 → 自清 + 不接管）。**⚠️ 新增一条线时必须同时带上这两条规则**
- **⑦按用户定案【拆掉素材线卡里的「素材+AI 混合」「全部 AI 生成」】**（`VF_SRC_SPLIT_V1`）：审计发现这两个按钮在**两套 UI** 里行为不一致 —— 表单卡的「混合」是死路（后端回"还在开发中"）、内联卡的「混合」却真能跑；内联卡的「全部 AI 生成」会被 AI 制片线接走，而表单卡的同名按钮走素材线的 AI 模式。→ 两套 UI 各删掉这两个按钮（连同 `source==='ai'` 的上传置灰/隐藏提示/强制竖屏 useEffect/画幅文案 4 处死分支），**素材线卡只剩「素材合成 / 我上传素材」**；后端老 mix 入口改为指路（不再说"开发中"、不再污染草稿）。**结果：4 种画面来源 → 4 条明确的路**（素材合成/我上传 → 素材线；全 AI → AI 制片线；混合 → 混合线，各由自身入口词触发）
- **⑧修「AI 制片走到『▶️ 下一步（排分镜）』掉出状态机」**（`VF_PROTO_V1`）：根因是 **`skipModelStep1`（状态机总入口）只认"入口词/草稿/发布词"** —— 而卡片提交发的是 `VF_FORM:`（协议串），**不是入口词** → 整块跳过 → 落到 AI 自由发挥，**AI 自己编了一张假卡**（`VF_JSON:{"step":"ai_plan"}` —— 这个卡型代码里根本不存在；回复尾巴「（模型：qwen3.8-flash）」只加在 AI 自由发挥上，是铁证）。次要原因：卡2 的表单带着**文案正文**，正文含「写标题/海报」→ 命中 AI 线的"工具意图排除" → 连入口词判断也 false（双重进不去）。**修**：`skipModelStep1` 增加**协议串前缀**判定（卡片提交必进状态机）+ 两条线里"协议串不算工具意图"。**教训：新增一条线/一张卡时，必须把它"怎么进状态机"一并接好**（入口词 + 协议串 + 草稿 三选一任一能进）
- **⑨两条新线补「入口词 = 重新开一条」**（`VF_AILINE_RESTART_V1` / `VF_MIXLINE_RESTART_V1`）：上一轮残留在 `ai_opts`/`script` 的草稿会把**新指令**吞掉（用户实测：说「AI 制片帮我做一条视频」被回"请在上面选好…"，看着像状态机不进）。素材线早有"入口词→清草稿"，两条新线漏了 → 各补一条（只认入口词，「确认/下一步/VF_FORM」绝不重置）。**同时补**：混合线分派在 AI 线之前却只排除了素材线入口词 → 会把「AI 制片…」抢走 → 补上 AI 入口词也让出
- **⑩★★【标准模式锁死】命令白名单 + 单一路由器（2026-09-21 用户定案，批次 1）**：标准模式 = 只有 `src/lib/agent/standard-commands.ts` 里的 **10 条命令**（4 多步状态机 + 3 单步工具 + 3 wip 占位；原「帮我搜一下小红书…」按用户定案**删除**）；**匹配 = 去空白后完全相等（少一字/错一字都不执行）**；**命令出现即清掉"发布线 + 三条成片线"的全部草稿（=重来）并强制进状态机**；**非命令且无进行中流程 → 固定话术（不再让 AI 自由发挥）**；认不出的卡型前端只给固定提示（不再显示 `VF_JSON:` 原文）。**新增命令必做两件事**：写进 `STD_COMMANDS` + 同步前端 `FEATURE_TIPS`（一字不差）。**待做（批次 2+）**：单步命令收窄为"只给这一个工具"；三线"活跃线 + step 只前进 + 结束即作废"
- **⑪★修「AI 制片出片必失败」**（2026-09-21 用户实测 vf1789997211542）：① `make.py _h3_download` **漏了 UA**（上轮只补了 API 调用那条路）→ 产物被 Cloudflare 403 → 生成成功却 0/4 镜拿不回来（`H3_UA_V1`）；② **"AI 镜全失败 → 自动回退素材合成"这个护栏对 AI 制片线是错的** —— AI 制片没素材（本次 0 张图）→ 回退后 `bgimage` 无图 → 渲染崩 → 整片失败，还把真病因埋在"渲染错误"里（`VF_AIFAIL_V1`：AI 制片直接失败并说清病因；混合线保留回退）。**加固**：`card_bgimage` 无图 → 降级 title 卡（`VF_NOIMG_V1`）；下载失败打出 URL（`H3_DLDIAG_V1`）
- **⑫按用户定案划清 AI 制片的边界：AI 制片 = 文生视频**（`VF_AIONLY_V1` / `VF_AIFAIL_V1`）—— **除了第一步"看素材库猜题材"，全程不碰素材库**：`aiOnly` 让分镜只产出"不需素材图"的卡（`bgimage`/`image` 一律降级 title）、写文案不再喂素材摘要、分镜不带素材图；出片时**缺任何一镜的 AI 画面 = AI 制作失败**（不用素材顶、不降级、不回退；混合线仍可回退，因为它本来就有素材画面）
- **⑬修两处 + 确认生效**（2026-09-21 实测第二轮）：✅ **AI 制片分镜已不再出现 `bgimage`**（`VF_AIONLY_V1` 生效）；① `STD_QUERY_V1`：**查询/进度类消息不再触发块外兜底**（用户那句查询里带着 `MAKE_VIDEO_TASK` 整段文案含"成片"→ 被误当"要做视频"→ 回了一张素材来源卡）；② `VF_AIDUR_V1`：**AI 制片补"按目标字数"的护栏**（选 10 秒却写了 83 字 ≈18 秒 → 成片 25 秒；现在超 1.15× 压缩、超 1.35× 句末硬截到 1.1×）
- ⚠️ **待用户实测**：连做两条（应免"点两次"、时长按本次所选）；**素材线点「确认」应正常入队**（不再回"AI 制片已在后台生成中"）；**素材线「成片设置」卡里应只剩「素材合成 / 我上传素材」两个来源按钮**；**AI 制片点「下一步」应直接出分镜确认卡**（不再出现 `VF_JSON:` 原文）；**说「AI 制片帮我做一条视频」应直接出主题卡**（不再回"请在上面选好…"）；出片日志应见 `[H3] ✅ 第 N 镜 OK 中转`（不再 403）

### 2026-09-20 成片 D 批：克隆音色闭环 + 词级字幕（✅ 代码完成，待部署实测）

- **D3 克隆音色**：原来只存客户端 `localStorage.dh_voice_id`，成片（跑在服务器）读不到 → 补闭环：数字人页克隆后 `PUT /api/agent/prefs {voiceClone}` → 存 `AgentMemory`(tag `voice_clone`) → 成片表单音色列表末尾出现「🎙 我的克隆音色」
- **顺手修**：表单音色原来写死 3 个，其中 `longyuan/龙嫗` **不在百炼官方列表** → 改为官方 7 个（longxiaochun/longxiaoxia/cherry/longshu/longchen/longjing/longxiaohui）
- **D4 词级字幕**：新增 `build_ass()` 生成 **ASS karaoke 逐字高亮**；**不依赖 funasr**（服务器未必装，客户端才有），改用「每镜 `subtitle` + 该镜真实配音时长」按字数均分生成 `\k`；`burn_subtitles` 支持 `.ass`（不覆盖自带样式）；**生成失败自动回落 SRT**
- **D2 BGM** ✅：表单「🎵 自动配乐 / 🔇 不要 BGM」→ 查 `MediaAsset(public/audio/music)` 取最新一首下载 → `make.py --bgm` → `render.py` 用 `-stream_loop -1` 循环 + 音量 0.12 + `amix normalize=0`（**必须关归一化**，否则人声被压低）
- **C3 配音卡点** ✅：`_reveal_seq()` 把画面大字拆成前缀序列、逐字浮现（镜头时长=配音时长 → 天然卡点）
- **C4 主色底板** ✅：`_avg_rgb()`（ffmpeg 缩 1x1 读原始 RGB，**绕开没装 PIL**）+ `_blend_dark()` 把素材平均色混进底板色 → 纯色卡跟素材色相统一
- **字幕字号自适应**：`--sub-size` 原默认写死 26（1920×1080 下仅屏高 2.4%，偏小）→ 未指定时按 `max(26, int(H*0.042))`（≈4.2%）；显式传值优先
- **文档**：本批问题已整理进 `ISSUES.md`（9 个实测 + 3 个自查，含代码级根因）；服务器部署前提三条核实**已解除**
- **一致性补丁**：`card_image` / `card_video` 也改为**不裁切**（原来只有 `bgimage` 改了）；`tts.py` 取词兜底**对齐** `render.py` 的 `_shot_text`（避免 compare/chart/cta 卡"字幕有配音无"）
- ⚠️ **如实标注（不当作已实现）**：C 批的"转场"实际是**每镜淡入淡出**（`fade=t=in/out` ≤0.2s，镜间轻微黑场），**不是 xfade 叠化** —— xfade 会缩短总时长导致音画失步（`voice.m4a` 按逐镜片段拼），须同步重算音频时间轴；本会话无法实测故不做，详见 `ISSUES.md` 遗留区
- **自检升级**：`render.py --selftest` 现会**自造测试图**并跑 `bgimage` 镜 → 覆盖模糊铺底/Ken Burns/逐字浮现/ASS 卡拉OK/底板取色（造图失败自动降级）；服务器上 `python3 render.py --selftest --workdir /tmp/vf --out /tmp/vf/selftest.mp4` 一条命令即可验证整条渲染链
- **⚠️ 待提交/验证清单已固化**：`docs/成片待提交与验证清单-20260920.md`（白名单 add + commit message + 部署 + 3 项验证含 `--selftest` 逐行期望输出 + 已知折中 5 条）—— 因本会话 shell 故障，我无法推送也无法跑运行时验证，此清单让**用户可独立走完**
- **✅ 首次运行时验证通过（2026-09-20，提交 `607d69b` 已部署）**：服务器 `render.py --selftest` 全绿 —— 底板取色 `0x112940`、字体命中、`bgimage` 新滤镜链无报错、5 镜全 OK、`subs.ass (字号 30)` 卡拉OK+自适应生效；标记 grep 10/3。**仍未覆盖**：BGM 混音 / 真实成片链路(tts→make→入库) / 302 播放
- **2026-09-20 修「成片只有 BGM、没有人声」（真因＝百炼音色名喂给了火山）**：表单音色 `longxiaochun` 是**百炼 id**，透传 `--speaker` 后：百炼链 HTTP 400（项目内同 body 的 `ai-providers.ts:1811` 也不通）→ 火山兜底**不认识这个音色名** → 每镜失败 → 无声片 + dur 停在 AI 值（**64 秒**）。修：`★VF_VOICE_MAP_V1` 百炼→火山音色映射 + `★VF_TTSERR_V1` 打印百炼响应体 + 失败即停重试 + `make.py` 失败打首尾行
- **2026-09-20 修「AI 自造卡 type」+「示例教 AI 写短 subtitle」（门禁首次实战）**：`[分镜门禁] 26 镜 / 覆盖 34%` 证明**门禁按设计拦住** ✅，但暴露真 bug：`[分镜构成]` 出现 **`subtitle` 自造 type** → `render.py` 不认（丢画面）+ 覆盖率统计漏掉其文案（34% 虚低）。且**我的示例要求 20~60 字、示例值却只 7 字** → AI 照写 11 字/镜。修：prompt 加 type 红线 + 示例 subtitle 改 28~33 字真实句子 + **`★VF_TYPEFIX_V1`** 未知 type 归一化
- **2026-09-20 修「只念 30% / 110 秒」（用户定案：严格 180 秒）**：实测 17 镜 × 6.5 秒 = 110 秒、1370 字文案只念了约 30%（`subs.ass` 17 条 Dialogue 实证）。根子=**不自洽**：表单承诺 `180 秒 ≈ 810 字 ≈ 36 镜`，AI 却写 1370 字、只排 17 镜。修：① **`★VF_LENFIX_V1`** 超额压缩（>1.15 倍让 AI 压到 `dur×4.5`；>1.35 倍句末硬截）② 分镜 prompt **必须 N 镜 + 覆盖全文** ③ **`★VF_COVER_V1`** 覆盖率 <80% **不给确认出片** ④ 「重试」把"上次只覆盖 X%"回喂 AI ⑤ `vfShotN` 上限统一 40
- **2026-09-20 修三处实测问题 + 加门禁（待部署验证）**：分镜 0 镜的**真凶**=prompt 示例 `"pick":图号` 被 AI 照抄 → JSON 非法 → 0 镜 → `--script` 规则切句 → **成片无素材画面**。修：示例改 `"pick":1` + 正则容错 + **解析失败自动重试一次**（回喂"只修 JSON"）；新增 **`★VF_GATE_V1` 门禁**（分镜 <2 镜**不给「确认出片」**，改「🔄 重试分镜」/「▶️ 先出字幕版」）；**`★VF_TOPIC_V1`** 协议串不当主题；script 卡去掉重复音色
- ⏳ **仅剩（用户已点名"现在都不做"，已归档）**：**真叠化转场** / **词级字幕（真字级时间戳）** / **克隆音色** / **🎨 全部 AI 生成** / **✨ 素材+AI 混合** / **D1 客户端播本地**（要改 `electron/` → 需重打包发版）→ 详见 `docs/能力开关与未来升级方向-20260920.md` 与 `ISSUES.md`「🔭 未来升级方向」
- ✅ **能力开关规划已完成（2026-09-20）**：11 个开关命名（`cap_<域>_<动作>`，9 条命令 + 2 个"画面来源"子开关）+ 树形结构 + 落地两步 → `docs/能力开关与未来升级方向-20260920.md`
- 📌 其余 A/B/C/D 全部代码完成，**等部署统一实测**（自检已全绿：**9 种卡型**（含 aivideo）+ **4 个 TTS 引擎**全通）
- 📖 **成片当前状态的唯一入口**：`docs/成片功能现状总表-20260920.md`（A/B/C/D 逐项状态 + 7 卡型 + 3 主题 + 4 TTS 引擎 + **12 条护栏机制** + **★日志速查表** + 自检命令）
- 🧪 **一键自检**：`bash scripts/video-factory/selfcheck.sh`（4 段 17 项：Python 语法 / 渲染 8 卡型 / TTS 四引擎 / 关键改动在位）—— 部署后跑这一条就能确认整体没退化
- 📊 **成片诊断**：`bash scripts/video-factory/last-video-report.sh`（打完最后一条成片的全部信息：起草/渲染日志、成片时长分辨率音轨、`cost` 扣点、分镜明细）
- 🎬 **「AI 直接成片」接入方案**：`docs/AI直接成片-接入方案-20260920.md`（用户指定**优先 MiniMax H3**；结论=**底座已存在**（`src/lib/minimax-h3.ts` 完整可用），只需新增第 3 种镜头源 `aivideo`；三种画面来源成本：**素材合成 6 点 / 素材+AI 混合 / 全部 AI 生成 ≈1500~2400 点**）
- ✅ **「全部 AI 生成」已接通（2026-09-20）**：表单「🎨 全部 AI 生成」→ 后端 `source='ai'` → `make.py --source ai` 在**配音之后**逐镜调 **MiniMax H3** → `render.py` 的 `aivideo` 卡型。**AI 模式仍读素材**（用户定案："看了素材让它自己决定"），**起草阶段与素材合成完全相同**，只在末处分叉。**计费按秒**（768P=50 点/秒），**报价与实扣同源**；单镜失败回退素材图、全失败回退素材合成。详见 `docs/成片功能现状总表-20260920.md` 第七节
- ✅★ **【AI 制片】独立线（2026-09-21，用户定案）**：`src/lib/agent/vf/vf-aivideo.ts` —— 把 AI 成片**从素材合成那条线里彻底分出来**，两条线各写各的（用户原话：「**把现在的视频状态机先不动，抽你需要的做 AI 制片**」「**不要设计公用层**……最怕设计了共用，不如不拆，出问题都不能用」）。
  - **该文件【零 import】**：`prisma` / `executeToolCall` / `genVideoShots` / `generateText` / `vfScriptCard` / 素材三函数 / `splitScript` / `parseForm` / `voiceList` **全部由 `route.ts` 通过 `ctx` 注入** → **它不可能连累其它代码**
  - **自己的草稿**：内存 Map + DB tag `vf_draft_ai`（**与素材合成的 `vf_draft` 分开，绝不串线**）
  - **内部绝不 throw**（异常转成人话返回 + 写日志）
  - **`route.ts` 只加一处分派**（约 25 行，在成片入口之前）；成片块条件改为 `if (!vfAiHandled && …)` —— **没接管时 `vfAiHandled` 恒为 false，素材合成行为一字未变**
  - **出片时显式传 `source:'ai'` + `duration`** → `make_ai_video` **不再需要读草稿去猜**（这正是 2026-09-21 那次事故的根因）
  - 方案与边界见 `docs/三套状态机拆分方案-20260921.md`
  - **⚠️ 前端未动**（用户"不用牵涉太广"）：起稿卡带 `aiLine:true`，供日后前端隐藏/置灰无关控件
  - **⚠️ `vf-material.ts`（素材合成抽文件）暂不做** —— 用户明确"先不动现有的"
- ✅★ **【三条线】（2026-09-21 用户定案：三个不同状态机）** —— 用户原话：「**3个不同的 素材智能成片，AI制片，素材+AI创作 可以吗 三个不同状态机**」「**不要设计公用层**……最怕你们设计了共用，不如不拆，出问题都不能用」
  | # | 线名 | 代码 | 草稿 tag | 日志 | 入口 |
  |---|---|---|---|---|---|
  | 1 | **素材智能成片** | `route.ts`（**原样未动**） | `vf_draft` | `[VF]` | 「用本地成片帮我做一条视频」 |
  | 2 | **AI 制片** | `src/lib/agent/vf/vf-aivideo.ts`（**零 import**） | `vf_draft_ai` | `[VF-A]` | 「AI 制片」「AI 成片」「用 AI 帮我做一条视频」 |
  | 3 | **素材+AI 创作** | `src/lib/agent/vf/vf-mix.ts`（**零 import**） | `vf_draft_mix` | `[VF-X]` | 「素材+AI创作」「混合创作」 |
  - **`route.ts` 三处分派**（顺序即优先级）+ **`!vfMixHandled && !vfAiHandled` 保护**（没接管时两个标记恒 `false`，**素材智能成片行为一字未变**）
  - **混合线规则 B**：AI 排分镜时自己标注每镜 `need_ai`（多用素材、少用 AI）→ 出片传 `make.py --source ai --mix 1,5` → **只对那几镜调 H3**；**安全阀**（超一半则收敛为 2~4 镜）；**计费三处同口径**（AI 镜实际 dur 之和 × 50 + 素材部分字数 ÷ 20）
  - **三条隔离铁律**：**零 import（依赖 ctx 注入）· 草稿 tag 分开 · 内部绝不 throw**
  - 详见 `docs/成片功能现状总表-20260920.md` 第七之二节

### 2026-09-19 成片状态机打通 + 两个真因修复（✅ 代码完成，待部署实测）

- **状态机全线跑通**：素材来源卡 → 看仓库 10 张图（视觉理解）→ 排 5 镜 → 文案卡 → 确认入队 ✅
- **真因①（我造成的）**：`prompts.ts` 红线里的**反引号**落在模板字符串内 → 提前闭合 → build 失败 → `deploy-server.sh` 因 `set -e` 退出 → **pm2 没重启** → 连续几轮"改了没反应 / AI 自由发挥"（**不是代码逻辑问题，是压根没上线**）
- **真因②（我造成的）**：pm2 跑 `.next/standalone/server.js`，`process.cwd()` ≠ 项目根 → 写死 cwd 导致 `TOOL_REJECT:未找到本地成片脚本`。**修**：`vfRootDir()` / `vfStorageRoot()`（VF_ROOT→cwd→上级→/root/AiMarketing），`make_ai_video` / `query_make_video` / `make-video-status` / `materialDir` 四处统一
- **附带**：画面来源三选卡（素材合成 / 素材+AI 混合 / 全部 AI，后两个诚实回"开发中"）；提示词加 **VF_JSON 红线**（实测 AI 会模仿 VF_JSON 装成状态机）
- **服务器环境已确认全绿**：脚本 ✅ / ffmpeg ✅ / python3 ✅ / NotoSansCJK+文泉驿 ✅ / **无第三方依赖（纯标准库，不用装 pillow/numpy）**
- ⏳ **待做**：部署实测 → 之后做「**客户端优先（打包带 ffmpeg + 主进程渲染链路）→ 服务器兜底**」双路成片

### 2026-09-19 成片状态机 v2：一键出发（✅ 代码完成，待 push/部署实测）

- **用户点「帮我做一个视频」→ 不再要求补主题**：第 0 步出**素材来源卡**（`🎞 用我的素材库` / `📤 我上传`），点一下就开工（= 一键出发）
- **新增素材层** `src/lib/agent/video-material.ts`：列个人仓库 → 下载到服务器本地 → `describeImageWithVL` 看懂图片（默认 10 张 / 可调 20，约 0.2 点/张）
- **AI 出场点①②合并**：一次调用同时出「口播文案 + 分镜 JSON」；**AI 只给 `pick`(图号)，本地路径由代码替换**（防编路径）
- **画面用真实素材**：确认后带 `plan`（`bgimage` 指向仓库图片的本地副本）调 `make_ai_video`
- **素材来源规则**：服务器只读 **OSS 个人仓库**（本地仓库在用户电脑上，读不到）；视频素材暂只列名不抽帧（抽帧能力发布流已有）
- ⏳ **待做**：push/部署实测；之后接 **AI 生成画面 / 混合**（缺素材的镜头用 H3 补）、卡片/主题扩充、程序化逐帧、词级字幕、首镜硬节点、衔接校验

### 2026-09-18 成片状态机骨架（★VF_FLOW_V1，✅ 骨架完成，待 push/部署实测）

- **触发**：用户说「用本地成片帮我做一条视频」→ AI 跑去 `search_storage` 列仓库文件、**什么都没生成** ✅ 印证"没状态机 AI 就乱走"
- **做法**（照发布状态机 + 设计文档 3.1~3.4 + 三·补）：独立草稿 `VIDEO_DRAFT`（与 `PUBLISH_DRAFT` 隔离）/ 独立意图 `vfIntent`（排除发布词，不抢发布的活）/ 新卡片前缀 **`VF_JSON`**（文案 + 音色 + 点数 + 确认出片）/ 确认后**直接调 `make_ai_video`**（不经 AI 判断）
- **AI 出场点**：目前只启用 ①"起稿润色文案"；②"排分镜"待接线（守住"AI 只在 2 处"）
- **已复用**：`make.py`（tts+render）→ `make-video-status` → 前端 6s 轮询
- ⏳ **待接线（顺序）**：6.5 画面来源（我的素材/AI 生成/混合，默认混合）→ **素材链路**（个人仓库/OSS → 服务器本地 → `plan.src`）→ 分镜编排（AI 第②处）→ **卡片/主题一次补全**（30~50 卡 / 10~15 主题）→ 程序化逐帧旁路 → 首镜硬节点 + 只重渲变更段 → 反 AI 味 preflight + 衔接校验 → 词级字幕（FunASR 字级时间戳 → ASS `\k` karaoke）

### 2026-09-18 H3 视频通道接入中转站（★H3_RELAY_V1，✅ 代码完成，待配置 + 验证）

- **背景**：用户提供朋友机房自建中转站 `https://h3.submodel.ai`（与官方 MiniMax H3 API 同构）；要求**中转优先、后台可配、只改 AGENT 做视频这一路**。
- ✅ **实测确认**：`POST /v2/video_generation` 提交成功（拿到 `task_id`）；`GET /v2/query/video_generation/{id}` 查不存在的任务返回 `TASK_NOT_FOUND`（= key 通过鉴权，**且不消耗额度**，可作轻量验 key 手法）；**顶层 `use_context_ir` 被接受**；turbo = 把 model 改成 `MiniMax-H3-Turbo`。
- ✅ **通道逻辑**（`minimax-h3.ts`）：中转（配了 `H3_BASE_URL`+`H3_API_KEY` 时）→ 官方 `api.minimaxi.com` → 两端都不通再**降级百炼 wan2.7-t2v**（`ai-providers.ts`）。任务 `failed`（内容/prompt 问题）**不降级**，避免白跑。
- ✅ **后台可配**：Settings →「AI 密钥」新增「🎬 H3 视频通道（中转优先）」：中转地址 / 中转 Key / 模型（`MiniMax-H3-Turbo` 或 `MiniMax-H3`）/ `use_context_ir` 开关。
- ✅ **测试按钮**：`test-key` 新增 `h3` 分支（查不存在任务 → **不花钱**验 key）；顺带修掉原先 minimax 测试打**国际站**、而实际功能走**国内站**的不一致。
- ⏳ **待做**：① 后台填入中转地址 + Key ② 跑一次真生成验证 ③ `tsc` 校验（shell 故障，尚未跑）

### 2026-09-18 本地成片（video-factory）Linux 服务器适配（✅ 代码完成，待 push/部署）

- **背景**：`make_ai_video` 在 `chat/route.ts` 里 spawn `scripts/video-factory/make.py` → 跑在 **API 所在机器**；用户确认成片跑在**服务器（Linux /root/AiMarketing）**，而原实现是照 Windows 本机写的。
- ✅ **① 火山凭据**（tts.py）：硬编码 `D:\AiMarketing\.env.local` → 改「进程环境变量 → `VF_ENV_FILE` → 从脚本位置逐级向上找 `.env.local` → cwd」；缺凭据时明确警告（不再静默出无声片）。
- ✅ **② 中文字体**（render.py）：`FONT_CANDS` 补 Noto CJK / 文泉驿 / DejaVu + CJK 回退顺序 + 缓存；字幕 `FontName` 由写死的 `Microsoft YaHei` 改为 `sub_font_name()` 按平台选。
- ✅ **③ python 命令名**：make.py 子进程改 `sys.executable`；route.ts `BU_PYTHON || 'python'` → 非 Windows 默认 `python3`。
- ✅ **④ 成片交付**：完成后 `saveToPersonalRepo()` 转 OSS 入个人仓库 + 写 `repoName`/`url`（24h 签名直链）；`make-video-status` 透出，前端完成消息与 `query_make_video` 都给下载链接。
- ✅ **⑤ 配音引擎改百炼**（tts.py，★VF_DASHSCOPE_V1）：用户明确「TTS 以百炼为主」→ `tts_one` 改为【百炼 CosyVoice 主用 → 火山兜底 → 都没有则明确警告】，协议与 `ai-providers.ts` 的 `dashscopeTTS` 一致；`--speaker` 默认改空（按引擎取默认音色：百炼 `longxiaochun` / 火山 `zh_female_vv_uranus_bigtts`）。
- ⏳ **待做**：① `git push`（否则服务器上没有 `scripts/video-factory`）② 服务器 `apt-get install -y fonts-noto-cjk` ③ 部署后实测一次成片（含配音 + 中文画面）
- ⚠️ 本次改动**未经编译验证**（本机 shell 环境故障，py_compile / tsc / 打包 / git push 均无法执行）——详见 ISSUES.md「服务器侧部署前提」。

### 2026-09-17 AGENT 发布链路 5 项修复（✅ 代码+实测完成，待打包分发）
- **背景**：用户逐条实测发现"登录态老丢 / 抖音卡封面 / B站跳首页 / 快手抓不到"，本轮全部定位到根因并修复。
- ✅ **① 登录态"丢失"**：`bu:check` 失败时谎报 `{success:true, accounts:[]}` + 前端 `else` 用空数组覆盖 → 全清显示未登录。修：不谎报 success / 无输出回退读 `bu_login_cache.txt` / 前端空数组不覆盖。
- ✅ **② 抖音封面卡死（#48 根因）**：封面"上传后死等 3500ms 就点完成"→ 此时图仍"生成中"，点击无效 → 抖音弹第二窗口「已基于横封面为你生成竖封面」（无「完成」无可用「发布」）→ 卡死。修：轮询等「完成」可点击（≤20s）+ 点后校验弹窗真关闭 + 兜底关提示层。
- ✅ **③ 6 平台登录失效明确报**：抖音/小红书/微博原来无检测，快手 `logged_in()` 太宽松。全部统一为明确报"未登录"。
- ✅ **④ 选页保护**：B站 goto 后复验（防登录失效被重定向到首页）；视频号锁死 `post/create`（原来抓任意 channels 页即用）。
- ✅ **⑤ 视频号登录态保活**：微信 sessionid 每天换值、久不访问即作废。新增 `scripts/keep-login-alive.mjs` + Windows 计划任务 `AiMarketing-KeepLogin`（每天 11:30，独立端口 9223、窗口移屏外、单例检测、taskkill 兜底）。
- 📌 实测：抖音 `--no-publish` 2 次通过（封面已就绪 0.5s + 弹窗已关闭，无第二窗口）；快手 `--no-publish` 通过；保活脚本 dry-run + 真跑通过；6 脚本 py_compile + main.js `node --check` 全通过。
- ⏳ **待做**：① 部署服务器（`src/app/agent/page.tsx` 改动）② 打包 1.0.203 分发 ③ 端到端验证（客户端里真发一次）
- ⚠️ **未做（待用户定）**：保活范围目前只跑视频号（可用 `--platforms` 扩展）；客户端安装时自动注册计划任务的逻辑尚未加入（当前是手动注册）

### 2026-09-10 AGENT 发布确定性脚本（✅ 抖音/小红书已通——待端到端验证）
- **方向变更**：AGENT 发布从 browser_use（AI 逐步决策，慢且不稳）改为**确定性 Playwright 脚本**；browser_use 保留作**无脚本平台**兜底（不放弃）
- **三层接线（已提交）**：
  1. `chat route` 建任务时 task 存 JSON：`{kind:'publish', platform, videoName, title, topics, cover, task(人话)}`
  2. `electron/main.js checkBrowserTasks` 解析 JSON → 抖音/小红书 spawn `bu_pub_douyin.py` / `bu_pub_xhs.py`；其他平台 → `bu_exec.py`
  3. 脚本随包下发：**必须改 `scripts/build-local.mjs` 的 extraResources**（它自己生成 build.local.json——改 package.json 无效）
- **抖音封面**：点 `[class*="coverControl"]` 层才开弹窗（cover-tip 文本层无效）→ 按封面图尺寸选入口（竖图→竖封面3:4）→ 弹窗内 `.semi-upload-drag-area:not(.semi-upload-drag-area-custom)`（排除 AI 参考图区）→ `button:has-text("完成")`
- **小红书封面**：读 PK 开关状态（`.pk-title-switch .d-switch-simulator` 含 `checked`）→ 未开才点 → 轮询等＋号（`.pk-cover-list-add-btn`）→ 系统文件框 → setFiles（PK 模式上传即生效）
- **话题联想浮层**：末尾再打一个 `#` 即消失（实测）
- ✅ 两平台 `--no-publish` 全流程实测通过；**1.0.129 已打包**（包内脚本已校验）
- ⏳ 待做：①服务器部署（chat route 改了）②装 1.0.129 端到端验证（AGENT 里发抖音/小红书）③套快手/视频号/微博/B站 ④browser_use 兜底路径回归
- 📌 方法论已存长期记忆：`aimarketing-publish-script-method`


### 2026-08-18 客户端常驻自动发布（✅ 已实现——需重打包分发）
- **目标**：Electron 启动后自动拉起指纹浏览器 + 后台轮询 agentPublishTask（pending→自动执行），**用户不开页面也能自动发布**（登录态一直在本地，比爬虫直发安全）
- **方案**：electron/main.js 定时拉 /api/agent/publish-tasks?status=pending → 匹配账号 fp:start（若未启动）→ fp:execute → 回写 done；页面打开时与页面轮询互斥（同一任务不双发）
- **替代否决**：服务器 Playwright 直发（IP/设备指纹不一致→封号风险）——不采用
- **连带**：真实中间状态回传（executing+阶段）→ AI 可报真实进度（可选二期）

### 2026-08-18 Agent 发布链路认知修正（🔴 高，测试暴露）
- **问题**：AI 不知"自动发布"真实链路（publish_content 建任务→客户端 3s 轮询自动执行→用户无需点发布），编造"唤起发布页/预填/你点发布"假流程 + 假任务 ID（pub_xhs_...非真实格式）
- **修**：①系统提示写清真实链路（任务建好=客户端自动发，用户只需打开指纹浏览器页）②AI 引用工具返回必须原文（#数字ID），禁编 ID/已执行 ③open_page 明确不支持 my-fingerprint 带参预填，AI 禁承诺
- **连带**：参考风格卡片（FLUX 3 模板推荐区）每次回复底部乱入——UI 待查

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

### 排期处理（2026-08-20 登记）
- 🔴 声纹球：朗读中点球不停 TTS（stopSession 不含 TTS——需加进点球逻辑/stopSession）——**暂不改，排期**
- 🟡 语音：ws watchdog 已放宽 8s（3.5s 误判重连丢上下文）；若仍"听不到"→ 检查服务器 voice-ws 重启加载最新代理 + 百炼响应
- 🟡 OpenCLI（github.com/jackwener/OpenCLI）接入评估：DOM 级浏览器操作 + 已登录 Chrome 复用——自动发布替代 fp-templates 坐标方案的候选——**排期评估**
- 🟡 favicon.ico 404：无害，后续放图标消除


### 发布"真执行"推演定稿（2026-08-20，暂不改代码）
**目标**：Agent 说"发布"→ 真正完成发布（不是假发布/不发布）。**核心结论：真发布取决于脚本结果验证闭环，不取决于浏览器方案**。
**事实（douyin-publish.js 实证）**：已有真发逻辑（找发布按钮→点→等8s→检测"发布成功/manage"），但有两个假成功漏洞：找不到发布按钮→`success:true,needConfirm`（没发报成功）；点后8s未确认→`success:true,needConfirm`（可能没发成报成功）。前端收到 success 就 reportAgentTask(succeeded)→任务假成功。
- **路径 A（采纳）**：Agent→任务→指纹浏览器执行 + **发布结果真验证闭环**——点发布后轮询 30-60s 验证页面进入"已发布/审核中"，确认才 succeeded；未确认一律 failed（可重试）；needConfirm/需人工确认场景回传 pending 提示（不 success）。隔离/自动/登录态用户维护/超时兜底均已具备。
- **路径 B（不采纳）**：Agent 对话实时驱动（跳任务层）——无审计/重试/状态回传，可靠性不增。
- **路径 C（不采纳）**：OpenCLI——核心平台无 publish 适配器（仅小红书有，6 平台 5 缺）。
- **P1 任务**：①6 平台脚本坐标→DOM 化 ②点发布后轮询验证真成功（douyin 已有雏形；xhs/kuaishou/shipinhao/bilibili/weibo 全核对补齐）③未确认一律 failed ④人工确认场景回传 pending。


### 发布"不触发"根因 + OpenCLI 结合设想（2026-08-20，暂不改代码）
**根因（实证）**：用户说"发布个抖音视频"→ AI 按规则"缺素材才问一句"→ 只回问"发哪个视频"→ 用户未继续→ 未建任务→ 客户端无 pending→ 不开指纹浏览器→ 不发布。**不是脚本/客户端问题（6 平台脚本手动验证过）**。
**改进方向（P2）**：发布规则升级——"发布 + 平台"缺视频时，先 `list_personal_files` 自动查个人仓库视频 → 有则列出让用户选 → 选中即建任务自动发；无视频才问"上传/生成"。
**OpenCLI 结合设想（减少脚本更新 + 增加平台）**：
- **设想 A（采纳）**：平台适配器注册表——每平台声明式适配器（发布页 URL/上传/标题/发布按钮/成功验证选择器）+ 统一引擎执行；加平台=加适配器，平台改版=改适配器，不重写流程脚本。
- **设想 C（采纳辅助）**：借用 OpenCLI 工具链（opencli-adapter-author recon/verify）辅助生成/维护适配器；运行时仍用指纹浏览器（隔离保留），OpenCLI 仅是"写适配器的工具"非运行依赖。
- **设想 B（不采纳）**：运行时接入 OpenCLI 本体（核心平台缺 publish 适配器 + 共享 Chrome 失隔离）。


### 发布"错平台/不执行"根因确认（2026-08-20，暂不改代码）
**用户要求**："不要点账号、要点启动、不用检查账号"——Agent 任务执行时**直接按任务平台启动对应浏览器执行**，不受 selectedAccount 影响。
**现状（代码实证）**：执行链路（executeBatch/publishNow）多处直接读 `selectedAccount.platform`（670/684/704/762/802 行），802 行 `!selectedAccount` 直接 return。selectedAccount 被"用户手动启动过的账号"占用后，Agent 任务（如抖音）会：①平台校验不匹配→failed 不发布；或②用错平台浏览器执行。**这就是"找第一个（视频号）启动/发抖音却点视频号"的根因。**
**改进方向（P2）**：Agent 任务执行去 selectedAccount 化——按任务 platform 直接启动对应浏览器（dummyAcct 平台即任务平台，handleStart 已按平台启动）→ executeBatch 用"本次启动的账号"而非全局 selectedAccount；手动路径保留 selectedAccount（用户自己选）。


### 客户端更新发布流程（2026-08-21 定稿，防遗忘）
**改版本必须同步 3 处**（否则下载页/更新链错乱）：
1. `package.json` version
2. `electron/version.json`：**version + downloadUrl 都要改**（downloadUrl 曾漏改卡在旧版）
3. `electron/changelog.json`：顶部加新条目（title 写描述，非版本号）

**发布步骤**：
1. `node scripts/build-local.mjs`（~15 分钟，产出 dist-rel/AI-Marketing-Setup-{ver}.exe + latest.yml + blockmap）
2. 上传三件套到服务器 `public/updates/`
3. 服务器：`cp public/updates/* .next/standalone/public/updates/ && pm2 restart aimarketing`
4. 验证：`curl https://ai-niuma.cc/api/client-info`（version + downloadUrl 必须是最新）+ `curl -o /dev/null -w "%{http_code}" https://ai-niuma.cc/updates/latest.yml`（200）
5. 客户端（旧版）打开 → 弹更新窗（v1.0.40+ 功能：独立小窗显示下载进度，12s 自动重启安装）

**踩坑记录**：
- downloadUrl 曾漏改（只改 version）→ 下载页版本对但下载地址旧
- changelog 不加条目 → 下载页不显示新版本
- latest.yml 不更新 → 旧客户端检测不到更新（不弹窗）
- public/updates 已排除 git（485d141），git 部署不会覆盖上传文件


### 浏览器通道（方案 A CDP）排期定稿（2026-08-21）
**定位**：用户日常浏览器通道（个人号发布/采集/热点/网页转MD/登录态检测），与指纹通道（矩阵号）分开。
- **P0**：CDP 执行器——客户端绑定浏览器（拉起 Chrome/Edge --remote-debugging-port，127.0.0.1+token 鉴权）→ 检测已登录平台 → 个人号发布（抖音/小红书/微博，移植 OpenCLI 开源适配器选择器，自研 CDP 执行）
- **P1**：`opencli_run` 工具接 AGENT（采集/热点/网页/账户，白名单命令）+ **未登录提示**（工具返回 needLogin(platform) → AI 自出 URL + SCENE open_login 打开登录页 + "继续"重试——不搞映射表，AI 自己知道平台地址）
- **P2**：browser-accounts 独立页（登录态显示绿/红点 + 每日 12 点刷新，仿 OpenCLI）——与 /accounts（服务器账号登记）完全分开
- **P3**：双通道分流细化（账号类型 → 个人号走浏览器 A / 矩阵号走指纹 B）
- **登录提示模式**：opencli_run 返回 needLogin(platform) → AI 回复"未登录，已打开登录页→扫码登录一次→说继续自动重试"；客户端 shell.openExternal 打开 AI 给的 URL

**P0-2 关键发现（2026-08-21）**：OpenCLI douyin publish 是**官方 API 直调**（TOS 上传 + create_v2 发布，`browserFetch`=page.evaluate 浏览器内 fetch 带 cookie+a_bogus 自动）——**不是 DOM 点按钮**。我们的 CDP page 完全兼容 browserFetch → **发布可复用 OpenCLI 全套 API 流程（clis/douyin/_shared/*），无扩展依赖**。路径：CDP connectOverCDP → 打开发布页（page）→ 移植 publish.js 8 阶段（getUploadAuthV5Credentials/tosUpload/create_v2）。比 DOM 操作稳。


### 打包前必查清单（2026-08-22 定稿，防遗漏）
1. **rebuildShortcuts 在 main.js**（自动更新后重建桌面+开始菜单快捷方式——曾被后续改动删丢）
2. **版本三处同步**：package.json / version.json（version **+ downloadUrl**）/ changelog.json
3. **build-local.mjs asarUnpack** 含 `@jackwener/opencli/**`（ESM import 需解包）
4. **新常量定义完整**（FEATURE_TIPS 等——构建前 grep"定义+使用"都在；createSourceFile 不查引用）
5. 本地 `npx tsc --noEmit` 或 `npm run build` 验证（createSourceFile 不查 const 重赋值/未定义引用——服务器 build 才暴露）
6. 服务器部署需 **npm install**（新依赖 lunar-javascript 等）
7. 打包前核对 PROJECT.md 本清单 + 更新计划
8. **【数据安全铁律 · 2026-09-22】打包 / 更新 / 卸载一律不得删用户数据**：`data/`（**多账号**登录态 + `accounts.json` + 指纹 profile）/ `storage/`（用户本地仓库）/ `python/`（内置环境）都要保。
   - `scripts/build-local.mjs` 清 `dist-rel/win-unpacked` 时要**跳过这三个目录**（用户可能正从该目录运行客户端）；
   - `electron/installer.nsh` 更新分支与卸载分支都要**保留**这三目录（曾出过 `RMDir /r $INSTDIR` 全删事故）；里面的 `for /d + if 比较路径` 写法较脆（`%i` 与 `$INSTDIR/data` 字符串比较），改动时优先换成"白名单删除"而不是"黑名单保留"；
   - 详见 `AGENTS.md` 硬规则 7。

### 更新计划（待办，2026-08-22）
- **换号按账号加载（非清理）**：user 切换 → historyLoaded 重置 + 按 userId 加载该账号会话（换回恢复）——**不是清空丢弃**，防跨账号串记忆（"探店v2.mp4"事件）
- 第二段操作引导（首登设置登记完成后：一键成片/文生图/文生视频/素材库逐个演示）
- 画像统一（行业/昵称存 AgentMemory agent_profile + User.agentName）
- 已登录账号折叠区自动刷新（CDP）
- 30 天自动清理旧会话 ✅ 已做

### 关键决策记录（防遗忘）
- **AGENT 发布只走浏览器通道（CDP）**：抖音/小红书/微博自动；快手/视频号/B站推指纹页手动；指纹发布纯用户手动（AGENT 不碰，像一键成片只呼出）
- **首登设置登记引导**：无画像自动开设置（①昵称闪烁+语音→保存→②行业输入框+语音→保存→完成；取消即停）
- opencli_run 只读类（采集/热点/搜索）；发布走 CDP 专用（browser:publish）
- 浏览器账号（发布通道）右侧折叠显示（CDP 检测，不显示指纹）


### 浏览器通道设计规划定稿（2026-08-23，防失忆）
**定位**：用户日常浏览器通道（个人号发布/采集热点/搜索/登录态检测），**独立备用系统**——原设计（自有热点 API + 指纹手动脚本）**全保留**，随时切换；**AGENT 页不参与浏览器采集**（AI 只用自有 API：/api/agent/hotspots + search_trends，避免两套系统 AI 混乱）。

**铁律（用户拍板）**：
- **运行时零 OpenCLI**：用户只装我们的客户端，**不装 OpenCLI、不装任何插件**；OpenCLI 仅作**源码参考**（本地 npm 包 176 clis，9 个发布适配器）——复制其适配器/API 流程自实现进客户端，防它不更新
- **浏览器**：Chrome / Edge（CDP 完整支持；国内用户预装 Edge 最友好）。客户端自动检测系统已装浏览器 → 一键启动（--remote-debugging-port）→ 用户**登录一次自己账号** → cookie 检测（**按平台域名独立存**：登录抖音只有 douyin.com 有 cookie，登录啥检测啥）
- **发布 9 平台**（移植 opencli publish.js 自实现 CDP）：抖音✅（API 流程完整）/ 微博🟡（DOM 版已有补全）/ 小红书（1423行最大）/ 视频号 / 闲鱼 / X(Twitter) / Instagram / 即刻 / band —— 用户都要试
- **采集（备用）**：B站（hot/ranking/search/feed/comment 全）/ 36kr / 1point3acres / 51job/BOSS / amazon / reddit / bluesky / bbc/bloomberg / 东方财富/雪球 / 12306（查票非抢票）等——**仅用户已登录平台可用，未登录不提供**
- **指纹发布手动脚本不动**（给用户手动支持，等更好替代再说）；**AGENT 不自动执行指纹发布**

**AGENT 防幻觉红线**：
- publish_content 工具：AI 创建任务后**必须等客户端执行结果回传**（成功/失败原因/未登录提示）才能回复；**未收到结果前禁止回复"已发布"**——只可"已创建发布任务，等待执行结果"
- 系统提示注入：禁止编造任务 ID / 发布成功 / 执行进度；browser-accounts 右侧边栏显示真实登录态（绿/红点，12 点刷新），不显示指纹

**动手顺序**：①微博补全 + 小红书移植（用户最常用）+ AGENT 防幻觉红线/工具注册 ②其余 7 平台逐个移植 ③browser-accounts 右侧边栏 ④登录态检测实测（cookie 映射验证）

**现状检查（2026-08-23 打包前）**：main.js 已删 opencli:run/publish/setup-guide IPC + preload 清理；setupAutoPublish 改 CDP 分流（getBrowserAccounts helper）；browser:accounts 11 平台（含未登录展示）+ browser:bind-mine 一键启动；CLIENT_OPENCLI 前端拦截已移除；@jackwener/opencli npm 包保留（抖音 vod/tos 上传 import 依赖，asarUnpack 打包，用户无感知）

### 2026-08-24 生成防丢 + 反馈闭环（✅ 已完成，待部署）
- **视频/图片生成防丢**：generate_video 生成即落库(text2video) + query_video_task 完成即转存 OSS(storage/{userId}/) + 自动入个人仓库 + 落记录——URL 不再一次性；客户端崩溃/断网不丢（可查 DB/OSS 找回）
- **丢失视频找回**：scripts/recover-video-task.mjs（taskId→百炼→下载→转存）；mbb 12秒视频已找回
- **#301 修复**：renderTaskCard 渲染期 setState 副作用→顶层 useEffect（视频自动播放 ref 防重复）
- **一键成片入仓库**：普通/智能成片完成后自动上传 storage/{userId}/（/storage 页可见）
- **生成中反馈**：loading 气泡类型化文案（生成图片/合成视频/写文案）+ 视频任务自动轮询（video-task-status API 10s 查进度自动提醒）
- **图片自动入库**：generate-image（页面+agent对话）成功即入 MediaAsset；自检加仓库条目（>80% 提示转移本地）
- **封面 3 选 1**：AI推荐帧✨ + 九宫格🧩 + AI生成封面🎨（多 SCENE_JSON 渲染）
- [x] 视频内容分析链路修复（2026-08-26）：帧传OSS→visualDesc真实、重新分析=回去看原视频、热榜只结合相关、上传不切帧
- **视觉理解前置**：抽帧后百炼 qwen-vl-max 看帧总结（AI 不再瞎编）；附件视频渲染卡片；frames API 兜底
- **待办**：①退点（失败任务标记+人工审核，防自动漏洞）②封面 AI 生成 i2i 后端 ③文档持续更新
- **思考链增强（2026-08-24 列入计划）**：思考流只显示工具步骤，看不出 AI 思考过程。方案 A（真思考过程，成本高）/ B（工具 `_reason` 字段，成本低）/ C（回复前思考摘要，成本低）——待选型实施

### 浏览器通道登记中心设计（2026-08-25 定稿，实施中）
**定位**：个人号浏览器通道的账号登记中心（与指纹浏览器/ADB/Q1 矩阵号登记**完全独立**，不混）

**登记原则**：任何平台都能登记（打开内置浏览器 → 平台清单卡片/自定义地址 → 用户自行登录）；登记状态=内置浏览器 profile cookie（本地持久，一次登录长期有效）

**入口（3 处，同一中心）**：
1. 🌐浏览器账号折叠区「＋打开浏览器登记」——平台清单（Google连带YT/抖音/小红书/微博/B站/视频号/X）+ 自定义地址
2. 引导⑥「发布通道准备」（首登，可跳过随时补）
3. AI 发布时未登记 → 自动打开登录页引导

**发布能力分级（AGENT 平台能力表 4c3）**：
- 自动发布支持：抖音/小红书/微博/视频号/X/即刻/闲鱼（浏览器通道真发）
- 可登记但暂不支持：B站/快手/其他（明确告知，可手动）
- 处理流程：先登记（任何平台）→ 支持就发 / 不支持如实（不瞎编）

**绑定关系**：登记了哪个平台 → 热点/采集优先用账号数据；未登记 → 免费 API 兜底（不登记也能看公开数据）

**技术**：bind-mine 优先内置 Chromium（独立 profile 必通 CDP 9333，不受系统 Chrome 影响）；browser:open-url IPC 跳登录页

---

## 🔮 未来更新计划（2026-09-12 定稿——自由模式增强 + 两条路线划分）

### ⚠️ 两条模式路线（定稿，勿混）

| 模式 | 定位 | 发布执行路线 |
|---|---|---|
| **标准模式** | 傻瓜式（选择填空） | **确定性脚本**（Playwright `scripts/agent-publish/bu_pub_*.py`）——快（全流程 2-8s）、稳、**0 LLM 花费** |
| **自由模式** | 会用的人（AI 自由发挥） | **AI 直接操浏览器**（browser_use / 未来"探针"能力）——慢、通用、**改版也能试** |

**铁律**：**自由模式的新方案不得打乱标准模式**——标准模式继续脚本路线。

### 自由模式增强：让 AI 真正"看得见"页面

**现状（2026-09-12 分析结论）**：
```
scripts/browser-use/bu_exec.py：
  L186  ChatOpenAI(model='qwen3.8-max')     ← 非视觉模型
  L220  use_vision=False                    ← 关掉"眼睛"
        use_thinking=False                  ← 关掉"思考"
→ AI 只拿到"一坨 DOM 元素文字列表"（无坐标 / 无遮挡信息 / 无层级 / 不知是否在视口外）
→ 这就是"点错元素、跳步、编造已完成"的根因（摸黑点）
```
**对比（人工/CDP 调试）**：可主动问"元素在哪、谁盖住它、可见吗"→ 一击命中（今天修小红书封面就是这么定位的）。

**三种方案（待定，均未实施）**：

1. **`run_browser_js` 工具（推荐）**
   - 连 CDP 9222 → 执行任意 JS → 返回结构化结果
   - 可问：元素位置、上层遮挡元素（`document.elementFromPoint`）、可见性、父子层级
   - **比截图更准**（遮挡/坐标/层级，截图看不出来）
2. **`use_vision=True` + `use_thinking=True` + 真视觉模型**
   - 需视觉模型（gemini / claude / qwen3-vl-max）——当前 `qwen3.8-max` **非视觉**
   - （用户已考虑充值 gemini 中转）
3. **混合：脚本为主 + 失败自动回退 AI**
   - 脚本某步失败（选择器失效/改版）→ 自动转 browser_use（或探针模式）兜底
   - 好处：平时快（脚本）+ 改版能兜住（AI）+ 减少人工补选择器

**前提条件已全部具备**（客户端已有）：CDP 9222 连接 ✅ / python+playwright ✅ / 只差"把执行 JS 暴露成工具" ✅

### 标准模式当前进度（2026-09-12）
- ✅ 抖音 / 小红书 / 微博 / 视频号 **4 平台脚本已通**
- ✅ 小红书 2026-09 改版适配完成（PK 开关类名 `.pk-cover-switch-trigger` + 隐藏 `input.pk-cover-list-file-input` 直传封面 + PK 满 3 张点 X 腾位）
- ⏳ 待办：快手 / B站 脚本 · 打包发版 · **登录态根治**（main.js 3 处启动 Chrome 收敛成 1 个函数——同一 profile 被两个进程抢写 Cookies）

---

## 🧩 标准/自由模式隔离进度（2026-09-12 更新——防压缩/接手人失忆）

### ✅ 已完成的隔离

| 层次 | 状态 | 位置 |
|---|---|---|
| **工具定义** | ✅ **已抽文件** | `src/lib/agent/tools.ts`（AGENT_TOOLS + TOOL_STEP_LABEL，354 行）|
| **系统提示** | ✅ **已抽文件** | `src/lib/agent/prompts.ts`（buildSystemPrompt，含 freeMode 分叉，290 行）|
| **发布任务** | ✅ 已抽文件 | `src/lib/agent/publish-task.ts`（createPublishTask / parsePublishTask）|
| **状态机** | ✅ **已加边界注释** | `chat/route.ts` **L1586 ~ L2235**（标准模式专属，648 行）|
| 前端任务进度带 | ✅ 条件渲染 | `page.tsx` L2951 `agentMode === 'standard'` |
| 前端快捷卡片 | ✅ 条件渲染 | `page.tsx` L2902 `agentMode === 'standard'` |
| 模型分流 | ✅ | freeMode → forceVL=true（整体切多模态 qwen3-max）|
| 状态机分流 | ✅ | `chat/route.ts` L1585 `if (!isFreeMode)`（唯一分叉点）|

**chat/route.ts 行数变化**：2990 → 2362（抽出 tools 350 行 + prompts 280 行）

### ★ freeMode 全部分叉点（改标准模式时对照此清单，避免波及自由模式）

| # | 位置 | 作用 |
|---|---|---|
| 1 | `prompts.ts` — buildSystemPrompt 开头 `if (freeMode)` | 返回自由模式极简 header（只讲意图理解 + 发布红线 + 诚实，无状态机步骤/WF_JSON）|
| 2 | `chat/route.ts` **L1585** `if (!isFreeMode) {` … **L2235** | 发布状态机整块（自由模式跳过）|
| 3 | `chat/route.ts` 模型调用（dashscopeFunctionCall 调用处）| freeMode 时 forceVL=true |
| 4 | `page.tsx` L2902（快捷卡片）/ L2951（任务进度带）| 仅标准模式渲染 |
| 5 | `page.tsx` L3041 | 标准/自由模式切换开关 |

### ⏳ 待做（第 2 步——文件级彻底隔离）

- 把状态机块（L1586-2235）物理搬进 `src/lib/agent/standard-flow.ts`
- 自由模式分支搬进 `src/lib/agent/free-flow.ts`
- **前置条件**：6 平台发布全部真发验证通过后再做（否则两条线同时动，风险叠加）
- 现状态记录于 ISSUES.md「标准/自由模式文件级隔离」条目（🟡）


### 2026-09-14 进度（AGENT 页专项 —— 详细接手见 [AGENT-HANDOFF.md](./AGENT-HANDOFF.md)）
- ✅ 账号绝对隔离（browser-profile / 本地仓库 按 userId 分 + 一次性自动迁移）— `1e996bb`（**客户机已验证**：userId=7、迁移 44 项）
- ✅ 热点上报 401 修复（bu_hot.py 只发 Cookie 头）— `80a33f0`
- ✅ 客户机环境可见性（自检不再静默，加载失败写日志）— `1be752e`
- ✅ 假 Python 识别（isRealPython 真执行校验）+ 内置环境安装每步日志 — `a90bdeb`
- ✅ 抖音封面删掉"判断横竖屏"（与引导弹窗同名按钮撞车致卡死）— `ad23732`
- ✅ **修我自己引入的 getter 回归**（path.join/fs 传对象 → TypeError → 发布中断）— `58b6cdb`
- ✅ 打包 **v1.0.160**（含以上全部客户端修复）— `521fba7`；⚠️ v1.0.159 含 getter bug，**不要发**
- ✅ **修"点平台按钮没反应"真因**：chat/route.ts 用 `PLATFORM_NAMES` 漏 import → ReferenceError → API 500 → 前端无任何显示；同时放宽为"点平台一律建任务" + 素材兜底 + 不再静默 — `513d831`
- ⏳ **待用户操作**：部署服务器（`bash scripts/deploy-server.sh`）—— 不部署则 `513d831` 不生效
- 🔴 待办：小红书脚本（PK/封面＋号 + "禁止笔记"格式）等**用户本地手动实测跑通**后再改；环境不可用的**前端提示+一键安装**未做；微博/视频号/B站/快手脚本未验证
