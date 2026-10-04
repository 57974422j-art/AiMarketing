#!/usr/bin/env node
/**
 * check-env.mjs —— **部署自检（只读 · 无副作用）**：一条命令告诉你"这台机器能不能跑这套流水线、缺什么、怎么补"
 *
 * 为什么要有它：部署时最容易卡在三处**本机看不出、服务器才暴露**的地方 ——
 *   ① ffmpeg **缺 libass**（`subtitles` 滤镜）⇒ 成片**没有字幕**且不报错（最阴的一项）
 *   ② 没跑过 `npm ci` ⇒ 缺渲染器 `hyperframes` ⇒ `render-deck` 直接失败
 *   ③ Node 版本过低（仓库全 ESM）
 *   ⇒ 本脚本逐条实测并给出**该敲的那条命令**；退出码：0=可测 · 1=缺必需项 · 2=脚本自身/环境异常
 *
 * 用法：node check-env.mjs        （可加 --json）
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync, rmSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const EXIT = { OK: 0, MISSING: 1, BROKEN: 2 }
const rows = []
const add = (name, ok, detail, fix) => rows.push({ name, ok, detail, fix })

/* ① Node */
const nodeMajor = Number(process.versions.node.split('.')[0])
add('Node 版本 ≥ 20', nodeMajor >= 20, `v${process.versions.node}（${process.platform}）`, '升级 Node 到 20/22 LTS')

/* ② ffmpeg / ffprobe（走**引擎自己的解析路径**，不是凭空 which） */
let ffmpeg = null, ffprobe = null
try {
  const m = await import('./engine-bin.mjs')
  ffmpeg = m.resolveFfmpeg().p
  ffprobe = m.resolveFfprobe().p
} catch { /* 下面统一报 */ }
const run = (bin, args) => { try { return execFileSync(bin, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) } catch { return '' } }
const ffVer = ffmpeg ? (run(ffmpeg, ['-version']).split('\n')[0] || '') : ''
add('ffmpeg 可执行', !!ffmpeg && !!ffVer, ffVer.trim() || `未找到（解析=${ffmpeg || '失败'}）`,
  '安装 ffmpeg；或把已有 ffmpeg 的路径交给引擎的**覆盖变量**（变量名只在 engine-bin.mjs 一处声明 ⇒ `grep -n FFMPEG_PATH engine-bin.mjs` 可见）')
if (ffVer) {
  const filters = run(ffmpeg, ['-hide_banner', '-filters'])
  const encoders = run(ffmpeg, ['-hide_banner', '-encoders'])
  add('ffmpeg 含 subtitles 滤镜（libass · **字幕烧录必需**）', /\bsubtitles\b/.test(filters),
    /\bsubtitles\b/.test(filters) ? '✓' : '缺 ⇒ 成片会**没有字幕**且不报错',
    '换一个带 libass 的 ffmpeg 构建（Ubuntu/Debian: `apt install ffmpeg`；或下载 full/static 构建）')
  add('ffmpeg 含 libx264（H.264 编码）', /\blibx264\b/.test(encoders), /\blibx264\b/.test(encoders) ? '✓' : '缺', '同上：换完整构建')
  add('ffmpeg 含 aac（音频编码）', /\baac\b/.test(encoders), /\baac\b/.test(encoders) ? '✓' : '缺', '同上：换完整构建')
}
add('ffprobe 可执行', !!ffprobe, ffprobe ? '✓' : '未找到', '与 ffmpeg 同包安装')

/* ③ 渲染器依赖（npm ci 是否跑过） */
const hfPkg = join(HERE, 'node_modules', 'hyperframes', 'package.json')
let hfVer = ''
try { hfVer = JSON.parse(readFileSync(hfPkg, 'utf8')).version } catch { /* 缺 */ }
add('渲染器 hyperframes 已安装（**渲染必需**）', !!hfVer, hfVer ? `v${hfVer}` : '缺 ⇒ render-deck 会直接失败',
  `cd ${HERE} && npm ci   （package-lock.json 在库 ⇒ 可复现安装；若网络受限，先只装 hyperframes）`)

/* ④ 自带字体与字表（防豆腐块闸门的输入） */
const fontsDir = join(HERE, 'fonts')
const charsCmn = join(fontsDir, 'chars-cmn.txt')
add('字体真源存在（fonts/）', existsSync(fontsDir) && existsSync(charsCmn),
  existsSync(charsCmn) ? 'chars-cmn.txt ✓' : '缺 fonts/chars-cmn.txt',
  '从仓库完整拉取（该目录在库内）')

/* ⑤ 目录可写（渲染/合成要写产物） */
let writable = false
const probeFile = join(HERE, '.check-env.tmp')
try { writeFileSync(probeFile, 'x'); writable = true; rmSync(probeFile, { force: true }) } catch { writable = false }
add('引擎目录可写（渲染/合成要写产物）', writable, writable ? '✓' : `不可写：${HERE}`, '给运行用户写权限，或把产物目录指到可写位置')

/* ⑥ 报告（机读 + 人读） */
const missing = rows.filter((r) => !r.ok)
if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ tool: 'check-env', node: process.versions.node, platform: process.platform, ok: missing.length === 0, rows }, null, 2))
} else {
  console.log('=== 部署自检（只读）===')
  for (const r of rows) console.log(`  ${r.ok ? '✓' : '✗'} ${r.name} —— ${r.detail}`)
  if (!missing.length) {
    console.log('\n✓ 环境可测：建议接着跑冒烟四连（validate / render / palette-distance / batch-video，见交接单）')
  } else {
    console.log(`\n✗ 缺 ${missing.length} 项 ⇒ 逐条修（每条后面就是**该敲的命令**）：`)
    for (const r of missing) console.log(`  · ${r.name}\n      ⇒ ${r.fix}`)
    const needFfmpegSwap = missing.some((r) => /subtitles|libx264|aac|ffmpeg/.test(r.name))
    console.log(needFfmpegSwap
      ? '\n★ 关于"ffmpeg 要不要升级"：**判据不是版本号，而是上面这三个滤镜/编码器**。三者齐 ⇒ 不必升级；缺 `subtitles` ⇒ 必须换成带 libass 的构建。'
      : '')
  }
}
process.exit(missing.length ? EXIT.MISSING : EXIT.OK)
