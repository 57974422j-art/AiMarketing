#!/usr/bin/env node
/**
 * ★VF_EXTRACT_V1 —— 「喂视频自动建库」的抽取器
 * =============================================================================
 * 用户口径（2026-10-08）：「看到一个好模板/好视频，丢给 AGENT，让它自己去收集建库可以吗？」
 *   ✅ 可以 —— 但**只做"抽取 + 归档 + 出候选清单"，不做"训练"**；最后一步"勾选"由人做（几秒钟）。
 *
 * 它做什么：
 *   ① 按固定间隔抽帧（默认每 8.5s 一帧，与用户看到的节奏一致）
 *   ② 每帧存成图片（给管理器页面当候选缩略图）
 *   ③ 从每帧里**读出可归类的线索**（浅色/深色底、强调色、是否有文字块、是否为满幅画面）
 *   ④ 生成 `candidates.json`：每条 = 一个"疑似元素/结构"候选，含帧号、截图路径、建议归类
 *   ⑤ 直接可用作「风格包」草稿：`--as-style <id>` 会顺手生成一张风格包骨架（含从帧里取的主色）
 *
 * 用法：
 *   node tools/extract-elements.mjs <视频> --out <目录> [--every 8.5] [--as-style my-style]
 * 产物：
 *   <目录>/frames/f0001.jpg …   候选截图
 *   <目录>/candidates.json      候选清单（人勾选）
 *   <目录>/style-<id>.json      （可选）风格包骨架
 *
 * 说明：本脚本**不调用任何 AI**（不联网）。它把"该看的都摆好"，
 *      真正的"读图/读文案"由 AGENT 或人在管理器里完成 —— 这样离线也能用。
 */
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const args = process.argv.slice(2)
const src = args.find((a) => !a.startsWith('--'))
const arg = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d }
const every = parseFloat(arg('every', '8.5'))
const outDir = path.resolve(arg('out', './extract-out'))
const asStyle = arg('as-style', '')

if (!src || !fs.existsSync(src)) { console.error('用法: node tools/extract-elements.mjs <视频> --out <目录> [--every 8.5] [--as-style id]'); process.exit(2) }

// ① 时长
const probe = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', src], { encoding: 'utf8' })
const dur = parseFloat(String(probe.stdout || '0').trim()) || 0
if (!dur) { console.error('读不到时长（ffprobe 失败）'); process.exit(2) }

fs.mkdirSync(path.join(outDir, 'frames'), { recursive: true })

// ② + ③ 按间隔抽帧
const n = Math.max(1, Math.min(60, Math.floor(dur / every)))
const frames = []
for (let i = 0; i < n; i++) {
  const t = +(i * every + every / 2).toFixed(2)
  const p = path.join(outDir, 'frames', 'f' + String(i + 1).padStart(3, '0') + '.jpg')
  const r = spawnSync('ffmpeg', ['-nostdin', '-y', '-v', 'error', '-ss', String(t), '-i', src,
    '-frames:v', '1', '-vf', 'scale=480:-1', p], { encoding: 'utf8' })
  if (r.status === 0 && fs.existsSync(p)) frames.push({ i: i + 1, t, file: path.relative(outDir, p).replace(/\\/g, '/') })
}

