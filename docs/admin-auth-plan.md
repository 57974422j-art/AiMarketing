# AiMarketing Admin 统一授权体系 — 详细规划

> 编写日期: 2026-06-06  
> 状态: **规划阶段 — 待用户确认后实施**

---

## 一、现状分析

### 1.1 现有角色体系

| 角色 | 层级 | 现有权限范围 | 存在问题 |
|------|------|-------------|---------|
| `admin` | L0 | 全部API、系统配置、MediaCrawler | 权限过于集中，缺少细粒度控制 |
| `editor` | L1 | 直播管理、素材审核、邀请码(end-user)、设备管理 | 缺少配额/设备类型的独立授权 |
| `end-user` | L2 | AI文案、视频制作、项目管理 | 无法自主选择使用哪种设备/Q1/指纹浏览器 |
| `viewer` | L3 | 团队内只读 | 几乎未使用 |

### 1.2 现有层级关系
```
admin (parentId = null)
  └── editor (parentId = admin.id)
        └── end-user (parentId = editor.id)
```
- 通过 `User.parentId` 实现三层树状结构 ✅ 已实现
- 但**没有**独立的"代理商(agent)"角色区分，editor 和 agent 混用 ❌

### 1.3 当前痛点
1. **设备类型无法分配** — 用户不知道自己能用 Q1 还是指纹浏览器还是真手机
2. **API Key 统一管理缺失** — 没有机制强制所有用户使用 admin 提供的 API
3. **工具权限粗放** — 只有 role 字段，无法单独开关某个功能
4. **配额无上限** — 没有 per-user/per-agent 的用量限制
5. **注册入口不明确** — 用户注册后如何获得功能权限，流程模糊

---

## 二、目标架构设计

### 2.1 核心原则

```
┌─────────────────────────────────────────────────┐
│                 Admin 统一控制台                  │
│                                                  │
│  ┌─────────────┐  ┌──────────────┐  ┌─────────┐ │
│  │ 代理商管理   │  │ 终端客户管理  │ │ 资源池   │ │
│  │ - 创建/编辑  │  │ - 审核/开通   │ │ - Q1设备 │ │
│  │ - 配额分配   │  │ - 功能授权    │ │ - 指纹池  │ │
│  │ - 工具权限   │  │ - 账号绑定    │ │ - 手机群  │ │
│  └─────────────┘  └──────────────┘  │ - API Key │ │
│                                     └─────────┘ │
│  ┌─────────────┐  ┌──────────────┐              │
│  │ 功能模块授权 │  │ 用量监控     │              │
│  │ - 开关控制   │  │ - Token统计  │              │
│  │ - 配额限制   │  │ - 任务统计  │              │
│  └─────────────┘  └──────────────┘              │
└─────────────────────────────────────────────────┘
```

**三大铁律：**
1. **一切资源归属 Admin** — 设备、API Key、指纹浏览器实例全部在 Admin 后台统一管理
2. **Agent 是中间层** — Admin 授权给 Agent，Agent 再分配给 End-user（也可跳过 Agent 直接给 End-user）
3. **End-user 无自配置权** — 所有能力来自上级授权，不可自行添加设备或 API

### 2.2 新角色定义

```
admin (平台拥有者)
  ├── agent  (代理商)        ← 原 editor 升级/拆分
  │      ├── agent-plus  (高级代理商)  可创建下级agent
  │      └── agent-basic  (基础代理商)  仅管理end-user
  └── end-user (终端客户)
         ├── trial (试用用户)          注册自动获得，有限功能
         └── active (正式用户)         Agent/Admin 手动开通
```

> **注意**: 为兼容现有数据，`editor` 角色保留为别名映射到 `agent`。新注册统一用 `agent`/`end-user`。

---

## 三、授权维度详细设计

### 3.1 维度总览

