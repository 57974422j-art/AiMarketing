#!/usr/bin/env node
/* check-product-freshness.mjs —— **产物新鲜度 + 缺产物分档**（team-lead ②b/②-④/③）
 *
 * 为什么：跨树"不一致"的真因就是**旧产物被当成证据**（探针侧 deck.master-v1 渲于 CSS 改动之前）。
 *   也覆盖"改了母版/字体忘了重渲"整类。
 *
 * 判据（对**声明清单**里的每个档，声明清单来自 `deck-targets.mjs` = 唯一实现）：
 *   · `产物 mp4` 的 mtime **必须 ≥ 该档输入集最新 mtime** ⇒ 不满足 **exit 1（红）**，文案点名最晚输入；
 *   · 声明档**缺产物** ⇒ **exit 4（需先渲染）**（与"判据失败"分开，服务器/CI 才能区分"还没渲染"与"真不合格"）；
 *   输入集（**按"渲染时真正读到的字节"定义**，team-lead ③-2）：
 *     ✅ `masters/<id>/` 下的 `master.json` / `master-<几何>.html` / `assets/` 全子树（`.css`/`.js`/`.woff2`）
 *        · `examples/<deck>.json` · `fonts/` 下的 `.woff2`
 *     ❌ **构建脚本**（`*.mjs` / `*.py`，如 `sync-master-fonts.mjs`）与 `chars-cmn.txt` —— 它们**改了自己不改变产物**
 *        （影响会经由**重新 materialize 的 woff2** 体现，而那已被纳入）⇒ 拿脚本 mtime 判陈旧是**语义错**（会造成假阳性）。
 *   · **档数 > 0 是断言**：0 档 ⇒ **exit 2**（"无事可查" ≠ "查过且通过"）。
 *   · 未声明产物（磁盘上有、声明清单没有）⇒ **打印一行"未声明产物（忽略）"**（不静默纳入/消失）。
 */
import { readdirSync, existsSync } from 'node:fs'
import { join, basename } from 'node:path'
import { pathToFileURL } from 'node:url'
import { ENGINE_ROOT, EXAMPLES_DIR, selfCheck } from './paths.mjs'
import { declaredDecks, hasMp4, mp4Of, undeclaredProducts, exclusions, exclusionsExpanded, mtime } from './deck-targets.mjs'

const ROOT = ENGINE_ROOT
const FONTS_DIR = join(ROOT, 'fonts')
const FMT = (ms) => new Date(ms).toISOString().slice(5, 16).replace('T', ' ')

/* 渲染时真正读到的字节：只认这些扩展名（脚本/txt 不计） */
const INPUT_EXT = /\.(html|json|css|js|woff2)$/i

const walkInputs = (dir) => {
  const out = []
  const go = (d) => {
    let es = []
    try { es = readdirSync(d, { withFileTypes: true }) } catch { return }
    for (const e of es) {
      if (e.isDirectory()) { if (!/^(out|node_modules|\.)/.test(e.name)) go(join(d, e.name)) }
      else if (INPUT_EXT.test(e.name)) out.push(join(d, e.name))
    }
  }
  if (existsSync(dir)) go(dir)
  return out
}

/** ★ **唯一实现**（供 `gate-release --render` 复用，避免第二套新鲜度判定）：返回声明档/缺产物/陈旧/未声明 */
export function evaluate() {
  let fontsMax = 0, fontsFile = ''
  for (const f of (existsSync(FONTS_DIR) ? readdirSync(FONTS_DIR).filter((x) => /\.woff2$/i.test(x)) : [])) {
    const p = join(FONTS_DIR, f); const m = mtime(p); if (m > fontsMax) { fontsMax = m; fontsFile = `fonts/${f}` }
  }
  const { decks, issues } = declaredDecks()
  const missing = [], stale = []
  for (const d of decks) {
    if (!hasMp4(d)) { missing.push(d); continue }
    let inMax = fontsMax, inFile = fontsFile
    const consider = (p) => { const m = mtime(p); if (m > inMax) { inMax = m; inFile = p.replace(ROOT + '\\', '').replace(ROOT + '/', '') } }
    consider(d.example)
    const mdir = join(ROOT, 'masters')
    for (const id of (existsSync(mdir) ? readdirSync(mdir, { withFileTypes: true }).filter((x) => x.isDirectory()).map((x) => x.name) : [])) {
      for (const f of walkInputs(join(mdir, id))) consider(f)
    }
    const am = mtime(mp4Of(d))
    if (am < inMax) stale.push({ deck: d.deck, outdir: d.outdir, am, inMax, inFile })
  }
  return { decks, issues, missing, stale, undeclared: undeclaredProducts() }
}

