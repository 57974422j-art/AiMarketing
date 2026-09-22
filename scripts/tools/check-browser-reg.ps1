# ============================================================================
#  AI营销助手 —— 「点浏览器登记没反应」一键诊断（**只读**：不改任何设置、不删任何文件）
#
#  用法（在那台有问题的机器上）：
#    1) 把本文件另存为  check-browser-reg.ps1  （放桌面就行）
#    2) 右键该文件 → 「使用 PowerShell 运行」
#       如果提示脚本被禁用，改用：
#       powershell -NoProfile -ExecutionPolicy Bypass -File "$env:USERPROFILE\Desktop\check-browser-reg.ps1"
#    3) 跑完会在桌面生成报告：check-browser-reg-日期-时间.txt  → 把这个文件发给开发
#
#  可选参数：
#    -ClientDir "D:\AI营销助手"   手动指定客户端安装目录（脚本也会自动找）
#    -TryLaunch                   最后做一次「和客户端一模一样参数」的启动测试
#                                 （会真的开一个浏览器窗口，用来区分"逻辑问题"还是"这台机器开不了")
#
#  本脚本只做四类事：查文件在不在、查进程/端口、读日志、打印结论。不会修改任何东西。
# ============================================================================
param(
  [string]$ClientDir = '',
  [switch]$TryLaunch
)

$ErrorActionPreference = 'SilentlyContinue'
$report = New-Object System.Collections.Generic.List[string]
function W($s) { $report.Add([string]$s); Write-Host $s }
function H($s) { W ''; W ('=' * 72); W $s; W ('=' * 72) }
function Mark($p) { if (Test-Path -LiteralPath $p) { '存在' } else { '不存在' } }

H '0. 基本信息'
W ("时间        : " + (Get-Date).ToString('yyyy-MM-dd HH:mm:ss'))
W ("机器名/用户 : " + $env:COMPUTERNAME + " / " + $env:USERNAME)
W ("系统        : " + (Get-CimInstance Win32_OperatingSystem).Caption + "  build " + [System.Environment]::OSVersion.Version)
W ("PowerShell  : " + $PSVersionTable.PSVersion)
W ("LOCALAPPDATA: " + $env:LOCALAPPDATA)

# ---------------------------------------------------------------- 1. 找客户端目录
H '1. 客户端安装目录 / 数据目录（客户端把浏览器资料放在 <安装目录>\data 下）'
$cands = New-Object System.Collections.Generic.List[string]
if ($ClientDir) { $cands.Add($ClientDir) }
# ★最可靠：直接从"正在运行的客户端进程"反推安装目录（客户端开着就能拿到）
Get-CimInstance Win32_Process -Filter "Name LIKE '%AI%'" |
  Where-Object { $_.Name -match 'AI营销助手|ai-marketing|AI-Marketing' -or $_.ExecutablePath -match 'ai-marketing' } |
  ForEach-Object { if ($_.ExecutablePath) { $cands.Add((Split-Path $_.ExecutablePath -Parent)) } }
$cands.Add("$env:LOCALAPPDATA\Programs\AI营销助手")
$cands.Add("$env:ProgramFiles\AI营销助手")
$cands.Add("${env:ProgramFiles(x86)}\AI营销助手")
$cands.Add("$env:LOCALAPPDATA\AI营销助手")
# 自动搜：LocalAppData\Programs 与 Program Files 下**精确**匹配产品名的目录
#（原来用 'AI' 做模糊匹配 → 会误命中 Windows Mail / Container 等）
foreach ($root in @("$env:LOCALAPPDATA\Programs", $env:ProgramFiles, "${env:ProgramFiles(x86)}")) {
  if (-not (Test-Path $root)) { continue }
  Get-ChildItem -LiteralPath $root -Directory -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -match 'AI\s*营销助手|ai-marketing|niuma|白龙马' } | ForEach-Object { $cands.Add($_.FullName) }
}
# 脚本所在目录 / 其上级（很多人会把脚本直接丢进客户端目录）
if ($PSScriptRoot) {
  $cands.Add($PSScriptRoot)
  $cands.Add((Split-Path $PSScriptRoot -Parent))
}
# 各盘符根下的常见目录名（客户端可能装在 D:/E: 盘）
foreach ($d in (Get-PSDrive -PSProvider FileSystem | Where-Object { $_.Free -ne $null })) {
  foreach ($n in @('ai-marketing', 'AI营销助手')) { $cands.Add((Join-Path ($d.Root) $n)) }
}