| 授权维度 | 控制粒度 | 归属者 | 分配方式 |
|---------|---------|--------|---------|
| **设备类型** | Q1 / 指纹浏览器 / 真手机 / 官方API | Admin 资产池 | Agent 申请 → Admin 批量分配 |
| **AI 工具** | 文案 / 生图 / 视频 / 数字人 / TTS / 智能客服 | 功能模块 | 按角色+配额开关 |
| **媒体账号** | 抖音 / 小红书 / 快手 / 视频号 + 绑定设备 | Agent/End-user 自有 | Admin 审核绑定请求 |
| **API 调用** | Token 配额 / 月限额 / 单次上限 | Admin 统一 Key | 按用户级联扣减 |
| **自动化任务** | 互关 / 点赞 / 评论 / 发布 / RPA | 按设备+账号 | 需对应设备授权 |
| **直播功能** | 直播间创建 / 商品管理 / 自动回复 / 弹幕互动 | 按账号 | 需账号+设备 |

### 3.2 设备类型授权（核心难点）

这是用户最关心的部分——**用户到底用什么设备执行操作？**

#### 设备资源池模型

```prisma
// ====== V3 授权升级 - 设备资源池 ======

model DevicePool {
  id            Int       @id @default(autoincrement())
  name          String                        // "华东Q1集群-A"
  type          String                         // "q1" | "fingerprint" | "realphone" | "api_only"
  status        String    @default("active")   // active / maintenance / offline
  
  // 容量管理
  maxSlots      Int       @default(0)         // 最大并发数（Q1=12窗口, 指纹=不限, 手机=1）
  usedSlots     Int       @default(0)         // 当前占用
  
  // 归属
  ownerId       Int                           // admin(0) 或 agent id
  // 当 ownerId=0 时表示归 admin 直接管理
  
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  allocations   DeviceAllocation[]
  devices       Device[]
}

model DeviceAllocation {
  id            Int       @id @default(autoincrement())
  poolId        Int                           // 分配到哪个资源池
  userId        Int                           // 获得授权的用户
  assignedBy    Int                           // 谁分配的 (admin or agent)
  
  // 分配额度
  slotQuota     Int       @default(1)         // 该用户可使用的槽位数
  usedSlots     Int       @default(0)         // 当前已使用
  
  // 时间限制
  expiresAt     DateTime?                     // null=永久, 有值=临时授权
  
  status        String    @default("active")  // active / expired / revoked
  
  createdAt     DateTime @default(now())

  pool          DevicePool @relation(fields: [poolId], references: [id])
  user          User       @relation(fields: [userId], references: [id])
}
```

#### 使用场景映射表

| 用户操作 | 所需设备类型 | 说明 |
|---------|------------|------|
| 抖音互关/点赞/评论 | Q1 或 指纹浏览器 | RPA 自动化操作 |
| 发布短视频 | Q1 或 指纹浏览器 | 上传视频+填写文案 |
| 直播推流 | Q1 或 真手机 | 需要摄像头 |
| 官方API发布 | api_only | 抖音开放平台API |
| 扫码登录/Cookie管理 | Q1 | MediaCrawler 需要 ADB |
| 素材采集/爬虫 | Q1 | Playwright 浏览器 |

#### 分配决策流程

```
Admin 登录后台
  ↓
[设备资源池] 页面 → 查看 Q1集群 / 指纹池 / 手机群
  ↓
点击 [分配] → 选择目标 Agent 或 End-user
  ↓
设置: 可用槽位数 / 有效期 / 允许的操作类型
  ↓
确认 → 写入 DeviceAllocation 表
  ↓
Agent/End-user 登录后 → 只看到被授权的设备和操作
```

### 3.3 AI 工具权限

#### 方案: 功能开关 + 配额

