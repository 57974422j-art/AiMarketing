# AiMarketing 项目完整报告

> 生成日期: 2026-05-24
> 项目路径: `/root/AiMarketing` (服务器) / `D:\AiMarketing` (本地)
> 域名: http://120.55.43.195:3000
> PM2 进程名: `aimarketing`
> Electron 客户端: 打包后 `dist-electron\AI营销助手 Setup 0.1.0.exe`

---

## 一、技术栈

| 层 | 技术 | 版本 |
|---|---|---|
| 框架 | Next.js (App Router) | 14.2.0 |
| 语言 | TypeScript | 5.5.4 |
| 样式 | TailwindCSS | 3.4.0 |
| 数据库 | SQLite (文件) | Prisma ORM 5.22.0 |
| 服务端运行 | PM2 | systemd |
| 客户端 | Electron | 33.x |
| ADB | @devicefarmer/adbkit + platform-tools | 本地脚本目录 |
| 投屏 | scrcpy | 2.7 (本地脚本目录) |
| 第三方 | 阿里云 OSS / 阿里云语音识别 | ali-oss 6.23.0 |
| 部署 | GitHub → 服务器 git pull | |

---

## 二、功能清单

### ✅ 已完成

| 功能 | 路径 | 说明 |
|------|------|------|
| **登录/注册** | `/login`, `/register` | 邀请码注册，三层角色 |
| **管理员后台** | `/admin` | 卡片式导航 |
| **数据看板 (三层)** | `/admin/dashboard` | admin/editor/end-user 三层数据 |
| **设备管理** | `/admin/devices` | 设备 CRUD，Q1 设备类型 |
| **Q1 物理机管理** | `/admin/phy-devices` | 添加 Q1 → 一键扫描全部容器 |
| **任务模板** | `/admin/automation-templates` | 平台卡片+抽屉配置（关键词/时间/全部动作） |
| **任务执行中心** | `/admin/automation` | 设备状态+已绑账号平台芯片+执行记录 |
| **社交账号 (编辑绑定)** | `/admin/social-accounts` | editor 绑定设备，admin 按 editor 折叠查看 |
| **账号登记 (终端)** | `/accounts` | 终端用户登记账号（多平台勾选+手机号密码） |
| **邀请码管理** | `/admin/invite-codes` | admin 可生成任意角色，editor 可生成终端 |
| **自动任务 (API)** | `/api/automation-tasks/[id]/execute` | Q1 uiautomator 驱动执行 |
| **AI 文案** | `/admin/ai-copy` | 可用 |
| **AI Agent** | `/admin/ai-agent` | 可用 |
| **内容审核** | `/admin/content-submissions` | 可用 |
| **账号分组** | `/admin/account-groups` | 保留，后续分组用 |
| **Q1 扫描 (v2)** | `/api/q1-devices/scan` | 调 Docker `/android` 接口，一次扫全部容器 |
| **Electron 客户端框架** | `electron/main.js` | 窗口 + ADB 桥接 + 投屏 + 截图 |
| **本地设备检测** | `/accounts` (Electron 专用) | USB/WiFi ADB 自动检测，5秒轮询 |
| **本地设备投屏** | `adb:mirror` IPC | 调用 scrcpy 实时显示手机画面 |
| **本地设备截图** | `adb:screenshot` IPC | ADB screencap + pull 到本地临时目录 |
| **本地运行脚本** | `/accounts` 弹窗 | 一键打开App/输入/点击/上滑/自定义 Shell |
| **ADB HTTP 桥接** | `adb:bridge` IPC | 启动本地 HTTP 服务兼容 Q1 modifydev 协议 |
| **本地设备登记权限** | `/accounts` 登记流程 | 未登记的只显示「登记设备」，审核后解锁功能 |

### 🚧 部分完成

| 功能 | 说明 |
|------|------|
| Dashboard AI 用量 | UI 有，数据未接入 |
| Dashboard Token 消耗 | 纯占位 |
| 获客模块 | 任务模板预留，功能未实现 |
| 官方API/指纹浏览器 | 绑定类型已预留，逻辑未实现 |

### ❌ 未开始

| 功能 | 说明 |
|------|------|
| 精准获客（企业/高德/截流/直播） | 预留位 |
| IMAI.WORK 指纹模拟器接入 | 预留位 |
| 定时发布 | 等待执行引擎 |
| AI 视频自动生成 | 未接 |

---

## 三、部署方式

```
IP: 120.55.43.195
SSH: root@120.55.43.195
项目路径: /root/AiMarketing
运行方式: pm2 start npm --name aimarketing -- start
端口: 3000
部署: git push → git pull → npm run build → pm2 restart
```

