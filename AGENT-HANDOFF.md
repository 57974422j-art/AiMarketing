# AiMarketing · AGENT 页接手文档

> **用途**：换工具 / 换机器时的**唯一接手入口**。读完本文即可接手。
> **范围**：只覆盖 **AGENT 页相关**（发布链路 / 热点 / 客户端环境 / 账号隔离）。
> ❌ 不管：`admin/*`、`my-automation`、`my-fingerprint`、`ai-copy`、`i18n` 等**手动功能页面**（那是用户手动用的，与 AGENT 无关）。
> **最后更新**：2026-09-14 13:40 ｜ 相关：[EXECUTION_LOG.md](./EXECUTION_LOG.md)（操作流水）、[ISSUES.md](./ISSUES.md)（问题清单）、[PROJECT.md](./PROJECT.md)（总文档）

---

## 0. 一页速览（接手先看这里）

```
最近提交：aa386d5(文档) ← 513d831(★点平台真因修复) ← 521fba7(v1.0.160) ← 58b6cdb(getter 回归修复) ← ad23732(抖音封面)
客户端：v1.0.185 已打包（自检编号化 1..8 + 顺序修复：先更新→环境→脚本→目录→预检→账号→登录态→采集）（启动自检四步：独立窗口 SPLASH_WINDOW_V1 / 每项进度条 STEP2_PROGRESS_V1 / 真检测 STEP3_REALCHECK_V1 / 统一更新入口 STEP4_UNIFY_UPDATE_V1）+ 登录态自愈 + 窗口分栏 + 小红书拟人化 + 视频号入口修复（dist-rel/AI-Marketing-Setup-1.0.160.exe，349MB，11:41）含全部客户端修复
服务端：★ 513d831 【尚未部署】→ 不部署则"点平台没反应"依旧

当前唯一阻塞 = 【部署服务器】
部署后 = 点各平台按钮应能建任务 → 客户端自动开 Chrome → 跑对应脚本

待用户实测：小红书/微博等发布脚本（用户要求"先自己手动跑通再让 AI 写脚本"）
```

---

## 1. 环境与路径（三台机器，别搞混）

| 角色 | 路径 | 说明 |
|---|---|---|
| 源码仓库（开发机） | `D:\AiMarketing` | 用户 `wo'shen`；git master |
| 本机客户端 | `E:\ai-marketing\AI营销助手.exe` | 开发机上的测试客户端 |
| **客户机** | `E:\ai-marketing\`（用户 `Administrator`，shell `C:\Users\Admin`） | **与开发机不是同一台**；历史问题多出自此机 |
| 服务器 | `root@iZbp1e6grl7nzt5fk90mu8Z:/root/AiMarketing` | PM2 进程 `aimarketing`；对外 `https://ai-niuma.cc` |
| OSS | `aimarketing-1.oss-cn-hangzhou.aliyuncs.com/updates/` | 客户端更新源 |
| DB | `prisma/dev.db`（服务器需 `DATABASE_URL="file:/root/AiMarketing/prisma/dev.db"`） | SQLite |

**客户端目录约定（定稿，勿改）**
```
★ 窗口分栏（LAYOUT_V1）：需要打开浏览器时 → 客户端缩到左侧 58%、浏览器靠右；任务结束 15s 后恢复
  （实现于 main.js：layoutSideBySide / restoreClientLayout / scheduleClientLayoutRestore；仅"要新启动浏览器"时触发）
userData   = 安装目录\data\        ← 登录态 / browser-profile / bu_debug.log
本地素材仓库 = 安装目录\storage\     ← 视频/封面（发布脚本从这里读）
★ 2026-09-14 起都按账号分：data\browser-profile\{userId}\ 、storage\{userId}\
```

---

## 2. AGENT 全景（文件地图 —— 只这些跟 AGENT 有关）