```prisma
model FeatureLicense {
  id            Int       @id @default(autoincrement())
  userId        Int                           // 被授权用户
  featureCode   String                        // 见下方功能编码列表
  
  // 开关状态
  isEnabled     Boolean  @default(false)      // 总开关
  
  // 配额限制 (null=无限, 0=禁用)
  dailyLimit    Int?                          // 每日次数
  monthlyLimit  Int?                          // 每月次数
  totalLimit    Int?                          // 总量上限
  
  // 已使用量 (系统自动累计)
  usedToday     Int       @default(0)
  usedThisMonth Int       @default(0)
  usedTotal     Int       @default(0)
  
  // 周期重置日
  resetDay      Int       @default(1)         // 每月1号重置 monthly
  
  grantedBy     Int                           // 授权人
  grantedAt     DateTime @default(now())
  expiresAt     DateTime?                     // null=永久
  
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  user          User       @relation(fields: [userId], references: [id])
}

@@unique([userId, featureCode])  // 每用户每功能唯一一条记录
```

#### 功能编码 (featureCode) 列表

| featureCode | 中文名 | 是否需API | 默认配额(trial) | 说明 |
|-------------|-------|----------|-----------------|------|
| `ai_copy` | AI 文案生成 | ✅ 需要 | 10次/天 | GPT/Qwen 生成营销文案 |
| `ai_image` | AI 图片生成 | ✅ 需要 | 5次/天 | SD/文生图 |
| `video_edit` | AI 视频剪辑 | ❌ 不需 | 3次/天 | 本地 FFmpeg 处理 |
| `text_to_video` | 文生视频 | ✅ 需要 | 1次/月 | Sora/Runway 类 |
| `digital_human` | 数字人视频 | ✅ 需要 | 0(关闭) | 高成本，需单独开 |
| `tts` | 语音合成 | ✅ 需要 | 20次/天 | EdgeTTS/云TTS |
| `ai_agent` | 智能客服 | ✅ 需要 | 0(关闭) | 对话式AI助手 |
| `ai_chat` | AI 对话 | ✅ 需要 | 50次/天 | 通用对话 |
| `mediacrawler` | 数据爬虫 | ❌ 不需 | 0(关闭) | 需Q1设备授权 |
| `live_stream` | 直播管理 | ❌ 不需 | 0(关闭) | 需设备+账号 |
| `automation_rpa` | RPA 自动化 | ❌ 不需 | 0(关闭) | 互关/点赞/评论等 |
| `publish_content` | 内容发布 | ❌ 不需 | 5次/天 | 需设备或API |

#### 需 API 的功能 vs 不需 API 的功能

| 类型 | 功能 | API 消耗来源 |
|------|------|------------|
| **需 API** | ai_copy, ai_image, text_to_video, digital_human, tts, ai_agent, ai_chat | Admin 统一提供 API Key，按调用计费 |
| **不需 API** | video_edit, mediacrawler, live_stream, automation_rpa, publish_content | 本地计算或设备依赖 |

**关键规则**: 
- **需 API 的功能**：所有用户共享 Admin 在 Settings 中配置的 API Key，前端不暴露 Key，后端统一代理调用
- **不需 API 的功能**：主要受限于**设备授权**和**本地资源**

### 3.4 API 统一管理

#### 设计思路

```
                    ┌──────────────────┐
                    │  .env.local      │
                    │  (仅服务器可读)    │
                    │                  │
                    │  OPENAI_KEY=sk-.. │
                    │  QWEN_KEY=sk-..   │
                    │  STABLE_DIFF=..   │
                    └────────┬─────────┘
                             │
                    ┌────────▼─────────┐
                    │ src/lib/         │
                    │ ai-providers.ts  │  ← 统一入口
                    │ (已有文件)        │
                    └────────┬─────────┘
                             │
              ┌──────────────┼──────────────┐
              │              │              │
     ┌────────▼──┐  ┌───────▼──────┐  ┌────▼─────┐
     │ /api/     │  │ /api/        │  │ /api/     │
     │ ai-copy   │  │ ai-image     │  │ tts       │
     │           │  │              │  │           │
     │ 检查license│  │ 检查 license │  │检查license│
     │ → 扣减配额 │  │ → 扣减配额   │  │→ 扣减配额 │
     │ → 调用API │  │ → 调用API    │  │ → 调用API │
     └───────────┘  └──────────────┘  └──────────┘
              │              │              │
              └──────────────┼──────────────┘
                             │
                    ┌────────▼─────────┐
                    │ FeatureLicense   │
                    │ (配额扣减记录)    │
                    └──────────────────┘
```

