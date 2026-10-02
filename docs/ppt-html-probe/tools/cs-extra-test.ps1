# cs-extra-test.ps1 -- two follow-ups on the colour-tag question (NO HyperFrames render needed)
# 动机：srv-env 的保留是"版本边界"（我只测了 ffmpeg 8.1）。
#   与其停在推测，不如在 8.1 上直接找一个"只声明、不转换"的可达路径 —— 那就是 -c copy 重封装：
#   容器/元数据改写是素材管线的常规操作，但它**不允许**改像素。若此时标签被改成 bt709 而像素仍是 601，
#   就得到"标签 ↔ 像素不一致"的真实可达状态（同一版本内可复现），不必等老版 ffmpeg。
#   B) 顺带测 srv-env 提到的"像素格式"边界：真身 601 的 **10bit** 源 + 只声明。
# 读出方式：corner RGB（ffmpeg 按各文件自己的标签解码）——期望绿 ≈ (0,160,0)。
# ASCII-only（PS5.1 + no-BOM UTF-8 .ps1 会解析失败）。变量后紧跟冒号必须写 ${x}。
$ErrorActionPreference = 'Continue'
$td = 'G:\AiMarketing\dist-rel\probe-hf\cs-test'
Push-Location $td

Write-Output '--- A) remux only (-c copy) + declare bt709 ---'
& ffmpeg -v error -y -i 'cs601.mp4' -c copy -color_range tv -colorspace bt709 `
    -color_primaries bt709 -color_trc bt709 -movflags +faststart 'remux-declared.mp4'
Write-Output ("remux exit={0}" -f $LASTEXITCODE)

Write-Output '--- B) true BT.601 10-bit source, declaration only ---'
& ffmpeg -v error -y -f lavfi -i 'color=c=0x00A000:s=1280x720:r=25:d=1' -c:v libx264 -pix_fmt yuv420p10le `
    -g 25 -an -color_range tv -colorspace smpte170m -color_primaries smpte170m -color_trc smpte170m 'ten601.mp4'
Write-Output ("ten601 exit={0}" -f $LASTEXITCODE)
& ffmpeg -v error -y -i 'ten601.mp4' -c:v libx264 -pix_fmt yuv420p10le -g 25 -an `
    -color_range tv -colorspace bt709 -color_primaries bt709 -color_trc bt709 'ten-decl.mp4'
Write-Output ("ten-decl exit={0}" -f $LASTEXITCODE)
Pop-Location

# file -> 采样时刻（cs601 系列第 2 秒是绿；10bit 测试源整段是绿）
$tbl = @(
  @{ f = 'cs601.mp4';          t = 1.5 },
  @{ f = 'decl-only.mp4';      t = 1.5 },
  @{ f = 'convert.mp4';        t = 1.5 },
  @{ f = 'remux-declared.mp4'; t = 1.5 },
  @{ f = 'ten601.mp4';         t = 0.2 },
  @{ f = 'ten-decl.mp4';       t = 0.2 }
)
Write-Output ''
Write-Output '期望：真身 601 的源解出来应是绿 ≈ (0,161,0)'
foreach ($r in $tbl) {
  $p = Join-Path $td $r.f
  if (-not (Test-Path $p)) { Write-Output ("MISSING {0}" -f $r.f); continue }
  $t = & ffprobe -v error -select_streams v:0 -show_entries stream=color_range,color_space,pix_fmt -of csv=p=0 $p
  $b = Join-Path $td 'x.bin'
  & ffmpeg -v error -y -ss $r.t -i $p -frames:v 1 -vf 'crop=160:160:8:8,scale=1:1' -pix_fmt rgb24 -f rawvideo $b
  $x = [System.IO.File]::ReadAllBytes($b)
  Write-Output ("{0,-20} t={1,-4} tags={2,-26} decodeRGB=({3},{4},{5})" -f $r.f, $r.t, ($t -join '|'), $x[0], $x[1], $x[2])
}
Remove-Item (Join-Path $td 'x.bin') -Force -ErrorAction SilentlyContinue
Write-Output 'DONE'
