#!/usr/bin/env node
/**
 * crosscheck-deck-json.mjs —— **deck JSON 真渲染路**（"双路交叉校验"的第二路；team-lead 要求）
 *
 * 为什么需要它：量表 `measure-sweep.mjs` 用的是 **HTML 注入法**（在已渲染产物里替换文字再测）。
 * 若"注入方式"本身引入偏差（例如改了 DOM 却漏了别处引用同一文案的地方），量表给出的上限就不可复核。
 * ⇒ 本工具走**源头路**：改 `examples/` 下各 deck JSON 的**字段**（如 `meta.title`）→ **真渲染** → 同一个判据闸门读结论。
 *
 * 用法：
 *   node crosscheck-deck-json.mjs --json examples/deck.master-v1.json --field meta.title \
 *        --cls cover-title --ks 36,37,38 [--outdir out-xcheck] [--pathA 37]
 *
 * 输出（每 k 一行，**两路都报原始读数**）：
 *   k · 读回长度 · 门 exit · 判据内 codes（稳定帧原文）· 结论
 * 判读规则（team-lead）：**两路不一致 ⇒ 先查"注入方式是否引入偏差"**；不许取平均、不许以某一路为准。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DECK_DIR } from './paths.mjs'
import { resolveHyperframes } from './engine-bin.mjs'
import { pageNoOfSelector, settledAt } from './timing.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const args = process.argv.slice(2)
const arg = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d }
const NODE = process.execPath
const JSONF = arg('--json', 'examples/deck.master-v1.json')
const FIELD = arg('--field', 'meta.title')
const CLS = arg('--cls', 'cover-title')
const KS = String(arg('--ks', '37,38')).split(',').map((s) => Number(s.trim())).filter((n) => Number.isFinite(n))
const OUT = arg('--outdir', 'out-xcheck')
const PATH_A = arg('--pathA', '')          // 第一路（HTML 注入）给出的临界，仅用于打印对照

/** 深设 `a.b.c` 路径字段 */
function setPath(obj, path, val) {
  const parts = path.split('.')
  let cur = obj
  for (let i = 0; i < parts.length - 1; i++) {
    const p = /^\d+$/.test(parts[i]) ? Number(parts[i]) : parts[i]
    if (cur[p] == null) cur[p] = {}
    cur = cur[p]
  }
  const last = /^\d+$/.test(parts[parts.length - 1]) ? Number(parts[parts.length - 1]) : parts[parts.length - 1]
  cur[last] = val
}

const src = resolve(DECK_DIR, JSONF)
if (!existsSync(src)) { console.error(`✗ 找不到 deck JSON：${src}（§25b ⇒ exit 2）`); process.exit(2) }
const base = JSON.parse(readFileSync(src, 'utf8'))
const outRoot = resolve(DECK_DIR, OUT)
mkdirSync(outRoot, { recursive: true })
const HF = resolveHyperframes().p        // ★ 返回 {p, why}（`resolveHyperframes().p` 才是可执行路径；与 measure-sweep 同口径）

