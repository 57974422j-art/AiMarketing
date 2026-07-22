# 支付对接实施计划（支付宝 + 微信）

> 创建时间: 2026-07-22 | 状态: 计划阶段，待逐步实施
> 配套设计: `docs/commercialization-design.md`（Phase 6 支付对接占位）
> 当前代码审计结论: 收费"壳"齐全，**收款环节完全缺失**

---

## 一、当前代码审计

### ✅ 已具备
| 模块 | 位置 | 说明 |
|------|------|------|
| 套餐后台管理 | `src/app/admin/subscription/page.tsx` | 套餐 CRUD、用量统计、种子初始化 |
| 套餐数据模型 | `prisma/schema.prisma` `SubscriptionPlan`(388) / `UserSubscription`(411) | 字段完整 |
| 用户端收费页 | `src/app/my-subscription/page.tsx` | 展示 active 套餐 + "立即订阅" + 用量 |
| 支付配置后台 | `src/app/admin/payment-settings/page.tsx` | 收集 alipay/wechat 各 3 字段 |

### ❌ 核心缺口
1. **订阅不收款**：`src/app/api/subscription/buy/route.ts` 直接落库开权限，点"立即订阅"即白嫖，无支付环节。
2. **支付配置是死库**：`payment-settings/route.ts` 只加密存库、无下单/回调，且 GET **未解密**（返回密文）。
3. **"自动显示支付按钮"是假的**：`payment-settings` 注释承诺"配置后用户端自动显示支付按钮"，但无任何代码读 `alipayEnabled` 来切换。
4. **无订单表 / 订单流程**：无 `Order` 模型，无法做"建预订单→支付→回调开通"。
5. **无支付宝下单与回调接口**；`package.json` 无 alipay SDK，且按规则**不改 package.json**，需用 Node 内置 `crypto` 手写 RSA2 签名（可行）。
6. **微信商户号尚未申请下来**，本计划**先设计好微信链路**，待商户号就绪后实现。

---

## 二、设计原则

- **不改 `package.json` / `tsconfig.json`**：支付宝/微信签名均用 Node 内置 `crypto` 手写，不引第三方 SDK。
- **支付与开通解耦**：下单只建订单；**回调成功才开通订阅**（把现有 `buy` 的"开权限"逻辑迁入回调）。
- **配置安全读取**：支付密钥仅服务端读取，前端只读"是否启用"（新增 `/api/payment/status`）。
- **幂等**：回调按 `orderNo` 去重，重复通知不重复开通。
- **最小可用先跑通支付宝**：微信设计留接口，商户号下来补实现。

---

## 三、数据模型（阶段 1 落地）

### 3.1 新增 `PaymentOrder`
```prisma
model PaymentOrder {
  id        Int      @id @default(autoincrement())
  orderNo   String   @unique                 // 商户订单号（平台生成，唯一）
  userId    Int
  planId    Int
  channel   String   @default("alipay")      // alipay / wechat
  amount    Int                               // 金额(分)
  subject   String                            // 订单标题，如 "专业版月卡"
  status    String   @default("pending")      // pending / paid / closed / failed
  tradeNo   String?                           // 第三方交易号
  payUrl    String?                           // 支付宝 wap 支付跳转 URL
  qrCode    String?                           // 微信 Native 支付二维码内容
  expireAt  DateTime?                         // 订单过期时间（如 +15 分钟）
  paidAt    DateTime?
  raw       String?                           // 回调原始数据(JSON，便于排查)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  user User             @relation(fields: [userId],   references: [id])
  plan SubscriptionPlan @relation(fields: [planId],   references: [id])
}
```

### 3.2 `UserSubscription` 增加溯源字段（同文件内改）
```prisma
  orderNo       String?   // 关联 PaymentOrder.orderNo，便于对账
  paymentMethod String?   // "alipay" / "wechat" / "manual"
```
> 现有 `UserSubscription` 已含 `status/startDate/endDate`，仅补这两个字段即可，不影响存量数据。

---

## 四、分阶段实施清单（每阶段改 1 个文件，改完确认）

