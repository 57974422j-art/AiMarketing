@echo off
chcp 65001 >/dev/null
title AI营销助手 - 残留清理工具
echo ============================================
echo   AI营销助手 残留清理工具（一键完成）
echo   将删除：程序残留 / 缓存 / 快捷方式 / 注册表项
echo   注意：指纹浏览器登录态也会被删除
echo ============================================
echo.
net session >/dev/null 2>&1
if %errorlevel% neq 0 (
    echo [提示] 请右键本脚本 - 以管理员身份运行
    pause
    exit /b
)
echo [1/6] 停止正在运行的 AI营销助手 进程...
taskkill /f /im "AI营销助手.exe" >/dev/null 2>&1
taskkill /f /im "ai-marketing.exe" >/dev/null 2>&1
taskkill /f /im "electron.exe" >/dev/null 2>&1
echo     完成。
echo [2/6] 删除程序目录残留...
if exist "%LOCALAPPDATA%\Programs\AI营销助手" rd /s /q "%LOCALAPPDATA%\Programs\AI营销助手"
if exist "%LOCALAPPDATA%\Programs\ai-marketing" rd /s /q "%LOCALAPPDATA%\Programs\ai-marketing"
if exist "%LOCALAPPDATA%\ai-marketing" rd /s /q "%LOCALAPPDATA%\ai-marketing"
echo     完成。
echo [3/6] 删除用户数据（缓存/配置/指纹浏览器登录态）...
if exist "%APPDATA%\ai-marketing" rd /s /q "%APPDATA%\ai-marketing"
if exist "%APPDATA%\AI营销助手" rd /s /q "%APPDATA%\AI营销助手"
if exist "%APPDATA%\ai-marketing-updater" rd /s /q "%APPDATA%\ai-marketing-updater"
if exist "%LOCALAPPDATA%\ai-marketing-updater" rd /s /q "%LOCALAPPDATA%\ai-marketing-updater"
if exist "%TEMP%\aimarketing-videos" rd /s /q "%TEMP%\aimarketing-videos"
echo     完成。
echo [4/6] 删除快捷方式...
if exist "%USERPROFILE%\Desktop\AI营销助手.lnk" del /f /q "%USERPROFILE%\Desktop\AI营销助手.lnk"
if exist "%PUBLIC%\Desktop\AI营销助手.lnk" del /f /q "%PUBLIC%\Desktop\AI营销助手.lnk"
if exist "%APPDATA%\Microsoft\Windows\Start Menu\Programs\AI营销助手.lnk" del /f /q "%APPDATA%\Microsoft\Windows\Start Menu\Programs\AI营销助手.lnk"
if exist "%APPDATA%\Microsoft\Windows\Start Menu\Programs\AI营销助手" rd /s /q "%APPDATA%\Microsoft\Windows\Start Menu\Programs\AI营销助手"
echo     完成。
echo [5/6] 清理注册表卸载项...
reg delete "HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\ai-marketing" /f >/dev/null 2>&1
reg delete "HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\AI营销助手" /f >/dev/null 2>&1
reg delete "HKLM\Software\Microsoft\Windows\CurrentVersion\Uninstall\ai-marketing" /f >/dev/null 2>&1
reg delete "HKLM\Software\Microsoft\Windows\CurrentVersion\Uninstall\AI营销助手" /f >/dev/null 2>&1
echo     完成。
echo [6/6] 完成收尾...
echo.
echo ============================================
echo   清理完成！残留已全部删除。
echo   现在可以重新安装最新版本。
echo ============================================
pause
