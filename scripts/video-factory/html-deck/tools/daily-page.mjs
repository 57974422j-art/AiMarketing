#!/usr/bin/env node
/**
 * temp/_exp/template/daily.mjs —— 「日报落地页」模板生成器（阶段 1 的产物）
 * =============================================================================
 * 定位：**保底模板族**。AI 自由写 HTML 崩了 ⇒ 回落到这里：给一份 JSON（段配置）就出一份合规 HTML。
 *   产出物 = 单文件 HTML，自带双模式（preview 自动循环 / film 由 __seek 驱动），目标是过 R1~R14。
 *
 * 用法：
 *   node temp/_exp/template/daily.mjs <配置.json> [--out temp/_exp/template/out/xxx.html]
 *
 * 配置（JSON）：
 * {
 *   "meta": { "issue": "第 07 期", "accent": "#C6392B", "paper": "#F5F1E8", "title": "页面标题" },
 *   "motion": "calm|normal|lively",              // 动效档：影响推近幅度 / 错峰快慢 / 预览循环节奏
 *   "imageDir": "images",                        // 真图目录（占位时不引用）
 *   "segments": [
 *     { "kind": "cover",   "kicker": "第 07 期 · 夜食", "stamp": "封面故事",
 *       "title": ["凌晨四点", "第一锅汤"], "imgs": [1], "points": [["四点起火","老汤先滚"],["手切现片","立盘不掉"],["七上八下","毛肚最佳"]] },
 *     { "kind": "feature", "kicker": "后厨 · 手作", "stamp": "现场",
 *       "title": ["刀起刀落", "薄如纸片"], "imgs": [2, 3], "points": [...],
 *       "form": "sticker", "place": "cover" },
 *     ...
 *   ]
 * }
 *   · kind：cover（封面，3.4s）/ feature（正片，3.2s）/ end（结尾，3.2s）
 *   · imgs：图号数组，1 张=单图版式，2 张=并列版式（竖屏左右、横屏上下）
 *   · points：最多 3 组 [大字, 小字]
 *
 * ★ 自带的**字数体检**（R11：标题 ≤12 字/行、信息点 ≤3 组、每组 ≤8 字）——不合规**打印警告**（不静默）。
 */
import fs from 'node:fs'
import path from 'node:path'

const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))
const REPO = path.resolve(HERE, '..', '..', '..')

const argv = process.argv.slice(2)
const cfgFile = argv.find((a) => a.endsWith('.json'))
const outIdx = argv.indexOf('--out')
if (!cfgFile) { console.log('用法：node temp/_exp/template/daily.mjs <配置.json> [--out xxx.html]'); process.exit(1) }
const cfg = JSON.parse(fs.readFileSync(path.resolve(cfgFile), 'utf8'))

const META = Object.assign({ issue: '', accent: '#C6392B', paper: '#F5F1E8', title: '日报落地页' }, cfg.meta || {})

/* ═══════════ ★VF_DAILY_L4（2026-10-12 用户「说 L4 大胆试」）：**皮肤放开** ═══════════
   病灶（用户原话「它设计跟你的一模一样」的**另一半**）：老实现的 `:root` 把纸色/墨色/次色/点缀色/
   字体/图片占位渐变**全写死**，所以两份产物的 `<style>` 连 md5 都相同 —— 结构能变、**皮肤永远是那一套**。
   现口径（三层保险，绝不让"难看配色"出厂）：
     ① `meta.theme` = 从下面 **20 套**预设皮肤里挑（AI 按素材气质选；V23 从 6 扩到 20）；
     ② 可选 `meta.custom = {paper,ink,dim,accent}` = AI 自定hex配色；
     ③ **对比度体检**（WCAG：正文≥4.5 / 次要≥3.0 / 强调≥2.0 / 反白≥4.5）——
        不达标 ⇒ **回落预设皮肤**并在页头注释与 stdout 里如实写明（不静默、不硬着头皮出）。
   皮肤只改"纸/墨/点缀/字体/占位渐变/暗衬"，**不动结构**（结构是 L2 的事）。 */
const THEMES = {
  'paper-daily': {
    name: '暖纸日报', font: 'serif',
    paper: '#F5F1E8', ink: '#17140F', dim: '#6B6157', accent: '#C6392B',
    g: ['linear-gradient(152deg,#6E2F1C 0%,#B4562A 52%,#E9B77F 100%)',
      'linear-gradient(152deg,#8E3A22 0%,#C4703A 52%,#E3B478 100%)',
      'linear-gradient(152deg,#3E3226 0%,#7A6244 58%,#C9AE84 100%)'],
  },
  'night-gold': {
    name: '夜宴金', font: 'serif',
    paper: '#191712', ink: '#F3EADB', dim: '#B9A98F', accent: '#D8A94B',
    g: ['linear-gradient(152deg,#2A2114 0%,#6A4E22 55%,#D8A94B 100%)',
      'linear-gradient(152deg,#1E1A12 0%,#4E3B1E 55%,#A98A45 100%)',
      'linear-gradient(152deg,#241E13 0%,#5C4520 58%,#C2A25A 100%)'],
  },
  'tea-green': {
    name: '青瓷茶绿', font: 'serif',
    paper: '#EEF2E9', ink: '#1B241C', dim: '#5F6B5C', accent: '#2E7D5B',
    g: ['linear-gradient(152deg,#1F3B2E 0%,#3F6B4E 55%,#9CC0A2 100%)',
      'linear-gradient(152deg,#2C4A38 0%,#5A7F5F 55%,#BBD3B4 100%)',
      'linear-gradient(152deg,#233A2C 0%,#4A6650 58%,#A8C0A6 100%)'],
  },
  'blue-print': {
    name: '蓝图冷调', font: 'sans',
    paper: '#EEF3F8', ink: '#12202E', dim: '#5A6C7C', accent: '#1F6FB2',
    g: ['linear-gradient(152deg,#12314C 0%,#2E5F86 55%,#9BC0DA 100%)',
      'linear-gradient(152deg,#1B3A57 0%,#3D6E93 55%,#B6CFE2 100%)',
      'linear-gradient(152deg,#16324A 0%,#4A7391 58%,#A7C3D8 100%)'],
  },
  'coral-warm': {
    name: '柿橙暖场', font: 'sans',
    paper: '#FBF3EA', ink: '#2A1A12', dim: '#7A5B4A', accent: '#E2662A',
    g: ['linear-gradient(152deg,#8A3417 0%,#D2672F 52%,#F0B27A 100%)',
      'linear-gradient(152deg,#9E4220 0%,#E07C3C 52%,#F3C08C 100%)',
      'linear-gradient(152deg,#6E3A22 0%,#B4653A 58%,#E3B489 100%)'],
  },
  'mono-print': {
    name: '素黑白', font: 'sans',
    paper: '#F6F6F4', ink: '#141414', dim: '#6A6A66', accent: '#141414',
    g: ['linear-gradient(152deg,#2A2A2A 0%,#5E5E5C 55%,#B8B8B4 100%)',
      'linear-gradient(152deg,#1F1F1F 0%,#4A4A48 55%,#A6A6A2 100%)',
      'linear-gradient(152deg,#333331 0%,#6E6E6B 58%,#C2C2BE 100%)'],
  },

  /* ═══ ★VF_DAILY_V23（2026-10-14 用户定案「先 B 吧」）：皮肤库 6 → **20 套** ═══
     做法：风格纲目参照开源 UI 设计 Skill（UI/UX Pro Max 的 67 风格分类：E-Ink/Editorial/Dark-OLED/
     Organic/Vintage Analog/Morandi 这一类），**色值是我们自己配的**（它的字典只给风格名，色值在
     data/*.csv，raw 拉不到）；每套都过了引擎同一套 WCAG 体检（正文≥4.5 / 次要≥3.0 / 强调≥2.0 / 反白≥4.5），
     配方台与筛法见 temp/_exp/daily/mk-themes.mjs，回归见 temp/_exp/daily/test-themes.mjs。
     为什么扩（用户原话「依然是文字排版同质化严重」「感觉没什么区别」）：皮肤原来只有 6 套、
     轮换几轮就会重复；20 套 + 轮换记忆（rotateTheme）把"上次同款"的概率压到 5%。
     占位渐变走 themeGrad() 派生（既有 6 套保持手写值不动）。 */
  'copper-pot': { name: '铜锅炭火', font: 'serif', paper: '#211813', ink: '#F4E8D8', dim: '#C2AB90', accent: '#D2703A', g: themeGrad('#211813', '#F4E8D8', '#D2703A') },
  'amber-cafe': { name: '琥珀咖啡', font: 'serif', paper: '#F6EFE3', ink: '#2A1F17', dim: '#7B6650', accent: '#9A5B2A', g: themeGrad('#F6EFE3', '#2A1F17', '#9A5B2A') },
  'wine-red': { name: '酒红宴席', font: 'serif', paper: '#1E1216', ink: '#F4E9E4', dim: '#C0A79F', accent: '#B3403F', g: themeGrad('#1E1216', '#F4E9E4', '#B3403F') },
  'late-night': { name: '深夜食堂', font: 'sans', paper: '#14171C', ink: '#F0EADC', dim: '#ACB2B2', accent: '#E0B23C', g: themeGrad('#14171C', '#F0EADC', '#E0B23C') },
  'cinema-noir': { name: '胶片黑', font: 'sans', paper: '#141414', ink: '#EDEDEA', dim: '#A8A8A2', accent: '#C9A227', g: themeGrad('#141414', '#EDEDEA', '#C9A227') },
  'forest-ink': { name: '墨绿松林', font: 'serif', paper: '#16211C', ink: '#EDEFE7', dim: '#A9B5A5', accent: '#C8A96A', g: themeGrad('#16211C', '#EDEFE7', '#C8A96A') },
  'jiangnan': { name: '江南宣纸', font: 'serif', paper: '#F3F0E6', ink: '#22242A', dim: '#6E6A5E', accent: '#4E7A6A', g: themeGrad('#F3F0E6', '#22242A', '#4E7A6A') },
  'bamboo': { name: '竹青', font: 'serif', paper: '#EFF3EC', ink: '#1E2A22', dim: '#64705F', accent: '#4C7A46', g: themeGrad('#EFF3EC', '#1E2A22', '#4C7A46') },
  'sand-dune': { name: '沙丘暖沙', font: 'serif', paper: '#F4EADA', ink: '#2B2116', dim: '#7A6449', accent: '#8A5A22', g: themeGrad('#F4EADA', '#2B2116', '#8A5A22') },
  'mist-blue': { name: '雾蓝书页', font: 'sans', paper: '#EEF1F3', ink: '#1A222A', dim: '#62707A', accent: '#3A6E8F', g: themeGrad('#EEF1F3', '#1A222A', '#3A6E8F') },
  'graphite': { name: '石墨办公', font: 'sans', paper: '#F1F1EF', ink: '#1C1C1C', dim: '#6B6B68', accent: '#3F7A6E', g: themeGrad('#F1F1EF', '#1C1C1C', '#3F7A6E') },
  'nordic': { name: '北欧冷白', font: 'sans', paper: '#F4F5F6', ink: '#1D2327', dim: '#68727A', accent: '#4A6B8A', g: themeGrad('#F4F5F6', '#1D2327', '#4A6B8A') },
  'rose-milk': { name: '草莓奶昔', font: 'sans', paper: '#FDF1F0', ink: '#2C1E20', dim: '#7A5F60', accent: '#B02A4C', g: themeGrad('#FDF1F0', '#2C1E20', '#B02A4C') },
  'morandi': { name: '莫兰迪灰粉', font: 'sans', paper: '#F2EDEA', ink: '#2A2624', dim: '#6F645E', accent: '#8A4F45', g: themeGrad('#F2EDEA', '#2A2624', '#8A4F45') },
}
const DEFAULT_THEME = 'paper-daily'

/* ═══ ★VF_DAILY_V25（2026-10-14 用户定案「B1+B2+B3，最大目的**去同质化**：文字 / 文字动效 / 配色 / 样式排版」）═══
   **B1 字体配对**：原来字体只有 serif/sans 两种（`--fbody` 按 TH.font 二选一）⇒ "文字"这条轴几乎没变化。
   现口径：字体家族库（4 族）+ **配对库**（标题 × 正文 × 标签 = 7 组），皮肤绑一个默认配对，AI 可用
   `meta.font` 覆盖（白名单校验，非法就回落并如实记 note）。
   字体栈里 Windows / macOS / Noto 三套名字都给（用户机器是 Windows，服务器是 Linux）——
   缺哪个都不至于掉成系统默认丑字，最差也落在"衬线/无衬线"这一档，**变体之间的差异不会消失**。 */