console.log(`=== deck JSON 真渲染路（第二路）===`)
console.log(`  源 = ${JSONF} · 字段 = ${FIELD} · 检测点 = .${CLS} · 变体 k = [${KS.join(', ')}] · 出目录 = ${OUT}${PATH_A ? ` · 第一路(HTML 注入)临界 = ${PATH_A}` : ''}`)
const rows = []
for (const k of KS) {
  const variant = JSON.parse(JSON.stringify(base))
  setPath(variant, FIELD, '汉'.repeat(k))
  const vj = join(outRoot, `deck-k${k}.json`)
  writeFileSync(vj, JSON.stringify(variant, null, 2), 'utf8')
  const deckName = basename(vj).replace(/\.json$/, '')
  /* ⚠️ **不许** `shell: true`：Windows 下 `process.execPath` 含空格（`C:\Program Files\nodejs\…`）
     ⇒ shell 拼接会把路径拆坏（实测：三行全"渲染 ✗"）。传数组、不用 shell 即可（§25a：失败原因要原样打印）。 */
  const r = spawnSync(NODE, [join(HERE, 'render-deck.mjs'), vj, '--outdir', join(DECK_DIR, OUT)], { cwd: HERE, encoding: 'utf8' })
  const prod = join(DECK_DIR, OUT, deckName)
  const renderOk = r.status === 0 && existsSync(join(prod, 'index.html'))
  if (!renderOk) {
    const tail = ((r.stdout || '') + (r.stderr || '')).split('\n').map((s) => s.trim()).filter(Boolean).slice(-4)
    console.log(`  k=${k} 渲染失败 exit=${r.status} ⇒ 原样末 4 行：`)
    for (const l of tail) console.log(`      ${l.slice(0, 170)}`)
  }
  // ① 读回（注入是否生效）：产物 HTML 里目标元素文本长度
  let back = -1
  if (renderOk) {
    const html = readFileSync(join(prod, 'index.html'), 'utf8')
    const m = new RegExp(`<([a-z0-9]+)\\b[^>]*class="[^"]*\\b${CLS}\\b[^"]*"[^>]*>([\\s\\S]*?)</\\1>`, 'i').exec(html)
    back = m ? m[2].replace(/<[^>]+>/g, '').trim().length : -1
  }
  // ② 判据码：在"该字段所在页的稳定帧"上直接问引擎（`timing.mjs` 唯一实现）
  let codes = [], at = '', no = ''
  if (renderOk) {
    const n = pageNoOfSelector(prod, CLS) || 1
    const st = settledAt(prod, n)
    if (st) {
      no = n; at = st.at.toFixed(3)
      const cr = spawnSync(HF, ['check', prod, '--json', '--at', at, '--no-contrast'], { encoding: 'utf8', shell: true })
      const out = String(cr.stdout || '')
      const i = out.indexOf('{')
      try {
        const j = JSON.parse(out.slice(i))
        codes = (j.layout?.findings || []).map((f) => String(f.code))
      } catch { codes = ['(JSON 不可解析)'] }
    }
  }
  // ③ 闸门口径（与量表的判据**同一套**：--assert-overlap --assert-decor）
  let gateExit = null, gateVerdict = ''
  if (renderOk) {
    const g = spawnSync(NODE, [join(HERE, 'check-engine-lint.mjs'), prod, '--assert-overlap', '--assert-decor', '--no-contrast'], { cwd: HERE, encoding: 'utf8', shell: true })
    gateExit = g.status
    gateVerdict = String((g.stdout || '')).split('\n').map((s) => s.trim()).filter((s) => /^结论:/.test(s)).pop() || ''
  }
  rows.push({ k, renderOk, back, at, no, codes, gateExit, gateVerdict })
  console.log(`  k=${String(k).padStart(3)} · 渲染 ${renderOk ? 'ok' : '✗'} · 读回 ${back}/${k}${back === k ? ' ✓' : ' ✗'} · 页 ${no || '-'} · 稳定帧 t=${at || '-'} · 判据内 codes = [${codes.join(', ')}] · 闸门 exit=${gateExit} · ${gateVerdict}`)
}
/* 双路对照（只对"临界 / 临界+1"两个点做定论；多 k 只是旁证） */
const bad = rows.filter((r) => !r.renderOk || r.back !== r.k)
if (bad.length) { console.error(`✗ 有 ${bad.length} 行渲染失败或读回不符 ⇒ **读数无意义**（§25b：先过读回再谈读数）⇒ exit 2`); process.exit(2) }
console.log(`\n  判读：每行都以 **闸门同一判据**（--assert-overlap --assert-decor）在**该字段所在页的稳定帧**上读结论；`)
console.log(`        第一路（HTML 注入）临界 = ${PATH_A || '(未提供)'}；两路不一致 ⇒ **先查注入方式是否引入偏差**（不许取平均/不许以某一路为准）。`)
/* 退出码：本工具只负责"把第二路的原始读数取回来"（读数可信 = 渲染成功且读回 == k，否则上面已 exit 2）；
   两路是否一致由**人/表**判定（不许工具替我们下"哪一路为准"的结论）。 */
process.exit(0)