```
前端页面
  src/app/agent/page.tsx                     AGENT 页（发布按钮=PLATFORM_NAMES、登记簿=PLATFORMS、方案卡）

服务端 API（Next.js —— 改这些必须【部署服务器】才生效）
  src/app/api/agent/chat/route.ts            ★ 入口：鉴权 + 状态机 + 建发布任务（含"平台:xxx"分支）
  src/app/api/agent/publish-tasks/route.ts   发布任务 CRUD（AGENT 页展示）
  src/app/api/agent/browser-tasks/route.ts   客户端轮询的任务队列（pending 列表）
  src/app/api/agent/hotspots/route.ts        热点聚合（服务器侧：头条/百度/HN/Reddit + 读客户端上报）
  src/app/api/agent/hotspot-report/route.ts  接收客户端采集上报（POST + GET 查看）
  src/app/api/agent/client-env/route.ts      客户端环境状态上报

平台真源（★ 唯一，新增/改平台只动 platforms.ts）
  src/lib/agent/platforms.ts                 PLATFORMS 数组 + 派生 PLATFORM_KEY/NAME/NAMES/URL/LOGIN_URL/ICON/IDS
  src/lib/agent/publish-task.ts              createPublishTask（唯一建任务入口）+ parsePublishTask + 转发导出
  electron/platforms.generated.js            ★ 由 scripts/gen-platforms-js.mjs 从 platforms.ts 自动生成（勿手改）
                                               main.js 用它做登录态预检(PLATFORM_KEY)和平台标签(PLATFORM_NAME)

客户端（Electron —— 改这些必须【重新打包】才生效）
  electron/main.js                           ★ checkBrowserTasks(轮询) / ensureChromeForPublish / ensureBuPython
                                               / collectHotspotsDaily / buLog(写 data\bu_debug.log) / 账号隔离
  electron/bu-env.js                         发布环境自检 + 上报（ensureBuEnvOnStartup）

客户端脚本（打进包 resources/scripts/）
  scripts/browser-use/bu_check.py            登录态检测（读 profile 的 Cookies → 输出 PLATS:抖音:1,...）
  scripts/browser-use/bu_hot.py              热点采集（A类 微博/B站 cookie 直调；--browser B类 开标签页 fetch）
  scripts/browser-use/bu_exec.py             browser-use 兜底执行器（无确定性脚本的平台）
  scripts/agent-publish/bu_pub_douyin.py     抖音
  scripts/agent-publish/bu_pub_xhs.py        小红书
  scripts/agent-publish/bu_pub_weibo.py      微博
  scripts/agent-publish/bu_pub_shipinhao.py  视频号
  scripts/agent-publish/bu_pub_kuaishou.py   快手
  scripts/agent-publish/bu_pub_bilibili.py   B站
  scripts/agent-publish/_cdp_click.py        ★ CDP 穿透点击（shadow DOM / iframe 唯一可靠手段）
```

**6 个平台 id ↔ 中文名**（`platforms.ts` 唯一真源）
```
douyin 抖音 / xiaohongshu 小红书 / weibo 微博 / shipinhao 视频号 / bilibili B站 / kuaishou 快手
```

---

## 3. 四条链路

### 3.1 发布链路（三层接线）
```
① 前端建任务
   page.tsx 平台按钮 → sendMessage('平台:小红书')
   → chat/route.ts 发布状态机 → draftW.step === 'full'（或任意 step + 平台:xxx）
   → createPublishTask(userId, {platform, videoName, title, topics, coverUrl, skips})
   → 写 prisma.agentBrowserTask（status=pending，task 字段是 JSON）

② 客户端轮询执行（electron/main.js checkBrowserTasks，每 ~8s）
   拉 pending 任务 → 逐个前置检查，任一不过就标 failed + continue（这就是"点了没反应"的常见出口）：
     a) getServerCookie() 为空        → 整个轮询跳过（日志：轮询跳过：getServerCookie 空）
     b) 环境未就绪                     → 静默 ensureBuPython()，仍不行则跳过（缺 Python 运行环境）
     c) 登录态预检 bu_check.py <profile>
        → 某平台 :0 → 跳过 + 标 failed（日志：登录态预检=... → 未登录微博，不执行（浏览器没开的原因））
   通过后：CDP 9222 不通 → ensureChromeForPublish(platUrlMap2[plat]) 自动启动 Chrome
   然后 spawn 对应 bu_pub_*.py（有脚本的平台）或 bu_exec.py（兜底）

③ 确定性脚本（Playwright + CDP 穿透点击）
   goto 平台发布页 → 上传视频 → 填标题/话题 → 封面 → 点发布 → 校验 URL
```

**关键：`draftW.step` 有 9 种取值**
```
pick → plat → abc → usercopy → frame → title → topics → cover → publish
                    ↘ full（方案卡完成态）
★ 只有 full 会建任务（2026-09-14 已放宽为"点平台按钮一律建任务"）
```

