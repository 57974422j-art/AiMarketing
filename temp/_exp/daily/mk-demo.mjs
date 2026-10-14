#!/usr/bin/env node
/**
 * temp/_exp/daily/mk-demo.mjs —— 用**我们自己的规则逻辑**组一条真落地页（供「d 减少动态」看效果）。
 * 纪律（不用 AI、不拍脑袋）：这一条的内容层完全走**服务端那套纯函数**，与线上同一条路：
 *   normSegs（结构/图数匹配 + 空框修正）→ fixDiversity（V22 相邻段共享 ≤1）→ assignFx（V19 效果配额）
 *   → buildPlanFromSegs（皮肤/图名表）。图片按 **A′（同级扁平名）** 落到与 HTML 同一个目录。
 * 跑法：node temp/_exp/daily/mk-demo.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { normSegs, fixDiversity, checkDiversity, assignFx, buildPlanFromSegs, themeName, PLAN_THEMES } = require('./run/daily-plan.js')

const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))
const REPO = path.resolve(HERE, '..', '..', '..')
const SRC = 'E:/ai-marketing/storage/1/餐饮素材'
const OUTDIR = path.join(REPO, 'temp/_exp/daily/out/demo-rm')
const ISSUE = '第 24 期'
const TOPIC = '铜锅涮肉 · 今日现拍'

// ── 1. 取 12 张真图，按 A′ 落成"与页面同级"的扁平名 ──
const files = fs.readdirSync(SRC).filter((f) => /\.jpe?g$/i.test(f)).sort()
const use = files.slice(0, 12)
if (use.length < 12) { console.log('  ⚠️ 素材不足 12 张（只有 ' + use.length + '）'); process.exit(1) }
fs.mkdirSync(OUTDIR, { recursive: true })
const names = use.map((f, i) => `gen_20261014_101_p${i + 1}.jpg`)
use.forEach((f, i) => fs.copyFileSync(path.join(SRC, f), path.join(OUTDIR, names[i])))

// ── 2. 内容层（12 张图全部用完，不重复用图）──
//   p1=满桌  p4=黑毛肚卷  p8=黑百叶+麻酱  p12=手切鲜肉（这四张我逐张看过，文案按实物写；
//   其余按"现拍/出品"这类**与具体菜品无关但成立**的说法，避免张冠李戴）
const raw = [
  { kind: 'cover', layout: 'hero', form: 'overlay', type: 'band', scale: 0.9, kicker: `${ISSUE} · 今日现拍`, stamp: '现拍',
    title: ['铜锅老汤', '手切上桌'], points: [['实拍', '原图'], ['细节', '特写']], imgs: [1], place: 'cover' },

  { kind: 'feature', layout: 'split', form: 'overlay', type: 'poster', scale: 0.92, kicker: '手切 · 现点现切',
    title: ['手切鲜肉', '现点现切'], points: [['切法', '手工'], ['上桌', '现涮']], imgs: [12], place: 'cover' },

  { kind: 'feature', layout: 'sticker', form: 'sticker', type: 'editorial', scale: 0.9, kicker: '百叶 · 蘸麻酱',
    title: ['黑百叶', '七上八下'], points: [['口感', '脆'], ['蘸料', '麻酱']], imgs: [8], place: 'cover' },

  { kind: 'feature', layout: 'vertical', form: 'vertical', type: 'grid', scale: 0.9, kicker: '毛肚 · 现切摆盘',
    title: ['黑毛肚', '纹理见功夫'], points: [['脆', '现切'], ['鲜', '当日']], imgs: [4], place: 'cover' },

  { kind: 'grid', layout: 'grid3', form: 'overlay', type: 'list', scale: 0.9, kicker: '今日三样 · 现拍',
    title: ['三样现拍', '锅里见'], points: [['锅底', '老汤'], ['出品', '现拍'], ['小料', '自取']], imgs: [2, 3, 6], place: 'cover' },

  { kind: 'feature', layout: 'quote', form: 'overlay', type: 'mono', scale: 0.9, kicker: '老汤 · 滚起来',
    title: ['老汤滚起来', '先下百叶'], points: [['第一筷', '百叶'], ['第二筷', '手切']], imgs: [5], place: 'cover' },

  { kind: 'grid', layout: 'grid4', form: 'overlay', type: 'outline', scale: 0.9, kicker: '四样出品 · 现拍',
    title: ['四样出品', '一桌够'], points: [['荤', '手切'], ['脆', '百叶'], ['滑', '现打'], ['鲜', '当日']], imgs: [7, 9], place: 'cover' },

  { kind: 'feature', layout: 'stack2', form: 'overlay', type: 'label', scale: 0.9, kicker: '两张 · 前后对照',
    title: ['前后两张', '都在锅里'], points: [['前', '上桌'], ['后', '入锅']], imgs: [10, 11], place: 'cover' },
]

const norm = normSegs(raw, use.length, TOPIC)
const segs = norm.segs
const divBefore = checkDiversity(segs)
const dv = fixDiversity(segs)
const divAfter = checkDiversity(segs)
assignFx(segs, 20261014)                       // ★V19 配额：切分型整片最多 1 次、落在封面或收尾

const plan = buildPlanFromSegs(segs, TOPIC, 'normal', 'copper-pot', undefined, names)
fs.writeFileSync(path.join(REPO, 'temp/_exp/daily/plan-demo.json'), JSON.stringify(plan, null, 1), 'utf8')

console.log(`  图片 ${use.length} 张 ⇒ 扁平名 ${names[0]} … ${names[names.length - 1]}（与页面同级）`)
console.log(`  皮肤 ${plan.meta.theme}（${themeName(plan.meta.theme)}）· 段数 ${segs.length}`)
console.log(`  normSegs 修正 ${norm.fixes.length} 条 / 补段 ${norm.added}`)
console.log(`  V22 去同质化：修前 ${divBefore.ok ? '达标' : '不达标 ' + JSON.stringify(divBefore.bad)} → 修了 ${dv.fixed} 处 → 修后 ${divAfter.ok ? '达标' : '仍不达标'}（方向组合数 ${divAfter.distinct}）`)
console.log('  ── 段表（结构 / 形式 / 文字层 / 动效 / 图）──')
segs.forEach((s, i) => {
  console.log(`   ${String(i + 1).padStart(2)}  ${String(s.layout).padEnd(9)} ${String(s.form).padEnd(8)} ${String(s.type).padEnd(9)} ${String(s.fx || '-').padEnd(9)} v${s.scale}  img${(s.imgs || []).join(',')}  「${(s.title || []).join(' / ')}」`)
})
console.log('  → ' + path.relative(REPO, path.join(REPO, 'temp/_exp/daily/plan-demo.json')))
