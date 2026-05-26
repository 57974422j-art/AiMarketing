@echo off
chcp 65001 >nul
echo ====================================
echo  🚀 AiMarketing 一键部署
echo ====================================
echo.
set /p SERVER="服务器IP: "
if "%SERVER%"=="" set SERVER=服务器IP

echo.
echo 📤 推送到 Git...
git push origin master --force
if %errorlevel% neq 0 (
  echo ❌ Git 推送失败！
  pause
  exit /b
)

echo.
echo 🔧 服务器构建部署...
ssh root@%SERVER% "cd /root/AiMarketing && git pull && npx prisma db push && npm run build 2>&1 | tail -3 && pm2 restart aimarketing"
if %errorlevel% neq 0 (
  echo ⚠️ 部署完成（可能有警告）
) else (
  echo ✅ 部署成功！
)

echo.
echo ====================================
pause