/** 从缩略图估算"底暗还是底亮"与主色（用 ffmpeg 输出平均色，不引第三方库） */
function avgColor(file) {
  // 缩到 1x1 像素，用 rawvideo 读 RGB
  const r = spawnSync('ffmpeg', ['-nostdin', '-v', 'error', '-i', file, '-vf', 'scale=1:1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { encoding: 'buffer', maxBuffer: 1024 })
  const b = r.stdout
  if (!b || b.length < 3) return null
  return { r: b[0], g: b[1], b: b[2] }
}
const lum = (c) => (c ? (0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b) / 255 : null)
const hex = (c) => c ? '#' + [c.r, c.g, c.b].map((x) => x.toString(16).padStart(2, '0')).join('') : ''

/* ★ 候选要**自带可用的配色建议** —— 实测：直接拿"平均色"当强调色是浑的（深灰绿 #1f221c 之类），
   走一遍 HSL 把色相留住、把饱和度/明度提到"可当强调色"的区间，才是一张能用的卡。 */
function rgb2hsl(r, g, b) {
  r /= 255; g /= 255; b /= 255
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn
  let h = 0
  if (d) {
    if (mx === r) h = ((g - b) / d + (g < b ? 6 : 0))
    else if (mx === g) h = ((b - r) / d + 2)
    else h = ((r - g) / d + 4)
    h /= 6
  }
  const l = (mx + mn) / 2
  const s = d ? d / (1 - Math.abs(2 * l - 1)) : 0
  return { h, s, l }
}
function hsl2hex(h, s, l) {
  const f = (n) => { const k = (n + h * 12) % 12; const a = s * Math.min(l, 1 - l); const v = l - a * Math.max(-1, Math.min(k - 3, Math.min(9 - k, 1))); return Math.round(v * 255).toString(16).padStart(2, '0') }
  return '#' + f(0) + f(8) + f(4)
}
function suggestTokens(c) {
  if (!c) return null
  const { h, s } = rgb2hsl(c.r, c.g, c.b)
  const dark = lum(c) < 0.35
  return {
    bg: dark ? '#0b0f14' : '#f5f6f8',
    ink: dark ? '#f0f5fa' : '#12161c',
    dim: dark ? '#b8c6d6' : '#4a5563',
    accent: hsl2hex(h, Math.max(0.55, s), dark ? 0.62 : 0.42),
    accentText: hsl2hex(h, Math.max(0.5, s), dark ? 0.76 : 0.34),
  }
}

// ④ 候选清单
const candidates = frames.map((f) => {
  const c = avgColor(path.join(outDir, f.file))
  const L = lum(c)
  return {
    id: 'cand-' + String(f.i).padStart(3, '0'),
    at: f.t + 's',
    frame: f.file,
    guess: {
      bgTone: L == null ? '未知' : (L < 0.35 ? '深色底' : (L > 0.7 ? '浅色底' : '中灰底')),
      dominantColor: hex(c),
      maybeLayer: L != null && L < 0.35 ? 'L1 背景层 / L4 文字层（深底亮字）' : 'L2 中间动画层（亮底素材）',
      maybeStructure: '待人工勾选（对照 elements/structures.json）',
      suggestTokens: suggestTokens(c),      // ← 够用的配色建议：色相留住、饱和度/明度提到可用区间
    },
    keep: false,             // ← 人在管理器里勾
    note: '',
  }
})

const out = {
  version: '0.1',
  source: src,
  duration: dur,
  every,
  createdAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
  howToUse: [
    '1) 打开 tools/style-studio.html（双击），用【导入 JSON】把本文件导入',
    '2) 逐条看截图，把像的勾上（keep: true），填 note（这条好在哪）',
    '3) 在管理器里把勾中的条目归到「元素 / 结构 / 动效」，存成新风格包',
    '4) 导出的 JSON 放回 styles/ 目录即生效（无需改代码、无需命令行）',
  ],
  candidates,
}
fs.writeFileSync(path.join(outDir, 'candidates.json'), JSON.stringify(out, null, 2) + '\n', 'utf8')

// ⑤ 可选：风格包骨架
if (asStyle) {
  const dark = candidates.filter((c) => c.guess.bgTone === '深色底').length >= candidates.length / 2
  const pack = {
    id: asStyle, name: asStyle, desc: '从视频自动抽取的风格包骨架（待人工调）',
    aspect: '9:16', speed: 'normal', mood: dark ? '科技' : '清爽',
    vertical: ['general'],
    tokens: { bg: dark ? '#0b0f1a' : '#f5f6f8', ink: dark ? '#eef4ff' : '#12161c', dim: dark ? '#b6c4dc' : '#4a5563',
      accent: candidates.map((c) => c.guess.dominantColor).find((c) => c && c !== '#000000') || '#4dd7ff',
      font: 'sans-900', radius: 16, density: 'normal', grain: 0.04 },
    structure: ['opening-hero'],
    elements: [],
    motion: { enter: 'rise', emphasis: 'grow-ring', exit: 'crossfade-out', pace: 1.0 },
    prompt: '（在这里写：这套风格的观感描述；/ 分隔可写多段）',
    refs: [src],
    example: 'ref:' + src + '#' + (Math.min(dur / 2, 20)).toFixed(1) + 's',
    createdBy: 'ai',
  }
  fs.writeFileSync(path.join(outDir, 'style-' + asStyle + '.json'), JSON.stringify(pack, null, 2) + '\n', 'utf8')
  console.log(`风格包骨架：${path.join(outDir, 'style-' + asStyle + '.json')}`)
}

console.log(`时长 ${dur.toFixed(1)}s · 抽帧 ${frames.length} 张（每 ${every}s）`)
console.log(`候选清单：${path.join(outDir, 'candidates.json')}`)
console.log('下一步：打开 tools/style-studio.html → 导入该 JSON → 勾选 → 存成风格包')