**规则：**
1. 用户**永远看不到** API Key
2. 所有 AI 调用经过后端代理 (`ai-providers.ts`)
3. 每次调用前检查 `FeatureLicense` 配额
4. 配额不足返回 **403 + 提示联系上级**
5. Admin 在 Settings 中统一配置/更换 API Key

### 3.5 媒体账号授权

```prisma
model AccountBindingRequest {
  id            Int       @id @default(autoincrement())
  userId        Int                           // 申请人
  platform      String                         // 抖音/小红书/...
  accountName   String                         // 账号名/ID
  deviceType    String?                        // 期望绑定的设备类型
  deviceId      Int?                          // 指定设备(可选)
  reason        String?                        // 申请理由
  
  status        String    @default("pending")  // pending / approved / rejected
  reviewedBy    Int?
  reviewedAt    DateTime?
  comment       String?                       // 审核意见
  
  createdAt     DateTime @default(now())

  user          User     @relation(fields: [userId], references: [id])
}
```

**流程：**
```
End-user → [我的账号]页面 → 点击[申请绑定]
  → 填写: 平台 + 账号名 + 期望设备类型
  → 提交 AccountBindingRequest

Agent/Admin → [账号审核]列表
  → 查看: 申请人 + 账号信息 + 期望设备
  → 决定: 通过(指定设备)/拒绝(填理由)

通过后:
  → 创建 SocialAccount 记录, 绑定 Device
  → 通知 End-user
```

---

## 四、注册与开通流程设计

### 4.1 方案对比

| 方案 | 描述 | 优点 | 缺点 | 推荐 |
|------|------|------|------|------|
| **A: 邀请码制(当前)** | 必须有邀请码才能注册 | 可控性强，防止滥用 | 获客门槛高 | ⭐⭐⭐ 适合B2B |
| **B: 开放注册+后台审核** | 任意注册，管理员审核开通 | 降低获客门槛 | 审核工作量大 | ⭐⭐ 适合早期 |
| **C: 混合模式** | 可开放注册(trial)，邀请码直接激活(active) | 灵活兼顾 | 实现复杂度中等 | ⭐⭐⭐⭐ **推荐** |

### 4.2 推荐方案 C：混合注册模式

```
                      ┌──────────────┐
                      │  访问首页     │
                      └──────┬───────┘
                             │
                   ┌─────────▼─────────┐
                   │   注册页面         │
                   │                   │
                   │ [输入邀请码?]      │ ← 可选
                   │   有 → 直接激活    │
                   │   无 → trial 用户  │
                   └─────────┬─────────┘
                             │
              ┌──────────────┼──────────────┐
              │              │              │
     ┌────────▼-------┐ ┌───▼────────┐ ┌───▼────────┐
     │ 邀请码注册      │ │ 开放注册    │ │ Admin手动   │
     │               │ │ (trial)    │ │ 创建用户    │
     │ role=由码决定  │ │ role=trial │ │ role=自定义  │
     │ parent=码创建者│ │ parent=null│ │ parent=指定  │
     │ status=active │ │ status=trial│ │ status=active│
     │ 功能=全开(受限)│ │ 功能=有限   │ │ 功能=自定义  │
     └───────────────┘ └────────────┘ └─────────────┘
              │              │              │
              └──────────────┼──────────────┘
                             │
                   ┌─────────▼─────────┐
                   │  用户 Dashboard    │
                   │                   │
                   │ trial用户顶部提示: │
                   │ "您的账号待开通    │
                   │  联系客服/等待审核"│
                   │                   │
                   │ active用户正常使用  │
                   └───────────────────┘
```