$found = @()
foreach ($c in ($cands | Select-Object -Unique)) {
  if (-not (Test-Path -LiteralPath $c)) { continue }
  $exe = Get-ChildItem -LiteralPath $c -Filter *.exe -ErrorAction SilentlyContinue |
         Where-Object { $_.Name -notmatch '^(unins|elevate|vc_redist)' } | Select-Object -First 1
  $hasData = Test-Path (Join-Path $c 'data')
  W ("  [$([bool]$exe)] $c    exe=" + ($(if ($exe) { $exe.Name } else { '(无)' })) + "   data目录=" + (Mark (Join-Path $c 'data')))
  if ($exe -or $hasData) { $found += $c }
}
if (-not $found.Count) { W '  ⚠️ 没找到客户端目录 —— 请用 -ClientDir 参数手动指定（例如 -ClientDir "D:\AI营销助手"）' }
$RealDir = if ($found.Count) { $found[0] } else { '' }
W ("  → 本次按这个目录继续: " + ($(if ($RealDir) { $RealDir } else { '(未知)' })))
$DataDir = if ($RealDir) { Join-Path $RealDir 'data' } else { '' }
if ($RealDir) {
  foreach ($vp in @((Join-Path $RealDir 'resources\app\electron\version.json'), (Join-Path $RealDir 'electron\version.json'), (Join-Path $RealDir 'resources\app\package.json'))) {
    if (Test-Path -LiteralPath $vp) {
      $vv = (& { try { (Get-Content -LiteralPath $vp -Raw | ConvertFrom-Json).version } catch { '' } })
      W ('  客户端版本(读自 ' + $vp + '): ' + $(if ($vv) { $vv } else { '?' }))
      break
    }
  }
}

