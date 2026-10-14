#!/usr/bin/env node
/**
 * temp/_exp/daily/probe-variance.mjs —— ★VF_DAILY_V25 的**去同质化体检**（用户点名的四条轴）。
 * 用户口径（2026-10-14）：「最大目的**去同质化**：文字。文字动效。配色。样式排版」。
 * 所以这里不验"某一份好不好"，而验"**连着做 6 份，像不像同一套**"：
 *   ① 配色（皮肤）② 文字（字体配对 + 文字层 type + 字号档）③ 文字动效（tm）
 *   ④ 样式排版（结构 layout + 形式 form）
 * 全部走**服务端同一套纯函数**（assignFx / assignTextMotion / fixDiversity / buildPlanFromSegs），
 * 皮肤轮换与线上同规则（换一个不同的、不带上一份的皮肤）。
 * 跑法：node temp/_exp/daily/probe-variance.mjs [轮数]
 */
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { PLAN_THEMES, PLAN_TM, assignFx, assignTextMotion, fixDiversity, checkDiversity, buildPlanFromSegs, themeName } = require('./run/daily-plan.js')
const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))
const REPO = path.resolve(HERE, '..', '..', '..')
const R = Number(process.argv[2] || 6)

// 引擎侧"皮肤→字体配对"的映射（从源码解析，避免两处手抄）
const ENGINE = path.join(REPO, 'scripts/video-factory/html-deck/tools/daily-page.mjs')
const src = fs.readFileSync(ENGINE, 'utf8')
const block = src.slice(src.indexOf('const PAIR_OF = {'), src.indexOf('const pairStacks'))
const PAIR = {}
for (const m of block.matchAll(/'([a-z0-9-]+)':\s*'([a-z-]+)'/g)) PAIR[m[1]] = m[2]

const LAYOUTS = ['hero', 'split', 'sticker', 'vertical', 'grid3', 'grid4', 'stack2', 'quote']
const TYPES = ['band', 'poster', 'editorial', 'grid', 'list', 'mono', 'outline', 'label']
const IMGC = { hero: 1, split: 1, sticker: 1, vertical: 1, grid3: 3, grid4: 2, stack2: 2, quote: 1 }
const PTS = { split: [['切法', '手工'], ['上桌', '现涮']], vertical: [['脆', '现切'], ['鲜', '当日']], quote: [['一', '百叶'], ['二', '手切']] }

/** 造一份"素材"（8 段、结构/文字层都不同），四轴的变化全交给线上那套函数 */
function roll(seed) {
  const order = ['hero', 'split', 'sticker', 'vertical', 'grid3', 'grid4', 'stack2', 'quote']
  const segs = order.map((layout, i) => ({
    kind: i === 0 ? 'cover' : 'feature', layout, form: ['hero', 'sticker', 'vertical'].includes(layout) ? (layout === 'hero' ? 'overlay' : layout) : 'overlay',
    type: TYPES[(seed + i) % TYPES.length], scale: [0.9, 1, 1, 1.15][(seed + i) % 4],
    kicker: `第 ${String(i + 1).padStart(2, '0')} 期 · 现拍`, stamp: i === 0 ? '现拍' : '',
    title: ['手切鲜肉', '现点现切'], imgs: Array.from({ length: IMGC[layout] }, (_, k) => ((i + k) % 12) + 1),
    points: PTS[layout] || [['实拍', '原图'], ['细节', '特写']], place: i === 1 ? 'mat' : 'cover',
  }))
  fixDiversity(segs)                       // V22 相邻段共享 ≤1
  assignFx(segs, seed)                     // V19 效果配额
  assignTextMotion(segs, seed)             // V25 文字动效（相邻必不同）
  return segs
}

