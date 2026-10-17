#!/usr/bin/env node
/**
 * ★VF_DAIDESIGN_V1（2026-10-17 用户定案「先做阶段1：AI 自由档接入产品」）
 *   **把「AI 自由写的落地页」机械适配成「可出片页」**。
 *
 * 为什么需要它（2026-10-17 本地端到端实测，不是推测）：
 *   AI 按"高级审美 / 风格不限 / 图是主题"写出来的页面，审美与素材统筹都没问题，
 *   但它天然**不是"可出片页"**，差三件纯机械的事：
 *     ① 图是**同级扁平名**（`1.png`），而出片管线（daily-film.mjs）只认 `images/` 子目录；
 *     ② 字体名是占位名（`"TXT-Serif"`）或干脆写了 Google 官方名
 *        —— 前者会落系统字体（服务器=Linux 没有中文字体 ⇒ 豆腐块），后者会让引擎抓全量 87MB（Node OOM，2026-10-16 刚踩过）；
 *     ③ 没有任何 `@font-face` ⇒ 服务器必然豆腐块（"服务器零字体依赖"这条硬口径的要求）。
 *   实测：这 3 条转换做完，**不改 AI 一个排版/动效**就能过四道闸门并出片（9 段 / 41s / 20MB）。
 *
 * 口径（重要）：**只做机械转换，绝不改 AI 的排版与动效** —— 那是用户要的"自由"。
 *   "禁用的 API"（IntersectionObserver / scroll / rAF / 随机 / 时间）**不自己改**：
 *   那是语义问题（要改成按时间驱动），自己瞎改多半不对 ⇒ 只**检测并如实报出**，
 *   由上层「失败重写循环」把报错喂回 AI 重写（`--strict` 时以 exit=2 退出）。
 *
 * 用法：
 *   node adapt-ai-page.mjs <in.html> <out.html> [--img-ext jpg] [--fonts <dir>] [--strict]
 *     --img-ext  图片实际扩展名（AI 常写 .png，素材可能是 .jpg）；默认沿用页面里写的
 *     --fonts    字体子集目录；默认 `<本文件>/../fonts`
 *     --strict   命中"禁用 API"时 exit=2（上层据此喂回 AI）；不加则只警告、继续转换
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const argv = process.argv.slice(2)
const flag = (k, d = '') => {
  const i = argv.indexOf('--' + k)
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d
}
const has = (k) => argv.includes('--' + k)
const [src, dst] = argv.filter((a) => !a.startsWith('--') && a !== flag('img-ext') && a !== flag('fonts'))
if (!src || !dst) { console.log('用法：node adapt-ai-page.mjs <in.html> <out.html> [--img-ext jpg] [--fonts <dir>] [--strict]'); process.exit(1) }

const FORCE_EXT = String(flag('img-ext', '')).replace(/^\./, '')
const FONTS = flag('fonts', path.join(HERE, '..', 'fonts'))

let h = fs.readFileSync(src, 'utf8')
const before = h.length

/* ── 0. 体检：**只报不改**（语义问题交给"失败重写循环"） ───────────────────── */
const bad = []
const chk = (re, why) => { if (re.test(h)) bad.push(why) }
chk(/IntersectionObserver/, '用了 IntersectionObserver（引擎按时间 seek，不滚动 ⇒ 动效永不触发）')
chk(/addEventListener\(\s*['"]scroll['"]/, '监听了 scroll（同上）')
chk(/window\.scrollY|scrollTop/, '依赖滚动位置（同上）')
chk(/requestAnimationFrame/, '用了 rAF 实时循环（引擎要求确定性，不能自走时钟）')
chk(/Math\.random\s*\(/, '用了 Math.random（非确定性）')
chk(/Date\.now\s*\(|performance\.now\s*\(/, '用了 Date.now/performance.now（非确定性）')
chk(/(src|href)="https?:\/\//, '引用了外链资源（必须零外链）')
chk(/fonts\.(googleapis|gstatic)\.com|"Noto Serif SC"|"Noto Sans SC"/, '引用了 Google Fonts 官方名（会让引擎抓全量 ~87MB）')

/* ── 1. 图路径归一到 images/，扩展名对齐到实际素材 ────────────────────────── */
// ⚠️ 踩过：`'src="images/$1"'` 里 `$1` 含扩展名 ⇒ AI 写 `.png`、素材是 `.jpg` ⇒ 引擎报 15 处 missing_local_asset。
let nImg = 0
h = h.replace(/src="(?:images\/)?(\d+)\.([a-zA-Z]+)"/g, (m0, num, ext) => {
  nImg++
  return 'src="images/' + num + '.' + (FORCE_EXT || ext.toLowerCase()) + '"'
})

/* ── 2. 字体族名：占位名 / Google 官方名 → 我们的自造名 ───────────────────── */
const FAMILY_MAP = [
  [/["']?TXT-Serif["']?/g, '"NotoSerifSC"'],
  [/["']?TXT-Sans["']?/g, '"NotoSansSC"'],
  [/"Noto Serif SC"/g, '"NotoSerifSC"'],
  [/"Noto Sans SC"/g, '"NotoSansSC"'],
  [/"Source Han Serif SC"/g, '"NotoSerifSC"'],
  [/"Source Han Sans SC"/g, '"NotoSansSC"'],
]
let nFam = 0
for (const [re, to] of FAMILY_MAP) {
  const c = (h.match(re) || []).length
  if (c) { h = h.replace(re, to); nFam += c }
}

/* ── 3. @font-face：base64 内嵌子集（与 daily-page.mjs 的 FONT_FACES 同源） ── */
const face = (name, file, range) => {
  const p = path.join(FONTS, file)
  if (!fs.existsSync(p)) throw new Error('缺字体子集：' + p)
  return '@font-face{font-family:"' + name + '";src:url(data:font/woff2;base64,'
    + fs.readFileSync(p).toString('base64') + ') format("woff2");font-weight:' + range + ';font-display:block}'
}
const hadFace = /@font-face/.test(h)
let nFace = 0
if (!hadFace) {
  if (!/<\/style>/i.test(h)) throw new Error('页面里没有 </style>，无法注入 @font-face')
  h = h.replace(/<\/style>/i, '\n' + face('NotoSerifSC', 'NotoSerifSC-sub.woff2', '200 900')
    + '\n' + face('NotoSansSC', 'NotoSansSC-sub.woff2', '100 900') + '\n</style>')
  nFace = 2
}

fs.writeFileSync(dst, h, 'utf8')
console.log('适配完成：图 ' + nImg + ' 处 · 字体族名 ' + nFam + ' 处 · @font-face ' + (nFace || '已有，跳过'))
console.log('体积 ' + (before / 1024).toFixed(0) + 'KB → ' + (h.length / 1024).toFixed(0) + 'KB')
for (const b of bad) console.log('  ⚠️ ' + b)
console.log('产物 ' + dst)
if (bad.length && has('strict')) {
  console.log('ADAPT_STRICT_FAIL：' + bad.length + ' 项违反出片契约（供上层喂回 AI 重写）')
  process.exit(2)
}
