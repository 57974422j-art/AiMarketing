# AiMarketing 项目完整报告

> 生成日期: 2026-06-05 (更新)
> 项目路径: `/root/AiMarketing` (服务器) / `D:\AiMarketing` (本地)
> 域名: http://120.55.43.195:3000
> PM2 进程名: `aimarketing`
> Git: github.com:57974422j-art/AiMarketing.git (master)
> 技术栈: Next.js 14 + TypeScript + Prisma 5.22.0 + SQLite + Tailwind CSS

---

## ⚠️ 可忽略的文件/目录（不要浪费时间阅读）

| 路径 | 原因 |
|------|------|
| **根目录下的垃圾文件** `{console.table(r)`、`脚本.txt`、`addsnap.mjs`、`cd`、`console.log(e.message))`、`cookies.txt`、`git` | 之前调试残留，**可删除** |
| **`dist-electron/`** | Electron 打包输出产物（200+ 文件），自动生成的 |
| **`node_modules/`**、**`.next/`** | 依赖和编译缓存，规则禁止读取 |
| **`scripts/` 目录** | ADB工具、测试脚本、语音分离等辅助工具（37个文件），与核心功能无关 |
| **`temp/`** | 临时测试视频文件 |
| **`.tsbuildinfo`**、**`next-env.d.ts`** | 编译缓存 |
| **`fix-pubbtn.mjs`**、**`deploy.bat`**、**`fix_prisma.sh`** | 一次性修复/部署脚本 |
| **`src/*.bak`** | 备份文件 |
| **`scripts/douyin-test.png`** | 测试截图 |

> 💡 建议：可以清理根目录下那几个无意义文件（`{console.table(r)` 等），避免干扰 AI 接手

---

## 一、功能清单

### 管理中心（admin/）

| 页面 | 状态 | 说明 |
|------|------|------|
| **数据看板** `/admin/dashboard` | 完成 | 三层数据看板 |
| **账号信息中心** `/admin/users` | 2026-05-27 重构 | 原"客户管理"重写为卡片式信息中心 |
| **社交账号** `/admin/social-accounts` | 2026-05-27 重构 | 加了解绑+删除+远程截图 |
| **设备管理** `/admin/devices` | 完成 | Q1 容器列表，含远程截图 |
| **Q1 物理机** `/admin/phy-devices` | 完成 | 分配 PhyDevice 给 editor 时同步容器 ownerId |
| **任务模板** `/admin/automation-templates` | 2026-05-28 改造 | 勾选动作弹出对应配置项 |
| **任务执行** `/admin/automation` | 2026-05-28 改造 | 改为读模板配置执行 |
| **账号分组** `/admin/account-groups` | 已实现未使用 | 有数据表无功能引用 |
| **邀请码** `/admin/invite-codes` | 完成 | |
| **系统设置** `/admin/settings` | 完成 | AI/OSS/引擎配置 |
| **内容审核** `/admin/content-submissions` | 完成 | |
| **素材库** `/admin/media-library` | 完成 | |
| **话术模板** `/admin/script-templates` | 完成 | |

### AI 工具 / 终端

| 功能 | 路径 | 说明 |
|------|------|------|
| **一键合成** | auto-compile | AI 合成视频，支持推送到 Q1 相册 |
| **仓库（素材存储）** | `/storage` | 文件存储（500MB上限），支持视频/图片上传 |
| **本地自动化** | `/my-automation` | end-user 真手机发布任务 |

### 🔑 指纹浏览器（Fingerprint Simulator）— 核心模块 ⭐

> **前端路径**: `src/app/my-fingerprint/page.tsx` (~35KB)
> **后端路径**: `electron/` 目录
> **技术栈**: Electron 主进程 + Playwright 浏览器自动化
> **部署注意**: Electron 客户端加载远程服务器页面 (`SERVER_URL=http://120.55.43.195:3000`)
>   - 前端 UI 改动 → 服务端 build 部署后才可见
>   - 模板改动（douyin-publish.js 等） → 客户端需重新打包安装

#### 功能概述

