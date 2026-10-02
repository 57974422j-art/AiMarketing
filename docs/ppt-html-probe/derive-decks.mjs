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

/** 竖屏 img3 的两处页改动（D15：left/right → full 的两种分支） */
const IMG3_PORTRAIT = [
  { i: 1, set: { layout: 'full', title: '竖屏满幅：有角标、无图注', kicker: 'FULL' }, del: ['caption'] },
  { i: 2, set: { layout: 'full', title: '竖屏满幅：有图注', caption: '竖屏下媒体是整宽顶带，文案落在下方版心' } },
]

/** 变异体：母 deck → 目标文件，只改 `patch` 里那几个 style 字段（可选 meta / pagePatch） */
const VARIANTS = [
  { src: 'deck.types8.json', dst: 'deck.types8-master-v2.json', patch: { masterId: 'master-v2', palette: 'azure' } },
  { src: 'deck.types8.json', dst: 'deck.types8-9x16.json', patch: { orientation: '9:16' } },
  { src: 'deck.types8.json', dst: 'deck.types8-9x16-master-v2.json', patch: { orientation: '9:16', masterId: 'master-v2', palette: 'azure' } },
  { src: 'deck.charttypes.json', dst: 'deck.charttypes-master-v2.json', patch: { masterId: 'master-v2', palette: 'azure' } },
  // 竖屏的 line/donut 像素反推（浅色+竖屏+占比环是最容易暴露"阈值/几何写死"的组合）
  { src: 'deck.charttypes.json', dst: 'deck.charttypes-9x16.json', patch: { orientation: '9:16' } },
  { src: 'deck.charttypes.json', dst: 'deck.charttypes-9x16-master-v2.json', patch: { orientation: '9:16', masterId: 'master-v2', palette: 'azure' } },
  // density 的像素级验证（要断言页边距差在横竖屏都成立）
  // 竖屏图片页 + 竖屏 12 页整片（补齐"母版 × 几何"矩阵）
  // ★ D15：竖屏图片页只有 full ⇒ 竖屏变体把原 left/right 两页**改成 full 的两种分支**
  //   （有角标无图注 / 有图注），这样页数仍 5、且顺带覆盖 image 页的 kicker 与 caption 两条分支
  { src: 'deck.img3.json', dst: 'deck.img3-9x16.json', patch: { orientation: '9:16' },
    meta: { subtitle: '竖屏只有 full（left/right 已在契约层禁用 · D15）' }, pagePatch: IMG3_PORTRAIT },
  { src: 'deck.img3.json', dst: 'deck.img3-9x16-master-v2.json', patch: { orientation: '9:16', masterId: 'master-v2', palette: 'azure' },
    meta: { subtitle: '竖屏只有 full（left/right 已在契约层禁用 · D15）' }, pagePatch: IMG3_PORTRAIT },
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
  if (v.meta) for (const [k, val] of Object.entries(v.meta)) out.meta[k] = val
  if (v.pagePatch) {
    for (const pp of v.pagePatch) {
      for (const [k, val] of Object.entries(pp.set || {})) out.pages[pp.i][k] = val
      for (const k of (pp.del || [])) delete out.pages[pp.i][k]
    }
  }
  writeFileSync(join(EX, v.dst), JSON.stringify(out, null, 2) + '\n', 'utf8')

  // 断言：把 style/meta/页改动**逐条还原** → 必须与母 deck 语义完全一致（说明"只改了这些字段"）
  const back = read(v.dst)
  for (const [k, val] of Object.entries(v.patch)) back.style[k] = base.style[k]
  if (v.meta) for (const [k, val] of Object.entries(v.meta)) back.meta[k] = base.meta[k]
  if (v.pagePatch) {
    for (const pp of v.pagePatch) {
      for (const k of Object.keys(pp.set || {})) {
        if (base.pages[pp.i][k] === undefined) delete back.pages[pp.i][k]
        else back.pages[pp.i][k] = base.pages[pp.i][k]
      }
      for (const k of (pp.del || [])) back.pages[pp.i][k] = base.pages[pp.i][k]
    }
  }
  const ok = JSON.stringify(back) === baseSnapshot
  if (!ok) bad++
  const patchStr = Object.entries(v.patch).map(([k, val]) => `${k}=${val}`).join(' + ')
    + (v.meta ? `  meta:${Object.keys(v.meta).join(',')}` : '')
    + (v.pagePatch ? `  改页[${v.pagePatch.map((x) => x.i).join(',')}]` : '')
  console.log(`${ok ? '✓' : '✗'} ${v.dst.padEnd(38)} ← ${v.src}  只改: ${patchStr}`)
}
console.log(`\n结论: ${bad === 0 ? `PASS（${VARIANTS.length} 个派生 deck 都只改了声明字段）` : `FAIL（${bad} 个派生 deck 有额外改动）`}`)
process.exit(bad === 0 ? 0 : 1)
