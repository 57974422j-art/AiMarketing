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
 * 行尾（probe-html ③a）：目标文件若用 CRLF，追加文本也**转成 CRLF**，避免同一文件混用行尾
 *   （混用会让"下次触碰整文件变化"变成假脏改动）。脚本会打印每套母版的行尾口径。
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
const A = {}
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i]
  if (!(a in FLAGS)) {
    console.error(`✗ 未识别的参数：${a}\n   允许：${Object.keys(FLAGS).join(' ')}`)
    process.exit(EXIT.INPUT)
  }
  const k = FLAGS[a]
  if (k === 'dryRun' || k === 'list') { A[k] = true; continue }
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
  const eol = css.includes('\r\n') ? '\r\n' : '\n'
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
  /* ★ 行尾统一（probe-html ③a）：目标文件可能是**历史混用**（早先编辑写入 LF）
   *   ⇒ 整文件规范到"主流行尾"，并把修正处数打出来（不许静默改） */
  const loneLF = (s) => (s.match(/(?<!\r)\n/g) || []).length
  let normNote = ''
  if (eol === '\r\n' && loneLF(css) > 0) {
    const n = loneLF(css)
    css = css.replace(/\r?\n/g, '\r\n')
    normNote = `（已统一行尾：修正 ${n} 处 LF→CRLF）`
  }
  /* 重读断言：每层标记**恰 1 份** */
  const back = A.dryRun ? css : (writeFileSync(p, css), readFileSync(p, 'utf8'))
  const bad = applied.filter((n) => (back.split(marks(n)[0]).length - 1) !== 1)
  const eolOk = loneLF(back) === 0
  console.log(`   ${m.padEnd(18)} 层 ${applied.length} 个 · 重读标记 ${bad.length ? '✗ ' + bad.join(',') : '✓ 各 1 份'} · 行尾 ${eol === '\r\n' ? 'CRLF' : 'LF'}${eolOk ? '（统一 ✓）' : '（**混用 ✗**）'}${normNote}`)
  if (bad.length || !eolOk) fail++
}
console.log(`${fail ? '✗' : '✓'} [LAYERS-RESULT] LAYERS-RESULT ok=${fail === 0} · 母版 ${masters.length} · 层 ${wantLayers.length} · 失败 ${fail}${A.dryRun ? '（dry-run：未落盘）' : ''}`)
process.exit(fail === 0 ? EXIT.OK : EXIT.FAIL)
