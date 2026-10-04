#!/usr/bin/env node
/**
 * apply-master-layers.mjs —— 把 `master-layers/<name>.css` **幂等**追加到每套母版的 `assets/master.css`
 *
 * 为什么要有这个脚本：
 *   · 竖屏节奏层此前是"我本机一个临时脚本一次写入 8 个母版" ⇒ **不可复现**（换台机器无法重跑/复核）
 *     —— probe-html 当场指出（`git ls-files` 里没有那个脚本）⇒ 收口成**入库工具 + 入库层文件**。
 *   · 层文件是**唯一真源**：改层 = 改 `master-layers/<name>.css`，再跑本脚本；**不要手改各母版**。
 *
 * 约定：层文件必须自带成对标记（形如 `LAYER: <name> (BEGIN)` / `LAYER: <name> (END)` 的块注释）
 *   本工具据此**先删旧块、再追加**（幂等；标记由文件名推导，层名与文件名必须一致）。
 *   ⚠️ 标记字符串在本文件里**拼接构造**（不写字面量）：注释卫生检查会扫"块注释里的闭合符"，
 *      写字面量会被判红（我们踩过同族：注释里写闭合符）。
 *
 * 行尾（probe-html ③a/③）：**以仓库声明为准** —— `.gitattributes` 是 `* text=auto eol=lf` ⇒ 规范 = **LF**。
 *   故本工具把追加文本与**整文件**都规范到 LF，并打印修正处数（第一版统一成 CRLF，与仓库方向相反，已改）。
 *
 * 用法：
 *   node apply-master-layers.mjs [--layer portrait-pass-v1] [--masters all|master-mono,master-v1]
 *        [--dry-run] [--list]
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs'
import { join, dirname, basename } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const EXIT = { OK: 0, FAIL: 1, INPUT: 2 }
const FLAGS = { '--layer': 'layer', '--masters': 'masters', '--dry-run': 'dryRun', '--list': 'list' }
/* ★ 旗标**类型声明 = 唯一真源**（team-lead msg28 ④ / probe-html msg29 ①）：解析器**从它派生**。
   背景坑：`--dry-run` 曾被当"有值旗标"读 ⇒ `A.dryRun = argv[++i]` **吃掉下一个参数**（看着在预览、实际在干活）。
   ⇒ 声明 bool 者走"置真"分支；有值者才 `argv[++i]` ⇒ 这类坑**结构性无法发生**。 */
const BOOL_KEYS = new Set(['dryRun', 'list'])
const A = {}
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i]
  if (!(a in FLAGS)) {
    console.error(`✗ 未识别的参数：${a}\n   允许：${Object.keys(FLAGS).join(' ')}`)
    process.exit(EXIT.INPUT)
  }
  const k = FLAGS[a]
  if (BOOL_KEYS.has(k)) { A[k] = true; continue }      /* 派生自声明：bool ⇒ 不吃下一个参数 */
  A[k] = process.argv[++i]
}
const DOWNSTREAM_FLAGS = new Set([])   // 本工具不调用别的工具（两张表纪律：没有下游就空表）
/* 旗标三件套（自有表 ⊇ 源码全部旗标字面量 · 每个注册项必须被消费） */
{
  const src = readFileSync(fileURLToPath(import.meta.url), 'utf8')
  const found = [...new Set([...src.matchAll(/'(--[a-zA-Z][\w-]*)'/g)].map((m) => m[1]))]
  const known = new Set(Object.keys(FLAGS))
  const missing = found.filter((f) => !known.has(f) && !DOWNSTREAM_FLAGS.has(f))
  const dead = [...known].filter((n) => !new RegExp(`\\b(A|opt|o)\\.${FLAGS[n]}\\b`).test(src))
  if (missing.length || dead.length) {
    console.error(`✗ 旗标三件套：注册表不全 ${missing.join(' ') || '（无）'} · 注册未消费 ${dead.join(' ') || '（无）'}`)
    process.exit(EXIT.INPUT)
  }
  /* ★ 第 ④ 条（类型）：① BOOL_KEYS 每个键必须**已注册** ② 解析器**真的**用 `BOOL_KEYS.has(` ③ 有值路径必须存在 */
  const unregisteredBool = [...BOOL_KEYS].filter((k) => !Object.values(FLAGS).includes(k))
  const derivedParser = src.includes('BOOL_KEYS.has(')
  const valuePath = /A\[k\] = process\.argv\[\+\+i\]/.test(src)
  if (unregisteredBool.length || !derivedParser || !valuePath) {
    console.error(`✗ 旗标三件套-④ 类型：未注册的 bool 键 ${unregisteredBool.join(' ') || '（无）'} · 解析器派生=${derivedParser} · 有值路径=${valuePath}`)
    process.exit(EXIT.INPUT)
  }
  const boolName = [...BOOL_KEYS].map((k) => Object.keys(FLAGS).find((f) => FLAGS[f] === k)).join('/')
  console.log(`  ✓ 旗标三件套-④ 类型：bool ${boolName} · 值旗标 ${known.size - BOOL_KEYS.size} · 解析器由声明派生 ✓`)
}