| 功能 | 模板Key | 说明 |
|------|---------|------|
| **抖音发视频** | `douyin-publish` | 上传视频→填标题/正文→话题→封面→位置→发布/草稿 |
| **抖音点赞** | `douyin-like` | 当前页滚动点赞 |
| **抖音评论** | `douyin-comment` | 填评论内容并发布 |
| **小红书发帖** | `xiaohongshu-publish` | 小红书文案发布 |
| **停止按钮** | — | 运行中可中断脚本执行（global.__fpAbort） |

#### 抖音发视频参数表（douyin-publish v5）

| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `storageFileName` | string | ✅ | 素材仓库名称（如 `1779884904572_dbd01667.mp4`） |
| `userId` | number | 自动获取 | 从 storage API 提取 |
| `title` | string | 推荐 | 作品标题（最多30字） |
| `description` | string | 推荐 | 作品简介/正文（最多1000字） |
| `topics` | string | 可选 | 自定义话题，支持 `#宠物 #萌宠` 或 `#宠物#萌宠` 格式 |
| `coverImage` | string | 可选 | 素材仓库中的封面图片名（jpg/png/webp），留空用系统默认 |
| `location` | string | 可选 | 地理位置文本（如"北京市朝阳区"） |
| `publishNow` | string | 默认 true | `true`=立即发布, `false`=仅存草稿 |

---

## 二、关键数据模型

```
User: id, username, email, passwordHash, name, role, parentId, plan
  role = admin | editor | end-user
  plan = free | pro | enterprise

Account: id, platform, accountName, userId, deviceId, status, isBound, bindType

Device: id, name, ownerId, apiPort, rpaPort, adbPort, phyDeviceId, type, status
PhyDevice: id, name, ip, port, ownerId, status

AutomationTemplate: id, name, type, params(JSON), ownerId
  params.actions = ['search','like','comment','follow','share','dm','publish','extract','comments']
```

---

## 三、三大关系

| 关系 | 说明 |
|------|------|
| **设备分配** | admin 录入 Q1 → 扫描容器 → 分配 PhyDevice 给 editor → 自动更新 Device.ownerId |
| **账号绑定** | editor 在社交账号页绑定账号到容器 → Account.deviceId=Device.id, isBound=true |
| **模板执行** | 选模板 → 读 actions → POST /api/devices/{id}/execute → 遍历执行 |

---

## 四、指纹浏览器 — 关键文件索引

### 文件结构

```
electron/
├── main.js                          # Electron 主进程 (~26KB) ⭐⭐⭐
│   ├── IPC 通道注册:
│   │   ├── fp:start                 # 启动浏览器实例 (Playwright launchPersistentContext)
│   │   ├── fp:stop                  # 停止浏览器实例
│   │   ├── fp:list                  # 列出活跃实例 + 状态
│   │   ├── fp:screenshot            # 截图
│   │   ├── fp:click/fp:type         # 点击/输入
│   │   ├── fp:execute               # 执行模板（路由分发）
│   │   └── fp:scriptStop            # 设置 global.__fpAbort=true 停止脚本
│   ├── case 'douyin-publish' 分支:
│   │   ├── 从 storage API 下载视频到 %TEMP%\aimarketing-videos\
│   │   ├── stream 方式下载 (http.get/https.get)
│   │   └── 传递 userId/coverImage/location 等参数给模板
│   └── BrowserInstance 管理 Map
│
├── preload.js                       # IPC桥接 (~3KB) ⭐
│   └── window.electronAPI 暴露给渲染进程:
│       ├── fpStart(opts) → ipcRenderer.invoke('fp:start')
│       ├── fpStop(port) / fpList() / fpScreenshot(port)
│       ├── fpExecute(port, templateType, params)
│       └── fpScriptStop() → ipcRenderer.invoke('fp:scriptStop')
│
└── fp-templates/
    └── douyin-publish.js            # 抖音发视频模板 (~600行) ⭐⭐⭐
        ├── executeDouyinPublish()   # 主入口函数（module.exports）
        ├── step1_navigate()         # 导航到 creator.douyin.com/content/upload
        ├── step2_upload()           # 视频上传（file input / filechooser 三种方法）
        ├── step3_waitUpload()       # 等待转码+进入编辑页（核心判定逻辑）
        ├── step4_fillContent()      # 填标题(input/textarea) + 正文(contenteditable)
        ├── step5_topics()           # #添加话题 手动输入模式
        ├── step55_location()        # 地理位置填写
        ├── step6_covers()           # 封面选择/自定义上传（弹窗管理）
        └── step7_publish()          # 发布 或 存草稿

src/app/my-fingerprint/page.tsx      # 指纹模拟器前端页面 (~35KB) ⭐⭐
    ├── Window.electronAPI 类型声明（第48-62行）
    ├── 模板选择 TEMPLATES 数组（第33-45行）
    ├── 状态管理（storageVideoName/templateTitle/templateDesc...）
    ├── 素材仓库视频选择器（从 storage API 获取列表）
    ├── 自定义封面图片选择器
    ├── 地理位置输入框
    ├── 执行日志显示区
    └── 停止按钮（红色 ⏹）

相关 API 文件:
├── src/middleware.ts                # 中间件：JWT鉴权 + 白名单
├── src/lib/api-auth.ts             # getAuthFromHeaders() 解析 X-User-Id
├── src/app/api/storage/files/route.ts  # 素材仓库列表（白名单+query param 兼容）
├── src/app/api/storage/file/route.ts   # 单文件下载（已加入白名单，无需token）
└── src/app/storage/page.tsx         # 素材仓库管理页面
```

