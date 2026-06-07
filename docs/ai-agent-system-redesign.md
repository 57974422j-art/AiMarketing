# AI 员工系统 — 待更新设计文档

> 创建时间: 2026-06-06 | 状态: 规划阶段，待开发

---

## 一、当前架构的本质

当前 AI-Agent 是一个 **"聊天机器人配置生成器"**，不是真正可运行的智能体。

```
┌─────────────────────────────────────────────┐
│           当前 AI-Agent 是什么？              │
│                                             │
│   一个「Prompt 配置管理工具」                 │
│   ┌─────────┐    ┌──────────┐               │
│   │ 配置表单  │ →  │ 测试聊天页 │              │
│   │ 名称/风格  │    │ (纯前端)  │              │
│   │ 提示模板  │    │          │              │
│   │ 培训文档  │    └──────────┘              │
│   └─────────┘                               │
│         ↓                                   │
│   存入数据库 (AIAgent + TrainingDocument)     │
│                                             │
│   ❌ 与设备系统零耦合                          │
│   ❌ 与平台账号零关联                          │
│   ❌ 无值守/监听能力                           │
└─────────────────────────────────────────────┘
```

---

## 二、两种目标场景

### 场景 A：终端客户（真手机 + 指纹浏览器）

| 用户画像 | 小商家/个体户，1-5个社交账号，手动运营为主 |
|---------|----------------------------------------|
| 核心诉求 | **AI 替我回复私信/评论**，不需24小时盯着手机 |
| 设备环境 | 自己的手机（ADB 调试）+ 电脑上的指纹浏览器 |

**完整链路需求：**

```
抖音/小红书收到新消息
       ↓
  [消息监听器] ← ❌ 当前完全缺失
       ↓
  AI Agent 判断意图 + 查知识库生成回复
       ↓
  [消息发送通道] ← ❌ 当前完全缺失
       ↓
  用户手机/浏览器上显示已发送
```

### 场景 B：代理商/代运营（Q1 主板机群）

| 用户画像 | 代运营公司，管几十到几百个账号，批量操作 |
|---------|----------------------------------------|
| 核心诉求 | **一批 AI 员工各自守着一批账号，自动获客/转化** |
| 设备环境 | Q1 魔云腾设备池（FRP 隧道）或主板机柜 |

**完整链路需求：**

```
N 台设备 × M 个账号
       ↓
  [任务调度中心分配] ← ❌ Agent 和 Device 没有绑定关系
       ↓
  每个 Agent 守护自己的账号组
       ↓
  监听消息 → AI 决策 → 执行动作 → 记录结果
       ↓
  [数据回流] 线索/意向客户录入 CRM ← ❌ 不存在
```

---

## 三、缺失的关键模块

| 编号 | 缺失模块 | 描述 | 影响范围 |
|------|---------|------|---------|
| **#1** | 消息监听器 | 轮询/推送获取新消息（私信、评论、@提及） | A/B 都缺 |
| **#2** | 消息发送通道 | 将 AI 回复写入设备（ADB输入 / Playwright DOM操作） | A/B 都缺 |
| **#3** | 会话状态管理 | 按 userId 维护对话上下文，记录聊到哪里了 | A/B 都缺 |
| **#4** | RAG 知识检索 | 培训文档向量化匹配，注入 Prompt（当前文档只是摆设） | A/B 都缺 |
| **#5** | Agent ↔ Device 绑定 | Agent 绑定到 SocialAccount + Device，确定部署目标 | 主要影响 B |
| **#6** | 并发调度模型 | 一个 Agent 同时监听多个账号的消息队列 + 排队限速 | 主要影响 B |
| **#7** | 风控感知 | 回复延迟模拟人工打字速度、同账号多Agent互斥、日上限 | 主要影响 B |
| **#8** | 结果闭环 | 高意向线索打标录入、对话质检追溯、转化漏斗统计 | 主要影响 B |

---

## 四、消息监听方案对比

| 方案 | 适用场景 | 可行性 | 备注 |
|------|---------|--------|------|
| **指纹浏览器 WebSocket 拦截** | 终端客户 | ⭐⭐⭐⭐⭐ | Playwright 可监听网络请求/响应，直接拦截私信 API |
| **Android 无障碍服务(AccessibilityService)** | 真机/Q1 | ⭐⭐⭐ | 需要在设备侧安装 APK，监听通知变化 |
| **ADB 通知栏轮询** | Q1/真机 | ⭐⭐⭐⭐ | `dumpsys notification` 定时拉取，已有 ADB 基础设施 |
| **UIAutomator 定时巡检** | Q1/真机 | ⭐⭐⭐ | `uiautomator dump` 检测未读红点，侵入性低 |
| **平台 WebSocket 推送** | 指纹浏览器 | ⭐⭐ | 需破解平台 WS 协议，有风控风险 |