### 3.2 热点链路
```
服务器侧（/api/agent/hotspots）：今日头条 + 百度 + HN + Reddit（直调，抓不到就不显示，无假数据）
客户端上报（/api/agent/hotspot-report POST）：
  electron/main.js collectHotspotsDaily() —— 启动后延迟跑一次，两步（顺序关键）：
    ① A 类（微博/B站）：读 cookie 文件直调（会锁 cookie 库 → 必须在前）
    ② B 类（抖音/快手）：--browser，开标签页在页内 fetch（会开浏览器）
  只有真的采到东西才写"今天已采"标记（data 下 hot-mark），失败不写（下次启动重试）
```
⚠️ **客户端侧 B 类在客户机尚未验证成功**（见 §5 待验证）

### 3.3 客户端 Python 运行环境（三层自动就绪）
```
① 内置 BUILTIN_PY = 安装目录\python\buvenv-test\Scripts\python.exe（playwright + browser_use 齐）→ 首选
② 系统 python（须过 isRealPython() 真执行校验——Windows 应用商店的 python 存根不算）缺库 → 自动 pip install
③ 都没有 → 下载 OSS python-bu.zip 解压到 安装目录\python\
触发：启动后自检（ensureBuEnvOnStartup），不弹窗；发布时只检查不安装
```

### 3.4 账号隔离（2026-09-14 新增）
```
browser-profile：userData\browser-profile\{userId}\     （原为共用一个 browser-profile）
本地仓库：      安装目录\storage\{userId}\                （原为 storage\）
userId 来源：启动 did-finish-load 后从登录 cookie 解 JWT payload（syncClientUser）
一次性迁移：旧的 userData\browser-profile（未分账号）复制进 {userId} 子目录，
           写 .profile-migrated-v1 标记防重复
手法：用 getter 对象替代字符串常量（★ 这是坑，见 §6）
```

---

## 4. 状态清单

### ✅ 已完成 且 已在客户机验证
```
· 账号隔离（browser-profile\7 + storage\7；迁移 44 项成功）—— 日志 [iso] 当前账号 userId=7
· 账号隔离竞态已修（86457bc / v1.0.161）：启动时先解析账号再 loadURL，前端首帧即拿到正确 profile —— 待装 1.0.161 验证
· 客户端执行链路（任务#33 小红书：建任务→启动 Chrome→跑脚本）
· 6 平台 URL 映射齐全（main.js platUrlMap2 含 douyin/xiaohongshu/weibo/shipinhao/kuaishou/bilibili）
· 登录态预检在工作（PLATS:douyin:1,xiaohongshu:1,weibo:1,bilibili:0,shipinhao:1,kuaishou:1,x:0）
· 环境自检能跑（系统 python 3.14.4 + playwright ok + browser_use ok）
```

### ⏳ 代码已改好，**等部署/等验证**
```
· 【必须做】部署服务器 → 513d831 才生效（点平台真因修复）
· 热点上报 401 修复（80a33f0：bu_hot.py 改只发 Cookie 头）—— 未在客户机验证
· 抖音封面"删横竖判断"（ad23732）—— 未在客户机验证
· 采集"失败不写标记"（3b1cbc6）—— 客户机今天被旧版写的标记挡住，明天才能验证
```

### 🔴 待办（按优先级）
```
1. 【用户操作】部署服务器（不部署则一切不生效）
2. 【用户实测→AI 改】小红书脚本：PK 开关=True 但「封面＋号数=0」→ ⚠️无封面＋号；
   末尾 Target page, context or browser has been closed 失败；用户另反馈"一直显示禁止笔记"
   （疑似 标题/正文/标签的【输入格式】问题）—— 用户要求先本地手动跑通再写脚本
3. 【待验证】微博/视频号/B站/快手脚本（微博今天没跑到）
4. 【未做】环境不可用的【前端可见提示 + 一键安装按钮】
   （目前只有后端日志记账；用户原话要求"环境不可用必须可见 + 一键安装"）
5. 【未查清】内置 Python 环境在客户机始终装不上：日志每次启动都是
   builtin:true + ok:false「缺组件 → 后台安装」→ 每次重装；靠系统 python 兜底才 ok
6. 【未验证】热点采集客户端侧：客户机日志显示
   [微博]/[B站] 未登录 → 跳过；[抖音]/[小红书] 已登录，但需开浏览器采集（暂未实现）；浏览器不可用 connect ECONNREFUSED 9222
7. 【未验证】账号隔离"换账号"：切账号后 profile/storage 要跟着换；未实测
8. 【未验证】对话内重发 #N；热点无国内源（已加头条/百度，待验证）
9. 【低】agent/page.tsx 约 30 处 tsc 类型错误（历史遗留，不影响构建与运行）
10.【低】白窗：更新日志弹窗 / 未完成任务弹窗（用户说"没关系"，保留）
```

