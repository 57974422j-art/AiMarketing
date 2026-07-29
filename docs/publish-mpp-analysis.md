# MoneyPrinterPlus 发布模式分析与改造方案

> 背景：用户发现指纹浏览器多平台发布的两个问题——①扫码登录后账号「保存不住」；②新增的 5 个平台（抖音/小红书/快手/视频号/B站）发布均不可用。用户提供了两个开源项目，本方案聚焦 **MoneyPrinterPlus** 的发布模式能否「直接克隆」以及如何借鉴。PostBot（浏览器扩展形态）因架构不兼容仅作对比，不纳入克隆范围。

---

## 0. 结论速览

- **能否直接克隆 MoneyPrinterPlus 的发布模式？** ❌ 不能。
  - 它是 **Python + Selenium + WebUI（Flask/Streamlit）** 项目；我们是 **Node + Electron + Playwright**。语言、运行时、自动化库三者全不兼容，Python 代码无法在原地运行。
- **能否借鉴其「发布模型」？** ✅ 能，且收益高、风险低。
  - 我们**已经具备等价能力**：Electron 起 Playwright `launchPersistentContext` ≈ MPP 用 Selenium 复用 Chrome `user-data-dir`。两者的登录态持久化思路本质一致。
  - 真正缺的是两块：
    1. 登录态**按账号维度**持久化 + **状态回写**到 Account 表（目前只落磁盘、从不通知后端/前端）。
    2. 发布脚本的**健壮选择器**（等待元素出现 + 重试 + 超时兜底），目前全部硬写死，平台一改版即崩。
- **实际可落地的做法**：不搬 Python 代码，而是把 MPP 的「每平台独立模块 + 统一接口 + 持久登录 + 健壮性」模式**映射到我们现有文件**，并修复两个 bug。

---

## 1. MoneyPrinterPlus 发布模式剖析

| 维度 | MoneyPrinterPlus 做法 |
| --- | --- |
| 技术栈 | Python；浏览器自动化用 **Selenium**（驱动 Chrome）；成片用 AI（chatTTS/faster-whisper/GPTSoVITS/云语音） |
| 发布架构 | 每个平台一个独立 publish 模块（`douyin_publish` / `kuaishou_publish` / `xiaohongshu_publish` / `shipinhao_publish`），统一入口调用 |
| 登录态持久化 | Selenium 复用 Chrome 的 **`user-data-dir`**，cookie 落在用户 Chrome 配置目录；首次扫码登录后，后续启动直接带登录态，**无需重新扫码** |
| 发布流程 | 上传视频 → 填标题/话题/正文 → 选封面 → 点发布；过程中靠 **等待目标元素出现 + 超时兜底** 推进 |
| 支持平台 | 抖音、快手、小红书、视频号（**不含 B站**） |
| 交互形态 | 本地 WebUI，用户点一下触发，后端 Selenium 驱动浏览器 |

**核心启示**：MPP 的「稳定性」来自两点——(a) 登录态靠浏览器 profile 目录天然持久；(b) 发布靠「等元素出现」而非「猜 class」。这两点正是我们 5 平台脚本缺的。

---

## 2. 直接克隆可行性判定（对比表）

| 对比项 | MoneyPrinterPlus | 我们 AiMarketing | 能否直接复用 |
| --- | --- | --- | --- |
| 语言 | Python | TypeScript/Node | ❌ 不可直接跑 |
| 自动化库 | Selenium | Playwright（Node） | ❌ API 不同，但概念等价 |
| 持久登录 | Chrome user-data-dir | Playwright `launchPersistentContext` | ✅ 等价，已具备 |
| 每平台模块 | `xxx_publish.py` | `electron/fp-templates/*.js` | ✅ 结构可对齐 |
| 选择器/步骤 | 社区维护、随平台更新 | 我们自研、硬写死、已过时 | ⚠️ 需借鉴其逻辑重写 |
| 前端形态 | 本地 WebUI | Electron + Next.js 网页 | 各自独立 |

**判定**：架构层面「发布模型」可借鉴，代码层面「不可直接克隆」，只能**移植思路 + 重写选择器**。

---

## 3. 可借鉴要点 → 映射为我们现有能力

1. **每平台独立模块 + 统一接口**
   - MPP：`douyin_publish` / `kuaishou_publish` / ... 统一被调度。
   - 我们：已有 `electron/fp-templates/{douyin,xiaohongshu,kuaishou,shipinhao,bilibili}-publish.js`，统一导出 `executeXxxPublish(page, params, log)`，main.js `fp:execute` switch 分发。**结构已对齐，只需补齐 4 个未完成的 + 统一签名**。
2. **登录态持久化（= 我们的 persistent context）**
   - MPP 靠 user-data-dir 天然持久。我们 `launchPersistentContext(userDataDir=appData/browser-profiles/{port})` 也已落盘。
   - **但我们有两个缺陷要修**：①目录维度是 `userId-platform` 而非 `accountId`，同用户多同平台账号会争用；②从不把「已登录」状态回写 Account 表，前端只能靠内存 `needLoginIds`，刷新即失。
3. **健壮性：等待 + 重试 + 超时兜底**
   - 把硬写死的 `page.locator('.xxx').click()` 改为 `waitForSelector` + 重试 N 次 + 超时抛 `needLogin`/失败，参考 MPP 的发布流。

---

## 4. 我们的改造方案（对接 MPP 模式）

### 4.1 第一层：登录态持久化修复（高价值 / 低风险，先修「保存不住」）

**根因**：profile 目录维度错 + 状态不回写 + 抖音无登录检测。