### 4.3 Trial 用户默认权限

| 功能 | Trial 默认值 | Active 由 Admin/Agent 设定 |
|------|------------|--------------------------|
| AI 文案 | 10次/天 | 自定义 |
| AI 生图 | 3次/天 | 自定义 |
| 视频剪辑 | 3次/天 | 自定义 |
| 设备(Q1/指纹) | ❌ 不可用 | 需分配 |
| 直播/RPA | ❌ 不可用 | 需分配 |
| 数据爬虫 | ❌ 不可用 | 需分配 |
| 项目数量 | 最多 3 个 | 自定义 |

---

## 五、Admin 后台新增页面规划

### 5.1 页面清单

| # | 页面路径 | 名称 | 说明 | 优先级 |
|---|---------|------|------|--------|
| 1 | `/admin/users` | 用户管理 | 已有，增强显示角色/状态/配额 | P0 |
| 2 | `/admin/device-pools` | 设备资源池 | **新建** - 管理 Q1/指纹/手机池 | P0 |
| 3 | `/admin/licenses` | 功能授权 | **新建** - 给用户批量开通功能+配额 | P0 |
| 4 | `/admin/account-review` | 账号审核 | **新建** - 审核终端客户的账号绑定申请 | P1 |
| 5 | `/admin/api-usage` | API 用量监控 | **新建** - 查看 Token 消耗趋势 | P1 |
| 6 | `/admin/agent-panel` | 代理商面板 | **新建** - Agent视角(子集) | P2 |

### 5.2 核心页面线框描述

#### 页面 1: `/admin/device-pools` 设备资源池

```
┌─────────────────────────────────────────────────────┐
│ 设备资源池                              [+ 新建资源池] │
├─────────────────────────────────────────────────────┤
│                                                     │
│ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌─────────┐ │
│ │ 办公室Q1  │ │ 云端指纹A │ │ 手机群-01 │ │ API通道 │ │
│ │          │ │          │ │          │ │         │ │
│ │ 类型: Q1  │ │ 类型:指纹 │ │ 类型:手机 │ │ 类型:API │
│ │ 槽位:8/12 │ │ 槽位:∞   │ │ 槽位:2/5 │ │ 槽位:∞  │
│ │ 状态:●在线 │ │ 状态:●在线│ │ 状态:○离线│ │ 状态:●OK │
│ │          │ │          │ │          │ │         │ │
│ │ [管理分配]│ │ [管理分配]│ │ [管理分配]│ │ [查看]  │ │
│ └──────────┘ └──────────┘ └──────────┘ └─────────┘ │
│                                                     │
│ === 分配记录 (某资源池详情) ===                       │
│ 用户          │ 分配槽位 │ 已用 │ 到期日   │ 操作    │
│ agent张三     │ 4       │ 2   │ 永久     │ [编辑]  │
│ end-user李四  │ 1       │ 1   │ 2026-07  │ [编辑]  │
└─────────────────────────────────────────────────────┘
```

#### 页面 2: `/admin/licenses` 功能授权

