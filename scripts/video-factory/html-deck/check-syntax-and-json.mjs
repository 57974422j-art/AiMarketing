#!/usr/bin/env node
/* check-syntax-and-json.mjs —— **全量语法 / JSON 守卫**（team-lead 批准，判红）
 *
 * 两件事（都是"通用防线"，比逐条匹配更根本、零误报）：
 *   ① **全量 `node --check`**（所有 `.mjs`）—— 抓"**已经造成语法错**"的：
 *      事故类型：块注释里出现【星号紧跟斜杠】的连写 ⇒ 注释被提前终止 ⇒ 尾部当代码 ⇒ 语法错
 *      （本文件第一版就踩了：注释里原样写了那个连写 ⇒ 当场语法错 —— 正好由本条规矩抓住）。
 *   ② **全量 `.json` 必须能 `JSON.parse`** —— 抓任何 JSON 破损：
 *      事故类型：JSON 内层用了直引号（`"真 bug"`）⇒ 非法（我本轮也踩过一次）。
 *   （"内层引号一律中文引号"只作**约定**，不做断言 —— 风格 ≠ 正确性。）
 *
 * 扫描面：入库根下 3 层 + `fonts/`（跳过 `out` 前缀目录 / `node_modules` / `evidence` / `cs-test` / `seek-test` / 点目录）
 * 退出码：0 = 全过 · 1 = 有语法/JSON 错（红）· 2 = 一个文件都没扫到（"无事可查" ≠ "查过且通过"）
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join, relative } from 'node:path'
import { DECK_DIR, ENGINE_ROOT, selfCheck } from './paths.mjs'

selfCheck({ quiet: true })

const SKIP_DIR = /^(out|node_modules|evidence|cs-test|seek-test|\.)/
const files = []
const collect = (dir, depth = 0) => {
  let es = []
  try { es = readdirSync(dir, { withFileTypes: true }) } catch { return }
  for (const e of es) {
    if (e.isDirectory()) { if (!SKIP_DIR.test(e.name) && depth < 3) collect(join(dir, e.name), depth + 1); continue }
    if (/\.(mjs|json)$/i.test(e.name)) files.push(join(dir, e.name))
  }
}
collect(DECK_DIR)
const fontsDir = join(ENGINE_ROOT, 'fonts')
if (existsSync(fontsDir)) collect(fontsDir)

const mjs = files.filter((f) => /\.mjs$/i.test(f))
const json = files.filter((f) => /\.json$/i.test(f))
const check = mjs.filter((f) => spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' }).status !== 0)
const badJson = []
for (const f of json) {
  try { JSON.parse(readFileSync(f, 'utf8')) } catch (e) { badJson.push(`${f} —— ${e.message}`) }
}

console.log(`\n⓪f 全量语法/JSON 守卫：.mjs ${mjs.length} 个（node --check）· .json ${json.length} 个（JSON.parse）`)
if (!mjs.length || !json.length) {
  console.error(`✗ 扫描到 0 个 .mjs 或 0 个 .json ⇒ exit 2（"无事可查" ≠ "查过且通过"）`)
  process.exit(2)
}
if (check.length || badJson.length) {
  console.error(`\n✗ 语法/JSON 错（§25a：原始清单，未过滤）`)
  for (const f of check) console.error(`    · [node --check 失败] ${relative(ENGINE_ROOT, f)}`)
  for (const f of badJson) console.error(`    · [JSON.parse 失败] ${relative(ENGINE_ROOT, f)}`)
  console.error('  ⇒ 语法错优先查"块注释里是否出现 `*/` 连写"（该写法会提前终止注释、尾部当代码）')
  process.exit(1)
}
console.log(`  ✓ ${mjs.length} 个 .mjs 语法全过 · ${json.length} 个 .json 全部可解析`)
