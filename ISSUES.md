## 🔧 tsc 类型错误待清（2026-09-06 盘点——核心 11 处已清，剩 72 处）

**已清（cb65872）**：chat route 6 处 + ai-providers 5 处（含 3 个真 bug：videoUrl 字段名错 / uploadToOSS 不存在 / timeoutMs 不生效）。

**剩余 72 处（按文件，待分批清）**：
- 🟡 agent/page.tsx 30（SceneCard.items/frames 类型、BlobPart、asrSessionAbort、JSX 重复属性等）
- 🟡 prompt-templates/page.tsx 7（null 判断）
- 🟡 media-library/page.tsx 5
- 🟡 live-stream-engine.ts 4（uploadOSS 不存在——同类 bug，数字人/直播上传）
- 🟡 my-fingerprint/page.tsx 4
- 🟡 ApiKeyPanel.tsx 4（setMinimaxKey/musicModel 缺）
- 🟡 login/route.ts 3
- 🟡 video-task-manager.ts 2
- 🟡 GlobeTrends.tsx 2 + prompt-library 2
- 🟡 其他零散 9（middleware/Navbar/digital-human/subscription×2/music/media-library-promote/content-draft/client-info/publish-stats/agent-tools/ settings）

**待办（功能桩/缺陷，另开轮清）**：
- 🔴 自动化引擎 engine.ts 四实现全是桩（mock/官方API/真机/指纹）——功能没落地
- 🟡 opencli_run 死桩（要装命令才能用——应隐藏/删）
- 🟡 digital_human_speak 参数错位
- 🟡 热点无国内源
- 🟡 一键成片 TTS/合成间歇失败（qwen3-tts + ffmpeg）
- 🟡 标准/自由模式文件级隔离（free-flow.ts / standard-flow.ts 物理抽取——已完成状态机块整体 if(!isFreeMode) 包裹 5c42abf，抽文件待测通后做）

### ✅ 已解决
- 🟡 **Browser Use「打不开浏览器」问题总结（2026-08-30——以后排查速查）**：
  分层排查（L1服务器→L2执行器→L3轮询fetch→L4 Python→L5浏览器）：
  1) L3 服务器 500：getAuthFromHeaders() 没传 req（agent-tools/browser-tasks 同坑）→ request undefined → headers in undefined → 修传 req（2c14b8b）
  2) L2 执行器没跑：checkBrowserTasks serverUrl 未定义（ReferenceError——0d7f2b3）；BU_SCRIPT 路径（extraResources→resources 非 asar.unpacked——c33c2cc）；bu_exec.py 没打包（1913b2d）
  3) L3 cookie 空：getServerCookie url 精确读不到 → 多域 fallback（3381cf7）
  4) 旧任务累积：pending 全捡→连续开浏览器——需「执行/跳过/全部清除」管理（会话框显示——不弹窗）
  5) 发布仍走 publish_content（opencli 旧链——抖音 -2 定时）——应改 browser_use（待办）
- 🟡 **工具箱扩展计划（2026-08-30 定案）**：
  - **A（先做）**：内置工具集（browser_use 已验证 / P图IOPaint / 爬虫 等——由开发接入——工具箱只管开关/角色）——**仅 admin 可用**（测试成熟后开放普通用户由 AGENT 调用）
  - **B（排期——后续）**：真插件化（admin 填 git URL/脚本 → 自动安装依赖 → 自动注册+执行端点——即④ git/MCP 工具）
  - 权限：新工具默认 roles=admin——成熟才改 all
- 🟡 **工具箱扩展排期（2026-08-30）**：④git/MCP 工具接入（拉仓库→装依赖→注册→执行端点）——需设计"插件安装器"（admin 填 git URL → 克隆到 scripts/tools/ → 依赖安装 → 注册 AgentTool + endpoint 分发）——排期（非本次）
- 🟡 **更新计划（2026-08-28）**：①P 图去水印接入（IOPaint——lama/去水印——CPU 可跑——封面/素材去"AI生成"水印）——已归档（2025-08）评估 fork/自维护；②小红书/微博发布 DOM 链路待实测（#13 失败）
- 🟡 **TTS 方向定案（2026-08-28）**：先修百炼（action 已修——测试）；**后期 TTS 全部预装客户端本地调用（不走服务器）**——候选 Kokoro-82M（Apache/82M/CPU/中文——首选）/ sherpa-onnx（轻但客户端曾崩——服务器版可）。服务器只留百炼为主，本地为兜底。- 🟡 **工具链承诺缩水清单（2026-08-28 全面核查 34 工具——按优先级排，数字人/热点放最后）**：
  - 🟡 **制作发布链（先满足）**：generate_image 无参考图/i2i（封面图生图做不到——A+C 方案待做）；publish_content fromSource（版权提示）参数建任务时忽略；发布任务 pending 需客户端 3s 轮询执行（getServerCookie 已修——待实测任务闭环）
  - 🟡 digital_human_speak 参数错位（parameters 定义 imageUrl/voiceType，case 只认 avatarId 未定义——数字人说话可能调不通）
  - 🟡 search_trends 无国内热榜源 + 服务器 DDG/Reddit 访问不通（curl 空）——热点承诺落空
  - 🟡 search_storage 只搜个人素材（description 称平台级——公共搜不到）
  - 🟡 opencli_run 死桩（前端拦截已移除——返回文本无人执行——应隐藏/删）
  - 🟡 automation_check 无 create 分支（description 承诺 action=list/create——只有查询）
  - 🟡 search_web 需 SERPER_API_KEY（服务器 .env.local 无——报"未配置"）
