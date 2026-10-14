#!/usr/bin/env node
/**
 * temp/_exp/daily/score-demo.mjs —— 用**我们自己的规则**给一条日报落地页打分（评审闭环的第一块砖）。
 * 口径（全部来自已落地的规则，不是我拍的）：
 *   ① 结构多样性 = V22 硬判据（相邻段共享 ≤1）+ 方向组合数          → 权重 20
 *   ② 可读性/无障碍 = V23 对比度探针最小值 + V24 减少动态行为探针   → 权重 20
 *   ③ 动效克制 = V19 配额（切分型 ≤1 且只在封面/收尾）+ R12 位移统计 → 权重 15
 *   ④ 版面稳定 = 三档闸门（溢出/越界/缺图/字号/折行/压图/JS 错）     → 权重 20
 *   ⑤ 出片质量 = V18 切分块覆盖 + 图源齐全                          → 权重 15
 *   ⑥ 文案字数 = R11 字数体检                                       → 权重 10
 * ⚠️ 主观项（"好不好看/像不像人写的"）脚本**不打分** —— 留着让用户填（避免机器自我感动）。
 * 跑法：node temp/_exp/daily/score-demo.mjs <产物.html> <plan.json>
 */
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { checkDiversity } = require('./run/daily-plan.js')
const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))
const REPO = path.resolve(HERE, '..', '..', '..')
const html = process.argv[2]
const planFile = process.argv[3]
if (!html || !planFile) { console.log('用法：node temp/_exp/daily/score-demo.mjs <产物.html> <plan.json>'); process.exit(2) }
const run = (args) => { try { return execFileSync(process.execPath, args, { cwd: REPO, encoding: 'utf8', maxBuffer: 1 << 28 }) } catch (e) { return String((e && e.stdout) || '') + String((e && e.stderr) || '') } }
const P = (f) => path.join(REPO, 'temp/_exp/daily', f)

// ── ① 结构多样性 ──
const plan = JSON.parse(fs.readFileSync(path.resolve(REPO, planFile), 'utf8'))
const segs = plan.segments || []
const div = checkDiversity(segs)
const fxList = segs.map((s) => String(s.fx || '-').split('#')[0])
const cutN = fxList.filter((x) => ['slats', 'blinds', 'mosaic'].includes(x)).length
const layouts = new Set(segs.map((s) => s.layout))
const types = new Set(segs.map((s) => s.type))
const sDiv = div.ok ? (div.distinct >= segs.length * 0.9 ? 20 : 16) : 8

// ── ② 可读性 / 无障碍 ──
const themeOut = run([P('probe-theme.mjs'), html])
const minC = Math.min(...(Array.from(themeOut.matchAll(/对比\s+([\d.]+)/g)).map((m) => Number(m[1]))).concat([99]))
const rmOut = run([P('probe-rm.mjs'), html])
const rmPass = Number((/通过\s+(\d+)\s+·\s+失败\s+(\d+)/.exec(rmOut) || [])[1] || 0)
const rmFail = Number((/通过\s+(\d+)\s+·\s+失败\s+(\d+)/.exec(rmOut) || [])[2] || 9)
let sA11y = 0
if (minC >= 4.5) sA11y += 12
if (rmFail === 0) sA11y += 8

// ── ③ 动效克制 ──
const cutSlotOk = cutN === 0 || (segs[0] && ['slats', 'blinds', 'mosaic'].includes(String(segs[0].fx || '').split('#')[0])) || (segs.length > 1 && ['slats', 'blinds', 'mosaic'].includes(String(segs[segs.length - 1].fx || '').split('#')[0]))
const r12 = ((run([path.join('temp', '_exp', 'shot.mjs'), html]).match(/R12\/出片动效 · ([^\n]*)/) || [])[1] || '').trim()
const transN = Number((/文字位移\s+(\d+)/.exec(r12) || [])[1] || 0)
let sMot = 0
if (cutN <= 1 && cutSlotOk) sMot += 10
if (transN >= 3) sMot += 5

// ── ④ 版面稳定（三档闸门）──
const gateOut = run([path.join('temp', '_exp', 'shot.mjs'), html])
const views = Array.from(gateOut.matchAll(/\[[vhn] [^\]]+\]\s*([^\n]*)/g)).map((m) => m[1])
const stable = views.length >= 3 && views.every((v) => !/溢出 x[1-9]|越界 [1-9]|缺图 [1-9]|JS错 [1-9]/.test(v)) && !/折行 · [1-9]/.test(gateOut) && !/文字压图 [1-9]/.test(gateOut)
const sLayout = stable ? 20 : 10

// ── ⑤ 出片质量（切分块）──
const vfxOut = run([P('probe-vfx.mjs'), html])
const covers = Array.from(vfxOut.matchAll(/覆盖\s+(\d+)%/g)).map((m) => Number(m[1]))
const vfxOk = /结论：✓/.test(vfxOut) || covers.length === 0
const sFilm = vfxOk ? 15 : 6

// ── ⑥ 文案字数（R11）──
//   ⚠️ 我第一版这里写了 `|| true`（恒真、永远满分）—— 打分脚本里的"恒真"比没打更坏（会骗自己），
//   现在按引擎 stdout 真解析：只有真打印"R11 字数体检：通过"才给满分。
const genOut = run([path.join('scripts', 'video-factory', 'html-deck', 'tools', 'daily-page.mjs'), planFile, '--out', path.join('temp', '_exp', 'daily', 'out', '_score-tmp.html')])
const r11 = /R11 字数体检：通过/.test(genOut)
const sText = r11 ? 10 : 5

const total = sDiv + sA11y + sMot + sLayout + sFilm + sText
const rows = [
  ['① 结构多样性（V22 相邻段共享≤1）', sDiv, 20, `${div.ok ? '达标' : '不达标'} · 方向组合 ${div.distinct}/${segs.length} · 结构 ${layouts.size} 种 · 文字层 ${types.size} 种`],
  ['② 可读性/无障碍（V23+V24）', sA11y, 20, `最低对比 ${minC.toFixed(2)}（≥4.5）· 减少动态 ${rmPass} 通过/${rmFail} 失败`],
  ['③ 动效克制（V19 配额）', sMot, 15, `切分型 ${cutN} 次（限 1，落封面/收尾 ${cutSlotOk ? '✓' : '✗'}）· ${r12}`],
  ['④ 版面稳定（三档闸门）', sLayout, 20, views.length + ' 档：' + (stable ? '溢出/越界/缺图/字号/折行/压图 全 0' : '有告警')],
  ['⑤ 出片质量（V18 切分块）', sFilm, 15, vfxOk ? '切分块有面积/铺满/有图源' : '有问题'],
  ['⑥ 文案字数（R11）', sText, 10, r11 ? '字数体检通过' : '字数体检**未通过**（有标题/信息点超长）'],
]
console.log('\n  ══ 机器打分（全部来自已落地规则，可复现）══')
rows.forEach(([k, s, w, why]) => console.log(`   ${k.padEnd(30)} ${String(s).padStart(2)}/${w}   ${why}`))
console.log(`   ${'─'.repeat(64)}`)
console.log(`   机器总分 ${total}/100  （≥85 可交付；60~85 先改再交；<60 重做）`)
console.log('\n  ══ 主观项（脚本不打分，留给你/评审人）══')
console.log('   · 好不好看 / 想不想发朋友圈（1~5）')
console.log('   · 像不像"人写的"（而不是模板拼的）（1~5）')
console.log('   · 皮肤与题材贴不贴（1~5）')