### 阶段 0 — 开放平台配置（您操作，非代码）
**支付宝**：
> ✅ **接口加签方式决策：选「密钥」（RSA2）。** 原因：本平台仅做订阅收款（手机网站支付/当面付），密钥方式完全满足且为默认推荐；「证书」仅在使用"现金红包""单笔转账到支付宝"等资金转出产品时强制，本项目不涉及。密钥方式生成的「应用公钥/应用私钥」可直接对应平台 `payment-settings` 两字段，无需证书托管。
- [ ] 控制台 → 我的应用 → 找到/创建"网页&移动应用" → **签约「手机网站支付」**（或「当面付」）
- [ ] 开发设置 → **接口加签方式选"密钥"** → 用密钥工具生成 RSA2 密钥对
- [ ] 复制 **应用私钥**（私钥文件内容）→ 平台 `应用私钥` 字段
- [ ] 上传 **应用公钥** 到支付宝 → 支付宝返回 **支付宝公钥** → 平台 `支付宝公钥` 字段
- [ ] 复制 **AppID**（应用概览顶部）→ 平台 `AppID` 字段
- [ ] **应用网关**填：`https://ai-niuma.cc/api/payment/alipay/notify`
- [ ] 选填：服务器 IP 白名单、接口内容加密（纯支付可暂不选）
- [ ] 网关地址记默认值 `https://openapi.alipay.com/gateway.do`（写进后端常量）

**微信**（商户号下来后）：
- [ ] 申请微信支付商户号 → 绑定 AppID
- [ ] 签约 JSAPI / Native 支付
- [ ] 获取 APIv3 密钥 + 平台证书
- [ ] 设置支付回调域名 `ai-niuma.cc`

### 阶段 1 — 数据层（1 文件）
- [ ] `prisma/schema.prisma`：新增 `PaymentOrder`；`UserSubscription` 加 `orderNo`/`paymentMethod`

### 阶段 2 — 支付配置可读取（1 文件 + 修复）
- [ ] 修复 `src/app/api/admin/payment-settings/route.ts`：补 `decrypt()`，GET 返回明文
- [ ] 新增 `src/lib/payment-config.ts`：服务端读取并解析配置（下单/回调共用，不直接 expose 私钥给前端）

### 阶段 3 — 支付宝下单 + 回调（核心，2 个文件）
- [ ] 新增 `src/lib/alipay.ts`：手写 RSA2 签名、构造 `alipay.trade.wap.pay` 请求、验签函数
- [ ] 新增 `src/app/api/subscription/checkout/route.ts`：`{userId, planId, channel}` → 建订单 + 调支付宝拿 `payUrl` → 返回
- [ ] 新增 `src/app/api/payment/alipay/notify/route.ts`：验签 → 校验金额/订单 → 标记 paid → **迁入 `buy` 的开通逻辑**
- [ ] 新增 `src/app/api/subscription/order/[orderNo]/route.ts`：前端轮询订单状态

### 阶段 4 — 支付状态可见性（1 文件）
- [ ] 新增 `src/app/api/payment/status/route.ts`：返回 `{ alipayEnabled, wechatEnabled }`（不含密钥）

### 阶段 5 — 前端改造（1 文件）
- [ ] `src/app/my-subscription/page.tsx`：`buyPlan` 改为调 `checkout` → 支付宝跳 `payUrl`（微信弹二维码）→ 轮询 `order/[orderNo]` → 开通后刷新；按 `status` 决定是否显示支付按钮

### 阶段 6 — 微信支付（商户号就绪后，2 文件，提前设计）
- [ ] `src/lib/wechat-pay.ts`：HMAC-SHA256 签名、Native 下单、回调验签（需 APIv3 密钥 + 证书）
- [ ] `src/app/api/payment/wechat/notify/route.ts`：同阶段 3 回调逻辑

### 阶段 7 — 可选增强
- [ ] 订单中心页（用户查历史订单）
- [ ] 过期订单定时关闭（cron / 请求时清理）
- [ ] 退款接口

---

## 五、接口契约