### 本地开发（Electron）

```
npm run dev              → 纯 Web 开发
npm run electron:dev     → Web + Electron 窗口（自动连服务器）
npm run electron:build   → 打包客户端 exe
npm run electron:start   → 直接运行 Electron
```

---

## 四、数据库关键模型

### 三层用户体系

```
User.role = 'admin'       ← 管理员，全可见
          = 'editor'      ← 二级客户，看自己下属终端的
          = 'end-user'    ← 终端客户，只看自己的

层级关系通过 User.parentId 实现：
  admin (parentId=null)
    └── editor (parentId=admin.id)
          └── end-user (parentId=editor.id)
```

### 账号体系（Account 统一表）

```
Account
  ├── platform     → douyin/kuaishou/xiaohongshu/... / local-device
  ├── accountName  → 昵称
  ├── mobile       → 手机号
  ├── password     → 密码
  ├── deviceId     → 绑定的 Q1 设备（null=本地设备）
  ├── status       → 未绑定/已绑定/登录异常/已封禁
  ├── bindType     → device(真机)/imai(指纹)/official(API)
  ├── accountId    → 主页链接(普通账号) 或 ADB序列号(local-device)
  ├── remark       → 备注，也可存 "adb:10CF3G0YDS003AD" 格式
  └── userId       → 所属用户
```

### Q1 物理机 + 容器

```
PhyDevice                  Device（容器窗口）
  ├── name                 ├── name
  ├── ip                   ├── apiPort (30001)
  ├── port (8000)          ├── rpaPort (30002)
  └── status               ├── adbPort (30000)
                            ├── ownerId → 归谁
                            └── phyDeviceId → 挂到哪台 Q1
```

### 任务配置

```
TaskConfig
  ├── accountId / deviceId  → 哪个账号在哪台设备
  ├── platform              → 抖音/快手
  ├── keywords [JSON]       → ["火锅","美业"]
  ├── timeStart / timeEnd   → 09:00 ~ 23:00
  └── actions [JSON]        → ["search","like","comment","share","publish"...]
```

---

## 五、魔云腾 Q1 集成

### 设备信息

```
设备: 魔云腾 Q1 v3
固件: QL-q1n-2026.v0.8.0
内网 IP: 192.168.1.14
管理端口: 8000（Docker API）
容器端口: 
  API = 容器内 9082 → 映射到宿主机
  RPA = 容器内 9083  
  ADB = 容器内 5555

端口计算公式（非桥接模式）:
  indexNum 1: api=30001, rpa=30002, adb=30000
  indexNum 2: api=30101, rpa=30102, adb=30100
  indexNum N: api=30000+(N-1)*100+1, rpa=..., adb=...
```

### Docker API 认证

```
接口: http://{Q1_IP}:8000/android
认证: HTTP Basic Auth, 用户名 admin
密码: 在魔云腾V3客户端 → 密码管理设置
```

### FRP 隧道

```
FRP Web 面板: http://120.55.43.195:11285（admin/admin）
当前隧道:
  q1-api     → 30001 → 192.168.1.14:30001
  q1-docker  → 28000 → 192.168.1.14:8000
新增 Q1 时：加一条 FRP 隧道到服务器的不同端口
```

### 容器扫描（v2）

```
调 http://127.0.0.1:{dockerPort}/android
→ 返回所有容器列表（含 portBindings）
→ 自动解析 9082→apiPort, 9083→rpaPort, 5555→adbPort
→ 批量创建/更新 Device 记录
→ 未来新 Q1 只需 FRP 隧道 + 添加 PhyDevice
```

### GOTCHAS

1. API 在宿主机不在容器内（容器内部 127.0.0.1:30001 不可用）
2. cmd=6 执行 shell 在容器内，不在宿主机
3. Docker API 认证走 HTTP Basic Auth，用户名固定 `admin`
4. 8000 端口需要设密码，否则返回 Forbidden
5. FRP 远程端口避开已占用端口（8000 不可用，改用 28000）

---

## 六、Electron 客户端架构

```
electron/
  ├── main.js      ← 主进程: 窗口管理 + ADB IPC + HTTP桥接
  └── preload.js   ← 桥接: 暴露 window.electronAPI 到渲染进程
scripts/
  ├── platform-tools/  ← adb.exe (本地ADB驱动)
  └── scrcpy/          ← scrcpy.exe (投屏工具)
```

### IPC 通道

