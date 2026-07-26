# 指纹浏览器端口策略 & 多平台录入模板 & 订阅门控（实施方案，未动手）

> 状态：✅ 代码已实现（待 build 部署验证）。关键架构发现：浏览器实际在 **Electron 客户端本地启动**，服务器端口池由客户端「申请/释放」调用，并非服务器直接 launch。
> 范围：指纹浏览器动态端口池(方案D) + 全局订阅到期全停(本次一起做) + 魔云腾授权保留
> 关键文件：src/lib/browser-manager.ts、src/lib/quota-manager.ts、src/app/api/browser/route.ts、src/app/api/accounts/route.ts、src/app/my-fingerprint/page.tsx、src/middleware.ts、src/lib/subscription-guard.ts、src/app/admin/social-accounts/page.tsx

---

## 〇、已拍板决策（用户确认）

1. **同平台账号**：每用户每平台 **1 个账号**；要多开同平台需再订阅一个名额（实现上=另一用户/订阅槽）。
2. **端口池**：默认 9220~9320（100 个）暂够用。
3. **全局订阅门控**：本次一起做——"订阅到期就什么都用不了"。
4. **旧数据**：`Account.cdpPort` 旧值保留不清理，仅停止新写入。
5. **admin/social-accounts**：仍可查看端口信息，但**去掉手动授权/分配端口**动作。
6. **魔云腾（Q1 云手机）**：**仍需要授权才能绑定**，面向代理商批量运维——本次**不改**其授权流程。

---

## 一、指纹浏览器：动态端口池 + 用完释放（方案 D）

### 1.1 设计要点
- 启动浏览器时，服务端从空闲池**任选一个端口**（随机，避免"总给第一个"），**不写库、不绑账号**。
- profile 目录按**用户+平台**落盘：`/root/browser-data/u{userId}-{platform}`（同用户同平台唯一；多账号需求=另一订阅槽，天然隔离）。
- `my-fingerprint` 点"停止" → `DELETE /api/browser?port=xxx` → 关浏览器并**释放端口**（仅从运行池移除，磁盘 profile 保留）。
- 端口占用 = **同时运行的会话数**，与账号数/平台数无关。

### 1.2 现状病根（代码已核对）
- `quota-manager.ts:82` `allocateCdpPort` 在**绑账号时**永久写 `Account.cdpPort` + `fingerprintUsed+1`；旧注释称"由 Admin 审核时手动分配"→ 人工常填 9220（即"老给第一个端口"）。
- `browser-manager.ts:129` `stopBrowser` **只关进程不释放**，端口永久被占（即"给再多也没用"）。
- `browser/route.ts:116` 初始 URL 写死抖音。

### 1.3 改动文件（指纹部分）

| 文件 | 改动 |
|------|------|
| `src/lib/browser-manager.ts` | `startBrowser(port, profileKey)`：`userDataDir=/root/browser-data/${profileKey}`；`stopBrowser` 仅从 `activeBrowsers` 移除、不删磁盘目录；去掉"一账号一端口"旧注释 |
| `src/lib/quota-manager.ts` | 删除"绑账号写死端口+永久占用"；新增 `acquireCdpPort()`（选不在 `activeBrowsers` 中的空闲端口，可随机）；新增 `releaseCdpPort(port)`（清理/计数）；端口范围配置保留 |
| `src/app/api/browser/route.ts` | POST 启动不再要前端传固定 port，服务端 `acquireCdpPort()`+`startBrowser(port, profileKey=userId-platform)` 并返回 port；初始 URL 按 `platform` 取（去抖音硬编码）；DELETE 停止调 `stopBrowser`+`releaseCdpPort` |
| `src/app/my-fingerprint/page.tsx` | "启动"不再读 `acct.cdpPort`，改用服务端返回 port 存组件 state；"停止"调释放；账号列表"端口"展示改"运行时动态分配"；去掉"申请端口/授权"相关 UI |
| `src/app/api/accounts/route.ts` | 绑 manual 账号**不再** `allocateCdpPort`/写 `cdpPort`；解绑**不再** `releaseCdpPort`；**新增每用户每平台唯一校验**（已存在则拒："该平台已绑定，多开需再订阅名额"） |
| `dashboard/sync/route.ts`、`agent/chat/route.ts` | 读 `a.cdpPort` 展示处降级为"动态端口/不展示固定端口"（兼容旧值，非阻断） |

> 客户端 Electron `window.electronAPI.fpExecute(port,...)` 不受影响：port 来自前端 state（服务端分配响应）。

---

## 二、全局"订阅到期全停"（本次一起做）

### 2.1 设计
- 复用 `UserSubscription`（`status='active'` 且 `endDate>=now` 为有效）。`quota-checker.ts:20` 已有同款查询逻辑。
- 落地在 **`src/middleware.ts`**（当前仅做 JWT 鉴权，matcher=`/api/*`，有白名单）——这是真正的全局唯一落点，无需改 50 个路由。
- 中间件在 JWT 校验通过后，对**非 admin 角色、非白名单**路径查询订阅；无有效订阅 → `403 { message:'订阅已到期或未订阅，请前往订阅页购买' }`。
- 阻塞 `/api/*` 后，前端页面因取不到数据即"全停"，无需改页面文件。

