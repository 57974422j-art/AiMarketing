#!/usr/bin/env node
/**
 * inject-long-text.mjs —— 测试助手：把某个选择器的文本换成"超长文本"（做"量具能失败"的注入）
 *
 * 用法: node inject-long-text.mjs <dir> <css类名> [重复次数]
 *   例: node inject-long-text.mjs out-limits-demo cover-title 12
 * 说明: 直接改产物的 `index.html`（绕过校验器），用于证明**引擎/我们自己的量具能报出溢出**。
 *       ⚠ 不是生产工具，只用于"步骤 0 能失败"的证明与临界长度实测。
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'

const [dirArg, cls, nArg] = process.argv.slice(2)
if (!dirArg || !cls) {
  console.error('用法: node inject-long-text.mjs <dir> <css类名> [重复次数]')
  process.exit(2)
}
const dir = resolve(dirArg)
const html = join(dir, 'index.html')
if (!existsSync(html)) { console.error(`✗ 没有 ${html}`); process.exit(2) }
const N = Number(nArg || 12)
const LONG = '很长的测试标题'.repeat(N)

let s = readFileSync(html, 'utf8')
const re = new RegExp(`<(h1|h2|div|p|span)([^>]*class="[^"]*\\b${cls}\\b[^"]*"[^>]*)>([\\s\\S]*?)<\\/\\1>`)
const m = re.exec(s)
if (!m) { console.error(`✗ 没找到 .${cls}（检查点失效，别据此下结论）`); process.exit(2) }
const before = m[3].replace(/<[^>]+>/g, '').length
s = s.slice(0, m.index) + `<${m[1]}${m[2]}>${LONG}</${m[1]}>` + s.slice(m.index + m[0].length)
writeFileSync(html, s, 'utf8')
console.log(`  已注入 .${cls}：原 ${before} 字 → ${LONG.length} 字（重复 ${N}×）`)
