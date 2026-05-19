# AiMarketing 项目完整报告

> 生成日期: 2026-05-19
> 项目路径: `/root/AiMarketing` (服务器) / `D:\AiMarketing` (本地)
> 域名: http://120.55.43.195:3000
> PM2 进程名: `aimarketing`

---

## 一、技术栈

| 层 | 技术 | 版本 |
|---|------|------|
| 框架 | Next.js (App Router) | 14.2.0 |
| 语言 | TypeScript | 5.5.4 |
| 样式 | TailwindCSS | 3.4.0 |
| 数据库 | SQLite (文件) | Prisma ORM 5.22.0 |
| 服务端运行 | PM2 | systemd |
| 第三方 | 阿里云 OSS / 阿里云语音识别 | ali-oss 6.23.0 |
| 部署 | GitHub → 服务器 git pull | |

**数据库位置**: `/root/AiMarketing/prisma/dev.db`

---

## 二、功能清单

### ✅ 已完成 / 基本可用

| 功能 | 路径 | 状态 |
|------|------|------|
| **登录/注册** | `/login`, `/register` | 正常 |
| **仪表盘 (三层管理)** | `/admin/dashboard` | 新重构，admin/editor 两层数据 |
| **设备管理** | `/admin/devices` | 可用，列表/添加/编辑/删除 |
| **任务中心** | `/admin/automation-tasks` | 可用，创建/执行/状态跟踪 |
| **社交账号管理** | `/admin/social-accounts` | 可用，CRUD + 状态 |
| **账号分组** | `/admin/account-groups` | 可用，分组管理账号 |
| **文案生成 (AI Copy)** | `/admin/ai-copy` | 可用 |
| **视频工具** | `/admin/video` | 可用 |
| **邀请码管理** | `/admin/invite-codes` | 可用，admin 生成 |
| **内容审核** | `/admin/content-submissions` | 可用 |
| **自动任务模板** | `/admin/automation-templates` | 可用 |
| **AI Agent 管理** | `/admin/ai-agent` | 可用（mock 数据 + 真实 API） |
| **Q1 设备直连隧道** | 服务器 `127.0.0.1:30001` | **今日刚打通**，用魔云腾 Q1 V3 公网穿透 |
| **发布视频 (执行器改造)** | Q1 uiautomator | 可用 |
| **邀请码注册流程** | `/api/auth/register` | 三层角色注册 |

### 🚧 部分完成 / 有框架无数据

| 功能 | 路径 | 说明 |
|------|------|------|
| **Dashboard AI 用量** | Dashboard 卡片 | UI 有，UsageLog 数据需接入 |
| **Dashboard 直播统计** | Dashboard 预留区域 | 纯占位，数据未接入 |
| **Dashboard Token 消耗** | Dashboard 预留区域 | 纯占位，需对接 AI Provider |
| **窗口池 (窗口会话)** | WindowSession 模型 | Schema 已有，未写 API |
| **素材库** | `/admin/media` | 需确认是否存在 |
| **数字人模板** | 无独立页面 | Schema 有，API 有，前端可能没有 |
| **NFC 规则模板** | 无独立页面 | Schema 有，API 有，前端可能没有 |
| **提示词模板库** | 无独立页面 | Schema 有，API 有，前端可能有 |

### ❌ 未开始

| 功能 | 说明 |
|------|------|
| **直播推流** | 预留位置，等待 Q1 流管理功能 |
| **AI 视频自动生成** | UsageLog 记录有，实际生成未接 |
| **数据大屏/实时监控** | 未做 |
| **批量任务调度** | 单个任务可执行，无定时调度 |
| **权限颗粒度细化** | 三层角色已分但 API 层校验不统一 |

---

## 三、部署方式

### 服务器信息

```
IP: 120.55.43.195
SSH: root@120.55.43.195
项目路径: /root/AiMarketing
运行方式: pm2 start npm --name aimarketing -- start
端口: 3000
```

### 部署步骤

```bash
# 本地改代码
cd D:\AiMarketing && git add . && git commit -m "xxx" && git push origin master --force

# 服务器拉取
ssh root@120.55.43.195
cd /root/AiMarketing
git pull

# 如果改 schema（新增表/字段）
npx prisma generate
npx prisma db push --accept-data-loss --force-reset  # 仅测试库可用，会清数据

# 编译重启
npm run build 2>&1 | tail -5
pm2 restart aimarketing
```

### 环境变量
没有 `.env` 文件。环境变量通过以下方式设置：
- `next.config.js` 或 `next.config.mjs`
- PM2 启动脚本
- 需要检查是否有环境变量在 `next.config` 中被引用

