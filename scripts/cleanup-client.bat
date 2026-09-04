@echo off
chcp 65001 >/dev/null
echo ============================================
echo   AI 营销助手 客户端一键清理（旧版遗留数据）
echo ============================================
echo.
echo 将清理以下旧数据（C 盘 AppData 的旧版配置/登录态/缓存）：
echo   - Roaming\AI-Marketing （旧大写目录）
echo   - Roaming\ai-marketing （旧小写目录）
echo   - Roaming\AI营销助手  （旧 productName 目录）
echo   - Local 下的同名缓存
echo.
echo 注意：清理后登录态会丢失，重装后需重新登录。
echo.
set /p OK=确认清理？(输入 Y 继续，其它取消)：
if /i not "%OK%"=="Y" (echo 已取消 & pause & exit /b)

set U=%USERPROFILE%\AppData
echo [1/4] 清理 Roaming 旧配置/登录态...
rd /s /q "%U%\Roaming\AI-Marketing" 2>/dev/null
rd /s /q "%U%\Roaming\ai-marketing" 2>/dev/null
rd /s /q "%U%\Roaming\AI营销助手" 2>/dev/null
echo [2/4] 清理 Local 缓存...
rd /s /q "%U%\Local\AI-Marketing" 2>/dev/null
rd /s /q "%U%\Local\ai-marketing" 2>/dev/null
rd /s /q "%U%\Local\AI营销助手" 2>/dev/null
echo [3/4] 清理临时下载（如有）...
if exist "%TEMP%\aimarketing-videos" rd /s /q "%TEMP%\aimarketing-videos" 2>/dev/null
echo [4/4] 完成。
echo.
echo 下一步：卸载旧客户端 → 安装最新版（data/storage 会自动建在安装盘）。
pause
