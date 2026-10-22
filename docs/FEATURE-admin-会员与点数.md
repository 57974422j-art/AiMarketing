# 需求：后台「会员与点数」操作面板（管理员自己给用户加时长 / 加点数）

> 本文是**执行单**，拿去新窗口直接做。所有行号已核对（2026-10-22）。
> **不要问用户需求**，需求都在本文里；有疑问按"三、关键约束"执行。

---

## 0. 一句话需求（用户原话）

> 「**后台怎么能加个功能，我自己去加时间**。」（点数同类需求，一起做）

管理员在后台点开某个用户 ⇒ 能：
1. **加会员时长**（+7 天 / +30 天 / +90 天 / +1 年 / 自定义天数）
2. **换套餐**（立即生效，比如从周卡换成旗舰年卡）
3. **加点数**（永久点数 `pointBalance`，带备注）

**现在只能手敲 Prisma 脚本改数据库**（2026-10-22 已经这样给 `xiaoliu` 开过一次年卡）。

---

## 1. 现状（必须先看，否则会重造轮子）

### 1.1 后台现有结构

| 页面 | 现状 |
|---|---|
| `src/app/admin/users/page.tsx` | **客户管理**：只能改「窗口配额」（`PUT /api/admin/editor-quota`）。**没有**改会员/点数/角色/密码的入口 |
| `src/app/admin/subscription/page.tsx` | **只有 `SubscriptionPlan`（套餐定义）CRUD** |
| `src/app/admin/point-cards/page.tsx` | **只有 `PointCard`（点卡商品）**，不是给用户加点数 |
| `src/app/admin/orders/page.tsx` | 订单查询，**只读** |
| **`UserSubscription`（用户订阅实例）** | ❌ **后台完全没有页面/接口** ← **本需求补的就是这个** |

### 1.2 关键约定

| 约定 | 位置 | 说明 |
|---|---|---|
| **「当前生效订阅」判定** | `src/lib/token-wallet.ts:160-171` `pickActiveSubscription()` | `status==='active' && endDate >= now`，**多条取 endDate 最大** |
| **加点数（现成函数）** | `src/lib/token-wallet.ts:313-326` `addPointBalance(userId, amount, reason)` | 内部 `increment` + 写 `usageLog`（`model: 'recharge:'+reason`）⇒ **必须复用，不要自己 `update`** |
| **权限样板** | `src/app/api/admin/users/route.ts:18-21`、`editor-quota/route.ts:17-19` | `getAuthFromHeaders()`（`src/lib/api-auth.ts:9-36`）+ `auth.role !== 'admin'` ⇒ 403 |
| **UI 体系** | 纯 Tailwind 自研 | 裸 `<table className="w-full text-xs">`、手写 `fixed inset-0` 弹窗、`showToast`（`src/components/Toast.tsx:9-17`）、`input-dark`（`src/app/globals.css:71`） |
| **请求** | 全裸 `fetch(...{credentials:'include'})` | 无 axios / 无 SWR |

---

## 2. 目标 UI（后端两个接口 + 前端一个弹窗）

```
后台 → 客户管理 → 每个用户卡片 → 新增按钮「👑 会员 / 点数」
        ↓ 弹窗（骨架照抄 admin/users/page.tsx:212-246 那个配额弹窗）
┌──────────────────────────────────────────┐
│ 当前：旗舰年卡 · 到 2027-10-22            │
│ 点数余额：0                                │
├──────────────────────────────────────────┤
│ ① 加时长   [+7天] [+30天] [+90天] [+1年]   │
│           自定义 [____] 天                 │
│ ② 换套餐   [套餐下拉] [立即生效]            │
│ ③ 加点数   [+1000] [+5000] [+10000]        │
│           自定义 [______] 点               │
│           备注 [____________]（记账用）     │
└──────────────────────────────────────────┘
```

---

## 3. 关键约束（⚠️ 这三个坑是本文档的核心，违反就等于改坏账）

### 坑 ① 「延长」**不能**照抄现有开通逻辑

现有开通的写法是**先清空再新建**：

- `src/app/api/payment/alipay/notify/route.ts:109-119`：先把该用户所有 `active` 置 `expired`，再 create 一条
- `src/app/api/subscription/my-usage/route.ts:43-46`：同上
- `src/app/api/subscription/claim-weekly/route.ts:87-103`：只做前置校验

⇒ **如果"加时长"照抄它，会把已有的 `endDate` / `orderNo` 丢掉**（等于把两年改成一年）。

**正确语义**：

| 操作 | 做法 |
|---|---|
| **加时长** | 找到当前 active 那条 ⇒ **`update` 它的 `endDate`（原值 + N 天）**；没有 active ⇒ 才新建（`startDate=now`） |
| **换套餐** | 才走"清旧 active + 插新"（`endDate = now + 套餐 durationMonths`） |
| **套餐 `durationMonths=0`**（免费周卡） | `endDate = now + 7 天`（照 `notify:102-106` 的特判） |

