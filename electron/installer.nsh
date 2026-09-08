; 安装前强制关闭正在运行的旧客户端 + 清理旧版本残留
; 2026-09-08：electron-builder 自动更新机制 = 先卸载旧版（RMDir /r 删整个安装目录）再装新版，
;             data（登录态/browser-profile）/python（88MB 环境）/storage（本地仓库）都在安装目录里，
;             不处理的话每次更新全丢 → 这里在卸载旧版前先把持久目录备份到 $TEMP，装完新版后恢复。
!macro customInit
  ; 关闭运行中的旧 AI营销助手.exe 及子进程（/t 杀树——它开的浏览器/子进程也占 data 文件锁）
  nsExec::Exec 'taskkill /im "AI营销助手.exe" /f /t'
  ; 等待文件句柄释放，避免备份时文件被锁
  Sleep 3000
  ; 清理旧安装目录 resources 残留（standalone 等 extraResources 不随自动更新，安装前必须清空）
  RMDir /r "$INSTDIR\resources\standalone"
  RMDir /r "$INSTDIR\resources\ms-playwright"
  RMDir /r "$INSTDIR\resources\scripts"
  ; ===== 备份持久数据（data/python/storage）→ $TEMP\aimarketing-data-backup =====
  ; 仅当 $INSTDIR 已有旧版（AI营销助手.exe 存在）才备份；全新安装无旧数据自动跳过
  ${If} ${FileExists} "$INSTDIR\AI营销助手.exe"
    ; 清上次更新残留的备份（保证从干净备份开始）
    ${If} ${FileExists} "$TEMP\aimarketing-data-backup"
      RMDir /r "$TEMP\aimarketing-data-backup"
    ${EndIf}
    CreateDirectory "$TEMP\aimarketing-data-backup"
    ; data：登录态/token/browser-profile/bu_debug.log（最关键——丢了要重新登录）
    ${If} ${FileExists} "$INSTDIR\data\*.*"
      nsExec::Exec 'robocopy "$INSTDIR\data" "$TEMP\aimarketing-data-backup\data" /e /move /NFL /NDL /NJH /NJS /r:2 /w:1 /R:2 /W:1'
    ${EndIf}
    ; python：python-bu 运行环境（88MB——不备份每次更新重下）
    ${If} ${FileExists} "$INSTDIR\python\*.*"
      nsExec::Exec 'robocopy "$INSTDIR\python" "$TEMP\aimarketing-data-backup\python" /e /move /NFL /NDL /NJH /NJS /r:2 /w:1 /R:2 /W:1'
    ${EndIf}
    ; storage：本地仓库（用户上传/生成的文件）
    ${If} ${FileExists} "$INSTDIR\storage\*.*"
      nsExec::Exec 'robocopy "$INSTDIR\storage" "$TEMP\aimarketing-data-backup\storage" /e /move /NFL /NDL /NJH /NJS /r:2 /w:1 /R:2 /W:1'
    ${EndIf}
  ${EndIf}
!macroend

; 2026-09-08：新版文件安装完成后，把备份的持久数据挪回安装目录
!macro customInstall
  ; ===== 恢复持久数据（$TEMP\aimarketing-data-backup → $INSTDIR）=====
  ${If} ${FileExists} "$TEMP\aimarketing-data-backup\data\*.*"
    CreateDirectory "$INSTDIR\data"
    nsExec::Exec 'robocopy "$TEMP\aimarketing-data-backup\data" "$INSTDIR\data" /e /move /NFL /NDL /NJH /NJS /r:2 /w:1 /R:2 /W:1'
  ${EndIf}
  ${If} ${FileExists} "$TEMP\aimarketing-data-backup\python\*.*"
    CreateDirectory "$INSTDIR\python"
    nsExec::Exec 'robocopy "$TEMP\aimarketing-data-backup\python" "$INSTDIR\python" /e /move /NFL /NDL /NJH /NJS /r:2 /w:1 /R:2 /W:1'
  ${EndIf}
  ${If} ${FileExists} "$TEMP\aimarketing-data-backup\storage\*.*"
    CreateDirectory "$INSTDIR\storage"
    nsExec::Exec 'robocopy "$TEMP\aimarketing-data-backup\storage" "$INSTDIR\storage" /e /move /NFL /NDL /NJH /NJS /r:2 /w:1 /R:2 /W:1'
  ${EndIf}
  ; 清理备份目录
  RMDir /r "$TEMP\aimarketing-data-backup"
  ; 桌面快捷方式（指向安装目录 exe，防止更新后失效）
  CreateShortCut "$DESKTOP\AI营销助手.lnk" "$INSTDIR\AI营销助手.exe" "" "$INSTDIR\AI营销助手.exe" 0
  ; 开始菜单快捷方式
  CreateDirectory "$SMPROGRAMS\AI营销助手"
  CreateShortCut "$SMPROGRAMS\AI营销助手\AI营销助手.lnk" "$INSTDIR\AI营销助手.exe" "" "$INSTDIR\AI营销助手.exe" 0
!macroend
