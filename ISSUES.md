## 🔴 发布链路待解决（2026-09-07）

- 🟡 **微博入口的正确写法（2026-09-13 实测定稿——修正此前误判）**：
  - ❌ 原来写成"直接打开 `weibo.com/upload/channel`"——那页的 file input 是 `accept="image/*,..."`（图片框），**塞视频会被静默忽略**，但脚本报成功（假成功）；且该地址会变。
  - ✅ **正确做法**：只 `goto https://weibo.com`（首页），然后 `query_selector('input[type=file][accept*="video"]')` **直接 set_input_files(视频)**——首页那个隐藏 input 的 accept 同时含 `image/*` 和 `video/*`，实测 3 秒内出现视频元素（720x1280）进入上传态。
  - 注意：脚本若**复用已开页面**，必须强制 `goto` 回首页（否则停在旧的上传页 → 又走图片框 → 假成功）。
  - 登记口（登录页）与发布入口是两回事：登记口用各平台**登录页**（微博 `weibo.com/login.php` 等），发布用首页。
- 🔴 **抖音封面上传与 browser-use 冲突**：browser-use 的 upload_file 是直接塞 file input（不点按钮弹窗），绕过抖音"设置封面→选择封面→弹窗→上传→完成"流程，封面保存不住。方案待定：A抖音官方API传封面 / B封面合进视频首帧 / C平台默认封面
- 🔴 **发小红书（跨平台复用）未实现**：同一视频/封面/标题/话题跨平台发布，自然语言"发小红书"不生效（full 分支只认"平台:"按钮格式）——待加自然语言平台识别+多平台循环
- 🟡 **对话内重发#N 待验证**：已实现（32fe01f，匹配 #N重新发布/重发/发布失败），用户实测未生效需排查（可能正则太窄/输入格式不符）

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
- 🟡 标准/自由模式文件级隔离（free-flow.ts / standard-flow.ts 物理抽取）——**2026-09-12 更新**：第1步已完成（抽出 tools.ts 354行 / prompts.ts 290行 + 状态机块边界注释 L1586-2235 + freeMode 5 个分叉点清单写入 PROJECT.md）；第2步（状态机块物理搬 standard-flow.ts）待 6 平台真发验证通过后做

### ✅ 已解决
- ✅ **agent 发布链路 5 个真问题（2026-09-17 修复——用户逐条实测发现）**：
  1) **登录态"丢失"（重登 N 次登记仍显示未登录）**：`bu:check` 在 python 无输出/超时时也 `return {success:true, accounts:[]}` → 前端 `else` 分支把空数组当"所有平台都没登录"→ 全清。用户实测：重登快手 3 次登记仍显示未登录，而 `bu_check.py` 单独跑输出 `kuaishou:1` 是对的（打开浏览器的瞬间 Chrome 独占锁 Cookies，读不到即产出空）。修：① 不谎报 success ② 拿不到输出回退读 `browser-profile/bu_login_cache.txt` ③ 前端不再用空数组覆盖（`electron/main.js` bu:check + `src/app/agent/page.tsx`）。
  2) **抖音发布卡在封面（任务 #48 失败根因，本机已复现）**：旧代码"上传封面后死等 3500ms 就点完成"，实测此时封面图仍在"生成中"、这一下点击无效 → 抖音紧接着弹出【第二个窗口】「已基于横封面为你生成竖封面。效果不满意？独立编辑」，该窗口里【没有「完成」也没有可点的「发布」】→ 一直卡着（同代码等 5s 点=正常、等 3.5s 点=出第二窗口，纯时序）。修：轮询等「完成」按钮可点击（≤20s，含 `semi-button-disabled` CSS 类判断）+ 点后【校验弹窗是否真关闭】+ 重试 + 兜底关闭该提示层。
  3) **登录失效"假成功"**：抖音/小红书/微博原来【完全没有】登录检测；快手 `logged_in()` 太宽松（URL 不跳登录页 + 没出现"扫码登录"就判已登录，页面没渲染完会误判）。修：6 平台统一明确报"XX 未登录，请在登记浏览器登录"。
  4) **平台跳错页**：B站 goto 后【不复验】（登录失效被重定向到首页仍继续操作 → 用户看到"B站直接跳到首页去了"）；视频号原来"只要 url 含 channels.weixin.qq.com 就抓"、抓到首页也不导航。修：两者都导航到正确发布页 + 复验 URL。
  5) **视频号登录态每天必丢**：微信的 sessionid 每天换值、久不访问即作废（实测 cookie 有效期 395 天，不是到期失效）。新增 `scripts/keep-login-alive.mjs` + Windows 计划任务 `AiMarketing-KeepLogin`（每天 11:30；独立端口 9223 不抢发布 9222、窗口移到屏幕外、Chrome 单例检测"已在运行则跳过"、taskkill 兜底关闭）。
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