const FF = {
  song: '"Source Han Serif SC","Noto Serif SC","Songti SC",SimSun,"宋体",Georgia,serif',
  hei: '"Source Han Sans SC","Noto Sans SC","PingFang SC","Microsoft YaHei","微软雅黑",system-ui,sans-serif',
  kai: 'KaiTi,STKaiti,"Kaiti SC","楷体","Noto Serif SC","Songti SC",serif',
  fang: 'FangSong,STFangsong,"Fangsong SC","仿宋","Noto Serif SC","Songti SC",serif',
}
const FONT_PAIRS = {
  'song-hei': { name: '宋黑', title: 'song', body: 'hei', label: 'hei' },   // 书名感：稳重
  'hei-song': { name: '黑宋', title: 'hei', body: 'song', label: 'hei' },   // 招牌感：硬朗
  'song-song': { name: '全宋', title: 'song', body: 'song', label: 'hei' }, // 书卷：安静
  'hei-hei': { name: '全黑', title: 'hei', body: 'hei', label: 'hei' },     // 现代：干净
  'kai-song': { name: '楷宋', title: 'kai', body: 'song', label: 'hei' },   // 手写感：文气
  'fang-hei': { name: '仿黑', title: 'fang', body: 'hei', label: 'hei' },   // 公文感：克制
  'kai-hei': { name: '楷黑', title: 'kai', body: 'hei', label: 'hei' },     // 题字感：市井
}
/** 老 6 套皮肤**保持原样**（serif→全宋 / sans→全黑，与改动前逐字节一致，老产物不失效）；
 *  新 14 套显式铺开配对 —— 这样 20 套皮肤在"字体"这条轴上也是散的，而不是只有两种。 */
const PAIR_OF = {
  'paper-daily': 'song-song', 'night-gold': 'song-song', 'tea-green': 'song-song',
  'blue-print': 'hei-hei', 'coral-warm': 'hei-hei', 'mono-print': 'hei-hei',
  'copper-pot': 'kai-song', 'amber-cafe': 'song-hei', 'wine-red': 'hei-song',
  'late-night': 'hei-hei', 'cinema-noir': 'hei-song', 'forest-ink': 'song-song',
  'jiangnan': 'kai-song', 'bamboo': 'song-hei', 'sand-dune': 'fang-hei',
  'mist-blue': 'hei-song', 'graphite': 'fang-hei', 'nordic': 'hei-hei',
  'rose-milk': 'kai-hei', 'morandi': 'kai-song',
}
const pairStacks = (id) => {
  const p = FONT_PAIRS[id] || FONT_PAIRS['song-song']
  return { id, title: FF[p.title], body: FF[p.body], label: FF[p.label] }
}

/** 十六进制 → [r,g,b]（拿不到就 null） */
function hex2rgb(h) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(h || '').trim())
  if (!m) return null
  const v = parseInt(m[1], 16)
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255]
}
/** WCAG 相对亮度 */
function lum(rgb) {
  const f = (c) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4) }
  return 0.2126 * f(rgb[0]) + 0.7152 * f(rgb[1]) + 0.0722 * f(rgb[2])
}
/** 对比度（1~21） */
function contrast(a, b) {
  const A = hex2rgb(a), B = hex2rgb(b)
  if (!A || !B) return 0
  const la = lum(A), lb = lum(B)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}
/** rgba(ink, alpha) */
function inkAlpha(ink, alpha) {
  const c = hex2rgb(ink) || [0, 0, 0]
  return `rgba(${c[0]},${c[1]},${c[2]},${alpha})`
}
/** 两色线性插值（占位渐变派生用；返回 #rrggbb） */
function mixHex(a, b, t) {
  const A = hex2rgb(a) || [0, 0, 0], B = hex2rgb(b) || [0, 0, 0]
  const c = A.map((x, i) => Math.round(x + (B[i] - x) * t))
  return '#' + c.map((x) => x.toString(16).padStart(2, '0')).join('')
}
/**
 * ★VF_DAILY_V23（2026-10-14 用户定案「先 B 吧」= 把设计字典抽成我们的皮肤库）：
 *   **占位渐变派生** —— 原来 6 套是手写的 3 条渐变；扩到 20 套再手写会爆量且容易配歪。
 *   规则：取 paper/ink/accent 三色插值出来（三条只是角度与幅度微差）⇒ 每套皮肤的"占位色块"
 *   自动与它的纸色/墨色/点缀同族，不会出现"紫底配绿块"这种串味。
 *   ⚠️ **既有 6 套继续用它手写的 g**（保证老产物逐字节不变）；只有 V23 新增的套件用 themeGrad()。
 */
function themeGrad(p, i, a) {
  return [
    `linear-gradient(152deg,${mixHex(p, i, 0.42)} 0%,${mixHex(a, i, 0.28)} 52%,${mixHex(a, p, 0.52)} 100%)`,
    `linear-gradient(168deg,${mixHex(p, i, 0.34)} 0%,${mixHex(a, i, 0.18)} 55%,${mixHex(a, p, 0.62)} 100%)`,
    `linear-gradient(138deg,${mixHex(p, i, 0.50)} 0%,${mixHex(a, i, 0.36)} 58%,${mixHex(a, p, 0.44)} 100%)`,
  ]
}
/** 把一套 4 色 token 补全成完整皮肤（并做对比度体检） */
function completeTheme(id, name, font, paper, ink, dim, accent, g, pairId) {
  const th = { id, name, font, paper, ink, dim, accent, g }
  // ★V25（B1）：字体配对 —— 皮肤带一个默认配对；老 6 套的默认与改动前**完全等价**
  //   （serif⇒全宋 / sans⇒全黑），所以老产物不受影响。
  th.pair = FONT_PAIRS[pairId] ? pairId : (font === 'sans' ? 'hei-hei' : 'song-song')
  th.fontStack = pairStacks(th.pair)
  th.line = inkAlpha(ink, 0.16)
  th.paper2 = id === DEFAULT_THEME ? '#EDE7DA' : inkAlpha(ink, 0.05)
  // 暗衬带：浅底皮肤用暖黑，深底皮肤用纯黑（都要能压住照片）
  th.scrim = contrast('#FFFFFF', paper) > 6 ? 'rgba(23,20,15,.74)' : 'rgba(6,6,8,.80)'
  // 反白字（角标底上的字）：纸色或白，哪个够 4.5 用哪个
  th.onAccent = contrast(paper, accent) >= 4.5 ? paper : (contrast('#FFFFFF', accent) >= 4.5 ? '#FFFFFF' : ink)
  th.fail = []
  if (contrast(ink, paper) < 4.5) th.fail.push(`正文/底 ${contrast(ink, paper).toFixed(2)} < 4.5`)
  if (contrast(dim, paper) < 3.0) th.fail.push(`次要/底 ${contrast(dim, paper).toFixed(2)} < 3.0`)
  if (contrast(accent, paper) < 2.0) th.fail.push(`强调/底 ${contrast(accent, paper).toFixed(2)} < 2.0`)
  if (contrast(th.onAccent, accent) < 4.5) th.fail.push(`角标反白 ${contrast(th.onAccent, accent).toFixed(2)} < 4.5`)
  return th
}
function themeById(id, gs) {
  const key = String(id || '')
  const t = THEMES[key]
  if (!t) return null
  return completeTheme(key, t.name, t.font, t.paper, t.ink, t.dim, t.accent, gs || t.g, PAIR_OF[key])
}
/** 最终皮肤：AI 自定配色 → 体检 → 不达标回落预设皮肤（全过程记进 themeNote） */
let themeNote = ''
let fontNote = ''
function resolveTheme() {
  const want = String(META.theme || '')
  const base = themeById(want, null) || themeById(DEFAULT_THEME, null)
  // ★V25（B1）：AI 可**直接指定字体配对**（`meta.font`），与皮肤解耦 —— 这是"文字"这条轴的第二层旋钮
  const wantFont = String(META.font || '')
  if (wantFont) {
    if (FONT_PAIRS[wantFont]) { base.pair = wantFont; base.fontStack = pairStacks(wantFont) }
    else fontNote = 'AI 要的字体配对「' + wantFont + '」不在库里 ⇒ 已用皮肤「' + base.name + '」的默认配对（' + base.pair + '）'
  }
  const cu = META.custom && typeof META.custom === 'object' ? META.custom : null
  if (cu) {
    const okHex = ['paper', 'ink', 'dim', 'accent'].every((k) => !!hex2rgb(cu[k]))
    if (!okHex) { themeNote = 'AI 自定配色里有非 hex 值 ⇒ 已忽略自定配色'; return base }
    // 自定配色沿用**该皮肤的字体配对**（配色与字体解耦：AI 换色不该顺带把字体也换成默认）
    const cand = completeTheme('custom', 'AI 自定配色', base.font, cu.paper, cu.ink, cu.dim, cu.accent, base.g, base.pair)
    if (!cand.fail.length) return cand
    themeNote = 'AI 自定配色对比度不达标（' + cand.fail.join('；') + '）⇒ 已回落「' + base.name + '」'
    return base
  }
  if (want && !THEMES[want]) themeNote = 'AI 要的皮肤「' + want + '」不在库里 ⇒ 已用「' + base.name + '」'
  if (base.fail.length) { themeNote = '预设皮肤「' + base.name + '」对比度异常（' + base.fail.join('；') + '）⇒ 已回落默认'; return themeById(DEFAULT_THEME, null) }
  return base
}
const TH = resolveTheme()
/**
 * ★VF_DAILY_V23 修（2026-10-14 用户定案「先 B 吧」扩皮肤库时被探针抓出来的**真 bug**）：
 *   原来 `data-form="overlay"` 一律 `h2{color:#fff}` + 暗衬带 —— 这个假设只对"文字真压在照片上"
 *   成立。但 `split / quote / stack2 / grid3 / grid4` 这些结构里，文字在**自己的格子**里、底下是纸色
 *   ⇒ 浅色皮肤（暖纸日报、北欧冷白…）上就是**白字压浅纸**：探针实测对比度 **1.09**（等于看不见）。
 *   修法：按**皮肤明暗**给整个 overlay 体系换向 ——
 *     · 深底皮肤：保持原样（白字 + 深色衬带，逐字节不变）；
 *     · 浅底皮肤：**衬带换纸色、字换墨色**（"带"还在，只是反相）⇒ 头上那句注释里的观感设计不丢。
 *   判据 `PAPER_DARK` = 白字在纸色上能不能读（≥4.5 ⇒ 纸是深的）。
 */
const PAPER_DARK = contrast('#FFFFFF', TH.paper) >= 4.5
if (themeNote) console.log('   ⚠️ ' + themeNote)
if (fontNote) console.log('   ⚠️ ' + fontNote)

const MOTION = {
  calm: { zoom: 1.04, dmul: 1.35, gap: 900, dur: 0.14 },     // 稳：推近小、错峰慢
  normal: { zoom: 1.07, dmul: 1.0, gap: 700, dur: 0 },
  lively: { zoom: 1.12, dmul: 0.7, gap: 520, dur: -0.04 },    // 活：推近大、错峰快
}[String(cfg.motion || 'normal')] || { zoom: 1.07, dmul: 1, gap: 700, dur: 0 }
const IMG_DIR = String(cfg.imageDir || 'images')
/* ═══ ★VF_DAILY_V19（2026-10-13 用户拍板「A′ = 本地镜像 + 同级扁平图」）═══
   图引用改成**同级扁平名**（如 `gen_20261013_016_p1.jpg`，不带子目录）。
   为什么必须扁平（三条硬约束，都是探过的）：
     · 客户端本地镜像把目录**拍平**（electron/main.js `path.basename()` ⇒ 目录被静默丢掉）；
     · 读 `api/storage/file`、删 `api/storage/delete`、短链 `/f` **三处正则都禁 `/`** ⇒ `images/1.jpg` 取不到；
     · 客户端渲染是 http(s)+srcDoc（不是 file://，且 file:// 导航被拦）⇒ 相对引用只会打到服务器站点。
   扁平后：HTML 与图落在**同一个平铺文件夹**里，相对引用天然可解析、也能被镜像一起带走。
   `cfg.imageNames` = 图号 1..N 的名字表；缺项退回老口径 `images/N.jpg`（旧档照旧能开）。 */