---

## 五、最近更新记录（2026-05 ~ 2026-06-05）

### 指纹浏览器模块迭代

| 日期 | Commit | 改动内容 |
|------|--------|---------|
| 2026-06-05 | `8a49901` | 自定义封面上传 + 位置标签(step55) + 话题#号分隔 + 封面弹窗修复(完成按钮关闭) |
| 2026-06-05 | `0129c1a` | 标题支持 input/textarea 元素(不再只找 contenteditable) + 封面按钮 includes 匹配 |
| 2026-06-05 | `a93e1d5` | storage/files API 加入白名单 + query param userId 兼容 Electron 环境 |
| 2026-06-05 | `1ce03ed` | storage/file API 加入白名单解决 httpOnly token 401 问题 |
| 2026-06-05 | `f426546` | 素材仓库下载带 JWT Cookie 解决 HTTP 401 |
| 2026-06-05 | `3ff0489` | 添加 fpScriptStop TypeScript 类型声明 |
| 更早 | — | main.js 清理残留代码、重复声明；前端 UI v5 重写(标题/正文拆分)；视频从素材仓库选取 |

---

## 六、注意事项（给接手AI）

### 强制规则（项目级）

1. **编辑工具用法** `replace_in_file({filePath, old_str, new_str})` 三个参数必填
2. **不要写 .mjs 脚本** 改代码直接在源文件上修改
3. **不要读** node_modules/ .next/ dist-electron/ scripts/
4. **不删文件、不改 package.json/tsconfig.json**
5. **每次只改一个文件**，改完等确认
6. **公开路径**：/ /login /register /ai-copy /video-edit /ai-agent /dashboard

### 部署

```bash
# 服务端部署（前端/UI 改动后必须执行）
cd /root/AiMarketing && git pull && rm -rf .next && npx next build && pm2 restart aimarketing

# 客户端部署（electron/ 模板改动后需要重新打包安装）
# electron/main.js 和 electron/fp-templates/*.js 是本地文件
```

### 数据库

```bash
# prisma/dev.db (SQLite)
# 改 schema 后 npx prisma db push（但当前规则禁止执行 prisma generate）
```

### 角色

- `admin` = 管理员
- `editor` = 代理商
- `end-user` = 终端客户

### 指纹浏览器特有注意事项