| 2026-09-10 | 🟡 设计缺陷 | **同账号多台机器抢任务（跨机器执行）**——`/api/agent/browser-tasks` 只按 `userId` 过滤（无机器维度）→ 同账号登录的每台客户端都轮询同一队列，**谁先轮到谁执行**。用户实测：在另一台（外网）点发布，任务被开发机客户端抢先执行（打开开发机浏览器发布）。**正解**：任务绑定机器 ID（客户端上报 machineId，任务只投给建它的机器） | electron/main.js、src/app/api/agent/browser-tasks/route.ts |
| 2026-09-10 | 🟢 已解决(v1.0.135) | **客户端更新后「未响应」（卡死）**——疑似 `ensureBuEnvOnStartup` 里 `getBuEnvInfo()` 用 **spawnSync（同步）** 调 python 3 次（每次超时 25s）→ **阻塞 Electron 主进程**（最长 ~75s 界面无响应）。修法：改异步 spawn / 或用已缓存结果（不阻塞 UI）。另一台机器用户先自查 C 盘残留 | electron/bu-env.js |
| 2026-09-10 | 🟢 已解决(v1.0.135) | **自检首次误报（重开即正常）**——用户点开自检看到 1 项 ❌，没做任何操作关闭再开 → 全 ✅。疑似**时序**：启动 8s 后台自检/环境上报未完成时，`selfcheck` 的「发布运行环境」读到未上报状态 → 显示 ❌。修法：客户端未上报时不判 fail（显示「检测中」） | src/app/api/agent/selfcheck/route.ts、agent/page.tsx |
| 2026-09-10 | 🟡 待确认 | **开机自检未自动弹出**——AGENT 页自检弹窗只在**首次**弹（`localStorage.agent_selfcheck_done` 标记），之后静默。用户期望「开机自检」每次可见？需确认是「每次启动都弹」还是「仅首次」 | src/app/agent/page.tsx（L774-777）|
| 2026-09-10 | 🟢 已解决 | **AGENT 发布慢/不稳**（browser_use 每步喂整页 DOM + 超长 MANUAL，qwen3.8-max 每步 75s）→ 改确定性 Playwright 脚本（抖音/小红书已实测通）；browser_use 退为无脚本平台兜底 |

## 🟢 已解决（2026-09-13）