const layersDir = join(HERE, 'master-layers')
const mastersDir = join(HERE, 'masters')
/* ★ 标记字符串**拼接构造**（注释卫生检查会扫"块注释里的闭合符"；写字面量必被judged红 —— 我们踩过同族） */
const CLOSE = '*' + '/'
const OPEN = '/' + '*'
const marks = (name) => [
  `${OPEN} ===== LAYER: ${name} (BEGIN) =====`,
  `${OPEN} ===== LAYER: ${name} (END) ===== ${CLOSE}`,
]
const allLayers = existsSync(layersDir) ? readdirSync(layersDir).filter((f) => f.endsWith('.css')) : []
if (A.list) { console.log(`   层文件 ${allLayers.length} 个：${allLayers.join(', ') || '(无)'}`); process.exit(EXIT.OK) }
const wantLayers = A.layer ? [`${A.layer}.css`] : allLayers
for (const f of wantLayers) if (!existsSync(join(layersDir, f))) { console.error(`✗ 层文件不存在：${f}`); process.exit(EXIT.INPUT) }
const masters = (A.masters && A.masters !== 'all' ? String(A.masters).split(',') : readdirSync(mastersDir))
  .filter((m) => existsSync(join(mastersDir, m, 'assets', 'master.css')))
if (!masters.length) { console.error('✗ 没有可应用的母版（masters/<id>/assets/master.css）'); process.exit(EXIT.INPUT) }

let fail = 0
for (const m of masters) {
  const p = join(mastersDir, m, 'assets', 'master.css')
  let css = readFileSync(p, 'utf8')
  const eol = '\n'   /* 仓库声明 LF（`.gitattributes`）⇒ 统一目标 */
  const applied = []
  for (const f of wantLayers) {
    const name = basename(f, '.css')
    const layer = readFileSync(join(layersDir, f), 'utf8')
    const [bMark, eMark] = marks(name)
    if (!layer.includes(bMark) || !layer.includes(eMark)) {
      console.log(`   ✗ ${f}：缺标记（须含 ${bMark} … ${eMark}）`); fail++; continue
    }
    const body = eol === '\n' ? layer : layer.replace(/\r?\n/g, '\r\n')
    /* 幂等：先删旧块（含标记行），再追加 */
    const bi = css.indexOf(bMark), ei = css.indexOf(eMark)
    if (bi >= 0 && ei > bi) {
      const from = css.lastIndexOf('\n', bi)
      const to = css.indexOf('\n', ei)
      css = css.slice(0, from < 0 ? 0 : from) + css.slice(to < 0 ? css.length : to)
    }
    css = css.replace(/\s+$/, '') + eol + body
    applied.push(name)
  }
  /* ★ 行尾：**以仓库声明为准**（`.gitattributes`: `* text=auto eol=lf` ⇒ 库内/工作树规范 = **LF**）
   *   —— probe-html ③ 指出我第一版统一成 CRLF 与仓库**方向相反**（虽不阻塞：git 会按 clean filter 归一，
   *   但会让工作树"看着脏"且每次触碰报行尾警告）⇒ 改为**整文件规范到 LF**，并打印修正处数（不许静默改）。 */
  const crlfCount = (s) => (s.match(/\r\n/g) || []).length
  let normNote = ''
  if (crlfCount(css) > 0) {
    const n = crlfCount(css)
    css = css.replace(/\r\n/g, '\n')
    normNote = `（已统一行尾：修正 ${n} 处 CRLF→LF）`
  }
  /* 重读断言：每层标记**恰 1 份** + 行尾无 CRLF */
  const back = A.dryRun ? css : (writeFileSync(p, css), readFileSync(p, 'utf8'))
  const bad = applied.filter((n) => (back.split(marks(n)[0]).length - 1) !== 1)
  const eolOk = crlfCount(back) === 0
  console.log(`   ${m.padEnd(18)} 层 ${applied.length} 个 · 重读标记 ${bad.length ? '✗ ' + bad.join(',') : '✓ 各 1 份'} · 行尾 LF${eolOk ? '（统一 ✓）' : '（**仍有 CRLF ✗**）'}${normNote}`)
  if (bad.length || !eolOk) fail++
}
console.log(`${fail ? '✗' : '✓'} [LAYERS-RESULT] LAYERS-RESULT ok=${fail === 0} · 母版 ${masters.length} · 层 ${wantLayers.length} · 失败 ${fail}${A.dryRun ? '（dry-run：未落盘）' : ''}`)
process.exit(fail === 0 ? EXIT.OK : EXIT.FAIL)