const IMG_NAME = (n) => {
  const t = Array.isArray(cfg.imageNames) ? String(cfg.imageNames[n - 1] || '') : ''
  return t || `${IMG_DIR}/${n}.jpg`
}
/* ═══ ★VF_DAILY_V19 效果配额（用户：「这个不能大范围使用，10 个里面有一个就行。这一半都这样视频最后做出来会很不好看」）═══
   口径：**安静组**（回拉/推近/横移）承担绝大多数；**切分型**（条分/百叶/拼片）整片**最多 1 次**，
   且只允许出现在**封面（第 1 段）或收尾（最后一段）**；段数 < 6 的短片一次都不用（短片没有"呼吸空间"）。
   服务端排好的 `s.fx` 优先（它要拿这个序列做"与上一份相似度"自检与重掷）；没给才走这里。 */
const FX_QUIET = ['zout', 'zin', 'pan', 'wipe']
const FX_CUT = ['slats', 'blinds', 'mosaic']
/* ═══ ★VF_DAILY_V21（2026-10-14 用户原话「依然是文字排版同质化严重」「AI 自主设计这里卡得还是太死」）═══
   把"文字层"从"每结构一套写死"改成**可参数化**（结构 × 文字层 × 字号档）：
     · `type`  文字层风格：band（默认·深色衬带）/ poster（海报式）/ editorial（杂志式）/ list（清单式）
     · `scale` 字号档：0.9 / 1 / 1.15 / 1.3 —— 只影响**这一段**标题与数字的大小
   两条硬护栏（照旧不破闸门）：
     ① 信息点字号**下限仍是 22px**（R3）⇒ 字号档只作用在标题/数字，不缩小字；
     ② 标题**下限 40px**（首段主标题 R3 判据）⇒ 用 max(40px, …) 兜住，缩不到违规。 */
const TEXT_TYPES = ['band', 'poster', 'editorial', 'list']
const TSCALES = [0.9, 1, 1.15, 1.3]
/**
 * ★V21：**标题字号 = 基准（结构+文字层）× 字号档**，算好后写成段上的**内联 --title**。
 *   为什么用内联：试过用 CSS 覆盖，被 quote / vertical 两处写死的字面字号打架（实测那两类段
 *   标题恒定 40.3px / 30px，ts 调到 1.3 也不动）—— 内联优先级最高，一次性根治这类"谁盖谁"的问题。
 *   下限：第 1 段 40px（闸门 R3 判"竖屏主标题 ≥40"）、其余段 30px（仍远高于信息点的 22px 下限）。
 */
function titleCss(i, layout, form, type, ts) {
  let b = { min: 44, vmin: 7, max: 92 }                          // 默认（衬带/海报/杂志）
  if (type === 'list') b = { min: 34, vmin: 4.6, max: 58 }       // 清单式：标题收成"小标"
  if (layout === 'quote') b = { min: 34, vmin: 5.6, max: 72 }    // 引用页：沿用原基准
  if (form === 'vertical') b = { min: 30, vmin: 3.4, max: 50 }   // 竖排：沿用原基准
  const floor = i === 0 ? 40 : 30
  const f = (x) => String(Math.round(x * 100) / 100)
  // ★VF_DAILY_CLIP_V2（2026-10-14 用户实测「第七段标题被裁掉半个字」）：
  //   病灶：`--title` 里**只有中间那项（vmin）随视口缩**，min 项是**死 px**（`max(40px, 44px*ts)`），
  //   而第 665 行 `h2 span{white-space:nowrap}`（R14 要求标题不折行）
  //   ⇒ **窄视口下容器按比例缩了、字号没缩** ⇒ 标题撑爆列宽、右边被裁。
  //   实测（gen_20261014_035 第七段 split + ts=1.15，探针 temp/_daily/probe7.mjs）：
  //     出片画布 720 宽 ⇒ h2 列宽 333 / 文字 303 ✅（**只剩 30px 余量**，再多一个字就裁）
  //     预览 360 宽 ⇒ h2 列宽 152 / 文字 214 ❌ 被裁 105px；400 ⇒ 172/214 ❌；宽视口 ✅
  //   修法：**下限也随视口缩** —— 用 `min(像素, 等值 vmin)` 表达（720 短边时两者相等 ⇒
  //     **出片画布逐字不变**；窄视口时 vmin 更小 ⇒ 字号跟着缩 ⇒ 不裁）。
  //   ⚠️ 别改成"允许标题折行"来解决：R14 就是为"标题/短标签被折行"立的（用户实测过"先涮后蘸"折两行很难看）。
  //   ⚠️ 换算基数 7.2 = 720（竖屏短边）/100 ⇒ 44px ⇔ 6.11vmin。
  const vf = (px, vminEq) => `min(${px}px, ${f(vminEq)}vmin)`
  const minItem = `max(${vf(floor, floor / 7.2)}, min(calc(${b.min}px * ${f(ts)}), calc(${f(b.min / 7.2)}vmin * ${f(ts)})))`
  return `clamp(${minItem}, calc(${b.vmin}vmin * ${f(ts)}), calc(${b.max}px * ${f(ts)}))`
}
/** 切分型**唯一的名额**落在哪一段：封面(0) 或 收尾(n-1)；-1 = 本片一次都不用。
 *  ⚠️ 必须**惰性求值**：`FX_SEED` 在本文件后面才声明，这里直接算会踩 TDZ（ReadonlyError）。 */
const cutSlotOf = () => {
  const n = Array.isArray(cfg.segments) ? cfg.segments.length : 0
  return n < 6 ? -1 : ((FX_SEED % 2) ? n - 1 : 0)
}

const segs = Array.isArray(cfg.segments) ? cfg.segments : []
if (!segs.length) { console.log('✗ 配置里没有 segments'); process.exit(1) }

/* ═══════════ ★VF_DAILY_L2（2026-10-12 用户「说 L2 大胆试」）：段**结构库** ═══════════
   病灶（用户原话「你是不是把设计说的很死，我看它设计跟你的一模一样」）：
   老实现**只有一套骨架** —— 每段都是"图 + 标题 + 信息点"同一个 grid，`form/place` 只改三处 CSS，
   于是两份产物连 `<style>` 都逐字节相同（md5 一致），AI 的自由度只剩文字。
   现口径：引擎提供 **8 种真实结构**，AI 按素材挑（见 daily-plan.ts 的同名白名单，两处必须一致）：

     hero     满幅压字  1 图   图吃满整段，文字贴下沿深色衬带
     sticker  贴纸标题  1 图   标题是纸色贴块 + 朱红硬投影
     vertical 竖排标题  1 图   竖排标题占独立一列，图在左
     split    图文左右  1 图   竖屏也左右分栏（字左图右）
     stack2   上下双图  2 图   竖屏上下 / 横屏左右
     grid3    三图拼版  3 图   1 大 + 2 小
     grid4    四宫格    4 图   2×2
     quote    引文页    0~1 图 大字居中 + 落款（图作窄条）

   ⚠️ 兼容：老方案没有 `layout` 字段 ⇒ 按 `form` 与图数**推导**（见 layoutOf），行为不变。
   ⚠️ 结构只决定"怎么排"，**皮肤（纸/朱红/字体）仍由 meta 定**（L4 才放开皮肤）。 */
const LAYOUTS = {
  hero:     { name: '满幅压字', minImg: 1, maxImg: 1 },
  sticker:  { name: '贴纸标题', minImg: 1, maxImg: 1 },
  vertical: { name: '竖排标题', minImg: 1, maxImg: 1 },
  split:    { name: '图文左右', minImg: 1, maxImg: 1 },
  stack2:   { name: '上下双图', minImg: 2, maxImg: 2 },
  grid3:    { name: '三图拼版', minImg: 3, maxImg: 3 },
  grid4:    { name: '四宫格',   minImg: 4, maxImg: 4 },
  quote:    { name: '引文页',   minImg: 0, maxImg: 1 },
}
const FORM_IDS = { hero: 'overlay', sticker: 'sticker', vertical: 'vertical' }
// ★VF_DAILY_V11：**图片动效轮换**（按段序，确定性）—— 治用户「不要都一个效果吧，这个效果感觉有点怪」。
//   zout=回拉（原效果）· zin=推近 · pan=横移取景。三种都用同一套"外框=图框"的几何（见 CSS）。
const FX = ['zout', 'zin', 'pan', 'wipe', 'slats', 'blinds', 'mosaic']
const layoutOf = (s) => {
  const l = String(s.layout || '')
  if (LAYOUTS[l]) return l
  const n = (Array.isArray(s.imgs) ? s.imgs : []).length
  if (n >= 4) return 'grid4'
  if (n === 3) return 'grid3'
  if (n === 2) return 'stack2'
  const f = String(s.form || '')
  if (f === 'sticker' || f === 'vertical') return f
  return 'hero'
}

// ── 字数体检（R11）：不合规只警告，不阻断（人要能看见） ──
const warns = []
segs.forEach((s, i) => {
  const n = i + 1
  for (const [j, line] of (s.title || []).entries()) {
    if (String(line).length > 12) warns.push(`段${n} 标题第${j + 1}行 ${String(line).length} 字 > 12`)
  }
  const pts = Array.isArray(s.points) ? s.points : []
  if (pts.length > 3) warns.push(`段${n} 信息点 ${pts.length} 组 > 3`)
  pts.forEach((p, k) => {
    const big = String((p && p[0]) || ''), small = String((p && p[1]) || '')
    if (big.length > 8) warns.push(`段${n} 信息点${k + 1} 大字 ${big.length} 字 > 8`)
    if (small.length > 8) warns.push(`段${n} 信息点${k + 1} 小字 ${small.length} 字 > 8`)
  })
  const lay = layoutOf(s)
  const lim = LAYOUTS[lay]
  const imgs = Array.isArray(s.imgs) ? s.imgs : []
  if (!imgs.length && lim.minImg > 0) warns.push(`段${n} 没有图（imgs 为空），但结构「${lim.name}」要 ${lim.minImg}~${lim.maxImg} 张`)
  if (imgs.length > Math.max(4, lim.maxImg)) warns.push(`段${n} 图数 ${imgs.length} 超过 ${lim.name} 的 ${lim.maxImg} 张（多的会被丢掉）`)
  if (imgs.length && (imgs.length < lim.minImg || imgs.length > lim.maxImg)) {
    warns.push(`段${n} 图数 ${imgs.length} 与结构「${lim.name}」(${lim.minImg}~${lim.maxImg}) 不匹配 —— 实际按 n${Math.min(imgs.length, lim.maxImg)} 渲染`)
  }
})

// ── 时间轴（段时长 → data-start/data-duration + __seek 映射） ──
const DUR = { cover: 3.4, feature: 3.2, end: 3.2 }
let acc = 0
const scenes = segs.map((s, i) => {
  const d = DUR[s.kind] || 3.2
  const sc = { i, kind: s.kind || 'feature', start: +acc.toFixed(2), dur: d }
  acc += d
  return sc
})
const TOTAL = +acc.toFixed(2)

const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/* ═══════════ ★VF_DAILY_L3（2026-10-12 用户「说 L3 大胆试」）：**AI 段内自由 HTML** ═══════════
   定位：L2 结构库之外，允许 AI 为**某一段**自己写 HTML/CSS（真正的自由设计）。
   三条护栏（缺一条就会变成"AI 随手写、页面崩了没人知道"）：
     ① **静态沙箱**：禁外链/禁脚本/禁随机与时间 API；CSS 里的选择器**必须**带该段的前缀
        （`.aiN-*` 且 `.sec[data-seg="N"]`）⇒ 防止不同段互相污染；
     ② **动画契约**：AI 的 CSS 必须用到 `var(--sp)`（段内进度 0→1，由统一时间轴驱动）
        ⇒ 这样出片确定性不会被破坏；
     ③ **段级回落**：任一条不满足 ⇒ **只有这一段**退回 L2 结构库的模板（其余段照旧），
        并把原因写进页头注释与 stdout（不静默）。
   开关：**两处任一为真**即接受 AI 段 —— ① `VF_DAILY_AIHTML=1`（环境变量，运维级总闸）；
   ② `meta.aiHtml === true`（方案级，产品线自己说了算）。都不给 ⇒ 行为逐字不变（默认关）。 */
const AIHTML_ON = String(process.env.VF_DAILY_AIHTML || '') === '1' || (cfg.meta && cfg.meta.aiHtml === true)

