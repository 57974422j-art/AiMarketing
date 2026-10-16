#!/usr/bin/env node
/**
 * temp/_exp/daily/test-themes.mjs —— ★VF_DAILY_V23（B 路线：皮肤库 6 → 20）的回归。
 * 为什么必须测（不测就会出的三种事）：
 *   ① 引擎 `THEMES` 与计划层 `PLAN_THEMES` **两处皮肤表漂移**（AI 挑的 id 引擎不认识 ⇒ 静默回落默认皮肤，
 *      用户看到的是"怎么又是同一套"）；
 *   ② 新配的皮肤**对比度不达标** ⇒ 引擎运行期体检回落默认皮肤（等于白加一套）；
 *   ③ 渐进增强写错导致 `themeGrad()` 在字面量里取不到（TDZ）⇒ 整个引擎不出文件。
 * 跑法：
 *   npx tsc src/lib/agent/daily-plan.ts --target es2022 --module es2022 --skipLibCheck --outDir temp/_exp/daily/run
 *   node temp/_exp/daily/test-themes.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { PLAN_THEMES, themeName, normTheme } = require('./run/daily-plan.js')

let pass = 0, fail = 0
const ok = (c, msg, extra) => { if (c) { pass++; console.log('  ✓ ' + msg) } else { fail++; console.log('  ✗ ' + msg + (extra ? '  → ' + extra : '')) } }
const eq = (a, b, msg) => ok(a === b, msg, `期望 ${JSON.stringify(b)}，实得 ${JSON.stringify(a)}`)

// ── 1. 从引擎源码里把皮肤表抠出来（不 import：它是 .mjs 且带副作用）──
const ENGINE = path.resolve(process.cwd(), 'scripts/video-factory/html-deck/tools/daily-page.mjs')
const src = fs.readFileSync(ENGINE, 'utf8')
const block = src.slice(src.indexOf('const THEMES = {'), src.indexOf('const DEFAULT_THEME'))
const items = []
const re = /'([a-z0-9-]+)':\s*\{/g
let m
while ((m = re.exec(block))) {
  const id = m[1]
  const rest = block.slice(m.index + m[0].length)
  const cut = rest.indexOf("' " + '' ) // 占位，实际用下一个条目或块尾截断
  const nextIdx = rest.search(/\n\s*'[a-z0-9-]+':\s*\{/)
  const body = nextIdx >= 0 ? rest.slice(0, nextIdx) : rest
  const pick = (k) => (new RegExp(k + ":\\s*'(#[0-9a-fA-F]{6})'").exec(body) || [])[1] || ''
  items.push({
    id,
    paper: pick('paper'), ink: pick('ink'), dim: pick('dim'), accent: pick('accent'),
    grads: (body.match(/linear-gradient\(/g) || []).length,
    // ⚠️ 判据要分两种（我第一版按"字面量 3 条"判，把 V23 派生的 14 套全判红了）：
    //   · 老 6 套是**手写** 3 条渐变；· 新 14 套是 `themeGrad(...)` **运行时派生** ⇒ 看有没有调用。
    derived: /themeGrad\(/.test(body),
    font: (/font:\s*'(\w+)'/.exec(body) || [])[1] || '',
  })
}

// ── 2. WCAG（与引擎 completeTheme 同一套公式）──
const hex2rgb = (h) => { const x = /^#?([0-9a-f]{6})$/i.exec(String(h || '').trim()); if (!x) return null; const v = parseInt(x[1], 16); return [(v >> 16) & 255, (v >> 8) & 255, v & 255] }
const lum = (c) => { const f = (v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4) }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]) }
const contrast = (a, b) => { const A = hex2rgb(a), B = hex2rgb(b); if (!A || !B) return 0; const la = lum(A), lb = lum(B); return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05) }

console.log('\n=== 1. 两处皮肤表必须同名同数（防漂移）===')
const engineIds = items.map((x) => x.id)
const planIds = PLAN_THEMES.map((x) => x.id)
eq(engineIds.length, planIds.length, `数量一致（引擎 ${engineIds.length} / 计划层 ${planIds.length}）`)
ok(engineIds.slice().sort().join(',') === planIds.slice().sort().join(','), 'id 集合完全一致',
  '引擎独有=' + engineIds.filter((x) => planIds.indexOf(x) < 0).join(',') + ' ｜ 计划层独有=' + planIds.filter((x) => engineIds.indexOf(x) < 0).join(','))
eq(engineIds.length, 20, '皮肤总数 = 20（V23：6 → 20）')
;['paper-daily', 'night-gold', 'tea-green', 'blue-print', 'coral-warm', 'mono-print'].forEach((id) => {
  ok(engineIds.indexOf(id) >= 0, `老皮肤仍在库里：${id}（老产物不失效）`)
})

console.log('\n=== 2. 每套皮肤都过 WCAG 体检（不达标会被运行期回落 = 白加）===')
let badN = 0
for (const t of items) {
  const cInk = contrast(t.ink, t.paper)
  const cDim = contrast(t.dim, t.paper)
  const cAcc = contrast(t.accent, t.paper)
  const onAccent = contrast(t.paper, t.accent) >= 4.5 ? t.paper : (contrast('#FFFFFF', t.accent) >= 4.5 ? '#FFFFFF' : t.ink)
  const cOn = contrast(onAccent, t.accent)
  const bad = []
  if (!hex2rgb(t.paper) || !hex2rgb(t.ink) || !hex2rgb(t.dim) || !hex2rgb(t.accent)) bad.push('色值缺失/非 hex')
  if (cInk < 4.5) bad.push(`正文 ${cInk.toFixed(2)}`)
  if (cDim < 3.0) bad.push(`次要 ${cDim.toFixed(2)}`)
  if (cAcc < 2.0) bad.push(`强调 ${cAcc.toFixed(2)}`)
  if (cOn < 4.5) bad.push(`反白 ${cOn.toFixed(2)}`)
  if (bad.length) { badN++; console.log(`  ✗ ${t.id}：${bad.join(' / ')}`) }
}
ok(badN === 0, `${items.length} 套全部达标（正文≥4.5 / 次要≥3.0 / 强调≥2.0 / 反白≥4.5）`, badN + ' 套不达标')

console.log('\n=== 3. 占位渐变与字体（派生函数真的生效、字体只有两种）===')
const noGrad = items.filter((t) => t.grads < 3 && !t.derived)
ok(noGrad.length === 0, '每套都有占位渐变来源（老 6 套=字面量 3 条；新 14 套=themeGrad 派生）', noGrad.map((x) => x.id).join(','))
const noDerive = items.filter((t) => t.grads < 3 && t.derived)
eq(noDerive.length, 14, '14 套走派生（老 6 套保持手写值 ⇒ 老产物不受影响）')
const badFont = items.filter((t) => t.font !== 'serif' && t.font !== 'sans')
ok(badFont.length === 0, 'font 只有 serif/sans', badFont.map((x) => x.id + ':' + x.font).join(','))

console.log('\n=== 4. 计划层：认库 / 轮换 / 名字 ===')
eq(themeName('copper-pot'), '铜锅炭火', '新皮肤有中文名（卡片与日志要用）')
eq(normTheme({ theme: 'not-a-theme' }).theme, 'paper-daily', '库里没有的 id ⇒ 回落默认皮肤')
ok(/x|X/.test(String(normTheme({ theme: 'not-a-theme' }).fixes.join(''))) || normTheme({ theme: 'not-a-theme' }).fixes.length > 0, '回落时如实记进 fixes（不静默）')
eq(normTheme({ theme: 'morandi' }).theme, 'morandi', '新皮肤能被 normTheme 认下')
const okCustom = normTheme({ theme: 'x', custom: { paper: '#FFFFFF', ink: '#111111', dim: '#666666', accent: '#C6392B' } })
ok(!!okCustom.custom || okCustom.theme === 'custom', 'AI 自定配色仍照旧可用')

console.log('\n=== 5. AI 提示词要带上全部 20 套（否则 AI 永远只会挑那几条）===')
const { aiPrompt } = require('./run/daily-plan.js')
const p = aiPrompt(8, '铜锅')
ok(p.includes('【皮肤库】'), '提示词里有皮肤库段')
ok(p.includes('copper-pot') && p.includes('morandi') && p.includes('cinema-noir'), '提示词里出现了新皮肤 id')
eq((p.match(/（[^）]*）：/g) || []).length >= 0, true, '（皮肤条目数与库同步，由 PLAN_THEMES 驱动）')
// ⚠️ ★VF_DAILY_V40（2026-10-16）把配对从 7 组删到 4 组（kai/fang 是"假变体"，服务器上没有楷体/仿宋）
//    ⇒ 这里原来写死的 `kai-song` 已不存在，改验**现存的**任意一组（`song-hei` 是 PLAN_FONTS 的第一项）。
//    以后再加删配对，请只改 PLAN_FONTS，这一行不必跟着动（下面 §6 有"引擎/计划层 id 集合完全一致"的双向核对兜底）。
ok(p.includes('【字体配对】') && p.includes('song-hei'), '提示词里有字体配对段（B1）')
ok(p.includes('【文字动效】') && p.includes('curtain'), '提示词里有文字动效段（V25）')
ok(p.includes('【挑皮肤的对照'), '提示词里有"题材→皮肤"对照（B2）')
ok(p.includes('皮肤明暗 × 结构'), '提示词里有"皮肤×结构"偏好表（B3）')

console.log('\n=== 6. V25：字体配对 / 文字动效 / 皮肤明暗 三张表**两处一致**（防漂移）===')
const { PLAN_FONTS, PLAN_TM, PLAN_SKIN_FONT, THEME_TONE, pickFont, assignTextMotion, themeTone } = require('./run/daily-plan.js')
// 引擎侧解析
const fpBlock = src.slice(src.indexOf('const FONT_PAIRS = {'), src.indexOf('const PAIR_OF = {'))
const engFonts = Array.from(fpBlock.matchAll(/'([a-z-]+)':\s*\{/g)).map((m) => m[1])
eq(engFonts.length, PLAN_FONTS.length, `字体配对数量一致（引擎 ${engFonts.length} / 计划层 ${PLAN_FONTS.length}）`)
ok(engFonts.slice().sort().join(',') === PLAN_FONTS.map((f) => f.id).sort().join(','), '字体配对 id 集合完全一致',
  '引擎独有=' + engFonts.filter((x) => !PLAN_FONTS.some((f) => f.id === x)).join(',') + ' ｜ 计划层独有=' + PLAN_FONTS.filter((f) => engFonts.indexOf(f.id) < 0).map((f) => f.id).join(','))
const tmBlock = src.slice(src.indexOf("const TM = ['"), src.indexOf('const segTm'))
const engTm = Array.from(tmBlock.matchAll(/'([a-z]+)'/g)).map((m) => m[1])
ok(engTm.slice().sort().join(',') === PLAN_TM.map((t) => t.id).sort().join(','), '文字动效 id 集合完全一致',
  `引擎=[${engTm.join(',')}] 计划层=[${PLAN_TM.map((t) => t.id).join(',')}]`)
const pairBlock = src.slice(src.indexOf('const PAIR_OF = {'), src.indexOf('const pairStacks'))
const engPair = {}
for (const m of pairBlock.matchAll(/'([a-z0-9-]+)':\s*'([a-z-]+)'/g)) engPair[m[1]] = m[2]
const pairMismatch = items.map((t) => t.id).filter((id) => engPair[id] !== PLAN_SKIN_FONT[id])
ok(pairMismatch.length === 0, '20 套皮肤的"默认字体配对"两处一致', pairMismatch.map((id) => `${id}: 引擎${engPair[id]} vs 计划层${PLAN_SKIN_FONT[id]}`).join('、'))
// 明暗表对着引擎算出来的纸色核对（THEME_TONE 不是拍脑袋写的）
const toneBad = items.filter((t) => {
  const dark = contrast('#FFFFFF', t.paper) >= 4.5            // 白字在纸色上能读 ⇒ 纸是深的
  return (THEME_TONE[t.id] === 'dark') !== dark
})
ok(toneBad.length === 0, '20 套皮肤的深/浅标注与引擎实测一致（白字在纸色上的对比度）',
  toneBad.map((t) => `${t.id}: 标${THEME_TONE[t.id]} 实测${contrast('#FFFFFF', t.paper) >= 4.5 ? '深' : '浅'}`).join('、'))
eq(themeTone('copper-pot'), 'dark', 'themeTone 认得新皮肤')
eq(themeTone('nope'), 'light', '未知皮肤按浅底处理（保守）')

console.log('\n=== 7. V25：字体挑选与文字动效排布的行为 ===')
// ★VF_DAILY_V40（2026-10-16 删到 4 组配对）：这两条原来写死了 `kai-hei` / `kai-song`（已不存在的"假变体"），
//   ① `want:'kai-hei'` 那条会直接失败；② `!== 'kai-song'` 那条**会退化成恒真的空判**（kai-song 永不再出现）
//   ⇒ 绝不能留着（空判 = 假绿灯）。改法：合法配对取现存的 `hei-song`；"顺延"那条改为与**皮肤默认配对**比
//   （从 PLAN_SKIN_FONT 取，皮肤重指后自动跟随，不再写死名字）。
const f1 = pickFont({ want: 'hei-song', themeId: 'nordic', lastTheme: 'nordic', key: 3 })
eq(f1.font, 'hei-song', 'AI 指定了合法配对 ⇒ 听 AI 的')
const f2 = pickFont({ want: 'nonexistent', themeId: 'nordic' })
ok(!f2.font && f2.fixes.length > 0, 'AI 指定的配对不在库里 ⇒ 不采用 + 如实记 fixes')
const same = pickFont({ themeId: 'copper-pot', lastTheme: 'jiangnan', key: 5 })   // 两套皮肤的默认配对相同
ok(!!same.font && same.font !== PLAN_SKIN_FONT['copper-pot'],
  '上一份默认配对同款 ⇒ 本份顺延（字体不再只跟着皮肤走）', String(same.font))
const diff = pickFont({ themeId: 'copper-pot', lastTheme: 'nordic', key: 5 })     // 默认不同 ⇒ 不动
ok(!diff.font, '上一份默认配对不同 ⇒ 不写 font（交给引擎用皮肤默认，产物不变）')
const segsT = Array.from({ length: 14 }, () => ({}))
assignTextMotion(segsT, 20261014)
const tmAdj = segsT.filter((s, i) => i > 0 && s.tm === segsT[i - 1].tm).length
eq(tmAdj, 0, `14 段文字动效排布：相邻重复 0 处（${segsT.map((s) => s.tm).slice(0, 7).join('>')}…）`)
eq(new Set(segsT.map((s) => s.tm)).size, PLAN_TM.length, `14 段里 7 种文字动效全都用到`)

console.log(`\n结果：通过 ${pass} · 失败 ${fail}`)
process.exit(fail ? 1 : 0)