### `POST /api/subscription/checkout`
请求: `{ userId, planId, channel: "alipay" | "wechat" }`
响应: `{ success, payUrl? , qrCode?, orderNo }`
行为: 校验套餐 active → 生成 `orderNo` → 建 `pending` 订单 → 调渠道拿支付凭证 → 返回。

### `POST /api/payment/alipay/notify`（免登录，公网）
- 支付宝异步通知，验签 `SHA256withRSA`（用**支付宝公钥**）
- 校验 `out_trade_no` 存在、`total_amount` 与订单 `amount` 一致、`trade_status=TRADE_SUCCESS`
- 幂等：已 `paid` 直接返回 `success`
- 成功：订单置 `paid` + 创建/续期 `UserSubscription`（迁自 `buy` 逻辑）

### `GET /api/subscription/order/[orderNo]`
响应: `{ success, status: "pending"|"paid"|"closed", subscription? }`（前端轮询用）

### `GET /api/payment/status`
响应: `{ alipayEnabled: boolean, wechatEnabled: boolean }`

---

## 六、支付宝签名方案（手写，无需 SDK）

- **算法**：RSA2 = `SHA256withRSA`（Node: `crypto.createSign('RSA-SHA256')`）
- **私钥格式**：支付宝密钥工具导出 PKCS#1（`-----BEGIN RSA PRIVATE KEY-----`）可直接被 `createSign` 使用；若 PKCS#8 也兼容。
- **签名串构造**：参数按 ASCII 升序排序 → `k1=v1&k2=v2`（值原样，不含引号）→ 用应用私钥签名（Base64）。
- **wap.pay 调起**：拼接 `gateway + "?charset=utf-8&method=alipay.trade.wap.pay&sign=...&sign_type=RSA2&" + 其余参数` → 作为 `payUrl` 由前端 `window.location` 跳转。
- **验签**：用支付宝公钥验 `sign` 与待签串。

---

## 七、微信支付方案（设计，待商户号）

- **Native 支付**：下单 `POST https://api.mch.weixin.qq.com/v3/pay/transactions/native`，返回 `code_url` → 前端转二维码。
- **签名**：V3 用 `HMAC-SHA256`（商户 APIv3 密钥）对 `method+url+timestamp+nonceStr+body` 签名，入 `Authorization` 头。
- **回调**：V3 回调为 AES-256-GCM 加密的 JSON，需平台证书解密后验签。
- **注意**：微信比支付宝复杂（证书 + GCM 解密），商户号就绪后再实现，接口形状与支付宝对齐（同 `checkout` / `notify` 模式）。

---

## 八、开放平台配置 CheckList（给管理员）

| 项目 | 页面位置 | 值 |
|------|----------|-----|
| 支付宝签约 | 控制台 → 应用 → 能力列表 | 手机网站支付 |
| 接口加签方式 | 开发设置 | 密钥（RSA2） |
| 应用私钥 → 平台 | 密钥工具导出 | 填 `payment-settings` 应用私钥 |
| 支付宝公钥 → 平台 | 上传应用公钥后返回 | 填 `payment-settings` 支付宝公钥 |
| AppID → 平台 | 应用概览 | 填 `payment-settings` AppID |
| 应用网关 | 开发设置 | `https://ai-niuma.cc/api/payment/alipay/notify` |
| 微信商户号 | 微信支付商户平台 | 申请中（待填） |
| 微信支付回调域名 | 商户平台 → 产品中心 | `ai-niuma.cc` |

---

## 九、验收标准

1. 平台 `payment-settings` 填入支付宝三要素 + 应用网关已配 → 前端"立即订阅"显示支付宝支付按钮。
2. 点击 → 跳转支付宝 → 付款成功 → 异步通知到达 `notify` → 订单 `paid` → 用户 `UserSubscription` 自动开通、功能解锁。
3. 回调重复到达不重复开通（幂等）。
4. 用户端"我的套餐"显示新订阅与到期日，用量配额生效。
5. 微信链路在商户号就绪后，按阶段 6 同流程跑通。

---

*本计划基于 2026-07-22 代码审计。每阶段改一个文件，改完确认再继续。*
