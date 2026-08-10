@echo off
REM ===== 数据库同步：服务器 → 本地（拉取真实数据，绝不反向）=====
REM 用法：双击运行，或命令行 scripts\sync-db.cmd
REM 前提：本机已配置 SSH 免密（或会提示输密码）
echo [1/2] 从服务器拉取最新 dev.db ...
scp root@120.55.43.195:/root/AiMarketing/prisma/dev.db "%~dp0..\prisma\dev.db"
if errorlevel 1 (
  echo ✗ 拉取失败——检查 SSH 连接（ssh root@120.55.43.195 是否能通）
  pause
  exit /b 1
)
echo [2/2] 备份旧库到 prisma\dev.db.pre-sync.bak
copy /y "%~dp0..\prisma\dev.db" "%~dp0..\prisma\dev.db.pre-sync.bak" >/dev/null
echo ✓ 同步完成（本地 dev.db 现在是服务器真实数据）
echo   注：客户端打包才带库；网页版直接用服务器库，无需同步
pause