- 2026-08-14 API key 保存后丢失/未配置：根因 ① config 写 cwd/standalone 被 rm -rf 删（修：DOTENV_CONFIG_PATH 统一）② 16 段保存没排除 ******** 掩码覆盖（修）③ statusMap minimax 未初始化显示未配置（修）——服务器验证 MINIMAX 保存成功
- 2026-08-14 settings 一页堆叠全部配置难用（修：分页 Tab 密钥/媒体/引擎/系统）

## ✅ 已解决（2026-08-25）
- **"＋打开浏览器登记"弹启动超时**：系统 Chrome 在跑时 spawn 附加失败（同 profile 锁）——bind-mine 优先内置 Chromium（独立 profile 必通 CDP）
- **登记账号无反应**：绑定成功后需刷新检测——现在登记中心每行平台卡实时绿点
- **浏览器找不到（跨机器）**：写死 Program Files + 注册表 App Paths + 内置 Chromium 兜底（三层）
- **AI 发布话术不一致**：平台能力表 4c3 注入（先登记任何平台→支持就发/不支持如实）
## ✅ 已解决（2026-08-24）
- **#301 无限重渲染**（Application error，mbb 会话118 触发）：renderTaskCard 渲染期调 openVideoFromUrl(setState)→循环；已改顶层 useEffect + ref 防重复
- **视频生成不落库不转存**（taskId 只在消息文本，视频做完即丢）：generate_video 生成即落库 + query_video_task 完成即转存 storage/ + 入仓库
- **丢失视频找回**：recover-video-task.mjs（taskId→百炼→下载→转存 OSS）；mbb 12秒"数字员工宣传片"已找回入仓库
- **frames 封面破碎图 404**：standalone 静态目录不服务运行时文件；改写 standalone public + /api/frames 读盘 API 兜底
- **附件视频显示链接**：renderContent 渲染 📎 视频为 video 卡片
- **一键成片不自动入仓库**：完成后自动上传 storage/{userId}/
- **浏览器账号一键启动崩溃**：补 bindMyChrome/browserNeedBind/bindingMine 定义
- **二次打开显示昨天记录**：恢复历史检查 updatedAt 非今天不恢复
- **服务器回调 401 静默失败**（done/download-url）：主进程读 session cookie 带上
- **agent 生成图片不转存**：generate_image 转存 storage/ + 入仓库 + 落记录

## 🟡 已知（2026-08-24）
- 视频任务提交即扣费、百炼最终失败不退点——自动退有漏洞风险，暂人工审核退点（待做：失败标记+人工退）
- 一键成片旧成片（修复前）在 public/generated 不在仓库——新成片自动上传
- frames 运行时文件在 standalone public——重启保留，但部署 rm -rf .next 会清（重新抽帧即可）
- 封面"AI生成封面"按钮已加，i2i 后端待接（generateImage 无参考图参数）
# AiMarketing 问题清单（ISSUES）

> 已知问题 / Bug / 风险 / 隐患。与 PROJECT.md 分开维护。
> 最后更新：2026-08-10 ｜ 状态图例：🔴 高（需尽快处理）🟡 中 🟢 低 ✅ 已解决（保留存档）
> 维护规则：每次操作后更新状态；问题解决后移到「已解决」区并注明日期。

## 〇、新规划待办（2026-08-10 起）

- 🟢 二期 A 已完成（c08031f）：generate_video >15s 首尾帧接力 + 成本两段式确认 + 分镜协议 + 任务引擎，待部署；二期 B（分镜视图/一句话成片）+ 三期（BGM/发布）待执行——见 PROJECT.md 六
- 🟡 中转站选型调研（OpenRouter/fal/Replicate/infistar）——必须覆盖文生图/图生视频/克隆视频能力，按用户实际需求定，勿盲目指引

## 一、支付 / 计费（🟡）

