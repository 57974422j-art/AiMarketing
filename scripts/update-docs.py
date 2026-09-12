# -*- coding: utf-8 -*-
import io, sys, re
sys.stdout.reconfigure(encoding='utf-8')

# ── PROJECT.md：更新顶部速查段 ──
p = 'PROJECT.md'
c = io.open(p, encoding='utf-8').read()
QUICK = """# 📌 会话恢复速查（2026-09-12，压缩后先读这段）

## 当前版本与产物
- **1.0.146（333MB）已打包未发布**；`dist-rel/` 里有 1.0.141~146
- 打包：`node scripts/bump-version.mjs X.Y.Z && node scripts/build-local.mjs`（~13 分钟）
- 发版：scp 三件套 → 服务器 `node scripts/update-oss`（实际脚本 `upload-update-oss.mjs public/updates`）→ cp latest.yml → pm2 restart

## 客户端（Electron 纯壳）
- 加载远程页面 `https://ai-niuma.cc`（`loadURL`）——**前端改动只需服务器部署，不用重打包**
- **userData = 安装目录\\data\\**（登录态/browser-profile/bu_debug.log）；本地仓库 = 安装目录\\storage\\
- 安装包瘦身已完成（547→333MB）：`build.files` 去 `.next` + 17 条 node_modules 排除；`electronLanguages` 中英；extraResources 去 models/sherpa
- **必须保留**：`ms-playwright`（指纹发布内核）、`scripts/{scrcpy,platform-tools}`（群控发布）、`scripts/{browser-use,agent-publish}`、`opencli`
- ⚠️ `package.json.bak-sl` / `scripts/build-local.mjs.bak-sl` 是**瘦身前旧备份**，勿覆盖回去

## AGENT 发布（四平台，确定性脚本）
- 链路：chat route 建任务（task 存 JSON）→ 客户端 `checkBrowserTasks` → `scriptMap` 分发
  - `douyin→bu_pub_douyin.py`｜`xiaohongshu→bu_pub_xhs.py`｜`weibo→bu_pub_weibo.py`｜`shipinhao→bu_pub_shipinhao.py`
  - 无脚本平台 → 回退 `bu_exec.py`（browser-use）
- 脚本目录：`scripts/agent-publish/`（客户端里在 `resources/scripts/agent-publish/`）
- **发布按钮统一用 CDP 穿透点击**（`_cdp_click.py`）：`DOM.getDocument(pierce)` → `getBoxModel` 准确坐标 → `mouse.click`；**参数 exact=True（精确文本）+ prefer_bottom_right（右下优先）+ 候选日志**
- 踩过的坑：文本【包含】匹配会命中导航/菜单（任务#15 点了左侧导航）；`frame.evaluate` 自算坐标会偏（视频号 iframe 偏 400px）

## 封面生成（百炼生图）
- 常态 **81~105 秒**（实测 3/3 成功），偶发更久 → **硬等**：服务器轮询 **570s**、前端 fetch **600s**、nginx **600s**
- 取值字段：`output.choices[0].message.content[0].image`（**不是** `results[0].url`）
- 提示要点：prompt 含标题文字，偶发会触发审核/失败

## 环境自检（客户端 Python）
- 启动 8 秒后静默自检 + 缺则后台装（内置→系统 pip→下载 zip）；**装完弹窗告知已安装组件**
- 发布时未就绪 → **静默补装**（不弹窗）
- **禁止主进程同步调用**（spawnSync/execSync）→ 一律 `runAsync`（曾致界面未响应）
- `python-bu.zip`（OSS updates/，89,581,744 字节）**已含 playwright/greenlet/pyee**

## 常用命令
- 服务器部署：`cd /root/AiMarketing && git fetch origin && git reset --hard origin/master && bash scripts/deploy-server.sh`
- 客户端日志：`安装目录\\data\\bu_debug.log`
- 服务器日志：`pm2 logs aimarketing --lines 200 --nostream`

---
"""
# 插到文件最前（若已有速查段则替换）
if '# 📌 会话恢复速查' in c:
    c = re.sub(r'# 📌 会话恢复速查.*?\n---\n', lambda m: QUICK, c, flags=re.S, count=1)
    print('PROJECT.md 速查段：已替换')
else:
    c = QUICK + c
    print('PROJECT.md 速查段：已插入顶部')
c = re.sub(r'> 最后更新：\S+', '> 最后更新：2026-09-12', c, count=1)
io.open(p, 'w', encoding='utf-8', newline='\n').write(c)

# ── EXECUTION_LOG：追加今天几条 ──
p2 = 'EXECUTION_LOG.md'
lines = io.open(p2, encoding='utf-8').read().split('\n')
ins = None
for i, ln in enumerate(lines):
    if ln.startswith('| 2026-'):
        ins = i
        break
rows = [
    '| 2026-09-12 | 客户端瘦身（547MB→333MB）：build.files 去 .next + 17 条 node_modules 排除（next/@next/prisma/@prisma/sherpa/@img/react/three/@capacitor/ali-oss 等）；electronLanguages 只留中英；extraResources 去 models/sherpa。保留 ms-playwright（指纹内核）/scrcpy+platform-tools（群控）/browser-use/agent-publish | package.json、scripts/build-local.mjs | 1.0.142~144 打包验证；启动实测无模块缺失 |',
    '| 2026-09-12 | 4 平台发布统一 CDP 穿透点击：抖音（原纯文本严格匹配→客户端"未找到发布按钮"）/小红书（像素定位改 CDP 优先）/微博（locator+CDP 兜底）/视频号（原 CDP） | scripts/agent-publish/bu_pub_*.py、_cdp_click.py | 任务#15 显示 CDP 命中 25 个"发布"点了左侧导航 → 已升级精确匹配+右下优先+候选日志 |',
    '| 2026-09-12 | 封面硬等：服务器轮询 180s→570s（3 处）、前端 fetch 240s→600s；修 topics 分支取值字段（results[0].url → choices[0].message.content[0].image）。实测百炼生图 81/105/81 秒 | src/app/api/agent/chat/route.ts、src/app/agent/page.tsx | nginx 已由用户改 600s；待部署验证 |',
]
for r in reversed(rows):
    lines.insert(ins, r)
io.open(p2, 'w', encoding='utf-8', newline='\n').write('\n'.join(lines))
print('EXECUTION_LOG 追加 3 条 OK')
