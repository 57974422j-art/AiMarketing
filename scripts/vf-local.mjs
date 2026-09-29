#!/usr/bin/env node
/**
 * ★VF_LOCAL_DIAG_V1（2026-09-29 用户定案）—— 本机成片「就地渲染 + 就地体检」工具
 *
 * 用户原话：「我机器上有 FF，目前用的是服务器的，是否能先检测到本来有就本地做，让你更好判断？
 *            或者你还是和以前一样让我去服务器上拿准确数据，方便你判断？
 *            光靠生成的视频切片你能方便判断吗」
 *
 * 结论（本工具就是答案）：
 *   · 生产出片：仍走服务器（字体一致、可复现、不占你机器）—— 本工具不改生产链路；
 *   · 诊断出片：走本机。三种数据一次拿全，判断精度从"逆向猜"变成"直接看"：
 *       ① 分镜 JSON（AI 到底给了什么文字/卡型/时长）
 *       ② 逐镜 mp4 + 完整 ffmpeg 滤镜串（哪一条 drawtext 的坐标算错，一眼可见）
 *       ③ 成片逐帧体检（竖线 / 文字边缘 / 越界，自动量出来，不靠肉眼描述）
 *
 * 用法：
 *   node scripts/vf-local.mjs --check                      # 体检：ffmpeg/python/字体/脚本 是否就位
 *   node scripts/vf-local.mjs --sb 分镜.json               # 本机渲染（产出 out.mp4 + 保留工作目录）
 *   node scripts/vf-local.mjs --filters 分镜.json [--shot 3]   # 只打印滤镜串（不渲染，秒级）
 *   node scripts/vf-local.mjs --probe 成片.mp4             # 逐帧体检：竖线/文字边缘/越界
 *   node scripts/vf-local.mjs --frames 成片.mp4 --t 49     # 抽某一秒的帧成 png（肉眼看）
 *
 * 常用参数：--out 输出.mp4  --wd 工作目录  --audio 配音.mp3  --no-bigtext（关画面大字）
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync, readFileSync, rmSync, readdirSync, statSync } from 'node:fs'
import { resolve, join, basename, dirname } from 'node:path'

const ROOT = resolve(process.cwd())
const VF = join(ROOT, 'scripts', 'video-factory')
const RENDER = join(VF, 'render.py')

function arg(name, def = '') {
  const i = process.argv.indexOf('--' + name)
  return i >= 0 ? String(process.argv[i + 1] || '') : def
}
const has = (name) => process.argv.includes('--' + name)

function sh(cmd, args, opts = {}) {
  return spawnSync(cmd, args, { encoding: 'utf8', ...opts })
}

// ── 环境探测（实测三个都试，报出到底用哪个）──────────────────────────
function findFfmpeg() {
  const cands = [
    process.env.FFMPEG_PATH,
    'C:\\ffmpeg\\bin\\ffmpeg.exe',
    join(process.env.LOCALAPPDATA || '', 'Microsoft', 'WinGet', 'Links', 'ffmpeg.exe'),
    '/usr/bin/ffmpeg', '/usr/local/bin/ffmpeg',
  ].filter(Boolean)
  for (const c of cands) if (existsSync(c)) return c
  const w = sh('where', ['ffmpeg'])
  if (w.status === 0) return String(w.stdout).split(/\r?\n/)[0].trim()
  return ''
}
function findPython() {
  // 优先客户端内置 python（与线上环境一致），其次 PATH 里的 python
  const cands = [
    'E:\\ai-marketing\\python\\buvenv-test\\python.exe',
    join(ROOT, 'python', 'buvenv-test', 'python.exe'),
    'python', 'python3',
  ]
  for (const c of cands) {
    if (c.includes('\\') || c.includes('/')) { if (existsSync(c)) return c; continue }
    const r = sh(c, ['-c', 'print(1)'])
    if (r.status === 0 && String(r.stdout).trim() === '1') return c
  }
  return ''
}
function findFont() {
  for (const f of ['C:\\Windows\\Fonts\\msyh.ttc', '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc']) {
    if (existsSync(f)) return f
  }
  return ''
}

const FFMPEG = findFfmpeg()
const PY = findPython()
const FPROBE = FFMPEG ? FFMPEG.replace(/ffmpeg(\.exe)?$/i, (m) => (m.toLowerCase().endsWith('.exe') ? 'ffprobe.exe' : 'ffprobe')) : ''
const FONT = findFont()

// ── ① --check 体检 ─────────────────────────────────────────────
if (has('check') || process.argv.length <= 2) {
  const ver = FFMPEG ? String(sh(FFMPEG, ['-version']).stdout || '').split(/\r?\n/)[0] : ''
  console.log('  成片诊断工具 · 本机体检')
  console.log('  ' + '-'.repeat(58))
  console.log('   ffmpeg   : ' + (FFMPEG || '❌ 没找到（可设 FFMPEG_PATH 或装进 PATH）'))
  if (ver) console.log('              ' + ver.slice(0, 78))
  console.log('   ffprobe  : ' + (FPROBE && existsSync(FPROBE) ? FPROBE : '（与 ffmpeg 同目录，缺了只用帧检测）'))
  console.log('   python   : ' + (PY || '❌ 没找到'))
  console.log('   中文字体 : ' + (FONT || '⚠️ 没找到 msyh/Noto → 中文会变方块'))
  console.log('   渲染脚本 : ' + (existsSync(RENDER) ? RENDER : '❌ 缺 scripts/video-factory/render.py'))
  console.log('  ' + '-'.repeat(58))
  console.log('  ★ 生产出片仍走服务器；本机渲染只用于"看清楚问题"（服务器用 Noto 字体，本机是 msyh，字形会略有差异）')
  if (!has('check')) console.log('  用法: node scripts/vf-local.mjs --check | --sb 分镜.json | --filters 分镜.json | --probe 成片.mp4')
  process.exit(0)
}

if (!PY) { console.error('❌ 没找到 python，无法继续'); process.exit(1) }
const tmpPy = (code, tag = 'tmp') => {
  const p = join(ROOT, `.tmp-vf-${tag}-${Date.now()}.py`)
  writeFileSync(p, code, 'utf8')
  return p
}
const runPy = (file, extraArgs = []) => {
  const r = spawnSync(PY, [file, ...extraArgs], { cwd: ROOT, stdio: 'inherit' })
  try { rmSync(file, { force: true }) } catch { /* ignore */ }
  return r.status || 0
}

