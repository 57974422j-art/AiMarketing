param(
  [Parameter(Mandatory=$true)][string]$Comp,
  [Parameter(Mandatory=$true)][string]$Out,
  [int]$Fps = 25,
  [string]$Label = 'r',
  [string]$Quality = 'looks',
  [int]$SampleMs = 400
)
$root = 'G:\AiMarketing\dist-rel\probe-hf'
$proj = Join-Path $root 'hfprobe'
$bin  = Join-Path $root 'node_modules\.bin\hyperframes.cmd'
$log  = Join-Path $root ("log-$Label.txt")
$err  = Join-Path $root ("log-$Label.err.txt")
if (Test-Path $log) { Remove-Item $log -Force }
if (Test-Path $err) { Remove-Item $err -Force }
$sw = [Diagnostics.Stopwatch]::StartNew()
$p = Start-Process -FilePath $bin -ArgumentList @('render','.', '-c',$Comp,'-o',$Out,'--fps',"$Fps",'--quality',$Quality) `
     -WorkingDirectory $proj -RedirectStandardOutput $log -RedirectStandardError $err -PassThru -NoNewWindow
$peakCpu = 0.0; $peakWs = 0.0; $samples = 0
while (-not $p.HasExited) {
  $procs = Get-CimInstance Win32_PerfFormattedData_PerfProc_Process -ErrorAction SilentlyContinue |
           Where-Object { $_.Name -match '^(node|chrome|ffmpeg)' }
  if ($procs) {
    $samples++
    $c = ($procs | Measure-Object -Property PercentProcessorTime -Sum).Sum
    $w = ($procs | Measure-Object -Property WorkingSetPrivate -Sum).Sum
    if ($c -gt $peakCpu) { $peakCpu = $c }
    if ($w -gt $peakWs) { $peakWs = $w }
  }
  Start-Sleep -Milliseconds $SampleMs
}
$p.WaitForExit()
$sw.Stop()
$res = [pscustomobject]@{
  label = $Label; comp = $Comp; out = $Out; fps = $Fps; quality = $Quality
  elapsedSec = [math]::Round($sw.Elapsed.TotalSeconds, 2)
  exitCode = $p.ExitCode
  peakCpuPercent = [math]::Round($peakCpu, 0)
  peakCpuCores = [math]::Round($peakCpu / 100, 2)
  peakWorkingSetMB = [math]::Round($peakWs / 1MB, 0)
  samples = $samples
}
$res | ConvertTo-Json | Tee-Object -FilePath (Join-Path $root "measure-$Label.json")
