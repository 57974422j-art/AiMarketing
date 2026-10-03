#!/usr/bin/env node
/* check-probe-paths.mjs —— ⓪e **陈旧路径断言**（team-lead ④-3）
 *
 * 为什么：`dist-rel/` 整体被 `.gitignore` 吞掉（`.gitignore:63`）⇒ **不可分发**。
 *   tracked 里写它 = "用户/服务器照做就炸"（本会话真实踩过：docs 误删 + v1 PARAMS 真源判错）。
 *
 * 规矩（第二版，按 team-lead 实测修正）：
 *   · **扫描面 = 全部文本文件**：`.md/.json/.mjs/.cjs/.py/.html`（**递归到入库根下 3 层** + `fonts/`）。
 *     ⚠️ 第一版把扫描面收窄到 `*.md`+`*.json` ⇒ **有盲区**（`fonts/make-fonts.py` 的注释、
 *     `check-docs-fork.mjs` 里的**布局探测真代码**都被漏掉）。自匹配**不靠缩小面**解决，靠**逐条白名单**。
 *   · 命中一律要**登记**：可执行指引 ⇒ 改指入库根；注释/布局探测 ⇒ 进 `probe-path-allowlist.json`
 *     （`file` + `snippet` + `reason` + `category` 必填；`snippet` 收窄到那一行）。
 *   · 仅**两处结构性豁免**（会打印理由）：① 本文件自身（必须写出待查词）② 白名单文件自身（`_note` 必须描述它）。
 *
 * 退出码：0 = 无未登记引用 · 1 = 有（红）· 2 = 环境/白名单错（§25b）
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join, dirname, relative, basename } from 'node:path'
import { DECK_DIR, ENGINE_ROOT, selfCheck } from './paths.mjs'

selfCheck({ quiet: true })

const NEEDLE = 'dist-rel'                     // 待查词（`dist-rel/probe-hf` 与单独 `dist-rel/` 都算）
const ALLOW_FILE = join(DECK_DIR, 'probe-path-allowlist.json')
const SELF_EXEMPT = new Set(['check-probe-paths.mjs', 'probe-path-allowlist.json'])
const TEXT_EXT = /\.(md|json|mjs|cjs|py|html)$/i
const SKIP_DIR = /^(out|node_modules|evidence|cs-test|seek-test|examples|masters|\.)/

let allow = []
if (existsSync(ALLOW_FILE)) {
  try { allow = JSON.parse(readFileSync(ALLOW_FILE, 'utf8')).allow || [] } catch (e) {
    console.error(`✗ 白名单解析失败：${ALLOW_FILE} —— ${e.message}（§25b ⇒ exit 2）`)
    process.exit(2)
  }
}
/* 字段名统一：一律按 `x.reason || x.why` 读（两者都缺才算缺） */
const badEntry = allow.filter((a) => !a.file || !(a.reason || a.why))
if (badEntry.length) {
  console.error(`✗ 白名单有 ${badEntry.length} 条缺 file/reason ⇒ exit 2（不许静默豁免）`)
  process.exit(2)
}

const targets = []
const collect = (dir, depth = 0) => {
  let es = []
  try { es = readdirSync(dir, { withFileTypes: true }) } catch { return }
  for (const e of es) {
    if (e.isDirectory()) {
      if (!SKIP_DIR.test(e.name) && depth < 3) collect(join(dir, e.name), depth + 1)
      continue
    }
    if (SELF_EXEMPT.has(e.name)) continue
    if (TEXT_EXT.test(e.name)) targets.push(join(dir, e.name))
  }
}
collect(DECK_DIR)
const fontsDir = join(ENGINE_ROOT, 'fonts')   // ★ 必须用 ENGINE_ROOT（flat 下 DECK_DIR===引擎根，`dirname` 会指错 ⇒ 扫不到真 fonts/）
if (existsSync(fontsDir)) collect(fontsDir)

const bad = []
for (const p of targets) {
  const rel = relative(DECK_DIR, p).split('\\').join('/')
  readFileSync(p, 'utf8').split('\n').forEach((line, i) => {
    if (!line.includes(NEEDLE)) return
    const ok = allow.some((a) => (a.file === rel || a.file === basename(p)) &&
      (!a.snippet || line.includes(a.snippet)))
    if (!ok) bad.push(`${rel}:${i + 1}  ${line.trim().slice(0, 120)}`)
  })
}

console.log(`\n⓪e 陈旧路径断言（不可分发路径 \`${NEEDLE}\`）：扫 ${targets.length} 个文本文件（*.md/*.json/*.mjs/*.cjs/*.py/*.html）`)
console.log(`  结构性豁免（不静默）：${[...SELF_EXEMPT].join(' · ')} —— 理由：这两者**必须**写出/描述该路径本身，属"规则表达式"而非"陈旧指引"`)
console.log(`  白名单 ${allow.length} 条（每条必须写 file+snippet+reason）：`)
for (const a of allow) console.log(`    · ${a.file}${a.snippet ? ' / "' + a.snippet + '"' : ''}  [${a.category || '-'}]  ${String(a.reason).slice(0, 90)}`)
if (bad.length) {
  console.error(`\n✗ 有 ${bad.length} 处**未登记的不可分发路径引用**（§25a：原始清单，未过滤）：`)
  for (const b of bad) console.error(`    · ${b}`)
  console.error('  处置：可执行指引 ⇒ 改指入库根 `scripts/video-factory/html-deck`；注释/布局探测 ⇒ 进 `probe-path-allowlist.json`（file+snippet+reason+category）。')
  process.exit(1)
}
console.log('  ✓ 无未登记的陈旧路径引用')
