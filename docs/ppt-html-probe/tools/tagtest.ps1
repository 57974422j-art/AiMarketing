# Root-cause test: is the HTML-path colour shift caused by the SOURCE clip being UNTAGGED?
# Builds the same 3s clip twice -- untagged vs explicitly bt709/tv tagged -- renders both
# through HyperFrames, and compares the decoded corner colour at t=1.5 (expect green).
# ASCII-only on purpose (PS5.1 + no-BOM UTF-8 .ps1 breaks).
# NOTE: brace variables in filter strings -- "text=T$i:fontsize=..." eats $i (PS scoping).
$ErrorActionPreference = 'Stop'
$base = 'G:\AiMarketing\dist-rel\probe-hf'
$td   = Join-Path $base 'tagtest'
New-Item -ItemType Directory -Force -Path $td | Out-Null
Copy-Item (Join-Path $base 'seek-test\font.ttf') (Join-Path $td 'font.ttf') -Force

$cols = @('0xC00000', '0x00A000', '0x0000C0')

function Build-Clip([string]$dest, [bool]$tagged) {
  Push-Location $td
  for ($i = 0; $i -lt 3; $i++) {
    $lbl = "drawtext=fontfile=font.ttf:text=T${i}:fontsize=72:fontcolor=white:x=(w-tw)/2:y=70:box=1:boxcolor=black@0.5:boxborderw=14"
    $num = "drawtext=fontfile=font.ttf:text=%{n}:fontsize=260:fontcolor=white:x=(w-tw)/2:y=(h-th)/2:box=1:boxcolor=black@0.4:boxborderw=24"
    $vf = "$lbl,$num"
    $a = @('-v', 'error', '-y', '-f', 'lavfi', '-i', "color=c=$($cols[$i]):s=1280x720:r=25:d=1",
           '-vf', $vf, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-g', '25', '-an')
    if ($tagged) { $a += @('-color_range', 'tv', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709') }
    $a += "s$i.mp4"
    & ffmpeg @a
    if ($LASTEXITCODE -ne 0) { throw "segment failed (tagged=$tagged) i=$i" }
  }
  @("file 's0.mp4'", "file 's1.mp4'", "file 's2.mp4'") | Set-Content -Encoding ascii 'list3.txt'
  if (Test-Path 'out.mp4') { Remove-Item 'out.mp4' -Force }
  & ffmpeg -v error -y -f concat -safe 0 -i 'list3.txt' -c copy -movflags +faststart -an 'out.mp4'
  if ($LASTEXITCODE -ne 0) { throw 'concat failed' }
  Copy-Item 'out.mp4' $dest -Force
  Pop-Location
}

$clips = @(
  @{ name = 'untagged'; dest = (Join-Path $td 'clip-untagged.mp4'); tagged = $false },
  @{ name = 'tagged';   dest = (Join-Path $td 'clip-tagged.mp4');   tagged = $true  }
)
foreach ($c in $clips) { Build-Clip $c.dest $c.tagged; Write-Output ("built {0} -> {1}" -f $c.name, $c.dest) }

# report the tags actually written
foreach ($c in $clips) {
  $s = & ffprobe -v error -select_streams v:0 -show_entries stream=color_range,color_space -of csv=p=0 $c.dest
  Write-Output ("tags[{0}] = {1}" -f $c.name, ($s -join ' | '))
}

# render each through HyperFrames (page-video.html in hfprobe points at probe-seek.mp4)
$proj = Join-Path $base 'hfprobe'
$bin  = Join-Path $base 'node_modules\.bin\hyperframes.cmd'
$orig = Join-Path $proj 'probe-seek.mp4'
Copy-Item $orig (Join-Path $td 'probe-seek.orig.mp4') -Force

# NOTE: hyperframes writes its [INFO] log to stderr; under ErrorActionPreference='Stop'
# PowerShell turns native stderr into a TERMINATING error -> must relax it for the render call.
$ErrorActionPreference = 'Continue'
foreach ($c in $clips) {
  Copy-Item $c.dest $orig -Force
  $out = Join-Path $td ("baseline-$($c.name).mp4")
  Push-Location $proj
  & $bin render '.' '-c' 'page-video.html' '-o' $out '--fps' 25 '--quality' 'looks' *> (Join-Path $td "log-$($c.name).txt")
  $code = $LASTEXITCODE
  Pop-Location
  if ($code -ne 0) { Write-Output ("render FAILED for {0}" -f $c.name); continue }
  $binf = Join-Path $td 'corner.bin'
  & ffmpeg -v error -y -ss 1.5 -i $out -frames:v 1 -vf 'crop=160:160:8:8,scale=1:1' -pix_fmt rgb24 -f rawvideo $binf
  $b = [System.IO.File]::ReadAllBytes($binf)
  Write-Output ("RENDERED[{0}] corner@t=1.5 = ({1},{2},{3})" -f $c.name, $b[0], $b[1], $b[2])
}

# source reference (the tagged clip is authored bt709/tv, so expect ~(0,161,0) there)
foreach ($c in $clips) {
  $binf = Join-Path $td 'corner2.bin'
  & ffmpeg -v error -y -ss 1.5 -i $c.dest -frames:v 1 -vf 'crop=160:160:8:8,scale=1:1' -pix_fmt rgb24 -f rawvideo $binf
  $b = [System.IO.File]::ReadAllBytes($binf)
  Write-Output ("SOURCE  [{0}] corner@t=1.5 = ({1},{2},{3})" -f $c.name, $b[0], $b[1], $b[2])
}

Copy-Item (Join-Path $td 'probe-seek.orig.mp4') $orig -Force
Remove-Item (Join-Path $td 'corner.bin'), (Join-Path $td 'corner2.bin') -Force -ErrorAction SilentlyContinue
Write-Output 'DONE (probe-seek.mp4 restored)'