```
┌─────────────────────────────────────────────────────┐
│ 功能授权管理                                         │
├─────────────────────────────────────────────────────┤
│                                                     │
│ 选择用户: [下拉选择 agent/end-user ▼]                │
│                                                     │
│ ┌─────────────────────────────────────────────────┐ │
│ │  功能           │ 开关  │ 日限 │ 月限 │ 总限    │ │
│ ├─────────────────┼───────┼──────┼──────┼─────────┤ │
│ │ AI 文案生成     │ [✓]  │ 50   │ 1000 │ ∞      │ │
│ │ AI 图片生成     │ [✓]  │ 20   │ 300  │ ∞      │ │
│ │ AI 视频剪辑     │ [✓]  │ 10   │ 200  │ ∞      │ │
│ │ 文生视频        │ [✗]  │ -    │ -    │ -      │ │
│ │ 数字人视频      │ [✗]  │ -    │ -    │ -      │ │
│ │ TTS 语音合成    │ [✓]  │ 100  │ 2000 │ ∞      │ │
│ │ 智能客服        │ [✗]  │ -    │ -    │ -      │ │
│ │ AI 对话         │ [✓]  │ 200  │ 5000 │ ∞      │ │
│ │ 数据爬虫        │ [✗]  │ -    │ -    │ -      │ │
│ │ 直播管理        │ [✗]  │ -    │ -    │ -      │ │
│ │ RPA 自动化      │ [✗]  │ -    │ -    │ -      │ │
│ │ 内容发布        │ [✓]  │ 10   │ 200  │ ∞      │ │
│ ├─────────────────┼───────┼──────┼──────┼─────────┤ │
│ │ [保存授权]                                    │ │
│ └─────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────┘
```

#### 页面 3: `/admin/account-review` 账号审核

```
┌─────────────────────────────────────────────────────┐
│ 账号绑定审核                    [待审核: 3] [已处理]  │
├─────────────────────────────────────────────────────┤
│                                                     │
│ #001 end-user王五 申请绑定 抖音号 @美业小助手        │
│      期望设备: Q1    理由: 需要发布产品视频           │
│      申请时间: 2026-06-06 17:00                     │
│                                                     │
│      [通过并分配设备 ▼]  [拒绝]  [要求补充材料]       │
│                                                     │
│ ---------------------------------------------------- │
│ #002 end-user赵六 申请绑定 小红书 @穿搭日记           │
│      期望设备: 指纹浏览器                            │
│                                                     │
│      [通过并分配设备 ▼]  [拒绝]                       │
└─────────────────────────────────────────────────────┘
```

---

## 六、数据库 Schema 变更汇总

### 6.1 新增模型

| 模型名 | 用途 | 关键字段 |
|--------|------|---------|
| `DevicePool` | 设备资源池 | type, maxSlots, ownerId |
| `DeviceAllocation` | 设备分配给用户 | poolId, userId, slotQuota, expiresAt |
| `FeatureLicense` | 功能授权+配额 | userId, featureCode, isEnabled, daily/monthly/totalLimit, used* |
| `AccountBindingRequest` | 账号绑定申请 | userId, platform, status |

### 6.2 User 模型变更

```diff
 model User {
   ...
+  status      String   @default("trial")   // trial / active / suspended
+  assignedPoolIds String?  @default("[]")   // JSON: 已分配的资源池ID数组
+  notes       String?                      // Admin备注
 }
```

### 6.3 删除/废弃

- **Onboarding 页面** — ✅ 已删除本次
- `InviteCode.role` 中 `viewer` 值 — 废弃不用
- `TeamMember` — 暂保留但不再作为主要权限机制

---

## 七、实施路线图

### Phase 1: 基础授权框架（1-2 周）
- [ ] 新增 `FeatureLicense` 模型 + Prisma migrate
- [ ] 新增 `/api/admin/licenses` CRUD API
- [ ] 新增 Admin「功能授权」页面
- [ ] 修改各 AI API 路由加入 License 检查中间件
- [ ] User 模型增加 `status` 字段 (trial/active/suspended)

### Phase 2: 设备资源池（2-3 周）
- [ ] 新增 `DevicePool` + `DeviceAllocation` 模型
- [ ] 新增 `/api/admin/device-pools` CRUD API
- [ ] Admin「设备资源池」页面
- [ ] 改造现有 Device/SocialAccount 绑定逻辑加入 Pool 校验
- [ ] 前端根据用户授权动态显示可用设备选项

### Phase 3: 账号审核流程（1 周）
- [ ] 新增 `AccountBindingRequest` 模型 + API
- [ ] Admin「账号审核」页面
- [ ] End-user「我的账号」页面增加申请入口
- [ ] 通知系统（站内消息或邮件）

