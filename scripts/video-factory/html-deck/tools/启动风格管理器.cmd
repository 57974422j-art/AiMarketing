@echo off
chcp 65001 >nul
title 风格包管理器（这个窗口不要关）
cd /d "%~dp0.."
echo ============================================
echo   风格包管理器 · 正在启动…
echo   （会自己打开浏览器；这个黑窗口不要关）
echo ============================================
echo.
node "tools\studio-server.mjs"
echo.
echo 服务已退出。按任意键关闭窗口。
pause >nul