/* ---------- CLI（被 import 时不执行） ---------- */
if (import.meta.url !== pathToFileURL(process.argv[1] || '').href) { /* imported: 只暴露 evaluate() */ } else {
selfCheck({ quiet: true })
const { decks, issues, missing, stale: staleObjs, undeclared } = evaluate()
const stale = staleObjs.map((s) => `${s.deck}：产物 ${FMT(s.am)}（output-.mp4）< 输入 ${FMT(s.inMax)}（${s.inFile}）`)
if (issues.length) {
  console.error(`✗ 声明清单有问题（禁静默跳过）：`)
  for (const x of issues) console.error(`    · ${x}`)
  process.exit(1)
}
if (!decks.length) {
  console.error('✗ **检查 0 档** ⇒ exit 2（"无事可查" ≠ "查过且通过"；断言防"0 档假绿"）')
  process.exit(2)
}
console.log(`\n②b 产物新鲜度 + 缺产物分档：声明档 ${decks.length}（唯一来源 deck-targets.mjs）· 输入集 = masters/<id>/{master*.html,master.json,assets/**} ∪ examples/<deck>.json ∪ fonts/*.woff2`)
if (undeclared.length) {
  console.log(`  ℹ **未声明产物（忽略）**：${undeclared.length} 个 ⇒ ${undeclared.slice(0, 8).join(', ')}${undeclared.length > 8 ? ' …' : ''}`)
  console.log('      （磁盘上有但不在声明清单 ⇒ 不纳入判据；也不静默消失 —— 要判它就把它写进声明/排除表）')
}
if (missing.length) {
  console.error(`\n⚠ **缺产物 ${missing.length} 档** ⇒ **exit 4（需先渲染）**，与"判据失败"分开：`)
  console.error(`    ${missing.slice(0, 12).join(', ')}${missing.length > 12 ? ' …' : ''}`)
  console.error('    ⇒ 跑 `node gate-release.mjs --render`（渲完缺产物的声明档再判）或 `node render-deck.mjs examples/<deck>.json --outdir <out|out-master-v2>`')
}
if (stale.length) {
  console.error(`\n✗ **产物陈旧（需重渲）**：${stale.length} 档 —— 产物早于其输入（§25a：原始清单，未过滤）`)
  for (const s of stale) console.error(`    · ${s}`)
}
if (missing.length) process.exit(4)
if (stale.length) process.exit(1)
console.log(`  ✓ ${decks.length} 档全部有产物且新于其输入`)

// 排除表：**展开集合必须打印**（禁 glob ⇒ 新命中必须可见）
// （用行注释而非块注释：块注释里写 glob 路径会踩"星号+斜杠"连写 ⇒ 提前终止注释）
const exList = exclusions()
const exNames = exclusionsExpanded()
console.log(`  （排除表 ${exList.length} 条 · 展开 **${exNames.length} 个目录**（禁 glob）：${exNames.join(', ')}）`)
for (const e of exList) console.log(`     · [${e.category}] ${e.dirs.join(', ')} —— ${String(e.reason).slice(0, 70)}`)
console.log(`  （注：${basename(EXAMPLES_DIR)} 下反例由 bad-expected.json 声明，不由本脚本判）`)
}   // ← CLI 分支结束（被 import 时只暴露 evaluate()）
