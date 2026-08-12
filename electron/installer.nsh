; 安装前强制关闭正在运行的旧客户端 + 清理旧版本残留（standalone/数据）
; 由 package.json 的 build.nsis.include 引用，在 NSIS .onInit 阶段（复制文件前）执行。
!macro customInit
  ; 关闭运行中的旧 AI营销助手.exe（结束不了也没关系，仅作兜底）
  nsExec::Exec 'taskkill /im "AI营销助手.exe" /f'
  ; 等待文件句柄释放，避免紧接着的文件替换被锁
  Sleep 1500
  ; 2026-08-12：清理旧安装目录残留（standalone 等 extraResources 不随自动更新，安装前必须清空重装）
  ; 防止旧版 standalone/文件残留导致代理失效（code 14）或版本错配
  RMDir /r "$INSTDIR\resources\standalone"
  RMDir /r "$INSTDIR\resources\ms-playwright"
  RMDir /r "$INSTDIR\resources\scripts"
!macroend