**文件改动清单**：
1. `electron/main.js`
   - `launchPersistentContext` 的 `userDataDir` 由 `browser-profiles/${userId}-${platform}` 改为 `browser-profiles/${accountId}`（解决多账号争用、错绑）。
   - 在 `fp:stop`（或新增 `fp:saveLogin`）中：用 `context.cookies()` 导出存盘（可选加固），并调用 `PUT /api/accounts/:id` 写回 `status='已登录'`、`loggedInAt=now`。
   - 抖音脚本补充 `isLoggedIn` 检测（对齐其他 4 平台）。
2. `prisma/schema.prisma`（若需新增字段）
   - `Account` 已有 `accountId`/`platform`/`bindType`/`status`；如需显式存 cookie 可加 `cookies String?`。**按需，不强制**（persistent context 已落盘）。
3. `src/app/api/accounts/...`（现有 accounts 路由）
   - 确保支持 `PUT` 更新 `status`/`loggedInAt`（供 main.js 回写）。
4. `src/app/my-fingerprint/page.tsx`
   - `needLoginIds` 改为**读 Account.status 字段**（来自后端），不再仅内存数组；刷新后按后端状态显示「去登录 / 已登录」。

**效果**：扫码登录一次 → 状态写回后端 + cookie 落 accountId 目录 → 下次启动直接带登录态、前端显示已登录，解决「保存不住」。

### 4.2 第二层：5 平台脚本重写（借鉴 MPP 选择器 + 健壮性）

**文件改动清单**：
- `electron/fp-templates/douyin-publish.js`：补 `isLoggedIn` 检测；引入 wait+retry 兜底。
- `electron/fp-templates/xiaohongshu-publish.js`：已有样板，升级为统一 wait+retry 模式。
- `electron/fp-templates/kuaishou-publish.js`：补全（参考 social-auto-upload 选择器）。
- `electron/fp-templates/shipinhao-publish.js`：重写「无表单也无登录入口就放行」的误判（先判登录态再判上传入口）。
- `electron/fp-templates/bilibili-publish.js`：修 `isLoggedIn` 永远返回 true 的 bug（改为真实登录态探测）；补必填分区+标签。
- `electron/main.js`：`fp:execute` switch 与各脚本 `require` 保持；统一返回值 `{success, message, needLogin?, needConfirm?}` 透传。

**健壮性范式（每平台脚本统一采用）**：
```
1. 打开平台发布页
2. waitForSelector(登录入口 OR 已登录特征) → 超时则返回 {needLogin:true}
3. 若检测到未登录 → 返回 {needLogin:true, message:'请扫码登录'}
4. 上传视频 waitForSelector(上传成功)
5. 填标题/话题/正文（waitForSelector 每个字段）
6. 封面：有则上传并确认；无则用平台默认（方案A）
7. 点发布 → waitForSelector(发布成功特征) → 返回 {success:true}
任意步超时 → 返回 {success:false, message:'步骤X超时'}
```

### 4.3 统一发布引擎（可选，降冗余）
- 把 5 个脚本重复的「上传/填标题/点发布/wait」抽成 `electron/fp-templates/_common.js` 的 helper（如 `uploadVideo(page, path)`、`fillTitle(page, title)`、`clickPublishAndWait(page)`），各平台脚本只保留差异化选择器。降低后续维护成本。

---

## 5. 实施顺序与确认节点（按项目铁律：一次一文件，改完等确认）

1. `electron/main.js`（登录态目录维度 accountId + 回写 status）— 单独改、单独确认
2. `src/app/api/accounts` 路由（PUT 回写 status）— 确认
3. `src/app/my-fingerprint/page.tsx`（needLogin 改读 Account.status）— 确认
4. `electron/fp-templates/douyin-publish.js`（补 isLoggedIn）— 确认
5. `xiaohongshu / kuaishou / shipinhao / bilibili` 四个脚本逐个重写 — 逐个确认
6. （可选）`_common.js` 抽取公共 helper — 确认

> 注：高风险文件（`prisma/schema.prisma`、`electron/main.js`）按规则单独改、单独确认。

---

## 6. 风险与未决问题

- **实际选择器需届时提取**：当前网络对 GitHub 源码抓取受限，MPP 每个平台的具体 DOM 选择器/步骤需在**实现阶段**从其源码（或镜像站 Gitee）读取作参考。本方案先定「模型与脚手架」，选择器为实施前置。
- **B站缺口**：MPP 不支持 B站，B站脚本需另寻源（MediaCrawler / fjwang1/codexSkill 等）或自研；本方案将其列为「自研/另寻源」，不在 MPP 借鉴范围内。
- **平台反爬/风控**：无论 MPP 还是我们，平台改版都会让选择器失效，需建立「真机跑后按 Electron 面板日志微调」的维护节奏（已有此规划）。
- **登录态失效**：cookie 有过期/二次验证风险，需保留 `needLogin` 兜底让用户重新扫码。

---

## 7. 待用户拍板

1. **第一层（登录态持久化）是否先做？** 推荐先做——直接解决「保存不住」，改动集中、风险低。
2. **5 平台重写**，倾向：
   - A. 我们参照 MPP 模式**自研硬修**（慢、可控、贴合现有 Electron 架构）；或
   - B. **直接移植 MPP 各平台发布逻辑**到 `.js`（快、但需对齐我们 `fp:execute` 调度与返回值）。
3. **是否一并做 4.3 统一发布引擎**（降冗余，但改动面更大）？
4. **B站**是否本期就要（MPP 不支持，需额外源）？还是本期先保抖音/小红书/快手/视频号 4 个，B站后续？