const rows = []
let lastTheme = ''
const recentThemes = []
for (let r = 0; r < R; r++) {
  // ⚠️ 第一版我用 seed = 20261014 + r*7 —— 步长 7 是文字动效种数(7)的倍数 ⇒ 模 7 全撞车、
  //    6 轮的 tm 序列**完全相同**（体检报告"1/6 条不同"就是这么来的）。改用与 7 互质的步长。
  const seed = 20261014 + r * 3 + 1
  // 皮肤轮换：换一个与上一份不同的（线上同规则）
  const cand = PLAN_THEMES.filter((t) => recentThemes.slice(0, 3).indexOf(t.id) < 0)
  const theme = cand[seed % cand.length].id
  const segs = roll(seed)
  // 字体配对：走**线上那个函数**（AI 没指定 + 与上一份同款 ⇒ 顺延），拿到的就是最终生效值
  const fp = require('./run/daily-plan.js').pickFont({ themeId: theme, recentThemes: recentThemes, key: seed })
  const fontUsed = fp.font || PAIR[theme] || '-'
  recentThemes.unshift(theme)
  lastTheme = theme
  const plan = buildPlanFromSegs(segs, '验收 · 去同质化', 'normal', theme, undefined, undefined, fp.font)
  const fx = segs.map((s) => String(s.fx).split('#')[0])
  const tm = segs.map((s) => s.tm)
  rows.push({
    r: r + 1, skin: theme, skinName: themeName(theme), font: fontUsed, fontNote: fp.fixes.length ? '顺延' : '',
    layouts: new Set(segs.map((s) => s.layout)).size, types: new Set(segs.map((s) => s.type)).size,
    fx, tm,
    pairTuples: segs.map((s) => s.layout + '/' + s.type).join(','),
    sig: [theme, PAIR[theme], fx.join('|'), tm.join('|'), segs.map((s) => s.layout + s.type).join(',')].join(' :: '),
    div: checkDiversity(segs),
  })
}

console.log(`\n  ══ ${R} 轮生成的"四轴"（每条都经过线上同一套函数）══`)
console.log('   轮  皮肤(配色)        字体    结构种类  文字层种类  效果序                    文字动效序')
rows.forEach((x) => {
  console.log(`   ${String(x.r).padStart(2)}  ${(x.skinName + '(' + x.skin + ')').padEnd(18)} ${String(x.font).padEnd(9)} ${String(x.layouts).padEnd(8)} ${String(x.types).padEnd(11)} ${x.fx.join('>').padEnd(26)} ${x.tm.join('>')}`)
})

const uniq = (a) => new Set(a).size
console.log('\n  ══ 不重复率 ══')
console.log(`   配色（皮肤）      ${uniq(rows.map((x) => x.skin))}/${R} 种`)
console.log(`   文字（字体配对）  ${uniq(rows.map((x) => x.font))}/${R} 种`)
console.log(`   样式排版（结构）  ${uniq(rows.map((x) => x.layouts))} 种不同"结构个数"取值 · 逐份 tuple 序列唯一 ${uniq(rows.map((x) => x.pairTuples))}/${R}`)
console.log(`   文字动效          ${uniq(rows.map((x) => x.tm.join('>'))) }/${R} 条不同的序列（相邻必不同：见下）`)
console.log(`   四轴合成签名唯一  ${uniq(rows.map((x) => x.sig))}/${R}  —— 这一项 = "两份片子像不像同一套"的机器判据`)

const dupFx = rows.filter((x) => x.fx.some((v, i) => i > 0 && v === x.fx[i - 1])).length
const dupTm = rows.filter((x) => x.tm.some((v, i) => i > 0 && v === x.tm[i - 1])).length
const divOk = rows.filter((x) => x.div.ok).length
console.log(`\n   自检：相邻效果重复 ${dupFx} 份 · 相邻文字动效重复 ${dupTm} 份 · V22 结构多样性达标 ${divOk}/${R} 份`)
console.log('   ' + (uniq(rows.map((x) => x.sig)) === R && !dupFx && !dupTm && divOk === R
  ? '✓ 结论：连着做 ' + R + ' 份，四轴合成签名两两不同 —— 这就是"去同质化"的可复现验收'
  : '✗ 还有重复：看上面哪一列塌了'))
