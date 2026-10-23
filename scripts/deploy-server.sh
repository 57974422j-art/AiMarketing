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
# ★VF_DBBACKUP_ROTATE_V1（2026-10-21 线上实测「渲染被拦：0.8 GB free at /tmp，磁盘 98%」）：
#   病灶：这里**每次部署都备份一份**（文件名精确到分钟），从不清理 ⇒ 备份越积越多，
#        再加上渲染中间产物（`html-deck/out/film_*` 每次 1~2GB），把 40G 盘吃到只剩 800MB。
#   现口径：**只保留最近 5 个备份**（同一天内多个备份回滚价值低；5 个足够覆盖"今天改坏了"的场景）。
ls -t /root/db-backup/dev-*.db 2>/dev/null | tail -n +6 | xargs -r rm -f
echo "  备份完成（保留最近 5 个）：$(ls /root/db-backup/dev-*.db 2>/dev/null | wc -l) 个 · $(du -sh /root/db-backup 2>/dev/null | cut -f1)"
# ★VF_DBBACKUP_ROTATE_V1：**渲染中间产物也一并清**（每次出片 `out/film_*` 留 1~2GB，片子做完就没用）。
#   部署时不会有渲染在跑（马上要重启），所以直接清是安全的。
BEFORE_KB=$(df -k / | tail -1 | awk '{print $4}')
rm -rf /root/AiMarketing/scripts/video-factory/html-deck/out/film_* 2>/dev/null
rm -rf /tmp/aidchk-* /tmp/shr-in-* /tmp/shr-out-* 2>/dev/null
# 帧确定性自检的产物（每次 10~50MB；新版已默认写到 /tmp，这里清旧版遗留 + 旧临时）
rm -rf /tmp/determinism-* /root/AiMarketing/temp/determinism-* 2>/dev/null
# ★VF_AIDESIGN_THINK_VISIBLE_V1：AI 设计每一步的"思考过程"落盘（每个 10~50KB，很小）
#   保留最近 30 个（够回溯最近几单），更早的删掉 —— 和 db 备份同一个轮转思路。
ls -t /root/AiMarketing/temp/aidesign-think/*.txt 2>/dev/null | tail -n +31 | xargs -r rm -f
AFTER_KB=$(df -k / | tail -1 | awk '{print $4}')
echo "  清理临时产物：释放 $(( (AFTER_KB - BEFORE_KB) / 1024 )) MB · 剩余 $(( AFTER_KB / 1024 / 1024 )) GB"
if [ "$AFTER_KB" -lt 3145728 ]; then echo "  ⚠️ 磁盘剩余不足 3GB —— 出片可能被拦，请检查（du -sh /* | sort -rh | head）"; fi
echo "[2/7] 拉取代码…"
git fetch origin && git reset --hard origin/master
echo "[3/7] 判断是否需要 npm install（lock 变才是依赖真变——版本号改动不触发）…"
if git diff HEAD^ HEAD --name-only | grep -q "package-lock.json"; then npm install; else echo "依赖没变，跳过 install（版本号改动不触发）"; fi
echo "[3b/7] 视频工厂·新引擎（html-deck）依赖…"
# ★VF_ENGINEDEP_V1（2026-10-07 用户实测「PPT+图视 换页 0/7 · note=render-failed」的**根因**）：
#   `scripts/video-factory/html-deck/` 有**自己的 package.json**（依赖 hyperframes + fontkit、
#   自带 node_modules），而本脚本此前**完全没管它** ⇒ 服务器上没装引擎 ⇒ 一走到渲染就失败，
#   用户侧只看到「换页未生效：render-failed」，完全看不出"引擎没装"（P0 从未真正生效过也是这个原因）。
#   这里按"目录缺失 / 引擎 lock 变"判断是否安装，并把引擎口径打出来备查（缺了会明确警告）。
if [ -f scripts/video-factory/html-deck/package.json ]; then
  if [ ! -d scripts/video-factory/html-deck/node_modules ] || git diff HEAD^ HEAD --name-only | grep -q "video-factory/html-deck/package-lock.json"; then
    (cd scripts/video-factory/html-deck && (npm ci --omit=dev || npm install --omit=dev))
  else
    echo "  引擎依赖没变，跳过 install"
  fi
  HF_BIN="${ENGINE_HF_BIN:-scripts/video-factory/html-deck/node_modules/.bin/hyperframes}"
  if [ -x "$HF_BIN" ] || command -v hyperframes >/dev/null 2>&1; then
    echo "  引擎 OK：${HF_BIN}"
  else
    echo "  ⚠️ 找不到 hyperframes —— 新引擎（PPT+图视）渲染会失败！"
    echo "     请手动执行：cd /root/AiMarketing/scripts/video-factory/html-deck && npm ci --omit=dev"
    echo "     若装在别处，请把 ENGINE_HF_BIN=<...>/node_modules/.bin/hyperframes 写进 .env.local"
  fi
  echo "  Chrome：${HYPERFRAMES_CHROME_PATH:-${CHROME_PATH:-（未设置 ⇒ 由渲染器自行解析）}} · Node：$(node -v)"
fi
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
