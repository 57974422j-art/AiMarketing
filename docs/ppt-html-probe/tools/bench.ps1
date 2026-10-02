param(
  [Parameter(Mandatory=$true)][string]$Comp,
  [Parameter(Mandatory=$true)][string]$Out,
  [int]$Fps = 25,
  [string]$Label = 'r',
  [string]$Quality = 'looks'
)
$root = 'G:\AiMarketing\dist-rel\probe-hf'
$proj = Join-Path $root 'hfprobe'
$bin  = Join-Path $root 'node_modules\.bin\hyperframes.cmd'
$logAll  = Join-Path $root "log-$Label.all.txt"
$samples = Join-Path $root "samples-$Label.txt"
$stop    = Join-Path $root "stop-$Label.flag"
Remove-Item $logAll, $samples, $stop -ErrorAction SilentlyContinue

$procNames = @('node', 'chrome', 'headless_shell', 'ffmpeg')

function Snap {
  $p = Get-Process -Name $procNames -ErrorAction SilentlyContinue
  if (-not $p) { return @{ cpu = 0.0; ws = 0.0 } }
  $c = ($p | Measure-Object -Property CPU -Sum).Sum; if (-not $c) { $c = 0 }
  $w = ($p | Measure-Object -Property WorkingSet64 -Sum).Sum; if (-not $w) { $w = 0 }
  return @{ cpu = [double]$c; ws = [double]$w }
}

$base = Snap

$job = Start-Job -ScriptBlock {
  param($samples, $stop, $names)
  while (-not (Test-Path $stop)) {
    $p = Get-Process -Name $names -ErrorAction SilentlyContinue
    if ($p) {
      $c = ($p | Measure-Object -Property CPU -Sum).Sum; if (-not $c) { $c = 0 }
      $w = ($p | Measure-Object -Property WorkingSet64 -Sum).Sum; if (-not $w) { $w = 0 }
    } else { $c = 0; $w = 0 }
    Add-Content -LiteralPath $samples -Value ("{0}|{1}|{2}" -f ([DateTime]::UtcNow.Ticks), $c, $w)
    Start-Sleep -Milliseconds 500
  }
} -ArgumentList $samples, $stop, $procNames
Start-Sleep -Milliseconds 1500

Push-Location $proj
$sw = [Diagnostics.Stopwatch]::StartNew()
& $bin render '.' '-c' $Comp '-o' $Out '--fps' $Fps '--quality' $Quality *> $logAll
$code = $LASTEXITCODE
$sw.Stop()
Pop-Location

New-Item -ItemType File -Force -Path $stop | Out-Null
Start-Sleep -Milliseconds 1500
$job | Stop-Job; $job | Remove-Job -Force

$rows = @()
foreach ($ln in (Get-Content -LiteralPath $samples -ErrorAction SilentlyContinue)) {
  $f = $ln.Split('|')
  if ($f.Count -ge 3) { $rows += [pscustomobject]@{ t = [long]$f[0]; cpu = [double]$f[1]; ws = [double]$f[2] } }
}
$peakCores = 0.0; $peakAddMB = 0.0; $peakTotalMB = 0.0
for ($i = 1; $i -lt $rows.Count; $i++) {
  $dt = ($rows[$i].t - $rows[$i - 1].t) / 1e7
  if ($dt -le 0) { continue }
  $dcpu = $rows[$i].cpu - $rows[$i - 1].cpu
  if ($dcpu -lt 0) { $dcpu = 0 }
  $cores = $dcpu / $dt
  if ($cores -gt $peakCores) { $peakCores = $cores }
  $tot = $rows[$i].ws / 1MB
  if ($tot -gt $peakTotalMB) { $peakTotalMB = $tot }
  $add = ($rows[$i].ws - $base.ws) / 1MB
  if ($add -gt $peakAddMB) { $peakAddMB = $add }
}
$hfLine = (Select-String -LiteralPath $logAll -Pattern 'rendered in .*' -ErrorAction SilentlyContinue | Select-Object -Last 1).Line
if ($hfLine) { $hfLine = ($hfLine -replace '[^\x20-\x7E]', '').Trim() }

$res = [pscustomobject]@{
  label                = $Label
  comp                 = $Comp
  out                  = $Out
  fps                  = $Fps
  quality              = $Quality
  exitCode             = $code
  wallSec              = [math]::Round($sw.Elapsed.TotalSeconds, 2)
  hfSelfReported       = $hfLine
  peakCoresUsed        = [math]::Round($peakCores, 2)
  peakAddedMemMB       = [math]::Round($peakAddMB, 0)
  peakTotalMemMB       = [math]::Round($peakTotalMB, 0)
  baselineMemMB        = [math]::Round($base.ws / 1MB, 0)
  sampleCount          = $rows.Count
}
$res | ConvertTo-Json | Tee-Object -FilePath (Join-Path $root "bench-$Label.json")