# ---------------------------------------------------------------- 2. 浏览器路径
H '2. 浏览器是否存在（★这是"部分机器打不开"最常见的原因）'
$c1 = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
$c2 = 'C:\Program Files (x86)\Google\Chrome\Application\chrome.exe'
$c3 = "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
W '  --- 系统 Chrome ---'
W ("  [1] $c1  " + (Mark $c1) + "   ← 客户端启动登记浏览器时只认 [1][2]")
W ("  [2] $c2  " + (Mark $c2) + "   ← 客户端启动登记浏览器时只认 [1][2]")
W ("  [3] $c3  " + (Mark $c3) + "   ← 只有「点击卡片」那一步认它；「真正启动」那一步【不认】")
$chromeOnlyUserLevel = ((Test-Path $c1) -eq $false -and (Test-Path $c2) -eq $false -and (Test-Path $c3))
W '  --- 系统 Edge（客户端另一条兜底链会用它）---'
$e1 = "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe"
$e2 = "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe"
W ("  $e1  " + (Mark $e1))
W ("  $e2  " + (Mark $e2))
W '  --- 注册表 App Paths（客户端第三层兜底）---'
foreach ($k in @('HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe',
                 'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe',
                 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\msedge.exe')) {
  $v = (& { try { (Get-ItemProperty -Path $k -Name '(default)' -ErrorAction Stop).'(default)' } catch { '' } })
  W ("  $k  →  " + ($(if ($v) { $v + '  ' + (Mark $v) } else { '(没有)' })))
}
W '  --- 客户端自带的 Playwright Chromium 兜底（%LOCALAPPDATA%\ms-playwright）---'
$pw = Get-ChildItem -Path "$env:LOCALAPPDATA\ms-playwright" -Recurse -Filter chrome.exe -ErrorAction SilentlyContinue | Select-Object -First 3
if ($pw) { $pw | ForEach-Object { W ("  " + $_.FullName) } } else { W '  没找到（打包版一般会自带；没有就去问开发）' }

# ---------------------------------------------------------------- 3. 端口 / 进程
H '3. 调试端口 9222（客户端用"9222 通不通"来判断"浏览器已经开了"）'
$p9222 = $null
try { $p9222 = Invoke-WebRequest -UseBasicParsing -TimeoutSec 3 'http://127.0.0.1:9222/json/version' } catch { $p9222 = $null }
if ($p9222) {
  W '  9222 = 通 ⚠️（**这一条很关键**：客户端会认为"浏览器已开"，于是【不再启动新窗口】）'
  W ('  返回内容: ' + ($p9222.Content -replace '\s+', ' ').Substring(0, [Math]::Min(220, $p9222.Content.Length)))
} else {
  W '  9222 = 不通（客户端会去启动浏览器）'
}
W '  谁在占用 9222：'
$ns = (netstat -ano | Select-String ':9222')
if ($ns) {
  $ns | ForEach-Object { W ('    ' + $_.ToString().Trim()) }
  $pids = $ns | ForEach-Object { ($_.ToString().Trim() -split '\s+')[-1] } | Select-Object -Unique
  foreach ($procId in $pids) {
    $pr = Get-CimInstance Win32_Process -Filter "ProcessId=$procId"
    if ($pr) { W ('    PID ' + $procId + ' = ' + $pr.Name + '  ->  ' + $pr.ExecutablePath) }
  }
} else { W '    （没有进程监听 9222）' }

W '  当前所有 chrome 进程（含命令行，能看出是不是"登记用的那个"）：'
$chps = Get-CimInstance Win32_Process -Filter "Name='chrome.exe'"
if ($chps) {
  foreach ($p in $chps) {
    $cl = [string]$p.CommandLine
    $flag = if ($cl -match '--remote-debugging-port=9222') { '★带 9222' } else { '' }
    W ('    PID ' + $p.ProcessId + ' ' + $flag)
    if ($cl) { W ('      ' + ($cl.Substring(0, [Math]::Min(300, $cl.Length)))) }
  }
} else { W '    （没有 chrome 进程在跑）' }

W '  客户端进程：'
# ★只认产品名（原来用 AI 模糊匹配 → 会误命中 NVDisplay.Container 之类）
$app = Get-CimInstance Win32_Process | Where-Object {
  $_.Name -match 'AI营销助手|ai-marketing|AI-Marketing' -or [string]$_.ExecutablePath -match 'ai-marketing'
}
if ($app) { $app | ForEach-Object { W ('    PID ' + $_.ProcessId + '  ' + $_.ExecutablePath) } } else { W '    （没找到客户端进程 —— 请确认客户端是打开着的）' }

# ---------------------------------------------------------------- 4. 浏览器资料目录
H '4. 浏览器资料目录（登录态就存在这里；被锁/不可写也会导致打不开）'
if ($DataDir -and (Test-Path $DataDir)) {
  $bp = Join-Path $DataDir 'browser-profile'
  W ('  ' + $bp + '  ' + (Mark $bp))
  if (Test-Path $bp) {
    Get-ChildItem -LiteralPath $bp -Directory | ForEach-Object {
      $lock = (Test-Path (Join-Path $_.FullName 'lockfile')) -or (Test-Path (Join-Path $_.FullName 'SingletonLock'))
      $ck = Test-Path (Join-Path $_.FullName 'Default\Cookies')
      W ('    - ' + $_.Name + '   锁文件=' + $lock + '  Cookies=' + $ck)
    }
    # 写权限测试（只写一个临时文件，马上去掉）
    $tf = Join-Path $bp ('.wtest-' + (Get-Random))
    try { Set-Content -LiteralPath $tf -Value 'x' -ErrorAction Stop; W '  写权限: ✅ 可写'; Remove-Item -LiteralPath $tf -Force }
    catch { W '  写权限: ❌ 不可写（可能是杀软/权限 —— 浏览器资料写不进去，窗口起不来）' }
  }
} else { W '  （没拿到数据目录，跳过）' }

# ---------------------------------------------------------------- 5. 客户端日志
H '5. 客户端日志（最重要：这里通常直接写着原因）'
$log = if ($DataDir) { Join-Path $DataDir 'bu_debug.log' } else { '' }
if ($log -and (Test-Path $log)) {
  W ('  日志文件: ' + $log + '   大小 ' + (Get-Item $log).Length + ' 字节')
  W '  --- 与浏览器启动相关的行（最后 30 条）---'
  $hits = Get-Content -LiteralPath $log -Tail 800 | Where-Object { $_ -match '\[chrome\]|\[cdp\]|\[FP\]|\[browser' }
  if ($hits) { $hits | Select-Object -Last 30 | ForEach-Object { W ('    ' + $_) } } else { W '    （日志里没有 [chrome]/[cdp] 记录 → 说明"启动浏览器"这段可能根本没被调用/或从没写进日志）' }
  W '  --- 日志最后 10 行（看时间戳，判断你点卡片那一刻有没有记录）---'
  Get-Content -LiteralPath $log -Tail 10 | ForEach-Object { W ('    ' + $_) }
} else { W ('  没找到 bu_debug.log（' + $log + '）—— 也可能客户端从未成功启动过浏览器') }

# ---------------------------------------------------------------- 6. 窗口位置
H '6. 浏览器窗口是否被"开到了屏幕外/最小化"（看起来就像没反应）'
try {
  Add-Type -AssemblyName System.Windows.Forms
  $screens = [System.Windows.Forms.Screen]::AllScreens | ForEach-Object { $_.Bounds }
  W ('  屏幕: ' + (($screens | ForEach-Object { '(' + $_.X + ',' + $_.Y + ' ' + $_.Width + 'x' + $_.Height + ')' }) -join ' '))
} catch { W '  （无法枚举屏幕）' }
Add-Type @'
using System;
using System.Runtime.InteropServices;
public class W32 {
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  public struct RECT { public int Left, Top, Right, Bottom; }
}
'@ -ErrorAction SilentlyContinue
$anyWin = $false
Get-Process chrome -ErrorAction SilentlyContinue | ForEach-Object {
  if ($_.MainWindowHandle -ne 0) {
    $anyWin = $true
    $r = New-Object W32+RECT
    [void][W32]::GetWindowRect($_.MainWindowHandle, [ref]$r)
    W ('  PID ' + $_.Id + ' 窗口=(' + $r.Left + ',' + $r.Top + ')→(' + $r.Right + ',' + $r.Bottom + ')  最小化=' + [W32]::IsIconic($_.MainWindowHandle) + '  标题=' + $_.MainWindowTitle)
  }
}
if (-not $anyWin) { W '  （没有可见的 chrome 窗口 —— 也就是"确实没开出来"，不是被挡在后面）' }

# ---------------------------------------------------------------- 7. 手动启动测试
if ($TryLaunch) {
  H '7. 手动启动测试（用与客户端完全相同的参数启动一次）'
  $exe = @($c1, $c2, $c3) | Where-Object { Test-Path $_ } | Select-Object -First 1
  if (-not $exe) { W '  ❌ 三个 Chrome 路径都没有 → 这台机器没有 Chrome，客户端自然开不出来（这就是原因）' }
  else {
    $prof = if ($DataDir) { Join-Path $DataDir 'browser-profile\default' } else { Join-Path $env:TEMP 'ctest-profile' }
    $args = @('--user-data-dir=' + $prof, '--remote-debugging-port=9222', '--remote-allow-origins=*', '--no-first-run', 'https://www.douyin.com/')
    W ('  执行: "' + $exe + '" ' + ($args -join ' '))
    Start-Process -FilePath $exe -ArgumentList $args
    Start-Sleep -Seconds 5
    $ok = $null; try { $ok = Invoke-WebRequest -UseBasicParsing -TimeoutSec 3 'http://127.0.0.1:9222/json/version' } catch {}
    W ('  5 秒后 9222 = ' + ($(if ($ok) { '通 ✅（说明这台机器"其实能开"，问题在客户端那条判断/分支上）' } else { '不通 ❌（这台机器起不来浏览器：看杀软/组策略/profile 权限）' })))
    W '  请肉眼确认：屏幕上有没有出现 Chrome 窗口？'
  }
}

# ---------------------------------------------------------------- 8. 结论
H '8. 自动结论（按命中顺序）'
$concl = @()
if ((-not (Test-Path $c1)) -and (-not (Test-Path $c2)) -and (Test-Path $c3)) {
  $concl += '★A: Chrome 是"仅为我安装"（只存在于 %LOCALAPPDATA%）。点卡片那一步能找到它，但客户端【真正启动浏览器】那一步只查 Program Files 两个路径 → 找不到 → 直接返回失败，窗口不会开。→ 这就是"只有这一台机器"的原因（改法：启动那一步也用同一个查找函数）'
}
if ((-not (Test-Path $c1)) -and (-not (Test-Path $c2)) -and (-not (Test-Path $c3))) {
  $concl += '★B: 这台机器没有任何 Chrome。客户端启动登记浏览器只认 Chrome → 必然打不开（有 Edge 也没用，那条兜底链没被用上）'
}
if ($p9222) {
  $concl += '★C: 9222 端口已经通了 → 客户端判定"浏览器已开"就【不再开新窗口】。如果那其实是别的程序/别的 Chrome 实例占用的，或窗口被最小化/在副屏 → 表面就是"点了没反应"'
}
if ($hits -and ($hits | Where-Object { $_ -match '未找到 chrome' })) {
  $concl += '★D: 客户端日志里明确写着【未找到 chrome.exe】→ 与 A/B 一致（日志是铁证）'
}
if (-not $hits) {
  $concl += '★E: 日志里完全没有 [chrome]/[cdp] 记录 → 说明"启动浏览器"这段逻辑可能压根没执行（或异常被吞了）→ 需要开发端补日志/修那个 ch 未定义的 bug'
}
if (-not $concl.Count) { $concl += '未命中已知的几条；请把本报告发给开发（里面有完整现场）' }
$concl | ForEach-Object { W ('  - ' + $_) }

# ---------------------------------------------------------------- 保存
$desktop = [Environment]::GetFolderPath('Desktop')
$file = Join-Path $desktop ('check-browser-reg-' + (Get-Date).ToString('MMdd-HHmm') + '.txt')
try { $report | Out-File -FilePath $file -Encoding UTF8; Write-Host ''; Write-Host ('✅ 报告已保存：' + $file) } catch { Write-Host '⚠️ 报告保存失败（请手动复制上面的输出）' }
Write-Host '（本脚本只读，没有修改任何东西）'
