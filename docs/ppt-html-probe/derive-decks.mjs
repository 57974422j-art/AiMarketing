#!/usr/bin/env node
/**
 * derive-decks.mjs —— 从母 deck 派生变体，并**机器断言"只改了指定字段"**
 *
 * 为什么要有这个脚本：本轮要"同一个 deck，只改 masterId / orientation"出多套片。
 * 靠人手工复制 JSON 会悄悄漂移（少一个字段、改错一处），所以把派生过程脚本化 +
 * 断言"把改动还原回去后，与母 deck 语义完全一致"。
 *
 * 用法: node derive-decks.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const EX = join(HERE, 'examples')
const read = (f) => JSON.parse(readFileSync(join(EX, f), 'utf8'))

/** 变异体：母 deck → 目标文件，只改 `patch` 里那几个 style 字段 */
const VARIANTS = [
  { src: 'deck.types8.json', dst: 'deck.types8-master-v2.json', patch: { masterId: 'master-v2', palette: 'azure' } },
  { src: 'deck.types8.json', dst: 'deck.types8-9x16.json', patch: { orientation: '9:16' } },
  { src: 'deck.types8.json', dst: 'deck.types8-9x16-master-v2.json', patch: { orientation: '9:16', masterId: 'master-v2', palette: 'azure' } },
  { src: 'deck.charttypes.json', dst: 'deck.charttypes-master-v2.json', patch: { masterId: 'master-v2', palette: 'azure' } },
  // 竖屏的 line/donut 像素反推（浅色+竖屏+占比环是最容易暴露"阈值/几何写死"的组合）
  { src: 'deck.charttypes.json', dst: 'deck.charttypes-9x16.json', patch: { orientation: '9:16' } },
  { src: 'deck.charttypes.json', dst: 'deck.charttypes-9x16-master-v2.json', patch: { orientation: '9:16', masterId: 'master-v2', palette: 'azure' } },
  // density 的像素级验证（要断言页边距差在横竖屏都成立）
  // 竖屏图片页三版式 + 竖屏 12 页整片（补齐"母版 × 几何"矩阵）
  { src: 'deck.img3.json', dst: 'deck.img3-9x16.json', patch: { orientation: '9:16' } },
  { src: 'deck.img3.json', dst: 'deck.img3-9x16-master-v2.json', patch: { orientation: '9:16', masterId: 'master-v2', palette: 'azure' } },
  { src: 'deck.all12.json', dst: 'deck.all12-9x16.json', patch: { orientation: '9:16' } },
  { src: 'deck.all12.json', dst: 'deck.all12-9x16-master-v2.json', patch: { orientation: '9:16', masterId: 'master-v2', palette: 'azure' } },
  // 12 页整片 + 图片页三版式：也要在两套母版上各出一片
  { src: 'deck.all12.json', dst: 'deck.all12-master-v2.json', patch: { masterId: 'master-v2', palette: 'azure' } },
  { src: 'deck.img3.json', dst: 'deck.img3-master-v2.json', patch: { masterId: 'master-v2', palette: 'azure' } },
  { src: 'deck.types8.json', dst: 'deck.types8-airy.json', patch: { density: 'airy' } },
  { src: 'deck.types8.json', dst: 'deck.types8-dense.json', patch: { density: 'dense' } },
  { src: 'deck.types8.json', dst: 'deck.types8-airy-9x16.json', patch: { density: 'airy', orientation: '9:16' } },
  { src: 'deck.types8.json', dst: 'deck.types8-dense-9x16.json', patch: { density: 'dense', orientation: '9:16' } },
]

let bad = 0
for (const v of VARIANTS) {
  const base = read(v.src)
  const baseSnapshot = JSON.stringify(base)
  const out = JSON.parse(JSON.stringify(base))
  for (const [k, val] of Object.entries(v.patch)) out.style[k] = val
  writeFileSync(join(EX, v.dst), JSON.stringify(out, null, 2) + '\n', 'utf8')

  // 断言：把 patch 还原回去 → 必须与母 deck 语义完全一致（说明"只改了这些字段"）
  const back = read(v.dst)
  for (const [k, val] of Object.entries(v.patch)) back.style[k] = base.style[k]
  const ok = JSON.stringify(back) === baseSnapshot
  if (!ok) bad++
  const patchStr = Object.entries(v.patch).map(([k, val]) => `${k}=${val}`).join(' + ')
  console.log(`${ok ? '✓' : '✗'} ${v.dst.padEnd(38)} ← ${v.src}  只改: ${patchStr}`)
}
console.log(`\n结论: ${bad === 0 ? `PASS（${VARIANTS.length} 个派生 deck 都只改了声明字段）` : `FAIL（${bad} 个派生 deck 有额外改动）`}`)
process.exit(bad === 0 ? 0 : 1)
