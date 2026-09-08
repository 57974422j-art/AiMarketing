; 2026-09-08：根治自动更新丢登录态
; electron-builder 更新 = 调旧卸载器 RMDir /r 删整个安装目录（data/python/storage 在安装目录内会被删）
; customRemoveFiles 是 electron-builder 官方 hook——卸载/更新删文件时替换默认的 RMDir /r $INSTDIR：
;   - 更新（--updated）：只删 app 文件，跳过 data（登录态）/python（88MB 环境）/storage（本地仓库）→ 数据原地保留，不复制不移动
;   - 手动卸载：全删（含 data）——卸载就是不要这个软件了

!macro customRemoveFiles
  ${if} ${isUpdated}
    ; ===== 更新模式：删 app 文件，保留持久数据目录 =====
    ; 删根目录文件（exe/dll/pak/asar 等）
    nsExec::Exec 'cmd /c del /q "$INSTDIR\*.*"'
    ; 删所有子目录，跳过 data/python/storage
    nsExec::Exec 'cmd /c for /d %i in ("$INSTDIR\*") do @if /i not "%i"=="$INSTDIR\data" if /i not "%i"=="$INSTDIR\python" if /i not "%i"=="$INSTDIR\storage" rd /s /q "%i"'
  ${else}
    ; ===== 手动卸载：删整个安装目录（含 data/python/storage）=====
    RMDir /r "$INSTDIR"
  ${endIf}
!macroend

; 安装前强制关闭正在运行的旧客户端 + 清理旧版本 resources 残留
!macro customInit
  ; 关闭运行中的旧 AI营销助手.exe 及子进程（/t 杀树——它开的浏览器/子进程也占文件锁）
  nsExec::Exec 'taskkill /im "AI营销助手.exe" /f /t'
  ; 等待文件句柄释放，避免紧接着的文件替换被锁
  Sleep 3000
  ; 清理旧安装目录 resources 残留（standalone 等 extraResources 不随自动更新，安装前必须清空）
  RMDir /r "$INSTDIR\resources\standalone"
  RMDir /r "$INSTDIR\resources\ms-playwright"
  RMDir /r "$INSTDIR\resources\scripts"
!macroend

; 2026-08-19：安装/更新完成后重建桌面与开始菜单快捷方式（electron-updater 更新后旧快捷方式可能失效）
!macro customInstall
  ; 桌面快捷方式（指向安装目录 exe，防止更新后失效）
  CreateShortCut "$DESKTOP\AI营销助手.lnk" "$INSTDIR\AI营销助手.exe" "" "$INSTDIR\AI营销助手.exe" 0
  ; 开始菜单快捷方式
  CreateDirectory "$SMPROGRAMS\AI营销助手"
  CreateShortCut "$SMPROGRAMS\AI营销助手\AI营销助手.lnk" "$INSTDIR\AI营销助手.exe" "" "$INSTDIR\AI营销助手.exe" 0
!macroend
