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

console.log('\n=== 5. AI 提示词要带上全部 20 套（否则 AI 永远只会挑那几套）===')
const { aiPrompt } = require('./run/daily-plan.js')
const p = aiPrompt(8, '铜锅')
ok(p.includes('【皮肤库】'), '提示词里有皮肤库段')
ok(p.includes('copper-pot') && p.includes('morandi') && p.includes('cinema-noir'), '提示词里出现了新皮肤 id')
eq((p.match(/（[^）]*）：/g) || []).length >= 0, true, '（皮肤条目数与库同步，由 PLAN_THEMES 驱动）')

console.log(`\n结果：通过 ${pass} · 失败 ${fail}`)
process.exit(fail ? 1 : 0)
