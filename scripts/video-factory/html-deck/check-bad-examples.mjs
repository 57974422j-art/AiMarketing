#!/usr/bin/env node
/* check-bad-examples.mjs —— **反例（设计性失败）退出码断言**（team-lead 要求，防"真故障被洗成设计性失败"）
 *
 * 为什么：18 个 `deck.bad-*` / `deck.covercustom` / `deck.html-injected` 在日志里与"真 bug"**长得一模一样**
 *   （都是一行失败）⇒ 若不断言"**它们应该失败，且失败的退出码 == 声明值**"，任何真故障都能混进去被当成"设计性"。
 *
 * 判据（对声明表 `bad-expected.json` 的每一条）：
 *   ① `render-deck` 退出码 **== expectExit**（不等 ⇒ 红）
 *   ② **不产生 mp4 产物**（产生 ⇒ 红：说明"校验闸门漏了"）
 *   ③ 反例**不进产物清单**（本脚本用**仓库之外**的临时 outdir：绝不污染产物目录 `out…`）
 * 退出码：0 = 全部符合声明 · 1 = 有偏差（红）· 2 = 环境/声明表错（§25b）
 */
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { DECK_DIR, EXAMPLES_DIR, selfCheck } from './paths.mjs'

selfCheck({ quiet: true })

const DECL = join(DECK_DIR, 'bad-expected.json')
if (!existsSync(DECL)) {
  console.error(`✗ 缺声明表 ${DECL}（反例必须声明期望退出码；§25b ⇒ exit 2）`)
  process.exit(2)
}
let decl
try { decl = JSON.parse(readFileSync(DECL, 'utf8')).bad || [] } catch (e) {
  console.error(`✗ 声明表解析失败：${e.message}（§25b ⇒ exit 2）`)
  process.exit(2)
}
const badEntry = decl.filter((x) => !x.deck || !Number.isInteger(x.expectExit) || !x.reason)
if (badEntry.length) {
  console.error(`✗ 声明表有 ${badEntry.length} 条缺 deck/expectExit/reason ⇒ exit 2（不许只写退出码）`)
  process.exit(2)
}

/* 运行态写在**仓库之外**（契约纪律：判据只依赖"源 + 产物"） */
const TMP_OUT = join(tmpdir(), 'html-deck-badcheck')
const RENDER = join(DECK_DIR, 'render-deck.mjs')

const rows = []
let wrong = 0
for (const d of decl) {
  const deckFile = join(EXAMPLES_DIR, `${d.deck}.json`)
  if (!existsSync(deckFile)) { rows.push({ ...d, got: '(样例缺失)', ok: false, prod: false }); wrong++; continue }
  const r = spawnSync(process.execPath, [RENDER, join('examples', `${d.deck}.json`), '--outdir', TMP_OUT], { cwd: DECK_DIR, encoding: 'utf8' })
  const got = r.status
  const prodDir = join(TMP_OUT, d.deck)
  let prod = false
  if (existsSync(prodDir)) {
    try {
      const stack = [prodDir]
      while (stack.length) {
        const cur = stack.pop()
        for (const e of readdirSync(cur, { withFileTypes: true })) {
          const p = join(cur, e.name)
          if (e.isDirectory()) stack.push(p)
          else if (/\.mp4$/i.test(e.name) && statSync(p).size > 0) prod = true
        }
      }
    } catch { /* ignore */ }
  }
  const ok = got === d.expectExit && !prod
  if (!ok) wrong++
  rows.push({ ...d, got, ok, prod })
}

console.log(`\n②c 反例退出码断言（声明表 ${decl.length} 条；运行态在仓库之外：${TMP_OUT}）`)
for (const r of rows) {
  const tag = r.ok ? '✓' : '✗'
  console.log(`  ${tag} ${String(r.deck).padEnd(28)} 期望 exit=${r.expectExit}（${r.stage}）· 实得 ${r.got}${r.prod ? ' · **却产出了 mp4**' : ''}`)
}
if (wrong) {
  console.error(`\n✗ 有 ${wrong} 条**与声明不符** ⇒ 要么实现变了（真故障/真回归），要么声明该更新（**必须给出理由**）`)
  console.error('  注意：这 18 条**本来就应该失败** —— 断言的是"**失败的退出码是否与声明一致**"，不是"有没有失败"。')
  process.exit(1)
}
console.log('  ✓ 全部与声明一致（且均未产出产物）')