---

## 四、数据库 schema 关键说明

### 三层用户体系

```
User.role = 'admin'     ← 超级管理员，看到所有数据
          = 'editor'    ← 二级客户（团队负责人），看到自己的设备和下级的账号
          = 'end-user'  ← 终端客户，只看到自己的账号和任务
          = 'viewer'    ← 普通查看者（预留）
```

层级关系通过 `User.parentId` 实现：
- `admin` → `parentId = null`
- `editor` → `parentId = adminId`
- `end-user` → `parentId = editorId`

### 窗口池体系

```sql
DevicePool {
  ownerId     → 关联 editor
  totalWindows → 总配额（如 50）
  usedWindows  → 已用
  dailyQuota   → 每日可刷新窗口数
}

WindowSession {
  poolId      → 关联 DevicePool
  deviceId    → 关联 Device（物理Q1窗口实例）
  status      → active / closed / expired
  taskCount   → 此窗口执行任务数
}

Device {
  ownerId      → 关联 editor
  phyDeviceName → 同一台 Q1 物理机名称（多窗口共享时相同）
  apiPort      → 如 30001
  rpaPort      → 如 30002
}
```

### 端口计算公式（Q1 非桥接模式）

```
API 端口 = 30000 + (坑位 - 1) × 100 + 1
RPA 端口 = 30000 + (坑位 - 1) × 100 + 2
ADB 端口 = 30000 + (坑位 - 1) × 100 + 0

实例 #1: 30001 / 30002 / 30000
实例 #2: 30101 / 30102 / 30100
...
实例 #12: 31101 / 31102 / 31100
```

---

## 五、魔云腾 Q1 集成详细说明

### 5.1 设备信息

```
设备: 魔云腾 Q1 v3
固件: v0.8.0
内网 IP: 192.168.1.14
客户端: 魔云腾 V3 客户端（Windows 软件）
```

### 5.2 GOTCHAS（巨坑，新人注意！）

#### 🔴 关键级

1. **API 在宿主机，不在容器内**
   - Q1 的 API 端口（30001）监听在 Q1 宿主机上，**不在 Android 容器内部**
   - 容器内部 `127.0.0.1:30001` 访问不到
   - 外部通过 `192.168.1.14:30001` 访问
   - 这意味着 frpc **不能在容器内部运行**（会连接拒绝）

2. **容器内部端口 ≠ 外部端口**
   ```
   外部: 192.168.1.14:30001 → 容器 #1 内部 9082
   外部: 192.168.1.14:30002 → 容器 #1 内部 9083
   外部: 192.168.1.14:30000 → 容器 #1 内部 5555 (ADB)
   ```

3. **cmd=6 执行 shell**
   - `http://{ip}:{port}/modifydev?cmd=6&cmdline={url编码的命令}`
   - 执行的是**容器内部**的 shell
   - 例如 `ps | grep frpc` 返回的是容器内的进程列表
   - 不是 Q1 宿主机

4. **截图接口**
   - `GET /task=snap&level=3` 返回一层级截图
   - `level` 参数控制截图层级（0-3）

#### 🟡 重要级

5. **魔云腾 V3 客户端安装顺序**
   - 必须先安装 **魔云互联**，再安装 **公网穿透**
   - 只安装公网穿透会丢失 Web 管理面板
   - 公网穿透装完后会给一个 Web 管理地址（如 `http://120.55.43.195:11285`）

6. **FRP Web 面板**
   - 地址: `http://服务器IP:端口`
   - 默认账号: `admin` / `admin`
   - 可以在这里新增 TCP/UDP 代理规则
   - 不在这里新增规则的话，隧道不会转发任何端口

7. **FRP 代理配置（关键！）**
   - 建 TCP 代理时:
     - 本地 IP = `192.168.1.14`（Q1 宿主机 IP）
     - 本地端口 = `30001`（Q1 宿主机上的 API 端口）
     - 远程端口 = `30001`（映射到服务器上的端口）
   - 建好后服务器上通过 `127.0.0.1:30001` 直接访问 Q1 API

8. **Prisma 不支持模型间 `/** */` 注释**（仅支持 `//` 行注释）

9. **数据库重置**
   - 测试数据可以随时清空重置 (`--force-reset`)
   - 生产数据不要用这条命令

#### 🟢 常规注意事项

