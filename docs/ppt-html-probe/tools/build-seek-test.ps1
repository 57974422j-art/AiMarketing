# Build <video> seek-test assets (Windows side). Linux mirror: build-seek-test.sh
# NOTE 1: ASCII-ONLY on purpose -- Windows PowerShell 5.1 parses a UTF-8 .ps1 WITHOUT BOM
#         as ANSI/GBK, so non-ASCII comments/strings break the parser.
# NOTE 2: BUGFIX -- never write "text=T$i:fontsize=..." in a double-quoted PS string:
#         PowerShell parses "$i:fontsize" as variable 'fontsize' in scope 'i' -> the
#         index is EATEN and '=220' lands inside the text (rendered "T=220", tiny font).
#         Always brace it: "text=T${i}" .
# Output: probe-seek.mp4(3s) probe-seek.webm(3s VP9) probe-seek-8s.mp4(8s) probe-seek-8s.webm(8s VP9)
# Spec: H.264 yuv420p 25fps. Per second: one solid colour (identifies the SECOND)
#       + big per-frame counter (identifies the FRAME inside that second -> frame-accurate check).
#       moov up front (+faststart), no audio track, no loop.
$ErrorActionPreference = 'Stop'
$root = 'G:\AiMarketing\dist-rel\probe-hf\seek-test'
New-Item -ItemType Directory -Force -Path $root | Out-Null
Push-Location $root

# --- 1. pick a font that exists locally (relative path avoids ':' inside the filter) ---
$cands = @('C:\Windows\Fonts\arialbd.ttf', 'C:\Windows\Fonts\arial.ttf',
           'C:\Windows\Fonts\segoeuib.ttf', 'C:\Windows\Fonts\msyhbd.ttc', 'C:\Windows\Fonts\msyh.ttc')
$font = $null
foreach ($c in $cands) { if (Test-Path $c) { $font = $c; break } }
if (-not $font) { throw 'no usable font file found' }
if (Test-Path 'font.ttf') { Remove-Item 'font.ttf' -Force }
Copy-Item $font 'font.ttf' -Force
Write-Output ("font: {0} -> font.ttf" -f $font)

# --- 2. eight distinguishable solid colours (T0..T7) ---
$cols = @('0xC00000', '0x00A000', '0x0000C0', '0xE0A000', '0x8000A0', '0x00A0A0', '0x606060', '0xA0A0A0')

# --- 3. one 1-second segment per colour ---
#   two drawtext layers: small "T<i>" at top (which SECOND) + big %{n} in centre (which FRAME).
#   %{n} = frame index of this segment, so it reads 0..24 in every second -> frame-level check.
for ($i = 0; $i -lt 8; $i++) {
  $seg = "seg$i.mp4"
  if (Test-Path $seg) { Remove-Item $seg -Force }
  $lbl = "drawtext=fontfile=font.ttf:text=T${i}:fontsize=72:fontcolor=white:x=(w-tw)/2:y=70:box=1:boxcolor=black@0.5:boxborderw=14"
  $num = "drawtext=fontfile=font.ttf:text=%{n}:fontsize=260:fontcolor=white:x=(w-tw)/2:y=(h-th)/2:box=1:boxcolor=black@0.4:boxborderw=24"
  $vf = "$lbl,$num"
  & ffmpeg -v error -y -f lavfi -i "color=c=$($cols[$i]):s=1280x720:r=25:d=1" -vf $vf -c:v libx264 -pix_fmt yuv420p -g 25 -an $seg
  if ($LASTEXITCODE -ne 0) { throw "segment build failed: seg$i" }
}
Write-Output 'segments ok (seg0..seg7)'

function Build-Concat([int]$n, [string]$out) {
  $list = "list-$n.txt"
  $lines = @()
  for ($i = 0; $i -lt $n; $i++) { $lines += "file 'seg$i.mp4'" }
  $lines | Set-Content -Encoding ascii $list
  if (Test-Path $out) { Remove-Item $out -Force }
  & ffmpeg -v error -y -f concat -safe 0 -i $list -c copy -movflags +faststart -an $out
  if ($LASTEXITCODE -ne 0) { throw "concat failed: $out" }
}

# --- 4. the two mp4s ---
Build-Concat 3 'probe-seek.mp4'
Build-Concat 8 'probe-seek-8s.mp4'

# --- 5. VP9 twins (fallback if the Linux headless-shell has no H.264) ---
$pairs = @(@('probe-seek.mp4', 'probe-seek.webm'), @('probe-seek-8s.mp4', 'probe-seek-8s.webm'))
foreach ($pair in $pairs) {
  if (Test-Path $pair[1]) { Remove-Item $pair[1] -Force }
  & ffmpeg -v error -y -i $pair[0] -c:v libvpx-vp9 -crf 32 -b:v 0 -pix_fmt yuv420p -an $pair[1]
  if ($LASTEXITCODE -ne 0) { throw "webm build failed: $($pair[1])" }
}

# --- 6. self-check: moov position + corner colour + centre frame-number OCR-free check ---
foreach ($f in @('probe-seek.mp4', 'probe-seek-8s.mp4')) {
  $bytes = [System.IO.File]::ReadAllBytes((Join-Path $root $f))
  $head = [System.Text.Encoding]::ASCII.GetString($bytes, 0, [Math]::Min(4096, $bytes.Length))
  $iMoov = $head.IndexOf('moov')
  $iMdat = $head.IndexOf('mdat')
  $verdict = 'FAIL'
  if (($iMoov -ge 0) -and ($iMoov -lt $iMdat)) { $verdict = 'PASS (moov before mdat)' }
  Write-Output ("FASTSTART {0}: moov@{1} mdat@{2} -> {3}" -f $f, $iMoov, $iMdat, $verdict)
}

Write-Output '--- corner colour self-check (expect RED / GREEN / BLUE) ---'
foreach ($t in @(0.5, 1.5, 2.5)) {
  $bin = "avg_$t.bin"
  & ffmpeg -v error -y -ss $t -i 'probe-seek.mp4' -frames:v 1 -vf 'crop=160:160:8:8,scale=1:1' -pix_fmt rgb24 -f rawvideo $bin
  $b = [System.IO.File]::ReadAllBytes((Join-Path $root $bin))
  Write-Output ("t={0}  corner RGB = {1},{2},{3}" -f $t, $b[0], $b[1], $b[2])
}
& ffmpeg -v error -y -ss 2.5 -i 'probe-seek-8s.mp4' -frames:v 1 -vf 'crop=160:160:8:8,scale=1:1' -pix_fmt rgb24 -f rawvideo 'avg8.bin'
$b8 = [System.IO.File]::ReadAllBytes((Join-Path $root 'avg8.bin'))
Write-Output ("8s t=2.5  corner RGB = {0},{1},{2}" -f $b8[0], $b8[1], $b8[2])

Write-Output '--- ffprobe ---'
foreach ($f in @('probe-seek.mp4', 'probe-seek-8s.mp4', 'probe-seek.webm', 'probe-seek-8s.webm')) {
  $s = & ffprobe -v error -show_entries stream=codec_name,width,height,pix_fmt,r_frame_rate,nb_frames -show_entries format=duration -of csv=p=0 $f
  Write-Output ("{0} => {1}" -f $f, ($s -join ' | '))
}
Pop-Location
Write-Output 'DONE'