- **微博入口**（此前我误判为"入口错"）：真相是入口本来对，但 ① 点「视频」必须点【图标中心 (734,208)】不是文字(734,220) ② 不能直接 goto /upload/channel（要首页点视频让微博自己跳）③ 上传用真按钮 `button[id^=video_button_upload]` ④ 禁止 file input 兜底（accept=image/* 是图片框，塞视频=假成功）。实测 2 轮均 3 秒到编辑页 ✅
- **微博上传太快**：加 wait_video_ready(240s，看 video.videoWidth>0 且无「上传中」) + wait_cover_ready(60s，看预览图) ✅
- **视频号封面**：视频号有【两个封面位】——「个人主页卡片 3:4 竖」+「分享卡片 4:3 横」；原来只传一张 → 只进分享卡片、竖位空着 → 改为两个位都传 ✅
- **标题长度**：状态机标题是模板拼的（kw 最长 14 字 + 后缀）→ 忽长忽短、只写 20 字；已改为拼满 16 字 + 前缀「【文案1】」→「1. 」（省 5 字）+ 视觉提示严格 16 字 + 6 平台脚本统一截 16 ✅
- **快手封面**：PK 开关已开则不点（避免被关掉）✅
- **6 脚本 connect_cdp 自我递归** BUG（快手/B站永远连不上浏览器）✅

## 🟢 已解决（2026-09-13 登录态专项）

- **重装丢登录态**：卸载器 `customRemoveFiles` 的手动卸载分支原来是 `RMDir /r "$INSTDIR"`（连 data/python/storage 全删）→ 改为只删程序文件、保留三目录。**用户决策 B：data 继续放安装目录内，只改卸载器保住它**
- **打开浏览器 → 平台 ✓ 标记 1 秒后全消失**：根因 = `bu_check.py` 用 `shutil.copy2` 读 `browser-profile/Default/Network/Cookies`，而打开浏览器时 Chrome **独占锁定**该文件 → `WinError 32` → 打印 `CHECK_ERR`（不返回任何数据）→ 前端 `setBuAccounts([])` 清空。
  修法三层：① bu_check 复制重试 4 次×1.5s ② 读成功写 `bu_login_cache.txt`、读失败回退该缓存 ③ 前端拿到空结果时保留上次显示。
  **实测**：Chrome 运行且文件锁定下仍输出 `PLATS:douyin:1,...,kuaishou:1` + `CACHED:1` ✅
- **参考**：OpenCLIApp 的做法（AppData\Local\BrowserBridge，自带 EBWebView + 常驻服务 tcp://127.0.0.1:19826 + account-archive.sqlite3 落库）——它"不登录也能拿到登录态"的本质是【用自己的浏览器 + 结果落库】，我们学的是"缓存/不因一次失败清空"。

## ✅ 已修（2026-09-14 热点采集上报 401）

- **现象**：客户端热点采集【全部成功】（微博20/B站20/抖音49/快手49，日志已证），
  但上报服务器失败：`上报失败: HTTP Error 401: Unauthorized` → 数据进不了服务器 → 热点大屏看不到新增
- **根因（代码定位）**：`scripts/browser-use/bu_hot.py` 上报请求头写法错——
  ```python
  headers={'Cookie': a.cookie, 'Authorization': 'Bearer ' + (a.cookie or '')}
  ```
  `a.cookie` 是完整 Cookie 字符串（形如 `token=eyJxxx; other=yyy`），
  拼成 `Authorization: Bearer token=eyJxxx; other=yyy` → 服务端解析不出有效 token → 401
- **修法（1~2 行）**：二选一——
  ① 只发 `Cookie` 头（middleware 会从 cookie 取 token）→ 删掉 Authorization 那行
  ② 或 `Authorization: Bearer <纯 token 值>`（不能带 `token=` 前缀、不能夹其它 cookie）
- **影响**：热点功能"看得见采集、看不见结果"；服务端 `data/hotspot-report.json` 始终为空
- **状态**：✅ 已修（`80a33f0`）——改为只发 Cookie 头。待装 1.0.159 验证

## 🔴 待观察（2026-09-14 客户机环境）

- **根因**：客户机常【没有真 Python】（只有 Windows 应用商店存根）+ 内置环境没装成功
- **已修**：`1be752e`（环境自检不再静默）+ `a90bdeb`（假 Python 真探测 + 安装每步记日志）
- **待验证**：装 1.0.159 后，客户机上应能看到 `[bu-python]` / `[bu-env]` 完整日志，
  若仍失败，日志会直接给出原因（HTTP 状态 / 解压退出码 / 哪个候选不是真 python）
- **仍缺**：环境不可用时【用户可见提示 + 一键安装】（前端自检项目前只上报，未做交互按钮）

## 🟡 待讨论（2026-09-14 同机换账号）

- 已按用户要求实现【绝对隔离】（`1e996bb`）
- 遗留：`D:\aimarketing-data`、`D:\...\Programs\aimarketing-data` 等旧残留目录
  （不影响运行；Administrator 机器上的一份 browser-profile 含登录态，另一份没有）


## ✅ 已修（2026-09-14 「点平台没反应」）

- **真因**：`chat/route.ts` L1885/L1888 用 `PLATFORM_NAMES` 但漏 import → 运行时 ReferenceError → API 500 → 前端无任何显示（2026-09-13 收拢平台名单时引入）
- **修复**：`513d831`（补 import + 点平台一律建任务 + 素材兜底 + 不再静默）
- **状态**：⏳ **代码已推送，等部署服务器生效**（客户端无需重新打包）
- **验证方法**：部署后点一次微博 → 日志应出现 `任务#N 走确定性脚本 bu_pub_weibo.py`

## 🔴 待处理（2026-09-14 小红书脚本 —— 用户要求等他本地实测）

- **现象**：`PK 开关状态=True` → `封面＋号数=0` → `⚠️ 无封面＋号（PK 未开或列表未渲染）` → 最后
  `{"success": false, "result": "Page.wait_for_timeout: Target page, context or browser has been closed"}`
- **另有**：用户反馈"一直显示禁止笔记"（疑似**输入格式/标题正文标签格式**问题）
- **处理方式（用户定）**：**先不写脚本**，用户在本地**手动逐步实测跑通**，拿到确定的选择器/格式后再改
- **相关**：`scripts/agent-publish/bu_pub_xhs.py`、`scripts/agent-publish/_cdp_click.py`、参考 `electron/fp-templates/*.js`


## ✅ 已修（2026-09-14 账号隔离竞态：「更新后所有登录态没有了、点一次才恢复」）

- **现象**：客户端更新后首次打开，登记簿**所有平台**显示未登录；点一次（刷新检测）恢复正常
- **根因**：`userId` 在页面加载**之后**才异步解析，而前端一挂载就调 `bu:check` → 读到 `browser-profile\default`（不存在）
- **修复**：`86457bc` —— A：`ensureUserResolved()` 幂等门 + `loadURL` **之前**解析 + 6 个消费方 await；C：前端首次全未登录自动重查一次
- **状态**：代码完成，**1.0.161 已打包** → 待用户安装验证
- **验证点**：重启后日志出现 `[iso] 启动前预解析完成 userId=N`；首次打开登记簿即显示正确登录态

## ⚠️ 注意（部署与服务端）

- `chat/route.ts` 的「点平台没反应」修复（`513d831`：补 `PLATFORM_NAMES` import + 点平台一律建任务）**尚未部署服务器**
- 客户端修复已到 **1.0.161**；v1.0.159 含 getter bug，**不要发**


## ✅ 已修（2026-09-14 视频号"网页打开但不上传/不执行脚本"）

- **现象**：点视频号发布 → 网页正常打开，但脚本完全不动（用户以为"上传失败"）
- **根因**：`bu_pub_shipinhao.py` 末尾**漏了 `main()` 调用** → python 只做"定义"即退出（exit 0、零输出、不执行任何步骤）
- **判定特征（下次遇到类似"秒退"直接套用）**：日志里"走确定性脚本"与"脚本执行失败 code=0"**同一秒**、且**没有任何 `[PUB]` 输出**
- **修复**：`6f59379` —— 补 `if __name__ == '__main__': main()`
- **状态**：✅ 已修 + **v1.0.162 已打包**，待安装验证
- **微博对照**：同一次实测**微博全流程 9 步 + 发布成功** ✅（微博脚本有 `main()` 调用）

## 🟡 待讨论（2026-09-14 客户端内嵌浏览器 —— 用户提出，仅记录未实施）

- 现状"打开浏览器"是外部弹窗；用户希望像 IDE 那样内嵌到客户端内
- **障碍**：内嵌视图 session 落不到真 Chrome 的 `browser-profile`（登录态读不到）+ 需重写 6 个脚本的 CDP 驱动层 + Chromium 版本差异
- **低成本折中**：① Chrome `--app=` 无地址栏 + 窗口贴靠 ② 客户端内 CDP 截图"实时预览"
- **结论**：属架构选择，等 6 平台发布稳定后单独评估（详见 EXECUTION_LOG.md 同轮记录）


## ✅ 已实现（2026-09-14 窗口可见性 —— 内嵌讨论的低成本折中）

- **需求**：打开浏览器时能"看得见"（原来停在客户端背后），且后期大量**采集类任务**也要用
- **已实现**：`6b6d598` —— 打开浏览器时**客户端自动缩到左侧**、浏览器放右侧；任务结束 15s 后恢复
- **仍未做（真正内嵌）**：webview/BrowserContentsView 内嵌 → 属架构选择（读不到真 Chrome profile + 要重写脚本驱动层），等发布稳定后单独评估
- **局限**：浏览器已开着（复用）时改不了它的窗口位置（Chrome 单例）


## 🟡 风控（2026-09-14 小红书账号被限制发布）

- **现象**：小红书账号**仅"限制发布"**，其它功能正常（用户实测确认）
- **已做（P0）**：`ec30ded` 小红书脚本拟人化（标题逐字输入、打字间隔随机、鼠标轨迹点击、发布前拟人浏览）——**只改小红书**
- **根本局限**：拟人化只降低概率，**不能保证不被封**；账号现有"限制发布"不会因脚本改动解除
- **未做方向**：① P1 端口随机化/一号一 IP ② P2 **官方开放平台 API**（小红书专业号/抖音/微博/B站，合规零风控）③ P3 **半自动：脚本准备好 + 人工点发布**
- **参考**：EXECUTION_LOG.md 同轮记录（含"机器特征"清单与风控因素分析）


## ✅ 已定位（2026-09-14 "客户端收不到任务/浏览器不打开" = 多客户端同账号抢任务）

- **现象**：前端显示"已创建任务#N"，但某台客户端日志只有 `任务数=0`（无任何 `任务#` 行）
- **真因**：**两台客户端同一账号** → 服务端 pending 队列按 userId 共享、**无客户端归属** → 谁先轮询谁拿走
  → 另一台抢走并执行（那台**缺 Python** → 失败）→ 本台查 pending 恒为 0
- **判定**：`sqlite3 prisma/dev.db "SELECT seq,status,updatedAt,substr(error,1,180) FROM AgentBrowserTask ORDER BY id DESC LIMIT 6;"`
  看到 `status=failed` + `error='缺 Python 运行环境：'` 即确认
- **不需修**（用户确认属使用约定问题）；根治可选：任务绑定 clientId / 客户端单实例锁（详见 EXECUTION_LOG 同轮）
- **配套**：那台机器装 v1.0.164 后环境会自装；视频号脚本入口缺失已修（`6f59379`）


## ✅ 已修（2026-09-15 启动自检 + 登录态自愈 + 内置环境根因）

- **启动自检**（`9b6cd24` / v1.0.167）：新增本地 `splash.html` 自检页，6 项真检（版本/运行环境/脚本插件/目录可写/账号/平台登录态），
  失败显示具体错误、允许"仍要继续"，全部完成点「确认进入」才进主界面
- **登录态反复消失**（`3b75072` / v1.0.166）：根因是迁移逻辑"一次性 + 静默失败 + 不校验就写标记"；已改为幂等 `ensureAccountProfile`
- **内置环境**（`b17c59d` / v1.0.165）：① venv 不可移植 → 换官方 embeddable 重打；② 目录创建顺序错误 → 先建目录再写标记

## 🔴 待做（2026-09-15 已讨论定方向，未开工）

1. **客户端采集（微博/B站/抖音/小红书/快手）**：用户定稿——"登记了就一个一个采集"，已登录的逐个采（进度按平台推进：
   抖音完成→小红书完成→…），未登录的提示"打开客户端登录，下次启动自动采集"。
   **前置**：B 类（抖音/小红书/快手页内取数）目前是"暂未实现"，是主要工作量；还要处理"与发布抢 9222"。
2. **「为你推荐」里的"把文案变成视频（一键成片）"**：用户认为已过时（方向是 AI 推荐文生视频）→ 待改（服务端 `/api/agent/suggestions`）
3. **热点"前天的"**：服务器侧（头条/百度/HN/Reddit）实测为**实时**；`data/hotspot-report.json` **不存在**（客户端上报从未成功）→
   待用户指出"在哪里看到旧数据"以定位


## ✅ 已完成（2026-09-15 启动自检四步改造）

- **独立窗口**（`4832171`）：点客户端先弹"启动自检"独立窗口 → 全部完成点「确认进入」才开主界面
- **每项进度条**（`1c64f1d`）：脚本逐文件/采集逐平台/环境分步；未知百分比走流动动效
- **真检测**（`be9f6fc`）：脚本与上次比对变化 · 环境真执行 playwright start/stop · 发布前置预检（Chrome/网络/9222/Cookies）
- **统一更新入口**（`8adc0b9`）：更新进度并入自检窗（第1段下载%、第2段安装提示"窗口会自动重开"）

## 🔴 待修（2026-09-15）

1. **内置环境 driver 缺失**（我删错）：`python-bu.zip` 少了 `playwright/driver` → `sync_playwright().start()` 失败 → 发布脚本全废。
   **OSS 上现在就是坏版本**（72637453 字节）。→ 重打（含 driver，~170MB）+ 重新上传 OSS。
   ★ 结论：内置环境【必须含 playwright/driver】
2. **点快捷方式先出白色客户端**：`mainWindow` 现在是 `{show:false}` + `about:blank`（白页）；
   而单实例逻辑 `app.on('second-instance')` 会 `mainWindow.show()` → 显示白页。
   → 改：自检窗在场时只前置自检窗；已进主界面才显示主窗口
3. **小红书 B 类采集未实现**（edith 域跨域 → 需走 www 域）；视频号未纳入
4. **服务器未部署**（点平台修复 `513d831`）


## ✅ 已解决（2026-09-15 顺序/编号修复，v1.0.183~185）
- **账号没选、登录态没验就采热点** → mainWindow 占位页的 did-finish-load 触发定时任务抢跑；已改为交给自检页按序执行（进主界面后仅"今日未采"兜底补采）
- **检查更新失败 / 一直转圈** → 更新器初始化晚于自检窗 + 两处并发 checkForUpdates；已提前初始化 + checkUpdateOnce 闸门 + 15s 超时
- **自检项无序号** → 已加 1.2.3.… 编号，第一项就是检查更新
- **内置环境"python.exe 在、库缺"** → 动态定位 findBuiltinPy()，去掉 Move-Item 迁移
- **报错被截断看不到病因** → 改为显示真正的错误行 + 后台 pip 补装
- **白屏/黑屏** → 主窗口补深色底色 + 自检窗 ready-to-show + second-instance 占位页走 enterMainApp + 关自检窗自动进入

## 🔴 仍待办
1. **上传 OSS**（本地 OSS key 只读，403）：dist-rel/python-bu.zip（85.8MB 正确结构）+ AI-Marketing-Setup-1.0.18x.exe + .blockmap + latest.yml（最后传）
2. 小红书 B 类采集（edith→www 域）；视频号未纳入 B 类
3. 服务器部署（点平台修复 513d831）
4. 首启"更新 → 安装 → 重启 → 继续自检"完整链路待真机验证（需 OSS 上有新版）


## ✅ 已解决（2026-09-16 画像清理 + 按主题搜热点）
- **画像数据乱**（平台冒充行业、重复、标签错配）→ 清噪音（服务器已执行，有备份）+ 修三个写入口 bug + 加幂等
- **User.industry 全表为 null** → 登记与自动提取都会同步写它了
- **"AI" 这类英文主题记不下来** → 改为用户显式填写（设置页「我关心的主题」），不再依赖自动提取
- **热点只有总榜** → 新增"按主题搜索"（HN 先行）；无主题账号不受影响
- **Reddit 源一直超时** → 已摘掉（服务器网络不可达）

## 🟡 待验证
- 部署后：admin 热点大屏应出现按主题的源（`HN·AI` / `HN·大模型` …）
- 画像面板分组显示是否正常

## 🔴 仍待办
1. **iOS/OSS 上传**：dist-rel/python-bu.zip（正确结构）+ exe/.blockmap/latest.yml 三者同步（本地 OSS key 只读 403）
2. 中文字段源（头条/百度）搜索接口解析试探
3. 发布接画像（常用平台默认勾选）
4. 小红书 B 类采集；服务器部署（点平台修复 513d831）