**推荐组合：**
- **终端客户**：指纹浏览器用 Playwright WS 拦截（最稳）+ 真机用 ADB 通知轮询
- **代理商**：Q1 用 UIAutomator 定时巡检（批量友好）+ ADB 通知兜底

---

## 五、执行架构（双模式）

```
┌──────────────────────────────────────────────────────┐
│                  Engine Dispatcher                    │
│                                                       │
│  ┌─────────────────────┐  ┌────────────────────────┐  │
│  │   终端客户模式        │  │   代理商模式             │  │
│  │                     │  │                        │  │
│  │  Fingerprint Mode   │  │  Q1 Pool Mode          │  │
│  │  ┌───────┐          │  │  ┌──────────────────┐  │  │
│  │  │Playwri│←DOM操作→  │  │  │DevicePool 调度    │  │  │
│  │  │ght    │  输入框   │  │  │↓                 │  │  │
│  │  └───────┘  发送按钮  │  │  │Q1 HTTP API       │  │  │
│  │       ↑             │  │  │↓                 │  │  │
│  │  [消息轮询/WS拦截]   │  │  │UIAutomator Driver │  │  │
│  │                     │  │  │(ADB/uiautomator)   │  │  │
│  │  适用: 1-5个账号     │  │  │                   │  │  │
│  │  特点: 单账号常驻     │  │  │适用: 几十~几百账号  │  │  │
│  └─────────────────────┘  │  │特点: 任务分发+并发   │  │  │
│                           │  └────────────────────┘  │  │
└──────────────────────────────────────────────────────┘
```

---

## 六、待补充的数据模型

```prisma
// 新增：Agent 部署绑定（一个 Agent 可以部署到多个账号）
model AgentDeployment {
  id               Int      @id @default(autoincrement())
  agentId          Int
  accountId        Int                    // SocialAccount.id
  deviceHint       String?                // "fingerprint" | "q1" | "real-device"
  status           String   @default("active")   // active/paused/error
  workHours        String?                // JSON: {start:"09:00", end:"22:00"}
  replyDelay       Int      @default(3)   // 模拟人工回复延迟(秒)
  maxDailyReplies  Int      @default(100) // 日上限防封
  
  agent            AIAgent        @relation(fields: [agentId], references: [id])
  account          SocialAccount  @relation(fields: [accountId], references: [id])
  conversations    Conversation[]
}

// 新增：会话记录（完整追溯）
model Conversation {
  id             Int      @id @default(autoincrement())
  deploymentId   Int
  platformUserId String?         // 对方用户ID
  lastActivity   DateTime @updatedAt
  summary        String?         // AI生成的会话摘要
  
  deployment     AgentDeployment @relation(...)
  messages       ConversationMessage[]
}

model ConversationMessage {
  id             Int      @id @default(autoincrement())
  conversationId Int
  role           String   // user/assistant/system
  content        String
  source         String   // dm/comment/auto-reply
  createdAt      DateTime @default(now())
}
```

---

## 七、RAG 知识库流程（让培训文档真正生效）

```
当前状态: TrainingDocument.content 直接存文本，chat 时未使用
      ↓
改进方案:
  用户消息
     ↓
  Embedding 向量化 (复用 ai-providers 已有的 embedding 能力)
     ↓
  向量匹配 Top-K 相关文档片段
     ↓
  注入 System Prompt:
    "以下是相关知识：
     [doc1] ...产品价格299元...
     [doc2] ...退换货7天无忧...
     
     请参考以上知识回复用户。"
     ↓
  generateText() → 回复
```

---

## 八、开发优先级建议

| 优先级 | 模块 | 工作量 | 理由 |
|-------|------|-------|------|
| **P0** | Agent ↔ SocialAccount 绑定 | 小 | 一切基础，不绑定就无法"部署" |
| **P0** | 消息监听（至少一种方案跑通） | 中 | 没有监听就没有触发源 |
| **P1** | 消息执行通道 | 中小 | 复用已有的 ADB/UIAutomator/Playwright，只需串起来 |
| **P1** | 会话状态管理（Conversation 表） | 小 | 否则每次都是陌生人对话 |
| **P2** | RAG 文档检索 | 中 | 让培训文档从"摆设"变有用 |
| **P2** | 风控参数（延迟/频率/工作时间） | 小 | 代理商用得上 |
| **P3** | 数据闭环（线索捕获/漏斗统计） | 大 | 商业价值最大化 |

---

## 九、核心结论

> **当前的 AI-Agent 是一个"离线配置工具"。要变成"在线智能员工"，核心缺口不是 AI 能力（项目已有完整的 ai-providers 多供应商降级链），而是缺少「监听 → 决策 → 执行 → 记录」这个运行时闭环。好消息是项目已具备所有执行引擎（ADB / UIAutomator / Playwright），主要工作是做调度编排和状态管理。**
