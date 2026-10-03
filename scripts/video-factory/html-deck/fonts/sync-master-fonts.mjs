#!/usr/bin/env node
/**
 * fonts/sync-master-fonts.mjs —— 把**共用字体**按需 materialize 到各母版的 assets/ 里
 *
 * 为什么要它：内嵌字体只有**唯一一份**（`probe-hf/fonts/`，由母版清单 fonts.src 声明），
 * 但**手写母版**（`masters/<id>/master-16x9.html` / `master-9x16.html`）里的 CSS 用的是相对路径
 * `assets/` 下的 `.woff2` —— 直接 `hyperframes render masters/master-v1` 时需要那些文件在场。
 * 生成器路径（`deck-contract/render-deck.mjs`）**不需要**本脚本：它渲染时自动从 fonts/ 拷进产物 assets。
 *
 * ★ 本脚本是**幂等的**：拷完会把"共用字体"与"母版内的副本"做字节比对，不一致才覆盖，并在最后复核。
 * ★ 它**不是第二份真源**：真源永远是 `fonts/`；母版里的是派生物（check-master-manifest.mjs 会断言两者字节一致）。
 *
 * 用法: node fonts/sync-master-fonts.mjs
 */
import { readFileSync, existsSync, copyFileSync, mkdirSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
/* ★ 为什么这里**必须**自推根（而不能 import `paths.mjs`）—— 实测教训，别再"收口"一次：
   本文件在 `fonts/` 下，而 `paths.mjs` 在**脚本目录**下：dev 布局是 `probe-hf/{fonts/, deck-contract/paths.mjs}`、
   flat 布局是 `html-deck/{fonts/, paths.mjs}` ⇒ **同一个相对路径在两种布局下指向不同地方**（`../paths.mjs`
   在 flat 对、在 dev 指向不存在的 `probe-hf/paths.mjs` ✗）。而 `resolve(HERE,'..')` 在两种布局下**都**等于引擎根 ✓
   （dev: `probe-hf` / flat: `html-deck`，均已实测）。
   ⇒ 该行在 `gate-release.mjs` 的"自造路径断言"里**显式豁免**（带本条理由，不静默）。 */
const ROOT = resolve(HERE, '..')
const same = (a, b) => existsSync(a) && existsSync(b) && Buffer.compare(readFileSync(a), readFileSync(b)) === 0

let bad = 0
for (const id of ['master-v1', 'master-v2']) {
  const man = join(ROOT, 'masters', id, 'master.json')
  if (!existsSync(man)) { console.log(`✗ 缺清单 ${man}`); bad++; continue }
  const m = JSON.parse(readFileSync(man, 'utf8'))
  if (!m.fonts?.src || !Array.isArray(m.fonts.files)) { console.log(`✗ ${id} 清单未声明 fonts{src,files}`); bad++; continue }
  const srcDir = resolve(join(ROOT, 'masters', id), m.fonts.src)
  const dstDir = join(ROOT, 'masters', id, m.assets || 'assets')
  mkdirSync(dstDir, { recursive: true })
  for (const f of m.fonts.files) {
    const from = join(srcDir, f), to = join(dstDir, f)
    if (same(from, to)) { console.log(`  = ${id}/assets/${f}  已一致（未动）`); continue }
    copyFileSync(from, to)
    const ok = same(from, to)
    if (!ok) bad++
    console.log(`  ${ok ? '✓' : '✗'} ${id}/assets/${f}  ${ok ? '已同步（与 fonts/ 字节一致）' : '同步后仍不一致！'}`)
  }
}
console.log(`\n结论: ${bad === 0 ? 'PASS（母版内副本与共用字体字节一致；真源始终是 fonts/）' : `FAIL（${bad} 项）`}`)
process.exit(bad ? 1 : 0)