function aiGuardHTML(n, html, css) {
  const h = String(html || '')
  const c = String(css || '')
  const bad = []
  if (!h.trim()) return { ok: false, why: 'html 为空' }
  if (h.length > 6000 || c.length > 6000) bad.push('体积超限（html/css 各 ≤6000 字符）')
  if (/https?:\/\/|\/\/[a-z0-9-]+\.[a-z]{2,}|@import/i.test(h + c)) bad.push('出现外链/外部资源')
  if (/<script|javascript:|on[a-z]+\s*=/i.test(h)) bad.push('出现脚本或内联事件')
  if (/Math\.random|Date\.now|setTimeout|setInterval|requestAnimationFrame/.test(h + c)) bad.push('出现随机/时间 API')
  // ★R2（规范硬线）：布局块不许用绝对定位 —— AI 段一律禁（我们的模板自己有可控地用它）
  if (/position\s*:\s*absolute/i.test(c)) bad.push('CSS 用了 position:absolute（R2 禁止用绝对定位排版）')
  // ⚠️ 实测踩到的：模型写的是 `var(--sp,0)`（带兜底值），旧正则只认 `var(--sp)` ⇒ 会把合格的段误判为不合格
  if (c && !/var\(\s*--sp\b/.test(c)) bad.push('CSS 没用 var(--sp)（无法随时间轴动）')
  // CSS 选择器前缀检查：每条选择器都要落在 `.aiN-` 或 `.sec[data-seg="N"]` 之内
  if (c) {
    const sels = c.replace(/\/\*[\s\S]*?\*\//g, '').match(/(^|[}])\s*([^{}@]+)\{/g) || []
    for (const raw of sels) {
      const sel = raw.replace(/[}{]/g, '').split(',').map((x) => x.trim()).filter(Boolean)
      for (const one of sel) {
        const okPrefix = one.startsWith(`.ai${n}-`) || one.startsWith(`.sec[data-seg="${n}"]`)
        if (!okPrefix) bad.push('选择器没带本段前缀：' + one.slice(0, 40))
      }
    }
  }
  if (bad.length) return { ok: false, why: bad.slice(0, 3).join('；') }
  return { ok: true, why: '' }
}
/**
 * ★L3 加固：AI 段里的 `<img>` 由**引擎**补上 `loading="lazy" onerror="this.remove()"`。
 * 为什么不能让 AI 自己写：沙箱**禁一切 `on*` 事件**（安全感），而缺图不摘掉就会被审核判"缺图"（实测：
 * AI 段三张图缺图 ⇒ 结构闸门 3 处不过）。⇒ 契约归契约，**兜底由引擎做**，不指望模型记得。
 */
function hardenAiHtml(h) {
  return String(h || '').replace(/<img\b([^>]*?)(\/?)>/gi, (m, attrs, slash) => {
    let a = attrs
    if (!/loading\s*=/i.test(a)) a += ' loading="lazy"'
    if (!/onerror\s*=/i.test(a)) a += ' onerror="this.remove()"'
    return '<img' + a + (slash || '') + '>'
  })
}

/** 收集 AI 段的 CSS（已带前缀）→ 注入主 <style> */
const AI_CSS = []
const AI_FALLBACKS = []
const AI_USED = []

// ★VF_DAILY_V13（2026-10-13 用户：「我要的是效果和多样性，低相似度」）：
//   每份产物的动效**起始偏移**不同（seed 由本片的 meta + 每段图号算出来，确定性 ⇒ 同输入同结果、
//   不同输入顺序不同）—— 这样"上一份 vs 这一份"不会连动效顺序都一模一样。
const FX_SEED = (() => {
  try {
    const key = JSON.stringify(cfg.meta || {}) + '|' + segs.map((s) => (s.imgs || []).join('-')).join(',')
    let h = 5381
    for (let i = 0; i < key.length; i++) h = ((h * 33) ^ key.charCodeAt(i)) >>> 0
    return h % FX.length
  } catch { return 0 }
})()

/**
 * 图槽 HTML。三种"切分型"入场（条分 / 百叶 / 拼片）单独出结构：
 *   · 用 CSS 变量 --imgN（在 :root 里**只写一次** url(images/N.jpg)）＋ background-position 取景，
 *     把整图切成 N 块显示 ⇒ **单文件内嵌时 base64 只出现一次**（体积不翻倍）。
 *   · 揭示只用 clip-path（不改元素外框）⇒ 不会把"越界"闸门顶翻。
 *   · 切分型没有 img 元素：图缺失时只是不上色，露出 .fig 的渐变占位（不裂图）。
 */
function figHTML(n, fx, fv) {
  const bg = `background:var(--g${n % 3})`
  const v = Math.max(0, Math.min(2, Number(fv) || 0))
  if (fx === 'slats' || fx === 'blinds') {
    // 变体：条数 + 展开方向（用户：「一次任务不要出现 2 次同一风格」⇒ 同一个 id 也换个样子）
    const N = fx === 'slats' ? (5 - v) : (4 - v)
    const up = v === 2
    const w = 100 / N
    let out = ''
    for (let i = 0; i < N; i++) {
      const p = i * w
      const d = (i * (up ? 0.05 : 0.05)).toFixed(3)
      const pos = ((i / Math.max(1, N - 1)) * 100).toFixed(2)
      // ⚠️⚠️ ★VF_DAILY_V18（2026-10-13 用户实测「还是 4.5.10.11 空的 就一个黄底」）：**绝对定位的条块必须给全尺寸**！
      //   病灶（就是个真 bug，不是动画态）：`.vc` 是 `position:absolute` 的**空元素** ——
      //     · 条分只写了 `left/width`，没写 `top/height` ⇒ 空元素 `height:auto` = **0** ⇒ 整条不可见；
      //     · 百叶只写了 `top/height`，没写 `left/width` ⇒ 空元素 `width:auto` = **0** ⇒ 整条不可见；
      //     · 拼片四边都给全了 ⇒ **只有它正常**（这就是"6/12 有图、4/5/10/11 只有一个黄底"的全部原因，
      //       黄底 = `.fig` 的 `background:var(--gN)` 占位渐变，不是素材）。
      //   为什么闸门漏了：探针只量 `img.ph`（切分型没有 img）与越界/溢出 —— **0 尺寸元素既不越界也不溢出**，
      //   覆盖率探针也只算 img。⇒ 已配 `temp/_exp/daily/probe-vfx.mjs` 专量"切分块有没有面积、面积和不和"。
      out += fx === 'slats'
        ? `<i class="vc" data-up="${up ? 1 : 0}" style="top:0;height:100%;left:${p.toFixed(3)}%;width:${w.toFixed(3)}%;--d:${up ? ((N - 1 - i) * 0.05).toFixed(3) : d};background-size:${N * 100}% 100%;background-position:${pos}% 0"></i>`
        : `<i class="vc" data-up="${up ? 1 : 0}" style="left:0;width:100%;top:${p.toFixed(3)}%;height:${w.toFixed(3)}%;--d:${up ? ((N - 1 - i) * 0.05).toFixed(3) : d};background-size:100% ${N * 100}%;background-position:0 ${pos}%"></i>`
    }
    return `<div class="fig vfx" data-fvv="${v}" style="${bg};--img:var(--img${n})">${out}</div>`
  }
  if (fx === 'mosaic') {
    const N = 3 + v                     // 3×3 / 4×4 / 5×5
    const w = 100 / N
    let out = ''
    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        const d = ((r * N + c) * 0.03).toFixed(3)
        const px = ((c / (N - 1)) * 100).toFixed(2)
        const py = ((r / (N - 1)) * 100).toFixed(2)
        out += `<i class="vc" style="left:${(c * w).toFixed(3)}%;top:${(r * w).toFixed(3)}%;width:${w.toFixed(3)}%;height:${w.toFixed(3)}%;--d:${d};background-size:${N * 100}% ${N * 100}%;background-position:${px}% ${py}%"></i>`
      }
    }
    return `<div class="fig vfx" data-fvv="${v}" style="${bg};--img:var(--img${n})">${out}</div>`
  }
  // ⚠️ ★VF_DAILY_V17（2026-10-13 用户录屏实证）：**不要用 loading="lazy"**！
  //   图本来就在文件里（单文件版是内嵌 data:、配图版是同目录文件，都没有网络请求）⇒ 懒加载**零收益**；
  //   但在"长页面滚动 / 客户端 webview"里会出现"该显示时还没解码 ⇒ 空图位"，
  //   现象就是用户说的「**部分图有、部分没有**」（录屏第 9 帧两个图位空着、封面段却有图）。
  //   改成 `loading="eager"` + `decoding="sync"`：一次全部解码，滚动到哪里都是现成的。
  return `<div class="fig" style="${bg}" data-fvv="${v}">`
    + `<img class="ph" src="${IMG_NAME(n)}" alt="" loading="eager" decoding="sync" onerror="this.remove()"></div>`
}

function segBody(s, sc) {
  const n = sc.i + 1
  // ★L3：AI 自写段优先（开关 + 静态沙箱都过才用）—— 不过就**只有这一段**回落 L2 结构
  if (AIHTML_ON && s && typeof s.html === 'string' && s.html.trim()) {
    const g = aiGuardHTML(n, s.html, s.css)
    if (g.ok) {
      AI_USED.push(n)
      if (s.css) AI_CSS.push('/* seg' + n + '（AI 自写段）*/\n' + String(s.css))
      return `<section class="sec" data-seg="${n}" data-start="${sc.start}" data-duration="${sc.dur}"`
        + ` data-place="${esc(s.place || 'cover')}" data-form="ai" data-layout="ai">`
        + hardenAiHtml(s.html)
        + `</section>`
    }
    AI_FALLBACKS.push(`段${n} 的 AI 自写段被拒（${g.why}）⇒ 已回落结构「${LAYOUTS[layoutOf(s)].name}」`)
  }
  const layout = layoutOf(s)
  const lim = LAYOUTS[layout]
  const form = FORM_IDS[layout] || String(s.form || 'overlay')
  const title = (s.title || []).map((line, j) => j === 0 ? `<span>${esc(line)}</span>` : `<span><em>${esc(line)}</em></span>`).join('')
  // ★VF_DAILY_L2：每段图数按**该结构**的上限收（grid4 可到 4 张）
  const imgs = (Array.isArray(s.imgs) ? s.imgs : []).slice(0, lim.maxImg)
  // ★VF_DAILY_V2：图槽真的挂上 images/N.jpg（缺图时 onerror 自己摘掉 ⇒ 退回渐变占位，不裂图）
  // ★V13：动效按"份 seed + 段序"取（不再所有段一个效果；每份片子的顺序也不同）
  //   ★V13b：**服务端排好的 s.fx 优先**（它要拿这个序列做"与上一份相似度"自检与重掷）；没给才自己轮换。
  //   fx 允许带变体：`slats#2` = 条分 + 第 3 种参数（条数/方向/密度）—— 同一 id 换个样子 ⇒ 一份里不重样。
  const fxRaw = String(s.fx || '')
  const fxSplit = fxRaw.split('#')
  const fxOk = FX.indexOf(fxSplit[0]) >= 0
  // ★V19 配额兜底：服务端没排 fx 时才轮到引擎自己取 —— 安静组轮着来，切分型**只给一个名额**
  const cutSlot = cutSlotOf()
  const fx = fxOk ? fxSplit[0] : (sc.i === cutSlot ? FX_CUT[FX_SEED % FX_CUT.length] : FX_QUIET[(FX_SEED + sc.i) % FX_QUIET.length])
  const fv = fxOk ? (parseInt(fxSplit[1] || '0', 10) || 0) : ((FX_SEED + sc.i) % 2)
  // ★V21：文字层与字号档（服务端排好的优先；没给就是默认 band/1 —— 与旧产物逐字节一致）
  const tType = TEXT_TYPES.indexOf(String(s.type || '')) >= 0 ? String(s.type) : 'band'
  const tScale = (() => { const v = Number(s.scale); return TSCALES.indexOf(v) >= 0 ? v : 1 })()
  const figs = imgs.map((n) => figHTML(n, fx, fv)).join('')
  const pts = (Array.isArray(s.points) ? s.points : []).slice(0, 3)
    .map((p) => `<div class="col"><b>${esc(p && p[0])}</b><i>${esc(p && p[1])}</i></div>`).join('')
  const head = `<div class="head"><span class="kick">${esc(s.kicker || '')}</span>`
    + (s.stamp ? `<span class="stamp">${esc(s.stamp)}</span>` : '') + `</div>`
  return `<section class="sec" data-seg="${sc.i + 1}" data-start="${sc.start}" data-duration="${sc.dur}"`
    + ` data-place="${esc(s.place || 'cover')}" data-form="${esc(form)}" data-layout="${layout}"`
    + ` data-type="${tType}" data-paper="${PAPER_DARK ? 'dark' : 'light'}" data-tm="${segTm[sc.i]}" style="--ts:${tScale};--title:${titleCss(sc.i, layout, form, tType, tScale)}"`
    + ` data-fx="${fx}" data-fv="${fv}" data-scrim="${esc(s.scrim || 'soft')}">`
    + head
    + `<h2>${title}</h2>`
    + `<div class="figs n${imgs.length}">${figs}</div>`
    + `<div class="cols c${pts.length}">${pts}</div>`
    + `</section>`
}

