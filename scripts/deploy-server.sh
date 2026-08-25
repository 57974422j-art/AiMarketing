#!/bin/bash
# 2026-08-24: 服务器一键部署（建议②）——备份db→拉取→build→delete+start→验证
# 用法: 服务器上 bash scripts/deploy-server.sh
set -e
cd /root/AiMarketing
echo "[1/7] 备份数据库…"
mkdir -p /root/db-backup
sqlite3 prisma/dev.db ".backup '/root/db-backup/dev-$(date +%Y%m%d-%H%M).db'" || cp prisma/dev.db /root/db-backup/dev-$(date +%Y%m%d-%H%M).db
echo "[2/7] 拉取代码…"
git fetch origin && git reset --hard origin/master
echo "[3/7] 判断是否需要 npm install…"
if git diff HEAD^ HEAD --stat | grep -qE "package(-lock)?.json"; then npm install; else echo "依赖没变，跳过 install"; fi
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
