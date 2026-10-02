# colorspace-test.ps1
# Question: srv-env claims that "-colorspace/-color_range only DECLARE, they do not CONVERT pixels",
# so re-tagging a genuinely BT.601 source as bt709 turns "untagged" into "MISLABELLED".
# Test: build a genuinely BT.601(bt470bg)+tv source, then produce two re-encodes:
#   decl-only : -colorspace bt709 ...            (declaration only, no pixel conversion)
#   convert   : scale=out_color_matrix=bt709:out_range=tv  + same declarations  (convert THEN declare)
# Then (a) sample with ffmpeg (honours tags) and (b) render each through HyperFrames and sample the
# same corner, comparing to the intended colour (green 0,160,0 / red 192,0,0).
# ASCII-only (PS5.1 + no-BOM UTF-8 .ps1 breaks). Native stderr relaxed before hyperframes calls.
$ErrorActionPreference = 'Stop'
$base = 'G:\AiMarketing\dist-rel\probe-hf'
$td = Join-Path $base 'cs-test'
New-Item -ItemType Directory -Force -Path $td | Out-Null
Copy-Item (Join-Path $base 'seek-test\font.ttf') (Join-Path $td 'font.ttf') -Force
Push-Location $td

# --- 1. genuinely BT.601 tagged + encoded 3s clip (green is second 1s) ---
$cols = @('0xC00000', '0x00A000', '0x0000C0')
for ($i = 0; $i -lt 3; $i++) {
  $lbl = "drawtext=fontfile=font.ttf:text=T${i}:fontsize=72:fontcolor=white:x=(w-tw)/2:y=70:box=1:boxcolor=black@0.5:boxborderw=14"
  $num = "drawtext=fontfile=font.ttf:text=%{n}:fontsize=260:fontcolor=white:x=(w-tw)/2:y=(h-th)/2:box=1:boxcolor=black@0.4:boxborderw=24"
  & ffmpeg -v error -y -f lavfi -i "color=c=$($cols[$i]):s=1280x720:r=25:d=1" -vf "$lbl,$num" `
      -c:v libx264 -pix_fmt yuv420p -g 25 -an `
      -color_range tv -colorspace smpte170m -color_primaries smpte170m -color_trc smpte170m "s$i.mp4"
  if ($LASTEXITCODE -ne 0) { throw "seg build failed $i" }
}
@("file 's0.mp4'", "file 's1.mp4'", "file 's2.mp4'") | Set-Content -Encoding ascii 'list3.txt'
& ffmpeg -v error -y -f concat -safe 0 -i 'list3.txt' -c copy -movflags +faststart -an 'cs601.mp4'

# --- 2. variant A: declaration only (NO conversion) ---
& ffmpeg -v error -y -i 'cs601.mp4' -c:v libx264 -crf 18 -pix_fmt yuv420p -g 25 -an `
    -color_range tv -colorspace bt709 -color_primaries bt709 -color_trc bt709 `
    -movflags +faststart 'decl-only.mp4'
if ($LASTEXITCODE -ne 0) { throw 'decl-only build failed' }

# --- 3. variant B: convert THEN declare (srv-env's proposed entry-transcode spec) ---
& ffmpeg -v error -y -i 'cs601.mp4' -vf "scale=out_color_matrix=bt709:out_range=tv,format=yuv420p" `
    -c:v libx264 -crf 18 -pix_fmt yuv420p -g 25 -an `
    -color_range tv -colorspace bt709 -color_primaries bt709 -color_trc bt709 `
    -movflags +faststart 'convert.mp4'
if ($LASTEXITCODE -ne 0) { throw 'convert build failed' }

Pop-Location

# --- 4. tags actually written ---
foreach ($f in @('cs601.mp4', 'decl-only.mp4', 'convert.mp4')) {
  $t = & ffprobe -v error -select_streams v:0 -show_entries stream=color_range,color_space -of csv=p=0 (Join-Path $td $f)
  Write-Output ("tags  {0,-16} = {1}" -f $f, ($t -join ' | '))
}

# --- 5. ffmpeg-side decode (honours each file's own tag) : intended green = (0,160,0) ---
foreach ($f in @('cs601.mp4', 'decl-only.mp4', 'convert.mp4')) {
  $b = Join-Path $td 'c2.bin'
  & ffmpeg -v error -y -ss 1.5 -i (Join-Path $td $f) -frames:v 1 -vf 'crop=160:160:8:8,scale=1:1' -pix_fmt rgb24 -f rawvideo $b
  $x = [System.IO.File]::ReadAllBytes($b)
  Write-Output ("FFMPEG decode [{0,-16}] t=1.5 corner=({1},{2},{3})" -f $f, $x[0], $x[1], $x[2])
}

# --- 6. render each through HyperFrames, sample the same corner ---
$ErrorActionPreference = 'Continue'
$proj = Join-Path $base 'hfprobe'
$bin = Join-Path $base 'node_modules\.bin\hyperframes.cmd'
$orig = Join-Path $proj 'probe-seek.mp4'
Copy-Item $orig (Join-Path $td 'probe-seek.orig.mp4') -Force
foreach ($f in @('cs601.mp4', 'decl-only.mp4', 'convert.mp4')) {
  Copy-Item (Join-Path $td $f) $orig -Force
  $out = Join-Path $td ("rendered-$f")
  Push-Location $proj
  & $bin render '.' '-c' 'page-video.html' '-o' $out '--fps' 25 '--quality' 'looks' '--workers' 1 *> (Join-Path $td "log-$f.txt")
  $code = $LASTEXITCODE
  Pop-Location
  if ($code -ne 0) { Write-Output ("render FAILED {0}" -f $f); continue }
  $b = Join-Path $td 'c.bin'
  & ffmpeg -v error -y -ss 1.5 -i $out -frames:v 1 -vf 'crop=160:160:8:8,scale=1:1' -pix_fmt rgb24 -f rawvideo $b
  $x = [System.IO.File]::ReadAllBytes($b)
  Write-Output ("RENDERED  [{0,-16}] t=1.5 corner=({1},{2},{3})" -f $f, $x[0], $x[1], $x[2])
}
Copy-Item (Join-Path $td 'probe-seek.orig.mp4') $orig -Force
Remove-Item (Join-Path $td 'c.bin'), (Join-Path $td 'c2.bin') -Force -ErrorAction SilentlyContinue
Write-Output 'DONE (probe-seek.mp4 restored)'
