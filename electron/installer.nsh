; 2026-09-08：根治自动更新丢登录态
; electron-builder 更新 = 调旧卸载器 RMDir /r 删整个安装目录（data/python/storage 在安装目录内会被删）
; customRemoveFiles 是 electron-builder 官方 hook——卸载/更新删文件时替换默认的 RMDir /r $INSTDIR：
;   - 更新（--updated）：只删 app 文件，跳过 data（登录态）/python（88MB 环境）/storage（本地仓库）→ 数据原地保留，不复制不移动
;   - 手动卸载：全删（含 data）——卸载就是不要这个软件了

!macro customRemoveFiles
  ; ★KEEP_USERDATA_V2（2026-09-22 用户定案「以后不动就行了」）：
  ;   铁律：打包 / 更新 / 卸载【一律不得删除用户数据】——
  ;     data/     = 【多账号】登录态（data/browser-profile/{账号Id}/Default/Network/Cookies）
  ;                 + accounts.json（多账号列表）+ bu_login_cache.txt + 指纹 profile（data/browser-profiles/）
  ;     storage/  = 用户本地仓库镜像（按账号分）
  ;     python/   = 内置运行环境
  ;   旧写法两个坑（就是它们把用户数据删了）：
  ;     ① 用 `for /d %i` + `if "%i"=="$INSTDIR\data"` **字符串比较**来"排除"用户目录 ——
  ;        路径展开只要有差异（尾斜杠 / 空格 / 短名），比较就失败 → data / python / storage 被一起 rd /s /q 删掉；
  ;     ② 更新时执行的是【旧版本带过来的卸载器】，从很旧的版本升级上来照样全删。
  ;   现在改成【白名单删除】：只删程序文件，永不遍历 / 比较用户目录 ——
  ;     程序根目录只有文件（exe/dll/pak/…）+ 两个程序子目录（locales、resources），
  ;     而用户数据只可能是目录 → `del /q "$INSTDIR\*.*"` 天然碰不到它们；
  ;     再显式只删 locales / resources，就不需要任何"排除逻辑"，也就**不可能误删**。
  ;   ⚠️ 以后若打包新增了别的【程序子目录】，要手动加到这个白名单里；**绝不要**改回"排除式"写法。
  nsExec::Exec 'cmd /c del /q "$INSTDIR\*.*"'
  RMDir /r "$INSTDIR\locales"
  RMDir /r "$INSTDIR\resources"
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