### 坑 ② 改订阅**必须同步两个冗余快照**

`User.plan`（`prisma/schema.prisma:23`）与 `User.paidFeatures`（`schema.prisma:69`）是**冗余快照**，每次开通都同步写：

- `notify/route.ts:122-129`
- `claim-weekly/route.ts:96-103`
- `my-usage/route.ts:47-51`

⇒ **照抄这三处里任意一处的同步写法**（不要自己编 `paidFeatures` 的结构）。
⇒ 只改订阅表、不同步这两个 ⇒ **老功能门控（`checkFeatureAccess`）会与实际不符**。

### 坑 ③ 延长 `endDate` **不会重置**本月已消耗额度

额度按 `startDate` 起算、按月刷新（`token-wallet.ts:120` `ALLOWANCE_PERIOD_MODE='period'`、`:137-145` `allowancePeriodStart()`、`:213-219`）。

⇒ **界面上必须写一句提示**：「加时长只延长有效期；本月额度不会重置（按月自动刷新）」。
⇒ 如果他当月额度用完了想立刻续用 ⇒ 用「加点数」（`pointBalance` 优先扣月额度、用完再扣余额）。

---

## 4. 改动清单

### 4.1 新建 `src/lib/subscription-grant.ts`（统一逻辑，**别再复制第 4 份**）

导出三个函数：

```ts
/** 给用户加时长（保留原记录）；没有 active 则新建 */
export async function extendSubscription(prisma, userId: number, days: number, opNote?: string): Promise<{ endDate: Date; mode: 'extended' | 'created' }>

/** 换套餐（清旧 active + 插新 + 同步快照） */
export async function switchSubscription(prisma, userId: number, planId: number, opNote?: string): Promise<{ endDate: Date }>

/** 只同步 User.plan / User.paidFeatures（内部用） */
export async function syncUserPlanSnapshot(prisma, userId: number, planId: number): Promise<void>
```

要求：
- `switchSubscription` 里**照抄** `notify/route.ts:99-129` 的 endDate 计算与快照同步（含周卡特判）
- `extendSubscription` 用 `update`，**绝不清旧记录**
- 全部走 `prisma.$transaction`

### 4.2 新建 `src/app/api/admin/subscriptions/grant/route.ts`

```
POST  body: { userId:number, action:'extend'|'switch', days?:number, planId?:number, note?:string }
```

- **第一行必须鉴权**：`const auth = getAuthFromHeaders(); if (!auth || auth.role !== 'admin') return 403`
- `action==='extend'` ⇒ `days` 必须 1~3650 ⇒ 调 `extendSubscription`
- `action==='switch'` ⇒ `planId` 必须存在且 `status==='active'` ⇒ 调 `switchSubscription`
- 返回：`{ success:true, endDate, mode, planName }`

### 4.3 新建 `src/app/api/admin/point-balance/route.ts`

```
POST  body: { userId:number, points:number, note?:string }
```

- 同样**必须鉴权**
- `points` 允许负数（扣点），范围 -1000000~1000000，**不允许 0**
- 调 **`addPointBalance(userId, points, note || 'admin-grant')`**（`token-wallet.ts:313-326`）
- 返回：`{ success:true, pointBalance }`（回读最新余额）

### 4.4 改 `src/app/admin/users/page.tsx`

| # | 位置 | 改什么 |
|---|---|---|
| 1 | `:163-168`（卡片按钮区，仓库按钮旁） | 加一个「👑 会员 / 点数」按钮 ⇒ `setGrantUser(u)` |
| 2 | `:212-246` 附近 | **照抄那个配额弹窗的骨架**，新建 `GrantModal`（三个区块：加时长 / 换套餐 / 加点数） |
| 3 | `:91-108`（保存逻辑写法） | 照抄它的 `fetch + showToast + 刷新列表` 模式 |
| 4 | `:150`（`planName` 展示处） | 弹窗顶部显示「当前：{planName} · 到 {endDate}」⇒ **需要列表接口多给 `endDate`** |

⚠️ `:8-10` 有注释说明 `User.plan`（字符串）是**历史遗留不可信**，界面显示用 `planName` ⇒ **弹窗也照此**，用 `planName`。

### 4.5 改 `src/app/api/admin/users/route.ts`（列表多给两个字段）

`GET` 的 `select` 里加：

```ts
userSubscriptions: { where: { status: 'active' }, orderBy: { endDate: 'desc' }, take: 1, select: { endDate: true, plan: { select: { name: true } } } }
```

⇒ 前端 `planName` / `endDate` 就有来源（现有 `:48-52` 已经在按 `endDate gte now` 查，**复用同一份条件**，不要另写一套）。

### 4.6 后台首页导航（可选，只在做成独立页时才需要）

