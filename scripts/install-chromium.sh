#!/usr/bin/env bash
# ★2026-11-03：lab2 自审要截图，服务器缺 chromium 二进制
#   报错：browserType.launch: Executable doesn't exist at
#         /root/.cache/ms-playwright/chromium_headless_shell-1223/...
#
# 用法（服务器上跑一次）：
#   cd /root/AiMarketing && bash scripts/install-chromium.sh
#
# 装完之后 lab2 的「自审」就能截图了（不用重启 pm2，代码会自己找到）

set -e

echo "═══ 1. 检查系统是否已有 chromium ═══"
for p in /usr/bin/chromium /usr/bin/chromium-browser /usr/bin/google-chrome /snap/bin/chromium; do
  if [ -x "$p" ]; then
    echo "  ✅ 已存在：$p"
    echo "  ⇒ 不需要装，lab2 会自动用它"
    echo "     如果想强制指定：在 ecosystem.config.js 里加 CHROMIUM_PATH=$p"
    exit 0
  fi
done
echo "  （系统没有，继续装 playwright 自带的）"

echo ""
echo "═══ 2. 安装 playwright chromium ═══"
cd "$(dirname "$0")/.."

# 只用无头壳（体积小一半，够截图用）
npx playwright install chromium --with-deps 2>&1 | tail -20

echo ""
echo "═══ 3. 验证 ═══"
node -e "
const fs=require('fs');
const dirs=fs.existsSync(process.env.HOME+'/.cache/ms-playwright')
  ? fs.readdirSync(process.env.HOME+'/.cache/ms-playwright') : [];
const hit=dirs.filter(function(d){ return /chromium/.test(d) });
if(hit.length){ console.log('  ✅ 已安装：'+hit.join(', ')) }
else { console.log('  ❌ 还是没找到，请检查网络/权限') }
"

echo ""
echo "═══ 完成 ═══"
echo "回到 /lab2 重新生成一单，页面应该显示「自审 ✓（改了 N 轮）」"