### Phase 4: 注册改造 + Agent 面板（1-2 周）
- [ ] 注册页改为支持可选邀请码
- [ ] Trial 用户默认权限设定
- [ ] Agent 子面板（简化版 Admin，只能管理自己的 end-user）
- [ ] 用量统计仪表盘

### Phase 5: 监控与优化（持续）
- [ ] API 用量监控大屏
- [ ] 配额预警（接近上限通知）
- [ ] 操作日志审计
- [ ] 导出报表

---

## 八、待决问题

以下问题需要您确认后再进入开发：

### Q1: 代理商(Agent) 的权限边界？
- **选项 A**: Agent 可以自己给 end-user 开通功能（在 Admin 给的总额度内自由分配）
- **选项 B**: Agent 只能提交申请，最终由 Admin 审批开通
- **推荐**: A（减轻 Admin 工作量）

### Q2: Trial 用户能否自助升级为 Active？
- **选项 A**: Trial 用户付费/联系客服后，Admin 手动改状态
- **选项 B**:Trial 用户填写申请表单 → Agent/Admin 审核通过
- **推荐**: B（更自动化）

### Q3: 设备故障时的降级策略？
- 如果 Q1 集群离线，已分配的用户：
  - **选项 A**: 自动暂停相关任务，通知用户
  - **选项 B**: 尝试切换到指纹浏览器备用
  - **推荐**: A（先简单可靠）

### Q4: 是否需要多租户数据隔离？
- 目前同一 Agent 下的 End-user 之间数据是隔离的（userId 过滤）
- Agent 之间数据天然隔离
- **是否需要更强隔离？**（如数据库级别）— 当前阶段不需要

---

## 九、附录: 快速参考

### 权限判断伪代码

```typescript
// API Route 中统一的权限检查函数
async function checkLicense(
  userId: number,
  featureCode: string,
  quantity: number = 1
): Promise<{ allowed: boolean; reason?: string }> {
  const license = await prisma.featureLicense.findUnique({
    where: { userId_featureCode: { userId, featureCode } }
  })
  
  if (!license || !license.isEnabled)
    return { allowed: false, reason: '功能未开通' }
  
  if (license.expiresAt && new Date() > license.expiresAt)
    return { allowed: false, reason: '授权已过期' }
  
  if (license.dailyLimit != null && license.usedToday + quantity > license.dailyLimit)
    return { allowed: false, reason: '今日配额已用尽' }
    
  if (license.monthlyLimit != null && license.usedThisMonth + quantity > license.monthlyLimit)
    return { allowed: false, reason: '本月配额已用尽' }
    
  if (license.totalLimit != null && license.usedTotal + quantity > license.totalLimit)
    return { allowed: false, reason: '总量配额已用尽' }
  
  return { allowed: true }
}

// 扣减配额
async function consumeLicense(userId: number, featureCode: string, qty: number) {
  await prisma.featureLicense.update({
    where: { userId_featureCode: { userId, featureCode } },
    data: {
      usedToday: { increment: qty },
      usedThisMonth: { increment: qty },
      usedTotal: { increment: qty },
    }
  })
}
```

### 设备分配伪代码

```typescript
// 用户查询自己可用的设备
async function getUserDevices(userId: number): Promise<Device[]> {
  const allocations = await prisma.deviceAllocation.findMany({
    where: {
      userId,
      status: 'active',
      OR: [
        { expiresAt: null },
        { expiresAt: { gt: new Date() } }
      ]
    },
    include: { pool: { include: { devices: true } } }
  })
  
  // 返回该用户有权访问的所有设备
  return allocations.flatMap(a => a.pool.devices)
}
```

---

*文档结束。以上为 Admin 统一授权体系的完整规划，请审阅后告知需要调整的部分以及希望优先实施的 Phase。*
