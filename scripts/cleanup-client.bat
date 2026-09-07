@echo off
chcp 65001 >/dev/null
title AI 营销助手 客户端一键清理
echo ============================================================
echo    AI 营销助手 客户端一键清理（旧版 C 盘残留 + 更新失败修复）
echo ============================================================
echo.
echo 本脚本用于清理【旧版客户端】留在 C 盘的所有残留，解决：
echo   1. 自动更新失败 / 卡住（旧安装 + updater 缓存冲突）
echo   2. 旧版安装目录 / 配置 / 登录态 / 浏览器 profile 残留
echo   3. 新版本路径已统一到安装盘（E:\aimarketing-data 等），C 盘旧数据已无用
echo.
echo 将清理以下位置（C 盘）：
echo   [1] AppData\Roaming 旧配置/登录态/浏览器 profile
echo   [2] AppData\Local 旧缓存 + 安装目录 + electron-updater 缓存
echo   [3] 旧版 Playwright 浏览器缓存（打包进去的旧浏览器）
echo   [4] 临时下载的视频/封面残留
echo   [5] 注册表卸载项残留
echo.
echo 注意：清理后旧登录态/浏览器登录态会丢失，重装后需重新登录。
echo     （不影响新版本 E:\aimarketing-data 里的数据——那是安装盘，不碰）
echo.
set /p OK=确认清理？(输入 Y 继续，其它取消)：
if /i not "%OK%"=="Y" (echo 已取消 & pause & exit /b)

set U=%USERPROFILE%\AppData
set PUB=%PUBLIC%

echo.
echo [1/6] 清理 Roaming 旧配置/登录态/浏览器 profile...
rd /s /q "%U%\Roaming\AI-Marketing" 2>/dev/null
rd /s /q "%U%\Roaming\ai-marketing" 2>/dev/null
rd /s /q "%U%\Roaming\AI营销助手" 2>/dev/null

echo [2/6] 清理 Local 旧缓存...
rd /s /q "%U%\Local\AI-Marketing" 2>/dev/null
rd /s /q "%U%\Local\ai-marketing" 2>/dev/null
rd /s /q "%U%\Local\AI营销助手" 2>/dev/null

echo [3/6] 清理旧安装目录（Local\Programs + Program Files）...
rd /s /q "%U%\Local\Programs\AI营销助手" 2>/dev/null
rd /s /q "%U%\Local\Programs\ai-marketing" 2>/dev/null
rd /s /q "%ProgramFiles%\AI营销助手" 2>/dev/null
rd /s /q "%ProgramFiles(x86)%\AI营销助手" 2>/dev/null

echo [4/6] 清理 electron-updater 更新缓存 + 旧 Playwright...
rd /s /q "%U%\Local\ai-marketing-updater" 2>/dev/null
rd /s /q "%U%\Local\AI营销助手-updater" 2>/dev/null
rd /s /q "%U%\Local\ms-playwright" 2>/dev/null

echo [5/6] 清理临时下载的视频/封面...
if exist "%TEMP%\aimarketing-videos" rd /s /q "%TEMP%\aimarketing-videos" 2>/dev/null
if exist "%TEMP%\aimarketing-covers" rd /s /q "%TEMP%\aimarketing-covers" 2>/dev/null
if exist "%PUB%\aimarketing-videos" rd /s /q "%PUB%\aimarketing-videos" 2>/dev/null

echo [6/6] 清理注册表卸载项残留...
reg delete "HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\com.aimarketing.app" /f 2>/dev/null
reg delete "HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\AI营销助手" /f 2>/dev/null
reg delete "HKLM\Software\Microsoft\Windows\CurrentVersion\Uninstall\com.aimarketing.app" /f 2>/dev/null
reg delete "HKLM\Software\Microsoft\Windows\CurrentVersion\Uninstall\AI营销助手" /f 2>/dev/null

echo.
echo ============================================================
echo   已完成清理。
echo   下一步：卸载旧客户端（控制面板）→ 安装最新版安装包。
echo   新版本数据会自动建在安装盘（E:\aimarketing-data），不碰 C 盘。
echo ============================================================
echo.
pause
