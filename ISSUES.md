### ✅ 已解决
- 2026-08-14 API key 保存后丢失/未配置：根因 ① config 写 cwd/standalone 被 rm -rf 删（修：DOTENV_CONFIG_PATH 统一）② 16 段保存没排除 ******** 掩码覆盖（修）③ statusMap minimax 未初始化显示未配置（修）——服务器验证 MINIMAX 保存成功
- 2026-08-14 settings 一页堆叠全部配置难用（修：分页 Tab 密钥/媒体/引擎/系统）

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