| # | 问题 | 位置 | 状态 |
|---|---|---|---|
| 7 | 点卡 checkout 读 process.env.ALIPAY_*，套餐 checkout 读 systemConfig（payment-config.ts），配置来源不一致，后台改配置后点卡可能走旧配置 | src/app/api/point-cards/checkout/route.ts | 🟡 |
| 8 | checkTokens/spendTokens 非事务（先查后扣，分步写），极端并发可能超扣 | src/lib/token-wallet.ts | 🟡 |
| 9 | 免费周卡 durationMonths=1 与代码实际 7 天口径不一致（schema 注释 vs 实现） | src/app/api/subscription/claim-weekly/route.ts | 🟢 |
| 10 | 微信 Native 支付未建（缺商户号，qrCode 字段已预留） | — | 🟢 待商户号 |
| 11 | 订单过期自动关闭定时任务未实现（过期订单滞留 pending） | — | 🟢 |

## 二、死代码 / 未启用（🟢）

| # | 问题 | 位置 | 状态 |
|---|---|---|---|
| 12 | quota-checker.ts 的 checkQuota 无任何调用方（死代码）；getUserMonthlyStats 仅 my-usage 使用 | src/lib/quota-checker.ts | 🟢 |
| 13 | subscription-guard.ts 封装 hasActiveSubscription，未见调用方 | src/lib/subscription-guard.ts | 🟢 |
| 14 | automation/engine.ts 四个实现（mock/official-api/real-device/fingerprint-browser）全是桩，返回假成功 | src/lib/automation/*.ts | 🟢 已知桩 |
| 15 | preload 暴露 adbBridge/adbBridgeStop，但 main.js 无对应 handler（调用会 reject） | electron/preload.js | 🟢 |

## 三、功能缺陷 / 待完善（🟡）

| # | 问题 | 位置 | 状态 |
|---|---|---|---|
| 16 | data-center 定时调度为内存 setInterval，服务重启丢失、不跨实例 | src/app/api/data-center/schedule/route.ts | 🟡 |
| 17 | MediaCrawler trending 未接 DouYinClient（crawler-client 返回提示走 main.py） | src/app/api/mediacrawler/lib/crawler-client.ts | 🟡 |
| 18 | Crawled* 数据写入端只有 lead-collector；mediacrawler 路由本身不落库仅透传 | — | 🟢 |
| 19 | agent publish_content 工具只校验账号绑定，不真实发布 | src/app/api/agent/chat/route.ts | 🟡 已知范围 |
| 20 | agent IM 渠道仅单向 webhook 推送，无收发对话循环 | src/app/api/agent/channel/route.ts | 🟡 |
| 21 | 热点大屏「情绪指数」为 mock 硬编码 72；关注度排序仅 localStorage 埋点 | src/app/agent/page.tsx | 🟢 |
| 22 | agent 对话非流式（一次性 JSON 返回），思考流为前端脉冲卡模拟 | src/app/agent/page.tsx | 🟢 |
| 23 | referral/preview 为纯前端模拟；nfc-promo API 失败回退内置 mock 模板 | src/app/referral/preview | 🟢 |
| 24 | 指纹浏览器：抖音改版后发布脚本坐标/选择器需重测维护 | electron/fp-templates/douyin-publish.js | 🟡 持续项 |
| 25 | douyin-official 开放平台适配器标注「申请资质后激活」，当前不可用 | src/lib/automation-providers.ts | 🟢 |

## 四、客户端本地化（阶段0）后待适配

| # | 问题 | 说明 | 状态 |
|---|---|---|---|
| 27 | 支付跳转适配：支付宝 checkout 返回的支付/回跳 URL 指向 ai-niuma.cc 域名，客户端本地模式下 window 跳转会离开本地壳 | 需改为 Electron 新窗口/外部浏览器打开支付，回跳后回到客户端（阶段 1 处理） | 🟡 |
| 28 | 生产环境 JWT_SECRET 未显式设置（默认 aimarketing-secret-key-2024，实测伪造 token 可通过远程验签） | 建议服务器设 JWT_SECRET 环境变量；客户端本地 middleware 与服务器需同步更新 | 🟡 运维建议 |
| 30 | 本地 .env.local 的 DEEPSEEK_API_KEY（尾 581a）无效（401），已改百炼 qwen 为 Agent 大脑默认；如需用 DeepSeek 需更换有效 key 并改回 | src/lib/ai-providers.ts dashscopeFunctionCall | 🟡 待用户提供有效 DeepSeek key |
| 31 | 打包版曾出现热点/地球/配置全空 + 「账号不存在」（根因：代理远程 + 客户端无本地库） | 2026-08-06 已解决：纯本地架构（无代理 + dev.db 打包 + DATABASE_URL），本地登录验证通过 | ✅ 已解决 |
| 29 | 客户端已引用新 API（/api/agent/media、/api/agent/suggestions），**服务器尚未部署**（当前返回 404）；且服务器未设 JWT_SECRET | 服务器 `git pull && npx next build && pm2 restart` 后生效；建议同时设置 JWT_SECRET | 🟡 待部署 |

## 五、已解决（存档）

| # | 问题 | 解决日期 | 说明 |
|---|---|---|---|
| 2 | /api/admin/seed-plans 完全无鉴权，任何人可初始化套餐 | 2026-08-05 | 已加 getAuthFromHeaders 鉴权（未认证 401 / 非管理员 403），语法检查通过 |
| 3 | /api/admin/usage-stats 无角色校验（仅 token 存在性） | 2026-08-05 | 已加 admin 鉴权（401/403），语法检查通过 |
| 4 | /api/admin/ai-generate-title 无角色校验 | 2026-08-05 | 已加 admin 鉴权（401/403），语法检查通过 |
| 5 | /api/subscription/buy 无鉴权可直接免费开通任意套餐 | 2026-08-05 | 全项目无调用方，按用户确认已删除该路由 |
| 6 | /api/admin/editor-quota 恒 403（(request as any).user 从未注入） | 2026-08-05 | 改为 getAuthFromHeaders 标准鉴权（401/403），语法通过；前端暂无页面调用（配额管理走 admin/users） |
| 1 | middleware 只解 JWT payload 不验签名，可伪造 X-User-* 头提权 | 2026-08-05 | 方案A：Edge Web Crypto HMAC-SHA256 验签，密钥与 login 一致；本地 4 用例测试通过（真token放行/篡改拒绝/错误密钥拒绝/损坏拒绝） |
| 26 | Windows 本地打包反复失败（7za 符号链接/zip 损坏/win-unpacked 占用需重建） | 2026-08-05 | 已脚本化根治：scripts/build-local.mjs 一键打包（清残留+7za补丁+zip校验+镜像）；main.js 退出残留修复待重新打包生效；根治需开开发者模式重启 |
| 🔴 | 2026-08-18 | Agent 发布链路认知错误：AI 编造任务 ID/已唤起发布页/预填（真实：任务建好客户端自动发）；open_page 不能带参唤起发布页，AI 禁承诺 | chat route 系统提示 + 前端 scene | 待修 |

## 已知问题
- 🟡 **发布工作流规格（用户确认式，用户于 2026-08-27 定）**：
  - ①抽帧：抽 4 帧 → 显示 4 张 + 选择键/编号 → 用户选帧
  - ②用户选帧后 → AI 基于画面推荐【3 个标题】 → 用户选/确认标题 → 留档（标题确认在封面前——封面要加标题文字，标题未确认无法制作封面）
  - ③话题标签：AI 推荐 → 用户确认 → 留档
  - ④封面：AI 根据【用户选帧 + 确认标题】制作封面（文生图输入=选帧+标题）→ 反馈 → 确认 → 留档
  - ⑤全部确认后 → 显示【确认发布】按键 → 用户点 → 进入发布流程（建任务→客户端执行）
  - 每步必须 反馈+确认+留档；封面/标题/话题缺一不可；不可跳过（规格要求全流程确认后才发）
  - 原则：发布前必须给用户看到 切片+标题+话题+封面，不然不发（反“什么都没有就发”）- 🟡 **发布流程重构（待一起修，2026-08-27）**：
  - ①状态机被 `!calledPublish` 跳过（AGENT 调 publish_content 就绕过抽帧/标题/确认）→ 应去掉该条件（发布必走状态机）
  - ②抽帧“时有时无”（依赖 AGENT 行为）→ 状态机无条件抽帧
  - ③视觉用 qwen-vl（百炼）——历史遗留（qwen 时代）；**V4（deepseek-v4-flash）多模态自己能看→视觉应改 V4 自己看**
  - ④封面/标题/话题缺失（建任务时 coverUrl/topics 空）→ 发布前必须三要素（封面+标题+话题）基于画面生成
  - ⑤展示审核环节缺失（应给用户看 切片+封面+标题+话题→确认→才发）- 🟡 **AI 文案内容生成误差**（无人机穿越视频被写成军训/燕麦）：抽帧+封面推荐正常，但文案环节 ①qwen-vl-max visualDesc 可能未注入（catch 吞失败）②或 visualDesc 正确但被“结合今日热榜”指令覆盖硬套（最可能——燕麦/军训=热榜拼接）。跨天已重置会话（非昨天记忆干扰）。待发布步统一修：visualDesc 强制注入 prompt（只能基于画面描述，禁止编造画面没有的题材）+ 热榜拼接弱化。用户暂不修改（2026-08-26）
- 🟡 **点平台卡偶发多窗口**（历史实例/profile 锁累积；v1.0.62 已含 __bindInProgress 防抖+getTargetPage 复用+同平台合并仍偶发）——**不影响发布功能**（发布复用已登录 tab 操作）；用户决定暂缓修复（2026-08-25）
