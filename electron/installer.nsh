; 安装前强制关闭正在运行的旧客户端，避免旧进程占用 exe 导致覆盖安装失败。
; 由 package.json 的 build.nsis.include 引用，在 NSIS .onInit 阶段（复制文件前）执行。
!macro customInit
  ; 关闭运行中的旧 AI营销助手.exe（结束不了也没关系，仅作兜底）
  nsExec::Exec 'taskkill /im "AI营销助手.exe" /f'
  ; 等待文件句柄释放，避免紧接着的文件替换被锁
  Sleep 1500
!macroend