### 2.2 必须白名单（否则无法购买/登录）
- `/api/auth/*`（登录/注册）
- `/api/subscription/*`（含 my-usage、checkout、buy、order 轮询）
- `/api/payment/*`（含 alipay/wechat notify 回调）
- 现有 `API_WHITELIST`（heartbeat、storage/file、tts、migrate 等）
- `role === 'admin'` 整体豁免（运营/管理员不受订阅限制）

### 2.3 改动文件（订阅门控）

| 文件 | 改动 |
|------|------|
| `src/lib/subscription-guard.ts`（新增） | 导出 `hasActiveSubscription(userId): Promise<boolean>`（复用 quota-checker 的查询条件）；可选 `requireSubscription(userId)` 抛出型，供指纹代码显式调用 |
| `src/middleware.ts` | 设 `export const runtime = 'nodejs'`（Prisma 需 Node 运行时不走 Edge）；JWT 通过后对非 admin、非白名单路径调 `hasActiveSubscription`，未过则 403；白名单补 auth/subscription/payment |

> 注意：中间件引入 DB 查询会显著增加每请求开销；本平台并发低可接受。若日后性能吃紧，可改为 JWT 内嵌 `subExp` 声明 + 购买/续费时刷新 token 的轻量方案（备查，非本次）。

---

## 三、管理端调整

| 文件 | 改动 |
|------|------|
| `src/app/admin/social-accounts/page.tsx` | 保留端口/账号信息**展示**；**移除 manual(指纹) 账号的"手动授权/分配端口"按钮**（端口改运行时动态，无需授权）。魔云腾/Device 绑定授权 UI **保留不动** |
| 魔云腾 / Q1 / Device 绑定 | **本次不改**：仍走授权流程（代理商批量运维用） |

---

## 四、实施记录（已完成）

1. ✅ `src/lib/quota-manager.ts` — 删除旧"按账号永久绑端口"逻辑；新增 `allocateCdpPort(userId, platform)`（运行时注册表，`userId-platform` 复用同一端口）+ `releaseCdpPort(port)` + `getPortRange()`/`getOccupiedPorts()`。端口池 9220~9320 全局共享。
2. （无需改）`src/lib/browser-manager.ts` — 经核对此流程浏览器在 Electron 客户端本地启动，服务器 `browser-manager` 不是实际运行方，故未改；端口池由新接口 `allocate/release` 管理。
3. ✅ 新增 `src/app/api/browser/allocate/route.ts`（POST 申请空闲端口）+ `src/app/api/browser/release/route.ts`（DELETE 释放端口）。订阅校验由中间件拦截。
4. ✅ `src/app/api/accounts/route.ts` — 去掉 `allocateCdpPort/releaseCdpPort`；指纹绑定不再分配固定端口；新增**每用户每平台唯一**校验（409 提示"多开需再订阅名额"）；Q1/设备绑定授权保留。
5. ✅ `src/app/my-fingerprint/page.tsx` — 启动先 `POST /api/browser/allocate` 拿动态端口再 `fpStart`；停止先 `fpStop` 再 `DELETE /api/browser/release`；`userDataDir` 改为 `userId-platform`（见 electron）；运行态基于 `runningPort/activeAccountId`。
6. ✅ `src/lib/subscription-guard.ts`（新增）— `hasActiveSubscription(userId)`。
7. ✅ `src/middleware.ts` — 改 `runtime='nodejs'`（显式 import `createHmac/timingSafeEqual` from 'crypto'）；全局订阅门控（非 admin 无有效订阅 → 403，容灾放行）；白名单含 `/api/auth`、`/api/subscription`、`/api/payment` 等。
8. （无需改）`src/app/admin/social-accounts/page.tsx` — 经核实 manual 账号本就"系统自动分配端口，无需手动输入"，**无手动授权按钮可移除**，仅展示。魔云腾/Q1 授权 UI 保留。
9. （可选/未做）`dashboard/sync`、`agent/chat` 仍读 `Account.cdpPort`（现 nullable，显示 null 不报错）；如需可降级为"动态端口"。

### 部署验证要点
- 服务器拉取后 `npm run build && pm2 restart aimarketing`（标准三步）。
- 客户端 Electron 需重新打包（electron/main.js 改动 `getUserDataDir`/`fp:start`），并递增 `version.json`。
- 全局订阅门控上线后，务必确认 `/api/subscription/*` 与订阅购买页在"未订阅"态可访问，否则用户卡死无法购买。

---

## 五、待实施时现场确认的小点
- admin/social-accounts 页面中"手动授权"控件的具体位置/文案，实施第 8 步时按实际 DOM 精确定位，避免误删魔云腾授权入口。
- 全局门控上线后，确认 `/api/subscription/my-usage` 与订阅页在"未订阅"态下仍可访问（否则用户卡死无法购买）。