### ⛔ 已知别踩
```
· v1.0.159 的包【含我引入的 getter bug】→ 不要发给客户，用 1.0.160
· 不要把 .next/ dist-rel/ 里的旧产物当源；源码才是源
· package.json.bak-sl / scripts/build-local.mjs.bak-sl 是瘦身前备份，别覆盖回去
· 别删 `D:\AiMarketing` 根下的 viag-shot*.png / xhs-shot.png（用户调试截图）
```

---

## 5. 坑与硬规则

**硬规则**
```
1. 绝不怀疑部署：用户说测了 = 已跑最新代码；问题在代码/API/配置，直接查证
2. Electron 主进程禁止 spawnSync/execSync 做耗时操作（pip 安装/解压/探测会致界面"未响应"）→ 用异步 runAsync
3. 只改 AGENT 相关；其它手动页面一律不动
4. 改前先讨论/备份；不猜，要实测验证
5. 操作后更新 EXECUTION_LOG.md + PROJECT.md + ISSUES.md
6. git 提交：默认不提交；需要时先问用户（本仓库有其它 AI 的版本，别搞乱历史）
```

**技术坑（都踩过）**
```
· ★ getter 对象陷阱（2026-09-14，我自己踩的）：把路径常量改成 {toString(){}} 以"零改动"，
  但 path.join() / fs.mkdirSync() / spawn args 【只认字符串】→ TypeError → 发布中断。
  → 改常量类型必须逐处确认调用方是否需要 string。
· ★ 漏 import 陷阱（2026-09-14，也是我）：chat/route.ts 用 PLATFORM_NAMES 但没 import
  → 运行时 ReferenceError → API 500 → 前端"点了没反应"（无任何提示）。
  → 改完必须 npx tsc --noEmit，别只看"跑得起来"。
· 抖音封面：不要判断横竖屏（抖音自己识别）；点「设置横封面」会与"设置横封面获更多流量"引导弹窗同名按钮撞车
· 微博入口：只 goto https://weibo.com（首页）再找 input[type=file]；不要直接开 /upload/channel（那页 input 是 image/*）
· 视频号发布器在 iframe，且该 iframe 内 Playwright locator 完全失效（count=0）→ 遍历 page.frames() 找 input[accept*=video]
· 小红书发表按钮 <xhs-publish-btn> 是 closed shadow DOM → 必须 CDP 穿透 / 像素定位
· React/Vue 页面必须真实点击（locator.click / mouse.click），不能 dispatchEvent
· frame.evaluate 自算坐标会偏（视频号 iframe 实测偏 400px）→ 用 CDP DOM.getBoxModel 拿准确视口坐标
· 打包选平台时：改 electron/platforms.generated.js 无效 —— 它是生成的，改 platforms.ts 后跑 gen 脚本
· nginx 主应用 60s 超时（封面同步会断）→ 需 proxy_read_timeout 300s
```

---

## 6. 常用命令

```bash
# ── 部署服务器（唯一命令；服务端代码改动后必做）──
cd /root/AiMarketing && git fetch origin && git reset --hard origin/master && bash scripts/deploy-server.sh

# ── 打包客户端（本地 Windows，约 13 分钟，产物 ~333MB）──
node scripts/bump-version.mjs X.Y.Z     # 同步 package.json + electron/version.json + changelog.json
#   ↑ bump 后【必须手动补】changelog.json 第一条的 title/items
node scripts/build-local.mjs            # → dist-rel/AI-Marketing-Setup-X.Y.Z.exe + .blockmap + latest.yml

# ── 发版（上传 OSS）──
scp dist-rel/{exe,exe.blockmap,latest.yml} root@<server>:/root/AiMarketing/public/updates/
# 服务器：node scripts/upload-update-oss.mjs public/updates
#        cp public/updates/latest.yml .next/standalone/public/updates/latest.yml && pm2 restart aimarketing

# ── 类型检查（改完 TS 必跑）──
npx tsc --noEmit 2>&1 | grep -E "chat/route|platforms|publish-task"   # 只关注 AGENT 相关文件

# ── 浏览器 CDP 探活 ──
curl -s -m 5 -o /dev/null -w "%{http_code}" http://127.0.0.1:9222/json/version

# ── 客户机诊断（在那台机器上跑）──
python "E:\ai-marketing\resources\scripts\browser-use\bu_check.py" "E:\ai-marketing\data\browser-profile"
Get-Content "E:\ai-marketing\data\bu_debug.log" -Tail 30
Select-String -Path "E:\ai-marketing\data\bu_debug.log" -Pattern "任务#|不执行|未登录|走确定性脚本|iso|bu-python" | Select-Object -Last 20
```