| 通道名 | 方向 | 说明 |
|--------|------|------|
| `adb:devices` | renderer→main | 获取ADB设备列表 |
| `adb:shell` | renderer→main | 执行 ADB shell 命令 |
| `adb:screenshot` | renderer→main | 截图并保存到临时目录 |
| `adb:mirror` | renderer→main | 启动 scrcpy 投屏 |
| `adb:tap` | renderer→main | 点击坐标 |
| `adb:input` | renderer→main | 输入文字 |
| `adb:swipe` | renderer→main | 滑动 |
| `adb:bridge` | renderer→main | 启动HTTP桥接（兼容Q1协议） |

### 本地设备登记权限流

```
① Electron 检测手机 → 显示序列号 +「📋 登记设备」按钮
② 点击登记 → POST /api/accounts (platform='local-device', accountId=序列号)
③ 管理员在 /admin/social-accounts 找到记录 → 更改 status='已绑定'
④ 用户刷新 → 截图/投屏/运行按钮出现
```

---

## 七、邀请码体系

```
admin 生成 → editor 角色 → 注册后 parentId=admin.id
editor 生成 → end-user 角色 → 注册后 parentId=editor.id
终端账号归属自动由邀请码创建者决定
```

---

## 八、账号流转流程

```
终端 /accounts 登记
  → 填平台+昵称+手机号+密码
  → 记录入 Account 表，status=未绑定
  ↓
editor /admin/social-accounts
  → 看到下属终端的待绑定账号
  → 选择设备 → 绑定
  → status=已绑定
  ↓
admin /admin/social-accounts
  → 按 editor 折叠查看全局
  → 不负责绑定
  ↓
任务执行 /admin/automation
  → 读取 status=已绑定 + deviceId 匹配的账号
  → 显示平台芯片（颜色=状态）
```

### 本地设备流转（新增）

```
① 终端客户 Electron 插手机
  → /accounts 页面显示本地设备 + 序列号
  → 点击「登记设备」
  → POST /api/accounts (platform='local-device', bindType='imai')
  ↓
② 管理员 /admin/social-accounts
  → 看到 platform='local-device' 的记录
  → 审核后标记 status='已绑定'
  ↓
③ 终端客户刷新 /accounts
  → 本地设备卡片显示「截图」「投屏」「运行」
```

---

## 九、部署命令

```bash
# 拉取部署
cd /root/AiMarketing && git pull && npm run build 2>&1 | tail -3 && pm2 restart aimarketing

# schema 变更时（新增字段/模型）
npx prisma generate && npx prisma db push 2>&1 | tail -3

# 强制重置数据库（清数据！慎用）
npx prisma db push --accept-data-loss --force-reset

# 测试 Q1 隧道
curl -s "http://127.0.0.1:30001/task=snap&level=3" -o /tmp/test.png
curl -s -u "admin:123456" http://127.0.0.1:28000/android | python3 -m json.tool | head -20

# 测试网站
curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3000/login

# Electron 开发
cd D:\AiMarketing
npm run electron:dev       # 启动开发模式（Web8081+Electron窗口）
npm run electron:build     # 打包客户端安装包
```

---

## 十、Git 仓库

```
远程: github.com:57974422j-art/AiMarketing.git
分支: master (force push)
本地: D:\AiMarketing
```

---

## 十一、注意事项（给 AI 阅读）

### 不要上传到 Git 的目录
```
scripts/platform-tools/   ← ADB 二进制（15MB，已在 .gitignore）
scripts/scrcpy/           ← scrcpy 二进制（160MB，已在 .gitignore）
node_modules/             ← npm 包
.next/                    ← 构建产物
dist-electron/            ← 打包产物
*.db                      ← 数据库文件
.env                      ← 密钥
```

### 不要读取 / 浪费 Token 的目录
```
node_modules/            ← 几十万行代码，不要看
.next/                   ← 构建产物，没用
dist-electron/           ← 打包产物
scripts/scrcpy/          ← 二进制，不要读
scripts/platform-tools/  ← 二进制，不要读
```

### 本地 Electron 环境依赖
```
1. adb.exe → scripts/platform-tools/ （手动下载）
2. scrcpy.exe → scripts/scrcpy/      （手动下载）
3. adb 驱动 → 手机需要打开 USB 调试
```

### 架构要点
```
1. 所有 API 路由在 /api/ 目录下，用 getUserContext() 获取用户
2. Electron 只是浏览器壳，业务代码跑在服务器上
3. 本地设备 = Electron IPC ➔ child_process.exec(adb)
4. Q1 设备 = HTTP ➔ Q1 API ➔ Docker 容器内 shell
5. 页面用 Tailwind + 玻璃态设计（card-glass, btn-primary, input-dark）
6. 增加新模型需要: schema.prisma → npx prisma db push
```

---

*报告由 AI 维护，每次重大变更后更新*