/* ═══ ★VF_DAILY_V25：文字动效的**整片排布**（引擎侧兜底）═══
   服务端排好 `s.tm` 优先（它要拿这个序列做去同质化自检）；没给就按种子轮换。
   硬约束：**相邻段必不同** —— 两段同动作最容易被一眼看成"同一页"。 */
const TM = ['rise', 'push', 'drift', 'zoom', 'wipe', 'curtain', 'blur']
const segTm = (() => {
  const out = []
  for (let i = 0; i < segs.length; i++) {
    const raw = String(segs[i].tm || '')
    let id = TM.indexOf(raw) >= 0 ? raw : TM[(((FX_SEED + i) % TM.length) + TM.length) % TM.length]
    if (i > 0 && id === out[i - 1]) id = TM[(TM.indexOf(id) + 1) % TM.length]
    if (i > 0 && id === out[i - 1]) id = TM[(TM.indexOf(id) + 1) % TM.length]   // TM 长度 > 2，最多两次必错开
    out.push(id)
  }
  return out
})()

// ⚠️ 顺序很重要：**先把每段渲染出来**（AI 段的 CSS 会在这步被收集进 AI_CSS），
//    再拼 HTML 模板 —— 否则 <style> 里的 `${AI_CSS}` 取值时还是空的（模板是从上往下算的）。
const BODIES = segs.map((s, i) => segBody(s, scenes[i]))

// ★VF_DAILY_V13：把用到的每张图**只声明一次**（切分型入场靠它取景；单文件内嵌时同一张图的
//   base64 也就只出现一次 ⇒ 体积不因"切成 5 条"而翻 5 倍）。
const IMG_VARS = (() => {
  let maxN = 1
  segs.forEach((s) => (s.imgs || []).forEach((x) => { if (x > maxN) maxN = x }))
  maxN = Math.min(24, maxN)
  const out = []
  for (let i = 1; i <= maxN; i++) out.push(`--img${i}:url(${IMG_NAME(i)});`)
  return out.join(' ')
})()