`src/app/admin/page.tsx:16-70` 的硬编码 `sections` 加一张卡。

---

## 5. 审计（P1 用取巧方案，不建表）

现状**没有**任何"谁改了什么"的表（全仓无 `AdminLog`）。

P1 做法（零成本）：
- **加点数**：`addPointBalance(userId, n, 'admin:' + auth.userId + (note ? ':' + note : ''))`
  ⇒ `reason` 会写进 `UsageLog.model`（`recharge:admin:1:补送`）⇒ **能查是谁加的**
- **加时长 / 换套餐**：写一条 `UsageLog`
  `{ userId, action: 'admin_grant', tokens: 0, model: 'sub:' + auth.userId + ':' + (note||'') }`

⚠️ 这是**借用字段**，正规做法（`AdminLog` 表 + `prisma db push`）留到 P3。

---

## 6. 权限（必须照对的范式，别抄坏的）

⚠️ 现有几个 admin 接口**没有鉴权**：`admin/subscription-plans/*`、`admin/payment-settings`、`admin/test-key`
（`GET /api/admin/subscription-plans` 被前台 `src/app/my-subscription/page.tsx:66` 直接调用，所以它没加校验 —— **新接口不要照抄这个坏范式**）。

**新接口第一行固定写**：

```ts
import { getAuthFromHeaders } from '@/lib/api-auth'
const auth = getAuthFromHeaders()
if (!auth || auth.role !== 'admin') return NextResponse.json({ error: 'forbidden' }, { status: 403 })
```

---

## 7. 边界（不影响什么）

| 不碰 | 理由 |
|---|---|
| ❌ `payment/alipay/notify`、`claim-weekly`、`my-usage` | 支付链路一行不动（只**照抄**其逻辑到新 lib） |
| ❌ 用户端任何页面 | 本需求纯后台 |
| ❌ 7 条制片线的任何文件 | 无关 |
| ❌ `SubscriptionPlan` / `PointCard` 的现有 CRUD | 不动 |

---

## 8. 验收标准（做完必须真跑，不能只看代码）

1. **加 30 天**：找 `xiaoliu`（id=18，当前年卡到 2027-10-22）⇒ 点「+30天」⇒ 弹窗刷新为 **2027-11-21**；
2. **再点一次 +30 天** ⇒ 变 **2027-12-21**（**累加，不是重置**）；
3. **数据库核对**（跑这条）：
   ```bash
   cd /root/AiMarketing && node --input-type=module -e "const {PrismaClient}=await import('@prisma/client');const p=new PrismaClient();console.log(JSON.stringify(await p.userSubscription.findMany({where:{userId:18},select:{id:true,planId:true,startDate:true,endDate:true,status:true}})));console.log(JSON.stringify(await p.user.findUnique({where:{id:18},select:{id:true,plan:true,pointBalance:true}})));await p.\$disconnect();"
   ```
   ⇒ **订阅记录 id 不变**（延长不是重建）、只有一条 `active`、`endDate` 与界面一致；
4. **加点数 1000** ⇒ `pointBalance` 变 1000，且 `UsageLog` 多一条 `model` 含 `admin:`;
5. **扣点 -500** ⇒ 变 500（允许负数）；
6. **非管理员访问**：用普通用户 cookie 调新接口 ⇒ **必须 403**；
7. **换套餐**：换成「基础月卡」⇒ `endDate` 变成 +1 个月、`User.plan` 同步变「基础月卡」、旧的 active 记录变 `expired`；
8. 界面上有那句提示：「**加时长只延长有效期；本月额度不会重置**」。

---

## 9. 验证命令

```powershell
cd G:\AiMarketing
npx tsc --noEmit -p tsconfig.json *> temp\_daily\_tsc.txt
(Select-String -Path temp\_daily\_tsc.txt -Pattern 'error TS').Count   # 基线 90，新增必须 0
```

## 10. 提交要求

```powershell
git add src/lib/subscription-grant.ts src/app/api/admin/subscriptions/grant/route.ts src/app/api/admin/point-balance/route.ts src/app/admin/users/page.tsx src/app/api/admin/users/route.ts
git commit -m "feat(后台): VF_ADMIN_GRANT_V1 会员与点数操作面板 —— 加时长(累加不清旧)/换套餐/加点数(复用addPointBalance), 全部admin鉴权"
git push origin master
```

并在 `EXECUTION_LOG.md` 追加一行（含三个坑的处理方式、验收读数）。

---

## 11. 分期（P1 必做，其余可选）

| 期 | 内容 |
|---|---|
| **P1（本单）** | 加时长 / 换套餐 / 加点数 + 审计取巧 |
| P2 | 独立页「会员管理」（列表 + 搜索 + 批量 + 到期提醒） |
| P3 | `AdminLog` 正规审计表（`prisma db push`） |
| P4 | 用户端「我的订阅」显示剩余额度与到期倒计时 |