// ── ② --filters：只打印滤镜串（定位"哪条 drawtext 算错"的最快方式）──
if (has('filters')) {
  const sb = arg('sb') || arg('filters')
  const shot = arg('shot', '-1')
  const code = `
import json, os, sys
sys.path.insert(0, r"${VF.replace(/\\/g, '\\\\')}")
import render
sb = json.load(open(r"${resolve(sb).replace(/\\/g, '\\\\')}", encoding='utf-8'))
W, H = sb.get('size', [720, 1280])[:2]
fps = int(sb.get('fps', 25))
th = sb.get('theme') or {'bg': '0x0a1620', 'text': 'white', 'accent': '0xff6b35', 'font': 'msyh'}
only = int(r"${shot}")
if sb.get('overlay_text') is False:
    render.SHOW_OVERLAY_TEXT = False
    print('   （storyboard 里 overlay_text=false → 画面大字已关）')
shots = sb.get('shots') or []
for i, s in enumerate(shots):
    if only >= 0 and i != only:
        continue
    typ = str(s.get('type') or 'title')
    fn = render.CARDS.get(typ) or render.card_title
    try:
        _in, vf, dur = fn(s, th, int(W), int(H), fps)
    except Exception as e:
        print('   #%d %-9s 生成失败: %s' % (i, typ, e)); continue
    print('   ── 第 %d 镜  %s  dur=%ss  text=%r' % (i, typ, dur, str(s.get('text') or '')[:28]))
    for part in str(vf).split(','):
        p = part.strip()
        if p.startswith('drawtext') or p.startswith('drawbox'):
            print('        ' + p[:190])
`
  process.exit(runPy(tmpPy(code, 'filters'), []))
}

// ── ③ --sb：本机渲染（保留工作目录，逐镜 mp4 都在）────────────────
if (has('sb')) {
  const sb = resolve(arg('sb'))
  if (!existsSync(sb)) { console.error('❌ 找不到分镜文件: ' + sb); process.exit(1) }
  const out = resolve(arg('out', join(ROOT, 'dist-rel', 'vf-local.mp4')))
  const wd = resolve(arg('wd', join(ROOT, 'dist-rel', 'vf-local-work')))
  mkdirSync(wd, { recursive: true })
  const args = ['-u', RENDER, '--storyboard', sb, '--workdir', wd, '--out', out]
  const audio = arg('audio')
  if (audio) args.push('--audio', resolve(audio))
  if (has('no-bigtext')) args.push('--no-bigtext')
  console.log('  本机渲染: ' + basename(sb) + '  →  ' + out)
  console.log('  工作目录（逐镜 mp4 / 字幕 / 滤镜日志都在这里）: ' + wd)
  const r = spawnSync(PY, args, { cwd: ROOT, stdio: 'inherit' })
  if (r.status === 0 && existsSync(out)) {
    const mb = (statSync(out).size / 1048576).toFixed(1)
    console.log('  ✅ 本机成片: ' + out + '  (' + mb + ' MB)')
    const shots = readdirSync(wd).filter((f) => /^shot\d+\.mp4$/.test(f)).sort()
    console.log('     逐镜文件 ' + shots.length + ' 个: ' + shots.slice(0, 8).join(' ') + (shots.length > 8 ? ' …' : ''))
  } else {
    console.error('  ❌ 渲染失败（退出码 ' + r.status + '）——上面是 render.py 的原始输出')
  }
  process.exit(r.status || 0)
}