const html = `<!DOCTYPE html>
<html lang="zh-CN" data-mode="preview">
<head>
<meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(META.title)}</title>
<!-- 由 temp/_exp/template/daily.mjs 生成（日报落地页模板 · 阶段 1）
     段：${segs.length} · 总时长：${TOTAL}s · 动效档：${String(cfg.motion || 'normal')}
     结构（★VF_DAILY_L2 段结构库）：${segs.map((s) => layoutOf(s)).join(' → ')}${AI_USED.length ? '（其中 ' + AI_USED.length + ' 段为 ★L3 AI 自写）' : ''}
     图片槽位：${Array.isArray(cfg.imageNames) && cfg.imageNames.length ? '与页面**同级**的扁平图名（A′）' : IMG_DIR + '/ 目录，命名 1..N.jpg'}（${segs.map((s) => (s.imgs || []).join('+')).join(' / ')}）
     契约：section.sec[data-seg][data-start][data-duration][data-place][data-form]；时间轴 window.__seek(t)
     合规目标：R1~R14（见 docs/exp/响应式段规范-v1.md） -->
${warns.length ? '<!-- ⚠️ 字数体检警告：\n     ' + warns.join('\n     ') + '\n-->' : ''}
${AI_FALLBACKS.length ? '<!-- ⚠️ ★L3 AI 自写段回落记录：\n     ' + AI_FALLBACKS.join('\n     ') + '\n-->' : ''}
<style>
  :root{
    /* ★VF_DAILY_L4：皮肤 token 全部来自 THEMES（AI 挑 / 对比度体检通过才会用它） */
    --paper:${TH.paper}; --paper2:${TH.paper2}; --ink:${TH.ink}; --dim:${TH.dim};
    --rule:${TH.accent}; --line:${TH.line}; --scrim:${TH.scrim}; --on-accent:${TH.onAccent};
    --dots:${inkAlpha(TH.ink, 0.05)};
    /* ★VF_DAILY_V13：每张图声明一次（切分型入场 / 单文件内嵌体积都靠这条） */
    ${IMG_VARS}
    --ftitle:${TH.fontStack.title};
    --fbody:${TH.fontStack.body};
    --fsans:${TH.fontStack.label};
    --pad:clamp(24px,3.6vmin,50px); --gap:clamp(14px,2vmin,26px);
    --title:clamp(44px,7vmin,92px); --label:22px; --num:clamp(30px,4.2vmin,56px);
    --mz:${MOTION.zoom};                    /* 动效档：推近幅度 */
    --sp:1; --d:0;
    --g1:${TH.g[1]};
    --g2:${TH.g[2]};
    --g0:${TH.g[0]};
  }
  *{box-sizing:border-box;margin:0;padding:0}
  /* ═══ ★VF_DAILY_V24：尊重"减少动态"（Pro Max 预交付清单里我们唯一缺的一条）═══
     动效的**主体**由 JS 逐帧写 --sp ⇒ 那边负责"锁末态、不开循环"；这里补 CSS 侧的活：
       ① 杀掉过渡/关键帧/平滑滚动（未来加 transition 或第三方样式时不会漏）；
       ② --sp:1 兜底 —— 万一 JS 没跑（被挡/被禁/被安全策略拦），版面至少是**末态**而不是空白；
          ⚠️ 只在"JS 没写过内联 --sp"时生效（内联优先于样式表，两条不会打架）。
     ⚠️ 本段在 JS 模板字符串里：注释里**不能出现反引号**（写错一次就整个引擎不出文件）。 */
  @media (prefers-reduced-motion: reduce){
    *,*::before,*::after{animation-duration:.001ms !important;animation-iteration-count:1 !important;
      transition-duration:.001ms !important;transition-delay:0s !important}
    html{scroll-behavior:auto}
    .sec{--sp:1}
  }
  /* ★短标签一律不折行 + 窄窗降级列数（R14：窗口被拖窄时"先涮后蘸"会被折行） */
  .kick,.stamp,.col b,.col i,h2 span{white-space:nowrap;word-break:keep-all}
  @media (max-width:600px){ .cols.c3{grid-template-columns:1fr 1fr} .figs.n2{grid-template-columns:1fr} }
  html,body{background:var(--paper);color:var(--ink);-webkit-font-smoothing:antialiased;
    font-family:var(--fbody)}
  body::after{content:"";position:fixed;inset:0;pointer-events:none;opacity:.5;
    background:radial-gradient(var(--dots) .6px, transparent .6px);background-size:5px 5px}
  html[data-mode="preview"] body{overflow-y:auto}
  html[data-mode="preview"] .sec{position:relative;height:100vh;min-height:520px}
  html[data-mode="preview"] .sec + .sec{border-top:1px solid var(--line)}
  html[data-mode="film"] body{overflow:hidden;width:100vw;height:100vh}
  html[data-mode="film"] .sec{position:absolute;inset:0;opacity:0}
  html[data-mode="film"] .sec[data-live="1"]{opacity:1}

  .sec{padding:var(--pad);display:grid;gap:var(--gap);
    grid-template-columns:minmax(0,1fr);grid-template-rows:auto auto minmax(0,1fr) auto;
    grid-template-areas:"head" "title" "fig" "cols"}
  @media (min-aspect-ratio:1/1){
    .sec{grid-template-columns:minmax(0,1.06fr) minmax(0,1fr);grid-template-rows:auto auto minmax(0,1fr);
      grid-template-areas:"head fig" "title fig" "cols fig"}
  }

  .head{grid-area:head;display:flex;align-items:baseline;gap:14px}
  .kick{font-family:var(--fsans);font-size:var(--label);color:var(--rule);
    letter-spacing:.3em;opacity:clamp(0,calc(var(--sp)*5),1)}
  .stamp{margin-left:auto;font-family:var(--fsans);font-size:var(--label);color:var(--on-accent);
    background:var(--rule);padding:4px 10px;border-radius:2px;
    opacity:clamp(0,calc((var(--sp) - .12)*4),1);
    transform:rotate(calc(-3deg + 3deg * clamp(0,calc((var(--sp) - .12)*4),1)))}

  h2{grid-area:title;font-size:var(--title);line-height:1.14;font-weight:900;letter-spacing:-.01em;
    font-family:var(--ftitle)}
  /* ═══ ★VF_DAILY_V25：**文字动效**（用户点名的去同质化四条轴之一）═══
     病灶：全片文字只有"上滑淡入"一种动作（同一段代码对每段都成立）⇒ 看三段就腻。
     现口径：入场**变量驱动** —— 基式只算"进度 k + 位移幅度(--tmx/--tmy) + 起始缩放(--tms0) + 遮罩(--tmclip)"，
     data-tm 的 7 个变体只改这几个变量。**只用 transform/clip-path/filter**（不碰盒模型）
     ⇒ 折行(R14)/越界/溢出这些闸门照旧管用（动画中途也不会撑破版面）。
     ⚠️ 刻意不用 letter-spacing 做"展开"：那会**触发重排**，动画中途可能折行 —— 闸门抓不到"中途折行"。 */
  .sec{--k:clamp(0,calc((var(--sp) - var(--d,0))*4),1);
    --tmx:0px;--tmy:30px;--tmyc:20px;--tms0:1;--tmclip:none;--tmblur:0px;--tmf:0}
  h2 span{display:block;opacity:clamp(0,calc((var(--sp) - var(--d,0))*4),1);
    clip-path:var(--tmclip);filter:blur(var(--tmblur));
    /* ⚠️⚠️ V25 修（B3 矩阵 + find-overflow 抓出来）：x/y 位移**都必须乘 (1 - k)**。
       我第一版把 --tmx 写成了裸的（没有乘 1-k）⇒ "推入/斜落"两型的标题**永久左移 44px / 右移 30px**
       （末态也没归零）⇒ 竖排段溢出 11px、越界 1 个元素；而当时"楷体不溢出"只是**变体不同**的错觉
       （同种子不同文件分到不同 tm），我一度误判成"字体宽度问题"。 */
    transform:translate(calc(var(--tmx)*(1 - clamp(0,calc((var(--sp) - var(--d,0))*4),1))),
        calc(var(--tmy)*(1 - clamp(0,calc((var(--sp) - var(--d,0))*4),1))))
      scale(calc(var(--tms0) + (1 - var(--tms0))*clamp(0,calc((var(--sp) - var(--d,0))*4),1)))}
  /* 变体（把"动作"换掉，其余一律不动） */
  .sec[data-tm="rise"]{--tmx:0px;--tmy:30px;--tmyc:20px}
  .sec[data-tm="push"]{--tmx:-44px;--tmy:0px;--tmyc:0px}
  .sec[data-tm="drift"]{--tmx:30px;--tmy:-12px;--tmyc:-8px}
  .sec[data-tm="zoom"]{--tmx:0px;--tmy:0px;--tmyc:0px;--tms0:.90}
  .sec[data-tm="wipe"]{--tmx:0px;--tmy:0px;--tmyc:0px;--tmclip:inset(0 0 calc(100% * (1 - var(--k))) 0)}
  .sec[data-tm="curtain"]{--tmx:0px;--tmy:0px;--tmyc:0px;--tmclip:inset(calc(100% * (1 - var(--k))) 0 0 0)}
  .sec[data-tm="blur"]{--tmx:0px;--tmy:10px;--tmyc:6px;--tmblur:calc(14px * (1 - var(--k)))}
  h2 span:nth-child(2){--d:calc(.10 * ${MOTION.dmul})}
  /* 逐行错峰的变体：第二行晚一点起（"两行像两口气"，与"整块一起动"完全不同的观感） */
  .sec[data-tm="push"] h2 span:nth-child(2),
  .sec[data-tm="drift"] h2 span:nth-child(2){--d:calc(.20 * ${MOTION.dmul})}
  .sec[data-tm="curtain"] h2 span:nth-child(2){--d:calc(.26 * ${MOTION.dmul})}
  h2 em{font-style:normal;box-shadow:inset 0 -.22em 0 rgba(198,57,43,.35)}

  .figs{grid-area:fig;min-height:0;display:grid;gap:var(--gap);grid-template-columns:minmax(0,1fr)}
  .figs.n2{grid-template-columns:minmax(0,1fr) minmax(0,1fr)}
  @media (min-aspect-ratio:1/1){ .figs.n2{grid-template-columns:minmax(0,1fr);grid-template-rows:minmax(0,1fr) minmax(0,1fr)} }
  .fig{min-height:0;position:relative;overflow:hidden;border-radius:3px;margin-top:8px;
    box-shadow:0 22px 44px rgba(60,40,20,.18), 0 1px 0 rgba(255,255,255,.4) inset;
    transform:rotate(-.25deg);filter:saturate(.94) contrast(1.04)}
  .fig::before{content:"";position:absolute;left:14px;top:14px;width:16px;height:16px;
    border-left:2px solid rgba(255,255,255,.75);border-top:2px solid rgba(255,255,255,.75)}
  .fig::after{content:"";position:absolute;right:14px;bottom:14px;width:16px;height:16px;
    border-right:2px solid rgba(255,255,255,.75);border-bottom:2px solid rgba(255,255,255,.75)}
  /* ★VF_DAILY_V2：真图槽（images/N.jpg）；img 被 onerror 摘掉时露出下面的渐变占位 */
  /* ═══ ★VF_DAILY_V10（2026-10-13 用户那份**带真图**的产物被闸门抓到"越界 1 处"）═══
     病灶：推近放大原来是加在 .fig（图框）上的 ⇒ 变换后的外框长到画布外（竖屏实测 img.ph
     [-2,43,722,1025]、横屏 [-23,64,1303,445]）。视觉上被 overflow:hidden 裁掉看不出来，
     但**外框确实出去了**（V3 那轮只在满幅段把放大挪进图内，其它结构漏了）。
     正解：**放大多少，就把图的内缩按同比例缩进去** —— 内缩 = 50% − 50%/zoom（图框的 1/zoom，居中），
     再按 --mz 放大 ⇒ 变换后的外框**恰好等于图框**：既不越界、导出时也不会有边缘渗漏。
     （calc() 除以 var 在 Chromium 里可用；万一不支持，内缩退化成 0 ⇒ 回到老行为，不会更糟。 */
  .fig .ph{--z:calc(var(--mz) - (var(--mz) - 1)*var(--sp));   /* 当前缩放（随时间从 --mz 收到 1） */
    position:absolute;left:50%;top:50%;width:calc(100% / var(--z));height:calc(100% / var(--z));
    object-fit:cover;display:block;transform:translate(-50%,-50%) scale(var(--z))}
  /* ★VF_DAILY_V11：**图片动效按段轮换**（原来所有段都是同一种"回拉"，用户觉得"都一个效果、有点怪"）。
     · zout（默认）= 回拉：从 --mz 收到 1；
     · zin        = 推近：从 1 涨到 --mz；
     · pan        = 横移取景：缩放钉在 1.06，靠 object-position 从偏左移到居中（画面"扫"过去）。
     三种都保持"外框 = 图框"（尺寸 = 图框/当前缩放，再 scale 回去）⇒ 越界闸门与覆盖率探针照旧管用；
     object-position 只改**框内**取景，不动元素的框 ⇒ 不会露边。 */
  .sec[data-fx="zin"] .fig .ph{--z:calc(1 + (var(--mz) - 1)*var(--sp))}
  .sec[data-fx="pan"] .fig .ph{--z:1.06;object-position:calc(34% + 32% * var(--sp)) 50%}
  /* ═══ ★VF_DAILY_V19 安静组新增：**裁切擦显 wipe** ═══
     用户原话「这个（切分型）不能大范围使用，10 个里面有一个就行…不然视频最后做出来会很不好看」
     ⇒ 安静组只有 回拉/推近/横移 三种，15 段里必然循环得能看出来。加这一种"一条硬边扫过去"：
     · 与切分型的本质区别：**只有一条边在动**，不是"一块块往上贴" ⇒ 出片不花；
     · 不位移、不缩放元素外框（只裁框内的图）⇒ 越界/溢出/覆盖率闸门照旧管用；
     · 变体：fv=0 自左向右、fv=1 自上向下（同一 id 也有两种样子）。 */
  /* ⚠️ 擦完的**时机**踩过坑（probe-wipe 量出来的）：原来写成 clamp(0, var(--sp), 1) ⇒ 要等整段
     走完才擦干净，实测**末态还差 10~15%**（出片里就是"定格那一角永远是空的"）。
     改成 var(--sp) * 2.4 ⇒ 段内约 42%（≈1.3s）擦完，与切分型的 *3.6 同一思路：
     留给观众一个"擦干净之后稳定看着图"的尾段。
     ⚠️⚠️ 本段 CSS 在 JS 模板字符串里 —— 注释里**绝不能出现反引号**（连"举例"也不行：
     第一次就写成 "原来写 [反引号]clamp(...)[反引号]" ⇒ 模板串提前闭合 ⇒ SyntaxError ⇒
     引擎一个字都不出）。已把 node --check daily-page.mjs 加进自检清单。 */
  .sec[data-fx="wipe"] .fig .ph{clip-path:inset(0 calc(100% * (1 - clamp(0, calc(var(--sp) * 2.4), 1))) 0 0)}
  .sec[data-fv="1"][data-fx="wipe"] .fig .ph{clip-path:inset(0 0 calc(100% * (1 - clamp(0, calc(var(--sp) * 2.4), 1))) 0)}
  /* ═══ ★VF_DAILY_V13 切分型入场：条分(slats) / 百叶(blinds) / 拼片(mosaic) ═══
     每块 .vc 用 --img（=var(--imgN)，整图只声明一次）＋ background-size/position 取景，
     揭示只用 clip-path（自顶向下展开，按 --d 错峰）—— 不动元素外框 ⇒ 不触发越界闸门，
     也不会把"覆盖率"弄乱（切分型没有 img.ph，探针自然跳过它）。 */
  .fig.vfx .vc{position:absolute;background-image:var(--img);background-repeat:no-repeat;
    clip-path:inset(calc(100% * (1 - clamp(0, calc((var(--sp) - var(--d)) * 3.6), 1))) 0 0 0)}
  /* 拼片/条分在"完全展开"后不该有缝：用 0.6px 的负向外描边把接缝压住 */
  /* ★V13b 变体：方向（自底向上）与**轻幅度**推近/回拉/横移 —— 同一 id 换个样子，
     让"一份 14 段"也凑不出两个一模一样的入场（用户：「一次任务不要出现 2 次同一风格」）。 */
  .fig.vfx .vc[data-up="1"]{clip-path:inset(0 0 calc(100% * (1 - clamp(0, calc((var(--sp) - var(--d)) * 3.6), 1))) 0)}
  .sec[data-fv="2"][data-fx="zin"] .fig .ph{--z:calc(1 + (var(--mz) - 1) * 0.45 * var(--sp))}
  .sec[data-fv="2"][data-fx="zout"] .fig .ph{--z:calc(var(--mz) - (var(--mz) - 1) * 0.45 * var(--sp))}
  .sec[data-fv="2"][data-fx="pan"] .fig .ph{object-position:calc(66% - 32% * var(--sp)) 50%}
  /* 拼片/条分在"完全展开"后不该有缝：用 0.6px 的负向外描边把接缝压住 */
  .fig.vfx .vc{outline:0.6px solid transparent;outline-offset:-0.6px}
  /* ⚠️ 这里踩过两次（都是探针抓出来的，闸门看不见）：
     ① 内缩写死按 --mz（不跟当前缩放）⇒ 动画末尾图只铺 93.5%，四周露一圈边；
     ② 想用 inset + width:auto;height:auto 让图自动收缩 —— img 是 **replaced element**，
        width:auto 会退回**固有尺寸**（1×1 的占位图就是 1px）⇒ 图几乎看不见，而闸门只报"缺图 0"。
     现写法：尺寸 = 图框/当前缩放（百分比按图框算），居中，再放大回当前缩放 ⇒ 变换后外框**正好等于图框**。
     （本文件这段 CSS 全在 JS 模板字符串里：注释里**不能出现反引号**，否则整段 JS 语法错、引擎直接不出文件。） */
  /* ⚠️ 内缩必须跟着**当前缩放**走（不能写死按 --mz）：动画末尾 z→1，若内缩还按 1.07 算，
     图只铺 93.5% ⇒ 四周露一圈纸色/渐变边。闸门测不到这个（它只测越界/压图/字号）——
     所以配了 temp/_exp/daily/probe-cover.mjs 专门量"图是否铺满图框"。 */

  /* ═══ ★VF_DAILY_V3（2026-10-12 用户定案「排版要真的不一样」）═══
     form / place 以前只是写在标签上、看不出差别；现在**真的换版式**。
     全部用 grid（不用绝对定位）⇒ 越界/溢出闸门照旧管用；三种 form 互不相同，
     文字压在图上的一律带 ≥74% 暗衬（对比度与"压图"判定都稳）。 */
  /* form=overlay：大图吃满整段（横竖都拉通），文字贴图下沿 + 暗衬条 */
  .sec[data-form="overlay"]{grid-template-columns:minmax(0,1fr);
    grid-template-rows:auto minmax(0,1fr) auto auto;grid-template-areas:"head" "fig" "title" "cols"}
  /* ⚠️ 踩过的坑（实测）：满幅图的"推近"若加在图框上，横屏会算出 3px 越界（图框比视口宽）。
     所以满幅段把推近**移到框内的图**上 —— 被 .fig 的 overflow:hidden 裁掉，版面不动。 */
  .sec[data-form="overlay"] .fig{margin-top:0;transform:rotate(-.25deg)}
  /* ⚠️ V10/V11 修正：这里原来还有一条 .sec[data-form="overlay"] .fig .ph { transform:scale(...) }
     （V3 时代"把推近挪进图内"留下的）。它把基类的几何（含 translate(-50%,-50%)）**整条覆盖掉** ⇒
     overlay 段的 transform 永远按"回拉"公式算、而 width 用的是按当前动效算的 --z
     ⇒ 两者**打架**：动画中途会露边（探针实测 sp=0 段5 覆盖 0.935 / sp=0.5 段3 覆盖 1.024）。
     现在删掉 —— 几何只在基类 .fig .ph 一处定义，动效只改 --z 或 object-position。
     （注：本段 CSS 在 JS 模板字符串里，注释里**不能出现反引号**，否则引擎直接不出文件。） */
  /* 标题与信息点共用**一条**暗衬带（::after 跨两行、把中间的行距也盖住）——
     否则两个深色块中间露一条纸色缝，看着像"两个灰盒子"（截图上看过一眼就不想要了）。 */
  .sec[data-form="overlay"]::after{content:"";grid-row:3 / span 2;grid-column:1;
    background:var(--scrim);z-index:0}
  /* ★VF_DAILY_V14（2026-10-13 用户截图：标题第二行"像被切"）：根因是**动画中途**标题下移 30px，
     第二行会跑出暗衬带（落到照片上 ⇒ 一半暗一半亮 = 看着像被切）。判据测不到，人眼一秒就看见。
     修法：**文字元素自带同色底**（底色跟着文字走，无论位移到哪都在），::after 那条带只负责补缝。 */
  .sec[data-form="overlay"] h2,.sec[data-form="overlay"] .cols{position:relative;z-index:1;
    background:var(--scrim)}
  /* ★R5′ 半步：暗衬改**渐隐**（上淡下浓）—— 餐饮/美食要亮，别整块压黑（用户定案口径） */
  .sec[data-form="overlay"]::after{background:linear-gradient(to bottom,
    transparent 0%, var(--scrim) 42%, var(--scrim) 100%)}
  /* ═══ ★VF_DAILY_V15 · R5′（2026-10-13 用户定案「主题明确的图不怕遮挡，文字遮挡完全没关系」）═══
     服务端量过每张图的**平均亮度**：深色底（<118）的段标 data-scrim="none" ⇒ **整块暗衬拿掉**
     （白字在深色照片上本来就清楚，再压暗衬只会把餐饮/美食压黑），改用**描边+阴影**保证可读；
     亮底图仍走上面的渐隐暗衬（那里白字确实看不清）。
     ⚠️ 这是"用数据换来的豁免"：渲染体检（daily-verify.mjs）只在 scrim=none **且文字有阴影**时放行。 */
  .sec[data-scrim="none"]::after{display:none}
  .sec[data-scrim="none"] h2,.sec[data-scrim="none"] .cols{background:transparent;
    text-shadow:0 2px 12px rgba(0,0,0,.75), 0 0 3px rgba(0,0,0,.65)}
  .sec[data-form="overlay"] h2{background:none;color:#fff;padding:.06em .26em .12em}
  .sec[data-form="overlay"] h2 em{box-shadow:inset 0 -.18em 0 rgba(230,150,120,.5)}
  .sec[data-form="overlay"] .cols{background:none;color:#fff;border-top:0;
    padding:var(--gap) calc(var(--gap) * .8)}
  .sec[data-form="overlay"] .cols .col i{color:rgba(255,255,255,.78)}
  .sec[data-form="overlay"] .cols .col b{color:#F3C9A0}
  /* ★VF_DAILY_V23：**浅底皮肤的 overlay 要反相**（白字压浅纸 = 对比 1.09，探针实测过）。
     深底皮肤走上面那几条（逐字节不变）；浅底皮肤把"衬带+白字"换成"纸色衬带+墨字"：
     观感语言不变（依旧是"文字压一条带"），可读性从 1.09 拉到 ≥4.5。 */
  .sec[data-paper="light"][data-form="overlay"] h2,
  .sec[data-paper="light"][data-form="overlay"] .cols{background:var(--paper2);color:var(--ink)}
  .sec[data-paper="light"][data-form="overlay"] .cols .col i{color:var(--dim)}
  .sec[data-paper="light"][data-form="overlay"] .cols .col b{color:var(--rule)}
  .sec[data-paper="light"][data-form="overlay"]::after{background:linear-gradient(to bottom,
    transparent 0%, var(--paper2) 42%, var(--paper2) 100%)}
  /* R5′：深色照片段（data-scrim="none"）本来就是"白字+描边"，浅底皮肤上要换成墨字+亮描边 */
  .sec[data-paper="light"][data-scrim="none"] h2,
  .sec[data-paper="light"][data-scrim="none"] .cols{background:transparent;color:var(--ink);
    text-shadow:0 2px 12px rgba(255,255,255,.9), 0 0 3px rgba(255,255,255,.85)}
  .sec[data-paper="light"][data-form="overlay"][data-layout="grid3"] .col,
  .sec[data-paper="light"][data-form="overlay"][data-layout="grid4"] .col{border-color:var(--line)}
  /* form=sticker：标题变贴纸块（纸色底 + 朱红硬投影 + 轻倾斜） */
  .sec[data-form="sticker"] h2{align-self:start;justify-self:start;
    background:var(--paper2);padding:.10em .30em .16em;box-shadow:7px 8px 0 rgba(198,57,43,.22)}
  /* form=vertical：竖排标题（报纸竖排感）—— 标题单独占一列，图在左 */
  .sec[data-form="vertical"]{grid-template-columns:minmax(0,1fr) auto;
    grid-template-rows:auto minmax(0,1fr) auto;grid-template-areas:"head head" "fig title" "cols cols"}
  .sec[data-form="vertical"] h2{writing-mode:vertical-rl;text-orientation:upright;
    /* ★V21：字号同样改读 --title（竖排基准 30/3.4vmin/50 已搬进 titleCss） */
    font-size:var(--title);letter-spacing:.08em;align-self:start;justify-self:end;
    padding-left:calc(var(--gap) * .6);
    /* ★VF_DAILY_V25：竖排标题列**不许被压到小于内容宽**（图列是 minmax(0,1fr)，能缩到 0）。
       ⚠️ 说清楚是哪儿的锅：竖排溢出那一例（溢出 x11 · 越界 1）**真因是 V25 的 --tmx 没归零**
       —— 见下面 h2 span 那段的注释；这条 min-width 是**防御性**的（字体/文案变宽时也不会被挤出去），
       别把它当那次事故的修复记。 */
    min-width:max-content}
  /* place=mat：相纸感（图缩一圈、白边、方角） */
  .sec[data-place="mat"] .figs{padding:clamp(8px,1.1vmin,16px)}
  .sec[data-place="mat"] .fig{outline:clamp(4px,0.7vmin,8px) solid #fff;border-radius:1px;
    box-shadow:0 16px 32px rgba(60,40,20,.16)}
  /* ═══ ★VF_DAILY_V12（2026-10-13 用户：「主题明确的图不怕遮挡、完全可以显示全图」）═══
     place=contain：**整张不裁**（白底产品图 / 主体集中 / 主体靠边的图用它，别把主体切掉）。
     · 用 object-fit:contain ⇒ 图整个装进图框，四周留**纸色/暖白**底（不是透明、不是黑边）；
     · 推近缩放照旧有效（框内整体放大，仍然整张可见），越界/覆盖率口径不变。 */
  .sec[data-place="contain"] .fig{background:var(--paper2)}
  .sec[data-place="contain"] .fig .ph{object-fit:contain}
  /* split 图文左右：**没有信息点时标题垂直居中**（用户截图实测：左列只有标题 ⇒ 下方一大片死空档）。
     .cols.c0 是"零信息点"时引擎给的空栏 ⇒ 直接隐藏，把高度让给标题行。 */
  .sec[data-layout="split"] h2{align-self:center}
  .sec[data-layout="split"] .cols.c0{display:none}

  /* ═══ ★VF_DAILY_L2 结构库（8 种；全部走 grid，不用绝对定位 ⇒ 越界/溢出闸门照旧管用）═══
     hero/sticker/vertical 三条就是上面 V3 那三段 CSS（故意复用，别重复定义）；下面是新增的 5 条。 */
  /* split 图文左右：竖屏也分栏（字左 / 图右） */
  .sec[data-layout="split"]{grid-template-columns:minmax(0,1.04fr) minmax(0,1fr);
    grid-template-rows:auto minmax(0,1fr) auto;grid-template-areas:"head head" "title fig" "cols fig"}
  /* grid3 三图拼版（竖屏：左 1 大 + 右 2 小） */
  .figs.n3{grid-template-columns:minmax(0,1.55fr) minmax(0,1fr);grid-template-rows:minmax(0,1fr) minmax(0,1fr)}
  .figs.n3 .fig:nth-child(1){grid-row:1 / span 2}
  /* grid4 四宫格 */
  .figs.n4{grid-template-columns:minmax(0,1fr) minmax(0,1fr);grid-template-rows:minmax(0,1fr) minmax(0,1fr)}
  /* quote 引文页：大字 + 图作窄条。
     ⚠️ 踩过的坑（截图上看出来的）：把 title 行设成 1fr ⇒ overlay 的暗衬带（跨 title+cols 两行）
     会把**剩下的空间全吃成一大块黑**。正确做法：图占弹性 1fr，**文字行 auto（贴紧）**。 */
  .sec[data-layout="quote"]{grid-template-columns:minmax(0,1fr);
    grid-template-rows:auto minmax(0,1fr) auto auto;grid-template-areas:"head" "fig" "title" "cols"}
  /* ★V21：字号改成读 --title（引擎按"结构×文字层×字号档"算好、以内联形式写在段上）；
     这里只保留引用页自己的排版特征（行高/下留白）。原来写死 clamp(34px,5.6vmin,72px) 会把字号档吃掉。 */
  .sec[data-layout="quote"] h2{font-size:var(--title);line-height:1.24;padding-bottom:.10em}
  .sec[data-layout="quote"] .cols{grid-template-columns:1fr;padding-top:calc(var(--gap) * .7)}
  .figs.n0{display:none}
  /* 横屏：grid3 改"上 1 通栏 + 下 2 并排"（避免三根细条）；grid4 保持 2×2 */
  @media (min-aspect-ratio:1/1){
    .figs.n3{grid-template-columns:minmax(0,1fr) minmax(0,1fr);grid-template-rows:minmax(0,1.08fr) minmax(0,1fr)}
    .figs.n3 .fig:nth-child(1){grid-row:1;grid-column:1 / span 2}
  }

  .cols{grid-area:cols;display:grid;grid-template-columns:1.45fr 1fr 1fr;gap:var(--gap);align-self:end;
    border-top:1px solid var(--line);padding-top:var(--gap)}
  .cols.c2{grid-template-columns:1.45fr 1fr}
  .cols.c1{grid-template-columns:1fr}
  /* ★V25：信息点跟着**同一个变体**走（幅度按 --tmyc 缩一档）—— 否则"标题换了动作、信息点还是老动作"，
     一段里两种动作打架，看着像 bug 而不像设计。 */
  .col{display:flex;flex-direction:column;gap:2px;
    opacity:clamp(0,calc((var(--sp) - var(--d,0))*4),1);
    clip-path:var(--tmclip);filter:blur(var(--tmblur));
    transform:translate(calc(var(--tmx)*.6*(1 - clamp(0,calc((var(--sp) - var(--d,0))*4),1))),
        calc(var(--tmyc)*(1 - clamp(0,calc((var(--sp) - var(--d,0))*4),1))))
      scale(calc(var(--tms0) + (1 - var(--tms0))*clamp(0,calc((var(--sp) - var(--d,0))*4),1)))}
  .col:nth-child(1){--d:calc(.14 * ${MOTION.dmul})}
  .col:nth-child(2){--d:calc(.22 * ${MOTION.dmul})}
  .col:nth-child(3){--d:calc(.30 * ${MOTION.dmul})}
  /* ★V14（三条闸门之一）：数字一律**等宽**（tabular-nums）—— 数字对齐是"专业感"最便宜的一处 */
  .col b,.stamp,.kick{font-variant-numeric:tabular-nums}
  .col b{font-size:var(--num);line-height:1.1}
  .col:nth-child(1) b{font-family:var(--fsans);color:var(--rule)}
  .col i{font-style:normal;font-size:var(--label);color:var(--dim)}

  /* ═══ ★VF_DAILY_V9 文字层随结构（2026-10-13 用户原话「感觉没什么区别」）═══
     诊断（拆过用户两份真产物）：结构确实换了（hero→grid3→split→vertical vs grid4→stack2→sticker），
     但**"字的观感"完全没变** —— 所有结构的标签/标题/信息点都用同一套样式，第一眼就被认成同款。
     这里给每条结构一套自己的**标签/标题/信息点**处理（只动装饰与排布：不加绝对定位、不缩字号 ⇒ 三档闸门照旧管用）。
     规则写在**最后**（与本文件前面的同名选择器同特异性 ⇒ 后者胜）。 */
  /* split 图文左右：标题每行带朱红竖线（像报纸栏头）＋信息点改"横排一行一条" */
  .sec[data-layout="split"] h2 span{display:block;border-left:clamp(3px,.48vmin,6px) solid var(--rule);
    padding-left:.3em;margin:.04em 0}
  .sec[data-layout="split"] .cols{grid-template-columns:1fr}
  .sec[data-layout="split"] .col{flex-direction:row;align-items:baseline;gap:.5em}
  .sec[data-layout="split"] .col b::after{content:"·";margin-left:.32em;color:var(--rule)}
  /* grid3 / grid4 多图拼版：信息点变**圆角胶囊**横排（图多时文字主动让位，字面清爽） */
  .sec[data-layout="grid3"] .cols,.sec[data-layout="grid4"] .cols{display:flex;flex-wrap:wrap;gap:.5em;
    border-top:0;padding-top:calc(var(--gap) * .6)}
  .sec[data-layout="grid3"] .col,.sec[data-layout="grid4"] .col{flex-direction:row;align-items:baseline;gap:.42em;
    border:1px solid var(--line);border-radius:999px;padding:.3em .72em}
  .sec[data-layout="grid3"] h2 em,.sec[data-layout="grid4"] h2 em{box-shadow:none;color:var(--rule)}
  /* 胶囊压在满幅段的暗衬带上时，边框要提亮（深色底上 .16 黑的线看不见） */
  .sec[data-form="overlay"][data-layout="grid3"] .col,
  .sec[data-form="overlay"][data-layout="grid4"] .col{border-color:rgba(255,255,255,.34)}
  /* quote 引文页：标题前挂一个大引号 ＋ 信息点居中 */
  .sec[data-layout="quote"] h2::before{content:"“";display:block;font-size:1.45em;line-height:.52;
    color:var(--rule);opacity:.6;margin-bottom:.06em}
  .sec[data-layout="quote"] .cols{justify-items:center;text-align:center}
  /* stack2 上下双图：标题与信息点居中（"双图对开"的对称感） */
  .sec[data-layout="stack2"] h2{text-align:center}
  .sec[data-layout="stack2"] .cols{justify-items:center;text-align:center}
  /* hero 满幅压字：标题再加一道**右侧朱红短标尺**，与 quote 的大引号区分开 */
  .sec[data-layout="hero"] h2 span:last-child{position:relative}
  .sec[data-layout="hero"] h2 span:last-child::after{content:"";display:block;width:clamp(46px,7vmin,96px);
    height:clamp(3px,.5vmin,6px);background:var(--rule);margin-top:.28em;opacity:.85}

  /* ═══ ═══ ★VF_DAILY_V21 文字层参数化（用户：「依然是文字排版同质化严重」）═══════
     原来"文字层随结构"是把 8 种结构各写死一套 ⇒ **同结构永远同一张脸**。现在拆成两级：
       结构（怎么摆图） × 文字层（字怎么说话） × 字号档（这一段多大）。
     这里只动**排版与装饰**：不改元素外框、不加绝对定位、不缩到违规字号 ⇒ 三档闸门照旧管用。
     定义在"文字层随结构"**之后** ⇒ 同特异性时后者胜（想覆盖某个结构就在这后面加）。
     字号档实现：只重定义 --title（各结构若另设 --title 也在同一处跟着 --ts 走）。 */
  /* ⚠️ 踩过的坑（probe-type 量出来的）：刚开始想用 CSS 覆盖来"把字号档接上去"，结果被
     quote / vertical 两处**写死的字面字号**（clamp(34px,5.6vmin,72px) / clamp(30px,3.4vmin,50px)）
     打架（实测：这两类段的标题恒定 40.3px / 30px，ts 调到 1.3 也不动）。
     现口径（简单且不可能再打架）：**字号基准由引擎按"结构+文字层"算好，直接写成段上的内联 --title**
     —— 内联优先级最高，CSS 里谁也别想盖它；那两处结构改成 font-size:var(--title)，只保留各自的排版特征。
     内联样式在 segBody 里生成（见 titleCss）。 */

  /* band（默认）：深色衬带 —— 现有观感，不加规则 */

  /* poster 海报式：标题紧排、色块撤掉只留朱红行、信息点**右对齐竖排**（像海报角标） */
  .sec[data-type="poster"] h2{letter-spacing:-.02em;line-height:.98}
  .sec[data-type="poster"] h2 em{background:none;color:var(--rule);padding:0}
  .sec[data-type="poster"] .head .kick{border-bottom:0;letter-spacing:.22em}
  .sec[data-type="poster"] .cols{display:flex;flex-direction:column;gap:.26em;align-items:flex-end;border-top:0;padding-top:0}
  .sec[data-type="poster"] .col{flex-direction:column;align-items:flex-end;text-align:right;gap:.05em}
  .sec[data-type="poster"] .col b{font-family:var(--fsans);font-size:var(--label)}

  /* editorial 杂志式：抬头细线 + 段号、信息点**两列小栏**（像刊物信息栏） */
  .sec[data-type="editorial"] .head{border-bottom:1px solid var(--line);padding-bottom:.34em}
  .sec[data-type="editorial"] h2{line-height:1.1}
  .sec[data-type="editorial"] h2 span:first-child::before{content:"§ ";color:var(--rule);font-family:var(--fsans)}
  .sec[data-type="editorial"] .cols{display:grid;grid-template-columns:1fr 1fr;gap:.44em 1.1em;border-top:1px solid var(--line)}
  .sec[data-type="editorial"] .col{flex-direction:column;gap:.08em;align-items:flex-start}
  .sec[data-type="editorial"] .col b{font-family:var(--fsans);font-size:var(--label)}

  /* list 清单式：标题收成**小标**、信息点成为主体（左侧朱红竖线 + 每条一道虚线下划） */
  /* 清单式的"标题收成小标"由 titleCss 的基准（34/4.6vmin/58）负责，这里只管排版与装饰 */
  .sec[data-type="list"] h2{letter-spacing:.01em}
  .sec[data-type="list"] .cols{display:flex;flex-direction:column;gap:.42em;border-left:clamp(3px,.5vmin,6px) solid var(--rule);padding-left:.7em}
  .sec[data-type="list"] .col{flex-direction:row;align-items:baseline;gap:.55em;border-bottom:1px dashed var(--line);padding-bottom:.34em}
  .sec[data-type="list"] .col b{font-family:var(--fsans);font-size:var(--label);min-width:2.4em}
${AI_CSS.length ? '\n  /* ══ ★VF_DAILY_L3：AI 自写段的 CSS（选择器都带 .aiN- / .sec[data-seg="N"] 前缀）══ */\n' + AI_CSS.join('\n') : ''}
</style>
</head>
<body>
${BODIES.join('\n\n')}

<script>
  /* 双模式：preview 自动循环（人打开就能看见动）；__seek(t) 一调 ⇒ 切 film 并停循环（渲染确定性） */
  (function () {
    var SECS = ${JSON.stringify(scenes.map((s) => ({ s: s.start, d: s.dur })))}
    var nodes = Array.prototype.slice.call(document.querySelectorAll('.sec'))
    var GAP = ${MOTION.gap}, t0 = (window.performance && performance.now) ? performance.now() : 0
    function paint(list) {
      for (var i = 0; i < list.length; i++) {
        list[i].node.style.setProperty('--sp', list[i].sp)
      }
    }
    /* ═══ ★VF_DAILY_V24（2026-10-14 用户定案「d 补上 prefers-reduced-motion」）═══
       为什么加（Pro Max 的 Pre-Delivery Checklist 里我们**唯一**没满足的一条）：
         · 我们所有动效都由 JS 逐帧写 --sp 驱动 ⇒ 对"减少动态"的用户，页面会一直在动，
           前庭敏感人群/远端桌面/省电模式都会被这条冒犯；截图工具也会抓到半截态。
         · 现口径：命中 prefers-reduced-motion: reduce ⇒ **一次性把末态画好 + 不启动逐帧循环**
           （不是"把动画变快"，是"根本不动"，任何时刻看都是完成的版面）。
         · 用户中途改系统设置 ⇒ 跟随（开=停循环并锁末态，关=重启循环），不会双循环（running 闸门）。
         · 不影响出片：film 模式由 __seek 驱动，与这里互斥（RM 只作用于 preview）。
       ⚠️ 本段也在模板字符串里：注释里不能出现反引号。 */
    var running = false
    function reduced() {
      try { return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) } catch (e) { return false }
    }
    function still() {                       // 锁在末态：每段都画成"已播完"
      var out = []
      for (var i = 0; i < nodes.length; i++) out.push({ node: nodes[i], sp: 1 })
      paint(out)
    }
    function start() {
      if (running) return                     // 防双循环（RM 切换时最容易踩）
      running = true
      requestAnimationFrame(loop)
    }
    function stop() { running = false }
    function loop(now) {
      if (!running) return
      if (document.documentElement.dataset.mode === 'film') return
      var out = []
      for (var i = 0; i < nodes.length; i++) {
        var T = SECS[i] ? SECS[i].d * 1000 : 3200
        var t = ((now - t0 - i * GAP) % (T + GAP) + (T + GAP)) % (T + GAP)
        out.push({ node: nodes[i], sp: Math.min(1, t / T) })
      }
      paint(out)
      requestAnimationFrame(loop)
    }
    function applyRM(on) {
      document.documentElement.dataset.rm = on ? '1' : '0'
      if (on) { stop(); still() }
      else { t0 = (window.performance && performance.now) ? performance.now() : 0; start() }
    }
    try {
      var mq = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null
      if (mq && mq.addEventListener) mq.addEventListener('change', function (e) { applyRM(!!e.matches) })
      else if (mq && mq.addListener) mq.addListener(function (e) { applyRM(!!e.matches) })   // 老 Chrome
    } catch (e) { /* 拿不到就按"不减少动态"走 */ }
    window.__seek = function (t) {
      document.documentElement.dataset.mode = 'film'
      t = Number(t) || 0
      var idx = SECS.length - 1
      for (var i = 0; i < SECS.length; i++) if (t >= SECS[i].s && t < SECS[i].s + SECS[i].d) idx = i
      var out = []
      for (var k = 0; k < nodes.length; k++) {
        var live = (k === idx)
        nodes[k].dataset.live = live ? '1' : '0'
        out.push({ node: nodes[k], sp: live ? Math.max(0, Math.min(1, (t - SECS[k].s) / SECS[k].d)) : 1 })
      }
      paint(out)
    }
    if (reduced()) applyRM(true)             // ★V24：系统要求"减少动态" ⇒ 直接锁末态、不开循环
    else start()
  })()
</script>
</body>
</html>
`

