#!/usr/bin/env node
/**
 * temp/_exp/daily/e2e-v19.mjs —— ★VF_DAILY_V19（A′）**端到端模拟**：
 *   按服务端真实顺序走一遍：段 → assignFx（配额）→ buildPlanFromSegs（带图名表）→ 引擎出件，
 *   再核对三件事：
 *     ① 图引用 = **同级扁平名**（不再 images/N.jpg）；
 *     ② 切分型**只出现 1 次**且在封面或收尾；其余全是安静组；
 *     ③ 把出件丢给 `rewriteRelativeRefs`（= 客户端预览那条路）能拿到 N 条站内签名短链。
 * 跑法：node temp/_exp/daily/e2e-v19.mjs [段数]
 */
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { assignFx, buildPlanFromSegs, DAILY_FX_CUT, DAILY_FX_QUIET, assignTextLayer, checkDiversity, fixDiversity } = require('./run/daily-plan.js')
const { rewriteRelativeRefs } = require('./run2/html-rewrite.js')

const REPO = process.cwd()
const N = Math.max(3, Math.min(15, Number(process.argv[2]) || 10))
const LAYOUTS = ['hero', 'split', 'vertical', 'sticker', 'grid3', 'stack2', 'grid4', 'quote']

const segs = Array.from({ length: N }, (_, i) => ({
  kind: i === 0 ? 'cover' : (i === N - 1 ? 'end' : 'feature'),
  layout: LAYOUTS[i % LAYOUTS.length],
  kicker: `第 0${(i % 9) + 1} 期 · 素材`,
  stamp: i === 0 ? '封面故事' : '',
  title: [`第${i + 1}段标题`, '现场记录'],
  imgs: i % 5 === 4 ? [((i * 2) % N) + 1, ((i * 2 + 1) % N) + 1] : [i + 1],
  points: [['实拍', '原图'], ['细节', '特写']],
  place: 'cover',
  form: 'overlay',
}))
// 服务端真实顺序：先排效果序（配额）→ 再排文字层（轮换）→ **去同质化自检/错开**（V22）→ 组装 cfg
assignFx(segs, 3)
assignTextLayer(segs, 3)
const dv0 = checkDiversity(segs, 1)
const fx1 = dv0.ok ? { fixed: 0, left: 0, msgs: [] } : fixDiversity(segs, 1)
const dv1 = checkDiversity(segs, 1)
console.log('  ── 去同质化自检（V22）──')
console.log('  相邻冲突（初检）：' + dv0.bad.length + ' 处 ｜ 错开 ' + fx1.fixed + ' 处 ｜ 复检冲突 ' + dv1.bad.length + ' 处'
  + ' ｜ 方向组合 ' + dv0.distinct + ' → ' + dv1.distinct + ' 种（目标 ≥' + dv0.want + '）')
const imageNames = Array.from({ length: N }, (_, i) => `gen_20261013_0${(20 + i)}.jpg`)
const plan = buildPlanFromSegs(segs, '端到端模拟', 'normal', 'night-gold', undefined, imageNames)

const cfg = path.join(REPO, 'temp', '_exp', 'daily', 'out', 'e2e-v19.json')
const out = path.join(REPO, 'temp', '_exp', 'daily', 'out', 'e2e-v19.html')
fs.mkdirSync(path.dirname(cfg), { recursive: true })
fs.writeFileSync(cfg, JSON.stringify(plan, null, 1), 'utf8')
const r = spawnSync(process.execPath, [path.join(REPO, 'scripts', 'video-factory', 'html-deck', 'tools', 'daily-page.mjs'), cfg, '--out', out], { cwd: REPO, encoding: 'utf8', timeout: 120000 })
const t = fs.readFileSync(out, 'utf8')

console.log('  ── ① 图引用 ──')
const flat = (t.match(new RegExp(imageNames[0].replace('.', '\\.'), 'g')) || []).length
const legacy = (t.match(/images\/\d+\.jpg/g) || []).length
console.log('  同级扁平名出现 ' + flat + ' 处 ｜ 老口径 images/N.jpg 残留 ' + legacy + ' 处 ' + (legacy === 0 ? '✓' : '✗'))

console.log('  ── ② 效果配额 ──')
const secs = t.match(/<section class="sec"[\s\S]*?<\/section>/g) || []
const fx = secs.map((s) => (s.match(/data-fx="([a-z]+)"/) || [, '-'])[1])
const cuts = []
fx.forEach((x, i) => { if (DAILY_FX_CUT.includes(x)) cuts.push(i + 1) })
console.log('  效果序 ' + fx.join(' → '))
console.log('  切分型段号 [' + cuts.join(',') + '] 共 ' + cuts.length + ' 次（期望 ≤1；且为 1 或 ' + N + '）'
  + (((cuts.length <= 1) && (!cuts.length || cuts[0] === 1 || cuts[0] === N)) ? ' ✓' : ' ✗'))
console.log('  安静组段数 ' + fx.filter((x) => DAILY_FX_QUIET.includes(x)).length + '/' + N
  + ((fx.filter((x) => DAILY_FX_QUIET.includes(x)).length >= N - 1) ? ' ✓' : ' ✗'))

console.log('  ── ③ 客户端预览那条改写 ──')
const rw = rewriteRelativeRefs(t, 1)
console.log('  改写 ' + rw.done + ' 处 ｜ 用到图名 ' + rw.names.length + ' 个 ｜ 产出 /f/ 短链 '
  + ((rw.html.match(/\/f\/1\/[^"]+/g) || []).length) + ' 条')
console.log('  再跑一遍（幂等）: ' + rewriteRelativeRefs(rw.html, 1).done + ' 处（期望 0）')

const okAll = legacy === 0 && flat > 0 && cuts.length <= 1 && rw.done > 0
console.log('\n  结论：' + (okAll ? '✓ 端到端符合 A′ 口径' : '✗ 有不符项，见上'))
console.log(String(r.stdout || '').split('\n').filter((l) => /自检|体检|生成/.test(l)).map((l) => '  ' + l.trim()).join('\n'))
process.exit(okAll ? 0 : 1)