10. **auth 机制**：前端通过 cookies（NextAuth session），API 通过 headers（`X-User-Id`, `X-User-Role`）
11. **账户密码存储**：SocialAccount.password 直接存储明文（加密未实现）
12. **任务执行**：`/api/automation-tasks/[id]/execute` 通过 Q1 uiautomator 执行
13. **编译**：Next.js 全量编译，一个 TypeScript 错误导致整个站点不可访问

---

## 六、API Routes 结构

| 前缀 | 权限 | 说明 |
|------|------|------|
| `/api/auth/*` | 公开 | 登录/注册 |
| `/api/admin/*` | admin | 仪表盘/邀请码 |
| `/api/devices` | admin/editor | 设备 CRUD |
| `/api/social-accounts` | admin/editor | 账号 CRUD |
| `/api/automation-tasks/*` | admin/editor | 任务 CRUD + 执行 |
| `/api/automation-templates` | admin/editor | 模板 CRUD |
| `/api/account-groups` | admin/editor | 分组 CRUD |
| `/api/ai-copy` | admin/editor | AI 文案 |
| `/api/video` | admin/editor | 视频处理 |
| `/api/dashboard` | 所有角色 | 旧版仪表盘（保留兼容） |
| `/api/ai-agent/*` | admin/editor | AI Agent CRUD + 聊天 |
| `/api/templates/*` | 所有角色 | 创意库模板 |
| `/api/content-submissions` | admin/editor | 内容审核 |
| `/api/script-templates` | admin/editor | 脚本模板 |
| `/api/q1-devices` | admin | Q1 设备管理 |
| `/api/fetch-prompts` | admin | 抓取提示词 |
| `/api/prompt-templates` | admin | 提示词模板库 |

---

## 七、前端页面结构

| 页面 | 路径 | 角色 |
|------|------|------|
| 登录 | `/login` | 公开 |
| 注册 | `/register` | 公开 |
| 管理员后台 | `/admin/*` | admin/editor |
| 仪表盘 | `/admin/dashboard` | admin/editor |
| 设备管理 | `/admin/devices` | admin/editor |
| 社交账号 | `/admin/social-accounts` | admin/editor |
| 账号分组 | `/admin/account-groups` | admin/editor |
| 任务中心 | `/admin/automation-tasks` | admin/editor |
| AI 文案 | `/admin/ai-copy` | admin/editor |
| 视频中心 | `/admin/video` | admin/editor |
| 内容审核 | `/admin/content-submissions` | admin/editor |
| AI Agent | `/admin/ai-agent` | admin/editor |
| 自动模板 | `/admin/automation-templates` | admin/editor |
| 邀请码 | `/admin/invite-codes` | admin |
| 设备池配置 | `/admin/device-pools` | admin（未确认是否存在） |
| 用户仪表盘 | `/dashboard` | end-user |

---

## 八、当前未解决问题 (TODO)

### P0 - 阻塞问题

| 问题 | 说明 |
|------|------|
| 暂无 | 网站已正常编译运行 |

### P1 - 下一步应该做

| 问题 | 说明 |
|------|------|
| **Dashboard 数据填充** | AI 用量/直播等预留区域等待真实数据 |
| **Q1 截图展示** | 后端已能截图，前端 Device 页面显示实时画面 |
| **API 统一认证** | 部分 API 用 `getAuthFromHeaders`，部分用 `getUserContext`，不统一 |

### P2 - 未来迭代

| 问题 | 说明 |
|------|------|
| 密码加密 | SocialAccount.password 明文存储 |
| 定时任务 | 支持定时自动执行任务 |
| 直播功能 | Q1 流管理对接 |
| Token 计费 | AI 调用的 token 统计和计费 |
| 多 Q1 管理 | 多台 Q1 设备同时管理 |
| 数据备份 | 数据库自动备份 |

---

## 九、关键命令备忘

```bash
# 编译
cd /root/AiMarketing && npm run build 2>&1 | tail -5

# 重启
pm2 restart aimarketing

# 查看日志
pm2 logs aimarketing --lines 30

# 查看错误日志
cat /root/.pm2/logs/aimarketing-error.log | tail -30

# Prisma
npx prisma generate
npx prisma db push --accept-data-loss --force-reset  # 清数据重建

# 测试 Q1 隧道
curl -s "http://127.0.0.1:30001/task=snap&level=3" -o /tmp/test.png

# 测试网站
curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3000/admin/dashboard
```

---

## 十、Git 仓库

```
远程: github.com:57974422j-art/AiMarketing.git
分支: master (force push)
本地: D:\AiMarketing
```

---

*此报告由 AI 自动生成，作为后续 AI 接手的上下文参考。*
