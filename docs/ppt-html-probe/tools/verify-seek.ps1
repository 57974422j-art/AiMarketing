# Verify a rendered <video>-seek baseline: which SECOND does each frame land in?
# Uses NEAREST-EXPECTED-COLOUR classification (robust to the colour-matrix/range shift
# that HyperFrames output has vs an untagged source -- see expected.txt section 6).
# Samples a 160x160 CORNER patch (text is centred, so the corner is pure segment colour).
# ASCII-only on purpose (PS5.1 + no-BOM UTF-8 .ps1 breaks).
param(
  [Parameter(Mandatory = $true)][string]$Mp4,
  [ValidateSet('3s', '8s')][string]$Kind = '3s',
  [string]$Label = ''
)

if ($Kind -eq '3s') {
  $times = @(0.5, 1.5, 2.5)
} else {
  $times = @(0.5, 1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5)
}
$palette = @(
  @{ name = 'T0 red';     rgb = @(192, 0, 0)     },
  @{ name = 'T1 green';   rgb = @(0, 160, 0)     },
  @{ name = 'T2 blue';    rgb = @(0, 0, 192)     },
  @{ name = 'T3 amber';   rgb = @(224, 160, 0)   },
  @{ name = 'T4 purple';  rgb = @(128, 0, 160)   },
  @{ name = 'T5 teal';    rgb = @(0, 160, 160)   },
  @{ name = 'T6 gray';    rgb = @(96, 96, 96)    },
  @{ name = 'T7 lt-gray'; rgb = @(160, 160, 160) }
)

$tmp = Join-Path $env:TEMP 'vfseek-verify'
New-Item -ItemType Directory -Force -Path $tmp | Out-Null

Write-Output ("FILE: {0}   {1}" -f $Mp4, $Label)
Write-Output ("  {0,-6} {1,-14} {2,-14} {3,-12} {4,-6} {5}" -f 't', 'got RGB', 'nearest', 'dist', 'expected', 'verdict')
$pass = 0; $fail = 0
foreach ($t in $times) {
  $bin = Join-Path $tmp ("a_{0}.bin" -f $t)
  & ffmpeg -v error -y -ss $t -i $Mp4 -frames:v 1 -vf 'crop=160:160:8:8,scale=1:1' -pix_fmt rgb24 -f rawvideo $bin
  $b = [System.IO.File]::ReadAllBytes($bin)
  $got = @([int]$b[0], [int]$b[1], [int]$b[2])

  $best = -1; $bestD = [int]::MaxValue
  for ($k = 0; $k -lt $palette.Count; $k++) {
    $d = 0
    for ($i = 0; $i -lt 3; $i++) { $x = [Math]::Abs($got[$i] - $palette[$k].rgb[$i]); if ($x -gt $d) { $d = $x } }
    if ($d -lt $bestD) { $bestD = $d; $best = $k }
  }
  $expIdx = [int][Math]::Floor($t - 0.0001)
  $verdict = 'FAIL'
  if ($best -eq $expIdx) { $verdict = 'PASS'; $pass++ } else { $fail++ }

  $verdict2 = $verdict
  if ($got[0] -gt 240 -and $got[1] -lt 20 -and $got[2] -gt 240) { $verdict2 = 'MAGENTA(video never loaded)' }
  if ($got[0] -lt 12 -and $got[1] -lt 12 -and $got[2] -lt 12) { $verdict2 = 'BLACK(no frame decoded)' }

  Write-Output ("  {0,-6} {1,-14} {2,-14} {3,-12} {4,-6} {5}" -f `
      $t, (('{0},{1},{2}' -f $got[0], $got[1], $got[2])), $palette[$best].name, $bestD, $palette[$expIdx].name, $verdict2)
}
Write-Output ("  => PASS={0} FAIL={1}" -f $pass, $fail)