// ── ★VF_DAILY_V18 生成期自检：**切分块的四边尺寸必须给全** ──
//   为什么加（用户实测「还是 4.5.10.11 空的 就一个黄底」）：`.vc` 是 `position:absolute` 的**空元素**，
//   条分只给 left/width ⇒ height:auto = 0；百叶只给 top/height ⇒ width:auto = 0 ⇒ **整段只剩占位渐变**。
//   这种"0 尺寸元素"既不越界也不溢出、又不在 `img.ph` 统计里 ⇒ 所有既有闸门**全绿也照样漏掉**。
//   所以在**生成的那一刻**静态体检一遍（不依赖浏览器、零成本）：缺哪条边就点名。
const vfxBad = []
for (const m of html.matchAll(/<i class="vc"[^>]*style="([^"]*)"/g)) {
  const st = m[1]
  const miss = ['left', 'top', 'width', 'height'].filter((k) => !new RegExp('(^|;)' + k + ':').test(st))
  if (miss.length) vfxBad.push(miss.join('/'))
}
const vfxNote = vfxBad.length
  ? '切分块缺尺寸 ' + vfxBad.length + ' 个（缺：' + Array.from(new Set(vfxBad)).join('、') + '）—— 这些段只会显示占位底色'
  : '通过'

const OUT = path.resolve(outIdx >= 0 ? argv[outIdx + 1] : path.join(HERE, 'out', path.basename(cfgFile, '.json') + '.html'))
fs.mkdirSync(path.dirname(OUT), { recursive: true })
fs.writeFileSync(OUT, html, 'utf8')
console.log('✅ 生成：' + path.relative(REPO, OUT) + '（' + scenes.length + ' 段 · ' + TOTAL + 's · 动效档 ' + String(cfg.motion || 'normal') + '）')
if (warns.length) { console.log('⚠️ 字数体检（R11）' + warns.length + ' 条：'); warns.forEach((w) => console.log('   · ' + w)) }
else console.log('   R11 字数体检：通过')
if (vfxBad.length) console.log('⚠️ 切分块自检（V18）：' + vfxNote)
else console.log('   V18 切分块自检：通过（条分/百叶/拼片四边尺寸齐全）')
// ── ★VF_DAILY_V25 生成期自检②：**文字动效不能相邻重复**（两段同动作 = 一眼看成同一页）──
//   与 V18 同理：这种"重复"既不越界也不溢出，**所有既有闸门都是绿的**，只能在生成那一刻点出来。
const tmDup = segTm.filter((x, i) => i > 0 && x === segTm[i - 1]).length
const tmCount = Array.from(new Set(segTm)).length
if (tmDup) console.log(`⚠️ 文字动效自检（V25）：相邻重复 ${tmDup} 处 —— 两段同动作会被当成同一页`)
else console.log(`   V25 文字动效自检：通过（${tmCount}/${TM.length} 种 · 相邻不重复：${segTm.join(' → ')}）`)
// ── ★V25 生成期自检③：字体配对（AI 要的必须在库里，且必须真的写进了 CSS 变量）──
const pairOk = !!FONT_PAIRS[TH.pair]
if (pairOk) console.log(`   V25 字体配对：${TH.pair}（${FONT_PAIRS[TH.pair].name}）· 皮肤「${TH.name}」`)
else console.log(`⚠️ V25 字体配对：「${TH.pair}」不在库里 —— CSS 变量会掉回衬线默认值`)