**日志关键词速查（`data\bu_debug.log`）**
```
轮询：HTTP=200 任务数=N        ← 任务队列（0=没有任务；有任务才会有后面的事）
任务#N 走确定性脚本 bu_pub_*    ← ★ 发布真正开始
任务#N 登记浏览器未开（CDP 9222 不通）——自动启动   ← 正常（会自动开浏览器）
任务#N 登录态预检=... → 未登录X，不执行（浏览器没开的原因） ← 被预检拦
任务#N 缺 Python 运行环境       ← 被环境拦
[iso] 当前账号 userId=N        ← 账号隔离生效
[bu-env] 模块加载成功/失败       ← 环境自检是否可用
[hot] A类/B类 ... 采集结果      ← 热点采集
TypeError: The "path" argument must be of type string   ← getter 陷阱（已修）
```

---

## 7. 排查范式（用最近一次故障演示）

**现象**：点小红书正常，点微博没反应（不建任务、不开浏览器）；客户端日志"任务数=0"一直不变。

**逐步排除（每步都必须有证据）**
```
1. 看客户端日志有没有 [iso] → 有 → 说明装的是含新代码的包（1.0.160）
2. 对比 exe 时间（客户机 11:41 = dist-rel 里 1.0.160 的时间）→ 确认版本一致
3. 看客户端日志有没有跑过任务 → 任务#33 小红书跑完了 → 【客户端侧没问题】
4. 用 npx tsc --noEmit → ★ 抓到 chat/route.ts(1885) PLATFORM_NAMES 未定义 → 真因
5. 解释"为什么有的平台行"：小红书那次 step=full（不经过该分支）；微博那次 step=plat（命中→崩）
```

**教训**：客户端日志能证明"任务有没有到客户端"；如果任务数=0，就**不要再查客户端**，要往服务端/前端走。

---

## 8. 遗漏检查表（本文档 vs 现状 —— 新接手请逐条确认）

| # | 项 | 状态 | 备注 |
|---|---|---|---|
| 1 | 部署服务器（513d831） | ⏳ **未做** | 不做则"点平台没反应"依旧 |
| 2 | 小红书脚本（PK/封面/禁止笔记） | 🟡 已做拟人化，待实测 | 用户账号被限制发布；拟人化只降风险 |
| 2b | 视频号脚本入口缺失 | ✅ 已修 `6f59379`（v1.0.162）| 待装包验证 |
| 3 | 微博/视频号/B站/快手脚本验证 | 🔴 未验证 | 只有抖音(9/12)和小红书(9/14)跑过 |
| 4 | 环境不可用【前端提示 + 一键安装】 | 🔴 未做 | 原需求只完成了后端记账 |
| 5 | 内置 Python 环境装不上（每次重装） | 🟡 未查清 | builtin:true+ok:false，靠系统 python 兜底 |
| 6 | 热点采集客户端侧（B类/未登录平台） | 🟡 未验证 | 客户机今天被旧标记挡住 |
| 7 | 热点上报 401 修复验证 | 🟡 未验证 | 80a33f0 |
| 8 | 抖音封面修复验证 | 🟡 未验证 | ad23732 |
| 9 | 账号隔离"换账号"实测 | 🟡 未验证 | 单账号已验证 |
| 10 | 1.0.159 含 bug | ⛔ 别发 | 用 1.0.160 |
| 11 | 标准/自由模式文件级隔离 | 🟡 历史待办 | free-flow.ts / standard-flow.ts 物理抽取 |
| 12 | 热点无国内源 | 🟢 可能已解决 | 已加头条/百度，待验证 |
| 13 | 对话内重发 #N | 🟡 待验证 | 32fe01f 已实现 |

---

## 9. 一句话总结

**客户端侧（1.0.160）已经全部正常**；当前卡点是 **① 服务端没部署** 和 **② 各平台发布脚本要用户手动实测跑通后再改**。
