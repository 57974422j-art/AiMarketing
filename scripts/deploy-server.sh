#!/bin/bash
# 2026-08-24: 服务器一键部署（建议②）——备份db→拉取→build→delete+start→验证
# 用法: 服务器上 bash scripts/deploy-server.sh
#       （规范调用：cd /root/AiMarketing && git fetch origin && git reset --hard origin/master && bash scripts/deploy-server.sh）
# ⛔ 2026-10-06 事故：有人（AI）拿 `git pull && npm run build && pm2 restart aimarketing` 当部署命令 ——
#   最致命的是**漏了本脚本第 5 步**：服务器跑 .next/standalone/server.js，而 standalone 产物不含
#   static/ 与 public/，必须拷进去；漏拷 ⇒ 前台 JS/CSS chunk 全 404（白屏/无样式），
#   但 API 200、pm2 online、日志无报错 ⇒ 前台坏了却看不出原因（用户原话「命令错了 前台不显示报错」）。
#   ⚠️ 第 4 步的 `rm -rf .next` 也不能省：它保证第 5 步的目标目录不存在，`cp -r` 才是"复制成目标"而不是
#      "复制到已存在目录里面"（否则静态资源会落到 .next/standalone/.next/static/static 里，照样 404）。
set -e
cd /root/AiMarketing
echo "[1/7] 备份数据库…"
mkdir -p /root/db-backup
sqlite3 prisma/dev.db ".backup '/root/db-backup/dev-$(date +%Y%m%d-%H%M).db'" || cp prisma/dev.db /root/db-backup/dev-$(date +%Y%m%d-%H%M).db
echo "[2/7] 拉取代码…"
git fetch origin && git reset --hard origin/master
echo "[3/7] 判断是否需要 npm install（lock 变才是依赖真变——版本号改动不触发）…"
if git diff HEAD^ HEAD --name-only | grep -q "package-lock.json"; then npm install; else echo "依赖没变，跳过 install（版本号改动不触发）"; fi
echo "[4/7] 构建…"
rm -rf .next && npm run build
echo "[5/7] 复制静态资源…"
cp -r .next/static .next/standalone/.next/static && cp -r public .next/standalone/public
echo "[6/7] 重启 pm2（delete+start 更新版本）…"
pm2 delete aimarketing || true
DOTENV_CONFIG_PATH=/root/AiMarketing/.env.local pm2 start .next/standalone/server.js --name aimarketing --node-args="-r dotenv/config"
pm2 save && pm2 flush aimarketing
echo "[7/7] 验证…"
sleep 3
curl -s -o /dev/null -w "login: %{http_code}\n" http://127.0.0.1:3000/login
curl -s http://127.0.0.1:3000/api/client-info | head -c 120
echo ""
echo "✅ 部署完成（pm2 版本列已更新）"
