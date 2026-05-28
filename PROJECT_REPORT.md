# AiMarketing 项目完整报告

> 生成日期: 2026-05-28
> 项目路径: `/root/AiMarketing` (服务器) / `D:\AiMarketing` (本地)
> 域名: http://120.55.43.195:3000
> PM2 进程名: `aimarketing`

---

## 一、功能清单

### 管理中心（admin/）

| 页面 | 状态 | 说明 |
|------|------|------|
| **数据看板** `/admin/dashboard` | 完成 | 三层数据看板 |
| **账号信息中心** `/admin/users` | 2026-05-27 重构 | 原"客户管理"重写为卡片式信息中心 |
| **社交账号** `/admin/social-accounts` | 2026-05-27 重构 | 加了解绑+删除+远程截图 |
| **设备管理** `/admin/devices` | 完成 | Q1 容器列表，含远程截图 |
| **Q1 物理机** `/admin/phy-devices` | 完成 | 分配 editor 时同步容器 ownerId |
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
| **仓库** | `/storage` | 文件存储 |
| **本地自动化** | `/my-automation` | end-user 真手机发布任务 |

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

## 四、注意事项（给接手AI）

1. **编辑工具用法** `replace_in_file({filePath, old_str, new_str})` 三个参数必填
2. **不要写 .mjs 脚本** 改代码直接在文件上修改
3. **数据库** `prisma/dev.db`，改 schema 后 `npx prisma db push`
4. **部署** git push → 服务器 `git pull && rm -rf .next && npm run build 2>&1 | tail -5 && pm2 restart aimarketing`
5. **角色** admin=管理员, editor=代理商, end-user=终端客户
6. **模板 params** 是 JSON 字符串，新增字段要同步更新 interface
7. **不要读** node_modules/ .next/ dist-electron/ scripts/
8. **PM2 日志** `/root/.pm2/logs/aimarketing-error.log`
9. **发布按钮定位** 抖音底部"+"按钮 clickable=false，需 dumpXml 全节点扫描 ImageView