// ── ④ --probe：成片逐帧体检（竖线 / 文字边缘 / 越界）──────────────
if (has('probe')) {
  const src = resolve(arg('probe'))
  if (!existsSync(src)) { console.error('❌ 找不到视频: ' + src); process.exit(1) }
  const code = `
import subprocess, os, json
FF = r"${FFMPEG.replace(/\\/g, '\\\\')}"
FP = r"${FPROBE.replace(/\\/g, '\\\\')}"
SRC = r"${src.replace(/\\/g, '\\\\')}"
r = subprocess.run([FP, "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height,duration",
                    "-of", "json", SRC], capture_output=True, text=True)
st = json.loads(r.stdout or "{}")["streams"][0]
W, H = st["width"], st["height"]; dur = float(st.get("duration") or 0)
print("   %dx%d  dur=%.1fs" % (W, H, dur))
def frame(t):
    r = subprocess.run([FF, "-v", "error", "-ss", str(t), "-i", SRC, "-frames:v", "1",
                        "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], capture_output=True)
    return r.stdout if len(r.stdout) >= W * H * 3 else None
def orange(p):
    rr, gg, bb = p[0], p[1], p[2]
    return rr > 140 and 50 < gg < 170 and bb < 135 and (rr - bb) > 55
print("   t(s)  橙竖线(x=命中/需要)   白字左右边缘     横跨   提示")
t = 1.0
while t < dur:
    b = frame(t)
    if b:
        y0, y1 = int(H * 0.20), int(H * 0.80)
        best, bestx = 0, -1
        for x in range(0, W, 4):
            c = 0
            for y in range(y0, y1, 6):
                o = (y * W + x) * 3
                if orange((b[o], b[o + 1], b[o + 2])): c += 1
            if c > best: best, bestx = c, x
        need = int((y1 - y0) / 6 * 0.8)
        mn = mx = None
        for y in range(int(H * 0.10), int(H * 0.90), 3):
            row = y * W * 3
            for x in range(0, W, 3):
                o = row + x * 3
                if b[o] > 205 and b[o + 1] > 205 and b[o + 2] > 205:
                    mn = x if mn is None or x < mn else mn
                    mx = x if mx is None or x > mx else mx
        hints = []
        if best >= need: hints.append("★贯穿竖线(中线位置多为对比卡分隔线)")
        if mn is not None and (mn <= 4 or mx >= W - 5): hints.append("文字贴边/越界")
        span = ("%.0f%%" % (100.0 * (mx - mn) / W)) if (mn is not None and mx) else "-"
        print("   %5.1f  x=%-5d(%d/%d)   %s..%s   %s   %s" % (t, bestx, best, need, mn, mx, span, " ".join(hints)))
    t += 2.0
`
  process.exit(runPy(tmpPy(code, 'probe'), []))
}

// ── ⑤ --frames：抽帧成 png（肉眼看）────────────────────────────
if (has('frames')) {
  const src = resolve(arg('frames'))
  if (!existsSync(src)) { console.error('❌ 找不到视频: ' + src); process.exit(1) }
  const ts = arg('t', '1').split(',').map((s) => s.trim()).filter(Boolean)
  const outDir = resolve(arg('wd', join(ROOT, 'dist-rel', 'vf-frames')))
  mkdirSync(outDir, { recursive: true })
  for (const t of ts) {
    const png = join(outDir, basename(src).replace(/\.\w+$/, '') + '_t' + t.replace('.', '_') + '.png')
    const r = spawnSync(FFMPEG, ['-y', '-v', 'error', '-ss', t, '-i', src, '-frames:v', '1', png], { stdio: 'inherit' })
    if (r.status === 0 && existsSync(png)) console.log('   ✅ ' + png)
    else console.error('   ❌ 抽帧失败 t=' + t)
  }
  process.exit(0)
}

console.log('  用法: node scripts/vf-local.mjs --check | --sb 分镜.json | --filters 分镜.json | --probe 成片.mp4 | --frames 成片.mp4 --t 49')