7. **Electron 加载远程页面**: 客户端加载 `http://120.55.43.195:3000/my-fingerprint`，前端改了代码服务器没 build 部署就看不到新 UI
8. **模板是本地文件**: `electron/fp-templates/douyin-publish.js` 在客户端本地，改了需要重新打包
9. **Middleware 白名单**: `/api/storage/file` 和 `/api/storage/files` 已加入白名单（因为 Electron http.get 无法带 httpOnly cookie）
10. **Storage API 兼容**: 前端 fetch 带 `?userId=${user.id}` 参数，后端 fallback 到 query param 读 userId
11. **视频下载路径**: `%TEMP%\aimarketing-videos\`（Windows）或 `/tmp/aimarketing-videos/`（Linux）
12. **封面下载路径**: `%TEMP%\aimarketing-covers\`
13. **停止机制**: `global.__fpAbort` 布尔标志，每轮循环检查；IPC通道 `fp:scriptStop`
14. **IPC 通道命名冲突**: 已有 `fp:stop` 用于停浏览器实例，所以停止脚本用了 `fp:scriptStop`
15. **标题元素类型不确定**: 抖音可能用 input 也可能用 contenteditable div，两种都要尝试
16. **封面弹窗遮挡**: 点第一个「选择封面」打开弹窗后，第二个按钮被弹窗遮盖无法点击 → 需要先点「完成」关闭弹窗
17. **Step3 判定优先级**: 终止(作品检测失败) > 成功(封面文字) > 成功(contenteditable 表单)

### 魔云腾 Q1 设备

18. **PM2 日志** `/root/.pm2/logs/aimarketing-error.log`
19. **发布按钮定位** 抖音底部"+"按钮 clickable=false，需 dumpXml 全节点扫描 ImageView
20. **ADB 端口**: 每容器需独立 FRP 隧道，不能复用

---

## 七、魔云腾 Q1 设备端口说明（v3 固件 v0.8.0）

> 宿主机 IP: `192.168.1.14`，FRP 管理面板: `http://120.55.43.195:11285` (admin/admin)

### 每个容器的 4 个端口

| 端口 | 名称 | 当前在用？ | 用途 | FRP 隧道 |
|------|------|-----------|------|---------|
| **`{apiPort}`** (如 30101) | 安卓设备管理API | ✅ **主力** | HTTP REST API: `/modifydev`(shell)、`/upload`、`/download`、`/info`、`/task=snap`(截图) | ✅ 已配 |
| **`{rpaPort}`** (如 30102) | RPA自动化API | ❌ 未用 | TCP 直连协议，提供 `sendText`(输入文字)、`touchClick`、`dumpNodeXml`、`takeCaptrue`(截图) | ❌ 未配 |
| **`{adbPort}`** (如 30100) | Android ADB | ⚠️ 部分用 | 快速滑动、ADBKeyBoard 中文输入 | ⚠️ 仅 T0001 已配 |
| 8000 | Docker管理 | ❌ 无关 | 容器生命周期管理 | ❌ 不需要 |

### 端口映射规则（以 T0002 为例）

```
容器内部 → 宿主机映射
  9082(设备管理API)  → 30101
  9083(RPA自动化API)  → 30102
  5555(ADB)          → 30100
  8000(Docker管理)    → 8000
```

### 当前实际分配

| 数据库 ID | 容器名 | apiPort | adbPort | rpaPort | FRP 状态 |
|-----------|--------|---------|---------|---------|----------|
| 1 | T0001 | 30001 | 30000 | 30002 | api+adb 已配 |
| 2 | T0002 | 30101 | 30100 | 30102 | 仅 api |
| 3 | T0003 | 30201 | 30200 | 30202 | 仅 api |

### 已知问题

- **ADB 端口需要每个容器独立 FRP 隧道**（不能复用），否则 ADB 命令会等 15 秒超时
- **`input text` 在 Q1 v0.8.0 shell 中不可用**（`/sdcard/upload/` 在 shell 中不可读）
- **RPA API（{rpaPort}）有 `sendText` 和 `touchClick`**，如果配通可能替代 ADB 解决中文输入问题，有待测试
- **API 端口（{apiPort}）已经全部配通 FRP**，HTTP shell 控制所有设备无问题

---

## 八、已知 Bug / 待优化项

| 优先级 | 问题 | 状态 | 备注 |
|--------|------|------|------|
| 🔴 高 | 封面弹窗第二个按钮仍偶发超时 | 部分 | 已加「完成」关闭逻辑，待验证 |
| 🟡 中 | 话题输入后未自动触发推荐选择列表 | 待测 | 可能需要更精确的等待时机 |
| 🟡 中 | 位置输入后下拉推荐匹配不稳定 | 待测 | 取决于抖音接口响应速度 |
| 🟢 低 | 根目录垃圾文件未清理 | 建议 | 见上方「可忽略的文件」表格 |
